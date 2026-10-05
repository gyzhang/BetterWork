# Task Continuity GPT-6 Luna 逐卡编码提示词

- 依据：[Task Continuity 产品设计](../designs/task-continuity.md)、[ADR-0038](../adr/0038-task-continuity-across-runs.md)（Accepted）、[实施契约](task-continuity-contracts.md)（v1.0）与 [TC00–TC05 唯一任务板](tasks-task-continuity.md)。
- 用法：在一个新的开发任务中一次粘贴并执行一张卡。不要把 TC00–TC05 全部放进同一个提示词；完成一张卡后，更新任务板和日志，再由用户决定是否开始下一张。
- TC00–TC02 已完成；下面的 TC01 提示词保留作历史授权文本，不要重复提交。后续卡片是否可开工以唯一任务板状态和用户当次指派为准。

## TC01：新 Task 目标和连续简报持久化

```text
请使用 GPT-6 Luna 完成 BetterWork Task Continuity 开发计划中的 TC01：新 Task 目标和连续简报持久化、恢复。

本提示词在新的开发任务中提交时，授权你实现 TC01 这一张卡及其必要的自动化测试和文档/日志更新。不要实现 TC02–TC05，不要扩展到 UI，不要创建子任务或委派其他智能体。

开始前必须读取：
1. `AGENTS.md` 和 `docs/development/README.md`；
2. `docs/development/tasks-task-continuity.md` 的 TC01 卡和共同工程门槛；
3. `docs/development/task-continuity-contracts.md` §1、§2、§6、§7、§8、§9；
4. `docs/designs/task-continuity.md`、`docs/adr/0038-task-continuity-across-runs.md`；
5. `docs/10-ui-ux-system.md` 与 `docs/12-engineering-standards.md` 中本卡相关章节；
6. 卡片涉及的现有协议、数据库迁移、Task 创建服务、Repository 和迁移测试源文件。

先核对当前分支、HEAD、工作区和应用数据库最新迁移号。保留所有已有改动，只修改 TC01 所需文件；若目标文件有与本卡冲突的未提交改动，停止冲突部分并说明，继续完成无冲突工作。不要根据任务板中的旧 HEAD 或旧 schema 号覆盖当前实现。

实现范围：
- 在共享 Agent 协议中定义并校验 `TaskContinuityBrief` / revision 所需的最小 Schema；类型、命名和目录遵循仓库现有约定。
- 在 `app-schema.ts` 追加连续版本、单事务的新结构迁移，为 `task_continuity_revisions` 与 `run_continuity_contexts` 提供契约要求的主外键、唯一性和约束。迁移号以开工时的实际最新版本递增。
- 建立最小 Repository/Service：新 Task 创建时，从已持久化的 `tasks.goal` 创建初始 Brief revision；revision 追加采用 Task 内递增版本和 `expectedRevision` CAS，拒绝跨 Task/Run 归属，并支持契约定义的幂等键。
- SQLite JSON 读取必须经 Schema 校验；损坏数据按契约报错，不能悄悄删字段或回退到不可信数据。
- 为新结构、新 Task 初始化、CAS 冲突、归属拒绝、幂等和事务回滚添加离线测试；用临时 SQLite 和合成数据。

数据决策是固定边界：当前是开发/测试阶段，用户明确允许丢弃现有非测试验证数据。本卡不做旧数据兼容，不扫描或总结历史消息，不从旧 `runs.prompt` 回填目标，不重建旧 Run/Artifact 进度，不加 `legacy-run-prompt` 分支。Schema 迁移只安装新结构；验收创建新 Task。可以使用临时数据库；若确需重置本地开发数据库，只操作已确认的开发数据库并在交接中说明，不删除测试夹具或无关文件。

规范与架构边界：
- 服从 `AGENTS.md` 和 `docs/12-engineering-standards.md` 这一份编码规范，包括版本化迁移、严格类型、错误收口、离线测试和文件纪律；不要增加局部规范、禁用 lint 或绕过护栏。
- 遵守 `docs/10-ui-ux-system.md`。TC01 不应引入任何 UI；后续 UI 卡必须复用现有 Task 工作区和可收起 ContextPanel。
- Renderer 不访问 SQLite；不要在 TC01 增加 IPC、Preload API、页面、组件或全局状态。
- 不改 RunService/Provider 的模型消息装配，不调用真实模型；这些归属后续卡。
- 不改其他任务系列、路线图范围或无关代码；如果发现需要更改产品边界、材料授权、Memory 或 Provider 公共协议，暂停相关部分并说明依据。

验证和收尾：
- 运行 TC01 的定向迁移/Repository/Service 测试及相关类型检查；在提交前阶段依仓库规则运行 `npm run verify`，完整保留原始输出，不通过管道截断。
- 阅读回所有本次编辑的中文文档，运行 `git diff --check`，确认测试不触网、未用私有工作材料。
- 只把 TC01 在真实完成证据支持下标为 `done`，更新本任务板和 `docs/logs/YYYY-MM-DD.md`；不要标记后续卡完成。
- 不提交、不推送、不发布。最终交接用中文，列明行为变化、主要文件、迁移号、测试与验证结果、任务板证据和未解决限制。
```

## TC02–TC05 的后续派发方式

完成当前卡后，用户可在新开发任务中复制下面的短提示词，并将编号替换为当次获指派的卡：

```text
请使用 GPT-6 Luna 完成 BetterWork Task Continuity 开发计划中的 [TC编号]。先读 AGENTS.md、docs/development/README.md、Task Continuity 设计、ADR-0038、实施契约、任务板对应卡片，以及 docs/10-ui-ux-system.md / docs/12-engineering-standards.md 的相关章节。核对前置卡证据、当前 HEAD、工作区和迁移版本；只完成被指派卡及必要测试/文档，不实现下一卡，不创建子任务或委派。遵守获批的无旧数据兼容、无历史回填边界；严格遵守现有 UI/工程规范。以任务卡验收证据更新唯一任务板和当日日志，运行卡片要求的离线测试与仓库验证，中文交接说明结果和限制；不要提交、推送或发布。
```
