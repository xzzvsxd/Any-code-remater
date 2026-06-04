use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Represents a project in the ~/.claude/projects directory
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    /// The project ID (derived from the directory name)
    pub id: String,
    /// The original project path (decoded from the directory name)
    pub path: String,
    /// List of session IDs (JSONL file names without extension)
    pub sessions: Vec<String>,
    /// Unix timestamp of the latest activity (session modification or project creation)
    pub created_at: u64,
    /// 三引擎各自的会话数（Claude/Codex/Gemini）。
    /// sessions 字段仅含 Claude，无法反映项目下的 Codex/Gemini 会话；
    /// 此字段在 list_projects 的 command 层统一填充，供前端按引擎显示徽章。
    #[serde(default)]
    pub session_counts: SessionCounts,
}

/// 项目下按引擎统计的会话数
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionCounts {
    #[serde(default)]
    pub claude: u32,
    #[serde(default)]
    pub codex: u32,
    #[serde(default)]
    pub gemini: u32,
}

/// Represents a session with its metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    /// The session ID (UUID)
    pub id: String,
    /// The project ID this session belongs to
    pub project_id: String,
    /// The project path
    pub project_path: String,
    /// Optional todo data associated with this session
    pub todo_data: Option<Value>,
    /// Unix timestamp when the session file was created
    pub created_at: u64,
    /// First user message content (if available)
    pub first_message: Option<String>,
    /// Timestamp of the first user message (if available)
    pub message_timestamp: Option<String>,
    /// Timestamp of the last message in the session (if available) - ISO string
    pub last_message_timestamp: Option<String>,
    /// The model used in this session (if available)
    pub model: Option<String>,
}

/// Represents a message entry in the JSONL file
#[derive(Debug, Deserialize)]
pub struct JsonlEntry {
    #[serde(rename = "type")]
    #[allow(dead_code)]
    pub entry_type: Option<String>,
    pub message: Option<MessageContent>,
    pub timestamp: Option<String>,
}

/// Represents the message content
#[derive(Debug, Deserialize)]
pub struct MessageContent {
    pub role: Option<String>,
    pub content: Option<Value>, // Supports string and array formats
}

/// Represents the settings from ~/.claude/settings.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeSettings {
    #[serde(flatten)]
    pub data: Value,
}

impl Default for ClaudeSettings {
    fn default() -> Self {
        Self {
            data: serde_json::json!({}),
        }
    }
}

/// Represents the Claude Code version status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeVersionStatus {
    /// Whether Claude Code is installed and working
    pub is_installed: bool,
    /// The version string if available
    pub version: Option<String>,
    /// The full output from the command
    pub output: String,
}

/// Represents detected Claude Code CLI capabilities
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCapabilities {
    /// Whether the CLI supports `--input-format stream-json` (realtime streaming input).
    /// 决定能否做持久化流式会话（随时插话 / 真硬阻塞）。
    pub supports_stream_json_input: bool,
    /// The version string if available
    pub version: Option<String>,
}

/// Represents a CLAUDE.md file found in the project
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeMdFile {
    /// Relative path from the project root
    pub relative_path: String,
    /// Absolute path to the file
    pub absolute_path: String,
    /// File size in bytes
    pub size: u64,
    /// Last modified timestamp
    pub modified: u64,
}

/// Represents a file or directory entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    /// The name of the file or directory
    pub name: String,
    /// The full path
    pub path: String,
    /// Whether this is a directory
    pub is_directory: bool,
    /// File size in bytes (0 for directories)
    pub size: u64,
    /// File extension (if applicable)
    pub extension: Option<String>,
}
