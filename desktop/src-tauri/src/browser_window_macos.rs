//! WKWebView operations required by the Desktop Browser guest.

use std::{
    ffi::{c_char, c_void, CStr, CString},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use tauri::{webview::PlatformWebview, AppHandle, Emitter, Manager, Webview};
use url::Url;

use super::BROWSER_EVENT;

type RuleResult = Result<(), String>;
type RuleSender = tokio::sync::oneshot::Sender<RuleResult>;

struct GuestContext {
    app: AppHandle,
    lease: String,
}

/** Native hook references and callback storage for one guest. */
#[derive(Clone)]
pub(crate) struct GuestHooks(Arc<GuestHookState>);

struct GuestHookState {
    opaque: usize,
    context: usize,
    removed: AtomicBool,
}

impl GuestHookState {
    fn remove(&self) {
        if !self.removed.swap(true, Ordering::AcqRel) {
            unsafe { dsh_browser_remove_hooks(self.opaque as *mut c_void) };
            unsafe { drop(Arc::from_raw(self.context as *const GuestContext)) };
        }
    }
}

impl Drop for GuestHookState {
    fn drop(&mut self) {
        self.remove();
    }
}

unsafe extern "C" {
    fn dsh_browser_install_hooks(
        webview: *mut c_void,
        focus_callback: unsafe extern "C" fn(*mut c_void),
        failure_callback: unsafe extern "C" fn(*mut c_void, *const c_char, i32, *const c_char),
        history_callback: unsafe extern "C" fn(*mut c_void, bool, bool, *const c_char),
        context: *mut c_void,
    ) -> *mut c_void;
    fn dsh_browser_remove_hooks(hooks: *mut c_void);
    fn dsh_browser_install_loopback_block_rule(
        hooks: *mut c_void,
        identifier: *const c_char,
        rules: *const c_char,
        callback: unsafe extern "C" fn(*mut c_void, i32, *const c_char),
        context: *mut c_void,
    );
    fn dsh_browser_navigation_state(
        webview: *mut c_void,
        can_go_back: *mut bool,
        can_go_forward: *mut bool,
    );
    fn dsh_browser_navigate_history(webview: *mut c_void, back: bool) -> bool;
}

/** Install WebKit delegates, history reporting, and the current sidecar block rule. */
pub(crate) async fn install(
    app: &AppHandle,
    lease: &str,
    view: &Webview,
    origin: &str,
    _workspace: &str,
) -> Result<GuestHooks, String> {
    let context = Arc::new(GuestContext {
        app: app.clone(),
        lease: lease.to_string(),
    });
    let context_pointer = Arc::as_ptr(&context) as usize;
    let install_context = Arc::clone(&context);
    let install = with_platform(view, move |platform| unsafe {
        let handle = dsh_browser_install_hooks(
            platform.inner(),
            guest_focused,
            page_load_failed,
            history_changed,
            context_pointer as *mut c_void,
        );
        if handle.is_null() {
            Err("WebKit did not install Browser guest hooks".to_string())
        } else {
            std::mem::forget(install_context);
            Ok(handle as usize)
        }
    })
    .await;

    let opaque = match install {
        Ok(opaque) => opaque,
        Err(error) => {
            return Err(error);
        }
    };
    let hooks = GuestHooks(Arc::new(GuestHookState {
        opaque,
        context: context_pointer,
        removed: AtomicBool::new(false),
    }));
    if let Err(error) = apply_loopback_rule(view, &hooks, lease, origin).await {
        remove(view, hooks).await?;
        return Err(error);
    }
    Ok(hooks)
}

/** Remove native callbacks before closing the WKWebView. */
pub(crate) async fn remove(view: &Webview, hooks: GuestHooks) -> Result<(), String> {
    let result = with_platform(view, move |_| {
        hooks.0.remove();
        Ok(())
    })
    .await;
    result
}

/** Read canGoBack and canGoForward from WKWebView's native history. */
pub(crate) async fn navigation_state(view: &Webview) -> Result<(bool, bool), String> {
    with_platform(view, |platform| unsafe {
        let mut can_go_back = false;
        let mut can_go_forward = false;
        dsh_browser_navigation_state(platform.inner(), &mut can_go_back, &mut can_go_forward);
        Ok((can_go_back, can_go_forward))
    })
    .await
}

/** Navigate through WKWebView's native back-forward list. */
pub(crate) async fn navigate_history(view: &Webview, back: bool) -> Result<(), String> {
    with_platform(view, move |platform| unsafe {
        if dsh_browser_navigate_history(platform.inner(), back) {
            Ok(())
        } else {
            Err("Browser guest has no matching history entry".to_string())
        }
    })
    .await
}

async fn with_platform<T, F>(view: &Webview, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(PlatformWebview) -> Result<T, String> + Send + 'static,
{
    let (sender, receiver) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        let _ = sender.send(operation(platform));
    })
    .map_err(|error| error.to_string())?;
    receiver
        .await
        .map_err(|_| "Browser WebView operation ended before returning".to_string())?
}

async fn apply_loopback_rule(
    view: &Webview,
    hooks: &GuestHooks,
    lease: &str,
    origin: &str,
) -> Result<(), String> {
    let (identifier, rules) = loopback_rule(lease, origin)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Box::into_raw(Box::new(sender)) as usize;
    let handle = hooks.0.opaque;
    if hooks.0.removed.load(Ordering::Acquire) {
        unsafe { drop(Box::from_raw(sender as *mut RuleSender)) };
        return Err("Browser guest hooks were already removed".to_string());
    }
    let scheduled = with_platform(view, move |_| {
        unsafe {
            dsh_browser_install_loopback_block_rule(
                handle as *mut c_void,
                identifier.as_ptr(),
                rules.as_ptr(),
                rule_installed,
                sender as *mut c_void,
            );
        }
        Ok(())
    })
    .await;
    if let Err(error) = scheduled {
        unsafe { drop(Box::from_raw(sender as *mut RuleSender)) };
        return Err(error);
    }
    receiver
        .await
        .map_err(|_| "WebKit rule compilation ended without a result".to_string())?
}

fn loopback_rule(lease: &str, origin: &str) -> Result<(CString, CString), String> {
    let origin = Url::parse(origin).map_err(|error| error.to_string())?;
    if !origin.username().is_empty()
        || origin.password().is_some()
        || !matches!(origin.scheme(), "http" | "https")
        || !origin.host_str().is_some_and(super::is_loopback_host)
    {
        return Err("Desktop Browser requires a loopback HTTP(S) sidecar origin".to_string());
    }
    let port = origin
        .port()
        .ok_or_else(|| "Desktop Browser sidecar origin has no explicit port".to_string())?;
    let filter = format!(r"^(?:https?|wss?)://(?:localhost|127\.0\.0\.1|\[::1\]):{port}(?:/|$)");
    let rules = serde_json::json!([{
        "trigger": { "url-filter": filter },
        "action": { "type": "block" }
    }]);
    let identifier = CString::new(format!(
        "dsh-browser-{}-{}",
        super::storage_key(lease),
        super::storage_key(origin.as_str()),
    ))
    .map_err(|error| error.to_string())?;
    let encoded_rules = CString::new(rules.to_string()).map_err(|error| error.to_string())?;
    Ok((identifier, encoded_rules))
}

unsafe extern "C" fn rule_installed(context: *mut c_void, success: i32, error: *const c_char) {
    let sender = Box::from_raw(context as *mut RuleSender);
    let result = if success != 0 {
        Ok(())
    } else if error.is_null() {
        Err("WebKit could not install the Browser request rule".to_string())
    } else {
        Err(CStr::from_ptr(error).to_string_lossy().into_owned())
    };
    let _ = sender.send(result);
}

unsafe extern "C" fn guest_focused(context: *mut c_void) {
    let context = &*(context as *const GuestContext);
    super::guest_focused(&context.app, &context.lease);
}

unsafe extern "C" fn page_load_failed(
    context: *mut c_void,
    url: *const c_char,
    code: i32,
    description: *const c_char,
) {
    let context = &*(context as *const GuestContext);
    let url = c_string(url);
    let description = c_string(description);
    super::page_load_failed(&context.app, &context.lease, &url, code, description);
}

unsafe extern "C" fn history_changed(
    context: *mut c_void,
    can_go_back: bool,
    can_go_forward: bool,
    url: *const c_char,
) {
    let context = &*(context as *const GuestContext);
    let app_state = context.app.state::<crate::DesktopState>();
    app_state.browser.update(&context.lease, |guest| {
        guest.state.url = c_string(url);
        guest.state.can_go_back = can_go_back;
        guest.state.can_go_forward = can_go_forward;
    });
    let snapshot = app_state
        .browser
        .guests
        .lock()
        .unwrap()
        .get(&context.lease)
        .map(|guest| guest.state.clone())
        .unwrap_or_default();
    let _ = context.app.emit_to(
        "main",
        BROWSER_EVENT,
        serde_json::json!({
            "lease": &context.lease,
            "kind": "history-changed",
            "state": snapshot,
        }),
    );
}

unsafe fn c_string(value: *const c_char) -> String {
    if value.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(value) }
        .to_string_lossy()
        .into_owned()
}
