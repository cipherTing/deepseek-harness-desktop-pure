use std::{ffi::OsString, path::PathBuf};

use tauri::{async_runtime::Receiver, AppHandle, Runtime};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tokio::sync::mpsc;

/// Events emitted by one owned Node sidecar generation.
#[derive(Debug)]
pub(crate) enum SidecarEvent {
    Stdout(Vec<u8>),
    Stderr(Vec<u8>),
    Error(String),
    Terminated(Option<i32>),
}

enum SidecarCommand {
    Write(Vec<u8>),
    Terminate,
    Exited,
}

/// Handle for the actor that owns the bundled Node sidecar.
pub(crate) struct SidecarProcess {
    commands: mpsc::UnboundedSender<SidecarCommand>,
}

impl SidecarProcess {
    /// Spawn the configured Tauri Node sidecar with raw protocol output.
    pub(crate) fn spawn<R: Runtime>(
        app: &AppHandle<R>,
        arguments: Vec<OsString>,
        cwd: PathBuf,
        events: mpsc::UnboundedSender<SidecarEvent>,
    ) -> Result<Self, String> {
        let command = app
            .shell()
            .sidecar("node")
            .map_err(|error| format!("Desktop Node sidecar could not be resolved: {error}"))?
            .args(&arguments)
            .current_dir(cwd)
            .set_raw_out(true);
        let (output, child) = command
            .spawn()
            .map_err(|error| format!("Desktop sidecar failed to spawn: {error}"))?;
        let (commands, receiver) = mpsc::unbounded_channel();
        spawn_output_reader(output, commands.clone(), events.clone());
        tauri::async_runtime::spawn_blocking(move || run_sidecar(child, receiver, events));

        Ok(Self { commands })
    }

    /// Queue a framed protocol message for ordered delivery to the sidecar stdin.
    pub(crate) fn write(&self, frame: Vec<u8>) -> Result<(), String> {
        self.commands
            .send(SidecarCommand::Write(frame))
            .map_err(|_| "Desktop sidecar is not running".to_string())
    }

    /// Stop the owned Node sidecar.
    pub(crate) fn terminate(&self) {
        let _ = self.commands.send(SidecarCommand::Terminate);
    }

    #[cfg(test)]
    pub(crate) fn test_handle() -> Self {
        let (commands, _receiver) = mpsc::unbounded_channel();
        Self { commands }
    }
}

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        self.terminate();
    }
}

fn spawn_output_reader(
    mut output: Receiver<CommandEvent>,
    commands: mpsc::UnboundedSender<SidecarCommand>,
    events: mpsc::UnboundedSender<SidecarEvent>,
) {
    tauri::async_runtime::spawn(async move {
        let mut terminated = false;
        while let Some(event) = output.recv().await {
            let event = match event {
                CommandEvent::Stdout(bytes) => SidecarEvent::Stdout(bytes),
                CommandEvent::Stderr(bytes) => SidecarEvent::Stderr(bytes),
                CommandEvent::Error(error) => {
                    SidecarEvent::Error(format!("Desktop sidecar output read failed: {error}"))
                }
                CommandEvent::Terminated(status) => {
                    terminated = true;
                    let _ = commands.send(SidecarCommand::Exited);
                    SidecarEvent::Terminated(status.code)
                }
                // Future Shell events cannot be interpreted as protocol bytes.
                other => SidecarEvent::Error(format!(
                    "Desktop sidecar emitted an unsupported output event: {other:?}"
                )),
            };
            if events.send(event).is_err() {
                let _ = commands.send(SidecarCommand::Terminate);
                return;
            }
        }
        if !terminated {
            let _ = events.send(SidecarEvent::Error(
                "Desktop sidecar event stream closed before termination".into(),
            ));
            let _ = commands.send(SidecarCommand::Terminate);
        }
    });
}

fn run_sidecar(
    mut child: CommandChild,
    mut commands: mpsc::UnboundedReceiver<SidecarCommand>,
    events: mpsc::UnboundedSender<SidecarEvent>,
) {
    while let Some(command) = commands.blocking_recv() {
        match command {
            SidecarCommand::Write(frame) => {
                if let Err(error) = child.write(&frame) {
                    let _ = events.send(SidecarEvent::Error(format!(
                        "Desktop sidecar stdin write failed: {error}"
                    )));
                    terminate_child(child, &events);
                    return;
                }
            }
            SidecarCommand::Terminate => {
                terminate_child(child, &events);
                return;
            }
            SidecarCommand::Exited => return,
        }
    }
    let _ = child.kill();
}

fn terminate_child(child: CommandChild, events: &mpsc::UnboundedSender<SidecarEvent>) {
    if let Err(error) = child.kill() {
        let _ = events.send(SidecarEvent::Error(format!(
            "Desktop sidecar termination failed: {error}"
        )));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Mutex, time::Duration};
    use tokio::time::timeout;

    static SIDECAR_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn test_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_shell::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap()
    }

    #[test]
    fn official_shell_sidecar_preserves_raw_protocol_bytes() {
        let _guard = SIDECAR_TEST_LOCK.lock().unwrap();
        tauri::async_runtime::block_on(async {
            let app = test_app();
            let (events_tx, mut events) = mpsc::unbounded_channel();
            let process = SidecarProcess::spawn(
                app.handle(),
                vec![
                    OsString::from("--input-type=module"),
                    OsString::from("--eval"),
                    OsString::from(
                        "process.stdout.write(Buffer.from([0, 255])); process.stdin.once('data', (chunk) => process.stdout.write(chunk, () => process.exit(0)));",
                    ),
                ],
                std::env::temp_dir(),
                events_tx,
            )
            .unwrap();
            let input = vec![1, 0, 2, 255];
            process.write(input.clone()).unwrap();
            let stdout = wait_for_termination(&mut events).await;
            assert_eq!(stdout, [vec![0, 255], input].concat());
        });
    }

    #[test]
    fn terminating_the_owned_sidecar_reports_termination() {
        let _guard = SIDECAR_TEST_LOCK.lock().unwrap();
        tauri::async_runtime::block_on(async {
            let app = test_app();
            let (events_tx, mut events) = mpsc::unbounded_channel();
            let process = SidecarProcess::spawn(
                app.handle(),
                vec![
                    OsString::from("--input-type=module"),
                    OsString::from("--eval"),
                    OsString::from("setInterval(() => {}, 1000);"),
                ],
                std::env::temp_dir(),
                events_tx,
            )
            .unwrap();
            process.terminate();
            let _ = wait_for_termination(&mut events).await;
        });
    }

    async fn wait_for_termination(events: &mut mpsc::UnboundedReceiver<SidecarEvent>) -> Vec<u8> {
        timeout(Duration::from_secs(5), async {
            let mut stdout = Vec::new();
            loop {
                match events.recv().await.unwrap() {
                    SidecarEvent::Stdout(bytes) => stdout.extend(bytes),
                    SidecarEvent::Error(error) => panic!("sidecar failed: {error}"),
                    SidecarEvent::Terminated(_) => return stdout,
                    SidecarEvent::Stderr(_) => {}
                }
            }
        })
        .await
        .expect("sidecar did not terminate")
    }
}
