#[cfg(windows)]
mod platform {
    use std::io;
    use windows::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD,
                THREADENTRY32,
            },
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::{
                OpenThread, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
            },
        },
    };

    pub struct Job(HANDLE);
    // 2026-11-09: a Job handle is process-wide; only its owner closes it after the child is reaped.
    unsafe impl Send for Job {}

    impl Job {
        pub fn spawn(
            command: &mut tokio::process::Command,
        ) -> io::Result<(tokio::process::Child, Self)> {
            let (mut child, job) = Self::spawn_suspended(command)?;
            if let Err(error) = resume(
                child
                    .id()
                    .ok_or_else(|| io::Error::other("Missing child PID"))?,
            ) {
                let _ = child.start_kill();
                return Err(error);
            }
            Ok((child, job))
        }

        fn spawn_suspended(
            command: &mut tokio::process::Command,
        ) -> io::Result<(tokio::process::Child, Self)> {
            unsafe {
                let job = Self(CreateJobObjectW(None, None)?);
                let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const _,
                    std::mem::size_of_val(&limits) as u32,
                )?;
                // 2026-11-12: Node must not execute or create descendants before kill-on-close applies.
                let mut child = command
                    .creation_flags(CREATE_NO_WINDOW.0 | CREATE_SUSPENDED.0)
                    .spawn()?;
                let result = (|| {
                    let handle = child
                        .raw_handle()
                        .ok_or_else(|| io::Error::other("Child exited before Job assignment"))?;
                    AssignProcessToJobObject(job.0, HANDLE(handle)).map_err(io::Error::from)
                })();
                if let Err(error) = result {
                    let _ = child.start_kill();
                    return Err(error);
                }
                Ok((child, job))
            }
        }
    }

    fn resume(pid: u32) -> io::Result<()> {
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0)?;
            let result = (|| {
                let mut entry = THREADENTRY32 {
                    dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
                    ..Default::default()
                };
                Thread32First(snapshot, &mut entry)?;
                loop {
                    if entry.th32OwnerProcessID == pid {
                        let thread = OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID)?;
                        let resumed = ResumeThread(thread);
                        let error = io::Error::last_os_error();
                        let _ = CloseHandle(thread);
                        if resumed == u32::MAX {
                            return Err(error);
                        }
                        return Ok(());
                    }
                    Thread32Next(snapshot, &mut entry)?;
                }
            })();
            let _ = CloseHandle(snapshot);
            result
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[tokio::test]
        async fn suspended_creation_assigns_the_exact_job_before_the_first_instruction() {
            let (mut child, job) = Job::spawn_suspended(
                tokio::process::Command::new("node")
                    .args(["-e", "process.exit(42)"])
                    .kill_on_drop(true),
            )
            .unwrap();
            let mut in_job = windows::core::BOOL::default();
            unsafe {
                windows::Win32::System::JobObjects::IsProcessInJob(
                    HANDLE(child.raw_handle().unwrap()),
                    Some(job.0),
                    &mut in_job,
                )
                .unwrap();
            }
            assert!(in_job.as_bool());
            assert!(child.try_wait().unwrap().is_none());
            resume(child.id().unwrap()).unwrap();
            let status = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(status.code(), Some(42));
        }
    }
}

#[cfg(windows)]
pub use platform::Job;

#[cfg(all(test, windows))]
mod tests {
    use super::Job;

    #[tokio::test]
    async fn closing_job_kills_a_child_without_cooperative_shutdown() {
        let (mut child, job) = Job::spawn(
            tokio::process::Command::new("node")
                .args(["-e", "setInterval(() => {}, 1000)"])
                .kill_on_drop(true),
        )
        .unwrap();
        let mut in_job = windows::core::BOOL::default();
        unsafe {
            windows::Win32::System::JobObjects::IsProcessInJob(
                windows::Win32::Foundation::HANDLE(child.raw_handle().unwrap()),
                None,
                &mut in_job,
            )
            .unwrap();
        }
        assert!(in_job.as_bool());
        assert!(child.try_wait().unwrap().is_none());
        drop(job);
        // 2026-11-09: Windows can report exit code 0 for kill-on-close; bounded exit proves cleanup.
        tokio::time::timeout(std::time::Duration::from_secs(5), child.wait())
            .await
            .unwrap()
            .unwrap();
    }
}

#[cfg(not(windows))]
pub struct Job;

#[cfg(not(windows))]
impl Job {
    pub fn spawn(
        command: &mut tokio::process::Command,
    ) -> std::io::Result<(tokio::process::Child, Self)> {
        Ok((command.spawn()?, Self))
    }
}
