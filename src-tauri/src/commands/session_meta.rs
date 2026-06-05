//! 会话元数据：自定义标题 + 自定义排序。
//!
//! 三引擎的原始会话文件都没有"显示名称"字段（标题从首条消息派生），
//! 也没有用户自定义排序。这里用一个统一的 JSON 文件集中存储这两类元数据，
//! 不污染各引擎的会话目录，跨引擎共用。
//!
//! 存储位置：~/.claude/session-meta.json
//! 结构：{ "titles": { "<session_id>": "自定义标题" },
//!        "order":  { "<engine>:<project_id>": ["id1","id2",...] } }

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use super::claude::get_claude_dir;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionMetaStore {
    #[serde(default)]
    pub titles: HashMap<String, String>,
    #[serde(default)]
    pub order: HashMap<String, Vec<String>>,
    /// 工作区项目的自定义显示顺序（项目 id 列表）。用户拖拽排序后写入；
    /// 非空即视为"用户已手动排序"，前端据此锁定顺序、不再自动置顶。
    #[serde(default)]
    pub project_order: Vec<String>,
}

fn meta_path() -> Result<PathBuf, String> {
    let dir = get_claude_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("session-meta.json"))
}

fn load_store() -> SessionMetaStore {
    let path = match meta_path() {
        Ok(p) => p,
        Err(_) => return SessionMetaStore::default(),
    };
    if !path.exists() {
        return SessionMetaStore::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|c| serde_json::from_str::<SessionMetaStore>(&c).ok())
        .unwrap_or_default()
}

fn save_store(store: &SessionMetaStore) -> Result<(), String> {
    let path = meta_path()?;
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let content =
        serde_json::to_string_pretty(store).map_err(|e| format!("serialize meta failed: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("write meta failed: {}", e))
}

fn order_key(engine: &str, project_id: &str) -> String {
    format!("{}:{}", engine, project_id)
}

/// 读取全部会话元数据（前端加载会话列表后用于叠加标题/排序）。
#[tauri::command]
pub async fn get_session_meta() -> Result<SessionMetaStore, String> {
    Ok(load_store())
}

/// 设置某会话的自定义标题；空字符串表示清除（恢复用首条消息派生）。
#[tauri::command]
pub async fn set_session_title(session_id: String, title: String) -> Result<(), String> {
    let mut store = load_store();
    let trimmed = title.trim();
    if trimmed.is_empty() {
        store.titles.remove(&session_id);
    } else {
        store.titles.insert(session_id, trimmed.to_string());
    }
    save_store(&store)
}

/// 设置某项目下会话的自定义顺序。
#[tauri::command]
pub async fn set_session_order(
    engine: String,
    project_id: String,
    session_ids: Vec<String>,
) -> Result<(), String> {
    let mut store = load_store();
    store
        .order
        .insert(order_key(&engine, &project_id), session_ids);
    save_store(&store)
}

/// 设置工作区项目的自定义显示顺序（拖拽排序）。空列表表示清除手动顺序、恢复自动排序。
#[tauri::command]
pub async fn set_project_order(project_ids: Vec<String>) -> Result<(), String> {
    let mut store = load_store();
    store.project_order = project_ids;
    save_store(&store)
}
