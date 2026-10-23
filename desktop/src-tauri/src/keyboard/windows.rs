//! Route WebView2 keyboard messages through one hook on Tauri's UI thread.

use std::{
    collections::{HashMap, HashSet},
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use tauri::{webview::PlatformWebview, AppHandle, Webview};
use webview2_com::{
    FocusChangedEventHandler, Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
};
use webview2_windows::Win32::Foundation::HWND as WebViewHwnd;
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM},
        System::Threading::GetCurrentThreadId,
        UI::{
            Input::{
                Ime::{ImmGetCompositionStringW, ImmGetContext, ImmReleaseContext, GCS_COMPSTR},
                KeyboardAndMouse::{
                    GetFocus, GetKeyState, GetKeyboardLayout, GetKeyboardState, ToUnicodeEx,
                    VK_CONTROL, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_MENU, VK_RCONTROL,
                    VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SHIFT,
                },
            },
            WindowsAndMessaging::{
                CallNextHookEx, GetAncestor, GetPropW, IsChild, RemovePropW, SetPropW,
                SetWindowsHookExW, UnhookWindowsHookEx, GA_ROOT, HC_ACTION, HHOOK, MSG, PM_REMOVE,
                WH_GETMESSAGE, WM_IME_COMPOSITION, WM_IME_ENDCOMPOSITION, WM_IME_STARTCOMPOSITION,
                WM_KEYDOWN, WM_KEYUP, WM_NULL, WM_SYSKEYDOWN, WM_SYSKEYUP,
            },
        },
    },
};

use super::KeyInput;

const CONTEXT_PROPERTY: PCWSTR = windows::core::w!("DeepDive.Desktop.KeyboardHookContext.v1");
const TO_UNICODE_NO_STATE_CHANGE: u32 = 0x0004;

/** Shared state reached only through a property on the owning Tauri root HWND. */
struct ThreadHookContext {
    app: AppHandle,
    root_hwnd: usize,
    thread_id: u32,
    hook: Mutex<Option<usize>>,
    views: Mutex<ViewRegistry>,
    removed: AtomicBool,
}

#[derive(Default)]
struct ViewRegistry {
    hwnds: HashMap<String, usize>,
    composing: HashSet<String>,
}

impl ViewRegistry {
    fn register(&mut self, label: &str, hwnd: usize) -> Result<(), String> {
        if self.hwnds.contains_key(label) {
            return Err(format!("keyboard hook already registered for view {label}"));
        }
        self.hwnds.insert(label.to_string(), hwnd);
        Ok(())
    }

    fn unregister(&mut self, label: &str) {
        self.hwnds.remove(label);
        self.composing.remove(label);
    }

    fn set_composing(&mut self, label: &str, composing: bool) {
        if composing {
            self.composing.insert(label.to_string());
        } else {
            self.composing.remove(label);
        }
    }

    fn is_composing(&self, label: &str) -> bool {
        self.composing.contains(label)
    }

    fn view_for_message(
        &self,
        message_hwnd: usize,
        mut is_child: impl FnMut(usize, usize) -> bool,
    ) -> Option<String> {
        self.hwnds.iter().find_map(|(label, registered)| {
            (message_hwnd == *registered || is_child(*registered, message_hwnd))
                .then(|| label.clone())
        })
    }
}

/** Event tokens and the shared root-thread hook owned by one native WebView. */
pub(crate) struct Hook {
    context: Arc<ThreadHookContext>,
    label: String,
    focus_tokens: FocusTokens,
    owner: bool,
    removed: bool,
}

#[derive(Clone, Copy)]
struct FocusTokens {
    got: i64,
    lost: i64,
}

impl Hook {
    fn remove_on_ui_thread(&mut self, controller: &ICoreWebView2Controller) -> Vec<String> {
        if self.removed {
            return Vec::new();
        }
        self.removed = true;
        let mut failures = remove_focus_handlers(controller, self.focus_tokens);
        if self.owner {
            failures.extend(self.context.remove_owner());
        } else {
            self.context.unregister_view(&self.label);
        }
        super::set_focus(&self.context.app, &self.label, false);
        super::reset(&self.context.app, &self.label);
        failures
    }
}

impl Drop for Hook {
    fn drop(&mut self) {
        if self.removed {
            return;
        }
        if self.owner {
            self.context.schedule_owner_removal();
        } else {
            self.context.unregister_view(&self.label);
        }
    }
}

impl ThreadHookContext {
    fn register_view(&self, label: &str, hwnd: HWND) -> Result<(), String> {
        if self.removed.load(Ordering::Acquire) {
            return Err("Desktop keyboard hook is already removed".into());
        }
        self.views.lock().unwrap().register(label, hwnd.0 as usize)
    }

    fn unregister_view(&self, label: &str) {
        self.views.lock().unwrap().unregister(label);
    }

    fn view_for_message(&self, message_hwnd: HWND) -> Option<String> {
        self.views
            .lock()
            .unwrap()
            .view_for_message(message_hwnd.0 as usize, |parent, child| {
                parent == child || unsafe { IsChild(hwnd_from(parent), hwnd_from(child)) }.as_bool()
            })
    }

    fn composing(&self, label: &str) -> bool {
        self.views.lock().unwrap().is_composing(label)
    }

    fn set_composing(&self, label: &str, composing: bool) {
        self.views.lock().unwrap().set_composing(label, composing);
    }

    fn remove_owner(&self) -> Vec<String> {
        if self.removed.swap(true, Ordering::AcqRel) {
            return Vec::new();
        }

        let mut failures = Vec::new();
        if let Some(hook) = self.hook.lock().unwrap().take() {
            if let Err(error) = unsafe { UnhookWindowsHookEx(HHOOK(hook as _)) } {
                failures.push(format!(
                    "failed to remove the keyboard message hook: {error}"
                ));
            }
        }
        let root = hwnd_from(self.root_hwnd);
        let _ = unsafe { RemovePropW(root, CONTEXT_PROPERTY) };
        let labels = {
            let mut views = self.views.lock().unwrap();
            views.composing.clear();
            views
                .hwnds
                .drain()
                .map(|(label, _)| label)
                .collect::<Vec<_>>()
        };
        for label in labels {
            super::set_focus(&self.app, &label, false);
            super::reset(&self.app, &label);
        }
        failures
    }

    fn schedule_owner_removal(self: &Arc<Self>) {
        if self.thread_id == unsafe { GetCurrentThreadId() } {
            for failure in self.remove_owner() {
                crate::devlog::write(format_args!("{failure}"));
            }
            return;
        }

        let scheduled = Arc::clone(self);
        if self
            .app
            .run_on_main_thread(move || {
                for failure in scheduled.remove_owner() {
                    crate::devlog::write(format_args!("{failure}"));
                }
            })
            .is_err()
        {
            // The owning UI thread is exiting, so it will remove its own hook.
            // Keep the property target alive until that thread can no longer call it.
            std::mem::forget(Arc::clone(self));
        }
    }
}

/** Install the one thread hook on `main`; guests register HWNDs and focus events. */
pub(crate) async fn install(view: &Webview, app: AppHandle, label: String) -> Result<Hook, String> {
    with_platform(view, move |platform| {
        install_on_platform(platform, app, label)
    })
    .await
}

/** Remove this view's focus listeners and its main/guest registration. */
pub(crate) async fn remove(view: &Webview, mut hook: Hook) -> Result<(), String> {
    with_platform(view, move |platform| {
        let failures = hook.remove_on_ui_thread(&platform.controller());
        if failures.is_empty() {
            Ok(())
        } else {
            Err(failures.join("; "))
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
        .map_err(|_| "WebView operation ended before returning".to_string())?
}

fn install_on_platform(
    platform: PlatformWebview,
    app: AppHandle,
    label: String,
) -> Result<Hook, String> {
    let controller = platform.controller();
    let hwnd = controller_parent_window(&controller)?;
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    if root.0.is_null() {
        return Err("WebView2 did not resolve to a Tauri root window".into());
    }
    let thread_id = unsafe { GetCurrentThreadId() };
    if thread_id == 0 {
        return Err("Windows did not report the WebView UI thread".into());
    }

    if label == "main" {
        install_main(controller, app, label, hwnd, root, thread_id)
    } else {
        install_guest(controller, app, label, hwnd, root, thread_id)
    }
}

fn install_main(
    controller: ICoreWebView2Controller,
    app: AppHandle,
    label: String,
    hwnd: HWND,
    root: HWND,
    thread_id: u32,
) -> Result<Hook, String> {
    if !unsafe { GetPropW(root, CONTEXT_PROPERTY) }.0.is_null() {
        return Err("Tauri root window already has a keyboard hook context".into());
    }
    let mut views = ViewRegistry::default();
    views.register(&label, hwnd.0 as usize)?;
    let context = Arc::new(ThreadHookContext {
        app,
        root_hwnd: root.0 as usize,
        thread_id,
        hook: Mutex::new(None),
        views: Mutex::new(views),
        removed: AtomicBool::new(false),
    });
    let property = HANDLE(Arc::as_ptr(&context) as *mut _);
    unsafe { SetPropW(root, CONTEXT_PROPERTY, Some(property)) }
        .map_err(|error| format!("failed to publish the keyboard hook context: {error}"))?;

    let hook = match unsafe {
        SetWindowsHookExW(WH_GETMESSAGE, Some(get_message_proc), None, thread_id)
    } {
        Ok(hook) => hook,
        Err(error) => {
            let _ = unsafe { RemovePropW(root, CONTEXT_PROPERTY) };
            return Err(format!(
                "failed to install the UI-thread keyboard hook: {error}"
            ));
        }
    };
    *context.hook.lock().unwrap() = Some(hook.0 as usize);

    let focus_tokens = match install_focus_handlers(&controller, &context, &label) {
        Ok(tokens) => tokens,
        Err(error) => {
            let _ = context.remove_owner();
            return Err(error);
        }
    };
    if view_has_focus(hwnd) {
        super::set_focus(&context.app, &label, true);
    }
    Ok(Hook {
        context,
        label,
        focus_tokens,
        owner: true,
        removed: false,
    })
}

fn install_guest(
    controller: ICoreWebView2Controller,
    _app: AppHandle,
    label: String,
    hwnd: HWND,
    root: HWND,
    thread_id: u32,
) -> Result<Hook, String> {
    let context = context_for_root(root).ok_or_else(|| {
        "main WebView keyboard hook is not installed for this root window".to_string()
    })?;
    if context.thread_id != thread_id || context.root_hwnd != root.0 as usize {
        return Err("Browser WebView does not share the main UI thread and root window".into());
    }
    context.register_view(&label, hwnd)?;
    let focus_tokens = match install_focus_handlers(&controller, &context, &label) {
        Ok(tokens) => tokens,
        Err(error) => {
            context.unregister_view(&label);
            return Err(error);
        }
    };
    // Wry creates a unique child HWND for each WebView, so this is view-specific.
    if view_has_focus(hwnd) {
        super::set_focus(&context.app, &label, true);
    }
    Ok(Hook {
        context,
        label,
        focus_tokens,
        owner: false,
        removed: false,
    })
}

fn install_focus_handlers(
    controller: &ICoreWebView2Controller,
    context: &Arc<ThreadHookContext>,
    label: &str,
) -> Result<FocusTokens, String> {
    let app_got = context.app.clone();
    let label_got = label.to_string();
    let got_handler = FocusChangedEventHandler::create(Box::new(move |_, _| {
        super::set_focus(&app_got, &label_got, true);
        Ok(())
    }));
    let mut got = 0;
    unsafe { controller.add_GotFocus(&got_handler, &mut got) }
        .map_err(|error| format!("failed to observe WebView focus: {error}"))?;

    let label_lost = label.to_string();
    let context_lost = Arc::clone(context);
    let app_lost = context.app.clone();
    let lost_handler = FocusChangedEventHandler::create(Box::new(move |_, _| {
        context_lost.set_composing(&label_lost, false);
        super::set_focus(&app_lost, &label_lost, false);
        Ok(())
    }));
    let mut lost = 0;
    if let Err(error) = unsafe { controller.add_LostFocus(&lost_handler, &mut lost) } {
        let _ = unsafe { controller.remove_GotFocus(got) };
        return Err(format!("failed to observe WebView focus loss: {error}"));
    }
    Ok(FocusTokens { got, lost })
}

fn remove_focus_handlers(controller: &ICoreWebView2Controller, tokens: FocusTokens) -> Vec<String> {
    let mut failures = Vec::new();
    if let Err(error) = unsafe { controller.remove_GotFocus(tokens.got) } {
        failures.push(format!("failed to remove WebView focus handler: {error}"));
    }
    if let Err(error) = unsafe { controller.remove_LostFocus(tokens.lost) } {
        failures.push(format!(
            "failed to remove WebView focus-loss handler: {error}"
        ));
    }
    failures
}

fn controller_parent_window(controller: &ICoreWebView2Controller) -> Result<HWND, String> {
    let mut hwnd = WebViewHwnd::default();
    unsafe { controller.ParentWindow(&mut hwnd) }
        .map_err(|error| format!("failed to read WebView2 host window: {error}"))?;
    if hwnd.0.is_null() {
        return Err("WebView2 controller has no host window".into());
    }
    Ok(HWND(hwnd.0))
}

fn context_for_root(root: HWND) -> Option<Arc<ThreadHookContext>> {
    let property = unsafe { GetPropW(root, CONTEXT_PROPERTY) };
    if property.0.is_null() {
        return None;
    }
    let pointer = property.0.cast::<ThreadHookContext>();
    unsafe { Arc::increment_strong_count(pointer) };
    let context = unsafe { Arc::from_raw(pointer) };
    (!context.removed.load(Ordering::Acquire)).then_some(context)
}

unsafe extern "system" fn get_message_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code != HC_ACTION as i32 || wparam.0 != PM_REMOVE.0 as usize || lparam.0 == 0 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let message = unsafe { &mut *(lparam.0 as *mut MSG) };
        if process_message(message) {
            message.message = WM_NULL;
            message.wParam = WPARAM(0);
            message.lParam = LPARAM(0);
        }
    }));
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn process_message(message: &mut MSG) -> bool {
    if message.hwnd.0.is_null() {
        return false;
    }
    let root = unsafe { GetAncestor(message.hwnd, GA_ROOT) };
    if root.0.is_null() {
        return false;
    }
    let Some(context) = context_for_root(root) else {
        return false;
    };
    if context.root_hwnd != root.0 as usize {
        return false;
    }
    if message.hwnd != root && !unsafe { IsChild(root, message.hwnd) }.as_bool() {
        return false;
    }
    let Some(label) = context.view_for_message(message.hwnd) else {
        return false;
    };

    match message.message {
        WM_IME_STARTCOMPOSITION => {
            context.set_composing(&label, true);
            return false;
        }
        WM_IME_ENDCOMPOSITION => {
            let view_hwnd = {
                let views = context.views.lock().unwrap();
                hwnd_from(*views.hwnds.get(&label).unwrap_or(&0))
            };
            if !is_ime_composing(message.hwnd, view_hwnd) {
                context.set_composing(&label, false);
            }
            return false;
        }
        WM_IME_COMPOSITION => {
            if message.lParam.0 as u32 & GCS_COMPSTR.0 != 0 {
                let view_hwnd = {
                    let views = context.views.lock().unwrap();
                    hwnd_from(*views.hwnds.get(&label).unwrap_or(&0))
                };
                if is_ime_composing(message.hwnd, view_hwnd) {
                    context.set_composing(&label, true);
                }
            }
            return false;
        }
        _ => {}
    }

    let Some(key_message) =
        decode_message(message.message, message.wParam.0 as u32, message.lParam.0)
    else {
        return false;
    };
    let Some(code) = physical_code(
        key_message.virtual_key,
        key_message.scan_code,
        key_message.extended,
    ) else {
        return false;
    };
    if !super::supported_code(&code) {
        return false;
    }

    let key = logical_key(
        key_message.virtual_key,
        key_message.scan_code,
        key_message.down,
    );
    let focused = unsafe { GetFocus() };
    let view_hwnd = hwnd_from(
        *context
            .views
            .lock()
            .unwrap()
            .hwnds
            .get(&label)
            .unwrap_or(&0),
    );
    let composing = context.composing(&label)
        || is_ime_composing(focused, view_hwnd)
        || is_altgr_active()
        || key == "Dead";
    super::handle(
        &context.app,
        &label,
        KeyInput {
            code,
            key,
            control: key_down(VK_CONTROL.0 as i32),
            alt: key_down(VK_MENU.0 as i32),
            shift: key_down(VK_SHIFT.0 as i32),
            meta: key_down(VK_LWIN.0 as i32) || key_down(VK_RWIN.0 as i32),
            repeat: key_message.down && key_message.previously_down,
            composing,
            down: key_message.down,
        },
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct DecodedMessage {
    virtual_key: u32,
    scan_code: u32,
    extended: bool,
    previously_down: bool,
    down: bool,
}

fn decode_message(message: u32, virtual_key: u32, lparam: isize) -> Option<DecodedMessage> {
    let down = match message {
        WM_KEYDOWN | WM_SYSKEYDOWN => true,
        WM_KEYUP | WM_SYSKEYUP => false,
        _ => return None,
    };
    let bits = lparam as u64;
    Some(DecodedMessage {
        virtual_key,
        scan_code: ((bits >> 16) & 0xff) as u32,
        extended: bits & (1 << 24) != 0,
        previously_down: bits & (1 << 30) != 0,
        down,
    })
}

fn physical_code(virtual_key: u32, scan_code: u32, extended: bool) -> Option<String> {
    if (0x70..=0x87).contains(&virtual_key) {
        return Some(format!("F{}", virtual_key - 0x6f));
    }
    let code = match (scan_code, extended) {
        (0x01, false) => "Escape",
        (0x02, false) => "Digit1",
        (0x03, false) => "Digit2",
        (0x04, false) => "Digit3",
        (0x05, false) => "Digit4",
        (0x06, false) => "Digit5",
        (0x07, false) => "Digit6",
        (0x08, false) => "Digit7",
        (0x09, false) => "Digit8",
        (0x0a, false) => "Digit9",
        (0x0b, false) => "Digit0",
        (0x0c, false) => "Minus",
        (0x0d, false) => "Equal",
        (0x0e, false) => "Backspace",
        (0x0f, false) => "Tab",
        (0x10, false) => "KeyQ",
        (0x11, false) => "KeyW",
        (0x12, false) => "KeyE",
        (0x13, false) => "KeyR",
        (0x14, false) => "KeyT",
        (0x15, false) => "KeyY",
        (0x16, false) => "KeyU",
        (0x17, false) => "KeyI",
        (0x18, false) => "KeyO",
        (0x19, false) => "KeyP",
        (0x1a, false) => "BracketLeft",
        (0x1b, false) => "BracketRight",
        (0x1c, false) => "Enter",
        (0x1d, false) => "ControlLeft",
        (0x1d, true) => "ControlRight",
        (0x1e, false) => "KeyA",
        (0x1f, false) => "KeyS",
        (0x20, false) => "KeyD",
        (0x21, false) => "KeyF",
        (0x22, false) => "KeyG",
        (0x23, false) => "KeyH",
        (0x24, false) => "KeyJ",
        (0x25, false) => "KeyK",
        (0x26, false) => "KeyL",
        (0x27, false) => "Semicolon",
        (0x28, false) => "Quote",
        (0x29, false) => "Backquote",
        (0x2a, false) => "ShiftLeft",
        (0x2b, false) => "Backslash",
        (0x2c, false) => "KeyZ",
        (0x2d, false) => "KeyX",
        (0x2e, false) => "KeyC",
        (0x2f, false) => "KeyV",
        (0x30, false) => "KeyB",
        (0x31, false) => "KeyN",
        (0x32, false) => "KeyM",
        (0x33, false) => "Comma",
        (0x34, false) => "Period",
        (0x35, false) => "Slash",
        (0x36, false) => "ShiftRight",
        (0x38, false) => "AltLeft",
        (0x38, true) => "AltRight",
        (0x39, false) => "Space",
        (0x3b..=0x44, false) => return Some(format!("F{}", scan_code - 0x3a)),
        (0x57, false) => "F11",
        (0x58, false) => "F12",
        (0x48, true) => "ArrowUp",
        (0x4b, true) => "ArrowLeft",
        (0x4d, true) => "ArrowRight",
        (0x50, true) => "ArrowDown",
        (0x53, true) => "Delete",
        (0x5b, true) => "MetaLeft",
        (0x5c, true) => "MetaRight",
        _ => return None,
    };
    Some(code.to_string())
}

fn logical_key(virtual_key: u32, scan_code: u32, down: bool) -> String {
    if (0x70..=0x87).contains(&virtual_key) {
        return format!("F{}", virtual_key - 0x6f);
    }
    if let Some(key) = named_key(virtual_key) {
        return key.to_string();
    }
    if virtual_key >= 256 {
        return "Unidentified".into();
    }
    let mut state = [0u8; 256];
    if unsafe { GetKeyboardState(&mut state) }.is_err() {
        return "Unidentified".into();
    }
    if down {
        state[virtual_key as usize] |= 0x80;
    } else {
        state[virtual_key as usize] &= !0x80;
    }
    let altgr = is_altgr_active();
    if !altgr {
        for key in [
            VK_CONTROL,
            VK_LCONTROL,
            VK_RCONTROL,
            VK_MENU,
            VK_LMENU,
            VK_RMENU,
        ] {
            state[key.0 as usize] = 0;
        }
    }
    for key in [VK_SHIFT, VK_LSHIFT, VK_RSHIFT] {
        state[key.0 as usize] = if key_down(key.0 as i32) { 0x80 } else { 0 };
    }
    let layout = unsafe { GetKeyboardLayout(0) };
    let mut output = [0u16; 8];
    let count = unsafe {
        ToUnicodeEx(
            virtual_key,
            scan_code,
            &state,
            &mut output,
            TO_UNICODE_NO_STATE_CHANGE,
            Some(layout),
        )
    };
    logical_key_from_unicode(count, &output)
}

fn logical_key_from_unicode(count: i32, output: &[u16]) -> String {
    if count < 0 {
        return "Dead".into();
    }
    if count == 0 {
        return "Unidentified".into();
    }
    String::from_utf16_lossy(&output[..(count as usize).min(output.len())])
}

fn named_key(virtual_key: u32) -> Option<&'static str> {
    Some(match virtual_key {
        0x08 => "Backspace",
        0x09 => "Tab",
        0x0d => "Enter",
        0x10 | 0xa0 | 0xa1 => "Shift",
        0x11 | 0xa2 | 0xa3 => "Control",
        0x12 | 0xa4 | 0xa5 => "Alt",
        0x13 => "Pause",
        0x14 => "CapsLock",
        0x1b => "Escape",
        0x20 => " ",
        0x21 => "PageUp",
        0x22 => "PageDown",
        0x23 => "End",
        0x24 => "Home",
        0x25 => "ArrowLeft",
        0x26 => "ArrowUp",
        0x27 => "ArrowRight",
        0x28 => "ArrowDown",
        0x2c => "PrintScreen",
        0x2d => "Insert",
        0x2e => "Delete",
        0x5b | 0x5c => "Meta",
        0x5d => "ContextMenu",
        0x90 => "NumLock",
        0x91 => "ScrollLock",
        0x6f => "Unidentified",
        _ => return None,
    })
}

fn key_down(virtual_key: i32) -> bool {
    (unsafe { GetKeyState(virtual_key) }) < 0
}

fn is_altgr_active() -> bool {
    key_down(VK_RMENU.0 as i32) && key_down(VK_CONTROL.0 as i32)
}

fn is_ime_composing(message_hwnd: HWND, view_hwnd: HWND) -> bool {
    let focused = unsafe { GetFocus() };
    let hwnd = if focused == view_hwnd || unsafe { IsChild(view_hwnd, focused) }.as_bool() {
        focused
    } else {
        message_hwnd
    };
    let context = unsafe { ImmGetContext(hwnd) };
    if context.0.is_null() {
        return false;
    }
    let composing = unsafe { ImmGetCompositionStringW(context, GCS_COMPSTR, None, 0) } > 0;
    let _ = unsafe { ImmReleaseContext(hwnd, context) };
    composing
}

fn view_has_focus(view_hwnd: HWND) -> bool {
    let focused = unsafe { GetFocus() };
    focused == view_hwnd || unsafe { IsChild(view_hwnd, focused) }.as_bool()
}

fn hwnd_from(value: usize) -> HWND {
    HWND(value as _)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_key_down_up_sys_and_repeat_bits() {
        let repeat_lparam = (1isize << 30) | (0x1e << 16);
        assert_eq!(
            decode_message(WM_KEYDOWN, 0x41, repeat_lparam),
            Some(DecodedMessage {
                virtual_key: 0x41,
                scan_code: 0x1e,
                extended: false,
                previously_down: true,
                down: true,
            })
        );
        assert_eq!(
            decode_message(WM_SYSKEYUP, 0x41, 0),
            Some(DecodedMessage {
                virtual_key: 0x41,
                scan_code: 0,
                extended: false,
                previously_down: false,
                down: false,
            })
        );
        assert_eq!(decode_message(WM_NULL, 0x41, 0), None);
    }

    #[test]
    fn maps_physical_scan_codes_independently_of_layout() {
        assert_eq!(physical_code(0x41, 0x1e, false).as_deref(), Some("KeyA"));
        assert_eq!(physical_code(0x30, 0x35, false).as_deref(), Some("Slash"));
        assert_eq!(physical_code(0x6f, 0x35, true), None);
        assert_eq!(physical_code(0x26, 0x48, true).as_deref(), Some("ArrowUp"));
        assert_eq!(
            physical_code(0xa3, 0x1d, true).as_deref(),
            Some("ControlRight")
        );
        assert_eq!(physical_code(0x7c, 0x64, false).as_deref(), Some("F13"));
        assert_eq!(physical_code(0x24, 0x48, true), None);
    }

    #[test]
    fn logical_key_handles_dead_keys_and_function_keys() {
        assert_eq!(named_key(0xa5), Some("Alt"));
        assert_eq!(named_key(0x20), Some(" "));
        assert_eq!(logical_key_from_unicode(-1, &[0x00b4]), "Dead");
        assert_eq!(logical_key_from_unicode(1, &[b'a' as u16]), "a");
        assert_eq!(physical_code(0x87, 0x76, false).as_deref(), Some("F24"));
    }

    #[test]
    fn registry_tracks_view_lifecycle_and_ime_composition() {
        let mut registry = ViewRegistry::default();
        registry.register("main", 1).unwrap();
        registry.register("guest-1", 2).unwrap();
        registry.register("guest-2", 3).unwrap();
        assert!(registry.register("guest-1", 2).is_err());
        assert_eq!(
            registry
                .view_for_message(4, |parent, child| parent == 2 && child == 4)
                .as_deref(),
            Some("guest-1")
        );
        assert_eq!(
            registry.view_for_message(3, |_, _| false).as_deref(),
            Some("guest-2")
        );
        assert_eq!(registry.view_for_message(9, |_, _| false), None);
        registry.set_composing("guest-1", true);
        assert!(registry.is_composing("guest-1"));
        registry.unregister("guest-1");
        assert!(!registry.is_composing("guest-1"));
        assert_eq!(registry.hwnds.get("main"), Some(&1));
    }
}
