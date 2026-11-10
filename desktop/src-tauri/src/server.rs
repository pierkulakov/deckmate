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
const INIT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Serialize)]
pub struct Failure {
    pub ok: bool,
    pub code: String,
    pub message: String,
    #[serde(skip)]
    address_in_use: bool,
}

impl Failure {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            code: code.into(),
            message: message.into(),
            address_in_use: false,
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

#[derive(Default)]
pub struct PortRetries(u8);

impl PortRetries {
    pub fn next(&mut self, failure: &Failure) -> io::Result<Option<u16>> {
        if !failure.address_in_use || self.0 >= 3 {
            return Ok(None);
        }
        self.0 += 1;
        free_port().map(Some)
    }
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
    // 2026-11-09: CreateProcessW rejects a working directory longer than MAX_PATH (os error 267) even with
    // LongPathsEnabled, so a project at a deep path never started. The server reads its folder from
    // DECKMATE_DATA, not the working directory; the short settings directory is the working directory instead.
    let mut child = command(programs)
        .arg(&programs.server)
        .current_dir(directory)
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
            address_in_use: false,
            port,
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
    address_in_use: bool,
    port: u16,
}

impl Process {
    fn output_line(&mut self, output: Output) {
        match output {
            Output::Stderr(line) => {
                self.address_in_use |= port_conflict(&line, self.port);
                push_stderr(&mut self.stderr, Output::Stderr(line));
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
        let mut failure = Failure::new(
            code,
            format!(
                "{message}\n{}",
                self.stderr.iter().cloned().collect::<Vec<_>>().join("\n")
            ),
        );
        failure.address_in_use = code == "start-failed" && self.address_in_use;
        failure
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

fn port_conflict(line: &str, port: u16) -> bool {
    // 2026-11-10: unrelated crashes and diagnostic mentions must not change the saved board origin.
    line.trim() == format!("Error: listen EADDRINUSE: address already in use 127.0.0.1:{port}")
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
    cancellation: impl std::future::Future<Output = Failure>,
) -> Result<(), Failure> {
    initialize_with_timeout(programs, folder, language, log, cancellation, INIT_TIMEOUT).await
}

async fn initialize_with_timeout(
    programs: &Programs,
    folder: &str,
    language: &str,
    log: &Log,
    cancellation: impl std::future::Future<Output = Failure>,
    timeout: Duration,
) -> Result<(), Failure> {
    let mut command = command(programs);
    command
        .arg(&programs.cli)
        .arg("init")
        .arg(folder)
        .stdin(Stdio::null());
    // 2026-11-09: CreateProcessW rejects a working directory longer than MAX_PATH (os error 267), so a project
    // created under a deep parent folder failed. The folder is an absolute argument; the CLI's own short
    // directory is the working directory, which also keeps any .env.local around the folder out of the CLI.
    if let Some(bin) = programs.cli.parent() {
        command.current_dir(bin);
    }
    let mut child = command.spawn().map_err(|error| {
        init_failure(
            Failure::new("create-failed", error.to_string()),
            folder,
            language,
        )
    })?;
    let job = match Job::attach(&child) {
        Ok(job) => job,
        Err(error) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(init_failure(
                Failure::new("create-failed", error.to_string()),
                folder,
                language,
            ));
        }
    };
    // 2026-11-09: drain both pipes while waiting so a noisy CLI cannot deadlock; no stdin stays in Child.
    let _stdin = child.stdin.take();
    let (output, mut receiver) = mpsc::unbounded_channel();
    let stdout = child
        .stdout
        .take()
        .map(|stream| tokio::spawn(read_output(stream, false, 0, output.clone(), log.clone())));
    let stderr = child
        .stderr
        .take()
        .map(|stream| tokio::spawn(read_output(stream, true, 0, output.clone(), log.clone())));
    drop(output);
    let mut tail = VecDeque::new();
    let result = async {
        tokio::pin!(cancellation);
        let deadline = time::sleep(timeout);
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                biased;
                failure = &mut cancellation => break Err(failure),
                _ = &mut deadline => break Err(Failure::new("create-failed", texts::text(language, "initTimeout"))),
                status = child.wait() => break status.map_err(|error| Failure::new("create-failed", error.to_string())),
                Some(output) = receiver.recv() => push_stderr(&mut tail, output),
            }
        }
    }.await;
    if result.is_err() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    // 2026-11-09: closing the Job also closes pipes inherited by descendants before joining readers.
    drop(job);
    for reader in [stdout, stderr].into_iter().flatten() {
        let _ = reader.await;
    }
    while let Ok(output) = receiver.try_recv() {
        push_stderr(&mut tail, output);
    }
    let status = result.map_err(|mut failure| {
        log.write(format!("project initialization stopped: {}", failure.code));
        if failure.code == "create-failed" {
            failure.message = format!(
                "{}\n{}",
                failure.message,
                tail.iter().cloned().collect::<Vec<_>>().join("\n")
            );
        }
        init_failure(failure, folder, language)
    })?;
    if status.success() {
        return Ok(());
    }
    Err(init_failure(
        Failure::new(
            "create-failed",
            format!(
                "{}\n{}",
                texts::format(language, "initFailed", "code", exit_code(status.code())),
                tail.into_iter().collect::<Vec<_>>().join("\n")
            ),
        ),
        folder,
        language,
    ))
}

pub(crate) fn init_failure(mut failure: Failure, folder: &str, language: &str) -> Failure {
    failure.message = format!(
        "{}\n{}",
        texts::format(language, "initPartial", "path", folder),
        failure.message
    );
    failure
}

fn push_stderr(tail: &mut VecDeque<String>, output: Output) {
    if let Output::Stderr(line) = output {
        tail.push_back(line.chars().take(4000).collect());
        if tail.len() > 12 {
            tail.pop_front();
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
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
    async fn port_collision_retries_on_a_new_port_and_stops_after_three_retries() {
        let fixture = Fixture::new(
            r#"
            const fs = require('fs');
            const file = 'attempts';
            const attempt = fs.existsSync(file) ? Number(fs.readFileSync(file, 'utf8')) : 0;
            fs.writeFileSync(file, String(attempt + 1));
            if (attempt === 0) { process.stderr.write('Error: listen EADDRINUSE: address already in use 127.0.0.1:' + process.env.DECKMATE_PORT + '\n'); process.exitCode = 1; }
            else {
                console.log('Deckmate: http://127.0.0.1:' + process.env.DECKMATE_PORT);
                process.stdin.once('data', () => process.exit(0));
            }
        "#,
        );
        let (first, ready) = fixture.start();
        let error = ready.await.unwrap().unwrap_err();
        first.exited().await;
        assert_eq!(error.code, "start-failed");
        let mut retries = PortRetries::default();
        let port = retries.next(&error).unwrap().unwrap();
        let (second, ready) = start_on_port(
            &fixture.programs,
            &fixture.directory,
            &fixture.directory.to_string_lossy(),
            Log::open(&fixture.directory),
            "en".into(),
            port,
        )
        .unwrap();
        assert_eq!(
            ready.await.unwrap().unwrap(),
            format!("http://127.0.0.1:{port}")
        );
        second.stop().await;
        assert_eq!(
            std::fs::read_to_string(fixture.directory.join("attempts")).unwrap(),
            "2"
        );
        assert!(retries.next(&error).unwrap().is_some());
        assert!(retries.next(&error).unwrap().is_some());
        assert!(retries.next(&error).unwrap().is_none());
        assert!(PortRetries::default()
            .next(&Failure::new("start-failed", "unrelated failure"))
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn unrelated_early_exit_with_occupied_port_is_not_retryable() {
        let fixture = Fixture::new("process.exitCode = 7;");
        let occupied = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = occupied.local_addr().unwrap().port();
        let (process, ready) = start_on_port(
            &fixture.programs,
            &fixture.directory,
            &fixture.directory.to_string_lossy(),
            Log::open(&fixture.directory),
            "en".into(),
            port,
        )
        .unwrap();
        let failure = ready.await.unwrap().unwrap_err();
        process.exited().await;
        assert_eq!(failure.code, "start-failed");
        assert!(!failure.address_in_use);
        assert!(PortRetries::default().next(&failure).unwrap().is_none());
    }

    #[test]
    fn port_conflict_requires_the_exact_node_error_and_chosen_port() {
        assert!(port_conflict(
            "Error: listen EADDRINUSE: address already in use 127.0.0.1:4318",
            4318
        ));
        for line in [
            "EADDRINUSE",
            "EADDRINUSE for 127.0.0.1:4318 in unrelated diagnostics",
            "127.0.0.1:4318 failed earlier; EADDRINUSE elsewhere",
            "Error: connect EADDRINUSE: address already in use 127.0.0.1:4318",
            "Error: listen EADDRINUSE: address already in use 127.0.0.1:43180",
            "Error: listen EADDRINUSE: address already in use 127.0.0.1:4317",
            "Error: listen EADDRINUSE: address already in use 127.0.0.1:4318 (example)",
            "example: Error: listen EADDRINUSE: address already in use 127.0.0.1:4318",
        ] {
            assert!(!port_conflict(line, 4318), "{line}");
        }
    }

    #[tokio::test]
    async fn init_drains_pipes_and_preserves_success_and_failure_tail() {
        for code in [0, 7] {
            let fixture = Fixture::new(&format!(
                r#"
                process.stdout.write('output '.repeat(16000));
                for (let i = 0; i < 16; i++) process.stderr.write(`line-${{i}}\n`);
                process.exitCode = {code};
            "#
            ));
            let result = time::timeout(
                Duration::from_secs(5),
                initialize(
                    &fixture.programs,
                    &fixture.directory.to_string_lossy(),
                    "en",
                    &Log::open(&fixture.directory),
                    std::future::pending(),
                ),
            )
            .await
            .unwrap();
            if code == 0 {
                assert!(result.is_ok());
            } else {
                let failure = result.unwrap_err();
                assert_eq!(failure.code, "create-failed");
                assert!(failure.message.contains("code 7"));
                assert!(!failure.message.contains("line-3\n"));
                assert!(failure.message.ends_with("line-15"));
            }
        }
    }

    #[tokio::test]
    async fn init_timeout_returns_create_failed_and_reaps_hung_child() {
        let fixture = Fixture::new(
            r#"
            require('fs').writeFileSync(require('path').join(__dirname, 'pid'), String(process.pid));
            process.stderr.write('init stalled'); setInterval(() => {}, 1000);
        "#,
        );
        let error = time::timeout(
            Duration::from_secs(8),
            initialize_with_timeout(
                &fixture.programs,
                &fixture.directory.to_string_lossy(),
                "ru",
                &Log::open(&fixture.directory),
                std::future::pending(),
                Duration::from_secs(3),
            ),
        )
        .await
        .unwrap()
        .unwrap_err();
        assert_eq!(error.code, "create-failed");
        assert!(error.message.contains(texts::text("ru", "initTimeout")));
        assert!(error.message.contains("частично"));
        assert!(error.message.contains(fixture.directory.to_str().unwrap()));
        assert!(error.message.ends_with("init stalled"));
        assert_child_reaped(&fixture.directory.join("pid")).await;
    }

    pub(crate) async fn assert_child_reaped(pid_file: &Path) {
        let pid = std::fs::read_to_string(pid_file).unwrap();
        let status = Command::new("node").args(["-e", &format!(
            "try {{ process.kill({pid}, 0); process.exitCode = 1; }} catch (error) {{ process.exitCode = error.code === 'ESRCH' ? 0 : 2; }}"
        )]).status().await.unwrap();
        assert!(status.success(), "init process {pid} must have been reaped");
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
