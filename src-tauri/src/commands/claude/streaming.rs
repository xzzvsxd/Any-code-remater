//! 持久化流式 Claude 会话（阶段2：随时插话 / 真硬阻塞）
//!
//! 与 cli_runner.rs 的 one-shot 路径完全独立：
//! - 用 `--input-format stream-json` 启动常驻进程，stdin 保持打开。
//! - 首条消息以 stream-json user 包络写入；后续消息由 `send_stream_message` 写入同一 stdin。
//! - 每轮以 stdout 的 `result` 消息为「单轮结束」信号（emit claude-complete），
//!   但进程不退出，可继续接收下一条消息。
//! - 进程真正退出（stdin 关闭 / kill）时做最终清理。
//!
//! 实测行为见记忆 claude-stream-json-input-behavior。

use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use super::cli_runner::{map_model_to_claude_alias, ClaudeProcessState};
use super::config::get_claude_execution_config;
use crate::commands::permission_config::{
    build_streaming_execution_args, ClaudeExecutionConfig, ClaudePermissionConfig,
};

/// 构造 stream-json user 消息包络行（含换行）
fn build_user_envelope(text: &str) -> Result<String, String> {
    let envelope = serde_json::json!({
        "type": "user",
        "message": { "role": "user", "content": [{ "type": "text", "text": text }] }
    });
    let mut line = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;
    line.push('\n');
    Ok(line)
}

/// 启动一个持久化流式 Claude 会话，并写入首条消息。
/// 进程常驻，后续可用 send_stream_message 向其 stdin 写入更多消息。
#[tauri::command]
pub async fn execute_claude_streaming(
    app: AppHandle,
    project_path: String,
    prompt: String,
    model: String,
    plan_mode: Option<bool>,
    max_thinking_tokens: Option<u32>,
    tab_id: Option<String>,
) -> Result<(), String> {
    let plan_mode = plan_mode.unwrap_or(false);
    log::info!(
        "[streaming] Starting persistent Claude session in {} model={} plan_mode={}",
        project_path,
        model,
        plan_mode
    );

    let claude_path = crate::claude_binary::find_claude_binary(&app)?;

    let mut execution_config = get_claude_execution_config(app.clone())
        .await
        .unwrap_or_else(|e| {
            log::warn!("[streaming] load config failed, default: {}", e);
            ClaudeExecutionConfig::default()
        });
    if let Some(tokens) = max_thinking_tokens {
        execution_config.max_thinking_tokens = Some(tokens);
    }
    if plan_mode {
        execution_config.permissions = ClaudePermissionConfig::plan_mode();
    }

    let mapped_model = map_model_to_claude_alias(&model);
    let mut args = build_streaming_execution_args(&execution_config, &mapped_model);

    // 挂载阻塞式提问/审批 MCP 工具（与 one-shot 路径共用同一 helper，逻辑单一来源）。
    args.extend(
        crate::commands::claude::build_ask_user_args(&app, tab_id.as_deref().unwrap_or("default"))
            .await,
    );

    // 复用 one-shot 的命令构建（stdin/stdout/stderr 均 piped）
    let mut cmd = super::cli_runner::create_streaming_command(
        &claude_path,
        args,
        &project_path,
        Some(&mapped_model),
    )?;
    let run_marker = crate::process::new_claude_run_marker();
    cmd.env(crate::process::CLAUDE_RUN_MARKER_ENV, &run_marker);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("[streaming] Failed to spawn Claude: {}", e))?;

    let pid = child.id().unwrap_or(0);
    log::info!("[streaming] Spawned persistent Claude PID={}", pid);

    let mut stdin = child
        .stdin
        .take()
        .ok_or("[streaming] Failed to get stdin")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("[streaming] Failed to get stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("[streaming] Failed to get stderr")?;

    // 立即写入首条消息（不关闭 stdin）
    let first_line = build_user_envelope(&prompt)?;
    stdin
        .write_all(first_line.as_bytes())
        .await
        .map_err(|e| format!("[streaming] write first message failed: {}", e))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("[streaming] flush first message failed: {}", e))?;

    let registry = app.state::<crate::process::ProcessRegistryState>();
    let registry_arc = registry.0.clone();

    // run_id / session_id 持有器
    let session_id_holder: std::sync::Arc<std::sync::Mutex<Option<String>>> =
        std::sync::Arc::new(std::sync::Mutex::new(None));
    let run_id_holder: std::sync::Arc<std::sync::Mutex<Option<i64>>> =
        std::sync::Arc::new(std::sync::Mutex::new(None));

    // stdin 暂存：init 后存入 registry
    let stdin_holder: std::sync::Arc<tokio::sync::Mutex<Option<tokio::process::ChildStdin>>> =
        std::sync::Arc::new(tokio::sync::Mutex::new(Some(stdin)));

    let stdout_reader = BufReader::new(stdout);
    let stderr_reader = BufReader::new(stderr);

    let app_out = app.clone();
    let sid_out = session_id_holder.clone();
    let rid_out = run_id_holder.clone();
    let reg_out = registry_arc.clone();
    let stdin_for_store = stdin_holder.clone();
    let project_for_reg = project_path.clone();
    let model_for_reg = model.clone();
    let prompt_for_reg = prompt.clone();
    let tab_out = tab_id.clone();
    let run_marker_for_reg = run_marker.clone();

    let stdout_task = tokio::spawn(async move {
        // emit 批处理器：普通输出行攒批，降低 streaming 期间 IPC 频率（Linux 卡死优化）。
        let mut batcher = crate::commands::stream_batcher::EmitBatcher::new(
            app_out.clone(),
            "claude-output",
            tab_out.clone(),
        );
        let mut lines = stdout_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log::trace!("[streaming] stdout: {}", line);

            if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) {
                let mtype = msg["type"].as_str().unwrap_or("");

                // init：每轮都会重发；仅首次注册进程并存 stdin
                if mtype == "system" && msg["subtype"] == "init" {
                    if let Some(sid) = msg["session_id"].as_str() {
                        let already = sid_out.lock().unwrap().clone();
                        if already.as_deref() != Some(sid) {
                            *sid_out.lock().unwrap() = Some(sid.to_string());
                        }
                        // 仅首次注册
                        if run_id_holder_is_empty(&rid_out) {
                            #[cfg(windows)]
                            let job = None;
                            let reg = reg_out.register_claude_session_with_job_and_marker(
                                sid.to_string(),
                                pid,
                                project_for_reg.clone(),
                                prompt_for_reg.clone(),
                                model_for_reg.clone(),
                                Some(run_marker_for_reg.clone()),
                                {
                                    #[cfg(windows)]
                                    {
                                        job
                                    }
                                    #[cfg(not(windows))]
                                    {
                                        None
                                    }
                                },
                            );
                            if let Ok(run_id) = reg {
                                *rid_out.lock().unwrap() = Some(run_id);
                                // 把 stdin 移交给 registry，供 send_stream_message 使用
                                if let Some(s) = stdin_for_store.lock().await.take() {
                                    let _ = reg_out.set_stream_stdin(run_id, s);
                                }
                                let _ = app_out.emit(
                                    "claude-session-state",
                                    &serde_json::json!({
                                        "session_id": sid, "project_path": project_for_reg,
                                        "model": model_for_reg, "status": "started",
                                        "pid": pid, "run_id": run_id, "streaming": true
                                    }),
                                );
                            }
                        }
                    }
                }

                // 存 live output
                if let Some(run_id) = *rid_out.lock().unwrap() {
                    let _ = reg_out.append_live_output(run_id, &line);
                }

                // emit 输出：普通行进批处理器攒批，降低 IPC 频率（修复 Linux 前端卡死）。
                // result 行是「单轮结束」控制消息，前端据此结束 streaming，必须即时送达。
                let sess_event = sid_out
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map(|sid| format!("claude-output:{}", sid));
                let is_control =
                    mtype == "result" || (mtype == "system" && msg["subtype"] == "init");
                if is_control {
                    // 先排空缓冲再立即单独 emit init/result，保证零延迟、不被攒批拖住。
                    // init 必须继续走 global 控制事件：前端正是靠它拿到真实 session_id，
                    // 然后才能 attach `claude-output:<sid>` 隔离监听器。
                    batcher.flush_with(sess_event.as_deref(), &line);
                    if mtype == "result" {
                        if let Some(ref sid) = *sid_out.lock().unwrap() {
                            let _ = app_out.emit(&format!("claude-complete:{}", sid), true);
                        }
                        let _ = app_out.emit(
                            "claude-complete",
                            &serde_json::json!({ "tab_id": tab_out, "payload": true }),
                        );
                    }
                } else {
                    batcher.push(sess_event.as_deref(), line.clone());
                }
            }
        }
        // 循环结束（进程退出）：排空残余缓冲，避免最后几行丢失。
        batcher.flush(
            sid_out
                .lock()
                .unwrap()
                .as_ref()
                .map(|sid| format!("claude-output:{}", sid))
                .as_deref(),
        );
        log::info!("[streaming] stdout closed (process ending)");
    });

    let app_err = app.clone();
    let sid_err = session_id_holder.clone();
    let tab_err = tab_id.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = stderr_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log::error!("[streaming] stderr: {}", line);
            if let Some(ref sid) = *sid_err.lock().unwrap() {
                let _ = app_err.emit(&format!("claude-error:{}", sid), &line);
            }
            let _ = app_err.emit(
                "claude-error",
                &serde_json::json!({ "tab_id": tab_err, "payload": &line }),
            );
        }
    });

    // 进程真正退出时的最终清理
    let app_wait = app.clone();
    let sid_wait = session_id_holder.clone();
    let rid_wait = run_id_holder.clone();
    let reg_wait = registry_arc.clone();
    let claude_state = app.state::<ClaudeProcessState>();
    let last_pid_arc = claude_state.last_spawned_pid.clone();
    let tab_wait = tab_id.clone();
    tokio::spawn(async move {
        let _ = stdout_task.await;
        let _ = stderr_task.await;
        let _ = child.wait().await;
        log::info!("[streaming] persistent process exited PID={}", pid);

        if let Some(ref sid) = *sid_wait.lock().unwrap() {
            let _ = app_wait.emit(
                "claude-session-state",
                &serde_json::json!({ "session_id": sid, "status": "stopped", "success": true }),
            );
            // 进程退出后补一个 complete，确保前端 loading 收尾
            let _ = app_wait.emit(&format!("claude-complete:{}", sid), true);
        }
        let _ = app_wait.emit(
            "claude-complete",
            &serde_json::json!({ "tab_id": tab_wait, "payload": true }),
        );

        if let Some(run_id) = *rid_wait.lock().unwrap() {
            let _ = reg_wait.unregister_process(run_id);
        }
        if pid != 0 {
            let mut last = last_pid_arc.lock().await;
            if last.as_ref() == Some(&pid) {
                *last = None;
            }
        }
    });

    Ok(())
}

/// 判断 run_id 持有器是否为空（避免在持锁期间嵌套）
fn run_id_holder_is_empty(holder: &std::sync::Arc<std::sync::Mutex<Option<i64>>>) -> bool {
    holder.lock().map(|g| g.is_none()).unwrap_or(true)
}
