---
trigger: glob: **/*.ts,tsx,css,mjs,json
---

# 编码规范与风格（唯一标准）

全仓只有**一份**代码规范：[docs/12-engineering-standards.md](../../docs/12-engineering-standards.md)。
它的可执行形式是 `eslint.config.mjs` + `.prettierrc.json`，它的结构护栏是 `standards/coding-standard.test.ts`。
三者冲突时以配置与护栏测试为准，并同时修正文档。

**动手前先读 docs/12 里与本任务相关的小节**（§2 目录结构、§3 命名与导出、§4 类型纪律、§5 异步与错误处理、§6 持久化与迁移、§7 IPC、§8 Renderer、§9 测试、§10 例外机制）。本文件只是速查入口，不复述也不另立标准。

## 不可协商

- **不新建第二套标准**：不加第二份 ESLint / Prettier / tsconfig 配置，不在任何 `package.json` 里内嵌 `eslintConfig` 或 `prettier` 键，不新建会各自放宽严格度的子 tsconfig。
- **源码里零豁免**：禁止 `eslint-disable`、`@ts-ignore`、`@ts-expect-error`、`prettier-ignore`。例外只能写进配置（按文件角色）或护栏测试的白名单，并注明理由。
- **提交前跑 `npm run verify`**（lint + format:check + typecheck + test + build）。**不要把输出接管道后只看末尾**——管道退出码取最后一个命令，会把失败读成成功。需要截取时用 `npm run verify > log 2>&1; echo $?`。

## 最常踩的硬约束

- 生产代码禁止 `any` 与 `!`；可选属性用条件展开 `...(value ? { key: value } : {})` 构造，不显式赋 `undefined`。
- `catch (error)` 里 `error` 是 `unknown`，统一用 `describeError(error)` 转文本；重新抛出必须带 `cause`。
- Renderer 到主进程的每一次调用都必须收口：`reportAction`（失败要让用户看见）或 `trackAction`（后台同步）。不存在 `void someIpcCall()`。
- `views/` 与 `components/` 里不出现 `window.betterwork`；IPC 调用收在 `hooks/`。
- `ipcMain.handle` 只出现在 `apps/desktop/src/main/ipc/register-ipc.ts`，且必须走三个注册 helper 之一。
- 取消语义只有一处定义：`packages/agent-core/src/errors.ts`。任何地方都不许再写 `'AbortError'` 字面量。
- `packages/*` 不依赖 `apps/*`；Agent Core 不依赖 Electron / React / SQLite；Renderer 不导入 `node:*`。
- Schema 变更走版本化迁移并补 `db/migrate.test.ts` 用例，不在启动代码里探测后 `ALTER`。
- 只用语义化主题 Token 与动效 Token；硬编码色值只允许出现在 Token 定义、外观预览色板、首帧窗口主题与品牌标志。
- 导入顺序交给 `simple-import-sort`，不要手工调整；类型导入写 `import type` 或内联 `type`。

## 例外怎么办

1. 先判断是「规则不适用于本项目架构」还是「代码写法有问题」。前者改配置，后者改代码。**不要因为嫌麻烦而放宽规则。**
2. 改 `eslint.config.mjs` 时按文件角色配置并写清理由；改护栏测试时把例外加进对应白名单数组并写清理由。
3. 同步更新 docs/12（§10 记录策略性关闭，其余小节记录规则本身），再跑 `npm run verify`。
