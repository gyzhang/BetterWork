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

状态：已完成。随后以最小的 Phase 1 切片进入：Workspace、Task 与 Session 已以独立持久化标识建立关联，运行不再依赖教学期的硬编码 ID；本地资料库可导入 Markdown/Text/PDF/DOCX，记录源路径、内容哈希，并以 SQLite FTS5 提供可定位的检索（PDF 按页、DOCX 按提取段落）。检索同时通过只读 `knowledge_search` Tool 提供给任务执行，并将结果去重登记为可在任务侧栏回看的本地 Evidence；XLSX/PPTX 解析、Embedding 与完整研究工作流保持后置。

## 3. Phase 1：研究报告 MVP

目标：完成第一条真实知识工作闭环。

用户故事：

> 用户输入一个研究主题，算台结合本地知识与网络新信息，形成来源清晰的大纲，经用户确认后生成带引用的 Markdown 和 Word 报告。

范围：

- Workspace / Task
- 本地 Knowledge Vault
- Markdown/Text/PDF 基础解析
- FTS5 + Embedding 检索
- Web Search / Fetch
- Evidence
- 精简 Research Workflow
- 大纲确认
- Markdown Artifact
- DOCX Artifact
- Artifact Version
- 研究专家和 Research Skill（文件定义）

验收：

1. 可以建立 Workspace 并导入本地资料。
2. 检索结果能定位来源。
3. 报告的关键事实带引用。
4. 用户可以在大纲阶段修改方向。
5. 输出 Markdown 和 DOCX。
6. 修改报告时生成新版本，不覆盖旧版本。

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

## 8. 第一阶段排除项

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

- 单元测试
- 关键事件时序测试
- 数据迁移测试
- 至少一个端到端用户旅程
- 示例数据和 Fake Provider
- 对应教学文档
- Artifact 生成后的自动验证
- macOS 和 Windows 基础打包验证

## 10. 建议的首批开发任务

1. 初始化 workspace 和 Electron 应用。
2. 定义 `agent-protocol` 事件与 Schema。
3. 实现 Fake Provider 和最小 Agent Loop。
4. 实现 Run Repository 和 Event Journal。
5. 按 UI Foundation 规范完成任务列表、协作区和可折叠过程面板。
6. 接入 Calculator 与 Read File Tool。
7. 完成第一轮端到端测试。
8. 再进入 Knowledge Vault 与研究报告切片。
