//! 跨会话内容的并行流式搜索。
//!
//! 前端把当前已加载的会话清单（含 id/engine/project 信息）传入，后端为每个会话
//! 并行读取其原始会话文件做不区分大小写的子串匹配；命中即通过 emit 单条吐回，
//! 前端流式 append，不阻塞 UI。搜索完成后 emit 结束事件。
//!
//! 设计取舍（KISS）：直接对会话文件原始文本做子串匹配即可满足"找内容"的诉求，
//! 不逐引擎做结构化解析——关键词只要出现在某条消息的内容里就能命中。

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use super::claude::{encode_project_path, get_claude_dir};
use super::codex::find_session_file as find_codex_session_file;
use super::codex::get_codex_sessions_dir;
use super::gemini::get_gemini_sessions_dir;

const SEARCH_CONCURRENCY: usize = 16;

/// 前端传入的待搜索会话条目（来自已加载的会话列表）。
#[derive(Debug, Clone, Deserialize)]
pub struct SearchSessionItem {
    pub id: String,
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
}

/// 并行流式搜索会话内容。
///
/// 事件（search_id 用于隔离多次搜索，避免旧结果串入）：
/// - `session-search-hit:{search_id}`  payload: { session_id, match_count }
/// - `session-search-done:{search_id}` payload: { scanned }
#[tauri::command]
pub async fn search_sessions_content(
    app: AppHandle,
    search_id: String,
    keyword: String,
    sessions: Vec<SearchSessionItem>,
) -> Result<(), String> {
    let keyword_lower = keyword.trim().to_lowercase();
    if keyword_lower.is_empty() {
        let _ = app.emit(
            &format!("session-search-done:{}", search_id),
            serde_json::json!({ "scanned": 0 }),
        );
        return Ok(());
    }

    tokio::spawn(async move {
        let total = sessions.len();
        let mut sessions = sessions.into_iter();

        loop {
            let mut handles = Vec::with_capacity(SEARCH_CONCURRENCY);
            for _ in 0..SEARCH_CONCURRENCY {
                let Some(item) = sessions.next() else {
                    break;
                };
                let app = app.clone();
                let sid = search_id.clone();
                let kw = keyword_lower.clone();
                handles.push(tokio::task::spawn_blocking(move || {
                    if let Some(count) = match_session(&item, &kw) {
                        if count > 0 {
                            let _ = app.emit(
                                &format!("session-search-hit:{}", sid),
                                serde_json::json!({
                                    "session_id": item.id,
                                    "match_count": count,
                                }),
                            );
                        }
                    }
                }));
            }

            if handles.is_empty() {
                break;
            }

            for h in handles {
                let _ = h.await;
            }
        }

        let _ = app.emit(
            &format!("session-search-done:{}", search_id),
            serde_json::json!({ "scanned": total }),
        );
    });

    Ok(())
}

/// 读取单个会话的原始文本并统计关键词出现次数（不区分大小写）。读不到则返回 None。
fn match_session(item: &SearchSessionItem, keyword_lower: &str) -> Option<usize> {
    let content = read_session_text(item)?;
    let count = content.to_lowercase().matches(keyword_lower).count();
    Some(count)
}

/// 按引擎定位会话文件并读取其全部文本内容。
fn read_session_text(item: &SearchSessionItem) -> Option<String> {
    let engine = item.engine.as_deref().unwrap_or("claude");
    match engine {
        "codex" => {
            let dir = get_codex_sessions_dir().ok()?;
            let path = find_codex_session_file(&dir, &item.id)?;
            std::fs::read_to_string(path).ok()
        }
        "gemini" => {
            let project_path = item.project_path.as_deref()?;
            let dir = get_gemini_sessions_dir(project_path).ok()?;
            // Gemini 文件名含 session_id 前 8 字符；扫描目录匹配，读到即返回文本。
            read_gemini_session_text(&dir, &item.id)
        }
        _ => {
            // Claude：~/.claude/projects/{project_id}/{session_id}.jsonl
            let project_id = item
                .project_id
                .clone()
                .or_else(|| item.project_path.as_deref().map(encode_project_path))?;
            let claude_dir = get_claude_dir().ok()?;
            let path = claude_dir
                .join("projects")
                .join(&project_id)
                .join(format!("{}.jsonl", item.id));
            std::fs::read_to_string(path).ok()
        }
    }
}

/// 在 Gemini 会话目录里按 session_id 前缀找到文件并读取文本。
fn read_gemini_session_text(sessions_dir: &std::path::Path, session_id: &str) -> Option<String> {
    let prefix = if session_id.len() >= 8 {
        &session_id[..8]
    } else {
        session_id
    };
    let entries = std::fs::read_dir(sessions_dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.contains(prefix) {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&path) {
            // 双重确认：文件内含该 sessionId（前缀可能碰撞）
            if text.contains(session_id) {
                return Some(text);
            }
        }
    }
    None
}
