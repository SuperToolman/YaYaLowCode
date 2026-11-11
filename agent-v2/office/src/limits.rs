//! The parent applies wall time/output limits; native memory and CPU limits live here.
#[cfg(windows)]
pub struct Limits(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl Drop for Limits {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
#[cfg(windows)]
pub fn install() -> anyhow::Result<Limits> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{JobObjects::*, Threading::GetCurrentProcess},
    };
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        anyhow::ensure!(!job.is_null(), "office_resource_limit_unavailable");
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_PROCESS_TIME;
        info.BasicLimitInformation.PerProcessUserTimeLimit = 10 * 10_000_000;
        info.ProcessMemoryLimit = 512 * 1024 * 1024;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of_val(&info) as u32,
        ) == 0
            || AssignProcessToJobObject(job, GetCurrentProcess()) == 0
        {
            CloseHandle(job);
            anyhow::bail!("office_resource_limit_unavailable");
        }
        Ok(Limits(job))
    }
}
#[cfg(unix)]
pub fn install() -> anyhow::Result<()> {
    unsafe {
        let memory = libc::rlimit {
            rlim_cur: 512 * 1024 * 1024,
            rlim_max: 512 * 1024 * 1024,
        };
        let cpu = libc::rlimit {
            rlim_cur: 10,
            rlim_max: 10,
        };
        anyhow::ensure!(
            libc::setrlimit(libc::RLIMIT_AS, &memory) == 0
                && libc::setrlimit(libc::RLIMIT_CPU, &cpu) == 0,
            "office_resource_limit_unavailable"
        );
    }
    Ok(())
}
