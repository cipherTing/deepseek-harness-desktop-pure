use std::sync::{
    atomic::{AtomicI32, Ordering},
    Arc,
};

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/** Run the real Wry/WebView2 workspace-storage lifecycle smoke test. */
pub fn run() -> i32 {
    let exit_code = Arc::new(AtomicI32::new(1));
    let setup_exit_code = exit_code.clone();
    let app = match tauri::Builder::default()
        .setup(move |app| {
            app.manage(crate::DesktopState::default());
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("about:blank".parse().expect("valid test URL")),
            )
            .title("DeepDive WebView2 lifecycle test")
            .inner_size(1.0, 1.0)
            .visible(false)
            .build()?;

            let app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result = crate::browser_window::run_webview2_lifecycle_test(&app).await;
                if let Err(error) = &result {
                    eprintln!("WebView2 lifecycle test failed: {error}");
                }
                let code = if result.is_ok() { 0 } else { 1 };
                setup_exit_code.store(code, Ordering::SeqCst);
                app.exit(code);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(error) => {
            eprintln!("WebView2 lifecycle test app failed to build: {error}");
            return 1;
        }
    };

    app.run(|_, _| {});
    exit_code.load(Ordering::SeqCst)
}
