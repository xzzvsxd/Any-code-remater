//! emit 批处理器：把「来一行 emit 一行」合并为「按窗口批量 emit」。
//!
//! 背景（Linux/WebKit 前端卡死优化）：streaming 高频输出时，后端每读一行就 emit 一次，
//! IPC 往返次数过多，叠加前端每事件一次处理，主线程被淹没。本批处理器在 stdout 读取循环里
//! 累积普通输出行，达到「行数阈值」或「时间窗口」时一次性 emit 为数组（前端按 string[] 拆行）。
//!
//! 控制消息（system:init / result 等前端用于冷启动/结束的关键行）必须即时送达，
//! 调用方对这类行走 `flush_with`（先排空缓冲再单独立即 emit），不进缓冲，保证零延迟。
//!
//! 协议：payload 为 `Vec<String>`（多行）。前端 normalizeStreamLines 兼容 string | string[]。
//! 注意：不引入独立定时器任务，时间窗口靠「每次 push 时比较时间戳」驱动 —— streaming 行密集到达
//! 足以攒批；空闲时下一行本就慢，单独 emit 不增延迟。循环结束务必调用 flush() 排空残余。

use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

/// 批处理窗口：缓冲达到该行数即 flush。
const MAX_BATCH_LINES: usize = 64;
/// 批处理窗口：距上次 flush 超过该时长即 flush（毫秒）。约一帧多一点，兼顾吞吐与延迟。
const MAX_BATCH_INTERVAL: Duration = Duration::from_millis(16);

/// 单个会话输出流的 emit 批处理器。
///
/// - `session_event`：会话隔离事件名，如 `claude-output:<sid>`（值为 Vec<String>）。
/// - `global_event`：全局事件名，如 `claude-output`（值为 { tab_id, payload: Vec<String> }）。
pub struct EmitBatcher {
    app: AppHandle,
    global_event: String,
    tab_id: Option<String>,
    buffer: Vec<String>,
    last_flush: Instant,
}

impl EmitBatcher {
    pub fn new(app: AppHandle, global_event: impl Into<String>, tab_id: Option<String>) -> Self {
        Self {
            app,
            global_event: global_event.into(),
            tab_id,
            buffer: Vec::with_capacity(MAX_BATCH_LINES),
            last_flush: Instant::now(),
        }
    }

    /// 累积一行普通输出。达到行数阈值或时间窗口时自动 flush。
    /// `session_event` 每次传入（因 session_id 可能在循环中途才确定）。
    pub fn push(&mut self, session_event: Option<&str>, line: String) {
        self.buffer.push(line);
        if self.buffer.len() >= MAX_BATCH_LINES || self.last_flush.elapsed() >= MAX_BATCH_INTERVAL {
            self.flush(session_event);
        }
    }

    /// 立即排空缓冲：把累积的行作为一个数组 emit 出去。
    pub fn flush(&mut self, session_event: Option<&str>) {
        if self.buffer.is_empty() {
            return;
        }
        let batch: Vec<String> = std::mem::take(&mut self.buffer);
        self.emit_lines(session_event, &batch);
        self.last_flush = Instant::now();
    }

    /// 控制消息专用：先排空已缓冲的普通行（保序），再把该行作为单元素数组立即 emit。
    /// 用于 system:init / result 等前端冷启动/结束依赖的关键行，确保零延迟、不被攒批拖住。
    pub fn flush_with(&mut self, session_event: Option<&str>, line: &str) {
        self.flush(session_event);
        let one = [line.to_string()];
        // 上一行 flush 后 buffer 为空，这里直接发单行批，保证它紧跟在已排空内容之后。
        self.emit_lines(session_event, &one);
        self.last_flush = Instant::now();
    }

    fn emit_lines(&self, session_event: Option<&str>, lines: &[String]) {
        if let Some(ev) = session_event {
            let _ = self.app.emit(ev, lines);
        }
        let _ = self.app.emit(
            &self.global_event,
            &serde_json::json!({ "tab_id": self.tab_id, "payload": lines }),
        );
    }
}
