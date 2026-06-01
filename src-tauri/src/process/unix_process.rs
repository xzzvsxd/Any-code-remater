//! Unix process isolation and termination helpers.
//!
//! Every AI CLI process that may spawn child processes should be started in its
//! own process group.  Cancellation can then target only that registered group
//! instead of guessing with process names such as `pkill claude`.

#[cfg(unix)]
pub fn apply_process_group(cmd: &mut tokio::process::Command) {
    use std::os::unix::process::CommandExt;

    // Make the child process the leader of a new process group.  With this
    // invariant, pid == pgid for the root process and kill(-pid, sig) targets
    // only descendants created for this run.
    cmd.process_group(0);
}

#[cfg(not(unix))]
pub fn apply_process_group(_cmd: &mut tokio::process::Command) {
    // Windows uses JobObject; no-op elsewhere.
}

#[cfg(unix)]
pub fn kill_process_group(pgid: u32) -> Result<(), String> {
    use std::process::Command;
    use std::time::Duration;

    if pgid == 0 {
        return Err("refusing to kill process group 0".to_string());
    }

    let group_arg = format!("-{}", pgid);
    log::info!("Sending SIGTERM to process group {}", pgid);
    let term = Command::new("kill")
        .args(["-TERM", &group_arg])
        .output()
        .map_err(|e| format!("failed to execute kill -TERM for pgid {}: {}", pgid, e))?;

    if !term.status.success() {
        let stderr = String::from_utf8_lossy(&term.stderr);
        log::warn!(
            "SIGTERM to process group {} failed (may already be gone): {}",
            pgid,
            stderr
        );
    }

    std::thread::sleep(Duration::from_millis(800));

    if !is_pid_running(pgid) {
        log::info!("Process group leader {} exited after SIGTERM", pgid);
        return Ok(());
    }

    log::warn!(
        "Process group leader {} still running after SIGTERM; sending SIGKILL",
        pgid
    );
    let kill = Command::new("kill")
        .args(["-KILL", &group_arg])
        .output()
        .map_err(|e| format!("failed to execute kill -KILL for pgid {}: {}", pgid, e))?;

    if kill.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&kill.stderr);
        Err(format!(
            "failed to kill process group {} with SIGKILL: {}",
            pgid, stderr
        ))
    }
}

#[cfg(not(unix))]
#[allow(dead_code)]
pub fn kill_process_group(_pgid: u32) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
pub fn is_pid_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }

    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(not(unix))]
#[allow(dead_code)]
pub fn is_pid_running(_pid: u32) -> bool {
    false
}
