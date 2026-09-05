# Qoder 开发交接：算台 BetterWork

> 交接日期：2026-09-05
>
> 交接基线：`6ca395d fix: separate settings nav items with 4px spacing`
>
> 仓库：[gyzhang/BetterWork](https://github.com/gyzhang/BetterWork.git)

这是一份给后续编码智能体和开发者的工作交接说明。它不替代 [AGENTS.md](../AGENTS.md)：开始任何改动前，必须先阅读 AGENTS、本文档，以及本次工作涉及的产品/架构文档。

本文是「当前到底实现了什么」的唯一入口。其他产品文档（`01`–`06`、`08`、`10`）以长期目标为主，已按章节补注实现状态，但判断现状仍以本文为准。

## 1. 产品与当前边界

算台 BetterWork 是面向知识工作者的个人 AI 工作台：利用用户的资料、记忆与工作方法，完成研究、分析、文档与演示；聊天是协作入口，Artifact 是主要交付物。

BetterWork 是一个新设计的教学项目，同时保留发展为个人或小范围知识工作台的清晰路径。它借鉴但不复制三个本机项目（详见 [参考项目与借鉴边界](09-reference-projects.md)）：

- `/Users/kevin/Dev4AI/LobsterAI/`：参考产品 UI、交互和完成度；不引入其 OpenClaw 引擎。
- `/Users/kevin/Dev4AI/ClawBible.AI/clawbible-desktop/`：参考 Agent、工具、知识和 Office 工程实践；不作为直接代码依赖。
- `/Users/kevin/Dev4AI/ClawBible.AI/clawbible-cloud/`：参考面向 AI Agent 的协作资产组织方式（分层规则、任务路由、工作日志）；已落地为 `.qoder/rules/` 与 `docs/logs/` 制度。

当前是 Phase 1 的受控最小切片。AGENTS.md 的范围约束优先于路线图中较远期的产品愿景：未经明确的产品决策、路线图更新和必要 ADR，不要提前实现 Embedding、完整研究 Agent、XLSX/PPTX 解析、DOCX/PPTX Artifact、完整 Memory、Expert/Skill/Kit、OpenClaw 兼容、多 Agent、云同步或代码 Agent。

## 2. 已实现且应保持可用的能力

| 领域 | 当前能力 |
| --- | --- |
| 应用与交互 | Electron 桌面应用；任务工作区、可完全收起的过程/资料/成果上下文面板、成果页、资料页、设置页；`system / light / dark` 与 jade、ink、ocean、sand 四套成对色系；统一页面骨架（70px 页头带 + 860px 版心）。 |
| 模型 | Fake Provider 与 OpenAI-compatible Provider（SSE 流式，支持 `reasoning_content` 与 `tool_calls` 增量拼接）；语言、视觉、嵌入三种角色可保存、启停、设默认与连通性测试。目前只有语言模型进入 Agent 执行，另两类仅完成配置层。 |
| Agent | `AsyncIterable<AgentRuntimeEvent>` 事件协议（13 种事件）、流式回复、工具卡片、取消、执行历史；四个工具：Calculator、受 Workspace 限制的 Read Text File、只读 Knowledge Search、Web Search。 |
| 任务数据 | Workspace、Task、Session、Run、Run Event 均有稳定持久化标识；侧栏按真实 Task 展示近期工作，可按 Task 回看历史 Run 与对应事件。 |
| 本地 Knowledge | 可导入 Markdown、Text、PDF、DOCX（单文件上限 20 MB）；保存源路径和内容哈希，PDF 按页、DOCX 按提取段落建立 SQLite FTS5 索引，命中为空时回退子串匹配；可检索、刷新索引、从资料库索引移除、打开已登记源文件。所有这些操作不得修改或删除用户源文件。 |
| 联网搜索 | 搜索引擎配置（百度千帆 AI 搜索先行，每服务商一行、`enabled` 全局唯一）；仅在存在已启用且配置了 Key 的引擎时注册 `web_search` 工具。见 [ADR-0007](adr/0007-search-engine-config-and-web-search-tool.md)。 |
| Evidence | `knowledge_search` 与 `web_search` 的结果会在 Run 中去重持久化为 Evidence（`local-file` / `web-page` 共用一张表）；任务侧栏可回看，本地来源可打开原始文件。 |
| Artifact | 将任务最终回复保存为版本化 Markdown Artifact；可预览、查看版本历史、从任意版本创建 `user-edit` 修订、导出任意版本为 Markdown。AI 版本关联该 Run 实际 Evidence，人工修订继承前一版本的来源关系。 |
| 通知 | 三层反馈：页面内联反馈 / Toast（同页抑制、右下角、常规 4s 错误 6s、堆叠上限 4、hover 暂停）/ 消息中心（侧栏铃铛 + 下拉面板、SQLite 200 条滚动上限、单条与全部已读、清空需确认）。通知携带可跳转 target，点击复用既有导航入口。窗口失焦且 run 终态时发系统通知，点击聚焦并跳转；run 取消静默。见 [ADR-0006](adr/0006-notification-feedback.md)。 |

ArtifactVersion 与 Evidence 的关系由 [ADR-0005](adr/0005-artifact-version-evidence.md) 决定。当前不自动往正文伪造引用标记；未来的 Claim/Citation 与人工来源编修应在完整研究工作流中显式设计，开工前先新增 ADR。

## 3. 先读什么、如何运行

推荐阅读顺序：

1. [AGENTS.md](../AGENTS.md)：硬约束、当前允许范围和完成定义。
2. [MVP 与路线图](07-mvp-and-roadmap.md)：产品阶段、切片进度与远期演进。
3. [UI/UX 体系](10-ui-ux-system.md)：信息架构、主题 Token 与交互规范（设计真相源）。
4. [系统架构](03-system-architecture.md)、[领域模型](02-domain-model.md)、[知识库与记忆](04-knowledge-and-memory.md)、[能力体系](05-capability-system.md)。
5. 本文，以及涉及变更的 ADR；如需借鉴参考项目，再读 [参考项目与借鉴边界](09-reference-projects.md)。
6. `.qoder/rules/` 的分层规则（由 Qoder 自动加载，其他智能体按 AGENTS.md 的任务路由读取）；写工作日志前先读 [日志模板](logs/README.md)。

在仓库根目录执行：

    npm install
    npm run setup:runtime
    npm run verify
    bash scripts/dev-start.sh

`setup:runtime` 用于安装 Electron 二进制并对 `better-sqlite3` 做原生重建；首次克隆或切换 Node 版本后必须执行。

开发应用只能通过 `bash scripts/dev-start.sh` 启动；它会准确停止旧的 BetterWork 开发实例并写入 PID。停止使用 `bash scripts/dev-stop.sh`，日志在 `/tmp/betterwork-dev.log`。不要绕开脚本直接启动 Electron，也不要用宽泛的进程匹配方式杀掉用户的其他 Electron 应用。

提交前最低验证命令：

    npm run typecheck
    npm test
    npm run build
    git diff --check

目前测试覆盖 **13 个测试文件、55 个测试**。生产构建存在两条来自 Zod 的 Rollup `@PURE` 注释警告；在不影响构建成功的前提下，它们是已知警告，不应因此作无关依赖升级。

**冷缓存注意**：`knowledge-vault.test.ts` 的 PDF 与 DOCX 两个用例首次运行需要现场转换 `pdf-parse` 与 `mammoth`，在冷 Vite 缓存下可能超过 Vitest 默认的 5000ms 超时而失败；缓存预热后同一文件仅需约 200–450ms。遇到这两条超时先重跑一次确认，不要误判为解析逻辑回归（该问题已记录在 §6 的收敛项中）。

用 `npm run verify` 时注意它由 `&&` 串联，测试失败会直接跳过构建；把输出接管道时还要留意管道会掩盖真实退出码。

## 4. 代码地图

| 位置 | 职责与注意事项 |
| --- | --- |
| `packages/agent-protocol/src/index.ts` | 跨进程协议、领域类型、Zod Schema 与 IPC channel 的唯一入口。新增 IPC 必须先在此处定义输入/输出并在边界校验。 |
| `packages/agent-core/src/agent-engine.ts` | `ReActAgentEngine`：单循环 ReAct，工具轮次上限默认 8，取消与失败语义在此收口。核心输出必须保持 `AsyncIterable<AgentRuntimeEvent>`。 |
| `packages/agent-core/src/fake-provider.ts`、`openai-compatible-provider.ts` | 教学 Provider 与 OpenAI 兼容 Provider。前者按前缀正则触发 calculator / read_text_file / knowledge_search，**不触发 web_search**。 |
| `packages/tool-runtime/src/` | 可测试的确定性工具实现。需要 Application 层资源的工具用「工厂 + 闭包注入」（`createKnowledgeSearchTool`、`createWebSearchTool`），保持本包不依赖 Electron、SQLite 或服务商 SDK。 |
| `apps/desktop/src/main/index.ts` | Electron 生命周期、全部 IPC handler 注册、系统对话框、模型与搜索的连通性测试、安全的系统文件打开入口。 |
| `apps/desktop/src/main/run-service.ts` | 运行编排：按配置选择 Provider、按是否有可用搜索引擎决定工具集、先持久化事件/Evidence 再向 Renderer 广播、run 终态触发通知。 |
| `apps/desktop/src/main/run-journal.ts` | 产品 SQLite 状态：Workspace、Task、Session、Run、Run Event、Evidence、Artifact 与版本、Model Profile、搜索引擎配置、Notification。 |
| `apps/desktop/src/main/knowledge-vault.ts` | 本地资料导入、格式解析与分块、FTS5 与子串兜底检索、来源路径验证、刷新与仅索引移除。 |
| `apps/desktop/src/main/notification-service.ts` | 通知的持久化—广播收口，以及窗口失焦时的系统通知与点击激活。 |
| `apps/desktop/src/main/search-engine-service.ts` | 千帆 `web_summary` HTTP 客户端与连接测试；错误信息不得含 Key。 |
| `apps/desktop/src/preload/index.ts` | 最小化、类型化的 Renderer API；所有推送事件过 Zod 后再交给 Renderer。必须维持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。 |
| `apps/desktop/src/renderer/src/App.tsx` | 当前主要 Renderer 组合入口，含工作/成果/知识/设置四视图与模型编辑 Sheet。后续可按明确功能逐步拆组件，但不要以大规模重构替代垂直切片交付。 |
| `apps/desktop/src/renderer/src/notifications.tsx` | `useNotifications` hook（初始加载、增量广播、同页抑制、Toast 生命周期）、消息中心面板与 Toast 宿主。 |
| `apps/desktop/src/renderer/src/activity.ts` | 从事件流派生用户可理解的工作阶段分组。**新增工具时必须同步更新此处的标签映射**，否则阶段标题退化为通用文案。 |
| `apps/desktop/src/renderer/src/appearance.ts`、`styles.css` | 主题系统与 UI Token。Renderer 不得新增硬编码色值或局部 `.dark` 补丁，必须使用语义化 Token。 |
| `apps/desktop/src/renderer/src/icons.tsx`、`brand-logo.tsx` | 内联 SVG 描边图标集（`currentColor`、统一 24 网格）与品牌标志。新增图标先进图标集再使用；禁止用 Unicode 字符或 emoji 充当界面图标。 |
| `apps/desktop/src/renderer/src/markdown-preview.tsx` | 成果的文档化 Markdown 预览，不渲染原始 HTML。 |

数据文件位于 Electron `userData` 下：应用状态库 `betterwork.db` 与知识库 `vaults/default/vault.sqlite` 都是可重建/本地运行数据，绝不能提交到 Git。当前 `model_profiles.api_key` 与 `search_engine_configs.api_key` 明文存于本地 SQLite，列表接口只回 `apiKeyConfigured`；日志和错误消息绝不能输出密钥。如未来引入系统钥匙串（`safeStorage`），须先新增 ADR 并设计迁移。

## 5. 不可破坏的实现约束

- 依赖方向固定为 `Renderer -> Preload API -> Application -> Agent Core / Infrastructure -> Tool Runtime`。
- Renderer 不直接访问 Node、文件系统、数据库或模型服务；Agent Core 不导入 Electron、React、SQLite Repository 或具体模型 SDK。
- `runId` 是一次执行的稳定标识；不要用拼接字符串冒充 Task、Session、Run、Message 关系。
- Application 层必须先持久化，再广播 UI 事件；UI 不是事件唯一消费者。
- SQLite 是产品状态真相源；缓存、索引和预览必须能够重建。
- 源资料默认只读。刷新与移除仅针对 BetterWork 的索引；打开文件前必须由 Main 进程验证它是已登记 Knowledge 来源。
- Artifact 的任何修改必须产生 ArtifactVersion；人工改动使用 `user-edit`，不得伪装为 AI Run 结果。
- 通知由 Application 层触发；Agent Core 不感知通知。
- UI 默认展示任务、过程、来源和成果，不展示模型私有思维链；长操作要有状态、取消入口和明确结果。

## 6. 已知缺陷与收敛项

以下是本次全量 review（2026-09-05）确认的问题，按优先级排列。它们不是「补全即正确」的产品缺口，而是需要修复的实现问题；动手前先确认优先级。

**正确性与健壮性**

1. `RunService.consume` 只有 `try/finally` 没有 `catch`。引擎内部会自行收口失败与取消，但 `consume` 内在进入事件循环之前（读取模型配置、构造搜索客户端）或 `publish` 内部（事件入库、Evidence 落库）抛错时，Run 会永久停留在 `running` 状态，且异常以未处理的 Promise rejection 形式逃逸（调用点是 `void this.consume(...)`）。应补 `catch` 并合成 `run.failed` 终态事件。
2. 未开启 `PRAGMA foreign_keys`，`run_events.run_id` 上的 `ON DELETE CASCADE` 实际不生效。当前没有删除 Run 的入口所以尚未暴露，但任何清理功能都必须先处理这一点。
3. 表结构演进靠启动时 `PRAGMA table_info` 探测加 `ALTER TABLE`，没有版本化迁移，也没有迁移测试（[MVP 与路线图](07-mvp-and-roadmap.md) §9 的未达成项）。
4. 冷 Vite 缓存下 `npm test` 会因 PDF/DOCX 用例超时而失败（见 §3）。应给这两条用例显式提高超时，或在 `vitest.config.ts` 中调整 `testTimeout`。

**协议与测试覆盖**

5. `OpenAICompatibleProvider` 的 SSE 解析与 `tool_calls` 增量拼接是风险最高的解析代码，却**完全没有测试**；断流、跨包分片、`[DONE]`、非法 JSON 行等路径均未覆盖。
6. `main/index.ts` 的 IPC handler 承载了大量业务判断（导出对话框与写盘、模型连通性测试的 URL 拼装、工作区选择、通知触发），全部没有测试。
7. `notification-service.ts` 的系统通知分支只在 `run-service.test.ts` 里被间接绕过（窗口桩返回 `isFocused: true`），没有独立测试。
8. Renderer 无任何组件测试（仓库没有 React 测试库），只覆盖了 `activity.ts`、`appearance.ts`、`markdown-preview.ts` 三个纯函数模块。
9. 无端到端 UI 自动化，`docs/07` §9 的「至少一个端到端用户旅程」未达成。

**规范违规（UI 铁律）**

10. 消息流的工具卡片用 `code` 直接渲染 `JSON.stringify` 后的工具输出，违反「原始 Run 事件不得成为默认主界面的视觉中心」（[UI/UX 体系](10-ui-ux-system.md) §11.1）。
11. `styles.css` 有 16 处 `10px`、2 处 `9px`、29 处 `11px`，其中承载产品信息的次要文本部分违反「禁止用 9–10px 小字号换取空间」铁律（§9.7 已区分可豁免的格式徽标与属违规的正文）。
12. 通知未读徽标 `.notification-badge` 硬编码 `color: #fff`，违反 Token 契约（§9.3）。
13. `styles.css` 零 `transition` / `animation`，也无 `prefers-reduced-motion`，§9.9 动效契约尚未开始实施。
14. 窄屏（`max-width: 960px`）自动折叠仍是 60px，与已拍板的 88px 手动折叠宽度不一致；60px 装不下 macOS 红绿灯正是当初改宽的原因。

**工程卫生**

15. 死代码：`App.tsx` 中从未被引用的 `CompletedWorkPage` 组件；`icons.tsx` 中未被使用的 `PanelLeftIcon`、`ChevronDownIcon`；`styles.css` 中成果来源图标容器残留的 `font-size: 9px`（该处早已改为 SVG 图标）。
16. 死 Token：`--text-on-dark` 在 8 个 Variant 中都定义但零消费；契约中的 `border-subtle` 与图表数据色尚未定义。
17. 依赖问题：`zustand` 写进 `apps/desktop/package.json` 但代码零引用，应移除；`knowledge-vault.test.ts` 直接 `import JSZip`，而 `jszip` 只是 `mammoth` 的传递依赖、并未显式声明。
18. 无 Lint 配置（ESLint / Prettier / Biome 均无）。`App.tsx` 与 `styles.css` 都存在极长单行（单行 JSX 与单行 CSS 规则），既难 review，也直接触发仓库的中文长行编辑损坏风险。
19. `activity.ts` 的工具标签映射未覆盖 `knowledge_search` 与 `web_search`，两者都退化为「调用工作工具」。

**产品缺口（属规划，不是缺陷）**

20. 视觉与嵌入模型可配置但未进入执行链路。
21. Evidence 已按版本关联，但没有正文 Claim/Citation 系统；这是 Phase 1 验收项 3，需先立 ADR。
22. 大纲确认（Phase 1 验收项 4）阻塞在协议层：`approval.requested` / `approval.resolved` / `run.waiting` 事件尚未定义。
23. Run 历史与 Session 标识已持久化，但尚未把历史作为模型上下文传入，不构成记忆系统。
24. 上下文面板展开状态未按 Task 记忆；侧栏折叠状态已持久化。
25. Renderer 多处 `void invoke()` 无 `catch`，失败静默（成果页版本列表加载失败即属此类）。
26. Dock/打包图标（`.icns`）待打包阶段：logo 已定稿（`docs/assets/betterwork-logo.svg`，透明背景），缺 PNG/ICNS 导出管线，`docs/07` §9 的打包验证门槛未达成。

## 7. 建议的续作方式

优先从 §6 的「正确性与健壮性」与「协议与测试覆盖」两组里选一条小而完整的路径收口——它们影响后续所有切片的可靠性，且都不需要新的产品决策。

UI 收敛项（§6 第 10–14 条）应作为**一次专项**处理，不要夹带进功能切片：字号、动效与折叠宽度都涉及观感验收，需要单独走人工验收流程。

以下能力符合长期方向，但**不是自动授权的下一步**：Embedding 与混合检索、带 Citation 的研究流与大纲确认、网页正文 Fetch、DOCX 报告、Excel 分析、PPT、长期 Memory、Expert/Skill/Kit。开始其中任一项前，应先与项目负责人确认优先级；再更新 [MVP 与路线图](07-mvp-and-roadmap.md)，并在涉及跨模块关系或关键技术选择时新增 ADR。

## 8. 变更与提交纪律

每次开始先执行 `git status --short`。工作树并不一定总是干净；既有改动属于用户，不能删除、覆盖或夹带进无关提交。多个会话并行改本仓库时，提交前要重新核对 `git status` 与 `git diff`，追加共享文档（如 `docs/logs/` 当天日志）前先重读文件末尾。每个提交保持聚焦，提交前完成第 3 节的验证，并将必要的测试、文档和 ADR 与实现放在同一变更中。

禁止提交 `.env`、API Key、数据库、构建产物、用户资料或本地工作文件。遇到产品范围、数据迁移策略或安全边界不明确时，先停在文档/ADR 层澄清，不要把猜测固化为实现。

每完成一次对话任务，当天写一篇 `docs/logs/YYYY-MM-DD.md`（当天已有则追加一节），模板见 [logs/README.md](logs/README.md)。
