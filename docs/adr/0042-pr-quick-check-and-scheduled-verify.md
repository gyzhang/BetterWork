# ADR-0042：PR 快门禁与按需、夜间完整验证

- 状态：Accepted（2026-10-08 用户同意 PR 快门禁、手动与夜间完整验证，并授权修改工作流和规则）。
- 日期：2026-10-08。
- 依据：[工程规范](../12-engineering-standards.md) §1/§1.1、[交接说明](../11-qoder-handoff.md) §3。
- 关系：替代 [ADR-0039](0039-task-branches-and-protected-main.md) 第 4、5 条中「所有代码 PR 合并前必须完整 verify」的验证范围；任务分支、worktree、受保护 main、必需状态 `PR Gate` 与资源清理继续按 ADR-0039 执行。

## 背景

局部修改的每次 PR 更新都会执行全量测试、构建和 Electron 页面检查。多轮更新叠加等待，不符合单人维护的日常节奏。用户希望小改动先通过快速检查并合并，在主动选择的时间或睡前运行完整验证。

## 决策

1. **PR 只自动执行快门禁**。目标为 `main` 的 PR 先检查差异空白并分类；代码或混合差异在 macOS 上执行 lint、format:check、typecheck、docs:check，以及 Vitest 按 PR base SHA 与依赖图选择的相关测试。功能档与重档依次运行，重档保持串行。纯 Markdown PR 只运行 docs:check。两种路径都由 `PR Gate` 汇总；分类失败或对应检查失败、取消、跳过时拒绝合并。
2. **完整验证只由用户按需触发或夜间计划触发**。`workflow_dispatch` 对用户选择的分支执行完整 `npm run verify`（lint + format:check + typecheck + test + build + ui:check）；`schedule` 每天北京时间 23:30（UTC 15:30）检查默认分支 `main` 最新提交。普通分支 push、PR 创建/更新与 main 合并后的 push 都不自动运行完整验证。AI 按任务做必要定向检查，不因提交、推送、合并或局部修改自行启动完整 verify。
3. **完整验证独立于 PR Gate**。PR Gate 的依赖不包含 Full verify；夜间或手动完整验证失败不追溯阻止已经完成的合并。只有 PR 快门禁通过时可以合并，不将其描述为全量验证通过。
4. **保留完整验证的诊断与证据**。失败上传渲染检查产物，成功上传 `.ui-render/results.json`。失败须读取该次 SHA 的步骤与产物，并在后续任务分支修复；不得把旧 SHA 的成功当作当前成功，或只重跑不记录根因。
5. **PR 与完整验证独立归组**。PR 更新取消同一 PR 的旧快门禁；手动和夜间运行分别按事件类型、分支归组，避免相互取消。

## 使用与边界

- GitHub Actions → Verify → Run workflow，选择 `main` 或待验收任务分支；CLI 等价入口是 `gh workflow run verify.yml --ref <分支名>`。手动选择任务分支验证的是该分支代码；PR 快门禁验证 GitHub 生成的合并候选。
- 夜间计划只能运行默认分支最新提交，工作流须合入默认分支后生效；GitHub 调度高负载时可能延迟，23:30 是计划时间。
- Vitest 的相关测试选择不保证覆盖动态文件读取或所有跨模块关系。配置、package.json 或广泛共享模块变化可能选择较多测试；快门禁始终不执行全量构建与 `ui:check`，完整验证仍负责整体集成回归。
- 人工验证、小范围自动测试、PR 快门禁和完整 verify 分别报告证据；发布或里程碑需要完整验证时，由用户明确安排并核对目标 SHA。

## 后果

- 小改动不再为每次 PR 更新等待完整 verify；纯 Markdown 的文档快检路径保留。
- 允许代码在完整验证前进入 main，整体集成问题可能到手动或夜间验证才发现，这是本次用户接受的工作流取舍。
- GitHub main 的必需检查仍叫 `PR Gate`，不需要关闭分支保护或改成直推。

## 验证

- 工作流护栏分别核对 PR 快门禁、纯文档路径、手动/夜间 Full verify、PR Gate 的依赖和失败收口、计划时间及产物留存。
- 对实际 PR Gate 脚本运行成功、分类失败和对应检查失败/跳过的夹具；本任务不自动触发完整 verify。

## 参考

- [GitHub 手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [GitHub schedule 事件与默认分支、调度延迟](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Vitest changed 测试选择](https://vitest.dev/config/changed)
