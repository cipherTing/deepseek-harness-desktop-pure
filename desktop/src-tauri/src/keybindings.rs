//! Device-local keyboard preferences.
//!
//! The shared `shortcuts` client plugin keeps one validated document per
//! device, and the Electron carrier stores it as a file the renderer never
//! names. This module is the same storage half: the page hands over complete
//! documents and reads them back, so path selection, atomic replacement and the
//! record body all stay outside the WebView.

use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

/** Preference file beside the other Desktop configuration. */
const KEYBINDINGS_FILE: &str = "keybindings.json";

/**
 * Resolve the preference path.
 * @param app - application handle owning the configuration directory.
 * @returns the document path, creating the directory on first use.
 */
fn document_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(KEYBINDINGS_FILE))
}

/**
 * Read the stored document.
 * @param app - application handle owning the configuration directory.
 * @returns the document text, or `None` while the user has never edited it.
 */
#[tauri::command]
pub(crate) fn desktop_keybindings_read(app: AppHandle) -> Result<Option<String>, String> {
    let path = document_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(raw) => Ok(Some(raw)),
        // A missing file is the normal first run, not a failure: the client
        // renders its defaults from `null` and writes on the first edit.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/**
 * Replace the stored document.
 *
 * The write goes through a sibling temporary file, so a crash mid-write cannot
 * leave a truncated document that the next launch would read as corrupt.
 * @param app - application handle owning the configuration directory.
 * @param document - complete document text produced by the client's validator.
 */
#[tauri::command]
pub(crate) fn desktop_keybindings_write(app: AppHandle, document: String) -> Result<(), String> {
    let path = document_path(&app)?;
    let temporary = path.with_extension("json.next");
    fs::write(&temporary, document.as_bytes()).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_document_lives_beside_the_other_desktop_configuration() {
        assert_eq!(KEYBINDINGS_FILE, "keybindings.json");
        assert!(!KEYBINDINGS_FILE.contains('/'));
    }

    #[test]
    fn a_temporary_sibling_never_collides_with_the_document() {
        let path = PathBuf::from("/tmp/keybindings.json");
        let temporary = path.with_extension("json.next");
        assert_eq!(temporary, PathBuf::from("/tmp/keybindings.json.next"));
        assert_ne!(temporary, path);
    }
}
