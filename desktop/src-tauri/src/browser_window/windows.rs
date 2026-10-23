//! Windows-specific WebView2 hooks for the Browser guest.

#![cfg(windows)]

use std::{
    cell::RefCell,
    rc::Rc,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use tauri::{webview::PlatformWebview, AppHandle, Webview};
use url::{Host, Url};
use webview2_com::{
    take_pwstr, FocusChangedEventHandler, HistoryChangedEventHandler,
    Microsoft::Web::WebView2::Win32::*, NavigationCompletedEventHandler,
    NavigationStartingEventHandler, PermissionRequestedEventHandler,
    WebResourceRequestedEventHandler,
};
use webview2_windows::{
    core::{Interface, BOOL, HSTRING, PWSTR},
    Win32::System::Com::IStream,
};

const LOOPBACK_FILTERS: [&str; 3] = ["*://localhost:*/*", "*://127.0.0.1:*/*", "*://[::1]:*/*"];

struct Navigation {
    id: u64,
    url: String,
    cancelled: bool,
}

struct NavigationTracker {
    current: Option<Navigation>,
}

/** Event registrations shared by the Browser registry and origin updater. */
#[derive(Clone)]
pub(crate) struct GuestHooks(Arc<GuestHookState>);

struct GuestHookState {
    registrations: Mutex<Option<Vec<EventRegistration>>>,
    removed: AtomicBool,
}

enum EventRegistration {
    Permission(ICoreWebView2, i64),
    Focus(ICoreWebView2Controller, i64),
    History(ICoreWebView2, i64),
    NavigationStarting(ICoreWebView2, i64),
    NavigationCompleted(ICoreWebView2, i64),
    WebResourceRequested(ICoreWebView2, i64),
    RequestFilter(ICoreWebView2_22, HSTRING),
}

impl GuestHookState {
    /** Remove each installed event and filter once, while the view is alive. */
    fn remove(&self) -> Vec<String> {
        if self.removed.swap(true, Ordering::AcqRel) {
            return Vec::new();
        }
        let registrations = self
            .registrations
            .lock()
            .unwrap()
            .take()
            .unwrap_or_default();
        remove_registrations(registrations)
    }
}

/** Install permission, focus, history, failure, and loopback-request hooks. */
pub(crate) async fn install(
    app: &AppHandle,
    lease: &str,
    view: &Webview,
    origin: &str,
) -> Result<GuestHooks, String> {
    let origin = parse_sidecar_origin(origin)?;
    let app = app.clone();
    let lease = lease.to_string();
    with_platform(view, move |platform| unsafe {
        install_on_platform(&app, &lease, platform, origin)
    })
    .await
}

/** Remove native handlers before the guest WebView closes. */
pub(crate) async fn remove(view: &Webview, hooks: GuestHooks) -> Result<(), String> {
    with_platform(view, move |_| {
        let failures = hooks.0.remove();
        if failures.is_empty() {
            Ok(())
        } else {
            Err(failures.join("; "))
        }
    })
    .await
}

/** Read back and forward availability from WebView2's native history. */
pub(crate) async fn navigation_state(view: &Webview) -> Result<(bool, bool), String> {
    with_platform(view, |platform| unsafe {
        let webview = core_webview(&platform)?;
        native_history(&webview)
    })
    .await
}

/** Navigate through WebView2's native history stack. */
pub(crate) async fn navigate_history(view: &Webview, back: bool) -> Result<(), String> {
    with_platform(view, move |platform| unsafe {
        let webview = core_webview(&platform)?;
        if back {
            webview.GoBack()
        } else {
            webview.GoForward()
        }
        .map_err(|error| error.to_string())
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

unsafe fn core_webview(platform: &PlatformWebview) -> Result<ICoreWebView2, String> {
    platform
        .controller()
        .CoreWebView2()
        .map_err(|error| error.to_string())
}

unsafe fn native_history(webview: &ICoreWebView2) -> Result<(bool, bool), String> {
    let mut back = BOOL::default();
    let mut forward = BOOL::default();
    webview
        .CanGoBack(&mut back)
        .map_err(|error| error.to_string())?;
    webview
        .CanGoForward(&mut forward)
        .map_err(|error| error.to_string())?;
    Ok((back.as_bool(), forward.as_bool()))
}

unsafe fn install_on_platform(
    app: &AppHandle,
    lease: &str,
    platform: PlatformWebview,
    origin: Url,
) -> Result<GuestHooks, String> {
    let controller = platform.controller();
    let webview = controller
        .CoreWebView2()
        .map_err(|error| error.to_string())?;
    let filtered_webview = webview.cast::<ICoreWebView2_22>().map_err(|error| {
        format!(
            "Browser request filtering requires WebView2 Runtime 122.0.2365.46 or newer: {error}"
        )
    })?;
    let request_origin = origin.clone();
    let mut registrations = Vec::with_capacity(9);

    let setup = (|| -> Result<(), String> {
        for filter in LOOPBACK_FILTERS {
            let filter = HSTRING::from(filter);
            filtered_webview
                .AddWebResourceRequestedFilterWithRequestSourceKinds(
                    &filter,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                )
                .map_err(|error| format!("failed to install loopback request filter: {error}"))?;
            registrations.push(EventRegistration::RequestFilter(
                filtered_webview.clone(),
                filter,
            ));
        }

        let environment = platform.environment();
        let request = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let request = args.Request()?;
            let mut uri = PWSTR::null();
            request.Uri(&mut uri)?;
            let address = take_pwstr(uri);
            let disposition = loopback_request_disposition(&request_origin, &address);
            if disposition == RequestDisposition::Allow {
                return Ok(());
            }

            let (status_code, reason) = match disposition {
                RequestDisposition::Deny => (403, "Forbidden"),
                RequestDisposition::FailClosed => (503, "Sidecar origin unavailable"),
                RequestDisposition::Allow => unreachable!(),
            };
            let reason = HSTRING::from(reason);
            let headers = HSTRING::from("Content-Type: text/plain\r\nCache-Control: no-store\r\n");
            let response = environment.CreateWebResourceResponse(
                None::<&IStream>,
                status_code,
                &reason,
                &headers,
            )?;
            args.SetResponse(&response)?;
            Ok(())
        }));
        let mut token = 0;
        webview
            .add_WebResourceRequested(&request, &mut token)
            .map_err(|error| error.to_string())?;
        registrations.push(EventRegistration::WebResourceRequested(
            webview.clone(),
            token,
        ));

        let permission = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
            }
            Ok(())
        }));
        token = 0;
        webview
            .add_PermissionRequested(&permission, &mut token)
            .map_err(|error| error.to_string())?;
        registrations.push(EventRegistration::Permission(webview.clone(), token));

        let app_focus = app.clone();
        let lease_focus = lease.to_string();
        let focus = FocusChangedEventHandler::create(Box::new(move |_, _| {
            super::guest_focused(&app_focus, &lease_focus);
            Ok(())
        }));
        token = 0;
        controller
            .add_GotFocus(&focus, &mut token)
            .map_err(|error| error.to_string())?;
        registrations.push(EventRegistration::Focus(controller.clone(), token));

        let tracker = Rc::new(RefCell::new(NavigationTracker { current: None }));
        let start_tracker = Rc::clone(&tracker);
        let starting = NavigationStartingEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut id = 0;
            args.NavigationId(&mut id)?;
            let mut uri = PWSTR::null();
            args.Uri(&mut uri)?;
            let url = take_pwstr(uri);
            let mut cancelled = BOOL::default();
            args.Cancel(&mut cancelled)?;

            let mut tracker = start_tracker.borrow_mut();
            if cancelled.as_bool() {
                if let Some(current) = tracker.current.as_mut().filter(|current| current.id == id) {
                    current.url = url;
                    current.cancelled = true;
                }
            } else if tracker
                .current
                .as_ref()
                .is_some_and(|current| current.id == id)
            {
                let current = tracker.current.as_mut().unwrap();
                current.url = url;
            } else {
                tracker.current = Some(Navigation {
                    id,
                    url,
                    cancelled: false,
                });
            }
            Ok(())
        }));
        token = 0;
        webview
            .add_NavigationStarting(&starting, &mut token)
            .map_err(|error| error.to_string())?;
        registrations.push(EventRegistration::NavigationStarting(
            webview.clone(),
            token,
        ));

        let completed_tracker = Rc::clone(&tracker);
        let app_completed = app.clone();
        let lease_completed = lease.to_string();
        let completed = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut id = 0;
            args.NavigationId(&mut id)?;
            let current = {
                let mut tracker = completed_tracker.borrow_mut();
                if tracker
                    .current
                    .as_ref()
                    .is_some_and(|current| current.id == id)
                {
                    tracker.current.take()
                } else {
                    None
                }
            };
            let Some(current) = current.filter(|current| !current.cancelled) else {
                return Ok(());
            };

            let mut succeeded = BOOL::default();
            args.IsSuccess(&mut succeeded)?;
            if succeeded.as_bool() {
                return Ok(());
            }
            let mut status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
            args.WebErrorStatus(&mut status)?;
            if status == COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED {
                return Ok(());
            }
            super::page_load_failed(
                &app_completed,
                &lease_completed,
                &current.url,
                status.0,
                web_error_description(status).to_string(),
            );
            Ok(())
        }));
        token = 0;
        webview
            .add_NavigationCompleted(&completed, &mut token)
            .map_err(|error| error.to_string())?;
        registrations.push(EventRegistration::NavigationCompleted(
            webview.clone(),
            token,
        ));

        let app_history = app.clone();
        let lease_history = lease.to_string();
        let history = HistoryChangedEventHandler::create(Box::new(move |sender, _| {
            if let Some(webview) = sender {
                let (back, forward) = native_history(&webview)?;
                let mut uri = PWSTR::null();
                webview.Source(&mut uri)?;
                update_history(&app_history, &lease_history, back, forward, take_pwstr(uri));
            }
            Ok(())
        }));
        token = 0;
        webview
            .add_HistoryChanged(&history, &mut token)
            .map_err(|error| error.to_string())?;
        registrations.push(EventRegistration::History(webview, token));

        Ok(())
    })();

    if let Err(error) = setup {
        let cleanup_errors = remove_registrations(std::mem::take(&mut registrations));
        return Err(if cleanup_errors.is_empty() {
            error
        } else {
            format!(
                "{error}; failed to remove partial Browser hooks: {}",
                cleanup_errors.join("; ")
            )
        });
    }

    Ok(GuestHooks(Arc::new(GuestHookState {
        registrations: Mutex::new(Some(registrations)),
        removed: AtomicBool::new(false),
    })))
}

fn remove_registrations(registrations: Vec<EventRegistration>) -> Vec<String> {
    let mut failures = Vec::new();
    for registration in registrations.into_iter().rev() {
        let result = unsafe {
            match registration {
                EventRegistration::Permission(webview, token) => {
                    webview.remove_PermissionRequested(token)
                }
                EventRegistration::Focus(controller, token) => controller.remove_GotFocus(token),
                EventRegistration::History(webview, token) => webview.remove_HistoryChanged(token),
                EventRegistration::NavigationStarting(webview, token) => {
                    webview.remove_NavigationStarting(token)
                }
                EventRegistration::NavigationCompleted(webview, token) => {
                    webview.remove_NavigationCompleted(token)
                }
                EventRegistration::WebResourceRequested(webview, token) => {
                    webview.remove_WebResourceRequested(token)
                }
                EventRegistration::RequestFilter(webview, filter) => webview
                    .RemoveWebResourceRequestedFilterWithRequestSourceKinds(
                        &filter,
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                    ),
            }
        };
        if let Err(error) = result {
            failures.push(error.to_string());
        }
    }
    failures
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RequestDisposition {
    Allow,
    Deny,
    FailClosed,
}

fn parse_sidecar_origin(value: &str) -> Result<Url, String> {
    let origin = Url::parse(value).map_err(|error| error.to_string())?;
    if !matches!(origin.scheme(), "http" | "https") || !is_loopback(&origin) {
        return Err("Desktop sidecar origin must use a loopback HTTP(S) address".to_string());
    }
    Ok(origin)
}

fn loopback_request_disposition(origin: &Url, request: &str) -> RequestDisposition {
    let Ok(request) = Url::parse(request) else {
        return RequestDisposition::FailClosed;
    };
    if !matches!(request.scheme(), "http" | "https" | "ws" | "wss")
        || request.port_or_known_default() != origin.port_or_known_default()
    {
        return RequestDisposition::Allow;
    }
    if is_loopback(&request) {
        RequestDisposition::Deny
    } else {
        RequestDisposition::Allow
    }
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain("localhost")) => true,
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        _ => false,
    }
}

fn update_history(app: &AppHandle, lease: &str, back: bool, forward: bool, url: String) {
    app.state::<crate::DesktopState>()
        .browser
        .update(lease, |guest| {
            guest.state.can_go_back = back;
            guest.state.can_go_forward = forward;
            if !url.is_empty() {
                guest.state.url = url;
            }
        });
    super::emit(app, lease, "history-changed");
}

fn web_error_description(status: COREWEBVIEW2_WEB_ERROR_STATUS) -> &'static str {
    match status {
        COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT => "Cannot connect to server",
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT => {
            "Invalid certificate name"
        }
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED => "Certificate expired",
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID => "Certificate is invalid",
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED => "Certificate revoked",
        COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS => {
            "Invalid client certificate"
        }
        COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED => "Connection aborted",
        COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET => "Connection reset",
        COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED => "Connection lost",
        COREWEBVIEW2_WEB_ERROR_STATUS_ERROR_HTTP_INVALID_SERVER_RESPONSE => {
            "Invalid server response"
        }
        COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED => "Host name not resolved",
        COREWEBVIEW2_WEB_ERROR_STATUS_REDIRECT_FAILED => "Redirect failed",
        COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE => "Server unreachable",
        COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT => "Request timed out",
        COREWEBVIEW2_WEB_ERROR_STATUS_UNEXPECTED_ERROR => "Unexpected navigation error",
        COREWEBVIEW2_WEB_ERROR_STATUS_VALID_AUTHENTICATION_CREDENTIALS_REQUIRED => {
            "Credentials required"
        }
        COREWEBVIEW2_WEB_ERROR_STATUS_VALID_PROXY_AUTHENTICATION_REQUIRED => {
            "Proxy credentials required"
        }
        _ => "Navigation failed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_filter_denies_sidecar_loopback_aliases_only() {
        let origin = parse_sidecar_origin("http://127.0.0.1:47821").unwrap();
        for request in [
            "http://127.0.0.1:47821/api",
            "http://localhost:47821/api",
            "http://[::1]:47821/api",
        ] {
            assert_eq!(
                loopback_request_disposition(&origin, request),
                RequestDisposition::Deny,
                "must deny {request}"
            );
        }
        for request in [
            "http://127.0.0.1:47822/api",
            "https://example.test:47821/api",
        ] {
            assert_eq!(
                loopback_request_disposition(&origin, request),
                RequestDisposition::Allow,
                "must allow {request}"
            );
        }
        for request in [
            "https://localhost:47821/api",
            "ws://localhost:47821/socket",
            "wss://[::1]:47821/socket",
        ] {
            assert_eq!(
                loopback_request_disposition(&origin, request),
                RequestDisposition::Deny,
                "must deny loopback host alias {request}"
            );
        }
        assert_eq!(
            loopback_request_disposition(&origin, "not a URL"),
            RequestDisposition::FailClosed
        );
    }

    #[test]
    fn sidecar_origin_must_be_loopback_http() {
        for origin in [
            "http://127.0.0.1:47821",
            "http://localhost:47821",
            "http://[::1]:47821",
            "https://127.0.0.1:47821",
        ] {
            assert!(parse_sidecar_origin(origin).is_ok(), "must accept {origin}");
        }
        for origin in ["http://example.test:47821", "file:///tmp/sidecar"] {
            assert!(
                parse_sidecar_origin(origin).is_err(),
                "must reject {origin}"
            );
        }
    }
}
