//! Native carrier for the Sidebar Browser tab.
//!
//! The Sidebar Browser needs a real browsing context: an ordinary page cannot
//! embed sites that send `X-Frame-Options`, and an iframe cannot observe its
//! own cross-origin history. Upstream Desktop solves this with an Electron
//! `<webview>` (a Chromium out-of-process frame); a system WebView has no such
//! capability, so this module carries each tab in its own borderless
//! `WebviewWindow` and keeps it glued to the address the page reports.
//!
//! The window is owned by the main window (`parent`), which gives the platform
//! the behavior the plan needs without extra code: Windows hides an owned
//! window with its owner, Linux marks it transient, and macOS adds it as a
//! child window.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

/// Event name the main window listens on for guest lifecycle and navigation.
pub(crate) const BROWSER_EVENT: &str = "desktop-browser-event";

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
}

/// The last address the page asked this guest to occupy, in CSS pixels
/// relative to the main window's client area.
#[derive(Clone, Copy, Deserialize)]
pub(crate) struct BrowserRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl BrowserRect {
    /** Whether the reported rectangle can place a real window. */
    fn is_usable(&self) -> bool {
        self.width >= 1.0 && self.height >= 1.0 && self.x.is_finite() && self.y.is_finite()
    }
}

/** One live guest: its native window, cached navigation state and address. */
struct BrowserGuest {
    label: String,
    state: BrowserGuestState,
    rect: Option<BrowserRect>,
}

/** Registry of live guests, keyed by the page-issued lease id. */
#[derive(Default)]
pub(crate) struct BrowserRegistry {
    guests: Mutex<HashMap<String, BrowserGuest>>,
    next_lease: AtomicU64,
}

/** A page-visible reservation; the partition names the guest's storage account. */
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserReservation {
    lease: String,
    partition: String,
}

impl BrowserRegistry {
    /**
     * Take a fresh lease id, which also names the guest window label.
     * @returns the lease id in the order windows were created.
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
    fn remove(&self, lease: &str) {
        self.guests.lock().unwrap().remove(lease);
    }

    /**
     * Re-apply every known address after the main window moved or resized.
     * The page also re-sends addresses while it observes the same transition,
     * so this is the native half of a deliberately doubled follow.
     * @param window - the main window whose new client-area origin applies.
     */
    fn refollow(&self, window: &WebviewWindow) {
        let guests = self.guests.lock().unwrap();
        for guest in guests.values() {
            let Some(rect) = guest.rect else { continue };
            if let Some(target) = window.app_handle().get_webview_window(&guest.label) {
                place(&window, &target, rect);
            }
        }
    }
}

/**
 * Convert the page's CSS-pixel address into the guest's desktop position.
 *
 * `inner_position` is the client area's top-left corner on the desktop and the
 * guest's own webview fills its client area, so no title-bar or border
 * compensation applies.
 * @param main - window the rectangle is measured against.
 * @param guest - window to move.
 * @param rect - address in CSS pixels relative to the main client area.
 */
fn place(main: &WebviewWindow, guest: &WebviewWindow, rect: BrowserRect) {
    if !rect.is_usable() {
        return;
    }
    let (Ok(origin), Ok(scale)) = (main.inner_position(), main.scale_factor()) else {
        return;
    };
    let _ = guest.set_size(tauri::LogicalSize::new(rect.width, rect.height));
    let _ = guest.set_position(tauri::LogicalPosition::new(
        origin.x as f64 / scale + rect.x,
        origin.y as f64 / scale + rect.y,
    ));
}

/**
 * Script injected into every guest document. It maintains the tab's in-page
 * history position, which the host reads instead of linking three platform
 * WebView APIs (WKWebView, WebView2 and WebKitGTK) for the same two booleans.
 *
 * The position travels in `history.state`, so a same-origin document load
 * resumes it; a cross-origin entry has no state and reports the entries the
 * tab can still reach conservatively.
 */
const NAVIGATION_SCRIPT: &str = r#"
(() => {
  const KEY = '__dshBrowserNav';
  const read = (value) => {
    if (typeof value !== 'object' || value === null) return undefined;
    const marker = value[KEY];
    if (typeof marker !== 'object' || marker === null) return undefined;
    return typeof marker.index === 'number' ? marker.index : undefined;
  };
  const initial = read(history.state);
  const position = { index: initial === undefined ? 0 : initial, length: history.length };
  Object.defineProperty(window, '__dshBrowserNav', { configurable: true, value: position });
  const replace = history.replaceState;
  history.replaceState = function (state, ...rest) {
    return replace.call(this, { ...(typeof state === 'object' && state !== null ? state : { value: state }), [KEY]: { index: position.index } }, ...rest);
  };
  const push = history.pushState;
  history.pushState = function (state, ...rest) {
    position.index += 1;
    position.length = Math.max(position.length, position.index + 1);
    return push.call(this, { ...(typeof state === 'object' && state !== null ? state : { value: state }), [KEY]: { index: position.index } }, ...rest);
  };
  const go = history.go;
  history.go = function (delta) {
    const result = go.call(this, delta);
    position.index = Math.max(0, position.index + (typeof delta === 'number' ? delta : 0));
    return result;
  };
  const back = history.back;
  history.back = function () { back.call(this); position.index = Math.max(0, position.index - 1); };
  const forward = history.forward;
  history.forward = function () { forward.call(this); position.index = Math.min(position.length - 1, position.index + 1); };
  window.addEventListener('popstate', (event) => {
    const index = read(event.state);
    if (index !== undefined) position.index = index;
  });
  true;
})();
"#;

/** Read the guest's navigation position as the JSON the host parses. */
const NAVIGATION_STATE_SCRIPT: &str = r#"
(() => {
  const nav = window.__dshBrowserNav;
  if (nav === undefined) return JSON.stringify({ index: 0, length: window.history.length });
  return JSON.stringify({ index: nav.index, length: Math.max(nav.length, window.history.length) });
})();
"#;

/** Store the guest's storage account under the application data directory. */
fn guest_data_directory(app: &tauri::AppHandle, workspace: &str) -> Option<PathBuf> {
    let root = app.path().app_data_dir().ok()?.join("browser");
    Some(root.join(storage_key(workspace)))
}

/**
 * Stable 16-character key for one workspace, so the same workspace keeps one
 * storage account across launches and two workspaces never share cookies.
 * @param workspace - the resolved workspace account name.
 * @returns a hexadecimal key of fixed length.
 */
fn storage_key(workspace: &str) -> String {
    // FNV-1a over the two 64-bit halves keeps this dependency-free and stable;
    // it selects a storage account, and the account name is not a secret.
    let mut first: u64 = 0xcbf2_9ce4_8422_2325;
    let mut second: u64 = 0x0000_0100_0000_01b3;
    for (index, byte) in workspace.as_bytes().iter().enumerate() {
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

/** Whether a page-requested address may load in the guest. */
fn permitted_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return Err("Desktop browser can only load absolute HTTP(S) addresses".into());
    }
    Ok(url)
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
    let _ = app.emit_to(
        "main",
        BROWSER_EVENT,
        serde_json::json!({ "lease": lease, "kind": kind, "state": snapshot }),
    );
}

/**
 * Re-read history availability, then emit, because a committed navigation is
 * exactly when Back and Forward change and the page renders their availability.
 * @param app - application handle owning the main window.
 * @param lease - the guest this event belongs to.
 * @param kind - lifecycle or navigation notification name.
 */
fn announce(app: &tauri::AppHandle, lease: &str, kind: &'static str) {
    let Some(window) = app.get_webview_window(lease) else {
        emit(app, lease, kind);
        return;
    };
    let app = app.clone();
    let lease = lease.to_string();
    tauri::async_runtime::spawn(async move {
        if let Some((back, forward)) = navigation_position(&window).await {
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

/**
 * Read the guest's history position through the injected tracker.
 * @param window - the guest webview.
 * @returns back and forward availability, or `None` while the page has no
 * tracker (a document that navigated away from the injected script).
 */
async fn navigation_position(window: &WebviewWindow) -> Option<(bool, bool)> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let sender = Arc::new(Mutex::new(Some(tx)));
    let Ok(()) = window.eval_with_callback(NAVIGATION_STATE_SCRIPT, move |value| {
        if let Some(sender) = sender.lock().unwrap().take() {
            let _ = sender.send(value);
        }
    }) else {
        return None;
    };
    let value = tokio::time::timeout(std::time::Duration::from_secs(2), rx)
        .await
        .ok()?
        .ok()?;
    #[derive(Deserialize)]
    struct Navigation {
        index: f64,
        length: f64,
    }
    let parsed: Navigation = serde_json::from_str(&value).ok()?;
    Some((parsed.index > 0.0, parsed.index + 1.0 < parsed.length))
}

/** Open one guest window for a workspace and register its lease. */
async fn create_guest(
    app: &tauri::AppHandle,
    lease: &str,
    workspace: &str,
) -> Result<BrowserGuest, String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Desktop main window is unavailable".to_string())?;
    let mut builder = WebviewWindowBuilder::new(
        app,
        lease,
        // The guest starts blank; the page navigates it once it has an address.
        WebviewUrl::External(
            Url::parse("about:blank")
                .map_err(|error| error.to_string())?
                .into(),
        ),
    )
    .parent(&main)
    .map_err(|error| error.to_string())?
    .title("DeepDive")
    .inner_size(320.0, 240.0)
    .visible(false)
    .decorations(false)
    .shadow(false)
    .resizable(false)
    .skip_taskbar(true)
    .initialization_script(NAVIGATION_SCRIPT)
    .on_page_load({
        let app = app.clone();
        let lease = lease.to_string();
        move |window, payload| {
            let started = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
            let address = (!started)
                .then(|| window.url().map(|url| url.as_str().to_string()).ok())
                .flatten();
            let registry = app.state::<crate::DesktopState>();
            registry.browser.update(&lease, |guest| {
                guest.state.loading = started;
                if let Some(address) = address.clone() {
                    guest.state.url = address;
                }
            });
            if started {
                emit(&app, &lease, "load-started");
            } else {
                // History availability is settled when a document finishes, so
                // this is the notification that carries it.
                announce(&app, &lease, "load-finished");
            }
        }
    })
    .on_document_title_changed({
        let app = app.clone();
        let lease = lease.to_string();
        move |_window, title| {
            let registry = app.state::<crate::DesktopState>();
            registry.browser.update(&lease, |guest| guest.state.title = title);
            emit(&app, &lease, "title");
        }
    })
    .on_navigation({
        let app = app.clone();
        let lease = lease.to_string();
        move |target| {
            // A guest may only present HTTP(S) content: a page-initiated
            // `mailto:`, `file:` or custom-scheme navigation is refused.
            if !matches!(target.scheme(), "http" | "https") {
                return false;
            }
            let registry = app.state::<crate::DesktopState>();
            let address = target.as_str().to_string();
            registry.browser.update(&lease, |guest| {
                guest.state.url = address;
            });
            announce(&app, &lease, "navigated");
            true
        }
    });
    // macOS refuses `data_directory`, and its per-WebView data store only
    // exists from macOS 14; asking for it is still correct below that version
    // because the platform then keeps the default store.
    let data_store = storage_key(workspace);
    let mut hasher = [0_u8; 16];
    for (index, byte) in data_store.as_bytes().iter().take(16).enumerate() {
        hasher[index] = *byte;
    }
    builder = builder.data_store_identifier(hasher);
    if let Some(directory) = guest_data_directory(app, workspace) {
        builder = builder.data_directory(directory);
    }
    builder.build().map_err(|error| error.to_string())?;
    Ok(BrowserGuest {
        label: lease.to_string(),
        state: BrowserGuestState::default(),
        rect: None,
    })
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
) -> Result<BrowserReservation, String> {
    let lease = state.browser.lease();
    let guest = create_guest(&app, &lease, &workspace).await?;
    state.browser.guests.lock().unwrap().insert(lease.clone(), guest);
    Ok(BrowserReservation {
        partition: format!("desktop-browser-{}", storage_key(&workspace)),
        lease,
    })
}

/**
 * Address the guest window to the given rectangle.
 * @param app - application handle owning the windows.
 * @param state - Desktop state holding the guest registry.
 * @param lease - the calling tab's lease.
 * @param x - left edge in CSS pixels relative to the main client area.
 * @param y - top edge in CSS pixels relative to the main client area.
 * @param width - member width in CSS pixels.
 * @param height - member height in CSS pixels.
 * @param visible - whether the guest should be on screen after moving.
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
    let rect = BrowserRect {
        x,
        y,
        width,
        height,
    };
    if !rect.is_usable() {
        return Ok(());
    }
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Desktop main window is unavailable".to_string())?;
    let guest = app
        .get_webview_window(&lease)
        .ok_or_else(|| "Desktop browser guest is not running".to_string())?;
    state.browser.update(&lease, |entry| entry.rect = Some(rect));
    place(&main, &guest, rect);
    if visible {
        guest.show().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/**
 * Show or hide the guest without discarding its page.
 * @param app - application handle owning the window.
 * @param lease - the calling tab's lease.
 * @param visible - whether the guest should be on screen.
 */
#[tauri::command]
pub(crate) fn desktop_browser_visible(
    app: tauri::AppHandle,
    lease: String,
    visible: bool,
) -> Result<(), String> {
    let guest = app
        .get_webview_window(&lease)
        .ok_or_else(|| "Desktop browser guest is not running".to_string())?;
    if visible {
        guest.show()
    } else {
        guest.hide()
    }
    .map_err(|error| error.to_string())
}

/**
 * Load an address in the guest.
 * @param app - application handle owning the window.
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
    let guest = app
        .get_webview_window(&lease)
        .ok_or_else(|| "Desktop browser guest is not running".to_string())?;
    guest.navigate(target).map_err(|error| error.to_string())
}

/**
 * Run one history or reload operation inside the guest.
 * @param app - application handle owning the window.
 * @param lease - the calling tab's lease.
 * @param command - `reload`, `back` or `forward`.
 */
#[tauri::command]
pub(crate) fn desktop_browser_command(
    app: tauri::AppHandle,
    lease: String,
    command: String,
) -> Result<(), String> {
    let guest = app
        .get_webview_window(&lease)
        .ok_or_else(|| "Desktop browser guest is not running".to_string())?;
    match command.as_str() {
        "reload" => guest.reload().map_err(|error| error.to_string()),
        "back" => guest
            .eval("history.back()")
            .map_err(|error| error.to_string()),
        "forward" => guest
            .eval("history.forward()")
            .map_err(|error| error.to_string()),
        other => Err(format!("unknown Desktop browser command {other:?}")),
    }
}

/**
 * Report the guest's cached navigation state.
 * @param app - application handle owning the window.
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
    let guest_window = app
        .get_webview_window(&lease)
        .ok_or_else(|| "Desktop browser guest is not running".to_string())?;
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
    if let Ok(url) = guest_window.url() {
        current.url = url.as_str().to_string();
    }
    if let Some((back, forward)) = navigation_position(&guest_window).await {
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
 * @param app - application handle owning the window.
 * @param state - Desktop state holding the guest registry.
 * @param lease - the calling tab's lease.
 */
#[tauri::command]
pub(crate) fn desktop_browser_release(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::DesktopState>,
    lease: String,
) -> Result<(), String> {
    state.browser.remove(&lease);
    if let Some(guest) = app.get_webview_window(&lease) {
        guest.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/**
 * Re-address every guest after the main window moved or resized.
 * @param app - application handle owning the windows.
 * @param window - the window whose event fired.
 */
pub(crate) fn follow(app: &tauri::AppHandle, window: &WebviewWindow) {
    if window.label() != "main" {
        return;
    }
    // A minimized main window has no client area to follow; its owned windows
    // leave the screen with it and are re-addressed on the way back.
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let state = app.state::<crate::DesktopState>();
    state.browser.refollow(window);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_keys_are_stable_and_distinct() {
        assert_eq!(storage_key("alpha"), storage_key("alpha"));
        assert_ne!(storage_key("alpha"), storage_key("beta"));
        assert_eq!(storage_key("alpha").len(), 32);
    }

    #[test]
    fn permitted_urls_are_absolute_http_or_https() {
        assert!(permitted_url("https://example.test/path").is_ok());
        assert!(permitted_url("http://127.0.0.1:5173/").is_ok());
        for rejected in [
            "file:///etc/passwd",
            "mailto:user@example.test",
            "javascript:alert(1)",
            "about:blank",
            "data:text/html,hi",
            "example.test",
            "",
        ] {
            assert!(permitted_url(rejected).is_err(), "must reject {rejected}");
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
        assert!(BrowserRect {
            x: 10.0,
            y: 20.0,
            width: 320.0,
            height: 240.0
        }
        .is_usable());
    }

    #[test]
    fn the_navigation_tracker_script_targets_the_reserved_global() {
        assert!(NAVIGATION_SCRIPT.contains("__dshBrowserNav"));
        assert!(NAVIGATION_SCRIPT.contains("pushState"));
        assert!(NAVIGATION_SCRIPT.contains("replaceState"));
        assert!(NAVIGATION_SCRIPT.contains("popstate"));
        assert!(NAVIGATION_STATE_SCRIPT.contains("JSON.stringify"));
    }
}
