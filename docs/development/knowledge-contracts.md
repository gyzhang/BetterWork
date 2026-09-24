# 知识基础闭环实施契约

- 日期：2026-09-24；状态：Proposed，尚未实施。
- 依据：[产品规范](../designs/knowledge-foundation.md)、[ADR-0027](../adr/0027-knowledge-foundation.md)。状态只在 [KM 任务板](tasks-knowledge.md) 维护，派发见[编码提示词](knowledge-coding-prompts.md)。
- 本文件是 KM 新增字段、算法、预算、错误码与接口的唯一真相源；已存在的 MaterialReference、TaskContext、ArtifactInputRelation、凭据协议直接引用，不复制另一套定义。
- 所有新增 DTO 使用共享协议中的 strict Zod Schema，类型从 Schema 推导；下面的对象字段是待实现合同，不是现有 API。可选字段省略，不传 undefined；数据库 NULL 由仓储映射。

## 1. 基线与复用边界

核对基线 HEAD `f59c71a`，来自 2026-09-24 静态阅读；非运行验收。开工时重核，不按旧行号机械修改。

| 事实或缺口 | 当前落点 | 处理归属 |
| --- | --- | --- |
| 知识页研究只传 query/count，清空材料后填 prompt | `App.tsx` 的 `startResearchFromKnowledge`、`KnowledgeView.tsx` | KM03 |
| 当前全库 FTS/LIKE；固定修订为 substring；没有正文工具 | `services/knowledge-vault.ts`、`services/run-service.ts`、`tool-runtime/src/knowledge-search.ts` | KM01/02/08 |
| Vault v3 已保存 parser/chunking；同文档同原始哈希去重 | `db/knowledge-schema.ts`、`knowledge-vault.ts` | KM01 |
| 模型 embedding 只连接测试，updatedAt 也会因测试而变化 | `model-connectivity.ts`、模型仓储和 `model-provider-factory.ts` | KM06 |
| Evidence 按 run/path/locator 去重，无修订/范围，save 返回 void | `persistence/evidence-repository.ts` | KM02；KM04 接展示 |
| 搜索也满足 hasMaterialRead，自动生成成果关系 | `run-material-read-repository.ts`、`run-service.ts` 的 `readArtifactInputRelations` | KM05 |
| Markdown 和文件版本自动关联 Run 全部 Evidence | `persistence/artifact-repository.ts` 的 `saveMarkdown`/`registerFile` | KM05：访问关系保留但不叫采用 |
| 协议有 inputRelations，文件登记 Tool 未暴露 | `agent-protocol/src/index.ts`、`artifact-register-file.ts` | KM05 |
| Office 已可解析，但取消为普通 Error，页序/定位和前置限额有差距 | `infrastructure/office-parser.ts` | KM12 |
| 准备/历史重放与提炼依赖不能漏知识读取 | `memory-recall-service.ts`、`extraction-source-reader.ts` | KM02/04 回归，不更改 WM 算法 |

路径前缀：Main 为 `apps/desktop/src/main/`，Renderer 为 `apps/desktop/src/renderer/src/`，工具与协议为 `packages/`。全局 Knowledge 是个人 Vault，不属于某个 Workspace；Run 仍按显式材料范围使用。

## 2. 身份、内容与生命周期

### 2.1 不可变修订

复用 `knowledge-revision` MaterialReference 的 documentId/revisionId/contentHash/sourcePath 语义，字段名保持现有协议。`contentHash` 始终是原始文件字节 SHA-256，不改成提取文本哈希。

扩充共享 `KnowledgeRevisionSummary`：沿用现有 Vault summary 字段，并增加 `textHash`、`sectionCount`、`warnings`。`warnings` 为第 11 节定义的解析警告码数组。`textHash` 是 UTF-8 JSON 数组 `[[ordinal,locator,content], ...]` 按 ordinal 升序、无额外空白序列化的 SHA-256；不包含 ID、时间、源路径。正文读取以这些保存的 section 为准，不把 current document.content 当历史正文。

已有 `knowledge_revision_chunks` 是不可变正文定位单元，下文称 section；不重命名历史表，也不因增加检索小块就覆盖 section。新增独立派生检索表，避免把两个 chunk 概念混用。

修订唯一键从 `(document_id, content_hash)` 改为 `(document_id, content_hash, parser_version, chunking_version)`；保留 `(document_id, revision)`。相同元组重复导入直接复用，且文本哈希必须相同，否则 `PARSER_NONDETERMINISTIC`。原始文件相同但解析/正文分段版本升级，可以追加新修订；普通“重建搜索索引”不重新解析。

- 同一路径更新 current document，追加或复用对应修订；不同路径不合并。
- 原路径 identity 沿用现有登记规则；不在本卡擅自引入跨路径内容去重。
- 刷新与导入对**同一份读取到的字节**计算哈希并解析，读取前 stat 检查，读后再查实际长度；不能 hash 后让解析器再次按路径读另一份内容。
- 移除 current document、当前 FTS/检索可见性及集合成员；保留修订和历史文本。新建草稿候选不再出现它，既有材料和运行仍可读已保存修订。
- 重新导入已移除路径沿用当前新 documentId 行为，不暗中恢复旧分类。
- 原件缺失仍允许读取留存修订；丢失的仅是“打开原件/刷新”能力，不是历史内容被删除。
- 不提供历史修订物理清理接口。旧规则中“Vault 可重建”只适用于派生索引，不能据此删除整库。

### 2.2 预算与单位

本表是 KM 数值唯一来源。实现中的共享限制在协议或同一领域常量中定义，生产者与消费者都引用；测试边界独立写期望字面量以发现同时放宽。

| 对象 | 限额/定义 |
| --- | --- |
| 知识导入原文件 | 每个 20 MiB，所有支持格式一致；一次选择最多 200 个 |
| 单修订提取正文 | 最多 2,000,000 Unicode 码点；超出整文件失败，不暗截断为完整导入 |
| 检索小块 | `knowledge-chunks-v1`：每个 section 内按 1,000 码点窗口，重叠 100；不跨 section；空白 section 不建块 |
| 查询 | trim 后 1–500 码点；候选搜索上限 50，工具输出上限 8 |
| 搜索摘要 | 每条最多 400 码点，工具合计最多 3,200；无隐藏正文尾部 |
| 正文/预览单页 | 请求 maxCodePoints：1–8,000，默认 4,000；每页最多 20 个片段 |
| 正文 Run 累计预算 | 60,000 码点，按每次实际返回计，重复请求也计；搜索摘要另受单次搜索限额 |
| Task 材料、成果 inputRelations | 复用既有协议上限，不新增一套限额 |
| Embedding 请求 | 每批最多 16 个输入，总计最多 16,000 码点；查询只有一个输入 |
| Embedding 响应 | 最多 4 MiB 流式累计字节；维度 1–4,096，有限浮点数且范数大于 0 |
| Embedding 请求超时 | 每批 30 秒，查询 10 秒；每次实际请求最多一次，不自动重试 |
| 向量总规模 | 当前可发布向量最多 20,000 个；超出保持关键词可用并报告容量不足，不静默丢弃旧向量 |
| 本地搜索批次 | 向量载荷每批最多 1 MiB；中间结果只保留各路 top 50 |
| 集合 | 名称 trim 后 1–80 码点，最多 100 个；单文档最多属于 20 个集合 |
| 诊断失败说明 | 最多 500 码点，去除凭据、完整响应正文和 URL 的 userinfo/query/fragment |

码点通过现有 `countCodePoints` 或相同遍历口径计数，不用 JS string.length 代替。SHA-256 使用 UTF-8 实际返回文本；不包含 UI 截断符和标签。

### 2.3 派生块身份

`KnowledgeSpan = { sectionOrdinal: 非负整数, start: 非负整数, end: 正整数 }`，范围为 section 内容中的码点半开区间 `[start,end)`，必须 `start < end <= section 长度`。ordinal 使用库中真实值，不把显示页码当 ordinal。Locator 是显示值，不充当唯一身份。

`KnowledgeRetrievalChunk`：`id, revisionId, textHash, chunkingVersion, span, locator, content, contentHash`。这里 contentHash 是**块正文哈希**，字段在材料引用中不得混用；持久列命名 `chunk_hash`。id 对 revisionId/chunkingVersion/span 做稳定哈希生成。同一修订同一算法重建 ID 相同。

### 2.4 选材入口的修订身份

KM01 即在现有 `knowledge.list` 摘要接通 `currentRevisionId`，在管理 `knowledge.search` 每个命中接通完整 `reference`；共享 Schema、Vault 查询、IPC、Preload、Hook 类型与测试同步迁移。命中正文与 reference 必须来自同一读快照，不能先查旧摘要再按 latest 补引用。同内容哈希不能代替 revisionId，解析升级也可能改变修订。

KM03 直接保存这份 reference，不按点击时的最新版本重新解析。KM01 保持既有关键词排序和摘要算法，不提前实现 §9 的完整混合响应；KM08 再整体迁移至 §9 response，并保留此身份保证。§10 的其余管理摘要字段由对应后续卡引入，不要求 KM01 预建集合或作业。

## 3. 正文与预览接口

### 3.1 正文游标

`KnowledgeCursor = { revisionId, textHash, sectionOrdinal, offset }`，offset 为码点偏移。它不是授权 token，无签名也不授予范围；服务必须独立验证 revision 和调用域。游标仅定位保存文本，不用于 latest 或其他修订。

`KnowledgeReadRequest = { reference: 既有 knowledge-revision 引用, cursor?: KnowledgeCursor, maxCodePoints?: number }`。

首读省略 cursor 从第一个非空 section 开始。cursor 对其他修订/文本、无效 ordinal、越界 offset 统一拒绝；段末 offset 可规范化到下一非空段。最后一段末 offset 返回空页 `complete: true`。需要从搜索位置读时，客户端可使用该结果 span.start 生成游标，仍受相同校验。

`KnowledgeTextPage` 返回：

- `reference, textHash, title, parserVersion, chunkingVersion, warnings`。
- `parts: [{ span, locator, text, excerptHash }]`，text 必须等于保存 section 指定区间。
- `returnedCodePoints, complete`；尚有正文时有 `nextCursor`，complete 时省略；不得同时表示两种状态。
- Run 正文工具额外返回 `remainingRunCodePoints`。一次请求被剩余预算缩小时仍有 nextCursor；预算为零且还有正文时拒绝 `KNOWLEDGE_READ_BUDGET_EXCEEDED`，不伪装读完。
- 不把 title/locator 的长度算入正文额度，但它们仍受既有标题/路径协议约束。

新增 Tool 名称 `read_knowledge`。执行上下文中的 runId/signal 由宿主提供，模型不能指定。只允许 RunContextSnapshot 中完整匹配的材料；依次验证运行有效性、引用范围、revision/hash/sourcePath、cursor、预算。返回前检查取消并完成第 5 节审计，失败不返回正文。

管理预览 IPC 使用同一分页纯逻辑，但不占 Run 预算、不生成 RunMaterialRead/Evidence、不调用模型。必须通过 `documentId + revisionId` 校验关联；移除的修订仅从既有 Task/Run/Artifact 来源入口解析，普通知识详情不接受任意历史 ID 作为发现入口。

`previewRunSource` 只回看单条 Evidence 实际返回过的区间，不扩展上下文全文。Main 校验 Evidence 属于请求 Run，再验证 knowledgeSource 的完整 reference 属于该 Run 快照、textHash/span/excerptHash 与保存文本一致。精确来源返回 `{ kind: 'exact', page }`：page 仅含该 span 的一个 part，止于 span.end，`complete: true`，省略 nextCursor；单条证据本已受 §2.2 单页上限约束。此接口不接收 cursor/maxCodePoints，不能以该入口续读未返回正文。旧来源缺精确字段返回 `{ kind: 'legacy', evidence }`，显示已有摘要及“历史范围未记录”，不推测位置。Task/Artifact 来源入口解析出原 runId/evidenceId 后复用同一归属校验；如需浏览更多且资料仍登记，另走普通详情预览。

### 3.2 生产接线清单

除工具文件外必须更新：tool-runtime 导出、Run `createRunTools` 注入、通用工具和 Expert 内置工具名称校验、材料清单说明、结果 Schema/守卫、事实审计、工具中文标签、足迹、来源面板、历史依赖测试。

新工具是只读能力，不借此修改所有已保存 Expert 的显式工具白名单；通用助手默认包含。Expert 明确白名单未包含时保持不可用，在配置处可选，不偷偷扩大历史授权。

无 TaskContext 的旧兼容 Run 在 `knowledge_search` 返回空结果并提示先选材料；有快照但零知识材料同样零结果且**不调用 embedding**。知识页全局搜索是独立管理调用，不复用这个空集去表示“全库”。

## 4. 研究草稿与任务材料

新增 Main 动作 `knowledge.createResearchDraft`，不是 runs.start 的别名。

输入：`operationId`（UUID）、`workspaceId`、`prompt`（沿用任务输入约束）、`materials`（非空、仅 knowledge-revision，复用 TaskMaterialSelection；用途默认 background，addedFrom 为 global-search）。每次用户点击生成 operationId，失败重试复用该值；用户重新选材或改问题则生成新值。

输出：`{ task, context, prompt }`。任务与 context 用现有 DTO；prompt 保存到现有任务草稿载体；若当前没有可持久化 prompt 的载体，在应用库动作回执中保存，不发明第二个 TaskContext。

1. 先做输入 Schema 校验和规范化：固定字段顺序、补齐默认用途、按完整材料身份排序去重；冲突用途拒绝，prompt 不另做内容改写。对 workspaceId/prompt/materials 计算 inputHash，先查 operationId 回执；存在且 hash 相同直接返回原草稿，hash 不同拒绝 `OPERATION_CONFLICT`。这条成功重试路径不重新检查当前登记，也不重建或覆盖已存在的任务。
2. 仅首次创建才校验 workspace 可用、逐一核对 Vault 当前登记仍存在且 revision 属于该 document。固定勾选的 revision，不跟随 latest；刷新产生新版本不使旧勾选自动失效。
3. Main 对“查回执→验证登记状态→提交应用库草稿”与资料移除使用同一短时互斥边界；并发相同 operationId 在边界内重查回执。边界内不等待 HTTP、不执行解析。在应用库同一事务创建 Task/Session、完整 TaskContext 和操作回执；executor 为 general，Skill/MCP bindings/排除记忆为空，modelReference 和 builtinToolPolicy 使用通用默认，不继承当前旧 Task。
4. 首次创建前登记已移除则拒绝；事务失败整体回滚。提交后资料再移除，不撤销既有留存修订选择；即使首次响应丢失，同 operationId 重试仍走第 1 步返回同一草稿。两库没有联合写入，也不新增不可发送的半成品 Task 状态。
5. Renderer 只有成功且请求代号/当前导航意图仍一致时才切换任务；失败不调用 `startNewTask()` 清空旧状态。迟到成功保存为可从最近任务找回的草稿，不强制导航。
6. 当前 Run 执行中入口拒绝；未保存草稿按产品规范离开确认，不自动丢弃。新草稿从不自动调用模型。

## 5. 访问记录与精确证据

### 5.1 同一次访问的事实

复用 `RunMaterialRead`，新增可选 `toolCallId, knowledgePartIndex, knowledgeSpan, textHash, evidenceId`。新知识足迹要求这组字段全部存在；knowledgePartIndex 为本工具结果中从 0 连续递增的片段序号。旧行保留原 operation 和字段，缺失范围显示“历史范围未记录”，不伪造历史 toolCall，也不迁移成 read。

- `knowledge_search` 为返回给模型的每条摘要记 operation=search。
- `read_knowledge` 为每个返回片段记 operation=read。
- 知识页文本预览不写 Run 足迹。
- 对其他格式现有 read/parse 语义保持，不能把 hasMaterialRead 的任意 operation 当知识正文读取。

`EvidenceSummary` 新增可选 `knowledgeSource = { reference, textHash, span, operation: search | read }`。既有 sourceType 保持 local-file；sourceUri 保持登记源路径，不能为了唯一性伪造文件路径。

知识 Evidence 去重键：`runId + revisionId + textHash + span + operation + excerptHash` 的稳定序列化哈希；同一访问文本可复用 Evidence ID，但每个 toolCall 的足迹独立记录。先搜后读不能吞掉正文来源，同路径同 Locator 的不同修订不能合并。

Evidence 表增加 nullable `knowledge_source_json`、`dedupe_key`，将旧 unique 索引改为两个部分唯一索引：非知识沿用 `(run_id,source_uri,locator)`，知识使用 `(run_id,dedupe_key)`。saveKnowledge 返回持久化后的完整 EvidenceSummary；web/MCP 保存行为不变。迁移旧 local-file 行不猜 reference/span。

`run_material_reads` 必须重建以移除旧表级 `UNIQUE(run_id,material_key,operation,locator)`，仅加列不足以记录同段后续页。新增列为 tool_call_id、knowledge_part_index、knowledge_span_json、text_hash、evidence_id（指向 Evidence 的 FK）；用 CHECK 约束新知识字段整组存在、operation 为 search/read。新部分唯一索引 `(run_id,tool_call_id,knowledge_part_index) WHERE evidence_id IS NOT NULL`；旧/其他工具行保留原四列部分唯一索引，条件为 `evidence_id IS NULL`。服务校验足迹与 Evidence 的 Run、材料、操作、范围和哈希一致，不能靠 FK 代替归属检查。

### 5.2 返回与落库顺序

Main 注入的搜索/读取回调在构造精确结果后，在应用库同一事务内保存 Evidence 与整组 RunMaterialRead，再把 `evidenceId` 附到模型可见结果；Run/toolCall 身份来自宿主闭包/context，不能来自模型参数。工具执行上下文若尚未暴露 toolCallId，只新增这个身份接点，不改变 Agent 事件体系。

保存失败抛 `KNOWLEDGE_AUDIT_FAILED`，模型不能获得未经审计正文。取消检查放在开始、外部等待后、写入前和返回前。审计成功后突然取消可以保留“工具已产生内容”的足迹，但**不得把它声称为 Provider 已消费**；是否发送用既有运行请求审计判断。

Run 累计正文用量等于新精确足迹中 operation=read 的 `span.end - span.start` 之和；事务内重算剩余额度并保存实际截取结果，避免并发超支。不同 toolCall 即使读相同 span、复用相同 Evidence 也分别计量；同一个 toolCall 的已审计结果重复消费，必须核对整组序号/范围/哈希完全一致，复用原记录且不重复计量，不允许追加片段或用 INSERT OR IGNORE 掩盖不同内容。不新增工具自动重执行或响应重试功能；旧历史行不推算缺失的正文量，旧终态 Run 不恢复执行。

当前 `tool.completed` 的通用消费者遇到已审计的知识结果只验证/复用，不能第二次插入；其他工具仍走原行为。材料事实审计只能用工具实际返回文本，不能把未返回 section 或整个文档的数值加入允许池。

历史上下文和提炼来源依赖复用现有材料依赖机制：至少包含本 Run 固定材料和本次实际读取；下次范围缩小不重放被排除材料的历史文本。新增读取不可绕过 WM 依赖校验，不重写 WM 召回/来源状态规则。

## 6. 成果来源声明

复用 `ArtifactInputRelationInput` 及其关系枚举；不新增“采用”关系枚举。它表达依据类型，不表达正确性批准。

### 6.1 新版本的声明

`artifact_versions` 新增 `source_declaration_kind`：`none | model | user | inherited | legacy`；历史行迁为 legacy，新版本默认 none。Artifact 详情 DTO 暴露同名语义字段 `sourceDeclarationKind`。

- 自动 Markdown：新增只作用于当前 Run 最终 Markdown 的 Tool `artifact_declare_sources`，输入 `{ inputRelations }`，允许空数组清除声明。宿主持久化至 `run_artifact_source_declarations`，同 Run 最后一次成功声明替换前一次；自动保存最终 Markdown 时读取该声明，同事务写版本和关系。不把声明误用于已登记的 PPTX。
- 文件成果：`artifact_register_file` 的 Zod、JSON tool schema、注册输入和 Main 回调全部接通既有 inputRelations。显式传入即 model 声明；省略即 none。
- 用户保存 Markdown：既有保存请求的 inputRelations 接到明确选择 UI，声明种类由宿主判断，模型/Renderer 不可自报任意种类。新建且省略 inputRelations 为 none；明确提交该字段为 user，空数组表示主动清除声明。编辑时省略该字段表示沿用前版，按下表继承；主动重选为 user。
- 声明失败不写任何关系，不破坏已有版本；没有声明不阻止合法成果生成，但显示“未声明采用依据”。

| 编辑时未主动重选的前版 kind | 新版 kind 与关系 | 展示 |
| --- | --- | --- |
| none | none；无采用关系 | 未声明采用依据 |
| legacy | legacy；原关联仅作历史关联保留 | 历史关联，未核实采用；不进入声明区 |
| model / user / inherited | inherited；继承前版声明关系 | 继承声明，不表示重新读取 |

连续编辑 legacy 仍为 legacy，不能经 inherited 洗成声明。只有用户明确重新选择并通过归属校验，才将新版本标为 user；旧版本不回写。inherited 因此始终代表存在明确声明祖先，不额外保存第二套推断来源。

### 6.2 声明验证

模型声明的 material 必须完整匹配本 Run 固定材料，并有同 Run 实际 read/parse 足迹；仅 search 不足以声明整份材料。若只用了摘要，应声明该精确 Evidence，允许搜索证据并展示“摘要依据”。Evidence 必须属于同 Run；用户对 assistant-run 的选取也受归属约束。用户编辑继承关系复用现有合法继承路径，不伪造新的模型访问。

Knowledge 优先使用 Evidence 引用，能定位具体范围；整份 material 声明明确标“文档级依据，非全文已读”。去重使用 input 完整身份＋relation；上限与 existing schema 一致。不得由材料用途自动生成声明。

`artifact_version_evidence` 自动关联 Run Evidence 的历史能力可保留，统一解释为“运行访问记录”，不再由这些行推断声明采用。新 `artifact_input_relations` 只来自上述声明或合法继承；移除 `readArtifactInputRelations` 自动映射。旧 input relations 保留且受版本 legacy 标记约束，不回填 model/user。

来源 UI 分当前 Run 与历史 Run、声明与访问、历史关联与精确范围。不通过“本次运行”标题掩盖 listByTask 的跨 Run 汇总。

## 7. Embedding 模型与请求

### 7.1 唯一模型选择

Vault 设置 `KnowledgeSearchSettings = { semanticEnabled, embeddingProfileId?, revision }`，初始 semanticEnabled=false。启用时从当前默认 embedding profile 解析出**具体 ID**并保存，用户也可显式选该角色其他已启用 profile。没有合格模型时拒绝启用；后续修改应用默认不暗中更换知识模型，知识页提供显式切换。

模型 profile 继续归现有模型管理；凭据仍由 credential-access/现有 resolver 在 Main 获取。不落入 Vault，不进入 Worker，不新增 apiKey 字段。模型停用/删除/密钥失效时停用实际语义请求但保留用户设置和可解释原因；不换另一个 profile 或 Fake Provider。

快照 `EmbeddingModelSnapshot = { profileId, provider, endpointFingerprint, model, modelFingerprint, dimension? }`。完整 endpoint 只存在 Main 请求配置；对外只回安全展示值。指纹为固定字段顺序的 JSON SHA-256：版本 `knowledge-embedding-v1`、profileId、provider、规范化完整 endpoint、model、固定请求格式 `float`。参与 fingerprint 的 endpoint 包含影响路由的 query 但不以明文记录；拒绝 URL userinfo，沿用 http/https 校验。

- `updatedAt`、名称、priority、连接探测结果和 API Key 不参与向量空间指纹。
- API Key 更换不改变空间，但取消正在用旧凭据的请求；重试重新解析，不自动重试。
- profile endpoint/model/provider 变化：使旧空间不兼容；当前调用/作业取消，查询降级，用户手动重建。
- 同名服务背后模型静默换代无法靠客户端完全识别；用户确认“强制重建”后，按 §8 为该 fingerprint 切换新的共享 spaceId/epoch，旧空间立即不可查询。仅换一份修订的 generation 不算强制重建。同维度静默变化仍需用户主动触发，这是已知边界。

### 7.2 适配器

Main 服务 `EmbeddingClient.embed({ snapshot, inputs, signal }) -> Promise<{ vectors, dimension, usage? }>`，可注入 fetch。复用 model-connectivity 的 endpoint 解析语义，但正式消费响应不能只判断 HTTP ok。

请求为 OpenAI-compatible `/embeddings` 语义 `{ model, input: string[], encoding_format: 'float' }`，不带聊天历史、工具和 temperature。未支持此协议的 provider 明确不可用，不猜测厂商格式。HTTP、网络、JSON 和响应大小均受限；流式读取达到上限即取消。

验证 `data` 条数等于 input 条数，index 唯一且覆盖 `[0,n)`，按 index 重排。每个 embedding 是同维度有限数值数组，非零范数；归一化为 Float32 后再次检查有限与非零，再归一化保存。适配器校验批内维度及 snapshot.dimension（存在时）；KM07 调度器将首个合法索引批次的维度原子锁定到共享 space，之后所有修订、作业和查询都复用该维度，不能各自锁定。不把 NaN/Infinity、空向量、重复/缺失 index 或维度错误当无命中。

usage 只接受服务返回的非负整数 token 值；缺失省略，不用字符数伪造 token/费用。HTTP 错误显示安全状态码/原因，不回显完整服务响应或密钥。请求超时与用户取消分开处理，后者通过统一 abortError，不走关键词降级后继续返回迟到结果。

## 8. 索引作业与代次

### 8.1 持久模型

以下表归 Vault，字段采用 snake_case；JSON 均有对应共享/内部严格 Schema。SQLite FK 与唯一约束由版本化迁移实现。

| 表 | 必需列及约束 |
| --- | --- |
| `knowledge_search_settings` | singleton id、semantic_enabled、embedding_profile_id（外库逻辑引用，不建跨库 FK）、revision |
| `knowledge_retrieval_chunks` | id PK、revision_id FK retained revision、text_hash、chunking_version、section_ordinal、start、end、locator、content、chunk_hash；unique(revision_id,chunking_version,section_ordinal,start,end) |
| `knowledge_retrieval_fts` | 派生块 FTS：chunk_id UNINDEXED、title、content；重建只动派生数据 |
| `knowledge_embedding_spaces` | id PK、model_fingerprint、epoch、dimension?、status=current/retired、created_at；unique(model_fingerprint,epoch)，同 fingerprint 仅一个 current 的部分唯一索引 |
| `knowledge_index_generations` | id PK、revision_id FK、text_hash、space_id FK、model_snapshot_json（无密钥）、chunking_version、status、chunk_count、created_at、published_at?；status=staging/active/superseded；指纹和维度以关联 space 为准 |
| `knowledge_chunk_vectors` | generation_id FK、chunk_id FK、vector BLOB（little-endian Float32）、chunk_hash；PK(generation_id,chunk_id) |
| `knowledge_jobs` | id PK、kind、status、attempt、sequence、retry_of_job_id?、request_json、space_id? FK、total_count、completed_count、failed_count、created_at、updated_at、failure_code?、failure_message? |
| `knowledge_job_items` | id PK、job_id FK、target_json、status、phase、attempt、completed_units、total_units?、result_revision_id?、failure_code?、failure_message?；同 job/target 唯一 |

generation 的原子发布单位是**一份修订**，不是整座 Vault。active 部分唯一约束为 `(revision_id,space_id,chunking_version)`；同空间同一事务先 supersede 旧代次再激活新代次。覆盖率必须反映部分成功，不能把一份完成说成全库完成。

space 是跨修订共享的向量空间身份，不是单作业代次。首次显式索引为当前 fingerprint 创建 epoch=1 的 current space；后续普通重建复用它。dimension 初始为空，由首个合法索引批次以 CAS 锁定；不同修订返回不同维度必须失败，不能另开一个同 epoch 的维度空间。查询只使用当前所选 fingerprint 的 current space，且必须已有锁定维度和可用覆盖。单次索引/查询上下文固定 `{ spaceId, modelSnapshot }`。

“强制重建”对应 `rebuildIndex` 的 semantic 分支 `resetSemanticSpace: true`，不接收局部目标；确认后在 Vault 同一事务将旧 space retired、创建 epoch+1 的空 current space、递增设置 revision、创建固定新 spaceId 的 job，并快照全部当前登记修订为目标。旧空间立刻从查询和覆盖率排除，不等首份新修订发布；取消/失败不退回旧空间，关键词仍可用。历史留存修订不自动向量化，可随后在新空间按精确引用另行重建。重试此 job 只复用已创建的新 space，不再次 reset；如 space 已被再次退役，拒绝 `INDEX_CONFIGURATION_CHANGED`。普通重建只替换同空间目标修订，可以保留旧兼容 active；两种动作必须区别展示。

`KnowledgeJobSummary` 只回 id/kind/status/attempt/sequence/retryOfJobId?/计数/时间/安全 failure；`KnowledgeJobItemSummary` 回 id/jobId、已登记 documentId 或文件名、status/phase/attempt/计数/resultRevisionId?/安全 failure。不回传内部 request_json、原始模型配置或 staging 向量。job get 返回 summary 与 item summaries；list 不内嵌 items，按 `(createdAt,id)` 倒序，cursor 固定为 `{ createdAt, id }`，超界拒绝，不沿用正文游标。

Jobs kind：`import | refresh | rebuild-keyword | rebuild-semantic | check-source`。job status：`queued | running | succeeded | partial | failed | cancelled | interrupted`。item status：`queued | running | succeeded | failed | cancelled | interrupted`；phase：`read | extract | chunk | embed | publish | check`。阶段不适用时直接跳过，不伪造耗时。

聚合：全部 succeeded 才 succeeded；成功与失败混合为 partial；全失败为 failed。用户取消优先 job=cancelled，保留已经 succeeded/failed 的 item，未完成项 cancelled。重启把 queued/running 收口 interrupted，终态不改；未完成 item interrupted。

### 8.2 调度、原子性与恢复

- 一个持久知识作业同时运行；其他排队。Embedding HTTP 另设并发 1，知识页/Run 查询在两个索引批次之间优先，不能打断并发布半批索引。排队期间用户取消立即生效。
- 队列/批次由 Main 调度；CPU 密集解析与向量扫描放独立工作进程，使用现有 Electron `ELECTRON_RUN_AS_NODE` 受管模式与独立构建入口。Main 独占数据库写入和凭据；Worker 只处理给定字节/向量批，不开放文件路径读取和网络。
- Worker 输入/输出有大小与 Schema 校验、请求 ID、作业 attempt；取消请求后 1 秒未退出只终止本作业已记录的子进程，不做宽泛进程匹配。开发和打包从同一构建入口启动，沿用工程规范，不复制 guardian 的专属业务。
- import/refresh：提取和校验成功后，在 Vault 一次事务发布 current document、revision/sections、关键词块/FTS；向量是后续 item/阶段，失败时文档仍可关键词查找。语义未就绪不是解析失败，UI 分两列状态。
- 开启语义后新导入触发对应修订向量处理；仅处理显式启用后的操作。启动不会扫描历史自动补费，手工重建才处理当前登记修订；历史选定修订可被明确加入重建目标。
- 向量逐批写 staging，只在全部块/哈希/共享空间维度校验及模型配置复核成功后发布。失败、取消、interrupted 的 staging 不参与检索，清理只动未发布代次；旧 active 仅在同一个仍为 current 的 space 内兼容，retired space 的 active 不可查询。
- 配置变化、space 退役、文档移除或作业重试：旧 attempt 返回不得发布。发布还要复核 current 登记或显式历史目标、textHash、fingerprint、spaceId/status/dimension 和设置 revision。强制重建取消旧空间正在执行或排队的作业；未完成 item 收口 cancelled，新 job 等既有取消收口后执行。新导入代次不能让旧 Run 的 revision 跟随最新。
- 重试是新 job，引用原 job ID，attempt 单调增加；原 job 必须已终态，仅接受用户选定的 `failed | interrupted | cancelled` item，成功/排队/运行项拒绝。成功项不重复向量化；取消项重试复用原 job 的仍有效 space，不再次 reset。复用完整 active 代次前核验 spaceId、dimension、fingerprint/chunkHash；不从失败半批拼接可见索引。退役空间的任何 job 都不得跨空间重试，须显式创建当前空间的新重建任务。
- 无跨库事务：Task/Run 只读已发布修订，索引服务只在 Vault 提交；应用模型变化以发布前复核消除迟到写入。没有完整分布式事务承诺。

### 8.3 运行时检索快照

每次 search 在开始固定允许修订集合、spaceId、共享 dimension 与当时兼容的 active generation IDs；执行期间同空间新代次发布不混入本次结果。被引用代次在请求结束前不能清理。材料授权由 Run 固定，管理页当前登记移除后不得出现在新管理搜索；已开始请求返回前复核管理可见性。

返回前必须复核所选 fingerprint 和 space 仍有效。强制重建使旧查询的向量请求取消，丢弃旧向量候选，即使维度相同也不能返回；若调用方未取消，可只返回本次已固定允许集合的关键词结果，原因 index-stale。用户取消则直接 abortError，不能冒充降级。容量与覆盖率只计算当前兼容空间，不包含 retired 空间；退役不删除历史修订。

关闭 semanticEnabled 取消未完成语义作业/查询；后续搜索只关键词。重开可用兼容 current space 的 active 代次，但不自动重跑旧失败任务。

## 9. 统一检索管线

Main `KnowledgeSearchService.search({ scope, query, mode, signal })` 为管理 IPC 与 Tool 共用入口；旧同步回调改为 Promise 并贯穿所有调用方。

scope 可辨识联合：`{ kind: 'library', collectionId? }` 或 `{ kind: 'run', runId }`。runId 由 Tool 宿主注入，不能作为模型输入；服务自行加载快照，不信任模型传 revisionIds。mode=`keyword | hybrid`，默认 hybrid；semanticEnabled=false 时实际 keyword。

### 9.1 过滤与关键词

1. 先解析 scope：library 仅 current 登记的当前修订，集合过滤先执行；run 仅快照所选修订，包括保留旧修订。空集合立即返回空，无 HTTP。
2. 用固定 `knowledge-chunks-v1` 派生块。短期 KM02 尚未接混合管线时复用 scoped 搜索，但输出身份/范围必须遵守本契约；KM08 后两入口统一算法。
3. 查询 NFKC、lowercase，按 Unicode 空白/标点分词，去重并保留顺序；纯空分词返回无结果。FTS 每词转义双引号后 AND，所有动态值参数绑定，不能拼接用户输入为 SQL。
4. 在允许集合内 FTS 命中按 bm25 升序；零命中才用所有词都在规范化 title 或 chunk content 中的 substring 回退。回退先标题命中词数降序，再正文首次命中位置升序，无正文命中排末；最后以 revisionId/sectionOrdinal/start 稳定排序。
5. top 50 是过滤后截取，不是全库 top 50 后剔除。FTS 排名仅作为本路顺序；旧历史修订也必须有关键词块，不能回退 latest。

### 9.2 向量与融合

- hybrid 且有兼容 active generation 才为 query 调一次 embedding；没有任何覆盖则直接关键词，避免无意义调用。查询与全部候选必须属于同一 current spaceId，维度等于该空间共享 dimension；只比 fingerprint/维度相同不够，不能混入 retired epoch。
- 精确扫描允许集合内的归一化向量，cosine 降序，分数相同按块身份稳定排序，只保留 top 50。部分覆盖不拿其他修订/其他模型/旧空间补足。
- 两路按 chunkId 去重，`RRF = Σ 1/(60 + rank)`，rank 从 1 起；未入某路贡献 0；两路同权。RRF 降序，同分按 revisionId/sectionOrdinal/start。无 Rerank、无自动问题改写、无任意经验阈值。
- 返回前处理重叠：同修订同 section 的重叠候选保留排名最高的一块，不跨不相交范围合并；再按请求入口限额截取。展示排序分数只属相关性，不作为模型置信度或事实可信度。
- 关键词摘要围绕首次命中位置（前留最多 80 码点）截取；无正文命中和纯向量候选从块首起。摘要实际 span 与哈希回算到 section，不能拿整个块范围冒充返回范围。

### 9.3 结果与降级

`KnowledgeSearchResponse = { results, requestedMode, effectiveMode, degradedReason?, coverage, durationMs }`。

`results[]`：`chunkId, reference, textHash, title, format, locator, span, excerpt, excerptHash, matchedBy`；matchedBy 为 keyword/vector/both。Tool 经第 5 节审计后另带 evidenceId；管理响应不带 Run evidenceId。format 使用扩充后的 KnowledgeFormat。

coverage=`{ eligibleChunks, indexedChunks }`，从本次 scope 与兼容空间计算，不拿全库覆盖冒充单 Run；effectiveMode=`keyword | hybrid | vector`，vector 表示本次只有向量路有结果，不承诺所有结果都两路命中。两路都无结果时按成功执行路径返回 keyword 或 hybrid。

降级原因：`semantic-disabled | model-unavailable | index-missing | index-partial | index-stale | embedding-failed | capacity-exceeded`。部分覆盖仍可 effectiveMode=hybrid 且 degradedReason=index-partial。超时/非法响应为 embedding-failed 并有安全诊断；外部用户取消抛 abortError，不返回降级结果。无关键词命中且语义失败时明确“语义失败，关键词无结果”，不是“资料不存在”。

## 10. 管理、集合与来源状态

### 10.1 集合

`KnowledgeCollection = { id, name, revision, createdAt, updatedAt }`。nameKey=NFKC(trim(name)).toLowerCase()，Vault 内唯一。默认全部/未分类为查询模式，不插入集合行。

表 `knowledge_collections` 保存上述字段及 name_key；`knowledge_collection_members` 为 `(collection_id,document_id)` 复合主键，FK 到 current document，删除集合/移除资料只级联成员。集合改名/删除要求 expectedRevision；成员用 replace-set 操作，携带 document 当前 membershipRevision，事务内替换，避免两个窗口互相覆盖。

KnowledgeDocumentSummary 扩充 `currentRevisionId, sourceStatus, sourceCheckedAt?, collectionIds, membershipRevision, lexicalState, semanticState`。正文、文件路径和内容哈希保持原协议语义。lexicalState=`ready | failed`；未成功导入文件仅存在 job item，不建立伪 ready document。semanticState 为查询设置与 generation 派生：`disabled | pending | ready | partial | stale | failed`，不把 job 状态复制为另一套可写状态。

### 10.2 来源检查

`sourceStatus = unchecked | unchanged | changed | missing | unreadable`，持久在 current document；sourceCheckedAt 仅成功完成一次检查时记录（包括 missing/unreadable 的确定结论）。新导入状态 unchanged，时间为实际读文件时间。

检查只接受登记 documentId，Main 取 sourcePath；比较当前原始字节 hash 与 current revision.contentHash。文件可读但超当前导入限额时标 changed，并提示超限，不能仅靠 size/mtime 声称内容一致。不存在为 missing，权限/其他读取失败为 unreadable；检查取消不改未完成项。状态是“截至某时”，不是实时保证。

打开原件仍经 Main 登记路径校验。旧修订和当前文件可能不同，界面分开“查看保存文本”和“打开本机当前文件”；来源已移除后，历史入口只看保存文本，不扩为任意路径 shell.openPath。

## 11. Office 导入

KnowledgeFormat 扩充 `xlsx | csv | pptx`；穷尽更新扩展名、文件选择器、format 标签、Schema/守卫和所有消费分支。原有 `extractDocument` 的默认 PDF 分支改为显式穷尽，不能让新类型走 PDF。

复用 `OfficeParserService`，增加接受已读取 bytes 的核心入口；任务 parseFile 也调用该核心，不复制实现。统一 abortError；读取前限额、解压累计流量在分配完整条目前检查、XML 文本/总展开/页与表上限延续 ADR-0018。若当前依赖不能在分配前实现限额，停下提出最小解析适配方案，不谎称事后 size 检查已经防住资源耗尽。

提取到 section 的确定性规则：

- PPTX 按 presentation.xml 的关系顺序，不按 slide 文件名；每页文本、每表、备注分别 section。Locator 为 `slide:N`、`slide:N/table:M`、`slide:N/notes`；备注按真实 slide 关系解析，不按显示序号猜文件。
- XLSX 按工作簿表顺序、行/列地址排序，每一非空逻辑行一个 section。Locator 显示 Sheet 名与范围；内部使用保存 section ordinal 读取，不从显示字符串重新猜 sheet。每个 cell 确定性序列化 address、value、formula、cachedValue（存在才写）；日期使用 ISO 文本；不计算公式。修复既有任务读取的 `sheet:` 前缀往返、含 `!`/引号表名处理，新增结构化定位适配，不破坏已接受旧 locator。
- CSV 仅 UTF-8（可 BOM）、逗号分隔、引号转义规则；每个逻辑记录一个 section，Locator `rows:N-N`；引号内换行不增加逻辑行号。单行超正文上限失败，不截断为合法完整表。
- Office warning 复用 `formula-without-cached-result | truncated | unsupported-feature`；本增量另加 `no-extractable-text` 作为导入失败原因，不把全空文件建立成可检索知识。出现 truncated 的旧解析结果不得直接发布为完整知识，转 `EXTRACTION_LIMIT_EXCEEDED`。
- XLSX 图片/图表、PPTX 图表/图片的内容不声称已提取；有不支持内容时显示 warning，仍可导入已提取文本。宏、外链、公式不执行，`.xls/.xlsm/.ppt` 不支持。

## 12. IPC、存储与事件映射

沿用现有 `knowledge.*` 命名风格在唯一 IpcChannel 定义新键；本表的逻辑 API 名决定 Preload 属性，实际 channel 字符串按现有命名惯例注册，不创建旁路 handler。

| 逻辑 API | 输入 | 输出/存储 |
| --- | --- | --- |
| knowledge.list | 现有查询＋collectionId/未分类过滤 | 扩充的文档摘要；Vault |
| knowledge.search | query、mode、collectionId? | §9 response；只允许 library scope |
| knowledge.listRevisions | documentId | §2 summary[]；Vault |
| knowledge.preview | documentId、revisionId、cursor?、maxCodePoints? | §3 page；无 Run 审计 |
| knowledge.previewRunSource | runId、evidenceId；不接受游标 | §3 exact/legacy 联合；精确页仅该证据 span，无续页，无新增模型读取 |
| knowledge.createResearchDraft | §4 输入 | 应用库 Task/Session/Context/操作回执 |
| knowledge.import | 既有系统对话框选择，不接收 Renderer 任意路径 | `{ jobId }`；取消文件对话框返回既有取消语义，不建 job |
| knowledge.refresh | documentId | `{ jobId }` |
| knowledge.rebuildIndex | kind=keyword/semantic；普通重建为非空 documentIds 或精确历史 references（二选一）；semantic 可选 resetSemanticSpace=true，此时不传目标，按 §8 全库当前修订快照 | `{ jobId }`；semantic 必须已启用；keyword 不接受 resetSemanticSpace |
| knowledge.checkSources | 非空 documentIds，最多 200 | `{ jobId }` |
| knowledge.jobs.list/get/cancel/retry | jobId、retry 的 itemIds；list 为游标分页默认 50/最多 100 | §8 job+item summaries；结果事件仅 ID/状态/计数 |
| knowledge.settings.get/save | save 带 expectedRevision、semanticEnabled、embeddingProfileId? | §7 设置与可用性；Vault CAS |
| knowledge.collections.list/save/delete | save/delete 带 expectedRevision；create 无 id/revision | §10 collection；Vault |
| knowledge.collections.setMembers | documentId、expectedMembershipRevision、collectionIds | 新 membershipRevision、collectionIds |
| knowledge.remove/openSource | 复用现有 documentId/path 校验接口 | 只改当前投影/只打开登记原件 |

`knowledge.jobs.changed` 事件携带完整 job summary 和单调递增的 `sequence`（按 job 持久化），Preload Zod 校验。Renderer 先加载快照再合并 sequence 更大的事件，卸载取消订阅；页面切换靠请求代号防迟到覆盖。sequence 不替代 attempt，前者为展示顺序，后者为发布资格。

长作业通知复用 NotificationService，目标为知识页对应 jobId，通知不能导航时清空当前 Task。取消不发失败 toast；对象可行动错误留内联，集合短成功使用 TransientToast。知识页不自建计时器/全局成功横幅。

应用库新增/扩充只涉及：研究草稿操作回执（operation_id/input_hash/task_id/context_id/prompt）、Evidence 精确来源列与索引、RunMaterialRead 精确字段及 §5 唯一约束重建、run_artifact_source_declarations（run_id PK、input_relations_json、tool_call_id、updated_at）、artifact_versions.source_declaration_kind。JSON 引用均由服务完整校验。与 Vault settings 的 profileId 不做跨库 FK。

## 13. 错误、迁移与验收

### 13.1 稳定错误码

复用既有统一取消和 IPC 错误封装，领域错误 code 与安全 message 分开；不得让所有异常只剩字符串。已有同义错误码直接沿用并在本表登记映射，不能新增平行枚举。

| 错误码 | 场景/结果 |
| --- | --- |
| KNOWLEDGE_NOT_SELECTED | Run 范围外读取，零正文/零新审计 |
| KNOWLEDGE_REVISION_MISMATCH | revision/document/hash/path 不一致，不回落最新 |
| KNOWLEDGE_CURSOR_INVALID | cursor 身份或偏移不合法 |
| KNOWLEDGE_READ_BUDGET_EXCEEDED | 累计读取预算耗尽 |
| KNOWLEDGE_AUDIT_FAILED | 来源/足迹事务失败，禁止返回模型正文 |
| KNOWLEDGE_DOCUMENT_REMOVED | 新草稿或管理动作指向已移除资料 |
| PARSER_NONDETERMINISTIC | 同解析身份得到不同文本，不覆盖旧版 |
| EXTRACTION_LIMIT_EXCEEDED | 文件、展开、提取文本超限，保留旧数据 |
| EMBEDDING_MODEL_UNAVAILABLE | 所选 embedding 模型/凭据不可用，无隐式 fallback |
| EMBEDDING_RESPONSE_INVALID | 非法向量、index、响应体、维度或格式 |
| EMBEDDING_TIMEOUT | 有限时间内未完成；作业失败/查询可解释降级 |
| INDEX_CAPACITY_EXCEEDED | 向量超本期规模上限；关键词保持 |
| INDEX_CONFIGURATION_CHANGED | 发布前发现空间/配置变化，旧 attempt 不可发布 |
| INDEX_ITEM_NOT_RETRYABLE | 重试目标不属于原作业、未终态或条目状态不在 failed/interrupted/cancelled 内 |
| SOURCE_DECLARATION_INVALID | 采用声明越界、未读整份材料或重复冲突 |
| OPERATION_CONFLICT | 幂等 ID 输入不同 |
| REVISION_CONFLICT | 设置/集合 CAS 失败 |
| COLLECTION_NAME_CONFLICT | 规范化名称重复 |

普通文件不存在/权限、格式不支持、无文本与解析失败保留具体 job item reason，不混同模型故障。未知异常使用 describeError 后脱敏，不在 UI 显示 stack。

### 13.2 迁移顺序与兼容

1. 开工核实每个库最新迁移号，各卡取下一号。不得将当前 Vault v3 或应用库版本写成未来固定迁移号。
2. Vault：重建修订唯一约束、给已存 section 计算 textHash；不重解析原件、不改 ID/hash/版本文本。新增派生块/FTS 可由已保存 section 离线建立；失败可以重建，不删除修订。
3. 应用库：旧 Evidence 保持原样，精确字段为空；旧成果标 legacy。Evidence 和 RunMaterialRead 的两组部分唯一索引必须同时落实，按现有 rebuildTable/事务/foreign_key_check 约定执行；旧足迹不回填虚构 toolCall/span。
4. 管理与索引卡按需追加各自表，不在第一卡预建所有空表/孤儿导出。所有迁移覆盖新库、v3/旧应用库、重复启动、失败回滚和外键完整性。
5. 两库升级各自原子，不声称联合原子。启动在必需迁移均通过后才开放知识动作；失败可见且保留可重试状态，不半初始化运行。
6. Tool/IPC 新签名同卡迁移所有调用方和测试；不保留暗中全库搜索的兼容支路。历史 Run 可回看，不自动重跑。

### 13.3 必需验证矩阵

- 身份：两路径同内容、同路径新内容、同字节解析升级、移除再导入、旧修订仍读、hash 不符、损坏文本/游标；搜索命中与 reference 同快照，选中后刷新不能按 latest 替换。
- 范围：Run 零材料零请求；同库未选资料不出现；历史不同 Workspace/Task 不串；过滤先于 topK；缩小材料范围不重放旧知识。
- 分页：空白 section、超长单段、多页、20 段边界、增补汉字、emoji 码点、预算 0/1/上限/超限、游标跨修订；同 section 后续页独立落库，不同 toolCall 重读分别占预算，同 toolCall 结果重复消费不重复计量。
- 来源：相同路径定位不同修订，先搜后读，重复 Evidence 返回相同 ID，不同 toolCall 不丢足迹，写库失败无正文输出；previewRunSource 严格止于证据 end、无 nextCursor，旧证据仅 legacy；选择/搜索/读取/声明四种事实分别断言。
- 声明：legacy 连续人工编辑仍未核实，none 继承不变成声明，model/user 声明才可变 inherited，明确重新选择或清空才写 user，旧版不回写。
- 模型：乱序/缺失/重复 index、NaN/Infinity/零向量/混合维度/非法 JSON、超响应字节、超时、取消、profile 测试只改 updatedAt、不变 fingerprint；切模型必变，换 key 不变空间但取消旧请求；跨修订共享维度锁，冲突批次拒绝。
- 作业：全成功/部分成功/全失败、队列取消、处理中取消、发布前崩溃、重启 interrupted、迟到响应、重试只处理指定目标；普通同空间失败重建保留旧 active；同名同维度强制重建立即排除全部旧空间，部分成功/取消不回退，重试不重复 reset。
- 检索：FTS、中文 substring 回退、标题命中、向量命中、RRF 同分、重叠去重、缺索引与部分覆盖、空结果不谎称无资料、模型故障不假成功；强制重建与查询交错不返回 retired space 候选。
- Office：合成文件含公式缓存与缺缓存、特殊 Sheet 名、CSV 引号内换行、PPTX 关系顺序与备注、损坏/加密/超限/取消、不支持内容警告；不得复制用户材料到测试。
- UI：空态、错误态、选择清空、创建草稿幂等、未保存旧草稿保护、切页迟到、刷新/移除/分类不改既有任务、当前 Run/历史 Run 与新旧成果声明标签；草稿提交成功但响应丢失、随后移除资料，同 operationId 重试返回原任务。

性能门槛为**待测目标**：macOS arm64，10,000 个 1,536 维向量，纯本地扫描与融合 warm p95 <= 1 秒；记录 20 次样本、机器与索引规模，排除 HTTP 耗时；处理时 UI 无长同步阻塞。达到 20,000/4,096 上限另做资源边界与取消测试，不承诺相同延迟。Worker 增量 RSS 目标 <= 256 MiB，向量批上限必须实测；不满足先修方案，不藏回主线程。

语义效果另行授权：使用共同确认的合成中文资料和 20 个同义改写问题，事先固定相关资料标注；目标 top5 命中不少于 16 个，与关键词基线并列报告，不能以替身向量证明真实模型质量。用户模型不可用时此项待验，不阻塞已完成卡的自动证据登记，但最终 KM15 不可 done。

工程检查使用本仓唯一 `npm run verify`；不接管道截尾。UI 与真实模型验收由光哥另行安排，自动测试、人工 UI、真实模型三栏分别记录。文档归档不运行这些命令，也不借此宣称新功能可用。
