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

每个任务在独立分支上工作；并行写任务各用独立 worktree 和分支。pre-commit 按暂存文件做差异空白、定向 ESLint/Prettier 与文档快检；pre-push 核对干净 HEAD 和空白差异并拒绝 main。代码 PR 在独立 macOS runner 并行执行全仓类型感知 lint 与其他代码检查；差异格式在配置/依赖变化时回退全仓，类型全仓，相关功能档后接串行重档并排除真实 Electron UI CLI 回归。发布清单专档执行格式、发布预检、实际消费者登记回归与 docs:check；纯 Markdown 只跑 docs:check。PR Gate 要求对应检查均成功，独立于完整/UI 验证。合并后清理已合并分支和 worktree，未合并工作保留。（docs/12 §1/§1.1、ADR-0039/0042/0046）

日常入口为 `npm run check:quick -- --base origin/main`，纳入未提交与未跟踪差异。完整 verify 仍为 lint + format:check + typecheck + test + build + ui:check，只由用户按需或夜间运行。AI 不因 UI 文件变化、页面 Review、局部修改、提交、推送或合并自动启动真实 UI 检查、页面走查或完整 verify，交接记录 UI 未验证项。（docs/12 §1/§1.1、ADR-0046）

    npm run verify        # 用户按需或夜间计划运行完整验证
    npm run docs:check    # 文档结构、摘要与规则链接一致性

GitHub Actions → Verify → Run workflow 可选分支和 scope=full（缺省）/ui；CLI 为 `gh workflow run verify.yml --ref <分支名> -f scope=ui` 或 scope=full。本地 UI 入口为 npm run ui:check；夜间每天北京时间 23:30（UTC 15:30）仍执行 main 的完整 verify。PR Gate 只依赖对应快检，各范围单独报告实际 SHA 和证据；失败读取步骤与产物后修复。（docs/12 §1/§1.1、ADR-0042/0046）

门禁范围现在有机器强制：`.husky/pre-commit` 按暂存路径运行 `scripts/pre-commit-check.mjs`，`.husky/pre-push` 运行 `scripts/pre-push-check.mjs` 阻止直推 `main` 并核对 HEAD/空白差异；PR workflow 按差异分类并提供稳定 `PR Gate`。护栏「提交与推送门禁纪律 › 本地钩子按暂存范围快检并阻止直推 main」以及提交/推送/分类夹具测试锁住各范围的检查选择。（docs/12 §1）

pre-commit 检查路径另有未暂存变化时拒绝，不能以工作树修正替暂存快照通过。快检强制选择动态资源与脚本消费者，变化的可执行生产 TypeScript 行按各档命中并集达到 80%；缺报告、旧报告、源码变化和必需消费者缺失失败。计划、测试、覆盖率与失败阶段留存 30 天，UI 变化只记录待专项验证。新增行为/缺陷修复的红绿证据及特征测试区分按唯一规范执行。（docs/12 §1/§1.1、ADR-0049）

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

- 模型与搜索 API Key 的生产路径由 Main 注入 Electron `safeStorage`，加密后存入 `credentials`；legacy 列与 journal 状态按 docs/12 §6 处理，`pending/failed` 不回退明文，`none` 仍保留兼容读取。对外只回 `apiKeyConfigured`，日志、错误消息、测试输出**绝不打印密钥**。（docs/12 §6、docs/11 §3）
