#[cfg(windows)]
mod platform {
    use std::{io, marker::PhantomData, rc::Rc};
    use windows::{
        core::{PCWSTR, PWSTR},
        Win32::{
            Foundation::{
                CloseHandle, LocalFree, ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_FILES, HANDLE, HLOCAL,
                WAIT_ABANDONED, WAIT_OBJECT_0, WAIT_TIMEOUT,
            },
            Security::{
                Authorization::ConvertSidToStringSidW, GetTokenInformation, TokenUser, TOKEN_QUERY,
                TOKEN_USER,
            },
            System::{
                Diagnostics::ToolHelp::{
                    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                    TH32CS_SNAPPROCESS,
                },
                Threading::{
                    CreateMutexW, GetCurrentProcess, OpenMutexW, OpenProcessToken, ReleaseMutex,
                    WaitForSingleObject, SYNCHRONIZATION_SYNCHRONIZE,
                },
            },
        },
    };

    struct Handle(HANDLE);
    // 2026-11-12: marker handles have no thread ownership; closing the last handle removes the marker.
    unsafe impl Send for Handle {}

    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    struct RegistryLock {
        handle: Handle,
        // 2026-11-12: Win32 mutex ownership must be released on the acquiring thread, never across await.
        _thread: PhantomData<Rc<()>>,
    }

    impl Drop for RegistryLock {
        fn drop(&mut self) {
            unsafe {
                let _ = ReleaseMutex(self.handle.0);
            }
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    fn marker(name: &str) -> io::Result<Handle> {
        unsafe {
            Ok(Handle(CreateMutexW(
                None,
                false,
                PCWSTR(wide(name).as_ptr()),
            )?))
        }
    }

    fn exists(name: &str) -> io::Result<bool> {
        match unsafe {
            OpenMutexW(
                SYNCHRONIZATION_SYNCHRONIZE,
                false,
                PCWSTR(wide(name).as_ptr()),
            )
        } {
            Ok(handle) => {
                drop(Handle(handle));
                Ok(true)
            }
            Err(error) if error.code() == ERROR_FILE_NOT_FOUND.to_hresult() => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    fn lock(scope: &str) -> io::Result<RegistryLock> {
        let handle = marker(&format!("{scope}-registry"))?;
        match unsafe { WaitForSingleObject(handle.0, 5000) } {
            WAIT_OBJECT_0 | WAIT_ABANDONED => Ok(RegistryLock {
                handle,
                _thread: PhantomData,
            }),
            WAIT_TIMEOUT => Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "MCP registry lock timed out",
            )),
            _ => Err(io::Error::last_os_error()),
        }
    }

    fn scope() -> io::Result<String> {
        unsafe {
            let mut token = HANDLE::default();
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token)?;
            let token = Handle(token);
            let mut size = 0;
            let _ = GetTokenInformation(token.0, TokenUser, None, 0, &mut size);
            let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
            GetTokenInformation(
                token.0,
                TokenUser,
                Some(buffer.as_mut_ptr().cast()),
                size,
                &mut size,
            )?;
            let user = &*buffer.as_ptr().cast::<TOKEN_USER>();
            let mut sid = PWSTR::null();
            ConvertSidToStringSidW(user.User.Sid, &mut sid)?;
            let name = sid.to_string();
            let _ = LocalFree(Some(HLOCAL(sid.0.cast())));
            Ok(format!(
                "Local\\Deckmate-MCP-{}",
                name.map_err(io::Error::other)?
            ))
        }
    }

    fn processes() -> io::Result<Vec<(u32, String)>> {
        unsafe {
            let snapshot = Handle(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)?);
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            Process32FirstW(snapshot.0, &mut entry)?;
            let mut result = Vec::new();
            loop {
                let length = entry
                    .szExeFile
                    .iter()
                    .position(|value| *value == 0)
                    .unwrap_or(entry.szExeFile.len());
                result.push((
                    entry.th32ProcessID,
                    String::from_utf16_lossy(&entry.szExeFile[..length]),
                ));
                match Process32NextW(snapshot.0, &mut entry) {
                    Ok(()) => (),
                    Err(error) if error.code() == ERROR_NO_MORE_FILES.to_hresult() => break,
                    Err(error) => return Err(error.into()),
                }
            }
            Ok(result)
        }
    }

    fn installer_running(processes: &[(u32, String)]) -> bool {
        // 2026-11-12: the updater exits immediately after ShellExecuteW. Its installer process covers
        // the handoff and the entire installation after the shell's named marker has closed.
        processes.iter().any(|(_, name)| {
            let name = name.to_ascii_lowercase();
            name.strip_prefix("deckmate-")
                .and_then(|name| name.strip_suffix("-installer.exe"))
                .is_some_and(|version| {
                    !version.is_empty()
                        && version
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || b".-+".contains(&byte))
                })
        })
    }

    fn busy() -> io::Error {
        io::Error::new(
            io::ErrorKind::WouldBlock,
            "MCP update installation in progress",
        )
    }

    pub struct Session {
        _marker: Handle,
    }

    impl Session {
        pub fn start() -> io::Result<Self> {
            Self::start_in(&scope()?)
        }

        fn start_in(scope: &str) -> io::Result<Self> {
            let _lock = lock(scope)?;
            if exists(&format!("{scope}-installing"))? || installer_running(&processes()?) {
                return Err(busy());
            }
            Ok(Self {
                _marker: marker(&format!("{scope}-{}", std::process::id()))?,
            })
        }
    }

    pub struct Installation {
        _marker: Handle,
        pub sessions: usize,
    }

    impl Installation {
        pub fn begin() -> io::Result<Self> {
            Self::begin_in(&scope()?)
        }

        fn begin_in(scope: &str) -> io::Result<Self> {
            let _lock = lock(scope)?;
            let processes = processes()?;
            if exists(&format!("{scope}-installing"))? || installer_running(&processes) {
                return Err(busy());
            }
            let mut sessions = 0;
            for (pid, _) in &processes {
                if exists(&format!("{scope}-{pid}"))? {
                    sessions += 1;
                }
            }
            Ok(Self {
                _marker: marker(&format!("{scope}-installing"))?,
                sessions,
            })
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{
            io::{BufRead, BufReader, Write},
            process::{Child, Command, Stdio},
            sync::atomic::{AtomicU64, Ordering},
        };

        fn isolated_scope() -> String {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            format!(
                "{}-test-{}-{}",
                scope().unwrap(),
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            )
        }

        #[test]
        fn counts_live_sessions_and_blocks_new_sessions_until_installation_is_dropped() {
            let scope = isolated_scope();
            let session = Session::start_in(&scope).unwrap();
            let installation = Installation::begin_in(&scope).unwrap();
            assert_eq!(installation.sessions, 1);
            assert_eq!(
                Session::start_in(&scope).err().unwrap().kind(),
                io::ErrorKind::WouldBlock
            );
            assert_eq!(
                Installation::begin_in(&scope).err().unwrap().kind(),
                io::ErrorKind::WouldBlock
            );
            drop(installation);
            drop(session);
            let installation = Installation::begin_in(&scope).unwrap();
            assert_eq!(installation.sessions, 0);
            drop(installation);
            assert!(Session::start_in(&scope).is_ok());
        }

        struct SessionProcess(Child);

        impl SessionProcess {
            fn start(scope: &str) -> Self {
                let mut child = Self(
                    Command::new(std::env::current_exe().unwrap())
                        .args([
                            "--exact",
                            "mcp_sessions::platform::tests::session_process_fixture",
                            "--nocapture",
                        ])
                        .env("DECKMATE_TEST_MCP_SCOPE", scope)
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .spawn()
                        .unwrap(),
                );
                let output = BufReader::new(child.0.stdout.take().unwrap());
                let ready = output
                    .lines()
                    .any(|line| line.unwrap().ends_with("mcp-marker-ready"));
                assert!(ready, "session fixture exited without registering");
                child
            }
        }

        impl Drop for SessionProcess {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }

        #[test]
        fn session_process_fixture() {
            let Ok(scope) = std::env::var("DECKMATE_TEST_MCP_SCOPE") else {
                return;
            };
            let _session = Session::start_in(&scope).unwrap();
            println!("mcp-marker-ready");
            io::stdout().flush().unwrap();
            let mut input = String::new();
            io::stdin().read_line(&mut input).unwrap();
        }

        #[test]
        fn counts_distinct_processes_and_releases_markers_after_a_hard_kill() {
            let scope = isolated_scope();
            let first = SessionProcess::start(&scope);
            let second = SessionProcess::start(&scope);
            let installation = Installation::begin_in(&scope).unwrap();
            assert_eq!(installation.sessions, 2);
            drop(installation);
            drop(first);
            let installation = Installation::begin_in(&scope).unwrap();
            assert_eq!(installation.sessions, 1);
            drop(installation);
            drop(second);
            assert_eq!(Installation::begin_in(&scope).unwrap().sessions, 0);
        }

        #[test]
        fn registration_and_installation_race_never_misses_a_started_session() {
            let scope = isolated_scope();
            let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
            let session = std::thread::spawn({
                let scope = scope.clone();
                let barrier = barrier.clone();
                move || {
                    barrier.wait();
                    Session::start_in(&scope)
                }
            });
            barrier.wait();
            let installation = Installation::begin_in(&scope).unwrap();
            match session.join().unwrap() {
                Ok(_session) => assert_eq!(installation.sessions, 1),
                Err(error) => {
                    assert_eq!(error.kind(), io::ErrorKind::WouldBlock);
                    assert_eq!(installation.sessions, 0);
                }
            }
        }

        #[test]
        fn updater_process_covers_the_marker_handoff_without_matching_the_app() {
            assert!(installer_running(&[(
                1,
                "Deckmate-0.7.2-installer.exe".into()
            )]));
            assert!(installer_running(&[(
                1,
                "Deckmate-0.7.2-rc.1-installer.exe".into()
            )]));
            assert!(!installer_running(&[
                (1, "Deckmate.exe".into()),
                (2, "node.exe".into()),
                (3, "other-installer.exe".into())
            ]));
        }
    }
}

#[cfg(windows)]
pub use platform::{Installation, Session};

#[cfg(not(windows))]
pub struct Session;
#[cfg(not(windows))]
impl Session {
    pub fn start() -> std::io::Result<Self> {
        Ok(Self)
    }
}
#[cfg(not(windows))]
pub struct Installation {
    pub sessions: usize,
}
#[cfg(not(windows))]
impl Installation {
    pub fn begin() -> std::io::Result<Self> {
        Ok(Self { sessions: 0 })
    }
}
