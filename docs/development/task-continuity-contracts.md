# Task Continuity 实施契约 v1.0（Accepted）

- 日期：2026-10-05。
- 状态：**用户于 2026-10-05 批准设计、ADR 与开发计划；TC01 已完成，TC02–TC05 尚未开始。**
- 产品与架构：[Task 跨 Run 连续协作设计](../designs/task-continuity.md)（v1.0），维持“一个 Task 中持续多轮协作”的用户心智。
- 决策：[ADR-0038](../adr/0038-task-continuity-across-runs.md) 为 Accepted。
- 唯一实施入口：[TC00–TC05 任务板](tasks-task-continuity.md)。
- 提示词：[GPT-6 Luna 逐卡编码提示词](task-continuity-coding-prompts.md)，按 TC 卡片逐个启动。
- 依据：[领域模型](../02-domain-model.md)、[系统架构](../03-system-architecture.md)、[记忆实施契约 §6](memory-contracts.md#6-确定性召回与历史上下文)、[材料契约](material-contracts.md)、[UI/UX 体系](../10-ui-ux-system.md)、[工程规范](../12-engineering-standards.md)。

## 1. 目标与不变量

用户在同一 Task / Session 中连续提交需求；每次提交创建独立 Run。模型每轮都能获得稳定任务目标、有限的近期用户要求和可信工作状态。Run 仍负责本轮执行状态、配置/材料快照、取消、失败收口与审计。

实现必须保持以下不变量：

1. Task Continuity 是 Task 范围的短期上下文；不并入 `TaskContextRevision`、`MemoryRecord`、Evidence 或 ArtifactVersion。
2. Main 是 Brief 的唯一写入者和授权校验方；Renderer 只提交带 `expectedRevision` 的用户修订请求。
3. 每个 Run 的材料、能力和来源仍由本轮 `TaskContextRevision` / `RunContextSnapshot` 决定。Brief、旧 prompt、进度条目和 Artifact 路径不能授予读取权限。
4. 用户原文与助手整理的要求/进度分字段、标来源；助手生成内容不能覆盖或升格为用户指令。
5. 模型只接收来源可追溯且仍符合当前依赖规则的助手进度。来源缺失、未知或已撤销时省略该进度，不恢复不安全历史。
6. Task 目标、当轮用户 prompt 和原有运行事实均可保留；Brief 超限时只能按优先级省略完整条目，不得静默截断后冒充完整。
7. Brief 写入或审计快照失败时，不向 Provider 发出未审计的请求。Run 已产生的 completed/failed/cancelled 终态不因后续 Brief 更新失败而改写。

## 2. 数据契约提案

### 2.1 `TaskContinuityBrief` v1

共享类型和 Zod Schema 由 `packages/agent-protocol/src/index.ts` 唯一定义。持久化内容和 Renderer DTO 使用同一 Schema 校验；数据库 JSON 读取失败按损坏数据处理，不能静默丢弃字段继续运行。

```ts
interface TaskContinuityBrief {
  schemaVersion: 1;
  objective: {
    text: string;
    source: 'task-goal' | 'user-edit';
    sourceRunId?: string;
  };
  activeRequirements: Array<{
    id: string;
    text: string;
    authoredBy: 'assistant-summary' | 'user-edit';
    sources?: Array<{ runId: string; promptHash: string }>;
  }>;
  progress?: {
    authoredBy: 'assistant-summary' | 'user-edit';
    status: 'in-progress' | 'blocked' | 'awaiting-user' | 'complete';
    completedActions: string[];
    nextAction?: string;
    blockers: string[];
    artifactVersionIds: string[];
    sourceRunId?: string;
    sourcePromptHash?: string;
  };
}
```

- 首版目标从 `tasks.goal` 初始化。用户改目标追加新的 Brief revision；不覆盖旧 Brief revision，也不回写既有 `tasks.goal`。
- Assistant 更新的每条 requirement 必须带一个或多个同 Task 的 Run 来源；Main 从库中重算并保存成成对的 `{runId, promptHash}`，不接受模型或 Renderer 提供的 hash。无法证明来源时拒绝该条更新。用户在面板手动创建的 requirement 标记为 `user-edit`；编辑助手摘要时保留源 Run 链。
- `progress` 仅描述工作状态、已完成动作、阻塞、下一步和精确登记的 ArtifactVersion。不得写模型推理、未验证业务结论、工具载荷、材料正文或“内容已验收”等未经证实声明。
- `assistant-summary` progress 归属于产生它的 Run，且 Main 计算并保存对应 prompt hash；读取前保守复核该 Run 的完整材料/记忆依赖并集。依赖不可用、发生修订或哈希不符时不注入；缺旧审计记录按来源未知处理。用户自行创建的 progress 标记为 `user-edit`，修改助手进度时保留来源链。
- 助手生成的 requirement/progress 与用户编辑项保留各自作者标记及来源，不因用户查看、继续运行或没有提出异议而变为用户批准。

### 2.2 建议的持久化关系

新增两类记录，迁移号须以开工时实际最新 schema 递增分配（本契约静态核对时 `app-schema.ts` 最新为 v38，不能据此跳过开工重核）。迁移只增加结构，不做旧对话兼容或历史回填：

| 记录 | 约束 | 用途 |
| --- | --- | --- |
| `task_continuity_revisions` | Task 外键、Task 内正整数 revision 唯一、不可变 brief JSON、Schema version、来源类型、可选来源 Run、哈希与时间 | 保存用户修订和每次已接受的 Run 更新；取最新 revision 作为下一次 Run 的默认 Brief |
| `run_continuity_contexts` | `run_id` 唯一外键、Task / revision 归属、经 Schema 校验的实际 Brief 快照、规范哈希、准备时间、首个 Provider 请求阶段 | 证明某 Run 装配了哪一版 Brief；不保存密钥或完整 Provider 请求 |

Repository 在一个 SQLite 同步事务内校验 Task/Run 归属、`expectedRevision` 并追加 revision；并发旧写入返回上下文冲突，不覆盖新状态。每个 Run 在第一次模型派发前固定快照；所有后续工具轮请求必须继续携带相同 Brief。Provider 审计检查消息中 Brief 与快照哈希相符后才允许派发。迁移不重写 `runs`、消息、历史记忆快照、材料快照或来源记录。

`TaskContinuityRevision` 与 `TaskContextRevision` 完全分开：前者保存工作意图与进度；后者仍只保存执行者、能力、模型及材料选择。`RunContinuityContext` 不取代 `RunContextSnapshot` 或 `RunMemoryContext`。

## 3. Brief 解析、预算与装配顺序

### 3.1 输入来源

Main 在启动每个 Run 时按 Task ID 读取：

1. 新 Task 在创建时从 `tasks.goal` 确定性创建的首个 Brief revision。旧 Task 没有 Brief 时不扫描历史、不从 Run prompt 兜底；开发/测试验证通过新建 Task 完成，必要时重置本地数据库。
2. 同一 Task 的最近用户提交，按 Run 创建顺序逆序查找，包含 failed/cancelled Run 的 `runs.prompt`；不读取其他 Task 的消息。
3. 最近 Run 的真实终态与错误类别、已登记 ArtifactVersion 的精确 ID/版本/来源；只读事实表，不从助手自然语言猜成果状态。
4. 现行安全历史重放和 Memory 决策。它们仍由 `memory-recall-service` 及历史契约决定，Brief 不绕过其过滤。

历史 prompt 只作为有来源的用户要求线索，不作为当前材料清单。它们不能授权读取 prompt 中提到的路径，不能将旧来源变成 Evidence，也不能覆盖本轮 prompt。

### 3.2 初始预算（已批准）

所有额度使用 Unicode code point 计数并由协议单一常量定义，禁止在 Service/Renderer 复制阈值。用户已接受下列首版预算；实施时用 Fake Provider 和确定性省略策略验证，不根据模型输出临时改阈值：

| 部分 | 首版建议上限 | 超限规则 |
| --- | ---: | --- |
| 目标 | 20,000 | 与当前 `createTaskRequestSchema.goal` 上限一致；目标本身不静默裁切 |
| 当前活跃用户要求 | 4 条 / 合计 2,000 | 按最新用户来源优先，要求整体纳入或整体省略 |
| 最近用户 prompt | 最多 3 轮 / 合计 8,000 | 按当前 Task 最近到较早选择完整 prompt；不截半条，不安全的旧助手回答不随 prompt 注入 |
| 最近进度 | 合计 2,000 | 超限时整条 progress 不注入并记录 skip reason |
| Continuity 组装总预算 | 32,000 | 目标 → 用户要求 → 最近用户 prompt → Assistant 进度；只省略低优先级完整项并在审计摘要标明原因 |

当前 Run 的 prompt 仍按现行 `startRunRequestSchema` 上限独立传入，不计入上述 Brief 预算。模型输入若因模型 profile 的可用上下文更小而不能容纳 Brief 与既有内容，按“本轮消息 → 原始目标 → 最近明确用户要求 → 最近 prompt → Assistant 进度”的优先级省略低优先级的完整条目，并在审计中记录原因；不得更改 Provider 上下文窗口或记忆/历史配额。

### 3.3 消息顺序

复用现有 `AgentRunInput.messages` 与 Agent Core 顺序，形成：

1. Agent Core 系统指令、Expert 指令、Skill 指令。
2. Task Continuity Brief（任务目标、带来源的用户要求、可用的进度/状态）。
3. 既有 Memory block 与安全历史对话，顺序按 memory 契约保持；本轮不改变其选择策略。
4. 当前 Run 的材料清单与授权边界说明。
5. 当前用户 prompt。

注入为清楚标记的 system message，指明 Assistant 摘要是辅助上下文、用户当前要求优先、该 Brief 不授予读取权限。`RunService` 不能用字符串相似度把自然语言内容升级为权威数据。

## 4. 更新与终态语义

- 新 Task 首个 Brief 只从已持久化 `tasks.goal` 构造；绝不从旧 Run prompt 迁移或补齐目标。既有开发/测试数据无生产保留要求，可在验证需要时重置；迁移不得为其回填 Brief。
- 每次提交的原始用户请求已在 `runs.prompt` 持久化。Run 失败/取消时保留原 Brief，下一轮可读最近用户 prompt 与 Run Journal 终态，不声称动作完成。
- completed Run 的候选 `TaskContinuityUpdate` 必须 Schema 校验、验证 source Run/Task/prompt hash/ArtifactVersion 归属和依赖闭包后，才能追加 revision。来源验证失败仅丢弃候选更新并留明确错误，不改变 Run 已完成终态。
- 计划保留“同一次 Run 内更新，不另起摘要 Run/独立 summary completion”的产品约束。现有 `ModelProvider` 只公开 text/tool-call/done chunk；Agent Core 对 ToolCall 默认会进入后续模型轮次。因此只在常规响应能通过类型化 side channel 提供更新时接收模型语义进度；若当前 Provider 无法可靠提供，首版采用确定性 Run/Artifact 状态和现有安全历史，不偷加第二次总结调用。该 fallback 已获用户接受。
- Failed/cancelled Run 从 Run Journal 的真实终态生成确定性 fallback。只有已登记 ArtifactVersion 可列为成果；没有登记事实时不得声称成果存在。Brief 更新写库失败不得使成功 Run 变 failed，UI 显示“任务进度未同步”并保留旧 revision。
- Run snapshot 记录该次运行实际使用的 Brief revision、Brief JSON、哈希和请求阶段。若首个或后续 Provider 请求的 Brief 与快照不一致，拒绝派发并沿现有 Run 失败路径收口。

## 5. 用户编辑与 IPC 边界

- 在当前 Task 的过程/上下文面板中检查目标、活跃要求、助手进度、来源 Run 和 ArtifactVersion；没有目标准备表单，不要求每轮确认。
- 用户可修改目标、增删活跃要求、修正或清除助手进度。用户独立新增的要求可没有来源 Run；若修正助手摘要则保留原始 Run/prompt 来源并标记为用户修订。写入使用独立的 continuity revision + `expectedRevision` CAS，不隐式改 `TaskContextRevision`。
- 新 IPC request/result schema 统一放 `packages/agent-protocol/src/index.ts`；只在 `register-ipc.ts` 注册，Preload 双向 Zod 校验，Renderer 由 hook 调用并收口错误。
- Main 以 Task ID 验证 Workspace/Run/Artifact 归属。Renderer 不提交可直接决定的 revision id、来源 hash 或依赖集合；这些值由 Main 从持久化对象重算。
- 页面复用当前工作任务与过程/上下文区域，不加一级导航、全局 Toast、独立 Expert 配置或额外 Memory scope。

## 6. 迁移、失败与恢复

1. 新迁移遵守 `app-schema.ts` 的连续版本、单事务、迁移测试和外键检查。迁移仅建立本功能表结构，不遍历历史 Task、Run、消息或 Artifact，不做回填和数据兼容。迁移测试验证 schema 安装与结构约束；新 Task 的连续性行为用临时数据库验证。
2. Run 启动时先完成 Brief 解析和不可变 snapshot 写入，再进入 Provider dispatch。准备/审计写入失败时不发送模型请求，Run 用现有终态兜底收口。
3. Brief update 可按 `(task_id, source_run_id)` 做幂等，避免 Main 恢复或重复事件产生两次 revision。update 只允许来自同 Task 完整终态 Run。
4. 进程重启不重跑模型、不根据空白摘要推断结果；从 SQLite Brief revision、Run Journal 和 ArtifactVersion 重建视图。
5. Task 删除由已有 Task/Workspace 生命周期处理；Brief 与 Run snapshot 按 FK 生命周期级联，不产生孤儿行。

## 7. 验收矩阵

| 场景 | 预期 |
| --- | --- |
| 新 Task 首轮 | 初始 `tasks.goal` 被持久化并出现在首个 Run 的实际 ModelRequest；当前 prompt 仍单独位于最后 |
| 首轮 Provider 连接失败后用户输入“继续” | 第二个 Run 收到原始目标、失败终态、最近失败 Run 的原始 user prompt；不声称有未登记成果 |
| 最近历史对超 `history-budget` | Brief 和用户 prompt 保持可用，旧 assistant 回答仍被现行规则省略；审计说明各自省略原因 |
| 多个连续用户修订 | 来源 Run/promptHash 保持精确；更新按新旧顺序合并；助手摘要不能覆盖最新用户明确要求 |
| TaskContext 材料移除/知识修订/记忆来源撤销 | 当前 Run 的授权不扩大；依赖不再安全的助手 progress 不进入 Brief；Task goal/user-authored instruction 的行为符合已批准的隐私边界 |
| 同 Task 完成并登记 ArtifactVersion | 简报只列准确的版本 ID/状态/来源；未登记路径与 assistant 自述不能冒充成果 |
| Update 错误来源、跨 Task Run、错误 prompt hash 或不存在 ArtifactVersion | Main 拒绝候选更新；不写 Brief revision，不改变主 Run 终态 |
| Brief/User edit 并发 | 旧 `expectedRevision` 得到冲突；重读后可保留用户选择，不覆盖较新更新 |
| Provider 多轮 ToolCall | 每个 ModelRequest 都包含完全相同的 Brief snapshot；Brief 不因材料工具或 Memory 变化而在 Run 内热更新 |
| 应用重启、Run 被强杀 | 迁移/恢复保持 Brief、snapshot 和 Run 终态一致；不自动重复调用模型 |
| 新 Task / 不同 Workspace 或 Expert | 不继承前 Task 的 Brief、要求或进度 |

自动化采用 Fake Provider、临时 SQLite 和合成材料；至少核对实际 `ModelRequest.messages`、持久化内容与授权拒绝，不只测格式化纯函数。旧数据兼容与回填不是验收项。Renderer 修改还需真实桌面人工走查。真实模型语义与付费调用仍须单独授权。

## 8. 明确不做

- 合并 Session/Run、让一个 Run 跨多个用户提交持续不终止。
- 无限回放所有聊天或工具事件、从任意自然语言猜测结构化目标或进度。
- 把 Task Brief 存进或提升为 Memory；引入 Embedding、跨 Task 反思、全量扫描或自动定时总结。
- 由 Brief/旧消息/旧 Artifact 路径扩大当前材料、MCP、网络或 Skill 授权。
- 单独再启动一个模型 Run/隐藏模型请求来总结上轮；如需改变此约束，另行评审 ADR 与成本/失败语义。

## 9. UI 与工程规范

- UI 设计以 [UI/UX 体系](../10-ui-ux-system.md) 为准：按 §5.1 Task-first 和 §5.3 渐进披露组织信息，复用 §6.2 Task 工作区与可收起的 ContextPanel，遵循 §11.3 面板及 §11.5.1 反馈出口、§12 可用性底线。组件使用 §10.1 台账里的现有基座；不得新增一级导航、局部色值、页面自造 Toast 或跳过真实桌面走查。
- 代码以 [工程规范](../12-engineering-standards.md) 为唯一标准；遵循 §2–§8 的目录、命名、类型、异步错误、迁移、IPC 与 Renderer 收口规则，以及 §9 测试约定。Schema/IPC 只在共享协议定义并双向校验；迁移保持版本化；所有新增领域行为补离线回归。
- 每张编码卡先读仓库 `AGENTS.md`、本契约、对应 ADR 与 UI/工程规范相关章节，并按最新代码状态重核文件/迁移基线；不能把本契约当作豁免规范。
