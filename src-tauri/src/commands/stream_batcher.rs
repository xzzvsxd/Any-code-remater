//! emit 批处理器：把「来一行 emit 一行」合并为「按窗口批量 emit」。
//!
//! 背景（Linux/WebKit 前端卡死优化）：streaming 高频输出时，后端每读一行就 emit 一次，
//! IPC 往返次数过多，叠加前端每事件一次处理，主线程被淹没。本批处理器在 stdout 读取循环里
//! 累积普通输出行，达到「行数阈值」「字节阈值」或「时间窗口」时一次性 emit 为数组（前端按 string[] 拆行）。
//!
//! 控制消息（system:init / result 等前端用于冷启动/结束的关键行）必须即时送达，
//! 调用方对这类行走 `flush_with`（先排空缓冲再单独立即 emit），不进缓冲，保证零延迟。
//!
//! 协议：payload 为 `Vec<String>`（多行）。前端 normalizeStreamLines 兼容 string | string[]。
//! 注意：不引入独立定时器任务，时间窗口靠「每次 push 时比较时间戳」驱动 —— streaming 行密集到达
//! 足以攒批；空闲时下一行本就慢，单独 emit 不增延迟。循环结束务必调用 flush() 排空残余。

use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, EventTarget, Manager};

/// 批处理窗口：缓冲达到该行数即 flush。
const MAX_BATCH_LINES: usize = 32;
/// 批处理窗口：缓冲达到该字节数即 flush。
///
/// 不能只按行数：Claude/Codex/Gemini 的一条 JSONL 可能包含很大的 tool_result。若 64 条大行
/// 合成一个巨型 Tauri IPC payload，Linux/WebKitGTK 在序列化、JS bridge 反序列化和 JSON.parse
/// 阶段会产生明显长任务/内存峰值。这里按 UTF-8 字节估算 batch 体积；单条超大 JSONL 不拆分，
/// 但会单独成批发送，保证协议完整性。
const MAX_BATCH_BYTES: usize = 64 * 1024;
/// 批处理窗口：距上次 flush 超过该时长即 flush（毫秒）。Linux WebKitGTK 下宁可降低
/// renderer 更新频率到约 30fps，也不要每 16ms 推 256KB 级 IPC 造成 JS bridge/JSON.parse 长任务。
const MAX_BATCH_INTERVAL: Duration = Duration::from_millis(32);
/// session_id 刚出现后，前端需要一小段时间从 global `system:init` 里拿到 sid 并注册
/// `*-output:<sid>` 监听。此窗口内普通 stream 仍保留少量 global fallback，避免 attach 竞态丢早期行。
const SESSION_LISTENER_ATTACH_GRACE_BATCHES: usize = 8;
const SESSION_LISTENER_ATTACH_GRACE_WINDOW: Duration = Duration::from_millis(750);

/// 单个会话输出流的 emit 批处理器。
///
/// - `session_event`：会话隔离事件名，如 `claude-output:<sid>`（值为 Vec<String>）。
/// - `global_event`：全局事件名，如 `claude-output`（值为 { tab_id, payload: Vec<String> }）。
pub struct EmitBatcher {
    app: AppHandle,
    global_event: String,
    tab_id: Option<String>,
    buffer: Vec<String>,
    buffered_bytes: usize,
    last_flush: Instant,
    last_session_event: Option<String>,
    session_listener_attach_grace_batches: usize,
    session_listener_attach_grace_until: Option<Instant>,
}

impl EmitBatcher {
    pub fn new(app: AppHandle, global_event: impl Into<String>, tab_id: Option<String>) -> Self {
        Self {
            app,
            global_event: global_event.into(),
            tab_id,
            buffer: Vec::with_capacity(MAX_BATCH_LINES),
            buffered_bytes: 0,
            last_flush: Instant::now(),
            last_session_event: None,
            session_listener_attach_grace_batches: 0,
            session_listener_attach_grace_until: None,
        }
    }

    /// 累积一行普通输出。达到行数阈值或时间窗口时自动 flush。
    /// `session_event` 每次传入（因 session_id 可能在循环中途才确定）。
    pub fn push(&mut self, session_event: Option<&str>, line: String) {
        let line_bytes = line.len();
        if should_flush_before_push(self.buffer.len(), self.buffered_bytes, line_bytes) {
            self.flush(session_event);
        }

        self.buffer.push(line);
        self.buffered_bytes = self.buffered_bytes.saturating_add(line_bytes);
        if should_flush_after_push(
            self.buffer.len(),
            self.buffered_bytes,
            self.last_flush.elapsed(),
        ) {
            self.flush(session_event);
        }
    }

    /// 立即排空缓冲：把累积的行作为一个数组 emit 出去。
    pub fn flush(&mut self, session_event: Option<&str>) {
        if self.buffer.is_empty() {
            return;
        }
        let batch: Vec<String> = std::mem::take(&mut self.buffer);
        self.buffered_bytes = 0;
        self.emit_stream_lines(session_event, &batch);
        self.last_flush = Instant::now();
    }

    /// 控制消息专用：先排空已缓冲的普通行（保序），再把该行作为单元素数组立即 emit。
    /// 用于 system:init / result 等前端冷启动/结束依赖的关键行，确保零延迟、不被攒批拖住。
    pub fn flush_with(&mut self, session_event: Option<&str>, line: &str) {
        self.flush(session_event);
        let one = [line.to_string()];
        // 上一行 flush 后 buffer 为空，这里直接发单行批，保证它紧跟在已排空内容之后。
        self.emit_control_lines(session_event, &one);
        self.last_flush = Instant::now();
    }

    fn emit_stream_lines(&mut self, session_event: Option<&str>, lines: &[String]) {
        let target = self.target_window_label();
        let target_event = EventTarget::webview_window(target);

        if let Some(ev) = session_event {
            // 高频普通 stream 行优先走 session-specific 隔离事件。
            // attach grace 结束后不再额外发 global，避免同一窗口内 global listener 也被唤醒，
            // 在 Linux/WebKit 下放大 JSON parse、normalize、队列调度成本。
            let _ = self.app.emit_to(target_event.clone(), ev, lines);

            // 但 session_id 刚出现时，前端尚未完成 session-specific listener attach。
            // 短暂保留 global fallback，覆盖 init 之后的早期几批输出；窗口结束后回到只发隔离事件。
            if !self.should_emit_global_fallback(ev) {
                return;
            }
        }

        self.emit_global_lines(target_event, lines);
    }

    fn emit_control_lines(&mut self, session_event: Option<&str>, lines: &[String]) {
        let target = self.target_window_label();
        let target_event = EventTarget::webview_window(target);

        if let Some(ev) = session_event {
            self.begin_session_listener_attach_grace(ev);
            let _ = self.app.emit_to(target_event.clone(), ev, lines);
        }

        self.emit_global_lines(target_event, lines);
    }

    fn emit_global_lines(&self, target_event: EventTarget, lines: &[String]) {
        let _ = self.app.emit_to(
            target_event,
            &self.global_event,
            &serde_json::json!({ "tab_id": self.tab_id, "payload": lines }),
        );
    }

    fn begin_session_listener_attach_grace(&mut self, session_event: &str) {
        if self.last_session_event.as_deref() == Some(session_event) {
            return;
        }

        self.last_session_event = Some(session_event.to_string());
        self.session_listener_attach_grace_batches = SESSION_LISTENER_ATTACH_GRACE_BATCHES;
        self.session_listener_attach_grace_until = Some(Instant::now() + SESSION_LISTENER_ATTACH_GRACE_WINDOW);
    }

    fn should_emit_global_fallback(&mut self, session_event: &str) -> bool {
        self.begin_session_listener_attach_grace(session_event);

        let within_grace_window = self
            .session_listener_attach_grace_until
            .map(|until| Instant::now() <= until)
            .unwrap_or(false);
        if !within_grace_window || self.session_listener_attach_grace_batches == 0 {
            return false;
        }

        self.session_listener_attach_grace_batches -= 1;
        true
    }

    fn target_window_label(&self) -> String {
        if let Some(tab_id) = self.tab_id.as_deref() {
            let session_label = format!("session-window-{}", tab_id);
            if self.app.get_webview_window(&session_label).is_some() {
                return session_label;
            }
        }

        "main".to_string()
    }
}

fn should_flush_before_push(
    buffered_lines: usize,
    buffered_bytes: usize,
    next_line_bytes: usize,
) -> bool {
    buffered_lines > 0 && buffered_bytes.saturating_add(next_line_bytes) > MAX_BATCH_BYTES
}

fn should_flush_after_push(
    buffered_lines: usize,
    buffered_bytes: usize,
    elapsed_since_flush: Duration,
) -> bool {
    buffered_lines >= MAX_BATCH_LINES
        || buffered_bytes >= MAX_BATCH_BYTES
        || elapsed_since_flush >= MAX_BATCH_INTERVAL
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flushes_before_adding_line_that_would_exceed_batch_bytes() {
        assert!(should_flush_before_push(1, MAX_BATCH_BYTES - 10, 11));
        assert!(!should_flush_before_push(0, MAX_BATCH_BYTES - 10, 11));
        assert!(!should_flush_before_push(1, MAX_BATCH_BYTES - 10, 10));
    }

    #[test]
    fn flushes_after_buffering_single_oversized_line() {
        assert!(should_flush_after_push(
            1,
            MAX_BATCH_BYTES + 1,
            Duration::from_millis(0),
        ));
    }

    #[test]
    fn keeps_small_batch_under_byte_limit_buffered() {
        assert!(!should_flush_after_push(
            1,
            MAX_BATCH_BYTES - 1,
            Duration::from_millis(0),
        ));
    }

    #[test]
    fn linux_renderer_batch_limits_stay_below_long_task_thresholds() {
        assert!(MAX_BATCH_LINES <= 32);
        assert!(MAX_BATCH_BYTES <= 64 * 1024);
        assert!(MAX_BATCH_INTERVAL >= Duration::from_millis(32));
    }
}
