# 参与 BetterWork 开发

BetterWork 当前采用单人主导的 AI+Human 工作流：人类描述需求、判定方案并做最终人工验收；Codex/Qoder 承担已授权范围内的设计、开发、测试、Review 与交接。内部开发直接使用 `main`，不要求每项工作建 Issue、Fork、PR 或寻找另一位人类 Reviewer。外部贡献可以通过 Issue/PR 交流；它们不是内部开发的前置门槛。

本文件只提供入口，不建立第二套规范。产品与授权边界读 [AGENTS.md](AGENTS.md)，执行流程读 [工程规范 §1](docs/12-engineering-standards.md)，UI 设计与页面检查读 [UI/UX §10.1](docs/10-ui-ux-system.md#101-组件台账与基座纪律)，实现和验收状态查对应任务板。遇到冲突，同轮修正错误的说明，不用本指南覆盖已接受的 ADR。

## 环境与启动

产品、开发与 CI 只支持 macOS（darwin/arm64），见 [ADR-0036](docs/adr/0036-macos-only-platform-scope.md)。Node 的版本真相源是 `.nvmrc`；`package.json` 的 engines 定义最低版本。

```bash
npm ci
npm run verify  # lint + format:check + typecheck + test + build + ui:check
bash scripts/dev-start.sh
bash scripts/dev-stop.sh
```

产品启停、数据位置、密钥与日志边界按 [交接说明 §3](docs/11-qoder-handoff.md) 执行。开发日志位于 `/tmp/betterwork-dev.log`；当前没有承诺 `~/.betterwork/logs/` 生产日志目录。报告 Bug 时给出复现步骤、版本、期望/实际行为与已脱敏证据，不粘贴密钥或完整用户资料。

## 完成与交接

开始任务先检查已有改动，按 AGENTS 的任务路由读取唯一规范和相关设计。UI 的页面分支、状态、反馈出口、明暗与窄窗证据按 docs/10 §10.1 提供；AI 完成自动验证与自身走查，再把可复查的验收步骤交给人类。不能把组件冒烟全绿写成完整页面或真实模型语义已验收。

提交前由 AI 运行完整 `npm run verify`；pre-commit 强制快检，pre-push 强制对干净且与推送对象一致的 HEAD 跑完整门禁。执行与证据要求只在 docs/12 §1 维护。每项任务更新对应状态和当日工作日志，注明未验证项；提交、推送、真实模型调用与发布按已有授权分别执行。

GitHub Actions 在 `main` push、Pull Request 和手动触发时执行门禁；其他分支的普通 push 不触发本工作流。失败上传渲染截图与读数，成功留存读数。`main` 不设分支保护是既定决策，CI 是推送后的信号；AI 必须核对本次提交 SHA 的运行结论，不能用旧提交的绿灯或一次手动成功覆盖首发失败的根因。

需要治理巡检时运行 `npm run drift:check`，触发、读数边界与基线更新条件见 docs/12 §1。不以规则数量或测试数量替代完成质量，也不通过重置基线掩盖发现。
