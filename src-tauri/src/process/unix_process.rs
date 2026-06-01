//! Unix process isolation and termination helpers.
//!
//! Every AI CLI process that may spawn child processes should be started in its
//! own process group.  Cancellation can then target only that registered group
//! instead of guessing with process names such as `pkill claude`.

#[cfg(unix)]
pub fn apply_process_group(cmd: &mut tokio::process::Command) {
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

    let actual_pgid = get_process_group_id(pgid)?;
    ensure_process_group_leader(pgid, actual_pgid)?;

    let group_arg = format!("-{}", pgid);
    log::info!("Sending SIGTERM to process group {}", pgid);
    let term = Command::new("kill")
        .args(["-TERM", "--", &group_arg])
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
        .args(["-KILL", "--", &group_arg])
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

#[cfg(any(unix, test))]
fn ensure_process_group_leader(pid: u32, actual_pgid: u32) -> Result<(), String> {
    if pid == actual_pgid {
        return Ok(());
    }

    Err(format!(
        "refusing to kill process group for pid {} because its actual pgid {} does not match; the process was not isolated into its own group",
        pid, actual_pgid
    ))
}

#[cfg(any(target_os = "linux", test))]
fn parse_linux_proc_stat_pgrp(stat: &str) -> Result<u32, String> {
    let close_paren = stat
        .rfind(')')
        .ok_or_else(|| "invalid /proc stat: missing command terminator".to_string())?;
    let fields_after_comm = stat
        .get(close_paren + 1..)
        .ok_or_else(|| "invalid /proc stat: truncated after command".to_string())?
        .split_whitespace()
        .collect::<Vec<_>>();

    // /proc/<pid>/stat after the "(comm)" field starts with:
    // state, ppid, pgrp, session, ...
    let pgrp = fields_after_comm
        .get(2)
        .ok_or_else(|| "invalid /proc stat: missing pgrp field".to_string())?;

    pgrp.parse::<u32>()
        .map_err(|e| format!("invalid /proc stat pgrp value '{}': {}", pgrp, e))
}

#[cfg(target_os = "linux")]
fn get_process_group_id(pid: u32) -> Result<u32, String> {
    let stat_path = format!("/proc/{}/stat", pid);
    let stat = std::fs::read_to_string(&stat_path).map_err(|e| {
        format!(
            "failed to read {} before process-group kill: {}",
            stat_path, e
        )
    })?;

    parse_linux_proc_stat_pgrp(&stat)
}

#[cfg(all(unix, not(target_os = "linux")))]
fn get_process_group_id(pid: u32) -> Result<u32, String> {
    let output = std::process::Command::new("ps")
        .args(["-o", "pgid=", "-p", &pid.to_string()])
        .output()
        .map_err(|e| format!("failed to query pgid for pid {}: {}", pid, e))?;

    if !output.status.success() {
        return Err(format!(
            "failed to query pgid for pid {}: {}",
            pid,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .trim()
        .parse::<u32>()
        .map_err(|e| format!("invalid pgid output for pid {}: {:?}: {}", pid, stdout, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_linux_proc_stat_pgrp_when_command_contains_spaces() {
        let stat =
            "1234 (node helper test) S 4321 1234 1234 0 -1 4194560 1 2 3 4 5 6 7 8 20 0 1 0 100";

        assert_eq!(parse_linux_proc_stat_pgrp(stat).unwrap(), 1234);
    }

    #[test]
    fn rejects_group_kill_when_pid_is_not_group_leader() {
        let err = ensure_process_group_leader(1234, 4321).unwrap_err();

        assert!(err.contains("refusing to kill process group"));
        assert!(err.contains("pid 1234"));
        assert!(err.contains("pgid 4321"));
    }
}
