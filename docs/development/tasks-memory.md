# 工作型记忆开发计划（WM00–WM16）

> 2026-09-25 记忆增量：[记忆改进 Spec](../designs/memory-improvements.md)、[MI00–MI10 独立任务板](tasks-memory-improvements.md)与[编码提示词](memory-improvement-coding-prompts.md)。D1–D5 推荐方案已获光哥批准，MI 全部仍未开工；不改下方 WM 状态或自动关闭 WM16，复用验收证据时须逐项注明。

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

- 文件：run-history-policy、RunService、TaskContext 最新版本校验、memory:run-context/preview 接线、必要 preload。契约 §11 拟新增的 `run-memory-audit.ts` **未单独建文件**，审计事实由 `run-memory-context-repository.ts`、`run-history-policy.ts`、`memory-dispatch-gate.ts`、`memory-recall-service.ts` 承载（见 §15.3 的「契约 §11 偏离」一条）。
- 将新旧入口统一到明确材料范围；最后最终回答、时间边界、传递依赖、连续安全后缀；Provider 包装器记录真实 request-prepared/dispatch-attempted。
- Given 旧记忆撤销或材料替换，Then 实际 Provider 输入无相关旧历史；Given 只是预算落选或材料增加，Then 保留仍安全历史；Given 并发未来轮次，Then 不纳入；Given 审计失败，Then 不调用 Provider。
- 定向：run-history-policy.test.ts、run-memory-context-repository.test.ts、memory-dispatch-gate.test.ts、run-service.test.ts、register-ipc.test.ts；必须断言请求 messages，不只断言 segmentId。

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

复用 operations/jobs/run contexts 记录，不新增第三方埋点服务。事件语义：`candidate_created`、`candidate_confirmed`、`candidate_rejected`、`memory_replaced`、`memory_selected`、`memory_dispatch_attempted`、`memory_excluded`、`extraction_finished`、`reference_selected`。属性只含范围 ID、任务/运行 ID、状态/原因、数量/耗时/真实 usage，不含正文/secret。UI 可以从这些记录生成诊断计数，不宣称「被选中＝改善成果」。九个事件语义的逐条生产者与属性落点见 §15.16。

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

### 15.16 §13.3 九类观察事件逐条取证（2026-09-23 04:50）

§13.3 要求「复用 operations/jobs/run contexts 记录，不新增第三方埋点服务」，但任务板此前只照抄了九个事件名，没有逐条指明谁生产、属性落在哪个字段。本轮按当前代码逐个核对：

| 事件语义 | 生产记录与字段（实测） | 定向测试 |
| --- | --- | --- |
| `candidate_created` | `memory_extraction_jobs.result_json` 的 `candidateRevisionIds` 与 `deduplicatedCount`；候选本体是 `memory_records` 里 `status='candidate'` 的修订 | `memory-extraction-service.test.ts`、`memory-extraction-repository.test.ts` |
| `candidate_confirmed` | `memory_operations` 的 `operation_kind='set-status'` ＋ `result_json.governanceAction='confirm'` | 本轮新增用例 |
| `candidate_rejected` | 同上，`governanceAction='reject'`；`restore-candidate` 复用同一字段 | 本轮新增用例 |
| `memory_replaced` | `memory_conflict_decisions.decision='replace'` ＋ `winner_revision_id`，配合被替代修订的 `replaces_revision_id` | `memory-operation-repository.test.ts`、`memory-repository.test.ts`、`migrate.test.ts` |
| `memory_selected` | `run_memory_contexts.selected_items_json`（身份/顺序/分数/理由）＋ `run_memory_reads.selected_for_injection` | `run-memory-context-repository.test.ts`、`memory-repository.test.ts` |
| `memory_dispatch_attempted` | `run_memory_contexts.phase='dispatch-attempted'` ＋ `dispatch_attempted_at`，表级 CHECK 保证阶段与时间戳一致 | `run-memory-context-repository.test.ts`、`migrate.test.ts` |
| `memory_excluded` | `task_context_revisions.excluded_memory_ids_json` ＋ 召回快照 `decision_summary_json.exclusions` 的原因枚举（含 `memory-excluded`） | `run-history-policy.test.ts`、`memory-recall-service.test.ts`、`register-ipc.test.ts` |
| `extraction_finished` | `memory_extraction_jobs.status`、`started_at/finished_at`、`input_code_points/output_code_points`、`usage_json`（真实 token 数）、`error_code` | `memory-extraction-service.test.ts` |
| `reference_selected` | `workspace_artifact_references.selected_at` ＋ `memory_operations` 的 `set-reference`/`remove-reference` 回执 | `workspace-reference-repository.test.ts`、`workspace-reference-service.test.ts` |

「属性只含范围 ID、任务/运行 ID、状态/原因、数量/耗时/真实 usage，不含正文」也核过：审计行只存修订身份，仓储用例直接断言回执序列化后不含记忆正文。全仓没有任何第三方埋点或遥测依赖，UI 诊断计数一律从上述表读出。

缺口一处，本轮已补：`governanceAction` 在服务层写入、仓储层解析，但**没有任何用例断言它能穿过 `result_json` 往返**——即 §13.3 里「候选确认」与「候选拒绝」两个事件的唯一区分点从未被验证，性质同 15.11 的「有枚举值、无生产者」。补了一条真实 SQLite 往返用例（该文件 9 passed），确认两条回执分别是 `confirm` 与 `reject`，且都不含正文。同一轮 `npm run verify` 退出码 0（Test Files 112 passed／Tests 1005 passed）。

### 15.17 枚举值生产者全量扫描与两处收口（2026-09-23 05:03）

15.11 与 15.15 各抓到一次「枚举值没有生产者」，本轮改成系统性扫描：把协议里所有 memory/brief/reference/job 相关的 `z.enum` 取出来，逐值在 `main`／`renderer`／`preload`／`agent-core` 的非测试源码里找字面量写入点。23 个枚举里只剩两处无生产者：

- `memoryOperationKindSchema` 的 `set-settings` —— 真缺陷，见下。
- `jobFailurePhaseSchema` 的 `publish` —— 属于 Skill 作业运行时（ADR-0009），不在 WM 范围，也不在本期改动，记录下来不顺手改。

**`memory:set-settings` 漏掉了 §5.6 的幂等回执**。契约写的是「所有用户写命令带 `operationId`；相同 `operationId` ＋ 相同请求哈希返回原提交效果」，`MemoryExtractionRepository.applySettings` 的注释也明说「回执由调用方在同一事务内用 `MemoryOperationRepository.append` 补写」，但服务层只是把 `operationId` 回显出去，既没 `claim` 也没 `append`。后果有三层：用户「点了开关但响应超时」后原样重发，会撞自己刚推进的 `expectedRevision` 被读成 `REVISION_CONFLICT`；重发还会再跑一次关闭开关的取消逻辑；同意/撤销动作在 `memory_operations` 里没有任何审计行。现在服务在同一事务内 `claim`→写设置→`append`，重放返回原提交效果与当前设置行、`cancelledJobCount` 为 0（取消只发生在首次提交），同 ID 换内容返回 `IDEMPOTENCY_CONFLICT`。

**本地日志是 §7.2 之外的第二条凭据路径**。契约只保证失败「不落库」，而提炼服务的文件注释把「原始诊断只进本地日志」当成安全前提；但厂商异常文本常见形态是把 `Authorization: Bearer ...` 或带密钥的端点原样回显，六条 `console.error(describeError(error))` 因此会把密钥写进 `dev.log`，违反 AGENTS.md「日志不得记录密钥」。现在统一走 `diagnosticOf`：写日志前用同一份 `findSensitiveMemoryContent`（含本次已知凭据）检查，命中只留原因码，未命中也截断到 300 码点，顺带满足「避免无必要记录完整文档内容」。用例改造为抛出带 Bearer 凭据的异常，断言数据库与日志两侧都不出现该凭据。

证据：`npm run verify` 退出码 0（lint＋format:check＋typecheck＋test＋build，Test Files 112 passed／Tests 1006 passed）；`memory-extraction-service.test.ts` 28 passed、`memory-extraction-repository.test.ts` 9、`register-ipc.test.ts` 26、`work-centered-memory.integration.test.ts` 10 全绿。契约 §5.6 与 §7.2 各补落点。代码提交 `f3eb029`。`mapError` 仍把部分异常文本作为 `MemoryError.message` 返回给界面展示，这是全仓既有口径而不是 WM 新增，本轮不单独改动提炼服务一处来打破一致性——若要收口应连同其它服务一起处理，留作待判定项。

### 15.18 错误码清单与真实生产者对齐（2026-09-23 05:07）

把 §15.17 的扫描从状态枚举扩到错误码：协议里 41 个记忆错误码逐值找非测试源码里的写入点，39 个有生产者，两个没有——`MATERIAL_NOT_ALLOWED` 与 `MATERIAL_HASH_MISMATCH`。它们的语义其实已经实现，只是用了别的词汇：召回阶段的材料依赖不满足是排除原因 `dependency-unavailable`，写入阶段的摘录与来源正文不一致是 `SOURCE_MISMATCH`。因此这不是缺功能，而是设计词汇比实现多出一档。本轮只在契约 §错误码清单下记录落点，不为了凑码新增失败路径，也不删清单条目，留给光哥判定「拆码」还是「收敛词汇」。

### 15.19 数字口径全量扫描与三处双源收口（2026-09-23 05:14）

§15.17 扫的是枚举值，§15.18 扫的是错误码，本轮把同一套动作换成契约里的数字：协议导出的 51 个数值型记忆／简报／分页常量逐个统计「非测试生产源码引用数」，再反向检查契约正文书写的每个上限（问答对 8、12,000 码点、16 条／6,000 码点、偏好池 2 条／600 码点、每区 10 条、参考区 5 个、排除身份 50、queued 20、并发 1、30 秒、输出 2,048 token、候选 3、证据 1–3、片段 2、同意版本）。结论分三层：

1. **契约数字全部有强制点**，没有一个只活在文档里。简报的两个上限直接 `slice(0, WORKSPACE_BRIEF_*_ITEM_LIMIT)`，召回预算整体收在 `RECALL_BUDGET`，提炼装配与严格解析共用 `EXTRACTION_LIMITS`，`memory:run-context` 的落库校验用 `MEMORY_RECALL_TOTAL_ITEM_LIMIT`／`MEMORY_REPLAY_PAIR_LIMIT` 组数组 Schema。
2. **§15.10 之后不再有孤儿常量**：那 9 个当时的孤儿已接进 `memory-retrieval.ts`／`memory-extraction-prompt.ts`；本轮剩下的都是「协议里被 Schema 用掉、服务层再抄一份字面量」的双源，而不是无人引用。
3. **真正的缺陷是三处双份数字**，值当前相等，所以行为不变，但改一处不会改另一处：
   - `run-history-policy.ts` 的 `HISTORY_LIMITS` 自写 `maxPairs: 8`／`maxCodePoints: 12_000`，而协议早已导出 `MEMORY_REPLAY_PAIR_LIMIT`／`MEMORY_REPLAY_CODE_POINT_BUDGET`。
   - `memory-recall-service.ts` 另立 `export const MEMORY_DECISION_IDENTITY_DISPLAY_LIMIT = 50`，与协议 `MEMORY_DECISION_SUMMARY_IDENTITY_LIMIT = 50` 各说一套；契约 §8.2 的「最多 50 个身份」因此有两个真相源。
   - 同意版本跨进程写了两遍：主进程 `MEMORY_SUGGESTION_CONSENT_VERSION = 1`（门槛）与界面 `MEMORY_CONSENT_VERSION = 1`（文案与请求）。界面侧注释甚至写明「协议未导出该常量」。**这是三处里唯一会真正咬人的**：门槛只接受等于自身常量的版本，一旦升到 v2 而界面副本没动，开关会永久返回 `CONSENT_REQUIRED`，且用户看到的仍是「同意版本 v1」——静默不可用，无报错可循。

修法统一为「把真相源搬进协议，两侧导入」：协议新增 `MEMORY_SUGGESTION_CONSENT_VERSION = 1`；`memory-extraction-service.ts` 删除本地定义改为导入（两个测试的导入也跟着改到协议）；`renderer/src/lib/memory-suggestions.ts` 保留 `MEMORY_CONSENT_VERSION` 这个名字但让它等于协议常量（与同文件里 `MEMORY_CANDIDATE_PER_JOB_LIMIT = MEMORY_EXTRACTION_MAX_CANDIDATES` 是同一个写法）；`HISTORY_LIMITS` 与排除身份切片直接引用协议常量。契约 §6.3、§7.3、§8.2 各补一句落点。

值得记下的对照：§15.9 修 `LIST_PAGE_DEFAULT_LIMIT` 时说的是「默认值没人读」，本轮三处是「两个值各读一份」——同一句「数字只有一个真相源」的两半，只有把它们都扫一遍才算收口。测试断言继续用字面量（如 `maxItems === 16`、5,000×2 撑破 12,000），这样契约数字变了会红在测试上而不是悄悄跟着常量走。

验证：`npm run typecheck` 通过；`npm run verify` 退出码 0（lint + format:check + typecheck + test：Test Files 112 passed / Tests 1006 passed + build）。定向用例：`run-history-policy.test.ts` 17、`memory-recall-service.test.ts` 4、`memory-extraction-service.test.ts` 28、`work-centered-memory.integration.test.ts` 10、`use-memory-suggestions.test.ts` 9、`memory-suggestions.test.ts` 12。本轮无表结构变化，因此无迁移。

### 15.20 IPC 双面一致性核对与 docs/04 过期能力描述修正（2026-09-23 05:25）

枚举、错误码、数字三条轴收完后，剩下两条还没被逐条取证：接口面（契约 §9 的 18 个通道）与文档口径（其他文档对 WM 能力的描述）。

**接口面。** 脚本对 18 个记忆通道逐条比对 `register-ipc.ts` 与 `preload/index.ts` 中该通道所用的请求 Schema 与 `resultSchema(...)` 内层标识符，18/18 两端完全一致（例如 `memory:set-status` 两端都是 `setMemoryStatusRequestSchema` ＋ `memoryWriteReceiptSchema`）；主进程注册表由 `register-ipc.test.ts` 的 `ipcMain.handle` 桩在运行时收集，已有断言覆盖「协议通道全部注册、无未知通道、无重复注册」。结构面另核两项：记忆区 60 个顶层对象 Schema 全部 `.strict()`（区内 90 处 `.object(` 对 93 处 `.strict()`，无遗漏），18 个通道里 17 个有界面消费者，只有 `memory:get` 没有——界面当前用 `memory:list` 返回的完整 `MemoryViewItem` 渲染详情，按精确修订读取的口子是契约 §9 定义的治理与调试入口，本轮不删也不为它造界面，留给光哥判定「保留为 API」还是「并进 list 的修订参数」。

**文档口径。** `docs/04-knowledge-and-memory.md` §6 的「已知边界」段仍然描述 WM 之前的实现：「现有取候选顺序是范围/时间排序后先截 16 条再套预算，不含任务内容相关性匹配，也不在排除后补位；按任务相关性召回、结构化来源与依赖判定、请求阶段审计均为 WM 拟新增能力」——这三项能力 WM04/WM05/WM06 都已交付并有测试，文档却把它们写成待办、把旧行为写成现状。同节另两处时态同理（§6.1 派生索引、§7 提炼触发）。已按实现改写：过滤九类排除 → `memory-recall-v1` 相关性打分 → 16 条／6,000 码点总预算＋2 条／600 码点偏好小池，排除与不胜任记录不占预算，预算落选只作原因码计数；并补上两个自动触发点的代码落点——`run-service.ts:732` 在 `run.completed` 终态后调用 `requestRunExtraction`，`discussion-checkpoint-service.ts:51` 只在人工 `feedback` 非空时入队（`summary` 不能触发）。顺带确认这两个触发不是只在测试里存在：`main/index.ts` 分别把 `memoryExtractions` 传进 `new RunService(...)` 与 `new DiscussionCheckpointService(store, memoryExtractions)`。

方法上的对照：接口面这一轴没查出缺陷，是因为它本来就是双端同写一份 Schema 标识符的机械结构，容易被复制粘贴保持同步；真正会烂掉的是**散文里的能力描述**——它不进任何门禁，只有人和代码对得上时才对。所以本轮之后，文档描述与实现的比对也要当成一条可重复的轴，而不是收尾时顺手读一遍。

验证：本轮纯文档改动，无代码与测试变更；`npx prettier --check docs/04-knowledge-and-memory.md` 通过，`git diff --check` 退出码 0，改动段落整段 `sed -n` 回读校验中文字面。

### 15.21 规范归档与链接面核对（2026-09-23 05:30）

Spec §15 是 WM00 的验收面，此前只按「文档已归档」处理，本轮把它的三条可执行要求逐条取证：五份产物＋入口接入、Markdown 链接与标题锚点、代码路径引用的真实性。

**五份产物与入口。** `docs/designs/work-centered-memory.md`、`docs/adr/0026-work-centered-memory.md`、`docs/development/memory-contracts.md`、`docs/development/tasks-memory.md`、`docs/development/memory-coding-prompts.md` 齐备且互链。Spec 列出的 13 类入口逐个 `grep` 确认都含 WM 引用：AGENTS.md（任务路由＋当前阶段）、docs/README、docs/development/README、docs/adr/README、docs/07、docs/04、docs/02、docs/03、docs/10、expert/material/capability 三份契约、ADR-0015。其中两条最容易写歪的已按 Spec 原意核对：ADR-0015 第 76 行仍写「ADR-0026 记为 **Proposed**（接受状态待用户确认）」，没有提前写成生效替代；docs/02 第 252 行明确「Task 不是长期记忆作用域」。

**链接与锚点。** 97 个 Markdown 文件全量扫描相对链接：WM 相关文档 **0 处断链、0 处失效锚点**。仓内另有两处与 WM 无关的历史问题，按「不改写历史记录/评审快照」原则记录不动：`docs/logs/2026-09-18.md` 指向仓库外的 `book/cn/…`（当时的外部书稿，现已不在库内），`docs/reviews/2026-09-07-code-quality.md` 用绝对路径写代码位置（评审快照的引用风格）。锚点只有 7 处（其中 5 处是文档间标题锚），另用近似 GitHub 的 slug 规则单独复核这 5 处，全部命中，包括 `memory-coding-prompts.md → tasks-memory.md#12-wm-唯一任务板与逐卡完成定义` 这种中英混排带空格的标题。

**代码路径引用真实性。** WM 文档中被反引号引用的文件名共 91 个（含 19 个全路径），逐个回落到仓库实际文件：全部命中，唯一「不存在」的是 `run-memory-audit.ts`，而它在任务板 §「契约 §11 偏离」一行里明确写作**拟新增未建文件**并说明审计事实由 `run-memory-context-repository.ts`／`run-history-policy.ts`／`memory-recall-service.ts` 承担——正是 Spec §15 要求的「计划中的未来代码路径标『拟新增』而非已存在链接」。其余三处未命中项均为误报（投影目录树里的运行时 `index.md`、散文中的 `*.test.ts` 通配、以及 `memory-coding-prompts.md` 本身位于 docs 目录而扫描器只建了代码文件索引）。

这条轴的结论与前几轮不同：**没有查出需要改的缺陷**，但它把 §15 的验收从「写过文档」变成了「链接、锚点、路径引用可机械复核」，也确认了上一轮修 `docs/04` 时担心的散文腐烂没有扩散到其他入口文档。

验证：本轮只新增本节与日志 05:31 一节，无代码、契约正文与测试变更；扫描脚本输出 97 文件／0 断链、7 处锚点全命中、91 引用文件名／0 失效（除已标拟新增者）；`npx prettier --check` 与 `git diff --check` 均通过。

### 15.22 Spec §3 产品行为逐条取证与 §1.4 指标数据源核对（2026-09-23 05:43）

前面几轮扫的都是协议面（枚举值、错误码、数字、接口、链接），本轮换正向轴：把 Spec §3 的每条产品行为对到界面组件与测试，再核 §1.4 四个产品指标有没有数据源。

**行为面逐条有证据，无缺陷：**

- §3.1 默认适用范围：`MemoryView.tsx:96` 的 `scopeOptionsFor` 在有专家且有工作空间时把 `expert-workspace` 排首位、无专家时首位是 `workspace`，`MemoryEditor.tsx:196` 取 `scopes[0]` 作默认，函数注释直接引用 §3.1。正文 2,000／来源摘录 500 都读协议常量并用 `countCodePoints` 计数，不是 UTF-16 长度。
- §3.1＋§3.2 提升与重述门槛：编辑器要求勾选「这是我的通用工作要求，与具体工作空间或资料无关」才能存全局；工作空间事实直接改全局被拒并指向「作为我的工作口径重新保存」；重述还要求正文确实改过——原样复制报「需要重新表述，不能原样复制资料结论」。
- §3.3 每次最多 3 条：`MEMORY_EXTRACTION_MAX_CANDIDATES = 3` 同时用于作业输出 Schema 与 `candidateRevisionIds` 上限。四个阶段文案在 `memory-labels.ts:56-59` 与 Spec 字面一致，`ContextPanel.test.tsx:285` 直接断言界面不含「模型已收到」。
- §3.3 关闭开关：`memory-extraction-service.ts:526` 的 `setSettings` 在同一事务内由 `jobs.applySettings` 返回 `cancelledJobCount`，只碰作业不碰记忆；幂等重放路径显式把取消数归零，避免「点了开关但响应超时」的第二次提交再取消一轮。
- §3.4 状态机：协议转换表只允许从 `candidate` 出发的候选动作，`deleted`／`superseded` 无回边，恢复待确认走 `restore-candidate` 复用同一 `governanceAction` 字段（§15.16 已补往返用例）。
- §3.5 排除只写 `excludedMemoryIds`：该字段在 17 个文件出现，完整保存 TaskContext 时其余字段保留；界面三段（下次运行可用／本次运行记忆／历史上下文调整）在 `ContextPanel.tsx` 与 `use-run-memories.ts`。
- §3.6 不猜专家：`App.tsx:214` 的注释与两条文案（有名字报名字、无名字报通用助手）；「引用到当前任务」在 `App.tsx:381` 注明固定精确版本、不改当前专家、不自动发送，`App.test.tsx` 三条用例分别覆盖不自动发送、不换专家与沿用来源专家。
- §3.7 收口：五个记忆相关 Hook 全部经 `reportAction`／`trackAction`，`views/`、`components/` 内不出现 `window.betterwork`。
- §13.1「依赖递归／循环」两个阶段都有真实用例：入队阶段返回 `SOURCE_DEPENDENCY_CYCLE`，入队之后才被改出环的作业收口为 `skipped`＋`INPUT_LIMIT`，两者都不调模型、不建候选。

**查到一处真缺口，本轮落进文档：** §1.4 把四件事并列写成「只定义采集口径」，读起来像都已就绪；实际「已展示候选数」这个分母没有任何生产者——§15.20 核过的 18 个通道里没有展示上报口，§13.3 又排除新增埋点，所以候选采纳率与建议负担当前**不可计算**，重复纠正次数与复用满意度同样只有口径、没有采集入口。已修订 `docs/designs/work-centered-memory.md` §1.4：逐项点名今天能取的是分子（`memory_operations` 的 `set-status`＋`governanceAction='confirm'` 回执）与真实耗时／usage（`memory_extraction_jobs` 的 `started_at`／`finished_at`／`usage_json`），并写死「不为凑分母补遥测，要采集必须先另立设计并单独授权」。这条与 ADR-0026「不承诺采纳率」一致，属于把既有边界说清，不改范围。

顺带核过「不把 code point 换算成实测 token」：`memory-extraction-service.ts:975` 的 `usage` 只在收到模型 chunk 时赋值，全仓无 code point→token 换算路径（`memory-retrieval.ts` 的 `tokenizeRecallText` 是相关性打分用词切分，与计量无关）。

验证：本轮只改设计稿一段与任务板本节，无代码与测试变更；`npx prettier --check` 与 `git diff --check` 通过，新增中文段落整段 `sed -n` 回读，引用的 `MemoryView.tsx:96`、`memory-labels.ts:56-59`、`ContextPanel.test.tsx:285`、`memory-extraction-service.ts:526/975`、`App.tsx:214` 逐个 `grep -n` 核到行。

### 15.23 §13.1 覆盖矩阵逐条映射与两条召回边界用例（2026-09-23 05:51）

§13.1 列了 16 项「测试必须覆盖」的场景，此前各卡只写了「有用例」，没有逐条对到用例名。本轮把 24 个记忆相关测试文件加 `migrate.test.ts`／`register-ipc.test.ts`／渲染侧四个界面用例共 356 条 `it()` 标题按矩阵逐条正则映射（每项都补了同义词，如「成环／循环」「残留／来源消失」），命中分布：

| 矩阵项 | 命中标题数 | 主要落点 |
| --- | --- | --- |
| 协议非法字段／ID 归属 | 6／1 | `memory-extraction-service.test.ts`、`workspace-memory-brief-service.test.ts`、协议侧 `index.test.ts` |
| CAS 与幂等 | 9 | `memory-repository.test.ts`、`memory-extraction-service.test.ts` |
| 状态终态 | 7 | `work-centered-memory.integration.test.ts` 等 |
| 迁移回滚／外键 | 5 | `migrate.test.ts`、`memory-repository.test.ts` |
| 有效期边界与清除 | 13 | `memory-conflict-policy.test.ts`、`memory-provenance.test.ts` |
| 依赖递归／循环 | 7 | `memory-recall-service.test.ts`、`memory-extraction-service.test.ts` |
| 中文与非 BMP 预算 | 2 | `memory-content-policy.test.ts`、`memory-retrieval.test.ts` |
| 冲突组 | 13 | `memory-conflict-policy.test.ts`、`MemoryView.test.tsx` |
| 取消／重启／迟到 | 13 | `memory-extraction-service.test.ts` 与四个 Hook |
| 投影与 DB 一致 | 8 | `memory-service.test.ts`、`register-ipc.test.ts` |
| 实际请求与重放 | 3 | `memory-dispatch-gate.test.ts`、`run-history-policy.test.ts` |
| 精确版本／新任务不带旧授权 | 3 | `App.test.tsx`、`work-centered-memory.integration.test.ts` |
| **来源移除但修订残留** | **1（且不在召回层）** | 只有 `workspace-memory-brief-service.test.ts` 的简报收缩用例 |
| opt-in 0 调用、无模型／截断／EOF／工具、UI 过期响应 | 9／7／5 | `memory-extraction-service.test.ts`、四个 Hook |

两条矩阵项在**召回层**没有对应边界用例，本轮补齐（`memory-recall-service.test.ts` 4 → 6 passed）：

1. **「人工来源被移除后，残留修订不再注入且排除账本只记身份」**——`memory-recall-service.ts:809` 会因来源操作行读不到而落 `source-unavailable`，但这条分支此前从未被任何用例走过。用例先按真实写入路径产出 verified＋manual 来源的已确认记忆，再用同目录 SQLite 连接抹掉 `memory_operations` 那一行（与文件里既有的 `forgeDependencies` 同一手法：生产路径不存在「只删来源留修订」的命令，所以造对抗状态而不为它开后门），断言修订仍在库里、却没进注入块，排除账本按身份命中，且账本序列化后与注入块都不含正文。
2. **「包装预算超限时整组让位，不留半条冲突口径」**——§6.2 的块级预算（整块 ≤8,000、包装 ≤2,000）只有常量断言，没有边界用例。用例造 8 组 keep-both 冲突（正好占满 16 条上限，正文极短），每组适用条件用满 §5.5 的 300 码点上限，使撑破的只可能是包装项；断言入选数小于 16、成对出现、块长不超 8,000，并逐组比对「两条要么都在块里、要么都不在」。

两次都用**变异验证**确认用例真的咬得住：把 `sourceAvailable(...)` 判断短路后第 1 条红、把块级预算两个比较项短路后第 2 条红（`expected 16 to be less than 16`），其余四条不受影响；两次变异都已还原，工作树里只有测试文件变更。

方法上的收获：命中数低不等于缺覆盖（关键词假阴性），命中数高也不等于覆盖到位（简报层有用例不能替代召回层）。判定只看一件事——**契约里那条分支有没有用例走过**，这一轮就是靠这条标准抓出召回层两个零覆盖分支的。

验证：`npx eslint` 与 `npx prettier --check` 通过；`npm run typecheck` 退出码 0；`npm run verify` 退出码 0（Test Files 112 passed／Tests 1008 passed，较上一轮 1006 净增 2）；无表结构与协议变化，故无迁移用例。

### 15.24 逐卡完成定义与定向清单核对（2026-09-23 05:57）

§12 的 16 张卡各自写着「文件／Given-Then／定向测试」三件套，但卡片标 done 之后没人回验过它点名的文件真的存在、定向命令真能跑。本轮把 WM01–WM15 卡片里点名的 32 个测试文件名与全部生产文件名逐个回落到仓库：

**一处真缺陷，已改。** WM06 的「文件」行仍列 `run-memory-audit`、「定向」行仍写 `run-memory-audit.test.ts`，而这个文件从未建立——审计事实实际由 `run-memory-context-repository.ts`、`run-history-policy.ts`、`memory-dispatch-gate.ts`、`memory-recall-service.ts` 四个文件承载，且这个偏离只在 §15.3「契约 §11 偏离」一条里记着。结果是照卡办事的人跑 `npm test -- …run-memory-audit.test.ts` 会得到「没有匹配到测试文件」，而卡片本身是 done。已把 WM06 两行改为真实的文件与测试清单（`memory-dispatch-gate.test.ts` 确实按 `request.messages` 断言，满足本卡「必须断言请求 messages，不只断言 segmentId」），并在同一行指向 §15.3 的偏离记录。

**一次假警报，已自我证伪。** 按关键词（`2048`／`上限`）扫 `openai-compatible-provider.test.ts` 只命中一条用例，据此会误判 WM08 的「Given profile 上限低于 2048，Then 使用较低值」没有边界用例。实际该用例存在，只是标题是英文且不含字面量：`sends the lower of the profile ceiling and the request ceiling` 断言了 profile 512 压住请求 2,048、请求 2,048 压住 profile 4,096、无 profile 时取 2,048 三种组合。教训：**扫标题找用例只能当索引，判定必须打开文件读断言**；本轮两次假阴性（上一节「成环／循环」、这一节的中英标题）都是同一个成因。

其余逐条核过的卡片硬条件都有强制点＋用例：WM09 的 `MEMORY_EXTRACTION_CONCURRENCY = 1`、`MEMORY_EXTRACTION_QUEUE_LIMIT = 20` 落在 `memory-extraction-repository.ts:376/420` 并由其测试按队列满与并发满双向验证；WM12 的同空间 active ≤20 是 `WORKSPACE_REFERENCE_ACTIVE_LIMIT`，超限走 `REFERENCE_LIMIT` 领域失败；WM04 的非 BMP／码点计数由 `memory-retrieval.test.ts:210`「counts emoji and other non-BMP content in code points」与 `memory-content-policy.test.ts:27`「counts code points rather than UTF-16 units for non-BMP content」钉住，WM06 的 messages 断言落在 `memory-dispatch-gate.test.ts`（该文件捕获 `request.messages` 末条内容）；WM15 点名的集成文件与全部定向路径存在。

验证：本轮只改任务板两行与新增本节，无代码与测试变更（改动的是文档指向，不需要重跑门禁）；`npx prettier --check` 与 `git diff --check` 通过，改后两行 `sed -n '150,153p'` 回读；所引 `memory-extraction-repository.ts:376/420`、`openai-compatible-provider.test.ts:390` 逐个 `grep -n` 核到行。

### 15.25 持久化清单列级核对与一处源码注释失效指针（2026-09-23 06:04）

§15.3 只核到「迁移 v26–v29 存在且被 `migrate.test.ts` 覆盖」这一层，表内列与约束没有逐条对过。本轮把契约／Spec §8.1–§8.3 声明的持久化形状逐项落到 `app-schema.ts` 上核对，共 **8 张表 82 个声明列**（`memory_records` 新增 6、`run_memory_reads` 新增 3、`memory_operations` 5、`memory_conflict_decisions` 8、`run_memory_contexts` 19、`workspace_memory_settings` 6、`memory_extraction_jobs` 26、`workspace_artifact_references` 9）：

- **列缺失 0。** 脚本按 `CREATE TABLE` 体解析列名并与声明清单求差，8 张表全部命中；两处 `extra` 是解析器把 `REFERENCES` 折行当列，非真实多余列。§5.2 要求的 `facet` 与 `kind` 互斥、`candidate_disposition` 只出现在 candidate、`replaces_revision_id` 不得自我替代，都写成了表级 CHECK，注释还说明反向不成立的理由（§8.4 不得回填伪造处置）。
- **约束与外键方向逐条对上 §8.1／§8.3。** `run_memory_reads` 保持 `UNIQUE(run_id, memory_revision_id)`，`memory_id` 只是数据列、精确引用与外键一律落在 `revision_id`；Run 审计子表 `ON DELETE CASCADE`，被历史引用的记忆修订、冲突裁决三列与 `workspace_artifact_references.artifact_version_id` 全部 `RESTRICT`。§8.2 索引清单四项齐备（`idx_memory_records_scope_hash`、`idx_memory_records_topic_key`、`idx_memory_extraction_jobs_status(status, created_at)`、`idx_workspace_artifact_references_active(workspace_id, status, selected_at DESC)`，另有三个裁决修订列的反查索引）。
- **写进去有没有人读出来。** 九个新增字段逐个回查生产源码，均同时具备写入点与读出映射；`run_memory_contexts` 的 19 列由 `run-memory-context-repository.ts:77-109` 全量映射回领域对象（JSON 列在读出时即用 Zod 解析），界面侧 `ContextPanel.tsx:535/554/709/749/761` 消费 `selectedItems`、`decisionSummary`、`replay`，不存在「只落库不展示」的哑列。

**一处真缺陷，已改。** `app-schema.ts:1242` 的注释把阶段守卫写成「由写入方（run-memory-audit）把守」，而该模块从未建立——阶段单调推进实际在 `run-memory-context-repository.ts:184/220` 的 `markRequestPrepared`／`markDispatchAttempted` 里用 `WHERE phase = …` 与 `changes !== 1` 双重把守。已把指针改为真实文件。这与 §15.24 的 WM06 卡片同源的旧名，说明 §15.21 那次文件名真实性扫描的覆盖面有边界：它只扫了文档里的反引号文件名，**源码注释里的失效指针不在其内**。

验证：本轮改一行注释并新增本节；`npx prettier --check` 与 `npx eslint apps/desktop/src/main/db/app-schema.ts` 均退出 0，改后该行 `sed -n '1242p'` 回读字面正确且 `grep -c run-memory-audit` 在该文件为 0。列级核对脚本只对源码文本求差，不写库、不跑迁移，故无测试变更，但改的是生产源码，仍跑定向 `migrate.test.ts` 兜底（41 passed，退出码 0）；表形状本身仍由 `db/migrate.test.ts` 与 WM15 集成测试的真实 SQLite 断言守着。

### 15.26 Spec §2.2 九条静态风险逐条闭合与契约「合并重建」要求收口（2026-09-23 06:19）

Spec §2.2 写着「必须验证的静态风险」九条，是本轮开发的立论起点；§15.3 只笼统提过 WM01 复现了第 1 条。本轮逐条把风险对到**当前生产代码里的强制点＋测试用例名**：

| 风险 | 强制点 | 用例（标题原文） |
| --- | --- | --- |
| 1 写 IPC 返回未解析 Promise | `register-ipc.ts:1215-1240` 四个写通道加 `:1285` 重建通道全部 `async (input) => await …` | `register-ipc.test.ts:821`「commits memory writes to receipt envelopes and lists governance views」——经真实注册回调断言 `revision` 已推进到 1/2/3 |
| 2 投影失败在提交之后 | `memory-service.ts:179-188` 警告语义、`:530-550` 串行链 | `memory-service.test.ts:242`「survives a failed projection as committed-plus-warning」、`work-centered-memory.integration.test.ts:801`「投影目录故障时仍按 SQLite 召回，重建请求可见地报失败」、`memory-result.test.ts:56`、`MemoryView.test.tsx:285` |
| 3 先截 16 条再排除、排除后不补位 | `memory-retrieval.ts:289-336` 跳过超长继续试更短、`memory-recall-service.ts:764-782` 任务排除在候选集之前由仓储过滤 | `memory-retrieval.test.ts:173`「skips an oversized record and keeps trying shorter ones」、`:145`「returns nothing rather than backfilling with unrelated recent records」 |
| 4 准备前记录被当成已发送 | 三阶段分别写于 `run-service.ts:516-527`、`memory-dispatch-gate.ts:77-82`、`run-memory-context-repository.ts:184/220`，DDL CHECK 在 `app-schema.ts:1247-1275` | `memory-dispatch-gate.test.ts:70`「writes request-prepared before dispatch-attempted, exactly once per run」、`:86`「never reaches the provider when the audit write fails」、`ContextPanel.test.tsx:425` |
| 5 重放只处理子集缩小、首个 message.completed 当最终回答 | `run-history-policy.ts:88-131`（删除/过期/排除/材料替换/新修订各自理由）、`memory-recall-service.ts:931-937` 取 sequence 最后一条 | `run-history-policy.test.ts:51/105/111/160/174` 五条（含「takes the contiguous safe suffix and stops at the first unsafe turn」） |
| 6 仅凭来源字符串认定归属 | `memory-provenance.ts:94-147` 由 Main 从已登记实体生成、`memory-recall-service.ts:282-306` 逐类型定位 | `memory-provenance.test.ts:76`「refuses to invent a source for a run that does not exist」、`:84`、`memory-service.test.ts:295`「rejects a fabricated source selector instead of trusting the client」 |
| 7 `supersedesId` 被当成跨记忆替代 | `memory-repository.ts:921` 恒指向同身份上一修订，`:717-719` 跨身份替代写 `replacesRevisionId` | `memory-repository.test.ts:148`（`:171` 断言 `supersedesId === 上一修订`）、`:551`（`:601` 断言精确修订引用） |
| 8 依赖 Renderer 临时消息 ID | 重放身份只由 `runId`＋`finalEventId`＋`promptHash` 构成（`memory-recall-service.ts:1002-1015/1090-1098`、`memory-provenance.ts:54`）；渲染层未检索到临时消息 ID 进入协议 | `run-history-policy.test.ts:211`「records the exact identity of every replayed turn」、`:136`「refuses to infer safety when legacy dependency facts are missing」 |
| 9 保存/导出/Run 成功被当成业务批准 | `workspace-brief-service.ts:16-21/63-64/117-141` 只按来源可用性分区、未决节点保持未决；`ArtifactView.tsx:658` 注释钉住标记语义 | `workspace-brief-service.test.ts:145`「keeps open checkpoints marked unresolved and never confirmed」、`:105`、`WorkspaceBrief.test.tsx:132` |

**一处契约与实现的真实冲突，已按实现收口。** 风险 2 的后半句「并发重建需保证旧投影不覆盖新状态」在契约 §5.6 里被写成「合并重建请求但不得旧覆盖新」，而 `memory-service.ts:534-549` 的实现从不合并——每个调用者排进链里跑自己那一次。**合并反而是缺陷**：在飞的那次执行读到的早于后来者刚提交修订，共用结果会让后来者在自己内容尚未落盘时拿到 `synced`。故按仓库纪律改文档而不是改代码：契约 §5.6 改成「不合并正在执行的重建」并写清为什么（每个写命令排入自己的执行＋每次执行开始时同步读最新提交），`memory-service.ts:531` 那句自相矛盾的注释同步改准。

该保证目前是构造性的，**没有可判定的回归测试**：本轮试过补一条并发重建用例，但交叠窗口依赖文件系统 await 的调度时机：三次并发重建即便真的同时跑，也各自写同一组目标路径并以唯一临时文件名 `rename` 覆盖，最终磁盘内容不变，所以用例大概率不会红。本轮没有为此改生产代码加测试 seam，也没有落这条用例（未做变异验证的猜测不算证据），按 §15.23 的规矩「永远通过」的用例比没有用例更有害，故把它作为已知测试边界写进契约 §5.6，交由 WM16 人工验收时观察是否存在可见的投影不一致。

验证：本轮改一行生产注释、契约 §5.6 一段、任务板新增本节；`npx prettier --check` 与 `npx eslint apps/desktop/src/main/services/memory-service.ts` 退出 0，`npx vitest run apps/desktop/src/main/services/memory-service.test.ts` 退出 0（16 passed，用它给投影路径兜底），`npm run typecheck` 退出 0；表内全部 `file:line` 与用例标题逐条 `sed -n`／`grep -n` 回读核实，其中 `memory-dispatch-gate.ts` 的两个阶段标记核到 `:77-82`、`memory-repository.ts` 的 `supersedesId` 核到 `:921`。


### 15.27 Spec §10 与 §7.3 逐条闭合、排队失败安全诊断补线（2026-09-23 06:54）

**A 组｜Spec §10「简报和成果引用精确规则」10 条逐条取证。** 每条都指到实现行号与非测试用例标题原文。

| # | 契约条款 | 强制点 | 用例（标题原文） |
| --- | --- | --- | --- |
| A1 | 简报字段与各区 `total`／`truncated` | 常量 `packages/agent-protocol/src/index.ts:1991-1993`（10／5／20）；`workspace-memory-brief-service.ts:59-149` 组装 | `workspace-memory-brief-service.test.ts:417`「各区按上限截断并如实报告 total，不假装完整」 |
| A2 | 确认区排序 `updatedAt DESC`／`id ASC` | `memory-repository.ts:602` | `:202`「确认区只收本空间当前有效、verified 且来源仍可用的 confirmed 记录」 |
| A3 | 只纳入当前有效＋verified＋来源可用 | 同上，配合 `workspace-memory-brief-service.ts` 的来源可用性分区 | `:243`「把待复核与源失效分别判定成各自身份，不折叠成可用」、`:530`「已确认记录的来源消失后简报当场收缩，不留残余条目」 |
| A4 | 空间视角不混 user 偏好，选专家才叠加 expert-workspace | `workspace-memory-brief-service.ts:59-149` 的 scope 过滤 | `:287`「只有为该专家装配简报时才叠加 expert-workspace 记录」 |
| A5 | 条目返回 `memoryId`／`revisionId`／`hash`／`content`／`scope`／`sourceAvailability`／`requiresMaterialSelection` | `workspace-brief-reader.ts:22-157` DTO 组装 | `:260`「资料派生条目仍进入简报，但标明使用时仍需材料且不因此获得授权」 |
| A6 | openIssues 取本空间未决节点最近 10 项、保留原标识、不做 LLM 推断 | `workspace-memory-brief-service.ts:59-149` openIssues 段 | `:322`「开放节点只取本空间未决项，被替代与外来空间的节点都不出现」、`:366`「未决节点保留 feedback 与 nextAction 原标识，不推断成已确认结论」 |
| A7 | 参考区取最新 5 个 active 标记，`selectedAt DESC`／`id ASC` | `workspace-reference-repository.ts:219`（排序）＋`:226`（截断） | `:392`「参考区按 selectedAt 倒序取用 active 标记，取消后的标记不再出现」 |
| A8 | 查询失败显示可重试错误，不伪造旧简报 | `workspace-brief-service.ts` 错误映射＋`use-workspace-brief.ts:42-84` | `:479`「底层读取失败返回可重试的 STORAGE_ERROR，不伪造旧简报」、`use-workspace-brief.test.ts:135`「读取失败时清空简报并给出重试入口，重试会重新现取一次」 |
| A9 | 空态不自动补内容；未知空间与非法入参不得降级成空简报 | 同上 | `:471`「未知工作空间回答 NOT_FOUND，而不是给出一份空简报」、`:525`「入参不合协议时由协议错误拒绝，不降级成空简报」、`:498` |
| A10 | 标记参考或显示简报不算读取 Evidence；引用后由既有工具读取 | 写点只出现在 `run-service.ts:1245/1260/1274/1290/1430`（真实读取之后） | `workspace-memory-brief-service.test.ts:447`「是可重建视图：新事实当场生效，读取本身不落任何库」 |

**§10 与实现的唯一字面差异已被 WM00 的机械对齐吸收，判定为无缺陷。** 设计稿写「默认 purpose 为 `comparison`」，而 `materialPurposeSchema`（`packages/agent-protocol/src/index.ts:251-260`）里根本没有该值——`comparison` 只存在于 `artifactInputRelationKindSchema:2174-2183`。契约 §10 第 309 行记录对齐后的 `historical-comparison`，`App.tsx:582-602/1058-1070` 完成映射。**不新增同义枚举**，正是 §10 自己要求的做法。

**B 组｜Spec §7.3「持久化生命周期」12 条逐条取证。**

| # | 契约条款 | 强制点 | 用例（标题原文） |
| --- | --- | --- | --- |
| B1 | 状态机 queued→running→终态；执行前条件不满足直接 skipped | `memory-extraction-repository.ts:419 claimNext`／`:441 markSkipped`／`:445 cancel`／`:449 fail`／`:454 succeed`；跳过判定 `memory-extraction-service.ts:727/731/734/741` | `memory-extraction-service.test.ts:534`「依赖记忆修订无法证明时跳过自动建议（不截断）」、`:568`「入队之后才被改出环的作业跳过执行，不建候选也不调用模型」 |
| B2 | 手动 retry 只从非成功终态转 queued，`attempt` 递增 | `memory-extraction-repository.ts:487-519`（`SET status='queued', trigger='manual-retry', attempt = attempt + 1`） | `memory-extraction-repository.test.ts:411`「retries only from a non-success terminal state and bumps the attempt」、`memory-extraction-service.test.ts:961`、`use-memory-suggestions.test.ts:282`「手动重试只授权这一次作业，不改动自动开关」 |
| B3 | succeeded 即使 0 条也不再提炼同来源版本 | `memory-extraction-repository.ts:367-374`（`findBySource` 命中即 `existing`） | `memory-extraction-service.test.ts:640`「模型返回 0 条也算成功，并且不再提炼同一来源版本」、`:486` |
| B4 | 来源键＝触发类型＋真实来源 id＋内容快照 hash，不含模型版本 | `memory-extraction-repository.ts:153-163 extractionSourceKey` | `memory-extraction-repository.test.ts:253`「keeps one logical job per source version no matter which model is chosen」 |
| B5 | 候选写入、去重统计、作业成功终态同事务 | `memory-extraction-service.ts:1072-1100`（一个 `this.transaction` 内 `create` ×N ＋ `succeed`） | `memory-extraction-service.test.ts:606`「合法用户纠正 → 候选以待审状态落库并整份继承依赖」、`:657`「与既有 pending 候选重复计 deduplicated，与已拒绝候选计 suppressed」 |
| B6 | 排队失败不能把已成功主 Run 改失败 | `run-service.ts:731-732`（终态 `publish` 之后才请求提炼）＋`:758-777`（不 await） | 新增 `work-centered-memory.integration.test.ts:807`「排队失败（全局队列已满）不改主 Run 终态，也不留下自动补单」、既有 `:782`「提炼失败不改变主 Run 终态，也不写入候选」 |
| B7 | 启动把遗留 queued／running 收口 interrupted，零网络 | `main/index.ts:124-127`、`memory-extraction-repository.ts:568-580` | `memory-extraction-repository.test.ts:457`、`memory-extraction-service.test.ts:943`「重启收口：遗留 queued/running 全部 interrupted 且零网络调用」、`work-centered-memory.integration.test.ts:717` |
| B8 | 关闭设置只取消本空间自动作业 | `memory-extraction-repository.ts:582-594`（`trigger='automatic' AND workspace_id=?`） | `memory-extraction-repository.test.ts:213`「cancels the automatic jobs of this workspace when the switch goes off」、`memory-extraction-service.test.ts:395` |
| B9 | 取消后先落库终态再中止请求 | `memory-extraction-service.ts:621-645`（`cancel` 成功后才 `controller.abort()`） | `memory-extraction-service.test.ts:914`「取消执行中的作业：先落终态再中止请求，迟到结果不落库」 |
| B10 | 落候选前校验 revision／attempt／status、来源有效性、自动模式 consentRevision；迟到结果不落库 | `memory-extraction-repository.ts:596-619`（`WHERE ... AND revision = ? AND attempt = ?`，`changes !== 1` 抛冲突）；同意新鲜度 `memory-extraction-service.ts:732-733/832` | `memory-extraction-repository.test.ts:355`「rejects a late result that does not match revision, attempt and status」、`memory-extraction-service.test.ts:818`「同意缺失、模型不可用、指纹变化、来源变化都在调用模型前收口」 |
| B11 | 失败只保存安全错误码；列表只回脱敏摘要 | `memory-extraction-repository.ts:596-619`（只写 `error_code` 列，库里无错误正文列）、`:540-566 listPage` | `memory-extraction-repository.test.ts:485`「pages desensitized job summaries for one workspace」、`memory-extraction-service.test.ts:1000`、`:684`、`:786`「Provider 抛错只落 MODEL_REQUEST_FAILED，凭据既不进数据库也不进日志」 |
| B12 | UI 主动刷新＋焦点查询；只在面板可见且有活动作业时 1 秒轮询，隐藏即停 | `use-memory-suggestions.ts:193-218`（`activeJobKey` 依赖＋`1_000` 毫秒＋`focus` 补查）、`:175-185`（换空间或换可见性先清空） | `use-memory-suggestions.test.ts:224`「有活动作业时按秒轮询，作业结束后停止轮询」、`:248`、`:147`「面板不可见时既不发请求也不启动轮询」、`:322` |

**（本节的这一条判定被 §15.28 更正）「摘要」到底有没有生产者？** §7.3 还写「失败只保存安全错误码与摘要」。本节初稿写成「协议与库里都只有 `errorCode`」——**这句是错的**：协议 `memoryJobSummarySchema` 里确实声明了 `diagnostic`（`packages/agent-protocol/src/index.ts:1916`，`max(500)` 的安全说明），界面还优先读它（`renderer/src/lib/memory-suggestions.ts:60`，用例 `memory-suggestions.test.ts:91`「失败优先展示摘要，缺摘要才退回错误码」）。真实状态是**有消费者、零生产者**：库里没有对应列，仓储 `finish()` 只写 `error_code`（`memory-extraction-repository.ts:596-619`），`toSummary` 从不填 `diagnostic`（`:210-226`）。完整判定与两条出路见 §15.28，取舍归光哥；本轮不自行补列，也不删契约条目。

**查到一处真实缺陷并已补线：排队失败从来没留过安全诊断。** §7.3 要求「排队失败不能把已成功主 Run 改失败；记录安全诊断」，而 `requestExtractionForRun` 对队列满、模型不可用、依赖超限等原因返回的是 **`ok: true` ＋ `status: 'not-enqueued'` ＋ `reason`**（`memory-extraction-service.ts:727-741/777-778/808`），`run-service.ts` 的旧代码只在 `!outcome.ok` 分支里 `console.warn`，于是这条正常返回的路径把原因码整个咽掉——§2.2 那类「声明了却没接线」在诊断面上再现一次。已在 `run-service.ts:767-771` 补：带 `reason` 的 not-enqueued 也写一条只含原因码的 warn（不落原文，守「日志不得记录密钥」）。`notEnqueued()` 无原因码的唯一路径是「自动建议本就关闭」（`:731`），保持静默，避免每次 Run 都刷屏。

**新增用例的写法与代价。** `work-centered-memory.integration.test.ts:807` 用另一条真实任务链（`a2`）把全局队列占满 20 条，再跑 `a1` 的 Run，断言主 Run 仍 `completed`、`a1` 名下没有任何作业行、候选为空、且那条安全诊断确实写出。占位作业必须挂在真实存在的 Run 上（`assertSourceOwnership` 会拒编造的来源），并且**一条事务写完**——逐条提交时本用例实测 4.7 秒，贴着默认 5 秒超时线；改成单事务后同一用例实测 912 毫秒（全文件 11 条全绿，`tests 17.65s`）。

**变异验证两次，一红一不红，都记录。** ① 把新加的 `console.warn` 短路成 `void 0`：本用例红（`AssertionError: expected false to be true`），其余 10 条不受影响；还原后 `grep` 确认生产源码只留这一处新增。② 反过来把诊断分支改成 `this.finalizeFailure(runId, ...)`（模拟「排队失败去改主 Run」）：用例**仍然绿**——因为 `requestRunExtraction` 在 `publish(terminalEvent)` 之后才调用，Run 早已终态，`finalizeFailure` 只收口仍处 `running` 的 Run。所以 B6 这半句在当前代码里还有**结构免疫**，新用例判定的是「诊断确实记录＋不补单＋不建候选」，判定不了「有人把入队挪到终态之前并 await」。不为此改生产代码加测试 seam，按 §15.23 的规矩把边界写在这里，交 WM16 人工验收时一并说明。

**「不自动扫描补单」是结构事实，不是用例。** `memory-extraction-service.ts` 内检索 `scan`／`backfill`／`sweep`／`requeue` 均无命中（假阴性已按同义词补查），作业只由 `requestExtraction*` 显式登记、由 `runPendingJobs` 排空已入队的行；本轮不为「不存在的路径」造用例。

**一处需光哥确认的口径（不改契约条目，只标注落点）。** 契约 §7.3 沿用 Spec 原句「Run 成功提交和作业登记、人工 feedback 提交和作业登记**尽量**在同应用库事务完成」。实现里这两处都**不共用**事务：登记前必须先 `await` 解析模型快照与凭据（`memory-extraction-service.ts:773-780`），而来源提交早已在 `publish` 时落定，把异步解析塞进 Run 事务会违反「事务内不得有网络／不得悬挂」。取舍兜底就是 B6 那条硬约束，任务板 WM09 卡片第 179 行也按「候选和作业成功同事务，主 Run 失败隔离」记录。**已在契约 §7.3 原句后补一段实测落点说明并指向本节**，是否算偏离原设计需光哥拍板；本轮没有删改「尽量」那句本身。

验证：`npx prettier --check` 与 `npx eslint` 对本轮两个源码文件退出 0；`npx vitest run apps/desktop/src/main/services/work-centered-memory.integration.test.ts` 11 条全绿（`tests 17.65s`）；`npm run verify` 退出码 0（112 文件／1009 用例，新增即本节这一条）；表内全部 `file:line` 与用例标题本轮逐条 `grep -n`／`sed -n` 回读核实，其中 `memory-extraction-repository.ts` 的五个终态方法核到 `:419/441/445/449/454`、`memory-extraction-service.ts` 的候选事务核到 `:1072-1100`、简报排序核到 `memory-repository.ts:602` 与 `workspace-reference-repository.ts:219/226`。


### 15.28 Spec §9.1／§9.3 与 §11 文件责任逐条闭合，抓出一个只有消费者没有生产者的字段（2026-09-23 07:10）

**A 组｜§9.1「统一结果与最小公共对象」6 条。**

| # | 契约条款 | 强制点 | 证据（用例标题原文／实测） |
| --- | --- | --- | --- |
| A1 | 仅记忆／简报／参考家族使用协议 `Result<T>`，不迁移全仓其他 IPC | `packages/agent-protocol/src/index.ts:1251` 定义 | `grep -rl "Result<" apps/desktop/src/main/services` 恰好命中 5 个记忆家族服务（`memory-service`／`memory-recall-service`／`memory-extraction-service`／`workspace-memory-brief-service`／`workspace-reference-service`）；`search-engine-service.ts`、`model-connectivity.ts` 各自保留自有形状，未被顺手改造 |
| A2 | WriteReceipt 字段（`operationId`／`commit`／`effect`／`committedRevisionIds`／`currentMemory?`／`projectionState`），设置与参考回执带各自 current 对象、不返回不受约束 data | `index.ts:1319-1330`、`:1379`（`currentSettings`）、`:1409`（`currentReference`） | `register-ipc.test.ts:973`（`receipt.currentSettings.autoSuggestEnabled`）、`workspace-reference-service.test.ts:111/136/142/152`（新建／改名／unchanged／removed 四态都带回 `currentReference`） |
| A3 | ListPage 的 `cursor` 是 `updatedAt＋id` 的版本化结构，limit 默认 50／上限 100；作业列表 20／50 | `index.ts:512-513`、`:1755-1756`；游标构造 `memory-extraction-repository.ts:560-565`（`{version:1, updatedAt, id}`）、`memory-repository.ts:554` | `memory-extraction-repository.test.ts:485`「pages desensitized job summaries for one workspace」（含翻页游标续取） |
| A4 | `MemoryViewItem` ＝ MemoryRecord＋`effectiveStatus`＋`sourceAvailability`＋`requiresMaterialSelection`＋`conflicts` | `index.ts:1293` | `memory-service.test.ts` 治理族；简报侧同源断言见 §15.27 A5 |
| A5 | EditPatch 只允许 content／facet／topicKey／scope／日期，日期与 topicKey 用显式 `clear`；来源不是任意可编辑 JSON | `index.ts:576-590`（set／clear 互斥）、`:955` `memoryEditPatchSchema`；来源只能经 verified 选择器（`memory-provenance.ts:94-147`） | `memory-service.test.ts` patch 族；来源伪造拒绝见 §15.26 风险 6 行 |
| A6 | 三条成功警告都要有生产者：`PROJECTION_PENDING`／`SOURCE_NEEDS_REVIEW`／`HISTORY_TRUNCATED` | `memory-service.ts`（投影失败＝已提交＋警告）、`memory-recall-service.ts:1278/1369/1428`、`:1284/1419` | `memory-service.test.ts:295`、`work-centered-memory.integration.test.ts:801`「投影目录故障时仍按 SQLite 召回，重建请求可见地报失败」（断言 `warnings` 含 `PROJECTION_PENDING` 且 `commit==='committed'`） |

§9.3 的错误码分组与警告分组已在 §15.18（错误码逐值找写入点）与 §15.21（文档散文）里扫过，本节不重复；§9.2 的 IPC 双面在 §15.20。本轮新增的是**「谁在读这个字段」这一面**：§15.18 只问「声明的码有没有人写」，没问「写出去的 DTO 字段有没有人填」。

**B 组｜§11「文件责任和阶段划分」拟新增模块逐个查存在性（19 项）。** 18 项都已按卡建立并可 `test -f`：`memory-operation-repository.ts`、`memory-provenance.ts`、`memory-content-policy.ts`、`memory-retrieval.ts`、`run-memory-context-repository.ts`、`run-history-policy.ts`、`model-provider-factory.ts`、`memory-extraction-repository.ts`、`memory-extraction-service.ts`、`memory-extraction-prompt.ts`、`workspace-reference-repository.ts`、`workspace-brief-service.ts`、`use-memory-suggestions.ts`、`use-run-memories.ts`、`use-workspace-brief.ts`、`MemorySuggestionList.tsx`、`WorkspaceBrief.tsx`、`MemoryEditor.tsx`。

唯一没落地的是 `persistence/run-memory-audit.ts`——**它正是这一系列幽灵名字的源头**：§15.24 抓到 WM06 卡片点名 `run-memory-audit.test.ts`（从未建立），§15.25 抓到 `app-schema.ts:1242` 注释把守卫写成 `run-memory-audit`。运行审计的真实承担者是 `run-memory-context-repository.ts`＋`run_memory_reads` 表，本轮不新建空壳模块凑名，只把落点记在这里（Spec §11 表格是交接快照，不回写）。

**C 组｜本轮的真实发现：`JobSummary.diagnostic` 有消费者、零生产者。** §9.2 把「安全说明?」写进 JobSummary 字段清单，协议据此声明了 `diagnostic`（`index.ts:1916`，`max(500)`），界面 `memory-suggestions.ts:60` 的读法是 `job.diagnostic ?? job.errorCode ?? 状态标签`——**摘要优先**；用例 `memory-suggestions.test.ts:91`「失败优先展示摘要，缺摘要才退回错误码」用**手喂的 DTO** 证明这条分支按设计工作。但生产侧没有任何一处填它：库里无对应列（`app-schema.ts` 作业表只有 `error_code`），`finish()` 只写码（`memory-extraction-repository.ts:596-619`），`toSummary` 也不带这个键（`:210-226`）。结果是**这条界面分支永远走后备路径**，而 §7.3「失败只保存安全错误码与摘要」里的「摘要」从来没有落地。

两条出路都不在本轮授权范围内，归光哥拍板：① **补生产者**＝新增列＋版本化迁移＋写前过 `diagnosticOf` 那份脱敏与 500 码点截断（同时把「敏感文本不进库」这条边界重新核对一遍）；② **收窄契约**＝删掉 `diagnostic` 字段与界面分支，只保留错误码。本轮既不自行加列，也不擅自删契约条目，只把 §15.27 里那句写错的判定就地更正。

**教训（写进核对方法）**：查「声明 vs 生产」时必须**双向**问——除了「声明的值有没有人写」，还要问「DTO 里每个字段有没有人填、有没有人读」。只查一侧会漏掉这种「界面优先读、生产端从不写」的字段；它比孤儿常量更隐蔽，因为界面单测手喂 DTO 会让它看起来完全被覆盖过。

验证：本节为纯文档改动（更正 §15.27 一处判定＋新增本节），生产源码与测试未再改动；`npx prettier --check docs/development/tasks-memory.md` 退出 0；表内 `file:line` 全部当场 `grep -n`／`sed -n` 回读核实（协议侧核到 `:512-513/1251/1293/1319-1330/1379/1409/1755-1756/1916`，主进程核到 `memory-recall-service.ts:1278/1284/1369/1419/1428`、`memory-extraction-repository.ts:210-226/560-565/596-619`），19 项模块存在性用 `test -f` 逐项打印。上一节（§15.27）的全量门禁仍然有效：`npm run verify` 退出码 0，112 文件／1009 用例。

### 15.29 Spec §5.1–§5.5 逐条款闭合，补齐四处「有强制点、无边界用例」并删掉一条假守卫（2026-09-24 20:31）

本轮轴＝通用实施契约 §5.1–§5.5 全 41 条逐条款。三条并行取证回料后，本人按行号抽查 45 处强制点（`sed -n "Np"` 逐行打印比对），下表只保留抽查命中的行；用例标题一律是 `it()` 原文。

**A 组｜§5.1 基础类型、长度与时间（7 条）**

| # | 条款 | 强制点 | 用例 |
| --- | --- | --- | --- |
| A1 | `operationId` 为 UUID，跨进程只在协议定义 | `agent-protocol/src/index.ts:519`；入库再校验＋同 ID 不同哈希判据 `memory-operation-repository.ts:145-149` | `memory-operation-repository.test.ts`「rejects receipt shapes that the contract does not allow」 |
| A2 | 一律按 Unicode 码点计量 | `index.ts:497` `countCodePoints`，生产侧 28 个调用点（`memory-retrieval.ts:83/129/142`、`memory-extraction-service.ts:309/766/1038`、`workspace-brief-service.ts:177` 等） | `index.test.ts:712`「按 Unicode 码点而不是 UTF-16 长度计量」、`memory-retrieval.test.ts:210`「counts emoji and other non-BMP content in code points」、`memory-provenance.test.ts:166` |
| A3 | 人工 1–2,000／候选 1–500／摘录 ≤500／`topicKey` ≤80／参考 `label` ≤120 | 常量 `index.ts:501-507`；强制点 `:809`（记录）、`:957`（patch）、`:1058`（create）、`:1826`（候选）、`:688`（摘录）、`:822`、`:2082`；DDL CHECK `db/app-schema.ts:1076/1368` | `memory-extraction-prompt.test.ts:139`、`memory-provenance.test.ts:57`、`migrate.test.ts:1778`、`migrate.test.ts:2050`；**人工正文 2,000 与适用条件 300 由本轮新增 `index.test.ts:719`「契约写死的正文与适用条件上限都要真的卡住」补齐** |
| A4 | 非负 epoch ms；`validFrom ≤ now < validUntil`；缺端无界 | `index.ts:815-819`；`memory-repository.ts:438-439` 与 SQL 同口径 `:461` | `memory-repository.test.ts:337`「derives validity and expiry at read time instead of storing a second status」、`index.test.ts:48` |
| A5 | `contentHash`＝UTF-8 SHA-256；`normalizedHash` 仅 NFC＋换行统一＋trim | `memory-content-policy.ts:12/15/18` | `memory-content-policy.test.ts:13`「normalizes only formatting and keeps meaning-bearing characters」、`:19`「keeps negation, digits and units out of the dedup collision」 |
| A6 | 稳定序列化：键排序、有序数组保序、集合按精确引用键排序，不含 secret／AbortSignal／临时消息 ID | `index.ts:572`（键排序 `:556-559`、数组保序 `:551-554`）；集合排序 `memory-recall-service.ts:154`、`memory-operation-repository.ts:91`；三处幂等指纹 `memory-service.ts:68`、`memory-extraction-service.ts:166`、`workspace-reference-service.ts:54` 只哈希已校验请求体 | `memory-operation-repository.test.ts:226`「stores one canonical shape per revision pair and reads it back either way round」、`memory-dispatch-gate.test.ts:59`；**唯一偏离：`memory-dispatch-gate.ts:24-33` 把整份 `messages` 喂进序列化器，而 `run-service.ts:790/793` 现场 `randomUUID()` 生成消息 id ⇒ 该指纹含临时消息 ID。它只在同调用内写库后回读比对（`run-memory-context-repository.ts:198-215`），从不跨请求复算，故无判定被削弱；落点已写进契约 §5.1，剥不剥归光哥** |
| A7 | 日期 patch 为 set／clear 判别联合，省略即保留，二者不可并存 | `index.ts:577`（两分支均 `.strict()`）；`memory-repository.ts:412` 未提交即保留 | `index.test.ts:798`「EditPatch 至少一个字段，日期支持显式 clear」、`memory-repository.test.ts:282`「keeps a cleared validity date distinct from one that was never set」 |

**B 组｜§5.2 MemoryRecord 增量（6 条）**

| # | 条款 | 强制点 | 用例 |
| --- | --- | --- | --- |
| B1 | 保留既有 16 字段，新增恰为 6 项 | `index.ts:802-828`（`.strict()` 挡第七项），新字段 `:821-826`；DDL `app-schema.ts:1053-1059` | `index.test.ts:48` |
| B2 | facet→kind 由宿主映射 | `index.ts:671` 与一致性校验 `:841`；SQL 侧第二处映射 `memory-repository.ts:245`；DDL CHECK `app-schema.ts:1098-1103` | `index.test.ts:746`「facet 与 kind 由宿主映射，客户端不能提交矛盾组合」 |
| B3 | `candidateDisposition` 仅 pending/rejected，非候选省略 | 枚举 `index.ts:656`、禁止 `:848`；构造 `memory-repository.ts:667-672`；DDL `app-schema.ts:1106` | `migrate.test.ts:1778`、`memory-repository.test.ts:470` |
| B4 | `replacesRevisionId` 指向另一身份精确旧修订，`supersedesId` 仍指本身份上一修订 | `memory-repository.ts:718`（前置 `:690` 判 `winner.id !== loser.id`）与 `:921`；FK／自替代 CHECK `app-schema.ts:1086/1109` | `memory-repository.test.ts:551`（断言 `loser.replacesRevisionId === winnerRevisionId`） |
| B5 | 每次编辑或状态变化追加修订；无变化返回 unchanged 不堆空修订 | `memory-repository.ts:619`（同状态短路）→`:623`＋`:920` | `memory-repository.test.ts:148`「appends a revision per change and refuses to pile up empty ones」 |
| B6 | 终态 deleted/superseded 禁编辑／确认／续期／恢复 | `index.ts:952`＋`memory-repository.ts:434/612/1095-1112`；服务映射 `memory-service.ts:110` | `memory-repository.test.ts:404`（对 edit 与六个治理动作逐个断言异常类）；**错误码字符串此前零断言 → 本轮补 `memory-service.test.ts`「终态记忆后续写走 TERMINAL_MEMORY 领域失败，不把异常文案丢给界面」** |

**C 组｜§5.3 来源和依赖（11 条）**

| # | 条款 | 强制点 | 用例 |
| --- | --- | --- | --- |
| C1 | `schemaVersion=1` 判别联合；legacy 不补造来源与时间；verified 带 authority／capturedAt／sources 1..3／依赖 0..200／0..100 | `index.ts:773-799`（`:788` `sources.min(1).max(3)`），常量 `:508-510`；构造期二次拦截 `memory-provenance.ts:250-255`；legacy 构造只展开原字段 `:274-280` | `memory-provenance.test.ts:200`「marks legacy rows unverified without fabricating a source or capture time」、`index.test.ts:785` |
| C2 | 自主全局可无 `originWorkspaceId`，空间来源必须真实 | 取值 `memory-service.ts:146-147`；条件展开 `memory-provenance.ts:237/264`；真身校验 `memory-repository.ts:983-989`（create 路径 `:473` 调用） | `memory-extraction-service.test.ts:606`（断言候选带 `originWorkspaceId`）、`memory-repository.test.ts:1002` |
| C3 | user/expert 全局只允许 user-instruction、依赖为空且 `genericDeclaration=true` | `memory-service.ts:247-259` 两道门；空依赖 `memory-provenance.ts:235-236`；升级禁令 `memory-service.ts:312-321` | `memory-service.test.ts:134`；**升级禁令此前有生产者零用例 → 本轮补集成用例「助手回复派生的空间记录不能直接改成全局口径」** |
| C4 | 五种 SourceRef 各带必需身份与版本 | `index.ts:695/703/711/720/729`；checkpoint 字段白名单 `:682`＋读取器只返回 feedback/summary（`memory-provenance-reader.ts:33-37`）；助手 `message.completed` 真实性 `memory-provenance-reader.ts:13-17` | `memory-provenance.test.ts:40/82/91/105/117/186` 逐分支 |
| C5 | Main 读已登记实体算哈希，Renderer 只提交选择器 | 选择器联合不含真实性字段 `index.ts:993-1028`；请求 `.strict()` `:1070`（夹带 `verification`/`authority` 直接拒）；重建 `memory-service.ts:684-695`→`:150-164` | `memory-service.test.ts:295`「rejects a fabricated source selector instead of trusting the client」、`memory-provenance.test.ts:40` |
| C6 | 摘录按码点 start/end 左闭右开，Main 验区间与文本一致 | `memory-provenance.ts:57-58` 区间、`:84` `SOURCE_MISMATCH`、`:181-183` 选中文本必须落在受管版本正文；协议二次校验 `index.ts:744-759` | `memory-provenance.test.ts:57`、`:65`「rejects a reversed or empty range」、`:132`；`index.test.ts:756` |
| C7 | 候选继承来源 Run 直连＋重放的材料与记忆依赖，模型无权删 | `extraction-source-reader.ts:56-73`（`listDependencyUnion`＝直连∪重放，`run-memory-context-repository.ts:266`）；登记 `memory-extraction-service.ts:791-792`；整份写到候选 `:1055-1062`；模型可名字段白名单 `memory-extraction-prompt.ts:219`、多余键拒 `:259-261` | `extraction-source-reader.test.ts:73`、`memory-extraction-service.test.ts:606` |
| C8 | 依赖超额或无法证明时可见跳过，绝不静默截断 | 入队 `memory-extraction-service.ts:737-748`；执行期复证 `:854-866`→`skipped`/`INPUT_LIMIT`；构造期 RangeError 按候选跳过 `:1064-1067`；跳过计数落作业结果 `:1094-1102` | `memory-extraction-service.test.ts:591/534/568` |
| C9 | 记忆依赖存 `memoryId＋revisionId＋contentHash`，按版本核、创建时展开、拒绝循环 | 形状 `index.ts:764-770`；按版本核 `memory-recall-service.ts:341-342`、`memory-extraction-service.ts:744-745`；DFS 展开 `memory-extraction-service.ts:188-205`，两处调用 `:750`、`:870` | `memory-extraction-service.test.ts:551`、`memory-recall-service.test.ts:230` |
| C10 | 三层有效性分开：历史可审计／用户可查看／当前可注入；材料派生仍需本 Run 允许集；记忆派生记忆失效要复核 | 三道闸在同一循环 `memory-recall-service.ts:803-818`（`source-review-required`／`source-unavailable`／`dependency-unavailable`），材料实体可用性 `:308-317`、精确键匹配 `:368-387`＋允许集 `:791-793`；视图仍可见但不可注入 `memory-service.ts:764`；历史仍可审计 `memory-repository.ts:512-518/788`；父删除预检不静默级联 `:1045-1084` | `memory-recall-service.test.ts:362/191`、`work-centered-memory.integration.test.ts:516/656` |
| C11 | 自主口径重新保存＝新 manual 来源＋空依赖，回执留 `fromMemoryRevisionId` 但不假装原资料已核实 | `memory-provenance.ts:221-241`（manual 源用最终提交正文哈希 `:213`）；只作审计的门 `memory-service.ts:645-658`；回执 `:276-278`；原样落库 `memory-operation-repository.ts:171-173` | `memory-service.test.ts:145`「keeps the restated revision as an audit link, even on replay」、`:180`「refuses an audit link that is fabricated or not a restatement」 |

**D 组｜§5.4 确认、拒绝、替代（7 条）**

| # | 条款 | 强制点 | 用例 |
| --- | --- | --- | --- |
| D1 | create 只接受最终表单，`confirmed` 由 Main 决定 | `memory-service.ts:486` 写死；请求体无 `status` 且 `.strict()` `index.ts:1055-1070` | `MemoryView.test.tsx:146` 以 `toEqual` 钉住整份请求字段集 |
| D2 | 模型候选只由内部服务写 candidate/pending，无公开「确认模型建议」API | `memory-extraction-service.ts:1085-1086`；通道闭集 `index.ts:3886-3905`＋`register-ipc.ts:1203-1289` | `register-ipc.test.ts:224`「registers no channel outside the protocol」 |
| D3 | `set-status` 六动作由状态转移表验证 | 枚举 `index.ts:906-913`；表 `:925-950` 是唯一判据，仓储直接复用（`memory-repository.ts:631`→`:1095-1112`） | `index.test.ts:809`「治理动作与错误码是封闭枚举」 |
| D4 | confirm/reconfirm 可带 patch，只核一个 `expectedRevision`，编辑与确认同事务 | `index.ts:1102-1116`；`memory-service.ts:359`→`:378-386` 单事务；`memory-repository.ts:629-681`（patch 投影 `:647-652`，一次追加修订 `:674-680`） | `memory-repository.test.ts:470`「walks candidates through reject and restore exactly as the transition table allows」 |
| D5 | candidate/rejected 只能回 pending 或删除；expired 可改有效期再确认；deleted/superseded 终态 | `index.ts:937-952`；`memory-repository.ts:611-613/1099-1105` | `memory-repository.test.ts:404`＋本轮新增服务层用例 |
| D6 | 替代要求新旧处于同一规范 scope，不允许局部例外作废全局规则 | `memory-repository.ts:699-701`（`sameCanonicalScope :406`）→`SCOPE_MISMATCH`（`memory-service.ts:112-114`）；无任何豁免分支 | `memory-repository.test.ts:635`「refuses a replace across scopes, against itself and over unconfirmed records」 |
| D7 | replace 事务核两条 `expectedRevision`、确认新、旧追加 superseded、写 `replacesRevisionId` 与裁决回执，任一步失败全回滚 | `memory-service.ts:506-521` 包事务；`memory-repository.ts:687-721` 双 CAS；裁决＋回执同内层事务 `memory-operation-repository.ts:215-263` | `memory-repository.test.ts:551`（回执写入抛错→两条记录都回到原位）、`memory-operation-repository.test.ts:191` |

**E 组｜§5.5 冲突策略（7 条）**

| # | 条款 | 强制点 | 用例 |
| --- | --- | --- | --- |
| E1 | 同非空 `topicKey`＋作用域交集＋有效期交集＋`normalizedHash` 不同 ⇒ 潜在冲突，不判真假 | `memory-conflict-policy.ts:85-90`（交集实现 `:14-34`、`:55-61`），非空下限由 `index.ts:822/1061` 保证 | `memory-conflict-policy.test.ts:81`「requires a shared non-empty topicKey, differing content and overlapping validity」 |
| E2 | 无 `topicKey` 不做语义矛盾识别；本期不调额外 LLM、不用不可解释启发式 | `memory-conflict-policy.ts:86` 直接短路；召回是纯函数 `memory-retrieval.ts:24-28`，`memory-recall-service.ts:100` 不触网；记忆族唯一模型路径 `memory-extraction-service.ts:965` 只写候选、不比较两条记忆 | `work-centered-memory.integration.test.ts`「重启后记忆、审计与召回保持一致，启动阶段零网络」 |
| E3 | candidate 与 confirmed 的冲突提示不阻塞既有 confirmed | 标记只落在候选 `memory-conflict-policy.ts:127`；列表侧 `memory-service.ts:735-766`；召回只装 confirmed `memory-repository.ts:593`，故 blocked 集按构造拿不到候选 | `memory-service.test.ts:405`「把与已确认记忆重复的候选标成待处理重复」（另一半见「本轮缺口」第 5 行） |
| E4 | 两条已确认未裁决 ⇒ 整组不注入＋可见「待澄清口径」摘要，不自动挑一条，也不展示越权正文 | 排除 `memory-recall-service.ts:823-826`；并查集成组、不选赢家 `:549-566`；摘要生产者 `:879`（协议字段 `index.ts:1569`）；只带身份 `:197-200/219-231`；文案 `memory-labels.ts:76`＋界面 `ContextPanel.tsx:613-616` | `memory-recall-service.test.ts:250`「同议题两条未裁决的口径互相顶住，谁都不注入」、`ContextPanel.test.tsx:394`「待澄清口径与待复核来源只报身份，不展示正文」 |
| E5 | keep-both 需用户填写 1–300 适用条件并绑定精确修订对；共同召回整组同进同退；任一修订变化即失效 | 边界 `index.ts:505-506`，请求 `:1130-1134`、存储 `:880-884`；成对绑定 `memory-operation-repository.ts:210-214/273-284`；失效判定 `:301-312`；成组 `memory-recall-service.ts:674-697`＋超预算整组让位 `:703-723` | `memory-operation-repository.test.ts:265/346`、`memory-recall-service.test.ts:338`「包装预算超限时整组让位，不留半条冲突口径」 |
| E6 | replace 必填 `winnerId`，keep-both 必填说明 | `memory-service.ts:497`（`INVALID_TRANSITION`）、`:437-447`（`CONFLICT_REVIEW_REQUIRED`）；刻意不进 IPC schema 的理由见 `index.ts:1137-1141` | `register-ipc.test.ts:909`「refuses an incomplete conflict decision as a domain failure instead of a schema throw」、`memory-service.test.ts:311` |
| E7 | 本期不声称自动识别新上传材料与记忆的全部语义冲突 | 负向条款：冲突判定只有三个调用点（`memory-recall-service.ts:542`、`memory-service.ts:742`、`workspace-brief-reader.ts:109`），资料导入与 `task-material` 管线都不引 `memory-conflict-policy` | 无测试（不声称的事情不需要用例；文档侧已按 §15.21 收口） |

**本轮缺口与处置**

| # | 缺口 | 处置 |
| --- | --- | --- |
| 1 | 人工正文 2,000、适用条件 300 两个契约数字**只有强制点、没有任何边界用例**（全仓无 2001／301 码点用例） | 新增 `index.test.ts:719`，双向断言 2,000 通过／2,001 拒、300 通过／301 拒，数字写死字面量 |
| 2 | `TERMINAL_MEMORY` 错误码字符串在测试里从未被断言（仓储层只断异常类，界面上到底出现哪个码无人证明） | 新增 `memory-service.test.ts` 服务层用例：删除后再编辑／再恢复都收口成 `TERMINAL_MEMORY`，且不追加修订 |
| 3 | `WORKSPACE_FACT_CANNOT_BE_GLOBAL` 有生产者（`memory-service.ts:318`）但零用例，是 §15.18「无生产者码」的反面同一种缺陷 | 新增集成用例：真实 Run 的 `message.completed` 派生 verified/derived 空间记录，改 `scope:'user'` 被拒且库里 scope 未变 |
| 4 | `memory-provenance.ts:293` 的 `assertNoDependencyCycle` **导出但生产零调用**，其唯一用例标题写着「derived provenance refuses …」而 `buildDerivedProvenance` 根本不调它 —— 一条会让后来人以为写时已挡自引用的假守卫 | 删除死导出与那条用例。真实环检测在 `memory-extraction-service.ts:188-205`（入队 `:750`、执行 `:870` 两处都有生产者与用例），读侧另有 `memory-recall-service.ts:331` 递归护栏；新建记录的身份先于任何依赖存在，自引用在写时结构上不可能，故不为此造失败路径 |
| 5 | §5.5「candidate 与 confirmed 的冲突提示」这半条在**召回链路**上无驱动用例 | 不补假用例：召回装载集合按 `memory-repository.ts:593` 只含 confirmed，候选按构造进不了 `blocked`，因此该分支无法被真实驱动；已在契约 §5.5 与本节记录为边界，人工验收时留意候选列表的冲突标记即可 |
| 6 | `modelRequestHash` 的输入含临时消息 ID，与 §5.1 那句字面不符 | 不改代码也不改判定：写进契约 §5.1 落点，若要审计指纹变成可跨次复算的规范指纹需在装配阶段剥 `message.id`，属协议与审计语义变化，归光哥 |

**变异验证**（每次还原后再跑下一处；全部完成后 `git status` 只剩本轮文件）

| 变异 | 结果 |
| --- | --- |
| `MEMORY_CONTENT_MAX_CODE_POINTS` 2,000→2,001 | 新用例红（其余 30 条不受影响） |
| `MEMORY_APPLICABILITY_NOTE_MAX_CODE_POINTS` 300→301 | 新用例红 |
| `mapDomainError` 的 `failResult('TERMINAL_MEMORY', …)`→`INVALID_TRANSITION` | `memory-service.test.ts` 17 条中**只有新用例红**，16 条仍绿 |
| 升级禁令 `authority === 'derived'`→永不匹配 | 集成 12 条中**只有新用例红**，11 条仍绿 |

验证：`npx eslint`（本轮 5 份改动文件）退出 0；`npx vitest run memory-provenance.test.ts` 删除后 14 条全绿；`npm run verify` 退出码 **0**，**112 文件／1011 用例全绿**。用例数与上一节对得上：1009 ＋ 本轮新增 3 条 − 删除的假守卫 1 条 ＝ 1011（`memory-provenance.test.ts` 少一条，其余三条分别落在协议、服务与集成文件）。契约 §5.1／§5.5 两处落点为纯文档改动，含在全量门禁的 `format:check` 里。**口径要说满**：本节这段验证文字写在那次门禁之后，它（以及日志同日新增段落）只由随后的 `npx prettier --check docs/development/tasks-memory.md docs/development/memory-contracts.md docs/logs/2026-09-24.md` 退出 0 覆盖，未重跑全量门禁——纯文档改动不触碰代码，这一点是判定而非实测。

### 15.30 Spec §7.1／§7.2 逐条款闭合：补上「无 Run 的讨论反馈用当前 TaskContext 的模型」这条从未实现的口径（2026-09-24 21:01）

本轮轴＝模型与提炼正文（§7.1 九条、§7.2 八条）＋ §13.2 里程碑三栏记录 ＋ §16 假设与边界。并行取证回料后按行号复核 31 处强制点。

**A 组｜§7.1 模型与 Provider（9 条）**

| # | 条款 | 强制点 | 用例（`it()` 原文） |
| --- | --- | --- | --- |
| A1 | Main 内共享 `model-provider-factory.ts`，复用 profile／默认解析／credential-access；Agent Core 不导入数据库 | 工厂存在且被两侧共用 `services/model-provider-factory.ts:113/143`；`packages/agent-core/package.json` 依赖面 | `model-provider-factory.test.ts:187`「reads the secret from the credential store once migration is done」＋护栏 `standards/coding-standard.test.ts:205`「packages 不依赖 apps，Agent Core 不依赖宿主运行时」 |
| A2 | 普通 Run 兼容行为保持 | `run-service.ts:1455` 仍走同一工厂的 `resolveForRun` | `model-provider-factory.test.ts:78`「keeps the teaching fallback for ordinary runs when nothing is configured」 |
| A3 | 提炼用 `requireConfiguredLanguageModel`，生产禁止 Fake 回落 | `model-provider-factory.ts:117-121`（非 profile/default 直接 `MODEL_UNAVAILABLE`）；主进程装配不传 `fallbackProvider`（`main/index.ts:112`），Fake 只作为普通 Run 的回落注入（`run-service.ts:417`→`:1454`） | `model-provider-factory.test.ts:113`「refuses to run extraction on the teaching model even when a fallback exists」 |
| A4 | 新 Run 审计存实际解析的 `modelProfileId` 与非敏感指纹 | `run-service.ts:620-622` | `run-memory-context-repository.test.ts:167`「walks selected to request-prepared to dispatch-attempted with the real request hash」 |
| A5 | **无 Run 的讨论反馈使用当前 TaskContext 的模型** | 本轮新实现：`extraction-source-reader.ts` 的 `taskContextModelProfileId`（`getLatest(taskId).modelReference` → 执行专家修订 `modelReference`，与 `run-service.ts:1527` 同口径），`readCheckpointSource` 在 `!runId` 时取它 | 本轮新增 `work-centered-memory.integration.test.ts`「没有来源 Run 的讨论反馈用当前 TaskContext 钉住的模型，不暗换应用级默认」（两侧：钉住 profile 时作业带该 profile；停用它后拒绝且零作业登记，而应用级默认可用） |
| A6 | 配置不可用／指纹变化 ⇒ `skipped`，不暗换另一服务 | `memory-extraction-service.ts:885/898`；工厂侧不另找替代 `model-provider-factory.ts:129` | `memory-extraction-service.test.ts:818`「同意缺失、模型不可用、指纹变化、来源变化都在调用模型前收口」 |
| A7 | 手动重试需展示当前模型并重新同意 | 独立同意 `memory-extraction-service.ts:600`；展示名从当前 profile 联表取 `memory-extraction-repository.ts:650`，界面 `MemorySuggestionList.tsx:220` | `memory-extraction-service.test.ts:961`「手动重试带独立同意：attempt 递增、trigger 变 manual-retry、不改自动开关」（「展示当前模型」这一半 无测试，见缺口 3） |
| A8 | 指纹不含凭据；端点只存去 query／userinfo 的展示值 | `model-provider-factory.ts:157`（指纹入参无 `apiKey`）、`:64`（`protocol//host+pathname`） | `model-provider-factory.test.ts:128`「never carries the credential, so two keys on the same config match」、`:66`「strips query, userinfo and any url-borne token」、`memory-extraction-service.test.ts:461` |
| A9 | `maxOutputTokens` 可选，实际发包 `min(请求上限, profile上限)`；done chunk 带可选 `finishReason`／`usage`，普通消费者兼容；提炼只接受 `stop`；缺结束原因＝`MODEL_FINISH_UNKNOWN`；`length` 不当完整 JSON | `agent-core/src/types.ts:29/35`；`openai-compatible-provider.ts:36`（`Math.min`）；编排器只读 tool-call 分支 `agent-engine.ts:139`；`memory-extraction-prompt.ts:231-232` | `openai-compatible-provider.test.ts:390`「sends the lower of the profile ceiling and the request ceiling」、`:404`、`:235`「maps the upstream finish_reason %s into %s」、`agent-engine.test.ts:38`、`memory-extraction-prompt.test.ts`「distinguishes truncation, tool calls and an unknown finish reason」 |

超时／取消／早 EOF／可注入 fetch 的复用已在 §15.9–§15.11 与 §15.19 逐条取证（`memory-extraction-service.ts:960/965` 无自有 `fetch`、`openai-compatible-provider.ts:131/246`），本节不重复。

**B 组｜§7.2 作业输入、输出及保密（8 条行为面）**

| # | 条款 | 强制点 | 用例（`it()` 原文） |
| --- | --- | --- | --- |
| B1 | 只用本次 prompt；需要消歧时才取「上一轮最终回答」，绝不把本轮新生成的答案当已被认可的经验 | `extraction-source-reader.ts:83`（`needsDisambiguation` 才取）＋`:48`（`run.id !== currentRunId` 过滤）＋`:32`（只取 `message.completed`） | `extraction-source-reader.test.ts:98`「attaches the previous final answer only when the prompt needs disambiguation」 |
| B2 | 讨论输入：人工 feedback 为主证据，summary 只是背景、不能证明确认 | `memory-extraction-prompt.ts:60`（`HUMAN_EVIDENCE_ROLES` 只有 `user-prompt`／`checkpoint-feedback`）→ `:311/314` 拒绝无人工证据的候选 | 「keeps human feedback as the primary fragment for checkpoint jobs」＋本轮新增「节点摘要单独撑不住一条候选：摘要只是背景，不证明确认」 |
| B3 | summary 送入上限 1,000 码点 | `memory-extraction-prompt.ts:29`（取协议常量）＋应用处 `:142`（`clampHeadTail`） | `memory-extraction-prompt.test.ts`「respects the fixed instruction and whole-request code point ceilings」 |
| B4 | 超长采用首尾等分并标注非全文；证据区间只能落在真实片段内 | `memory-extraction-service.ts:325/329`（等分＋`partial: true`）＋`:396`（`mapStoredRange` 把片段坐标映回全文，跨标记即放弃）；`memory-extraction-prompt.ts:306/308` | 「marks truncation instead of silently dropping the middle」＋`memory-extraction-service.test.ts:1068`「超长来源：截断片段仍按全文坐标证明头段证据；命中截断标记的证据被放弃而非伪造」 |
| B5 | 不读完整材料、文件或其它历史来补上下文 | `memory-extraction-prompt.ts:103`（装配器只收四个文本字段）；`extraction-source-reader.ts:70`（材料只取引用，不取正文）；提炼服务全文件无 `readFile`／`knowledgeVault` | 「sends only the minimal evidence plus disambiguating background」、`extraction-source-reader.test.ts:62`「refuses a run without a preparation snapshot」 |
| B6 | 依赖随来源与背景引用整份继承，不随送入片段截断 | `memory-extraction-service.ts:791`（入队整份）→`:1059`（候选整份）；超额即拒 `:737` | 「合法用户纠正 → 候选以待审状态落库并整份继承依赖」「材料依赖超额时返回 SOURCE_DEPENDENCY_LIMIT 结论」 |
| B7 | 严格 JSON 的每条子断言（≤3 条；每条 1–3 段证据；至少一段人工证据；Main 验片段身份／码点区间／非空；宿主字段出现即整次非法；0 条合法；围栏或解释或任一非法即整体失败；不做修复重试） | `memory-extraction-prompt.ts:243/244/250/258/259/267/284/287/303/306/308/311/314`；单次解析 `memory-extraction-service.ts:1000` | 「accepts zero candidates as a successful result」「rejects code fences, trailing prose and any extra top-level key」「rejects a candidate supported only by assistant text」「rejects evidence pointing at a fragment that was never sent」「rejects evidence ranges outside the fragment that was actually sent」「rejects host-owned fields smuggled into a candidate」「rejects more than three candidates and an over-long body」＋`work-centered-memory.integration.test.ts:788`「提炼失败不改变主 Run 终态，也不写入候选」（其中断言提炼请求恰好 1 次＝无修复重试）；**候选正文下限 1 码点由本轮新增「空正文候选让整次结果失败（正文下限 1 码点）」补上** |
| B8 | 提示词六条固定规则随请求送出；敏感内容三处拒绝且日志不落原文；用户可关自动建议；不外传到其它服务 | `memory-extraction-prompt.ts:66-70`（六条原文）；`memory-extraction-service.ts:760/905/1027`（入队前／执行前／保存前）＋`:696`（日志同源脱敏）；`memory-content-policy.ts:44`（含本次已知凭据）；`memory-service.ts:244`（写入口同源）；开关 `memory-extraction-service.ts:526`；唯一出口 `:965` | 「来源片段命中敏感内容时拒绝提炼：零入队零模型调用」「输出命中凭据模式时整批拒绝保存且不落原文」「Provider 抛错只落 MODEL_REQUEST_FAILED，凭据既不进数据库也不进日志」＋本轮新增「契约写死的六条提炼规则随每次请求一起送出」（六句原文逐条 `toContain`） |

**C 组｜§13.2 里程碑三栏记录（此前只有两栏，缺第三栏即记为缺，不伪造）**

| 里程碑 | 自动证据 | 用户界面证据（人工） | 模型语义证据（真实模型） |
| --- | --- | --- | --- |
| WM-M0 | 文档完整性／链接：§15.13（429 条内部链接逐条）＋§15.21 文档散文轴 | 待光哥（设计批准已给，界面未逐项签收） | 不适用 |
| WM-M1 | §15.2 自动证据清单＋§15.23 §13.1 矩阵逐条映射＋§15.29 §5.1–§5.5 全 41 条 | 待光哥：§15.5 第 1 项治理界面（保存／复核／排除／冲突／本次记忆） | 不适用（本里程碑不涉模型） |
| WM-M2 | §15.9–§15.11 提炼族＋§15.19 数字面＋§15.30 §7.1／§7.2 逐条款（含假 Provider 拒绝、无修复重试、凭据三处出口） | 待光哥：§15.5 第 2 项自动建议候选质量 | **未验证**：真实模型语义质量需光哥单独授权后跑，本轮全部用可捕获请求的替身 |
| WM-M3 | §15.12–§15.16 简报与参考链＋§15.27 §10 十条 | 待光哥：§15.5 第 3 项简报与精确版本引用（Markdown／PPTX） | 不适用 |
| WM-M4 | `npm run verify` 退出码 0（见本节末）＋§15.1 WM15 端到端 13 条 | 待光哥：§15.5 第 4／5 项（连续两次实际工作、提交发布授权） | **未验证**，同上 |

**D 组｜§16 已确定假设与边界逐条核对**

| 假设／边界 | 现状证据 |
| --- | --- |
| 自动建议默认关闭、按空间同意；人工保存不调模型 | 设置默认值 `memory-extraction-repository.ts:273`（`autoSuggestEnabled: false`）与同意门槛 `memory-extraction-service.ts:600`、`memory-extraction-service.ts:600`；人工保存路径无任何模型调用（`memory-service.ts:236-280` 只写库） |
| 不依赖 CF 未完成的远程 MCP／API；缺可用模型只阻塞相应真实提炼验收 | 提炼只经 `ModelProviderFactory`＋credential-access，无 MCP／API 服务依赖；缺模型时 `MODEL_UNAVAILABLE` 收口（`:885`） |
| 旧来源无法证明时保留历史但需复核，且必须让用户看见 | `memory-recall-service.ts:804-807`＋`memory-service.ts:764`（`review-required` 仍可见）＋`SOURCE_NEEDS_REVIEW` 警告；§15.26 风险 1 行 |
| 本机可存来源与记忆内容；远程遵循已显示同意，不承诺永不离开设备 | 契约 §7.2 已按此措辞；同意版本单一来源 `MEMORY_SUGGESTION_CONSENT_VERSION`（§15.19） |
| 跨空间只由既有显式材料选择授权；本期参考标记只同空间 | `workspace-reference-repository.ts` 归属校验与 `REFERENCE_WORKSPACE_MISMATCH`；§15.14／§15.16 |
| 规模压测用 1,000 条有效记忆记录排序耗时，超可接受开销即返回设计评审、不擅自上向量库 | `memory-retrieval.test.ts:229`「ranks 1,000 active memories within the main-thread budget」：构造 1,000 条、两次排序结果一致、上界断言 200 ms，本机约 10 ms（`:227` 注释与 §15.17）；未超 ⇒ 按 Spec 不返回设计评审。记忆侧确无 Embedding／向量检索接线（`memory-retrieval.ts:24-28` 写明「非向量的确定性任务相关召回」）；全仓 `embedding` 字样只出现在既有的模型连通性检查里（`model-connectivity.ts:34-43` 按角色拼 endpoint），与记忆召回无关 |

**本轮缺口与处置**

| # | 缺口 | 处置 |
| --- | --- | --- |
| 1 | §7.1「无 Run 的讨论反馈使用当前 TaskContext 的模型」**整条未实现**：检查点无 `runId` 时 `modelProfileId` 恒为 `undefined`，提炼悄悄用应用级默认模型 | 已在 `extraction-source-reader.ts` 实现（TaskContext 自己的 `modelReference` 优先，退到执行专家修订），并落契约 §7.1 落点＋集成用例；这条是本轮唯一的「契约有、实现无」，与 §15.18／§15.28 那两类（有声明无生产）同源 |
| 2 | `summary` 单独作证据、候选正文空串两处契约分支无用例 | 补 `memory-extraction-prompt.test.ts` 两条（含 `INVALID_MODEL_OUTPUT` 判定） |
| 3 | §7.1 手动重试「展示当前模型」这一半无测试（`model_label` 联表已有生产者，界面也有读点） | 只记为边界，不为凑测试改生产代码；人工验收时在重试弹窗里核对模型名即是这一栏的证据 |
| 4 | 提示词六条规则此前只被长度断言覆盖 | 补「契约写死的六条提炼规则随每次请求一起送出」，逐句 `toContain` 原文；改词即红 |

**变异验证**

| 变异 | 结果 |
| --- | --- |
| 把 `readCheckpointSource` 的 profileId 取法还原成 `snapshot ? … : undefined` | 新集成用例红（`expected undefined to be '<pinned id>'`），其余 12 条不受影响；已还原，`git diff --numstat` 该文件只剩本轮新增 |
| `HUMAN_EVIDENCE_ROLES` 加上 `checkpoint-summary` | 「节点摘要单独撑不住一条候选」红，其余绿；已还原 |
| `candidateContentMinCodePoints: 1`→`0` | 「空正文候选让整次结果失败」红；已还原 |
| 改掉 `INSTRUCTION` 第 1 条规则措辞 | 「契约写死的六条提炼规则随每次请求一起送出」红；已还原 |

验证：`npx eslint`（三份改动文件）退出 0；`npm run typecheck` 通过；`npx vitest run memory-extraction-prompt.test.ts` 18 条全绿；`npx vitest run work-centered-memory.integration.test.ts` 13 条全绿；`npm run verify` 退出码 **0**，**112 文件／1015 用例全绿**（上一节 1011 ＋ 本轮新增 4 条）。本节这段验证文字写在那次门禁之后，只由随后的 `npx prettier --check`（三份文档退出 0）覆盖，未重跑全量门禁——纯文档改动不触碰代码，这一点是判定而非实测。

**待光哥拍板新增**：本轮把「无 Run 的讨论反馈用当前 TaskContext 的模型」按契约原文实现成「TaskContext 钉住的 profile 优先，退到执行专家修订的 `modelReference`」——若产品上更希望这类反馈固定走应用级默认（现状＝改动前行为），请明确，我按结论回退或改文档；另外「重试弹窗展示当前模型」要不要补界面自动化测试也归光哥。
