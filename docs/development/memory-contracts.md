# 记忆实施契约（WM 系列）

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

### 5.6 幂等与投影

所有用户写命令带 `operationId`；已有实体另带 `expectedRevision`。相同 `operationId`＋相同请求哈希返回原提交效果和当前最新展示状态；同 ID 不同请求返回 `IDEMPOTENCY_CONFLICT`。

事务包含业务修订和回执；不跨网络持有事务。重复自动候选按 `scope`＋`normalizedHash` 抑制；与已拒绝候选相同也抑制；恢复候选后才重新进入待审列表。

落点：写时抑制在 `memory-repository.ts` 的 `findCandidateByDedupeKey`（同 `scope`＋同 `normalizedHash` 返回 `deduplicated`／`suppressed`，不产生第二条待审记录）。已确认记忆与候选之间的重复不落库、按查询派生：`MemoryViewItem.duplicatesConfirmedMemoryId` 由 `memory-service.ts` 用 `scopesMatchExactly`＋同哈希判定，只指向那条已确认记录，界面据此在候选行内提示重复后果。「所有用户写命令」也覆盖 `memory:set-settings`：`MemoryExtractionService.setSettings` 在同一事务里先 `claim`、再写设置、再 `append` 回执，因此「点了开关但响应超时」的第二次原样重发拿回的是原提交效果与当前设置行，`cancelledJobCount` 为 0（取消只发生在首次提交），换内容的同 ID 提交返回 `IDEMPOTENCY_CONFLICT`。

投影在数据库提交后重建，使用单实例串行队列、唯一临时路径及原子 rename；合并重建请求但不得旧覆盖新。成功回执可带 `PROJECTION_PENDING`，不能把已提交误报成保存失败。来源待复核、`candidate`、`deleted`、`superseded`、`expired` 不进入有效投影。

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

### 6.3 安全历史重放

对所有新 Run 统一处理，包括旧通用入口。已有 TaskContext 的任务必须提交并匹配最新修订；真正没有上下文的任务由 Main 生成明确 `general`＋空材料上下文，不代表全 Workspace/全知识库可读。

候选历史只取同 Task、`completed`、`createdAt` 早于当前 Run、`completedAt` 不晚于当前准备时点的运行。取按事件 sequence 最后的非工具最终 `message.completed`；不重放 reasoning、工具调用或别的任务。若不能确认最终回答，跳过并记录原因。

安全性检查使用**直接＋传递依赖**：历史实际记忆修订、重放继承记忆、历史已选/实际读取材料的保守并集。旧记录缺依赖事实则不推断安全。

以下情况使依赖历史不可重放：记忆被删除/排除/替代/过期/改修订/缩 scope、来源不可用、依赖材料移除/换版本/哈希不符；相关记忆本次无命中或预算落选不使历史失效。纯增加材料也不应无故截断。

从最近历史向前选连续安全后缀，遇首个不安全轮次停止，不跨过它拼接更早对话。上限 8 个完整问答对、12,000 code points；容不下完整一对就停止。记录实际重放 `runId`/`finalEventId`/`promptHash` 及依赖；不让更近回答隐藏它继承的已撤销信息。

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

启动时将遗留 `queued`/`running` 收口 `interrupted`，不自动触网。关闭设置取消本空间自动作业；单次手动重试有独立同意，不暗开全局开关。取消后先落库终态再中止请求；成功落候选前检查 job revision/attempt/status、来源有效性、自动模式 `consentRevision`。迟到结果不能落库。

候选写入、去重统计、作业成功终态在同事务提交。失败只保存安全错误码与摘要；主任务终态不受影响。UI 主动刷新和窗口重获焦点查询状态；仅面板可见且有活动作业时按 1 秒轮询，隐藏即停并清理，无自造成功提示计时器。落点：轮询与重获焦点的重查都在 `renderer/src/hooks/use-memory-suggestions.ts`——`window` 的 `focus` 监听补发一次全量查询（设置、作业、候选），面板不可见或已卸载即摘除监听；用例见 `use-memory-suggestions.test.ts`。

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

`run_memory_contexts` 中：`selectedItems`＝memoryId/revisionId/hash/order/score/reason；`replay`＝runId/finalEventId/promptHash 和边界理由；`decisionSummary`＝各原因计数和合法范围内最多 50 个身份/原因，不复制被排除正文；`policySnapshot` 保存算法版本及全部预算；依赖 union 保存精确引用，不得只存摘要文本。

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

成功警告：`PROJECTION_PENDING`、`SOURCE_NEEDS_REVIEW`、`HISTORY_TRUNCATED`。错误 `message` 使用可操作中文，不带完整内容、URL 凭据或提供商原始响应。

输入/输出 Zod 错误继续由已有注册 helper 拒绝；transport 拒绝由 Hook 统一映射 `IPC_FAILURE`，不解析 Electron 异常字符串来猜业务错误码。领域错误通过 `Result` 明确返回。投影失败是已提交成功＋警告，不是领域写失败。落点：`renderer/src/lib/memory-result.ts` 导出 `IPC_FAILURE_CODE` 作为该映射的唯一来源，`IPC_FAILURE` 不是领域错误码，`memoryErrorCodeSchema` 必须继续拒绝它（用例见 `packages/agent-protocol/src/index.test.ts`）；界面侧收口的三条路径——transport 拒绝、领域失败原样透出、成功保留 `warnings`——见 `memory-result.test.ts`。

## 10. 简报和成果引用精确规则

`WorkspaceBrief` 字段：workspaceId、expertId?、generatedAt、goals、constraints、decisions、methods、openIssues、referenceVersions 及每区 total/truncated。确认区每区最多 10 条，`updatedAt DESC`/`id ASC`；只纳入当前有效、verified、来源仍可用的 `confirmed`。workspace 视角只取 workspace 记录，选专家再加相应 expert-workspace；不把 user 偏好混成项目事实。

每个记忆条目返回 memoryId/revisionId/hash/content/scope/sourceAvailability/requiresMaterialSelection。资料派生内容可在同空间管理简报中显示，但注明使用时仍需材料，不因此获得模型授权。

`openIssues` 取本空间 Task 的 open checkpoint 最近 10 项，保留 summary/feedback/nextAction 原有标识；开放不等于「已确认未解决所有问题」，不做 LLM 状态推断。参考区取最新 5 个 active 标记，`selectedAt DESC`/`id ASC`；可进入全部参考列表。

源失效、过期和候选不进入确认区；重复/冲突待处理计数作为管理提示。空态不自动补内容，查询失败显示可重试错误，不显示伪造旧简报。

落点：「重复/冲突待处理计数」落在记忆治理页（`MemoryView.tsx` 的 `.memory-pending-governance` 提示带，只报「几组口径待澄清 · 几条候选与已确认记忆重复」并指明去对应分组裁决），不新增 `WorkspaceBrief` 字段——本节的简报字段清单是封闭的，计数也不是「现有事实的只读投影」。简报侧继续只做「未裁决冲突组整组不进确认区」，不在此处替用户裁决。

引用流程：选精确版本 → Main 验证归属及哈希 → 现有 `MaterialReference` → 加入 TaskContext，默认 purpose 为 `historical-comparison`，用户可改 `structure-reference` 等已有用途 → 后续 Run 按既有工具读取 → 实际读取后关联本期成果。WM00 已核对 `materialPurposeSchema` 的实际枚举字符串为 `rule`、`current-input`、`historical-comparison`、`structure-reference`、`template`、`background`、`other`（见 `packages/agent-protocol/src/index.ts`），本契约按该实名机械对齐，不新增同义枚举。标记参考或显示简报不算读取 Evidence。
