# Run 执行追踪实施契约

- 版本：v0.1 Proposed；2026-10-16 用户接受产品方向并要求开发卡。AT-M1 实施按本契约推进；技术提案状态仍以 ADR-0050 为准。
- 依据：[调研报告](../reviews/2026-10-16-agent-execution-tracing-analysis.md)、[ADR-0050](../adr/0050-run-execution-diagnostics.md)、[UI/UX](../10-ui-ux-system.md)、[工程规范](../12-engineering-standards.md)。
- 职责：本文拥有本增量的字段与行为口径；[AT 任务板](tasks-execution-tracing.md)拥有状态/证据；[Luna 交接](execution-tracing-coding-prompts.md)拥有可复制执行指令。不得从历史任务板复制旧的 verify/UI 运行要求。

## 1. 范围与入口

近期交付：逐轮模型与工具记录、宿主阶段与脚本关联、版本/来源联查、执行详情与时间轴、有限范围统计、问题 Run 标记、脱敏诊断包、离线质量样本。

工作页继续保留紧凑工具摘要和过程旁白；在右侧“过程”页签增加“执行详情”入口，通过现有 `Modal` 的 `variant="sheet"` 承载较宽详情空间，允许关闭并归还入口焦点。历史 Run 使用同一入口。统计/筛选放在该详情空间的执行记录区域，不新增一级导航或独立模型设置；具体组合与真实基座 props 在 UI 卡开工时核对。普通用户不默认看到原始事件。新增稳定领域组件可登记台账，不能自造基础 Modal、Toast、按钮、列表或页签。

不做：替换 Agent 引擎、多 Agent、DAG、自动重试/断点续跑、自动修改提示词/Expert/Skill/Memory、全量聊天扫描、后台付费评测、远程监控服务、价格账单、完整模型请求捕获。OTLP 导出仅 AT25 可选实施；与本地 JSON 诊断包不同。

## 2. 基线与定序

文档静态基线为 `0bb1b13ff7b7fbfb1887893f7f9da9066a163e25`。当时代码迁移最新 v46；每卡必须重新读取现状与迁移列表，不据此固定下一号、不重置本地数据库。

两种事实来源均在应用 SQLite 内：

| 来源 | 写入者/顺序 | 所有权 |
| --- | --- | --- |
| `run_events` / AgentRuntimeEvent | 现有 Core 生成器 sequence；Application 持久化和已有兜底终态机制 | 模型/工具/消息及 Run 结果事实 |
| `run_diagnostic_events` / HostDiagnosticEvent | Main Run 诊断记录器分配独立 diagnosticSequence | Core 未记录的宿主阶段边界与观测故障事实 |

Main 不在 Core sequence 中插入准备/清理事件；一个 Run 内宿主记录器是该诊断序列唯一写入入口，递增分配与写入须在同一 SQLite 事务完成。UI 不重排或重写任何原始序号。树的因果关系依赖显式关联；时间相同的跨来源节点仅采用稳定显示顺序，不能宣称该顺序证明先后执行。

查询投影不成为新业务真相源。初期不新建模型/工具 Span 表；若规模证据要求缓存，先说明失效/重建规则并记录 ADR 增量，不让 Luna 为“以后可能需要”预建索引系统。

## 3. 模型与工具事件

### 3.1 模型生命周期

共享事件增加 `model.started`、`model.completed`、`model.failed`、`model.cancelled`。所有事件保留现有 envelope；每次 `ModelProvider.stream` 调用尝试生成新的 modelCallId（独立随机 ID），round 为从 0 开始的本 Run 轮次。开始/结束通过 modelCallId 配对，不以 messageId 或模型名称代替。

- `model.started`：在调用 Provider stream 前发出；携带 modelCallId、round、providerId、messageCount、toolDefinitionCount。它证明调用尝试已开始，不证明服务端收到或已计费；保留记忆/连续上下文审计门。
- 结束事件共同字段：modelCallId、round、durationMs，以及可选的 timeToFirstTextMs、finishReason、usage、providerRequestId、providerResponseId、responseModel。ID/模型字符串经长度与类型验证，不含 headers、URL 查询参数或凭据。
- `model.failed` 另外携带受控 errorCode 与安全摘要。输出截断、内容过滤、未知完成原因、空/不完整流沿用现有 Run 失败语义；若已经收到 done 的 usage/元数据，失败事件仍保留它们，不能先 throw 再丢掉。
- `model.cancelled` 表达本次调用因 Run signal 被取消；不吞掉取消，不触发下一工具或模型。已完成调用在 yield 后收到 Run 取消，不改写该调用已完成事实。
- 每个已开始调用最多一条结束事件。流中途异常和提前结束消费必须通过 finally/既有恢复机制解释未闭合状态，不因新增事件改变已有 generator 清理。进程强杀不能补造实际结束时刻。

`usage` 延续真实服务数字、非负整数、字段可缺失的契约；无用量就是未知，不能填 0 或按字符数推算。Provider 继续读取 `[DONE]` 前、finish_reason 后的 usage。首期不向全部兼容服务强塞 `include_usage` 或新增模型设置；需要服务专属选项时另说明证据和兼容边界。

durationMs 是同一调用开始到收口的单调时钟差，包含宿主 Provider 包装审计及流消费；不得标成纯网络耗时。timeToFirstTextMs 只测首个非空可见 `text-delta`，排除 reasoning 与工具参数；tool-only 调用省略。测试注入 clock，不用真实 sleep 验证数值。错误前未观察到的指标保持未知，不追求伪造完整。

### 3.2 工具关联

现有 `tool.requested/started/progress/completed/failed` 增加可选 modelCallId 与 round，保持旧事件可解析。解析失败的工具参数只记录必要的调用身份、受控错误类别与关联，不把损坏原参数写入共享事件；unknown-tool 的现有 diagnostic 保留。

不得为非法调用伪造 started。诊断投影区分“被拒绝且未执行”和“执行后失败”，分别计拒绝/执行数量；没有 started 的记录不计算执行耗时。外层 completed 下的 Skill failed/timed-out/cancelled 继续沿用真实命令结果解释。新增元数据不得进入后续模型消息，避免改变上下文、材料边界或执行结果。

同轮模型节点和工具节点是轮次节点的子项；工具不挂在已经结束的模型耗时区间下面。round 是显示/关联信息，不新增领域 Step。

## 4. 宿主诊断事实（AT11 起）

HostDiagnosticEvent 最小字段：id、runId、operationId、diagnosticSequence、createdAt、kind、phase、state；可选 parentOperationId、toolCallId、executionId、durationMs、errorCode、受控数值/枚举元数据。Schema 使用判别联合和严格白名单，不开放任意 attributes、路径、argv、env、stdout/stderr 正文或请求正文。

- kind：`run-host` 或 `skill-host`。
- state：`started / completed / failed / cancelled / interrupted`，每个 operationId 至多开始一次、收口一次；结束前必须存在同 Run 的开始，重复相同收口幂等、冲突收口拒绝。
- Run phase：`prepare / audit / skill-cleanup / mcp-cleanup / artifact-commit`。
- Skill phase：`dispatch / execute / validate / publish / cleanup`。只有代码中确实能观测到的边界才细分；未埋点的 Python/CLI 内部显示“内部过程未记录”，不得按总耗时平分。
- Skill 关联沿用真实 `ScriptExecution.id` 与发起命令的 `toolCallId`：`dispatch` 覆盖 RunService 对绑定/命令/环境的解析以及 Supervisor 启动，启动失败沿用 `spawn-failed` 并记录为 dispatch 失败；`execute` 覆盖 Supervisor 结果收口；存在输出验证器时，`validate` 覆盖 `VerifiedExecutionOutput` 收集和持久化；文件成果登记时，`publish` 覆盖现有 `FileArtifactService.register`；`cleanup` 覆盖执行取消和有界清理。阶段记录只标明宿主观察到的区间，不推断子进程内部子阶段。
- 输出诊断元数据仅允许受控结果、退出码、输出字节数与 `outputTruncated` 布尔值。完整 `reportHash` 和 `outputIds` 继续留在既有 ScriptExecution/VerifiedExecutionOutput 业务记录中，由 executionId 联查；不得复制 stdout/stderr、报告正文或文件路径，也不把这些诊断元数据注入后续模型消息。
- 同一 phase 可发生多次，必须使用不同 operationId；禁止以 phase 名称作为唯一身份。跨 Run 的 parent/tool/execution 关系拒绝。

准备只覆盖已持久创建 Run 后发生的装配区间；创建 Run 事务之前的选择校验不补造成可回看 Run。recordingVersion/已启用诊断部分在新 Run 创建事务中固定，用于区分旧记录和应该存在但缺失的事实，不能由“没有失败事件”推导诊断完整。

表采用 run 外键与级联删除、id 主键、`UNIQUE(run_id, diagnostic_sequence)`，并对 operation 开始/终态约束补迁移和仓储测试；JSON 均在读写边界过 Schema。migration 用当前最新版本加一，先验证临时库，禁止启动时探测 ALTER。

已有业务记录（ScriptExecution、输出校验/成果版本）仍拥有其业务状态；诊断只存其观察边界与关联。不新增脚本权限、进程能力，不改变 JobResult 的现有失败分类。

## 5. 终态、恢复和观测故障

- 根节点读取 `runs.status` 与已提交的终态事件，不读取最后一个子 Span 作为结果；Core 的候选完成不算根完成。
- 保留审计 → Skill 清理 → MCP 释放 → 最终取消裁决 → 成果提交 → 终态发布的现行语义。Skill 清理失败仍尝试 MCP；清理失败不伪装安全取消；提交开始后的 cancel 不得虚假接受。
- 历史中的未闭合模型/工具/宿主节点按 Run 结果标识 cancelled、interrupted 或 unknown，并注明“结束未记录”；没有实测 durationMs 就不补出测量值。启动恢复仍只补既有 Run 失败，不自动重跑付费请求。
- Core Journal、权限与请求审计落库失败沿用既有编排失败语义。新增宿主 recorder 则为观测：其失败捕获并通过安全宿主日志记录，不吞掉业务异常、不把成功改为失败、不妨碍取消清理。
- 如有能力写入观测故障条目则写入；整个库不可写时不承诺能持久化故障标记。查询依据 recordingVersion、预期阶段与缺口给出 `partial / unavailable`，不能仍报完整。再次可用后不编造丢失事件。

## 6. 查询与实时交接

最小读模型：RunDiagnosticsSummary、DiagnosticNode、RunDiagnosticsPage、DiagnosticNodeDetail、RunDiagnosticsSources。名称可按工程规范调整，字段含义不可缩减。节点携带 sourceKind、原始 ID/序号引用与 evidenceState（`recorded / derived / missing`），旧字段缺失在 DTO 保持缺失。

- summary：Run/Task/Session、持久终态、起止、调用/拒绝计数、已知用量及缺失调用数、recordingVersion/完整性。
- node：独立节点 ID、显式父关系、类型、状态、实际执行与否、事件时间、可用耗时、可选 round/model/tool/execution 关联。不把两个来源序列拼成一个递增序列。
- sources：引用当时固定的 ExpertRevision、Skill/环境绑定、model snapshot、材料读取、记忆修订/派发审计、连续上下文、ArtifactVersion；无法取得时给原因，不查询 latest 代替历史。
- `run:diagnostics-sources` 使用 Run/Task/Workspace 同一范围请求与严格响应 Schema。固定上下文只投影精确修订 ID、版本号、状态和必要的模型显示名/指纹；Skill 环境只含状态、平台、lock hash 与依赖清单 hash。已选材料和读取足迹分开列出，只有 `read/parse` 可令 `wasRead=true`，`preview/search` 不能推断正文已采用。Knowledge/Artifact 通过精确 revision/version ID 读取元数据；输入快照核对 Workspace、hash、format 和 fileKey 绑定，但响应不含路径/fileKey/locator。
- 记忆只回传选择身份/hash、读取身份与来源状态、重放身份及阶段时间；连续上下文只回传修订/hash/时间、省略原因和同 Task 的来源 Run/ArtifactVersion ID，不回传简报正文。成果只回传版本身份/hash、类型/校验元数据与已登记的精确输入关系，不回传标题、内容、Evidence 摘录或文件定位符。`dispatch-attempted` 只表示本地记录了派发尝试，不代表 Provider 服务端已收到。
- revision、hash、Workspace/Run 归属不匹配时标记 unavailable 并降级整体完整性；缺少旧字段保持 `not-recorded`，不补取当前配置或 latest。完整性按字段白名单重新构造，不序列化底层 Repository 详情对象。
- 查询必须验证 Run 真实归属；选中的 Task/Workspace 范围在 Main 校验。跨范围 ID 不返回其他对象明细，不依赖 Renderer 过滤。
- 页面大小默认 50、上限 200；游标明确含来源边界及查询筛选身份。不把全量原始消息/工具载荷塞进 summary，节点载荷按需取；诊断详情文本最多 64 KiB UTF-8，带 truncated 标志，保留原事实不改写。

IPC channel 只在有实际 Main/Preload/Hook 消费者的卡中注册。Host 变化推送只发送 runId 与诊断游标/失效提示，不广播第二份全文；Core 继续用既有 RunEvent。订阅建立后读取快照，以稳定 eventId/各自序号合并，再补取缺口；快照读取期间到达的事件不得重复应用或丢失。切 Task/Run 后迟到回执和卸载订阅必须丢弃；停止某个 UI 订阅不等于取消 Run。

## 7. 时间轴、统计与比较

时间轴只展示已记录起止与正在运行的占位；单调 duration 与 wall-clock 区间含义分开。主进程/子进程未同步时钟不支持精确关键路径推断；并发节点耗时不得直接相加当总时长。数据异常或零长度区间有明确降级，不生成负宽度。

统计范围固定 Workspace，可选 Task、时间窗、精确 ExpertRevision、SkillRevision、模型快照指纹；缺少历史版本时归入“未记录”，不混入当前版本。分页与统计使用相同筛选条件，返回样本数和纳入/排除计数。

- Run 失败率只按最终 completed/failed 的已终态样本计算，取消与运行中单列；没有可用分母返回未知。
- 工具失败/参数拒绝分别统计，不能与 Run 失败率混用；tool-only 模型也计入调用尝试。
- 每种 token 分别给 knownSubtotal、knownCallCount、missingCallCount；0 是服务真实返回时的有效值。父节点不重复累计子节点。
- duration 的 p50/p95 使用已终态且有有效测量的调用样本，采用 nearest-rank，并返回样本数；不含 unknown、中断后估计值与正在运行的计时。
- 不自动计算货币费用，不以 fake 模型测量结果宣称真实模型性能。墙钟/内存预算断言只进现有 bench 档，不进功能测试。

## 8. 问题标记与本地诊断包

问题标记为用户显式操作，保存 runId、分类（`model / tool / material / artifact / lifecycle / other`）、可选诊断节点引用和更新时间；不保存自由文本备注、私有正文或自动写 Memory。保持每 Run 一个当前标记，允许更改和清除；修改标记不改变 Run。

新增标记表在对应卡追加迁移，run 外键级联删除；节点引用必须属于该 Run。禁止预先建立通用反馈/训练平台。

本地 JSON 诊断包有 schemaVersion、生成时间、代码/策略版本（可取得时）、Run/调用标识、受控分类/状态、计数/耗时、快照 ID/哈希和完整性/截断说明。文件保存由 Main 复用现有选择/导出设施，取消保存不报失败；不是新 Artifact 类型，不触发模型。

导出默认不含：prompt、消息/工具输入输出正文、reasoning、记忆/材料全文、绝对路径、URL、Provider 原始错误、headers、env、凭据、脚本日志正文。不能仅依靠“把 JSON 序列化后替换 API Key”；必须用字段白名单重新构造。全包上限 5 MiB，超限明确拒绝并引导缩小范围，不静默裁成看似完整。

## 9. 离线评测与可选扩展

AT21 只建立合成案例、确定性校验器与比较报告，不新增面向用户的自动模型重跑按钮。每次验证创建新的 Run/隔离库，固定输入、配置修订与期望；至少覆盖成功、模型截断、tool-only、可恢复工具失败、Skill 结构化失败、取消、清理失败、历史/实时交接和版本缺失。报告区分结构正确、链路完整、业务质量未验，不能用 syntheticRequests=0 等读数代签真实模型语义。

AT23 人工 UI 和 AT24 真实模型验收独立派发。AT25 若获授权，再以固定版本映射 OTel，sessionId 与 runId 分字段，外部 exporter 有有界队列/超时/退出排空，不反向影响 Run。完整请求捕获、自动优化及把问题样本作为模型训练数据继续排除，不因可选 exporter 而自动启用。

## 10. 工程证据

所有代码卡遵循 docs/12：新增行为/缺陷最小反例红跑 → 实现绿跑 → 必要重构回归；特征测试如实标记。使用 Fake Provider、注入 fetch/clock、临时 SQLite/目录，无触网测试，不读取私有资料。日常运行 `npm run check:quick -- --base <本卡基点>`，静态/类型/相关测试与差异覆盖由当前工具链选择，不自动运行完整 verify、ui:check 或页面走查。

每卡记录 HEAD/工作树、红绿命令及退出码、主要行为、迁移号、验证范围、未验 UI/模型项和当日日志。自动化通过、真实 UI 通过、真实模型语义通过分别交接，不靠预算耗尽、文档完成或其他卡的绿灯宣布本卡完成。
