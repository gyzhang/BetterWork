# 执行追踪：GPT-6 Luna 目标模式交接

- 日期：2026-10-16。用户明确选择 GPT-6 Luna；本文不切换当前模型、不创建新聊天、不在本轮激活开发目标。
- 真相源：[AT 唯一任务板](tasks-execution-tracing.md)、[实施契约](execution-tracing-contracts.md)、[ADR-0050](../adr/0050-run-execution-diagnostics.md)。状态不在提示词中维护。
- 用法：用户在新开发聊天选择 GPT-6 Luna，开启目标模式后粘贴一个完整目标；首次推荐 §2。跨卡连续执行已在提示词中授权，卡片是检查点，不是每次都要向用户问“继续”的停点。

## 1. 编排依据与工作区交接

[OpenAI Docs 的 GPT-6 Luna 模型页](https://developers.openai.com/api/docs/models/gpt-6-luna)将其定位于聚焦任务；[目标模式指南](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)建议为目标给出完成条件、验证依据、约束、边界、迭代规则与阻塞条件。下面的小卡/分期是本项目的工程选择，不是官方对单卡大小、预算或成功率的保证。无需修改任何 API 参数或模型注册表来使用这些任务卡。

计划编制时位于 `/Users/kevin/Dev4AI/BetterWork` 的 `codex/agent-execution-tracing-analysis`，文档可能尚未提交/合入 main。新聊天开始先确认能读到这三份入口：若使用同一本地目录，保留已有文档和日志；若另建 checkout/worktree，只能从实际包含文档的分支/提交取得它们，不能假定 origin/main 已有。缺文件时先查已提供的本地目录和分支，不凭空重建，也不擅自提交、reset、clean 或搬走用户改动。

新实现目标采用自己的 `codex/` 任务分支，基于当时最新可用主线并保留所需文档。若当前目录仍有其他写任务，暂停共享目录写入，说明具体占用后等待用户处理或采用已有授权允许的独立 worktree；不共享暂存区。本文不授权归档尚未合并的工作。

## 2. 首次推荐：完成第 1 期（AT01–AT10）

```text
请用 GPT-6 Luna，以目标模式完成 BetterWork 执行追踪的 AT-M1（AT01–AT10），直到用户能从工作页过程入口查看当前或历史 Run 的逐轮模型与工具执行链，且该范围的离线回归和日常快检全部通过。

工作区：/Users/kevin/Dev4AI/BetterWork。
本次明确采用 docs/adr/0050-run-execution-diagnostics.md 和 docs/development/execution-tracing-contracts.md 的技术提案，授权 AT01–AT10 的产品实现、必要离线测试、文档与日志更新。不要重复询问已接受的产品方向，也不要自动把 ADR 改为 Accepted。

先读 AGENTS.md、.qoder/rules/betterwork.md、docs/12-engineering-standards.md 的相关章节、docs/development/tasks-execution-tracing.md、execution-tracing-contracts.md、ADR-0050，以及每卡指定源码。UI 卡读 docs/10-ui-ux-system.md 的实际台账和相关章节。调研报告是参考快照，实施字段/行为以契约为准。

先执行 date，核对 HEAD、分支、git status、计划文档可见性、前置卡证据、最新迁移号和当前测试档位。使用自己的任务分支，不覆盖、重置或提交已有改动；共享目录仍有写任务时遵守独立 worktree 规则。发现真实文件冲突先停止冲突部分并给事实，不用丢弃用户内容来制造干净工作树。

按 AT01→AT10 串行，每次只推进一张卡：写最小行为反例并确认预期红灯，再实现、绿跑、必要重构回归，记录证据后在本目标授权范围内自动进入下一卡。不要每卡结束就停下等待“继续”，不要创建其他聊天、委派子智能体、切换模型或重做整套架构。

保持 Core AsyncIterable 有序事件、Application 先持久化再广播、SQLite 真相源、材料/记忆权限和现有唯一终态；宿主阶段暂不插入 Core sequence。模型 usage 缺失保持未知，tool-only 可追踪，参数拒绝不伪造执行；不展示 reasoning、不记录完整模型请求或凭据。不要加入重试、断点续跑、自动优化、OTel 服务或额外模型设置。

验证只使用 Fake Provider、注入 fetch/clock、临时 SQLite/目录与 React/IPC 合约替身，不读私有资料、不调用真实模型或外部服务。定向测试按 vitest.config.ts 选正确档位，RunService/App 的 heavy 测试不能在 functional 中空跑。每卡执行 npm run check:quick -- --base <有效基点>，失败修复后再推进；新增/修改生产代码的差异覆盖遵守现有 80% 门槛。不得自动运行完整 verify、ui:check、真实页面走查或强杀用户应用。

只有 AT01–AT10 的验收成立、当前快照快检成功、中文回读/差异检查通过、唯一任务板和当日日志证据齐全，才将本目标标完成。真实 UI、真实模型、性能与安装未验要明确列出；AT11–AT25 不在本次范围，保持其真实状态。不要提交、推送、创建 PR 或发布。

遇到产品范围、数据迁移或安全边界冲突，或方案连续两层障碍，停止相关变更，给出尝试、证据、最小替代方案及所需输入；不要默改契约或因预算耗尽宣布成功。压缩上下文后从任务板第一张未完成且已授权的卡继续，不重置已完成工作。最终用中文交接实际结果、命令退出码、迁移号、文件与未验证项。
```

## 3. 继续某一阶段

下面模板复制后，只把【阶段】和【范围】替换为表中同一行的值；不要将单独验收卡混入离线范围。正文其余约束保持。

| 阶段 | 范围 | 前置必须已有实际证据 |
| --- | --- | --- |
| AT-M2 | AT11–AT16 | AT10 |
| AT-M3 | AT17–AT20 | AT16 |
| AT-M4 | AT21–AT22 | AT20 |

```text
请用 GPT-6 Luna，以目标模式连续完成 BetterWork 执行追踪【阶段】，本次授权范围为【范围】及其必要离线测试、文档和日志；完成条件严格采用 docs/development/tasks-execution-tracing.md 的对应里程碑和卡片验收。

采用 docs/adr/0050-run-execution-diagnostics.md 和 docs/development/execution-tracing-contracts.md 的技术提案；AGENTS.md、共同纪律、docs/12 是现行工程约束，UI 以 docs/10 §10.1 的真实台账为准，不复制旧任务板的完整 verify/真实 UI 要求。

从 /Users/kevin/Dev4AI/BetterWork 开始，核对 date、HEAD/分支/工作树、文档可见性、最新迁移、正确测试档位和前置实际证据；缺少前置实现时报告准确缺口，不越权替其他阶段重新实现。使用独立任务分支，保留用户改动，不共享并行写目录。

在授权范围内逐卡红跑→实现→绿跑→必要回归→快检→日志/任务板留证，随后自动继续下一卡。一次只推进一张，不向其他智能体委派，不创建新聊天或自动换模型。每卡 npm run check:quick -- --base <有效基点>；不自动执行 verify、ui:check 或真实页面走查。临时库/合成材料/Fake Provider/注入 fetch 和时钟验证，不触网、不修改用户库。

业务 Journal/权限审计继续严格收口；新增宿主诊断失败只影响诊断完整性，不改变 Run 业务结果。两条事实流不共享序号，精确修订不被 latest 替代，未知指标不变 0，取消/清理/提交语义不回退。JSON 诊断包只含契约白名单元数据，不复制正文、路径或密钥。

达到本阶段验收且当前快照快检通过、中文回读/差异检查/唯一状态板/当日日志证据齐全后完成目标；不要越过授权阶段。AT23–AT25 仍单独指派，未验项如实交接，不提交、推送、建 PR 或发布。

普通实现选择自行推进；实质范围/安全/数据冲突或连续两层技术障碍先停下给具体证据和备选路径，不默改契约、不以耗尽预算当完成。上下文压缩后从唯一任务板恢复当前授权卡。
```

## 4. 完整离线目标（AT01–AT22）

用户希望一次持续推进全部离线开发时，使用下面完整目标；它不要求每阶段重新确认。推荐先阅读 §2 的单阶段目标，评估是否采用该较大范围。

```text
请用 GPT-6 Luna，以目标模式完整实现 BetterWork 执行追踪的离线范围 AT01–AT22。目标结果是：逐轮模型与工具执行链、宿主阶段与精确来源、统一时间轴、范围内统计、问题标记与脱敏本地诊断包均接入现有产品，固定合成样本回归和当前日常快检通过，并完成证据交接。

工作区 /Users/kevin/Dev4AI/BetterWork。采用 docs/adr/0050-run-execution-diagnostics.md、docs/development/execution-tracing-contracts.md 的技术提案；本次授权 AT01–AT22 的实现、必要离线测试及文档/日志更新。用户已接受产品方向，无需重复询问，也不自动将 ADR 改为 Accepted。

开始读取 AGENTS.md、共同纪律、docs/12 相关章节、docs/development/tasks-execution-tracing.md、execution-tracing-contracts.md、ADR-0050 和各卡指定源文件；UI 卡读取 docs/10 §6.1/§8/§9/§10.1/§11.5/§12 的实际契约。先核对 date、HEAD/分支/git status、任务文档可见性、前置证据、迁移与测试档位；计划未入 main 时保留原文档，不凭空重建或覆盖用户改动。使用独立任务分支；并行写任务使用独立 worktree。

严格按卡片依赖串行，只推进一张卡至其验收和快检通过，更新唯一状态板/当日日志后自动进入下一卡与下一阶段。不要因阶段完成就结束整个目标或等待“继续”。不要创建其他聊天、委派智能体、自动切换模型或另造任务板。上下文压缩后从现有证据和第一张未完成且已授权的卡恢复，不回滚已有工作。

实现保持现有 Core/Provider/Application/IPC 分层、先落库再广播、SQLite 真相源和原有材料/记忆权限。Core sequence 与宿主 diagnosticSequence 独立；Run 终态仍由 Application 提交。未知 usage 保持未知；局部失败与最终失败区分；精确修订不取 latest；诊断与导出不泄漏请求/工具正文、reasoning、路径或密钥。不得引入自动重试/恢复、自动改 Expert/Skill/Memory、付费后台重跑、远程监控服务或新引擎。

按 docs/12 执行最小反例红跑→实现绿跑→必要重构回归，已有覆盖复用并如实记特征证据；每卡运行 npm run check:quick -- --base <有效基点>，失败修复后继续，差异行覆盖遵循现有 80% 门槛。测试仅用 Fake Provider、注入 fetch/clock、临时 SQLite/目录、合成资料与现有 React/IPC 合约替身。RunService/App 按实际 heavy 档执行，不以空测试运行作证。不要自动运行完整 verify、ui:check、真实页面走查，不修改用户实际库或强杀用户应用。

目标只在 AT01–AT22 全部验收成立、当前快照快检成功、必要文档/中文回读/差异检查及日志证据齐全时完成；AT22 必须列明真实 UI、真实模型、安装、性能等未验项。AT23 人工 UI、AT24 真实模型、AT25 可选 OTLP 全部排除，不因它们 todo 而无限等待，也不把它们标 done。不要提交、推送、创建 PR 或发布。

遇产品/安全/数据策略冲突、用户已有改动冲突或连续两层技术障碍，先停止受影响变更，报告已尝试路径、证据、最小备选和所需输入；常规编码选择持续推进，不默改契约。预算耗尽或阶段性进展不能当作完成。最终中文交接当前代码版本、实现范围、迁移号、红绿/快检命令及退出码、关键文件与未验证项。
```

## 5. 单卡修补与中断恢复

```text
请用 GPT-6 Luna 只完成 BetterWork 执行追踪【AT卡号】及必要离线测试/文档。以 tasks-execution-tracing.md 当前卡片、execution-tracing-contracts.md、ADR-0050 和 AGENTS/docs/12 为准，UI 再按 docs/10。先核对 date、当前代码/工作树、前置和已有证据；已有实现先复核，不重复重写。按本卡反例与验收红绿验证、check:quick、中文回读，更新唯一任务板与当日日志。不要推进下一卡、调用真实模型、自动启动真实 UI/完整 verify、委派、提交、推送或发布。遇边界冲突给具体事实与最小下一步，不以部分完成作成功交接。
```

恢复已有连续目标时，用户可直接发送：“继续执行已授权的 AT 范围，从唯一任务板第一张未完成卡恢复，保持原授权边界。”这只是恢复已有范围，不自动扩大至 AT23–AT25，也不继承其他系列的数据重置或发布授权。

## 6. 每卡交接摘要

按“已实现 / 自动化通过 / 真实 UI 是否安排 / 待人工或真实模型验收”分别说明，给出当前 HEAD/工作树、行为变化、失败与取消结果、涉及文件/迁移、实际命令和退出码、卡片状态/日志，以及仍缺证据。无需复制整份契约或测试输出；原始数据不含私有资料或密钥。完整离线目标中这份摘要是阶段记录，不是停止继续的理由。
