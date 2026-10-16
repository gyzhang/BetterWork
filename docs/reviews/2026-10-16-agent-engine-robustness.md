# Agent 引擎健壮性审查

- 审查时间：2026-10-16 20:40（北京时间，来自 `date`）。
- 代码基线：`85a5c0d93e9fc34c2d9424207248e64d8433a829`，原分支 `codex/builtin-skill-expert-planning`。
- 报告分支：`codex/agent-engine-review`，独立 worktree；原工作区的 Skill 与日志未提交改动保持原样。
- 结论：发现 10 项问题，按本轮影响判定为 6 项 P1、4 项 P2。其中包含历史契约明确保留的高风险行为，不能把修复实施为无文档的语义变更。本轮完成审查与离线复现，修复尚未实施。

## 1. 故障核实与覆盖范围

按 GATE-0 先只读检查 SQLite，再读 `/tmp/betterwork-dev.log`，最后阅读实现。默认库的普通只读连接无法打开 WAL 模式数据库，目录核对确认当前没有 WAL/SHM 后，使用只读 `immutable=1` 连接；未写入产品库。

本机库有一条失败 Run：`b6f968ef-9bb4-4edd-acb5-c1f5e025637f`。其事件序号 1381 为 `run.failed`，错误是 `Unknown tool: web_answer`。这证明用户报告的故障确实发生过。当前基线已经包含 `725ef9c0` 的未知工具恢复和 `85a5c0d9` 的 Provider 关联诊断。离线对照确认：未知工具产生 `tool.failed` 后，模型收到反馈并在第二次请求完成。本轮不把已修复问题重复列为新发现，也不据此认定用户运行中的构建已加载新源码。

审查覆盖：

- Agent Core 的消息装配、ReAct 循环、同轮多工具、错误边界、进度、取消、轮数上限和终态。
- OpenAI-compatible Provider 的请求构造、SSE 分片、工具参数、完成原因、超时及请求关联信息。
- RunService 的准备、工具装配、能力绑定、结果适配、事件 Journal、终态协调、成果登记和退出。
- Tool Runtime 的参数校验及读写/脚本入口；MCP 的工具桥接、Run 资源所有权及释放。
- 历史与记忆派发边界、固定材料范围及已有相关测试。

未执行真实付费模型调用、开发应用启停、Electron UI 走查、完整 `verify`、提交或推送。Office 解析器、模型服务端内部行为与 macOS 原生进程监督器没有另做全量审计。

## 2. 发现清单

| ID | 优先级 | 问题 | 验证层级 |
| --- | --- | --- | --- |
| F01 | P1 | 损坏的工具参数 JSON 直接终止 Run，模型失去纠正机会 | Core/Provider 离线探针 + 真实 RunService/临时 SQLite 红跑 |
| F02 | P1 | 合法 JSON 的非对象参数逃过 Provider 校验，直到 Journal 拒绝整个 Run | Core/Provider/校验边界探针 + 真实 RunService/临时 SQLite 红跑 |
| F03 | P1 | 取消信号在工具派发和进度排水边界漏检，可能继续执行或挂起 | Core 离线时序探针 |
| F04 | P1 | 收尾期间接受取消后仍发布成功，并登记成果 | Core/Lifecycle 探针 + 真实 RunService/临时 SQLite 红跑 |
| F05 | P1 | MCP 释放失败丢失所有权，shutdown 又吞掉清理错误 | 真实 McpClientService 方法 + 合成连接故障注入 |
| F06 | P1 | Skill 清理失败直接返回，MCP 清理被跳过 | 真实 Lifecycle + 合成清理端口；既有测试明确固化该分支 |
| F07 | P2 | 内容过滤完成原因仍被记为成功，甚至产生空成功回复 | Core 离线探针 |
| F08 | P2 | 已收到 SSE `[DONE]` 仍等待连接 EOF | Provider + 保持打开的合成 ReadableStream |
| F09 | P2 | 缺失上游工具 ID 时跨轮复用 `tool-0`，破坏调用身份 | Provider/Core 两轮离线探针 + 下游身份消费者静态核对 |
| F10 | P2 | 工具同步抛错越过可恢复边界，直接终止 Run | Core + 符合接口类型的合成 AgentTool |

### F01 — 损坏的参数 JSON 被升级为 Run 失败

位置：[openai-compatible-provider.ts:269](../../packages/agent-core/src/openai-compatible-provider.ts#L269)。

Provider 在流结束后集中 `JSON.parse(call.arguments)`，任一解析失败就直接抛错，且全部调用解析完成之前不发出任何 `tool-call`。因此一次模型参数错误不仅结束 Run，还会丢掉同轮其他合法调用的执行机会。Core 的 `tool.failed → 工具结果 → 模型纠正` 分支根本接不到这个错误。

最小输入是一个已经正常结束的 SSE 工具调用，`function.arguments` 为 `{"x":`。实测只有 1 次模型请求、0 条 `tool.failed`，终态为 `run.failed`。真实 RunService 与临时 SQLite 的回归要求它反馈并继续，实际同样失败。

修复应让工具参数解析失败成为有调用 ID 的结构化失败；保留原始格式错误事实，同时禁止执行，不要静默换成 `{}`。该错误类型跨 Provider/Core 的表达需先明确协议或内部接口契约。同批合法调用仍应按既有顺序处理，并受轮数预算约束。

### F02 — 非对象参数把模型失误变成 Journal 异常

位置：[openai-compatible-provider.ts:269](../../packages/agent-core/src/openai-compatible-provider.ts#L269)，消费边界是 [agent-protocol/src/index.ts:6](../../packages/agent-protocol/src/index.ts#L6) 与 [run-repository.ts:114](../../apps/desktop/src/main/persistence/run-repository.ts#L114)。

`JSON.parse(...) as Record<string, unknown>` 只做 TypeScript 断言，不会检查运行期值。`null`、数组、字符串和数值都能被 Provider 当作工具输入发出。Core 随即产生 `tool.requested`，而共享事件 Schema 要求 input 为对象；Journal 会在工具自己的参数校验之前抛错，编排层只好将整个 Run 标记失败。

`arguments: "null"` 的实测持久化事件只有 `run.started → run.failed`，模型请求 1 次。真实 RunService/SQLite 回归也复现该结果。修复应在外部数据进入类型化工具事件之前收窄形状，并沿可恢复工具错误路径反馈；不能放宽 Journal Schema 来接纳非法事件。

### F03 — 取消在派发与进度排水边界丢失

位置：[agent-engine.ts:221](../../packages/agent-core/src/agent-engine.ts#L221) 与 [agent-engine.ts:245](../../packages/agent-core/src/agent-engine.ts#L245)。

Core 在 `tool.started` 的 yield 后直接注册 abort 监听并调用 execute，没有检查 yield 期间是否已经取消。如果取消早于监听器注册，监听器也不会补收到事件。另一个窗口在进度排水：`yield nextProgress` 之后直接 continue；若取消落在 yield 期间，`wakeForProgress` 此时为空，取消唤醒被丢掉，下一轮会重新等待尚未完成的 execution。

离线复现两种情况：

1. 消费到 `tool.started` 时取消，合成工具仍被执行，副作用计数为 1，之后才得到 `run.cancelled`。现有内建工具大多自行检查 signal，能减轻该风险；Core 的 AgentTool 接口没有强制这一前置保护。
2. 工具同步报告两条进度后等待门闩，消费第一条进度时取消；第二条进度仍发出，Run 继续等待，必须手动释放工具门闩才得到取消终态。等待窗口只是观察是否挂起，不是性能阈值测试；结束时已释放自己的全部门闩。

修复应在工具派发前、每次 yield 恢复后、进入等待前检查 signal，并让取消等待状态保持可观察，不能只依赖一次性 wake 回调。Core 的及时取消与宿主对外部资源的清理确认仍需分层：不能以抢先发出取消事件替代宿主清理。

### F04 — 已接受取消的 Run 仍登记成功成果

位置：[run-event-lifecycle.ts:59](../../apps/desktop/src/main/services/run-event-lifecycle.ts#L59)；取消入口在 [run-service.ts:527](../../apps/desktop/src/main/services/run-service.ts#L527)。Core 的对应窗口在 [agent-engine.ts:168](../../packages/agent-core/src/agent-engine.ts#L168)。

Lifecycle 收到候选完成后会等待 Skill/MCP 清理，此时数据库仍为 running，RunService 仍持有 active Run，`cancel()` 返回 true。但 Lifecycle 不接收 signal，清理后直接登记 Markdown 成果并发布原候选 `run.completed`。Core 在 `message.completed` yield 后也会直接发成功终态，没有复查取消。

离线宿主探针得到 `aborted=true / artifactSaved=true / run.completed`。真实 RunService 回归在清理门闩期间调用 `cancel()`，返回 true，清理后实际 status 仍是 completed，预期 cancelled 的断言红跑。

修复前需明确提交点：建议在终态/成果提交之前仍接受取消，则取消应参与最后裁决；如果已越过不可逆提交点，则取消入口应明确拒绝。清理失败始终不得被覆盖成安全取消。[C4 顺序契约](2026-10-10-run-event-lifecycle.md) §5 明确保留了旧的竞争裁决，实施时应先修订该保留行为和相应测试。

### F05 — MCP 清理失败既不能重试，也不能阻止退出

位置：[mcp-client-service.ts:565](../../apps/desktop/src/main/services/mcp-client-service.ts#L565) 与 [mcp-client-service.ts:579](../../apps/desktop/src/main/services/mcp-client-service.ts#L579)。

`releaseRun` 在关闭连接之前就从 `runs` 删除记录。如果任一 close 失败，第一次释放虽抛错，随后的恢复释放已经找不到该 Run，立即成功返回；并发释放也不会等待同一个清理 Promise。失败资源没有留下所有权和再次确认的入口。

此外，`shutdown()` 对 OAuth、在途操作和 Run 释放执行 `Promise.allSettled`，但不检查 rejected 项。注入一个会抛错的 close 后，实测再次 release 的 close 总调用次数仍为 1、Run 记录已不存在；独立 shutdown 探针也只有 1 次失败 close，却正常 resolve。上层 `shutdownApplication` 因而无法得知该清理失败，和架构 §3.1 要求的“清理失败保留数据库、退出尝试可重试”不一致。

应持有运行中/失败中的释放记录，共享清理 Promise，全部资源确认关闭后才移除所有权；shutdown 应聚合真正的清理失败并向上抛出。正常操作被取消和资源无法清理须分别处理，不能把所有 rejection 一概吞掉或一概判成退出失败。

### F06 — Skill 清理失败阻断 MCP 清理

位置：[run-event-lifecycle.ts:54](../../apps/desktop/src/main/services/run-event-lifecycle.ts#L54)。

`finishSkills` 抛错或返回 `cleanupFailed > 0` 时，代码发布失败后直接 return，没有尝试 releaseMcp，也不会进入外围 recover。对于同时持有 Skill 和 MCP 的 Run，MCP 连接/本地服务进程仍可能保留到应用退出。

故障注入结果是 `run.failed / releaseCalls=0`。现有 `turns a cleanup-failure report ...` 参数化测试甚至明确要求 `mcpReleased === false`。这不是缺少几条断言，而是测试已经固化了有风险的行为。[C4 顺序契约](2026-10-10-run-event-lifecycle.md) §3 也明文保留该快速失败分支，不能直接改代码后宣称契约未变。

应把各类清理设计为独立尝试并聚合结果。Skill 清理失败阻止成功终态和成果提交，但不应阻止另一类资源的释放。按仓库规则先调整该契约，再用“两个资源同时存在、其中一个清理失败”的组合回归约束实现。

### F07 — 内容过滤被误判为成功

位置：[agent-engine.ts:157](../../packages/agent-core/src/agent-engine.ts#L157)。

Provider 已把 `content_filter` 归一化为 `content-filter`，Core 却只处理 length；没有待执行工具就无条件成功。只返回 `done(content-filter)` 时，实测终态是 `run.completed`，finalContent 为空。上层普通任务会生成成功结果；已有的输出截断测试只参数化了 length。

应对每种 ModelFinishReason 明确裁决，过滤/异常结束需要可解释的未完成结果；同时定义没有可见回答且没有工具的完成语义。不能把“流结束”直接等同于“用户工作完成”。

### F08 — 已收到 `[DONE]` 仍依赖 HTTP EOF

位置：[openai-compatible-provider.ts:248](../../packages/agent-core/src/openai-compatible-provider.ts#L248)，标记位置为同文件 212 行。

收到 `[DONE]` 只设置 completed，读取循环仍一直 `reader.read()` 到 result.done。工具调用也要等到这个循环退出才发出。若兼容网关已经发送结束标记但连接继续保持，答案/工具会卡住；真实 fetch 最后可能因 300 秒总超时失败。finally 仅 releaseLock，也没有在提前结束/消费被关闭时主动 cancel reader。

保持打开的合成 ReadableStream 已发送答案、stop 和 `[DONE]`，实测 Run 仍 pending；手动 close 后才完成。现有测试助手均在 start 里立即 close，覆盖不到这个差异。

应区分 choice 的 finish_reason、尾部 usage 和传输终止标记：保留 finish_reason 之后、`[DONE]` 之前的 usage，遇到 `[DONE]` 则完成消费并取消/释放未结束的响应体。无 `[DONE]` 但有 finish_reason 的现有兼容路径仍须保留相应边界测试。

### F09 — 补造工具 ID 在跨轮重复

位置：[openai-compatible-provider.ts:235](../../packages/agent-core/src/openai-compatible-provider.ts#L235)。

缺失上游调用 ID 时，Provider 使用 `tool-${index}`；每次 stream 新建工具 Map，因此两轮的第一个调用都会变成 `tool-0`。实测两次已执行调用的 ID 为 `["tool-0", "tool-0"]`，Run 仍完成。

下游把 toolCallId 作为调用生命周期和审计身份：例如 `run_material_reads` 用 Run + toolCallId + knowledgePartIndex 判定同一次读取的幂等性，不同内容占用同一槽位会报 `Knowledge footprint conflict`。过程派生同样按该 ID 合并。兼容缺失 ID 时必须为每次实际调用生成在 Run 内唯一的稳定 ID，并对上游重复 ID 给出明确策略，避免把不同调用静默合并。

### F10 — 同步工具异常逃出工具失败边界

位置：[agent-engine.ts:226](../../packages/agent-core/src/agent-engine.ts#L226)。

代码直接调用 execute，再对返回的 Promise 安装失败转换，而负责移除 abort listener 的 try/finally 还在后面。如果合法 AgentTool 实现先同步校验并抛错，异常会直接进入整个 Run 的 catch，产生 `run.failed`，没有 `tool.failed`；本次新增的 abort listener 也不会进入内层 finally 释放。

合成工具 `execute() { throw new Error('synchronous validation'); }` 实测终态 failed、工具失败事件 0。当前仓内大部分工具是 async 方法，日常调用较少触发这一问题；这仍是公开工具接口的异常边界缺口，不能把“返回 Promise”理解为“调用时绝不抛错”。

应把工具调用本身和 await 都放在同一个可恢复错误与清理边界中，同时明确工具输出的 JSON 可序列化契约。已有回归只覆盖 async rejection，需增加同步抛错、异常输出序列化与后续模型恢复的组合。

## 3. 设计层缺口与修复次序

以下是静态审查观察，和上面的可复现问题分开记录：

1. **Run 内上下文没有总预算。** `maxContextTokens` 只在协议、设置与模型仓储读写；Core/Provider 没有消费这一上限。循环每轮追加完整工具结果，MCP 单次允许 100000 字符，Skill 资源单次也有较大正文；历史重放/Skill 各自预算不能限制本次循环的总请求。复杂长任务会累积到模型拒绝，且 usage 未用于预算裁决。应明确模型容量、输出预留、工具 Schema 和读取结果的共同预算，以及超限时的可解释收缩/停止策略。精确 token 计数与保守估计必须区分，不能拿字符数冒充 token。
2. **失败分类不够统一。** 模型生成错误、工具校验错误、工具运行失败、Provider 传输错误、权限撤销和宿主一致性错误，目前依赖抛错发生的层级决定是否继续。应先建立错误分类与预算，再选择哪些错误回模型、哪些请求可有限重试、哪些必须结束。HTTP 429/5xx 当前没有重试；这属于恢复策略缺口，不应引入对有副作用工具的盲目重放。
3. **恢复保证主要是“有终态”。** 启动时 failInterruptedRuns 会将遗留 running 收口为 failed，并不恢复中断任务的工作进度。当前实现这一点是清楚的；未来若设计可恢复长任务，需要显式保存决策/操作边界，不宜从原始 reasoning.delta 重建计划。

建议按三批执行：

- 第一批：F01/F02/F03/F04，统一模型工具错误反馈、取消检查点和成果提交裁决。先形成具体错误/取消契约，再补红跑并实现。
- 第二批：F05/F06，统一清理所有权、共享等待与失败聚合，修订 C4 保留分支，保证退出能观察失败且再次清理仍有对象。
- 第三批：F07/F08/F09/F10，补齐完成原因、流资源、调用身份和工具异常边界；随后处理 Run 总上下文预算与有界 Provider 恢复策略。

现有分层不需要推倒重建：Core 保持宿主无关，Application 保持持久化与资源所有权，工具授权仍来自本 Run 固定注册表。未知工具与错误参数的可恢复处理不能扩大授权；宿主审计失败、材料越界、凭据错误也不能为了“继续执行”而吞掉。

## 4. 验证证据

2026-10-16 本次定向既有测试共 27 文件、406 项通过，三个调用均退出 0：

```sh
npx vitest run --project functional packages/agent-core/src apps/desktop/src/main/services/run-event-lifecycle.test.ts apps/desktop/src/main/services/run-tool-context.test.ts apps/desktop/src/main/services/run-tool-result-adapter.test.ts apps/desktop/src/main/persistence/run-repository.test.ts
# 8 文件 / 196 项

npx vitest run --project heavy apps/desktop/src/main/services/run-service.test.ts
# 1 文件 / 100 项

npx vitest run --project functional packages/tool-runtime/src apps/desktop/src/main/services/mcp-client-service.test.ts apps/desktop/src/main/services/memory-dispatch-gate.test.ts apps/desktop/src/main/services/run-context-resolver.test.ts apps/desktop/src/main/services/run-history-policy.test.ts
# 18 文件 / 110 项
```

独立 worktree 临时复制原 RunService 测试文件并增加 3 个期望健壮行为的回归，仅选择 `review regression` 运行：退出 1，3 项均以真实行为差异红跑，原有 100 项跳过，不计为测试失败。三项为：

- 清理门闩期间 cancel 返回 true，预期 cancelled，实际 completed。
- 损坏参数 `{"x":`，预期反馈后 completed，实际 failed。
- 非对象参数 `null`，预期反馈后 completed，实际 failed。

这些回归使用真实 RunService、Journal、临时 SQLite 和 fetch 替身，无外部网络。测试副本在记录后移到临时证据目录，未留在产品测试目录。本轮没有实现修复，因此没有对应绿跑，也没有宣称通过修复验收。

另外运行 14 个观察探针：1 个未知工具恢复对照，13 个失败行为观察，映射到上面的 10 个问题；同一问题的 Core/宿主或释放/shutdown 观察不重复计为发现。探针使用真实 Core/Provider/Lifecycle/MCP 方法，宿主端口和连接为合成对象，不等同于真实进程泄漏实测。探针进程退出 0 表示完成观察，**不表示被审查行为正确**。其中等待探针已主动释放自己的工具门闩和流，未操作用户进程。

临时原始证据：`/tmp/betterwork-agent-review/probe.ts`、`probe-results.jsonl`、`run-service.review.test.ts`、`host-regressions.log`。本报告保留了关键输入、实际终态、次数及根因，不依赖临时文件长期存在。

文档验证：`npm run docs:check` 退出 0，156 项结构与文档判据通过；`git diff --check` 退出 0。既有三组定向测试也在独立 worktree 的同一代码快照复跑，结果仍为 27 文件/406 项通过。

## 后续修复状态

2026-10-16 用户下达“请修复”后，F01–F10 已完成代码修复和自动化验证，见[修复契约与收口证据](2026-10-16-agent-engine-hardening.md)。本报告保留审查时的基线行为与行号，修复后的当前实现以该收口文档及源码为准；设计层另列的总上下文预算、自动重试与断点恢复仍待后续设计。修复位于独立 worktree，尚未提交或合并。
