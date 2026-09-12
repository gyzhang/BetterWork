# MVP 与路线图

## 0. 2026-09-08 生效的开发顺序

2026-09-12 用户明确将阶段 A 本轮交付与验收范围限定为 **macOS**：Windows A09 及对应安装/运行验收保留待办记录，暂不实施，也不作为本轮 macOS 完成的阻塞条件。其他功能与质量门保持，只有 macOS 全旅程通过后才可声明「阶段 A（macOS）完成」。

用户已确认 **A：Skill 管理与配置 → B：专家管理与配置 → C：研究到汇报完整路径**。专家以配置定义，一个专家可调用多项 Skill 持续完成任务。产品先服务个人自用和周边同事，实际可用性优先于教学。

2026-09-12 范围调整：对话内选择技能与 Run↔Skill 1:N 能力绑定从阶段 B 前置为独立切片 **B0**，见 [ADR-0012](adr/0012-composer-capability-binding.md) 与 [B0 任务卡](development/tasks-b0.md)。这不改变 A→B→C 顺序，也不代表 B0 已实现；专家定义、专家管理与知识范围仍在 B01–B03。

2026-09-12 范围补充：阶段 A 的文件成果增加**幻灯片缩略图预览**——成果详情页按页展示预览图，可点击放大逐页查看，「打开」仍用系统应用编辑。预览在主进程内由纯 JS 渲染器生成，不引入 LibreOffice 等外部应用，也不依赖 Skill 的 Python 运行时；中文字体随包分发，渲染依赖的本地补丁由 `patch-package` 管理，技术选择与否决方案见 [ADR-0013](adr/0013-slide-preview-rendering.md)。代码与单测已落地，真实应用内用样本 deck 的端到端验收与 `npm run dist` 产物的字体路径仍待验证；成果的可编辑与版本化属阶段 C，不在本轮范围。

| 阶段 | 已确认方向 | 范围与验收状态 |
| --- | --- | --- |
| A | Skill 管理、配置与脚本运行先行 | 管理、macOS 执行依赖、PPT 接线与文件成果已有实现；2026-09-11 补救门禁通过，真实样本、Office 编辑与冷安装验收仍待完成，Windows 受阻 |
| B | 专家配置接续，绑定多项 Skill | 尚未实现；前置切片 B0（对话内能力绑定与 1:N 绑定）已规划，见 [tasks-b0](development/tasks-b0.md)；配置字段、知识范围和执行接线建议见修订稿 §4 |
| C | 长期目录下完成研究、场景方案、报告和公司模板可编辑 PPT | 尚未实现；六个讨论节点已确认，具体切片与验收建议见修订稿 §5 |

[产品修订稿](reviews/2026-09-08-product-scope.md) 区分已确认决策和待审阅建议；[ADR-0008](adr/0008-personal-workbench-and-capability-first.md) 固定本次产品及职责决策。A/B/C 是新的交付顺序，不代表下方旧 Phase 已完成，也不自动批准修订稿中的技术提议。后续已确认首个脚本型 Skill 必须从 A 支持，见 [ADR-0009](adr/0009-script-skill-baseline.md) 与 [样本边界](reviews/2026-09-08-skill-runtime-boundary.md)；「首轮仅指令、脚本后置」建议撤回。执行器、依赖准备和文件边界已形成 [设计提案](designs/skill-executor-and-dependencies.md) 与 [ADR-0010](adr/0010-skill-executor-and-dependencies.md)（Proposed）；A1–A4 的实现次序和验收已列出，当前实现与验收缺口见阶段 A 任务板。

阶段 A 同时纳入已确认的 [Skill 信任与本地分发规则](adr/0011-skill-trust-and-local-distribution.md)：内置默认信任、导入显式选择、更新与撤销语义、三类目录、用户副本和共享依赖分发。配置验收必须覆盖启用/信任/依赖状态分离以及更新不覆盖用户选择。

开发已拆为 [阶段 A 执行手册](development/README.md) 的 A00–A21 顺序任务（供 5.6 Luna 使用），分组对应 A1 管理配置、A2 执行依赖、A3 样本接线、A4 成果分发。任务状态以手册任务板为准；代码补救及验证见 [2026-09-11 修正记录](reviews/2026-09-11-phase-a-repairs.md)，阶段 A 尚未通过完整验收。

首个完整场景为「集团智能体场景落地」，阶段内部自主推进，六次讨论依次为：理解与计划、网络调研、报告大纲、报告完成、PPT 大纲、PPT 完成与迭代。用户最终手工编辑 PPT 后汇报。

已有工程门禁继续保留；教学讲解材料不再是产品交付门槛。配置必须影响执行，安装包必须携带必要内置资源；研究到汇报的交付必须验证来源、成果版本、可编辑 PPT 与人工调整路径。

**以下 §1–§10 保留为旧 Phase 规划及实现进度档案。已实现能力与质量缺口仍有效，旧 Phase 1–5 的未来排期、MVP 总范围和教学验收由本节替代，禁止据旧 Phase 4/5 将基础配置后置。** 尚未接受的新字段、包协议、权限和 Worker 选型仍须先设计并记录 ADR。

## 1. 开发策略

教学链路与产品链路并行但有先后：

- 教学最小链路用于验证架构和讲解 Agent Loop。
- 第一条产品垂直切片直接验证研究、Evidence、Artifact 和 Word 报告。
- Excel、Word/PPT Studio、专家和 Kit 在同一领域模型上逐步增加。

## 2. Phase 0：项目骨架与教学链路

目标：一个开发者可以完整理解消息如何穿过系统。

范围：

- Electron Main / Preload / Renderer
- Typed IPC
- Agent Core `AsyncIterable` 事件
- Fake Model Provider
- 一个 OpenAI-compatible Provider
- Calculator Tool
- Read Text File Tool
- Streaming Message
- Tool Call Card
- Cancel / Abort
- SQLite Run Journal
- Execution Timeline

验收：

1. Fake Model 能稳定产生一组可预测的流式事件。
2. 用户可以启动和取消 Run。
3. 工具调用在 UI 中显示开始、结果和失败。
4. 关闭并重新打开应用后可以查看 Run 历史。
5. Agent Core 测试不启动 Electron。

### Phase 0 UI Foundation Gate

现有 Renderer 只视为验证 Agent 教学链路的工程原型。进入 Phase 1 前，先按 [UI/UX 体系与落地计划](10-ui-ux-system.md) 完成 UI Foundation：统一视觉 Token、多模式多色系外观、应用外壳、任务工作区、上下文面板和模型设置体验。

该 Gate 允许重构 Renderer 的组件和样式结构，但不借机扩张 Agent Core、知识库或 Office 能力。完成后必须保证 Fake Provider 与真实 Provider 的已有链路不回退。

状态：已完成。随后以最小的 Phase 1 切片进入：Workspace、Task 与 Session 已以独立持久化标识建立关联，运行不再依赖教学期的硬编码 ID，侧栏也以真实 Task 而不是重复 Run 展示近期工作；用户可在 Task 的过程面板按需展开并回看其历史 Run 与对应事件。本地资料库可导入 Markdown/Text/PDF/DOCX，记录源路径、内容哈希，并以 SQLite FTS5 提供可定位的检索（PDF 按页、DOCX 按提取段落）。用户可从已登记的资料卡片或任务中的 Evidence 安全地打开原始文件，也可按登记文档刷新索引，或仅从算台的本地索引移除资料；这些操作不会修改或删除原始文件。检索同时通过只读 `knowledge_search` Tool 提供给任务执行，并将结果去重登记为可在任务侧栏回看的本地 Evidence。任务完成后，用户可把最终回复保存为关联 Workspace、Task、Run 的 Markdown Artifact；AI 生成版本会持久化该 Run 实际使用的 Evidence，人工修订继承前一版来源关系，成果页可显示每个版本的来源清单。再次保存或在成果页编辑都会新增 ArtifactVersion 而不覆盖旧版本；人工修订明确标为 `user-edit`，不伪装为 AI Run 产物。成果页可将当前或历史版本以安全的文档化 Markdown 预览呈现、从历史版本继续创建修订，或使用系统保存对话框导出当前/历史 Markdown 文件。XLSX/PPTX 解析、Embedding 与完整研究工作流保持后置。

## 3. Phase 1：研究报告 MVP

目标：完成第一条真实知识工作闭环。

用户故事：

> 用户输入一个研究主题，算台结合本地知识与网络新信息，形成来源清晰的大纲，经用户确认后生成带引用的 Markdown 和 Word 报告。

范围（含落地状态）：

| 范围项 | 状态 | 说明 |
| --- | --- | --- |
| Workspace / Task | 已落地 | 与 Session、Run 均为独立持久化标识 |
| 本地 Knowledge Vault | 已落地 | 独立 SQLite，可重建索引，不改动源文件 |
| Markdown/Text/PDF/DOCX 解析 | 已落地 | PDF 按页、DOCX 按提取段落建立 Locator |
| FTS5 检索 | 已落地 | 关键词匹配加子串兜底 |
| Embedding / 向量检索 | 移出当前切片 | 按 AGENTS.md 范围约束留待后续切片单独实现；开工前需先确认向量存储选型（[知识库与记忆](04-knowledge-and-memory.md) §5 建议 sqlite-vec）并新增 ADR |
| Web Search | 已落地 | 搜索引擎配置 + `web_search` Tool，见 [ADR-0007](adr/0007-search-engine-config-and-web-search-tool.md) |
| Web Fetch（网页正文） | 未落地 | Phase 1 后续切片 |
| Evidence | 已落地 | 本地与网页来源共用一张表，Run 内去重登记 |
| Markdown Artifact + Version | 已落地 | 保存、预览、`user-edit` 修订、导出、版本—Evidence 关联 |
| 精简 Research Workflow | 部分落地 | 已落地子集与仍缺步骤见 [知识工作流](06-knowledge-workflows.md) §2 |
| 大纲确认 | 未落地 | 阻塞在协议层：需先定义 `approval.requested` / `run.waiting` 事件并新增 ADR |
| DOCX Artifact | 移出当前切片 | 按 AGENTS.md 范围约束留待后续切片；渲染管线设计见 [知识工作流](06-knowledge-workflows.md) §4 |
| Research Skill 文件格式定义 | 未落地 | 本阶段只定义文件格式，不实现专家人格；专家 CRUD 属 Phase 4 |
| 消息中心与通知 | 已落地 | 横向基础能力，见 §3.1 与 [ADR-0006](adr/0006-notification-feedback.md) |

验收：

1. 可以建立 Workspace 并导入本地资料。**已达成**
2. 检索结果能定位来源。**已达成**（PDF 页码、DOCX 段落、文本全文、网页标题与站点）
3. 报告的关键事实带引用。**未达成**：Evidence 已按版本关联，但正文无 Claim/Citation 系统，需先立 ADR。
4. 用户可以在大纲阶段修改方向。**未达成**：无大纲阶段，也无确认点事件。
5. 输出 Markdown 和 DOCX。**部分达成**：Markdown 可保存与导出；DOCX 已移出当前切片。
6. 修改报告时生成新版本，不覆盖旧版本。**已达成**

### 3.1 切片进度

- 知识库垂直切片（2026-09-03）：Workspace / Task / Session 独立持久化标识、本地资料导入（Markdown/Text/PDF/DOCX）与 FTS5 可定位检索、只读 `knowledge_search` Tool、Evidence 去重登记与「打开原文」白名单、知识检索结果一键带查询意图进入工作任务、Markdown Artifact 的版本化保存 / 预览 / `user-edit` 修订 / 导出，以及版本—Evidence 关联（[ADR-0005](adr/0005-artifact-version-evidence.md)）。
- 搜索引擎配置与联网搜索（2026-09-05）：百度千帆 AI 搜索先行，`search_engine_configs` 每服务商一行且 `enabled` 全局唯一；`web_search` Tool 仅在存在已启用且配置了 Key 的引擎时注册；网页引用落为 `sourceType: 'web-page'` 的 Evidence，与本地来源共用同一张表和成果版本来源清单。见 [ADR-0007](adr/0007-search-engine-config-and-web-search-tool.md)。
- 消息中心与通知机制（2026-09-05 拍板）：作为横向基础能力先行落地。三层反馈模型（页面内联反馈 / Toast / 消息中心统一落档）、Notification 领域对象与 SQLite 持久化（200 条滚动上限）、run 终态与知识导入/成果导出触发、窗口失焦时的系统通知。设计与规范见 [ADR-0006](adr/0006-notification-feedback.md) 与 [UI/UX 体系](10-ui-ux-system.md) §11.5。

## 4. Phase 2：Excel 分析工作台

范围：

- XLSX/CSV 导入和结构预览
- Python Worker
- 数据质量分析
- 指标口径确认
- DuckDB/Polars/pandas 分析
- 图表 Artifact
- Workbook 输出
- 分析结论与 Word 报告
- 数据分析专家和 Kit 雏形

## 5. Phase 3：文档与演示 Studio

范围：

- DocumentModel / PresentationModel
- 模板管理
- Word 页面预览与视觉 QA
- PPT 故事线和 Slide 大纲
- PPTX 渲染与截图
- Slide 级修改
- Artifact 版本比较
- 已有 Word/PPT 的非破坏性修改

## 6. Phase 4：专家与记忆

范围：

- 专家 CRUD
- Skill 绑定
- Knowledge Scope
- User/Workspace/Expert Memory
- 记忆建议和记忆中心
- 后台反思
- 专家输出偏好
- 可解释的专家推荐

说明：领域接口从 Phase 0 预留；完整产品 UI 在本阶段建设。

## 7. Phase 5：套件与扩展生态

范围：

- Kit Manifest
- 本地安装、卸载和升级
- 依赖解析
- 权限声明与检查
- Expert Presets
- Templates
- MCP/Connectors
- Sample Tasks

不立即建设公开市场。

## 8. MVP 期间排除项

- IM
- 定时任务
- 多 Agent 自主协作
- 通用 DAG 编辑器
- 云同步
- 团队权限
- Skills 市场
- 浏览器桌面自动化
- 图片/视频生成平台
- 代码 Agent

## 9. 质量门槛

每个 Phase 应具备：

| 门槛 | 当前状态 |
| --- | --- |
| 单元测试 | 已达成：Vitest 覆盖协议、Agent 引擎、SSE Provider、工具、迁移与持久化、知识库、连通性探测、通知、Renderer 组件与全仓编码规范护栏；以实际 `npm run verify` 输出为准 |
| 关键事件时序测试 | 已达成：`agent-engine.test.ts` 覆盖流式、工具轮次、失败与取消时序；`run-service.test.ts` 覆盖广播顺序与终态 |
| 数据迁移测试 | 已达成：`apps/desktop/src/main/db/` 下的版本化迁移，`migrate.test.ts` 覆盖新库建立、历史库对账、缺列补齐、幂等重开、孤儿行清理、迁移表校验及迁移提交前的外键完整性回滚 |
| 至少一个端到端用户旅程 | 已达成（主进程边界）：`register-ipc.test.ts` 经已注册 IPC 完成「Workspace → Task → Fake Run → Markdown Artifact → user-edit 版本 → 导出」；真实桌面 UI 自动化仍需在后续专项接入 |
| 示例数据和 Fake Provider | 已达成：`FakeModelProvider` 可稳定复现事件顺序与工具行为 |
| 对应教学文档 | 部分达成：架构与领域文档齐备，尚缺面向学习者的链路讲解材料 |
| Artifact 生成后的自动验证 | **未达成**：无验证状态字段与自动校验 |
| macOS 和 Windows 基础打包验证 | **未达成**：仅有 `electron-vite build`，未配置打包与图标导出管线 |

未达成项应在对应 Phase 收尾前补齐，或在本文档显式记录延后理由，不得默认跳过。

## 10. 建议的首批开发任务

以下八项已全部完成，保留作为「一条消息如何穿过系统」的建设顺序参考：第 5 项的 UI Foundation 已按 [UI/UX 体系](10-ui-ux-system.md) 落地，第 8 项的知识库切片进度见 §3.1。

1. 初始化 workspace 和 Electron 应用。
2. 定义 `agent-protocol` 事件与 Schema。
3. 实现 Fake Provider 和最小 Agent Loop。
4. 实现 Run Repository 和 Event Journal。
5. 按 UI Foundation 规范完成任务列表、协作区和可折叠过程面板。
6. 接入 Calculator 与 Read File Tool。
7. 完成第一轮端到端测试。
8. 再进入 Knowledge Vault 与研究报告切片。
