#[cfg(windows)]
mod platform {
    use std::io;
    use windows::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
    };

    pub struct Job(HANDLE);
    // 2026-11-09: a Job handle is process-wide; only its owner closes it after the child is reaped.
    unsafe impl Send for Job {}

    impl Job {
        pub fn attach(child: &tokio::process::Child) -> io::Result<Self> {
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
                let handle = child
                    .raw_handle()
                    .ok_or_else(|| io::Error::other("Child exited before Job assignment"))?;
                AssignProcessToJobObject(job.0, HANDLE(handle))?;
                Ok(job)
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
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
        let mut child = tokio::process::Command::new("node")
            .args(["-e", "setInterval(() => {}, 1000)"])
            .creation_flags(windows::Win32::System::Threading::CREATE_NO_WINDOW.0)
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let job = Job::attach(&child).unwrap();
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
    pub fn attach(_: &tokio::process::Child) -> std::io::Result<Self> {
        Ok(Self)
    }
}
