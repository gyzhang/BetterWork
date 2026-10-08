# 参与 BetterWork 开发

BetterWork 当前采用单人主导的 AI+Human 工作流：人类描述需求、判定方案并做最终人工验收；Codex/Qoder 承担已授权范围内的设计、开发、测试、Review 与交接。每项工作从最新 `origin/main` 创建任务分支，通过 Pull Request 合并回受保护的 `main`；单人维护阶段不要求额外人类 Reviewer。并行任务使用独立 worktree 和分支，避免多个任务共用同一编辑目录与 Git 暂存区。

本文件只提供入口，不建立第二套规范。产品与授权边界读 [AGENTS.md](AGENTS.md)，执行流程读 [工程规范 §1](docs/12-engineering-standards.md)，UI 设计与页面检查读 [UI/UX §10.1](docs/10-ui-ux-system.md#101-组件台账与基座纪律)，实现和验收状态查对应任务板。遇到冲突，同轮修正错误的说明，不用本指南覆盖已接受的 ADR。

## 环境与启动

产品、开发与 CI 只支持 macOS（darwin/arm64），见 [ADR-0036](docs/adr/0036-macos-only-platform-scope.md)。Node 的版本真相源是 `.nvmrc`；`package.json` 的 engines 定义最低版本。

```bash
npm ci
npm run verify  # 用户按需运行：lint + format:check + typecheck + test + build + ui:check
bash scripts/dev-start.sh
bash scripts/dev-stop.sh
```

产品启停、数据位置、密钥与日志边界按 [交接说明 §3](docs/11-qoder-handoff.md) 执行。开发日志位于 `/tmp/betterwork-dev.log`；当前没有承诺 `~/.betterwork/logs/` 生产日志目录。报告 Bug 时给出复现步骤、版本、期望/实际行为与已脱敏证据，不粘贴密钥或完整用户资料。

## 分支与合并

新任务从最新远端 main 创建短期分支；Codex 默认用 `codex/` 前缀：

```bash
git fetch origin
git switch -c codex/short-task-name origin/main
```

一个任务可以包含多个聚焦提交，并按个人节奏推送分支。完成后创建目标为 `main` 的 Pull Request；PR Gate 通过后合并。PR 合并后删除已合并任务分支，并归档/移除对应的 Codex worktree。未合并或含未提交工作的 worktree 必须保留。完整规则见 [ADR-0039](docs/adr/0039-task-branches-and-protected-main.md)。

## 完成与交接

开始任务先检查已有改动，按 AGENTS 的任务路由读取唯一规范和相关设计。UI 的页面分支、状态、反馈出口、明暗与窄窗证据按 docs/10 §10.1 提供；AI 完成自动验证与自身走查，再把可复查的验收步骤交给人类。不能把组件冒烟全绿写成完整页面或真实模型语义已验收。

提交时 pre-commit 按暂存范围运行差异空白、定向 ESLint/Prettier 和文档快检；不为每个 TypeScript 提交运行全仓 typecheck。pre-push 拒绝直推 `main`，只核对干净且与推送对象一致的 HEAD 以及差异空白。代码或混合 PR 在 macOS Actions 上运行 lint、format:check、typecheck、docs:check 和按 PR base SHA 选择的相关测试；纯 Markdown PR 只运行 `docs:check`。必需状态统一为 `PR Gate`，其通过表示快门禁通过。

完整 `npm run verify`（lint + format:check + typecheck + test + build + ui:check）由用户按需触发或夜间计划执行。执行与证据要求只在 docs/12 §1 维护。每项任务更新对应状态和当日工作日志，注明未验证项；提交、推送、真实模型调用与发布按已有授权分别执行。

GitHub Actions 对目标为 `main` 的 Pull Request 运行分类快门禁；`workflow_dispatch` 对所选分支运行完整验证，`schedule` 每天北京时间 23:30 检查默认分支 main 最新提交。AI 不因局部修改、提交、推送或合并自行运行完整 verify；夜间或手动 Full verify 独立于 PR Gate。现行验证范围见 [ADR-0042](docs/adr/0042-pr-quick-check-and-scheduled-verify.md)。

代码 PR 失败时在任务分支修复并更新 PR，合并前核对该 PR 最新 SHA 的 `PR Gate` 结论；失败时读取步骤与产物，不能用旧 SHA 的绿灯或一次手动成功覆盖首发失败的根因。分支保护配置和工作树清理步骤见 ADR-0039 与 docs/11 §3/§8。

需要治理巡检时运行 `npm run drift:check`，触发、读数边界与基线更新条件见 docs/12 §1。不以规则数量或测试数量替代完成质量，也不通过重置基线掩盖发现。
