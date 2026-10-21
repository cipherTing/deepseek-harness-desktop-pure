//! The `dsh` command in the user's PATH.
//!
//! A packaged installation has no `dsh` on PATH: the CLI lives inside the
//! application bundle and runs under the bundled Node, so a terminal cannot find
//! it. This module installs one launcher that names those packaged paths, keeps
//! a receipt of what it wrote, and removes exactly that on request.

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/** Receipt name beside the other Desktop configuration. */
const RECEIPT_FILE: &str = "dsh-command.json";
/** Launcher file name; Windows needs an extension to be executable. */
const LAUNCHER: &str = "dsh";

/** What this installation wrote, so removal touches nothing else. */
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    /** Absolute launcher path that was created. */
    path: String,
    /** Launcher bytes, so a file the user replaced is left alone. */
    digest: String,
    /** Installed Desktop version at the time, for the About row. */
    version: String,
}

/** Resolved paths a launcher needs; every one is inside the installation. */
struct LauncherPlan {
    path: PathBuf,
    node: PathBuf,
    entry: PathBuf,
    version: String,
}

/**
 * Resolve the bundled Node and CLI entry points.
 * @param app - application handle owning the resource and executable directories.
 * @returns the plan, or why this installation cannot offer a launcher.
 */
fn plan(app: &AppHandle) -> Result<LauncherPlan, String> {
    let resources = app.path().resource_dir().map_err(|error| error.to_string())?;
    let entry = resources.join("rt/lib/cli.mjs");
    if !entry.is_file() {
        return Err("The packaged DeepDive CLI entry is missing from this installation".into());
    }
    // `process.execPath` for the shell is the application binary; the bundled
    // Node sits beside it, which is where Tauri's `externalBin` places it.
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = executable
        .parent()
        .ok_or_else(|| "The DeepDive executable has no parent directory".to_string())?;
    let node = directory.join(if cfg!(windows) { "node.exe" } else { "node" });
    if !node.is_file() {
        return Err("The bundled Node runtime is missing from this installation".into());
    }
    let version = crate::update::installed_version(app);
    Ok(LauncherPlan {
        path: launcher_path()?,
        node,
        entry,
        version,
    })
}

/**
 * Resolve where the launcher belongs.
 *
 * macOS and Linux use `~/.local/bin`, the per-user directory distributions
 * already put on PATH. Windows has no such convention for CLI tools, so the
 * launcher goes under the application's local data directory and its directory
 * is appended to the user PATH by {@link add_to_path}.
 * @returns the absolute launcher path.
 */
fn launcher_path() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let local = std::env::var_os("LOCALAPPDATA")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| "LOCALAPPDATA is not set".to_string())?;
        return Ok(local
            .join("DeepDive")
            .join("bin")
            .join(format!("{LAUNCHER}.cmd")));
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| "HOME is not set".to_string())?;
        Ok(home.join(".local").join("bin").join(LAUNCHER))
    }
}

/** @returns the launcher bytes for the current platform. */
fn launcher_body(plan: &LauncherPlan) -> String {
    let node = shell_quote(&plan.node.to_string_lossy());
    let entry = shell_quote(&plan.entry.to_string_lossy());
    if cfg!(windows) {
        // `dsh.cmd` forwards its arguments and the caller's exit code, so a
        // pipeline or a script sees the real result.
        return format!(
            "@echo off\r\nsetlocal\r\n\"{}\" \"{}\" %*\r\nexit /b %ERRORLEVEL%\r\n",
            plan.node.display(),
            plan.entry.display(),
        );
    }
    format!(
        "#!/bin/sh\n\
         # Installed by DeepDive {}\n\
         # Removes with the Desktop app's \"Remove dsh command\" action.\n\
         exec {} {} \"$@\"\n",
        plan.version, node, entry,
    )
}

/** Quote one argument for `sh`, leaving ordinary paths unquoted. */
fn shell_quote(value: &str) -> String {
    if value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "/._-+".contains(character))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', r"'\''"))
}

/** @returns the hexadecimal SHA-256 of a byte slice. */
fn digest(bytes: &[u8]) -> String {
    // A small, self-contained SHA-256: the launcher identity check must not add
    // a dependency to a shell that already ships a Node runtime.
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut state: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let mut message = bytes.to_vec();
    let bit_length = (bytes.len() as u64) * 8;
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_length.to_be_bytes());
    for block in message.chunks_exact(64) {
        let mut schedule = [0_u32; 64];
        for (index, word) in block.chunks_exact(4).enumerate() {
            schedule[index] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for index in 16..64 {
            let s0 = schedule[index - 15].rotate_right(7)
                ^ schedule[index - 15].rotate_right(18)
                ^ (schedule[index - 15] >> 3);
            let s1 = schedule[index - 2].rotate_right(17)
                ^ schedule[index - 2].rotate_right(19)
                ^ (schedule[index - 2] >> 10);
            schedule[index] = schedule[index - 16]
                .wrapping_add(s0)
                .wrapping_add(schedule[index - 7])
                .wrapping_add(s1);
        }
        let mut working = state;
        for index in 0..64 {
            let s1 = working[4].rotate_right(6) ^ working[4].rotate_right(11) ^ working[4].rotate_right(25);
            let choice = (working[4] & working[5]) ^ (!working[4] & working[6]);
            let temp1 = working[7]
                .wrapping_add(s1)
                .wrapping_add(choice)
                .wrapping_add(K[index])
                .wrapping_add(schedule[index]);
            let s0 = working[0].rotate_right(2) ^ working[0].rotate_right(13) ^ working[0].rotate_right(22);
            let majority = (working[0] & working[1]) ^ (working[0] & working[2]) ^ (working[1] & working[2]);
            let temp2 = s0.wrapping_add(majority);
            working[7] = working[6];
            working[6] = working[5];
            working[5] = working[4];
            working[4] = working[3].wrapping_add(temp1);
            working[3] = working[2];
            working[2] = working[1];
            working[1] = working[0];
            working[0] = temp1.wrapping_add(temp2);
        }
        for index in 0..8 {
            state[index] = state[index].wrapping_add(working[index]);
        }
    }
    state.iter().map(|word| format!("{word:08x}")).collect()
}

/** @returns the receipt path in the Desktop configuration directory. */
fn receipt_path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join(RECEIPT_FILE))
}

/** @returns the receipt this installation wrote, if any. */
fn read_receipt(app: &AppHandle) -> Option<Receipt> {
    let raw = fs::read_to_string(receipt_path(app)?).ok()?;
    serde_json::from_str(&raw).ok()
}

/** Persist the receipt; a failure leaves an unreceipted launcher behind. */
fn write_receipt(app: &AppHandle, receipt: &Receipt) -> Result<(), String> {
    let path = receipt_path(app).ok_or_else(|| "Desktop configuration directory is unavailable".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_string(receipt).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

/**
 * Report what the `dsh` command looks like on this machine.
 * @param app - application handle owning the configuration and resources.
 * @returns the install state the About row renders.
 */
#[tauri::command]
pub(crate) async fn desktop_cli_status(app: tauri::AppHandle) -> Result<CliStatus, String> {
    let target = launcher_path()?;
    let receipt = read_receipt(&app);
    let present = target.is_file();
    // "Ours" means the file still carries the bytes this installation wrote; a
    // launcher the user edited or replaced is theirs to keep.
    let ours = present
        && receipt
            .as_ref()
            .is_some_and(|receipt| digest(&fs::read(&target).unwrap_or_default()) == receipt.digest);
    Ok(CliStatus {
        path: target.to_string_lossy().to_string(),
        installed: ours,
        present,
        on_path: on_path(&target),
        version: receipt.map(|receipt| receipt.version),
    })
}

/** @returns whether the launcher's directory is already on PATH. */
fn on_path(launcher: &Path) -> bool {
    let Some(directory) = launcher.parent() else { return false };
    std::env::var_os("PATH").is_some_and(|value| {
        std::env::split_paths(&value).any(|entry| entry == directory)
    })
}

/**
 * Write the `dsh` launcher and record what was written.
 *
 * An existing file that this installation did not write is moved aside instead
 * of replaced, and the move is reverted if the write fails, so a failed install
 * cannot destroy a launcher the user already had.
 * @param app - application handle owning the configuration and resources.
 * @returns the status after installing.
 */
#[tauri::command]
pub(crate) async fn desktop_cli_install(app: tauri::AppHandle) -> Result<CliStatus, String> {
    let plan = plan(&app)?;
    let body = launcher_body(&plan);
    if let Some(parent) = plan.path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let backup = plan.path.with_extension("deepdive-backup");
    let displaced = if plan.path.exists() && !existing_is_ours(&app, &plan.path) {
        fs::rename(&plan.path, &backup).map_err(|error| error.to_string())?;
        true
    } else {
        false
    };
    let written = fs::write(&plan.path, body.as_bytes()).and_then(|()| set_executable(&plan.path));
    if let Err(error) = written {
        if displaced {
            let _ = fs::rename(&backup, &plan.path);
        }
        return Err(error.to_string());
    }
    write_receipt(
        &app,
        &Receipt {
            path: plan.path.to_string_lossy().to_string(),
            digest: digest(body.as_bytes()),
            version: plan.version,
        },
    )?;
    #[cfg(windows)]
    add_to_path(&plan.path)?;
    desktop_cli_status(app).await
}

/** @returns whether the existing file matches the receipt this installation wrote. */
fn existing_is_ours(app: &AppHandle, path: &Path) -> bool {
    read_receipt(app).is_some_and(|receipt| {
        receipt.path == path.to_string_lossy() && digest(&fs::read(path).unwrap_or_default()) == receipt.digest
    })
}

/** Mark the launcher executable on every Unix target. */
fn set_executable(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)?.permissions();
        permissions.set_mode(0o755);
        return fs::set_permissions(path, permissions);
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

#[cfg(windows)]
/** Append the launcher's directory to the user PATH, once. */
fn add_to_path(launcher: &Path) -> Result<(), String> {
    let Some(directory) = launcher.parent() else { return Ok(()) };
    let directory = directory.to_string_lossy();
    let current = std::env::var("PATH").unwrap_or_default();
    if std::env::split_paths(&current).any(|entry| entry.to_string_lossy() == directory) {
        return Ok(());
    }
    // The user-scoped registry value is what a new terminal inherits; the
    // machine value would need elevation and would change other accounts.
    let status = std::process::Command::new("setx")
        .arg("PATH")
        .arg(format!("{current};{directory}"))
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Updating the user PATH failed".into())
    }
}

/**
 * Remove the launcher this installation wrote.
 *
 * A file whose bytes no longer match the receipt is left in place: the user (or
 * an installer) replaced it, and deleting it would discard their choice.
 * @param app - application handle owning the configuration and resources.
 * @returns the status after removal.
 */
#[tauri::command]
pub(crate) async fn desktop_cli_remove(app: tauri::AppHandle) -> Result<CliStatus, String> {
    let target = launcher_path()?;
    if existing_is_ours(&app, &target) {
        fs::remove_file(&target).map_err(|error| error.to_string())?;
        // Restoring a launcher this installation displaced keeps the machine as
        // it was before `install`.
        let backup = target.with_extension("deepdive-backup");
        if backup.is_file() {
            let _ = fs::rename(&backup, &target);
        }
    }
    if let Some(path) = receipt_path(&app) {
        let _ = fs::remove_file(path);
    }
    desktop_cli_status(app).await
}

/** Install state of the `dsh` command. */
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CliStatus {
    /** Absolute launcher path this installation owns or would write. */
    path: String,
    /** Whether the file at {@link path} is the one this installation wrote. */
    installed: bool,
    /** Whether any file already occupies {@link path}. */
    present: bool,
    /** Whether the launcher's directory is on this process's PATH. */
    on_path: bool,
    /** Desktop version that wrote the launcher. */
    version: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_launcher_names_the_packaged_node_and_cli() {
        // The paths have to be platform-shaped: the launcher body embeds them
        // verbatim, and a `.cmd` file only ever names the packaged `node.exe`.
        let (node, entry) = if cfg!(windows) {
            (
                PathBuf::from(r"C:\Program Files\DeepDive\node.exe"),
                PathBuf::from(r"C:\Program Files\DeepDive\rt\lib\cli.mjs"),
            )
        } else {
            (
                PathBuf::from("/Applications/DeepDive.app/Contents/MacOS/node"),
                PathBuf::from("/Applications/DeepDive.app/Contents/Resources/rt/lib/cli.mjs"),
            )
        };
        let plan = LauncherPlan {
            path: PathBuf::from("launcher"),
            node: node.clone(),
            entry: entry.clone(),
            version: "0.2.0".into(),
        };
        let body = launcher_body(&plan);
        assert!(body.contains(&node.to_string_lossy().into_owned()));
        assert!(body.contains(&entry.to_string_lossy().into_owned()));
        if cfg!(windows) {
            assert!(body.contains("%*"));
            assert!(body.contains("exit /b %ERRORLEVEL%"));
        } else {
            assert!(body.starts_with("#!/bin/sh\n"));
            assert!(body.contains("exec"));
            assert!(body.contains("\"$@\""));
            assert!(body.contains("0.2.0"));
        }
    }

    #[test]
    fn a_path_with_spaces_survives_shell_quoting() {
        assert_eq!(shell_quote("/plain/path"), "/plain/path");
        assert_eq!(shell_quote("/with space/node"), "'/with space/node'");
        assert_eq!(shell_quote("/with'quote/node"), r#"'/with'\''quote/node'"#);
    }

    #[test]
    fn the_digest_matches_published_sha256_vectors() {
        assert_eq!(
            digest(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        );
        assert_eq!(
            digest(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
        // Longer than one block, so the length padding path is covered.
        assert_eq!(
            digest(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
        );
        assert_ne!(digest(b"one"), digest(b"two"));
    }
}
