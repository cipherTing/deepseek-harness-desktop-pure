use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use rmpv::Value;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{
    http::{header, Request, Response, StatusCode},
    ipc::Channel,
    AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tokio::{
    io::AsyncWriteExt,
    sync::{mpsc, oneshot},
    time::{timeout, Duration},
};
use url::Url;

const PROTOCOL_VERSION: u32 = 1;
const INITIAL_STREAM_CREDIT: u32 = 32;

#[derive(Default)]
struct DesktopState {
    peer: RwLock<Option<Arc<SidecarPeer>>>,
    ready: RwLock<Option<ReadyData>>,
    exiting: AtomicBool,
}

#[derive(Clone)]
struct ReadyData {
    index_html: Arc<Vec<u8>>,
    plugins: Arc<HashMap<(String, String), ()>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopHttpRequest {
    method: String,
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default, with = "serde_bytes")]
    body: Vec<u8>,
}

#[derive(Debug, Deserialize, Serialize)]
struct DesktopHttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    #[serde(with = "serde_bytes")]
    body: Vec<u8>,
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
    stream_id: Option<u64>,
    count: Option<u32>,
    protocol_version: Option<u32>,
    graph: Option<Value>,
    graph_json: Option<String>,
    index_html: Option<String>,
    status: Option<u16>,
    headers: Option<HashMap<String, String>>,
}

#[derive(Serialize)]
struct RequestMessage<'a, P> {
    kind: &'static str,
    id: u64,
    method: &'a str,
    payload: &'a P,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreditMessage {
    kind: &'static str,
    stream_id: u64,
    count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelMessage {
    kind: &'static str,
    stream_id: u64,
}

#[derive(Serialize)]
struct RequestCancelMessage {
    kind: &'static str,
    id: u64,
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

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamId {
    stream_id: u64,
}

#[derive(Debug, Clone)]
struct StreamPacket {
    kind: String,
    payload: Option<Value>,
    status: Option<u16>,
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
    child: Mutex<Option<CommandChild>>,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    request_keys: Mutex<HashMap<String, u64>>,
    streams: Mutex<HashMap<u64, mpsc::UnboundedSender<StreamPacket>>>,
    ready: Mutex<Option<oneshot::Sender<Result<InboundMessage, String>>>>,
}

impl SidecarPeer {
    fn send<T: Serialize>(&self, message: &T) -> Result<(), String> {
        let payload = rmp_serde::to_vec_named(message).map_err(|error| error.to_string())?;
        let mut frame = Vec::with_capacity(payload.len() + 4);
        frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        frame.extend_from_slice(&payload);
        let mut child = self.child.lock().unwrap();
        child
            .as_mut()
            .ok_or_else(|| "Desktop sidecar is not running".to_string())?
            .write(&frame)
            .map_err(|error| error.to_string())
    }

    async fn request<P: Serialize, R: DeserializeOwned>(
        &self,
        method: &str,
        payload: &P,
    ) -> Result<R, String> {
        self.request_with_key(method, payload, None).await
    }

    async fn request_with_key<P: Serialize, R: DeserializeOwned>(
        &self,
        method: &str,
        payload: &P,
        request_key: Option<String>,
    ) -> Result<R, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        if let Some(key) = request_key.as_ref() {
            self.request_keys.lock().unwrap().insert(key.clone(), id);
        }
        if let Err(error) = self.send(&RequestMessage {
            kind: "request",
            id,
            method,
            payload,
        }) {
            self.pending.lock().unwrap().remove(&id);
            if let Some(key) = request_key.as_ref() {
                self.request_keys.lock().unwrap().remove(key);
            }
            return Err(error);
        }
        let received = timeout(Duration::from_secs(120), rx).await;
        if let Some(key) = request_key.as_ref() {
            self.request_keys.lock().unwrap().remove(key);
        }
        let value = match received {
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                let _ = self.send(&RequestCancelMessage {
                    kind: "request-cancel",
                    id,
                });
                return Err(format!("Desktop sidecar request timed out: {method}"));
            }
            Ok(Err(_)) => return Err(format!("Desktop sidecar stopped during request: {method}")),
            Ok(Ok(result)) => result?,
        };
        rmpv::ext::from_value(value)
            .map_err(|error| format!("invalid Desktop response for {method}: {error}"))
    }

    fn cancel_request(&self, request_key: &str) -> Result<(), String> {
        let Some(id) = self.request_keys.lock().unwrap().remove(request_key) else {
            return Ok(());
        };
        if let Some(waiter) = self.pending.lock().unwrap().remove(&id) {
            let _ = waiter.send(Err("Desktop request cancelled".into()));
        }
        self.send(&RequestCancelMessage {
            kind: "request-cancel",
            id,
        })
    }

    fn register_stream(&self, stream_id: u64) -> mpsc::UnboundedReceiver<StreamPacket> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.streams.lock().unwrap().insert(stream_id, tx);
        rx
    }

    fn credit(&self, stream_id: u64, count: u32) -> Result<(), String> {
        self.send(&CreditMessage {
            kind: "credit",
            stream_id,
            count,
        })
    }

    fn cancel(&self, stream_id: u64) -> Result<(), String> {
        self.streams.lock().unwrap().remove(&stream_id);
        self.send(&CancelMessage {
            kind: "cancel",
            stream_id,
        })
    }

    fn dispatch(&self, message: InboundMessage, app: &AppHandle) {
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
            "stream-open" | "stream-data" | "stream-end" => {
                if let Some(stream_id) = message.stream_id {
                    let packet = StreamPacket {
                        kind: message.kind.clone(),
                        payload: message.payload,
                        status: message.status,
                        error: message.error,
                    };
                    let sender = self.streams.lock().unwrap().get(&stream_id).cloned();
                    if let Some(sender) = sender {
                        let _ = sender.send(packet);
                    }
                    if message.kind == "stream-end" {
                        self.streams.lock().unwrap().remove(&stream_id);
                    }
                }
            }
            "system-request" => {
                let Some(id) = message.id else { return };
                let Some(method) = message.method else { return };
                let payload = message.payload.unwrap_or(Value::Nil);
                let peer = app.state::<DesktopState>().peer.read().unwrap().clone();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let result = handle_system_request(&app, &method, payload).await;
                    if let Some(peer) = peer {
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
                    }
                });
            }
            _ => {}
        }
    }

    fn kill(&self) {
        if let Some(child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }

    fn fail(&self, error: String) {
        if let Some(child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
        self.request_keys.lock().unwrap().clear();
        if let Some(waiter) = self.ready.lock().unwrap().take() {
            let _ = waiter.send(Err(error.clone()));
        }
        for (_, waiter) in std::mem::take(&mut *self.pending.lock().unwrap()) {
            let _ = waiter.send(Err(error.clone()));
        }
        for (_, stream) in std::mem::take(&mut *self.streams.lock().unwrap()) {
            let _ = stream.send(StreamPacket {
                kind: "stream-end".into(),
                payload: None,
                status: None,
                error: Some(error.clone()),
            });
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
struct BootGraph {
    rev: String,
    entries: Vec<BootEntry>,
}

#[derive(Debug, Deserialize, Serialize)]
struct BootEntry {
    id: String,
    url: String,
    rev: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    inject: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    immediately: Option<bool>,
}

#[derive(Serialize)]
struct EventStreamRequest<'a> {
    path: &'a str,
}

#[derive(Serialize)]
struct PluginReadRequest<'a> {
    id: &'a str,
    rev: &'a str,
}

#[derive(Deserialize)]
struct PluginReadResponse {
    #[serde(with = "serde_bytes")]
    body: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserStreamEvent {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
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

fn sidecar_peer(state: &tauri::State<'_, DesktopState>) -> Result<Arc<SidecarPeer>, String> {
    state
        .peer
        .read()
        .unwrap()
        .clone()
        .ok_or_else(|| "Desktop sidecar is not ready".into())
}

#[tauri::command]
async fn desktop_fetch(
    state: tauri::State<'_, DesktopState>,
    request_id: String,
    request: DesktopHttpRequest,
) -> Result<DesktopHttpResponse, String> {
    sidecar_peer(&state)?
        .request_with_key("http.fetch", &request, Some(request_id))
        .await
}

#[tauri::command]
fn desktop_fetch_cancel(
    state: tauri::State<'_, DesktopState>,
    request_id: String,
) -> Result<(), String> {
    sidecar_peer(&state)?.cancel_request(&request_id)
}

#[tauri::command]
async fn desktop_stream_open(
    state: tauri::State<'_, DesktopState>,
    path: String,
    on_event: Channel<BrowserStreamEvent>,
) -> Result<StreamId, String> {
    let peer = sidecar_peer(&state)?;
    let opened: StreamId = peer
        .request("stream.events", &EventStreamRequest { path: &path })
        .await?;
    let mut receiver = peer.register_stream(opened.stream_id);
    if let Err(error) = peer.credit(opened.stream_id, INITIAL_STREAM_CREDIT) {
        let _ = peer.cancel(opened.stream_id);
        return Err(error);
    }
    let forward = peer.clone();
    let stream_id = opened.stream_id;
    tauri::async_runtime::spawn(async move {
        while let Some(packet) = receiver.recv().await {
            let event = match packet.kind.as_str() {
                "stream-open" => BrowserStreamEvent {
                    kind: "open".into(),
                    stream_id: Some(stream_id),
                    payload: None,
                    error: None,
                },
                "stream-data" => {
                    let payload = packet
                        .payload
                        .and_then(|value| value.as_str().map(ToOwned::to_owned));
                    BrowserStreamEvent {
                        kind: "message".into(),
                        stream_id: Some(stream_id),
                        payload,
                        error: None,
                    }
                }
                "stream-end" if packet.error.is_some() => BrowserStreamEvent {
                    kind: "error".into(),
                    stream_id: Some(stream_id),
                    payload: None,
                    error: packet.error,
                },
                "stream-end" => BrowserStreamEvent {
                    kind: "close".into(),
                    stream_id: Some(stream_id),
                    payload: None,
                    error: None,
                },
                _ => continue,
            };
            let is_data = packet.kind == "stream-data";
            if let Err(error) = on_event.send(event) {
                eprintln!("Desktop stream channel failed on {stream_id}: {error}");
                let _ = forward.cancel(stream_id);
                break;
            }
            if is_data {
                let _ = forward.credit(stream_id, 1);
            }
            if packet.kind == "stream-end" {
                break;
            }
        }
    });
    Ok(opened)
}

#[tauri::command]
fn desktop_stream_close(
    state: tauri::State<'_, DesktopState>,
    stream_id: u64,
) -> Result<(), String> {
    sidecar_peer(&state)?.cancel(stream_id)
}

#[tauri::command]
async fn desktop_save_session(
    app: AppHandle,
    state: tauri::State<'_, DesktopState>,
    request: DesktopHttpRequest,
    filename: String,
) -> Result<(), String> {
    let target = tokio::task::spawn_blocking({
        let app = app.clone();
        move || {
            app.dialog()
                .file()
                .set_file_name(filename)
                .add_filter("ZIP archive", &["zip"])
                .blocking_save_file()
        }
    })
    .await
    .map_err(|error| error.to_string())?;
    let Some(target) = target else { return Ok(()) };
    let target = target.into_path().map_err(|error| error.to_string())?;
    let peer = sidecar_peer(&state)?;
    let opened: StreamId = peer.request("stream.http", &request).await?;
    let mut receiver = peer.register_stream(opened.stream_id);
    if let Err(error) = peer.credit(opened.stream_id, INITIAL_STREAM_CREDIT) {
        let _ = peer.cancel(opened.stream_id);
        return Err(error);
    }
    let temp = temporary_export_path(&target);
    let mut file = match tokio::fs::File::create(&temp).await {
        Ok(file) => file,
        Err(error) => {
            let _ = peer.cancel(opened.stream_id);
            return Err(error.to_string());
        }
    };
    let result = async {
        let mut completed = false;
        while let Some(packet) = receiver.recv().await {
            match packet.kind.as_str() {
                "stream-open" if !(200..300).contains(&packet.status.unwrap_or(500)) => {
                    return Err(format!(
                        "Session export failed: HTTP {}",
                        packet.status.unwrap_or(500)
                    ));
                }
                "stream-data" => {
                    let value = packet
                        .payload
                        .ok_or_else(|| "Session export stream omitted a chunk".to_string())?;
                    let bytes: Vec<u8> =
                        rmpv::ext::from_value(value).map_err(|error| error.to_string())?;
                    file.write_all(&bytes)
                        .await
                        .map_err(|error| error.to_string())?;
                    peer.credit(opened.stream_id, 1)?;
                }
                "stream-end" if packet.error.is_some() => return Err(packet.error.unwrap()),
                "stream-end" => {
                    completed = true;
                    break;
                }
                _ => {}
            }
        }
        if !completed {
            return Err("Session export stream closed before completion".into());
        }
        file.flush().await.map_err(|error| error.to_string())?;
        drop(file);
        tokio::fs::rename(&temp, &target)
            .await
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = peer.cancel(opened.stream_id);
        let _ = tokio::fs::remove_file(&temp).await;
    }
    result
}

fn temporary_export_path(target: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    target.with_file_name(format!(".{name}.{stamp}.part"))
}

fn safe_asset_path(root: &Path, uri_path: &str) -> Option<PathBuf> {
    let relative = uri_path.trim_start_matches('/');
    let path = Path::new(if relative.is_empty() {
        "index.html"
    } else {
        relative
    });
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    Some(root.join(path))
}

fn response(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(body)
        .unwrap()
}

fn build_ready(message: InboundMessage) -> Result<ReadyData, String> {
    if message.protocol_version != Some(PROTOCOL_VERSION) {
        return Err(format!(
            "Desktop protocol mismatch: expected {PROTOCOL_VERSION}, got {:?}",
            message.protocol_version
        ));
    }
    let graph_value = message
        .graph
        .ok_or_else(|| "Desktop ready message omitted graph".to_string())?;
    let mut graph: BootGraph =
        rmpv::ext::from_value(graph_value).map_err(|error| error.to_string())?;
    let original_json = message
        .graph_json
        .ok_or_else(|| "Desktop ready message omitted graphJson".to_string())?;
    let mut plugins = HashMap::new();
    for entry in &mut graph.entries {
        plugins.insert((entry.id.clone(), entry.rev.clone()), ());
        let id: String = url::form_urlencoded::byte_serialize(entry.id.as_bytes()).collect();
        let rev: String = url::form_urlencoded::byte_serialize(entry.rev.as_bytes()).collect();
        entry.url = if cfg!(windows) {
            format!("http://dsh-plugin.localhost/client.js?id={id}&rev={rev}")
        } else {
            format!("dsh-plugin://localhost/client.js?id={id}&rev={rev}")
        };
    }
    let rewritten_json = serde_json::to_string(&graph).map_err(|error| error.to_string())?;
    let index = message
        .index_html
        .ok_or_else(|| "Desktop ready message omitted indexHtml".to_string())?;
    let marker = format!("window.__DSH_BOOT__ = {original_json}");
    if !index.contains(&marker) {
        return Err("Desktop index did not contain the expected boot graph".into());
    }
    let index = index.replace(&marker, &format!("window.__DSH_BOOT__ = {rewritten_json}"));
    Ok(ReadyData {
        index_html: Arc::new(index.into_bytes()),
        plugins: Arc::new(plugins),
    })
}

async fn spawn_sidecar(app: &AppHandle) -> Result<(Arc<SidecarPeer>, ReadyData), String> {
    let resource = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let script = resource.join("resources/runtime/lib/sidecar.mjs");
    let cwd = app.path().home_dir().map_err(|error| error.to_string())?;
    let (ready_tx, ready_rx) = oneshot::channel();
    let (mut events, child) = app
        .shell()
        .sidecar("node")
        .map_err(|error| error.to_string())?
        .arg(script)
        .current_dir(cwd)
        .set_raw_out(true)
        .spawn()
        .map_err(|error| error.to_string())?;
    let peer = Arc::new(SidecarPeer {
        child: Mutex::new(Some(child)),
        next_id: AtomicU64::new(1),
        pending: Mutex::new(HashMap::new()),
        request_keys: Mutex::new(HashMap::new()),
        streams: Mutex::new(HashMap::new()),
        ready: Mutex::new(Some(ready_tx)),
    });
    let reader = peer.clone();
    let app_for_reader = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut decoder = FrameDecoder::new();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => match decoder.push(&bytes) {
                    Ok(messages) => {
                        for message in messages {
                            reader.dispatch(message, &app_for_reader);
                        }
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        reader.kill();
                        reader.fail(error);
                        break;
                    }
                },
                CommandEvent::Stderr(bytes) => eprint!("{}", String::from_utf8_lossy(&bytes)),
                CommandEvent::Error(error) => eprintln!("Desktop sidecar error: {error}"),
                CommandEvent::Terminated(status) => {
                    reader.fail(format!("Desktop sidecar exited: {:?}", status.code));
                    break;
                }
                _ => {}
            }
        }
        reader.fail("Desktop sidecar event channel closed".into());
    });
    let ready_message = timeout(Duration::from_secs(120), ready_rx)
        .await
        .map_err(|_| "Desktop sidecar readiness timed out".to_string())?
        .map_err(|_| "Desktop sidecar readiness channel closed".to_string())??;
    let ready = build_ready(ready_message)?;
    Ok((peer, ready))
}

fn app_protocol(
    state: tauri::State<'_, DesktopState>,
    resource_root: PathBuf,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if request.method() != "GET" && request.method() != "HEAD" {
        return response(StatusCode::METHOD_NOT_ALLOWED, "text/plain", Vec::new());
    }
    let path = request.uri().path();
    if path == "/" || path == "/index.html" {
        return match state.ready.read().unwrap().as_ref() {
            Some(ready) => response(
                StatusCode::OK,
                "text/html; charset=utf-8",
                (*ready.index_html).clone(),
            ),
            None => response(
                StatusCode::SERVICE_UNAVAILABLE,
                "text/plain",
                b"Desktop is starting".to_vec(),
            ),
        };
    }
    let Some(file) = safe_asset_path(&resource_root, path) else {
        return response(StatusCode::BAD_REQUEST, "text/plain", Vec::new());
    };
    match std::fs::read(&file) {
        Ok(body) => response(
            StatusCode::OK,
            mime_guess::from_path(file)
                .first_or_octet_stream()
                .essence_str(),
            body,
        ),
        Err(_) => response(StatusCode::NOT_FOUND, "text/plain", Vec::new()),
    }
}

fn plugin_protocol(
    app: AppHandle,
    request: Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    tauri::async_runtime::spawn(async move {
        let parsed = Url::parse(&request.uri().to_string());
        let result = async {
            let url = parsed.map_err(|error| error.to_string())?;
            let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
            let id = query
                .get("id")
                .ok_or_else(|| "plugin id is required".to_string())?;
            let rev = query
                .get("rev")
                .ok_or_else(|| "plugin rev is required".to_string())?;
            let state = app.state::<DesktopState>();
            if !state
                .ready
                .read()
                .unwrap()
                .as_ref()
                .is_some_and(|ready| ready.plugins.contains_key(&(id.clone(), rev.clone())))
            {
                return Err("plugin is not present in the current Desktop manifest".to_string());
            }
            let peer = sidecar_peer(&state)?;
            let bundle: PluginReadResponse = peer
                .request("plugin.read", &PluginReadRequest { id, rev })
                .await?;
            Ok(bundle.body)
        }
        .await;
        responder.respond(match result {
            Ok(body) => Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/javascript; charset=utf-8")
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
                .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
                .body(body)
                .unwrap(),
            Err(error) => response(StatusCode::NOT_FOUND, "text/plain", error.into_bytes()),
        });
    });
}

async fn stop_sidecar(app: &AppHandle) {
    let state = app.state::<DesktopState>();
    let peer = state.peer.read().unwrap().clone();
    if let Some(peer) = peer {
        let _: Result<Value, String> = timeout(
            Duration::from_secs(8),
            peer.request("shutdown", &Value::Nil),
        )
        .await
        .unwrap_or_else(|_| Err("Desktop sidecar shutdown timed out".into()));
        peer.kill();
    }
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_fetch,
            desktop_fetch_cancel,
            desktop_stream_open,
            desktop_stream_close,
            desktop_save_session,
        ])
        .register_uri_scheme_protocol("dsh-app", |context, request| {
            let app = context.app_handle();
            let root = app.path().resource_dir().unwrap().join("resources/web");
            app_protocol(app.state::<DesktopState>(), root, request)
        })
        .register_asynchronous_uri_scheme_protocol("dsh-plugin", |context, request, responder| {
            plugin_protocol(context.app_handle().clone(), request, responder)
        })
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match spawn_sidecar(&handle).await {
                    Ok((peer, ready)) => {
                        let state = handle.state::<DesktopState>();
                        *state.peer.write().unwrap() = Some(peer);
                        *state.ready.write().unwrap() = Some(ready);
                        let url = Url::parse("dsh-app://localhost/index.html").unwrap();
                        let window = WebviewWindowBuilder::new(
                            &handle,
                            "main",
                            WebviewUrl::CustomProtocol(url),
                        )
                        .title("DeepSeek Harness Desktop")
                        .inner_size(1280.0, 820.0)
                        .min_inner_size(900.0, 640.0);
                        #[cfg(target_os = "macos")]
                        let window = window
                            .title_bar_style(tauri::TitleBarStyle::Overlay)
                            .hidden_title(true);
                        let _ = window.build();
                    }
                    Err(error) => {
                        eprintln!("Desktop startup failed: {error}");
                        handle.exit(1);
                    }
                }
            });
            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build DeepSeek Harness Desktop");
    app.run(|app, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            let state = app.state::<DesktopState>();
            if !state.exiting.swap(true, Ordering::SeqCst) {
                api.prevent_exit();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    stop_sidecar(&app).await;
                    app.exit(0);
                });
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_failure_settles_pending_requests_and_streams() {
        let (pending_tx, mut pending_rx) = oneshot::channel::<Result<Value, String>>();
        let (stream_tx, mut stream_rx) = mpsc::unbounded_channel::<StreamPacket>();
        let (ready_tx, mut ready_rx) = oneshot::channel::<Result<InboundMessage, String>>();
        let peer = SidecarPeer {
            child: Mutex::new(None),
            next_id: AtomicU64::new(2),
            pending: Mutex::new(HashMap::from([(1, pending_tx)])),
            request_keys: Mutex::new(HashMap::from([("browser-request".into(), 1)])),
            streams: Mutex::new(HashMap::from([(7, stream_tx)])),
            ready: Mutex::new(Some(ready_tx)),
        };

        peer.fail("sidecar stopped".into());

        assert_eq!(ready_rx.try_recv().unwrap().unwrap_err(), "sidecar stopped");
        assert_eq!(
            pending_rx.try_recv().unwrap().unwrap_err(),
            "sidecar stopped"
        );
        let packet = stream_rx.try_recv().unwrap();
        assert_eq!(packet.kind, "stream-end");
        assert_eq!(packet.error.as_deref(), Some("sidecar stopped"));
        assert!(peer.pending.lock().unwrap().is_empty());
        assert!(peer.request_keys.lock().unwrap().is_empty());
        assert!(peer.streams.lock().unwrap().is_empty());
    }
}
