//! Mandatory-update enforcement.
//!
//! The release feed can raise a floor above the installed build, and the feed is
//! the only party that can declare this build unusable. The blocking window is
//! the carrier for that decision: it loads a bundled document rather than the
//! Harness surface, so it holds no page capability and the loopback host is not
//! needed to render it.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use crate::update::UpdateState;

/** Window label; the startup path reuses this window if it already exists. */
const LABEL: &str = "mandatory-update";
/** Remembered answer, beside the other Desktop configuration. */
const STATE_FILE: &str = "mandatory-update.json";

/**
 * The floor this build already acted on.
 *
 * An acknowledgement records the floor, not the release: raising the floor
 * again (a later `mandatoryMinVersion`) is a new decision and reopens the
 * window, while the same floor does not nag across restarts.
 */
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MandatoryState {
    /// Highest floor the user has seen and been blocked by.
    acknowledged: Option<String>,
}

/**
 * The single capability surface the blocking document may reach.
 *
 * `__TAURI_INTERNALS__` is always present in Tauri 2, and the document needs
 * exactly two calls; exposing them by name keeps the rest of that object out of
 * reach of the page.
 */
const BRIDGE_SCRIPT: &str = r#"
Object.defineProperty(window, 'dshMandatory', {
  configurable: true,
  value: Object.freeze({
    state: () => window.__TAURI_INTERNALS__.invoke('desktop_mandatory_state'),
    dismiss: (minimum, openPage) =>
      window.__TAURI_INTERNALS__.invoke('desktop_mandatory_dismiss', { minimum, openPage }),
  }),
});
"#;

/** Serializes window creation, so two polls cannot open two blockers. */
static OPENING: Mutex<()> = Mutex::new(());

/** @returns the remembered acknowledgement document. */
fn read_state(app: &AppHandle) -> MandatoryState {
    let Some(path) = app
        .path()
        .app_config_dir()
        .ok()
        .map(|root| root.join(STATE_FILE))
    else {
        return MandatoryState::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/** Persist the acknowledgement; a failure only costs one repeated window. */
fn write_state(app: &AppHandle, state: &MandatoryState) {
    let Some(path) = app
        .path()
        .app_config_dir()
        .ok()
        .map(|root| root.join(STATE_FILE))
    else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string(state) {
        let _ = std::fs::write(path, raw);
    }
}

/**
 * Block the application when the installed build is below the feed's floor.
 *
 * The comparison keeps the update module's parser: an unparseable floor must
 * never block an installation that would then have no way to learn otherwise.
 * @param app - application handle owning the main window.
 * @param minimum - floor text from the release feed.
 */
pub(crate) fn enforce(app: &AppHandle, minimum: &str) {
    let installed = crate::update::installed_version(app);
    let Some(ordering) = crate::update::compare_versions(&installed, minimum) else {
        return;
    };
    if ordering >= 0 {
        return;
    }
    if read_state(app).acknowledged.as_deref() == Some(minimum) {
        return;
    }
    let _guard = OPENING.lock().unwrap();
    if app.get_webview_window(LABEL).is_some() {
        return;
    }
    // The main window keeps serving, but it is hidden so the blocked document
    // is the only thing the user can act on.
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("mandatory.html".into()))
        .title("DeepDive needs an update")
        // The bundled document has no bundler and no import map; one script
        // object is the whole bridge it is allowed to use.
        .initialization_script(BRIDGE_SCRIPT)
        .inner_size(520.0, 420.0)
        .resizable(false)
        .minimizable(false)
        .build();
    match built {
        Ok(window) => {
            // Whichever way the blocker goes away, the main window comes back:
            // otherwise a closed blocker would leave a running app with no
            // visible window at all.
            let handle = app.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Destroyed = event {
                    if let Some(main) = handle.get_webview_window("main") {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                }
            });
        }
        Err(error) => {
            eprintln!("DeepDive mandatory-update window failed: {error}");
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
            }
        }
    }
}

/**
 * Record that the user saw the blocking window for this floor.
 * @param app - application handle owning the configuration directory.
 * @param minimum - floor the window reported.
 */
pub(crate) fn acknowledge(app: &AppHandle, minimum: &str) {
    write_state(
        app,
        &MandatoryState {
            acknowledged: Some(minimum.to_string()),
        },
    );
}

/**
 * Report the release facts the blocking document renders.
 *
 * The document is bundled, so it asks for its own content instead of receiving
 * a page capability: this command is reachable only from that window.
 * @param app - application handle owning the state.
 * @returns the floor and the release page a download starts from.
 */
#[tauri::command]
pub(crate) async fn desktop_mandatory_state(
    app: tauri::AppHandle,
) -> Result<MandatoryView, String> {
    let state = app.state::<crate::DesktopState>();
    let UpdateState {
        latest,
        notes,
        page,
        mandatory_minimum,
        ..
    } = state.updates.snapshot();
    Ok(MandatoryView {
        installed: crate::update::installed_version(&app).to_string(),
        latest,
        notes,
        page,
        minimum: mandatory_minimum,
    })
}

/**
 * Close the blocker, optionally after handing the release page to the browser.
 *
 * The document carries no capability to open a URL itself: the release page is
 * opened here, where the shell already owns external navigation, so one call
 * both opens the download and records that the user acted.
 * @param app - application handle owning both windows.
 * @param minimum - floor the window was opened for.
 * @param open_page - whether the release page should open in the system browser.
 */
#[tauri::command]
pub(crate) async fn desktop_mandatory_dismiss(
    app: tauri::AppHandle,
    minimum: String,
    open_page: bool,
) -> Result<(), String> {
    acknowledge(&app, &minimum);
    if open_page {
        let page = app.state::<crate::DesktopState>().updates.snapshot().page;
        if let Some(page) = page {
            app.opener()
                .open_url(page, None::<&str>)
                .map_err(|error| error.to_string())?;
        }
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(())
}

/** Release facts the blocking document renders. */
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MandatoryView {
    installed: String,
    latest: Option<String>,
    notes: Option<String>,
    page: Option<String>,
    minimum: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_acknowledgement_round_trips_as_camel_case() {
        let state = MandatoryState {
            acknowledged: Some("0.3.0".into()),
        };
        let raw = serde_json::to_string(&state).unwrap();
        assert_eq!(raw, "{\"acknowledged\":\"0.3.0\"}");
        assert_eq!(
            serde_json::from_str::<MandatoryState>(&raw)
                .unwrap()
                .acknowledged
                .as_deref(),
            Some("0.3.0"),
        );
    }

    #[test]
    fn an_unreadable_acknowledgement_document_blocks_again() {
        // Losing the file must not silently grant the update-free state; the
        // comparison and the window are both cheap, and the floor is the feed's.
        assert!(serde_json::from_str::<MandatoryState>("").is_err());
        assert!(serde_json::from_str::<MandatoryState>("{\"acknowledged\":3}").is_err());
    }
}
