//! Native discovery and opening through installed applications.

use std::{collections::HashSet, path::Path};

#[cfg(target_os = "windows")]
use std::path::PathBuf;

#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStringExt;

use serde::Serialize;

/** A native application selected from a freshly resolved system list. */
#[derive(Clone)]
pub(crate) struct FileHandler {
    id: String,
    label: String,
    launcher: String,
}

impl FileHandler {
    /** Return the opaque ID sent back by the WebView. */
    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    /** Open through Tauri, or through GIO with the Linux desktop entry's arguments. */
    pub(crate) fn open(&self, path: &Path) -> Result<(), String> {
        #[cfg(target_os = "linux")]
        {
            use gio::prelude::AppInfoExt;
            let application = gio::DesktopAppInfo::new(&self.launcher)
                .ok_or_else(|| "Desktop file handler is no longer available".to_string())?;
            application
                .launch(&[gio::File::for_path(path)], None::<&gio::AppLaunchContext>)
                .map_err(|error| error.to_string())
        }
        #[cfg(not(target_os = "linux"))]
        tauri_plugin_opener::open_path(path, Some(&self.launcher))
            .map_err(|error| error.to_string())
    }

    fn summary(&self) -> FileHandlerSummary {
        FileHandlerSummary {
            id: self.id.clone(),
            label: self.label.clone(),
        }
    }
}

/** The file-opening choices exposed through the narrow Desktop bridge. */
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileHandlerMenu {
    primary: Option<FileHandlerSummary>,
    handlers: Vec<FileHandlerSummary>,
}

/** A display-safe projection of one native file handler. */
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileHandlerSummary {
    id: String,
    label: String,
}

struct ResolvedHandlers {
    primary: Option<FileHandler>,
    handlers: Vec<FileHandler>,
}

/** Discover the current system choices for a file without persisting any state. */
pub(crate) fn menu_for(path: &Path) -> FileHandlerMenu {
    let handlers = resolved_handlers(path);
    let primary_id = handlers.primary.as_ref().map(|handler| handler.id());
    FileHandlerMenu {
        primary: handlers.primary.as_ref().map(FileHandler::summary),
        handlers: handlers
            .handlers
            .iter()
            .filter(|handler| Some(handler.id()) != primary_id)
            .map(FileHandler::summary)
            .collect(),
    }
}

/** Resolve a handler ID again immediately before launching it. */
pub(crate) fn find_for(path: &Path, id: &str) -> Option<FileHandler> {
    let handlers = resolved_handlers(path);
    handlers
        .primary
        .into_iter()
        .chain(handlers.handlers)
        .find(|handler| handler.id == id)
}

fn resolved_handlers(path: &Path) -> ResolvedHandlers {
    let mut handlers = platform_handlers(path);
    let mut seen = HashSet::new();
    if let Some(primary) = &handlers.primary {
        seen.insert(primary.id.clone());
    }
    handlers
        .handlers
        .retain(|handler| seen.insert(handler.id.clone()));
    handlers
}

#[cfg(target_os = "macos")]
fn platform_handlers(path: &Path) -> ResolvedHandlers {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSString, NSURL};

    let Some(file_url) = NSURL::from_file_path(path) else {
        return ResolvedHandlers {
            primary: None,
            handlers: Vec::new(),
        };
    };
    let workspace = NSWorkspace::sharedWorkspace();
    let primary = workspace
        .URLForApplicationToOpenURL(&file_url)
        .and_then(|url| macos_handler(&url, None));
    let mut handlers = workspace
        .URLsForApplicationsToOpenURL(&file_url)
        .iter()
        .filter_map(|url| macos_handler(&url, None))
        .collect::<Vec<_>>();

    for (bundle_id, label) in MACOS_DEVELOPER_APPLICATIONS {
        let identifier = NSString::from_str(bundle_id);
        if let Some(url) = workspace.URLForApplicationWithBundleIdentifier(&identifier) {
            if let Some(handler) = macos_handler(&url, Some(label)) {
                handlers.push(handler);
            }
        }
    }

    ResolvedHandlers { primary, handlers }
}

#[cfg(target_os = "macos")]
const MACOS_DEVELOPER_APPLICATIONS: &[(&str, &str)] = &[
    ("com.microsoft.VSCode", "Visual Studio Code"),
    ("com.todesktop.230313mzl4w4u92", "Cursor"),
    ("com.apple.dt.Xcode", "Xcode"),
    ("com.google.android.studio", "Android Studio"),
    ("com.jetbrains.intellij", "IntelliJ IDEA"),
];

#[cfg(target_os = "macos")]
fn macos_handler(url: &objc2_foundation::NSURL, label: Option<&str>) -> Option<FileHandler> {
    let application = url.to_file_path()?;
    let launcher = application.file_stem()?.to_string_lossy().into_owned();
    if launcher.is_empty() {
        return None;
    }
    let application_path = application.to_string_lossy().into_owned();
    Some(FileHandler {
        id: format!("macos:{application_path}"),
        label: label.unwrap_or(&launcher).to_owned(),
        launcher,
    })
}

#[cfg(target_os = "windows")]
fn platform_handlers(_path: &Path) -> ResolvedHandlers {
    let handlers = WINDOWS_DEVELOPER_APPLICATIONS
        .iter()
        .filter_map(windows_handler)
        .collect();
    ResolvedHandlers {
        primary: None,
        handlers,
    }
}

#[cfg(target_os = "windows")]
struct WindowsDeveloperApplication {
    id: &'static str,
    label: &'static str,
    executable: &'static str,
}

#[cfg(target_os = "windows")]
const WINDOWS_DEVELOPER_APPLICATIONS: &[WindowsDeveloperApplication] = &[
    WindowsDeveloperApplication {
        id: "visual-studio-code",
        label: "Visual Studio Code",
        executable: "Code.exe",
    },
    WindowsDeveloperApplication {
        id: "cursor",
        label: "Cursor",
        executable: "Cursor.exe",
    },
    WindowsDeveloperApplication {
        id: "android-studio",
        label: "Android Studio",
        executable: "studio64.exe",
    },
    WindowsDeveloperApplication {
        id: "intellij-idea",
        label: "IntelliJ IDEA",
        executable: "idea64.exe",
    },
];

#[cfg(target_os = "windows")]
const WINDOWS_VSCODE_PATHS: &[&str] = &[
    r"Programs\Microsoft VS Code\Code.exe",
    r"Microsoft VS Code\Code.exe",
];

#[cfg(target_os = "windows")]
const WINDOWS_CURSOR_PATHS: &[&str] = &[r"Programs\Cursor\Cursor.exe", r"Cursor\Cursor.exe"];

#[cfg(target_os = "windows")]
const WINDOWS_ANDROID_STUDIO_PATHS: &[&str] = &[
    r"Programs\Android Studio\bin\studio64.exe",
    r"Android\Android Studio\bin\studio64.exe",
];

#[cfg(target_os = "windows")]
const WINDOWS_INTELLIJ_IDEA_PATHS: &[&str] = &[r"JetBrains\IntelliJ IDEA\bin\idea64.exe"];

#[cfg(target_os = "windows")]
fn windows_handler(application: &WindowsDeveloperApplication) -> Option<FileHandler> {
    let executable = windows_application_path(application)?;
    let launcher = executable.to_string_lossy().into_owned();
    Some(FileHandler {
        id: format!("windows:{}:{launcher}", application.id),
        label: application.label.to_owned(),
        launcher,
    })
}

#[cfg(target_os = "windows")]
fn windows_application_path(application: &WindowsDeveloperApplication) -> Option<PathBuf> {
    windows_app_path_from_registry(application.executable)
        .or_else(|| windows_known_installation(application))
        .filter(|path| path.is_file())
}

#[cfg(target_os = "windows")]
fn windows_app_path_from_registry(executable: &str) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::ERROR_SUCCESS,
            System::Registry::{
                RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
            },
        },
    };

    let key = std::ffi::OsStr::new(&format!(
        r"Software\Microsoft\Windows\CurrentVersion\App Paths\{executable}"
    ))
    .encode_wide()
    .chain(Some(0))
    .collect::<Vec<_>>();

    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let mut byte_count = 0;
        let status = unsafe {
            RegGetValueW(
                root,
                PCWSTR(key.as_ptr()),
                PCWSTR::null(),
                RRF_RT_REG_SZ,
                None,
                None,
                Some(&mut byte_count),
            )
        };
        if status != ERROR_SUCCESS || byte_count < 2 {
            continue;
        }

        let mut value = vec![0u16; byte_count as usize / 2];
        let status = unsafe {
            RegGetValueW(
                root,
                PCWSTR(key.as_ptr()),
                PCWSTR::null(),
                RRF_RT_REG_SZ,
                None,
                Some(value.as_mut_ptr().cast()),
                Some(&mut byte_count),
            )
        };
        if status != ERROR_SUCCESS {
            continue;
        }
        if value.last() == Some(&0) {
            value.pop();
        }
        let path = PathBuf::from(std::ffi::OsString::from_wide(&value));
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn windows_known_installation(application: &WindowsDeveloperApplication) -> Option<PathBuf> {
    let roots = [
        "LOCALAPPDATA",
        "ProgramFiles",
        "ProgramW6432",
        "ProgramFiles(x86)",
    ]
    .into_iter()
    .filter_map(std::env::var_os)
    .map(PathBuf::from)
    .collect::<Vec<_>>();
    let suffixes = match application.id {
        "visual-studio-code" => WINDOWS_VSCODE_PATHS,
        "cursor" => WINDOWS_CURSOR_PATHS,
        "android-studio" => WINDOWS_ANDROID_STUDIO_PATHS,
        "intellij-idea" => WINDOWS_INTELLIJ_IDEA_PATHS,
        _ => return None,
    };
    roots
        .iter()
        .flat_map(|root| suffixes.iter().map(|suffix| root.join(suffix)))
        .find(|path| path.is_file())
}

#[cfg(target_os = "linux")]
fn platform_handlers(path: &Path) -> ResolvedHandlers {
    use gio::prelude::{AppInfoExt, FileExt};
    let content_type = gio::File::for_path(path)
        .query_info(
            "standard::content-type",
            gio::FileQueryInfoFlags::NONE,
            None::<&gio::Cancellable>,
        )
        .ok()
        .and_then(|info| info.content_type());
    let Some(content_type) = content_type else {
        return ResolvedHandlers {
            primary: None,
            handlers: Vec::new(),
        };
    };
    let primary = gio::AppInfo::default_for_type(&content_type, false)
        .and_then(|application| linux_handler(&application));
    let handlers = gio::AppInfo::all_for_type(&content_type)
        .iter()
        .filter(|application| application.should_show())
        .filter_map(linux_handler)
        .collect();
    ResolvedHandlers { primary, handlers }
}

#[cfg(target_os = "linux")]
fn linux_handler(application: &gio::AppInfo) -> Option<FileHandler> {
    use gio::prelude::AppInfoExt;
    let desktop_id = application.id()?.to_string();
    Some(FileHandler {
        id: format!("linux:{desktop_id}"),
        label: application.display_name().to_string(),
        launcher: desktop_id,
    })
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::{
        fs,
        os::unix::fs::PermissionsExt,
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn linux_handlers_preserve_desktop_arguments() {
        if let Some(root) = std::env::var_os("DSH_LINUX_HANDLER_FIXTURE") {
            let root = std::path::PathBuf::from(root);
            let path = root.join("note with spaces.txt");
            let menu = menu_for(&path);
            assert_eq!(menu.primary.unwrap().label, "Fixture Default");
            assert!(menu
                .handlers
                .iter()
                .any(|handler| handler.label == "Fixture Choice"));
            assert!(!menu
                .handlers
                .iter()
                .any(|handler| handler.label == "Fixture Hidden"));
            assert!(find_for(&path, "linux:/bin/sh").is_none());
            let handler = find_for(&path, "linux:fixture-choice.desktop").unwrap();
            handler.open(&path).unwrap();
            let output = root.join("arguments");
            let deadline = Instant::now() + Duration::from_secs(10);
            while !output.exists() {
                assert!(
                    Instant::now() < deadline,
                    "desktop application did not receive the file"
                );
                thread::sleep(Duration::from_millis(10));
            }
            assert_eq!(
                fs::read_to_string(output).unwrap(),
                format!("--fixture-mode\n{}\n", path.display())
            );
            return;
        }

        // GIO caches XDG application state, so each fixture gets its own process.
        let root = tempfile::tempdir().unwrap();
        let applications = root.path().join("data/applications");
        let configuration = root.path().join("config");
        fs::create_dir_all(&applications).unwrap();
        fs::create_dir_all(&configuration).unwrap();
        let helper = root.path().join("open-fixture");
        fs::write(&helper, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$DSH_HANDLER_OUTPUT.tmp\"\nmv \"$DSH_HANDLER_OUTPUT.tmp\" \"$DSH_HANDLER_OUTPUT\"\n").unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        for (id, label, hidden) in [
            ("default", "Fixture Default", false),
            ("choice", "Fixture Choice", false),
            ("hidden", "Fixture Hidden", true),
        ] {
            fs::write(applications.join(format!("fixture-{id}.desktop")), format!(
                "[Desktop Entry]\nType=Application\nName={label}\nExec=\"{}\" --fixture-mode %F\nMimeType=text/plain;\nNoDisplay={hidden}\nTerminal=false\n",
                helper.display(),
            )).unwrap();
        }
        fs::write(configuration.join("mimeapps.list"), "[Default Applications]\ntext/plain=fixture-default.desktop;\n[Added Associations]\ntext/plain=fixture-default.desktop;fixture-choice.desktop;fixture-hidden.desktop;\n").unwrap();
        fs::write(root.path().join("note with spaces.txt"), "fixture text\n").unwrap();
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "file_handlers::tests::linux_handlers_preserve_desktop_arguments",
                "--nocapture",
            ])
            .env("DSH_LINUX_HANDLER_FIXTURE", root.path())
            .env("DSH_HANDLER_OUTPUT", root.path().join("arguments"))
            .env("XDG_DATA_HOME", root.path().join("data"))
            .env("XDG_CONFIG_HOME", configuration)
            .env("XDG_CONFIG_DIRS", root.path().join("empty-config"))
            .env("XDG_CURRENT_DESKTOP", "DeepDiveFixture")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        let timed_out = loop {
            if child.try_wait().unwrap().is_some() {
                break false;
            }
            if Instant::now() >= deadline {
                // A concurrently exited child is still reaped by wait_with_output.
                let _termination = child.kill();
                break true;
            }
            thread::sleep(Duration::from_millis(10));
        };
        let output = child.wait_with_output().unwrap();
        assert!(
            !timed_out,
            "Linux desktop application fixture exceeded its deadline"
        );
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
