# Qoder 开发交接：算台 BetterWork

> 后续范围更新：阶段 A 必须支持脚本型 `ppt-generation-expert`，详见 [ADR-0009](adr/0009-script-skill-baseline.md)。截至 2026-09-14，macOS 执行器、依赖绑定、PPTX 文件成果、专家、材料、记忆、MCP、网页正文和 Office 输入已有代码与自动化验证；真实业务两期旅程、取消走查和签名安装仍见[专家开发计划](development/tasks-experts.md)的 E55/E56。

> 交接日期：2026-09-05
>
> 交接基线：分支 `refactor/unified-code-quality`，代码基线 `8905e60 refactor(renderer): move cohesive state clusters into hooks and sort imports`
>
> 仓库：[gyzhang/BetterWork](https://github.com/gyzhang/BetterWork.git)

这是一份给后续编码智能体和开发者的工作交接说明。它不替代 [AGENTS.md](../AGENTS.md)：开始任何改动前，必须先阅读 AGENTS、本文档，以及本次工作涉及的产品/架构文档。

本文是运行与交接入口。§2 的能力表与 §4–§7 的缺口记录含早期交接快照，不是所有模块的实时状态真相源；现状与验收以各 A/B0/E/CF/WM/MI/KM/SC 任务板的最新证据为准。UI 契约以 docs/10 为准，§3 的命令与验证要求持续维护。

> 最新产品确认：Skill 信任选项与本地目录分发见 [ADR-0011](adr/0011-skill-trust-and-local-distribution.md)，管理与授权实现已落地，安装分发仍待完整验收；ADR-0010 其余执行技术仍为 Proposed。

## 1. 产品与当前边界

算台 BetterWork 是面向知识工作者的个人 AI 工作台：利用用户的资料、记忆与工作方法，完成研究、分析、文档与演示；聊天是协作入口，Artifact 是主要交付物。

BetterWork 优先成为个人实际使用的工作台，再供周边同事用于个人工作；教学总结不约束产品可用性。它借鉴但不复制三个本机项目（详见 [参考项目与借鉴边界](09-reference-projects.md)）：

- `/Users/kevin/Dev4AI/LobsterAI/`：参考产品 UI、交互和完成度；不引入其 OpenClaw 引擎。
- `/Users/kevin/Dev4AI/ClawBible.AI/clawbible-desktop/`：参考 Agent、工具、知识和 Office 工程实践；不作为直接代码依赖。
- `/Users/kevin/Dev4AI/ClawBible.AI/clawbible-cloud/`：参考面向 AI Agent 的协作资产组织方式（分层规则、任务路由、工作日志）；已落地为 `.qoder/rules/` 与 `docs/logs/` 制度。

2026-09-08 已确认后续顺序：Skill 管理与配置 → 专家管理与配置 → 研究到汇报完整路径。见 [ADR-0008](adr/0008-personal-workbench-and-capability-first.md)。该顺序是产品决策记录；实现已持续推进，下面能力表不覆盖后续全部增量。具体配置范围和工程边界见 [修订稿](reviews/2026-09-08-product-scope.md)，建议项不能视为已实现或已接受技术选型；开工仍需相关实现 ADR。

## 2. 已实现能力的交接摘要（增量状态见任务板）

| 领域 | 当前能力 |
| --- | --- |
| 应用与交互 | Electron 桌面应用；任务工作区、可完全收起的过程/资料/成果上下文面板、成果页、资料页、设置页；`system / light / dark` 与 jade、ink、ocean、sand 四套成对色系；统一页面骨架（70px 页头带 + 860px 版心）。 |
| 模型 | Fake Provider 与 OpenAI-compatible Provider（SSE 流式，支持 `reasoning_content` 与 `tool_calls` 增量拼接）；语言、视觉、嵌入三种角色可保存、启停、设默认与连通性测试。目前只有语言模型进入 Agent 执行，另两类仅完成配置层。 |
| Agent | `AsyncIterable<AgentRuntimeEvent>` 事件协议、流式回复、工具卡片、取消、执行历史；按 Expert/TaskContext 裁决 Calculator、Read Text File、Knowledge Search、Artifact/Office 读取、Web Search/Fetch、经营分析和经用户授权的 MCP 工具。 |
| 任务数据 | Workspace、Task、Session、Run、Run Event 均有稳定持久化标识；侧栏按真实 Task 展示近期工作，可按 Task 回看历史 Run 与对应事件。 |
| 本地 Knowledge | 可导入 Markdown、Text、PDF、DOCX（单文件上限 20 MB）；保存源路径和内容哈希，PDF 按页、DOCX 按提取段落建立 SQLite FTS5 索引，命中为空时回退子串匹配；可检索、刷新索引、从资料库索引移除、打开已登记源文件。所有这些操作不得修改或删除用户源文件。 |
| 联网搜索 | 搜索引擎配置（百度千帆 AI 搜索先行，每服务商一行、`enabled` 全局唯一）；仅在存在已启用且配置了 Key 的引擎时注册 `web_search` 工具。见 [ADR-0007](adr/0007-search-engine-config-and-web-search-tool.md)。 |
| Evidence | `knowledge_search`、`web_search`、`web_fetch` 与选定 MCP 工具的结果会在 Run 中去重持久化为 Evidence（`local-file` / `web-page` / `mcp-tool` 共用一张表）；任务侧栏和成果版本可回看，本地来源可打开原始文件，网页与 MCP 来源只读展示。 |
| Artifact | 将任务最终回复保存为版本化 Markdown Artifact；可预览、查看版本历史、从任意版本创建 `user-edit` 修订、导出任意版本为 Markdown。AI 版本关联该 Run 实际 Evidence，人工修订继承前一版本的来源关系。 |
| 通知 | 三层反馈：页面内联反馈 / Toast（同页抑制、右下角、常规 4s 错误 6s、堆叠上限 4、hover 暂停）/ 消息中心（侧栏铃铛 + 下拉面板、SQLite 200 条滚动上限、单条与全部已读、单条删除与清空均需确认）。通知携带可跳转 target，点击复用既有导航入口。窗口失焦且 run 终态时发系统通知，点击聚焦并跳转；run 取消静默。见 [ADR-0006](adr/0006-notification-feedback.md)。 |

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

需要跳过内置 Skill/Expert 注册进行空白态开发验收时，运行 `npm run dev:start:empty`。该开关只对未打包的开发应用生效，不删除数据库已有记录。设置 → 运行中的「启用内置 Skill」与「启用内置专家」可分别控制内置资源；更改后立即自动保存，从列表隐藏对应项并阻止新 Run 使用，后续启动按设置跳过注册。关闭内置 Skill 时，引用内置 Skill 的内置专家也会隐藏并跳过注册。若重新开启但数据库中没有相应记录，重启应用后会按发布清单登记；两项设置默认开启。Skill 工具调用轮数有效输入停止后自动保存，离开输入框时提交；更改只影响新 Run。

为人工验收启动开发应用时，必须在持久终端会话中运行并保持终端打开；可在同一命令后持续查看日志：`npm run dev:start:empty; tail -f /tmp/betterwork-dev.log`。应用进程依附于这个会话；终端或会话关闭，应用也会退出。启动后核对日志和实际窗口：窗口标题应为「算台 BetterWork」，Renderer URL 应为 `localhost:5173/`；Electron 自带的「To run a local app」示例页不算启动成功。不要关闭承载该会话的终端。

分支与验证流程（[ADR-0039](adr/0039-task-branches-and-protected-main.md)、[ADR-0042](adr/0042-pr-quick-check-and-scheduled-verify.md)）：

    # 每个任务从最新 origin/main 创建任务分支；并行写任务使用独立 worktree 与分支
    git fetch origin
    git switch -c codex/short-task-name origin/main
    # 多次提交后，按个人节奏推送任务分支并创建 PR；main 只通过 PR Gate 合并

提交与推送快检：

    # git commit 自动按暂存文件执行 diff、格式、lint 或文档快检；不跑全仓 typecheck
    npm run docs:check # 文档结构、门禁摘要与规则链接的一致性快检
    npm run verify     # lint + format:check + typecheck + test + build + ui:check；用户按需或夜间计划运行
    npm run ui:check   # 组件矩阵 + 成果/知识/专家/记忆生产页面合成关键路径 + 真实 IPC/临时 SQLite 离线应用旅程与进程恢复；边界见 docs/10 §10.1.3
    npm run bench      # 计时基准档（串行）：跑完规模/性能卡或专门核查时执行，不在提交门禁里

日常提交只做暂存范围快检；一次任务可以包含多个提交，普通分支 push 不运行完整 `verify`。代码或混合 PR 的 Actions 执行 lint、format:check、typecheck、docs:check，再以 PR base SHA 执行 Vitest 的相关功能测试与相关重档测试；两档依次运行，重档保持串行。纯 Markdown PR 只跑 `docs:check`。`PR Gate` 是 main 的必需状态，依赖分类和对应快检，独立于 Full verify；通过快门禁不能称为完整验证通过。

pre-push 阻止直推 main，并核对干净 HEAD 与空白差异。PR 合并后，删除已合并的短期分支；Codex 管理的 worktree 归档或移除。有未提交改动或尚未合并的任务时保留 worktree 与分支。

完整验证：GitHub Actions → Verify → Run workflow，选择 main 或任务分支；CLI 可用 `gh workflow run verify.yml --ref <分支名>`。手动运行验证所选分支，PR 快门禁验证合并候选。夜间 `schedule` 每天北京时间 23:30（UTC 15:30）验证默认分支 main 最新提交，工作流合入 main 后生效，调度高峰时可能延迟。AI 按任务做定向检查，不因局部修改、提交、推送或合并自行启动完整 verify。

配置或共享模块变化可能让相关测试选中较多文件；快门禁始终不执行完整构建或 ui:check。夜间/手动失败应读取该 SHA 的日志与产物，在后续任务分支修复。

离线人工走查的前置对象由 AI 准备：`npm run ui:check -- --prepare-acceptance` 在独立目录运行生产 App/Preload/IPC/临时 SQLite，完成既有旅程与前置样本后打开合成窗口；关闭保留库，按输出目录用 `UI_RENDER_OUTPUT_DIR="原输出目录" npm run ui:check -- --reopen-acceptance` 重开。它不启停产品 dev 应用，模型/脚本为离线替身，不代表安装入口或真实模型验收。自动化回归用 `--acceptance-smoke` 验证准备、关闭、新 PID 重开；人类操作与结果仍只记 [MI 原清单](development/memory-mi10-checklist.md)，不代签、不另造任务板。

测试分 functional/heavy/bench 三档：`npm test` 依次跑功能并发与重文件串行（均断言行为），`npm run bench` 跑独立计时基准（断言墙钟与内存预算）。`verify` 包含前两档及 ui:check，不含 bench——并发跑时计时值会漂 1.5–5 倍，随机红的门禁守不住任何东西；阈值没有放宽，样本值每次照旧打印。理由与口径见 [工程规范](12-engineering-standards.md) §1 与 §9。

**不要把 verify 的输出接管道后只看末尾**（`npm run verify | tail` 的退出码是 `tail` 的，永远为 0，会把失败读成成功）。需要截取输出时用 `npm run verify > /tmp/verify.log 2>&1; echo $?`。

车道构成：`npm test` 是功能档（并发）加 heavy 档（串行）两次独立调用，`npm run ui:check` 跑多组真实 Electron 渲染检查，`npm run bench` 独立、不进提交门禁。**规模数字（测试文件数／用例数／护栏条数／渲染检查组数）一律以当次 `npm run verify` 的输出为准，本文不登记快照**——2026-10-02 之前这里、README 与 docs/12 §9 各写着一套互不相符的过期数字，现由护栏「规模计数必须带日期或写明以当次为准」钉住。CI 门禁跑在 macOS runner 上（[ADR-0036](adr/0036-macos-only-platform-scope.md)），不需要 Xvfb。生产构建存在来自 Zod 的 Rollup `@PURE` 注释已知警告，不应因此作无关依赖升级。

`knowledge-vault.test.ts` 的 PDF 与 DOCX 两个用例已显式提高超时——它们首次运行需要现场转换 `pdf-parse` 与 `mammoth`，冷 Vite 缓存下会超过默认的 5 秒。

数据文件位于 Electron `userData` 下：应用状态库 `betterwork.db` 与知识库 `vaults/default/vault.sqlite`，都是本地运行数据，绝不能提交到 Git。两个库的 schema 由 `db/` 下的版本化迁移管理；迁移制度之前建立的历史库会在首次启动时被识别并对账，不会丢数据。模型与搜索的 API Key 明文存于本地 SQLite，列表接口只回 `apiKeyConfigured`；日志和错误消息绝不能输出密钥。如未来引入系统钥匙串（`safeStorage`），须先新增 ADR 并设计迁移。
以下 §4–§7 保留早期架构/质量治理的交接记录，不能直接作为新待办。新增 UI 工作走 docs/10 §10.1；历史问题是否仍存在须回到代码及最新任务板核实。

## 4. 代码地图


| 位置 | 职责与注意事项 |
| --- | --- |
| `packages/agent-protocol/src/index.ts` | 跨进程协议、领域类型、Zod Schema 与 IPC channel 的唯一入口。新增 IPC 必须先在此处定义输入/输出并在边界校验。 |
| `packages/agent-core/src/agent-engine.ts` | `ReActAgentEngine`：单循环 ReAct，工具轮次上限默认 8，取消与失败语义在此收口。核心输出必须保持 `AsyncIterable<AgentRuntimeEvent>`。 |
| `packages/agent-core/src/errors.ts` | 取消与错误描述的**唯一**定义（`abortError` / `isAbortError` / `describeError`）。任何地方都不要再手写 `Object.assign(new Error(...), { name: 'AbortError' })`。 |
| `packages/agent-core/src/fake-provider.ts` | 教学 Provider，不联网、输出可预测。刻意不支持 `web_search` 触发词——联网搜索会发起真实请求，与离线可复现的定位冲突。 |
| `packages/agent-core/src/openai-compatible-provider.ts` | OpenAI 兼容 SSE 解析与 `tool_calls` 增量拼接。改动前先看它同目录的测试。 |
| `packages/tool-runtime/src/` | 确定性工具实现。需要 Application 层资源的工具用「工厂 + 闭包注入」（`createKnowledgeSearchTool`、`createWebSearchTool`），保持本包不依赖 Electron、SQLite 或服务商 SDK。 |
| `apps/desktop/src/main/index.ts` | 只做装配：建窗口、组装依赖、注册 IPC、管理生命周期；启动时收口上次被中断的 Run。**不放业务逻辑**。 |
| `apps/desktop/src/main/window.ts` | 窗口构造、首帧主题常量（必须与青玉浅色 Token 一致，避免冷启动闪白）。 |
| `apps/desktop/src/main/db/` | 连接与 PRAGMA、版本化迁移执行器（`migrate.ts`）、两个库的 schema 与历史库对账。新增 schema 变更只能加迁移，不能改已发布的迁移。 |
| `apps/desktop/src/main/persistence/` | 按聚合拆分的 Repository（workspace / task / run / evidence / artifact / model / search-engine / notification）与组装它们的 `AppStore`。Repository 只写自己的表，可读其他表做归属校验；跨聚合写入由调用方用 `store.transaction()` 显式包起来。 |
| `apps/desktop/src/main/services/run-service.ts` | 运行编排：选 Provider、装配工具、持有启动/取消与活动注册表；`RunEventLifecycle` 集中先持久化再分发与清理/终态，外围 catch 保留并调用恢复入口；终态通知与定时结果等待仍在 RunService。 |
| `apps/desktop/src/main/services/knowledge-vault.ts` | 资料导入、格式解析与分块、FTS5 与子串兜底检索、来源路径验证、刷新与仅索引移除。不碰 DDL。 |
| `apps/desktop/src/main/services/notification-service.ts` | 通知的持久化—广播收口，以及窗口失焦时的系统通知与点击激活。 |
| `apps/desktop/src/main/services/search-engine-service.ts` | 千帆 `web_summary` 客户端与连接测试；外部字段一律经 `readString` 收窄，错误信息不得含 Key。 |
| `apps/desktop/src/main/services/model-connectivity.ts` | 模型连通性探测的纯函数实现（可注入 fetch），含超时与 http/https 协议校验收窄。 |
| `apps/desktop/src/main/ipc/register-ipc.ts` | 全部 channel 注册。三个 helper（`handleInput` / `handleOptionalInput` / `handleNoInput`）是入参校验的唯一通道，handler 不得自行解析 `raw`。 |
| `apps/desktop/src/preload/index.ts` | 最小化、类型化的 Renderer API；所有推送事件过 Zod 后再交给 Renderer。必须维持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。 |
| `apps/desktop/src/renderer/src/App.tsx` | 跨簇编排与布局组装（行数以当次 `wc -l` 为准，本文不登记快照）：工作会话状态、视图切换、通知接线、Sidebar 与错误条。侧栏、消息流与 Composer 三段仍是内联 JSX，外提属 UI 复用评估的 R3。 |
| `apps/desktop/src/renderer/src/views/` | 工作以外的页面级视图：`ArtifactView`、`KnowledgeView`、`MemoryView`、`SkillsView`、`ExpertsView`、`SettingsView`。视图内不出现 IPC 调用。 |
| `apps/desktop/src/renderer/src/components/` | 跨视图复用组件与基座：`ContextPanel`、`Welcome`、`EmptyState`、`ModelEditorSheet`，以及 `Modal`、`PopoverMenu`、`ListRow`、`SectionHeader`、`AsyncButton`／`InlineLoading`、`IconButton`、`ActionBar`、`NavList`／`NavItem`、`Badge`、`Tabs`、`Field`／`FieldSelect`、`layout/` 四件（台账见 docs/10 §10.1）。 |
| `apps/desktop/src/renderer/src/hooks/` | 有状态逻辑按内聚状态簇一个 hook（当前有哪几簇看目录本身，本文不登记数量）。IPC 调用只出现在这一层与 `App.tsx` 的跨簇编排接线——`App.tsx` 不在 docs/12 §8 的标识符判据（`views/`、`components/`）射程内，属登记例外，新增动作仍先落 hook。刷新类回调用 `useCallback` 保持引用稳定，挂载 effect 才能如实声明依赖。 |
| `apps/desktop/src/renderer/src/lib/` | 无状态纯函数与常量：`async-action`（「让用户看见」与「只记录」两类处置的缺省实现，**不是**收口的唯一写法——判据与合法形状清单见 [工程规范 §5](12-engineering-standards.md)）、`tool-summary`、`labels`（含 `TOOL_LABELS`，新增工具必须同步）、`format`、`titlebar`、`view-types`。 |
| `apps/desktop/src/renderer/src/notifications.tsx` | `useNotifications`（初始加载、增量广播、同页抑制、Toast 生命周期）、消息中心面板与 Toast 宿主。 |
| `apps/desktop/src/renderer/src/activity.ts` | 从事件流派生用户可理解的工作阶段分组。 |
| `apps/desktop/src/renderer/src/appearance.ts`、`styles.css` | 主题系统、Token 与全部界面样式。不得新增硬编码色值或局部 `.dark` 补丁；动效时长只能用 Token。 |
| `apps/desktop/src/renderer/src/icons.tsx`、`brand-logo.tsx` | 内联 SVG 描边图标集（`currentColor`、统一 24 网格）与品牌标志。新增图标先进图标集再使用。 |
| `apps/desktop/src/renderer/src/markdown-preview.tsx` | 成果的文档化 Markdown 预览，不渲染原始 HTML。 |
| `standards/coding-standard.test.ts` | 跨文件的规范护栏：配置唯一性、源码零豁免（扫描面含本目录与根级配置）、分层边界、Token 与动效纪律、规则索引完整、首帧主题一致，另钉本地钩子与 `verify` 的覆盖关系、文档指针的有效性、规模计数带日期、交接文档不得与组件台账相互打脸。例外写成文件内的白名单数组并注明理由，不要在源码里加豁免注释。 |
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
2. Renderer 已有 App、视图、组件与 Hook 的 jsdom 行为测试，`ui:check` 另覆盖生产组件/四类页面矩阵、真实 App/Preload/IPC/临时 SQLite 离线旅程和独立进程强杀恢复，具体命中与未覆盖项见 [UI/UX §10.1.3](10-ui-ux-system.md#1013-组合约束与检查边界)。这些证据不代表所有真实桌面路径、真实模型语义、屏幕阅读器或安装验收通过，人工尾项仍查原任务板。
3. GitHub Actions 在 **macOS runner** 上对目标为 `main` 的 Pull Request 按变更范围执行快门禁：代码或混合差异跑静态检查、文档护栏和相关测试，纯 Markdown 跑 `npm run docs:check`，两档结果聚合为 main 必需状态 `PR Gate`（[ADR-0036](adr/0036-macos-only-platform-scope.md)、[ADR-0039](adr/0039-task-branches-and-protected-main.md)、[ADR-0042](adr/0042-pr-quick-check-and-scheduled-verify.md)；平台范围只有 macOS，Windows 不在支持范围）。macOS 基础打包验证仍未达成；真实桌面 UI 自动化应在该专项中接入。完整 verify 只接 `workflow_dispatch` 和夜间 `schedule`，独立于 PR Gate。工作流按事件类型与 PR/ref 开 `concurrency`，PR 只保留最新运行；完整验证随失败上传截图与读数，随成功只上传 `.ui-render/results.json`（留 7 天），由护栏「远端门禁跑在受支持的平台、能手动触发、并且留下绿跑读数」钉住。

**界面**

4. `App.tsx` 仍是全仓最大的视图文件（R3-B 外提 `MessageBlock`／`Composer` 后降过一截；行数不在本文登记，以当次 `wc -l` 为准），AppShell 与 Sidebar 未拆出（此前写的「约 720 行」是 2026-09-26 之前的状态，功能三轮之后已不成立）。工作会话状态刻意留在 App（它同时牵动任务列表、上下文面板、成果列表与通知跳转），但 Sidebar、消息流与 Composer 三段是纯 JSX，可以继续外提。
5. Confirmation Dialog 已落地，但尚未覆盖所有未来的破坏性操作；新增此类操作必须复用组件并补键盘行为测试。
6. 部分低频次级按钮的点击区域小于 32px（Composer 工作区行的文字按钮、上下文页签、模型行内动作、通知面板动作、证据「原文」按钮）。达标方式是扩大命中区，不是放大视觉尺寸。
7. Skeleton 与百分比进度条未落地（Progress 只有一枚不确定态 spinner `.spinner`）；除 `⌘/Ctrl ↵` 外没有其他快捷键。Tooltip 与 Switch 已落地，契约见 docs/10 §10.1 台账——本条此前把两者一并列为缺失，2026-10-02 由护栏「交接与规则文档不得宣称台账组件尚未落地」钉住这类反向陈述。
8. docs/10 §13 UI-5 要求的三尺寸 × 3 模式 × 4 色系验收矩阵仍未建立；本轮字号与动效收敛后需要重新做一轮人工验收。
9. 窄屏（`max-width: 960px`）是**强制**图标栏，不读取用户的折叠偏好；覆盖式右栏没有点击外部关闭的背板。
10. 上下文面板展开状态未按 Task 记忆（侧栏折叠状态已持久化）。
11. 外观持久化值损坏时静默回落到默认外观，未按 docs/10 §9.5 向用户说明原因。

**产品缺口（属规划，不是缺陷）**

12. 视觉与嵌入模型可配置但未进入执行链路；一个 ModelProfile 只能担任一个角色。
13. Evidence 已按版本关联，但没有正文 Claim/Citation 系统——Phase 1 验收项 3，需先立 ADR。
14. 大纲确认（Phase 1 验收项 4）阻塞在协议层：`approval.requested` / `approval.resolved` / `run.waiting` 事件尚未定义，事件 Schema 也没有版本号字段。
15. Run 历史与 Session 标识已持久化，但执行链路尚未把历史作为模型上下文传入，不构成记忆系统。
16. 2026-10-04 已采用「合页」标志（`docs/assets/betterwork-logo.svg`，透明背景），macOS 打包图标 PNG/ICNS 已落地于 `apps/desktop/build/` 并由 `electron-builder.yml` 引用；签名与安装态 Dock 显示仍随打包验收核对。

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

每次开始先执行 `git status --short`。工作树并不一定总是干净；既有改动属于用户，不能删除、覆盖或夹带进无关提交。每个任务使用自己的分支；并行写任务使用独立 worktree 和分支，不共享编辑目录或 Git 暂存区。单个 checkout 同一时刻只允许一个写任务。提交前核对 `git status` 与 `git diff`，追加共享文档（如 `docs/logs/` 当天日志）前先重读文件末尾。每个提交保持聚焦，必要的测试、文档和 ADR 与实现放在同一变更中；PR 快门禁由 PR Gate 收口，完整 verify 按用户按需/夜间计划运行。PR 合并后清理已合并分支并归档/移除 worktree；未提交或未合并内容必须保留。

禁止提交 `.env`、API Key、数据库、构建产物、用户资料或本地工作文件。遇到产品范围、数据迁移策略或安全边界不明确时，先停在文档/ADR 层澄清，不要把猜测固化为实现。

每完成一次对话任务，当天写一篇 `docs/logs/YYYY-MM-DD.md`（当天已有则追加一节），模板见 [logs/README.md](logs/README.md)。
