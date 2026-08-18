use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
};

#[cfg(unix)]
use process_wrap::tokio::ProcessGroup;
use process_wrap::tokio::{ChildWrapper, CommandWrap};
#[cfg(windows)]
use process_wrap::tokio::{CreationFlags, JobObject, KillOnDrop};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::ChildStdin,
    sync::mpsc,
    time::{Duration, MissedTickBehavior},
};
#[cfg(windows)]
use windows::Win32::System::Threading::CREATE_NO_WINDOW;

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
}

/// Handle for the sidecar actor that owns the complete process scope.
pub(crate) struct SidecarProcess {
    commands: mpsc::UnboundedSender<SidecarCommand>,
}

impl SidecarProcess {
    /// Resolve the Tauri `externalBin` location for the bundled Node executable.
    pub(crate) fn bundled_node_path() -> Result<PathBuf, String> {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        bundled_binary_path(&executable, "node")
    }

    /// Spawn a sidecar with platform-native ownership of its entire process scope.
    pub(crate) fn spawn(
        program: &Path,
        arguments: Vec<OsString>,
        cwd: PathBuf,
        events: mpsc::UnboundedSender<SidecarEvent>,
    ) -> Result<Self, String> {
        let mut command = CommandWrap::with_new(program, |command| {
            command
                .args(&arguments)
                .current_dir(cwd)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
        });
        #[cfg(unix)]
        command.wrap(ProcessGroup::leader());
        #[cfg(windows)]
        {
            command.wrap(CreationFlags(CREATE_NO_WINDOW));
            command.wrap(JobObject);
            command.wrap(KillOnDrop);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("Desktop sidecar failed to spawn: {error}"))?;
        let stdin = match require_pipe(child.stdin().take(), "stdin") {
            Ok(pipe) => pipe,
            Err(error) => {
                let _ = child.start_kill();
                return Err(error);
            }
        };
        let stdout = match require_pipe(child.stdout().take(), "stdout") {
            Ok(pipe) => pipe,
            Err(error) => {
                let _ = child.start_kill();
                return Err(error);
            }
        };
        let stderr = match require_pipe(child.stderr().take(), "stderr") {
            Ok(pipe) => pipe,
            Err(error) => {
                let _ = child.start_kill();
                return Err(error);
            }
        };

        spawn_output_reader(stdout, OutputStream::Stdout, events.clone());
        spawn_output_reader(stderr, OutputStream::Stderr, events.clone());
        let (commands, receiver) = mpsc::unbounded_channel();
        tauri::async_runtime::spawn(run_sidecar(child, stdin, receiver, events));

        Ok(Self { commands })
    }

    /// Queue a framed protocol message for ordered delivery to the sidecar stdin.
    pub(crate) fn write(&self, frame: Vec<u8>) -> Result<(), String> {
        self.commands
            .send(SidecarCommand::Write(frame))
            .map_err(|_| "Desktop sidecar is not running".to_string())
    }

    /// Stop the entire process scope, not just the Node parent process.
    pub(crate) fn terminate(&self) {
        let _ = self.commands.send(SidecarCommand::Terminate);
    }

    #[cfg(test)]
    pub(crate) fn test_handle() -> Self {
        let (commands, _receiver) = mpsc::unbounded_channel();
        Self { commands }
    }
}

fn bundled_binary_path(executable: &Path, program: &str) -> Result<PathBuf, String> {
    let executable_dir = executable
        .parent()
        .ok_or_else(|| "Desktop executable has no parent directory".to_string())?;
    // Match Tauri Shell's documented sidecar layout in development and bundles.
    let base_dir = if executable_dir.ends_with("deps") {
        executable_dir.parent().unwrap_or(executable_dir)
    } else {
        executable_dir
    };
    let path = base_dir.join(program);
    #[cfg(windows)]
    {
        let mut path = path;
        if path.extension().is_none() {
            path.as_mut_os_string().push(".exe");
        }
        return Ok(path);
    }
    #[cfg(not(windows))]
    Ok(path)
}

fn require_pipe<T>(pipe: Option<T>, name: &str) -> Result<T, String> {
    pipe.ok_or_else(|| format!("Desktop sidecar {name} pipe was not created"))
}

#[derive(Clone, Copy)]
enum OutputStream {
    Stdout,
    Stderr,
}

fn spawn_output_reader<R>(
    output: R,
    stream: OutputStream,
    events: mpsc::UnboundedSender<SidecarEvent>,
) where
    R: AsyncRead + Send + Unpin + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut output = output;
        let mut buffer = [0; 16 * 1024];
        loop {
            match output.read(&mut buffer).await {
                Ok(0) => return,
                Ok(length) => {
                    let event = match stream {
                        OutputStream::Stdout => SidecarEvent::Stdout(buffer[..length].to_vec()),
                        OutputStream::Stderr => SidecarEvent::Stderr(buffer[..length].to_vec()),
                    };
                    if events.send(event).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    let name = match stream {
                        OutputStream::Stdout => "stdout",
                        OutputStream::Stderr => "stderr",
                    };
                    let _ = events.send(SidecarEvent::Error(format!(
                        "Desktop sidecar {name} read failed: {error}"
                    )));
                    return;
                }
            }
        }
    });
}

async fn run_sidecar(
    mut child: Box<dyn ChildWrapper>,
    mut stdin: ChildStdin,
    mut commands: mpsc::UnboundedReceiver<SidecarCommand>,
    events: mpsc::UnboundedSender<SidecarEvent>,
) {
    let mut liveness = tokio::time::interval(Duration::from_millis(100));
    liveness.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = liveness.tick() => {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        // The root process has exited. A process group or Job Object
                        // can still contain descendants, so terminate the scope before
                        // publishing the generation as stopped.
                        let _ = child.start_kill();
                        report_termination(Ok(status.code()), &events);
                        return;
                    }
                    Ok(None) => {}
                    Err(error) => {
                        let _ = events.send(SidecarEvent::Error(format!(
                            "Desktop sidecar liveness check failed: {error}"
                        )));
                        terminate_child(&mut child, &events).await;
                        return;
                    }
                }
            }
            command = commands.recv() => match command {
                Some(SidecarCommand::Write(frame)) => {
                    if let Err(error) = stdin.write_all(&frame).await {
                        let _ = events.send(SidecarEvent::Error(format!(
                            "Desktop sidecar stdin write failed: {error}"
                        )));
                        terminate_child(&mut child, &events).await;
                        return;
                    }
                }
                Some(SidecarCommand::Terminate) | None => {
                    terminate_child(&mut child, &events).await;
                    return;
                }
            }
        }
    }
}

async fn terminate_child(
    child: &mut Box<dyn ChildWrapper>,
    events: &mpsc::UnboundedSender<SidecarEvent>,
) {
    match Box::into_pin(child.kill()).await {
        Ok(()) => {
            let status = child
                .try_wait()
                .ok()
                .flatten()
                .and_then(|status| status.code());
            report_termination(Ok(status), events);
        }
        Err(error) => {
            let _ = events.send(SidecarEvent::Error(format!(
                "Desktop sidecar termination failed: {error}"
            )));
            report_termination(Ok(None), events);
        }
    }
}

fn report_termination(
    status: Result<Option<i32>, std::io::Error>,
    events: &mpsc::UnboundedSender<SidecarEvent>,
) {
    match status {
        Ok(code) => {
            let _ = events.send(SidecarEvent::Terminated(code));
        }
        Err(error) => {
            let _ = events.send(SidecarEvent::Error(format!(
                "Desktop sidecar wait failed: {error}"
            )));
            let _ = events.send(SidecarEvent::Terminated(None));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    use std::time::Duration;
    #[cfg(target_os = "macos")]
    use tokio::time::{sleep, timeout};

    #[test]
    fn bundled_node_path_is_beside_the_desktop_executable() {
        let path =
            bundled_binary_path(Path::new("/bundle/DeepSeek Harness Desktop"), "node").unwrap();
        assert_eq!(path, Path::new("/bundle/node"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn terminating_the_scope_kills_a_descendant() {
        tauri::async_runtime::block_on(async {
            let (events_tx, mut events) = mpsc::unbounded_channel();
            let process = SidecarProcess::spawn(
                Path::new("/bin/sh"),
                vec![
                    OsString::from("-c"),
                    OsString::from("sleep 30 & printf '%s\\n' \"$!\"; wait"),
                ],
                std::env::temp_dir(),
                events_tx,
            )
            .unwrap();

            let child_pid = receive_descendant_pid(&mut events).await;

            process.terminate();
            wait_for_termination(&mut events).await;

            wait_for_process_exit(child_pid).await;
        });
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn root_exit_cleans_its_remaining_process_scope() {
        tauri::async_runtime::block_on(async {
            let (events_tx, mut events) = mpsc::unbounded_channel();
            let _process = SidecarProcess::spawn(
                Path::new("/bin/sh"),
                vec![
                    OsString::from("-c"),
                    OsString::from("sleep 30 & printf '%s\\n' \"$!\""),
                ],
                std::env::temp_dir(),
                events_tx,
            )
            .unwrap();

            let child_pid = receive_descendant_pid(&mut events).await;
            wait_for_termination(&mut events).await;

            wait_for_process_exit(child_pid).await;
        });
    }

    #[cfg(target_os = "macos")]
    async fn receive_descendant_pid(events: &mut mpsc::UnboundedReceiver<SidecarEvent>) -> u32 {
        timeout(Duration::from_secs(5), async {
            let mut output = String::new();
            loop {
                match events.recv().await.unwrap() {
                    SidecarEvent::Stdout(bytes) => {
                        output.push_str(&String::from_utf8_lossy(&bytes));
                        if let Some(pid) = output.lines().find_map(|line| line.parse().ok()) {
                            return pid;
                        }
                    }
                    SidecarEvent::Error(error) => panic!("sidecar failed: {error}"),
                    SidecarEvent::Terminated(_) => {
                        panic!("sidecar ended before reporting its child")
                    }
                    SidecarEvent::Stderr(_) => {}
                }
            }
        })
        .await
        .expect("sidecar did not report its descendant pid")
    }

    #[cfg(target_os = "macos")]
    async fn wait_for_termination(events: &mut mpsc::UnboundedReceiver<SidecarEvent>) {
        timeout(Duration::from_secs(5), async {
            loop {
                match events.recv().await {
                    Some(SidecarEvent::Terminated(_)) => return,
                    Some(SidecarEvent::Error(error)) => panic!("sidecar failed: {error}"),
                    Some(SidecarEvent::Stdout(_) | SidecarEvent::Stderr(_)) => {}
                    None => panic!("sidecar event stream closed before termination"),
                }
            }
        })
        .await
        .expect("sidecar scope did not terminate");
    }

    #[cfg(target_os = "macos")]
    async fn wait_for_process_exit(pid: u32) {
        timeout(Duration::from_secs(2), async {
            while process_is_running(pid) {
                sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("sidecar descendant survived termination");
    }

    #[cfg(target_os = "macos")]
    fn process_is_running(pid: u32) -> bool {
        std::process::Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }
}
