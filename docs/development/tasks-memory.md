# 工作型记忆开发计划（WM00–WM16）

- 生效：2026-09-22。本文件是 WM 系列**唯一任务状态板**：状态列是活动真相源，[设计总稿快照](../../.qoder/specs/工作型记忆设计与开发交接_task-17a.md)（`.qoder/specs/工作型记忆设计与开发交接_task-17a.md`）永不回写，避免两套活动任务板。
- 设计：[工作型记忆产品设计](../designs/work-centered-memory.md)（产品行为真相源）。决策：[ADR-0026](../adr/0026-work-centered-memory.md)（**Proposed**）。字段/算法/迁移/接口：[记忆实施契约](memory-contracts.md)（唯一真相源）。提示词：[记忆编码提示词](memory-coding-prompts.md)。
- 授权边界：**设计批准、单卡开发授权、真实模型调用授权、提交发布授权相互独立**。WM00 只归档文档；WM01 开工前需用户明确批准具体技术方案，不得自动连续开工、提交或推送。
- 平台与并行：本轮 macOS。WM 与 [阶段 A](README.md)/[专家计划](tasks-experts.md)（E 系列）/[能力基础计划](tasks-capability-foundation.md)（CF 系列）并行，不重复排期、不改写其任务状态；E55/E56、CF11 等外部验收仍属原任务板。
- 执行方式：严格串行、每次一张卡；遵守[执行手册](README.md)与全仓唯一[工程规范](../12-engineering-standards.md)，不创建新规范、第二套测试门禁或额外依赖。
- 归档基线（WM00 实测，2026-09-22 14:36）：HEAD `bfc66cd`；当时 `git status --short` 只含未跟踪 `.qoder/specs/`、`docs/designs/work-centered-memory.md`、`docs/logs/2026-09-22.md`，无已跟踪文件改动；应用库最新迁移 **v25**；`docs/adr/` 最大编号 **0025**，0026 未占用；`materialPurposeSchema` 实际枚举为 `rule`/`current-input`/`historical-comparison`/`structure-reference`/`template`/`background`/`other`。**这些不是未来开工时的固定值，每卡重新核对。**

## 0. 文档状态与使用方式

- 设计日期：2026-09-22，取自本轮 `date` 命令。
- 状态（2026-09-23 01:57 收口，见 §15）：**WM00–WM15 done，WM16 doing。** 近期产品范围已获用户确认；ADR-0026 与其契约仍记为 Proposed（接受状态待光哥确认），但技术方案已按用户 2026-09-22 目标模式指令实施，WM01–WM15 有自动化验收证据。本板记录的仍是「卡片验收状态」，不等于工作树内容快照，也不把自动化通过写成人工已通过。
- **2026-09-22 14:38–14:56 并发工作树观察（事实记录，非验收）**：WM00 执行期间，工作树出现非本卡产生的代码改动与新增文件——`apps/desktop/src/main/ipc/register-ipc.ts`/`.test.ts`（记忆写通道改为 `await` 内层 Promise）、`apps/desktop/src/main/services/memory-service.test.ts`、`packages/agent-protocol/src/index.ts`（`countCodePoints`、`MEMORY_*` 限额常量、`sha256HexSchema`/`memoryOperationIdSchema`）、`packages/agent-core/src/types.ts`、`openai-compatible-provider.ts`/`.test.ts`，以及未跟踪的 `memory-retrieval.ts`/`.test.ts`、`memory-content-policy.ts`/`.test.ts`、`run-history-policy.ts`/`.test.ts`。WM00 **未修改、未回滚、未验证**这些文件，也不掌握其授权与测试结果；它们与 WM01/WM02/WM03/WM04/WM06/WM08 的对应关系、是否满足各卡 Given/When/Then、是否取得 ADR-0026 技术方案批准，均待对应卡自行核对与证据记录。任何后续卡开工前必须先重跑 `git status` 与本表比对，不得据此把状态写成 done。**后续事实（2026-09-23 记录）**：这些改动自 2026-09-22 22:33 起由 WM01–WM06、WM08–WM11 各卡接管，补齐定向测试后按卡提交，逐卡证据见 §15。
- 后续使用 Qwen3.8-Flash 逐卡开发，提示词见[记忆编码提示词](memory-coding-prompts.md)。
- 已存在未跟踪文件 `docs/logs/2026-09-22.md` 含用户既有记录，不得覆盖或删除；归档时按实际时间追加。
- WM00 本轮没有运行应用、测试、数据库诊断或浏览器验收；设计文档 §2.2 的风险来自静态核查，不能写成已复现、已修复。
- 阅读顺序：先产品设计与 ADR，再按本卡列表读契约对应小节；契约不复述在本文件，本文件不复述字段。

## 11. 文件责任和阶段划分

根路径：`/Users/kevin/Dev4AI/BetterWork`。下表「拟新增」列为后续拟改文件，动手前先查等价实现，**不得当作已存在的路径引用**。

| 责任 | 既有落点 | 拟新增内聚模块 |
| --- | --- | --- |
| 协议/接线 | packages/agent-protocol/src/index.ts；main/ipc/register-ipc.ts；preload/index.ts | 不另建协议入口 |
| 数据库/装配 | main/db/app-schema.ts；main/persistence/index.ts；main/index.ts | 按下面仓储聚合 |
| 记忆治理 | main/persistence/memory-repository.ts；main/services/memory-service.ts | memory-operation-repository.ts（操作/裁决）；services/memory-provenance.ts；memory-content-policy.ts |
| 召回 | 现有 MemoryService | services/memory-retrieval.ts（纯函数） |
| 运行与历史 | services/run-service.ts；persistence/run-context-snapshot-repository.ts | persistence/run-memory-context-repository.ts；services/run-history-policy.ts；run-memory-audit.ts |
| 模型 | agent-core/src/types.ts、openai-compatible-provider.ts；Main credential-access.ts | services/model-provider-factory.ts |
| 提炼 | Run 及 discussion-checkpoint-service 触发点 | persistence/memory-extraction-repository.ts；services/memory-extraction-service.ts；memory-extraction-prompt.ts |
| 简报/参考 | 成果仓储、TaskMaterialService | persistence/workspace-reference-repository.ts；services/workspace-brief-service.ts |
| UI | App.tsx、MemoryView、ContextPanel、WorkspaceSelector、ArtifactView、use-memories、use-artifact-viewer | hooks/use-memory-suggestions.ts、use-run-memories.ts、use-workspace-brief.ts；components/MemorySuggestionList.tsx、WorkspaceBrief.tsx、MemoryEditor.tsx |

测试与实现同目录；已有 hook 测试后缀按其是否含 JSX 确定，使用已存在文件不另造并行测试体系。新模块只在对应卡有真实职责时创建，不预铺目录。

## 12. WM 唯一任务板与逐卡完成定义

### 12.1 共用规则

状态仅 todo/doing/blocked/done。点数为相对复杂度，不是工期或模型耗时承诺。严格串行，前卡 done 才能下一卡；人工里程碑单独记录，不能将自动测试通过写成人工已通过。

所有代码卡：读必读文档→核对基线/前置→列文件和契约对齐清单→先必要回归→实施→定向测试→typecheck→verify→更新本卡/当日日志→交接停止。不得把测试拖到最后。

缺陷卡执行 GATE-0：先只读检查可用 SQLite 与开发日志，再分析代码；现场数据不具备时明确记录「不适用/不可得」，用隔离真实 SQLite 测试复现，不编造现场结果、不修改用户数据库。

共同停止条件：用户改动冲突；契约须作实质改变；准备扩大范围/新增外部依赖/访问真实服务；迁移编号冲突；来源安全无法证明；必需验收缺条件。常规编码和本卡缺陷自主解决，不每个小步骤重复请示。

### 12.2 总表

| 卡号 | 主题 | 点数 | 前置 | 状态 |
| --- | --- | --- | --- | --- |
| WM00 | 文档归档与基线核对 | 2 | 本稿 | done |
| WM01 | 记忆写 IPC 异步回归修正 | 3 | WM00＋设计批准 | done |
| WM02 | 治理数据、CAS 及幂等事务 | 8 | WM01 | done |
| WM03 | 来源治理、写契约与投影一致性 | 8 | WM02 | done |
| WM04 | 确定性相关召回 | 5 | WM03 | done |
| WM05 | 运行记忆/依赖审计存储 | 5 | WM04 | done |
| WM06 | 安全历史与真实请求阶段接线 | 8 | WM05 | done |
| WM07 | 人工治理及运行可见性界面 | 5 | WM06 | done |
| WM08 | 共享模型解析及 Provider 提炼边界 | 5 | WM07 | done |
| WM09 | 自动建议设置和持久作业 | 5 | WM08 | done |
| WM10 | 严格提炼、触发与候选闭环 | 8 | WM09 | done |
| WM11 | 建议、同意、取消及重试交互 | 5 | WM10 | done |
| WM12 | 精确参考成果版本 | 3 | WM11 | done |
| WM13 | 工作空间确定性简报 | 5 | WM12 | done |
| WM14 | 简报和成果复用界面 | 5 | WM13 | done |
| WM15 | 跨任务/空间/重启集成验收 | 8 | WM14 | done |
| WM16 | 用户验收与交接收口 | 3 | WM15＋人工授权 | doing |

WM00 证据见[2026-09-22 工作日志](../logs/2026-09-22.md)的 WM00 一节：五份规范文档已建立并双向链接，基线核对完成，文档检查（中文回读、链接与锚点、字段一致性、`git diff --check`、未跟踪新文件单独读取）通过；未写业务代码、未运行构建、未提交。WM01 起需用户明确批准 ADR-0026 的具体技术方案。

### WM00：文档归档与基线核对

- 只改第 15 节文档及链接（清单见本卡下方「归档与链接检查清单」）；把总稿完整分拆，契约单一真相源，不复制整套字段到多处。
- 核对 HEAD/工作树/迁移最新号/ADR0026 占用/并行 CF 改动/材料 purpose 实际枚举，不重做产品设计。
- Given 本稿完整，When 归档，Then 设计、ADR、契约、任务卡、提示词五份文档均存在且双向链接有效；Given 路径已有用户内容，Then 增量合并或报告冲突，不覆盖。
- 文档检查：中文新增片段回读、链接/锚点和字段一致性、`git diff --check`；未跟踪新文件要单独检查，不能只凭 git diff。无需 npm 构建。
- 文档可在具体方案待评审时保持 Proposed；开工 WM01 前需要用户明确批准。本卡结束不编码。

#### 归档与链接检查清单（总稿第 15 节，落在此处以免另立第六份文档）

WM00 拆分为五份明确产物：

| 路径 | 唯一职责 |
| --- | --- |
| [docs/designs/work-centered-memory.md](../designs/work-centered-memory.md) | 总稿 1–3、产品验收和范围；产品行为真相源 |
| [docs/adr/0026-work-centered-memory.md](../adr/0026-work-centered-memory.md) | 总稿 4 及关键取舍、替代关系；编号查重 |
| [docs/development/memory-contracts.md](memory-contracts.md) | 总稿 5–10；字段/状态/算法/迁移/接口唯一真相源 |
| [docs/development/tasks-memory.md](tasks-memory.md) | 总稿 0、11–13；WM 唯一任务状态板、卡、里程碑 |
| [docs/development/memory-coding-prompts.md](memory-coding-prompts.md) | 总稿 14；可复制的交接提示词，不重复定义字段 |

归档后总稿作为设计阶段快照保留，后续实施状态只更新本文件，避免两套活动任务板。设计/契约/ADR/任务/提示词相互链接；明确哪个文档负责哪类真相。

必须接入的现有入口：

- [AGENTS.md](../../AGENTS.md)：「任务路由」「当前阶段」新增 WM 入口及独立授权边界。
- [docs/README.md](../README.md)：「技术设计提案」「开发执行规划」。
- [docs/development/README.md](README.md)：顶部增量说明与「文档路由」，不复制 WM 状态。
- [docs/adr/README.md](../adr/README.md)：新 ADR 及替代关系。
- [docs/07-mvp-and-roadmap.md](../07-mvp-and-roadmap.md)：当前开发顺序的独立增量，不改写旧 Phase 或 E/CF 状态。
- [docs/04-knowledge-and-memory.md](../04-knowledge-and-memory.md)：记忆体系/形成/治理/知识加工闭环，区分已实现与拟实施。
- [docs/02-domain-model.md](../02-domain-model.md)：解释 Task 是临时上下文，非新增长期记忆 scope。
- [docs/03-system-architecture.md](../03-system-architecture.md)：新增 Main 提炼服务/请求审计/派生简报边界。
- [docs/10-ui-ux-system.md](../10-ui-ux-system.md)：记忆页、可关闭上下文、空间简报、参考标记的提案，保留现有导航/反馈规则。
- [expert-contracts.md](expert-contracts.md)、[material-contracts.md](material-contracts.md)、[capability-contracts.md](capability-contracts.md)：只补相关双向链接及需要调整的上下文兼容说明，不提前实现 CF 新接口。
- [ADR-0015](../adr/0015-memory-scope-and-governance.md)：只追加被新提案细化/拟替代的条款链接，批准前不写成已生效替代。
- [docs/logs/实际日期.md](../logs/2026-09-22.md)：先 `date`、重读、追加；不把设计记录当作实现或验收记录。

文档验证：新增中文逐段回读；Markdown 链接逐一确认，内部标题锚点核对；计划中的未来代码路径标「拟新增」而非已存在链接；检查类型/key/枚举/预算在契约与任务提示词一致；新未跟踪文件单独检查；`git diff --check`。**无需修改工程规范、依赖或构建配置。**

### WM01：异步响应回归

- 文件：register-ipc.ts/.test.ts，memory-service.test.ts；只修 await 和响应 Promise 问题，不提前改整个响应协议。
- Given 真实异步服务，When create/update/set-status，Then 返回已解析 Record 且写一次；Given 服务 reject，Then 错误收口且无未处理拒绝。
- 用真实注册回调和 SQLite 验证，不能 mock 掉 Promise 行为。投影成功/失败双路径先建立测试证据；投影已提交语义在 WM03 统一 Result 切换时处理，明确记录过渡限制。
- 定向：`npm test -- apps/desktop/src/main/ipc/register-ipc.test.ts apps/desktop/src/main/services/memory-service.test.ts`。

### WM02：治理数据与事务

- 文件：协议、app-schema、memory-repository、memory-operation-repository、persistence 装配及同目录测试。
- 实现新增字段、legacy 机械标记、CAS/幂等、日期 clear、拒绝恢复、原子替代、精确修订外键和父对象删除引用预检；不激活新来源召回门禁直到 WM03。
- Given 同 operationId 重复提交，Then 一份效果；Given 并发同修订或双记录替代任一失败，Then 零部分写入；Given 终态记录，Then 不能复活。
- 定向：migrate.test.ts、memory-repository.test.ts、memory-operation-repository.test.ts；覆盖新库/旧库/回滚/外键/重启。

### WM03：来源、写契约和投影

- 文件：MemoryService、memory-provenance/content-policy、旧四 IPC/Preload、use-memories/App/MemoryView 及测试。
- 一次升级旧写调用方到 Result/operationId/action，提供 legacy 复核及自主口径表单入口；新门禁启用与入口同卡落地。投影串行、提交成功＋警告、手动重建。
- Given 用户自主口径，Then 换期材料仍可复用；Given 派生结论确认，Then 依赖不被解除；Given 伪造来源或 secret，Then 拒绝且不写敏感快照；Given DB 已提交投影失败，Then 保存成功但可见待修复，不重复写。
- 定向：memory-service.test.ts、memory-provenance.test.ts、memory-content-policy.test.ts、register-ipc.test.ts 及 use-memories 现有测试。

### WM04：确定性召回

- 文件：memory-retrieval.ts/.test.ts、MemoryService/Repository、RunService 召回入口。
- 精确实现契约[第 6 节](memory-contracts.md)分词、score、过滤、冲突组、小偏好池和预算；不增加 FTS 或分词依赖。
- Given 大量无关/已排除项，Then 不占预算；Given emoji/非 BMP 内容，Then code point 计数正确；Given 超预算长记录，Then 跳过后补短项；Given 无命中，Then 仅合法通用偏好或空。
- 定向：memory-retrieval.test.ts、memory-service.test.ts、run-service.test.ts。

### WM05：运行审计数据

- 文件：共享 DTO、app-schema、run-memory-context-repository、run_memory_reads 扩展、RunService 准备写入和装配。
- 保存 selected 及直接/传递依赖所需结构、精确引用、旧 legacy_unknown；提供内部查询，不在存储卡声称历史重放已经安全。
- Given 准备成功，Then 精确有序修订和 budget 落库；Given 写失败，Then 无半运行快照；Given 旧记录，Then 没有伪造请求 hash 或时间。
- 定向：run-memory-context-repository.test.ts、migrate.test.ts、run-service.test.ts。下一卡再启用全部安全重放和请求阶段。

### WM06：安全历史与请求接线

- 文件：run-history-policy、run-memory-audit、RunService、TaskContext 最新版本校验、memory:run-context/preview 接线、必要 preload。
- 将新旧入口统一到明确材料范围；最后最终回答、时间边界、传递依赖、连续安全后缀；Provider 包装器记录真实 request-prepared/dispatch-attempted。
- Given 旧记忆撤销或材料替换，Then 实际 Provider 输入无相关旧历史；Given 只是预算落选或材料增加，Then 保留仍安全历史；Given 并发未来轮次，Then 不纳入；Given 审计失败，Then 不调用 Provider。
- 定向：run-history-policy.test.ts、run-memory-audit.test.ts、run-service.test.ts、register-ipc.test.ts；必须断言请求 messages，不只断言 segmentId。

### WM07：人工治理及透明展示

- 文件：MemoryView、MemoryEditor、ContextPanel、use-memories、use-run-memories、App 及测试。
- 完成 confirm/reject/restore/replace/keep-both/日期 clear/Task 排除；分开下次预览与本次快照，展示来源和当前/历史状态。相同字段直接复用协议 DTO。
- Given 修订冲突，Then 草稿保留；Given 快速切 Run/空间，Then 迟到响应不覆盖；Given Task 排除，Then 其他 TaskContext 字段完整。
- 定向：MemoryView/ContextPanel 测试、use-run-memories 测试、App 相关测试。人工 UI 交给用户，不擅自浏览器验收。

### WM08：共享模型与 Provider

- 文件：model-provider-factory、RunService 模型解析、agent-core types/Provider 及测试；不改 CF 凭据迁移业务。
- 复用配置凭据；新增请求额度及 finishReason/usage；Run 记录非敏感实际模型身份。提炼严格模式没有 Fake 回退。
- Given profile 上限低于 2048，Then 使用较低值；Given length/EOF/unknown/工具调用，Then 提炼层可区分；Given 普通 Run，Then 原行为兼容。
- 定向：openai-compatible-provider.test.ts、model-provider-factory.test.ts、run-service.test.ts；fetch 替身，禁止真实触网。

### WM09：设置、作业与恢复

- 文件：settings/jobs 迁移、memory-extraction-repository、服务调度部分、相关 IPC/Preload、Main 启动恢复。
- 来源唯一、global concurrency 1、queued 20、revision/attempt、取消和单次重试同意；执行器通过注入接口单测，不放空生产实现。
- Given 默认关闭，Then 零自动入队/请求；Given 重启 queued/running，Then interrupted 且零网络；Given 重复来源/迟到结果，Then 不重复提交；Given 关开关，Then 取消该空间自动作业。
- 定向：migrate.test.ts、memory-extraction-repository.test.ts、memory-extraction-service.test.ts、register-ipc.test.ts。

### WM10：严格候选提炼

- 文件：memory-extraction-prompt/service、Run 终态/DiscussionCheckpoint 保存触发、MemoryService 候选内部入口。
- 按契约[第 7 节](memory-contracts.md)最小用户证据＋必要背景、来源依赖、严格 JSON、限额、敏感内容检查；候选和作业成功同事务，主 Run 失败隔离。
- Given 合法用户纠正，Then 最多 3 条 candidate；Given 0 条，Then 成功；Given 工具调用/错误 JSON/越权字段/超时/secret，Then 不写 confirmed 且不记录敏感原文；Given 原 Run 完成，Then 提炼失败也不改变终态。
- 定向：memory-extraction-service.test.ts、memory-extraction-prompt.test.ts、discussion-checkpoint-service.test.ts、run-service.test.ts。

### WM11：建议交互

- 文件：use-memory-suggestions、MemorySuggestionList、设置记忆页、任务入口/ContextPanel 及测试。
- 开关告知与同意版本、候选批次、状态/取消/手动重试、0 条与失败区分；可见活动时轮询、离开清理。主动口径保存不依赖模型。
- Given 跨空间切换，Then 不串候选；Given 关闭或取消，Then 不接受迟到成功；Given 重试，Then 只授权一次调用且不开自动建议；Given 每条候选，Then 无逐条全局 Toast。
- 定向：use-memory-suggestions.test.ts、MemorySuggestionList.test.tsx、MemoryView 相关测试。

### WM12：参考成果精确版本

- 文件：workspace-reference-repository、迁移、共享协议/IPC/Preload、引用归属校验。
- 同空间 active≤20、固定 version/hash、CAS/幂等、取消参考；不新增 Artifact 批准字段，不读全文。
- Given 成果新增版本，Then 参考仍指旧版本；Given 跨空间/失效/哈希不符/超上限，Then 拒绝；Given 重复提交，Then 只一条标记。
- 定向：workspace-reference-repository.test.ts、migrate.test.ts、register-ipc.test.ts。

### WM13：确定性简报

- 文件：workspace-brief-service、对应 IPC/Preload、同目录测试。
- 契约[第 10 节](memory-contracts.md)取数/排序/限制/来源状态/未决标识完整；不存正文副本、不调用模型。
- Given 同数据，Then 内容和排序稳定（generatedAt 除外）；Given 空空间，Then 诚实空态；Given 过期/未核来源/其他空间，Then 不混入确认区；Given 开放节点，Then 不标成已确认。
- 定向：workspace-brief-service.test.ts、register-ipc.test.ts。

### WM14：简报与引用 UI

- 文件：WorkspaceBrief/use-workspace-brief、WorkspaceSelector、ContextPanel、ArtifactView/use-artifact-viewer、App 新任务草稿衔接。
- 简报可关、参考标记、Markdown/PPTX 精确引用；新任务不自动发送、不继承原材料/授权，来源专家按产品设计[第 3.6 节](../designs/work-centered-memory.md)处理。
- Given 选择指定版本，Then TaskContext 固定 version/hash；Given 目标消失/切空间迟到/保存冲突，Then 错误可见且草稿不丢；Given 参考标记，Then 不冒称业务批准。
- 定向：WorkspaceBrief.test.tsx、use-workspace-brief.test.ts、ArtifactView.test.tsx、use-artifact-viewer.test.tsx、App.test.tsx。

### WM15：系统级合成验收

- 新增 `main/services/work-centered-memory.integration.test.ts`（拟新增路径），必要 fixture 置同目录测试资源，禁止使用公司真实文件。
- 真实 SQLite＋mock fetch 捕获实际 Provider 请求；两 Workspace 同 Expert、每空间两个独立 Task、重启、替代/删除/排除/到期、中文混合检索、材料更换、legacy、取消迟到、提炼失败、投影故障全覆盖。
- Given 自主口径确认，Then 第二独立 Task 正确带入；Given 派生记忆依赖没选，Then 不带入；Given 旧规则被替代，Then 直接记忆和历史回答均无旧规则；Given 另一个 Workspace，Then 不泄漏。
- 运行该集成测试、相关全部定向测试、typecheck、verify；自动 fixture 只证明机制，不能证明真实模型语义质量。

### WM16：用户验收与收口

- 文档/验收记录为主，不扩功能。收集实际代码版本、命令退出码、用户步骤和结果；按 WM 里程碑收口，不改 E/CF 状态。
- 用户分别确认：人工保存/修改/来源/排除；开关和候选质量；两期实际交付；简报和精确版本引用。真实模型调用只用用户授权的配置/合成材料。
- 缺人工证据则保持 doing/blocked 及「人工待验」，不标总体 done。签名安装/真实 MCP 等未完成项仍回原任务板，不绑架本地记忆开发。
- 最终定向回归、typecheck、verify；只交接，不自动提交、推送或发布。
- 当前收口状态：Spec 侧自动化证据已闭环到 §15.6–§15.15（阈值收口与护栏见 §15.13，文档链接取证见 §15.14）。等待项只有 §15.5 的五项人工验收与真实模型授权下的语义确认，外加 §15.12 那一处口径偏离需要光哥拍板——「沿用来源 Run 快照的专家身份」当前按 Task 草稿取专家。本卡保持 doing，不得因测试全绿转 done。

## 13. 测试、里程碑与可观测性

### 13.1 测试数据与硬断言

合成空间甲「经营分析」、空间乙「市场研究」，共用一个专家；每空间两个独立任务。例句：

- 自主口径：「收入按回款金额统计，不使用签约金额。」
- 新规则：「本期改为不含税回款金额。」
- 表达偏好：「先列异常和待决策事项，再列总体指标。」
- 临时事实：「本期续约率为 82%」，不得泛化为永久公司事实。
- 去重对照：「不得合并/可以合并」「10 万元/100 万元」。
- 中英混合：「ARR 不含一次性实施费，单位为万元」。

测试覆盖矩阵：协议非法字段/ID 归属；CAS 与幂等；状态终态；migration 回滚/外键；有效期边界/clear；来源移除但修订残留；依赖递归/循环；中文与非 BMP 预算；conflict 组；实际请求与重放；opt-in 0 调用；无模型/截断/EOF/工具调用；取消/重启/迟到；投影 DB 成功；UI 过期响应；参考精确版本/新任务不带旧授权。

### 13.2 里程碑

| 里程碑 | 范围 | 自动证据 | 人工证据 |
| --- | --- | --- | --- |
| WM-M0 | WM00 | 文档完整性、链接和基线 | 具体设计批准 |
| WM-M1 | WM01–WM07 | 治理、相关召回、安全历史、请求审计 | 保存/复核/排除/冲突/本次记忆 |
| WM-M2 | WM08–WM11 | 无工具提炼、同意、取消、恢复 | 告知与真实候选质量 |
| WM-M3 | WM12–WM14 | 简报、精确版本链路 | 简报与 Markdown/PPTX 引用 |
| WM-M4 | WM15–WM16 | 系统回归和全量门禁 | 连续两次实际工作与最终确认 |

里程碑使用 WM 前缀避免与 CF 的 M0–M5 混淆。每个里程碑的自动结果、用户 UI 结果、模型语义结果分栏记录，缺一项不伪造。

### 13.3 本地观察数据

复用 operations/jobs/run contexts 记录，不新增第三方埋点服务。事件语义：`candidate_created`、`candidate_confirmed`、`candidate_rejected`、`memory_replaced`、`memory_selected`、`memory_dispatch_attempted`、`memory_excluded`、`extraction_finished`、`reference_selected`。属性只含范围 ID、任务/运行 ID、状态/原因、数量/耗时/真实 usage，不含正文/secret。UI 可以从这些记录生成诊断计数，不宣称「被选中＝改善成果」。

### 13.4 验证命令

后续代码卡在仓库根执行：

```text
npm test -- <该卡列出的仓库相对测试路径>
npm run typecheck
npm run verify
git diff --check
```

禁止管道截尾掩盖退出码；记录命令、退出码和实际失败原因。Markdown 不在 Prettier 范围；文档卡用中文回读/链接/差异检查，不跑无关构建。新未跟踪文件需单独读取检查。

真实桌面只按 `bash scripts/dev-start.sh` / `bash scripts/dev-stop.sh` 管理，未经用户要求不自动 Browser/ComputerUse 验收。人工验收由用户执行并反馈；模型语义质量不能由 stub 测试代替。

## 14. 交接输出

每卡交接说明：卡号与状态、实现行为（含失败/取消/恢复）、修改文件、命令与退出码、迁移版本、文档与日志、人工待验项、风险、下一卡前置。缺必需证据不得标 done；只交接，不自动提交、推送或发布。提示词模板见[记忆编码提示词](memory-coding-prompts.md)。


## 15. WM15/WM16 收口记录（2026-09-23 01:57 CST）

本节只收集**已发生的事实**：代码版本、命令与退出码、命名偏离、契约缺口与人工待验项。缺证据的条目一律标「待验」，不写成通过。

### 15.1 代码版本（`git log` 时间戳，基线 `bfc66cd`）

| 提交 | 时间 | 覆盖卡 |
| --- | --- | --- |
| `51615e0` feat(memory): 在工作型记忆协议里定义来源治理、召回预算与统一 Result 契约 | 2026-09-22 22:33 | WM01–WM05 协议部分 |
| `911aa1c` feat(agent-core): 为模型请求补齐输出额度并回传结束原因与用量 | 2026-09-22 22:33 | WM08（Provider 边界） |
| `46be772` feat(memory): 落地工作型记忆的主进程策略层 | 2026-09-22 22:33 | WM02–WM06、WM08、WM13 策略层 |
| `8c886fa` feat(memory): 治理服务收口 Result 契约并接入记忆 IPC 首批通道 | 2026-09-22 22:53 | WM01、WM02、WM03 |
| `13dab82` feat(memory): 接入自动提炼作业闭环（WM08–WM11） | 2026-09-22 23:16 | WM09、WM10、WM11 |
| `741fba8` feat(memory): 讨论节点反馈接上自动提炼入队 | 2026-09-22 23:22 | WM10 触发点 |
| `3ffd605` style(memory): 补回前序 WM 提交漏掉的 prettier 排版 | 2026-09-23 00:18 | 排版收口 |
| `1bca8e3` feat(memory): 跑通确定性召回、运行审计与安全历史重放 | 2026-09-23 00:19 | WM04–WM06、WM12、WM13 |
| `5ea0651` feat(memory): 接上记忆治理、建议审阅与工作空间简报界面 | 2026-09-23 00:20 | WM07、WM11、WM14 |
| `6b10ac7` test(memory): 断言召回记忆与安全历史后缀真正进入模型请求体 | 2026-09-23 00:30 | WM06 |
| `3836cd6` fix(memory): 自动建议一次装载只认最后返回的请求 | 2026-09-23 00:49 | WM11 缺陷 |
| `c06cd18` test(memory): 补齐运行可见性与经验建议的界面测试 | 2026-09-23 00:49 | WM07、WM11 |
| `b3c97c9` test(memory): 补齐简报、参考版本与运行可见性的界面测试 | 2026-09-23 01:17 | WM07、WM14 |
| `2da9180` test(memory): 补齐工作型记忆系统级合成验收 | 2026-09-23 01:57 | WM15 |

WM16 的文档收口（本节、AGENTS.md、ADR-0026、契约、产品设计、docs/03、04、07、10、两个 README、当日日志）随本卡提交，不含新功能。

### 15.2 自动化证据（仓库根执行，逐条记录退出码）

| 命令 | 结果 | 退出码 |
| --- | --- | --- |
| `npx vitest run apps/desktop/src/main/services/work-centered-memory.integration.test.ts` | 10 tests passed（WM15 全部场景） | 0 |
| `npm test -- <18 个 WM 定向测试文件>` | Test Files 18 passed，Tests 207 passed | 0 |
| `npm run typecheck` | 无输出 | 0 |
| `npm run verify`（lint + format:check + typecheck + test + build） | Test Files 108 passed，主/渲染进程构建完成 | 0 |
| `git diff --check` | 无输出 | 0 |

WM15 集成测试的事实边界：真实文件 SQLite（关得掉、重得开）、`fetch` 全替身并捕获 Provider 实际请求体、两个合成工作空间共用一个专家、每空间两个独立任务、启动阶段零网络断言。它只证明机制与范围隔离，**不证明真实模型语义质量**。

WM15 期间发现并修正的两处测试自身缺陷（不是产品缺陷）：

1. 材料范围 Run 必须真实调用 `read_text_file` 才能通过 `auditMaterialFacts`；替身改为按清单里的 `path` 发起一次读取，否则源 Run 以「材料事实校验失败」收口，提炼作业按 `SOURCE_UNAVAILABLE` 正确拒绝入队。
2. 「替代后历史无旧规则」的原始写法把旧规则写进替身回答正文，等于要求产品改写历史，与「替代不改写历史」的契约自相矛盾。改为先让旧规则真实成为某一轮的记忆依赖，再断言替代后该轮被 `memory-revised` 截断、旧正文不再作为记忆注入。

### 15.3 结构性核对（本次实测，非引用旧结论）

- 迁移 v26–v29 存在且 `db/migrate.test.ts` 覆盖（`workspace_memory_settings`、`memory_extraction_jobs`、`workspace_artifact_references` 等）。
- 本增量 IPC 通道共 18 个：`memory:*` 14 个，加 `workspace:memory-brief` 与参考版本的 list/set/remove 3 个；`register-ipc.ts` 与 `preload/index.ts` 全部一一命中，无缺注册、无多余暴露。
- 契约 §11 拟新增的 `run-memory-audit.ts` **未单独建文件**：审计事实由 `persistence/run-memory-context-repository.ts`、`services/run-history-policy.ts`、`services/memory-dispatch-gate.ts` 与 `services/memory-recall-service.ts` 承载。命名偏离在此记录，不新增空模块凑结构。
- §8.3 `HISTORY_REFERENCE_BLOCKS_DELETE` 已实现于 `services/workspace-reference-service.ts` 并有测试；不存在「无删除入口」的缺口。

### 15.4 曾上报的契约缺口（2026-09-23 02:24 已补齐）

原缺口：`memory:create` 输入没有承载 §5.3 要求的 `fromMemoryRevisionId`，而回执 `MemoryWriteReceipt` 有该可选字段，「作为我的工作口径重新保存」提交时带不上审计链。

补齐方式（不新增迁移、不新增错误码）：`createMemoryRequestSchema` 与 `memoryOperationRecordSchema` 各加一个可选字段；`MemoryService.create` 先用 `checkRestatementLink` 校验「只有人工口径可以声明来源修订」与「该修订必须真实存在」，再经 `commitReceipt` 写进 `memory_operations.result_json`，由 `buildReceipt` 回显，因此幂等重放返回同一条线索。`MemoryEditor` 的重新表述路径提交 `restateFrom.revisionId`，仍不携带 `sourceSelector`。契约 §5.3 与 §9.2 同步改口径。

证据：`packages/agent-protocol/src/index.test.ts`（字段可用且拒绝空串、操作记录可携带）、`memory-service.test.ts` 两条新用例（回执与重放都带线索、失败路径返回 `NOT_FOUND`/`SOURCE_MISMATCH`）、新增 `components/MemoryEditor.test.tsx` 两条（重新表述提交精确修订、原样复制时不提交）。

### 15.5 人工待验（缺证据即为待验，不得代填）

| 项 | 需要的用户动作 | 当前状态 |
| --- | --- | --- |
| WM-M1 治理界面 | 在真实桌面完成保存/修改/来源/排除各一次并确认所见 | 待光哥验收 |
| WM-M2 自动建议 | 打开空间自动建议开关、审阅一次真实候选质量并同意/拒绝 | 待光哥验收 |
| WM-M3 简报与引用 | 连续两期实际工作：引用参考版本、查看空间简报 | 待光哥验收 |
| WM-M4 端到端 | 用真实模型配置（用户授权）与合成材料跑通两期交付 | 待光哥验收 |
| 提交与发布 | 本轮只做本地提交，未推送、未打包、未发布 | 需单独授权 |

### 15.6 收口复核补齐（2026-09-23 02:53）

15.4 之后又按 Spec 原文逐条复核，另有两项只有实现、没有自动化证据，本轮补齐：

- **Spec §16 规模压测**：`memory-retrieval.test.ts` 新增 `memory-recall-v1 scale` 用例，用 1,000 条有效记忆（工作空间与专家工作空间两种范围、40 个议题、中英混合文案）跑确定性排序，断言条数、最高分范围、两次排序结果完全一致，并设 200ms 主线程上界防回归。本机（darwin/arm64，Node 24）实测约 10ms，未超出可接受的主线程开销，因此按 Spec 要求不返回设计评审，也不引入向量库或长期后台扫描。
- **§13.1「依赖递归/循环」**：新增 `memory-recall-service.test.ts`（此前 `memory-recall-service.ts` 没有任何测试文件）。两条用例都走 `MemoryService` 真实写入路径产出 verified＋来源可定位的已确认记忆，再用生产构建器 `buildDerivedProvenance` 把依赖挂到已有修订上：一条证明链路末端被删除后，中间与末端都落 `dependency-unavailable`——只看一层依赖会把已经站不住的末端口径放回来；一条把两条**当前**修订改成互相引用，证明递归在环处终止且环内记录都不注入。正常写入路径产不出环（新修订只能引用已存在的修订），所以环状态由测试自己打开同目录 SQLite 文件改写 `provenance_json` 得到，没有在生产代码里开测试后门。

证据：`npm test -- apps/desktop/src/main/services/memory-retrieval.test.ts apps/desktop/src/main/services/memory-recall-service.test.ts` → 21 passed；`npx eslint` 对两份测试文件无告警；`npm run typecheck` 退出码 0。

### 15.7 写时拒环补齐（2026-09-23 03:04）

契约 §5.3 要求「在创建时展开来源依赖、拒绝循环」，错误码 `SOURCE_DEPENDENCY_CYCLE` 此前只存在于协议枚举、生产代码从不产出：`MemoryExtractionService` 只校验依赖修订存在且哈希一致，没有把来源依赖展开成图。补上两处展开——入队前 `enqueueAutomatic` 返回 `notEnqueued('SOURCE_DEPENDENCY_CYCLE')`，执行前依赖复证同样展开成环则 `finish(job, 'skipped', 'INPUT_LIMIT')`（作业阶段只允许 `memoryJobErrorCodes`，依赖证不出来一律收口成 `INPUT_LIMIT`，不为此扩协议枚举）。展开逻辑是模块内纯函数 `hasMemoryDependencyCycle`，下一跳由 `revisionDependencies` 读取已确认修订的 verified 来源，legacy 来源没有可展开的依赖。

环状态同样不能用生产 API 造：新修订只能引用已存在的修订，所以测试改写 `memory_records.provenance_json` 造出两条互相引用的当前修订；作业阶段的用例必须走 `seedQueuedJob` 直连登记，因为入队路径自身的非阻塞排空会在同一次 claim 内跑完依赖复证，服务层入队来不及在中间改库。契约 §5.3 同步写明两处落点。

证据：`memory-extraction-service.test.ts` 27 passed（新增 2 条，含「不调用模型」「不建候选」两条负断言）；`npm run verify` 退出码 0（110 个测试文件全绿）。

### 15.8 §13.1 测试矩阵逐条复核（2026-09-23 03:08）

16 项按当前工作树逐条取证（每项至少回读到具体 `it(...)` 与断言，不看用例名推断）：协议非法字段/ID 归属、CAS 与幂等、状态终态、migration 回滚/外键、有效期边界/clear、来源移除但修订残留、依赖递归/循环、中文与非 BMP 预算、实际请求与重放、opt-in 0 调用、无模型/截断/EOF/工具调用、取消/重启/迟到、投影 DB 成功、UI 过期响应、参考精确版本/新任务不带旧授权——共 15 项此前已有自动化证据。

唯一缺口是第 9 项「conflict 组」：治理侧（裁决行、回执、精确修订绑定、keep-both 必须写适用条件、界面表单、预算组原子性）都有测试，但**召回期的冲突装配**没有——`buildConflictMap` → `conflict-unresolved` 账本与 keep-both 同组注入这条路径此前只在 `memory-retrieval.test.ts` 里以手工构造的分组喂给预算层。补齐 `memory-recall-service.test.ts` 两条：同议题、有效期重叠、无裁决的两条口径都不注入且 `conflictReviewRequired` 为真；经 `resolveConflict('keep-both')` 后两条以 `conflict-pair` 一起回来、记忆块带适用条件说明、`conflictReviewRequired` 归零。该测试文件同时承载 15.6 的依赖闭包两条，共 4 条用例。

矩阵 16 项至此全部有自动化证据；仍缺的只有 §15.5 的人工验收与真实模型语义确认。

### 15.9 分页默认值收口到协议常量（2026-09-23 03:18）

Spec §9 与契约 §9 都写着 ListPage「`limit` 默认 50，上限 100」，协议也导出了 `LIST_PAGE_DEFAULT_LIMIT = 50`，但这个常量在生产代码里没有任何消费者：请求 Schema 只用 `LIST_PAGE_MAX_LIMIT` 卡上限，真正的默认值是 `MemoryRepository.listPage` 里写死的 `?? 50`。行为当时是对的，问题在于常量与实现各说一套——改常量不会改行为，看代码的人也读不出谁是真相源。同一文件族的作业列表（`memory-extraction-repository.ts:542`）本来就是从 `MEMORY_JOB_LIST_DEFAULT_LIMIT` 取的，说明约定如此，只有这一处漏了。

修法是一行替换加一条回归用例：`parsed.limit ?? LIST_PAGE_DEFAULT_LIMIT`，用例种 `LIST_PAGE_DEFAULT_LIMIT + 1` 条记忆，断言第一页正好返回常量条数、给出游标、第二页返回剩下的 1 条且不再给游标，并断言两页并集不重不漏。此后常量与存储层只能一起动。契约 §9 补了一句写明「默认值与上限只认协议常量」。

证据：`npm test -- apps/desktop/src/main/persistence/memory-repository.test.ts` → 16 passed；`npx eslint`（含 `--fix` 后的 import 排序）退出码 0；`npm run typecheck` 退出码 0。

### 15.10 风险与下一卡前置（2026-09-23 03:18）

补齐 §14 交接模板里此前没有独立条目的两项（其余七项散落在 15.1–15.9）。

**风险**

1. **人工验收缺口＝收口缺口**：§15.5 五项（治理界面、自动建议质量、简报与精确版本引用、真实模型端到端、提交发布授权）一条都没有用户证据。按 Spec §14.4 的口径，不得把「测试通过」写成「业务质量通过」，也不得把「记忆已选中」写成「已影响成果」。
2. **ADR-0026 仍是 Proposed**：本增量业务代码已落地，但技术方案批准权在光哥手上；任务板与文档不得自行改为 Accepted。
3. **召回在 Main 进程同步执行**：1,000 条实测约 10ms，`memory-retrieval.test.ts` 里 200ms 是防回归上界而不是容量承诺。规模到万级或上界被踩到时，按 Spec §16 回设计评审，不得就地加缓存或悄悄引入向量库绕过。
4. **真实模型语义未验证**：替身测试只覆盖请求结构、上限、`finishReason`、用量与取消；候选质量、费用与实际失败模式要在 §15.5 第 2、4 项里由光哥用真实模型配置确认。
5. **只本地提交、未推送**：本工作树与其他 Qoder 会话共享，后续每次提交前必须重跑 `git status` 并逐份核对 diff，追加共享日志前先重读文件末尾。

**下一卡前置**

- WM16 收口的前置就是 §15.5 表格逐项拿到用户证据＋真实模型授权下的语义确认；拿到后 ADR-0026 转 Accepted、WM16 标 done、当日日志收口。
- 本增量不依赖 CF 未完成的远程 MCP/API 能力，也不得改写 E/CF 任务状态；期间发现的缺陷按 GATE-0（先查 SQLite 现场 → `/tmp/betterwork-dev.log` → 代码）另立缺陷卡，不在 WM16 内顺手扩范围。
- 若验收通过后再谈推送、打包与发布，那是单独一次授权。

### 15.11 全量审计五处缺口逐条收口（2026-09-23 03:42）

15.9／15.10 之后又做了一次「契约句子 ↔ 生产代码 ↔ 自动化用例」三方对齐审计，报出五处只有实现或只有文档、缺证据的缺口，本轮全部补齐。写法上统一：先补断言真实行为的用例，再把落点写进契约，不反过来为已通过的行为编用例。

1. **派发闸门核对记忆块修订（契约 §6.4）**。原文要求「计算规范化 `requestHash`，核对记忆块修订」，此前只做了前半句：`withRunMemoryAudit` 落两阶段审计，但没有任何地方校验真正发出去的那份 `ModelRequest` 里带的记忆块，和装配阶段落进 `run_memory_contexts.selected_items_json` 的那份是同一个。中间隔着工具循环，记忆块一旦被替换或漏注入，审计里记下的选择就解释不了实际请求。补 `assertMemoryBlockMatches`：请求中所有带 `MEMORY_BLOCK_HEADER` 的系统消息必须与 `RunMemoryPreparation.memoryBlock` 逐字相同；`memoryBlock` 为空串表示本次不注入，此时出现任何记忆块也算不符。抛 `MemoryBlockMismatchError`，位置在两次审计写入**之前**，所以不符时既不发审计也不发包。`MEMORY_BLOCK_HEADER` 从模块私有常量改为导出，避免第二份表头字面量。
2. **窗口重获焦点查询状态（契约 §7.3）**。原文两件事并列：「UI 主动刷新和窗口重获焦点查询状态」＋「仅面板可见且有活动作业时按 1 秒轮询」。此前只实现了轮询，而轮询恰恰只在有活动作业时才开——别处（后台作业或另一个窗口）改变候选状态后，回到窗口的用户读到的是过期快照。补 `focus` 监听补发一次全量查询（设置＋作业＋候选），面板不可见或卸载时摘除监听。
3. **投影清理只碰 manifest（契约 §5.6）**。实现是对的（`rebuildProjection` 按 manifest 逐项删除），缺的是负向证据。补一条用例：预埋同空间子目录里的用户笔记与工作空间根目录的草稿，删除一条已投影记忆后重建，断言受管文件消失、manifest 清空、两个用户文件内容原样。这类「不遍历删除用户资料」的约束只有正断言等于没测。
4. **`IPC_FAILURE` 命名与语义（契约 §9.3）**。渲染侧 transport 兜底码此前叫 `TRANSPORT_FAILURE`，与契约写明的 `IPC_FAILURE` 不一致；而 `memoryErrorCodeSchema` 明确不含该码，所以它只能是界面侧常量、不能塞进协议枚举。改为导出 `IPC_FAILURE_CODE` 并让 `MemoryFailureCode` 从它派生 union，新增 `memory-result.test.ts` 覆盖三条路径：拒绝映射成 `IPC_FAILURE` 且标可重试（含拒绝对象无消息时的回落文案）、领域失败原样透出错误码与 `currentRevision` 不降级、成功时保留 `warnings`。
5. **来源专家不可用改用通用助手并提示（设计稿 §3.6）**。此前 `startFromArtifactVersion` 在专家已归档时静默回落到通用助手，等于「猜」了一次没有说出来的降级。现在把原因当场说出来（`TransientToast`，含来源专家名），并在 `App.test.tsx` 补两条：来源专家可用时草稿交给该专家当前修订且不自动发送、无提示；已归档时提示文案精确、不出现「当前专家」列表、不自动发送。

本轮还纠正了一处测试基础设施缺陷：`use-memory-suggestions.test.ts` 的 `afterEach` 没有 `cleanup()`。`vitest.config.ts` 用 `environment: 'node'` 且未开 `globals`，RTL 的自动清理不会生效，前一例泄漏的挂载会继续监听 `window` 事件并命中当前例的共享替身，新加的 `focus` 监听把这种污染放大成了可见失败（期望 2 次调用实得 6 次）。补 `cleanup()` 是在修测试，不是绕开产品问题。

证据：`memory-dispatch-gate.test.ts` 6 passed（含正例与两种不符）；`memory-result.test.ts` 4 passed；`use-memory-suggestions.test.ts` 9 passed；`memory-service.test.ts` 14 passed；`App.test.tsx` 21 passed；`work-centered-memory.integration.test.ts` ＋ `run-service.test.ts` 61 passed，说明真实请求路径满足新加的逐字核对；`npm run verify` 退出码 0（Test Files 111 passed）。

### 15.12 一处未收口的口径偏离（2026-09-23 03:42）

设计稿 §3.6 要求「新任务默认沿用**来源 Run 快照**中的专家身份」。当前实现读的是来源成果所属 Task 的 `TaskContext.executor`，不是那个版本实际所属 Run 的 `RunContextSnapshot`。两者在专家未换时等价，但语义不同：快照记的是「当时实际用了谁」，草稿记的是「现在打算用谁」。

没有按原文改的原因：v21 确实在 `run_context_snapshots` 里持久化了 `expert_id`／`expert_revision_id`，但没有任何 preload／IPC 通道把运行快照的专家身份暴露给渲染进程；`成果版本 → 所属 Run → 快照专家`这条查询要新增通道、协议 Schema 和 `Result` 契约，而跨模块核心信息变化按 AGENTS.md §8 需要先补 ADR——那是 E 系列（专家上下文与材料绑定）的范围，不在 WM16 里顺手扩。

因此本条按「已知偏离」记录，不标完成，也不改设计稿口径。要么由光哥判定当前「按 Task 草稿取专家」可接受（则改设计稿一句话即可），要么另立一卡走 IPC＋协议＋ADR。

### 15.13 召回与提炼阈值收口到协议常量，并加护栏（2026-09-23 03:51）

15.9 修的是 `LIST_PAGE_DEFAULT_LIMIT` 一处，本轮把同一类问题一次扫清：扫描协议里导出的 57 个 `UPPER_SNAKE` 常量，凡「在 `index.ts` 内只出现在自己的导出行、且 `apps/`＋`agent-core/` 生产源码里无人引用」都算孤儿。结果是 9 个：`MEMORY_RECALL_SINGLE_TOKEN_MIN_MATCHED`、`MEMORY_RECALL_STRONG_TOKEN_WEIGHT`、`MEMORY_RECALL_SINGLE_HAN_WEIGHT`、`MEMORY_RECALL_HAN_STOP_BIGRAMS`、`MEMORY_RECALL_LATIN_STOP_WORDS`，以及 `MEMORY_EXTRACTION_INPUT/TEXT/INSTRUCTION/SUMMARY_CODE_POINT_LIMIT`。它们的值在生产代码里各有一份字面量——`memory-retrieval.ts` 自己写了 `RECALL_BUDGET`、`PHRASE_WEIGHT = 3`、`SINGLE_HAN_WEIGHT = 1` 和两份停用词表，`memory-extraction-prompt.ts` 自己写了 `EXTRACTION_LIMITS` 的 1,500／6,000／2,000／1,000。逐值比对全部相等，所以这是一次纯接线，不改任何行为。

- 召回侧：`RECALL_BUDGET` 的 12 个字段、两个权重、打分基数（`MEMORY_RECALL_SCORE_SCALE`）与「至少命中 2 个 token／单 token 查询允许命中 1 个」都改为取协议常量；`MEMORY_RECALL_VERSION` 和两份停用词表不再本地导出，测试改从协议引用，于是「算法版本」只有一处定义。
- 提炼侧：`EXTRACTION_LIMITS` 逐项引用协议常量，并删掉两个无人消费且与协议重复的字段（`outputTokensMax`、`timeoutMs`——服务层本来就直接用 `MEMORY_EXTRACTION_MAX_OUTPUT_TOKENS`／`MEMORY_EXTRACTION_TIMEOUT_MS`）。三个片段类上限（用户 prompt／前一轮回答／人工 feedback）都归到协议的 `MEMORY_EXTRACTION_FRAGMENT_CODE_POINT_LIMIT`，与契约 §7.2「各自 ≤2,000」一致。
- 命中阈值的写法顺带纠正了一处语义混用：原 `matchedTokens < 2 && query.length !== 1` 把「单 token 查询」和「放宽后的下限」挤在一个条件里，现在按常量分别表达，行为逐值等价。

护栏进 `standards/coding-standard.test.ts`：新增「协议导出的阈值常量都有真实消费者」，规则是常量要么在协议内被 Schema 或别的常量引用，要么被 `apps/`／`packages/` 的生产源码引用，否则判为孤儿。这条护栏恰好是本轮缺陷的可执行形式——此前 9 个孤儿全都会让它失败。它不覆盖 15.9 那一类（常量在协议内已被 Schema 消费、存储层却又写死一份），那一类仍需按契约逐处核对，不夸大护栏能力。

证据：`npm test -- standards/coding-standard.test.ts` → 22 passed；负向验证——临时在协议里加 `export const GUARD_PROBE_ORPHAN = 7;` 后该卡失败并报出该名字，随后撤销，`git diff` 对协议文件为空。`npm test -- memory-retrieval.test.ts memory-extraction-prompt.test.ts memory-recall-service.test.ts memory-extraction-service.test.ts` → 4 files／65 passed；`npx prettier --write`＋`npx eslint` 退出码 0；`npm run typecheck` 退出码 0；`npm run verify` 退出码 0（Test Files 111 passed）。

### 15.14 Spec §15 文档验证取证（2026-09-23 03:57）

§15「文档验证」要求内部链接与标题锚点逐一确认，此前只在 WM00 归档时人工看过。本轮用一次性脚本（不入库）扫描 WM 文档集与其 12 个接入入口，共 18 份文档、429 条内部链接：文件目标全部存在，锚点按 GitHub slug 规则（去句点与中文标点、空白转连字符、拉丁字母小写）逐个比对目标文件的实际标题，**0 条断链**。首轮报出的 4 条全是脚本自身的 slug 缺陷（没有剥掉「`## 12. 标题`」里的句点），修脚本后归零——不是文档有问题，也不许把脚本误报当成待修项写进文档。

同节还要求「检查类型/key/枚举/预算在契约与任务提示词一致」：`memory-coding-prompts.md` 全文不出现任何预算数字或字段定义（grep `6,000`／`8,000`／`2,000`／`1,500`／`12,000`／`1,000`／`500`／`≤`／`最多` 均无命中），与 §15 表格里「提示词不重复定义字段」的职责划分一致，因此这一项是由「没有第二份定义」保证的，而不是两份定义被对上了。工作树此刻无未跟踪文件，`git diff --check` 退出码 0。

### 15.15 冲突判定收口、待澄清可见性与界面样式（2026-09-23 04:44）

15.11 那类「契约句子 ↔ 生产代码 ↔ 自动化用例」三方对齐再做一遍，报出四处缺口，本轮全部收口。写法仍是先补断言真实行为的用例，再把落点写进契约。

1. **`unresolved` 冲突状态此前没有任何生产者**。协议 `memoryConflictStateSchema` 允许它，召回也按它整组排除并置 `conflictReviewRequired`，但没有任何代码把未裁决对放进 `memory:list` 的返回：治理列表两侧都不显示冲突，产品设计 §3.4 的裁决界面（并列呈现＋替代/并存/暂不处理）在真实数据下永不出现，`conflictReviewRequired` 成了没有出口的死提示。现在 `MemoryService` 按当前全部在效记录（`candidate`/`confirmed`/`expired`，不分页）派生未裁决对，一对两条口径各自都带同一条 `state: 'unresolved'`；裁决后原样变成 `keep-both`/`replaced`。
2. **§5.5 判定规则有三份实现**：召回内联一份（按 `topicKey` 分桶）、简报内联一份（把「作用域交集」写窄成「同一规范范围」）、治理可见性需要第三份。抽出 `memory-conflict-policy.ts` 后三处共用同一份谓词，简报的作用域口径同时纠正。
3. **候选与已确认记忆的重复没有可展示的指针**。§5.6 的写时抑制只覆盖自动候选之间，`MemorySuggestionList` 的冲突提示此前无源。新增查询派生字段 `MemoryViewItem.duplicatesConfirmedMemoryId`，候选行内提示「确认后会出现两条同口径记录，通常直接拒绝候选即可」。
4. **记忆、简报、经验建议三块界面没有样式**。`styles.css` 里这三块用到的 108 个类有 66 个从未定义（`.memory-conflict*`、`.memory-group*`、`.memory-editor*`、`.brief-*`、`.suggestion-*`、`.context-row` 等）——WM07/WM11/WM14 交的是「结构正确但裸排版」的界面。本轮按语义 Token 补齐（提示带用 `--info`/`--warning`，冲突并列两条同宽，行内提示不再靠浏览器默认样式），零硬编码色值、未新增第三种 toast；顺带修掉 `suggestion-settings` 既当变体钩子又当面板类的同名冲突（面板改名 `suggestion-consent`）。

需要光哥判定的两处（本轮按「已实现并记录」处理，不自称已批准）：

- §10「重复/冲突待处理计数作为管理提示」的实现落点选了治理页而不是 `WorkspaceBrief`，理由是简报字段清单封闭且计数不是「现有事实的投影」。若判定计数必须进简报，要同时改契约 §10 的字段清单。
- 因此 `MemoryViewItem` 多了一个契约 §9.1 原本没列的可选字段。已把 §9.1 该行改写为含 `duplicatesConfirmedMemoryId?`——这是契约的最小扩写，不是新增通道，也不落库。

证据：`npm run verify` 退出码 0（lint＋format:check＋typecheck＋test＋build，Test Files 112 passed／Tests 1004 passed）。分项目标：`memory-conflict-policy.test.ts` 8 passed；`memory-service.test.ts` 16 passed；`memory-recall-service.test.ts` 4 passed；`workspace-brief-service.test.ts` 10 passed；`MemoryView.test.tsx` 11 passed；`MemorySuggestionList`／`ContextPanel`／`WorkspaceBrief`／`coding-standard` 四份 58 passed。`npm run typecheck` 曾捕获治理用例里 `conflicts` 可能为 `undefined` 的收窄缺陷——`vitest` 不做类型检查，测试全绿不代表类型正确，这条已经吃过一次亏。提交分三笔：`19ab026`（策略模块收口）、`fb12ab7`（待澄清与重复可见性）、`f738a08`（界面样式）。WM16 仍 doing：§15.5 五项人工验收与真实模型语义确认未变，界面样式的实际观感也要靠光哥在应用里确认（本轮只看类名与 Token 覆盖，没有跑真机视觉核对）。
