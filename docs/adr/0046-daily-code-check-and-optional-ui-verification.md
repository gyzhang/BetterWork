# ADR-0046：日常代码快检与按需 UI 验证

- 状态：Accepted（2026-10-14 用户确认日常只做快速代码校验，并指令修改工作流）。
- 日期：2026-10-14。
- 关系：细化 [ADR-0042](0042-pr-quick-check-and-scheduled-verify.md) 的 PR 检查范围；任务分支、受保护 main、完整 verify 入口、夜间计划和 UI 留证继续保留。
- 依据：[耗时调研](../reviews/2026-10-14-ci-verification-performance.md)、[工程规范](../12-engineering-standards.md) §1/§1.1/§9。

## 决策

1. 日常 PR 不运行构建、真实 Electron 渲染矩阵、截图、应用旅程或进程恢复。相关逻辑与组件行为测试继续执行；`scripts/ui-render-check.test.ts` 从快速测试调用排除，仍属于完整 `npm test` 的 heavy 档，不改测试档位或完整覆盖。
2. 代码 PR 的全仓类型感知 lint 与其他检查在独立 macOS runner 上并行，均成功后才通过 `PR Gate`。不采用仅按文件内容失效的 ESLint 缓存。功能测试后接重档，重档保持串行。
3. 格式检查针对基点至当前检出的改动文件；格式配置、忽略规则或依赖清单改变时回退全仓。使用同一份 Prettier 配置。删除文件不交给格式工具，重命名与带空格路径使用参数数组处理。
4. 纯 Markdown 只做文档检查。仅修改 `resources/skills/release-manifest.json`、`resources/experts/release-manifest.json` 及 Markdown 时进入资源档：格式检查、现有发布预检、实际清单通过 Skill/Expert 服务登记到临时 SQLite 的回归、文档检查。其他资源、未知路径、配置、脚本、混合代码及空差异均保守走代码档。
5. 本地统一入口为 `npm run check:quick -- --base <ref>`，缺省基点为 `origin/main`。脚本同时供 CI 分阶段执行，纳入未提交及未跟踪差异。非法基点、检查进程失败或被信号终止均返回失败；每步打印耗时，在 Actions summary 留证。
6. `npm run ui:check` 是已有的手动 UI 入口。GitHub 手动 Verify 增加 `scope=full/ui` 选择：缺省 full 运行完整 verify，ui 运行 UI CLI 回归及真实 UI 检查并保留截图/读数。夜间继续执行完整 verify。两种手动范围独立归组，PR Gate 不等待它们。
7. AI 不因 UI 文件变化或页面 Review 自动启动真实 UI 验证、页面走查或完整 verify；日常报告代码检查范围与 UI 未验证项。用户明确安排 UI 验证时再执行对应路径，夜间自动证据不代签人工验收。

## 边界与验证

- 本轮不并行化完整 verify、不改 ESLint 规则强度、不改变完整功能/heavy 档位，也不引入 TypeScript 持久化缓存；先用实际读数确认这轮收益。
- 三类差异互斥；分类失败、输出无效、对应检查失败/取消/跳过均拒绝合并。代码档同时要求 lint 与其他检查成功。
- CLI 夹具验证范围分类、差异格式选择及回退、失败中止、真实 UI 文件排除和资源消费者强制选择。结构测试执行实际 PR Gate 脚本正反例，并核对手动/夜间条件与成功/失败产物。
- 资源档必须读取实际清单、检查内容哈希及专家 Skill 引用，再通过生产登记服务和临时数据库验证；不依赖静态依赖图发现 JSON 文件读取。
- 快检通过只代表对应代码范围；完整验证或 UI 验证仍按其实际 SHA 与范围独立报告。
