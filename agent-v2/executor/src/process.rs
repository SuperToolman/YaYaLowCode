//! Process tree ownership, not a filesystem sandbox.
use super::*;
/// Independent supervisor owns the process group. If the manager dies, its pipe closes
/// and the watchdog kills this group instead of leaving ordinary descendant processes.
/// Scripts can escape a process group; this is lifecycle cleanup, not a hostile-code sandbox.
#[cfg(unix)]
pub(super) fn supervise() -> ! {
    let mut arguments = std::env::args_os().skip(2);
    let Some(program) = arguments.next() else {
        std::process::exit(126)
    };
    std::thread::spawn(|| {
        use std::io::Read;
        let mut byte = [0u8; 1];
        loop {
            match std::io::stdin().read(&mut byte) {
                Ok(0) | Err(_) => unsafe {
                    libc::kill(-libc::getpgrp(), libc::SIGKILL);
                    break;
                },
                _ => {}
            }
        }
    });
    let status = std::process::Command::new(program)
        .args(arguments)
        .stdin(std::process::Stdio::null())
        .status();
    std::process::exit(status.ok().and_then(|s| s.code()).unwrap_or(126));
}
pub(super) fn configure(command: &mut Command) {
    command.kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
}
#[cfg(windows)]
pub(super) struct Tree(usize);
#[cfg(windows)]
impl Tree {
    pub(super) fn attach(pid: u32) -> Result<Self> {
        use windows_sys::Win32::{
            Foundation::*,
            System::{JobObjects::*, Threading::*},
        };
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                bail!("job object unavailable")
            }
            let owner = Self(job as usize);
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
            {
                bail!("job limits unavailable")
            }
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false as _, pid);
            if process.is_null() {
                bail!("child process unavailable")
            }
            let assigned = AssignProcessToJobObject(job, process);
            CloseHandle(process);
            if assigned == 0 {
                bail!("child process tree ownership unavailable")
            }
            Ok(owner)
        }
    }
}
#[cfg(windows)]
impl Drop for Tree {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0 as _);
        }
    }
}
#[cfg(unix)]
pub(super) struct Tree(u32);
#[cfg(unix)]
impl Tree {
    pub(super) fn attach(pid: u32) -> Result<Self> {
        Ok(Self(pid))
    }
}
#[cfg(unix)]
impl Drop for Tree {
    fn drop(&mut self) {
        unsafe {
            libc::kill(-(self.0 as i32), libc::SIGKILL);
        }
    }
}
pub(super) async fn terminate(pid: u32) {
    #[cfg(windows)]
    {
        let mut c = Command::new("taskkill");
        configure(&mut c);
        let _ = c
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}
