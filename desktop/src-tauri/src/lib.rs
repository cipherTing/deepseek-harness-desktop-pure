#[cfg(any(target_os = "windows", test))]
use std::ffi::OsString;
use std::{
    collections::HashMap,
    io::copy,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rmpv::Value;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tokio::{
    sync::{mpsc, oneshot, Notify},
    time::timeout,
};
use url::Url;

mod file_handlers;
mod sidecar_process;

use sidecar_process::{SidecarEvent, SidecarProcess};

const PROTOCOL_VERSION: u32 = 1;
/** Respawn attempts after an unexpected sidecar exit (exponential backoff). */
const RESPAWN_ATTEMPTS: u32 = 3;
/** Total cap for one session-export download (10 minutes). */
const EXPORT_TIMEOUT: Duration = Duration::from_secs(600);
/** Upper bound for copying one text file into the system clipboard. */
const CLIPBOARD_FILE_LIMIT: u64 = 8 * 1024 * 1024;
#[derive(Default)]
struct DesktopState {
    peer: RwLock<Option<Arc<SidecarPeer>>>,
    /**
     * Origin of the currently serving sidecar web host. Refreshed on every
     * `ready`: a respawn serves from a NEW random port, so the window's
     * navigation allowlist must read this live value instead of a startup
     * string captured when the window was built.
     */
    origin: RwLock<Option<String>>,
    exiting: AtomicBool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopHttpRequest {
    method: String,
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
enum DesktopSaveResult {
    FileSaved,
    Cancelled,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InboundMessage {
    kind: String,
    id: Option<u64>,
    ok: Option<bool>,
    error: Option<String>,
    payload: Option<Value>,
    method: Option<String>,
    protocol_version: Option<u32>,
    url: Option<String>,
}

#[derive(Serialize)]
struct RequestMessage<'a, P> {
    kind: &'static str,
    id: u64,
    method: &'a str,
    payload: &'a P,
}

#[derive(Serialize)]
struct SystemResponseMessage<P> {
    kind: &'static str,
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<P>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

struct FrameDecoder {
    buffer: Vec<u8>,
}

impl FrameDecoder {
    fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    fn push(&mut self, chunk: &[u8]) -> Result<Vec<InboundMessage>, String> {
        self.buffer.extend_from_slice(chunk);
        let mut messages = Vec::new();
        loop {
            if self.buffer.len() < 4 {
                break;
            }
            let length = u32::from_be_bytes(self.buffer[..4].try_into().unwrap()) as usize;
            if length > 256 * 1024 * 1024 {
                return Err(format!("Desktop protocol frame too large: {length}"));
            }
            if self.buffer.len() < length + 4 {
                break;
            }
            let message = rmp_serde::from_slice(&self.buffer[4..4 + length])
                .map_err(|error| format!("invalid Desktop protocol frame: {error}"))?;
            self.buffer.drain(..4 + length);
            messages.push(message);
        }
        Ok(messages)
    }
}

struct SidecarPeer {
    process: SidecarProcess,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    ready: Mutex<Option<oneshot::Sender<Result<InboundMessage, String>>>>,
    terminated: AtomicBool,
    terminated_notify: Notify,
}

impl SidecarPeer {
    fn send<T: Serialize>(&self, message: &T) -> Result<(), String> {
        let payload = rmp_serde::to_vec_named(message).map_err(|error| error.to_string())?;
        let mut frame = Vec::with_capacity(payload.len() + 4);
        frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        frame.extend_from_slice(&payload);
        self.process.write(frame)
    }

    async fn request<P: Serialize, R: DeserializeOwned>(
        &self,
        method: &str,
        payload: &P,
    ) -> Result<R, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        if let Err(error) = self.send(&RequestMessage {
            kind: "request",
            id,
            method,
            payload,
        }) {
            self.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        let received = timeout(Duration::from_secs(120), rx).await;
        let value = match received {
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                return Err(format!("Desktop sidecar request timed out: {method}"));
            }
            Ok(Err(_)) => return Err(format!("Desktop sidecar stopped during request: {method}")),
            Ok(Ok(result)) => result?,
        };
        rmpv::ext::from_value(value)
            .map_err(|error| format!("invalid Desktop response for {method}: {error}"))
    }

    fn dispatch(self: &Arc<Self>, message: InboundMessage, app: &AppHandle) {
        match message.kind.as_str() {
            "response" => {
                if let Some(id) = message.id {
                    if let Some(waiter) = self.pending.lock().unwrap().remove(&id) {
                        let result = if message.ok == Some(true) {
                            Ok(message.payload.unwrap_or(Value::Nil))
                        } else {
                            Err(message
                                .error
                                .unwrap_or_else(|| "Desktop sidecar request failed".into()))
                        };
                        let _ = waiter.send(result);
                    }
                }
            }
            "ready" | "fatal" => {
                if let Some(waiter) = self.ready.lock().unwrap().take() {
                    let result = if message.kind == "ready" {
                        Ok(message)
                    } else {
                        Err(message
                            .error
                            .unwrap_or_else(|| "Desktop sidecar failed".into()))
                    };
                    let _ = waiter.send(result);
                }
            }
            "graph-changed" => {
                // The composed client graph changed (a profile patch hot-reload):
                // reload the page so the fresh boot manifest takes effect — the
                // desktop equivalent of refreshing a browser tab.
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.reload();
                    }
                });
            }
            "system-request" => {
                let Some(id) = message.id else { return };
                let Some(method) = message.method else { return };
                let payload = message.payload.unwrap_or(Value::Nil);
                // Keep the response tied to the generation that requested it.
                // A native dialog can outlive a sidecar crash and respawn; using
                // DesktopState.peer here would otherwise send an old response to
                // the new process, whose request ids start from one again.
                let peer = self.clone();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let result = handle_system_request(&app, &method, payload).await;
                    match result {
                        Ok(payload) => {
                            let _ = peer.send(&SystemResponseMessage {
                                kind: "system-response",
                                id,
                                ok: true,
                                payload: Some(payload),
                                error: None,
                            });
                        }
                        Err(error) => {
                            let _ = peer.send(&SystemResponseMessage::<Value> {
                                kind: "system-response",
                                id,
                                ok: false,
                                payload: None,
                                error: Some(error),
                            });
                        }
                    }
                });
            }
            // The page aborted a system request (the native dialog may still be
            // open; its eventual response finds no waiter and is dropped).
            "system-cancel" => {}
            _ => {}
        }
    }

    fn terminate(&self) {
        self.process.terminate();
    }

    fn fail(&self, error: String) {
        self.terminate();
        if let Some(waiter) = self.ready.lock().unwrap().take() {
            let _ = waiter.send(Err(error.clone()));
        }
        for (_, waiter) in std::mem::take(&mut *self.pending.lock().unwrap()) {
            let _ = waiter.send(Err(error.clone()));
        }
    }

    fn mark_terminated(&self) {
        self.terminated.store(true, Ordering::SeqCst);
        self.terminated_notify.notify_one();
    }

    async fn wait_terminated(&self) {
        loop {
            if self.terminated.load(Ordering::SeqCst) {
                return;
            }
            let notified = self.terminated_notify.notified();
            if self.terminated.load(Ordering::SeqCst) {
                return;
            }
            notified.await;
        }
    }
}

fn is_loopback_hostname(hostname: &str) -> bool {
    hostname == "127.0.0.1" || hostname == "localhost" || hostname == "[::1]"
}

/** Return whether a navigation stays on the currently serving sidecar origin. */
fn is_current_sidecar_origin(current_origin: Option<&str>, target: &Url) -> bool {
    current_origin == Some(target.origin().ascii_serialization().as_str())
}

fn clear_peer_if_current(state: &DesktopState, peer: &Arc<SidecarPeer>) {
    let mut current = state.peer.write().unwrap();
    if current
        .as_ref()
        .is_some_and(|candidate| Arc::ptr_eq(candidate, peer))
    {
        *current = None;
    }
}

async fn handle_system_request(
    app: &AppHandle,
    method: &str,
    payload: Value,
) -> Result<Value, String> {
    match method {
        "pick-directory" => {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "Desktop main window is unavailable".to_string())?;
            let (tx, rx) = oneshot::channel();
            app.dialog()
                .file()
                .set_parent(&window)
                .pick_folder(move |selected| {
                    let _ = tx.send(selected);
                });
            let selected = rx
                .await
                .map_err(|_| "Desktop directory dialog closed without a result".to_string())?;
            let path = match selected {
                Some(path) => Some(
                    path.into_path()
                        .map_err(|error| error.to_string())?
                        .to_string_lossy()
                        .into_owned(),
                ),
                None => None,
            };
            rmpv::ext::to_value(path).map_err(|error| error.to_string())
        }
        "open-path" => {
            #[derive(Deserialize)]
            struct OpenPath {
                path: String,
            }
            let request: OpenPath =
                rmpv::ext::from_value(payload).map_err(|error| error.to_string())?;
            app.opener()
                .open_path(request.path, None::<String>)
                .map_err(|error| error.to_string())?;
            Ok(Value::Nil)
        }
        _ => Err(format!("unknown Desktop system request {method:?}")),
    }
}

/** Parse a user-triggered external URL without granting arbitrary URI schemes. */
fn external_browser_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return Err("Desktop can only open absolute HTTP(S) URLs externally".into());
    }
    Ok(url)
}

/** Resolve an absolute filesystem target or a standards-compliant file URL. */
fn linked_file_path(value: &str) -> Result<PathBuf, String> {
    if value.is_empty() {
        return Err("Desktop file link path cannot be empty".into());
    }
    if value
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("file:"))
    {
        let url = Url::parse(value).map_err(|error| error.to_string())?;
        if url.scheme() != "file"
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Desktop file links must be local file URLs".into());
        }
        return url
            .to_file_path()
            .map_err(|_| "Desktop file URL cannot be converted to a local path".to_string());
    }

    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err("Desktop native file actions require an absolute path".into());
    }
    Ok(path)
}

/** Resolve a linked local path and require a regular file for read/copy actions. */
fn linked_regular_file_path(value: &str) -> Result<PathBuf, String> {
    let path = linked_file_path(value)?;
    let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Desktop file actions require a regular file".into());
    }
    Ok(path)
}

/** Extract a displayable filename for the native Save As dialog. */
fn linked_file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Desktop file action could not determine a filename".to_string())
}

/** Convert a linked path to the Unicode argument accepted by Tauri Opener. */
fn linked_file_argument(path: PathBuf) -> Result<String, String> {
    path.into_os_string()
        .into_string()
        .map_err(|_| "Desktop file links must contain valid Unicode paths".to_string())
}

#[tauri::command]
fn desktop_open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(external_browser_url(&url)?, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_open_file(app: AppHandle, path: String) -> Result<(), String> {
    let path = linked_file_argument(linked_file_path(&path)?)?;
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_file_handlers(path: String) -> Result<file_handlers::FileHandlerMenu, String> {
    Ok(file_handlers::menu_for(&linked_file_path(&path)?))
}

#[tauri::command]
fn desktop_open_file_with(app: AppHandle, path: String, handler_id: String) -> Result<(), String> {
    let path = linked_file_path(&path)?;
    if !std::fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err("Desktop Open With actions require a regular file".into());
    }
    let handler = file_handlers::find_for(&path, &handler_id)
        .ok_or_else(|| "Desktop file handler is no longer available".to_string())?;
    app.opener()
        .open_path(linked_file_argument(path)?, Some(handler.launcher()))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_copy_text(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_reveal_file(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .reveal_item_in_dir(linked_file_path(&path)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn desktop_save_file_as(app: AppHandle, path: String) -> Result<DesktopSaveResult, String> {
    let source = linked_regular_file_path(&path)?;
    let file_name = linked_file_name(&source)?;
    let target = tokio::task::spawn_blocking({
        let app = app.clone();
        move || {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "Desktop main window is unavailable".to_string())?;
            Ok::<_, String>(
                app.dialog()
                    .file()
                    .set_parent(&window)
                    .set_file_name(file_name)
                    .blocking_save_file(),
            )
        }
    })
    .await
    .map_err(|error| error.to_string())??;
    let Some(target) = target else {
        return Ok(DesktopSaveResult::Cancelled);
    };
    let target = target.into_path().map_err(|error| error.to_string())?;
    tokio::task::spawn_blocking(move || {
        std::fs::copy(source, target).map_err(|error| error.to_string())?;
        Ok::<_, String>(())
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(DesktopSaveResult::FileSaved)
}

#[tauri::command]
async fn desktop_copy_file_contents(app: AppHandle, path: String) -> Result<(), String> {
    let source = linked_regular_file_path(&path)?;
    let contents = tokio::task::spawn_blocking(move || {
        let metadata = std::fs::metadata(&source).map_err(|error| error.to_string())?;
        if metadata.len() > CLIPBOARD_FILE_LIMIT {
            return Err(format!(
                "Desktop can copy text files up to {CLIPBOARD_FILE_LIMIT} bytes to the clipboard"
            ));
        }
        std::fs::read_to_string(source).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    app.clipboard()
        .write_text(contents)
        .map_err(|error| error.to_string())
}

/** Validate that a save request targets the current sidecar's export endpoint. */
fn validate_export_request(
    request: &DesktopHttpRequest,
    current_origin: &str,
) -> Result<Url, String> {
    if request.method != "GET" || !request.headers.is_empty() {
        return Err("Session export must be a header-free GET request".into());
    }
    let url = Url::parse(&request.url).map_err(|error| error.to_string())?;
    if !is_current_sidecar_origin(Some(current_origin), &url)
        || url.path() != "/api/session.export"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("Session export URL must target the current Desktop web host".into());
    }
    Ok(url)
}

/** Fetch the session export directly from the current web host and stream it to disk. */
fn download_export(
    request: &DesktopHttpRequest,
    current_origin: &str,
    temp: &Path,
    target: &Path,
) -> Result<(), String> {
    let url = validate_export_request(request, current_origin)?;
    let agent = ureq::AgentBuilder::new().redirects(0).build();
    let response = agent
        .get(url.as_str())
        .timeout(EXPORT_TIMEOUT)
        .call()
        .map_err(|error| error.to_string())?;
    let status = response.status();
    if !(200..300).contains(&status) {
        return Err(format!("Session export failed: HTTP {status}"));
    }
    let mut reader = response.into_reader();
    let mut file = std::fs::File::create(temp).map_err(|error| error.to_string())?;
    copy(&mut reader, &mut file).map_err(|error| error.to_string())?;
    drop(file);
    std::fs::rename(temp, target).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn desktop_save_session(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
    request: DesktopHttpRequest,
    filename: String,
) -> Result<DesktopSaveResult, String> {
    let current_origin = state
        .origin
        .read()
        .unwrap()
        .clone()
        .ok_or_else(|| "Desktop web host is not ready".to_string())?;
    let target = tokio::task::spawn_blocking({
        let app = app.clone();
        move || {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "Desktop main window is unavailable".to_string())?;
            Ok::<_, String>(
                app.dialog()
                    .file()
                    .set_parent(&window)
                    .set_file_name(filename)
                    .add_filter("ZIP archive", &["zip"])
                    .blocking_save_file(),
            )
        }
    })
    .await
    .map_err(|error| error.to_string())??;
    let Some(target) = target else {
        return Ok(DesktopSaveResult::Cancelled);
    };
    let target = target.into_path().map_err(|error| error.to_string())?;
    let temp = temporary_export_path(&target);
    let cleanup_temp = temp.clone();
    let result = tokio::task::spawn_blocking(move || {
        download_export(&request, &current_origin, &temp, &target)
    })
    .await
    .map_err(|error| error.to_string())?;
    if result.is_err() {
        let _ = std::fs::remove_file(&cleanup_temp);
    }
    result.map(|()| DesktopSaveResult::FileSaved)
}

fn temporary_export_path(target: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    target.with_file_name(format!(".{name}.{stamp}.part"))
}

/** Validate the sidecar readiness message and normalize its loopback origin. */
fn parse_ready_url(message: &InboundMessage) -> Result<String, String> {
    if message.protocol_version != Some(PROTOCOL_VERSION) {
        return Err(format!(
            "Desktop protocol mismatch: expected {PROTOCOL_VERSION}, got {:?}",
            message.protocol_version
        ));
    }
    let raw = message
        .url
        .as_deref()
        .ok_or_else(|| "Desktop ready message omitted url".to_string())?;
    let parsed =
        Url::parse(raw).map_err(|error| format!("Desktop ready URL is invalid: {error}"))?;
    let hostname = parsed
        .host_str()
        .ok_or_else(|| "Desktop ready URL has no hostname".to_string())?;
    if parsed.scheme() != "http"
        || !is_loopback_hostname(hostname)
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.port().is_none()
    {
        return Err(format!(
            "Desktop ready URL must be loopback HTTP with an explicit port: {raw}"
        ));
    }
    Ok(parsed.origin().ascii_serialization())
}

/** Own one sidecar generation's event channel and report when it ends. */
fn spawn_sidecar_reader(
    peer: Arc<SidecarPeer>,
    mut events: mpsc::UnboundedReceiver<SidecarEvent>,
    app: AppHandle,
) -> oneshot::Receiver<()> {
    let (exit_tx, exit_rx) = oneshot::channel();
    tauri::async_runtime::spawn(async move {
        let mut decoder = FrameDecoder::new();
        while let Some(event) = events.recv().await {
            match event {
                SidecarEvent::Stdout(bytes) => match decoder.push(&bytes) {
                    Ok(messages) => {
                        for message in messages {
                            peer.dispatch(message, &app);
                        }
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        peer.fail(error);
                        break;
                    }
                },
                SidecarEvent::Stderr(bytes) => eprint!("{}", String::from_utf8_lossy(&bytes)),
                SidecarEvent::Error(error) => {
                    eprintln!("Desktop sidecar error: {error}");
                    peer.fail(format!("Desktop sidecar error: {error}"));
                    break;
                }
                SidecarEvent::Terminated(code) => {
                    peer.fail(format!("Desktop sidecar exited: {code:?}"));
                    break;
                }
            }
        }
        peer.fail("Desktop sidecar event channel closed".into());
        peer.mark_terminated();
        let _ = exit_tx.send(());
    });
    exit_rx
}

/** Build the module-mode Node expression used to bypass Windows main-script lookup. */
#[cfg(any(target_os = "windows", test))]
fn node_sidecar_import(script: &Path) -> Result<String, String> {
    let script_url = Url::from_file_path(script)
        .map_err(|_| "Desktop sidecar path cannot be converted to a file URL".to_string())?;
    let script_url =
        serde_json::to_string(script_url.as_str()).map_err(|error| error.to_string())?;
    Ok(format!(
        "try {{ await import({script_url}); }} catch (error) {{ console.error(error); process.exitCode = 1; }}"
    ))
}

/** Build Windows Node arguments while preserving the sidecar main-module identity. */
#[cfg(any(target_os = "windows", test))]
fn node_sidecar_arguments(script: &Path) -> Result<Vec<OsString>, String> {
    Ok(vec![
        OsString::from("--input-type=module"),
        OsString::from("--eval"),
        OsString::from(node_sidecar_import(script)?),
        OsString::from("--"),
        script.as_os_str().to_owned(),
    ])
}

async fn spawn_sidecar(
    app: &AppHandle,
) -> Result<(Arc<SidecarPeer>, String, oneshot::Receiver<()>), String> {
    let resource = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let script = resource.join("rt/lib/sidecar.mjs");
    let cwd = app.path().home_dir().map_err(|error| error.to_string())?;
    let (ready_tx, ready_rx) = oneshot::channel();
    #[cfg(target_os = "windows")]
    let arguments = node_sidecar_arguments(&script)?;
    #[cfg(not(target_os = "windows"))]
    let arguments = vec![script.into_os_string()];
    let (events_tx, events) = mpsc::unbounded_channel();
    let process = SidecarProcess::spawn(app, arguments, cwd, events_tx)?;
    let peer = Arc::new(SidecarPeer {
        process,
        next_id: AtomicU64::new(1),
        pending: Mutex::new(HashMap::new()),
        ready: Mutex::new(Some(ready_tx)),
        terminated: AtomicBool::new(false),
        terminated_notify: Notify::new(),
    });
    *app.state::<DesktopState>().peer.write().unwrap() = Some(peer.clone());
    let exited = spawn_sidecar_reader(peer.clone(), events, app.clone());
    let ready = match timeout(Duration::from_secs(120), ready_rx).await {
        Err(_) => Err("Desktop sidecar readiness timed out".to_string()),
        Ok(Err(_)) => Err("Desktop sidecar readiness channel closed".to_string()),
        Ok(Ok(result)) => result,
    };
    let ready_message = match ready {
        Ok(message) => message,
        Err(error) => {
            peer.fail(error.clone());
            let _ = timeout(Duration::from_secs(3), peer.wait_terminated()).await;
            clear_peer_if_current(&app.state::<DesktopState>(), &peer);
            return Err(error);
        }
    };
    let url = match parse_ready_url(&ready_message) {
        Ok(url) => url,
        Err(error) => {
            peer.fail(error.clone());
            let _ = timeout(Duration::from_secs(3), peer.wait_terminated()).await;
            clear_peer_if_current(&app.state::<DesktopState>(), &peer);
            return Err(error);
        }
    };
    Ok((peer, url, exited))
}

fn monitor_sidecar_exit(peer: Arc<SidecarPeer>, exited: oneshot::Receiver<()>, app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let _ = exited.await;
        let state = app.state::<DesktopState>();
        clear_peer_if_current(&state, &peer);
        if !state.exiting.load(Ordering::SeqCst) {
            supervise_sidecar(&app).await;
        }
    });
}

/** Bounded respawn after an unexpected exit: retry with backoff, then fail loud. */
async fn supervise_sidecar(app: &AppHandle) {
    let state = app.state::<DesktopState>();
    if state.exiting.load(Ordering::SeqCst) {
        return;
    }
    for attempt in 0..RESPAWN_ATTEMPTS {
        if state.exiting.load(Ordering::SeqCst) {
            return;
        }
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(u64::from(attempt))).await;
            if state.exiting.load(Ordering::SeqCst) {
                return;
            }
        }
        match spawn_sidecar(app).await {
            Ok((peer, url, exited)) => {
                if state.exiting.load(Ordering::SeqCst) {
                    peer.terminate();
                    clear_peer_if_current(&state, &peer);
                    return;
                }
                let parsed = Url::parse(&url).expect("validated Desktop origin must parse");
                // Publish the new origin before navigating so the live
                // allowlist accepts this generation's random port.
                *state.origin.write().unwrap() = Some(parsed.origin().ascii_serialization());
                let navigation = app
                    .get_webview_window("main")
                    .ok_or_else(|| "Desktop main window is unavailable".to_string())
                    .and_then(|window| window.navigate(parsed).map_err(|error| error.to_string()));
                if let Err(error) = navigation {
                    peer.terminate();
                    clear_peer_if_current(&state, &peer);
                    show_error_and_exit(
                        app,
                        format!("DeepDive failed to reconnect:\n{error}"),
                        1,
                    );
                    return;
                }
                monitor_sidecar_exit(peer, exited, app.clone());
                return;
            }
            Err(error) => {
                eprintln!(
                    "Desktop sidecar respawn attempt {} failed: {}",
                    attempt + 1,
                    error
                );
            }
        }
    }
    show_error_and_exit(
        app,
        "DeepDive 宿主进程多次重启失败，应用即将退出。",
        1,
    );
}

/** Show a modal error on the main thread, then exit with the given code. */
fn show_error_and_exit(app: &AppHandle, message: impl Into<String>, code: i32) {
    let message = message.into();
    let for_dialog = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = for_dialog.dialog().message(message).blocking_show();
    });
    app.exit(code);
}

async fn stop_sidecar(app: &AppHandle) {
    let state = app.state::<DesktopState>();
    let peer = state.peer.read().unwrap().clone();
    if let Some(peer) = peer {
        let graceful = timeout(
            Duration::from_secs(8),
            peer.request("shutdown", &Value::Nil),
        )
        .await
        .is_ok_and(|result: Result<Value, String>| result.is_ok());
        if graceful
            && timeout(Duration::from_secs(3), peer.wait_terminated())
                .await
                .is_ok()
        {
            *state.peer.write().unwrap() = None;
            return;
        }
        peer.terminate();
        let _ = timeout(Duration::from_secs(3), peer.wait_terminated()).await;
    }
    *state.peer.write().unwrap() = None;
}

fn begin_graceful_exit(app: &AppHandle, exit_code: i32) {
    let state = app.state::<DesktopState>();
    if state.exiting.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        stop_sidecar(&app).await;
        app.exit(exit_code);
    });
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_open_external_url,
            desktop_open_file,
            desktop_file_handlers,
            desktop_open_file_with,
            desktop_copy_text,
            desktop_reveal_file,
            desktop_save_file_as,
            desktop_copy_file_contents,
            desktop_save_session,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match spawn_sidecar(&handle).await {
                    Ok((peer, url, exited)) => {
                        let state = handle.state::<DesktopState>();
                        if state.exiting.load(Ordering::SeqCst) {
                            peer.terminate();
                            clear_peer_if_current(&state, &peer);
                            return;
                        }
                        let Ok(parsed) = Url::parse(&url) else {
                            peer.terminate();
                            clear_peer_if_current(&state, &peer);
                            show_error_and_exit(
                                &handle,
                                "Desktop startup failed: validated readiness URL became invalid",
                                1,
                            );
                            return;
                        };
                        *state.origin.write().unwrap() =
                            Some(parsed.origin().ascii_serialization());
                        let nav_handle = handle.clone();
                        let opener_handle = handle.clone();
                        let window = WebviewWindowBuilder::new(
                            &handle,
                            "main",
                            WebviewUrl::External(parsed),
                        )
                        .title("DeepDive")
                        .inner_size(1280.0, 820.0)
                        .min_inner_size(900.0, 640.0)
                        .on_navigation(move |target| {
                            // Allow only the CURRENT sidecar origin, read fresh
                            // from shared state: a respawn serves from a new
                            // random port, and a stale startup-captured origin
                            // would cancel that navigation and wrongly bounce
                            // it to the system browser.
                            let current = nav_handle
                                .state::<DesktopState>()
                                .origin
                                .read()
                                .unwrap()
                                .clone();
                            if is_current_sidecar_origin(current.as_deref(), target) {
                                return true;
                            }
                            if target.scheme() == "http" || target.scheme() == "https" {
                                let _ = opener_handle
                                    .opener()
                                    .open_url(target.clone(), None::<&str>);
                            }
                            false
                        });
                        #[cfg(target_os = "macos")]
                        let window = window
                            .title_bar_style(tauri::TitleBarStyle::Overlay)
                            .hidden_title(true)
                            .decorations(true);
                        match window.build() {
                            Ok(_) => monitor_sidecar_exit(peer, exited, handle.clone()),
                            Err(error) => {
                                peer.terminate();
                                clear_peer_if_current(&state, &peer);
                                show_error_and_exit(
                                    &handle,
                                    format!("Desktop window creation failed: {error}"),
                                    1,
                                );
                            }
                        }
                    }
                    Err(error) => {
                        show_error_and_exit(
                            &handle,
                            format!("DeepDive failed to start:\n{error}"),
                            1,
                        );
                    }
                }
            });
            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build DeepDive");
    app.run(|app, event| {
        if let RunEvent::ExitRequested { code, api, .. } = event {
            let state = app.state::<DesktopState>();
            if !state.exiting.load(Ordering::SeqCst) {
                api.prevent_exit();
                begin_graceful_exit(app, code.unwrap_or(0));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_sidecar_arguments_preserve_main_module_argv() {
        let script = if cfg!(target_os = "windows") {
            Path::new(r"C:\Program Files\DeepSeek Harness\rt\lib\sidecar.mjs")
        } else {
            Path::new("/Applications/DeepSeek Harness/rt/lib/sidecar.mjs")
        };
        let arguments = node_sidecar_arguments(script).unwrap();

        assert_eq!(arguments[0], OsString::from("--input-type=module"));
        assert_eq!(arguments[1], OsString::from("--eval"));
        assert!(arguments[2].to_string_lossy().contains("%20"));
        assert_eq!(arguments[3], OsString::from("--"));
        assert_eq!(arguments[4], script.as_os_str());
    }

    #[test]
    fn sidecar_failure_settles_pending_requests() {
        let (pending_tx, mut pending_rx) = oneshot::channel::<Result<Value, String>>();
        let (ready_tx, mut ready_rx) = oneshot::channel::<Result<InboundMessage, String>>();
        let peer = SidecarPeer {
            process: SidecarProcess::test_handle(),
            next_id: AtomicU64::new(2),
            pending: Mutex::new(HashMap::from([(1, pending_tx)])),
            ready: Mutex::new(Some(ready_tx)),
            terminated: AtomicBool::new(false),
            terminated_notify: Notify::new(),
        };

        peer.fail("sidecar stopped".into());

        assert_eq!(ready_rx.try_recv().unwrap().unwrap_err(), "sidecar stopped");
        assert_eq!(
            pending_rx.try_recv().unwrap().unwrap_err(),
            "sidecar stopped"
        );
        assert!(peer.pending.lock().unwrap().is_empty());
    }

    #[test]
    fn readiness_url_must_be_loopback_http_with_explicit_port() {
        let ready = |url: &str| InboundMessage {
            kind: "ready".into(),
            id: None,
            ok: None,
            error: None,
            payload: None,
            method: None,
            protocol_version: Some(PROTOCOL_VERSION),
            url: Some(url.into()),
        };
        assert_eq!(
            parse_ready_url(&ready("http://127.0.0.1:5173")).unwrap(),
            "http://127.0.0.1:5173"
        );
        assert_eq!(
            parse_ready_url(&ready("http://localhost:5173")).unwrap(),
            "http://localhost:5173"
        );
        for bad in [
            "http://127.0.0.1",           // no explicit port
            "https://127.0.0.1:5173",     // not http
            "http://192.168.1.10:5173",   // not loopback
            "http://127.0.0.1:5173/path", // not the origin root
            "http://127.0.0.1:5173?x=1",  // query
        ] {
            assert!(parse_ready_url(&ready(bad)).is_err(), "must reject {bad}");
        }
    }

    #[test]
    fn navigation_uses_the_current_sidecar_origin() {
        let old = Url::parse("http://127.0.0.1:5173/path").unwrap();
        let current = Url::parse("http://127.0.0.1:6291/path").unwrap();

        assert!(is_current_sidecar_origin(
            Some("http://127.0.0.1:5173"),
            &old
        ));
        assert!(!is_current_sidecar_origin(
            Some("http://127.0.0.1:5173"),
            &current
        ));
        assert!(is_current_sidecar_origin(
            Some("http://127.0.0.1:6291"),
            &current
        ));
    }

    #[test]
    fn export_request_must_target_the_current_sidecar_endpoint() {
        let request = |method: &str, url: &str| DesktopHttpRequest {
            method: method.into(),
            url: url.into(),
            headers: HashMap::new(),
        };

        assert!(validate_export_request(
            &request(
                "GET",
                "http://127.0.0.1:6291/api/session.export?sessionId=test"
            ),
            "http://127.0.0.1:6291",
        )
        .is_ok());
        for invalid in [
            request(
                "GET",
                "http://127.0.0.1:5173/api/session.export?sessionId=test",
            ),
            request("GET", "http://127.0.0.1:6291/api/settings"),
            request(
                "POST",
                "http://127.0.0.1:6291/api/session.export?sessionId=test",
            ),
        ] {
            assert!(validate_export_request(&invalid, "http://127.0.0.1:6291").is_err());
        }
    }
}
