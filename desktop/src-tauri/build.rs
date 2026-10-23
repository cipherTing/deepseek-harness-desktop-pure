use std::{env, path::PathBuf, process::Command};

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_browser_macos();
    }

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_open_external_url",
            "desktop_open_file",
            "desktop_file_handlers",
            "desktop_open_file_with",
            "desktop_copy_text",
            "desktop_reveal_file",
            "desktop_save_file_as",
            "desktop_save_session",
            "desktop_device_info",
            "desktop_log",
            "desktop_credentials_present",
            "desktop_browser_acquire",
            "desktop_browser_bounds",
            "desktop_browser_visible",
            "desktop_browser_navigate",
            "desktop_browser_command",
            "desktop_browser_state",
            "desktop_browser_release",
            "desktop_cli_status",
            "desktop_cli_install",
            "desktop_cli_remove",
            "desktop_keybindings_read",
            "desktop_keybindings_write",
            "desktop_keyboard_configure",
            "desktop_release_state",
            "desktop_release_check",
            "desktop_mandatory_state",
            "desktop_mandatory_dismiss",
        ]),
    ))
    .expect("failed to generate Tauri Desktop permissions");
}

fn build_browser_macos() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let source = manifest_dir.join("src/browser_window_macos.m");
    let object = out_dir.join("browser_window_macos.o");
    let archive = out_dir.join("libbrowser_window_macos.a");
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        target => panic!("unsupported macOS Desktop architecture {target:?}"),
    };

    let status = Command::new("xcrun")
        .args([
            "--sdk",
            "macosx",
            "clang",
            "-fobjc-arc",
            "-arch",
            arch,
            "-mmacosx-version-min=13.0",
            "-c",
        ])
        .arg(&source)
        .arg("-o")
        .arg(&object)
        .status()
        .expect("failed to start the macOS SDK clang compiler");
    assert!(status.success(), "failed to compile Browser WebKit hooks");

    let status = Command::new("ar")
        .arg("crs")
        .arg(&archive)
        .arg(&object)
        .status()
        .expect("failed to start ar for Browser WebKit hooks");
    assert!(status.success(), "failed to archive Browser WebKit hooks");

    println!("cargo:rerun-if-changed={}", source.display());
    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=browser_window_macos");
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rustc-link-lib=framework=WebKit");
}
