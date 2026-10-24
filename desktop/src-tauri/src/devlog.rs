//! Append-only diagnostic log.
//!
//! A packaged Desktop starts from Finder, where `stderr` goes nowhere: a panic,
//! a failed window creation or an unexpected exit leaves no trace to read after
//! the fact. This module keeps a bounded human-readable log so a report of "it
//! quit" can be traced to the call that caused it.
//!
//! The log is a development aid with a fixed location per platform
//! (`app_log_dir`, i.e. `~/Library/Logs/<identifier>/` on macOS), and rotates
//! rather than clearing it so recent crashes survive the relaunch that follows.

use std::{
    backtrace::Backtrace,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager};

/** File name inside the platform log directory. */
const LOG_FILE: &str = "desktop.log";

/** Maximum size of each retained diagnostic log. */
const MAX_LOG_BYTES: u64 = 1024 * 1024;

/** Maximum size of one diagnostic record. */
const MAX_LINE_BYTES: usize = 4096;

/** Resolved log path; unset until {@link init} runs. */
static PATH: OnceLock<PathBuf> = OnceLock::new();

/** Serialize appends and log rotation across native and WebView threads. */
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/**
 * Resolve the log file and start it with one line per launch.
 *
 * Called once the application paths exist, which is also before any window the
 * page can reach is created.
 * @param app - application handle owning the platform log directory.
 */
pub(crate) fn init(app: &AppHandle) {
    let Ok(directory) = app.path().app_log_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&directory);
    let _ = PATH.set(directory.join(LOG_FILE));
    write(format_args!(
        "--- launch: version {}",
        crate::update::installed_version(app)
    ));
}

/**
 * Append one line, prefixed with seconds since the epoch.
 *
 * Every failure to write is swallowed: diagnostics must never become the reason
 * a window does not open.
 * @param message - one line of diagnostic text.
 */
pub(crate) fn write(message: std::fmt::Arguments<'_>) {
    let Some(path) = PATH.get() else { return };
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let line = bounded_line(&message.to_string());
    if fs::metadata(path).is_ok_and(|metadata| metadata.len() >= MAX_LOG_BYTES) {
        let previous = path.with_file_name("desktop.previous.log");
        if fs::remove_file(&previous).is_err() && previous.exists() {
            return;
        }
        if fs::rename(path, previous).is_err() {
            return;
        }
    }
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs_f64())
        .unwrap_or_default();
    let _ = writeln!(file, "[{stamp:.3}] {line}");
}

/** Keep records single-line and bounded before writing them to disk. */
fn bounded_line(message: &str) -> String {
    let mut line = String::with_capacity(MAX_LINE_BYTES);
    let mut truncated = false;
    for character in message.chars() {
        let character = if character.is_control() {
            ' '
        } else {
            character
        };
        if line.len() + character.len_utf8() > MAX_LINE_BYTES - 3 {
            truncated = true;
            break;
        }
        line.push(character);
    }
    if truncated {
        line.push_str("...");
    }
    line
}

/**
 * Record a panic and its Rust backtrace before the default hook runs.
 *
 * A panic crossing a Cocoa callback aborts the process, so the callback frame
 * is needed to identify which native event caused it.
 */
pub(crate) fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        write(format_args!("panic: {info}"));
        write(format_args!(
            "panic backtrace: {}",
            Backtrace::force_capture()
        ));
        previous(info);
    }));
}

/**
 * Append one page-reported line, for errors the WebView sees and Rust does not.
 * @param app - application handle owning the log path.
 * @param message - text the page formatted.
 */
#[tauri::command]
pub(crate) fn desktop_log(message: String) {
    // The source label distinguishes page reports from native diagnostics.
    write(format_args!("[page] {message}"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_records_are_single_line_and_bounded() {
        let line = bounded_line(&format!("first\n{}last", "x".repeat(MAX_LINE_BYTES)));

        assert!(!line.contains('\n'));
        assert!(line.len() <= MAX_LINE_BYTES);
        assert!(line.ends_with("..."));
    }
}
