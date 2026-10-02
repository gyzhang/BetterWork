---
trigger: glob: **/*.ts,tsx,css,mjs,json
---

# 编码规范与风格（速查复述，标准在 docs/12）

全仓只有**一份**代码规范：[docs/12-engineering-standards.md](../../docs/12-engineering-standards.md)。
它的可执行形式是 `eslint.config.mjs` + `.prettierrc.json`，它的结构护栏是 `standards/coding-standard.test.ts`。
发现冲突时按 docs/12 的语义与已接受决策核对实现，修正文档、配置或护栏；不得仅因机器通过就静默偏离规范。

**动手前先读 docs/12 里与本任务相关的小节**（§2 目录结构、§3 命名与导出、§4 类型纪律、§5 异步与错误处理、§6 持久化与迁移、§7 IPC、§8 Renderer、§9 测试、§10 例外机制）。

**本文件是速查复述，不是第二份标准。** 下面每一条都是 docs/12（少数几条是 AGENTS.md）某个小节的摘要，句末括号里的 `§N` 就是它的出处；本文件与出处不一致时**回到出处核对配置与护栏**，并同轮修好本文件。这么标注是付出过代价的：IPC 收口判据曾在 `AGENTS.md`／`docs/12`／本文件／`betterwork-ui.md` 四处并存两种措辞，其中本文件那一处直到 2026-09-29 才对齐（[治理校准账本](../../docs/reviews/2026-09-28-ui-governance-audit.md) P3-11）。**改 docs/12 的任一小节，必须同轮 grep 本文件有没有复述到它**；护栏「规则文件的每条复述都要带出处」会拦住新增的无源条目，且它自 2026-10-02 起管的是 `.qoder/rules/` 下**全部**规则文件，不只本文件——没有出处的复述就是另立标准，而漂移时没人能判断哪一份对。

## 不可协商

- **不新建第二套标准**：不加第二份 ESLint / Prettier / tsconfig 配置，不在任何 `package.json` 里内嵌 `eslintConfig` 或 `prettier` 键，不新建会各自放宽严格度的子 tsconfig。（AGENTS.md §7、docs/12 §10）
- **源码里零豁免**：禁止 `eslint-disable`、`@ts-ignore`、`@ts-expect-error`、`prettier-ignore`。例外只能写进配置（按文件角色）或护栏测试的白名单，并注明理由。（docs/12 §10）
- **提交前跑 `npm run verify`**（lint + format:check + typecheck + test + build + ui:check）。**不要把输出接管道后只看末尾**——管道退出码取最后一个命令，会把失败读成成功。需要截取时用 `npm run verify > log 2>&1; echo $?`。（docs/12 §1）
- **墙钟与内存预算断言只写在 `*.bench.test.ts` 里**，由 `npm run bench` 串行跑，不属于 `verify`；功能档里出现 `performance.now()` 会被护栏拦下。为昂贵夹具放宽**超时**是另一回事，注释里写清放宽的是什么。单文件墙钟 ≥20s 的重文件走 `heavy` 串行档。（docs/12 §9）

## 最常踩的硬约束

- 生产代码禁止 `any` 与 `!`；可选属性用条件展开 `...(value ? { key: value } : {})` 构造，不显式赋 `undefined`。（docs/12 §4）
- `catch (error)` 里 `error` 是 `unknown`，统一用 `describeError(error)` 转文本（§4）；重新抛出必须带 `cause`（§5）。
- Renderer 到主进程的每一次调用都必须**收口**：失败必须到达一个真实存在的呈现出口，或把 promise 交回调用方收口。**「收口」不等于「必须字面调用某个函数」**——`reportAction`（让用户看见）与 `trackAction`（只记录）是两类处置的缺省实现，为了在成功时也播报一句而手写 `try/catch`、把失败交给同一个出口属同一类处置。**二选一的判据是「这句话是否已有内联或浮层承载」**，同一次结果不得两个通道各播一遍；「让用户看见」的出口不必是全局的，接在局部 `TransientToast` 上同样合规。禁止的是第三种处置「不处理」：`void someIpcCall()`、空 `catch {}`、不写降级理由的 `.catch(() => undefined)`。（docs/12 §5 的 Renderer 小节含形状清单与实测口径、§8 的判据）
- `views/` 与 `components/` 里不出现 `window.betterwork`，动作收在 `hooks/`；`App.tsx` 的跨簇编排接线在这条判据的射程之外，是登记在案的例外。（docs/12 §8）
- `ipcMain.handle` 只出现在 `apps/desktop/src/main/ipc/register-ipc.ts`，且必须走三个注册 helper 之一。（docs/12 §7）
- 取消语义只有一处定义：`packages/agent-core/src/errors.ts`。任何地方都不许再写 `'AbortError'` 字面量。（docs/12 §5）
- `packages/*` 不依赖 `apps/*`；Agent Core 不依赖 Electron / React / SQLite；Renderer 不导入 `node:*`。（AGENTS.md §3）
- Schema 变更走版本化迁移并补 `db/migrate.test.ts` 用例，不在启动代码里探测后 `ALTER`。（docs/12 §6）
- 只用语义化主题 Token 与动效 Token；硬编码色值只允许出现在 Token 定义、外观预览色板、首帧窗口主题与品牌标志。（docs/12 §8）
- 导入顺序交给 `simple-import-sort`，不要手工调整；类型导入写 `import type` 或内联 `type`。（docs/12 §3）

## 例外怎么办

1. 先判断是「规则不适用于本项目架构」还是「代码写法有问题」。前者改配置，后者改代码。**不要因为嫌麻烦而放宽规则。**
2. 改 `eslint.config.mjs` 时按文件角色配置并写清理由；改护栏测试时把例外加进对应白名单数组并写清理由。
3. 同步更新 docs/12（§10 记录策略性关闭，其余小节记录规则本身）与本文件的对应复述，再跑 `npm run verify`。
