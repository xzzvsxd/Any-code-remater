#!/usr/bin/env node
/**
 * ask-user-mcp-server.cjs —— 阻塞式"向用户提问"MCP 工具
 *
 * 背景（实测结论，见记忆 askuserquestion-headless-blocked-needs-mcp）：
 * Claude CLI 在 headless(`-p`) 流式模式下，对内置 AskUserQuestion 工具会"瞬间自答 is_error"，
 * 从不等待用户。唯一能让 CLI 真正阻塞等待的机制是【自定义 MCP 工具】——CLI 会一直等
 * 工具 handler 返回。本文件即该工具的实现：注册 ask_user 工具，handler 把问题经本地 HTTP
 * 转交 Tauri 后端（→ 前端弹问答 UI），并阻塞直到用户提交答案后才返回 tool_result。
 *
 * 设计要点（KISS + 零依赖）：
 * - MCP 协议本质是 stdio 上的换行分隔 JSON-RPC，这里手写，不依赖任何 npm 包，便于 sidecar 释放。
 * - 副通道用 Node 内置 http 模块 POST 到 Tauri 后端的本地端口（端口/令牌由环境变量传入）。
 * - 该请求会被后端长挂起，直到前端回灌答案或超时，因此天然实现"阻塞等待"。
 */

'use strict';

const http = require('http');

// Tauri 后端注入的本地桥接地址与令牌（见 Rust 侧 ask_user_bridge）。
const BRIDGE_PORT = process.env.ASK_USER_BRIDGE_PORT;
const BRIDGE_TOKEN = process.env.ASK_USER_BRIDGE_TOKEN || '';
// 当前会话 id（用于后端把问题路由到正确的标签页/前端会话）。
const SESSION_ID = process.env.ASK_USER_SESSION_ID || '';

// ---- 极简 stdio JSON-RPC 收发 ----

let stdinBuf = '';
process.stdin.on('data', (chunk) => {
  stdinBuf += chunk.toString('utf8');
  let idx;
  while ((idx = stdinBuf.indexOf('\n')) >= 0) {
    const line = stdinBuf.slice(0, idx).trim();
    stdinBuf = stdinBuf.slice(idx + 1);
    if (line) handleLine(line);
  }
});

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleLine(line) {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return; // 非法 JSON 直接忽略
  }
  const { id, method, params } = req;

  try {
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'askuser', version: '1.0.0' },
      });
    } else if (method === 'notifications/initialized') {
      // 通知无需响应
    } else if (method === 'tools/list') {
      reply(id, { tools: [ASK_USER_TOOL, SUBMIT_PLAN_TOOL] });
    } else if (method === 'tools/call') {
      await handleToolCall(id, params);
    } else if (id !== undefined) {
      // 其它带 id 的请求给个空结果，保持协议礼貌
      reply(id, {});
    }
  } catch (err) {
    if (id !== undefined) {
      replyError(id, -32603, `internal error: ${err && err.message ? err.message : String(err)}`);
    }
  }
}

// ---- 工具定义 ----

// inputSchema 对齐前端 Question 结构（见 src/lib/askUserQuestionUtils.ts / UserQuestionContext.tsx）。
const ASK_USER_TOOL = {
  name: 'ask_user',
  description:
    '向用户提出一个或多个问题并【阻塞等待】用户在界面上选择/输入答案后再继续。' +
    '当你需要用户做决策、澄清需求、在多个方案间选择时，必须使用本工具，' +
    '不要使用内置的 AskUserQuestion（在当前环境下它无法真正等待用户）。' +
    '调用后会暂停，直到用户提交答案，返回内容即用户的真实回答。',
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '问题列表，通常一个；每个问题可带可选项供用户点选。',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: '完整问题文本' },
            header: { type: 'string', description: '简短标签（≤12字），用于UI标题' },
            multiSelect: { type: 'boolean', description: '是否允许多选，默认 false' },
            options: {
              type: 'array',
              description: '可选项；省略则为开放式输入',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: '选项显示文本' },
                  description: { type: 'string', description: '选项说明' },
                },
                required: ['label'],
              },
            },
          },
          required: ['question'],
        },
      },
    },
    required: ['questions'],
  },
};

// submit_plan：提交计划并【阻塞等待】用户在界面审批（批准 / 拒绝），替代被 headless 短路的内置 ExitPlanMode。
const SUBMIT_PLAN_TOOL = {
  name: 'submit_plan',
  description:
    '在 Plan（计划）模式下，把你制定好的实施计划提交给用户审批，并【阻塞等待】用户点击批准或拒绝。' +
    '当你完成方案设计、准备开始动手前，必须调用本工具，不要使用内置的 ExitPlanMode' +
    '（在当前环境下它无法真正等待用户审批）。返回内容会告知用户是批准（可开始执行）还是拒绝（含理由）。',
  inputSchema: {
    type: 'object',
    properties: {
      plan: {
        type: 'string',
        description: '完整的实施计划文本（Markdown），供用户审阅。',
      },
    },
    required: ['plan'],
  },
};

// ---- 工具调用：经本地 HTTP 桥接阻塞等用户回答 ----

let callSeq = 0;

async function handleToolCall(id, params) {
  const name = params && params.name;
  const args = (params && params.arguments) || {};

  // 无桥接配置时降级：直接返回提示，避免 CLI 永久挂起。
  if (!BRIDGE_PORT) {
    reply(id, {
      content: [{ type: 'text', text: '（交互通道未就绪：缺少 ASK_USER_BRIDGE_PORT，无法收集用户输入）' }],
      isError: true,
    });
    return;
  }

  if (name === 'ask_user') {
    const questions = Array.isArray(args.questions) ? args.questions : [];
    if (questions.length === 0) {
      reply(id, { content: [{ type: 'text', text: '（未提供问题，已跳过）' }], isError: true });
      return;
    }
    await blockingCall(id, { kind: 'question', questions }, '收集用户回答');
    return;
  }

  if (name === 'submit_plan') {
    const plan = typeof args.plan === 'string' ? args.plan : '';
    if (!plan.trim()) {
      reply(id, { content: [{ type: 'text', text: '（未提供计划内容，已跳过）' }], isError: true });
      return;
    }
    await blockingCall(id, { kind: 'plan', plan }, '等待用户审批计划');
    return;
  }

  replyError(id, -32601, `unknown tool: ${name}`);
}

/**
 * 统一的阻塞式工具调用：把 payload 发给后端桥接并长挂起，直到用户在前端做出响应。
 * payload.kind 区分 question / plan，后端据此 emit 不同前端事件。
 */
async function blockingCall(id, payload, actionLabel) {
  const requestId = `${process.pid}-${Date.now()}-${++callSeq}`;
  try {
    const text = await postAndWait({ requestId, sessionId: SESSION_ID, ...payload });
    reply(id, { content: [{ type: 'text', text }] });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    reply(id, {
      content: [{ type: 'text', text: `（${actionLabel}失败：${msg}）` }],
      isError: true,
    });
  }
}

/**
 * POST 到 Tauri 后端的本地桥接端点，请求会被后端长挂起，
 * 直到用户在前端提交响应（后端返回 {text}）或后端判定超时/取消。
 * 返回值为可直接交给模型的纯文本。
 */
function postAndWait(bodyObj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: Number(BRIDGE_PORT),
        path: '/ask',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-ask-user-token': BRIDGE_TOKEN,
        },
        // 不设 socket 超时：阻塞等待是预期行为，超时由后端统一裁决。
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c.toString('utf8')));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`bridge HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
          try {
            const parsed = JSON.parse(data);
            // 后端约定返回 { text: "格式化后的用户响应" }
            resolve(typeof parsed.text === 'string' ? parsed.text : JSON.stringify(parsed));
          } catch (e) {
            reject(new Error(`bad bridge response: ${e.message}`));
          }
        });
      }
    );
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}
