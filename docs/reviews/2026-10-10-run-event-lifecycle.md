# C4：Run 事件消费与终态协调

2026-10-10 06:10，用户授权继续 C3 之后的事件消费与终态整理。从干净 main `3532e952e9c98b16115e0407142c61f25c1de0e6` 建立 `codex/review-run-event-lifecycle`，使用原 checkout，不新建 worktree。

## 实施边界

在现有 Application 层抽取 `RunEventLifecycle`，集中事件持久化、候选终态消费、资源清理与失败/取消兜底。RunService 继续拥有上下文与工具装配、启动/取消、活动 Run 和消费 Promise 注册表、结果适配/广播/通知、定时结果等待及成果/记忆回调。消费的外围 catch 和 finally 保留，准备阶段的异常也必须进入同一恢复入口。

没有跨模块依赖、核心领域关系、协议/迁移、安全边界或关键技术变化，无需新增 ADR；工程规范只补充现行实现的调用落点，不改变规则或例外。

## 顺序契约

1. 普通事件先写 Run Journal，再执行工具结果适配并广播。第一个引擎终态只作为候选；完成内容先经材料事实审计。流无终态必须失败，首个终态后的事件不再消费。
2. 正常候选终态先等待 Skill `finishRun`，再释放 MCP；成功 Run 随后登记用户请求的 Markdown 成果，最后持久化/广播终态。完成后的连续简报同步与记忆入队仍由原回调处理。
3. 保留已有 Skill 清理失败的快速失败分支：直接 forceFailure，不发布候选成功/取消，也不继续后面的 MCP/成果路径。其他异常按既有顺序先尝试 MCP 释放，再尝试 Skill 清理；恢复中的清理错误追加到失败说明。
4. 只有信号已取消、原错误属于 AbortError 且清理成功时，恢复入口才合成 cancelled；普通异常和清理失败均 failed。取消序号接续持久化日志；forceFailure 只处理仍在 running 的 Run，已提交终态不会被后续错误改写。
5. 定时结果仍在消费 finally 内等待，然后移除活动 Run；普通取消保持静默。启动恢复和撤权不迁移，不改变取消与候选终态竞争的现有裁决。

本批用真实 SQLite 固定上述边界，保留现有 RunService、来源、记忆和定时集成回归。现有清理失败快速分支与完成后的错误处理不借抽取改写；更全面的清理重试或取消裁决属于另行评估的行为变更。

## 验证与状态

开始巡检的规则与规模保持，只有本批日志尚未新增；最初误用 `--base` 已改为巡检支持的 `--batch-base`。本批不运行完整 verify、不调用真实模型、不访问用户数据库或启停开发应用。定向检查、离线应用/恢复、精确 SHA 的 PR Gate 与合并证据完成后追加。


2026-10-10 06:17 本地证据：终态模块 27 项、既有 AppStore 27 项与相关来源/成果/记忆/定时/IPC/护栏回归通过；functional 按文件去重共 9 文件 / 331 项，RunService heavy 86 项（新增 2 项），合计 10 文件 / 417 项。覆盖清理阻塞期间无终态/通知/成果、定时结果等待及 shutdown、无终态流、审计/登记/分发失败、清理失败与取消、持久化后异常和重复收口。两次顺序破坏探针分别被测试检出：颠倒 Journal/dispatch、提前提交 completed；恢复后测试通过，日志留在 `/tmp/betterwork-c4-journal-order-probe.log` 与 `/tmp/betterwork-c4-terminal-order-probe.log`，不提交。

初次新夹具缺 run.started 的 taskId/sessionId，被协议 Schema 全部拒绝，已补真实 Task/Session 字段；新集成夹具采用 Promise.withResolvers 在运行时可用但不在仓库 ES2022 类型范围内，已改普通 Promise 门闩。没有改协议、tsconfig 或断言绕过失败；定向 lint/format、typecheck 与生产 build 已通过。RunService 从 2,066 行到 2,009 行，新模块 111 行，按 wc -l 的物理行口径，生产源码总量净增 54 行，收益是单独可测的顺序边界。

真实 App/Preload/IPC/临时 SQLite 的 app-only 旅程完成 4 个 Run（完成/失败/取消及重开），网络尝试 0；AI 回读取消与重开截图。证据在 `/var/folders/kq/ts17kvnd5yg2kjtkx645y1zw0000gn/T/betterwork-ui-render-erKiTK`。独立进程 recovery-only 通过，强杀自己的合成宿主后以新 PID 恢复，普通/定时遗留 Run 收口、定时结果只恢复一次、成果/版本和合成源文件保持、请求/网络尝试均 0；证据在 `/var/folders/kq/ts17kvnd5yg2kjtkx645y1zw0000gn/T/betterwork-ui-render-fJZdu5`。已核对恢复宿主 bundle 中两处顺序为正常实现；不计入破坏探针。未运行完整 verify、全 UI 矩阵、真实模型或安装态人工验收；最新 SHA 的 PR Gate 与合并继续收口。


2026-10-10 06:18 治理终检：原批次基点的 drift:check 通过并保存读数；测试文件 244、粗略用例声明 2,145、护栏 154、例外 203、配置块 6、规则文件 7。规则指纹与例外保持；巡检源码读数 97,022（净增 55），它按换行分割计数，新文件的尾部空项使增量比 wc -l 多 1，并非另一项代码变更。保存后再查确认没有漂移。最终文档检查与源提交随后收口。


2026-10-10 06:23 远端收口：源提交 `97e805ead7ba2e64f2ec9f761517fda2bf2287a6` 的 [macOS PR Gate](https://github.com/gyzhang/BetterWork/actions/runs/37998559802) 成功；静态快检、文档护栏 154、相关 functional 101 与 heavy 86 项通过，CI 共 6 文件 / 341 项，Full verify 跳过。本地额外执行的结果适配、KnowledgeAudit、成果采用声明与 AppStore 共 76 项不混入 CI 数字；build、app-only 和 recovery-only 沿用本地证据。

[PR #36](https://github.com/gyzhang/BetterWork/pull/36) 已 squash 合入 main，合并提交 `4b1783f0087f013414a328255478c0a5b3d0e4e6`。原 checkout 已同步 main，代码分支本地/远端均已删除，没有新建 worktree；从此提交建立 `codex/review-c4-closeout`，仅以 Markdown 归档最终证据。C1–C4 的计划切片完成，R06 的其他上下文/工具职责与 C2 事实关联限制仍如前述，不宣称全部重构结束；后续按已接受顺序进入 D 的 Task 草稿/请求生命周期整理，待下一次开发指令。
