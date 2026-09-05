# 工程规范

本文是算台 BetterWork 的**唯一**代码规范。全仓只有一套标准：不允许某个目录、某个文件或某位贡献者另行约定。

规范的**执行者是机器**，不是本文档：`eslint.config.mjs` 与 `.prettierrc.json` 是本文的可执行形式，`npm run verify` 是门禁。本文负责解释「为什么是这条规则」，配置负责保证「没有人能绕过它」。两者冲突时以配置为准，并同时修正本文。

相关文档：架构边界见 [系统架构](03-system-architecture.md)，界面规范见 [UI/UX 体系](10-ui-ux-system.md)，当前实现基线与已知缺陷见 [Qoder 开发交接](11-qoder-handoff.md)。

## 1. 工具链与命令

| 命令 | 作用 |
| --- | --- |
| `npm run lint` | ESLint（含类型感知规则） |
| `npm run lint:fix` | 自动修复可修复项（导入顺序、类型导入等） |
| `npm run format` | Prettier 写入 |
| `npm run format:check` | Prettier 校验 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest 单次运行 |
| `npm run verify` | 上述五项按序全跑，任一失败即中止 |

提交前必须跑 `npm run verify`。**不要**把它的输出接管道后只看末尾——`cmd | tail` 的退出码是 `tail` 的，会把失败读成成功。需要截取输出时用 `npm run verify > log 2>&1; echo $?`。

规范的执行分三层，缺一层就会漂移：

| 层 | 载体 | 管住什么 |
| --- | --- | --- |
| 单文件写法 | `eslint.config.mjs`、`.prettierrc.json` | 一个文件内部的类型、异步、命名与排版 |
| 跨文件结构 | `standards/coding-standard.test.ts` | 配置唯一性、零豁免、分层边界、Token 与动效纪律 |
| 门禁 | `npm run verify` | 上面两层，加类型检查、全部测试与构建 |

结构护栏随 `npm test` 执行，因此也在 `verify` 里。它断言的都是 ESLint 表达不了的约定：ESLint / Prettier / tsconfig 各只有一份且严格开关全开、源码里没有任何豁免注释、`packages/*` 不依赖 `apps/*`、Agent Core 不依赖宿主运行时、Renderer 不导入 `node:*`、`views/` 与 `components/` 不直接调 IPC、`ipcMain.handle` 只在一处、取消词汇只在一处、硬编码色值与写死的动效时长只出现在白名单里、首帧窗口主题与青玉浅色 Token 一致、`.qoder/rules/` 下每个规则文件都登记在索引里。

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
│   └── ipc/              # 全部 channel 注册与边界校验
├── preload/index.ts      # 最小类型化 API，推送事件一律过 Zod
└── renderer/src/
    ├── main.tsx          # 挂载入口
    ├── App.tsx           # 跨簇编排与布局组装
    ├── views/            # 页面级视图（一个导航入口一个文件）
    ├── components/       # 跨视图复用的界面组件
    ├── hooks/            # 有状态逻辑，一个内聚状态簇一个 hook
    ├── lib/              # 无状态纯函数与常量（可单测，不含 JSX）
    └── *.ts / *.tsx      # 领域派生逻辑（activity、appearance、icons 等）

packages/
├── agent-protocol/       # 跨进程协议、领域类型、Zod Schema、IPC channel 的唯一入口
├── agent-core/           # Agent Loop、Provider 接口与统一错误词汇
└── tool-runtime/         # 确定性工具实现

standards/
└── coding-standard.test.ts  # 跨文件的结构护栏，随 npm test 执行
```

放置规则：

- **有状态**逻辑进 `hooks/`，**无状态**逻辑进 `lib/`。判据是「是否持有 React 状态」，不是「文件长短」。
- 一个视图只在 `views/`，被两个以上视图使用才提升到 `components/`。不要为「以后可能复用」提前提升。
- `services/` 可以依赖 `persistence/`，反向不行；两者都可以依赖 `packages/*`，`packages/*` 不得依赖 `apps/*`。
- 需要 Application 层资源的 Tool 用「工厂 + 闭包注入」（`createKnowledgeSearchTool`），使 `tool-runtime` 不依赖 Electron、SQLite 或服务商 SDK。

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

## 5. 异步与错误处理

这是本仓最重要的一条纪律，因为它直接决定用户能否看见失败。

**主进程**

- `RunService.consume` 必须有 `catch`：引擎自身会收口失败与取消，但编排层在进入事件循环之前（读模型配置、构造搜索客户端）或在写库、广播过程中抛错时，引擎不会产出任何终态事件。兜底靠 `RunRepository.forceFailure`，它只在 Run 仍为 `running` 时合成 `run.failed`，因此重复调用安全，也不会与引擎的终态冲突。
- 不变量：**每个 Run 都必须有明确终态**。启动时 `failInterruptedRuns` 会把上次进程被强杀留下的 `running` 收口为 `failed`。
- 启动失败要 `console.error` 后退出，不能静默留在半初始化状态。

**Renderer**

到主进程的每一次调用都必须收口，只有两种方式（`lib/async-action.ts`）：

| 方式 | 何时用 | 失败去向 |
| --- | --- | --- |
| `reportAction(promise, onError, fallback)` | 用户主动发起、且失败后用户能采取行动 | 调用方指定的可见出口（页面错误条、表单错误、内联提示） |
| `trackAction(promise, label)` | 后台同步，或调用自身已负责呈现结果 | `console.error`，带 label 便于定位 |

不存在第三种「`void someIpcCall()`」。ESLint 的 `no-floating-promises` 已设为 `ignoreVoid: false`，正是为了让这种写法无法通过。

列表刷新函数（`refreshX`）统一为「返回 `void`、永不 reject」，因此调用点不需要也不应该 `await` 它们。

**错误词汇**

取消语义只有一处定义：`packages/agent-core/src/errors.ts` 的 `abortError()` / `isAbortError()` / `describeError()`。任何地方都不允许再写 `Object.assign(new Error('Run cancelled'), { name: 'AbortError' })`——写错名字会让取消被当成失败上报。

重新抛出的错误必须带 `cause`（ESLint 核心规则 `preserve-caught-error`）。

## 6. 持久化与迁移

- SQLite 是产品状态真相源；缓存、索引、预览必须可重建。
- 每个库的 schema 演进走 `db/` 里的**版本化迁移**，不允许在启动代码里用 `PRAGMA table_info` 探测后 `ALTER`。
- 迁移约定：
  - `version` 从 1 开始连续递增且唯一，`migrate()` 启动时校验，写错会直接抛错而不是静默跳版本。
  - v1 固定为「迁移制度引入之前」的形状；历史库由 `detectLegacy` 识别、`reconcileLegacy` 对账到 v1、打版本戳，然后正常走 v2 及以后。这样历史库不会漏掉任何后续迁移。
  - 每条迁移是一个原子事务，失败整体回滚且不打版本戳，下次启动从失败那条重来。
  - SQLite 无法用 `ALTER` 增删外键，补外键一律走 `rebuildTable`：事务外关外键、建新表、拷数据、删旧表、改名、补回索引。
  - **悬空引用由调用方在重建前清理**，不要用 `PRAGMA foreign_key_check` 在事务内兜底：它读的是已落盘的数据，看不到同一事务里早先的 `DELETE`，放在事务内只会误报。清理顺序必须**先父后子**——删父表孤儿会产生新的子表孤儿（见 `app-schema.ts` 的 `addForeignKeys`）。整条迁移仍是一个原子事务，失败即回滚且不打版本戳。
  - 新增迁移必须同时补 `db/migrate.test.ts` 里的对应用例（新库、历史库、幂等、失败回滚）。
- `PRAGMA foreign_keys` 常开。写测试时要建真实的父级行，不能塞伪造 id。
- Repository 只写自己的聚合表，但可以读其他表做存在性与归属校验；跨聚合写入由调用方用 `store.transaction()` 显式包起来。Repository 之间不互相持有引用。
- 密钥（模型与搜索的 API Key）明文存于本地 SQLite，**只**在主进程内部流转；对外接口一律只回 `apiKeyConfigured`。日志、错误信息、测试输出绝不出现 Key。

## 7. IPC

- channel、输入、输出全部在 `packages/agent-protocol` 定义；`IpcChannel` 是 channel 名的唯一来源。
- 所有 handler 必须经 `ipc/register-ipc.ts` 的三个注册 helper 之一：`handleInput`（必填入参）、`handleOptionalInput`（入参可整体省略）、`handleNoInput`（入参必须为空）。三者都在边界上做 Zod 校验，不允许 handler 自行解析 `raw`。
- 推送给 Renderer 的事件在 preload 侧过 Zod 后再交给监听者。
- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 不可放松。
- 需要用户文件访问的能力，白名单校验必须在主进程完成（例如「打开原文」先查知识库登记记录，再交给 `shell.openPath`）。
- 会发起网络请求的用户输入必须收窄协议（`resolveEndpoint` 只接受 http/https），Zod 的 `url()` 会放过 `file://`。
- 外部 HTTP 调用一律带超时（`AbortSignal.timeout`），并保证错误信息不含凭据。

## 8. Renderer

分层：`views/` 只呈现、`components/` 只呈现、`hooks/` 持有状态与动作、`lib/` 是纯函数。**视图组件里不应出现 IPC 调用**，它们从 hook 拿到已经包装好的动作。

界面规范以 [UI/UX 体系](10-ui-ux-system.md) 为真相源，其中与本节相关的硬约束：

- 只用语义化 Token，禁止硬编码色值与局部 `.dark` 补丁。新增颜色先进 §9.3 的契约并**当场补齐 8 个 Variant**，不留半套。
- 动效时长只用 Token（`--motion-instant` / `--motion-expand` / `--motion-overlay`），禁止在组件里写死毫秒数；`prefers-reduced-motion` 的降级已全局处理，新增动效自动生效。
- 正文与承载产品信息的次要文本不得小于 12px。豁免仅限图形化标识：格式徽标（MD / PDF / DOC / TXT）、品牌字标、未读数徽标、当前模型徽标。
- 界面功能图标一律用 `icons.tsx` 里的内联 SVG（`currentColor`、24 网格、统一笔画）。新增图标先进图标集再使用。禁止 Unicode 字符或 emoji 充当界面图标。
- 原始 Run 事件不得出现在主界面。工具卡片显示阶段名与一句摘要（`lib/tool-summary.ts`），原始载荷只在过程面板的折叠区里。
- 工具名到阶段名的映射在 `lib/labels.ts` 的 `TOOL_LABELS`，**新增工具必须同步**，否则界面会退化成通用文案。
- React：不在渲染期间写 ref、不在渲染期间产生副作用；事件回调需要读最新值时用「effect 同步 ref」的模式（见 `notifications.tsx`）。挂载 effect 的依赖必须如实声明，靠 `useCallback` 让回调稳定，而不是用空依赖数组掩盖。

## 9. 测试

- 一个实现文件对应一个同目录 `.test.ts`；纯函数优先单测，跨模块行为用集成测试。
- 测试用真实的 SQLite（`:memory:` 或临时目录）而不是 mock 仓储——本仓已有多次「mock 通过、真实库失败」的教训来源是 schema 与约束。
- 需要构造非法输入、按下标取断言目标时直接用 `!` 与 `any`，测试文件按角色放宽了这几条规则（见 `eslint.config.mjs` 的 `betterwork/tests` 块）。这是按文件角色划定的单一策略，不是逐文件例外；生产代码不享受。
- 涉及外部 HTTP 的代码必须注入 `fetch`（或用 `vi.stubGlobal`），测试绝不触网。
- 断言窗口广播时必须区分 channel：同一个 `webContents.send` 同时承载 Run 事件与通知事件，只按 `type` 断言会把两者混在一起。
- 依赖重型动态导入的用例（PDF / DOCX 解析）要显式提高超时，冷缓存下的首次转换会超过默认 5 秒。

## 10. 例外机制

规范可以有例外，但例外必须**写在配置里并说明理由**，不允许散落在源码中。

- 源码里**不接受单点豁免**：`eslint-disable`、`@ts-ignore`、`@ts-expect-error`、`prettier-ignore` 一律为零，由结构护栏强制。真要放宽某条规则，改 `eslint.config.mjs` 并在配置注释里写清理由——这会迫使例外可见、可评审，而不是藏进一行注释。
- 需要整类豁免时在 `eslint.config.mjs` 里按文件角色（如 `betterwork/tests`）配置，并写清为什么这类文件适用不同口径。
- 结构性约定的例外写在 `standards/coding-standard.test.ts` 的白名单数组里并注明理由（外观预览色板可以用字面色值、格式与徽标类标识可以小于 12px、首帧窗口主题只能写字面值）。白名单里的每一项都必须能在本文或 [UI/UX 体系](10-ui-ux-system.md) 里找到对应条款；找不到就先补条款再加白名单。
- 已经生效的三处策略性关闭及其理由都记录在配置注释中：`require-await`（接口签名要求 async，同步实现必然无 await）、`prefer-nullish-coalescing` 对字符串放行 `||`（空串回退是有意的）、React Compiler 的优化类规则（本项目未启用编译器）。

发现规则产生大量误报时，先判断是「规则不适用于本项目的架构」还是「代码写法有问题」。前者改配置并记录理由，后者改代码。不要因为嫌麻烦而放宽规则。

## 11. 变更记录

- 2026-09-05：建立本文。同时引入 Prettier + ESLint（含类型感知规则、导入排序）、把 `lint` 与 `format:check` 纳入 `verify` 门禁、按聚合拆分持久化层、引入版本化迁移与外键、统一异步收口与错误词汇、按 views / components / hooks / lib 拆分 Renderer。
- 2026-09-06：新增 `standards/coding-standard.test.ts`，把 ESLint 表达不了的跨文件约定（配置唯一、源码零豁免、分层边界、Token 与动效纪律、规则索引完整、首帧主题一致）纳入 `npm test` 门禁；修正 §6 中已失效的 `foreign_key_check` 兜底描述——它在事务内看不到同事务早先的 `DELETE`，改为由调用方在重建表前按「先父后子」清理孤儿行。
