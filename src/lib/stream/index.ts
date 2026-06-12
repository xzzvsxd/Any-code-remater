/**
 * Stream 模块导出
 *
 * 提供统一的流式消息处理能力
 */

// 异步队列
export { AsyncQueue } from './AsyncQueue';

// 流式 payload 协议适配（单行 string / 批量 string[]）
export { normalizeStreamLines } from './streamPayload';

// 协作式队列消费，防止高频 streaming task 在 microtask 链上饿死 UI。
export {
  consumeYielding,
  shouldYieldTaskConsumer,
  yieldToEventLoop,
  type ConsumeYieldingOptions,
  type TaskConsumerBudget,
} from './yieldingTaskConsumer';

// 消息转换器
export * from './converters';

// 会话连接
export {
  SessionConnection,
  ConnectionManager,
  connectionManager,
  type ConnectionState,
  type SessionConnectionConfig,
} from './SessionConnection';

// 状态管理
export {
  sessionStore,
  useSessionStore,
  useSession,
  useActiveSession,
  useSessionMessages,
  useSessionStatus,
  type SessionData,
  type SessionStatus,
} from './SessionStore';
