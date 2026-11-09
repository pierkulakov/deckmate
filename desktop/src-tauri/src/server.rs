use crate::{job::Job, log::Log, paths::Programs, texts};
use serde::Serialize;
use std::{
    collections::VecDeque, ffi::OsString, io, net::TcpListener, path::Path, process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, ChildStdin, Command},
    sync::{mpsc, oneshot, watch},
    time,
};

const START_TIMEOUT: Duration = Duration::from_secs(20);
const STOP_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, Serialize)]
pub struct Failure {
    pub ok: bool,
    pub code: String,
    pub message: String,
}

impl Failure {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Exit {
    pub code: Option<i32>,
    pub expected: bool,
    pub forced: bool,
}

#[derive(Clone)]
pub struct Server {
    stop: watch::Sender<bool>,
    exit: watch::Receiver<Option<Exit>>,
}

impl Server {
    pub fn request_stop(&self) {
        let _ = self.stop.send(true);
    }

    pub async fn exited(&self) -> Exit {
        let mut exit = self.exit.clone();
        let _ = exit.wait_for(|value| value.is_some()).await;
        let result = exit.borrow().clone().unwrap_or(Exit {
            code: None,
            expected: true,
            forced: true,
        });
        result
    }

    pub async fn stop(&self) -> Exit {
        self.request_stop();
        self.exited().await
    }
}

#[cfg(test)]
impl Server {
    /// 2026-11-09: a handle for unit tests of shell logic (window::is_server_url); both channels stay
    /// idle because those tests never start or stop a process through it.
    pub fn idle() -> Self {
        let (stop, _) = watch::channel(false);
        let (_, exit) = watch::channel(None);
        Self { stop, exit }
    }
}

pub fn filtered_env(
    entries: impl IntoIterator<Item = (OsString, OsString)>,
) -> Vec<(OsString, OsString)> {
    entries
        .into_iter()
        .filter(|(key, _)| {
            let key = key.to_string_lossy().to_ascii_uppercase();
            // 2026-11-09: NODE_OPTIONS (--require, --inspect), NODE_PATH and OPENSSL_CONF/OPENSSL_MODULES would let an
            // inherited environment load code into the bundled Node; the Electron build disabled them through fuses.
            !["DECKMATE_", "FREETION_", "NODE_", "OPENSSL_"]
                .iter()
                .any(|prefix| key.starts_with(prefix))
        })
        .collect()
}

fn command(programs: &Programs) -> Command {
    let mut command = Command::new(&programs.node);
    command
        .env_clear()
        .envs(filtered_env(std::env::vars_os()))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(windows::Win32::System::Threading::CREATE_NO_WINDOW.0);
    command
}

/// 2026-11-09: only the exact origin of the port the shell chose counts, and only once the port is complete: a chunk
/// boundary inside the number, or another local server's port, must not become the trusted board origin.
pub fn ready_url(output: &str, port: u16) -> Option<String> {
    let origin = format!("http://127.0.0.1:{port}");
    let marker = format!("Deckmate: {origin}");
    let start = output.find(&marker)?;
    match output[start + marker.len()..].chars().next() {
        Some(next) if next.is_ascii_digit() => None,
        _ => Some(origin),
    }
}

fn free_port() -> io::Result<u16> {
    Ok(TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port())
}

pub fn choose_port(saved: Option<u16>) -> io::Result<u16> {
    if let Some(port) = saved.filter(|port| *port != 0) {
        match TcpListener::bind(("127.0.0.1", port)) {
            Ok(_) => return Ok(port),
            Err(error) if error.kind() == io::ErrorKind::AddrInUse => (),
            Err(error) => return Err(error),
        }
    }
    free_port()
}

pub fn start(
    programs: &Programs,
    directory: &Path,
    folder: &str,
    log: Log,
    language: String,
) -> io::Result<(Server, oneshot::Receiver<Result<String, Failure>>)> {
    // 2026-11-09: self-test stays isolated from the user's persisted board origin.
    start_on_port(programs, directory, folder, log, language, free_port()?)
}

pub fn start_on_port(
    programs: &Programs,
    directory: &Path,
    folder: &str,
    log: Log,
    language: String,
    port: u16,
) -> io::Result<(Server, oneshot::Receiver<Result<String, Failure>>)> {
    let mut child = command(programs)
        .arg(&programs.server)
        .current_dir(folder)
        .env("DECKMATE_DATA", folder)
        .env("DECKMATE_PORT", port.to_string())
        .env("DECKMATE_HOST", "127.0.0.1")
        .env("DECKMATE_INDEX", directory.join("index"))
        .env("DECKMATE_SHUTDOWN_STDIN", "1")
        .spawn()?;
    let job = Job::attach(&child)?;
    // 2026-11-09: Child::wait() closes the child's stdin before waiting, and the run loop waits from the first
    // poll; the server reads that as the shell going away and stops. The handle lives outside the Child instead.
    let stdin = child.stdin.take();
    log.write(format!("start {folder} on port {port}"));
    let (output, receiver) = mpsc::unbounded_channel();
    let stdout = tokio::spawn(read_output(
        child.stdout.take().unwrap(),
        false,
        port,
        output.clone(),
        log.clone(),
    ));
    let stderr = tokio::spawn(read_output(
        child.stderr.take().unwrap(),
        true,
        port,
        output,
        log.clone(),
    ));
    let (ready, ready_receiver) = oneshot::channel();
    let (stop, stop_receiver) = watch::channel(false);
    let (exit, exit_receiver) = watch::channel(None);
    let folder = folder.to_owned();
    tokio::spawn(async move {
        let mut process = Process {
            child,
            stdin,
            ready: Some(ready),
            output: receiver,
            stderr: VecDeque::new(),
            language,
            started: false,
            timed_out: false,
        };
        let result = process.run(stop_receiver, &log, &folder).await;
        let ready = process.ready.take();
        drop(job);
        let _ = stdout.await;
        let _ = stderr.await;
        while let Ok(line) = process.output.try_recv() {
            process.output_line(line);
        }
        if let Some(ready) = ready {
            let (code, message) = match process.timed_out {
                true => ("timeout", texts::text(&process.language, "timeout").into()),
                false => (
                    "start-failed",
                    texts::format(
                        &process.language,
                        "serverExit",
                        "code",
                        exit_code(result.code),
                    ),
                ),
            };
            let _ = ready.send(Err(process.failure(code, message)));
        }
        if !result.expected {
            log.write(format!(
                "server exited unexpectedly with code {}",
                exit_code(result.code)
            ));
        }
        let _ = exit.send(Some(result));
    });
    Ok((
        Server {
            stop,
            exit: exit_receiver,
        },
        ready_receiver,
    ))
}

enum Output {
    Ready(String),
    Stderr(String),
}

fn output_line(bytes: &[u8], stderr: bool, sender: &mpsc::UnboundedSender<Output>, log: &Log) {
    let line = String::from_utf8_lossy(bytes).trim_end().to_owned();
    log.write(format!(
        "[{}] {line}",
        if stderr { "stderr" } else { "stdout" }
    ));
    if stderr {
        let _ = sender.send(Output::Stderr(line));
    }
}

async fn read_output(
    mut stream: impl AsyncRead + Unpin,
    stderr: bool,
    port: u16,
    sender: mpsc::UnboundedSender<Output>,
    log: Log,
) {
    let mut chunk = [0u8; 4096];
    let mut pending = Vec::new();
    let mut ready_buffer = Vec::new();
    let mut matched_ready = stderr;
    loop {
        let length = match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(length) => length,
        };
        if !matched_ready {
            ready_buffer.extend_from_slice(&chunk[..length]);
            if let Some(url) = ready_url(&String::from_utf8_lossy(&ready_buffer), port) {
                let _ = sender.send(Output::Ready(url));
                matched_ready = true;
            }
            ready_buffer.drain(..ready_buffer.len().saturating_sub(4000));
        }
        pending.extend_from_slice(&chunk[..length]);
        while let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
            output_line(&pending[..end], stderr, &sender, &log);
            pending.drain(..=end);
        }
        if pending.len() >= 64 * 1024 {
            output_line(&pending, stderr, &sender, &log);
            pending.clear();
        }
    }
    if !pending.is_empty() {
        output_line(&pending, stderr, &sender, &log);
    }
}

struct Process {
    child: Child,
    stdin: Option<ChildStdin>,
    ready: Option<oneshot::Sender<Result<String, Failure>>>,
    output: mpsc::UnboundedReceiver<Output>,
    stderr: VecDeque<String>,
    language: String,
    started: bool,
    timed_out: bool,
}

impl Process {
    fn output_line(&mut self, output: Output) {
        match output {
            Output::Stderr(line) => {
                self.stderr.push_back(line.chars().take(4000).collect());
                if self.stderr.len() > 12 {
                    self.stderr.pop_front();
                }
            }
            Output::Ready(url) => {
                if let Some(ready) = self.ready.take() {
                    self.started = true;
                    let _ = ready.send(Ok(url));
                }
            }
        }
    }

    fn failure(&self, code: &str, message: String) -> Failure {
        Failure::new(
            code,
            format!(
                "{message}\n{}",
                self.stderr.iter().cloned().collect::<Vec<_>>().join("\n")
            ),
        )
    }

    async fn run(&mut self, mut stop: watch::Receiver<bool>, log: &Log, folder: &str) -> Exit {
        let deadline = time::sleep(START_TIMEOUT);
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                _ = stop.changed() => {
                    log.write(format!("stop {folder}"));
                    return shutdown(&mut self.child, &mut self.stdin, self.started).await;
                }
                Some(output) = self.output.recv() => self.output_line(output),
                status = self.child.wait() => return Exit { code: status.ok().and_then(|s| s.code()), expected: false, forced: false },
                _ = &mut deadline, if !self.started => {
                    self.timed_out = true;
                    return shutdown(&mut self.child, &mut self.stdin, false).await;
                }
            }
        }
    }
}

async fn shutdown(child: &mut Child, stdin: &mut Option<ChildStdin>, ready: bool) -> Exit {
    if ready {
        let graceful = async {
            if let Some(mut stdin) = stdin.take() {
                stdin.write_all(b"{\"type\":\"shutdown\"}\n").await?;
            }
            child.wait().await
        };
        if let Ok(Ok(status)) = time::timeout(STOP_TIMEOUT, graceful).await {
            return Exit {
                code: status.code(),
                expected: true,
                forced: false,
            };
        }
    }
    let _ = child.kill().await;
    let code = child.wait().await.ok().and_then(|s| s.code());
    Exit {
        code,
        expected: true,
        forced: true,
    }
}

pub fn exit_code(code: Option<i32>) -> String {
    code.map(|code| code.to_string())
        .unwrap_or_else(|| "null".into())
}

pub async fn initialize(
    programs: &Programs,
    folder: &str,
    language: &str,
    log: &Log,
) -> Result<(), Failure> {
    let mut command = command(programs);
    command
        .arg(&programs.cli)
        .arg("init")
        .arg(folder)
        .stdin(Stdio::null());
    if let Some(parent) = Path::new(folder).ancestors().find(|path| path.is_dir()) {
        command.current_dir(parent);
    }
    let child = command
        .spawn()
        .map_err(|error| Failure::new("create-failed", error.to_string()))?;
    let _job =
        Job::attach(&child).map_err(|error| Failure::new("create-failed", error.to_string()))?;
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| Failure::new("create-failed", error.to_string()))?;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        log.write(format!("[stdout] {line}"));
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    for line in stderr.lines() {
        log.write(format!("[stderr] {line}"));
    }
    if output.status.success() {
        return Ok(());
    }
    let lines = stderr.lines().collect::<Vec<_>>();
    Err(Failure::new(
        "create-failed",
        format!(
            "{}\n{}",
            texts::format(
                language,
                "initFailed",
                "code",
                exit_code(output.status.code())
            ),
            lines[lines.len().saturating_sub(12)..].join("\n")
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_available_saved_port_and_falls_back_when_taken() {
        let occupied = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = occupied.local_addr().unwrap().port();
        assert_ne!(choose_port(Some(port)).unwrap(), port);
        drop(occupied);
        assert_eq!(choose_port(Some(port)).unwrap(), port);
        assert_ne!(choose_port(None).unwrap(), 0);
        assert_ne!(choose_port(Some(0)).unwrap(), 0);
    }

    #[test]
    fn removes_legacy_and_current_environment_case_insensitively() {
        let entries = [
            "DECKMATE_DATA",
            "deckmate_port",
            "FreeTion_INDEX",
            "PATH",
            "APPDATA",
            "DECKMATES",
            "NODE_OPTIONS",
            "node_path",
            "NODE_COMPILE_CACHE",
            "OPENSSL_CONF",
        ]
        .map(|key| (key.into(), "value".into()));
        let kept = filtered_env(entries);
        assert_eq!(
            kept.iter()
                .map(|(key, _)| key.to_str().unwrap())
                .collect::<Vec<_>>(),
            ["PATH", "APPDATA", "DECKMATES"]
        );
    }

    #[test]
    fn ready_line_extracts_only_loopback_origin_without_secret() {
        assert_eq!(
            ready_url(
                "prefix Deckmate: http://127.0.0.1:4318/?token=abcd\r\n",
                4318
            ),
            Some("http://127.0.0.1:4318".into())
        );
        for line in [
            "Deckmate: http://localhost:4318",
            "Deckmate: https://127.0.0.1:4318",
            "Deckmate: http://127.0.0.1:",
            "http://127.0.0.1:4318",
            "Deckmate: http://127.0.0.1:431",
            "Deckmate: http://127.0.0.1:43180",
            "Deckmate: http://127.0.0.1:4317",
        ] {
            assert_eq!(ready_url(line, 4318), None);
        }
    }

    struct Fixture {
        directory: std::path::PathBuf,
        programs: Programs,
    }

    impl Fixture {
        fn new(source: &str) -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let directory = std::env::temp_dir().join(format!(
                "deckmate-process-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&directory).unwrap();
            let entry = directory.join("server.cjs");
            std::fs::write(&entry, source).unwrap();
            Self {
                directory,
                programs: Programs {
                    node: "node".into(),
                    server: entry.clone(),
                    cli: entry.clone(),
                    package: entry,
                },
            }
        }
        fn start(&self) -> (Server, oneshot::Receiver<Result<String, Failure>>) {
            start(
                &self.programs,
                &self.directory,
                &self.directory.to_string_lossy(),
                Log::open(&self.directory),
                "en".into(),
            )
            .unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }

    #[tokio::test]
    async fn fragmented_ready_without_newline_and_graceful_stdin_shutdown() {
        let fixture = Fixture::new(
            r#"
            process.stdout.write('Deck');
            setTimeout(() => process.stdout.write('mate: http://127.0.0.1:' + process.env.DECKMATE_PORT), 30);
            process.stdin.once('data', data => process.exit(JSON.parse(data).type === 'shutdown' ? 0 : 2));
            process.stdin.on('end', () => process.exit(3));
        "#,
        );
        let (process, ready) = fixture.start();
        let url = time::timeout(Duration::from_secs(5), ready)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(url.starts_with("http://127.0.0.1:"));
        // 2026-11-09: a closed stdin would make the fixture exit with 3 during this pause.
        time::sleep(Duration::from_millis(300)).await;
        let exit = process.stop().await;
        assert!(exit.expected);
        assert!(!exit.forced);
        assert_eq!(exit.code, Some(0));
    }

    #[tokio::test]
    async fn early_exit_reports_last_twelve_stderr_lines() {
        let fixture = Fixture::new(
            "for(let i=0;i<16;i++) process.stderr.write(`line-${i}\\n`); process.exitCode=7;",
        );
        let (process, ready) = fixture.start();
        let error = ready.await.unwrap().unwrap_err();
        assert_eq!(error.code, "start-failed");
        assert!(error.message.contains("code 7"));
        assert!(!error.message.contains("line-3\n"));
        assert!(error.message.ends_with("line-15"));
        assert_eq!(process.exited().await.code, Some(7));
    }

    #[tokio::test]
    async fn starting_process_can_be_superseded_without_waiting_for_timeout() {
        let fixture = Fixture::new("setInterval(() => {}, 1000);");
        let (process, ready) = fixture.start();
        let exit = time::timeout(Duration::from_secs(2), process.stop())
            .await
            .unwrap();
        assert!(exit.expected && exit.forced);
        assert!(ready.await.unwrap().is_err());
    }

    #[tokio::test]
    async fn timeout_reaps_the_child_and_keeps_unterminated_stderr() {
        let fixture =
            Fixture::new("process.stderr.write('startup stalled'); setInterval(() => {}, 1000);");
        let (process, ready) = fixture.start();
        let error = time::timeout(Duration::from_secs(25), ready)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert_eq!(error.code, "timeout");
        assert!(error.message.ends_with("startup stalled"));
        assert!(process.exited().await.forced);
    }
}
