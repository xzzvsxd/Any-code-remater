//! ask_user_bridge —— 阻塞式"向用户提问"MCP 工具的后端桥接
//!
//! 背景（实测见记忆 askuserquestion-headless-blocked-needs-mcp）：Claude CLI 在 headless
//! 流式模式下对内置 AskUserQuestion 会瞬间自答 is_error，无法真正等用户。根治方案是用一个
//! 自定义 MCP 工具（binaries/ask-user-mcp-server.cjs）——CLI 会一直阻塞等其 handler 返回。
//!
//! 本模块是该 MCP 工具 handler 的"另一端"：
//! - 启动一个仅监听 127.0.0.1 的极简 HTTP 服务（零额外依赖，tokio TcpListener 手写）。
//! - MCP handler `POST /ask {requestId, sessionId, questions}` 会被【长挂起】，
//!   我们存下一个 oneshot::Sender，并把问题 emit 给前端弹问答 UI。
//! - 前端提交后调用 `answer_user_question`，唤醒挂起请求、把答案作为 HTTP 响应返回给 handler，
//!   handler 再作为 tool_result 交还 CLI，于是 CLI 在【同一轮】继续。
//! - 会话取消 / 超时则返回错误文本，避免 CLI 永久挂起。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

/// 单次提问挂起态：持有把答案送回 HTTP handler 的 oneshot 通道。
struct PendingAsk {
    sender: oneshot::Sender<String>,
    /// 关联会话，便于按会话批量取消。
    session_id: String,
}

/// 全局桥接状态（注册为 Tauri managed state）。
#[derive(Clone)]
pub struct AskUserBridge {
    inner: Arc<BridgeInner>,
}

struct BridgeInner {
    /// 绑定到的本地端口（0 表示尚未启动）。
    port: std::sync::atomic::AtomicU16,
    /// 简单令牌，校验只有本机我们启动的 MCP server 能调用。
    token: String,
    /// requestId -> 挂起请求。
    pending: Mutex<HashMap<String, PendingAsk>>,
}

/// 前端通过事件收到的提问/计划负载。
#[derive(Debug, Serialize, Clone)]
pub struct AskUserQuestionEvent {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    /// "question" | "plan"
    pub kind: String,
    /// question 类型携带问题数组；plan 类型为 null。
    pub questions: serde_json::Value,
    /// plan 类型携带计划文本；question 类型为 null。
    pub plan: serde_json::Value,
    /// 前端展示倒计时用：后端最长等待秒数。
    #[serde(rename = "timeoutSeconds")]
    pub timeout_seconds: u64,
    /// 前端展示倒计时用：本次等待截止毫秒时间戳。
    #[serde(rename = "expiresAtMs")]
    pub expires_at_ms: u64,
}

/// MCP handler POST /ask 的请求体。
#[derive(Debug, Deserialize)]
struct AskRequestBody {
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(default, rename = "sessionId")]
    session_id: String,
    /// 区分交互类型：缺省视为 question（向后兼容）。
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    questions: serde_json::Value,
    #[serde(default)]
    plan: serde_json::Value,
}

impl AskUserBridge {
    pub fn new() -> Self {
        // 令牌用进程启动时间 + 随机性的简单拼接即可（仅本机回环，非强安全场景）。
        let token = format!(
            "askuser-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        Self {
            inner: Arc::new(BridgeInner {
                port: std::sync::atomic::AtomicU16::new(0),
                token,
                pending: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub fn token(&self) -> &str {
        &self.inner.token
    }

    pub fn port(&self) -> u16 {
        self.inner.port.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// 提交某次提问的答案：唤醒挂起的 HTTP 请求。返回是否命中。
    pub async fn answer(&self, request_id: &str, text: String) -> bool {
        let mut guard = self.inner.pending.lock().await;
        if let Some(p) = guard.remove(request_id) {
            let _ = p.sender.send(text);
            true
        } else {
            false
        }
    }

    /// 取消某会话下所有挂起提问（会话被 cancel 时调用），返回取消条数。
    pub async fn cancel_session(&self, session_id: &str) -> usize {
        let mut guard = self.inner.pending.lock().await;
        let ids: Vec<String> = guard
            .iter()
            .filter(|(_, p)| p.session_id == session_id)
            .map(|(k, _)| k.clone())
            .collect();
        for id in &ids {
            if let Some(p) = guard.remove(id) {
                let _ = p.sender.send("__ASK_USER_CANCELLED__".to_string());
            }
        }
        ids.len()
    }
}

impl Default for AskUserBridge {
    fn default() -> Self {
        Self::new()
    }
}

/// 提问挂起的最长等待（秒）：超过则返回提示，避免 CLI 永久挂起。
/// 5 分钟——足够用户回应，又不会在用户离开时让 CLI 无限期卡死。会话 cancel 会提前唤醒。
const ASK_TIMEOUT_SECS: u64 = 300; // 5 分钟

/// 启动本地桥接 HTTP 服务（仅 127.0.0.1，系统分配端口）。幂等：已启动则直接返回。
pub async fn ensure_bridge_started(app: AppHandle, bridge: AskUserBridge) -> Result<u16, String> {
    if bridge.port() != 0 {
        return Ok(bridge.port());
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("bind ask-user bridge failed: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    bridge
        .inner
        .port
        .store(port, std::sync::atomic::Ordering::SeqCst);
    log::info!("[ask-user-bridge] listening on 127.0.0.1:{}", port);

    let app_for_loop = app.clone();
    let bridge_for_loop = bridge.clone();
    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let app_c = app_for_loop.clone();
                    let bridge_c = bridge_for_loop.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_conn(stream, app_c, bridge_c).await {
                            log::debug!("[ask-user-bridge] conn error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    log::warn!("[ask-user-bridge] accept error: {}", e);
                }
            }
        }
    });

    Ok(port)
}

/// 处理单个连接：极简 HTTP/1.1，仅支持 `POST /ask`。
async fn handle_conn(
    mut stream: tokio::net::TcpStream,
    app: AppHandle,
    bridge: AskUserBridge,
) -> Result<(), String> {
    // 读取直到 header 结束（\r\n\r\n），再按 Content-Length 读 body。
    let mut buf: Vec<u8> = Vec::with_capacity(2048);
    let mut tmp = [0u8; 2048];
    let header_end;
    loop {
        let n = stream
            .read(&mut tmp)
            .await
            .map_err(|e| format!("read: {}", e))?;
        if n == 0 {
            return Err("connection closed before headers".into());
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_subsequence(&buf, b"\r\n\r\n") {
            header_end = pos + 4;
            break;
        }
        if buf.len() > 64 * 1024 {
            return Err("headers too large".into());
        }
    }

    let header_str = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let first_line = header_str.lines().next().unwrap_or("");
    let is_ask = first_line.starts_with("POST /ask");

    // 校验令牌
    let token_ok = header_str
        .lines()
        .find_map(|l| {
            let lower = l.to_ascii_lowercase();
            if lower.starts_with("x-ask-user-token:") {
                Some(l[l.find(':').unwrap() + 1..].trim().to_string())
            } else {
                None
            }
        })
        .map(|t| t == bridge.token())
        .unwrap_or(false);

    if !is_ask {
        write_response(&mut stream, 404, "{}").await?;
        return Ok(());
    }
    if !token_ok {
        write_response(&mut stream, 403, "{\"error\":\"bad token\"}").await?;
        return Ok(());
    }

    // 读取 Content-Length 与剩余 body
    let content_len = header_str
        .lines()
        .find_map(|l| {
            let lower = l.to_ascii_lowercase();
            if lower.starts_with("content-length:") {
                l[l.find(':').unwrap() + 1..].trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);

    let mut body = buf[header_end..].to_vec();
    while body.len() < content_len {
        let n = stream
            .read(&mut tmp)
            .await
            .map_err(|e| format!("read body: {}", e))?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..n]);
    }

    let parsed: AskRequestBody =
        serde_json::from_slice(&body).map_err(|e| format!("bad ask body: {}", e))?;

    // 注册挂起请求 + emit 给前端
    let (tx, rx) = oneshot::channel::<String>();
    {
        let mut guard = bridge.inner.pending.lock().await;
        guard.insert(
            parsed.request_id.clone(),
            PendingAsk {
                sender: tx,
                session_id: parsed.session_id.clone(),
            },
        );
    }

    let kind = parsed
        .kind
        .clone()
        .unwrap_or_else(|| "question".to_string());
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let expires_at_ms = now_ms.saturating_add(ASK_TIMEOUT_SECS.saturating_mul(1000));

    let evt = AskUserQuestionEvent {
        request_id: parsed.request_id.clone(),
        session_id: parsed.session_id.clone(),
        kind: kind.clone(),
        questions: parsed.questions.clone(),
        plan: parsed.plan.clone(),
        timeout_seconds: ASK_TIMEOUT_SECS,
        expires_at_ms,
    };
    // 按类型 emit 不同事件：plan → ask-user-plan，question → ask-user-question。
    // 同时各带一条按 sessionId 的事件，前端任择其一监听。
    let event_name = if kind == "plan" {
        "ask-user-plan"
    } else {
        "ask-user-question"
    };
    let _ = app.emit(event_name, &evt);
    if !parsed.session_id.is_empty() {
        let _ = app.emit(&format!("{}:{}", event_name, parsed.session_id), &evt);
    }

    // 阻塞等答案 / 超时 / 取消
    let answer =
        match tokio::time::timeout(std::time::Duration::from_secs(ASK_TIMEOUT_SECS), rx).await {
            Ok(Ok(text)) => text,
            Ok(Err(_)) => "（提问通道已关闭，未能收集到回答）".to_string(),
            Err(_) => {
                // 超时：清理挂起项
                let mut guard = bridge.inner.pending.lock().await;
                guard.remove(&parsed.request_id);
                "（等待用户回答超时，请用户稍后重新触发或直接在对话中回复）".to_string()
            }
        };

    let resp_body = serde_json::json!({ "text": answer }).to_string();
    write_response(&mut stream, 200, &resp_body).await?;
    Ok(())
}

async fn write_response(
    stream: &mut tokio::net::TcpStream,
    status: u16,
    body: &str,
) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "OK",
    };
    let resp = format!(
        "HTTP/1.1 {} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
        status,
        reason,
        body.as_bytes().len(),
        body
    );
    stream
        .write_all(resp.as_bytes())
        .await
        .map_err(|e| format!("write resp: {}", e))?;
    let _ = stream.flush().await;
    Ok(())
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

// ---- Tauri 命令 ----

/// 前端提交答案：唤醒挂起的提问 HTTP 请求。text 为已格式化好的回答文本。
#[tauri::command]
pub async fn answer_user_question(
    bridge: tauri::State<'_, AskUserBridge>,
    request_id: String,
    text: String,
) -> Result<bool, String> {
    Ok(bridge.answer(&request_id, text).await)
}

/// 取消某会话下所有挂起提问（供会话 cancel 兜底调用）。
#[tauri::command]
pub async fn cancel_user_questions(
    bridge: tauri::State<'_, AskUserBridge>,
    session_id: String,
) -> Result<usize, String> {
    Ok(bridge.cancel_session(&session_id).await)
}

// ---- MCP server 释放 + 配置生成 ----

/// 嵌入的 ask-user MCP server 脚本字节（发布模式提取到磁盘运行）。
#[cfg(not(debug_assertions))]
const ASK_USER_MCP_BYTES: &[u8] = include_bytes!("../../../binaries/ask-user-mcp-server.cjs");

/// 解析 ask-user MCP server 脚本路径：dev 用源码树 binaries/，release 提取到 ~/.acemcp/。
fn resolve_mcp_server_path() -> Result<std::path::PathBuf, String> {
    if cfg!(debug_assertions) {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
            .map_err(|e| format!("CARGO_MANIFEST_DIR: {}", e))?;
        Ok(std::path::PathBuf::from(manifest_dir)
            .join("binaries")
            .join("ask-user-mcp-server.cjs"))
    } else {
        #[cfg(not(debug_assertions))]
        {
            let dir = dirs::home_dir()
                .ok_or_else(|| "no home dir".to_string())?
                .join(".acemcp");
            let path = dir.join("ask-user-mcp-server.cjs");
            if !path.exists() {
                std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                std::fs::write(&path, ASK_USER_MCP_BYTES).map_err(|e| e.to_string())?;
            }
            Ok(path)
        }
        #[cfg(debug_assertions)]
        unreachable!()
    }
}

/// 为一次会话生成临时 MCP 配置文件，挂载 ask_user / submit_plan 工具，并把桥接端口/令牌/会话 id 经 env 注入。
/// 返回 (mcp_config_path, allowed_tool_names)。session_hint 用作前端路由（通常传 tab_id）。
pub fn write_mcp_config(
    bridge: &AskUserBridge,
    session_hint: &str,
) -> Result<(std::path::PathBuf, Vec<String>), String> {
    let server_path = resolve_mcp_server_path()?;
    let port = bridge.port();
    if port == 0 {
        return Err("ask-user bridge not started yet".into());
    }

    // node 接受正斜杠路径（实测）；统一转正斜杠避免 JSON 转义问题。
    let server_str = server_path.to_string_lossy().replace('\\', "/");

    let cfg = serde_json::json!({
        "mcpServers": {
            "askuser": {
                "command": "node",
                "args": [server_str],
                "env": {
                    "ASK_USER_BRIDGE_PORT": port.to_string(),
                    "ASK_USER_BRIDGE_TOKEN": bridge.token(),
                    "ASK_USER_SESSION_ID": session_hint,
                }
            }
        }
    });

    let dir = std::env::temp_dir().join("anycode-askuser");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let cfg_path = dir.join(format!("mcp-{}.json", sanitize_filename(session_hint)));
    std::fs::write(
        &cfg_path,
        serde_json::to_string(&cfg).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok((
        cfg_path,
        vec![
            "mcp__askuser__ask_user".to_string(),
            "mcp__askuser__submit_plan".to_string(),
        ],
    ))
}

fn sanitize_filename(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "default".to_string()
    } else {
        cleaned
    }
}

/// 共享：为一次 one-shot Claude 命令挂载阻塞式提问/审批 MCP 工具，返回需追加到命令行的 args。
///
/// 真实 GUI 会话走 one-shot 路径（execute/continue/resume_claude_code），不是 streaming，
/// 因此 MCP 工具必须挂在这些命令上才会生效。先确保桥接 HTTP 服务已就绪（规避启动竞态），
/// 再生成临时 mcp 配置并返回：--mcp-config <p> [--allowedTools <t>]* --append-system-prompt <引导>。
/// 失败仅记日志返回空（退化为无阻塞提问），不阻断会话启动。
pub async fn build_ask_user_args(app: &AppHandle, session_hint: &str) -> Vec<String> {
    let bridge = match app.try_state::<AskUserBridge>() {
        Some(b) => b.inner().clone(),
        None => {
            log::warn!("[ask-user] bridge state missing; skip mount");
            return Vec::new();
        }
    };
    // 确保桥接已启动（setup 异步启动可能尚未完成）。
    let _ = ensure_bridge_started(app.clone(), bridge.clone()).await;

    match write_mcp_config(&bridge, session_hint) {
        Ok((cfg_path, tool_names)) => {
            let mut args = Vec::new();
            args.push("--mcp-config".to_string());
            args.push(cfg_path.to_string_lossy().to_string());
            for tool in &tool_names {
                args.push("--allowedTools".to_string());
                args.push(tool.clone());
            }
            args.push("--append-system-prompt".to_string());
            args.push(
                "本运行环境下，内置的 AskUserQuestion 与 ExitPlanMode 工具无法真正等待用户，会被立即短路。\
                 因此：① 需要向用户提问 / 让其在多个方案间选择 / 澄清需求时，必须调用 mcp__askuser__ask_user 工具；\
                 ② 在 Plan（计划）模式下完成方案、准备开始执行前，必须调用 mcp__askuser__submit_plan 工具提交计划等待用户审批。\
                 这两个工具会阻塞等待用户在界面上响应后再返回。不要使用内置的 AskUserQuestion / ExitPlanMode，也不要仅用纯文本提问。"
                    .to_string(),
            );
            log::info!(
                "[ask-user] mounted MCP tools for one-shot: {:?} {:?}",
                cfg_path,
                tool_names
            );
            args
        }
        Err(e) => {
            log::warn!("[ask-user] MCP not mounted: {}", e);
            Vec::new()
        }
    }
}
