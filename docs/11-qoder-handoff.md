# Qoder 开发交接：算台 BetterWork

> 交接日期：2026-09-03
>
> 交接基线：`087fa6b feat: retain evidence with artifact versions`
>
> 仓库：[gyzhang/BetterWork](https://github.com/gyzhang/BetterWork.git)

这是一份给后续编码智能体和开发者的工作交接说明。它不替代 [AGENTS.md](../AGENTS.md)：开始任何改动前，必须先阅读 AGENTS、本文档，以及本次工作涉及的产品/架构文档。

## 1. 产品与当前边界

算台 BetterWork 是面向知识工作者的个人 AI 工作台：利用用户的资料、记忆与工作方法，完成研究、分析、文档与演示；聊天是协作入口，Artifact 是主要交付物。

BetterWork 是一个新设计的教学项目，同时保留发展为个人或小范围知识工作台的清晰路径。它借鉴但不复制两个本机项目：

- `/Users/kevin/Dev4AI/LobsterAI/`：参考产品 UI、交互和完成度；不引入其 OpenClaw 引擎。
- `/Users/kevin/Dev4AI/ClawBible.AI/clawbible-desktop/`：参考 Agent、工具、知识和 Office 工程实践；不作为直接代码依赖。

当前是 Phase 1 的受控最小切片。AGENTS.md 的范围约束优先于路线图中较远期的产品愿景：未经明确的产品决策、路线图更新和必要 ADR，不要提前实现 Embedding、Web Research、完整研究 Agent、XLSX/PPTX 解析、DOCX/PPTX Artifact、完整 Memory、Expert/Skill/Kit、OpenClaw 兼容、多 Agent、云同步或代码 Agent。

## 2. 已实现且应保持可用的能力

| 领域 | 当前能力 |
| --- | --- |
| 应用与交互 | Electron 桌面应用；任务工作区、可收起的过程/上下文面板、成果页、资料页、模型设置；`system / light / dark` 与 jade、ink、ocean、sand 色系。 |
| 模型 | Fake Provider 与 OpenAI-compatible Provider；语言、视觉、嵌入三种配置角色可保存和连通性测试。目前只有语言模型进入 Agent 执行，另外两类仅完成配置层。 |
| Agent | `AsyncIterable<AgentRuntimeEvent>` 事件协议、流式回复、工具卡片、取消、执行历史；Calculator、受 Workspace 限制的 Read Text File、只读 Knowledge Search Tool。 |
| 任务数据 | Workspace、Task、Session、Run、Run Event 均有稳定持久化标识；侧栏按真实 Task 展示近期工作，可按 Task 回看 Run。 |
| 本地 Knowledge | 可导入 Markdown、Text、PDF、DOCX；保存源路径和内容哈希，PDF 按页、DOCX 按提取段落建立 SQLite FTS5 索引；可检索、刷新索引、从资料库索引移除、打开已登记源文件。所有这些操作不得修改或删除用户源文件。 |
| Evidence | `knowledge_search` 结果会在 Run 中去重持久化为本地 Evidence；任务侧栏可回看并打开已登记的原始资料。 |
| Artifact | 将任务最终回复保存为版本化 Markdown Artifact；可预览、查看版本历史、从任意版本创建 `user-edit` 修订、导出任意版本为 Markdown。AI 版本关联该 Run 实际 Evidence，人工修订继承前一版本的来源关系。 |

ArtifactVersion 与 Evidence 的关系由 [ADR-0005](adr/0005-artifact-version-evidence.md) 决定。当前不自动往正文伪造引用标记；未来的 Claim/Citation 与人工来源编修应在完整研究工作流中显式设计。

## 3. 先读什么、如何运行

推荐阅读顺序：

1. [AGENTS.md](../AGENTS.md)：硬约束、当前允许范围和完成定义。
2. [MVP 与路线图](07-mvp-and-roadmap.md)：产品阶段与远期演进。
3. [UI/UX 体系](10-ui-ux-system.md)：信息架构、主题 Token 与交互规范。
4. [系统架构](03-system-architecture.md)、[领域模型](02-domain-model.md)、[知识库与记忆](04-knowledge-and-memory.md)。
5. 本文，以及涉及变更的 ADR；如需借鉴参考项目，再读 [参考项目与借鉴边界](09-reference-projects.md)。
6. `.qoder/rules/` 的分层规则（由 Qoder 自动加载，其他智能体按 AGENTS.md 的任务路由读取）；写工作日志前先读 [日志模板](logs/README.md)。

在仓库根目录执行：

    npm install
    npm run verify
    bash scripts/dev-start.sh

开发应用只能通过 `bash scripts/dev-start.sh` 启动；它会准确停止旧的 BetterWork 开发实例并写入 PID。停止使用 `bash scripts/dev-stop.sh`，日志在 `/tmp/betterwork-dev.log`。不要绕开脚本直接启动 Electron，也不要用宽泛的进程匹配方式杀掉用户的其他 Electron 应用。

提交前最低验证命令：

    npm run typecheck
    npm test
    npm run build
    git diff --check

目前测试覆盖 11 个测试文件、32 个测试。生产构建存在两条来自 Zod 的 Rollup `@PURE` 注释警告；在不影响构建成功的前提下，它们是已知警告，不应因此作无关依赖升级。

## 4. 代码地图

| 位置 | 职责与注意事项 |
| --- | --- |
| `packages/agent-protocol/src/index.ts` | 跨进程协议、领域类型、Zod Schema 与 IPC channel 的唯一入口。新增 IPC 必须先在此处定义输入/输出并在边界校验。 |
| `packages/agent-core/src/` | 与 Electron、SQLite、具体模型 SDK 解耦的 Agent Loop 与 Provider 接口。核心输出必须保持 `AsyncIterable<AgentRuntimeEvent>`。 |
| `packages/tool-runtime/src/` | 可测试的确定性工具实现。Tool 输入输出必须结构化；不得让模型承担计算。 |
| `apps/desktop/src/main/index.ts` | Electron 生命周期、IPC、系统对话框和安全的系统文件打开入口。 |
| `apps/desktop/src/main/run-service.ts` | 运行编排：先持久化事件/Evidence，再向 Renderer 广播。 |
| `apps/desktop/src/main/run-journal.ts` | 产品 SQLite 状态：Workspace、Task、Session、Run、Evidence、Artifact、Model Profile 等。 |
| `apps/desktop/src/main/knowledge-vault.ts` | 本地资料导入、FTS5、来源路径验证、刷新与仅索引移除。 |
| `apps/desktop/src/preload/index.ts` | 最小化、类型化的 Renderer API；必须维持 `contextIsolation: true`、`nodeIntegration: false`。 |
| `apps/desktop/src/renderer/src/App.tsx` | 当前主要 Renderer 组合入口。后续可按明确功能逐步拆组件，但不要以大规模重构替代垂直切片交付。 |
| `apps/desktop/src/renderer/src/appearance.ts`、`styles.css` | 主题系统和 UI Token。Renderer 不得新增硬编码色值或局部 `.dark` 补丁，必须使用语义化 Token。 |

数据文件位于 Electron `userData` 下；应用状态 SQLite 与 Knowledge Vault SQLite 都是可重建/本地运行数据，绝不能提交到 Git。当前 `model_profiles.api_key` 存于本地 SQLite，日志和错误消息绝不能输出密钥；如未来引入系统钥匙串，须先新增 ADR 并设计迁移。

## 5. 不可破坏的实现约束

- 依赖方向固定为 `Renderer -> Preload API -> Application -> Agent Core / Infrastructure -> Tool Runtime`。
- Renderer 不直接访问 Node、文件系统、数据库或模型服务；Agent Core 不导入 Electron、React、SQLite Repository 或具体模型 SDK。
- `runId` 是一次执行的稳定标识；不要用拼接字符串冒充 Task、Session、Run、Message 关系。
- Application 层必须先持久化，再广播 UI 事件；UI 不是事件唯一消费者。
- SQLite 是产品状态真相源；缓存、索引和预览必须能够重建。
- 源资料默认只读。刷新与移除仅针对 BetterWork 的索引；打开文件前必须由 Main 进程验证它是已登记 Knowledge 来源。
- Artifact 的任何修改必须产生 ArtifactVersion；人工改动使用 `user-edit`，不得伪装为 AI Run 结果。
- UI 默认展示任务、过程、来源和成果，不展示模型私有思维链；长操作要有状态、取消入口和明确结果。

## 6. 建议的续作方式

当前切片仍可做的优先方向，应以一条小而完整的用户路径为单位选择，例如：改善 Artifact 版本来源列表的可访问性，完善资料索引的失败/空状态，补齐相关回归测试，或将现有 Task/Artifact 流程中的可用性问题打磨完整。

以下能力符合长期方向，但**不是自动授权的下一步**：Embedding 与混合检索、网络检索和带 Citation 的研究流、DOCX 报告、Excel 分析、PPT、长期 Memory、Expert/Skill/Kit。开始其中任一项前，应先与项目负责人确认优先级；再更新 [MVP 与路线图](07-mvp-and-roadmap.md)，并在涉及跨模块关系或关键技术选择时新增 ADR。

当前已知的产品事实，不应被误当成缺陷后直接“补全”：

- 视觉、嵌入模型虽然可配置和测试，但尚未被执行链路使用。
- Evidence 是本地 Knowledge 检索的可追溯记录；Artifact 页面显示来源元数据，但没有正文 Citation/Claim 系统。
- Run 历史与 Session 标识已经持久化，但尚未实现把完整历史作为模型上下文的“记忆系统”。
- 尚未建设端到端 UI 自动化；改动核心用户路径时，至少补单元测试并进行一次实际桌面验收。

## 7. 变更与提交纪律

每次开始先执行 `git status --short`。工作树并不一定总是干净；既有改动属于用户，不能删除、覆盖或夹带进无关提交。每个提交保持聚焦，提交前完成第 3 节的验证，并将必要的测试、文档和 ADR 与实现放在同一变更中。

禁止提交 `.env`、API Key、数据库、构建产物、用户资料或本地工作文件。遇到产品范围、数据迁移策略或安全边界不明确时，先停在文档/ADR 层澄清，不要把猜测固化为实现。
