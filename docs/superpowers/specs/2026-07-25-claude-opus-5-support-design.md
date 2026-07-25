# Claude Opus 5 完整接入设计

日期：2026-07-25

## 背景

Anthropic 于 2026-07-24 发布 Claude Opus 5。当前项目的 Claude 模型选择器仍把 Opus 4.8 标记为 Opus 家族最新版，`opus` 短别名、前端计费归一化、Token Counter 和 Rust 用量统计后端也仍将未带版本的 Opus 归入 Opus 4.8。

只在选择器中追加一条型号会造成表面可选但内部不一致：Opus 5 会被当成旧 Opus 或未知模型，可能显示错误上下文窗口、错误标签或零成本。因此本次采用跨 UI、解析、上下文和计费的完整接入。

## 官方事实基线

以 Anthropic 官方页面为准：

- 发布公告：[Introducing Claude Opus 5](https://www.anthropic.com/news/claude-opus-5)
- 型号总览：[Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- Claude API ID 与 alias：`claude-opus-5`
- AWS Bedrock ID：`anthropic.claude-opus-5`
- Google Cloud ID：`claude-opus-5`
- 输入价格：$5 / 百万 tokens
- 输出价格：$25 / 百万 tokens
- Prompt Cache 写入价格：$6.25 / 百万 tokens
- Prompt Cache 读取价格：$0.50 / 百万 tokens
- 原生上下文窗口：1,000,000 tokens
- 同步 Messages API 最大输出：128,000 tokens
- Adaptive Thinking：支持；Claude API 与 Claude Code 默认 `effort=high`
- `thinking.type="enabled"` 旧式 Extended Thinking：不适用于 Opus 5
- 可靠知识截止与训练数据截止：2026-05

项目当前没有按型号集中配置“最大输出 tokens”的数据结构，因此本次不为 128K 新建未被消费的配置层；验收重点放在现有产品实际使用的模型选择、发送、标签、上下文和计费路径。

## 目标

- 在 Claude 模型选择器的 Opus 家族首位加入 `claude-opus-5`。
- 将 Opus 5 标记为 Opus 家族最新版和原生 1M 型号。
- 将未带版本的 `opus` 别名解析为 Opus 5。
- 继续保留 Opus 4.8、4.7、4.6 供显式选择，不迁移已钉住具体 ID 的历史设置或会话。
- 保留历史 `opus1m` 的原有含义：Opus 4.8 + `[1m]`，避免静默改变已有用户设置。
- 确保完整 ID、短别名和云平台格式在前端及 Rust 后端均按 Opus 5 计费。
- 确保 Opus 5 的上下文窗口显示为原生 1M，不追加 `[1m]` 后缀。
- 确保运行时模型标签显示为 `Claude Opus 5`。
- 用前端 Vitest、TypeScript 类型检查、Rust 单元测试和生产构建覆盖回归。

## 非目标

- 不删除或下线任何旧 Opus 型号。
- 不把已存储的 `claude-opus-4-8`、`claude-opus-4-8[1m]` 或 `opus1m` 自动迁移到 Opus 5。
- 不改变 `default` 与 `opusplan` 两种 Claude Code 自动调配模式。
- 不新增 Fast mode 开关；官方 Fast mode 属于独立价格与平台能力，后续可单独设计。
- 不新增动态调用 Anthropic Models API 的运行时发现机制。
- 不顺带修正其他 Claude 家族的历史默认值或价格策略。
- 不修改工作区内现有的 FloatingPromptInput 会话作用域未提交改动。

## 方案选择

### 采用：A｜跨层静态完整接入

沿用项目现有静态模型表模式，同时更新：

1. 选择器型号数据；
2. 编码、解码与短别名；
3. 标签格式化；
4. 上下文窗口与 Token Counter 归一化；
5. 前端统一计费表；
6. Rust 用量统计模型家族和价格；
7. 对应回归测试与注释中的最新版说明。

优点是与当前架构一致、改动边界清晰，离线启动和旧数据恢复不依赖网络，同时消除前后端计费分歧。用户已确认采用此完整方案。

### 未采用：B｜只添加选择器条目

改动最少，但 `claude-opus-5` 会在部分路径落入通用 Opus 4.8 或 Unknown，Rust 用量统计可能得到零成本。这不满足“完整实现”。

### 未采用：C｜运行时动态型号发现

通过 Anthropic Models API 动态生成型号列表可以减少未来手工更新，但需要处理凭据、第三方 Base URL、缓存、离线回退、云平台 ID、价格与能力元数据缺失等问题，明显超出本次新增单一型号的范围。

## 组件设计

### Claude 模型选择与发送

`src/components/FloatingPromptInput/constants.tsx` 继续作为选择器的型号单一事实来源：

- 在 Opus versions 首位加入：
  - `id: "claude-opus-5"`
  - `label: "Opus 5"`
  - 官方描述：`For complex agentic coding and enterprise work`
  - `supports1m: false`
  - `native1m: true`
  - `isLatest: true`
- Opus 4.8 保留但移除 `isLatest`。
- `decodeClaudeModel("opus")` 通过最新版标记解析为 Opus 5。
- 对 `opus1m` 增加显式历史分支，固定解析为 `claude-opus-4-8` 且 `oneMillion=true`。
- `encodeClaudeModel("claude-opus-5", true)` 仍返回裸 ID，因为其 1M 是原生能力。

`ModelSelector` 已能依据 `native1m` 显示“原生 1M”并隐藏后缀开关，不新增组件分支。

### 标签与会话模型显示

`src/lib/claudeModelSelection.ts` 的内置 `opus` 标签更新为 `Claude Opus 5`。为了保持 `opus1m` 与解析行为一致，旧别名标签继续显示 `Claude Opus 4.8 1M`，而完整 `claude-opus-5` 由通用 `modelNameParser` 解析为 `Claude Opus 5`。

已钉住 `claude-opus-4-8...` 的会话继续显示 Opus 4.8。自动续接仍优先采用消息流或会话中记录的真实型号，不改变其模型继承顺序。

### 上下文窗口与 Token Counter

`src/lib/tokenCounter.ts` 增加：

- Opus 5 计费项；
- `claude-opus-5: 1_000_000` 上下文窗口；
- `opus -> claude-opus-5`；
- `opus5` 与 `opus-5` 短别名；
- Opus 5 的优先归一化分支；
- 通用 Opus fallback 更新为 Opus 5。

匹配顺序必须先识别 4.8/4.7/4.6/4.5/4.1 等具体版本，再处理 Opus 5 与裸 Opus，防止版本字符串末尾的 `5` 被误认为 Opus 5。`opus1m` 在上下文别名表中继续指向 `claude-opus-4-8[1m]`。

### 前端统一计费

`src/lib/pricing.ts` 增加 `claude-opus-5` 价格，并在 Opus 旧版本精确匹配之后、通用 Opus fallback 之前识别：

- `claude-opus-5`
- `opus-5`
- `opus5`
- 裸 `opus`

旧版本精确 ID 继续映射旧型号对应价格。虽然 Opus 5 与 Opus 4.8 的基本费率相同，仍需要独立键和归一化结果，以便型号身份正确、后续价格变化时不耦合。

### Rust 用量统计后端

`src-tauri/src/commands/usage.rs` 增加 `ModelFamily::Opus5`：

- `ModelPricing::for_family(Opus5)` 返回 $5 / $25 / $6.25 / $0.50；
- `parse_model_family` 识别 Claude API、Bedrock 和 Google Cloud 的 Opus 5 格式；
- 裸 Opus fallback 改为 Opus 5；
- 旧版本分支保持更高优先级；
- 添加解析和价格 Rust 单元测试。

这样历史 JSONL、云平台日志和新 Claude Code 会话在后端聚合时使用一致的 Opus 5 身份与成本。

## 数据流

1. 用户在 Opus 家族选择 Opus 5，选择器发送 `claude-opus-5`。
2. 因为该型号 `native1m=true`，UI 显示原生 1M，编码层不追加 `[1m]`。
3. 会话启动后，Claude Code 的 init 消息记录实际型号；标签解析显示 `Claude Opus 5`。
4. 上下文指标从完整 ID 或 `opus` 别名解析出 1,000,000 tokens。
5. 前端会话成本通过 `pricing.ts` 或 `tokenCounter.ts` 归一化为 Opus 5 费率。
6. Rust 用量聚合从 JSONL 中解析相同型号家族并使用相同费率。
7. 旧会话若记录 Opus 4.8 或旧 `opus1m`，继续使用原型号与原 1M 行为。

## 兼容与错误处理

- 未识别的自定义模型保持既有 fallback 行为，本次不改变警告与零成本策略。
- 精确旧型号优先于裸家族 fallback，避免历史成本归属变化。
- `opus1m` 在 UI 解码、标签和上下文三处保持 Opus 4.8 语义。
- Opus 5 不接受 UI `[1m]` 开关，避免产生官方未要求的伪型号字符串。
- 第三方 `ANTHROPIC_BASE_URL` 仍可发送完整 `claude-opus-5`；不对服务端可用性做预探测。

## 测试设计

### RED：前端模型选择测试

- Opus 家族第一项为 Opus 5，且只存在一个 `isLatest`。
- Opus 5 为 `native1m=true`、`supports1m=false`。
- `encodeClaudeModel("claude-opus-5", true)` 不追加后缀。
- `decodeClaudeModel("opus")` 返回 Opus 5。
- `decodeClaudeModel("opus1m")` 继续返回 Opus 4.8 + 1M。

### RED：标签、上下文与价格测试

- `formatClaudeModelLabel("opus")` 为 `Claude Opus 5`。
- `formatClaudeModelLabel("claude-opus-5")` 为 `Claude Opus 5`。
- `formatClaudeModelLabel("opus1m")` 仍为 `Claude Opus 4.8 1M`。
- `getContextWindowSize` 对完整 ID、`opus`、`opus5`、`opus-5` 均返回 1,000,000。
- 前端两套计费 API 对完整 ID、裸别名和云平台格式均返回 $5 / $25 / $6.25 / $0.50。
- Opus 4.8 精确 ID 仍被识别为 Opus 4.8，不被新分支吞掉。

### RED：Rust 后端测试

- `ModelFamily::Opus5` 价格正确。
- `parse_model_family` 能识别 `claude-opus-5`、`anthropic.claude-opus-5` 和 `claude-opus-5@...`。
- 裸 `opus` fallback 为 `Opus5`。
- `claude-opus-4-8` 继续为 `Opus48`。

### GREEN 与回归

逐组运行新测试确认先因功能缺失而失败，再做最小实现使其通过。最终运行：

- 定向 Vitest；
- 完整 Vitest；
- `npm run typecheck`；
- Rust `usage` 模块测试；
- `npm run build`；
- `cargo check`（若完整 Tauri 构建依赖外部签名或打包环境，则以 Rust 测试与 check 作为后端编译验收）。

## 验收标准

- 模型选择器在 Opus 家族首位显示 `Opus 5`、`最新`、`原生 1M`。
- 选择 Opus 5 后发送的模型字符串恰为 `claude-opus-5`。
- `opus` 默认解析、标签、上下文和计费全部指向 Opus 5。
- Opus 5 上下文指标使用 1,000,000 tokens。
- 前端和 Rust 后端均按官方 $5 / $25 及缓存 $6.25 / $0.50 计费。
- 历史 Opus 4.8、4.7、4.6 和 `opus1m` 行为保持不变。
- 新增测试、完整前端测试、类型检查、生产构建和 Rust 检查通过。

