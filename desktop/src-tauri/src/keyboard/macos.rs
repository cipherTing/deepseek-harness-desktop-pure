//! Install an AppKit keyboard monitor scoped to one focused WKWebView.

use std::{
    ffi::{c_char, c_void, CStr},
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use tauri::{webview::PlatformWebview, AppHandle, Webview};

use super::KeyInput;

#[path = "macos_keycodes.rs"]
mod keycodes;

const EVENT_DOWN: u8 = 1;
const EVENT_UP: u8 = 2;
const EVENT_MODIFIERS: u8 = 3;

struct HookContext {
    app: AppHandle,
    view_label: String,
}

/** Native monitor reference and callback storage for one Tauri webview. */
pub(crate) struct Hook(Arc<HookState>);

struct HookState {
    opaque: usize,
    context: usize,
    removed: AtomicBool,
}

impl HookState {
    fn remove(&self) {
        if !self.removed.swap(true, Ordering::AcqRel) {
            unsafe { dsh_keyboard_remove_hooks(self.opaque as *mut c_void) };
            unsafe { drop(Arc::from_raw(self.context as *const HookContext)) };
        }
    }
}

impl Drop for HookState {
    fn drop(&mut self) {
        self.remove();
    }
}

unsafe extern "C" {
    fn dsh_keyboard_install_hooks(
        webview: *mut c_void,
        input_callback: unsafe extern "C" fn(
            *mut c_void,
            u16,
            *const c_char,
            u8,
            u8,
            bool,
            bool,
        ) -> bool,
        reset_callback: unsafe extern "C" fn(*mut c_void),
        context: *mut c_void,
    ) -> *mut c_void;
    fn dsh_keyboard_remove_hooks(hook: *mut c_void);
}

/** Install a local keyboard monitor for this webview's focused input. */
pub(crate) async fn install(
    view: &Webview,
    app: AppHandle,
    view_label: String,
) -> Result<Hook, String> {
    let context = Arc::new(HookContext { app, view_label });
    let install = with_platform(view, move |platform| unsafe {
        let context_pointer = Arc::into_raw(Arc::clone(&context)) as *mut c_void;
        let opaque = dsh_keyboard_install_hooks(
            platform.inner(),
            keyboard_input,
            keyboard_blurred,
            context_pointer,
        );
        if opaque.is_null() {
            drop(Arc::from_raw(context_pointer as *const HookContext));
            Err("AppKit did not install the webview keyboard monitor".to_string())
        } else {
            Ok(Hook(Arc::new(HookState {
                opaque: opaque as usize,
                context: context_pointer as usize,
                removed: AtomicBool::new(false),
            })))
        }
    })
    .await?;
    Ok(install)
}

/** Remove the local monitor and its observers before its WKWebView closes. */
pub(crate) async fn remove(view: &Webview, hook: Hook) -> Result<(), String> {
    with_platform(view, move |_| {
        hook.0.remove();
        Ok(())
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

unsafe extern "C" fn keyboard_input(
    context: *mut c_void,
    key_code: u16,
    characters: *const c_char,
    event_kind: u8,
    modifiers: u8,
    repeat: bool,
    composing: bool,
) -> bool {
    catch_unwind(AssertUnwindSafe(|| {
        let Some(context) = (unsafe { (context as *const HookContext).as_ref() }) else {
            return false;
        };
        if event_kind == EVENT_MODIFIERS {
            super::reset(&context.app, &context.view_label);
            return false;
        }

        let characters = if characters.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(characters) }
                .to_string_lossy()
                .into_owned()
        };
        let code = keycodes::code_for_keycode(key_code)
            .or_else(|| keycodes::code_for_function_character(&characters));
        let Some(code) = code else {
            return false;
        };
        let down = match event_kind {
            EVENT_DOWN => true,
            EVENT_UP => false,
            _ => return false,
        };
        let key = keycodes::key_for_event(code, &characters);
        super::handle(
            &context.app,
            &context.view_label,
            KeyInput {
                code: code.to_string(),
                composing: composing || key == "Dead",
                key,
                control: modifiers & 0b0001 != 0,
                alt: modifiers & 0b0010 != 0,
                shift: modifiers & 0b0100 != 0,
                meta: modifiers & 0b1000 != 0,
                repeat,
                down,
            },
        )
    }))
    .unwrap_or(false)
}

unsafe extern "C" fn keyboard_blurred(context: *mut c_void) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let Some(context) = (unsafe { (context as *const HookContext).as_ref() }) else {
            return;
        };
        super::reset(&context.app, &context.view_label);
    }));
}
