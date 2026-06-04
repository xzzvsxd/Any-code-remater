mod cli_runner;
mod config;
mod file_ops;
mod hooks;
mod models;
mod paths;
mod platform;
mod project_store;
mod session_history;
mod streaming;

pub use models::*;
pub use paths::*;
pub use self::streaming::execute_claude_streaming;
// Export platform utilities for process window hiding
pub use self::cli_runner::{
    cancel_claude_execution, continue_claude_code, execute_claude_code, get_claude_session_output,
    list_running_claude_sessions, resume_claude_code, send_stream_message, ClaudeProcessState,
};
pub use self::config::{
    check_claude_version,
    clear_custom_claude_path,
    find_claude_md_files,
    get_available_tools,
    get_claude_capabilities,
    get_claude_execution_config,
    get_claude_path,
    get_claude_permission_config,
    get_claude_settings,
    // Claude WSL mode configuration
    get_claude_wsl_mode_config,
    get_codex_system_prompt,
    get_permission_presets,
    get_system_prompt,
    open_new_session,
    read_claude_md_file,
    reset_claude_execution_config,
    save_claude_md_file,
    save_claude_settings,
    save_codex_system_prompt,
    save_system_prompt,
    set_claude_wsl_mode_config,
    set_custom_claude_path,
    update_claude_execution_config,
    update_claude_permission_config,
    update_thinking_mode,
    validate_permission_config,
};
pub use self::hooks::{get_hooks_config, update_hooks_config, validate_hook_command};
use self::project_store::ProjectStore;
pub use file_ops::{list_directory_contents, search_files};
// kill_process_tree 在 Windows 下不再被 Codex/Gemini 回退使用（改为拒绝裸 taskkill、只杀直接 child），
// 仅 Unix 路径调用；在 Windows 编译时允许其重导出未被使用，避免警告噪音。
pub use platform::apply_no_window_async;
#[cfg_attr(windows, allow(unused_imports))]
pub use platform::kill_process_tree;
// Agent functionality removed

#[tauri::command]
pub async fn list_projects() -> Result<Vec<Project>, String> {
    // 1) Claude 项目与本地会话（claude 计数已在 store 内填充）
    let projects = tokio::task::spawn_blocking(|| {
        let store = ProjectStore::new()?;
        store.list_projects()
    })
    .await
    .map_err(|e| format!("list_projects task failed: {}", e))??;

    // 2) Codex：一次性加载全量会话（内部已 spawn_blocking），按归一化项目路径分桶计数
    let codex_sessions = crate::commands::codex::session::list_codex_sessions()
        .await
        .unwrap_or_else(|e| {
            log::warn!("list_projects: failed to load Codex sessions for counts: {}", e);
            Vec::new()
        });

    // 3) 在阻塞线程内完成 codex 分桶 + Gemini 逐项目扫描，避免阻塞 async executor
    let projects = tokio::task::spawn_blocking(move || {
        let mut codex_counts: std::collections::HashMap<String, u32> =
            std::collections::HashMap::new();
        for s in codex_sessions {
            if s.project_path.is_empty() {
                continue;
            }
            let key = normalize_path_for_comparison(&s.project_path);
            *codex_counts.entry(key).or_insert(0) += 1;
        }

        let mut projects = projects;
        for project in projects.iter_mut() {
            let norm = normalize_path_for_comparison(&project.path);
            project.session_counts.codex = codex_counts.get(&norm).copied().unwrap_or(0);
            project.session_counts.gemini =
                crate::commands::gemini::config::list_session_files(&project.path)
                    .map(|files| files.len() as u32)
                    .unwrap_or(0);
        }
        projects
    })
    .await
    .map_err(|e| format!("list_projects counts task failed: {}", e))?;

    Ok(projects)
}

/// Gets sessions for a specific project
#[tauri::command]
pub async fn get_project_sessions(project_id: String) -> Result<Vec<Session>, String> {
    tokio::task::spawn_blocking(move || {
        let store = ProjectStore::new()?;
        store.get_project_sessions(&project_id)
    })
    .await
    .map_err(|e| format!("get_project_sessions task failed: {}", e))?
}

/// Deletes a session and all its associated data
#[tauri::command]
pub async fn delete_session(session_id: String, project_id: String) -> Result<String, String> {
    let store = ProjectStore::new()?;
    let session_deleted = store.delete_session(&project_id, &session_id)?;

    if session_deleted {
        Ok(format!("Successfully deleted session: {}", session_id))
    } else {
        Ok(format!(
            "Session {} was already missing; associated metadata cleaned up",
            session_id
        ))
    }
}

/// Deletes multiple sessions in batch
#[tauri::command]
pub async fn delete_sessions_batch(
    session_ids: Vec<String>,
    project_id: String,
) -> Result<String, String> {
    let store = ProjectStore::new()?;
    let outcome = store.delete_sessions_batch(&project_id, &session_ids);

    if outcome.failed_count > 0 {
        Err(format!(
            "Batch delete completed with errors: {} deleted, {} failed. Errors: {}",
            outcome.deleted_count,
            outcome.failed_count,
            outcome.errors.join("; ")
        ))
    } else {
        Ok(format!(
            "Successfully deleted {} sessions",
            outcome.deleted_count
        ))
    }
}

/// Removes a project from the project list (without deleting files)
#[tauri::command]
pub async fn delete_project(project_id: String) -> Result<String, String> {
    let store = ProjectStore::new()?;
    let newly_hidden = store.hide_project(&project_id)?;

    let result_msg = if newly_hidden {
        format!(
            "Project '{}' has been removed from the list (files are preserved)",
            project_id
        )
    } else {
        format!(
            "Project '{}' was already hidden (files are preserved)",
            project_id
        )
    };

    log::info!("{}", result_msg);
    Ok(result_msg)
}

/// Restores a project to the project list
#[tauri::command]
pub async fn restore_project(project_id: String) -> Result<String, String> {
    let store = ProjectStore::new()?;
    store.restore_project(&project_id)?;

    let result_msg = format!("Project '{}' has been restored to the list", project_id);
    log::info!("{}", result_msg);
    Ok(result_msg)
}

/// Permanently delete a project from the file system with intelligent directory detection
#[tauri::command]
pub async fn delete_project_permanently(project_id: String) -> Result<String, String> {
    let store = ProjectStore::new()?;
    let actual_project_id = store.delete_project_permanently(&project_id)?;

    let result_msg = if actual_project_id != project_id {
        format!(
            "项目 '{}' (实际目录: '{}') 已永久删除",
            project_id, actual_project_id
        )
    } else {
        format!("项目 '{}' 已永久删除", project_id)
    };

    log::info!("{}", result_msg);
    Ok(result_msg)
}

/// Lists all hidden projects with intelligent directory existence check
#[tauri::command]
pub async fn list_hidden_projects() -> Result<Vec<String>, String> {
    let store = ProjectStore::new()?;
    store.list_hidden_projects()
}

/// Reads the Claude settings file

/// Loads the JSONL history for a specific session
#[tauri::command]
pub async fn load_session_history(
    session_id: String,
    project_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    tokio::task::spawn_blocking(move || {
        session_history::load_session_history(&session_id, &project_id)
    })
    .await
    .map_err(|e| format!("load_session_history task failed: {}", e))?
}
