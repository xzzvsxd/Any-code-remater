use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::SystemTime;

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;

use super::models::JsonlEntry;
use super::paths::get_claude_dir;
use crate::utils::jsonl_tail::read_jsonl_line_window_from_end;

const MAX_HISTORY_PAGE_LIMIT: usize = 1000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHistoryPage {
    pub messages: Vec<Value>,
    pub next_offset: usize,
    pub returned_messages: usize,
    pub has_more_before: bool,
}

/// Extracts the timestamp of the last message (user or assistant) from a JSONL file
#[allow(dead_code)]
pub fn extract_last_message_timestamp<P: AsRef<Path>>(jsonl_path: P) -> Option<String> {
    let file = match fs::File::open(jsonl_path) {
        Ok(file) => file,
        Err(_) => return None,
    };

    let reader = BufReader::new(file);
    let mut last_timestamp: Option<String> = None;

    for line in reader.lines() {
        if let Ok(line) = line {
            if let Ok(entry) = serde_json::from_str::<JsonlEntry>(&line) {
                // Check if this entry has a message (user or assistant)
                if entry.message.is_some() {
                    // Update last_timestamp if this entry has a timestamp
                    if let Some(timestamp) = entry.timestamp {
                        last_timestamp = Some(timestamp);
                    }
                }
            }
        }
    }

    last_timestamp
}

/// Extracts the model used in the session from a JSONL file
/// Looks for model information in system init messages or assistant messages
#[allow(dead_code)]
pub fn extract_session_model<P: AsRef<Path>>(jsonl_path: P) -> Option<String> {
    let file = match fs::File::open(jsonl_path) {
        Ok(file) => file,
        Err(_) => return None,
    };

    let reader = BufReader::new(file);
    let mut last_model: Option<String> = None;

    for line in reader.lines() {
        if let Ok(line) = line {
            // Try to parse as a generic JSON value first
            if let Ok(entry) = serde_json::from_str::<Value>(&line) {
                // Check for model in different locations:
                // 1. System init message: { "type": "system", "model": "..." }
                // 2. Assistant message: { "type": "assistant", "message": { "model": "..." } }

                if let Some(model_str) = entry.get("model").and_then(|m| m.as_str()) {
                    last_model = Some(model_str.to_string());
                } else if let Some(message) = entry.get("message") {
                    if let Some(model_str) = message.get("model").and_then(|m| m.as_str()) {
                        last_model = Some(model_str.to_string());
                    }
                }
            }
        }
    }

    last_model
}

/// Loads the JSONL history for a specific session
/// Also loads subagent messages from agent-*.jsonl files and merges them
pub fn load_session_history(session_id: &str, project_id: &str) -> Result<Vec<Value>, String> {
    log::info!(
        "Loading session history for session: {} in project: {}",
        session_id,
        project_id
    );

    let claude_dir = get_claude_dir().map_err(|e| e.to_string())?;
    let project_dir = claude_dir.join("projects").join(project_id);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));

    if !session_path.exists() {
        return Err(format!("Session file not found: {}", session_id));
    }

    // Get file modification time as base timestamp
    let file_metadata =
        fs::metadata(&session_path).map_err(|e| format!("Failed to read file metadata: {}", e))?;
    let base_time = file_metadata
        .modified()
        .unwrap_or_else(|_| SystemTime::now());

    let file =
        fs::File::open(&session_path).map_err(|e| format!("Failed to open session file: {}", e))?;

    let reader = BufReader::new(file);
    let mut messages = Vec::new();

    // Step 1: Load main session messages and build agentId -> tool_use_id mapping
    let mut agent_to_tool_use_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for line in reader.lines() {
        if let Ok(line) = line {
            if let Ok(json) = serde_json::from_str::<Value>(&line) {
                // Check for tool_result with agentId to build mapping
                if let Some(content) = json
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_array())
                {
                    for item in content {
                        if item.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                            // Get tool_use_id and agentId from toolUseResult
                            if let (Some(tool_use_id), Some(agent_id)) = (
                                item.get("tool_use_id").and_then(|t| t.as_str()),
                                json.get("toolUseResult")
                                    .and_then(|r| r.get("agentId"))
                                    .and_then(|a| a.as_str()),
                            ) {
                                log::debug!(
                                    "Found agentId mapping: {} -> {}",
                                    agent_id,
                                    tool_use_id
                                );
                                agent_to_tool_use_id
                                    .insert(agent_id.to_string(), tool_use_id.to_string());
                            }
                        }
                    }
                }
                messages.push(json);
            }
        }
    }

    log::info!(
        "Found {} agent-to-tool_use_id mappings",
        agent_to_tool_use_id.len()
    );

    // Step 2: Load subagent messages from agent-*.jsonl files
    if !agent_to_tool_use_id.is_empty() {
        if let Ok(entries) = fs::read_dir(&project_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    // Match agent-*.jsonl files
                    if file_name.starts_with("agent-") && file_name.ends_with(".jsonl") {
                        // Extract agentId from filename (e.g., "agent-aa740fde.jsonl" -> "aa740fde")
                        let agent_id = file_name
                            .strip_prefix("agent-")
                            .and_then(|s| s.strip_suffix(".jsonl"))
                            .unwrap_or("");

                        // Check if this agent belongs to our session
                        if let Some(tool_use_id) = agent_to_tool_use_id.get(agent_id) {
                            log::info!(
                                "Loading subagent file: {} for tool_use_id: {}",
                                file_name,
                                tool_use_id
                            );

                            // Load subagent messages
                            if let Ok(file) = fs::File::open(&path) {
                                let reader = BufReader::new(file);
                                for line in reader.lines() {
                                    if let Ok(line) = line {
                                        if let Ok(mut json) = serde_json::from_str::<Value>(&line) {
                                            // Verify this subagent belongs to our session
                                            let subagent_session_id =
                                                json.get("sessionId").and_then(|s| s.as_str());
                                            if subagent_session_id == Some(session_id) {
                                                // Add parent_tool_use_id to link subagent messages to Task
                                                json["parent_tool_use_id"] =
                                                    Value::String(tool_use_id.clone());
                                                messages.push(json);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Step 3: Add display timestamps to historical messages that don't have them.
    //
    // IMPORTANT: Do not sort loaded JSONL entries here. Claude/Codex/Gemini
    // histories are append-only event logs, so file order is the conversation
    // order. Some user prompt entries do not carry a top-level `timestamp`;
    // sorting by timestamp moves all of those prompts to the beginning and makes
    // long histories look like "all prompts first, all answers later".
    apply_fallback_display_timestamps(&mut messages, base_time);

    log::info!(
        "Loaded {} total messages (including subagent messages)",
        messages.len()
    );
    Ok(messages)
}

/// Loads one window of a Claude JSONL history from the end of the main session
/// file. This is the fast path used by the conversation detail view: it avoids
/// parsing and transferring thousands of historical entries before the first
/// paint. `offset` counts physical non-empty JSONL lines already loaded from
/// the end of the main session file.
pub fn load_session_history_page(
    session_id: &str,
    project_id: &str,
    offset: usize,
    limit: usize,
) -> Result<SessionHistoryPage, String> {
    log::info!(
        "Loading session history page for session: {} in project: {}, offset={}, limit={}",
        session_id,
        project_id,
        offset,
        limit
    );

    let claude_dir = get_claude_dir().map_err(|e| e.to_string())?;
    let project_dir = claude_dir.join("projects").join(project_id);
    let session_path = project_dir.join(format!("{}.jsonl", session_id));

    if !session_path.exists() {
        return Err(format!("Session file not found: {}", session_id));
    }

    let file_metadata =
        fs::metadata(&session_path).map_err(|e| format!("Failed to read file metadata: {}", e))?;
    let base_time = file_metadata
        .modified()
        .unwrap_or_else(|_| SystemTime::now());

    let safe_limit = limit.min(MAX_HISTORY_PAGE_LIMIT);
    if safe_limit == 0 {
        return Ok(SessionHistoryPage {
            messages: Vec::new(),
            next_offset: offset,
            returned_messages: 0,
            has_more_before: false,
        });
    }

    let line_window = read_jsonl_line_window_from_end(&session_path, offset, safe_limit)
        .map_err(|e| format!("Failed to read session history page: {}", e))?;

    let mut messages = parse_jsonl_values(&line_window.lines);

    // Keep the initial system:init available on the first page so model/cwd
    // metadata and the "system initializing" display are not lost when only the
    // recent tail is loaded.
    if offset == 0 {
        if let Some(init_message) = extract_first_init_message(&session_path) {
            if !messages.iter().any(|message| message == &init_message) {
                messages.insert(0, init_message);
            }
        }
    }

    // Load only subagent details that can actually be grouped by Task calls in
    // the current page. The old full loader scanned every agent file for every
    // history open; doing that for the first paint is exactly what made large
    // sessions feel frozen.
    let task_tool_use_ids = extract_task_tool_use_ids(&messages);
    if !task_tool_use_ids.is_empty() {
        let agent_to_tool_use_id = extract_agent_mapping_from_messages(&messages);
        append_matching_subagent_messages(
            &mut messages,
            &project_dir,
            session_id,
            &agent_to_tool_use_id,
            &task_tool_use_ids,
        );
    }

    apply_fallback_display_timestamps(&mut messages, base_time);

    let returned_messages = messages.len();
    let next_offset = offset.saturating_add(line_window.selected_line_count);

    log::info!(
        "Loaded session page: {} messages, next_offset={}, has_more_before={}",
        returned_messages,
        next_offset,
        line_window.has_more_before
    );

    Ok(SessionHistoryPage {
        messages,
        next_offset,
        returned_messages,
        has_more_before: line_window.has_more_before,
    })
}

fn parse_jsonl_values(lines: &[String]) -> Vec<Value> {
    lines
        .iter()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect()
}

fn extract_first_init_message(session_path: &Path) -> Option<Value> {
    let file = fs::File::open(session_path).ok()?;
    let reader = BufReader::new(file);

    for line in reader.lines().map_while(Result::ok) {
        let Ok(json) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let is_init = json.get("type").and_then(|t| t.as_str()) == Some("system")
            && json.get("subtype").and_then(|s| s.as_str()) == Some("init");

        if is_init {
            return Some(json);
        }
    }

    None
}

fn extract_task_tool_use_ids(messages: &[Value]) -> HashSet<String> {
    let mut task_tool_use_ids = HashSet::new();

    for json in messages {
        if let Some(content) = json
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        {
            for item in content {
                let is_task_tool = item.get("type").and_then(|t| t.as_str()) == Some("tool_use")
                    && item
                        .get("name")
                        .and_then(|name| name.as_str())
                        .map(|name| name.eq_ignore_ascii_case("task"))
                        .unwrap_or(false);

                if is_task_tool {
                    if let Some(id) = item.get("id").and_then(|id| id.as_str()) {
                        task_tool_use_ids.insert(id.to_string());
                    }
                }
            }
        }
    }

    task_tool_use_ids
}

fn extract_agent_mapping_from_messages(messages: &[Value]) -> HashMap<String, String> {
    let mut agent_to_tool_use_id = HashMap::new();

    for json in messages {
        if let Some(content) = json
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        {
            for item in content {
                if item.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                    if let (Some(tool_use_id), Some(agent_id)) = (
                        item.get("tool_use_id").and_then(|t| t.as_str()),
                        json.get("toolUseResult")
                            .and_then(|r| r.get("agentId"))
                            .and_then(|a| a.as_str()),
                    ) {
                        agent_to_tool_use_id
                            .insert(agent_id.to_string(), tool_use_id.to_string());
                    }
                }
            }
        }
    }

    agent_to_tool_use_id
}

fn append_matching_subagent_messages(
    messages: &mut Vec<Value>,
    project_dir: &Path,
    session_id: &str,
    agent_to_tool_use_id: &HashMap<String, String>,
    page_task_tool_use_ids: &HashSet<String>,
) {
    if agent_to_tool_use_id.is_empty() {
        return;
    }

    let Ok(entries) = fs::read_dir(project_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        if !file_name.starts_with("agent-") || !file_name.ends_with(".jsonl") {
            continue;
        }

        let agent_id = file_name
            .strip_prefix("agent-")
            .and_then(|name| name.strip_suffix(".jsonl"))
            .unwrap_or("");

        let Some(tool_use_id) = agent_to_tool_use_id.get(agent_id) else {
            continue;
        };

        if !page_task_tool_use_ids.contains(tool_use_id) {
            continue;
        }

        let Ok(file) = fs::File::open(&path) else {
            continue;
        };
        let reader = BufReader::new(file);

        for line in reader.lines().map_while(Result::ok) {
            if let Ok(mut json) = serde_json::from_str::<Value>(&line) {
                let subagent_session_id = json.get("sessionId").and_then(|s| s.as_str());
                if subagent_session_id == Some(session_id) {
                    json["parent_tool_use_id"] = Value::String(tool_use_id.clone());
                    messages.push(json);
                }
            }
        }
    }
}

fn apply_fallback_display_timestamps(messages: &mut [Value], base_time: SystemTime) {
    let messages_count = messages.len();
    for (i, message) in messages.iter_mut().enumerate() {
        let message_type = message.get("type").and_then(|t| t.as_str()).unwrap_or("");

        // Calculate timestamp for this message (5 second intervals, older messages get earlier timestamps)
        let time_offset = (messages_count - i - 1) as u64 * 5; // 5 seconds between messages
        let message_time = base_time - std::time::Duration::from_secs(time_offset);
        let timestamp_iso = DateTime::<Utc>::from(message_time).to_rfc3339();

        // Set appropriate timestamp fields based on message type, only if they don't exist
        match message_type {
            "user" => {
                if !message.get("sentAt").is_some() {
                    message["sentAt"] = Value::String(timestamp_iso.clone());
                }
            }
            "assistant" | "system" | "result" => {
                if !message.get("receivedAt").is_some() {
                    message["receivedAt"] = Value::String(timestamp_iso.clone());
                }
            }
            _ => {
                // For unknown types, add receivedAt
                if !message.get("receivedAt").is_some() {
                    message["receivedAt"] = Value::String(timestamp_iso.clone());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_fallback_display_timestamps, extract_agent_mapping_from_messages,
        extract_task_tool_use_ids,
    };
    use serde_json::json;
    use std::time::{Duration, SystemTime};

    fn message_text(message: &serde_json::Value) -> String {
        message
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(|content| content.as_array())
            .and_then(|content| content.first())
            .and_then(|item| item.get("text"))
            .and_then(|text| text.as_str())
            .unwrap_or("")
            .to_string()
    }

    #[test]
    fn fallback_timestamps_preserve_jsonl_order_when_prompts_have_no_timestamp() {
        let mut messages = vec![
            json!({"type":"user","message":{"content":[{"type":"text","text":"prompt 1"}]}}),
            json!({"type":"assistant","timestamp":"2026-01-01T00:00:02.000Z","message":{"content":[{"type":"text","text":"answer 1"}]}}),
            json!({"type":"user","message":{"content":[{"type":"text","text":"prompt 2"}]}}),
            json!({"type":"assistant","timestamp":"2026-01-01T00:00:04.000Z","message":{"content":[{"type":"text","text":"answer 2"}]}}),
        ];

        apply_fallback_display_timestamps(
            &mut messages,
            SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000),
        );

        let labels = messages.iter().map(message_text).collect::<Vec<_>>();
        assert_eq!(labels, vec!["prompt 1", "answer 1", "prompt 2", "answer 2"]);
        assert!(messages[0].get("sentAt").and_then(|value| value.as_str()).is_some());
        assert!(messages[1].get("receivedAt").and_then(|value| value.as_str()).is_some());
    }

    #[test]
    fn extracts_only_task_tool_use_ids_for_page_subagent_loading() {
        let messages = vec![json!({
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "tool_use", "name": "Read", "id": "read-1"},
                    {"type": "tool_use", "name": "Task", "id": "task-1"}
                ]
            }
        })];

        let ids = extract_task_tool_use_ids(&messages);

        assert!(ids.contains("task-1"));
        assert!(!ids.contains("read-1"));
    }

    #[test]
    fn extracts_agent_mapping_from_tool_result_messages() {
        let messages = vec![json!({
            "type": "user",
            "toolUseResult": {"agentId": "agent-a"},
            "message": {
                "content": [
                    {"type": "tool_result", "tool_use_id": "task-1"}
                ]
            }
        })];

        let mapping = extract_agent_mapping_from_messages(&messages);

        assert_eq!(mapping.get("agent-a"), Some(&"task-1".to_string()));
    }
}
