# 专家与任务材料开发计划

- 生效：2026-09-14，用户通过[设计 v0.2](../designs/experts-and-task-materials.md)评审并要求落实设计、形成开发计划。
- 决策：[ADR-0014](../adr/0014-expert-context-and-material-binding.md) 已接受；具体字段、记忆投影、MCP 与解析器实施选择按本计划对应任务落档，不把设计接受写成代码完成。
- 核对基线：BetterWork `e283c47`，E11–E54 已按本计划提交并推送；E55/E56 仍按真实条件保持 partial。后续每张任务卡继续独立提交、推送并记录门禁结果。
- 平台：本轮 macOS；Windows 保留原待办，不扩大自动调度、多 Agent、通用 DAG 或企业权限。
- 执行方式：串行、每次一张任务卡；遵守 [执行手册](README.md)与全仓唯一 [工程规范](../12-engineering-standards.md)。不创建新规范或单独测试门禁。
- 验收边界：本计划先验收 Expert/Skill/材料/工具/MCP/成果的技术链路、状态、范围与失败收口是否自洽；除非任务卡明确写出场景质量目标，不评价示例 Expert、Skill、提示词或模型产出的业务质量，也不因质量问题扩大实现范围。

## 1. 交付顺序与完成口径

| 里程碑 | 用户得到什么 | 结束位置 |
| --- | --- | --- |
| E1 专家可用 | 创建/配置专家，点击召唤直接对话，真实使用人格与多 Skill | E15；不宣称材料隔离、长期记忆或 MCP 已交付 |
| E2 材料可控 | 选择知识、历史成果与当期文件，实际读取受本次清单限制，版本与来源可追溯 | E25；先覆盖现有可解析格式 |
| E3 记忆可复用 | 查看、确认、修改/删除记忆，新任务复用且不串公司 | E32 |
| E4 外部资料可用 | 配置 MCP、选择具体工具真实调用，获取网页正文与来源 | E43 |
| E5 两期工作闭环 | 读取 PPT/XLSX 输入，讨论、分析、生成报告和可编辑 PPT，再做下一期 | E56；完成整体设计验收 |

第一步执行 **E00**，核对并补齐 A/macOS 与 B0 前置证据，随后 E10 → E15 交付第一个可使用的专家。不能一次性建立全部领域表后再开始 UI，也不能先做无执行接线的专家页面。

不承诺未经验证的工期。每张卡记录实际开始/完成时间、变更、测试和遗留；E15 完成后按真实工作量更新后续排程。每个里程碑均有自动测试与真实桌面旅程，不用纯草图代替验收。

## 2. 当前基础与前置

| 范围 | 当前证据 | 处理 |
| --- | --- | --- |
| Skill 管理、修订、依赖与运行工具 | 已有代码及阶段 A 测试记录 | 复用，不重造安装器、信任体系或执行器 |
| Run 多 Skill、顺序注入、Composer 与撤销 | B00-1…4 任务板标 done，B00-5 doing | UI 双 Skill 运行与重启恢复仍有人工验收尾项（B00-5 原卡），E00 核对 |
| A12/A16/A17/A19/A20/A21 | 任务板仍有 doing/todo | E00 按对应原卡核对/收尾，不悄悄视为通过 |
| Workspace/Task/Session、Artifact、Knowledge | 已有仓储、服务及 UI | 沿用 ID 与既有对象关系；输入格式与精确范围需新增 |
| Memory、MCP | E30–E32 已接入最小记忆管理与注入；E40–E42 已接入 stdio MCP 配置、工具选择与运行适配 | 复用现有协议、Run 快照和来源记录；真实外部账号/业务端点仍按 E43/E55 的人工条件验收，不把离线替身写成真实连接 |

E00 不重复此前已证实且未受变更影响的测试；以最新提交、真实日志和任务板对照，缺证据才补。未完成的 A 卡继续在原任务板维护，不能复制一个 done 到本计划覆盖原状态。首个业务实现 E11 在 E00/E10 完成后开展；E10 的契约细化可在 E00 收尾期间做文档工作。

## 3. 唯一新任务板

本表是 E 系列状态真相源；下面卡片不重复维护状态。旧 B01–B04 与 C01–C08 的迁移映射见 §5，禁止两套任务同时实施。

| 编号 | 工作 | 前置 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| E00 | A/macOS 与 B0 前置核对收尾 | 原 A/B0 卡 | done | [2026-09-14 日志](../logs/2026-09-14.md)：`npm run verify` 全绿；通过 `scripts/dev-start.sh` 启动真实 macOS Electron 窗口并核对 `+ → 技能 → ppt-generation-expert → chip` 路径；B00-5 双技能真实运行与重启回看缺少记录，已将原卡恢复为 doing，不伪造通过 |
| E10 | 专家、草稿与运行精确契约 | 本设计已接受 | done | [专家与任务上下文契约](expert-contracts.md)：Expert/Revision、E1 TaskContextRevision、Skill/模型/内置工具解析、启动事务、旧任务迁移、冲突和错误码已定案；仅文档，未创建表或 IPC |
| E11 | 专家修订、管理服务与迁移 | E00、E10 | done | [ExpertRepository/Service 测试](../../apps/desktop/src/main/persistence/expert-repository.test.ts)、[迁移与 IPC 测试](../../apps/desktop/src/main/db/migrate.test.ts)；v9 experts/expert_revisions 迁移、创建/修订/复制/启停归档、并发冲突、缺项状态及 Preload/IPC 已接通；`npm run verify` 退出 0（54 文件 / 441 测试），2026-09-14 13:54。执行注入与召唤留 E12–E13 |
| E12 | 专家执行注入与能力裁决 | E11 | done | [TaskContext/Run 测试](../../apps/desktop/src/main/services/run-service.test.ts)、[Agent Core 测试](../../packages/agent-core/src/agent-engine.test.ts)、[迁移测试](../../apps/desktop/src/main/db/migrate.test.ts)：v10 TaskContextRevision、CAS/归属隔离（含无上下文任务的期望修订拒绝）、专家人格指令、模型引用、内置工具 allow-list 与 Run 接入；`npm run verify` 退出 0（55 文件 / 448 测试 / Electron build），2026-09-14 14:05 |
| E13 | 对话草稿、召唤与身份切换 | E12 | done | [App/IPC 测试](../../apps/desktop/src/renderer/src/App.test.tsx)、[IPC 注册测试](../../apps/desktop/src/main/ipc/register-ipc.test.ts)：专家列表“召唤”直达空白任务，首条消息保存 TaskContextRevision 后启动 Run；任务重开恢复专家/Skill 选择，`+ → 专家` 打开专家列表；`npm run verify` 退出 0（55 文件 / 451 测试 / Electron build），2026-09-14 14:15 |
| E14 | 专家管理与按需配置 UI | E13 | done | [专家配置 UI 测试](../../apps/desktop/src/renderer/src/App.test.tsx)：专家列表/详情、独立编辑器、新建与不可变修订保存、Skill 预设、内置工具 allow-list、模型偏好（应用默认或指定语言模型）、常用参考选择、按当前工作空间隔离的关联记忆摘要与带作用域的“管理记忆”入口、生命周期操作和内置复制均复用 E11 IPC；本阶段新增常用参考持久化与召唤注入回归，完整门禁见日志。 |
| E15 | 内置专家分发与 E1 验收 | E14 | done | [内置 Expert 服务测试](../../apps/desktop/src/main/services/expert-service.test.ts)：新增 `resources/experts/release-manifest.json`，启动幂等注册 stable builtin Expert；发布同一 ID 的变更追加 builtin 修订并保留用户副本与生命周期选择；打包资源同步进入 `experts/`，内置修订只读且可复制；`npm run verify` 退出 0（55 文件 / 453 测试 / Electron build），2026-09-14 14:27 |
| E20 | 材料与快照精确契约 | E15 | done | [材料、快照与运行来源契约](material-contracts.md)：定稿候选/选择/读取分离、Knowledge revision、ArtifactVersion、Workspace 输入快照、用途、RunContextSnapshot、两库与文件恢复/回收、范围校验入口、读取足迹和 ArtifactInputRelation；明确源变更、缺失、重复、跨空间、取消、归档、旧任务和范围收缩语义。文档差异检查通过，2026-09-14。 |
| E21 | 知识修订、文件快照与恢复 | E20 | done | [KnowledgeVault 修订与快照测试](../../apps/desktop/src/main/services/knowledge-vault.test.ts)、[输入快照测试](../../apps/desktop/src/main/services/input-snapshot-service.test.ts)、[迁移测试](../../apps/desktop/src/main/db/migrate.test.ts)：知识库 v3 保留不可变内容/分块修订；应用库 v11 增加 Workspace 所属输入快照状态；稳定读取、哈希寻址复制、取消、符号链接/特殊文件拒绝、缺失/孤儿恢复已接通启动装配；`npm run verify` 退出 0（56 文件 / 459 测试 / Electron build），2026-09-14 15:04。 |
| E22 | 材料选择与草稿持久化 | E21 | done | [TaskMaterialService/TaskContext 测试](../../apps/desktop/src/main/services/task-material-service.test.ts)、[TaskContextRepository 测试](../../apps/desktop/src/main/persistence/task-context-repository.test.ts)：TaskContextRevision v12 保存材料判别引用、用途、备注和添加来源；候选查询覆盖 Knowledge revision、Workspace ArtifactVersion、ready 输入快照；ExpertRevision v20 保存最多 50 个 Knowledge/ArtifactVersion 常用参考，召唤时以 `expert-reference` 注入新任务；保存边界校验修订哈希、快照状态、重复项和 Workspace 归属；新增候选/输入快照 IPC 与 Preload；本阶段决策见 [ADR-0022](../adr/0022-expert-reference-materials.md)。 |
| E23 | 宿主范围与上下文收缩 | E22 | done | [RunService/快照/工具测试](../../apps/desktop/src/main/services/run-service.test.ts)：Run 绑定不可变 `run_context_snapshots`，Run 仓储拒绝 Task/Session 交叉归属，并在快照边界校验 Run、Task、Workspace 与 TaskContextRevision 的组合归属；Knowledge revision、输入快照和 Markdown ArtifactVersion 通过宿主范围校验；材料收缩创建新上下文段并过滤旧段历史；v21/v22 继续固定 Expert 身份、模型引用、内置工具策略和 MCP 绑定。`npm run verify` 退出 0（75 文件 / 547 测试 / Electron build），2026-09-15。 |
| E24 | 读取足迹与成果输入来源 | E23 | done | [读取/成果来源测试](../../apps/desktop/src/main/services/run-service.test.ts)：v14 保存 RunMaterialRead 与 ArtifactInputRelation；有 TaskContext 的 Run 只能登记快照中精确选定且元数据、版本哈希一致的材料，仓储校验成果版本属于产生它的 Run，Markdown/文件成果只允许关联同一 Run 已读取材料。`npm run verify` 退出 0（75 文件 / 547 测试 / Electron build），2026-09-15。 |
| E25 | 材料 UI、成果复用与 E2 验收 | E24 | done | Composer 与资料面板支持文件/知识/成果选择、用途调整、失效提示和取消；专家编辑器可选择当前工作区适用的常用参考，专家“召唤”只把适用引用带入 TaskContext，任务仍可移除/补充；成果详情可引用精确 Markdown 版本开始新任务；Office 材料在 E51 接入后进入可读候选；跨 Workspace 材料需通过任务内显式来源选择。 |
| E30 | 记忆投影与治理实现 ADR | E25 | done | 新增 [ADR-0015](../adr/0015-memory-scope-and-governance.md)：SQLite 唯一真相源、User/Workspace/Expert/Expert×Workspace 判别范围、candidate/confirmed/过期/删除状态、来源、预算、运行快照、投影重建和失败恢复语义已定案。 |
| E31 | 记忆存储、检索与运行注入 | E30 | done | [MemoryRepository/Service 与 RunService 测试](../../apps/desktop/src/main/persistence/memory-repository.test.ts)：应用库 v15 增加不可变记忆修订与 Run 读取足迹；四种作用域按隔离规则检索，confirmed 记录按 16 条/6,000 字符预算注入新 Run，候选不会注入；读取足迹写入时校验 Run 的工作空间/专家范围、有效期、不可变修订身份和内容哈希；新增 Expert 与 Expert×Workspace 运行隔离回归；IPC/Preload 已接通，Markdown 只读投影按作用域重建。`npm run verify` 退出 0（75 文件 / 546 测试），2026-09-15。 |
| E32 | 记忆管理、对话确认与 E3 验收 | E31 | done | [记忆管理与运行测试](../../apps/desktop/src/renderer/src/views/MemoryView.test.tsx)：设置页支持用户记忆创建、候选确认、编辑和删除；从专家详情进入记忆管理时固定专家与当前工作空间范围，并支持创建对应作用域记忆；任务资料面板支持“本任务不用”，排除项通过 IPC 保存进 TaskContextRevision 并只影响后续该任务运行。新增 Expert 作用域捕获与跨工作空间隔离回归。迁移 v16、协议/运行/Renderer 测试已覆盖；RunContextSnapshot 的专家身份直接快照和跨 Expert 修订归属回归已补入，最新 `npm run verify` 退出 0（76 文件 / 558 测试），2026-09-15。 |
| E40 | MCP 接入实现 ADR 与探测样本 | E32 | done | [ADR-0016](../adr/0016-mcp-transport-and-lifecycle.md) 与离线探测脚本 [`scripts/mcp-probe.mjs`](../../scripts/mcp-probe.mjs)：首轮选定官方 `@modelcontextprotocol/client` v2.0.0 的 stdio 传输，明确稳定工具 ID、候选/授权分离、取消/超时/断线/退出语义；只读 `finance.monthly_summary` 替身完成 initialize → tools/list → tools/call → clean close。无外部业务账号，真实连接验收保持阻塞。 |
| E41 | MCP 连接、工具适配与取消 | E40 | done | [McpClientService 测试](../../apps/desktop/src/main/services/mcp-client-service.test.ts)：应用库 v17 持久化 stdio 连接与工具 Schema 目录；官方 `@modelcontextprotocol/client@2.0.0` 接入 Main，发现工具映射为稳定 `connectionId/toolName`，只有 TaskContext 显式绑定才适配成 `AgentTool`；发现时编译 JSON Schema、调用前校验模型参数，文本与结构化输出均受大小上限，进度、超时、AbortSignal、断线与退出清理沿现有 Run 终态。`npm run verify` 退出 0（75 文件 / 549 测试 / Electron build），2026-09-15。 |
| E42 | MCP 配置及专家/任务工具选择 | E41 | done | 设置页支持 stdio 连接新增/编辑/删除/检测；专家修订保存具体 MCP 工具预设；任务资料面板可按连接选择本次工具并通过 IPC 持久化到 TaskContext，保存边界拒绝重复的 `connectionId + toolId`；`run-service.test.ts` 另覆盖选定 MCP 工具进入模型工具目录、完成本地只读替身调用、登记 `mcp-tool` Evidence 并收口 Run；[ADR-0021](../adr/0021-mcp-evidence-provenance.md) 定义来源契约；历史绑定不随发现变化，失效连接会定位为 MCP 工具不可用且仍可从配置中移除；协议/迁移/ExpertService/Renderer 覆盖已补齐。|
| E43 | 网页正文、来源与 E4 验收 | E42 | done | [ADR-0017](../adr/0017-web-fetch-and-evidence-boundary.md) 与 `web_fetch`：Main 注入可取消、15 秒超时、1 MiB 上限、HTTP(S)/公开主机和重定向校验；HTML 正文提取后登记最终 URL/时间/哈希/定位 Evidence，Evidence 仓储校验 Run 与 Task 的归属。`run-service.test.ts` 另覆盖选中工具到 Evidence 的离线集成；替身覆盖正文、私网 IPv4/IPv6、重定向上限、非正文、1 MiB 截断和取消；真实外网旅程留人工验收。`npm run verify` 退出 0（75 文件 / 550 测试 / Electron build），2026-09-15。|
| E50 | Office 输入解析技术定案 | E43 | done | [ADR-0018](../adr/0018-office-input-parsing-boundary.md)、`scripts/office-input-probe.mjs`：JSZip + fast-xml-parser 解析 PPTX，ExcelJS 读取 XLSX，受限 UTF-8/BOM CSV；固定大小、解压、页数和公式缓存边界，`npm run verify` 退出 0，2026-09-14。 |
| E51 | PPTX/XLSX/CSV 读取与定位 | E50 | done | `OfficeParserService`、`read_office_material` 和材料候选状态已接入；只读 E21 输入快照或精确选中的 PPTX 成果版本，支持 slide/table/notes、Sheet/Range、CSV rows 定位，登记 `parse` 材料足迹；`run-service.test.ts` 另覆盖选定 CSV 从 Run 工具调用到定位足迹的离线集成；定向测试通过，2026-09-14。 |
| E52 | 讨论节点与重启后继续/返工 | E51 | done | [ADR-0019](../adr/0019-discussion-checkpoints-and-rework.md)、`DiscussionCheckpointRepository/Service`、IPC 和工作页节点条已接入；客户端 ID 幂等、旧节点替代、重启查询恢复，以及仓储层 Run/Task/ArtifactVersion 归属校验已覆盖；重复客户端 ID 不能跨 Task 读取或复用节点，2026-09-15。 |
| E53 | 经营分析方法与数值校验 | E52 | done | [ADR-0020](../adr/0020-deterministic-business-analysis.md)、`analyze_business_metrics` 确定性工具和内置「经营分析方法」Skill 已接入；期间变化、预算偏差、零基数和缺失指标有结构化结果/警告；`run-service.test.ts` 另覆盖 Expert allow-list 到确定性结果的离线 Run 集成，2026-09-14。 |
| E54 | 报告/PPT 交付、修订及来源 | E53 | done | 复用现有 Markdown/FileArtifactService 版本路径；ArtifactVersion 详情通过 IPC 返回本版 `inputRelations`，成果页显示证据和材料输入；旧版本、导出、继续编辑与来源关系保持精确，2026-09-14。 |
| E55 | 连续两期真实桌面验收 | E54 | partial | [人工验收脚本](../acceptance/2026-09-15-expert-human-acceptance.md) 定义以用户走查为主的功能验收：召唤、材料/用途、Skill/内置工具/MCP、网页来源、成果、第二期独立 Task/Session/Run、取消与重启。现有记录已覆盖部分开发态路径；真实业务 MCP、完整连续两期人工记录和用户使用自己的专家/Skill 的最终走查仍待补齐。本卡不以示例专家的提示词、Skill 文案或示例报告质量作为功能通过条件。 |
| E56 | macOS 安装态与整体收尾 | E55 | partial | [安装资源预检记录](../acceptance/2026-09-14-expert-install-preflight.md) 与 [人工验收脚本](../acceptance/2026-09-15-expert-human-acceptance.md)：arm64/x64 打包资源和资源路径预检已有证据；安装态完整走查、Developer ID 签名、Gatekeeper 与升级保留仍待具备签名身份后完成。 |

## 4. 开发任务卡

### 通用完成条件

每卡先读 AGENTS、docs/12、设计对应小节与 ADR-0014，再读卡内指定文件。新增源码路径均为预期落点，动手前用 rg 确认等价实现。协议/迁移/服务/UI 按现有分层；IPC 只在 register-ipc.ts 注册，Renderer 调用经 hook 与 reportAction/trackAction。

代码卡完成：定向测试、typecheck 与 npm run verify 通过；变更若影响真实操作，完成该卡规定的桌面验收。全量验证不接管道截尾。文档/契约卡完成：本地链接、关系和差异检查，不跑无关构建。每卡写当日日志，状态与证据同时更新。

运行、导入、连接、读取与准备过程均有取消/错误收口。自动测试采用合成文件与可注入替身，不触网；真实模型/MCP/办公软件验证另列人工证据。用户公司文件、密钥和运行制品不入库。后续工程决策在用户已接受范围内自主完成并落档；只有新的产品范围或无法推断的外部条件才需用户输入。

### E00 前置核对与收尾

- 必读：执行手册任务板、tasks-a2/a3/a4、tasks-b0、docs/11 §3、阶段 A 修正记录。
- 改动范围：原卡规定文件及原任务板证据；本卡不写专家实现。
- 工作：核对 A/macOS 真实脚本、成果打开/导出、安装资源及 B0 双 Skill/重启恢复；按原卡完成确有缺口的收尾。先取得基线 verify，再补真实旅程；不借缺失记录重复重构。
- 失败：缺本机样本/外部凭据的卡写明具体缺项，保留未验收状态；不伪造通过，也不自动扩大为 Windows 工作。
- 完成：A/macOS 门槛与 B0 人工尾项各有可追溯证据；原卡状态真实更新。任何新缺陷按 GATE-0 数据→日志→代码排查。

### E10 专家与运行契约

- 必读：docs/02/03/05、ADR-0012/0014、ClawBible 专家定义调研、agent-protocol/index.ts、RunService、TaskRepository、App.tsx。
- 改动范围：新增 `docs/development/expert-contracts.md`，同步领域与架构文档；不先创建未来 E2–E5 空表。
- 工作：定义 Expert/Revision、管理输入输出、顺序 Skill 预设、模型引用、内置工具策略、TaskContextRevision 的 E1 子集、启动事务及迁移方案。专家预设解析为现有 RunSkillBinding；明确当前任务配置固定、更新显式应用、停用/归档和历史保留。
- 定案要求：人格字段最终合成为唯一可执行指令；工具清单是可用能力与专家/本次选择及授权的交集，不能因参考项目“全部工具兜底”改变已接受范围。记忆、MCP 和资料字段在所属切片迁移，不创建可误用的全权限占位。
- 完成：列清必填/可选、版本冲突、旧任务迁移、无专家/无 Skill 合法路径、错误码与每个消费者；后续无需重新猜字段或要求用户批准同一设计。

### E11 专家修订与管理

- 前置与落点：E10 契约；agent-protocol、db/app-schema/migrate.test、persistence、services、register-ipc、preload。
- 工作：实现专家创建/读取/编辑/复制/启停/归档及不可变修订，来源由 Main 判定；乐观并发拒绝覆盖新修订；复制不复制信任、记忆、历史或密钥。
- 失败/取消：事务失败无半条专家；归档不删除历史 Run；已有配置缺 Skill 可保存并报告缺项，不装作 ready；管理失败按原错误收口。
- 必测：新库/旧库迁移、重开幂等、修订不可变、内置防覆盖、并发编辑、非法 IPC、归档后历史可读。
- 完成：经真实 IPC 创建并修改专家，重启读回；只完成管理，不声称执行已接线。

### E12 执行注入与能力裁决

- 落点：RunService、TaskContextRepository、agent-core/types/agent-engine、tool-runtime 工厂、协议和 run-service/engine/IPC tests。
- 工作：加载专家修订和模型引用，组装人格与有序 Skill 指令，固定本次有效工具；Skill 仍走原启用/信任/依赖/6 项上限与绑定事务。E1 未实现的资料/记忆/MCP 不能显示为可配置且生效。
- 失败/取消：无效专家或能力在启动边界拒绝，明确原因；不影响无专家普通 Run；撤销仍级联取消，清理后唯一终态。
- 必测：两专家实际 messages 与 tools 不同；旧 Run 不随编辑变化；第二项 Skill 不可用时整体不启动；禁止工具既不暴露也不可调用；取消与重启兜底回归。
- 完成：主进程集成旅程证明配置影响真实执行；E12 已通过 TaskContextRevision 读取与 CAS、专家人格注入、模型引用和内置工具裁决接入 Run。E1 不宣称当前知识工具已经具有 E2 的材料范围隔离。

### E13 草稿、召唤与任务身份

- 落点：Task/Session 仓储、任务上下文服务、共享协议、RunService、App/hook。
- 工作：保存 E1 对话草稿与能力选择；召唤带入专家修订和当前 Workspace，进入对话而不自动发送。首条消息建立/使用独立 Task、Session；数据创建时机按 E10 统一。查看配置、切换任务和重启不丢输入。
- 失败/取消：发送失败保留草稿；首次运行后更换专家新建 Task/Session，禁止把旧专家回复私自带入；普通能力修改从下 Run 生效；配置保存竞争按期望修订处理。
- 必测：空消息不创建 Run、无本期数据可澄清、草稿重启、任务间不串选项、旧任务无历史专家快照时不补造事实。
- 完成：召唤到第一轮回复经真实 IPC 贯通；不引入准备页、字段填表或二次开始。

### E14 专家管理与对话 UI

- 必读/落点：docs/10、views/SkillsView、ComposerCapabilityPicker、PopoverMenu、App/hook、styles/icons。
- 工作：专家列表/详情“召唤”，独立编辑配置，内置复制编辑；可从工作区候选选择 Knowledge 修订和 ArtifactVersion 作为常用参考；对话内查看专家使用可关闭面板；能力简要显示、详细选择按需展开。复用 E11–E13，不造第二套运行入口。
- 失败/取消：列表读取失败与空列表不同；保存失败留在编辑器；关闭查看回原输入并还原焦点；长操作复用状态/取消，反馈不自造 Toast。
- 必测/手验：从专家页召唤→发需求→编辑专家→回任务草稿不丢；召唤后常用参考进入任务且可移除；键盘、三档外观、窄窗口；无准备表单与强制依据预览。
- 完成：功能真实接线，不从示例草图复制 mock 行为；无 9–10px 字号、硬编码颜色或新 UI 框架。

### E15 内置资源与 E1 验收

- 落点：resources/experts、资源定位器、启动装配、打包配置、专家服务测试。
- 工作：分发最小专家预设，引用确实存在的 Skill；经营分析/调研能力尚未安装时标明缺项，不用虚构 ID 宣称就绪。内置更新不覆盖用户副本、停用与授权选择。
- 失败/取消：安装资源缺失明确不可用；停用专家禁止新运行并按 E10 生命周期处理活跃 Run；旧任务与成果保留。
- 必测/手验：开发/安装路径、升级/重启、副本独立、两专家执行差异、同专家多 Skill、无专家回归。
- 完成：E1 独立可交付，证据报告区分已有能力与 E2–E5 未完成范围。

### E20 材料与快照契约

- 必读/落点：docs/04、ADR-0005/0014、KnowledgeVault、Artifact/FileArtifactService、Workspace/TaskRepository；扩展 expert-contracts。
- 工作：定稿工作空间候选关联、任务选材修订、Knowledge 内容修订、ArtifactVersion 引用、本地输入快照、材料用途、Run 读取足迹和成果输入关系；明确两库与文件资产的恢复和回收。
- 失败语义：源文件变化、缺失、重复引用、非法跨空间请求、快照取消、归档对象仍被引用、旧任务继续执行、范围缩小后的历史筛选逐项定义。
- 完成：见[材料、快照与运行来源契约](material-contracts.md)。已定稿工作空间候选与任务授权、六类用途、Knowledge 内容修订、ArtifactVersion、本地输入快照、RunContextSnapshot、读取足迹和成果输入关系；明确两库与受管文件恢复/回收、所有读取入口的范围校验落点，以及源变化、缺失、重复、跨空间、取消、归档、旧任务和范围收缩语义。E23 已将带 `TaskContext` 的 `read_text_file` 与 `knowledge_search` 接入 Run 范围过滤；脚本按本机用户权限运行，不宣称 OS 沙箱。仅文档变更，`git diff --check` 和 Markdown 关系检查通过，2026-09-14。

### E21 修订、快照与恢复

- 落点：db/knowledge-schema 与 app-schema、KnowledgeVault、快照服务、相关仓储。
- 工作：知识刷新生成修订；外部文件只读复制到受管输入快照，哈希去重；数据库记录可恢复准备状态，成功后才用于 Run。文件并发修改需稳定读/重试或明确拒绝，快照哈希与解析内容一致。
- 失败/取消：快照准备可取消；断电/崩溃后恢复或清理孤立文件，不破坏被历史成果引用的资产；路径穿越/符号链接越界/特殊文件拒绝。
- 必测：新旧库迁移、修改期间读取、失败事务、取消、重启清理、共享引用回收、旧知识修订仍可读取。
- 完成：Knowledge Vault v3 新增不可变 `knowledge_revisions`/`knowledge_revision_chunks`，旧库迁移自动生成 revision 1，刷新只追加新内容哈希修订；应用库 v11 新增 `input_snapshots`，`InputSnapshotService` 完成 Workspace/路径/符号链接/特殊文件校验、稳定读取重试、SHA-256 内容寻址复制、`preparing → ready/failed/cancelled` 收口、取消和启动恢复/孤儿清理。原文件保持只读，输入快照不冒充 Artifact；`npm run verify` 退出 0（56 文件 / 459 测试 / Electron build），2026-09-14 15:04。材料选择绑定、运行读取过滤和来源关系留 E22–E24。

### E22 材料选择服务与草稿

- 落点：材料服务/仓储、ExpertRevision 常用参考、TaskContextRevision、IPC/preload。
- 工作：工作空间候选与任务实际选择分离；支持具体知识、现有可读成果版本和当前文件。常用参考从当前 Workspace 候选选择后带入，同清单可移除；跨 Workspace ArtifactVersion 只能通过任务内显式全局来源选择，不能由专家常用参考自动带入。
- 失败/取消：无访问登记的任意 ID/路径拒绝；源版本变化给差异，不追随最新；取消选择不改草稿；超限和不可读格式有具体原因。
- 必测：候选不等于授权、常用参考引用版本稳定、跨 Workspace 来源明确、并发草稿版本、重复引用去重、移除不会被预设自动补回。
- 完成：`TaskContextRevision` v12 新增 `materials_json`；`ExpertRevision` v20 新增 `reference_materials_json`，协议定义 `MaterialReference`、六类用途和 `addedFrom`，`TaskMaterialService` 提供 Knowledge revision、当前 Workspace ArtifactVersion、ready 输入快照候选，并在保存时校验内容哈希、快照完整性、重复引用、跨空间和失效状态。专家编辑器保存全局知识或当前工作区适用的常用参考，召唤把适用引用以 `expert-reference` 复制到新 TaskContext，任务可继续移除或补充；新增材料候选查询与 Workspace 文件快照 IPC/Preload，App 保存并恢复材料草稿；[ADR-0022](../adr/0022-expert-reference-materials.md) 固化边界。当前工具仍可读整个 Knowledge Vault/Workspace，范围收紧留 E23；空材料仍允许澄清任务。

### E23 范围与历史上下文

- 落点：RunService、知识/文件/成果读取工厂、上下文服务、任务修订。
- 工作：每 Run 绑定精确清单与快照；检索和读取只能访问该集合。缩小范围创建上下文段，后续排除旧段助手回复以及旧消息中的自动附件/工具摘要；仅保留明确的当前目标与用户选定成果。
- 失败/取消：未知材料、旧 binding、别的 Run 句柄不能读取；启动裁决与撤销串行；运行中快照不热换；旧历史 UI 保留。
- 必测：直接文件路径/知识检索/成果 ID 三条越界；跨公司；材料移除后检查完整模型输入无旧内容；取消和错误唯一终态。
- 完成：应用库 v13 新增 `run_context_snapshots`，Run 启动事务固定 TaskContext 的材料清单、工作空间、上下文段和修订号。`RunService` 将 Knowledge 搜索限制在所选 revision，将 `read_text_file` 映射到所选输入快照的受管副本，并新增精确 `read_artifact` 版本读取；未知材料、越界路径和未选成果版本都会在工具边界拒绝。材料集合严格缩小时创建新上下文段，旧段的助手回复不会进入本次模型输入；普通未绑定材料的旧任务仍保留原历史。新增运行范围、快照仓储和工具工厂测试；`npm run verify` 退出 0（59 文件 / 470 测试 / Electron build），2026-09-14。脚本仍以本机用户权限运行，以上是应用层约束，不宣称 OS 沙箱。

### E24 读取与成果来源

- 落点：Evidence、ArtifactRepository、FileArtifactService、Run 消费与读取适配层。
- 工作：分别保存已选、实际读取及成果来源；新成果版本关联输入 ArtifactVersion；保留片段定位和源修订。上期所有 Evidence 不自动标成本期查阅结果。
- 失败/取消：重复读取去重不丢定位；迟到读取/产物不能越过取消终态登记；源已归档仍可按历史引用解释。
- 必测：选但未读不算读取、读但未用不伪造正文引用、版本关联不漂移、人工修订遵守 ADR-0005 继承语义。
- 完成：应用库 v14 新增 `run_material_reads` 与 `artifact_input_relations`；RunService 对知识搜索、输入快照和成果读取记录具体修订、定位、内容哈希和摘要哈希。Markdown 与文件成果的显式输入关系在 Main 校验同一 Run 已实际读取，选中但未读取、旧 Run Evidence 或人工修订不能伪装成来源。`npm run verify` 退出 0（60 文件 / 473 测试 / Electron build），2026-09-14。仍不声称已有逐句 Citation。

### E25 材料交互、成果复用与 E2 验收（已完成）

- 落点：Composer、上下文资料面板、知识/成果选择器、ArtifactView、对应 hooks。
- 工作：“＋”添加文件/引用知识/引用成果；用途默认推导、详情可改。常驻只显示摘要，完整清单可收起。成果“基于此成果开始新任务”精确引用版本、沿用专家、清空期间和本期输入。
- 失败/取消：选择器取消不改变原选项，失效项原地修复；缺材料通过对话补充，绝不跳配置向导；重启草稿不丢。
- 必测/手验：引用非最新版、补材料继续、跨空间显式来源、范围收缩、新一期不带旧聊天；三档外观/窄屏/键盘。
- 完成：Composer `+` 菜单与右侧资料面板共用任务材料草稿，支持当前工作空间文件快照、Knowledge revision、ArtifactVersion 的候选选择；选择器取消不改原清单，材料芯片可调整用途并显示失效状态。专家编辑器可选择全局知识或当前工作区适用的常用参考，专家“召唤”直接注入适用引用并允许移除/补充；成果详情可对精确 Markdown 版本执行“基于此版本开始新任务”，沿用仍有效的专家、清空旧任务上下文与本期输入并保留精确历史成果引用；跨 Workspace 成果需通过任务内显式来源选择。候选查询支持尚未创建 Task 的新任务草稿。E51 后 PPTX/XLSX/CSV 可读状态由具体格式和快照完整性决定。`npm run verify` 的本阶段结果见 2026-09-14 日志。

### E30 记忆实现 ADR（已完成）

- 必读：ADR-0004/0014、docs/04、E23 的上下文段；新增记忆实现 ADR 并更新契约。
- 工作：定稿 User/Workspace/Expert/Expert×Workspace、修订、candidate/confirmed/失效状态、来源和有效期；SQLite 权威，Markdown 可重建。规定手改投影的导入校验/冲突处理或首版只允许 UI 编辑，不留双真相源。
- 定案：预算、检索排序、读取快照、删除后缓存/投影失效、活跃 Run 与后续 Run 语义、用户“记住这个”和模型建议的区别；不先建设向量库/后台反思。
- 完成：新增 ADR-0015，定稿 SQLite 唯一真相源与可重建 Markdown 投影、四种范围判别联合、来源与确认状态转移、有效期、16 条/6,000 字符预算、Run 快照、范围收缩、并发冲突、投影失败和重启恢复；明确不做自动反思、Embedding、向量库或 Task 长期记忆。E31/E32 按该 ADR 实现，不再重复请求同一产品批准。

### E31 记忆存储与注入

- 落点：Memory 仓储/服务、投影设施、上下文装配、读取工具与测试。
- 工作：按 E30 实现检索、更新、确认、失效/删除；只注入适用且 confirmed 的记录，按需读取并固定实际记录修订，内容不取得系统授权权限。
- 失败/取消：Expert×Workspace 双条件匹配；记忆与选定制度冲突不能静默覆盖；删除/缩范围后接 E23 历史收缩；投影失败不把 DB 回滚成旧记忆。
- 必测：四种 scope、跨公司不串、候选/过期排除、编辑/删除后下一 Run、缓存失效、崩溃重建、预算与定位。
- 完成：新 Task 通过主进程边界复用记忆，旧 Run 可解释当时版本。

### E32 记忆管理与 E3 验收

- 落点：专家记忆区、任务资料面板、hooks/IPC、对话结构化记忆建议入口。
- 工作：查看来源/范围、编辑、确认/忽略建议、删除、本任务不用；显式“记住这个”走同一校验，不让模型任填 expertId 扩大范围。
- 失败/取消：保存冲突留编辑稿；取消建议不写 confirmed；不把整个聊天或成果自动沉淀。
- 必测/手验：同专家两 Workspace；确认一条后重启新任务生效，删除后后续不引用；范围及来源可见。
- 完成：最小记忆真可管理，不以“记忆中心”占位页交付；Expert 对话可将已确认经验保存为专家通用记忆，Expert×Workspace 仍可保存公司专属经验。

### E40 MCP 实现 ADR 与样本

- 必读：设计 §6.4、ADR-0014、tool-runtime/types、模型工具映射、现有搜索设置和进程取消设施。
- 工作：选择一个真实只读业务样本和可重复离线 MCP 替身，核实它要求的传输/认证，选定首轮支持类型与 SDK 版本；记录官方依据、协议适配、凭据存储、工具稳定 ID/同名映射、连接复用和更新策略。新增专门 ADR，不以未核实的库版本写死任务卡。
- 定案：启动/连接/发现/调用/断线/重连/超时/取消/退出；新增工具不自动授权；工具描述不等于读写权限判定依据，样本范围需显式配置。
- 完成：至少一种实际需要的 MCP 接入路径有可执行探测与生命周期验证方案；外部账号不可得时明确阻塞真实验收，继续离线协议准备，不以假连接声称通过。

### E41 MCP 运行设施与工具适配

- 落点：infrastructure MCP client、连接服务、tool-runtime 工厂、协议/持久化。
- 工作：实现 E40 选定类型，工具 Schema 校验、进度与受限输出、稳定 ID、每 Run 工具范围裁决；Core 不导入 MCP SDK。
- 失败/取消：调用 timeout/abort 传到底层；共享连接取消不得中断其他 Run；进程树按现有策略清理；断线不得盲重试可能有副作用的操作；密钥不入日志。
- 必测：离线替身连接/断线/同名/描述变化/非法输出/取消并发，撤销后不能继续调用，退出无遗留进程。
- 完成：真实只读调用进入现有 ToolCall/Run Journal 与终态体系。

### E42 MCP 设置与工具选择

- 落点：独立设置、专家能力编辑、任务能力详情、hooks/IPC。
- 工作：配置连接、检测、展示状态、选择具体工具；专家预设可引用，本次调整可见。工具新增不会自动加入历史选择；凭据不返回 Renderer 列表或导出专家。
- 失败/取消：失效工具定位到具体连接；连接检测可取消；缺能力提示与业务材料不足区别处理，不隐式调用未选工具。
- 必测/手验：两个专家相同连接不同工具、应用重启、停用撤销、无凭据泄漏、一次真实只读调用。
- 完成：配置真的改变模型侧与执行侧工具集合。

### E43 网页正文与 E4 验收

- 落点：web_fetch 工具/宿主 HTTP 服务、Evidence、来源 UI。
- 工作：接续现有搜索读取公开网页正文，记录 URL/时间/内容哈希/定位；明确摘要与正文、第三方主张与用户事实。HTTP 可注入，限制协议/重定向/响应大小与超时；不得借抓取访问未授权本机/内网资源。
- 失败/取消：网络失败、非正文、限流和取消可解释；失败正文不假装已核对官方依据；外部内容不能改变授权或指令。
- 必测：替身 HTTP 的重定向、非法目标、超长/类型异常、取消；真实搜索→正文→来源显示。
- 完成：E4 的真实 MCP 与公开网页旅程均记录证据，不自动形成业务系统写入连接器。

### E50 Office 输入解析定案

- 必读：现有 PPT 预览、KnowledgeVault、文件快照、PPT Skill 与依赖锁；新增解析器技术 ADR/契约。
- 工作：用合成 PPTX/XLSX/CSV 探测候选解析路径，确定依赖和安装方式、输入大小/压缩包展开限额、编码、耗时与取消；沿用工具链时明确版本及授权。
- 定案：PPT 文本/表格/备注/页号；XLSX Sheet/Range、公式与缓存值新鲜度、空值/日期、CSV 编码；图片图表不猜数。不把应用外观或缩略图渲染器当成解析结果。
- 完成：样本期望输出、限制与许可证/打包要求可执行，后续迁移/API 有明确形状。

### E51 Office 输入读取

- 落点：解析设施、材料读取服务、tool-runtime、材料选择可读性状态。
- 工作：按 E50 实现对 E21 快照的解析和范围读取，输出页/Sheet/Range 定位，支持被选历史 PPT 成果作为输入。
- 失败/取消：损坏/加密/过大/不支持类型不崩溃，公式无可靠值明确告知，宏/外部链接不执行；取消后不登记成功解析。
- 必测：合成 PPT 文本表格备注、XLSX 公式/缓存缺失、CSV 中文、压缩包异常、定位、旧版本读取、跨材料越界。
- 完成：能实际读取上期 PPT 与本期表格；界面选择前后可解释是否可读。
- 实现：`OfficeParserService` 仅从受管输入快照或 FileArtifactService 保存的精确版本读取；`read_office_material` 由 Run 的材料范围注入，输出结构化片段和解析警告，并将每个定位片段登记为 `RunMaterialRead(operation=parse)`。候选列表将可解析的 PPTX 成果和 PPTX/XLSX/CSV 输入标为可读，其他文件继续显示不可读。
- 验证：合成 PPTX 文本/表格/备注与定位、XLSX 缓存/无缓存公式、中文 BOM CSV 行范围、损坏压缩包和取消均有测试；工具参数、材料范围和现有 Run 工具注册覆盖通过。

### E52 讨论节点与继续/返工

- 落点：DiscussionCheckpoint 协议/迁移/服务、Task、对话节点组件。
- 工作：持久化理解/计划、研究完成、报告大纲、报告、PPT 大纲、PPT 完成与迭代，关联审阅成果版本和反馈。节点经结构化请求产生，不解析自然语言猜状态；每个 Run 结束后再等待用户。
- 失败/取消：重启恢复待审内容；过期版本反馈有冲突提示；返工不覆盖后续旧成果，也不自动重发旧请求；取消不丢已完成节点。
- 必测：推进、返工、双重提交、重启、材料变化导致依赖重新确认、Run 终态唯一。
- 完成：同一专家真实持续协作，不引入通用 DAG 或 run.waiting。

- 实现：迁移 v19 新增 `discussion_checkpoints`；结构化请求保存阶段、结论、反馈、下一步、来源 Run 和 ArtifactVersion。工作页显示当前节点、历史替代状态和轻量记录表单；保存返工节点会原子标记上一节点为 `superseded`，重启后通过 IPC 从 SQLite 恢复。
- 验证：Repository 覆盖客户端 ID 幂等与替代，Service 覆盖 Task/Run/成果归属，IPC 注册与 Renderer 表单覆盖结构化提交；不自动解析自然语言或维持运行中等待。

### E53 经营分析方法与确定性结果

- 落点：用户/内置专家预设、目录型分析 Skill、受管工具链/命令与测试样本，必要时补全仓跨语言门禁。
- 工作：提供实际可运行的经营分析方法，核对期间/指标口径，计算有数据支撑的环比/同比/预算偏差；固定合成两期输入与人工核定期望数值。真实业务规则仍通过选材进入，不能硬编码到引擎。
- 失败/取消：缺同期/预算数据不输出对应结论；零分母、单位、异常值和缺失值明确；脚本异常/取消不发布成功结果。
- 必测：已知数值、单位/期间不匹配、缺输入、零值、脚本取消和来源定位。
- 完成：专家真实调用分析方法，避免只写提示词要求模型心算。

- 实现：新增 `analyze_business_metrics` Tool Runtime，并纳入 Expert 内置工具 allow-list、过程标签和摘要；工具只接受当前值、对比值和预算值，输出不四舍五入的变化额/比例和零基数 warning。新增内置 Skill `builtin-business-analysis`，说明口径确认与工具调用边界；内置研究分析专家预设该 Skill。
- 验证：合成指标覆盖正负变化、预算偏差、缺失值、零基数和取消；不把公司财务规则写入工具，规则仍由任务材料提供。

### E54 报告、PPT 与来源交付

- 落点：现有 Markdown/FileArtifactService、PPT Skill、成果版本与输入关系、报告/PPT 方法资源。
- 工作：报告采用现有 Markdown 版本路径；PPT 使用已验证模板生成、结构/视觉检查与可编辑性验证，修改生成新版本。若要扩展 Claim/Citation，先在本卡补专门设计，不能把 Evidence 元数据自动称为逐句引用。
- 失败/取消：生成/验证失败保留可解释诊断，不冒充正式交付；旧版本不覆盖；材料变化后明确重新生成范围。
- 必测/手验：报告到 PPT 版本关系、源数据数值一致性、模板资源、结构失败、人工可编辑、取消与来源继承。
- 完成：报告和 PPT 可打开/导出/继续修改；DOCX 与任意人工 Office 改件回收不自动扩入本轮。

- 实现：GetArtifact/GetArtifactVersion/GetFileArtifact 在主进程按精确版本补充 `artifactInputRelations`，成果详情页显示本版输入材料与关系类型；Markdown 与 PPT 继续沿用现有版本化保存、导出、缩略图和人工打开路径，不覆盖历史版本。
- 验证：IPC/协议允许可选输入关系，成果输入关系仓储和 Artifact 页面测试通过；输入关系仍要求同一 Run 先实际读取，不能用旧 Evidence 或标题补造来源。

### E55 连续两期真实验收

- 落点：新增验收记录，必要问题回各实现卡修复；不另造验收用绕路实现。
- 路径：召唤→选规则/上期成果/当期数据→补外部资料→讨论→生成报告/PPT→确认记忆→从成果再做一期→换当期输入→生成第二期。
- 必须证明：第二期重新计算，复用结构和已确认经验；任务/Session/Run 独立，旧聊天不自动带入；源成果版本固定、跨公司范围、取消/重启有效；真实 MCP 与网页正文来源可回看。
- 完成：保存脱敏操作步骤、已核定数值、SQLite 关系与成果验证证据，列出工具/格式限制；公司材料只留本地引用，不进 Git。

### E56 安装态与整体收尾

- 落点：打包资源、资源定位与安装验收文档、最终任务状态。
- 工作：macOS 安装后重走召唤、多 Skill、材料读取、记忆、MCP 及两期成果核心路径；验证内置资源/解析依赖/模板与升级保留用户配置，无开发机绝对路径依赖。
- 失败：安装或恢复缺项回相应卡，不把开发态通过替代安装态；未交付平台/格式如实列出。
- 完成：npm run verify 与安装态证据齐全，设计 §9 验收矩阵逐条对应结果；无未说明临时实现、密钥、生成制品。至此才可声明整体设计已实现。

## 5. 与旧 B/C 规划的唯一归属

| 旧项目 | 新归属 | 说明 |
| --- | --- | --- |
| B00 | 保留原任务板，E00 只补证据 | 已有代码不重复开发 |
| B01 | E10/E11、E20、E30 | 专家先落地，资料/记忆随各自迁移 |
| B02 | E12/E23/E24/E31/E41 | 统一执行链与范围 |
| B03 | E14/E25/E32/E42 | 配置与按需 UI 分切片接线 |
| B04 | E13/E15/E55/E56 | 召唤、分发、真实验收 |
| C01 | E20–E25、E50/E51 | 长期目录候选与精确材料读取 |
| C02 | E52 | 持久化讨论节点，不重复建设 |
| C03 | E43 | 搜索接正文、来源 |
| C04 | E53/E54 的方法/来源；集团场景作为后续内容样本 | 完整 Claim/Citation 若扩展先定设计 |
| C05 | E54 | 当前 Markdown；DOCX 格式要求另行确认，不阻塞已选月报闭环 |
| C06/C07 | E52/E54 | 大纲讨论、PPT 制作/修改 |
| C08 | E30–E32、E55 | 记忆与第二任务复用 |

原“集团智能体场景落地”保留为后续同一能力链的验收场景，不因加入月报而取消，也不重新实现一套引擎。完整市场、自动专家路由、通用工作流、完整记忆中心继续后置。

## 6. 交接输出

每卡交接说明：完成的具体行为（含失败/取消）、修改文件、测试命令与退出码、真实验收证据、已更新日志和任务行、下一可执行卡。若只完成代码而缺人工验收，保持 doing 并列缺项；不要依靠一句“基本完成”跨过门槛。

专家计划的 E11–E54 已按任务板落地；E55/E56 与旧 B00-5 保持 partial/doing，原因和证据链接写在对应验收记录中。B00-5 的撤销原因已进入活动摘要，剩余是可用模型 endpoint 下的用户人工功能走查、真实业务 MCP 和签名安装条件。下一实施入口是按[人工验收脚本](../acceptance/2026-09-15-expert-human-acceptance.md)补齐证据，不再把示例专家/Skill 的内容质量当作本轮功能门槛，也不重新讨论已接受的召唤交互或完整选材需求。
