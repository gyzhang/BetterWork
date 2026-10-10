# 工程规范

本文是算台 BetterWork 的**唯一**代码规范。全仓只有一套标准：不允许某个目录、某个文件或某位贡献者另行约定。

规范面向 AI 实现与 Review，机器检查负责执行可自动判断的部分：`eslint.config.mjs` 与 `.prettierrc.json` 是本文的可执行形式，`npm run verify` 是完整验证入口，PR 的必需快门禁为 `PR Gate`。本文定义规则与适用理由，配置和护栏落实可检查的不变量。机器检查的覆盖边界见 UI/UX §10.1.3；文档与实现冲突时回到本文和已接受的设计/ADR 核对，同轮修正错误一侧，不能把门禁通过当作偏离规范的授权。

相关文档：架构边界见 [系统架构](03-system-architecture.md)，界面规范见 [UI/UX 体系](10-ui-ux-system.md)，当前实现基线与已知缺陷见 [Qoder 开发交接](11-qoder-handoff.md)。

## 1. 工具链与命令

| 命令 | 作用 |
| --- | --- |
| `npm run lint` | ESLint（含类型感知规则） |
| `npm run lint:fix` | 自动修复可修复项（导入顺序、类型导入等） |
| `npm run format` | Prettier 写入 |
| `npm run format:check` | Prettier 校验 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest **功能档并发 → 重档串行**两次独立调用（`--project functional`，然后 `--project heavy`），断言行为是否正确；重档收录单文件墙钟 ≥20s 的文件，判据见 §9 |
| `npm run bench` | Vitest **计时基准档**（`--project bench`）：串行跑 `*.bench.test.ts`，断言墙钟与内存预算 |
| `npm run ui:check` | 独立 Electron 宿主：全部正式色系明暗 × 760/1380px 的组件矩阵，加成果/知识/专家/设置内记忆分区的生产页面关键路径（青玉明暗、两档宿主宽度、普通/减动效）、一条真实 App/Preload/IPC/临时 SQLite 离线旅程与独立进程强杀恢复（青玉深色、1380px）；截图/读数放临时目录，边界见 docs/10 §10.1.3 |
| `npm run verify` | lint + format:check + typecheck + test + build + ui:check，任一失败即中止 |

提交由 `.husky/pre-commit` 按**暂存文件**做快检：所有改动跑 `git diff --cached --check`；暂存代码文件跑对应 ESLint / Prettier；含 Markdown 时跑 `npm run docs:check`。每次提交不跑全仓 typecheck、测试、构建或 UI 检查；`.md` 按本文 §1 的格式范围不经 Prettier。

`.husky/pre-push` 拒绝直接推送 `main`，并核对待推送对象等于当前干净 `HEAD`、差异没有空白错误；它不运行全仓验证。普通任务分支可按个人节奏积累多次提交后再推送，pre-push 不会因代码提交重复执行完整门禁。

`docs:check` 运行结构与文档一致性护栏，不是完整 `verify` 的替代品。PR 是进入 `main` 的唯一入口（[ADR-0039](adr/0039-task-branches-and-protected-main.md)）；验证范围按 [ADR-0042](adr/0042-pr-quick-check-and-scheduled-verify.md)：代码或混合差异由 GitHub Actions 对 PR 合并候选执行 lint、format:check、typecheck、docs:check，再以 PR base SHA 执行 Vitest 相关功能测试与相关重档测试；两档依次运行，重档保持串行。纯 Markdown 差异只执行 `npm run docs:check`。分类前检查差异空白，两种路径都汇总到稳定的必需状态 `PR Gate`。PR Gate 不依赖 Full verify；快门禁通过只能报告对应范围通过。

完整 `npm run verify` 只由用户按需触发或夜间计划运行，AI 不因局部修改、提交、推送或合并自行启动完整验证。`workflow_dispatch` 对所选分支运行完整 verify；`schedule` 每天北京时间 23:30（UTC 15:30）检查默认分支 main 最新提交并留存渲染读数，调度可能延迟。相关测试按依赖图选择，配置或共享模块变化可能选中较多测试，动态文件读取可能未被选择；完整验证负责整体集成回归。夜间/手动结果不阻止已经完成的合并，失败需后续任务分支修复。

护栏「提交与推送门禁纪律 › 本地钩子按暂存范围快检并阻止直推 main」与「远端门禁跑在受支持的平台、能手动触发、并且留下绿跑读数」分别锁定本地和远端形状。

远端那一层也有机器核对：护栏「远端门禁跑在受支持的平台、能手动触发、并且留下绿跑读数」逐样点名——`runs-on` 必须是 macOS（ADR-0036：跑在别的平台上测的是不兼容的靶子，`ui:check` 还会在 Ubuntu 的 userns 限制下崩成 SIGTRAP）、必须留 `workflow_dispatch` 和夜间 `schedule`，必须在手动/夜间任务整条跑 `npm run verify`（不许把完整验证改成只跑某几步），并且必须有一步随**成功**上传 `.ui-render/results.json`：产物只在失败时上传的话，连着两次绿跑之间什么都没留下，「门禁绿了」于是重新变成一句没有读数的话。同一条判据还拦「删掉 `if: success()` 那一步」，所以留存不是一次性配置，是钉住的形状。
文档引用一条结构判据时有固定写法：写成紧邻的 `护栏「X」`／`护栏：「X」`，X 是 `standards/coding-standard.test.ts` 里 `it()` 的标题；同名判据分散在不同块里时写 `describe › it` 的完整路径。判据改名必须同轮把引用一起改掉——护栏「文档点名的护栏必须是一条真实存在的判据」把这句话变成机器可读的。2026-10-02 一次判据改名就让 `betterwork-code-style.md` 指着一台不存在的闸，另外两处引用漏抄了标题后半截：判据在、名字对不上，下一个人仍然无法确定自己找到的是不是同一条。之所以只认紧邻形状：中文正文里大量用「」引用界面文案与术语，放宽到「同一行出现过护栏」会判红 300 多处无关引号，过宽到没人能修的判据等于没有判据。
规范的执行包括三层门禁与一层周期巡检：

| 层 | 载体 | 管住什么 |
| --- | --- | --- |
| 单文件写法 | `eslint.config.mjs`、`.prettierrc.json` | 一个文件内部的类型、异步、命名与排版 |
| 跨文件结构 | `standards/coding-standard.test.ts` | 配置唯一性、零豁免、分层边界、协议常量被消费、Token 与动效纪律 |
| 验证 | PR 快门禁 / 完整 `npm run verify` | PR 检查静态约束与相关测试；完整验证加全部测试、构建与 UI 检查 |
| 周期巡检 | `npm run drift:check` | 护栏看不见的三类漂移：仓库外部的状态、跨时间的读数变化、制度有没有真的被执行 |

**第四层是周期巡检，不在门禁里**：开始治理审计前、每完成一个批次后、同类问题第二次出现时跑 `npm run drift:check`。它比较本机钩子启用状态、超过三天的未推送提交、按日/批次日志与跨时间规范读数；具体判据、留档及边界统一见 §1.1。检查依赖 Git 历史与本机配置，同一代码在不同克隆的结论可以不同，因此不塞进 verify。脚本、CLI 回归、读数基线、npm 入口和本段由护栏「治理巡检装在工具链里，但不进提交门禁」关联；规则判据变更需同时检查反例，不以新基线掩盖失败。

结构护栏随 `npm test` 执行，因此也在 `verify` 里。它断言的都是 ESLint 表达不了的约定：ESLint / Prettier / tsconfig 各只有一份且严格开关全开、源码里没有任何豁免注释、`packages/*` 不依赖 `apps/*`、Agent Core 不依赖宿主运行时、Renderer 不导入 `node:*`、`views/` 与 `components/` 不直接调 IPC、`ipcMain.handle` 只在一处、取消词汇只在一处、硬编码色值与写死的动效时长只出现在白名单里、样式表引用的每个 Token 都有定义、首帧窗口主题与青玉浅色 Token 一致、`.qoder/rules/` 下每个规则文件都登记在索引里、界面间距与控件几何取档位、计时断言不出现在功能档里、本地钩子按暂存范围快检并阻止直推 main、每个任务使用独立分支且并行写任务使用独立 worktree、规则与规范文档里的路径指针真实存在、规模计数必须带日期或写明以当次为准、交接与规则文档不得对组件台账里的东西给出相反结论、文档里点名的护栏必须能在本文件里找到同名判据、规则文件带着可识别的触发元数据、仓库文本里没有替换字符与编码重读产物、远端门禁的平台与触发形状和绿跑读数留存也一并点名。

### 1.1 AI+Human 执行与证据

人类负责需求、方案判定和最终人工验收；Codex/Qoder 负责已授权范围内的设计、实现、测试、Review 和交接。每个任务都从最新 `main` 派生自己的短期分支，并通过 Pull Request 合并；GitHub `main` 已启用分支保护，必需检查为 `PR Gate`，当前不要求审批数（[ADR-0039](adr/0039-task-branches-and-protected-main.md)）。顺序任务可在一个 checkout 中依次切换分支；并行写任务各用独立 worktree 与分支。一个 checkout 与暂存区同一时刻只允许一个写任务，不共享编辑目录或暂存区。已授权的普通实现步骤持续推进；产品范围、关键技术选择或安全边界的未决事项先准备具体方案，再交人类判定。真实模型调用、提交、推送和发布继续分别核对已有授权，不由测试通过推导新授权。

任务开始核对工作树、相关任务板与 AGENTS 的必读路由；修改契约先更新唯一规范/ADR，不从历史报告复制现行数字。Codex 不自动套用 Qoder frontmatter：跨工具共同执行的纪律必须在 AGENTS 或其必读入口能找到，Qoder 场景规则只补阅读路由。

Qoder 的文件规则采用本机 IDE 编辑入口实际保存并识别的 frontmatter；多个通配符按 [IDE 官方说明](https://docs.qoder.com/zh/user-guide/rules)用英文逗号分隔，每一项都是完整模式，不能用 `**/*.ts,tsx,css` 表示多个扩展名。CLI 文档接受的 YAML 列表不能直接推导为 IDE 可用。元数据与正反例测试检查仓内格式和代表文件匹配；实际 IDE 规则页还必须无“未启用”提示、编辑入口必须展示完整范围。设置页识别不证明模型会话已注入正文；更新规则或工具后，AI 另在新会话核对实际上下文，未取得该证据时如实交接。

AI 交接按“已实现／自动化通过／AI 页面走查／待人工验收”分别描述，附改动范围、失败/取消证据、命令退出码、代码版本和未验证项；任务板的 done 判据仍以原卡为准，不新增一套状态。UI 证据按 docs/10 §10.1.1/§10.1.3，最终人类验收不能替代 AI 本轮应完成的测试与走查。提交阶段按暂存范围快检；代码或混合改动由 PR 上的代码快门禁收口，纯 Markdown PR 只执行 `docs:check`；完整 verify 由用户按需或夜间计划运行，分别报告目标 SHA 与覆盖范围。

完整 `npm run verify` 不按提交、普通分支 push 或 PR 更新自动运行。pre-push 检查推送引用，拒绝 `main` 目标，并要求新增对象解析到当前干净 `HEAD`；它对新分支以 `origin/main` 为基点、对已有远端分支以远端对象为基点执行差异空白检查。钩子的行为回归在 `scripts/pre-push.test.ts` 的独立 Git 夹具中运行，不执行真实推送、不碰产品数据。代码/混合 PR 的快门禁与纯 Markdown PR 的文档门禁由 `.github/workflows/verify.yml` 分类执行，聚合至 `PR Gate`。护栏「提交与推送门禁纪律 › 本地钩子按暂存范围快检并阻止直推 main」和「任务分支隔离并要求并行写任务使用独立 worktree」锁定本地规则对应关系。

PR 更新后，AI 用 `gh run list`/`gh run view` 核对该 PR 最新 SHA 的 Actions 结论，失败时读取失败步骤与产物，在任务分支修复并更新 PR。旧 SHA 的成功不等于本次成功；首发失败后手动绿跑须记录差异与根因，不能仅以重跑关闭问题。workflow 接目标为 `main` 的 PR、手动完整验证与夜间 schedule，不接 push 事件。PR 快门禁、人工验证与完整 verify 分别报告，未经 PR Gate 的本地代码状态不能称为 PR 门禁通过。完整验证失败同样读取该 SHA 的步骤与产物，在后续任务分支修复；不得用旧绿灯或无归因的重跑掩盖失败。

巡检由 AI 归因、修复和留证，人类只判定需要改变产品/技术边界的取舍。批次开始记录 `git rev-parse HEAD`；交接时用 `npm run drift:check -- --batch-base=<起点SHA>`，提交后仍用同一起点 SHA，不能以已更新的 origin/main 作为本批次基点。检查与留档有以下边界：

- **规则文本变化**：基线记录完整 ESLint 配置，以及结构护栏中带 reason 的变量清单和名称含 exception/exempt/allowlist/whitelist/outlet/owners 的出口清单的 AST 指纹。格式/注释不影响指纹；清单范围、理由、正则字面值、规则强度变化均给出具体清单与前后指纹，数量不变也判红。新增/删除/收紧同样要求 Review。它是变化信号，不自动判定语义等价或批准例外；未登记的动态规则、变量改名与间接依赖仍需看 Git 差异。修改这类规则时同时核对 docs/12、配置、护栏和违规反例。
- **日志**：默认只查窗口内有提交的日期是否有文件；指定 batch-base 后，还查基点至当前工作树的日志新增文本（含未跟踪的新日志），必须有一个新增任务小节及非空背景/变更内容/测试证据。同一天的旧文件不能替当前交接；结构检查仍不能判断证据真假或自动把每个改动映射到任务。
- **钩子**：检查 hooksPath 和已安装 wrapper，再让 Git 临时调用其副本的无副作用标记钩子，照常加载本机 Husky init.sh。能发现 HUSKY=0、缺入口或失效 wrapper；不修改实际安装入口、不提交、不推送、不跑 npm。这个探针只证明本次入口启用，不证明过去每次提交没有绕过；实际 commit/push 的退出码、verify 与对应 SHA 的 CI 仍要留证。
- **留档**：非规则发现未处理时，`--save` 拒绝写文件。例外变化或旧基线缺指纹时，AI 先 Review 具体差异，追加本批次日志，再带 `--batch-base=<起点SHA> --review-reason='具体理由' --save` 留档，理由随基线保存。该次命令仍返回 1 并保留发现，随后再跑一次巡检，确认与经 Review 的新基线一致。无规则变化时正常留读数无需重复理由；损坏的基线不能当成空基线。
- **规模**：文件数含 bench，用例数粗读 it 声明、不展开参数化用例，不是实际运行结果。护栏短标题与完整路径只计同一判据一次；点名覆盖只表示专名引用，不表示未点名规则无人知晓。性能相关任务另跑对应 bench，不能从 verify 推导性能已验。

新会话规则演练分别记录「工具能识别」「可观察的加载/检索记录」「实际遵循行为」。交接只列执行过的阅读命令/工具结果、版本、范围、改动和验证退出码；工具不提供的原始注入记录标未验，不依据模型自述判通过。沙箱或权限导致的门禁失败保留原退出码，外层 Review 与完整门禁独立收口；不把定向测试当全仓通过，也不把 CLI 的证据外推到桌面工具。

页面与 UI 状态的回归优先扩展现有 ui:check；组件/页面矩阵使用合成数据或最小 IPC 替身，应用旅程使用真实 App/Preload/IPC/Application 与临时 SQLite、确定性请求替身，明确命中路径与未覆盖项；不新建一套视觉规范或把合成宿主称为完整产品验收。

应用旅程定向排查可用 `npm run ui:check -- --app-only`，进程恢复定向排查用 `--recovery-only`；只跑对应旅程并留下独立结果，不能当作完整 `ui:check` 或 `verify` 通过。完整门禁默认始终执行全部矩阵、应用旅程与进程恢复。进程恢复只强杀 AI 创建的离线测试进程组；运行挂起后的落库标记就绪才能执行，禁止对用户正在使用的应用或库做强杀实验。

格式化范围：所有 `.ts` / `.tsx` / `.css` / `.html` / `.json`。Markdown 与 `docs/assets/` 下的品牌 SVG **不格式化**——中文长行经重排后无法逐字回读校验，标志文件是人工定稿资产。

## 2. 目录结构

```text
apps/desktop/src/
├── main/
│   ├── index.ts          # 只做装配：建窗口、组装依赖、注册 IPC、管理生命周期
│   ├── window.ts         # 窗口构造与首帧主题常量
│   ├── db/               # 连接、PRAGMA、版本化迁移与各库的 schema
│   ├── persistence/      # Repository（按聚合拆分）与 AppStore
│   ├── services/         # 编排与外部系统适配（运行、通知、资料库、搜索、连通性探测）
│   ├── infrastructure/   # 宿主之外的运行时适配：进程 supervisor、guardian 脚本与其合成 fixture
│   └── ipc/              # 全部 channel 注册与边界校验
├── preload/index.ts      # 最小类型化 API，推送事件一律过 Zod
└── renderer/src/
    ├── main.tsx          # 挂载入口
    ├── App.tsx           # 跨簇编排与布局组装
    ├── views/            # 普通页面及设置内嵌分区，按内聚职责划分
    ├── components/       # 布局、反馈与稳定领域呈现组件
    ├── hooks/            # 有状态逻辑，一个内聚状态簇一个 hook
    ├── lib/              # 无状态纯函数与常量（可单测，不含 JSX）
    └── *.ts / *.tsx      # 领域派生逻辑（activity、appearance、icons 等）

packages/
├── agent-protocol/       # 跨进程协议、领域类型、Zod Schema、IPC channel 的唯一入口
├── agent-core/           # Agent Loop、Provider 接口与统一错误词汇
└── tool-runtime/         # 确定性工具实现

standards/
├── coding-standard.test.ts  # 跨文件结构与文档一致性，随 npm test 执行
├── ui-governance.ts         # UI 结构检测器
└── ui-governance.test.ts    # 合法与违规变异的检测器回归
```

放置规则：

- **有状态**逻辑进 `hooks/`，**无状态**逻辑进 `lib/`。判据是「是否持有 React 状态」，不是「文件长短」。
- 页面专属视图留在 `views/`；跨视图布局/反馈组件，以及有明确数据-动作边界的稳定领域呈现组件进入 `components/`。不要为「以后可能复用」提前抽象数据加载或 CRUD 控制器。
- `services/` 可以依赖 `persistence/`，反向不行；两者都可以依赖 `packages/*`，`packages/*` 不得依赖 `apps/*`。
- 需要 Application 层资源的 Tool 用「工厂 + 闭包注入」（`createKnowledgeSearchTool`），使 `tool-runtime` 不依赖 Electron、SQLite 或服务商 SDK。
- `infrastructure/` 放「主进程之外还要再跑一个进程」的适配。`skill-guardian.ts` 是**独立构建入口**（见 `apps/desktop/electron.vite.config.ts` 的 `main.build.rollupOptions.input`），必须自包含：只用 `node:` 内置模块与 `import type`，不导入仓库内其他运行时模块。开发/打包态由 Electron 以 `ELECTRON_RUN_AS_NODE=1` 执行构建产物，测试态由 Node 直接执行同一份 TS 源文件（Node ≥ 22.18 原生剥离类型），两条路径共用一份源码，不出现第二套实现。
- `infrastructure/fixtures/` 是合成进程替身，只在测试里被 `spawn`，不被任何构建入口 import；它们同样是受本规范约束的 TypeScript，不引入第三方脚本或本机运行制品。

## 3. 命名与导出

- 文件：`kebab-case.ts`；测试与实现同目录同名，后缀 `.test.ts`。
- 组件与 hook 文件按其导出命名：`ContextPanel.tsx` 导出 `ContextPanel`，`use-appearance.ts` 导出 `useAppearance`。
- 类型（interface / type / class / enum）一律 `PascalCase`；变量与函数 `camelCase`；模块级常量 `camelCase`（由 ESLint `naming-convention` 只约束类型，常量沿用现有风格）。
- 组件与 hook 用 `export function`；对象字面量形式的配置与工具（如 `calculatorTool`、`colorSchemes`）用 `export const`。
- 导出的函数必须有显式返回类型（`explicit-module-boundary-types`）。内部函数不强制。
- 导入顺序由 `simple-import-sort` 决定：副作用导入 → Node 内置 → 外部包 → 绝对路径 → 相对路径。不要手工调整。
- 类型导入必须写成 `import type`（`consistent-type-imports`）；类型与值同源时用内联形式 `import { abortError, type AgentTool }`。

## 4. 类型纪律

`tsconfig.json` 开启 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`useUnknownInCatchVariables`。这四条塑造了本仓大量写法，不要为了少写几行而关掉：

- `noUncheckedIndexedAccess`：下标访问得到 `T | undefined`。取首元素用 `list.at(-1)` / `list[0]` 后判空，**不要用 `!`**。
- `exactOptionalPropertyTypes`：可选属性不能显式赋 `undefined`。构造对象时用条件展开：`...(value ? { key: value } : {})`。这是本仓最常见的惯用法。
- `useUnknownInCatchVariables`：`catch (error)` 里 `error` 是 `unknown`。统一用 `describeError(error)` 转文本，不要 `String(error)` 散落各处。
- 禁止 `any`（生产代码）与 `!` 非空断言。数据库行一律先声明 `interface XxxRow` 再 `as` 到该类型，不要 `Record<string, unknown>` 加 `String()` 逐字段转换——那会让 `no-base-to-string` 报警，也容易把 `[object Object]` 写进用户数据。
- 可选属性优先于 `null`；数据库列的 `NULL` 在映射层转成「省略该属性」。
- `allowImportingTsExtensions` 仅为独立 Worker 入口开启：`knowledge-worker.ts` 需要被 Node 原生类型剥离直接执行（同 skill-guardian 的「测试跑 TS 源、打包跑构建 JS」双入口），原生 ESM 解析要求相对导入带 `.ts` 后缀；除该入口链外不要新增 `.ts` 后缀导入。

## 5. 异步与错误处理

这是本仓最重要的一条纪律，因为它直接决定用户能否看见失败。

**主进程**

- `RunService.consume` 必须有 `catch`：引擎自身会收口失败与取消，但编排层在进入事件循环之前（读模型配置、构造搜索客户端）或在写库、广播过程中抛错时，引擎不会产出任何终态事件。当前 catch 调用 Application 内的 `RunEventLifecycle.recover`，兜底仍靠 `RunRepository.forceFailure`，它只在 Run 仍为 `running` 时合成 `run.failed`，因此重复调用安全，也不会与引擎的终态冲突。
- 不变量：**每个 Run 都必须有明确终态**。启动时 `failInterruptedRuns` 会把上次进程被强杀留下的 `running` 收口为 `failed`。
- 启动失败要 `console.error` 后退出，不能静默留在半初始化状态。

**Renderer**

到主进程的每一次调用都必须**收口**。收口指的是「失败必须到达一个真实存在的呈现出口」，**不是「必须字面调用某个函数」**——`lib/async-action.ts` 的两个 helper 是两类处置的缺省实现，不是唯一写法：

| 处置 | 何时用 | 失败去向 | 缺省实现 |
| --- | --- | --- | --- |
| 让用户看见 | 用户主动发起、且失败后用户能采取行动 | 调用方指定的可见出口（内联错误条、表单错误、局部浮层） | `reportAction(promise, onError, fallback)` |
| 只记录 | 后台同步，或调用链上已有另一层负责呈现 | `console.error`，带 label 便于定位 | `trackAction(promise, label)` |

**手写 `try/catch` 与 helper 属同一类处置，不算第三种**：`reportAction` 只有 `onError` 一个出口，表达不了「成功也要播报一句」，需要时就手写 `try { await …; showToast('success', …) } catch (error) { setError(describeActionError(error, …)) }`，把失败交给同一个呈现出口即可。`hooks/use-knowledge-library.ts` 的 22 处是这一形状。

**另两种形状也不算违规**：hook 直接 `return window.betterwork.x(…)` 把 promise 交回调用方——收口发生在调用链上最先能承载这条消息的那一层（`hooks/use-experts.ts` 的 `get`／`create`／`saveRevision`／`copy`／`setLifecycle`／`remove` 六处）；以及 `await` 写在一个由上层 `try/catch` 包裹的 async 函数里。

真正不存在的是第三种**处置**——「不处理」：`void someIpcCall()`（ESLint 的 `no-floating-promises` 已设为 `ignoreVoid: false`，正是为了让这种写法无法通过）、空 `catch {}`、以及不写降级理由的 `.catch(() => undefined)`。**降级本身是合法的**（「设置读取失败保持旧值；下一次动作仍会在错误里可解释」），但理由必须写在 catch 体里，护栏按此断言。

2026-09-30 实测口径：`hooks/` 里 100 个 `window.betterwork` 调用点，41 处字面走 helper，其余 59 处分布在上面三种形状里，**没有一处失败被静默吞掉**。此前的字面（「只有两种方式」）会被读成「只有这两个函数」，与 59% 的合法现实不符，据此改准。

列表刷新函数（`refreshX`）统一为「返回 `void`、永不 reject」，因此调用点不需要也不应该 `await` 它们。

会因选择对象变化而重新发起的 Renderer 请求（例如切换 Run、Artifact 或版本）必须有请求代号或等价的过期响应保护。旧请求返回后不得覆盖当前选择；事件快照还要与加载期间收到的增量按稳定事件标识合并。

**错误词汇**

取消语义只有一处定义：`packages/agent-core/src/errors.ts` 的 `abortError()` / `isAbortError()` / `describeError()`。任何地方都不允许再写 `Object.assign(new Error('Run cancelled'), { name: 'AbortError' })`——写错名字会让取消被当成失败上报。

重新抛出的错误必须带 `cause`（ESLint 核心规则 `preserve-caught-error`）。

## 6. 持久化与迁移

- SQLite 是产品状态真相源；缓存、索引、预览必须可重建。
- 每个库的 schema 演进走 `db/` 里的**版本化迁移**，不允许在启动代码里用 `PRAGMA table_info` 探测后 `ALTER`。
- 迁移约定：
  - `version` 从 1 开始连续递增且唯一，`migrate()` 启动时校验，写错会直接抛错而不是静默跳版本。
  - v1 固定为「迁移制度引入之前」的形状；历史库由 `detectLegacy` 识别、`reconcileLegacy` 对账到 v1、打版本戳，然后正常走 v2 及以后。这样历史库不会漏掉任何后续迁移。
  - 每条迁移是一个原子事务，失败整体回滚且不打版本戳，下次启动从失败那条重来。迁移打戳后、提交前必须执行 `PRAGMA foreign_key_check`；它能读取同一事务内的变更，发现违反项就回滚，避免外键重新开启后遗留孤儿行。
  - SQLite 无法用 `ALTER` 增删外键，补外键一律走 `rebuildTable`：事务外关外键、建新表、拷数据、删旧表、改名、补回索引。
  - **悬空引用仍由调用方在重建前清理**。清理顺序必须按实际引用关系安排——删父表孤儿可能产生新的子表孤儿（见 `app-schema.ts` 的 `addForeignKeys`）；最终以事务内完整性检查作为提交门槛。
  - 新增迁移必须同时补 `db/migrate.test.ts` 里的对应用例（新库、历史库、幂等、失败回滚、完整性检查）。
- `PRAGMA foreign_keys` 常开。写测试时要建真实的父级行，不能塞伪造 id。
- Repository 只写自己的聚合表，但可以读其他表做存在性与归属校验；跨聚合写入由调用方用 `store.transaction()` 显式包起来。Repository 之间不互相持有引用。
- 密钥（模型与搜索的 API Key）明文存于本地 SQLite，**只**在主进程内部流转；对外接口一律只回 `apiKeyConfigured`。日志、错误信息、测试输出绝不出现 Key。

## 7. IPC

- channel、输入、输出全部在 `packages/agent-protocol` 定义；`IpcChannel` 是 channel 名的唯一来源。
- 通用 handler 必须经 `ipc/register-ipc.ts` 的三个注册 helper 之一：`handleInput`（必填入参）、`handleOptionalInput`（入参可整体省略）、`handleNoInput`（入参必须为空）。三者都在边界上用共享协议的 Zod Schema 校验输入与输出，不允许 handler 自行解析 `raw` 或绕过响应校验。
- 定时的 `handleScheduleInput` 是专用边界，额外保留有界领域错误与 success/rejected 包装。带入参的三个 helper 向 handler 提供请求 Schema 的 `z.output`，无入参 helper 继续提供 `IpcMainInvokeEvent`。四个 helper 的 handler 返回响应（定时为 data）Schema 的 `z.input` 或其 Promise；Schema 参数决定类型，回调不得放宽推导。响应默认值与转换仍由运行期 `.parse()` 完成，编译期关联不替代边界校验。
- 推送给 Renderer 的事件在 preload 侧过 Zod 后再交给监听者。
- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 不可放松。
- 需要用户文件访问的能力，白名单校验必须在主进程完成（例如「打开原文」先查知识库登记记录，再交给 `shell.openPath`）。
- 会发起网络请求的用户输入必须收窄协议（`resolveEndpoint` 只接受 http/https），Zod 的 `url()` 会放过 `file://`。
- 外部 HTTP 调用一律带超时（`AbortSignal.timeout`），并保证错误信息不含凭据。
- 共享协议导出的阈值常量（分页大小、code point 上限、权重与停用词表等）是唯一真相源：消费方 `import` 常量，不在实现里另写字面量。协议内被 Schema 或别的常量引用、或被生产源码引用之外，任何 `export const UPPER_SNAKE` 都算孤儿，由 `coding-standard.test.ts`「协议导出的阈值常量都有真实消费者」拦下。半覆盖的形态（常量在协议内已被 Schema 消费、实现却仍写死一份）护栏读不出来，只能按契约逐处核对。

## 8. Renderer

分层：`views/` 负责页面组合，`components/` 负责布局、反馈和领域呈现，`hooks/` 持有状态与动作，`lib/` 是纯函数。**视图组件里不应出现 IPC 调用**，它们从 hook 拿到已经包装好的动作；落到标识符上就是 `views/` 与 `components/` 里不出现 `window.betterwork`，护栏按此断言。**这条判据的射程只到这两个目录**：跨簇编排的 `App.tsx` 既不在 `views/` 也不在 `components/`，它到主进程的接线属登记在案的例外（护栏不数它，也不该数它）；新增一次动作仍然先落 hook，只有确实属于跨簇编排的接线才留在 `App.tsx`。列表页优先复用 `components/layout/` 的页头、工具栏、滚动区和视图容器，不在每个页面重新发明滚动边界。

**组件基座纪律不在本文复述**：按钮、卡片、列表行、区块头、导航、表单字段、页签、徽标、空态、模态、浮层菜单、折叠披露、图标按钮、动作条、busy 按钮、开关、文本提示、消息块与输入区等「一律用哪个基座、哪几档、护栏锁什么」，唯一真相源是 [UI/UX 体系 §10.1 组件台账](10-ui-ux-system.md)。写 UI 前先查台账，缺基座时先补基座再接页面，不得就地自造同类控件。

帮助正文使用现有 `MarkdownPreview` 的 `guide` 变体：文档排版仍归该组件，只移除成果卡片外壳，版心与滚动仍归页面骨架。其精确选择器在表面所有者清单登记，不扩大页面级卡片或标题外观的豁免；静态手册资源由构建导入，不通过 Renderer 文件系统访问。

页面检查、Review 与创建先执行 UI/UX §10.1.1 的同一流程；台账由真实组件导出双向核验。新增页面检查实际 JSX 返回分支和组件使用关系，支持命名导入别名与合法包装，不把未使用 import、可选 JSX 子树或回调里的 JSX 当成复用证据。内嵌列表的首读/空集合替代出口按精确形态逐分支核验。跨文件护栏同时检查新命名 CSS 表面的所有者、页面额外版心与逐主题 Token 契约；检测器及违规变异用例放在 `standards/`，由 `coding-standard.test.ts` 接入全仓扫描，例外仍在该文件按用途登记。内联样式采用 TypeScript 语法树检查，未知表达式默认不能充当绕过通道；动态浮层位置和成果排版按精确出口处理。ESLint 的 Renderer 规则同时禁止非原生元素冒充按钮、要求自定义点击元素的角色/焦点/键盘处理；共享菜单的键盘委托由既有基座承担，规则和行为测试共同验证。

反馈实现必须先按 [UI/UX 体系 §11.5](10-ui-ux-system.md) 路由语义，再选择组件：**三个落点各只有一个出口组件**——短时结果用 `TransientToast`，需要停留且当前对象可行动的错误／警告用 `InlineError`，跨页面可回看的长操作结果才进入消息中心（`NotificationService`）。禁止在 Hook 或页面里另造自动消失计时器、顶部横幅（常驻或固定悬浮皆算）或第三套 Toast——`TransientToast`（局部、自消、不落库）与 `ToastHost`（已持久化通知的投影）是既有的两套，分工见 §11.5.1，不可混用；对象状态本身能表达结果时，不重复制造全局提示。

同一条消息**不得同时占用两个落点**。调用链上最先能承载它的那一层负责呈现，向上传递给另一个通道即视为重复播报。IPC 收口因此二选一（两类处置的形状与清单见 §5 的 Renderer 小节）：调用链上已经有内联／浮层承载这句话的，走「只记录」那一类；这句话还没有任何出口的，走「让用户看见」那一类，由 `reportAction` 的 `onError`、或手写 `catch` 把它交到内联错误条、表单错误与局部浮层之一。**「让用户看见」的出口不必是全局的**——`use-model-settings` 把 `onError` 接在局部 `TransientToast` 上同样合规，判据是「这句话有没有出口」，不是「出口有多大」。

反馈轴之外还有一条**状态轴**：一句常驻的只读状态说明（「这个对象现在是什么」）由 `StatusNote` 独家出口，档位只有 `neutral`／`success`／`warning`／`danger` 四档，无底、无内距、不自带上下缝。两轴的分界看「说的是哪一件事」，不看「有没有底」——一句无底纯文字，讲的是动作结果就仍归反馈轴。判据、清单与护栏见 [UI/UX 体系 §11.5.2](10-ui-ux-system.md)。

界面规范以 [UI/UX 体系](10-ui-ux-system.md) 为真相源，其中与本节相关的硬约束：

- 只用语义化 Token，禁止硬编码色值与局部 `.dark` 补丁。新增颜色先进 §9.3 的契约并**当场补齐 8 个 Variant**，不留半套。
- 动效时长只用 Token（`--motion-instant` / `--motion-expand` / `--motion-overlay`），禁止在组件里写死毫秒数；`prefers-reduced-motion` 的降级已全局处理，新增动效自动生效。**降级的两轨不可互换**：动画压到 0.01ms、过渡取 `0s`——`transition-property` 的初始值是 `all`，给 `*` 写非零 `transition-duration` 会反向替所有元素造出过渡，把本来不动的属性（焦点环的 `outline-width`／`offset`／`color`）一起拖进动画。护栏「界面观感基线 › 全局动效降级只能关过渡、压动画，不得给 * 造出过渡」拦这一条，理由与实测见 [UI/UX 体系 §9.9](10-ui-ux-system.md) 与 [ADR-0035](adr/0035-focus-ring-inside-control-box.md)。
- 正文与承载产品信息的次要文本不得小于 12px。豁免仅限图形化标识：格式徽标（MD / PDF / DOC / TXT）、品牌字标、未读数徽标。`<small>` 已在 `styles.css` 给出 12px 全局基线（UA 默认 `0.83em` 会掉到下限之下，且「没写声明」扫不出来），组件只在此之上放大，不得再靠逐处补 `font-size` 兜底。
- 间距标尺是 4 / 8 / 12 / 16 / 24 / 32px，对应 `--space-4` 至 `--space-32` 六个原子 Token。`gap` / `row-gap` / `column-gap` 与 `margin` 全系（含逻辑属性）非零间距必须引用这六档或经登记的语义 Token，不直接写像素；`0` 与 `auto` 可用于复位／对齐。`standards/coding-standard.test.ts` 核对 Token 值、引用与值域；要加新档位先改 [UI/UX 体系 §9.8](10-ui-ux-system.md)。`padding` 不走这把尺，走 §9.10 的控件内距档位与容器留白。
- 页头或页签分隔线到首块内容的入口间距只有 `--content-start-gap: 12px` 一档（[UI/UX 体系 §8.3／§9.8](10-ui-ux-system.md)）。普通页、工作页、右侧五页签、设置中的记忆分组和定时任务知识范围选择分别由 `.page-body`、`.workspace`、`.context-content`、`.memory-settings`、`.schedule-source-sheet` 承担，页面不得另补顶部间距；设置页的窗口安全留白是不同关系。结构护栏与真实 Electron 页面检查共同验证这道缝。
- 纵向堆叠的块之间必须有垂直间距：堆叠容器用 `gap` / `row-gap` 拥有节奏，`components/layout/` 的骨架容器必须自带 `display` + `gap`，页面不得用后代选择器覆写骨架的 `display` / `flex-direction` / `gap` / `align-items` / `justify-content`；表单控件不写 `width:100%`（在弹性行里会挤到同排标签逐字断行）。护栏见 `standards/coding-standard.test.ts`，理由见 [UI/UX 体系 §9.8](10-ui-ux-system.md)。
- 界面功能图标一律用 `icons.tsx` 里的内联 SVG（`currentColor`、24 网格、统一笔画）。新增图标先进图标集再使用。禁止 Unicode 字符或 emoji 充当界面图标；品牌字标与格式徽标（MD／PDF／DOC／TXT）是**文字标识**，不在此列。
- 原始 Run 事件不得出现在主界面。工具卡片显示阶段名与一句摘要（`lib/tool-summary.ts`），原始载荷只在过程面板的折叠区里。
- 工具名到阶段名的映射在 `lib/labels.ts` 的 `TOOL_LABELS`，**新增工具必须同步**，否则界面会退化成通用文案。
- React：不在渲染期间写 ref、不在渲染期间产生副作用；事件回调需要读最新值时用「effect 同步 ref」的模式（见 `notifications.tsx`、`TransientToast.tsx`）。挂载 effect 的依赖必须如实声明，靠 `useCallback` 让回调稳定，而不是用空依赖数组掩盖。**计时器 effect 是另一回事**：它的依赖应当是「这一条计时属于哪一件事」（如浮层的 `tone` 与 `message`），而不是回调的标识——把 `onDismiss` 列进去，调用点写内联箭头时宿主每次重渲染都会把计时清零，护栏因此直接锁 `TransientToast` 的依赖数组形状。

## 9. 测试

- 一个实现文件对应一个同目录 `.test.ts`；纯函数优先单测，跨模块行为用集成测试。
- 测试用真实的 SQLite（`:memory:` 或临时目录）而不是 mock 仓储——本仓已有多次「mock 通过、真实库失败」的教训来源是 schema 与约束。
- 需要构造非法输入、按下标取断言目标时直接用 `!` 与 `any`，测试文件按角色放宽了这几条规则（见 `eslint.config.mjs` 的 `betterwork/tests` 块）。这是按文件角色划定的单一策略，不是逐文件例外；生产代码不享受。
- 涉及外部 HTTP 的代码必须注入 `fetch`（或用 `vi.stubGlobal`），测试绝不触网。
- 真实渲染检查复用生产组件与样式，在独立临时 Chromium 数据目录运行，不抢桌面焦点。组件/页面矩阵不挂产品 Preload、不访问 SQLite；应用旅程与进程恢复挂生产 Preload 和真实 IPC/Application，只访问临时 SQLite 与合成资料，Provider 请求由确定性替身接管，全部均不联网、不调用真实模型。覆盖与恢复边界只维护在 UI/UX §10.1.3。测试宿主用软件合成，等待动画结束与新绘制帧；组件/页面矩阵另核对稳定截图中的主题画布、模态遮罩和面板像素，DOM 就绪不足以证明截图有效。门禁跑在 macOS runner 上（[ADR-0036](adr/0036-macos-only-platform-scope.md)），合成窗口保持 `sandbox: true`。原生控件对比测自然高度，不能用 flex stretch 掩盖差异。`npm run ui:check -- --probe-control-height`、`--probe-snapshot-theme`、`--probe-snapshot-modal`、`--probe-page-feedback` 只改临时构建 CSS；`--probe-app-persistence` 只改临时数据库，分别验证几何、截图主题、模态绘制、页面反馈与真实持久化退化会被拦截；`--probe-crash-recovery` 跳过合成宿主的 Run 启动收口。上述探针均预期退出 1。这些证据不能替代整页视觉差异审阅、屏幕阅读器、真实模型与安装验收。
- **像素门禁按「连续两帧读数一致」下结论，不按单帧**：`capturePage` 在负载高的机器上会把「遮罩已画、面板主题还没换上」的中间态交出来，单帧即判就是把环境差异读成缺陷（2026-10-02 的 macOS runner 假红是这个形状；焦点环那一发是同一族的读取时机问题）。判据时机与容差都收在 `scripts/fixtures/frame-verdict.ts`：两帧一致且合规才落图放行，两帧报同一条违规才判红，两帧不同就继续等；通道容差仍是 2——**放宽容差等于把真实缺陷登记成环境差异**，要改的永远是「什么时候可以判」而不是「差多少算过」。
- 断言窗口广播时必须区分 channel：同一个 `webContents.send` 同时承载 Run 事件与通知事件，只按 `type` 断言会把两者混在一起。
- 依赖重型动态导入的用例（PDF / DOCX 解析）要显式提高超时，冷缓存下的首次转换会超过默认 5 秒。
- **墙钟与内存预算断言只允许住在 `*.bench.test.ts`，由 `npm run bench` 串行跑，不进 `npm run verify`**。原因不是性能不好，而是门禁不可信：137 个测试文件并发抢核时，同一份代码的 p95 会漂到 1.5–5 倍（2026-09-26 实测连跑四轮，红项组合每次都变；串行档里 p95 303ms，预算 1s）。随机红的门禁下一个被牺牲的永远是门禁本身。挪进串行档的同时保留三件事：样本值每次照旧打印、阈值一格没放宽、护栏锁「功能档里不得出现 `performance.now()`」，防止新的计时断言悄悄混回提交门禁。
- **慢夹具 ≠ 计时基准**：只为构造非法输入而昂贵的用例（例如压缩炸弹夹具要真 DEFLATE 210 MiB）留在功能档，放宽**该用例的超时**并在注释里写明放宽的是夹具时间、断言的是什么边界。放宽超时的注释必须能被反驳：安静机上先量一次实测值（该例约 4 秒），别一上来就写「可能超时」。同批登记的还有两处：`standards/ui-governance.test.ts` 的 ESLint 门禁第一条要冷加载扁平配置与 TS／JSX 解析器（安静机实测 1.8s，整档并发漂到 5.1s 撞过默认 5 秒），`scripts/ui-render-check.test.ts` 三条各真起一次 esbuild＋Electron 子进程（安静机 0.5／1.2／1.6s，macOS runner 上撞线）。两处都按同一判据放宽到 20 秒，并且证过预算真的接在用例上——把常量压到 1ms 时四条全部红成 `Test timed out in 1ms`；阻塞式 `spawnSync` 也是子进程返回后才报超时，所以抬预算是把门禁变可信，不是把红挪个地方。
- `scripts/ui-render-check.test.ts` 的 `--acceptance-smoke` 会准备合成验收数据、关闭进程并以新 Electron 进程重开；2026-10-05 macOS runner 在原 20 秒硬上限被终止（spawn status 为 `null`，用例耗时 20.075 秒）。此用例单独采用 60 秒夹具上限，断言仍要求重开成功并且没有写入人工验收结果；这不是性能预算。
- **重文件走 `heavy` 串行档**：`vitest.config.ts` 的 `HEAVY_TEST_FILES` 收录**单文件墙钟 ≥20s** 的文件（2026-09-29 实测门槛：第 6 名 23.1s、第 7 名 15.9s，中间断档），`npm test` 因此是「functional 并发 → heavy 串行」两次独立调用。判据是墙钟不是主题：这些文件要么渲染整棵应用树（`App.test.tsx` 35 例），要么在真实子进程／解压／数据库上跑，撞 5s 默认超时的从来是它们而不是快文件。**改这类 include／exclude 必须当场核对两档的文件数与用例数**，与改动前当次 `npm test` 的输出逐项对齐（规模快照不进本文，理由见 §1）；漏档的文件会静默消失而不报任何错。**串行档只隔离「我们自己这一批测试文件互相抢核」，隔离不了本机其它进程**：同晚负载 31 时把 `App.test.tsx` 单独跑仍红 5 条超时、且红项与并发跑那次完全不同（红项轮换＝争抢特征），所以「红哪几条随负载而变」只被消掉一半，判读法仍是上一条的「p50／p95 是否同比例放大＋单文件复跑」。

## 10. 例外机制

仓库根 `.codeartsdoer/` 是 CodeArts 自动生成的本地索引与工具配置，不是产品源码。Git、ESLint、Prettier 和结构扫描排除此根目录；护栏另外检查它没有被 Git 跟踪。该例外不允许产品数据库或密钥进入源码目录，也不豁免其他位置的同名目录。

规范可以有例外，但例外必须**写在配置里并说明理由**，不允许散落在源码中。

- 源码里**不接受单点豁免**：`eslint-disable`、`@ts-ignore`、`@ts-expect-error`、`prettier-ignore` 一律为零，由结构护栏强制。真要放宽某条规则，改 `eslint.config.mjs` 并在配置注释里写清理由——这会迫使例外可见、可评审，而不是藏进一行注释。
- 需要整类豁免时在 `eslint.config.mjs` 里按文件角色（如 `betterwork/tests`）配置，并写清为什么这类文件适用不同口径。
- 结构性约定的例外写在 `standards/coding-standard.test.ts` 的白名单数组里并注明理由。**色值与字号是两条不同的轴，别混在一句里**：色值一侧只有 TS 的三个文件（`appearance.ts` 外观预览色板、`window.ts` 首帧窗口主题、`brand-logo.tsx` 品牌标志）加 CSS 的 `:root` Token 定义与 `.mode-preview`／`.scheme-preview` 预览选择器；字号一侧只有图形化标识（格式徽标、品牌字标、未读数徽标）可以小于 12px。白名单里的每一项都必须能在本文或 [UI/UX 体系](10-ui-ux-system.md) 里找到对应条款；找不到就先补条款再加白名单。
- 已经生效的三处策略性关闭及其理由都记录在配置注释中：`require-await`（接口签名要求 async，同步实现必然无 await）、`prefer-nullish-coalescing` 对字符串放行 `||`（空串回退是有意的）、React Compiler 的优化类规则（本项目未启用编译器）。

发现规则产生大量误报时，先判断是「规则不适用于本项目的架构」还是「代码写法有问题」。前者改配置并记录理由，后者改代码。不要因为嫌麻烦而放宽规则。

## 11. 变更记录

- 2026-09-05：建立本文。同时引入 Prettier + ESLint（含类型感知规则、导入排序）、把 `lint` 与 `format:check` 纳入 `verify` 门禁、按聚合拆分持久化层、引入版本化迁移与外键、统一异步收口与错误词汇、按 views / components / hooks / lib 拆分 Renderer。
- 2026-09-06：新增 `standards/coding-standard.test.ts`，把 ESLint 表达不了的跨文件约定（配置唯一、源码零豁免、分层边界、Token 与动效纪律、规则索引完整、首帧主题一致）纳入 `npm test` 门禁。
- 2026-09-07：修正 `foreign_key_check` 的事务语义：它可以读取同一事务的变更；迁移现在以迁移后、提交前的完整性检查为门槛。IPC 注册器同时校验共享协议定义的请求和响应。
- 2026-09-23：`coding-standard.test.ts` 增加「协议导出的阈值常量都有真实消费者」，把 §7 新增的协议常量单一真相源条款纳入门禁；同轮把记忆召回与提炼里 9 个无人消费的协议常量接回实现侧。

- 2026-10-02：对齐 AI 页面检查/Review/创建流程与真实组件台账；规则入口按职责路由，门禁摘要核对实际 verify 命令；补条件子树/CSS 末声明解析回归，Field 分组选项语义与讨论节点基座复用同步治理；真实截图增加绘制同步与像素正反校验，避免 DOM 通过而图像停在旧帧。
