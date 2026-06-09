//! 草稿会话：未发送的新会话独立落盘，支持每项目多个、全局多个。
//!
//! 与正式会话(各引擎的 .jsonl)分离：草稿只是「用户已经开始写、但还没发出去」的暂存，
//! 一旦发出首条消息、会话转正，前端会删除对应草稿。用统一 JSON 文件集中存储，
//! 不污染各引擎会话目录，跨引擎共用。
//!
//! 存储位置：~/.claude/draft-sessions.json
//! 结构：{ "drafts": { "<draft_id>": { id, project_id, project_path, content, engine,
//!                                     created_at, updated_at } } }

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use super::claude::get_claude_dir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftSession {
    /// 草稿唯一 id（前端生成，通常等于承载它的 tab id）
    pub id: String,
    /// 所属项目 id（可空：尚未归属任何项目的全局草稿）
    #[serde(default)]
    pub project_id: String,
    /// 所属项目路径（用于侧栏归一化匹配项目，project_id 在虚拟项目下可能对不上）
    #[serde(default)]
    pub project_path: String,
    /// 草稿正文（输入框文本）
    #[serde(default)]
    pub content: String,
    /// 目标引擎
    #[serde(default)]
    pub engine: String,
    /// 创建时间（Unix 秒）
    #[serde(default)]
    pub created_at: u64,
    /// 最后更新时间（Unix 秒）
    #[serde(default)]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DraftSessionStore {
    #[serde(default)]
    pub drafts: HashMap<String, DraftSession>,
}

fn drafts_path() -> Result<PathBuf, String> {
    let dir = get_claude_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("draft-sessions.json"))
}

fn load_store() -> DraftSessionStore {
    let path = match drafts_path() {
        Ok(p) => p,
        Err(_) => return DraftSessionStore::default(),
    };
    if !path.exists() {
        return DraftSessionStore::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|c| serde_json::from_str::<DraftSessionStore>(&c).ok())
        .unwrap_or_default()
}

fn save_store(store: &DraftSessionStore) -> Result<(), String> {
    let path = drafts_path()?;
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(store)
        .map_err(|e| format!("serialize drafts failed: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("write drafts failed: {}", e))
}

/// 列出草稿。传 project_id 时只返回该项目的草稿；不传(None/空)返回全部。
#[tauri::command]
pub async fn list_draft_sessions(project_id: Option<String>) -> Result<Vec<DraftSession>, String> {
    let store = load_store();
    let mut drafts: Vec<DraftSession> = match project_id {
        Some(pid) if !pid.is_empty() => store
            .drafts
            .into_values()
            .filter(|d| d.project_id == pid)
            .collect(),
        _ => store.drafts.into_values().collect(),
    };
    // 按更新时间倒序，最近编辑的草稿排前面
    drafts.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(drafts)
}

/// 保存草稿（upsert）：按 draft.id 覆盖写入。content 为空时视为删除（清理空草稿）。
/// 返回 draft id。
#[tauri::command]
pub async fn save_draft_session(draft: DraftSession) -> Result<String, String> {
    if draft.id.trim().is_empty() {
        return Err("draft id is empty".to_string());
    }
    let mut store = load_store();
    let id = draft.id.clone();
    // 内容为空白：等价于删除该草稿，避免侧栏堆积空草稿条目。
    if draft.content.trim().is_empty() {
        store.drafts.remove(&id);
    } else {
        let mut next = draft;
        if let Some(existing) = store.drafts.get(&id) {
            if existing.created_at > 0 {
                next.created_at = existing.created_at;
            }
        }
        store.drafts.insert(id.clone(), next);
    }
    save_store(&store)?;
    Ok(id)
}

/// 删除草稿（会话转正/用户丢弃时调用）。
#[tauri::command]
pub async fn delete_draft_session(draft_id: String) -> Result<(), String> {
    let mut store = load_store();
    store.drafts.remove(&draft_id);
    save_store(&store)
}
