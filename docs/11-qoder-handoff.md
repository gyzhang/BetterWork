# Qoder 开发交接：算台 BetterWork

> 交接日期：2026-09-05
>
> 交接基线：分支 `refactor/unified-code-quality`，代码基线 `8905e60 refactor(renderer): move cohesive state clusters into hooks and sort imports`
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
2. [工程规范](12-engineering-standards.md)：全仓唯一的代码规范。写任何代码前先读它，`eslint.config.mjs` 与 `.prettierrc.json` 是它的可执行形式，`standards/coding-standard.test.ts` 是它的跨文件结构护栏。
3. [MVP 与路线图](07-mvp-and-roadmap.md)：产品阶段、切片进度与远期演进。
4. [UI/UX 体系](10-ui-ux-system.md)：信息架构、主题 Token 与交互规范（界面设计真相源）。
5. [系统架构](03-system-architecture.md)、[领域模型](02-domain-model.md)、[知识库与记忆](04-knowledge-and-memory.md)、[能力体系](05-capability-system.md)。
6. 本文，以及涉及变更的 ADR；如需借鉴参考项目，再读 [参考项目与借鉴边界](09-reference-projects.md)。
7. `.qoder/rules/` 的分层规则（由 Qoder 自动加载，其他智能体按 AGENTS.md 的任务路由读取）；写工作日志前先读 [日志模板](logs/README.md)。

在仓库根目录执行：

    npm install
    npm run setup:runtime
    npm run verify
    bash scripts/dev-start.sh

`setup:runtime` 用于安装 Electron 二进制并对 `better-sqlite3` 做原生重建；首次克隆或切换 Node 版本后必须执行。

开发应用只能通过 `bash scripts/dev-start.sh` 启动；它会准确停止旧的 BetterWork 开发实例并写入 PID。停止使用 `bash scripts/dev-stop.sh`，日志在 `/tmp/betterwork-dev.log`。不要绕开脚本直接启动 Electron，也不要用宽泛的进程匹配方式杀掉用户的其他 Electron 应用。

提交前唯一门禁：

    npm run verify     # lint + format:check + typecheck + test + build

**不要把 verify 的输出接管道后只看末尾**（`npm run verify | tail` 的退出码是 `tail` 的，永远为 0，会把失败读成成功）。需要截取输出时用 `npm run verify > /tmp/verify.log 2>&1; echo $?`。

目前测试覆盖 **20 个测试文件、131 个测试**（含 `standards/coding-standard.test.ts` 的 17 条规范护栏），ESLint 全仓零错误。生产构建存在两条来自 Zod 的 Rollup `@PURE` 注释警告；在不影响构建成功的前提下，它们是已知警告，不应因此作无关依赖升级。

`knowledge-vault.test.ts` 的 PDF 与 DOCX 两个用例已显式提高超时——它们首次运行需要现场转换 `pdf-parse` 与 `mammoth`，冷 Vite 缓存下会超过默认的 5 秒。

数据文件位于 Electron `userData` 下：应用状态库 `betterwork.db` 与知识库 `vaults/default/vault.sqlite`，都是本地运行数据，绝不能提交到 Git。两个库的 schema 由 `db/` 下的版本化迁移管理；迁移制度之前建立的历史库会在首次启动时被识别并对账，不会丢数据。模型与搜索的 API Key 明文存于本地 SQLite，列表接口只回 `apiKeyConfigured`；日志和错误消息绝不能输出密钥。如未来引入系统钥匙串（`safeStorage`），须先新增 ADR 并设计迁移。
## 4. 代码地图


| 位置 | 职责与注意事项 |
| --- | --- |
| `packages/agent-protocol/src/index.ts` | 跨进程协议、领域类型、Zod Schema 与 IPC channel 的唯一入口。新增 IPC 必须先在此处定义输入/输出并在边界校验。 |
| `packages/agent-core/src/agent-engine.ts` | `ReActAgentEngine`：单循环 ReAct，工具轮次上限默认 8，取消与失败语义在此收口。核心输出必须保持 `AsyncIterable<AgentRuntimeEvent>`。 |
| `packages/agent-core/src/errors.ts` | 取消与错误描述的**唯一**定义（`abortError` / `isAbortError` / `describeError`）。任何地方都不要再手写 `Object.assign(new Error(...), { name: 'AbortError' })`。 |
| `packages/agent-core/src/fake-provider.ts` | 教学 Provider，不联网、输出可预测。刻意不支持 `web_search` 触发词——联网搜索会发起真实请求，与离线可复现的定位冲突。 |
| `packages/agent-core/src/openai-compatible-provider.ts` | OpenAI 兼容 SSE 解析与 `tool_calls` 增量拼接。改动前先看它的 19 个测试。 |
| `packages/tool-runtime/src/` | 确定性工具实现。需要 Application 层资源的工具用「工厂 + 闭包注入」（`createKnowledgeSearchTool`、`createWebSearchTool`），保持本包不依赖 Electron、SQLite 或服务商 SDK。 |
| `apps/desktop/src/main/index.ts` | 只做装配：建窗口、组装依赖、注册 IPC、管理生命周期；启动时收口上次被中断的 Run。**不放业务逻辑**。 |
| `apps/desktop/src/main/window.ts` | 窗口构造、首帧主题常量（必须与青玉浅色 Token 一致，避免冷启动闪白）。 |
| `apps/desktop/src/main/db/` | 连接与 PRAGMA、版本化迁移执行器（`migrate.ts`）、两个库的 schema 与历史库对账。新增 schema 变更只能加迁移，不能改已发布的迁移。 |
| `apps/desktop/src/main/persistence/` | 按聚合拆分的 Repository（workspace / task / run / evidence / artifact / model / search-engine / notification）与组装它们的 `AppStore`。Repository 只写自己的表，可读其他表做归属校验；跨聚合写入由调用方用 `store.transaction()` 显式包起来。 |
| `apps/desktop/src/main/services/run-service.ts` | 运行编排：选 Provider、按是否有可用搜索引擎决定工具集、先持久化再广播、终态触发通知，并在编排自身出错时用 `forceFailure` 兜底。 |
| `apps/desktop/src/main/services/knowledge-vault.ts` | 资料导入、格式解析与分块、FTS5 与子串兜底检索、来源路径验证、刷新与仅索引移除。不碰 DDL。 |
| `apps/desktop/src/main/services/notification-service.ts` | 通知的持久化—广播收口，以及窗口失焦时的系统通知与点击激活。 |
| `apps/desktop/src/main/services/search-engine-service.ts` | 千帆 `web_summary` 客户端与连接测试；外部字段一律经 `readString` 收窄，错误信息不得含 Key。 |
| `apps/desktop/src/main/services/model-connectivity.ts` | 模型连通性探测的纯函数实现（可注入 fetch），含超时与 http/https 协议校验收窄。 |
| `apps/desktop/src/main/ipc/register-ipc.ts` | 全部 channel 注册。三个 helper（`handleInput` / `handleOptionalInput` / `handleNoInput`）是入参校验的唯一通道，handler 不得自行解析 `raw`。 |
| `apps/desktop/src/preload/index.ts` | 最小化、类型化的 Renderer API；所有推送事件过 Zod 后再交给 Renderer。必须维持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。 |
| `apps/desktop/src/renderer/src/App.tsx` | 跨簇编排与布局组装（约 720 行）：工作会话状态、视图切换、通知接线、Sidebar 与错误条。 |
| `apps/desktop/src/renderer/src/views/` | 工作以外的页面级视图：`ArtifactView`、`KnowledgeView`、`SettingsView`。视图内不出现 IPC 调用。 |
| `apps/desktop/src/renderer/src/components/` | 跨视图复用组件：`ContextPanel`、`Welcome`、`EmptyState`、`ModelEditorSheet`。 |
| `apps/desktop/src/renderer/src/hooks/` | 五个内聚状态簇：`useAppearance`、`useKnowledgeLibrary`、`useModelSettings`、`useArtifactViewer`、`useSearchEngineSettings`。IPC 调用只出现在这一层与 `App.tsx`；刷新类回调用 `useCallback` 保持引用稳定，挂载 effect 才能如实声明依赖。 |
| `apps/desktop/src/renderer/src/lib/` | 无状态纯函数与常量：`async-action`（异步收口的唯一入口）、`tool-summary`、`labels`（含 `TOOL_LABELS`，新增工具必须同步）、`format`、`titlebar`、`view-types`。 |
| `apps/desktop/src/renderer/src/notifications.tsx` | `useNotifications`（初始加载、增量广播、同页抑制、Toast 生命周期）、消息中心面板与 Toast 宿主。 |
| `apps/desktop/src/renderer/src/activity.ts` | 从事件流派生用户可理解的工作阶段分组。 |
| `apps/desktop/src/renderer/src/appearance.ts`、`styles.css` | 主题系统、Token 与全部界面样式。不得新增硬编码色值或局部 `.dark` 补丁；动效时长只能用 Token。 |
| `apps/desktop/src/renderer/src/icons.tsx`、`brand-logo.tsx` | 内联 SVG 描边图标集（`currentColor`、统一 24 网格）与品牌标志。新增图标先进图标集再使用。 |
| `apps/desktop/src/renderer/src/markdown-preview.tsx` | 成果的文档化 Markdown 预览，不渲染原始 HTML。 |
| `standards/coding-standard.test.ts` | 跨文件的规范护栏：配置唯一性、源码零豁免、分层边界、Token 与动效纪律、规则索引完整、首帧主题一致。例外写成文件内的白名单数组并注明理由，不要在源码里加豁免注释。 |
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


2026-09-05 的全量 review 记录了 26 项问题，随后在 `refactor/unified-code-quality` 分支上做了一轮系统收敛。下面先列**仍未解决**的，再列已收敛的，避免后续会话重复劳动。

### 仍未解决

**测试覆盖**

1. IPC 注册器已有 Electron 替身行为测试：非法输入、无入参通道、输出 Schema、来源打开白名单，以及「Workspace → Task → Run → Artifact → 修订 → 导出」主进程旅程。后续新增 channel 必须在同一测试中补边界行为；真实桌面窗口自动化尚未建立。
2. Renderer 已引入 `@testing-library/react` + jsdom，并覆盖 Confirmation Dialog 的焦点与 Escape 行为、成果版本加载错误，以及 `useArtifactViewer` 在受控异步乱序下忽略过期版本列表响应。仍无覆盖完整 AppShell 的组件测试与真实桌面 UI 自动化；其他视图和 hook 仍主要依靠人工桌面验收。
3. GitHub Actions 已对 Pull Request 和 `main` 推送执行 `npm run verify`。macOS 和 Windows 基础打包验证仍未达成；真实桌面 UI 自动化应在该专项中接入。

**界面**

4. `App.tsx` 仍有约 720 行，AppShell 与 Sidebar 未拆出。工作会话状态刻意留在 App（它同时牵动任务列表、上下文面板、成果列表与通知跳转），但 Sidebar 是纯 JSX，可以继续外提。
5. Confirmation Dialog 已落地，但尚未覆盖所有未来的破坏性操作；新增此类操作必须复用组件并补键盘行为测试。
6. 部分低频次级按钮的点击区域小于 32px（Composer 工作区行的文字按钮、上下文页签、模型行内动作、通知面板动作、证据「原文」按钮）。达标方式是扩大命中区，不是放大视觉尺寸。
7. Tooltip、Popover、Progress、Skeleton、Switch 未落地；除 `⌘/Ctrl ↵` 外没有其他快捷键。
8. docs/10 §13 UI-5 要求的三尺寸 × 3 模式 × 4 色系验收矩阵仍未建立；本轮字号与动效收敛后需要重新做一轮人工验收。
9. 窄屏（`max-width: 960px`）是**强制**图标栏，不读取用户的折叠偏好；覆盖式右栏没有点击外部关闭的背板。
10. 上下文面板展开状态未按 Task 记忆（侧栏折叠状态已持久化）。
11. 外观持久化值损坏时静默回落到默认外观，未按 docs/10 §9.5 向用户说明原因。

**产品缺口（属规划，不是缺陷）**

12. 视觉与嵌入模型可配置但未进入执行链路；一个 ModelProfile 只能担任一个角色。
13. Evidence 已按版本关联，但没有正文 Claim/Citation 系统——Phase 1 验收项 3，需先立 ADR。
14. 大纲确认（Phase 1 验收项 4）阻塞在协议层：`approval.requested` / `approval.resolved` / `run.waiting` 事件尚未定义，事件 Schema 也没有版本号字段。
15. Run 历史与 Session 标识已持久化，但执行链路尚未把历史作为模型上下文传入，不构成记忆系统。
16. Dock/打包图标（`.icns`）待打包阶段：logo 已定稿（`docs/assets/betterwork-logo.svg`，透明背景），缺 PNG/ICNS 导出管线。

### 本轮已收敛

- **Run 终态保证**：`RunService.consume` 补了 `catch`，`RunRepository.forceFailure` 只在 Run 仍为 `running` 时合成 `run.failed`（重复调用安全、不与引擎终态冲突），启动时 `failInterruptedRuns` 收口上次被强杀留下的运行。此前编排层抛错会让 Run 永远停在 `running` 并以未处理 rejection 逃逸。
- **数据完整性**：`PRAGMA foreign_keys` 常开，任务/运行/证据/成果/版本之间的级联删除真实生效；schema 改为版本化迁移（`schema_migrations` + 历史库对账 + 重建表前清理孤儿行 + 原子事务），并有迁移测试。
- **上帝对象拆分**：502 行的 `RunJournal` 按聚合拆为 8 个 Repository + `AppStore`；`main/index.ts` 的 45 处非空断言随 IPC 下沉到 `ipc/register-ipc.ts` 后全部消失。
- **静默失败**：46 处 `void someIpcCall()` 全部改为 `reportAction`（失败呈现给用户，新增了跨视图错误条）或 `trackAction`（后台同步记录到控制台）；成果页版本列表加载失败不再静默。
- **测试补齐**：SSE Provider 19 个用例（端点归一化、跨包拼接、`tool_calls` 增量合并、并行调用按 index 分离、keep-alive 与畸形行、各类失败）、连通性探测 10 个、通知服务 7 个（含此前被完全跳过的系统通知分支）。
- **间距与阴影 Token**：5 处偏离标尺的 `3px` 间距对齐到 4px；阴影与遮罩颜色提为 `--scrim` 与五档 `--shadow-color-*`，按明暗分别取值（深色画布上同等强度的黑色阴影不可见，抬升感会消失），组件不再写 `rgba(0, 0, 0, …)` 字面量。
- **UI 契约**：动效 Token + transitions + keyframes + `prefers-reduced-motion`；41 处小字号提升到 12px 下限（5 处图形徽标按规范豁免，3 处死声明删除）；`--on-danger` 与 `--border-subtle` 补齐 8 个 Variant，硬编码 `#fff` 清零；死 Token `--text-on-dark` 删除；窄屏折叠 60px 统一为 88px；工具卡片不再裸渲染 JSON，原始载荷移入过程面板折叠区。
- **工程卫生**：引入 Prettier + ESLint（类型感知规则、导入排序）并纳入 `verify` 门禁，全仓零 lint 错误；3930 行源码格式化后为可读的多行结构，不再有 2000 字符的单行 JSX/CSS；删除死代码（`CompletedWorkPage`、`PanelLeftIcon`、`ChevronDownIcon`、两处 `.primary-nav em`）；移除未使用的 `zustand`，显式声明测试用到的 `jszip`；取消语义统一到 `agent-core/errors.ts`；`FakeModelProvider` 的可取消延时不再每次泄漏一个 abort 监听器。
## 7. 建议的续作方式


先读 [工程规范](12-engineering-standards.md)，再动手。规范是机器强制的：`npm run verify` 不过就不能提交。

从 §6「仍未解决」里选一条小而完整的路径收口。优先级建议：

1. **第 1、2 条（IPC 与 Renderer 测试）**：这两处是唯一还没有自动化保护的核心路径，后续任何切片都要踩在上面。
2. **第 14 条（确认点事件协议）**：它是 Phase 1「大纲确认」验收项的前置，且属跨模块协议变更，需要先立 ADR 再实现。
3. **第 8 条（视觉验收矩阵）**：本轮改了字号与动效，观感需要一次系统性人工验收，不要等到下一个功能切片时才发现。

界面类的第 4–11 条涉及观感，应作为**一次专项**处理并单独走人工验收，不要夹带进功能切片。

以下能力符合长期方向，但**不是自动授权的下一步**：Embedding 与混合检索、带 Citation 的研究流与大纲确认、网页正文 Fetch、DOCX 报告、Excel 分析、PPT、长期 Memory、Expert/Skill/Kit。开始其中任一项前，应先与项目负责人确认优先级；再更新 [MVP 与路线图](07-mvp-and-roadmap.md)，并在涉及跨模块关系或关键技术选择时新增 ADR。
## 8. 变更与提交纪律

每次开始先执行 `git status --short`。工作树并不一定总是干净；既有改动属于用户，不能删除、覆盖或夹带进无关提交。多个会话并行改本仓库时，提交前要重新核对 `git status` 与 `git diff`，追加共享文档（如 `docs/logs/` 当天日志）前先重读文件末尾。每个提交保持聚焦，提交前完成第 3 节的验证，并将必要的测试、文档和 ADR 与实现放在同一变更中。

禁止提交 `.env`、API Key、数据库、构建产物、用户资料或本地工作文件。遇到产品范围、数据迁移策略或安全边界不明确时，先停在文档/ADR 层澄清，不要把猜测固化为实现。

每完成一次对话任务，当天写一篇 `docs/logs/YYYY-MM-DD.md`（当天已有则追加一节），模板见 [logs/README.md](logs/README.md)。
