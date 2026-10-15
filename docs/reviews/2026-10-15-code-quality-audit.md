# 代码质量、规范一致性与重复实现复审

- 审查时间：2026-10-15，Asia/Shanghai，取自本机 `date`。
- 基点：`3401a12a4997f7a7fb1bc02e3e4f0b355901c5b8`；开始时工作树干净，fetch 后从 `origin/main` 在当前目录检出 `codex/code-quality-audit-20261015`。
- 初次审查范围：静态扫描、关键链路阅读、现有定向测试与离线反例；10:03 归档时只新增报告并追加工作日志。用户随后授权修复 A01–A05，实现与验证见 §7；未提交或推送。
- 本文记录发现与建议，不改变已有任务板、ADR 状态或人工验收结果，也不宣称这些问题均由 v1.2.0 新引入。
- 修复状态：A01–A05 已在当前工作树修复并通过日常快检，证据见 §7；下文 §1–§6 保留首次审查的基点事实。

## 1. 判断

基础规范总体一致：全仓 ESLint、Prettier、TypeScript 均通过；治理巡检没有发现其覆盖范围内的漂移。现有定向 functional 653 项和 heavy 156 项通过。

没有发现足以支持“全仓存在大量复制粘贴、需要整体重写”的证据。重复集中在少量契约描述、结果包装与旧算法，以及导入和迁移等有意保留的结构。更明显的问题是**同一工程契约在不同路径落实不一致**：部分请求有完整代次保护，另一些没有；Promise 正常返回被误当作领域成功；错误消息的敏感信息边界也不统一。

本轮确认 **5 类行为缺陷：1 项 P1、4 项 P2**，使用实际 Hook、搜索客户端和 Agent Engine 的离线探针形成 8 个失败反例。还记录 3 类重复实现和 2 类维护问题。优先修复行为，再做小范围去重与职责拆分。

## 2. 已确认的行为缺陷

### A01｜P1：搜索错误回显的密钥会进入工具事件和下一轮模型上下文

位置：[search-engine-service.ts](../../apps/desktop/src/main/services/search-engine-service.ts) L73–80；传播链为 [web-search.ts](../../packages/tool-runtime/src/web-search.ts)、[agent-engine.ts](../../packages/agent-core/src/agent-engine.ts) L241–249、[run-repository.ts](../../apps/desktop/src/main/persistence/run-repository.ts) L113–134。

搜索客户端将外部 JSON 的 `message` 直接拼入错误，也把 fetch 异常的 message 原样拼入连接错误。服务端或代理若在认证错误中回显提交的 Key，这段文本会到达设置页；在 Run 中则进入 `tool.failed.error` 和下一次模型请求的 tool message。RunRepository 对事件整体序列化落库，没有另行脱敏。

离线使用合成 Key，注入返回 HTTP 401 且 message 含该字符串的 fetch：客户端错误保留了该字符串。继续执行真实 `createWebSearchTool` 和 `ReActAgentEngine`，确认失败事件与下一轮模型请求均包含它。没有使用真实凭据或调用网络；落库路径由源码确认，未操作用户库，也没有声称真实密钥已经发生泄漏。

这违反 AGENTS §5 的密钥日志纪律、工程规范 §6 的错误信息约束，以及服务自身“任何错误信息都不得包含 Key”的声明。

建议：在知道当前凭据的服务边界生成有界、安全的诊断；保留可行动的 HTTP 状态与稳定错误类别。外部 message、网络异常和嵌套原因均按同一边界处理，测试同时检查返回消息、工具失败事件与下一轮请求，不能只检查 Authorization 头未写日志。

### A02｜P2：知识页切换集合后，旧列表和旧搜索仍能回填

位置：[use-knowledge-library.ts](../../apps/desktop/src/renderer/src/hooks/use-knowledge-library.ts) L203–218、L441–447、L538–576。

列表刷新直接 `.then(setDocuments)`，成功、失败和 loading 均没有请求代次保护。`setFilter` 清空查询和结果，但没有推进 `searchSeq`；旧搜索只与“下一次搜索”比较代次，无法识别集合已经变化。同一 Hook 的正文详情已有 `detailSeq`，这两条路径的落实明显不同。

两个离线反例：

1. 集合 A、B 依次请求列表，先完成 B 再完成 A。最终筛选仍为 B，列表却是 A 的文档。
2. 在 B 发起搜索，等待时切换到 C。C 已清空查询和结果，B 的旧搜索完成后又写入 B 的命中。

影响是当前筛选与展示/后续勾选的材料身份不一致；集合本身不是权限边界，本文不把它描述成突破 Run 授权。

建议：列表与搜索分别持有请求身份；集合切换同步使两类旧请求失效。成功、失败、loading 和清空结果使用同一有效性判据，补 A→B→A、旧失败、同集合重复刷新反例。依据为工程规范 §5 的过期响应保护。

### A03｜P2：MCP 清单旧响应会回退连接修订，并污染下一次操作的 CAS 参数

位置：[use-mcp-connections.ts](../../apps/desktop/src/renderer/src/hooks/use-mcp-connections.ts) L35–56。

`refresh` 没有请求代次，较早的清单响应可覆盖较新的连接记录。`request()` 随后从被覆盖的 `connections` 中提取 `expectedRevisionId`，因此这不只是旧文字闪回，还会让检测、登录、删除等后续操作携带旧修订。

离线先发两个清单请求，先完成含 `revision-new` 的请求，再完成含 `revision-old` 的请求；再次调用 `test`，实际提交的 `expectedRevisionId` 为 `revision-old`。宿主 CAS 应拒绝该过期操作；没有证据表明它能绕过宿主校验。

建议：对清单的成功、失败与 loading 一并加代次保护；将“旧清单之后实际发出的动作参数”纳入回归。当前两个测试只覆盖单次读取成功/拒绝。

### A04｜P2：记忆静默请求抢占普通刷新后，loading 无法结束

位置：[use-memories.ts](../../apps/desktop/src/renderer/src/hooks/use-memories.ts) L120–164；界面分支见 [MemoryView.tsx](../../apps/desktop/src/renderer/src/views/MemoryView.tsx) L494 起。

普通 `load(false)` 设置 loading，筛选变化的 `load(true)` 使用同一请求序号使前者失效。旧请求无法执行结束逻辑，新的静默请求又只在 `!silent` 时关闭 loading，因此两者都完成后仍为 true。

离线先完成首读并显示一条记录，再执行 `refresh()`，随后 `setQuery('no-match')`，让新查询返回空列表，最后完成旧刷新。所有请求均已结束，实际状态仍为 `loading=true, query=no-match, items=[]`。此组合会让记忆分区持续显示“正在加载记忆…”，搜索控件所在分支也被替换。

建议：silent 只决定开始请求时是否展示加载态，当前有效请求完成必须关闭自己接管的加载态。补刷新→搜索、首读→筛选、最新请求失败和写后补载的组合测试，不改变旧响应作废原则。

### A05｜P2：两处连接检测忽略 `ok=false`，将真实失败显示为成功

位置：[use-model-settings.ts](../../apps/desktop/src/renderer/src/hooks/use-model-settings.ts) L114–121；[use-search-engine-settings.ts](../../apps/desktop/src/renderer/src/hooks/use-search-engine-settings.ts) L73–87。生产返回见 [register-ipc.ts](../../apps/desktop/src/main/ipc/register-ipc.ts) L1289–1312、L1555–1588。

模型探测和搜索探测在 HTTP 失败、超时等情况下正常返回 `{ ok: false, message }`，IPC 也按该契约返回。两个 Hook 都在 await 后无条件 `showToast('success', result.message)`，只有 Promise rejection 才进入错误出口。

离线为两个真实 Hook 返回 `{ ok: false, message: 'HTTP 401' }`，两者均得到 `toast={ tone: 'success', message: 'HTTP 401' }, error=''`。这不是假设一种不存在的返回：主进程的 HTTP 错误与缺 Key 路径确实使用该结果类型。

现有“连接测试失败”测试注入的是 rejected Promise，未覆盖生产常见的领域失败分支；测试标题与覆盖能力不一致。建议显式分支判断 `ok`，可修正的连接错误使用现有表单错误出口，补完整的成功、领域失败、传输拒绝矩阵。无需为两个简单分支建立通用设置控制器。

## 3. 重复代码的读数与取舍

### 3.1 扫描方法

以 `git ls-files apps packages` 中 `.ts/.tsx` 为输入，排除 `.test.*`、`.bench.*`、`fixtures/`、`test-helpers`、`test-fixtures` 和 `.d.ts`，得到 **324 个文件、96,021 个物理行**，包含空行与注释。该口径不包括测试、CSS、检查脚本和 JSON；与 drift 的“产品源码行”口径不同。

临时扫描器去除行首尾空白，跳过空行和以注释标记开头的行，寻找至少连续 12 个相同行的片段；合并同一文件的命中区间，避免一行多次计数。另按 TypeScript AST 比较至少 70 token 的完整函数体，忽略 token 间排版。

| 读数 | 结果 |
| --- | ---: |
| 满足阈值的重复片段配对 | 40 对 |
| 配对命中区间涉及的物理行 | 1,613，约占范围内 1.68% |
| 排除 import、历史迁移和 Guardian 配对后 | 23 对，798 行，约 0.83% |
| 完整函数体相同的候选 | 1 对，Preload 成果详情/版本详情归一化 |

这些数字是**按本次阈值命中的片段占用量**，不是成熟 clone detector 的全仓重复率，也不是可以直接删除的行数。去除上述大类后仍包括接口字段与 Hook 返回值/视图解构字段的镜像，这些不能当成重复业务实现。改名、语句重排、短于阈值和语义近似的重复未被完整度量，结论限于未发现大规模逐行复制。

### 3.2 值得安排的小范围去重

| 候选 | 证据与建议 | 优先级 |
| --- | --- | --- |
| 成果来源的模型 JSON Schema | [artifact-declare-sources.ts](../../packages/tool-runtime/src/artifact-declare-sources.ts) L24–104 与 [artifact-register-file.ts](../../packages/tool-runtime/src/artifact-register-file.ts) L97–184 各维护四种来源引用和 relation 枚举。实际创建工具后，两者的 `inputRelations.items` 深比较一致，序列化均为 1,438 字节。共享 Zod 已存在，模型侧仍要同步两份；建议在 tool-runtime 内共用该稳定片段，保留各工具不同的说明、必填性和执行语义，并验证模型定义与 Zod 的接受范围。 | P3 |
| v1/v2 记忆预算运行算法 | [memory-retrieval.ts](../../apps/desktop/src/main/services/memory-retrieval.ts) L301–340 与 L351–418 重复偏好池和普通组装配。`rg` 确认旧 `applyRecallBudget` 只有测试消费者，生产 `memory-recall-service.ts` 使用 v2。契约 §11.4 要求新运行只用 v2、旧记录只读 v1；建议核对后移除无生产消费者的 v1 运行算法或明确其保留用途，把有效预算断言接到生产选择器。冻结的 v1 Schema/历史解码必须保留。 | P3 |
| Memory/参考成果的 Result 包装 | [memory-service.ts](../../apps/desktop/src/main/services/memory-service.ts) L75–115 与 [workspace-reference-service.ts](../../apps/desktop/src/main/services/workspace-reference-service.ts) L54–96 重复请求哈希、成功/失败结果和可重试码判断；提炼服务也有相同请求哈希。建议仅复用同一 Memory 契约的纯结果构造与哈希助手，各服务错误类型映射仍保持自己的语义。不要扩成全项目错误框架。 | P3 |

**有意保留的重复**：历史迁移是版本快照，不能为降重复率修改已发布 SQL；Main/Preload 分别声明实际消费的协议导入是边界职责；Guardian 自包含是工程规范 §2 的明确要求。Preload 相同的归一化函数可评估复用，但应先保持联合类型收窄和全部通道类型契约，不能用宽类型断言换取少几行。

## 4. 维护与规范一致性

### 4.1 入口职责仍集中，应按状态所有权拆分

本次口径下 15 个文件超过 1,000 行。前五个文件合计 16,036 行：

| 文件 | 物理行 |
| --- | ---: |
| `packages/agent-protocol/src/index.ts` | 7,353 |
| `apps/desktop/src/main/db/app-schema.ts` | 2,310 |
| `apps/desktop/src/main/ipc/register-ipc.ts` | 2,280 |
| `apps/desktop/src/renderer/src/App.tsx` | 2,163 |
| `apps/desktop/src/preload/index.ts` | 1,930 |

长度本身不是缺陷：协议的单一公开入口、迁移历史和显式 IPC 映射具有合理增长原因。优先关注实际状态所有权：[App.tsx](../../apps/desktop/src/renderer/src/App.tsx) L200–297 仍集中材料、任务历史、记忆捕获、通知导航与界面选择；[McpSettings.tsx](../../apps/desktop/src/renderer/src/views/McpSettings.tsx) 的主体函数从 L143 延续到 L1273，包含连接表单、保存、导入、检测、登录及工具审阅。

已有成果导航、工作消息组件、Run 终态协调和工具结果适配的拆分应保留。后续按材料选择、任务历史、MCP 编辑/导入/登录这类内聚状态簇小步整理，先固定失效/失败/取消反例，再转移所有权；不设任意行数门槛，不改成通用 CRUD 或全局状态框架。

### 4.2 错误词汇与现行交接仍有人工规则未被护栏覆盖

- 工程规范 §4/§5 和交接说明声明统一使用 `agent-core/errors.ts` 的 `describeError`，但 [file-artifact-service.ts](../../apps/desktop/src/main/services/file-artifact-service.ts) L27、[input-snapshot-service.ts](../../apps/desktop/src/main/services/input-snapshot-service.ts) L73、[search-engine-service.ts](../../apps/desktop/src/main/services/search-engine-service.ts) L33 仍各有本地同名函数，技能依赖另有 `messageOf`。部分实现只是同一 `Error.message/String(error)` 转换，搜索的缺省文本则不同。建议逐处使用中央转换或明确登记安全/领域包装用途；统一错误转文本本身不能解决 A01 的脱敏问题。
- [交接说明](../11-qoder-handoff.md) L133 仍称消息流和 Composer 为内联 JSX，而实际 [App.tsx](../../apps/desktop/src/renderer/src/App.tsx) L1757、L1798 已复用 `WorkMessageList`、`Composer`；L117 写工具轮次默认 8，实际 Agent Engine 默认 20，生产默认值来自运行设置。应明确源码默认与生产设置的区别。
- [系统架构](../03-system-architecture.md) L369 的“核心路径改动加一次真实桌面验收”与当前工程规范/ADR-0046 的按需 UI 验证口径不一致，应直接引用现行唯一规则。

这些属于 P3 的规范/文档治理问题，不能据此宣称既有静态检查失败。它们也解释了为什么 `drift:check` 绿灯仍不能代替语义审查。

## 5. 检查证据与边界

| 本次执行 | 结果 |
| --- | --- |
| `npm run drift:check` | 退出 0；156 条结构判据、204 条例外登记，未发现其覆盖范围内漂移 |
| `npm run lint` | 退出 0，全仓 |
| `npm run format:check` | 退出 0，全仓 |
| `npm run typecheck` | 退出 0，全仓 |
| 定向 functional | 29 文件 / 653 项通过，退出 0 |
| 定向 heavy：RunService、App | 2 文件 / 156 项通过，退出 0 |
| 实际生产模块离线反例探针 | 8/8 预期行为断言失败，退出 1；对应 A01–A05，保留原失败，未修改实现 |
| 报告落盘后的 `check:quick -- --base origin/main` | 纯 Markdown 档，156 项文档/结构检查通过，退出 0 |

functional 覆盖 Agent Core、全部 tool-runtime、Preload、IPC、搜索与模型探测、记忆预算和本轮涉及的五个 Hook。两档运行命令与输出保存在证据目录；本轮 809 个现有通过用例不包含 8 个离线失败反例，文档检查另计。

证据目录：`/Users/kevin/.codex/verification-evidence/betterwork-code-quality-2026-10-15`，含源码 SHA-256 清单、扫描器和结果、探针和结果、静态检查及两档测试日志。宿主为 Darwin arm64、Node v26.8.1。复现探针需在仓库根目录执行，使用当前安装依赖：

```sh
NODE_PATH="$PWD/node_modules" node /Users/kevin/.codex/verification-evidence/betterwork-code-quality-2026-10-15/betterwork-quality-probes.cjs
```

在本报告基点预期退出 1 并列出 8 个 FAIL；这是审查反例，未作为已修复缺陷的 Red/Green 证据。修复时应将每项反例变成同目录的正式行为回归。

按 GATE-0 先尝试对指定产品 SQLite 作只读连接，文件无法打开；随后阅读 `/tmp/betterwork-dev.log`，其内容止于先前开发启动，未提供本轮缺陷的用户运行证据。因此以上为源码和隔离替身下的确定性反例，不是用户数据库事故诊断。测试仅使用已有离线夹具/临时存储，没有启停用户应用。

未执行完整 `npm run verify`、真实 Electron UI 检查/页面走查、构建、bench、真实模型/API 调用或依赖漏洞审计；未覆盖的性能、视觉、安装和业务语义不作通过判断。已有 QI08、WM、KM、CF、SC 人工验收状态保持原任务板。

## 6. 建议的修复顺序

1. 先修 A01：服务边界安全诊断，覆盖事件和模型上下文传播。
2. 同批修 A02–A04：逐状态簇补请求生命周期反例，统一有效性与 loading 归属；先复用可靠模式，不预设新框架。
3. 修 A05：按实际 IPC 结果分支呈现，并修正测试只模拟 rejection 的盲区。
4. 再整理三处 P3 重复和入口状态所有权，同轮校准现行交接；历史迁移和旧记录 Schema 保持冻结。

各实现批次继续使用原工程规范的 TDD、差异覆盖和快门禁，不为本报告新增另一套质量标准。

## 7. A01–A05 修复与回归

2026-10-15 用户明确要求检查并修复上述 5 类缺陷；继续在 `codex/code-quality-audit-20261015` 实施，基点仍为 `3401a12a4997f7a7fb1bc02e3e4f0b355901c5b8`。本节时间来自本机 `date`，首次定向绿跑为 10:27，必要整理后 10:28 再次通过。

修改 6 个生产文件与其同目录测试，保持 IPC、持久化、授权与页面结构不变。§3 的重复实现建议和 §4 的职责整理未在本批次开工。

| 缺陷 | 实现 | 正式回归 |
| --- | --- | --- |
| A01 | 搜索客户端对外部错误中所有当前 Key 的字面出现脱敏，详情最多 500 字符；网络错误保留脱敏后的原因，不保留外部堆栈及嵌套 cause。错误转文本复用 Core 现有函数，HTTP 状态、正常检索和用户取消语义保持。 | 重复 Key/正则特殊字符、超长错误、网络异常及嵌套原因；真实 Web Search Tool → Agent Engine 的失败事件和下一轮请求均无合成 Key。超时特征测试另验失败分类及脱敏原因。 |
| A02 | 列表的成功、失败和 loading 使用独立请求代次；切换集合立即使搜索代次失效，卸载同时失效列表和搜索。 | 旧成功/失败分别在当前列表前后完成、A→B→A、当前请求自身失败、集合变化后的旧搜索成功/失败。 |
| A03 | MCP 清单同样对结果、错误和 loading 统一核对请求代次，卸载失效在途请求。 | 新清单先到后旧修订不得回退，后续检测实际使用新 CAS 修订；旧成功/失败不得结束当前加载，旧失败不得覆盖新结果。 |
| A04 | silent 只影响请求开始时的加载展示；当前有效记忆请求无论是否 silent 都负责结束 loading，卸载使请求失效。 | 普通刷新被静默查询抢占后，查询成功、领域失败、传输失败均结束加载；旧回执作废；首读被范围变化抢占同样收口。 |
| A05 | 两个连接检测 Hook 显式检查 `ok`，失败进现有表单错误出口；每次检测开始清除上一条局部成功提示；两类结果均刷新已落库的连接状态。 | 先成功后返回 `ok=false`，保留模型表单/搜索 Key、清除旧成功且只呈现内联错误，搜索 busy 解除，清单刷新继续。既有 rejection 回归保持。 |

### 7.1 TDD 证据

先只修改测试，生产模块保持基点内容：

- A01/A05 的 3 个文件：5 个新增反例全部失败、18 项既有通过，Vitest 退出 1。
- A02–A04 的 3 个文件：15 个新增反例全部失败、53 项既有通过，Vitest 退出 1。
- 修复后同一 6 个测试文件：91/91 通过，退出 0；随后对错误原因构造与卸载清理做必要整理，再次 91/91 通过。3 个有请求清理的 Hook 测试补齐真实 unmount teardown。
- 另补 1 项超时分类与安全原因的特征测试，最终定向 6 文件/92 项通过；此项没有测试先行，不计入前述 20 个红跑反例。

红跑分别保存在 `betterwork-fixes-a01-a05-red.log` 与 `betterwork-fixes-a02-a04-red.log`，最初绿跑为 `betterwork-fixes-green.log`，含特征测试的定向绿跑为 `betterwork-fixes-green-final.log`；源码 SHA-256 与命令留在 `/Users/kevin/.codex/verification-evidence/betterwork-five-defect-fixes-2026-10-15`。这是正式回归的真实红绿证据，与 §5 初次审查的临时探针分开。

### 7.2 验证状态

最终 `npm run check:quick -- --base origin/main` 退出 0：全仓 lint、差异格式、全仓 typecheck、156 项文档检查、14 文件/389 项相关 functional、2 文件/156 项 heavy 通过；差异可执行生产行覆盖 **38/38（100%）**，未新增例外或放宽门槛。545 项相关行为测试包含前述定向回归，不与 92 项相加。

第一次定向 lint 指出的导入排序、catch 参数赋值与 ref 清理捕获问题已整理。超时补测初版使用取消名称字面量，被既有结构判据拒绝；改为 Core 的 `isAbortError` 后最终快检通过，保留该次退出 1 的记录，未修改护栏。部分 RunService 夹具仍输出异步简报同步遇已关闭库的诊断；其行为断言与门禁通过，不将该独立诊断解释为已在本批次修复。

最终快检及 `coverage/quick` 的计划、测试 JSON、源码快照和差异读数与红绿日志一同留档。目标是基点上的未提交工作树，准确生产源码 SHA-256 见证据目录，不把基点 SHA 当成已发布修复。

本批次未启动完整 verify、真实 Electron UI 或页面走查、真实模型/API、用户库写入、提交或推送；现有人工验收状态不变。按 GATE-0 的本次只读连接可建立，未查业务表；开发日志文件本次不存在，使用正式离线反例定位与验证。
