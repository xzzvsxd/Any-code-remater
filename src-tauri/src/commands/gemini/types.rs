//! Gemini CLI Type Definitions
//!
//! This module defines all types used for Gemini CLI integration,
//! including stream events, execution options, and configuration.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ============================================================================
// Stream Event Types (from --output-format stream-json)
// ============================================================================

/// Raw Gemini event from JSONL stream
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RawGeminiEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(flatten)]
    pub data: serde_json::Value,
}

/// Gemini CLI stream event - represents a single line of JSONL output
#[derive(Debug, Clone, Serialize)]
pub enum GeminiStreamEvent {
    /// Session initialization event
    Init {
        session_id: Option<String>,
        model: Option<String>,
        timestamp: Option<String>,
    },

    /// User or assistant message
    Message {
        role: String,
        content: String,
        delta: bool,
        timestamp: Option<String>,
    },

    /// Tool use request
    ToolUse {
        tool_name: String,
        tool_id: String,
        parameters: serde_json::Value,
        timestamp: Option<String>,
    },

    /// Tool execution result
    ToolResult {
        tool_id: String,
        status: String,
        output: Value,
        timestamp: Option<String>,
    },

    /// Error event (non-fatal)
    Error {
        error_type: Option<String>,
        message: String,
        code: Option<i32>,
    },

    /// Final result with statistics
    Result {
        status: String,
        stats: Option<GeminiStats>,
        /// Optional Gemini API usage metadata (when present in output)
        usage_metadata: Option<TokenUsage>,
        timestamp: Option<String>,
    },
}

impl GeminiStreamEvent {
    /// Parse from raw JSON value
    pub fn from_json(value: &serde_json::Value) -> Option<Self> {
        let event_type = value.get("type")?.as_str()?;

        match event_type {
            "init" => Some(Self::Init {
                session_id: value
                    .get("session_id")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                model: value
                    .get("model")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                timestamp: value
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            }),
            "message" => Some(Self::Message {
                role: value
                    .get("role")
                    .and_then(|v| v.as_str())
                    .unwrap_or("assistant")
                    .to_string(),
                content: value
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                delta: value
                    .get("delta")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                timestamp: value
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            }),
            "tool_use" => Some(Self::ToolUse {
                tool_name: value
                    .get("tool_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                tool_id: value
                    .get("tool_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                parameters: value
                    .get("parameters")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
                timestamp: value
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            }),
            "tool_result" => Some(Self::ToolResult {
                tool_id: value
                    .get("tool_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                status: value
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                // output 可能是字符串或对象，需要完整保留结构以便前端渲染（如 functionResponse）
                output: value
                    .get("output")
                    .cloned()
                    // 一些 Gemini 变体会把结果放在 response 字段
                    .or_else(|| value.get("response").cloned())
                    .unwrap_or(Value::Null),
                timestamp: value
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            }),
            "error" => Some(Self::Error {
                error_type: value
                    .get("error_type")
                    .or(value.get("type"))
                    .and_then(|v| v.as_str())
                    .map(String::from),
                message: value
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Unknown error")
                    .to_string(),
                code: value.get("code").and_then(|v| v.as_i64()).map(|n| n as i32),
            }),
            "result" => Some(Self::Result {
                status: value
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                stats: value
                    .get("stats")
                    .and_then(|v| serde_json::from_value(v.clone()).ok()),
                usage_metadata: value
                    .get("usageMetadata")
                    .or_else(|| value.get("usage_metadata"))
                    .or_else(|| value.get("usage"))
                    .and_then(|v| serde_json::from_value(v.clone()).ok()),
                timestamp: value
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            }),
            _ => None,
        }
    }
}

/// Statistics from Gemini CLI execution
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct GeminiStats {
    pub total_tokens: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub duration_ms: Option<u64>,
    pub tool_calls: Option<u32>,
}

// ============================================================================
// Token Usage Types
// ============================================================================

/// Token usage / usageMetadata returned by Gemini APIs (and token summaries in Gemini CLI history)
///
/// This struct is intentionally flexible and supports multiple naming conventions:
/// - Gemini API: `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`, ...
/// - Some SDKs / logs: `prompt_token_count`, `candidates_token_count`, ...
/// - Gemini CLI aggregated tokens: `prompt`, `candidates`, `total`, `cached`, `thoughts`, `tool`
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct TokenUsage {
    /// Prompt/input token count
    #[serde(
        rename = "promptTokenCount",
        alias = "prompt_token_count",
        alias = "prompt"
    )]
    pub prompt_token_count: Option<u64>,

    /// Candidate/output token count (excludes thinking tokens in some APIs)
    #[serde(
        rename = "candidatesTokenCount",
        alias = "candidates_token_count",
        alias = "candidates"
    )]
    pub candidates_token_count: Option<u64>,

    /// Total token count (prompt + output + other categories)
    #[serde(
        rename = "totalTokenCount",
        alias = "total_token_count",
        alias = "total"
    )]
    pub total_token_count: Option<u64>,

    /// Cached content token count (subset of prompt tokens)
    #[serde(
        rename = "cachedContentTokenCount",
        alias = "cached_content_token_count",
        alias = "cached"
    )]
    pub cached_content_token_count: Option<u64>,

    /// Thinking/reasoning token count
    #[serde(
        rename = "thoughtsTokenCount",
        alias = "thoughts_token_count",
        alias = "thoughts"
    )]
    pub thoughts_token_count: Option<u64>,

    /// Tool-use prompt tokens
    #[serde(
        rename = "toolUsePromptTokenCount",
        alias = "tool_use_prompt_token_count",
        alias = "tool"
    )]
    pub tool_use_prompt_token_count: Option<u64>,
}

// ============================================================================
// Execution Options
// ============================================================================

/// Gemini CLI execution options
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiExecutionOptions {
    /// Project/working directory path
    pub project_path: String,

    /// User prompt
    pub prompt: String,

    /// Model to use (e.g., "gemini-2.5-pro", "gemini-2.5-flash")
    pub model: Option<String>,

    /// Approval mode: "auto_edit" or "yolo"
    pub approval_mode: Option<String>,

    /// Additional directories to include in context
    pub include_directories: Option<Vec<String>>,

    /// Session ID for resuming (if supported)
    pub session_id: Option<String>,

    /// Enable debug mode
    #[serde(default)]
    pub debug: bool,

    /// Frontend tab id used to scope early global events before the runtime session id is known.
    pub tab_id: Option<String>,
}

impl Default for GeminiExecutionOptions {
    fn default() -> Self {
        Self {
            project_path: String::new(),
            prompt: String::new(),
            model: Some("gemini-2.5-pro".to_string()),
            approval_mode: Some("auto_edit".to_string()),
            include_directories: None,
            session_id: None,
            debug: false,
            tab_id: None,
        }
    }
}

// ============================================================================
// Session Types
// ============================================================================

/// Gemini session metadata
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiSession {
    /// Session ID
    pub id: String,

    /// Project path
    pub project_path: String,

    /// Model used
    pub model: String,

    /// Creation timestamp
    pub created_at: u64,

    /// Last updated timestamp
    pub updated_at: u64,

    /// Session status
    pub status: String,

    /// First user message
    pub first_message: Option<String>,
}

// ============================================================================
// Process State
// ============================================================================

use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Child;
use tokio::sync::Mutex;

use crate::commands::wsl_utils;
use crate::process::JobObject;

/// Gemini process handle with PID for proper cleanup
pub struct GeminiProcessHandle {
    pub child: Child,
    pub pid: u32,
    /// Windows Job Object (kills all child processes when dropped); no-op on non-Windows.
    pub job_object: Option<JobObject>,
    #[cfg(target_os = "windows")]
    pub wsl_spec: Option<wsl_utils::WslCommandSpec>,
}

impl GeminiProcessHandle {
    pub async fn terminate(mut self, reason: &str) {
        log::info!(
            "[Gemini] Terminating process PID {} for {}",
            self.pid,
            reason
        );

        let mut terminated_via_job = false;
        #[cfg(target_os = "windows")]
        if let Some(spec) = self.wsl_spec.as_ref() {
            match wsl_utils::build_wsl_termination_command(spec, self.pid, reason) {
                Ok(mut termination_cmd) => match termination_cmd.output() {
                    Ok(output) if output.status.success() => {
                        log::info!(
                            "[Gemini] Terminated WSL-side process for host PID {}",
                            self.pid
                        );
                    }
                    Ok(output) => {
                        log::warn!(
                            "[Gemini] WSL-side termination command failed for host PID {}: {}",
                            self.pid,
                            String::from_utf8_lossy(&output.stderr)
                        );
                    }
                    Err(e) => {
                        log::warn!(
                            "[Gemini] Failed to run WSL-side termination for host PID {}: {}",
                            self.pid,
                            e
                        );
                    }
                },
                Err(e) => {
                    log::warn!(
                        "[Gemini] Refused unsafe WSL-side termination for host PID {}: {}",
                        self.pid,
                        e
                    );
                }
            }
        }

        if let Some(job) = self.job_object.as_ref() {
            match job.terminate_all(1) {
                Ok(_) => {
                    terminated_via_job = true;
                    log::info!("[Gemini] Terminated Job Object for PID {}", self.pid);
                }
                Err(e) => {
                    log::warn!(
                        "[Gemini] Failed to terminate Job Object for PID {}: {}",
                        self.pid,
                        e
                    );
                }
            }
        }

        if !terminated_via_job {
            // Windows：没有 JobObject 身份时，拒绝裸 taskkill /F /T /PID。
            // taskkill /T 会按进程树杀，若 self.pid 已被 OS 复用，会误杀无关进程树。
            // 与 Claude registry 的策略对齐：无身份校验则只杀直接 child 句柄。
            #[cfg(target_os = "windows")]
            {
                if self.wsl_spec.is_some() {
                    log::warn!(
                        "[Gemini] Refusing unsafe Windows taskkill fallback for WSL host PID {}",
                        self.pid
                    );
                } else {
                    log::warn!(
                        "[Gemini] No JobObject for PID {}; refusing unsafe taskkill /T, killing direct child only",
                        self.pid
                    );
                }
                if let Err(e2) = self.child.kill().await {
                    log::error!(
                        "[Gemini] Fallback child.kill failed for PID {}: {}",
                        self.pid,
                        e2
                    );
                }
                return;
            }

            // Unix：进程在独立进程组中，kill_process_group 内部已校验 pid==pgid（组长身份），
            // 不会误杀其它进程组，安全。
            #[cfg(not(target_os = "windows"))]
            if let Err(e) = crate::commands::claude::kill_process_tree(self.pid) {
                log::warn!(
                    "[Gemini] Failed to terminate process tree for PID {}: {}",
                    self.pid,
                    e
                );
                if let Err(e2) = self.child.kill().await {
                    log::error!(
                        "[Gemini] Fallback child.kill failed for PID {}: {}",
                        self.pid,
                        e2
                    );
                }
            }
        }
    }
}

/// Global state to track Gemini processes
pub struct GeminiProcessState {
    pub processes: Arc<Mutex<HashMap<String, GeminiProcessHandle>>>,
    pub last_session_id: Arc<Mutex<Option<String>>>,
}

impl Default for GeminiProcessState {
    fn default() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            last_session_id: Arc::new(Mutex::new(None)),
        }
    }
}

// ============================================================================
// Installation Status
// ============================================================================

/// Gemini CLI installation status
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiInstallStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

// ============================================================================
// Session History Types (for reading Gemini CLI history from ~/.gemini/tmp)
// ============================================================================

/// Session log entry from logs.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiSessionLog {
    pub session_id: String,
    pub message_id: i32,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub message: String,
    pub timestamp: String,
}

/// Complete session detail from chats/session-*.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiSessionDetail {
    pub session_id: String,
    pub project_hash: String,
    pub start_time: String,
    pub last_updated: String,
    pub messages: Vec<serde_json::Value>,
}

/// Session file info (simplified for listing)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiSessionInfo {
    pub session_id: String,
    pub file_name: String,
    pub start_time: String,
    pub first_message: Option<String>,
}
