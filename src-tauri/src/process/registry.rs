use super::JobObject;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::process::{Child, ChildStdin};

/// live_output 缓冲上限（4MB）。超出时按 \n 边界丢弃旧数据，
/// 避免长会话内存无限膨胀，同时按行边界 drain 规避 UTF-8 多字节切片 panic。
const MAX_LIVE_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

fn trim_live_output_buffer(live_output: &mut String) {
    while live_output.len() > MAX_LIVE_OUTPUT_BYTES {
        let target = live_output.len() / 2;
        // char_indices 保证 drain_to 一定落在 UTF-8 字符边界；优先按换行边界丢弃旧数据。
        let drain_to = live_output
            .char_indices()
            .find_map(|(idx, ch)| (idx >= target && ch == '\n').then_some(idx + ch.len_utf8()))
            .unwrap_or_else(|| {
                // 极端情况：超大单行输出没有换行。退化为按字符边界丢弃前半段，避免内存无限增长。
                live_output
                    .char_indices()
                    .find_map(|(idx, _)| (idx >= target).then_some(idx))
                    .unwrap_or_else(|| live_output.len())
            });

        if drain_to == 0 {
            break;
        }
        live_output.drain(..drain_to);
    }
}

/// Type of process being tracked
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ProcessType {
    AgentRun { agent_id: i64, agent_name: String },
    ClaudeSession { session_id: String },
}

/// Information about a running agent process
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub run_id: i64,
    pub process_type: ProcessType,
    pub pid: u32,
    pub started_at: DateTime<Utc>,
    pub project_path: String,
    pub task: String,
    pub model: String,
}

/// Information about a running process with handle
#[allow(dead_code)]
pub struct ProcessHandle {
    pub info: ProcessInfo,
    pub child: Arc<Mutex<Option<Child>>>,
    pub live_output: Arc<Mutex<String>>,
    /// 持久化流式会话的 stdin 写入端（仅流式模式下存在）。
    /// 用于"随时插话"：向常驻进程写入新的 stream-json user 消息，而不重启进程。
    pub stream_stdin: Arc<tokio::sync::Mutex<Option<ChildStdin>>>,
    #[cfg(windows)]
    pub job_object: Option<Arc<JobObject>>, // Job object for automatic cleanup on Windows
}

/// Registry for tracking active agent processes
pub struct ProcessRegistry {
    processes: Arc<Mutex<HashMap<i64, ProcessHandle>>>, // run_id -> ProcessHandle
    next_id: Arc<Mutex<i64>>, // Auto-incrementing ID for non-agent processes
}

impl ProcessRegistry {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(1000000)), // Start at high number to avoid conflicts
        }
    }

    /// Generate a unique ID for non-agent processes
    pub fn generate_id(&self) -> Result<i64, String> {
        let mut next_id = self.next_id.lock().map_err(|e| e.to_string())?;
        let id = *next_id;
        *next_id += 1;
        Ok(id)
    }

    /// Register a new running agent process
    #[allow(dead_code)]
    pub fn register_process(
        &self,
        run_id: i64,
        agent_id: i64,
        agent_name: String,
        pid: u32,
        project_path: String,
        task: String,
        model: String,
        child: Child,
    ) -> Result<(), String> {
        let process_info = ProcessInfo {
            run_id,
            process_type: ProcessType::AgentRun {
                agent_id,
                agent_name,
            },
            pid,
            started_at: Utc::now(),
            project_path,
            task,
            model,
        };

        self.register_process_internal(run_id, process_info, child)
    }

    /// Register a new Claude session (without child process - handled separately)
    /// DEPRECATED: Use register_claude_session_with_job instead for proper child process cleanup
    #[allow(dead_code)]
    pub fn register_claude_session(
        &self,
        session_id: String,
        pid: u32,
        project_path: String,
        task: String,
        model: String,
    ) -> Result<i64, String> {
        // Call the new function with no pre-created job object (will create one here)
        #[cfg(windows)]
        {
            self.register_claude_session_with_job(session_id, pid, project_path, task, model, None)
        }
        #[cfg(not(windows))]
        {
            self.register_claude_session_with_job(session_id, pid, project_path, task, model, None)
        }
    }

    /// Register a new Claude session with an optional pre-created Job Object
    ///
    /// 🔧 FIX: This function accepts a pre-created Job Object that was created immediately
    /// after spawning the Claude process. This ensures all child processes (including MCP
    /// node processes) are added to the Job Object and will be terminated when the session ends.
    ///
    /// If no Job Object is provided, one will be created here (legacy behavior, but may miss
    /// child processes that were already started).
    #[cfg(windows)]
    pub fn register_claude_session_with_job(
        &self,
        session_id: String,
        pid: u32,
        project_path: String,
        task: String,
        model: String,
        pre_created_job: Option<Arc<JobObject>>,
    ) -> Result<i64, String> {
        let run_id = self.generate_id()?;

        let process_info = ProcessInfo {
            run_id,
            process_type: ProcessType::ClaudeSession { session_id },
            pid,
            started_at: Utc::now(),
            project_path,
            task,
            model,
        };

        let mut processes = self.processes.lock().map_err(|e| e.to_string())?;

        // Use pre-created Job Object if provided, otherwise create one here (legacy fallback)
        let job_object = if let Some(job) = pre_created_job {
            log::info!(
                "🔧 FIX: Using pre-created Job Object for process {} (child processes included)",
                pid
            );
            Some(job)
        } else {
            // Legacy fallback: create Job Object here (may miss already-started child processes)
            log::warn!(
                "Creating Job Object late for process {} - child processes may not be included",
                pid
            );
            match JobObject::create() {
                Ok(job) => match job.assign_process_by_pid(pid) {
                    Ok(_) => {
                        log::info!(
                            "Assigned process {} to Job Object for automatic cleanup",
                            pid
                        );
                        Some(Arc::new(job))
                    }
                    Err(e) => {
                        log::warn!("Failed to assign process {} to Job Object: {}", pid, e);
                        None
                    }
                },
                Err(e) => {
                    log::warn!("Failed to create Job Object: {}", e);
                    None
                }
            }
        };

        let process_handle = ProcessHandle {
            info: process_info,
            child: Arc::new(Mutex::new(None)),
            live_output: Arc::new(Mutex::new(String::new())),
            stream_stdin: Arc::new(tokio::sync::Mutex::new(None)),
            job_object,
        };

        processes.insert(run_id, process_handle);
        Ok(run_id)
    }

    /// Register a new Claude session with an optional pre-created Job Object (non-Windows version)
    #[cfg(not(windows))]
    pub fn register_claude_session_with_job(
        &self,
        session_id: String,
        pid: u32,
        project_path: String,
        task: String,
        model: String,
        _pre_created_job: Option<()>,
    ) -> Result<i64, String> {
        let run_id = self.generate_id()?;

        let process_info = ProcessInfo {
            run_id,
            process_type: ProcessType::ClaudeSession { session_id },
            pid,
            started_at: Utc::now(),
            project_path,
            task,
            model,
        };

        let mut processes = self.processes.lock().map_err(|e| e.to_string())?;

        let process_handle = ProcessHandle {
            info: process_info,
            child: Arc::new(Mutex::new(None)),
            live_output: Arc::new(Mutex::new(String::new())),
            stream_stdin: Arc::new(tokio::sync::Mutex::new(None)),
        };

        processes.insert(run_id, process_handle);
        Ok(run_id)
    }

    /// Internal method to register any process
    #[allow(dead_code)]
    fn register_process_internal(
        &self,
        run_id: i64,
        process_info: ProcessInfo,
        child: Child,
    ) -> Result<(), String> {
        let mut processes = self.processes.lock().map_err(|e| e.to_string())?;

        // Create Job Object on Windows for automatic process cleanup
        #[cfg(windows)]
        let job_object = {
            let pid = process_info.pid;
            match JobObject::create() {
                Ok(job) => {
                    // Assign the process to the job
                    match job.assign_process_by_pid(pid) {
                        Ok(_) => {
                            log::info!(
                                "Assigned process {} to Job Object for automatic cleanup",
                                pid
                            );
                            Some(Arc::new(job))
                        }
                        Err(e) => {
                            log::warn!("Failed to assign process {} to Job Object: {}", pid, e);
                            None
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Failed to create Job Object: {}", e);
                    None
                }
            }
        };

        let process_handle = ProcessHandle {
            info: process_info,
            child: Arc::new(Mutex::new(Some(child))),
            live_output: Arc::new(Mutex::new(String::new())),
            stream_stdin: Arc::new(tokio::sync::Mutex::new(None)),
            #[cfg(windows)]
            job_object,
        };

        processes.insert(run_id, process_handle);
        Ok(())
    }

    /// Get all running Claude sessions
    pub fn get_running_claude_sessions(&self) -> Result<Vec<ProcessInfo>, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        Ok(processes
            .values()
            .filter_map(|handle| match &handle.info.process_type {
                ProcessType::ClaudeSession { .. } => Some(handle.info.clone()),
                _ => None,
            })
            .collect())
    }

    /// Get a specific Claude session by session ID
    pub fn get_claude_session_by_id(
        &self,
        session_id: &str,
    ) -> Result<Option<ProcessInfo>, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        Ok(processes
            .values()
            .find(|handle| match &handle.info.process_type {
                ProcessType::ClaudeSession { session_id: sid } => sid == session_id,
                _ => false,
            })
            .map(|handle| handle.info.clone()))
    }

    /// Update the Claude session id for an already-registered process.
    ///
    /// Used when a resumed Claude process is registered immediately with the
    /// known resume id so early cancellation can work, then Claude emits the
    /// authoritative session id in `system:init`.
    pub fn update_claude_session_id(&self, run_id: i64, session_id: String) -> Result<(), String> {
        let mut processes = self.processes.lock().map_err(|e| e.to_string())?;
        let handle = processes
            .get_mut(&run_id)
            .ok_or_else(|| format!("Process {} not found in registry", run_id))?;

        match &mut handle.info.process_type {
            ProcessType::ClaudeSession { session_id: sid } => {
                *sid = session_id;
                Ok(())
            }
            _ => Err(format!("Process {} is not a Claude session", run_id)),
        }
    }

    /// Unregister a process (called when it completes)
    #[allow(dead_code)]
    pub fn unregister_process(&self, run_id: i64) -> Result<(), String> {
        let mut processes = self.processes.lock().map_err(|e| e.to_string())?;
        processes.remove(&run_id);
        Ok(())
    }

    /// Get all running processes
    #[allow(dead_code)]
    pub fn get_running_processes(&self) -> Result<Vec<ProcessInfo>, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        Ok(processes
            .values()
            .map(|handle| handle.info.clone())
            .collect())
    }

    /// Get all running agent processes
    #[allow(dead_code)]
    pub fn get_running_agent_processes(&self) -> Result<Vec<ProcessInfo>, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        Ok(processes
            .values()
            .filter_map(|handle| match &handle.info.process_type {
                ProcessType::AgentRun { .. } => Some(handle.info.clone()),
                _ => None,
            })
            .collect())
    }

    /// Get a specific running process
    #[allow(dead_code)]
    pub fn get_process(&self, run_id: i64) -> Result<Option<ProcessInfo>, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        Ok(processes.get(&run_id).map(|handle| handle.info.clone()))
    }

    /// Kill a running process with proper cleanup
    pub async fn kill_process(&self, run_id: i64) -> Result<bool, String> {
        use log::{error, info, warn};

        // First check if the process exists and get its PID
        #[cfg_attr(unix, allow(unused_variables))]
        let (pid, child_arc) = {
            let processes = self.processes.lock().map_err(|e| e.to_string())?;
            if let Some(handle) = processes.get(&run_id) {
                (handle.info.pid, handle.child.clone())
            } else {
                warn!("Process {} not found in registry", run_id);
                return Ok(false); // Process not found
            }
        };

        info!(
            "Attempting graceful shutdown of process {} (PID: {})",
            run_id, pid
        );

        #[cfg(unix)]
        {
            // 优先走「安全的按进程组终止」。仅在其成功时直接返回；
            // 若被安全校验拒绝（pid 非自身进程组组长）或失败，则不再直接返回，
            // 而是继续往下回退到「只杀直接 child 句柄」——既避免误杀其它软件，又不漏杀本进程。
            match self.kill_process_by_pid(run_id, pid) {
                Ok(true) => return Ok(true),
                Ok(false) => {
                    warn!(
                        "Safe process-group kill refused or failed for process {} (PID: {}); falling back to direct child kill only",
                        run_id, pid
                    );
                }
                Err(e) => {
                    warn!(
                        "Safe process-group kill errored for process {} (PID: {}): {}; falling back to direct child kill only",
                        run_id, pid, e
                    );
                }
            }
        }

        #[cfg(target_os = "windows")]
        {
            let job_object = {
                let processes = self.processes.lock().map_err(|e| e.to_string())?;
                processes
                    .get(&run_id)
                    .and_then(|handle| handle.job_object.clone())
            };

            if let Some(job) = job_object {
                info!("Terminating Windows JobObject for process {}", run_id);
                match job.terminate_all(1) {
                    Ok(_) => {
                        self.unregister_process(run_id)?;
                        return Ok(true);
                    }
                    Err(e) => {
                        warn!(
                            "Failed to terminate JobObject for process {} (PID {}): {}",
                            run_id, pid, e
                        );
                    }
                }
            }

            // Do not pre-emptively walk/kill by ParentProcessId.  Without a
            // creation-time identity check, PID reuse can turn a child-tree
            // fallback into a cross-application kill.  Prefer JobObject; if it
            // is unavailable, only the original child handle is signalled below.
        }

        // Send kill signal to the process
        let kill_sent = {
            let mut child_guard = child_arc.lock().map_err(|e| e.to_string())?;
            if let Some(child) = child_guard.as_mut() {
                match child.start_kill() {
                    Ok(_) => {
                        info!("Successfully sent kill signal to process {}", run_id);
                        true
                    }
                    Err(e) => {
                        error!("Failed to send kill signal to process {}: {}", run_id, e);
                        // Don't return error here, try fallback method
                        false
                    }
                }
            } else {
                warn!(
                    "No child handle available for process {} (PID: {}), attempting system kill",
                    run_id, pid
                );
                false // Process handle not available, try fallback
            }
        };

        // If direct kill didn't work, try system command as fallback
        if !kill_sent {
            info!(
                "Attempting fallback kill for process {} (PID: {})",
                run_id, pid
            );
            match self.kill_process_by_pid(run_id, pid) {
                Ok(true) => return Ok(true),
                Ok(false) => warn!(
                    "Fallback kill also failed for process {} (PID: {})",
                    run_id, pid
                ),
                Err(e) => error!("Error during fallback kill: {}", e),
            }
            // Continue with the rest of the cleanup even if fallback failed
        }

        // Wait for the process to exit (with timeout)
        let wait_result = tokio::time::timeout(tokio::time::Duration::from_secs(5), async {
            loop {
                // Check if process has exited
                let status = {
                    let mut child_guard = child_arc.lock().map_err(|e| e.to_string())?;
                    if let Some(child) = child_guard.as_mut() {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                info!("Process {} exited with status: {:?}", run_id, status);
                                *child_guard = None; // Clear the child handle
                                Some(Ok::<(), String>(()))
                            }
                            Ok(None) => {
                                // Still running
                                None
                            }
                            Err(e) => {
                                error!("Error checking process status: {}", e);
                                Some(Err(e.to_string()))
                            }
                        }
                    } else {
                        // Process already gone
                        Some(Ok(()))
                    }
                };

                match status {
                    Some(result) => return result,
                    None => {
                        // Still running, wait a bit
                        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                    }
                }
            }
        })
        .await;

        match wait_result {
            Ok(Ok(_)) => {
                info!("Process {} exited gracefully", run_id);
            }
            Ok(Err(e)) => {
                error!("Error waiting for process {}: {}", run_id, e);
            }
            Err(_) => {
                warn!("Process {} didn't exit within 5 seconds after kill", run_id);
                // Force clear the handle
                if let Ok(mut child_guard) = child_arc.lock() {
                    *child_guard = None;
                }
                // One more attempt with system kill
                let _ = self.kill_process_by_pid(run_id, pid);
            }
        }

        // Remove from registry after killing
        self.unregister_process(run_id)?;

        Ok(true)
    }

    /// Kill a process by PID using system commands (fallback method)
    pub fn kill_process_by_pid(&self, run_id: i64, pid: u32) -> Result<bool, String> {
        use log::{info, warn};

        info!("Attempting to kill process {} by PID {}", run_id, pid);

        #[cfg(target_os = "windows")]
        {
            let job_object = {
                let processes = self.processes.lock().map_err(|e| e.to_string())?;
                processes
                    .get(&run_id)
                    .and_then(|handle| handle.job_object.clone())
            };

            if let Some(job) = job_object {
                match job.terminate_all(1) {
                    Ok(_) => {
                        info!("Successfully terminated JobObject for process {}", run_id);
                        self.unregister_process(run_id)?;
                        return Ok(true);
                    }
                    Err(e) => {
                        warn!(
                            "Failed to terminate JobObject for process {} (PID {}): {}",
                            run_id, pid, e
                        );
                    }
                }
            }

            warn!(
                "Refusing unsafe taskkill fallback for process {} (PID {}) without JobObject identity",
                run_id, pid
            );
            Ok(false)
        }

        #[cfg(not(target_os = "windows"))]
        {
            // On Unix, AI CLI roots are started in their own process group.
            // Kill only the registered pgid; never use a name-based fallback.
            match crate::process::kill_process_group(pid) {
                Ok(_) => {
                    info!("Successfully killed process group {}", pid);
                    self.unregister_process(run_id)?;
                    Ok(true)
                }
                Err(e) => {
                    warn!("Failed to kill process group {}: {}", pid, e);
                    Ok(false)
                }
            }
        }
    }

    /// Check if a process is still running by trying to get its status
    #[allow(dead_code)]
    pub async fn is_process_running(&self, run_id: i64) -> Result<bool, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;

        if let Some(handle) = processes.get(&run_id) {
            let child_arc = handle.child.clone();
            drop(processes); // Release the lock before async operation

            let mut child_guard = child_arc.lock().map_err(|e| e.to_string())?;
            if let Some(ref mut child) = child_guard.as_mut() {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        // Process has exited
                        *child_guard = None;
                        Ok(false)
                    }
                    Ok(None) => {
                        // Process is still running
                        Ok(true)
                    }
                    Err(_) => {
                        // Error checking status, assume not running
                        *child_guard = None;
                        Ok(false)
                    }
                }
            } else {
                Ok(false) // No child handle
            }
        } else {
            Ok(false) // Process not found in registry
        }
    }

    /// Append to live output for a process
    pub fn append_live_output(&self, run_id: i64, output: &str) -> Result<(), String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = processes.get(&run_id) {
            let mut live_output = handle.live_output.lock().map_err(|e| e.to_string())?;
            live_output.push_str(output);
            live_output.push('\n');
            trim_live_output_buffer(&mut live_output);
        }
        Ok(())
    }

    /// 保存某进程的 stdin 写入端（持久化流式会话用）。
    /// 传入已包在 Arc<tokio::Mutex> 中的 stdin，便于 spawn 处与 registry 共享同一句柄。
    pub fn set_stream_stdin(&self, run_id: i64, stdin: ChildStdin) -> Result<(), String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = processes.get(&run_id) {
            // 用 try_lock 即可：此时尚无并发写入
            if let Ok(mut guard) = handle.stream_stdin.try_lock() {
                *guard = Some(stdin);
                Ok(())
            } else {
                Err("stream_stdin is locked".to_string())
            }
        } else {
            Err(format!("Process {} not found in registry", run_id))
        }
    }

    /// 按 session_id 取出 stdin 写入端的 Arc 克隆（不持有 std Mutex 跨 await）。
    /// 返回 None 表示该会话不存在或非流式（无常驻 stdin）。
    pub fn get_stream_stdin_by_session(
        &self,
        session_id: &str,
    ) -> Result<Option<Arc<tokio::sync::Mutex<Option<ChildStdin>>>>, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        Ok(processes
            .values()
            .find(|handle| match &handle.info.process_type {
                ProcessType::ClaudeSession { session_id: sid } => sid == session_id,
                _ => false,
            })
            .map(|handle| handle.stream_stdin.clone()))
    }

    /// Get live output for a process
    pub fn get_live_output(&self, run_id: i64) -> Result<String, String> {
        let processes = self.processes.lock().map_err(|e| e.to_string())?;
        if let Some(handle) = processes.get(&run_id) {
            let live_output = handle.live_output.lock().map_err(|e| e.to_string())?;
            Ok(live_output.clone())
        } else {
            Ok(String::new())
        }
    }

    /// Cleanup finished processes
    #[allow(dead_code)]
    pub async fn cleanup_finished_processes(&self) -> Result<Vec<i64>, String> {
        let mut finished_runs = Vec::new();
        let processes_lock = self.processes.clone();

        // First, collect all process IDs (lock released immediately)
        let run_ids: Vec<i64> = {
            let processes = processes_lock.lock().map_err(|e| e.to_string())?;
            processes.keys().cloned().collect()
        }; // ✅ Lock is released here, before any await points

        // Then check each process (no lock held during async operations)
        for run_id in run_ids {
            if !self.is_process_running(run_id).await? {
                finished_runs.push(run_id);
            }
        }

        // Then remove them from the registry
        {
            let mut processes = processes_lock.lock().map_err(|e| e.to_string())?;
            for run_id in &finished_runs {
                processes.remove(run_id);
            }
        }

        Ok(finished_runs)
    }

    /// Kill all registered processes (for application shutdown)
    /// This is a critical cleanup function to prevent orphaned processes
    pub async fn kill_all_processes(&self) -> Result<usize, String> {
        use log::{info, warn};

        info!("Starting cleanup of all registered processes for application shutdown");

        // Get all run IDs with their PIDs
        let process_info: Vec<(i64, u32)> = {
            let processes = self.processes.lock().map_err(|e| e.to_string())?;
            processes
                .iter()
                .map(|(id, handle)| (*id, handle.info.pid))
                .collect()
        };

        let total_processes = process_info.len();
        info!("Found {} processes to cleanup", total_processes);

        let mut killed_count = 0;

        // Kill registered processes only.  On Unix this targets the isolated
        // process group; on Windows the process/job tree is terminated.
        for (run_id, _pid) in process_info {
            match self.kill_process(run_id).await {
                Ok(true) => {
                    info!("Successfully killed process {}", run_id);
                    killed_count += 1;
                }
                Ok(false) => {
                    warn!("Process {} was not found or already exited", run_id);
                }
                Err(e) => {
                    warn!("Failed to kill process {}: {}", run_id, e);
                }
            }
        }

        // Never perform process-name based cleanup here.  It can terminate
        // unrelated user applications (for example another `claude` binary on
        // Linux).  Only registered PIDs/PGIDs/JobObjects are in scope.

        info!(
            "Cleanup complete: killed {}/{} processes",
            killed_count, total_processes
        );
        Ok(killed_count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trim_live_output_buffer_handles_multibyte_boundaries() {
        let mut buffer = "测".repeat(MAX_LIVE_OUTPUT_BYTES / 3 + 16);
        buffer.push('\n');
        buffer.push_str(&"试".repeat(MAX_LIVE_OUTPUT_BYTES / 3 + 16));

        trim_live_output_buffer(&mut buffer);

        assert!(buffer.is_char_boundary(buffer.len()));
        assert!(buffer.len() <= MAX_LIVE_OUTPUT_BYTES);
    }

    #[test]
    fn trim_live_output_buffer_keeps_small_output() {
        let mut buffer = "hello\nworld".to_string();
        trim_live_output_buffer(&mut buffer);
        assert_eq!(buffer, "hello\nworld");
    }
}

impl Default for ProcessRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Global process registry state
pub struct ProcessRegistryState(pub Arc<ProcessRegistry>);

impl Default for ProcessRegistryState {
    fn default() -> Self {
        Self(Arc::new(ProcessRegistry::new()))
    }
}

impl Drop for ProcessRegistryState {
    fn drop(&mut self) {
        // Do not block inside Drop.  During app/runtime shutdown, `block_on`
        // can panic or deadlock.  Per-session cancellation and platform
        // JobObject/process-group cleanup handle normal lifecycle.
        log::info!("ProcessRegistryState dropping; skipping async Drop cleanup");
    }
}
