fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_open_external_url",
            "desktop_open_file",
            "desktop_file_handlers",
            "desktop_open_file_with",
            "desktop_copy_text",
            "desktop_reveal_file",
            "desktop_save_file_as",
            "desktop_copy_file_contents",
            "desktop_save_session",
        ]),
    ))
    .expect("failed to generate Tauri Desktop permissions");
}
