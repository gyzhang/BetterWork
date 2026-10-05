# ADR-0038：Task 跨 Run 连续协作上下文

- 状态：Accepted（2026-10-05 用户批准设计、ADR 与开发计划；开发/测试数据可重置，不做旧对话回填或历史 Task 兼容）。
- 日期：2026-10-05。
- 依据：[Task 跨 Run 连续协作设计](../designs/task-continuity.md)、[领域模型](../02-domain-model.md)、[系统架构](../03-system-architecture.md)、[ADR-0008](0008-personal-workbench-and-capability-first.md)、[ADR-0014](0014-expert-context-and-material-binding.md)、[记忆实施契约 §6.3](../development/memory-contracts.md#63-安全历史重放)。

## 背景

产品领域已经将 Task 定义为持续工作、Session 定义为连续协作上下文、Run 定义为一次 Agent 执行。用户可见体验应是同一 Task 中持续多轮提交与修订，而不需要理解每次提交背后的 Run 生命周期。

当前跨 Run 上下文依赖有限的安全历史重放。Task 的持久化目标没有作为稳定任务上下文独立注入；失败 Run 和超预算历史可能无法重放，造成“同一 Task 中继续工作”与模型实际可用上下文之间不一致。完整重放所有历史也会突破安全、权限和上下文预算边界。

## 决策提案

1. **保留 Task / Session / Run 三个领域对象及其职责。** 一个 Task 表示持续工作；一个 Session 承载围绕该 Task 的连续协作；每次用户提交启动独立 Run。Run 保留独立状态、输入范围快照、取消、失败收口和审计能力。UI 不将 Run 暴露为用户必须管理的对话单位。
2. **引入 Task 作用域、版本化的 Task Continuity Brief。** 每个 Run 都在 Main 侧获得有界 Brief，至少表达持久化任务目标、用户明确提出且仍生效的后续要求、最近进度/阻塞、真实 Run 终态，以及已登记 ArtifactVersion 的精确状态和来源。Brief 区分用户原文/修订与助手生成的进度摘要，并保留来源关系；助手摘要不得静默改写用户意图。
3. **Brief 与现有 TaskContextRevision、Memory 分离。** TaskContextRevision 继续表达本次 Expert、模型、Skill、工具和材料配置；Memory 继续按既有作用域、治理和来源规则工作。Brief 是同一 Task 内的短期工作上下文，不是长期记忆、授权、Evidence 或内容质量认证，不跨 Task / Workspace / Expert 自动共享。
4. **安全历史重放作为补充，不再是连续性的唯一来源。** 可重放历史继续受现行依赖校验与预算约束；失败、不安全或超预算的问答可以省略，而 Brief 仍提供最小稳定任务状态。提示上下文有总预算时优先保留本轮消息、原始目标及最近明确用户要求；不得把被截断的 Brief 伪装成完整内容。
5. **每轮的材料和权限保持独立。** 每个 Run 仍从当次有效 TaskContextRevision 建立不可变输入/授权快照。历史消息、Brief 和旧 Run 中出现的材料路径不能扩大当前 Run 的可读范围；材料撤销、范围收缩、来源校验和 Evidence 规则继续生效。
6. **以类型化更新维护进度，不从自由文本猜测权威状态。** 提案采用与当前 Run 同程产生的可选结构化 TaskContinuityUpdate 更新 Brief，不为摘要额外发起模型调用。Main 校验 Task/Run/ArtifactVersion 归属后追加 revision。若 Run 在更新前失败或取消，保留上一版 Brief，并从 Run Journal 与已登记成果构造保守的确定性状态；Brief 更新失败不得篡改 Run 终态。
7. **以 Task 对话为主界面，执行记录渐进披露。** 同 Task 消息流呈现多轮协作；目标和进度可在现有过程/上下文区域检查与修正，Run 事件、工具和状态按需展开。不新增一级导航、启动准备表单或要求每轮确认 Brief 的门槛。
8. **只做安装新结构所需的版本化数据库迁移，不迁移旧对话数据。** 新建 Task 时从已持久化的 `tasks.goal` 初始化 Brief。迁移不扫描旧消息、不从历史 Run prompt 回填目标或要求、不重建旧进度。开发/测试数据库可在需要时重置；旧 Task 不保证获得连续简报，验证以新建 Task 和合成测试数据为准。

## 考虑过的方案

- **维持当前受限历史重放为唯一机制**：实现成本低，但失败 Run 与超预算轮次会让同一 Task 的“继续”失去任务目标，不满足连续协作预期。
- **每轮无界重放全部消息和工具事件**：不采用。上下文成本无界，也可能让旧材料依赖、已撤销来源或不安全工具载荷进入新 Run。
- **把整个 Task 合并成单一长期 Run**：不采用。会模糊每轮状态、输入授权快照、取消和失败恢复边界，并与现有 Run Journal / 执行生命周期冲突。
- **仅依赖用户每轮重述**：不采用。将系统持续任务上下文的责任转嫁给用户，也无法满足失败后仅说“继续”的常见工作方式。
- **新增 Task Continuity Brief，并保留有限重放**：推荐方案。任务意图稳定可得，详细历史仍走已有安全规则；代价是新增版本化状态、迁移、装配与用户可检查的来源呈现。

## 边界与后续细化

实施细化见 [Task Continuity 实施契约](../development/task-continuity-contracts.md) 与 [TC00–TC05 任务板](../development/tasks-task-continuity.md)。类型化进度更新只可随常规 Run 输出产生，不另发摘要模型请求；若当前 Provider 无法提供同次响应的结构化更新，首版采用确定性 Run/Artifact 状态。初始预算和完整降级顺序见契约。用户批准的是设计与计划；代码尚未开工，真实模型语义验收与发布仍按各自边界处理。

具体用户行为、字段语义、上下文优先级、材料边界、迁移和验收场景见[产品设计稿](../designs/task-continuity.md)。
