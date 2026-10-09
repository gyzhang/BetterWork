# BetterWork 全仓代码 Review 与重构建议

- 审阅日期：2026-10-09；时间取自本机 `date`。
- 代码基点：`94e2b318fc650de951f1d89abaf5e3ca6f69f7a3`，开始时工作树干净。
- 本轮边界：阅读、扫描、离线复现和报告；没有修改产品实现、测试、配置或数据库，没有提交、推送或创建 PR。
- 本报告提出候选方向，不构成重构开工指令，也不改变已有任务板、产品范围或 ADR 状态。

## 1. 结论

项目的基础架构值得保留：Renderer、Preload、Application、Agent Core 的边界基本清楚，Run 有持久化事件与终态，材料和成果有版本及来源，授权撤销、取消、恢复也有实际实现与测试。没有证据支持推倒重写。

当前主要压力是功能持续叠加到少数入口：`RunService` 集中了运行、材料、工具、业务事实校验、来源和成果；`App.tsx` 集中了 Task 草稿、选择、事件和导航；IPC 注册层开始直接承担业务用例。维护这些入口需要同时理解越来越多的状态与策略，局部修复容易遗漏相邻路径。

这已经出现具体后果：离线复现了事件快照覆盖增量、取消选择后旧详情回写、数字单位空白导致事实校验不同结果；文件级测试也暴露了一个顺序敏感的草稿保留失败。因此建议先修行为与补回归，再按职责抽取模块，最后优化查询与治理组织。

## 2. 审阅范围与证据口径

### 2.1 覆盖方式

对已跟踪的 `.ts/.tsx/.js/.mjs/.cjs/.py/.sh/.css/.html` 文件做了全量文本与结构扫描，解析 TypeScript/JavaScript 的函数、分支、状态声明及导入关系；沿启动、IPC、Run、工具、材料、来源、成果、知识、记忆、定时任务和 Renderer 异步状态路径深入阅读，并对照相关测试和文档。

这是“全仓扫描＋关键链路深审”。**不宣称对约 18 万行逐行完成了同等深度的语义证明**，也不把测试通过视为所有交错顺序、安全边界或真实产品旅程均已验证。

排除第三方依赖、构建输出、二进制资源、`book/` 和 `docs/prototype/` 中的教学/原型代码；JSON、工具链配置、资源清单和 Markdown 文档按相关性核对，不计入下表代码行数。源码行数按换行计数，包含空行与注释。

| 口径 | 文件数 | 行数 |
| --- | ---: | ---: |
| 上述范围内代码合计 | 581 | 180,139 |
| 测试，含 bench 文件 | 238 | 76,247 |
| 其余源码、配置脚本与夹具 | 343 | 103,892 |

`drift:check` 自身的“生产代码”口径为 95,936 行，与上述宽口径不同；其 2,076 个用例读数是静态声明统计，不是本次实际运行数量。

### 2.2 判断分级

- **离线复现**：执行当前源码抽取的函数或实际 Hook，使用可控替身制造交错顺序；没有真实模型或外部网络。
- **测试观察**：记录原有测试的实际结果；测试失败不直接等同于已证明的生产缺陷。
- **静态确定**：代码结构或控制流可以直接确认，尚未跑完整产品旅程。
- **风险推断**：代码存在使问题成立的条件，但没有完整运行复现；单独注明。

优先级：P1 为应优先消除的正确性、生命周期或边界问题；P2 为影响后续开发与数据规模增长的结构问题；P3 为可在前两类收口后整理的组织问题。没有把文件长度单独当作缺陷，也没有发现并证明需要紧急停用产品的 P0 事件。

### 2.3 已执行检查

| 检查 | 结果与边界 |
| --- | --- |
| `npm run drift:check` | 通过；154 条护栏、203 条例外登记。只代表该脚本覆盖的漂移检查通过。 |
| `npm run typecheck` | 通过。 |
| `npm run docs:check` | 初次审阅与报告落盘后均为 154 项通过。 |
| functional：packages、Preload、退出辅助、定时宿主、技能 Hook、事件辅助 | 22 文件、187 项通过。 |
| functional：IPC、网页读取、记忆召回 | 3 文件、57 项通过。 |
| heavy：RunService 与 App | 2 文件、111 项；110 通过、1 失败。RunService 的 69 项通过。 |
| heavy：单独重跑整个 App 文件 | 42 项；41 通过、同一项再次失败。 |
| heavy：只跑失败用例 | 1 项通过、41 项跳过；没有据此抹去文件级失败。 |
| `npm audit --json` | 退出 1：27 个告警条目，6 moderate、20 high、1 critical；已核对安装树与相关上游公告，未运行 fix/install。 |

未运行完整 `npm run verify`、全仓 lint/build、完整 UI 矩阵、正式 bench 或真实模型/网络验收，未重启或操作用户正在运行的应用。当前应用 SQLite 文件的只读 CLI 打开失败，已继续检查开发日志；日志没有提供这些发现的运行期证明。因此本文不是基于真实用户数据库完成的事故根因报告。

## 3. 优先级总表

| 编号 | 优先级 | 发现 | 证据 | 建议批次 |
| --- | --- | --- | --- | --- |
| R01 | P1 | 全 Task 事件快照覆盖实时增量 | 离线复现 | 先补回归与修行为 |
| R02 | P1 | 材料数字校验的单位不统一，且全数字配对膨胀 | 离线复现＋静态确定 | 先修规范化，再独立策略 |
| R03 | P1 | 异步请求失效规则不一致，旧结果能回写 | 技能 Hook 离线复现；其余静态分析 | 与 R01 一起收口 |
| R04 | P1 | 应用退出未覆盖全部后台作业所有者 | 风险推断 | 生命周期独立批次 |
| R05 | P1 | 网页目的地主机判断过于粗糙 | 本地函数复现；DNS 风险静态分析 | 边界补强独立批次 |
| R13 | P1/P2 | App 文件级测试已有红灯；夹具与整树测试耦合 | 测试观察＋静态确定 | 先解释红灯，再拆测试 |
| R17 | P1/P2 | 依赖告警需按运行可达性与升级链治理 | npm 审计＋安装树＋上游公告 | 先核查网络与构建依赖 |
| R06 | P2 | RunService 职责与依赖持续集中 | 静态确定 | 宿主编排拆分 |
| R07 | P2 | App 多份相关状态、手工重置与重复呈现 | 静态确定 | Task 状态与工作页拆分 |
| R08 | P2 | IPC 层夹带用例编排和查询投影 | 静态确定 | 应用用例抽取 |
| R09 | P2 | IPC 类型与响应 Schema 没有编译期联动 | 静态确定 | 契约小步统一 |
| R10 | P2 | 候选、记忆、历史读取存在全量/N+1 路径 | 静态确定；延迟风险未定量 | 读模型优化 |
| R11 | P2 | 材料身份、精确引用与序列化指纹散落 | 静态确定 | 领域纯函数整理 |
| R12 | P2 | 工具结果在宿主反复按名称解析 | 静态确定 | 工具结果适配边界 |
| R14 | P2 | macOS 单平台范围仍留跨平台执行分支 | 静态确定 | 小范围死代码清理 |
| R15 | P3 | 治理测试与 UI 夹具本身成为维护集中点 | 静态确定 | 治理组织整理 |
| R16 | P3 | 部分现行规范与实现不一致 | 文档与源码对照 | 文档同步批次 |

## 4. 详细发现

### R01｜P1：事件快照与实时事件有两套合并规则

**位置**：[App.tsx](../../apps/desktop/src/renderer/src/App.tsx)，L587–604、L621–633、L1040–1116；[run-events.ts](../../apps/desktop/src/renderer/src/lib/run-events.ts)，L18–27。

`loadAllTaskRuns` 并发读取各 Run 的事件，最终用 `setTaskAllEvents(eventsMap)` 整体替换。等待期间，事件订阅会向旧 Map 追加新事件；较早的快照回来后把它们覆盖。另一个 `events` 状态已经使用 `mergeRunEvents(snapshot, current)`，实际展示全 Task 时读取的 `taskAllEvents` 却没有同样保护。

从当前源码抽取加载函数，用延迟的 `listEvents` 替身复现：快照等待期间状态为 `['old', 'new']`，旧快照返回后变成 `['old']`。这是 Renderer 内存投影丢增量，**不是 SQLite 原始日志被删**；后续刷新可能恢复，也不能保证所有中间状态及时恢复。

还有两个相邻风险：只检查 Task ID，不能区分同一个 Task 的两次加载代次；订阅对 Map 中尚不存在的 Run 直接返回，启动响应前到达的事件可能被忽略。后者未做完整 IPC 时序复现。

**建议**：为 Task 建立一份按 Run 索引的事件状态，快照和订阅都按 event ID 去重、sequence 排序合并；加载带请求代次。复用现有合并函数，不另造事件总线。

**验收**：延迟快照期间收到 delta/终态不能丢失；重复事件不能重复呈现；A→B→A 和同 Task 两次刷新逆序返回均正确；覆盖 Run 启动应答与首个事件的顺序。先固定这些行为，再抽 Hook。

### R02｜P1：材料事实校验混合了字符串识别、推导和通用运行策略

**位置**：[run-service.ts](../../apps/desktop/src/main/services/run-service.ts)，L171–282、L556–560、L1533–1580、L1656–1694。

**已复现的正确性问题**：识别正则把单位前空白放进 `match[2]`，录入时直接交给 `isCountUnit/isPercentageUnit` 精确比较，审计输出时却先 `.trim()`。同一材料仅改变排版就得到不同许可结果：

| 材料文本 | 校验输出数字与单位 | 当前结果 |
| --- | --- | --- |
| `本期新增10家` | `10 家` | 允许 |
| `本期新增10 家` | `10 家` | 不允许 |
| `占比10%` | `10 %` | 允许 |
| `占比10 %` | `10 %` | 不允许 |

复现执行了实际 `createMaterialFactLedger`、`recordMaterialFacts` 和 `hasAllowedNumber`，没有调用模型。最终回复审计依赖这个账本，因此可能把材料中存在的数字判为未提供。

**规模与策略问题**：每次读取材料后，把累计全部数字两两组合，生成差值、变化率和比值，并分别展开多个舍入精度。单次至少有 O(N²) 枚举，累计读取还反复算旧组合；运行在主进程，没有专门的数字数量预算。离线示例的 50/100/200 个不同数字分别约 18/45/193ms，200 个数字产生约 10.1 万个 allowedNumbers、18.6 万个 allowedPercentages。它只是单机示意测量，不是正式性能门禁或生产延迟结论。

账本还把“已续约、已流失、客户总数”等业务词写死，并对选择了材料的通用 Run 启用。数值集合缺少指标、单位、期间和来源之间的关系；任意两个数字可被组合，难以解释“这个计算为什么合法”。

**建议**：第一步只统一单位规范化并补回归；第二步把材料事实策略移出 RunService，用明确的事实项和确定性工具结果记录来源、单位及期间，避免构造数字笛卡尔积。业务规则的适用范围先对照 ADR-0020 与当前产品契约决定，保留已授权的防护行为，不在重构中悄悄删校验或扩大业务质量范围。

**验收**：空白、全角百分号、负数、小数、计数单位等价；不同指标/期间不会仅因数字相同被混作同一事实；失败原因可以回溯材料或工具；性能预算放在 bench，功能测试不写墙钟断言。

### R03｜P1：请求代次只在部分入口正确维护

**位置**：[use-skills.ts](../../apps/desktop/src/renderer/src/hooks/use-skills.ts)，L72–103；[App.tsx](../../apps/desktop/src/renderer/src/App.tsx)，L545–582、L881–949、L1151–1175。

实际 Hook 离线复现：发起选择详情请求→取消选择→旧请求返回。取消后 `detailLoading` 仍为 true；旧请求返回后 `selected` 又变成旧详情，而 `selectedId` 仍为空。`select` 有 requestId，`deselect` 没使它失效。这证明状态矛盾，尚未声称某个完整界面一定重新打开。

`startFromArtifactVersion` 等待来源执行身份后比较 `activeTask?.id` 与等待前保存的值，二者来自同一次渲染闭包，不能观察等待期间用户切换了 Task；已有 `activeTaskIdRef` 才代表最新身份。`refreshTasks`、`refreshDiscussionCheckpoints` 和部分材料请求也直接提交结果，缺少对象范围或请求代次判断。相比之下 `refreshEvidence` 已有身份与代次保护，规则明显不一致。

**建议**：按实际状态所有权定义请求范围，例如 Workspace、Task、所选对象及代次；切换、取消选择、删除和重新开始都使旧代次失效。提取很小的请求保护工具即可，先复用已有可靠模式，不默认引入全局查询框架。

**验收**：请求 A 慢于 B、取消后成功/失败返回、删除后返回、旧 Task 请求回到新 Task 均不能改写当前内容、错误或 busy；同时测试 A→B→A，不能只比较对象 ID。

### R04｜P1：后台作业的所有权没有完整进入应用退出流程

**位置**：[main/index.ts](../../apps/desktop/src/main/index.ts)，L82–101、L746–764；[knowledge-index-service.ts](../../apps/desktop/src/main/services/knowledge-index-service.ts)，L124–125、L369–435；[memory-extraction-service.ts](../../apps/desktop/src/main/services/memory-extraction-service.ts)，L676–721；[skill-dependency-service.ts](../../apps/desktop/src/main/services/skill-dependency-service.ts)，L285、L674–694。

退出已等待定时准备、Run、通知、MCP 与知识 Worker。但应用上下文没有持有知识索引队列、记忆提炼队列、技能依赖准备服务的统一停止/排空入口，随后就关闭 KnowledgeVault 和 AppStore。

这些服务各自拥有 controller、draining Promise 或活动子进程。关闭提取 Worker 不等于停止仍在等待 Embedding 的索引作业；等待 RunService 也不等于排空已自动入队的记忆提炼。异步后续逻辑仍可能使用已经关闭的库，依赖准备也可能被退出中断。**这是源码可见的生命周期缺口与风险推断，未对用户应用做强杀或退出实验。**

**建议**：列出每个后台服务的所有者、停止接收、取消与排空动作，统一执行“停止新工作→取消/等待工作→关闭资源”；给等待定义有界预算与失败语义。保持简单生命周期装配，不引入复杂 DI 框架。

**验收**：临时 SQLite 与受控替身下，在索引、提炼、依赖安装的每个 await 阶段退出；资源关闭后零写入、零新派发；子进程收口或明确持久化中断态；重复退出幂等。不可只测试 `createQuitHandler` 的调用顺序。

### R05｜P1：网页目标校验使用字符串近似规则

**位置**：[web-fetch-service.ts](../../apps/desktop/src/main/services/web-fetch-service.ts)，L8–44、L113–160；对照 [mcp-network-policy.ts](../../apps/desktop/src/main/services/mcp-network-policy.ts)，L13–96；[ADR-0017](../adr/0017-web-fetch-and-evidence-boundary.md)。

当前把 hostname 以 `fc` 或 `fd` 开头直接当成私有 IPv6，并未先确认它是 IP。调用实际校验函数，`https://fca.example.com/`、`https://fda.example.com/` 都被拒绝；这是正常域名形状被误判，无须联网就能证明。另一个本地结果是 `http://169.254.169.254/` 通过校验。

公网域名解析到私网时，单看 URL 字面不能兑现“拒绝私网目的地”；重定向也同样依赖这个判断。ADR-0017 已记录真实 DNS 验证边界，本文不把它描述成近期首次退化；MCP 的能力契约也明确 public web_fetch 没有随 CF 自动增强。这里建议独立补强并明确契约，不能把 MCP 的内网显式授权规则直接套给网页工具。

同一服务把用户取消和自身 15 秒超时都转成 `abortError`，工具失败原因失去区分；不能据此断言整个 Run 一定会显示 cancelled。

**建议**：IP 分类先使用明确的 IP 解析与网段判断；分别保留网页与 MCP 的权限语义，共享纯地址分类等可共享机制。DNS 检查若落地，必须覆盖实际 socket 的地址绑定与每次重定向，不能仅加一次 lookup 后让 fetch 再解析。超时与用户取消保留不同原因。

**验收**：正常 fc/fd 域名、私网与特殊网段、IPv6 各表示法、混合 DNS 回答、目标重解析及重定向全部用注入替身；拒绝时不得发出请求；超时与用户取消结果可区分。没有进行任何真实内网访问或利用验证。

### R06｜P2：RunService 成为跨域变更的集中入口

**位置**：[run-service.ts](../../apps/desktop/src/main/services/run-service.ts)，L337–459、L484–504、L721–925、L1248 起、L1533 起、L1731 起、L1978 起、L2128 起。

2,602 行、42 个 import 声明、19 个位置参数，其中 14 个可选；同时负责上下文准备、工具装配、消费与落库、材料读取、业务校验、成果保存、证据登记、凭据、Skill 脚本环境和终态通知。

这不是“类长所以坏”：新增一种工具，需要同时查看工具工厂、输出识别、事实采集、材料读取足迹和 Evidence；测试构造还可以省略多个服务，从而进入与生产不同的能力路径。生产实际接线提供这些依赖，不能仅因参数可选就认定已经发生越权。

**建议边界**：先改为有名字的依赖对象并明确必需端口；随后按顺序抽取 Run 上下文准备、运行工具上下文、事件落库/来源适配、终态与成果收口。RunService 保留启动、取消、执行消费和生命周期协调。先抽相对纯的部分，再动终态路径，每批保持行为一致。

**验收**：现有事件顺序、范围、撤权、取消、脚本失败、成果来源和恢复测试全部保持；新增工具不再需要修改多个分散解析分支；生产必需依赖缺失在装配时明确失败，不能无声降级。仍留在当前 Application 层，不为拆分而新增 package。

### R07｜P2：App 的状态重复与呈现耦合已经影响行为

**位置**：[App.tsx](../../apps/desktop/src/renderer/src/App.tsx)，L134 起、L235、L685–721、L1574–1695；[ContextPanel.tsx](../../apps/desktop/src/renderer/src/components/ContextPanel.tsx)。

App 有 50 个 `useState` 调用，持有多份 Run 列表、`events/taskAllEvents`，以及 TaskContext 与单独维护的材料、技能、记忆排除、MCP 绑定等草稿字段。`startNewTask` 手工重置大量状态，其他进入 Task 的路径再各自恢复。R01/R03 正是这些状态规则不同步的具体后果。

另一个可以直接确认的问题：`artifactNote` 是单个状态，却在 `taskAllRuns.map` 的每一项里渲染同一个 InlineError/TransientToast；Task 有多次 Run 时，同一句保存结果会产生多个出口实例和多个计时器。保存按钮也从各个 Run 行调用面向 `latestCompletedRun` 的共享保存函数，行为意图不够局部。

每个渲染还反复扫描 Run 事件、提取文本和工具活动；部分逐 Run 逻辑再次搜索整体 Run 列表。尚未测量用户可感知卡顿，先视为增长风险。

**建议**：拆出 Task 草稿状态、Task Run 事件状态和工作消息列表；互相关联的草稿用明确的 reducer/快照管理；保存操作接收目标 Run，反馈标记其对象或在列表外只有一处出口。`ContextPanel` 按已有页签职责拆组合，而不是用一个通用大对象掩盖 props。

**验收**：新建、切换 Workspace/Task、打开历史成果、定时续作均保留正确草稿；保存任意历史 Run 的语义明确；一次结果只呈现一次；活动 Run 流式更新不使全部历史投影重复计算。App 可以继续承担跨区域装配，不要求把所有 IPC 字面调用搬出它。

### R08｜P2：IPC 注册层承担了业务用例与读模型

**位置**：[register-ipc.ts](../../apps/desktop/src/main/ipc/register-ipc.ts)，L618–994，特别是 L790–834、L849–944；L1190 起的成果通道。

文件已有按域注册函数，但它们仍放在 2,531 行的同一模块。定时详情在这里遍历 Task 成果、版本和输入关系形成采用数量；手动执行则组合幂等、修订、预检、能力与派发顺序。成果入口也包含业务事务协调。重构应用用例时，需要连 Electron IPC 环境一起理解和测试。

**建议**：先抽实际业务用例，例如定时实例详情查询、手动执行、成果保存声明；IPC 仅校验入参、调用用例、映射输出/错误，再按域组织注册文件。读模型使用 Repository 投影；需要跨仓储一致性的事务仍由 Application 用例掌控。

**验收**：业务用例可脱离 Electron 单测；IPC 保留恶意输入、输出校验及事件广播测试；幂等键、CAS 和事务边界无变化。不要抽成一个通用 CRUD controller，也不要把业务协调塞进 Repository。

### R09｜P2：契约有运行期保护，编译期关联仍不足

**位置**：[register-ipc.ts](../../apps/desktop/src/main/ipc/register-ipc.ts)，L375–409、L501–518；[preload/index.ts](../../apps/desktop/src/preload/index.ts)，L200 起；[协议入口](../../packages/agent-protocol/src/index.ts)。

`handleInput` 的 handler 返回 `Result`，responseSchema 却是独立的 `ZodTypeAny`，两者没有类型约束。返回形状写错时可以编译通过，到运行期 `.parse()` 才失败。`handleScheduleInput` 也有相同关系缺口。

旧 Preload 接口使用裸 `ipcRenderer.invoke`，较新接口用 `invokeValidated`。Main 仍校验边界，不能将这种不一致夸大为没有安全校验。错误契约还有异常/null、Memory 的 `ok/data/error`、Schedule 的 `status/data/error` 多种模式，Renderer 要记住不同处置方法。

协议文件 7,283 行主要是声明，长度本身不是业务复杂度；但 channel、请求、响应、API 方法、Main 和 Preload 的手工关联容易跨位置漏改。

**建议**：先让 helper 的响应 Schema 推导 handler 返回类型；按领域模块拆协议，保留原导出入口和 IPC 兼容性。为新增通道明确统一约定，旧契约按领域逐步迁移；错误、缺失与取消仍按产品语义保留区分，不一次性把所有 API 改成一个万能 Result。

**验收**：错误响应类型在编译期不可通过；非法入参/输出仍在边界拒绝；关键 API 的 Main、Preload 与共享声明有契约测试；旧记录和历史版本不因整理声明而失效。

### R10｜P2：页面需要轻投影，服务却读取完整对象与历史

**位置**：[task-material-service.ts](../../apps/desktop/src/main/services/task-material-service.ts)，L67–154；[memory-recall-service.ts](../../apps/desktop/src/main/services/memory-recall-service.ts)，L788–808、L992–1050；[memory-conflict-policy.ts](../../apps/desktop/src/main/services/memory-conflict-policy.ts)，L74–99；[knowledge-index-store.ts](../../apps/desktop/src/main/services/knowledge-index-store.ts)，L580 起。

材料候选枚举知识全部修订、成果各版本，再调用 `getVersionDetail` 读取正文/详情；对工作空间所有 ready 快照串行执行文件校验。只是打开选择器，也可能承担逐版本数据库访问和逐文件读取/哈希。

记忆召回已经有范围候选查询，却为排除账本再读取 `memories.list({})` 的全域完整记录；潜在冲突先两两枚举再比较 topic。历史安全重放对 Task 全部已完成 Run 读取完整事件与多个关联仓储，而 `listEvents` 会逐条 JSON 解码和 Zod parse。

知识范围覆盖/substring 回退读取全部 chunk 正文。现有向量扫描已经有 Worker、批次和预算，这一发现不能外推为“知识系统没有性能边界”，也不支持引入向量库。

**建议**：优先增加候选与元数据投影、分页/检索、批量读取、按 topic 分桶，以及专用终态/来源查询。完整哈希验证保留在选择确认和运行前；若候选页不再做完整校验，必须明确其状态语义。历史安全证明可用完整依赖摘要与受限正文读取，不能为了提速先 LIMIT 掉必须核查的来源。

**验收**：大样本下读取行数、正文总量、文件校验次数可解释；候选结果、不可用提示和来源安全语义保持；scope 在截断前处理；性能以定向 bench 记录，不以函数改短作为完成标准。

### R11｜P2：同一材料概念存在多种散落的相等判定

**位置**：[materials.ts](../../apps/desktop/src/renderer/src/lib/materials.ts)，L14–23；[task-material-service.ts](../../apps/desktop/src/main/services/task-material-service.ts)，L41–50；[run-context-snapshot-repository.ts](../../apps/desktop/src/main/persistence/run-context-snapshot-repository.ts)，L217 起；[schedule-source-service.ts](../../apps/desktop/src/main/services/schedule-source-service.ts)，L96 起；[schedule-material-resolver.ts](../../apps/desktop/src/main/services/schedule-material-resolver.ts)，L57 起；[artifact-declaration-service.ts](../../apps/desktop/src/main/services/artifact-declaration-service.ts)，L201 起。

有按修订 ID 的 key、逐字段精确比较、知识引用特例，还有 `JSON.stringify` 比较和去重。Schedule 两处精确比较基本重复。新增一种材料或身份字段时，需要记住所有位置；对象序列化顺序也不适合作为未命名的领域相等规则。

不同判定有实际语义差别，不能全部替换成同一个“equals”：列表身份、版本/哈希精确快照、持久化指纹应分别定义。

**建议**：为这三类语义建立命名明确的纯函数与测试，再逐调用点选择正确规则；跨 Main/Renderer 的纯规则可以放现有共享层，涉及文件/数据库的检查仍留宿主。

**验收**：同 ID 不同 hash、同内容不同工作空间、可选字段省略、字段顺序、历史知识引用兼容均有测试；审计字段与授权精确度不丢失。先核对语义，再去重。

### R12｜P2：工具结果契约在宿主被重复重建

**位置**：[agent-core/types.ts](../../packages/agent-core/src/types.ts)，AgentTool；[run-service.ts](../../apps/desktop/src/main/services/run-service.ts)，L1533 起、L1731 起、L1799 起、L2449–2602；[tool-runtime](../../packages/tool-runtime/src/index.ts)。

Core 用 `Promise<unknown>` 接受不同工具结果是合理的隔离边界。问题是宿主后续在事实采集、Evidence、材料足迹和产物登记中，反复判断 toolName，并用手写 type guard 重建同一输出形状。新增工具的主要成本从执行代码转移到了这些旁路。

**建议**：在具体工具/宿主适配边界定义结果 Schema 与类型，将“结果如何登记读取足迹、证据、事实、成果”放进该工具对应的小适配器；通用 Run 消费器只调用已有适配入口。无需让 Core 依赖全部领域类型，也无需新增泛化事件总线。

**验收**：每种结果只校验一次明确契约；非法或未知结果可解释地失败；新增工具只扩展对应适配与装配；事件持久化、Evidence 和输入关系原子性不变。

### R13｜P1/P2：先处理测试基线红灯，再降低整树夹具成本

**位置**：[App.test.tsx](../../apps/desktop/src/renderer/src/App.test.tsx)，L944–1018，失败断言 L995；[run-service.test.ts](../../apps/desktop/src/main/services/run-service.test.ts)；[register-ipc.test.ts](../../apps/desktop/src/main/ipc/register-ipc.test.ts)；[vitest.config.ts](../../vitest.config.ts)。

`从固定期间打开原 Task、保留草稿并只把补充材料写入该 Task` 在 heavy 两文件运行、整个 App 单文件重跑中都失败：期望续作草稿，收到空字符串；仅跑该用例通过。不是超时失败。当前证据只能确认文件级结果对执行上下文敏感，可能是用例间泄漏，也可能是未等待稳定状态/产品异步竞态；本轮没有证明根因。

这是重构前的 P1 基线问题，不能用 isolated 绿灯结束。尤其要避免在后续拆 App 时把测试改得更宽松后声称“重构修好了”。

P2 维护问题是大型用例依赖完整 AppStore 或整套 Desktop API 替身，夹具与生产新增字段一起扩张；当前 RunService 测试 4,403 行、IPC 测试 2,072 行、App 测试 2,007 行。全仓测试投入很充分，但 R01–R03 表明延迟请求与交错顺序仍有缺口。

**建议**：先独立归因这个红灯，检查未排空请求、挂载/重置、清理与跨用例状态；再围绕抽出的纯策略、小用例和 Hook 建立最小端口夹具，保留关键整树/真实持久化旅程。fixture builder 的默认值应显式且保守，不能自动给信任、授权和 ready 状态。

**验收**：失败用例在单独、文件级、规定测试档中均稳定通过并有原因证据；新增竞态测试能在修复前可靠失败；重构不减少终态、撤权、恢复和来源测试覆盖，也不把业务断言换成私有函数调用次数。

### R14｜P2：平台范围收窄后仍有旧执行分支

**位置**：[window.ts](../../apps/desktop/src/main/window.ts)，L35–48；[register-ipc.ts](../../apps/desktop/src/main/ipc/register-ipc.ts)，L2496 起；[skill-dependency-service.ts](../../apps/desktop/src/main/services/skill-dependency-service.ts)，L266–271、L461、L741–747、L979–983；[ADR-0036](../adr/0036-macos-only-platform-scope.md)。

macOS/arm64 已是唯一产品平台，窗口仍留 win32 titleBarOverlay，依赖服务仍识别 Windows/Linux 并选择 `Scripts/python.exe` 等路径。这些执行分支增加阅读和未来修改时的错误选择面。

**建议**：单独小批次清理已退役平台执行代码，保留明确的 unsupported platform/runtime 守卫。共享 Schema 或持久化历史曾接受多平台数据，是否收窄需先核对历史读取与迁移；不能机械删除所有 `win32/linux` 字面量，也不能重写旧迁移。

**验收**：正式路径明确只依赖 darwin/arm64；非法宿主/解释器明确拒绝；历史兼容语义可解释；不新增兼容 runner 或测试开关。

### R15｜P3：治理与 UI 测试辅助需要按职责组织

**位置**：[coding-standard.test.ts](../../standards/coding-standard.test.ts)；[ui-page-fixture.tsx](../../scripts/fixtures/ui-page-fixture.tsx)；[ui-app-fixture.tsx](../../scripts/fixtures/ui-app-fixture.tsx)；[styles.css](../../apps/desktop/src/renderer/src/styles.css)。

6,098 行的工程护栏已经承担许多不同主题，例外/出口注册与实现形状检查集中；UI fixture 的大分支负责多个旅程。改变代码组织时，可能先被路径、名称或源码形状耦合牵制。当前 docs:check 很快，没有证据认为治理门禁性能失控。

**建议**：保持唯一规范、唯一入口和全部护栏，将扫描辅助、按主题检查与夹具旅程在内部模块化；明确哪些断言钉领域不变量，哪些钉约定的代码形状。规则应有违反它的反例，不为每个 review 建议再加一条路径白名单。

CSS 也可在未来按 token/base/组件/页面组织，但必须保留级联顺序、主题作用域和现有视觉基线；优先级低于状态和编排，不能变成一次全仓样式重排。

**验收**：护栏清单与违规反例不缩水；检查口径、例外理由和唯一标准保持；UI fixture 拆分仍覆盖原旅程；样式整理另跑授权范围内的视觉验证。

### R16｜P3：现行规范有局部事实漂移

**位置**：[工程规范](../12-engineering-standards.md)，L191；[credential-migration-service.ts](../../apps/desktop/src/main/services/credential-migration-service.ts)，L25–108；[credential-repository.ts](../../apps/desktop/src/main/persistence/credential-repository.ts)，L110 起；[register-ipc.ts](../../apps/desktop/src/main/ipc/register-ipc.ts)，L501 起。

工程规范仍写模型/搜索密钥“明文存于本地 SQLite”，当前已有受保护存储、密文凭据仓储和 journaled 明文迁移，且受保护存储不可用时有 pending/恢复语义。这句话不再准确描述当前正式路径，容易误导以后新增配置实现。

IPC 注册辅助的文档组织也没有完整反映新的 Schedule 结果辅助。这里是规范事实同步问题，不能据此推断当前代码仍普遍明文存 Key。交接文档明确标为历史的章节也不应该一律算漂移。

**建议**：在专门文档批次更新现行规范的事实，区分正式行为、历史迁移与受保护存储不可用时的状态；不改写历史日志和已执行迁移，也不增加第二份规范。

**验收**：工程规范、能力契约和当前凭据实现一致；新增通道约定能对应实际 helper 与错误策略；不把 review 建议写成已经实施的架构。

### R17｜P1/P2：依赖版本需要单独的治理闭环

**位置**：[Desktop 依赖清单](../../apps/desktop/package.json)、[根依赖清单](../../package.json)、[依赖锁](../../package-lock.json)；[MCP 传输](../../apps/desktop/src/main/services/mcp-client-service.ts)，L578–612。

本次只读 `npm audit --json` 返回 27 个告警条目：6 moderate、20 high、1 critical。这里含传递影响与构建依赖，**不是 27 个独立 CVE，也不证明产品有 27 条可利用路径**。此前打包日志的 23 项读数不是当前审计结果。

`npm ls` 确认直接运行依赖 `@modelcontextprotocol/client@2.0.0`、`undici@6.28.0`；构建链 `electron-builder@25.1.8 → @electron/rebuild@3.6.1/node-gyp → tar@6.2.1`。根重建工具另有较新的 `@electron/rebuild@4.2.0` 和 `tar@7.5.22`，并没有自动替换 builder 的旧子树。

MCP 上游公告覆盖当前 Client 版本，并涉及 HTTP OAuth 凭据的授权服务器绑定；应用确实使用 HTTP transport 与 authProvider，但本轮尚未证明当前自定义 OAuth 流程满足全部利用条件，需优先核查。stdio 不受该项影响。[MCP 维护者公告](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h)

tar 告警涉及解包时硬链接/符号链接逃逸，当前旧版本落在构建链，不能直接当作产品材料导入的漏洞；产品 Office/Skill 解包使用其他实现。[node-tar 维护者公告](https://github.com/isaacs/node-tar/security/advisories/GHSA-83g3-92jg-28cx)

审计还识别不同位置的 Undici 版本和多项功能相关公告。例如解压预算公告针对 7.x，安装树中的 `7.29.0` 在 Electron 下载依赖，不是应用直接使用的 6.x。应按公告对应的版本和功能逐条判断，不能把某个漏洞标题套到所有同名包。[Undici 维护者公告](https://github.com/nodejs/undici/security/advisories/GHSA-3xpg-4rpp-hhhm)

**建议**：先建立运行期、构建期与不可达项的清单；优先审查网络/OAuth 依赖与制品构建路径，再制定兼容升级批次。`npm audit` 给部分链建议跨 major，甚至回退旧主版本；不能用 `audit fix --force` 作为默认方案。升级还要核对现有 patch、协议、打包与随包运行时。

**验收**：每个剩余 high/critical 有版本、可达性与处置证据；实际使用的 HTTP/OAuth、重建、打包和随包 MCP 链路通过相关测试；检查安装树和锁文件，而不只看根版本号。本轮没有改动依赖或 lockfile。

## 5. 建议的重构推进顺序

| 批次 | 范围 | 交付与停止条件 |
| --- | --- | --- |
| A：行为基线 | R01/R02 单位问题/R03/R13 红灯 | 每个问题先有失败回归；解释现有红灯；保持任务、事件、草稿正确，不做大模块搬迁。 |
| B：退出、网络与依赖边界 | R04/R05/R17 | 各自独立设计/证据与 PR；明确取消、超时、排空、目的地策略和依赖可达性；不混入 UI 重排。 |
| C：运行宿主 | R06/R02 策略/R12 | 命名依赖、纯策略与工具结果适配先抽；最后处理事件消费与终态；每批保持现有链路。 |
| D：Task 界面状态 | R07，延续 R01/R03 | 一份草稿、一份事件索引；工作列表与上下文组合职责清晰；唯一反馈出口。 |
| E：用例与读模型 | R08/R09/R10/R11 | IPC 变薄；编译期关联；候选/历史读取有界；材料语义集中；来源安全证明保持。 |
| F：整理 | R14/R15/R16 | 小范围清死代码、内部组织和文档事实；不与行为变化混提交。 |

这不是要求暂停全部功能开发。建议把 A 作为最近一批的共同基线，再在新增功能命中的模块里执行 C/D/E 的切片抽取；避免重构分支长期脱离 main。新跨模块依赖、核心关系或关键技术选择仍按项目约束新增 ADR；测试只运行当批相关门禁，完整 verify 由用户按需触发或既定夜间任务执行。

## 6. 应保留的设计与暂不建议的改动

- 保留类型化 IPC、Zod 边界、严格 TypeScript、AsyncIterable 事件和“先持久化再广播”。静态运行期导入图未发现循环强连通分量；不等于动态加载与所有外部依赖均已证明无环。
- 保留 SQLite 状态真相源、版本化成果、输入快照和来源依赖证明。AppStore 的仓储组合不是业务 God Object，不需要为了减少属性数量引入 DI 容器或 ORM。
- 保留迁移历史。`app-schema.ts` 长主要由历史迁移累积，整理可以拆文件，不能 squash、删除旧版本或在启动时临时 ALTER。
- 保留 Skill guardian 独立构建与自包含边界；它与宿主重复的小工具函数有运行隔离理由，不能为 DRY 引入宿主运行依赖。
- 保留 MCP 授权修订/hash、撤权与目的地策略，以及知识 Worker 的批次、预算、暂存发布和可解释降级。
- 不默认引入全局状态库、额外 package、通用 DAG、多 Agent、向量数据库或全面重写；没有证据表明它们能解决本报告的首要问题。
- 不把 Expert/Skill 示例文案或模型业务内容质量纳入这一轮重构任务；只围绕已实现契约、正确性和维护边界推进。

## 7. 下一轮分析需要决定的事项

1. 先以 R01/R02/R03 与 App 红灯组成一个小的正确性批次，还是按每个缺陷独立卡推进。
2. 材料业务事实防护的适用范围及可解释契约，是否继续对所有选材 Run 通用启用；技术抽取前对照现有设计确认。
3. RunService 和 Task 界面各采用什么最小职责边界；先做一个完整切片，再决定其他功能的归属。

这些决定留给后续讨论。本轮没有开始上述修复或重构。

## 8. 实施跟踪

2026-10-09 15:38：用户接受建议并下达开工指令后，先实施 A 批次。从更新后的 `origin/main`（`e75222e`）建立独立 worktree 和 `codex/review-correctness-baseline` 分支；前文仍记录 14:49 的 Review 基线，不将历史读数改成实施后的读数。

| 范围 | 本批结果 |
| --- | --- |
| R01 | App 合并为一份按 runId 索引的事件状态；快照与增量按事件 id 合并、sequence 排序；读取代次与选择代次一起防止旧历史回写。保留启动回执前的事件，回执后补读持久化日志；已收到终态时不被旧 running 摘要重新标成执行中。 |
| R02 单位 | 用户请求和材料录入使用与输出审计一致的单位 trim；覆盖空格、制表符、换行、全角空白、家/户/客户、全角百分号、负数与小数。数值组合与业务防护策略的抽取仍留 C 批次。 |
| R03 列出的入口 | 技能取消选择/删除使旧详情失效，列表响应只采用最新代次；任务历史、最近任务、讨论节点、材料候选/文件选择、成果版本来源身份及启动回执按当前对象和代次提交。A→B→A 同样丢弃旧请求，成功、失败和 busy 都受保护。 |
| R13 草稿红灯 | 确认输入框重挂载先出现空值、再由 passive effect 恢复草稿的时序窗口；查找输入框存在可以先于恢复完成。改为初始化时读取现有草稿，并新增首帧回归；原定时 Task 草稿保留用例及完整 App 文件已通过。夹具组织问题仍留后续批次。 |

事件状态的合并提前完成了 R07 的一部分；Task 草稿所有权、界面职责和成果反馈尚未全面拆分，不能将 R07 整项标为完成。B/C/D/E/F 其余工作继续按第 5 节的独立边界推进。

本地证据：App 55 项、RunService 79 项，相关 Hook/事件函数与工程护栏 168 项，共 302 项通过；typecheck、定向 ESLint/Prettier 与 drift:check 通过。真实 Electron 的 `--app-only` 离线旅程通过：4 个 Run、失败/取消及重开恢复，网络尝试 0；AI 回读草稿和取消截图。未运行完整 verify、全主题 UI 矩阵或真实模型调用；PR Gate 与人工验收单独记录。

2026-10-09 15:56 复核补充：Task 历史的读取代次独立于 Run 选择代次。开始续作时仍合并同一 Task 已在加载的历史；新任务、重新选择 Task 或跨 Task 选择 Run 时使旧历史失效。新增回归先复现“续作开始后旧 Run 要等终态才重新显示”，再修复；App 全文件现在为 56 项，本批相关验证累计 303 项。第一轮提交 `c42d47d` 的 PR Gate 已通过，但尚未合并；补充提交继续核对自己的最新 SHA 门禁。

## 9. A 合入后的推进建议

2026-10-09 16:14 核对：[PR #22](https://github.com/gyzhang/BetterWork/pull/22) 已 squash 合入 main，合并提交为 `2e46e770a13f3c12b1a77110b3e740d6054cbca7`；最新源提交 `a2bdc4ae6e91d164d8c0579b53677044ed9a0465` 的 [PR Gate](https://github.com/gyzhang/BetterWork/actions/runs/37902393807) 成功。第 8 节保留各检查时点的历史事实。本节只细化后续建议，不表示 B–F 已实施，不改变原有功能任务板或 ADR 状态。

### 9.1 下一批：将 B 拆成三个独立任务

B 开始时先刷新 R17 的只读审计与安装树证据。若确认存在可达的 high/critical 运行路径，前置对应依赖修复；其余按 B1 → B2 → B3 推进。原审计读数只代表 Review 时点，不直接当作后续版本的当前结论。

| 任务 | 范围与交付 | 验收条件 |
| --- | --- | --- |
| B1：退出生命周期（R04） | 明确索引、记忆提炼、技能依赖准备等后台工作的所有者；停止接收后取消或排空，最后关闭 Worker、网络客户端和数据库；定义有界等待与恢复语义。 | 受控异步阶段退出、重复退出、异常退出下，资源关闭后零写入、零新派发；子进程结束或有明确中断记录。使用临时 SQLite 和进程替身，不操作用户运行数据。 |
| B2：网页请求边界（R05） | 先纠正域名/IP 分类及超时与用户取消原因；另准备 DNS、实际连接地址绑定和逐跳重定向的具体方案，核对 ADR-0017 后确定实现边界。 | 正常 fc/fd 域名、特殊网段、IPv6、重定向及取消/超时有离线回归。一次 lookup 不能冒充连接绑定；涉及新的安全边界先完成方案判定。网页与 MCP 授权语义各自保持。 |
| B3：依赖治理（R17） | 按运行期/构建期、实际版本与功能可达性逐项处置，分别评估网络/OAuth、重建和制品构建链；兼容升级形成小 PR。 | 每个剩余 high/critical 有证据与处置理由；核对锁文件、安装树、已有 patch 和受影响的 macOS 打包链路。不得以强制自动升级或根版本号替代验证。 |

### 9.2 后续结构重构：按职责切片，逐次合入

| 顺序 | 先做什么 | 保持什么 |
| --- | --- | --- |
| C：RunService（R06/R02 策略/R12） | 从命名依赖、可单测的材料策略和工具结果适配开始，最后整理事件消费与终态；不一次搬走全部编排。 | Agent Core 边界、先持久化再广播、撤权/取消/恢复与来源原子性。材料事实防护的适用范围先对照 ADR-0020 与现有契约，不能借抽取改变策略。 |
| D：Task 状态（R07） | 集中草稿所有权、选择身份和请求生命周期，再减少 App 的跨簇接线与页面组合职责。 | A 批次的单一事件索引、A→B→A 保护、迟到启动回执语义，以及唯一反馈出口。 |
| E：用例与读模型（R08–R11） | 逐个把 IPC 业务用例移到现有 Application 层，建立明确类型关联，再约束候选/历史读取与集中材料规则。 | Zod 边界、任务/材料范围、历史兼容与来源安全证明；不默认增加 package、ORM 或通用框架。 |
| F：整理（R14–R16） | 分别清理退役平台执行分支、内部测试/护栏组织和现行文档事实；文档事实同步可作为独立小任务穿插。 | macOS/arm64 守卫、历史迁移、全部护栏与现有视觉基线；不与行为变化混提交。 |

每个任务从最新 main 建短期分支，以“现状证据 → 具体边界 → 实现与相关回归 → Review → 最新 SHA 的 PR Gate → 合并清理”收口。已证明的缺陷先保留能失败的反例；纯组织调整保留原有行为测试，不能靠放宽断言制造绿灯。合并后更新本报告的实施跟踪，完整 verify 仍只由用户按需或夜间计划运行。下一项建议进入 B1；B2 的连接策略与 C 的业务事实策略先准备具体方案供判定，不从本推进表推导新的产品或安全契约。

## 10. B1 实施跟踪

2026-10-09 16:56：用户授权从 B1 开始，明确不新开 worktree。从干净 `main` 的 `e4a438ed0ab964a279c9419ca9df667e230997f4` 建立 `codex/review-background-shutdown` 分支，在原 checkout 实施 R04。当前为实现与本地回归记录，PR Gate 与合并事实另行核对。

- ApplicationContext 显式拥有知识索引、记忆提炼和依赖准备；退出协调器先停止接收/调度、取消并等待后台工作，随后排空通知、关闭 Worker，最后关库。额外等待全部启动任务结束，避免一项初始化失败时遗漏仍在运行的其他任务。
- 索引与提炼保留已发布结果，未完成作业转 `interrupted`；登记前的模型/凭据解析也纳入等待，迟到结果不派发新请求或改写终态。依赖准备等待探测、下载、安装、结果轮询和清理，取消与超时按 macOS 进程组终止并核验后代。
- 同次复核发现 MCP 检测和 OAuth 原本只 abort、未 join；现在等待检测、发现/登录/刷新和凭据写入结束。总退出预算 15 秒，超时保留数据库，再次退出复用仍在运行的清理；真正失败才重新尝试，重复退出幂等。
- 本地相关功能测试 132 项、依赖准备 33 项、RunService 79 项通过；覆盖临时 SQLite、提取/嵌入/模型解析/下载迟到、依赖五个进程阶段、真实父子进程、MCP/OAuth 和重复退出。最早的退出预算与服务 shutdown 反例已在修复前失败。类型检查通过，最终格式/文档/治理检查继续核对。
- 刷新只读 `npm audit --json` 仍为 27 条（6 moderate、20 high、1 critical）。本批未升级依赖，也未完成逐条可达性判定，R17 留 B3；不将告警总数解读为已排除运行期风险。B2 网页边界与 C–F 未实施。

契约落点见[系统架构 §3.1](../03-system-architecture.md#31-应用退出与后台工作所有权)、[知识作业](../development/knowledge-contracts.md#8-索引作业与代次)及[记忆生命周期](../development/memory-contracts.md#73-持久化生命周期)。没有新 package、IPC/Schema 或迁移，不改原功能任务板与 ADR 状态；未启动完整 verify、真实模型或用户数据库验收，也未启停用户开发应用。

2026-10-09 16:59 本地收口：补启动屏障后退出/进程回归 11 项通过；MCP 与工程护栏复查 180 项通过。相关用例按文件去重共 398 项通过（132 functional、33 依赖准备、79 RunService、154 工程护栏），最终 typecheck、定向 ESLint/Prettier、docs:check 与带批次基点的 drift:check 通过。护栏初次指出测试直接写取消名称，已统一使用 `isAbortError`，未放宽规则；PR Gate 尚待远端执行。

2026-10-09 20:21 合并前复核：[PR #24](https://github.com/gyzhang/BetterWork/pull/24) 的首轮源提交 `7e0fb6a8121cf6a7929707c7110c5d2fcf7b5bd8` 已通过 [macOS PR Gate](https://github.com/gyzhang/BetterWork/actions/runs/37908708758)。继续核对时补上 OAuth 本地回调监听器关闭回执的等待；新回归在移除等待时失败，补齐后 OAuth/MCP/工程护栏 181 项通过，本地累计按文件去重为 399 项。补充提交必须核对自己的最新 SHA 门禁，不能沿用首轮绿灯；尚未合并。

2026-10-09 20:27 最终收口：源提交 `007aa279e0f9b685bf9a5933defc44af40e6c5ec` 的 [macOS PR Gate](https://github.com/gyzhang/BetterWork/actions/runs/37929647973) 成功，静态检查、受影响 functional/heavy 均通过；Full verify 按规则跳过。[PR #24](https://github.com/gyzhang/BetterWork/pull/24) 已 squash 合入 main，合并提交 `d095fc87820da97a07a8e0d44f36177088d092f5`；原 checkout 已同步 main，已合并代码分支已清理，全程没有新建 worktree。B1/R04 的代码与自动化验证收口；本轮未代替人类验收，B2/B3 与 C–F 仍保持原边界。

## 11. B2 实施跟踪

2026-10-09 20:56：用户要求推进 B2，从干净 main `da622d3e49bf05bd12f4882885b2f5d4ecd0def6` 建立 `codex/review-web-request-boundary`，使用原 checkout，不新建 worktree。先完成 [ADR-0046](../adr/0046-web-fetch-destination-binding.md) 的具体连接方案，用户选择“同意完整方案并实施”，状态记为 Accepted；本节为实现与本地证据，远端门禁、合并另记。

- R05 的域名/IP 分类使用 `isIP` 与 BlockList；正常 fc/fd 域名放行，localhost/local 尾点、IPv4 各 URL 表示、私网/链路本地/共享/组播/保留及 IPv6 映射/特殊网段拒绝。具体地址策略固定在 ADR-0046，不把所有通过分类的地址称为已证明可达。
- 每跳检查全部 DNS 回答，混合/空/非法结果拒绝；第一个批准地址复制后固定在独立 Undici Agent 的实际 socket lookup 中，域名、TLS SNI 与证书校验保留。重定向先释放前一跳，再重新校验与解析；同主机重定向也重新解析。成功、拒绝、HTTP/正文错误、截断、取消和超时释放响应与 Agent；DNS/HTTP 迟到结果不能派发新工作或成为成果证据。
- DNS、连接、重定向和正文共用 15 秒预算，正文停滞也能结束等待；用户取消与超时保留第一原因。超时是 `tool.failed`，不是用户取消；Core 仍允许模型处理工具错误后继续，未借 B2 改变 Run 失败策略或 Evidence 接口。保留既有 1,000,000 字节正文截断数值。
- 最早的 27 项回归在修复前 17 项失败；最终网页服务/网络策略 111 项通过。连接退化探针临时移除 socket lookup 时 TCP/TLS 两项失败，恢复后通过；测试走真实 Undici 到被拦截的 Node 连接入口，全部离线，没有真实内网或公网请求。
- 工具/Core/MCP/工程护栏 180 项、RunService 79 项通过；按文件去重共 370 项，覆盖既有网页 Evidence 持久化。typecheck 通过，定向 lint/format、中文回读、差异空白、文档/治理终检继续核对；本批不运行完整 verify、真实模型、安装包或人工公网旅程，也不启停用户开发应用或写用户数据库。

没有新依赖、package、IPC、Schema 或迁移；MCP 的 public/private/loopback 授权独立保持。B3/R17 依赖治理与 C–F 未实施，不由本批离线绿灯推导依赖风险已排除。

2026-10-09 20:58 本地终检：定向 ESLint/Prettier、typecheck、docs:check、差异空白与带批次基点的 drift:check 通过，读数已留档；结构护栏 154 条、例外 203 条保持，未修改规则或扩大例外。最终中文文档已回读；远端最新源 SHA 的 PR Gate 尚待执行。

2026-10-09 21:05 最终收口：源提交 `23e451645c9a583f2aad5f5afddb83a032254e4e` 的 [macOS PR Gate](https://github.com/gyzhang/BetterWork/actions/runs/37933802737) 成功，静态快检、文档护栏和按依赖图选择的相关测试步骤均通过；Full verify 按规则跳过。[PR #26](https://github.com/gyzhang/BetterWork/pull/26) 已 squash 合入 main，合并提交 `e7551eddb9b5a6c5dface0c502ca9a8337f8ec8b`。原 checkout 已同步 main，代码任务分支本地/远端均已清理，全程未新建 worktree；本归档仅修改 Markdown，按独立文档 PR 门禁收口。B2/R05 的代码与自动化证据完成，真实公网和安装包旅程仍待人工验收；B3/R17 与 C–F 继续保持原边界。


## 12. B3 依赖治理实施证据

2026-10-09 21:25，B3/R17 已完成兼容依赖升级与本地验证，进入 PR Gate 收口；详见[逐链处置报告](2026-10-09-dependency-governance.md)。MCP client/core 升至 2.3.1，应用 Undici 精确锁定 6.29.0，builder 26.15.3 移除嵌套 rebuild 3.x/node-gyp 9.x/tar 6.x；兼容叶依赖同步修复，既有 PPTX patch 保留。

干净安装后全树审计为 16 项（12 moderate、4 high、0 critical），生产审计为 5 moderate、0 high/critical。四个 high 是同一无稳定修复版 braces 告警沿 patch-package 开发工具链传播；当前 glob 来自仓库固定 workspaces，四包未进入产品制品。其余 moderate 的 Office/构建调用条件与保留理由均逐链记录，未强制降级或隐去告警。

328 项相关回归、类型/定向静态检查、生产构建、macOS arm64 未签名 DMG 和校验通过；包内 SQLite、空 PATH 下的三个 Node stdio MCP、44 项随包资源哈希及 PPTX patch 均核对。完整 verify 未自动触发，真实账号、Developer ID 安装态和用户窗口不由本批代签，C–F 仍未开工。


2026-10-09 21:40 最终收口：源提交 `5ecc080e5f7feeb0fb93b9f7fb3660f692928b88` 的 [macOS PR Gate](https://github.com/gyzhang/BetterWork/actions/runs/37937420161) 通过，按依赖图选择的 237 文件 / 2333 项测试通过；Full verify 按规则跳过。[PR #28](https://github.com/gyzhang/BetterWork/pull/28) 已 squash 合入 main，合并提交 `c021db2ebab354ebbea79557e8bd7f8dfbaeffc9`。原 checkout 已同步，代码分支本地/远端已清理，没有新建 worktree；最终合并证据以纯文档 PR 归档。B3/R17 的修复和逐链分析完成，剩余告警与人工验收边界见依赖治理报告，C–F 未自动开工。

## 13. C1：RunService 具名依赖与生产装配

2026-10-09 22:06：用户授权从 C1 开始，从干净 main `b00873b553406c947e4964729b8e371ef7545124` 建立 `codex/review-run-service-dependencies`，继续原 checkout，不新建 worktree。当前为实施边界，验证与合并事实另记。

- 将 19 个位置参数改为具名依赖，生产工厂要求完整接线并在构造前拒绝缺失项；迁移生产、测试和离线宿主全部六处调用，不把占位问题转移到测试 helper。
- 测试与离线宿主通过具名构造器明确能力子集，保留原有可选能力行为；生产入口只使用完整工厂。窗口返回 `null` 是合法状态，不能误判为依赖缺失。
- 保留 Run 事件、终态、取消、撤权、材料范围和来源原子性；不抽取材料事实策略、工具结果或终态编排。C2 及 C 的其余切片、D–F 继续待后续指令。

装配契约见[系统架构 §3.2](../03-system-architecture.md#32-runservice-的具名依赖装配)。没有新 package、IPC、Schema、迁移或产品范围变化；同层装配调整无需新增 ADR。

2026-10-09 22:13 本地证据：六处调用和 32 处 helper 调用迁移完成；RunService 83 项（新增装配回归 4 项）、IPC/记忆集成/定时六期与工程护栏 228 项通过，去重共 311 项。临时禁用装配检查后新增 4 项全部失败，恢复后通过；未放宽现有断言。typecheck、定向 ESLint、生产 build 通过；真实 Electron `--app-only` 离线旅程完成 4 个 Run、失败/取消及重开恢复，网络尝试 0，AI 已回读重开截图。首次测试遇到 Electron 本地自动安装并发冲突，确认运行文件完整后原命令复查通过，没有修改依赖或产品代码绕过环境失败。文档、格式、治理终检与最新 SHA 的 PR Gate 继续核对；完整 verify 未自动触发，未调用真实模型或操作用户数据库/开发窗口。

2026-10-09 22:20 最终收口：源提交 `a1c2a356f13821d7d392ad22043652e69079aece` 的 [macOS PR Gate](https://github.com/gyzhang/BetterWork/actions/runs/37942836781) 成功，静态快检、文档护栏 154 项、相关 functional 74 项与 heavy 83 项通过，共 5 文件 / 311 项；Full verify 跳过。[PR #30](https://github.com/gyzhang/BetterWork/pull/30) 已 squash 合入 main，合并提交 `8ac5002419ff1e795e9cf8abda30151491791526`。原 checkout 已同步 main，代码任务分支本地/远端均已删除，全程没有新建 worktree；最终证据以独立纯文档 PR 归档。C1 的依赖装配与自动化验证完成，R06 的其他职责仍未全面拆分；下一项为 C2 材料事实策略，先核对 ADR-0020 与现有适用范围，再按后续授权抽取。D–F 继续待推进。

## 14. C2：材料事实策略抽取与采集开销

2026-10-09 22:42：用户授权继续 C2，从干净 main `93abc92d73ec9b19f9828adb1ede7ae535767a5d` 建立 `codex/review-material-fact-policy`，使用原 checkout。已将启用、采集和输出审计移至同层纯策略；RunService 保留六处工具片段适配与事件/来源/终态协调。保持有材料范围且实际选材的 Run 防护，不按专家/提示词重新推断。详见 [C2 范围与证据](2026-10-09-material-fact-policy.md)。

采集改为直接值存储，派生许可仅为本次实际输出按需批量查询，所有查询共用一次配对扫描；不永久保存数字笛卡尔积。纯策略 41、RunService 83、相关 functional 230 项，共 354 项功能回归通过，独立 bench 2 项通过；300 场景/155,712 次审计与旧实现一致。typecheck、定向 lint/format 和 build 通过，最终文档/治理/应用旅程与远端门禁继续核对。

本批完成 R06 的纯策略边界和 R02 的读取阶段枚举问题；指标、单位、期间和来源关联仍不是现行数字池能证明的事实。保留原许可与错误契约，最坏审计扫描仍为二次量级；不能将本批称为 R02 全部语义问题已解决。工具结果适配、终态整理和 D–F 待后续切片。

2026-10-09 22:50 本地终检：docs:check（154 项）、差异空白与原批次基点的 drift:check 通过，护栏 154、例外 203 及规则指纹保持。app-only 一组真实 IPC/临时 SQLite 离线旅程通过，4 个 Run、失败/取消与重开恢复、网络尝试 0，AI 已回读截图；不等于完整 UI 或人工验收。代码与自动化已完成，最新源 SHA 的 PR Gate 和合并证据继续收口。


2026-10-09 22:56 远端收口：源提交 `82809db2f986e39ebd4846222d08c2e132e8b179` 的 [macOS PR Gate](https://github.com/gyzhang/BetterWork/actions/runs/37947330899) 成功，静态快检、文档护栏 154、相关 functional 115 与 heavy 83 项通过，按本次 CI 输出共 6 文件 / 352 项；本地另执行的经营工具 2 项不计入该 CI 数字。Full verify 跳过。[PR #32](https://github.com/gyzhang/BetterWork/pull/32) 已 squash 合入 main，合并提交 `eaeaf76df3f838330bd9b556b1d50cef4f59b199`。原 checkout 已同步，代码分支本地/远端均已删除，没有新建 worktree；最终证据从此合并提交建立 `codex/review-c2-closeout`，以纯 Markdown PR 归档。 C2 完成；R02 的关联语义问题、C3 工具结果适配和其余治理继续待后续切片。
