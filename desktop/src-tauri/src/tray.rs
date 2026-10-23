//! Background residency through the system tray.
//!
//! A Desktop window close is not always a quit: the sidecar keeps serving, the
//! Session keeps running, and the user expects to come back to the same window.
//! This module owns that decision — the tray icon, the show/quit menu, and the
//! close interception — so the main window only has to forward the event.

use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_dialog::DialogExt;

/** Tray identity; a fixed id keeps one icon across reconnects on Windows. */
const TRAY_ID: &str = "deepdive-tray";
/** Menu ids; they are matched by exact string in the tray menu handler. */
const MENU_SHOW: &str = "deepdive-tray-show";
const MENU_QUIT: &str = "deepdive-tray-quit";
/** Remembered close answer, stored beside the other Desktop configuration. */
const PREFERENCE_FILE: &str = "tray.json";

/** The remembered answer to what a window close means. */
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClosePreference {
    /** `true` keeps the process running in the tray; `false` quits. */
    close_to_tray: bool,
}

/** @returns the preference file path in the Desktop configuration directory. */
fn preference_path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join(PREFERENCE_FILE))
}

/**
 * Read the remembered close answer.
 * @param app - application handle owning the configuration directory.
 * @returns `true` or `false` once the user has answered, `None` before that.
 */
pub(crate) fn close_preference(app: &AppHandle) -> Option<bool> {
    let path = preference_path(app)?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<ClosePreference>(&raw)
        .ok()
        .map(|preference| preference.close_to_tray)
}

/**
 * Store the close answer so later closes need no confirmation.
 * @param app - application handle owning the configuration directory.
 * @param close_to_tray - whether closing the window keeps the process alive.
 */
fn remember(app: &AppHandle, close_to_tray: bool) {
    let Some(path) = preference_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let Ok(raw) = serde_json::to_string(&ClosePreference { close_to_tray }) else {
        return;
    };
    let _ = fs::write(path, raw);
}

/** @returns the main window while it exists. */
fn main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main")
}

/**
 * Bring the main window back from the tray, minimized or hidden.
 * @param app - application handle owning the window.
 */
pub(crate) fn reveal(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/** Hide the main window without touching the sidecar or the Sessions. */
fn hide(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };
    // A hidden fullscreen window keeps its Space on macOS and its exclusive
    // mode on Windows, so the window has to leave fullscreen before it goes.
    if window.is_fullscreen().unwrap_or(false) {
        let _ = window.set_fullscreen(false);
    }
    let _ = window.hide();
}

/**
 * Decide what a main-window close means.
 *
 * The first close asks once, because a fork with no updater and no dock-only
 * target has no other place to explain residency; the answer is remembered, so
 * the dialog never becomes a per-close annoyance.
 * @param app - application handle owning the window and the dialog.
 */
pub(crate) fn handle_close_request(app: &AppHandle) {
    match close_preference(app) {
        Some(true) => hide(app),
        Some(false) => crate::begin_graceful_exit(app, 0),
        None => ask(app),
    }
}

/** Ask whether this close means "stay in the tray" or "quit", then apply it. */
fn ask(app: &AppHandle) {
    let handle = app.clone();
    app.dialog()
        .message(
            "DeepDive keeps running in the background after the window closes, so the \
             Sidecar and any running Session survive. Use the tray icon to bring the \
             window back.",
        )
        .title("DeepDive")
        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
            "Keep Running".into(),
            "Quit".into(),
        ))
        .show_with_result(move |result| {
            let stay = matches!(
                result,
                tauri_plugin_dialog::MessageDialogResult::Ok
                    | tauri_plugin_dialog::MessageDialogResult::Yes
            );
            remember(&handle, stay);
            if stay {
                hide(&handle);
            } else {
                crate::begin_graceful_exit(&handle, 0);
            }
        });
}

/**
 * Create the tray icon and its menu.
 *
 * macOS and Windows reopen the window from a left click.
 * @param app - application handle supplying the menu manager and default icon.
 * @returns the build result; a missing tray is not fatal to startup.
 */
pub(crate) fn install(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, MENU_SHOW, "Open DeepDive", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit DeepDive", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit])?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("DeepDive")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW => reveal(app),
            MENU_QUIT => crate::begin_graceful_exit(app, 0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stored_answer_round_trips_through_the_preference_document() {
        for expected in [true, false] {
            let raw = serde_json::to_string(&ClosePreference {
                close_to_tray: expected,
            })
            .unwrap();
            assert_eq!(raw, format!("{{\"closeToTray\":{expected}}}"));
            let parsed: ClosePreference = serde_json::from_str(&raw).unwrap();
            assert_eq!(parsed.close_to_tray, expected);
        }
    }

    #[test]
    fn an_unreadable_document_reads_as_no_remembered_answer() {
        // A corrupt file must re-ask instead of silently choosing residency or
        // quitting on behalf of a user who never answered.
        assert!(serde_json::from_str::<ClosePreference>("").is_err());
        assert!(serde_json::from_str::<ClosePreference>("{\"closeToTray\":\"yes\"}").is_err());
    }
}
