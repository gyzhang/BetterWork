# Task Continuity 开发计划（TC00–TC05）

- 日期：2026-10-05。
- 状态：**产品、ADR 与开发计划已于 2026-10-05 获用户批准；TC01–TC03 已完成，TC04–TC05 尚未开始。**
- 产品入口：[Task 跨 Run 连续协作设计](../designs/task-continuity.md)（v1.0）。
- 技术入口：[ADR-0038](../adr/0038-task-continuity-across-runs.md)（Accepted）与[Task Continuity 实施契约](task-continuity-contracts.md)（v1.0 Accepted）。
- GPT-6 Luna 交接：[逐卡编码提示词](task-continuity-coding-prompts.md)。本文是 TC 唯一任务状态真相源；每卡仍需单独开工指派，真实模型业务验收与发布分别处理。
- TC00 文档阶段的静态基线快照：HEAD `9031d41`；工作树仅含此前 Task Continuity 文档修改；当时应用库迁移 v38，`Task.goal` 上限 20,000 code points、Run prompt 上限 8,000；RunService 经 `AgentRunInput.messages` 注入 Memory、受限历史和本轮材料，Agent Core 把它们放在系统/Expert/Skill 指令之后、当前 prompt 之前。每卡开工仍须重核，不按此历史快照覆盖新实现。
- TC01 开工实测：HEAD `70cc423d5126fafd8a6209830522e3fe85652d5e`，分支 `main`，工作树干净；`app-schema.ts` 与实际应用数据库最新迁移均为 v38。TC01 迁移递增至 v39；未重置或写入实际应用数据库。
- TC02 开工实测：HEAD `4188e3bd69d5367499b2545da0b3a71421a508be`（TC01 提交），分支 `main`，工作树干净；代码迁移为 v39，实际应用数据库通过只读 `schema_migrations` 查询为 v38。TC02 迁移递增至 v40；实际应用数据库未重置或写入。
- 执行：所有实现串行，一次一张卡。共享协议、`app-schema.ts`、RunService、App/ContextPanel 不并行修改。优先使用现有分层和组件，不创建新导航或第二套历史/记忆系统。

## 1. 目标与完成门槛

同 Task 多轮提交在用户体验上形成连续对话；每个新 Run 的实际模型输入都包含可回查的 Task Continuity snapshot；失败/取消及安全历史预算不会丢失原始目标；Brief 不扩大本轮材料权限；用户能检查并纠正持久化目标和活跃要求。

整体完成必须同时满足：TC01–TC04 实现证据齐全；TC05 的跨层回归通过；版本化迁移覆盖新建结构和回滚；用户在真实桌面走查主要旅程；相关文档与当日日志齐全。旧数据兼容、历史对话回填不是目标或验收项。真实模型语义和发布分别按独立授权处理。

### 授权口径

- 用户已明确批准产品/架构方案、ADR-0038、实施契约与 TC 开发计划，并说明开发期数据可重置、不需旧数据兼容，UI/编码须遵循当前规范。
- TC00 文档阶段的授权范围仅覆盖设计、计划、提示词和文档归档；产品代码须按 TC 卡片另行单独指派。
- 用户于 2026-10-05 单独授权 TC01 的实现、必要自动化测试和文档/日志更新；不包含 TC02–TC05、UI、真实模型调用或提交/推送/发布。
- 每卡交付只推进该卡，不自动进入下一卡；若实现发现可能改变已接受行为的技术边界，回到产品/ADR 记录后再继续，不能由编码卡静默发明。

## 2. 里程碑

| 里程碑 | 交付 | 收口条件 |
| --- | --- | --- |
| M0 · 技术评审 | TC00 | 用户已接受 ADR-0038、实施契约与预算/降级决策；本里程碑完成 |
| M1 · 持久化与稳定注入 | TC01–TC02 | Brief revision 与 Run snapshot 可迁移/恢复，真实 ModelRequest 带入每轮简报 |
| M2 · 同轮更新与用户治理 | TC03–TC04 | 更新来源/依赖安全、终态不被污染；用户可检查和修正 |
| M3 · 端到端验收 | TC05 | 失败、超预算、权限缩小、重启与跨任务隔离闭环通过 |

不承诺未实测工期。实现中若证据要求改变产品行为，先回到产品设计/ADR 收敛，不在代码卡里改范围。

## 3. 唯一任务板

状态仅用 `todo / doing / blocked / done`。卡片未获开工指令前保持 todo；没有测试、日志或人工走查证据不得标 done。

| 编号 | 用户可感知交付 | 前置 | 优先级 | Points | 状态 | 证据 |
| --- | --- | --- | --- | ---: | --- | --- |
| TC00 | 设计决策接受与基线复核 | 无 | P0 | 3 | done | 用户于 2026-10-05 批准产品/架构/计划；ADR-0038 与契约转 Accepted；固定 32,000 code point 初始总预算、同次响应更新/确定性 fallback、不发独立摘要请求及无旧数据回填。每张代码卡开工仍重核最新基线 |
| TC01 | 新 Task 目标和连续简报可持久化、恢复 | TC00 | P0 | 5 | done | v39 安装两张新表与归属/幂等/JSON/不可变约束；新 Task 通过 Main 同事务从已持久化 `tasks.goal` 初始化 revision。开工 HEAD `70cc423d`、工作树干净、实际库 v38；本地库未重置。定向测试 4 文件/113 项通过；完整 `npm run verify` 退出 0：functional 212/1,886、heavy 8/167、build、ui:check 58 组通过 |
| TC02 | 每个新 Run 可回查它实际获得的任务简报 | TC01 | P0 | 8 | done | v40 在既有 Run 快照上持久化省略审计并加 SQLite 单次 Provider 请求时间护栏；Main 按固定预算装配目标/来源要求、最近同 Task 用户 prompt 与真实 Run/登记 Artifact 状态，快照写入后才允许派发，每轮核验相同 Brief。Fake Provider 集成覆盖失败后继续、长历史与 prompt 预算、跨 Task/材料隔离、第二轮一致性、缺 Brief/审计失败零派发；迁移/Repository/RunService 定向测试 3 文件 / 126 项通过，`npm run typecheck` 通过，完整 `npm run verify` 与 `git diff --check` 证据见 2026-10-05 日志 |
| TC03 | 完成轮次能安全更新进度，失败/取消有确定性降级 | TC02 | P1 | 8 | done | Run completed 后由 Main 按 Journal/精确 ArtifactVersion 写入确定性助手进度；校验同 Task、completed 终态、源 prompt SHA-256、ArtifactVersion 归属及材料/记忆依赖闭包，按 source Run 幂等；user-edit 进度不被覆盖，失败/取消不写成功进度，更新失败不改 Run 终态。常规 Provider 没有可用的类型化 update 通道，因此未扩展 Provider 协议或发摘要请求。定向测试 4 文件/79 项、typecheck 通过；完整 `npm run verify` 退出 0（functional 213 文件/1,893 项，heavy 8 文件/174 项，build 成功，ui:check 58 组通过）；代码迁移 v40、实际应用库 v38 均未改动，详情见 2026-10-05 日志 |
| TC04 | 用户能查看并修正本任务目标与活跃要求 | TC01、TC02 | P1 | 8 | todo | 预期增量：最小 IPC/Preload/Hook/现有任务过程面板 UI；CAS 保存、来源 Run 跳转/说明、助手摘要与用户文本标签、局部错误出口；复用现有 UI 基座，无新导航。需真实桌面走查 |
| TC05 | 连续对话全链路满足安全与恢复契约 | TC02、TC03、TC04 | P0 | 5 | todo | 覆盖失败/取消、历史超预算、材料撤销/来源失效、artifact 精确版本、更新写入失败、并发 revision、重启、跨 Task/Workspace/Expert 隔离；实际 ModelRequest + 临时 SQLite；相关全仓 verify 与用户桌面旅程证据 |

Points 是相对复杂度建议，不是时间承诺；TC00 已关闭。若实施中验证导致复杂度估计明显变化，在对应卡证据中记录理由，不因此擅自改变产品范围。

## 4. 各卡共同工程门槛

- 先读 `AGENTS.md`、[Task Continuity 实施契约](task-continuity-contracts.md)、ADR-0038、docs/12 对应段落和卡片指定源文件；开工先核对工作树与最新迁移。
- UI 卡还必须读 [UI/UX 体系](../10-ui-ux-system.md) §5、§6.2、§10.1、§11.3、§11.5.1、§12；复用既有 Task 工作区、可收起 ContextPanel 与反馈组件。编码只遵守 [工程规范](../12-engineering-standards.md) 这一份标准。
- 协议只在 `packages/agent-protocol/src/index.ts`；SQLite 只用 `apps/desktop/src/main/db/app-schema.ts` 版本化迁移；IPC 只在 `register-ipc.ts`，Preload 两侧校验；服务与 Renderer 遵守既有层级。
- 不修改用户已有文件或数据；不复制私有工作材料进测试。用合成 prompt/材料和 Fake Provider；所有实际 Run ModelRequest 上断言目标 Brief 与材料边界。
- 新领域行为、Schema 迁移、事件顺序、失败与取消必须补自动化测试。每代码卡执行相关定向验证；达到提交前阶段时执行 `npm run verify`，完整输出留证。
- 用户可见 UI 改动必须在真实 macOS 窗口走查并写“动作 → 预期 → 实际”；组件测试不代替真实界面验收。
- 每卡收尾读回中文文件、`git diff --check`，更新本表状态/证据和 `docs/logs/YYYY-MM-DD.md`；不提交、不推送、不发布。

## 5. 卡片边界与停止条件

### TC00：设计决策接受与基线复核（无代码，已完成）

- 用户于 2026-10-05 明确批准产品/架构/开发计划，并确认开发期数据可重置、无需旧数据兼容，UI/编码遵循当前规范。
- 冻结实施决策：32,000 code point 初始 Brief 总预算；结构化助手进度只接收当前 Run 常规响应中的类型化更新，无法提供时采用确定性 Run/Artifact 状态；绝不另起摘要模型请求。
- 冻结数据和边界：新 Task 从持久化 goal 初始化；迁移只增结构，不回填旧 Task、Run 或消息。版本化迁移、Main 授权校验、本轮材料隔离、失败/取消语义按契约实施。
- 当前静态基线曾核对 HEAD `9031d41`、应用库 schema v38、RunService/Agent Core 消息顺序。实际编码卡仍须重核最新 HEAD、工作树和 schema 版本。
- 停止条件：发现需要扩大 Memory、材料授权、Provider 公共能力范围或新增产品入口时，回到产品/ADR 评审，不让 TC01–TC05 推断范围。

### TC01：持久化与新 Task 初始 Brief

- 初始化只信任新 Task 创建时已持久化的 `tasks.goal`。不从 Run prompt 回退，不扫描、回填或总结旧 Task/历史聊天。开发数据库可为验收重建；新建 Task 作为主要测试对象。
- revisions append-only；用户写入必须 CAS。重复 `(task_id, source_run_id)` 更新幂等；所有 Run/Task/Workspace 归属在 Main 校验。
- 必测：迁移可在当前 schema 上原子新增结构、连续打开幂等、外键、非法 JSON/枚举、CAS 冲突、事务故障回滚。验证迁移不扫描或回填历史内容；无需证明旧业务数据保留。
- 完成证据：共享 `TaskContinuityBrief` / revision Schema 严格校验；Repository 对 SQLite JSON 做 Schema 与 SHA-256 校验，损坏时报错；CAS、助手 Run 更新幂等与用户修订来源链分开；Brief 内 Run 来源均校验同 Task 且终态。Task 初始化失败与迁移 DDL 失败均证明事务回滚；应用迁移未扫描/回填旧 Task 或消息。
- 最终验证：目标测试 4 文件/113 项；`npm run typecheck`、改动文件 lint/Prettier 检查、`git diff --check` 通过。`npm run verify` 退出 0（functional 212 文件/1,886 项，heavy 8 文件/167 项，build 成功，ui:check 58 组通过）。实际应用数据库 v38 保持未修改，迁移号将随应用正常启动升至 v39。

### TC02：Run 快照和上下文装配

- 在 Main 装配后先存 `run_continuity_contexts` 快照，再让首个 Provider request 可派发；包装器对每个工具轮校验 Brief 消息哈希与快照完全一致。
- 顺序依契约 §3.3；历史 user prompt 只描述工作意图，不可当材料。Brief 缺失或审计落库失败时不发模型请求，Run 以既有失败终态收口。
- 必测：Fake Provider 捕获**真实请求消息**；首轮失败→继续、前一轮长历史 skip、prompt 尾部预算、跨 Task/材料引用不得进入、模型工具第二轮快照一致、dispatch 保存失败零 Provider 请求。

### TC03：更新、依赖闭包和失败降级

- 只接受同 Task 的 completed Run 产生的 Schema 化更新，精确校验 source prompt hash、artifact-version 所属和依赖集合；更新不可以改 Task goal 或 Run 状态。
- 写 revision 前重验 Run 终态与当前有效材料/记忆来源；按 sourceRunId 幂等；过期、撤销或来源未知时过滤 progress，并保留用户目标/要求。
- 如果当前 Provider 无法在常规响应中提供结构化 update，首版仅从 Journal / Artifact 表形成确定性状态；失败/取消显示真实类别，不能把自然语言“做完了”当作结果。
- 必测：错 Task/错 hash/不存在或他 Task Artifact 拒绝；来源删除/修订后进度不注入；completed 后 Brief 写入失败但 Run 仍 completed；failed/cancelled 不接纳成功进度；候选事件重复不多建 revision。

### TC04：面板检查与编辑

- 只在现有工作 Task 的上下文/过程区域呈现；用户可以清晰区分任务目标、用户要求、助手整理的进度、Run 来源与登记成果。
- 保存分别传 `expectedRevision`；请求乱序/切 Task 后旧响应不能覆盖；用现有 InlineError/Action 收口，不新建 Toast 或通用 CRUD 基座。
- 必测：加载新 Task 初始 Brief、编辑目标和要求、修正助手进度、版本冲突重载、切 Task 快速返回、IPC 错误、窄窗/键盘/可收起 ContextPanel。真实窗口逐条记录实际结果。

### TC05：联合验收

- 以契约 §7 验收矩阵逐条映射到自动化测试或人工动作，表中无“暂时略过”而仍标整体完成。
- 同时核对应用库迁移版本、新 Task 的真实模型输入与工具范围、错误/取消终态、任务间隔离、Artifact 来源与 UI 进度文案；旧数据保留/兼容不作为验收条件。
- 最终完整 `npm run verify` 以原始完整输出记录；产品行为质量和真实模型摘要语义若超出 Fake Provider 技术合同，另行请求真实模型授权和用户验收。
