use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

pub const CLAUDE_RUN_MARKER_ENV: &str = "ANY_CODE_CLAUDE_RUN_MARKER";
pub const CLAUDE_SESSION_ID_ENV: &str = "ANY_CODE_CLAUDE_SESSION_ID";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PersistedClaudeRun {
    pub run_id: i64,
    pub session_id: String,
    pub pid: u32,
    pub started_at: DateTime<Utc>,
    pub project_path: String,
    pub task: String,
    pub model: String,
    pub marker: String,
}

#[derive(Debug)]
pub struct PersistedClaudeRunStore {
    path: PathBuf,
}

impl PersistedClaudeRunStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load_all(&self) -> Result<Vec<PersistedClaudeRun>, String> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&self.path).map_err(|e| {
            format!(
                "failed to read persisted Claude runs {}: {}",
                self.path.display(),
                e
            )
        })?;

        if content.trim().is_empty() {
            return Ok(Vec::new());
        }

        serde_json::from_str::<Vec<PersistedClaudeRun>>(&content).map_err(|e| {
            format!(
                "failed to parse persisted Claude runs {}: {}",
                self.path.display(),
                e
            )
        })
    }

    pub fn upsert(&self, run: PersistedClaudeRun) -> Result<(), String> {
        let mut runs = self.load_all()?;
        if let Some(existing) = runs.iter_mut().find(|r| r.run_id == run.run_id) {
            *existing = run;
        } else if let Some(existing) = runs
            .iter_mut()
            .find(|r| !run.marker.is_empty() && r.marker == run.marker)
        {
            *existing = run;
        } else {
            runs.push(run);
        }
        self.save_all(&runs)
    }

    pub fn update_session_id(&self, run_id: i64, session_id: String) -> Result<(), String> {
        let mut runs = self.load_all()?;
        let mut changed = false;
        for run in &mut runs {
            if run.run_id == run_id {
                run.session_id = session_id.clone();
                changed = true;
            }
        }

        if changed {
            self.save_all(&runs)?;
        }
        Ok(())
    }

    pub fn remove(&self, run_id: i64) -> Result<(), String> {
        let mut runs = self.load_all()?;
        let original_len = runs.len();
        runs.retain(|r| r.run_id != run_id);

        if runs.len() == original_len {
            return Ok(());
        }

        if runs.is_empty() {
            match fs::remove_file(&self.path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(format!(
                    "failed to remove persisted Claude runs {}: {}",
                    self.path.display(),
                    e
                )),
            }
        } else {
            self.save_all(&runs)
        }
    }

    fn save_all(&self, runs: &[PersistedClaudeRun]) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "failed to create persisted Claude run directory {}: {}",
                    parent.display(),
                    e
                )
            })?;
        }

        let content = serde_json::to_string_pretty(runs)
            .map_err(|e| format!("failed to serialize persisted Claude runs: {}", e))?;
        let tmp_path = self.path.with_extension("json.tmp");

        fs::write(&tmp_path, content).map_err(|e| {
            format!(
                "failed to write persisted Claude runs temp {}: {}",
                tmp_path.display(),
                e
            )
        })?;
        fs::rename(&tmp_path, &self.path).map_err(|e| {
            format!(
                "failed to replace persisted Claude runs {}: {}",
                self.path.display(),
                e
            )
        })
    }
}

pub trait ClaudeProcessProbe {
    fn is_expected_claude_process(&self, pid: u32, marker: &str) -> bool;
}

pub struct SystemClaudeProcessProbe;

impl ClaudeProcessProbe for SystemClaudeProcessProbe {
    fn is_expected_claude_process(&self, pid: u32, marker: &str) -> bool {
        if pid == 0 || marker.trim().is_empty() {
            return false;
        }

        platform_process_has_marker(pid, marker)
    }
}

pub fn new_claude_run_marker() -> String {
    Uuid::new_v4().to_string()
}

#[cfg(target_os = "linux")]
fn platform_process_has_marker(pid: u32, marker: &str) -> bool {
    let environ_path = PathBuf::from(format!("/proc/{}/environ", pid));
    let bytes = match fs::read(environ_path) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    let needle = format!("{}={}", CLAUDE_RUN_MARKER_ENV, marker);
    bytes
        .split(|b| *b == 0)
        .any(|entry| entry == needle.as_bytes())
}

#[cfg(all(unix, not(target_os = "linux")))]
fn platform_process_has_marker(pid: u32, marker: &str) -> bool {
    let needle = format!("{}={}", CLAUDE_RUN_MARKER_ENV, marker);
    let output = match std::process::Command::new("ps")
        .arg("eww")
        .arg("-p")
        .arg(pid.to_string())
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return false,
    };

    String::from_utf8_lossy(&output.stdout).contains(&needle)
}

#[cfg(windows)]
fn platform_process_has_marker(_pid: u32, _marker: &str) -> bool {
    // Windows Claude runs are assigned to a JobObject with KILL_ON_JOB_CLOSE.
    // On normal app shutdown they should not survive, and Windows does not
    // expose another process' environment safely without invasive APIs.  Use a
    // conservative no-restore policy here instead of risking PID-reuse matches.
    false
}
