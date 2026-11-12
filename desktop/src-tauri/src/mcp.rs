use crate::{job::Job, mcp_sessions, paths::Programs, server, settings, texts};
use std::{
    io::{self, Write},
    process::Stdio,
};
use tokio::process::Command;

const EXCLUDED_ENV_PREFIXES: &[&str] = &["NODE_", "OPENSSL_"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Mode {
    Protocol,
    Check,
}

pub(crate) fn mode(arguments: &[String]) -> Mode {
    if arguments.iter().any(|arg| arg == "--check") {
        Mode::Check
    } else {
        Mode::Protocol
    }
}

pub fn arguments(args: &[String]) -> Option<&[String]> {
    args.get(1)
        .is_some_and(|arg| arg == "mcp")
        .then(|| &args[2..])
}

fn command(programs: &Programs, arguments: &[String], mode: Mode) -> Command {
    let (stdout, stderr) = match mode {
        Mode::Protocol => (Stdio::inherit(), Stdio::inherit()),
        Mode::Check => (Stdio::piped(), Stdio::piped()),
    };
    let mut command = Command::new(&programs.node);
    command
        .arg(&programs.cli)
        .arg("mcp")
        .args(arguments)
        .env_clear()
        // 2026-11-11: project selection and write policy belong to the MCP caller; only variables that can load
        // code into the bundled Node are removed.
        .envs(server::filter_env(
            std::env::vars_os(),
            EXCLUDED_ENV_PREFIXES,
        ))
        .stdin(Stdio::inherit())
        .stdout(stdout)
        .stderr(stderr)
        .kill_on_drop(true);
    command
}

async fn wait(programs: &Programs, arguments: &[String], mode: Mode) -> io::Result<i32> {
    // 2026-11-12: protocol bytes keep their inherited handles. CREATE_NO_WINDOW suppresses a check child's console
    // output, so only that finite command is piped and printed by the parent after it exits.
    let (mut child, job) = Job::spawn(&mut command(programs, arguments, mode))?;
    let status = match mode {
        Mode::Protocol => child.wait().await?,
        Mode::Check => {
            let output = child.wait_with_output().await?;
            let mut stdout = io::stdout().lock();
            let mut stderr = io::stderr().lock();
            stdout.write_all(&output.stdout)?;
            stderr.write_all(&output.stderr)?;
            stdout.flush()?;
            stderr.flush()?;
            output.status
        }
    };
    drop(job);
    Ok(status.code().unwrap_or(1))
}

pub(crate) fn run(arguments: &[String], mode: Mode) -> i32 {
    let result = mcp_sessions::Session::start().and_then(|_session| {
        let programs = Programs::resolve(None)?;
        for path in [&programs.cli, &programs.package] {
            if !path.is_file() {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("Deckmate package file not found: {}", path.display()),
                ));
            }
        }
        let runtime = tokio::runtime::Runtime::new()?;
        runtime.block_on(wait(&programs, arguments, mode))
    });
    match result {
        Ok(code) => code,
        Err(error) => {
            let locale = settings::system_locale();
            let language = if locale.to_lowercase().starts_with("ru") {
                "ru"
            } else {
                "en"
            };
            if error.kind() == io::ErrorKind::WouldBlock {
                eprintln!("{}", texts::text(language, "mcpUpdateInProgress"));
            } else {
                eprintln!(
                    "{}",
                    texts::format(language, "mcpStartFailed", "error", error)
                );
            }
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::OsStr, path::PathBuf};

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).into()).collect()
    }

    #[test]
    fn recognizes_only_the_early_mcp_command_and_keeps_its_tail() {
        let full = args(&[
            "Deckmate.exe",
            "mcp",
            "--data",
            "project with spaces",
            "--member",
            "glm",
            "--check",
        ]);
        assert_eq!(arguments(&full), Some(&full[2..]));
        assert_eq!(arguments(&args(&["Deckmate.exe", "mcp"])), Some(&[][..]));
        assert_eq!(arguments(&args(&["Deckmate.exe", "--self-test"])), None);
        assert_eq!(arguments(&args(&["Deckmate.exe", "other", "mcp"])), None);
        assert_eq!(arguments(&args(&["Deckmate.exe"])), None);
    }

    #[test]
    fn selects_proxy_output_only_for_check() {
        assert_eq!(mode(&args(&[])), Mode::Protocol);
        assert_eq!(mode(&args(&["--data", "demo"])), Mode::Protocol);
        assert_eq!(mode(&args(&["--check"])), Mode::Check);
        assert_eq!(mode(&args(&["--data", "demo", "--check"])), Mode::Check);
        assert_eq!(mode(&args(&["--check=true"])), Mode::Protocol);
    }

    #[test]
    fn preserves_project_environment_and_removes_node_loading_hooks() {
        let entries = [
            "PATH",
            "DECKMATE_DATA",
            "deckmate_member",
            "DECKMATE_INDEX",
            "DECKMATE_WRITE",
            "FreeTion_DATA",
            "DECKMATE_PORT",
            "DECKMATE_SHUTDOWN_STDIN",
            "NODE_OPTIONS",
            "node_path",
            "OPENSSL_CONF",
            "openssl_modules",
        ]
        .map(|key| (key.into(), "value".into()));
        let kept = server::filter_env(entries, EXCLUDED_ENV_PREFIXES);
        assert_eq!(
            kept.iter()
                .map(|(key, _)| key.to_str().unwrap())
                .collect::<Vec<_>>(),
            [
                "PATH",
                "DECKMATE_DATA",
                "deckmate_member",
                "DECKMATE_INDEX",
                "DECKMATE_WRITE",
                "FreeTion_DATA",
                "DECKMATE_PORT",
                "DECKMATE_SHUTDOWN_STDIN",
            ]
        );
    }

    #[test]
    fn uses_shared_node_cli_and_package_paths_without_changing_the_working_directory() {
        let programs = Programs::resolve(None).unwrap();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        assert_eq!(programs.cli, root.join("bin/deckmate.mjs"));
        assert_eq!(programs.package, root.join("package.json"));
        let command = command(&programs, &args(&["--data", "demo"]), Mode::Protocol);
        let command = command.as_std();
        assert_eq!(command.get_program(), programs.node.as_os_str());
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            [
                programs.cli.as_os_str(),
                OsStr::new("mcp"),
                OsStr::new("--data"),
                OsStr::new("demo"),
            ]
        );
        assert_eq!(command.get_current_dir(), None);
    }
}
