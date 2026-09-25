# 记忆实施契约（WM 系列）

> 2026-09-25：[MI 改进 Spec](../designs/memory-improvements.md)的 D1–D5 推荐方案已获光哥批准；新增字段、迁移、IPC 和 v2 召回集中在[§11](#11-mi-改进契约proposed)。技术契约与 ADR 正式状态仍为 Proposed，尚未获单卡实施授权，不改变下方 §5–§10 的现行状态。

- 状态：**已实施的契约（ADR-0026 仍为 Proposed，接受状态待用户确认）**。本文所述字段、表、通道与算法由 WM01–WM15 落地并有自动化验收记录，收口证据见 [WM 任务板](tasks-memory.md) §15；实施与人工验收状态只以该任务板为准，本文不复述状态。
- 日期：2026-09-22（取自本轮 `date`）。
- 唯一职责：本文是工作型记忆**字段名、类型、状态转移、`memory-recall-v1` 算法、预算、code point 计数、表结构、迁移批次、IPC 通道、DTO 与错误码**的单一真相源。其他文档只链接、不复述整套字段。
- 依据：[工作型记忆产品设计](../designs/work-centered-memory.md)（产品行为与范围）、[ADR-0026](../adr/0026-work-centered-memory.md)（架构决策与替代关系）、[WM 唯一任务板](tasks-memory.md)（状态与验收）、[记忆编码提示词](memory-coding-prompts.md)。
- 相邻契约：[专家与任务上下文契约](expert-contracts.md)（Expert/TaskContextRevision/RunContextSnapshot）、[材料、快照与运行来源契约](material-contracts.md)（材料引用与读取足迹）、[能力契约](capability-contracts.md)（凭据与远程能力，本契约不依赖其未完成项）。
- 章节号沿用设计总稿的 §5–§10，以便任务卡与提示词中的「第 6 节」「第 7 节」引用在各文档间保持一致。
- 基线：HEAD `bfc66cd`，应用库最新迁移 v25；每卡开工重新核对，不作为未来固定值。

## 5. 通用实施契约

### 5.1 基础类型、长度与时间

- ID 延用已有稳定身份约定；新 `operationId` 为 UUID。跨进程全部定义在 `packages/agent-protocol/src/index.ts` 唯一入口。
- 本契约所有「字符数」均为 **Unicode code points**。正文、摘录和预算用同一计数函数；token 是独立模型额度。
- `content`：人工 1–2,000；自动候选 1–500；source excerpt ≤500；`topicKey` ≤80；参考 `label` ≤120。
- 时间为非负 epoch milliseconds；有效区间为 `validFrom ≤ now < validUntil`；缺省端点无界。
- `contentHash`＝保存正文 UTF-8 的 SHA-256。`normalizedHash` 仅做 NFC、换行统一和首尾空白去除后计算，不丢数字、单位、标点或否定词。
- 稳定序列化 JSON：对象键排序，语义有序数组保留顺序，集合先按精确引用键排序；不包含 secret、AbortSignal 和临时消息 ID。
- 日期 patch 为 `{ action: 'set', value }` 或 `{ action: 'clear' }`；省略表示保留。`set` 与 `clear` 不可同时出现，不使用 `undefined` 猜清空。

落点（任务板 §15.29）：「不包含 secret、AbortSignal 和临时消息 ID」由**调用方喂什么**保证，`stableStringifyJson` 本身只做键排序与数组保序。幂等指纹三处（`memory-service.ts:68`、`memory-extraction-service.ts:166`、`workspace-reference-service.ts:54` 的 `requestHashOf`）都只哈希已校验的 IPC 请求体，里面既没有凭据也没有 signal，因此重放判定与 `IDEMPOTENCY_CONFLICT` 不受影响。唯一把消息对象喂进序列化器的是 `modelRequestHash`（`services/memory-dispatch-gate.ts:24-33`）：它按 §6.4 要钉住「实际发出去的那份字节」，而每次装配的 `AgentMessage.id` 由 `run-service.ts:790/793` 现场生成，所以这个指纹里**确实含临时消息 ID**。该值只在同一次调用内写库后回读比对（`persistence/run-memory-context-repository.ts:198-215`），从不跨请求复算，因此没有判定被削弱；若要它变成可复算的规范指纹，需要装配阶段剥离 `message.id`，属审计语义变化，交光哥拍板，本轮不改。

### 5.2 MemoryRecord 增量

保留既有 `id`/`revisionId`/`revision`/`scope`/`kind`/`content`/`sourceType`/`sourceId`/`sourceLocator`/`confidence`/`status`/`validFrom`/`validUntil`/`supersedesId`/`contentHash`/`createdAt`/`updatedAt`。

| 新字段 | 含义 |
| --- | --- |
| facet | goal/constraint/decision/fact→semantic；method→procedural；preference→preference；experience→episodic |
| topicKey? | 可见、可编辑的议题标识，仅用于提示潜在冲突，不是权限或事实键 |
| normalizedHash | 确定性重复检测 |
| provenance | 版本化来源联合，见 §5.3 |
| candidateDisposition? | 仅 candidate 有 pending/rejected，其他状态省略 |
| replacesRevisionId? | 不同 memoryId 的被替代精确旧修订；supersedesId 仍指本身份上一修订 |

每次编辑/状态变化追加修订。相同内容无变化的提交返回 `unchanged`，不堆积空修订。终态 `deleted`/`superseded` 禁止编辑、确认、续期或恢复。

### 5.3 来源和依赖

`provenance` 为 `schemaVersion=1` 的联合：

- **legacy**：`verification:'legacy-unverified'`，保留原 `sourceType`/`sourceId`/`sourceLocator`，不补造来源或确认时间。
- **verified**：`verification:'verified'`, `authority:'user-instruction'|'derived'`, `capturedAt`, `sources[1..3]`, `materialDependencies[0..200]`, `memoryDependencies[0..100]`, `originWorkspaceId?`, `genericDeclaration?`。
- 新自主全局表单可无 `originWorkspaceId`；所有空间来源必须有真实 `originWorkspaceId`。`user`/`expert` 全局仅允许 `user-instruction`，来源依赖为空且 `genericDeclaration=true`。

结构化 `SourceRef` 分支：

| kind | 必需身份与版本 |
| --- | --- |
| manual | operationId、提交正文哈希 |
| run-user | runId、promptHash |
| run-assistant | runId、真实 message.completed eventId、事件正文哈希 |
| checkpoint | checkpointId、结论/反馈/引用的 contentHash；排除 status/updatedAt，节点被替代不伪造内容变化 |
| artifact-version | artifactId、artifactVersionId、contentHash |

每项附 `excerpt`、`excerptHash`、可选 `locator`。Main 读取已登记实体生成哈希；Renderer 只提交选择器，不能自报来源真实性。摘录使用 code point 起止位置 `start`/`end`（左闭右开），Main 验证范围和文本一致。人工表单来源直接使用最终提交内容。

自动候选及从助手/成果提炼的记录继承来源运行直接和重放的材料、记忆依赖；模型无权删依赖。依赖超额或无法证明时跳过自动建议，不静默截断。依赖记忆保存 `memoryId`、`revisionId`、`contentHash`，按版本检查，并在创建时展开来源依赖、拒绝循环。`MemoryExtractionService` 在入队与执行前各展开一次：入队阶段返回 `SOURCE_DEPENDENCY_CYCLE` 并跳过自动建议，作业阶段按 `INPUT_LIMIT` 收口为 skipped，两者都不调用模型、不建候选。

来源有效性分三层：历史可审计、用户可查看、当前可带入模型。Knowledge 历史修订还在不等于当前登记有效；材料派生内容进入模型仍要求精确依赖在本 Run 允许材料集合。记忆派生内容依赖旧记忆时，后者删除/修改/排除/失效应使前者待复核，不能重新包装后绕过遗忘。

自主口径重新保存是新 `manual` 来源、空模型依赖；由 `memory:create` 的 `fromMemoryRevisionId` 承载被重述的精确修订，`memory_operations.result_json` 原样保存并在回执里回显，但不假装原资料事实已核实。

### 5.4 确认、拒绝、替代

- `create` 只接受用户最终表单，Main 决定 `confirmed`；不接受任意 `status`。
- 模型候选仅由内部服务写 `candidate`/`pending`，无公开「模型确认」API。
- `set-status` 改成 action：`confirm`、`reject`、`restore-candidate`、`expire`、`delete`、`reconfirm`；由状态转移表验证。
- `confirm`/`reconfirm` 可含编辑 patch，检查一个 `expectedRevision`，在同一事务完成编辑和确认。
- `candidate`/`rejected` 只能恢复 `pending` 或删除；`expired` 可明确修改有效期并重新确认；`deleted`/`superseded` 是终态。
- 替代要求新旧记录处于同一规范 scope；否则提示先明确范围，不允许一条局部例外把全局规则作废。
- `replace` 事务校验两条 `expectedRevision`，确认新规则、旧规则追加 `superseded`、写 `replacesRevisionId` 和裁决/回执，任一步失败全回滚。

### 5.5 冲突策略

同一非空 `topicKey`、作用域交集、有效期交集、不同 `normalizedHash` ⇒ 潜在冲突，不认定真假。无 `topicKey` 不做语义矛盾识别，本期不调用额外 LLM 或使用不可解释启发式。

`candidate` 与 `confirmed` 的冲突提示不阻塞既有 `confirmed`。两条已确认冲突且未裁决时，当前召回排除这组规则并给出可见「存在待澄清口径」的摘要，不自动挑一个，也不展示越权那条正文。用户可继续无关工作；相关业务结论应先澄清。

`keep-both` 需用户填写 `applicabilityNote`（1–300），绑定精确修订对；以后共同召回时同时带入条件说明，组内两条不能因预算只带一条。任一修订变化使该裁决失效。无法写出适用条件时不要确认共存。

本期不声称自动识别新上传材料与记忆的全部语义冲突。当前指令/明确本期规则优先的上下文说明仍保留；自动化验收只证明上下文和冲突组处理，语义冲突处理用人工旅程验证。

落点：§5.5 的判定规则只实现一次，在 `apps/desktop/src/main/services/memory-conflict-policy.ts`（`scopesIntersect`／`validityIntersects`／`listPotentialConflictPairs`／`unresolvedConflictPairs`）。此前召回内联一份（按 `topicKey` 分桶，等价于在共同适用集合内取作用域交集），简报又内联一份并把「作用域交集」写窄成「同一规范范围」；现在两处都只接线精确修订对的裁决记录，作用域口径归一。未裁决对以 `MemoryViewItem.conflicts`（`state: 'unresolved'`）摆进治理列表：一对两条口径各自都带同一条待澄清记录，替代与并存的裁决入口因此才可达；已裁决（`keep-both`/`replace`）按裁决结果原样展示，不重复提示。用例见 `memory-conflict-policy.test.ts` 与 `memory-service.test.ts`「把未裁决的同议题口径作为待澄清冲突摆进管理列表」。

落点（任务板 §15.29 E3 与缺口 5）：「候选与已确认的冲突提示不阻塞既有 confirmed」是**结构事实**——标记只落在候选（`memory-conflict-policy.ts:127`），而召回装载集合按 `memory-repository.ts:593` 只取 `status = 'confirmed'`，候选按构造进不了 `blocked` 组，因此没有任何一条召回用例能真实驱动这半条。本轮不为它补会永远通过的假用例，人工验收时在候选行上看重复标记即可。`keep-both` 说明的 300 码点上界此前只有「正好 300 通过」的用例，越界拒绝由 §15.29 新增的协议用例（`packages/agent-protocol/src/index.test.ts:719`）补上。

### 5.6 幂等与投影

所有用户写命令带 `operationId`；已有实体另带 `expectedRevision`。相同 `operationId`＋相同请求哈希返回原提交效果和当前最新展示状态；同 ID 不同请求返回 `IDEMPOTENCY_CONFLICT`。

事务包含业务修订和回执；不跨网络持有事务。重复自动候选按 `scope`＋`normalizedHash` 抑制；与已拒绝候选相同也抑制；恢复候选后才重新进入待审列表。

落点：写时抑制在 `memory-repository.ts` 的 `findCandidateByDedupeKey`（同 `scope`＋同 `normalizedHash` 返回 `deduplicated`／`suppressed`，不产生第二条待审记录）。已确认记忆与候选之间的重复不落库、按查询派生：`MemoryViewItem.duplicatesConfirmedMemoryId` 由 `memory-service.ts` 用 `scopesMatchExactly`＋同哈希判定，只指向那条已确认记录，界面据此在候选行内提示重复后果。「所有用户写命令」也覆盖 `memory:set-settings`：`MemoryExtractionService.setSettings` 在同一事务里先 `claim`、再写设置、再 `append` 回执，因此「点了开关但响应超时」的第二次原样重发拿回的是原提交效果与当前设置行，`cancelledJobCount` 为 0（取消只发生在首次提交），换内容的同 ID 提交返回 `IDEMPOTENCY_CONFLICT`。

投影在数据库提交后重建，使用单实例串行队列、唯一临时路径及原子 rename。**不合并正在执行的重建**：每个写命令都排入属于自己的那次执行，因此它拿到 `synced` 时自己那次提交必定已落盘；每次执行在开始时同步读取最新提交，晚到的执行只会写出更新的状态，旧快照不可能覆盖新状态。（若改成「在飞时后来者共用同一个结果」，后来者会在自己的内容尚未落盘时拿到 `synced`。）该保证目前是构造性的：把链式串行改成并发执行后没有用例会变红，因为交叠窗口依赖文件系统 await 的调度时机，无法在不给服务加测试 seams 的前提下确定性地复现——取舍记录见[任务板 §15.26](tasks-memory.md)。成功回执可带 `PROJECTION_PENDING`，不能把已提交误报成保存失败。来源待复核、`candidate`、`deleted`、`superseded`、`expired` 不进入有效投影。

维护只读 manifest 标识受管投影文件；仅清理 manifest 登记的旧受管文件，不遍历删除用户资料。落点：`memory-service.test.ts`「投影重建只清理 manifest 登记的受管文件，不遍历删除用户资料」在投影目录里预埋同空间的用户文件与子目录文件，删除记忆后断言受管文件消失而两者内容原样。DB 与跨文件投影不宣称原子，投影失败可见且可本地重建；模型永远不从投影读取。

## 6. 确定性召回与历史上下文

### 6.1 召回输入及算法

Main 构造 `MemoryQueryContext`：`workspaceId`、`expertId?`、`taskId`、精确 `TaskContextRevision`、`evaluatedAt`、`prompt`、任务标题、已选材料标题、`excludedMemoryIds`。`preview` 接受草稿 prompt 但不写读取足迹；真实 Run 独立重新计算。

过滤顺序：最新修订 → confirmed/生效 → scope → 任务排除 → verified 来源可用 → 材料/记忆依赖可用 → 潜在冲突组 → 内容相关性 → 预算。

固定 `memory-recall-v1`：

1. 检索文本 NFKC、英文小写、空白归一，不修改原文哈希。
2. 中文连续汉字重叠 bigram；单汉字查询作低权字符匹配。英文数字 token 为连续字母/数字，可含内部小数点、下划线、连字符。分词为纯函数，不依赖平台词典。
3. 固定过滤词：中文 bigram 为「请帮、帮我、一下、进行、根据、这个、这次、需要、我们、任务」；英文为 a/an/the/and/or/to/of/for/in/on/is/are/please。列表改动需升算法版本并更新 fixtures。
4. 查询＝prompt（≤4,000；超限取首尾各 2,000）、任务标题≤200、按精确引用键排序的前 10 个已选材料标题（各≤120）；不读取材料正文。记录是否截取。
5. 记录检索文本＝`topicKey`＋`content`。bigram/英文数字权重 3，单汉字权重 1；`score ＝ floor(1000 × 命中 token 权重和 / 查询与记录 token 并集权重和)`。至少 2 个命中 token；查询本身只有 1 个 token 时允许 1 个。
6. 排序：`score DESC` → scope 特异性 `expert-workspace`/`workspace`/`expert`/`user` → `updatedAt DESC` → `id` 字节序 `ASC`。`confidence` 不参与排序。
7. 无命中不拿最近记录填满；无相关记忆是正常结果。

本节出现的每个数字与两份过滤词表只有一份定义：协议的 `MEMORY_RECALL_*` 常量。`memory-retrieval.ts` 的 `RECALL_BUDGET`、分词权重、命中阈值与打分基数一律取这些常量，不再写第二份字面量；`MEMORY_RECALL_VERSION` 也只由协议导出。护栏见 `standards/coding-standard.test.ts`「协议导出的阈值常量都有真实消费者」。

### 6.2 预算

- 通用偏好小池：仅 verified＋`user-instruction`＋`user`＋`preference`，最多 2 条、600 code points；按更新时间/id 稳定选择，可无内容命中。
- 总计最多 16 条、正文 6,000 code points，偏好计入总额；未用配额交还相关记忆。
- 包装/标签/适用条件另限 2,000，整体记忆块 ≤8,000 code points。
- 跳过无法完整容纳的记录后继续尝试更短记录，不先截 16 条再排除；`keep-both` 冲突裁决组按整组选择或跳过。
- 记录选择顺序、score、理由码、预算计数及排除原因统计。不可记录越权记忆正文；不把预算落选当作授权撤销。

落点：块级预算与 `keep-both` 的整组原子性由 `memory-recall-service.test.ts`「包装预算超限时整组让位，不留半条冲突口径」钉住——8 组冲突占满 16 条上限、每组适用条件用满 300 码点，能撑破的只有 2,000 的包装项；§6.1 的 `source-unavailable` 分支由同文件「人工来源被移除后，残留修订不再注入且排除账本只记身份」钉住。两条都做过变异验证（把对应判断短路后各自变红，其余用例不受影响），取证见[任务板 §15.23](tasks-memory.md)。

### 6.3 安全历史重放

对所有新 Run 统一处理，包括旧通用入口。已有 TaskContext 的任务必须提交并匹配最新修订；真正没有上下文的任务由 Main 生成明确 `general`＋空材料上下文，不代表全 Workspace/全知识库可读。

候选历史只取同 Task、`completed`、`createdAt` 早于当前 Run、`completedAt` 不晚于当前准备时点的运行。取按事件 sequence 最后的非工具最终 `message.completed`；不重放 reasoning、工具调用或别的任务。若不能确认最终回答，跳过并记录原因。

安全性检查使用**直接＋传递依赖**：历史实际记忆修订、重放继承记忆、历史已选/实际读取材料的保守并集。旧记录缺依赖事实则不推断安全。

以下情况使依赖历史不可重放：记忆被删除/排除/替代/过期/改修订/缩 scope、来源不可用、依赖材料移除/换版本/哈希不符；相关记忆本次无命中或预算落选不使历史失效。纯增加材料也不应无故截断。

从最近历史向前选连续安全后缀，遇首个不安全轮次停止，不跨过它拼接更早对话。上限 8 个完整问答对、12,000 code points；容不下完整一对就停止。记录实际重放 `runId`/`finalEventId`/`promptHash` 及依赖；不让更近回答隐藏它继承的已撤销信息。落点：`run-history-policy.ts` 的 `HISTORY_LIMITS` 逐项取协议常量 `MEMORY_REPLAY_PAIR_LIMIT`／`MEMORY_REPLAY_CODE_POINT_BUDGET`，服务层不再自写 8 与 12,000；边界用例见 `run-history-policy.test.ts`「caps at eight complete pairs」与「stops instead of truncating a pair to fit the code point budget」。

`contextSegmentId` 保留为展示分段，不作为唯一授权闸门。历史 UI 保留，模型请求不带不安全历史；没有模型二次摘要绕回被删除内容。理由码：`memory-revised`、`memory-excluded`、`memory-inactive`、`source-unavailable`、`material-removed-or-replaced`、`legacy-provenance-unknown`、`history-budget`。

### 6.4 运行准备和请求阶段

异步准备不跨 await 持有事务；写入快照前在同步事务重验 TaskContext 最新修订及相关记忆版本，期间变更则返回可操作的上下文冲突。外部来源检查完成后仍须按现有工具边界在实际读取时核验，不能由记忆授予权限。

运行记录阶段：`selected` → `request-prepared` → `dispatch-attempted`，阶段时间单调；旧记录 `legacy_unknown`。

Main 的 Provider 包装器在首个实际 `ModelRequest` 装配后计算规范化 `requestHash`，核对记忆块修订，持久化 `request-prepared`；开始消费委托 Provider 前持久化 `dispatch-attempted`。任何阶段持久化失败均不发起该次请求，主 Run 按现有失败机制收口。落点：`services/memory-dispatch-gate.ts` 的 `withRunMemoryAudit` 先在首个 `ModelRequest` 上核对记忆块，再依次写两阶段；`assertMemoryBlockMatches` 要求请求中带 `MEMORY_BLOCK_HEADER` 的系统消息与已落库的同一份正文完全相同，`memoryBlock` 为空串表示本次不注入，此时出现任何记忆块也算不符并抛 `MemoryBlockMismatchError`。`modelRequestHash` 只指纹 `messages`、`tools`、`maxOutputTokens`，signal 与凭据不进指纹。用例见 `memory-dispatch-gate.test.ts`。

不保存完整请求副本、不记录密钥、不把调用尝试当作网络已成功。后续工具回合继续使用固定记忆，无需新建逐回合记忆日志。普通记忆编辑/删除只影响新 Run；活跃 Run 如需刷新，由用户取消并重跑。现有材料/工具撤销机制不因本设计放松。

## 7. 模型提炼作业

### 7.1 模型与 Provider

从 `RunService` 提取 Main 内共享 `model-provider-factory.ts`，复用 model profiles、默认模型解析和 credential-access；Agent Core 不导入数据库。普通 Run 兼容行为保持，提炼使用 `requireConfiguredLanguageModel` 模式，禁止生产 FakeProvider 回退。

在新 Run 审计中保存实际解析的 `modelProfileId` 和非敏感配置指纹；提炼沿用来源 Run 的模型。无 Run 的讨论反馈使用当前 TaskContext 的模型。配置不可用/指纹变化则 `skipped`，不暗换另一服务；手动重试需展示当前模型并重新同意。配置指纹不含凭据；历史摘要只存清除 query、userinfo 的 endpoint 展示值，不存 URL token。
落点（任务板 §15.30）：「无 Run 的讨论反馈使用当前 TaskContext 的模型」此前**没有实现**——`extraction-source-reader.ts` 对没有 `runId` 的检查点只回 `modelProfileId: undefined`，于是提炼走 `model-provider-factory.ts:143` 的应用级默认模型。本轮补上取法：`taskContexts.getLatest(taskId).modelReference` 优先，缺省再退到该上下文执行专家修订的 `modelReference`（与 RunService 解析运行模型的同一口径，`run-service.ts:1527`），两处都不是 `profile` 模式才交给应用级默认；只回传 profile id 而不另存引用，是因为「专家说用应用级默认」与「没有专家」在解析结果上是同一个模型，多存一份反而造出第二套口径。用例见 `work-centered-memory.integration.test.ts`「没有来源 Run 的讨论反馈用当前 TaskContext 钉住的模型，不暗换应用级默认」：把该 profile 停用后同一来源必须可见地拒绝（`MODEL_UNAVAILABLE`、零作业登记），而应用级默认模型此刻仍然可用——回落就等于把同一段反馈送给另一个服务。

`ModelRequest` 增加可选 `maxOutputTokens`；实际发包为 `min(请求上限, profile上限)`，未设置请求上限时维持现状。done chunk 增加可选 `finishReason`（`stop`/`length`/`tool-calls`/`content-filter`/`unknown`）及可选 `usage`；普通消费者兼容，提炼仅接受 `stop`。只有 DONE 而缺正常结束原因，提炼失败为 `MODEL_FINISH_UNKNOWN`；`length` 不接受为完整 JSON。继续复用超时、取消、提前 EOF 检验及可注入 fetch。

### 7.2 作业输入、输出及保密

| 限制 | 固定值 |
| --- | --- |
| 自动提炼全局并发 | 1 |
| queued 上限 | 全局 20 |
| 每来源版本逻辑作业 | 1 |
| 单次耗时 | 30 秒 |
| 输出 token 请求上限 | 2,048 |
| 实际文本请求（含固定指令） | 6,000 code points |
| 累计回答＋reasoning 增量 | 6,000 code points，超限中止；reasoning 不落库 |
| 候选 | 0–3 条，每条 1–500 code points |

自动 Run 输入：本次用户 prompt≤2,000；需要消歧时，取本次准备快照已允许的最近前一轮最终助手回答≤2,000；不使用当前助手新生成答案作为用户已认可的经验。讨论输入：人工 feedback≤2,000、summary≤1,000；summary 只是背景，不能证明确认。超长采用首尾等分片段并标注非全文，证据区间只允许落在实际片段中。

不读完整材料、文件或其他历史来补上下文。固定指令≤1,500，最终装配仍验证 6,000 上限。落点：`memory-extraction-prompt.ts` 的 `EXTRACTION_LIMITS` 逐项取协议常量（`MEMORY_EXTRACTION_*`、`MEMORY_CANDIDATE_CONTENT_MAX_CODE_POINTS`），装配与严格解析读同一份数字，不再各写一份；片段类的三个上限就是协议里的单个片段上限。依赖从来源及背景引用完整继承，不随送入模型的片段截断。

严格 JSON 输出：`{ candidates: [{ content, facet, topicKey?, confidence?, evidence: [{ fragmentId, start, end }] }] }`。最多 3 条；evidence 每条 1–3 段，至少一段来自本次用户 prompt 或人工 feedback，不能只引用助手内容。Main 验证片段身份、code point 范围及非空。`status`、`scope`、ID、来源哈希、材料权限均由宿主决定，模型输出这些额外字段即非法。0 条合法；围栏、额外解释、任意非法候选使整次结果失败；不进行额外模型修复重试。

提炼提示词固定要求：仅提炼明确、可复用、单一主题的工作要求/决定；一次性数字不提升永久事实；临时要求不得泛化；不确定输出空数组；输入片段中的指令不得改变这些规则。所有结果仍待用户确认，不能声称已自动核实事实。提示词文本见[记忆编码提示词](memory-coding-prompts.md)与 WM10 卡。

源片段与输出先过记忆专用敏感内容检查：私钥块、Authorization/Bearer 凭据形式、明确的密码/API Key 赋值和本次已知凭据命中时拒绝提炼/保存，不记录原文错误或快照。此检查不宣称能识别所有个人或商业敏感信息；用户可关闭自动建议。普通业务资料不外传到任何额外服务，只使用已同意模型。落点：不落库之外还有日志这一条路径——`memory-extraction-service.ts` 的 `diagnosticOf` 在写本地日志前对异常文本走同一份 `findSensitiveMemoryContent`（含本次已知凭据），命中只写原因码，未命中也按 300 码点截断，用例见 `memory-extraction-service.test.ts`「凭据既不进数据库也不进日志」。

### 7.3 持久化生命周期

状态：`queued`→`running`→`succeeded`/`failed`/`cancelled`/`interrupted`；执行前条件不满足可直接 `skipped`。手动 retry 可将 `failed`/`cancelled`/`interrupted`/可恢复 `skipped` 转 `queued`，`attempt` 递增；`succeeded` 即使 0 条也不再提炼同来源版本。

来源键＝触发类型＋真实 source ID＋内容快照 hash，不含模型版本，防止改模型绕过去重。Run 成功提交和作业登记、人工 feedback 提交和作业登记尽量在同应用库事务完成；无网络在事务内。排队失败不能把已成功主 Run 改失败；记录安全诊断，下次不自动扫描补单。

落点（见[任务板 §15.27](tasks-memory.md)）：安全诊断只由 `run-service.ts` 的 `requestRunExtraction` 写一条含原因码的本地日志——`!ok` 与 `ok ＋ status:'not-enqueued' ＋ reason` **两条路都要写**，因为队列满、模型不可用、依赖超限这些原因返回的是正常结论而非错误，只盯 `!ok` 会让这条契约静默失效（本轮实测到的缺陷）；「自动建议本就关闭」不带原因码，保持静默以免每次 Run 刷屏。「不自动扫描补单」是结构事实：服务里没有 `scan`／`backfill`／`requeue` 一类路径，作业只能由 `requestExtraction*` 显式登记。同事务那半句的实测落点是**不共用事务**：登记前必须先 `await` 解析模型快照与凭据，而来源提交在终态发布时已落定，把异步解析塞进 Run 事务会违反「事务内不得有网络／不得悬挂」，两步之间由「排队失败不影响主 Run」兜底；这是否算偏离原设计由光哥拍板，本节只记录落点、不改「尽量」那句本身。

启动时将遗留 `queued`/`running` 收口 `interrupted`，不自动触网。关闭设置取消本空间自动作业；单次手动重试有独立同意，不暗开全局开关。取消后先落库终态再中止请求；成功落候选前检查 job revision/attempt/status、来源有效性、自动模式 `consentRevision`。迟到结果不能落库。同意版本也只有一个定义：协议 `MEMORY_SUGGESTION_CONSENT_VERSION`，主进程门槛（`memory-extraction-service.ts`）与界面文案（`renderer/src/lib/memory-suggestions.ts`）都导入它；此前两处各自写死 `1`，改版本会静默分裂成「界面说 v1、门槛拒 v2」。

候选写入、去重统计、作业成功终态在同事务提交。失败只保存安全错误码与摘要；主任务终态不受影响。落点（更正任务板 §15.27 里的初判，完整判定见 §15.28）：摘要这一半是**有声明、有消费者、零生产者**——协议 `memoryJobSummarySchema` 声明了 `diagnostic?`（`packages/agent-protocol/src/index.ts:1916`），界面失败文案确实优先读它再退回错误码（`renderer/src/lib/memory-suggestions.ts:60`，用例见 `memory-suggestions.test.ts:92/96`），但库里没有任何对应列，仓储终态写入只落 `error_code`（`memory-extraction-repository.ts:596-619`），`toSummary` 也从不填 `diagnostic`（`:210-226`）。因此界面上「一段安全的失败摘要」永远不会出现，用户只看到错误码。出路有两条且互斥：补列＋迁移＋脱敏写入，或收窄契约与协议、删掉界面的这条分支；取舍归光哥，本轮不自行加列也不删契约条目。UI 主动刷新和窗口重获焦点查询状态；仅面板可见且有活动作业时按 1 秒轮询，隐藏即停并清理，无自造成功提示计时器。落点：轮询与重获焦点的重查都在 `renderer/src/hooks/use-memory-suggestions.ts`——`window` 的 `focus` 监听补发一次全量查询（设置、作业、候选），面板不可见或已卸载即摘除监听；用例见 `use-memory-suggestions.test.ts`。

## 8. 持久化与迁移清单

### 8.1 既有表增量

字段以 camelCase↔snake_case 一一映射；JSON 列后缀 `_json` 且用版本化 Zod 验证，NULL 映射省略。所有新时间/枚举/数量校验在共享 Schema 和领域层一致。

| 表 | 新增字段 |
| --- | --- |
| memory_records | facet、topic_key?、normalized_hash、provenance_json、candidate_disposition?、replaces_revision_id? |
| run_memory_reads | selected_for_injection、replayed_via_run_ids_json、provenance_state（known/legacy_unknown） |

`run_memory_reads` 继续以 `runId`＋`memoryRevisionId` 唯一；直接注入和历史继承可同时成立。`MemoryRecord` 稳定 `id` 在修订表不唯一，不得建立指向 `id` 的错误单列外键；精确引用指向 `revision_id`。

### 8.2 新增六张内聚表

| 表 | 字段与约束 |
| --- | --- |
| memory_operations | operation_id PK、operation_kind、request_hash、result_json、committed_at。回执保存提交实体/修订/确认动作/来源声明，不复制全文。仅记录成功事务；错误重试不伪装成功。 |
| memory_conflict_decisions | id PK、operation_id UNIQUE、left_revision_id、right_revision_id、decision（keep-both/replace）、winner_revision_id?、applicability_note?、created_at；左右规范排序，绑定精确修订。 |
| run_memory_contexts | run_id PK、schema_version、phase、recall_version、evaluated_at、query_hash、policy_snapshot_json、selected_items_json、replay_json、material_dependency_union_json、memory_dependency_union_json、decision_summary_json、authorization_hash、model_snapshot_json?、request_hash?、selected_at、request_prepared_at?、dispatch_attempted_at?、updated_at。 |
| workspace_memory_settings | workspace_id PK、revision、auto_suggest_enabled 默认 0、consent_version?、consented_at?、updated_at；无行视为 revision0/off。 |
| memory_extraction_jobs | id PK、source_key UNIQUE、workspace_id、task_id、run_id?、checkpoint_id?、source_snapshot_json、source_version_hash、material_dependencies_json、memory_dependencies_json、model_profile_id?、model_snapshot_json?、trigger（automatic/manual-retry）、consent_revision?、status、revision、attempt、input_code_points、output_code_points、usage_json?、result_json?、error_code?、created_at、updated_at、started_at?、finished_at?。 |
| workspace_artifact_references | id PK、workspace_id、artifact_version_id、content_hash、label?、status（active/removed）、revision、selected_at、updated_at；workspace_id＋artifact_version_id UNIQUE，同空间 active≤20。 |

`run_memory_contexts` 中：`selectedItems`＝memoryId/revisionId/hash/order/score/reason；`replay`＝runId/finalEventId/promptHash 和边界理由；`decisionSummary`＝各原因计数和合法范围内最多 50 个身份/原因，不复制被排除正文；`policySnapshot` 保存算法版本及全部预算；依赖 union 保存精确引用，不得只存摘要文本。「最多 50 个身份」只有一个数字：`memory-recall-service.ts` 直接 `slice(0, MEMORY_DECISION_SUMMARY_IDENTITY_LIMIT)`，与协议里 `memoryDecisionSummary` 的 `.max(...)` 读同一常量。

索引：memory 最新修订及 scope 保留，补 scope＋normalized_hash、topic_key；job(status,created_at)；reference(workspace_id,status,selected_at)；精确修订/Run 外键查询索引。

### 8.3 外键和删除边界

Run 审计子表随 Run `CASCADE`；被历史引用的记忆修订及冲突裁决使用 `RESTRICT`，保留解释能力。多态/跨知识库来源使用结构化引用＋Main 校验，不声称 SQLite 能做跨库原子外键。

Workspace/Expert 常规移除不得绕过已有历史引用约束；若现有删除入口会物理级联，WM02 在其删除边界加引用预检并返回可操作阻止信息，不能静默级联清除历史或关闭外键。本期不新增彻底擦除 Workspace 历史的流程。测试必须覆盖跨空间引用造成的父对象删除约束，并保留原有无引用对象删除行为。

### 8.4 迁移批次与兼容

不改旧迁移。各批在开工时使用最新连续版本号：WM02 治理字段/operations/conflicts；WM05 运行依赖与阶段表；WM09 设置/jobs；WM12 参考标记。**不要预填固定 v26–v29 而与并行 CF 系列争号**（归档基线实测应用库最新为 v25）。

Legacy：保留原 `id`、`revision`、`status`、`contentHash`；facet 仅按 kind 机械映射，来源标 `legacy-unverified`。历史 `confirmed` 显示「已确认，来源待复核」，不自动注入新 Run；用户补来源生成新修订或重新提交自主口径。旧 reads 仅标 `legacy_unknown`，不回填发送时间、请求 hash 或伪造确认人。

WM02 先扩展仓储形状，公开旧调用方切换在 WM03 一起完成；来源新门禁从 WM03 启用，同时提供复核入口，不能先全禁用再让用户等下一卡。

每批真实 SQLite 验证：新库、历史数据升级、重新启动幂等、故障回滚、索引重建、完整 `foreign_key_check`。失败不能降级到内存记忆、跳迁移或继续半初始化。Markdown 投影可重建，不改用户源文件。

## 9. IPC、DTO 与错误契约

### 9.1 统一结果与最小公共对象

仅记忆/简报/参考新增家族使用 `Result<T>`：成功 `{ok:true,data:T,warnings:Warning[]}`；领域失败 `{ok:false,error:{code,message,retryable,currentRevision?}}`。不迁移全仓其他 IPC。

- **WriteReceipt**：`operationId`、`commit:'committed'`、`effect`(created/updated/unchanged/deduplicated/suppressed)、`committedRevisionIds`、`currentMemory?`、`projectionState`(synced/pending/failed)。设置/参考写回执另包含相应 `currentSettings`/`currentReference`，不能返回不受约束任意 `data`。
- **MemoryViewItem**：`MemoryRecord`＋`effectiveStatus`＋`sourceAvailability`(available/unavailable/review-required)＋`requiresMaterialSelection`＋`conflicts`（精确修订对与状态，含未裁决的 `unresolved`）＋`duplicatesConfirmedMemoryId?`（§5.6 的查询派生重复指针，不落库）。
- **ListPage**：`items`、`nextCursor?`；cursor 为 `updatedAt`＋`id` 的版本化结构，`limit` 默认 50，上限 100；created/modified 排序定义在对应响应，非任意 SQL 游标。
默认值与上限只认协议常量 `LIST_PAGE_DEFAULT_LIMIT`／`LIST_PAGE_MAX_LIMIT`：请求 Schema 卡上限，`MemoryRepository.listPage` 取默认值，存储层不再写死数字（回归用例见 `memory-repository.test.ts`「uses the protocol page-size constant as the default limit」）。
- `Scope` 从现有判别联合复用；`Facet` 与 `kind` 由宿主映射，客户端不能提交矛盾组合。
- **EditPatch** 允许 `content`/`facet`/`topicKey`/`scope`/日期 patch；`topicKey` 清空同样用 `clear`。来源不作为任意可编辑 JSON，单独经 verified 选择器或人工重新表述构造。

### 9.2 通道与参数

| 通道 | 输入 | 成功 data |
| --- | --- | --- |
| memory:list | workspaceId?/expertId?、statuses?、includeCandidates 默认 true、cursor?、limit? | ListPage\<MemoryViewItem\>；全局管理可无过滤，Run 召回不复用此权限宽查询 |
| memory:get | id、revisionId? | MemoryViewItem，精确旧修订标历史不可直接编辑 |
| memory:create | operationId、content、facet、scope、topicKey?、validFrom?/validUntil?、sourceSelector?、asUserInstruction:boolean、genericDeclaration?、fromMemoryRevisionId? | WriteReceipt；`fromMemoryRevisionId` 只在「作为我的工作口径重新保存」出现，必须指向真实修订 |
| memory:update | operationId、id、expectedRevision、patch、legacySourceReview? | WriteReceipt；legacy 复核须完整选择器/人工声明 |
| memory:set-status | operationId、id、expectedRevision、action、confirmPatch? | WriteReceipt；confirmPatch 只在 confirm/reconfirm 合法 |
| memory:resolve-conflict | operationId、left:{id,expectedRevision}、right:{id,expectedRevision}、decision、winnerId?、applicabilityNote? | WriteReceipt＋ConflictDecision；replace 必填 winner，keep-both 必填说明 |
| memory:preview | taskId、taskContextRevisionId、expectedTaskContextRevision、prompt | selectedItems、预算、排除原因摘要、evaluatedAt；不落运行读取 |
| memory:run-context | runId | phase、精确 MemoryViewItem/引用、选择理由、预算、replay 摘要、各阶段时间 |
| memory:get-settings | workspaceId | WorkspaceMemorySettings |
| memory:set-settings | operationId、workspaceId、expectedRevision、autoSuggestEnabled、consentVersion? | 设置回执＋cancelledJobCount；开启必须当前 consentVersion |
| memory:list-jobs | workspaceId、taskId?、cursor?、limit 默认 20/最大 50 | 脱敏 JobSummary 列表；不返回原始模型输入/错误 |
| memory:retry-job | operationId、jobId、expectedRevision、consentVersion | JobSummary；单次同意，不修改自动开关 |
| memory:cancel-job | operationId、jobId、expectedRevision | JobSummary |
| memory:rebuild-projection | operationId | projectionState，纯本地重建 |
| workspace:memory-brief | workspaceId、expertId? | WorkspaceBrief |
| workspace:list-reference-versions | workspaceId | active 参考标记及版本可用性 |
| workspace:set-reference-version | operationId、workspaceId、artifactVersionId、expectedRevision（新建 0）、label? | ReferenceReceipt＋既有 MaterialReference |
| workspace:remove-reference-version | operationId、id、expectedRevision | ReferenceReceipt |

`sourceSelector` 联合：`run-user(runId,start,end)`、`run-assistant(runId,eventId,start,end)`、`checkpoint(checkpointId,field:feedback/summary,start,end)`、`artifact-version(artifactVersionId,locator,selectedText)`。成果 `selectedText` 必须由当前已可读取的受管版本验证，不能接受任意伪造摘录；格式无法精确验证时只允许用户独立 `manual` 表单，不承诺自动文本定位。

`JobSummary` 字段：id/workspaceId/taskId/status/revision/attempt/trigger/模型展示名?/候选数/错误码?/安全说明?/createdAt/updatedAt，不含密钥或源片段正文。

旧 `memory:list`/`memory:create`/`memory:update`/`memory:set-status` 四通道（现有 `IpcChannel` 实名）在 WM03 同卡升级共享 Schema、Main、Preload、hooks、App 和测试；不保留能绕过来源确认的旧写后门。新增通道只随对应卡提供真实实现，不发布空占位 API。

### 9.3 错误、警告和边界

错误码固定分组：

- **身份/并发**：`NOT_FOUND`、`REVISION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`CONTEXT_REVISION_REQUIRED`。
- **治理**：`INVALID_TRANSITION`、`TERMINAL_MEMORY`、`INVALID_VALIDITY`、`CONFLICT_REVIEW_REQUIRED`。
- **范围/来源**：`SCOPE_MISMATCH`、`GLOBAL_SCOPE_REQUIRES_DECLARATION`、`WORKSPACE_FACT_CANNOT_BE_GLOBAL`、`SOURCE_UNAVAILABLE`、`SOURCE_MISMATCH`、`SOURCE_REVIEW_REQUIRED`、`SOURCE_DEPENDENCY_LIMIT`、`SOURCE_DEPENDENCY_CYCLE`、`MATERIAL_NOT_ALLOWED`、`MATERIAL_HASH_MISMATCH`、`SENSITIVE_CONTENT`。
- **模型/作业**：`MODEL_UNAVAILABLE`、`MODEL_PROFILE_CHANGED`、`CREDENTIAL_UNAVAILABLE`、`CONSENT_REQUIRED`、`QUEUE_FULL`、`JOB_STATE_CONFLICT`、`INPUT_LIMIT`、`OUTPUT_LIMIT`、`TIMEOUT`、`CANCELLED`、`INTERRUPTED`、`INVALID_MODEL_OUTPUT`、`MODEL_OUTPUT_TRUNCATED`、`MODEL_TOOL_CALL_REJECTED`、`MODEL_FINISH_UNKNOWN`、`MODEL_REQUEST_FAILED`。
- **参考/存储**：`REFERENCE_WORKSPACE_MISMATCH`、`REFERENCE_LIMIT`、`REFERENCE_UNAVAILABLE`、`HISTORY_REFERENCE_BLOCKS_DELETE`、`STORAGE_ERROR`、`INTERNAL_ERROR`。

落点：`MATERIAL_NOT_ALLOWED` 与 `MATERIAL_HASH_MISMATCH` 目前没有任何生产者，两条语义由别的词汇承担——召回阶段「材料未在本任务允许集合内或实体已不可读」记为排除原因 `dependency-unavailable`（`memory-recall-service.ts` 的 `dependencyAvailable`），写入阶段「登记摘录与来源正文不一致」返回 `SOURCE_MISMATCH`（`memory-provenance.ts`）。本期不新增失败路径去凑这两个码，也不从清单里删，等光哥判定是拆成独立错误码还是把清单收敛到实际词汇。

成功警告：`PROJECTION_PENDING`、`SOURCE_NEEDS_REVIEW`、`HISTORY_TRUNCATED`。错误 `message` 使用可操作中文，不带完整内容、URL 凭据或提供商原始响应。

输入/输出 Zod 错误继续由已有注册 helper 拒绝；transport 拒绝由 Hook 统一映射 `IPC_FAILURE`，不解析 Electron 异常字符串来猜业务错误码。领域错误通过 `Result` 明确返回。投影失败是已提交成功＋警告，不是领域写失败。落点：`renderer/src/lib/memory-result.ts` 导出 `IPC_FAILURE_CODE` 作为该映射的唯一来源，`IPC_FAILURE` 不是领域错误码，`memoryErrorCodeSchema` 必须继续拒绝它（用例见 `packages/agent-protocol/src/index.test.ts`）；界面侧收口的三条路径——transport 拒绝、领域失败原样透出、成功保留 `warnings`——见 `memory-result.test.ts`。

## 10. 简报和成果引用精确规则

`WorkspaceBrief` 字段：workspaceId、expertId?、generatedAt、goals、constraints、decisions、methods、openIssues、referenceVersions 及每区 total/truncated。确认区每区最多 10 条，`updatedAt DESC`/`id ASC`；只纳入当前有效、verified、来源仍可用的 `confirmed`。workspace 视角只取 workspace 记录，选专家再加相应 expert-workspace；不把 user 偏好混成项目事实。

每个记忆条目返回 memoryId/revisionId/hash/content/scope/sourceAvailability/requiresMaterialSelection。资料派生内容可在同空间管理简报中显示，但注明使用时仍需材料，不因此获得模型授权。

`openIssues` 取本空间 Task 的 open checkpoint 最近 10 项，保留 summary/feedback/nextAction 原有标识；开放不等于「已确认未解决所有问题」，不做 LLM 状态推断。参考区取最新 5 个 active 标记，`selectedAt DESC`/`id ASC`；可进入全部参考列表。

源失效、过期和候选不进入确认区；重复/冲突待处理计数作为管理提示。空态不自动补内容，查询失败显示可重试错误，不显示伪造旧简报。

落点：「重复/冲突待处理计数」落在记忆治理页（`MemoryView.tsx` 的 `.memory-pending-governance` 提示带，只报「几组口径待澄清 · 几条候选与已确认记忆重复」并指明去对应分组裁决），不新增 `WorkspaceBrief` 字段——本节的简报字段清单是封闭的，计数也不是「现有事实的只读投影」。简报侧继续只做「未裁决冲突组整组不进确认区」，不在此处替用户裁决。

引用流程：选精确版本 → Main 验证归属及哈希 → 现有 `MaterialReference` → 加入 TaskContext，默认 purpose 为 `historical-comparison`，用户可改 `structure-reference` 等已有用途 → 后续 Run 按既有工具读取 → 实际读取后关联本期成果。WM00 已核对 `materialPurposeSchema` 的实际枚举字符串为 `rule`、`current-input`、`historical-comparison`、`structure-reference`、`template`、`background`、`other`（见 `packages/agent-protocol/src/index.ts`），本契约按该实名机械对齐，不新增同义枚举。标记参考或显示简报不算读取 Evidence。

## 11. MI 改进契约（Proposed）

日期：2026-09-25。对应[改进 Spec](../designs/memory-improvements.md)、[ADR-0028](../adr/0028-memory-reliability-improvements.md)与 [MI00–MI10](tasks-memory-improvements.md)。**D1–D5 推荐方案已批准，本节尚未实施**；技术契约及 ADR 正式状态保持 Proposed。§5–§10 保留现行基线，只有获得对应卡实施授权后才按下列增量修改，不把设计批准回写成已实现事实。字段与数字以本节为唯一新定义，其他文档只链接。

### 11.1 来源闭环（MI01/MI02）

不新增 sourceSelector 种类。`run-assistant` 继续提交 `runId/eventId/start/end`，且 `asUserInstruction=false`。新增拒绝组合校验：任何 `sourceSelector` 与 `asUserInstruction=true` 同时出现均非法；显式自主重述仍只携带 `fromMemoryRevisionId`，不携带 selector。

Main 必须依次验证：

1. 来源实体真实存在；来源 Run 为 completed；eventId 属于该 Run 按 sequence 最后的、非工具调用的最终 message.completed。不能拿 run.completed 的事件 ID 代替。核对该消息对应的工具调用事实，不能仅按事件类型猜最终回答。
2. 来源真实 workspaceId 与提交的 workspace/expert-workspace 一致；derived 不允许 user/expert 全局。originWorkspaceId 从登记关系生成，不信任客户端范围暗示。
3. `[start,end)` 是**原始事件正文**的 code point 区间，摘录为 1–500，不能为空、越界或拆 UTF-16 代理对；超过上限返回 `SOURCE_MISMATCH`，不等到构造输出 Zod 时抛内部错误。最终记忆正文沿用人工 1–2,000 上限，可与摘录不同，依赖不随编辑缩减。
4. 来源运行的准备快照与记忆审计记录齐全；以记录是否存在和完整性判断，不以数组为空判断缺记录。合法空依赖允许；缺记录返回 `SOURCE_REVIEW_REQUIRED`，不 `?? []`。
5. 依赖取来源 Run 已选材料、实际读取材料、重放继承材料的保守并集，以及直接/继承记忆的精确修订并集；按精确引用键去重，递归展开记忆来源，拒绝循环、缺修订/哈希不符和超限。继续使用 §5.3 的材料 200、记忆 100 上限，不能静默截断。当前不再有效的依赖返回 `SOURCE_REVIEW_REQUIRED`；超限/循环使用已有专用错误码。
6. 检查与写入在现有应用事务边界内重验相关修订；异步读取不跨 await 持有事务。外部可用性在使用时仍重验，不宣称跨库或文件系统事务原子。

`ResolvedMemorySource` 增加内部 `memoryDependencies`，`provenanceFromResolved` 使用解析结果而不是字面空数组；既有 provenance schemaVersion=1 已支持该字段，不升级来源版本。优先复用 `runMemoryContexts.get/listDependencyUnion`、RunContextSnapshot、现有材料读取与记忆依赖展开；不能直接复用 extraction-source-reader 的空数组回退作为安全证明。

同一手工解析器各来源的依赖规则：

| 来源 | 规则 |
| --- | --- |
| manual / run-user | 保持既有自主口径规则；run-user 必须可追到真实空间，不借来源选择器绕过全局通用声明 |
| run-assistant | 按上方完整检查；已有但失效的依赖不自动擦除 |
| checkpoint | 有来源 Run 时继承其完整依赖，并联合节点明确引用的材料；无 Run 时只能在节点来源事实足以证明完整依赖时保存，否则 `SOURCE_REVIEW_REQUIRED`，不推断 summary 是自主要求 |
| artifact-version | 纳入该精确 ArtifactVersion 本身的材料引用，并继承该版本已登记的输入/来源关系；AI 版本核验所属 Run，user-edit 沿前版登记关系继承，检测版本链循环。无法证明完整性或不可精确读取时拒绝，不把人工编辑版本当空依赖 |

本期只新增回答捕获 UI，其他来源只补共用服务安全门禁；依赖实体字段以现有 material-contracts 和 ArtifactVersion 登记关系为准。不能证明时采用上表的明确拒绝，不发明外部证据实体或新的成果写入系统。

Renderer 选择：仅接受当前回答容器内单段选区；原始正文唯一精确命中时按前缀 code points 计算索引。否则显示只读原文 textarea 供选择，使用 selectionStart/selectionEnd 对应前缀转换 code point 索引，并拒绝半代理对边界。重复文本用原文区间定位，不使用第一次 indexOf 猜测；trim 后必须同步重算区间，不 `.slice()` 静默截长。表单分别持有 selector 与可编辑正文；选区未确认则提交禁用。没有 selector 不得从捕获入口调用 create。

不迁移旧 manual 为 derived，不扫描相似文本追源。历史纠错由用户逐条保留正确新来源、删除错误旧条，再验证下次请求。

### 11.2 独立任务排除投影（MI03）

新增通道 `memory:task-exclusions`（IpcChannel 新成员），请求为 `{taskId,taskContextRevisionId,expectedTaskContextRevision}`；复用 preview 的上下文身份校验但**不要求 prompt**。响应 `Result<{taskId,taskContextRevisionId,taskContextRevision,items:TaskMemoryExclusionItem[]}>`。

`TaskMemoryExclusionItem` 为 strict 判别联合：

- `{visibility:'visible',memoryId,revisionId,content,scope,effectiveStatus}`：仅当前 workspace/expert 可管理范围内的记录，字段复用既有类型；记录过期/删除仍可解释，恢复只解除排除。
- `{visibility:'unavailable',memoryId}`：不在当前范围、不存在或不可查看统一返回此分支，不返回 revision/title/content/source，不区分是否存在。

列表从最新 TaskContext 的 excludedMemoryIds 读取，保留其顺序、按 ID 去重；最多 100 项，抽出/复用同一共享阈值供 TaskContext、查询与保存 Schema 使用。不从 decisionSummary 的 50 项账本截取，不扫描并返回其他空间身份。响应仅包含该任务已登记 ID。列表查询不写读取足迹或 Run 快照。

写入仍用现有 `SaveTaskContextRequest`，保留 executor、skills、materials、MCP、modelReference、builtinToolPolicy 等全部上下文；只改变目标 excludedMemoryIds，带最新 expectedRevision。该 API 现有 CAS 机制保持，**本卡不套用 memory operationId，也不新建第二套任务写协议**。响应不明先重查当前上下文，确认目标是否已达成，再由用户重试；不盲重发反向 toggle。

Hook 按 taskId＋contextRevision＋请求序号防过期响应。切任务/卸载丢弃 UI 结果但不撤销已提交保存；同任务串行写入。REVISION_CONFLICT 不自动覆盖或静默合并其他编辑。预览与排除查询独立错误状态；恢复后重算只更新「下次运行」，不修改当前 Run。

### 11.3 显式策略与持久化（MI04/MI05/MI06）

`MemoryRecord.recallPolicy: 'relevant'|'pinned'`；应用表 `memory_records.recall_policy TEXT NOT NULL DEFAULT 'relevant'`，CHECK 枚举。这是修订字段，不是新 scope/status/authority；不参与正文 contentHash/normalizedHash，但包含在操作请求哈希与变更检测中。写新修订、状态变化时明确继承，不由默认值悄悄清掉。

- 既有全部修订机械填 relevant，不改变 revisionId、revision、正文/hash、来源、状态或操作回执；自动候选及所有 create 初始 relevant，模型输出不允许此字段。
- MI04 只完成字段映射、默认持久化和迁移；MI05 同时开放 update.patch.recallPolicy 与实际召回。不要先发布可设置 pinned 却不生效的公共接口。
- 设置 pinned 仅允许 confirmed＋当前有效＋verified/user-instruction＋来源可用＋空材料/记忆依赖，facet 限 goal/constraint/decision/method/preference。派生事实、经验、candidate、legacy 不允许；复用 `INVALID_TRANSITION` 并给中文原因，不新增重复错误码。
- 已 pinned 记录被编辑成不符合这些条件的记录时拒绝，要求先显式取消优先；expire/delete/supersede 允许并保留策略值作历史事实，但不再入选。恢复确认仍重验资格。
- 调整使用 `memory:update` 的 operationId/expectedRevision；追加修订；同值返回 unchanged。确认、替代不继承另一 memoryId 的 pinned 标记；新替代记忆按自己的显式策略，不能自动置优先。
- 不设新硬性「每空间多少条」上限；受运行预算约束，避免多窗口配额事务。UI 可显示本次实际可用和落选，不承诺全部必带。
- 迁移使用开工时下一连续版本，绝不修改历史迁移或预占 v33。真实 SQLite 覆盖空库、旧数据、重启幂等、CHECK 非法值、故障回滚及 foreign_key_check。
- 旧 memory_operations.result_json 可能内嵌旧 MemoryRecord：只在读取旧持久化 DTO 的版本适配点补 relevant，严格公网/IPC写入不加兼容后门；旧请求 requestHash 不重算，同 operationId 原样重放仍命中原回执。Markdown 投影只是可重建展示，可显示策略但不能变成模型读取入口。

### 11.4 memory-recall-v2（MI05）

新版 `recallVersion='memory-recall-v2'`、`algorithmVersion=2`，**仅选择策略升级，词法分词/打分仍按 §6.1**。每个新阈值只在共享协议定义，并有生产消费者；本卡与使用侧同交付，不堆孤儿常量。

新增协议常量 `MEMORY_RECALL_PINNED_ITEM_LIMIT=6`、`MEMORY_RECALL_PINNED_CODE_POINT_BUDGET=2000`；加入 v2 的 policySnapshot：`pinnedItemLimit`、`pinnedCodePointBudget`。沿用总 16 条/正文 6,000/包装 2,000/整块 8,000、偏好 2 条/600 与历史预算，不复制另一套值。

选择顺序与边界：

1. 原有范围、有效期、任务排除、来源、依赖及冲突门禁**先于所有池**；优先不能穿透任何一层。
2. keep-both 的已裁决关系按连通分量形成不可拆组，并携带分量全部适用说明，避免 A–B、B–C 只注入半组。未裁决冲突仍挡住对应规则。组内至少一条 pinned 则整个组属于优先池，所有成员与正文计入该池；含 relevant 成员不是暗改其策略。分量不能容纳则整组落选。
3. 优先池不要求文本命中；按组内最具体 scope 排序，再按组内规范最小 memoryId 字节序升序，组内按同样规则；不按 updatedAt 给修改者隐性业务优先权。
4. 逐组校验该池条数/正文预算与全局正文、条数、包装、整块预算。容不下整组就记 budget，继续尝试后面较小组。未入选 pinned 组本次不再进入其他池绕过上限。
5. 其余 eligible relevant 记录进入既有偏好池与词面相关池，同一 revision 去重。优先成员不二次占偏好池；偏好池只处理未分配组。所有 keep-both 分量无论进入哪个池都不可拆；偏好分量所有成员计入偏好限额，容不下可在普通相关池以整组按既有相关性规则竞争，但不能拆成单条。
6. 新 selection reason `pinned-rule`，优先组所有成员用此 reason，score 为实际词面分数或 0（不能伪造高分）；非优先选择保留原理由。落选仍使用已有 budget 等原因；不新增「预算失败就阻止发送」或强制预览。
7. 预算在**加入组之前**核对最终格式化字节对应的 code point 计数，不能先选完再从高优先组倒删；包装含每条标签、分隔和共存说明。空块不发送；不截断规则或说明凑预算。
8. preview 与真实 Run 共用相同选择器/格式化器；Run 独立重算并在写快照时重验上下文与记忆修订。运行记录依旧 selected→request-prepared→dispatch-attempted，不表示模型已读。

兼容要求：当前 Schema 对版本使用 literal，直接改全局常量会使旧库解析失败。保留冻结的 v1 policy Schema 和快照解析，新 v2 分支严格要求两个新预算字段；RunMemoryContext.recallVersion 必须与 policySnapshot 分支一致。旧 selected reason 与旧 usage/decisionSummary 原样可读，新 pinned-rule 只允许在 v2 运行上下文中出现；不批量把旧行改为 v2、不补历史 pinned 或调用时间。schemaVersion 可继续为 1，算法版本由 recallVersion 判别，不设永久双算法运行开关：新运行只写 v2，旧运行只读 v1。

### 11.5 冲突视图与连续性（MI07/MI08）

`MemoryViewItem.conflicts` 中 keep-both 分支增加必需 `applicabilityNote`（沿用 1–300）；unresolved/replace 不带该字段。返回精确左右 revisionId，读取已存在裁决表；无新表和迁移。旧持久化回执含旧展示 DTO 时，返回当前状态必须通过实时视图投影补齐，不能给空字符串假说明。

冲突来源详情优先复用已有 `memory:get(id,revisionId)` 与 provenance；同一合法管理范围内才显示。页面/hook 对比精确修订，不把旧 decision 应用于新修订；禁止根据同 topicKey 自动重新关联 note。查询失败不影响已有裁决记录。

换期动作只复用本期材料面板、记忆详情和精确 ArtifactVersion 详情；不新增「恢复历史」IPC、checkpoint 自动摘要或资料权限。source Run 专家快照是「从成果开始新任务」默认专家的来源；旧 Task 的最新 executor 不是来源证据。

MI08 同卡新增只读 `artifact:get-version-executor`，Preload 为 `artifacts.getVersionExecutor`；严格请求 `{artifactId,artifactVersionId}`，响应为 `ArtifactVersionExecutorSummary|null`。不扩充每次成果详情的载荷，不向 Renderer 开放完整 RunContextSnapshot。只有 Markdown 的既有「从此版本开始」入口消费，不扩大可创建任务的成果类型。

`ArtifactVersionExecutorSummary` 为 strict 判别联合：

- `{kind:'general',sourceRunId}`：存在完整来源快照，且快照确为通用执行器。
- `{kind:'expert',sourceRunId,expertId,sourceExpertRevisionId,currentExpertRevisionId,name}`：快照专家身份和来源修订已核验，专家当前 active；当前修订单独标明，不能把当前配置冒称历史配置。
- `{kind:'unavailable',reason:'source-unavailable'|'expert-unavailable'}`：来源链/快照无法证明，或来源专家不可用；不返回猜测的专家或其他任务草稿。

Main 先沿用成果管理读取边界校验版本属于所给 artifactId；对象不存在或不匹配均返回 null。沿该精确版本 `getVersionSourceRunId` 查询；user-edit 无来源 Run 时用 `getPreviousVersionId` 沿同成果前版回溯，遇 assistant-run 却缺来源、链断裂或循环即 unavailable，绝不改取 latest。重验 Run 所属 Task/Workspace 与成果登记一致、快照专家修订属于该专家；数据库读取失败按既有 Artifact IPC 的异常/Hook 错误出口处理，不伪装 unavailable。

新任务默认沿用的是来源专家**身份**，不是恢复旧权限：当前修订不同于来源修订时先显示差异并由用户确认使用当前版；新绑定复用现有专家选择流程的当前预设，不复制来源 Task 的最新 skills/model/MCP，也不复活快照中的旧授权。选择完成前不清空原草稿；general 才可直接默认通用，unavailable 必须显式选择通用或可用专家。取消/失败/迟到响应均保留原任务；创建时重验专家当前状态及修订，变化则提示重选，不自动发起 Run。

### 11.6 共同错误与取消语义

- 来源/策略/裁决用户写命令沿用 §9.3 领域错误和 §5.6 幂等；Zod 拒绝与 transport 失败仍由 Hook 映射 IPC_FAILURE，不抓字符串猜业务码。
- 短时本地写无新增作业和取消 API；未提交关闭不写库，已提交结果可查询。双击同请求复用 operationId，编辑请求后生成新 ID；数据库成功但投影失败按 PROJECTION_PENDING 报成功警告。
- preview、来源详情、排除查询的迟到响应不得污染另一任务或关闭的表单。用户正在编辑的正文不能被后台刷新覆盖。
- 运行快照不因策略/排除/来源治理中途变化而改写；要求本次改变则复用取消 Run 后重跑。下次必须重验，历史中的旧依赖不得回流。
- 不新增网络作业，不自动调用模型验收，不改自动提炼开关/同意版本/模型配置或凭据保存方式。
