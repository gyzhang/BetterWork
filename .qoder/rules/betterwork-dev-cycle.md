---
trigger: model_decision
description: 启动应用、停止应用、调试、运行开发环境、构建、验证、提交代码、打包发布时加载
---

# 应用启停、验证与提交纪律

本文件是**速查复述**，不是第二份标准：每条句末括号里是它的唯一出处，与出处不一致时回到出处核对并同轮修好本文件。

## 启停（只用脚本）

    bash scripts/dev-start.sh   # 启动：先准确停止旧的开发实例，再写 PID
    bash scripts/dev-stop.sh    # 停止：按 PID 文件精确停止

- 开发日志固定在 `/tmp/betterwork-dev.log`。（docs/11 §3）
- **产品开发实例禁止绕开脚本直接启动 Electron，禁止 `pkill -f electron` 等宽泛进程匹配**——那会误杀用户的其他 Electron 应用；必要时按 PID 并用 lsof 校验工作目录后再操作。（docs/11 §3）
- `ui:check` 的独立合成 Electron 测试进程由验证脚本管理，不是产品开发实例。（docs/12 §9）
- 生产构建存在来自 Zod 的 Rollup `@PURE` 注释已知警告；构建成功即通过，**不得因此作无关依赖升级**。（docs/11 §3）

## 提交与推送验证

每个任务在独立分支上工作；并行写任务各用独立 worktree 和分支。提交时由 pre-commit 对暂存文件做差异空白、定向 ESLint / Prettier 与文档结构快检，不按每个 TypeScript 提交跑全仓 typecheck。pre-push 阻止直推 `main`，只核对干净 `HEAD` 与差异空白。代码或混合 PR 执行一次完整 `npm run verify`（lint + format:check + typecheck + test + build + ui:check）；纯 Markdown PR 只执行 `npm run docs:check`，两者均由必需状态 `PR Gate` 汇总。合并后删除已合并分支并归档/移除 worktree；未合并任务保留。（docs/12 §1/§1.1、ADR-0039）

    npm run verify        # PR 上由 GitHub Actions 执行；代码/混合改动必须通过
    npm run docs:check    # 文档结构、摘要与规则链接一致性

门禁范围现在有机器强制：`.husky/pre-commit` 按暂存路径运行 `scripts/pre-commit-check.mjs`，`.husky/pre-push` 运行 `scripts/pre-push-check.mjs` 阻止直推 `main` 并核对 HEAD/空白差异；PR workflow 按差异分类并提供稳定 `PR Gate`。护栏「提交与推送门禁纪律 › 本地钩子按暂存范围快检并阻止直推 main」以及提交/推送/分类夹具测试锁住各范围的检查选择。（docs/12 §1）

需要单独定位时：

    npm run lint          # 或 npm run lint:fix 自动修复导入顺序等
    npm run format:check  # 或 npm run format 写入
    npm run typecheck
    npm test
    npm run bench       # 计时基准档（*.bench.test.ts，串行），不属于 verify
    npm run build
    npm run ui:check    # 全正式主题 × 两档窗口；独立合成进程，不读取产品数据
    git diff --cached --check

- **禁止把 `npm run verify` 的输出接管道后只看末尾**（如 `npm run verify | tail`）：管道退出码取最后一个命令，`tail` 永远返回 0，会把失败读成成功。需要截取输出时用 `npm run verify > /tmp/verify.log 2>&1; echo $?`。（docs/12 §1）
- 治理巡检：`npm run drift:check` 查护栏看不见的三类漂移（钩子有没有接进这个克隆、未推送提交攒了多久、有提交的日子有没有工作日志），并对照 `docs/development/drift-readings.json` 报例外登记的增减；它**不进** `npm run verify`，因为它要读 git 与本机克隆配置，换台机器结论就不同。审计前、每完成一个批次后、同类问题第二次出现时各跑一次（docs/12 §1）。
- 规范本身见 [工程规范](../../docs/12-engineering-standards.md)：配置（`eslint.config.mjs`、`.prettierrc.json`）是规范的可执行形式，跨文件的结构约定由 `standards/coding-standard.test.ts` 守卫，同样跑在 `npm test` 里。改规则前先读该文档的例外机制一节。（docs/12 §1、§10）

## 提交纪律

- 每次开始先 `git status --short`；工作树中的既有改动属于用户，不得删除、覆盖或夹带进无关提交。（docs/11 §8、AGENTS.md §8）
- 每个提交聚焦一件事；必要的测试、文档与 ADR 和实现放在同一变更中。（AGENTS.md §8、docs/11 §8）
- 每个任务使用自己的分支；并行写任务使用独立 worktree 和分支。一个 checkout 与暂存区同一时刻只允许一个写任务。（docs/12 §1.1、docs/11 §8）
- main 只通过 PR Gate 合并；PR 合并后清理短期分支并归档/移除对应 worktree，未合并或含未提交修改的任务保留。（ADR-0039、docs/11 §3/§8）
- 禁止提交：`.env`、API Key、SQLite/数据库文件、构建产物、用户资料、本地工作文件。（AGENTS.md §7、docs/11 §8）
- 产品范围、数据迁移策略或安全边界不明确时，先停在文档 / ADR 层澄清，不把猜测固化为实现。（docs/11 §8、AGENTS.md §8）

## 密钥

- `model_profiles.api_key` 明文存于本地 SQLite，只在主进程内部流转；日志、错误消息、测试输出**绝不打印密钥**。如未来引入系统钥匙串，先新增 ADR 并设计迁移。（docs/12 §6、docs/11 §3）
