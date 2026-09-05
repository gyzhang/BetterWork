# MVP 与路线图

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

- 知识库垂直切片（2026-09-03）：Workspace / Task / Session 独立持久化标识、本地资料导入（Markdown/Text/PDF/DOCX）与 FTS5 可定位检索、只读 `knowledge_search` Tool、Evidence 去重登记与「打开原文」白名单、Markdown Artifact 的版本化保存 / 预览 / `user-edit` 修订 / 导出，以及版本—Evidence 关联（[ADR-0005](adr/0005-artifact-version-evidence.md)）。
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
| 单元测试 | 已达成：Vitest 覆盖协议、Agent 引擎、工具、持久化、知识库、通知与 Renderer 纯函数 |
| 关键事件时序测试 | 已达成：`agent-engine.test.ts` 覆盖流式、工具轮次、失败与取消时序；`run-service.test.ts` 覆盖广播顺序与终态 |
| 数据迁移测试 | **未达成**：表结构演进靠启动时 `PRAGMA table_info` 探测加 `ALTER TABLE`，没有版本化迁移，也没有迁移测试 |
| 至少一个端到端用户旅程 | **未达成**：无 Playwright 或等价的 UI 自动化；当前以单元测试加人工桌面验收兜底 |
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
