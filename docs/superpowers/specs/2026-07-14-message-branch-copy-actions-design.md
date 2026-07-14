# 消息分支与复制操作合并设计

日期：2026-07-14

## 背景与问题

当前消息级复制操作由 `MessageActions` 渲染在具体消息组件内部，而分支操作由 `SessionMessages` 在消息组外层额外绝对定位。两者处于不同 DOM 层级，使用不同的 hover 边界与定位上下文。在虚拟列表、消息宽度或层叠上下文变化后，独立分支按钮可能被裁切、遮挡，或在复制按钮出现时仍不可见。

目标是移除独立分支浮层，将分支操作合并到复制按钮所在的同一个消息操作工具条，视觉顺序为：

`分支 icon | 复制 icon`

## 目标

- 分支按钮与复制按钮共享同一个工具条、定位、背景、边框和 hover 显隐条件。
- 可分支消息在复制按钮左侧显示分支按钮。
- 不可分支消息继续只显示复制按钮，不显示空分隔线。
- 分支执行时在原位置展示加载态，避免重复触发。
- 保持用户消息工具条左上定位、AI 消息工具条右上定位。
- 保持流式消息、工具节点、子代理入口等既有分支资格规则。

## 非目标

- 不改变创建分支会话的后端流程。
- 不改变 promptIndex 的计算逻辑。
- 不改变复制内容与复制成功/失败反馈。
- 不统一用户消息与 AI 消息的工具条左右位置。
- 不为原本没有复制工具条的工具结果或子代理入口新增工具条。

## 方案选择

### 采用：扩展 `MessageActions`

`MessageActions` 增加可选的 `branchPromptIndex` 与 `onBranch` 参数，并在复制按钮之前渲染分支操作。分支资格由现有 `SessionMessages` 继续计算，通过 `StreamMessageV2` 传递到最终的用户消息或 AI 消息组件。

优点：

- 只有一个操作工具条和一个 hover 边界。
- 不重复复制逻辑和状态反馈。
- 分支按钮成为工具条的可选动作，组件职责清晰。
- 后续增加更多消息动作时可以继续复用同一结构。

### 未采用：在 `SessionMessages` 重建统一浮层

需要在外层重新提取消息可复制文本并复制 `MessageActions` 的状态逻辑，容易产生行为差异。

### 未采用：Context/Slot 动态注入

扩展性较强，但对当前两个操作而言复杂度过高，会增加隐式依赖。

## 组件设计

### `MessageActions`

新增可选属性：

- `branchPromptIndex?: number`
- `onBranch?: (promptIndex: number) => void | Promise<void>`

当 `branchPromptIndex >= 0` 且存在 `onBranch` 时：

1. 在复制按钮左侧渲染分支按钮。
2. 两个按钮之间渲染一条短竖向分隔线。
3. 点击分支后停止事件冒泡，进入 busy 状态，并等待 `onBranch` 完成。
4. busy 时禁用分支按钮并将 `GitBranch` 替换为旋转的 `Loader2`。
5. 分支失败时必须恢复 busy 状态；现有上层错误处理继续负责用户反馈。

不可分支时不渲染分支按钮和分隔线。

### `StreamMessageV2`

接收并向真正承载复制工具条的消息组件传递分支参数。仅普通主会话消息获得这些参数；子代理对话和其他直接复用 `AIMessage` / `UserMessage` 的调用方不传参数，因此行为不变。

### `UserMessage` 与 `AIMessage`

接收可选分支参数并传给 `MessageActions`。现有工具条定位和显隐样式保持不变。

### `SessionMessages`

继续负责：

- 判断消息是否为用户消息、最终助手回复或中断消息。
- 计算 `branchPromptIndex`。
- 流式消息禁止分支。

改为把分支参数传入 `StreamMessageV2`，并删除消息组右上角的独立 `MessageBranchButton` 容器。

### `MessageBranchButton`

独立组件不再用于主消息列表。实现可以删除，避免未来误用和重复样式来源；若搜索确认无其他调用方，则同时删除文件。

## 数据流

1. `SessionMessages` 根据消息组计算 `branchPromptIndex`。
2. 流式消息将有效分支索引降级为不可分支状态。
3. `SessionMessages` 将索引和 `onBranch` 传给 `StreamMessageV2`。
4. `StreamMessageV2` 只向当前实际渲染的 `UserMessage` 或 `AIMessage` 继续传递。
5. 消息组件把参数交给 `MessageActions`。
6. `MessageActions` 在同一 hover 工具条内按“分支、分隔线、复制”的顺序渲染。

## 错误与并发处理

- busy 状态阻止连续点击分支。
- 使用 `try/finally` 保证成功或失败后都恢复按钮。
- 分支回调异常不在工具条内吞掉，维持上层既有错误处理与提示。
- 复制状态与分支 busy 状态相互独立，分支处理中仍允许复制。

## 测试

添加或调整回归测试，至少验证：

- `MessageActions` 支持可选分支操作。
- 分支按钮源码顺序位于复制按钮之前。
- 只有存在有效索引与回调时才显示分支按钮和分隔线。
- `SessionMessages` 不再渲染独立绝对定位的 `MessageBranchButton`。
- 分支参数能够通过 `StreamMessageV2` 传给用户消息和 AI 消息。
- 现有 TypeScript 类型检查与构建通过。

## 验收标准

- 悬浮可分支的非流式用户或 AI 消息时，只出现一个操作工具条。
- 工具条顺序为 `分支 icon | 复制 icon`。
- 两个按钮同时出现、同时消失。
- 分支按钮可点击且加载态正确，复制按钮行为不回归。
- 不可分支消息仍仅显示复制按钮。
- 主消息列表中不存在独立右上角分支浮层。
