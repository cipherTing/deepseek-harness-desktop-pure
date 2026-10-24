//! Native carrier for the Sidebar Browser tab.
//!
//! The Sidebar Browser needs a real browsing context: an ordinary page cannot
//! embed sites that send `X-Frame-Options`, and an iframe cannot observe its
//! own cross-origin history. Upstream Desktop solves this with an Electron
//! `<webview>` (a Chromium out-of-process frame); a system WebView has no such
//! capability, so this module hosts each tab in a native child WebView where
//! Tauri supports bounds within the main window.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use crate::keyboard;
use serde::{Deserialize, Serialize};
use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, Webview, WebviewBuilder,
    WebviewUrl,
};
use url::Url;

mod storage;

/// Event name the main window listens on for guest lifecycle and navigation.
pub(crate) const BROWSER_EVENT: &str = "desktop-browser-event";

/** A main-frame load failure shown by the Browser toolbar. */
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserGuestError {
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}

/// Per-tab history and loading cache the page polls through `state` and
/// receives inline with each event, so no frame gate has to await the host.
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserGuestState {
    url: String,
    title: String,
    loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<BrowserGuestError>,
}

/// The guest rectangle relative to the main window's client area.
#[derive(Clone, Copy, Deserialize)]
pub(crate) struct BrowserRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl BrowserRect {
    /** Whether the reported rectangle can place a native view. */
    fn is_usable(&self) -> bool {
        self.width >= 1.0
            && self.height >= 1.0
            && self.x.is_finite()
            && self.y.is_finite()
            && self.width.is_finite()
            && self.height.is_finite()
    }
}

/** One live guest and its cached navigation state. */
struct BrowserGuest {
    state: BrowserGuestState,
    platform_hooks: Arc<BrowserPlatformHooks>,
    keyboard_hook: keyboard::NativeHook,
}

#[cfg(target_os = "macos")]
#[path = "browser_window_macos.rs"]
mod browser_window_macos;
#[cfg(windows)]
#[path = "browser_window/windows.rs"]
mod browser_window_windows;

enum BrowserPlatformHooks {
    #[cfg(target_os = "macos")]
    Macos(browser_window_macos::GuestHooks),
    #[cfg(windows)]
    Windows(browser_window_windows::GuestHooks),
}

impl BrowserPlatformHooks {
    async fn remove(&self, view: &Webview) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let Self::Macos(hooks) = self;
            browser_window_macos::remove(view, hooks.clone()).await
        }
        #[cfg(windows)]
        {
            let Self::Windows(hooks) = self;
            browser_window_windows::remove(view, hooks.clone()).await
        }
    }

    #[cfg(windows)]
    async fn remove_without_view(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let Self::Windows(hooks) = self;
        browser_window_windows::remove_without_view(app, hooks.clone()).await
    }

    #[cfg(windows)]
    async fn remove_by_lease(
        app: &tauri::AppHandle,
        view: Option<&Webview>,
        lease: &str,
    ) -> Result<(), String> {
        browser_window_windows::remove_by_lease(app, view, lease.to_string()).await
    }
}

/** Registry of live guests, keyed by the page-issued lease id. */
#[derive(Default)]
pub(crate) struct BrowserRegistry {
    guests: Mutex<HashMap<String, BrowserGuest>>,
    next_lease: AtomicU64,
    storage: storage::WorkspaceStorage,
    lifecycle: tokio::sync::RwLock<()>,
}

/** A page-visible reservation; the partition names the guest's storage account. */
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserReservation {
    lease: String,
    partition: String,
}

/** Return a stable key for native Browser identifiers derived from text. */
fn storage_key(value: &str) -> String {
    let mut first: u64 = 0xcbf2_9ce4_8422_2325;
    let mut second: u64 = 0x0000_0100_0000_01b3;
    for (index, byte) in value.as_bytes().iter().enumerate() {
        if index % 2 == 0 {
            first ^= u64::from(*byte);
            first = first.wrapping_mul(0x0000_0100_0000_01b3);
        } else {
            second ^= u64::from(*byte);
            second = second.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    format!("{first:016x}{second:016x}")
}

impl BrowserRegistry {
    /**
     * Take a fresh lease id, which also names the guest view.
     * @returns the lease id in creation order.
     */
    fn lease(&self) -> String {
        let ordinal = self.next_lease.fetch_add(1, Ordering::SeqCst) + 1;
        format!("browser-guest-{ordinal}")
    }

    /** Record the cached state of one guest, ignoring a released lease. */
    fn update<F: FnOnce(&mut BrowserGuest)>(&self, lease: &str, change: F) {
        if let Some(guest) = self.guests.lock().unwrap().get_mut(lease) {
            change(guest);
        }
    }

    /** Drop one guest from the registry. */
    fn remove(&self, lease: &str) -> Option<BrowserGuest> {
        self.guests.lock().unwrap().remove(lease)
    }
}

/** Close Browser guests and release their workspace stores before app exit. */
pub(crate) async fn shutdown(app: &tauri::AppHandle) -> Vec<String> {
    let state = app.state::<crate::DesktopState>();
    let browser = &state.browser;
    let _lifecycle = browser.lifecycle.write().await;
    let leases = browser
        .guests
        .lock()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    let mut failures = Vec::new();
    for lease in leases {
        if let Err(error) = release_guest(app, browser, &lease).await {
            failures.push(format!("lease {lease}: {error}"));
        }
    }
    #[cfg(windows)]
    {
        match browser_window_windows::remove_all_hooks(app).await {
            Ok(hook_failures) => failures.extend(hook_failures),
            Err(error) => failures.push(format!("Browser platform hooks: {error}")),
        }
        if let Err(errors) = storage::release_platform_storages(&browser.storage, app).await {
            failures.extend(errors);
        }
    }
    failures
}

#[cfg(all(windows, feature = "webview2-lifecycle-test"))]
/** Run the Windows WebView2 shutdown regression harness. */
pub(crate) async fn run_webview2_lifecycle_test(app: &tauri::AppHandle) -> Result<(), String> {
    storage::run_webview2_lifecycle_test(app).await
}

/** Parse one absolute browser URL that does not contain credentials. */
fn permitted_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Desktop browser can only load absolute HTTP(S) addresses".into());
    }
    Ok(url)
}

/** Whether a guest URL targets the current sidecar host or one of its loopback aliases. */
fn is_application_host(origin: &str, target: &Url) -> bool {
    let Ok(origin) = Url::parse(origin) else {
        return false;
    };
    let Some(origin_host) = origin.host_str() else {
        return false;
    };
    let Some(target_host) = target.host_str() else {
        return false;
    };
    target.port() == origin.port() && (target_host == origin_host || is_loopback_host(target_host))
}

fn is_loopback_host(host: &str) -> bool {
    let host = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

/** Reject the running application origin from top-level Browser navigation. */
fn permitted_browser_url(app: &tauri::AppHandle, value: &str) -> Result<Url, String> {
    let target = permitted_url(value)?;
    let origin = app
        .state::<crate::DesktopState>()
        .origin
        .read()
        .unwrap()
        .clone();
    if is_tauri_app_url(&target)
        || origin
            .as_deref()
            .is_some_and(|origin| is_application_host(origin, &target))
    {
        return Err("Desktop browser cannot load the Desktop application itself".into());
    }
    Ok(target)
}

/** Whether a URL points at Tauri's bundled application origin. */
fn is_tauri_app_url(url: &Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
}

/** Whether a URL names the bundled document used before the first browser navigation. */
fn is_bootstrap_url(url: &Url) -> bool {
    is_tauri_app_url(url)
        && url.path() == "/browser-blank.html"
        && url.query().is_none()
        && url.fragment().is_none()
}

fn guest_view(app: &tauri::AppHandle, lease: &str) -> Result<Webview, String> {
    app.get_webview(lease)
        .ok_or_else(|| "Desktop browser guest is not running".to_string())
}

/**
 * Emit one guest event carrying the cached state, so the page never has to
 * await a round trip between an observation and the frame gate it feeds.
 * @param app - application handle owning the main window.
 * @param lease - the guest this event belongs to.
 * @param kind - lifecycle or navigation notification name.
 */
fn emit(app: &tauri::AppHandle, lease: &str, kind: &str) {
    let state = app.state::<crate::DesktopState>();
    let snapshot = state
        .browser
        .guests
        .lock()
        .unwrap()
        .get(lease)
        .map(|guest| guest.state.clone())
        .unwrap_or_default();
    let payload = if kind == "load-failed" {
        let error = snapshot.error.clone();
        serde_json::json!({
            "lease": lease,
            "kind": kind,
            "state": snapshot,
            "error": error,
        })
    } else {
        serde_json::json!({ "lease": lease, "kind": kind, "state": snapshot })
    };
    let _ = app.emit_to("main", BROWSER_EVENT, payload);
}

/** Send an approved guest popup request back to the Browser tab that owns it. */
fn emit_open_requested(app: &tauri::AppHandle, lease: &str, target: &Url) {
    if permitted_browser_url(app, target.as_str()).is_err() {
        return;
    }
    let state = app.state::<crate::DesktopState>();
    let snapshot = state
        .browser
        .guests
        .lock()
        .unwrap()
        .get(lease)
        .map(|guest| guest.state.clone())
        .unwrap_or_default();
    let _ = app.emit_to(
        "main",
        BROWSER_EVENT,
        serde_json::json!({
            "lease": lease,
            "kind": "open-requested",
            "state": snapshot,
            "url": target.as_str(),
        }),
    );
}

/**
 * Re-read the native history, then emit, because a committed navigation is
 * exactly when Back and Forward change and the page renders their availability.
 * @param app - application handle owning the main window.
 * @param lease - the guest this event belongs to.
 * @param kind - lifecycle or navigation notification name.
 */
fn announce(app: &tauri::AppHandle, lease: &str, kind: &'static str) {
    let Ok(view) = guest_view(app, lease) else {
        emit(app, lease, kind);
        return;
    };
    let app = app.clone();
    let lease = lease.to_string();
    tauri::async_runtime::spawn(async move {
        if let Some((back, forward)) = navigation_position(&view).await {
            app.state::<crate::DesktopState>()
                .browser
                .update(&lease, |guest| {
                    guest.state.can_go_back = back;
                    guest.state.can_go_forward = forward;
                });
        }
        emit(&app, &lease, kind);
    });
}

async fn navigation_position(view: &Webview) -> Option<(bool, bool)> {
    #[cfg(target_os = "macos")]
    {
        return browser_window_macos::navigation_state(view).await.ok();
    }
    #[cfg(windows)]
    {
        return browser_window_windows::navigation_state(view).await.ok();
    }
}

fn page_load_event(
    app: &tauri::AppHandle,
    lease: &str,
    event: tauri::webview::PageLoadEvent,
    url: &Url,
) {
    let started = matches!(event, tauri::webview::PageLoadEvent::Started);
    crate::devlog::write(format_args!(
        "browser load: lease={lease} state={}",
        if started { "started" } else { "finished" },
    ));
    let address = (!started).then(|| url.as_str().to_string());
    app.state::<crate::DesktopState>()
        .browser
        .update(lease, |guest| {
            guest.state.loading = started;
            guest.state.error = None;
            if let Some(address) = address {
                guest.state.url = address;
            }
        });
    if started {
        emit(app, lease, "load-started");
    } else {
        announce(app, lease, "load-finished");
    }
}

/** Record a native main-frame failure unless the user replaced that navigation. */
fn page_load_failed(
    app: &tauri::AppHandle,
    lease: &str,
    url: &str,
    code: i32,
    description: String,
) {
    if code == -999 || code == -3 {
        return;
    }
    crate::devlog::write(format_args!(
        "browser load failed: lease={lease} code={code}"
    ));
    let failed_url = url.to_string();
    app.state::<crate::DesktopState>()
        .browser
        .update(lease, |guest| {
            guest.state.url = failed_url;
            guest.state.loading = false;
            guest.state.error = Some(BrowserGuestError {
                code: Some(code),
                description: Some(description),
            });
        });
    emit(app, lease, "load-failed");
}

/** Publish a native guest focus change to the owning Browser frame. */
fn guest_focused(app: &tauri::AppHandle, lease: &str) {
    emit(app, lease, "guest-focused");
}

fn title_changed(app: &tauri::AppHandle, lease: &str, title: String) {
    app.state::<crate::DesktopState>()
        .browser
        .update(lease, |guest| guest.state.title = title);
    emit(app, lease, "title");
}

fn navigation_allowed(app: &tauri::AppHandle, lease: &str, target: &Url) -> bool {
    if is_bootstrap_url(target) {
        return true;
    }
    let Ok(target) = permitted_browser_url(app, target.as_str()) else {
        return false;
    };
    let address = target.as_str().to_string();
    app.state::<crate::DesktopState>()
        .browser
        .update(lease, |guest| {
            guest.state.url = address;
            guest.state.loading = true;
            guest.state.error = None;
        });
    announce(app, lease, "navigated");
    true
}

/** Install one per-lease native view for a workspace. */
async fn create_guest(
    app: &tauri::AppHandle,
    lease: &str,
    workspace: &str,
    initial_url: &Url,
) -> Result<(BrowserGuest, Webview, String), String> {
    let app_load = app.clone();
    let lease_load = lease.to_string();
    let app_title = app.clone();
    let lease_title = lease.to_string();
    let app_navigation = app.clone();
    let lease_navigation = lease.to_string();
    let app_popup = app.clone();
    let lease_popup = lease.to_string();
    let origin = app
        .state::<crate::DesktopState>()
        .origin
        .read()
        .unwrap()
        .clone()
        .ok_or_else(|| {
            "Desktop Browser cannot start before the sidecar origin is ready".to_string()
        })?;

    let (view, partition) = {
        let builder = WebviewBuilder::new(lease, WebviewUrl::App("browser-blank.html".into()))
            .focused(false)
            .on_download(|_view, _event| false)
            .on_page_load(move |_view, payload| {
                page_load_event(&app_load, &lease_load, payload.event(), payload.url());
            })
            .on_document_title_changed(move |_view, title| {
                title_changed(&app_title, &lease_title, title);
            })
            .on_navigation(move |target| {
                navigation_allowed(&app_navigation, &lease_navigation, target)
            })
            .on_new_window(move |target, _features| {
                emit_open_requested(&app_popup, &lease_popup, &target);
                tauri::webview::NewWindowResponse::Deny
            });
        app.state::<crate::DesktopState>()
            .browser
            .storage
            .create_view(app, workspace, builder)
            .await?
    };

    #[cfg(target_os = "macos")]
    let platform_hooks =
        match browser_window_macos::install(app, lease, &view, &origin, workspace).await {
            Ok(hooks) => BrowserPlatformHooks::Macos(hooks),
            Err(error) => {
                let _ = view.close();
                return Err(error);
            }
        };
    #[cfg(windows)]
    let platform_hooks = match browser_window_windows::install(app, lease, &view, &origin).await {
        Ok(hooks) => BrowserPlatformHooks::Windows(hooks),
        Err(error) => {
            let _ = view.close();
            return Err(error);
        }
    };

    let keyboard_hook = match keyboard::install(app, &view, lease).await {
        Ok(hook) => hook,
        Err(error) => {
            let _ = platform_hooks.remove(&view).await;
            let _ = view.close();
            return Err(error);
        }
    };

    if let Err(error) = view.hide() {
        let _ = keyboard_hook.remove(&view).await;
        let _ = platform_hooks.remove(&view).await;
        let _ = view.close();
        return Err(error.to_string());
    }
    Ok((
        BrowserGuest {
            state: BrowserGuestState {
                url: initial_url.as_str().to_string(),
                loading: true,
                ..BrowserGuestState::default()
            },
            platform_hooks: Arc::new(platform_hooks),
            keyboard_hook,
        },
        view,
        partition,
    ))
}

/** Replace the bundled blank document with the first Browser address. */
fn initial_navigation_script(url: &Url) -> Result<String, String> {
    let address = serde_json::to_string(url.as_str()).map_err(|error| error.to_string())?;
    Ok(format!("window.location.replace({address});"))
}

/**
 * Create the guest that carries one Browser tab.
 * @param app - application handle owning the window.
 * @param state - Desktop state holding the guest registry.
 * @param workspace - resolved storage account for the tab.
 * @returns the lease the page addresses every later command with.
 */
#[tauri::command]
pub(crate) async fn desktop_browser_acquire(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::DesktopState>,
    workspace: String,
    initial_url: String,
) -> Result<BrowserReservation, String> {
    let _lifecycle = state.browser.lifecycle.read().await;
    if state.exiting.load(Ordering::SeqCst) {
        return Err("Desktop is shutting down".into());
    }
    if workspace.is_empty() || workspace.len() > 4096 {
        return Err("Desktop browser requires a workspace storage identity".into());
    }
    let initial_url = permitted_browser_url(&app, &initial_url)?;
    let lease = state.browser.lease();
    crate::devlog::write(format_args!("browser acquire: lease={lease}"));
    let (guest, view, partition) = create_guest(&app, &lease, &workspace, &initial_url)
        .await
        .map_err(|error| {
            crate::devlog::write(format_args!("browser acquire failed: lease={lease}"));
            error
        })?;
    state
        .browser
        .guests
        .lock()
        .unwrap()
        .insert(lease.clone(), guest);
    if let Err(error) = initial_navigation_script(&initial_url)
        .and_then(|script| view.eval(script).map_err(|error| error.to_string()))
    {
        if let Some(guest) = state.browser.remove(&lease) {
            let _ = guest.keyboard_hook.remove(&view).await;
            let _ = guest.platform_hooks.remove(&view).await;
        }
        let _ = view.close();
        crate::devlog::write(format_args!(
            "browser initial navigation failed: lease={lease}"
        ));
        return Err(error);
    }
    crate::devlog::write(format_args!("browser guest ready: lease={lease}"));
    Ok(BrowserReservation { partition, lease })
}

/**
 * Address the guest view to the given rectangle.
 * @param app - application handle owning the views.
 * @param state - Desktop state holding the guest registry.
 * @param lease - the calling tab's lease.
 * @param x - left edge in CSS pixels relative to the main client area.
 * @param y - top edge in CSS pixels relative to the main client area.
 * @param width - member width in CSS pixels.
 * @param height - member height in CSS pixels.
 * @param visible - whether the guest view should be on screen.
 */
#[tauri::command]
pub(crate) fn desktop_browser_bounds(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::DesktopState>,
    lease: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
) -> Result<(), String> {
    let _ = &state;
    let rect = BrowserRect {
        x,
        y,
        width,
        height,
    };
    crate::devlog::write(format_args!(
        "browser bounds request: lease={lease} rect=({x:.1},{y:.1},{width:.1}x{height:.1}) visible={visible} usable={}",
        rect.is_usable(),
    ));
    if !rect.is_usable() {
        return Ok(());
    }
    let guest = guest_view(&app, &lease)?;
    if let Err(error) = guest
        .set_bounds(Rect {
            position: Position::Logical(LogicalPosition::new(rect.x, rect.y)),
            size: Size::Logical(LogicalSize::new(rect.width, rect.height)),
        })
        .map_err(|error| error.to_string())
    {
        let _ = guest.hide();
        return Err(error);
    }
    if visible {
        guest.show().map_err(|error| error.to_string())?;
    } else {
        guest.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/**
 * Show or hide the guest view without discarding its page.
 * @param app - application handle owning the view.
 * @param lease - the calling tab's lease.
 * @param visible - whether the guest should be on screen.
 */
#[tauri::command]
pub(crate) fn desktop_browser_visible(
    app: tauri::AppHandle,
    lease: String,
    visible: bool,
) -> Result<(), String> {
    crate::devlog::write(format_args!(
        "browser visibility request: lease={lease} visible={visible}"
    ));
    let guest = guest_view(&app, &lease)?;
    if visible {
        guest.show().map_err(|error| error.to_string())
    } else {
        guest.hide().map_err(|error| error.to_string())
    }
}

/**
 * Load an address in the guest.
 * @param app - application handle owning the view.
 * @param lease - the calling tab's lease.
 * @param url - absolute HTTP(S) address the page has already validated.
 */
#[tauri::command]
pub(crate) fn desktop_browser_navigate(
    app: tauri::AppHandle,
    lease: String,
    url: String,
) -> Result<(), String> {
    let target = permitted_url(&url)?;
    let guest = guest_view(&app, &lease)?;
    crate::devlog::write(format_args!("browser navigation request: lease={lease}"));
    guest.navigate(target).map_err(|error| {
        crate::devlog::write(format_args!("browser navigate failed: lease={lease}"));
        error.to_string()
    })
}

/**
 * Run one history or reload operation inside the guest.
 * @param app - application handle owning the view.
 * @param lease - the calling tab's lease.
 * @param command - `reload`, `back` or `forward`.
 */
#[tauri::command]
pub(crate) async fn desktop_browser_command(
    app: tauri::AppHandle,
    lease: String,
    command: String,
) -> Result<(), String> {
    let guest = guest_view(&app, &lease)?;
    match command.as_str() {
        "reload" => guest.reload().map_err(|error| error.to_string()),
        "back" => navigate_history(&guest, true).await,
        "forward" => navigate_history(&guest, false).await,
        other => Err(format!("unknown Desktop browser command {other:?}")),
    }
}

async fn navigate_history(view: &Webview, back: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return browser_window_macos::navigate_history(view, back).await;
    }
    #[cfg(windows)]
    {
        return browser_window_windows::navigate_history(view, back).await;
    }
}

/**
 * Report the guest's cached navigation state.
 * @param app - application handle owning the view.
 * @param state - Desktop state holding the guest registry.
 * @param lease - the calling tab's lease.
 * @returns the last observed address, title, loading and history availability.
 */
#[tauri::command]
pub(crate) async fn desktop_browser_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::DesktopState>,
    lease: String,
) -> Result<BrowserGuestState, String> {
    let guest = guest_view(&app, &lease)?;
    let mut current = state
        .browser
        .guests
        .lock()
        .unwrap()
        .get(&lease)
        .map(|guest| guest.state.clone())
        .ok_or_else(|| "Desktop browser guest is not registered".to_string())?;
    // The URL is read from the webview rather than cached only from
    // `on_navigation`, which does not fire for an in-page history change.
    if let Ok(url) = guest.url() {
        current.url = url.as_str().to_string();
    }
    if let Some((back, forward)) = navigation_position(&guest).await {
        current.can_go_back = back;
        current.can_go_forward = forward;
    }
    state.browser.update(&lease, |guest| {
        guest.state = current.clone();
    });
    Ok(current)
}

/**
 * Close the guest and forget its cache.
 * @param app - application handle owning the view.
 * @param state - Desktop state holding the guest registry.
 * @param lease - the calling tab's lease.
 */
#[tauri::command]
pub(crate) async fn desktop_browser_release(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::DesktopState>,
    lease: String,
) -> Result<(), String> {
    let _lifecycle = state.browser.lifecycle.read().await;
    release_guest(&app, &state.browser, &lease).await
}

async fn release_guest(
    app: &tauri::AppHandle,
    browser: &BrowserRegistry,
    lease: &str,
) -> Result<(), String> {
    let guest = browser.remove(lease);
    let view = app.get_webview(lease);
    let mut failures = Vec::new();
    if let Some(guest) = guest {
        if let Some(view) = view.as_ref() {
            if let Err(error) = guest.keyboard_hook.remove(view).await {
                failures.push(format!("Browser keyboard hook: {error}"));
            }
            if let Err(error) = guest.platform_hooks.remove(view).await {
                failures.push(format!("Browser platform hooks: {error}"));
            }
        } else {
            #[cfg(windows)]
            if let Err(error) = guest.platform_hooks.remove_without_view(&app).await {
                failures.push(format!("Browser platform hooks: {error}"));
            }
        }
    } else {
        #[cfg(windows)]
        if let Err(error) = BrowserPlatformHooks::remove_by_lease(&app, view.as_ref(), &lease).await
        {
            failures.push(format!("Browser platform hooks: {error}"));
        }
    }
    if let Some(view) = view {
        if let Err(error) = storage::close_view(app, view).await {
            failures.push(format!("Browser WebView close: {error}"));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_browser_identifier_keys_are_stable_and_distinct() {
        assert_eq!(storage_key("alpha"), storage_key("alpha"));
        assert_ne!(storage_key("alpha"), storage_key("beta"));
        assert_eq!(storage_key("alpha").len(), 32);
    }

    #[test]
    fn permitted_urls_are_absolute_http_or_https() {
        assert!(permitted_url("https://example.test/path").is_ok());
        assert!(permitted_url("http://127.0.0.1:5173/").is_ok());
        assert!(permitted_url("https://tauri.localhost/").is_ok());
        for rejected in [
            "file:///etc/passwd",
            "mailto:user@example.test",
            "javascript:alert(1)",
            "about:blank",
            "data:text/html,hi",
            "http://user:secret@example.test/",
            "example.test",
            "",
        ] {
            assert!(permitted_url(rejected).is_err(), "must reject {rejected}");
        }
    }

    #[test]
    fn only_the_bundled_browser_bootstrap_is_allowed_as_a_local_navigation() {
        for value in [
            "tauri://localhost/browser-blank.html",
            "http://tauri.localhost/browser-blank.html",
            "https://tauri.localhost/browser-blank.html",
        ] {
            assert!(
                is_bootstrap_url(&Url::parse(value).unwrap()),
                "must allow {value}"
            );
        }
        for value in [
            "tauri://localhost/other.html",
            "tauri://localhost/browser-blank.html?x=1",
            "https://tauri.localhost/browser-blank.html#x",
            "https://example.test/browser-blank.html",
        ] {
            assert!(
                !is_bootstrap_url(&Url::parse(value).unwrap()),
                "must reject {value}"
            );
        }
    }

    #[test]
    fn unusable_rectangles_are_refused() {
        assert!(!BrowserRect {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 100.0
        }
        .is_usable());
        assert!(!BrowserRect {
            x: f64::NAN,
            y: 0.0,
            width: 100.0,
            height: 100.0
        }
        .is_usable());
        assert!(!BrowserRect {
            x: 0.0,
            y: 0.0,
            width: f64::INFINITY,
            height: 100.0
        }
        .is_usable());
        assert!(BrowserRect {
            x: 10.0,
            y: 20.0,
            width: 320.0,
            height: 240.0
        }
        .is_usable());
    }
}
