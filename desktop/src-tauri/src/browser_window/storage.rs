//! Process-lifetime, workspace-isolated Browser storage.

#[cfg(windows)]
use std::path::{Path, PathBuf};
use std::{collections::HashMap, future::Future, sync::Arc};

use tauri::{LogicalPosition, LogicalSize, Manager, Webview, WebviewBuilder};
use tokio::sync::{oneshot, Mutex};

/** Retains a workspace's partition after its final tab closes. */
#[derive(Default)]
pub(super) struct WorkspaceStorage {
    #[cfg(target_os = "macos")]
    partitions: PartitionCache<PlatformStorage>,
    #[cfg(windows)]
    partitions: PartitionCache<()>,
}

struct Partition<T> {
    name: String,
    storage: T,
}

struct PartitionCache<T> {
    partitions: Mutex<HashMap<String, Arc<Partition<T>>>>,
}

impl<T> Default for PartitionCache<T> {
    fn default() -> Self {
        Self {
            partitions: Mutex::new(HashMap::new()),
        }
    }
}

impl<T> PartitionCache<T> {
    async fn acquire<F, R>(&self, workspace: &str, create: F) -> Result<Arc<Partition<T>>, String>
    where
        F: FnOnce(String) -> R,
        R: Future<Output = Result<T, String>>,
    {
        let mut partitions = self.partitions.lock().await;
        if let Some(partition) = partitions.get(workspace) {
            return Ok(partition.clone());
        }
        let name = format!("desktop-browser-{}", partitions.len() + 1);
        let storage = create(name.clone()).await?;
        let partition = Arc::new(Partition { name, storage });
        partitions.insert(workspace.to_string(), partition.clone());
        Ok(partition)
    }
}

#[cfg(target_os = "macos")]
struct PlatformStorage(
    dispatch2::MainThreadBound<objc2::rc::Retained<objc2_web_kit::WKWebsiteDataStore>>,
);

#[cfg(windows)]
struct PlatformStorage {
    // WebView2 releases the in-memory profile when its final controller closes.
    _anchor: Webview,
    environment: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment,
    directory: std::path::PathBuf,
}

#[cfg(windows)]
std::thread_local! {
    // WebView2 COM objects stay on the Tauri UI thread; DesktopState stores only workspace names.
    static PLATFORM_STORAGES: std::cell::RefCell<HashMap<String, PlatformStorage>> =
        std::cell::RefCell::new(HashMap::new());
}

/** Close one WebView on Tauri's UI thread and wait for Wry to release its controller. */
pub(super) async fn close_view(app: &tauri::AppHandle, view: Webview) -> Result<(), String> {
    let (send, receive) = oneshot::channel();
    app.run_on_main_thread(move || {
        let result = view.close().map_err(|error| error.to_string());
        drop(view);
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive
        .await
        .map_err(|_| "WebView close ended before the UI thread confirmed release".to_string())?
}

/** Close workspace anchors before releasing their WebView2 environments and profiles. */
#[cfg(windows)]
pub(super) async fn release_platform_storages(
    storage: &WorkspaceStorage,
    app: &tauri::AppHandle,
) -> Result<Vec<PathBuf>, Vec<String>> {
    let (send, receive) = oneshot::channel();
    app.run_on_main_thread(move || {
        let storages =
            PLATFORM_STORAGES.with(|storages| std::mem::take(&mut *storages.borrow_mut()));
        let mut directories = Vec::with_capacity(storages.len());
        let mut failures = Vec::new();
        for (workspace, storage) in storages {
            let PlatformStorage {
                _anchor,
                environment,
                directory,
            } = storage;
            if let Err(error) = _anchor.close() {
                failures.push(format!("workspace {workspace} anchor close: {error}"));
            }
            drop(_anchor);
            drop(environment);
            directories.push(directory);
        }
        let _ = send.send((directories, failures));
    })
    .map_err(|error| vec![error.to_string()])?;

    let (directories, mut failures) = receive
        .await
        .map_err(|_| vec!["Browser storage release ended before the UI thread responded".into()])?;
    for directory in &directories {
        if let Err(error) = remove_profile_directory(directory).await {
            failures.push(format!(
                "WebView2 profile {} could not be removed: {error}",
                directory.display()
            ));
        }
    }
    storage.partitions.partitions.lock().await.clear();
    if failures.is_empty() {
        Ok(directories)
    } else {
        Err(failures)
    }
}

#[cfg(windows)]
async fn remove_profile_directory(directory: &Path) -> Result<(), String> {
    const ATTEMPTS: u32 = 7;
    for attempt in 0..ATTEMPTS {
        match tokio::fs::remove_dir_all(directory).await {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error)
                if attempt + 1 < ATTEMPTS && matches!(error.raw_os_error(), Some(5 | 32 | 33)) =>
            {
                tokio::time::sleep(std::time::Duration::from_millis(25 * (1 << attempt))).await;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

impl WorkspaceStorage {
    /** Attach a tab to the workspace's retained memory store, creating it once. */
    pub(super) async fn create_view(
        &self,
        app: &tauri::AppHandle,
        workspace: &str,
        builder: WebviewBuilder<tauri::Wry>,
    ) -> Result<(Webview, String), String> {
        let partition = self
            .partitions
            .acquire(workspace, |name| create_storage(app, name))
            .await?;
        let name = partition.name.clone();
        let app_main = app.clone();
        let (send, receive) = oneshot::channel();
        app.run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            let result = configure_builder(&partition.storage, builder)
                .and_then(|builder| add_child(&app_main, builder));
            #[cfg(windows)]
            let result = PLATFORM_STORAGES.with(|storages| {
                let builder = {
                    let storages = storages.borrow();
                    let storage = storages.get(&partition.name).ok_or_else(|| {
                        "Desktop Browser workspace storage is not available on the UI thread"
                            .to_string()
                    })?;
                    configure_builder(storage, builder)?
                };
                add_child(&app_main, builder)
            });
            let _ = send.send(result);
        })
        .map_err(|error| error.to_string())?;
        let view = receive
            .await
            .map_err(|_| "Desktop Browser storage creation was interrupted".to_string())??;
        Ok((view, name))
    }
}

fn add_child(
    app: &tauri::AppHandle,
    builder: WebviewBuilder<tauri::Wry>,
) -> Result<Webview, String> {
    app.get_window("main")
        .ok_or_else(|| "Desktop main window is unavailable".to_string())?
        .add_child(
            builder,
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(1.0, 1.0),
        )
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
async fn create_storage(app: &tauri::AppHandle, _name: String) -> Result<PlatformStorage, String> {
    let (send, receive) = oneshot::channel();
    app.run_on_main_thread(move || {
        let mtm = objc2::MainThreadMarker::new().expect("Tauri main thread");
        // SAFETY: WebKit storage is created and subsequently accessed on the main thread.
        let store = unsafe { objc2_web_kit::WKWebsiteDataStore::nonPersistentDataStore(mtm) };
        let _ = send.send(PlatformStorage(dispatch2::MainThreadBound::new(store, mtm)));
    })
    .map_err(|error| error.to_string())?;
    receive
        .await
        .map_err(|_| "Desktop Browser storage creation was interrupted".to_string())
}

#[cfg(target_os = "macos")]
fn configure_builder(
    storage: &PlatformStorage,
    builder: WebviewBuilder<tauri::Wry>,
) -> Result<WebviewBuilder<tauri::Wry>, String> {
    let mtm = objc2::MainThreadMarker::new().expect("Tauri main thread");
    // SAFETY: Both the configuration and its workspace store stay on the main thread.
    let config = unsafe {
        let config = objc2_web_kit::WKWebViewConfiguration::new(mtm);
        config.setWebsiteDataStore(storage.0.get(mtm));
        config
    };
    Ok(builder.with_webview_configuration(config))
}

#[cfg(windows)]
async fn create_storage(app: &tauri::AppHandle, name: String) -> Result<(), String> {
    use tauri::WebviewUrl;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_13;
    use webview2_windows::core::{Interface, BOOL};

    // The directory selects an isolated WebView2 environment; browsing data is InPrivate.
    let process_nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let root = std::env::temp_dir().join("deepdive-browser");
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let directory = root.join(format!("{}-{process_nonce}-{name}", std::process::id()));
    std::fs::create_dir(&directory).map_err(|error| error.to_string())?;
    let anchor = match add_child(
        app,
        WebviewBuilder::new(
            format!("{name}-storage"),
            WebviewUrl::External("about:blank".parse().unwrap()),
        )
        .focused(false)
        .incognito(true)
        .data_directory(directory.clone())
        .on_navigation(|url| url.as_str() == "about:blank")
        .on_download(|_, _| false)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny),
    ) {
        Ok(anchor) => anchor,
        Err(error) => {
            let _ = remove_profile_directory(&directory).await;
            return Err(error);
        }
    };
    if let Err(error) = anchor.hide() {
        let mut failures = vec![error.to_string()];
        if let Err(error) = close_view(app, anchor).await {
            failures.push(format!("Browser storage anchor close: {error}"));
        }
        if let Err(error) = remove_profile_directory(&directory).await {
            failures.push(format!("WebView2 profile cleanup: {error}"));
        }
        return Err(failures.join("; "));
    }
    let (send, receive) = oneshot::channel();
    let storage_name = name.clone();
    let directory_for_storage = directory.clone();
    let storage_anchor = anchor.clone();
    let inspect = anchor.with_webview(move |platform| {
        // SAFETY: Tauri invokes this callback on the controller's owning thread.
        let result = unsafe {
            (|| {
                let view = platform
                    .controller()
                    .CoreWebView2()
                    .map_err(|error| error.to_string())?;
                let profile = view
                    .cast::<ICoreWebView2_13>()
                    .map_err(|error| error.to_string())?
                    .Profile()
                    .map_err(|error| error.to_string())?;
                let mut private = BOOL::default();
                profile
                    .IsInPrivateModeEnabled(&mut private)
                    .map_err(|error| error.to_string())?;
                if !private.as_bool() {
                    return Err("Desktop Browser requires WebView2 InPrivate storage".to_string());
                }
                Ok(platform.environment())
            })()
        };
        match result {
            Ok(environment) => {
                PLATFORM_STORAGES.with(|storages| {
                    storages.borrow_mut().insert(
                        storage_name.clone(),
                        PlatformStorage {
                            _anchor: storage_anchor,
                            environment,
                            directory: directory_for_storage,
                        },
                    );
                });
                if send.send(Ok(())).is_err() {
                    let storage = PLATFORM_STORAGES.with(|storages| {
                        storages.borrow_mut().remove(&storage_name)
                    });
                    if let Some(storage) = storage {
                        let directory = storage.directory.clone();
                        let _ = storage._anchor.close();
                        drop(storage);
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = remove_profile_directory(&directory).await {
                                eprintln!("WebView2 profile cleanup after cancelled acquire failed: {error}");
                            }
                        });
                    }
                }
            }
            Err(error) => {
                let _ = send.send(Err(error));
            }
        }
    });
    if let Err(error) = inspect {
        let mut failures = vec![error.to_string()];
        if let Err(error) = close_view(app, anchor).await {
            failures.push(format!("Browser storage anchor close: {error}"));
        }
        if let Err(error) = remove_profile_directory(&directory).await {
            failures.push(format!("WebView2 profile cleanup: {error}"));
        }
        return Err(failures.join("; "));
    }
    let result = receive
        .await
        .unwrap_or_else(|_| Err("Desktop Browser storage creation was interrupted".into()));
    if let Err(error) = result {
        let mut failures = vec![error];
        if let Err(error) = close_view(app, anchor).await {
            failures.push(format!("Browser storage anchor close: {error}"));
        }
        if let Err(error) = remove_profile_directory(&directory).await {
            failures.push(format!("WebView2 profile cleanup: {error}"));
        }
        return Err(failures.join("; "));
    }
    Ok(())
}

#[cfg(windows)]
fn configure_builder(
    storage: &PlatformStorage,
    builder: WebviewBuilder<tauri::Wry>,
) -> Result<WebviewBuilder<tauri::Wry>, String> {
    Ok(builder
        .incognito(true)
        .data_directory(storage.directory.clone())
        .with_environment(storage.environment.clone()))
}

#[cfg(all(windows, feature = "webview2-lifecycle-test"))]
pub(super) async fn run_webview2_lifecycle_test(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::WebviewUrl;

    let state = app.state::<crate::DesktopState>();
    *state.origin.write().unwrap() = Some("http://127.0.0.1:47821".into());
    let workspace = format!("webview2-lifecycle-test-{}", std::process::id());
    let mut guests = Vec::new();
    let mut partition = None;
    let mut failures = Vec::new();
    for label in ["browser-lifecycle-first", "browser-lifecycle-second"] {
        let builder =
            WebviewBuilder::new(label, WebviewUrl::External("about:blank".parse().unwrap()))
                .focused(false);
        match state
            .browser
            .storage
            .create_view(app, &workspace, builder)
            .await
        {
            Ok((view, name)) => {
                if partition
                    .as_ref()
                    .is_some_and(|partition| partition != &name)
                {
                    failures.push("workspace tabs did not reuse their storage partition".into());
                }
                partition.get_or_insert(name);
                if let Err(error) = super::browser_window_windows::install(
                    app,
                    label,
                    &view,
                    "http://127.0.0.1:47821",
                )
                .await
                {
                    failures.push(format!("Browser hook installation failed: {error}"));
                }
                guests.push(view);
            }
            Err(error) => {
                failures.push(format!("Browser guest creation failed: {error}"));
                break;
            }
        }
    }
    let profiles = match profile_directories(app).await {
        Ok(profiles) => profiles,
        Err(error) => {
            failures.push(format!(
                "WebView2 workspace profiles could not be inspected: {error}"
            ));
            Vec::new()
        }
    };
    for view in &guests {
        if let Err(error) = verify_guest_in_private_mode(view).await {
            failures.push(format!("Browser guest profile check failed: {error}"));
        }
    }
    while let Some(view) = guests.pop() {
        if let Err(error) = close_view(app, view).await {
            failures.push(format!("Browser guest close failed: {error}"));
        }
    }
    failures.extend(super::shutdown(app).await);
    if profiles.len() != 1 {
        failures.push(format!(
            "expected one WebView2 workspace profile, found {}",
            profiles.len()
        ));
    }
    if profiles.iter().any(|profile| profile.exists()) {
        failures.push("a WebView2 workspace profile remained after shutdown".into());
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

#[cfg(all(windows, feature = "webview2-lifecycle-test"))]
async fn profile_directories(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    let (send, receive) = oneshot::channel();
    app.run_on_main_thread(move || {
        let directories = PLATFORM_STORAGES.with(|storages| {
            storages
                .borrow()
                .values()
                .map(|storage| storage.directory.clone())
                .collect::<Vec<_>>()
        });
        let _ = send.send(directories);
    })
    .map_err(|error| error.to_string())?;
    receive
        .await
        .map_err(|_| "WebView2 profile inspection ended before the UI thread responded".into())
}

#[cfg(all(windows, feature = "webview2-lifecycle-test"))]
async fn verify_guest_in_private_mode(view: &Webview) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_13;
    use webview2_windows::core::{Interface, BOOL};

    let (send, receive) = oneshot::channel();
    view.with_webview(move |platform| {
        let result = unsafe {
            (|| {
                let core = platform
                    .controller()
                    .CoreWebView2()
                    .map_err(|error| error.to_string())?;
                let profile = core
                    .cast::<ICoreWebView2_13>()
                    .map_err(|error| error.to_string())?
                    .Profile()
                    .map_err(|error| error.to_string())?;
                let mut enabled = BOOL::default();
                profile
                    .IsInPrivateModeEnabled(&mut enabled)
                    .map_err(|error| error.to_string())?;
                if enabled.as_bool() {
                    Ok(())
                } else {
                    Err("WebView2 did not create an InPrivate guest".to_string())
                }
            })()
        };
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive
        .await
        .map_err(|_| "WebView2 profile check ended before returning".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn workspace_tabs_share_storage_and_other_workspaces_are_isolated() {
        tauri::async_runtime::block_on(async {
            let cache = PartitionCache::default();
            let first = cache.acquire("alpha", |_| async { Ok(1) }).await.unwrap();
            let same = cache
                .acquire("alpha", |_| async {
                    panic!("must reuse workspace storage")
                })
                .await
                .unwrap();
            let other = cache.acquire("beta", |_| async { Ok(2) }).await.unwrap();
            assert!(Arc::ptr_eq(&first, &same));
            assert_ne!(first.name, other.name);
            assert_eq!(first.storage, 1);
            assert_eq!(other.storage, 2);
        });
    }

    #[test]
    fn storage_survives_the_final_tab_and_dies_with_the_registry() {
        struct MemoryStore(Arc<AtomicUsize>);
        impl Drop for MemoryStore {
            fn drop(&mut self) {
                self.0.fetch_add(1, Ordering::SeqCst);
            }
        }
        tauri::async_runtime::block_on(async {
            let drops = Arc::new(AtomicUsize::new(0));
            let cache = PartitionCache::default();
            let tab = cache
                .acquire("alpha", |_| async { Ok(MemoryStore(drops.clone())) })
                .await
                .unwrap();
            let store = Arc::downgrade(&tab);
            drop(tab);
            assert!(store.upgrade().is_some());
            assert_eq!(drops.load(Ordering::SeqCst), 0);
            let reopened = cache
                .acquire("alpha", |_| async {
                    panic!("must retain a closed workspace")
                })
                .await
                .unwrap();
            assert!(Arc::ptr_eq(&store.upgrade().unwrap(), &reopened));
            drop(reopened);
            drop(cache);
            assert!(store.upgrade().is_none());
            assert_eq!(drops.load(Ordering::SeqCst), 1);
            let restarted = PartitionCache::default();
            let fresh = restarted
                .acquire("alpha", |_| async { Ok(MemoryStore(drops.clone())) })
                .await
                .unwrap();
            assert!(store.upgrade().is_none());
            drop(fresh);
            drop(restarted);
            assert_eq!(drops.load(Ordering::SeqCst), 2);
        });
    }

    #[test]
    fn failed_storage_creation_is_not_reused() {
        tauri::async_runtime::block_on(async {
            let cache = PartitionCache::default();
            assert!(cache
                .acquire("alpha", |_| async { Err("unavailable".into()) })
                .await
                .is_err());
            let retry = cache.acquire("alpha", |_| async { Ok(1) }).await.unwrap();
            assert_eq!(retry.storage, 1);
        });
    }
}
