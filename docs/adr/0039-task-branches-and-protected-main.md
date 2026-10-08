# ADR-0039：任务分支、PR 门禁与受保护的 main

- 状态：Accepted（2026-10-05 用户决定从次日开始不再直接在 `main` 工作，并授权当天完成规则与仓库配置准备）。
- 日期：2026-10-05。
- 依据：[AGENTS.md](../../AGENTS.md)、[工程规范](../12-engineering-standards.md) §1/§1.1、[Qoder 开发交接](../11-qoder-handoff.md) §3/§8。
- 关系：取代 [ADR-0036](0036-macos-only-platform-scope.md) 中「单人工作直接在 main，main 不设保护」的流程决策；不改写 ADR-0036 的 macOS 平台范围。
- 后续：2026-10-08 [ADR-0042](0042-pr-quick-check-and-scheduled-verify.md) 替代第 4、5 条的完整验证范围，现行规则为 PR 快门禁、手动/夜间完整 verify；本记录保留当时的决策。

## 背景

单人开发也会同时打开多个 Codex 任务。多个任务共用 `main` checkout 时，编辑与暂存区会相互影响；每个代码提交跑全仓检查又会让一天多次提交的等待成本过高。之前的本地 pre-push 和 `main` push Actions 还会对同一批代码重复运行完整 `verify`。同时，BetterWork 已进入需要与 GitHub 合作者共同维护和推广的阶段，直接向 `main` 推送缺少统一的验证入口。

## 决策

1. **每个任务从 `main` 派生自己的任务分支**，完成后创建 Pull Request 合并回 `main`。`main` 只接受 PR 合并，不接受直接推送。Codex 默认使用 `codex/` 前缀；其他贡献者可使用清楚表达任务的分支名。
2. **每个并行写任务使用独立 worktree 和分支**。Worktree 提供互不覆盖的文件目录，分支保存提交历史；两者解决不同问题。顺序执行的任务可以复用同一个 checkout，但每次开始新任务前先回到最新 `main` 并创建新分支。
3. **提交时只跑按暂存范围选择的快检**：差异空白检查、暂存代码文件的 ESLint/Prettier，以及暂存 Markdown 的 `docs:check`。不在每次 TypeScript 提交时跑全仓 typecheck、测试、构建或 UI 检查。
4. **普通任务分支 push 不跑完整验证**。pre-push 核对工作树干净、推送对象等于当前 `HEAD`、差异没有空白错误，并拒绝推送目标为 `main`。完整代码门禁由 PR CI 收口。
5. **PR 验证按差异分类**：代码或代码与文档混合时，在 macOS runner 上执行一次完整 `npm run verify`；纯 Markdown 变更执行 `npm run docs:check`。稳定聚合检查 `PR Gate` 根据实际差异要求对应任务成功。`workflow_dispatch` 保留为手动完整验证入口；不在合并后的 `main` push 上再运行同一套完整门禁。
6. **保护 GitHub `main`**：必须通过 Pull Request，必需状态检查为 `PR Gate`，分支须基于最新 `main`，禁止强推与删除，并对管理员生效。当前是单人维护，不要求审批数；将来合作者需要强制互审时再调整审批规则。
7. **任务合并后清理短期资源**：确认 PR 已合并并且工作树没有未提交内容后，删除远端与本地已合并任务分支；Codex 管理的 worktree 归档或移除。未合并分支或有未提交内容的 worktree 保留。

## 后果

- 多次提交仍保留逐提交历史，但本地提交快检不会重复跑全仓验证；一次 PR 对最终差异执行对应的 CI 门禁。
- 工作分支可以在一天中积累多个提交，按个人节奏一次推送；推送只发布分支，不代表验证完成，PR Gate 通过才允许合并。
- 并行任务通过 worktree 隔离文件与 Git 暂存区。合并后的 `main` 是可供下一个任务派生的干净基线。
- 纯 Markdown 变更不会触发 lint、typecheck、测试、构建或 UI 检查，但仍经过差异空白和文档结构检查。
- 直接 push `main` 的旧习惯停止使用；若 PR CI 失败，应在任务分支修复并更新 PR，而不是绕过保护。

## 验证

- 仓库钩子、PR 工作流、差异分类脚本和结构护栏按本 ADR 更新并验证。
- GitHub `main` 的分支保护以实际 API 读回结果为准，PR 合并通过 `PR Gate` 完成。
