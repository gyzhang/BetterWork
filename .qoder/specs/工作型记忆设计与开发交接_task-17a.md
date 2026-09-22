# 算台工作型记忆：设计、开发计划与编码交接总稿

## 0. 文档状态与使用方式

- 设计日期：2026-09-22，取自本轮 `date` 命令。
- 状态：**近期产品范围已获用户确认；本稿具体技术决策待评审。未实施业务代码。**
- 本稿同时包含产品设计、架构决策、实施契约、任务卡和编码提示词，可以独立交给后续编码任务，不依赖前序聊天。
- 本轮将上述产物集中保存为本交接总稿。规范目录中的五份文档尚未创建；WM00 仅负责按本稿分拆归档、链接和核对代码基线，不重新设计。
- 后续使用 Qwen3.8-Flash 逐卡开发。设计批准、单卡开发授权、真实模型调用授权和提交发布授权相互独立；不得自动连续开工或提交、推送。
- 当前只读基线：HEAD `bfc66cd`，应用数据库最新迁移 v25；这些不是未来开工时的固定值。每卡重新核对。
- 已存在未跟踪文件 `docs/logs/2026-09-22.md`，不得覆盖或删除。归档时按实际时间追加本任务记录。
- 本轮没有运行应用、测试、数据库诊断或浏览器验收。下文风险来自静态核查，不能写成已复现、已修复。

## 1. 产品定位、目标与范围

### 1.1 核心定位

算台面向产品负责人、运营分析人员、顾问、研究员及经常制作报告和方案的个人知识工作者。聊天是协作入口，专业工作成果是交付目标，不建设通用陪聊应用。

记忆的产品承诺是：**让下一次工作继承已确认的工作积累，减少重复说明和重复错误，而不是保存更多聊天。**

用户应能回答：记住了什么、来自哪里、适用于哪里、何时失效、这次是否带入、怎样纠正或停止使用。

### 1.2 本轮设计范围

| 近期开发范围 | 明确不进入近期开发 |
| --- | --- |
| 人工保存、纠正提炼、候选确认与拒绝 | 全量聊天扫描、定时反思 |
| 非向量任务相关召回及预算 | Embedding、向量数据库、知识图谱 |
| 精确运行记录和历史重放隔离 | 通用 Agent 引擎、通用 DAG、通用作业平台 |
| 去重、冲突提示、人工替代、有效期 | 模型自动确认、依据置信度自动覆盖 |
| 工作空间只读派生简报 | 新 Project 实体、企业权限、多租户 |
| 用户指定历史成果精确版本并引用 | 自动成果差异学习、经验自动转 Skill |
| 旧数据迁移与来源复核 | DOCX 新增生成能力、云同步、完整历史物理擦除 |

### 1.3 概念分工

- Knowledge：用户资料及事实依据。
- Memory：用户确认可复用的偏好、上下文、方法和经验。
- TaskContext：本任务目标、材料选择、能力和临时排除；不新增长期 Task 记忆。
- WorkspaceBrief：现有事实的可重建视图，不是新的事实库，不整体自动注入模型。
- ArtifactReference：用户指定一个精确成果版本作为参考，不等于内容正确、审批通过或已被本期读取。

四种用户视角映射现有 kind：工作偏好→preference；背景/共识→semantic；工作方法→procedural；历史经验→episodic。四种作用域继续为 user、workspace、expert、expert-workspace。

### 1.4 成功标准

首个完整旅程：纠正业务口径 → 确认适用范围 → 新独立任务相关召回 → 新成果不再重复同一错误。

技术硬指标：候选自动确认、未授权跨空间注入、关闭自动建议后的自动模型请求、重复提交新增多余修订、已撤销记忆经历史回流，均为 0。排序及预算通过固定合成用例验证。

产品指标只定义采集口径，不编造基线或提升比例：候选采纳率＝确认候选数/已展示候选数；建议负担＝每个完成任务展示的候选数；重复纠正次数由用户标记；复用满意度由用户对下一次成果反馈。模型调用耗时和 usage 只记录真实返回值，不把 code point 换算成实测 token 或费用。

## 2. 已有能力和前置风险

### 2.1 实际可复用基础

- `packages/agent-protocol/src/index.ts`：MemoryRecord、四作用域、状态、TaskContextRevision、精确材料引用、IPC Schema。
- `apps/desktop/src/main/persistence/memory-repository.ts`：修订化记忆、作用域过滤、运行记忆引用。
- `apps/desktop/src/main/services/memory-service.ts`：创建更新编排及 Markdown 只读投影。
- `apps/desktop/src/main/services/run-service.ts`：运行准备、模型解析、上下文装配和工具执行。
- `apps/desktop/src/main/services/task-material-service.ts`：精确 KnowledgeRevision、ArtifactVersion、FileSnapshot 校验。
- `apps/desktop/src/main/services/discussion-checkpoint-service.ts`：人工讨论反馈和替代节点。
- `MemoryView.tsx`、`use-memories.ts`、`ContextPanel.tsx`：现有管理、任务排除和展示入口。
- ArtifactVersion → 材料快照 → 实际读取 → ArtifactInputRelation 已有链路，不新造来源系统。

### 2.2 必须验证的静态风险

1. 记忆写 IPC 把异步服务结果放进 `{ memory: Promise }`，外层 helper 不等待对象属性；可能数据库已写入而响应校验失败。WM01 用真实注册回调及异步服务测试复现。
2. 投影失败发生在数据库提交之后，不能继续当作“保存未成功”；并发重建需保证旧投影不覆盖新状态。
3. 当前查询无任务内容匹配：范围/时间排序→先取 16 条→预算→任务排除，存在无关项占位及排除后不补位。
4. 现有 run_memory_reads 在模型准备前记录，不能称为外部模型已经收到。
5. 历史重放只处理材料严格子集缩小，遗漏材料替换、记忆删除/过期/排除；取第一个 message.completed 也不一定是最终回答。
6. 来源 sourceId/sourceLocator 为自由字段，不能仅凭存在或字符串格式认定归属、当前可访问性。
7. `supersedesId` 实际指同一记忆前一 revisionId，不是跨记忆替代关系。
8. 用户消息没有独立持久化 messageId；应使用 runId 和 promptHash，不使用 Renderer 临时消息 ID。
9. 成果保存、导出、Run 成功、讨论节点保存均不是业务批准事实。

E30–E32 的历史 done 保留；新卡记录补强范围和证据，不静默追认缺失行为。E55/E56、CF11 等外部验收仍属原任务板。

## 3. 产品行为与交互设计

### 3.1 人工保存经验

入口：现有记忆页“新增”；用户发言、助手回答、讨论节点的“保存为经验”；成果版本详情的显式保存入口。

打开可编辑表单，字段为内容、分类、适用范围、可选议题、可选有效期、来源说明。选中片段可预填；不再把助手回复前 2,000 字直接当作完整经验。来源最长 500 字，正文可编辑至 2,000 code points。

有专家默认 expert-workspace，无专家默认 workspace。用户在最终保存表单明确提交后可直接 confirmed，不调用模型。自然语言“记住”如果需要模型理解和提炼，仍生成候选卡供确认，不用关键词正则绕过确认。

工作空间事实不直接改成全局记忆。user 仅用于用户通用偏好，expert 用于专家通用方法；提升全局须用户重新表述并声明通用性。

### 3.2 自主口径与资料派生结论

- **自主口径**：用户在表单明确制定的、自包含的工作要求。可跨期换材料继续使用；不授予读取原文件的权限。
- **资料派生结论**：来自助手分析、材料、历史输出的事实或经验。普通确认保留来源依赖；新 Run 必须满足其材料与记忆依赖，不能通过“记住”绕过材料选择。
- 用户可将资料结论重新表述为自主要求，但必须走“作为我的工作口径重新保存”，显示差异并创建新人工来源，不在后台静默解除依赖。
- 自动候选均按派生处理；确认表单可明确选择上述重新表述路径。这样保守来源控制不会迫使自主业务口径每期重选旧资料。

### 3.3 自动建议

每个工作空间独立开关，默认关闭。开启前说明：会向当前已选模型发送最小必要片段，可能产生费用；远程模型会接收这些片段；不会扫描历史、读取未选资料或自动确认。

自动触发仅两处：Run 成功终态已提交；用户提交含非空 feedback 的讨论节点。失败/取消 Run 不自动提炼，但仍可人工保存。开关开启不回填旧任务。

每次最多 3 条建议；0 条是成功结果。候选在相关任务中的轻量“经验建议”区及设置中的记忆页集中展示，不自动打开侧栏，不逐条全局 Toast。

关闭开关取消当前空间尚未完成的自动提炼作业，不删除已确认记忆。作业可取消、失败后手动重试；重启不自动触网。

### 3.4 候选与治理

候选显示正文、来源、范围、依赖、可能冲突和有效期。动作：编辑并确认、暂不采用、删除。编辑并确认必须原子提交。

“暂不采用”抑制同范围同内容重复建议，可在管理页恢复为待确认；deleted/superseded 不复活，只能显式新建身份。

冲突并列呈现来源和范围，文案为“可能冲突”。用户可替代旧规则、修改范围/有效期、确认两条适用条件后保留或暂不处理。系统不根据置信度、更新时间判断业务真假。

自然到期不需要定时作业：查询派生“已过期”；重新启用必须明确修改有效期并确认。删除文案区分“以后不用”“历史仍保留”“正在运行不热更新，可取消重跑”。

### 3.5 本任务排除与运行可见性

既有上下文面板按需展开：

- “下次运行可用”：当前候选范围预览，不是实际使用记录。
- “本次运行记忆”：精确修订、顺序、选择理由和请求阶段。
- “历史上下文调整”：被截断的历史轮次及可解释原因。

阶段文案：selected＝已选入准备；request-prepared＝已构造成请求上下文；dispatch-attempted＝已尝试调用模型；legacy_unknown＝旧版记录，无法确认请求阶段。禁止显示“模型已收到/已阅读”或声称因果影响。

本任务不用只更新 excludedMemoryIds；完整保存 TaskContext 时保留 executor、Skill、materials、modelReference、builtinToolPolicy、MCP 等其他字段。冲突保留草稿，不能覆盖别人更新。

### 3.6 工作空间简报与参考成果

复用 WorkspaceSelector 的空间入口及可关闭上下文面板，不增加一级导航或启动表单。

简报包含：已确认目标、约束、决策、方法；开放讨论节点（标明未决事项）；用户指定的参考成果版本。内容来自查询，不用 LLM 二次总结、不持久化简报正文、不整体注入模型。每条可跳转来源。

成果版本增加“指定为本空间参考版本”“取消参考”“引用到当前任务”。固定 versionId/contentHash，不跟随 latest。标记只表示参考选择，不表示批准。

同空间支持现有 Markdown/PPTX 的精确引用；新建任务入口可复用这两类版本，创建草稿而不自动发送。现有读取能力不支持的格式不伪装可用，不趁机扩展 DOCX。

新任务默认沿用来源 Run 快照中的专家身份，使用该专家当前可用修订；历史快照缺失或专家不可用时用通用助手并提示，不猜专家。Skill/工具配置依现有专家新任务预设解析；不继承旧 Task 的本期材料、排除列表或运行授权。当前任务加引用不改变当前专家。

### 3.7 反馈规范

局部短时成功复用 TransientToast；当前表单可处理错误使用内联错误；长操作仅在确需跨页回看时使用现有通知中心。候选结果本身可见时不重复通知。所有新 Hook 使用 reportAction/trackAction 和迟到响应防护，视图不直接调用 IPC。

## 4. 架构决策草案

拟新增 `docs/adr/0026-work-centered-memory.md`，编号在归档时重新查重。

1. 保留 SQLite 记忆修订为唯一真相源，Markdown 只读投影不参与运行读取。
2. 保留四作用域及 kind；新增细分类、结构化来源、人工操作审计和跨记录替代关系。
3. 自动提炼为 Main 层无工具单轮作业，复用模型配置和凭据，不新增模型设置或 Agent 引擎。
4. 首期在 SQLite 范围过滤后使用内存确定性中英文本匹配；不引入 FTS/向量依赖。未来索引仅是可重建优化。
5. 任务相关性优先于作用域桶排序，保留小额通用偏好预算。
6. 新 Run 固定记忆修订与安全历史；普通治理变化影响下一 Run，不热改活跃 Run。
7. 区分选中、请求装配、调用尝试，保留精确版本和哈希，不存第二份完整模型请求。
8. 简报为只读派生视图；参考标记为版本级用户选择。

关系：延续 ADR-0004 的混合记忆边界；细化 ADR-0015 来源/确认/失败语义，并明确替代其固定范围优先排序、Unicode 长度含糊表述及“选中即实际注入”的解释；补足其范围缩小重放要求。对于自然语言“记住”，明确：未经用户核对的模型提炼不是用户确认原文。

保留 ADR-0014 的材料范围、ADR-0005 的版本与来源、ADR-0019 的讨论节点事实边界。旧 Accepted ADR 只追加替代关系，不改写原接受历史。对旧无 TaskContext 路径的全库兼容访问收敛为明确空材料范围，属于此 ADR 的显式安全变更，不静默修改产品承诺。

## 5. 通用实施契约

### 5.1 基础类型、长度与时间

- ID 延用已有稳定身份约定；新 operationId 为 UUID。跨进程全部定义在 agent-protocol 唯一入口。
- 本稿所有“字符数”均为 Unicode code points。正文、摘录和预算用同一计数函数；token 是独立模型额度。
- content：人工 1–2,000；自动候选 1–500；source excerpt ≤500；topicKey ≤80；参考 label ≤120。
- 时间为非负 epoch milliseconds；有效区间为 validFrom ≤ now < validUntil；缺省端点无界。
- contentHash＝保存正文 UTF-8 的 SHA-256。normalizedHash 仅做 NFC、换行统一和首尾空白去除后计算，不丢数字、单位、标点或否定词。
- 稳定序列化 JSON：对象键排序，语义有序数组保留顺序，集合先按精确引用键排序；不包含 secret、AbortSignal 和临时消息 ID。
- 日期 patch 为 `{ action: 'set', value }` 或 `{ action: 'clear' }`；省略表示保留。set 与 clear 不可同时出现，不使用 undefined 猜清空。

### 5.2 MemoryRecord 增量

保留既有 id/revisionId/revision/scope/kind/content/sourceType/sourceId/sourceLocator/confidence/status/validFrom/validUntil/supersedesId/contentHash/createdAt/updatedAt。

| 新字段 | 含义 |
| --- | --- |
| facet | goal/constraint/decision/fact→semantic；method→procedural；preference→preference；experience→episodic |
| topicKey? | 可见、可编辑的议题标识，仅用于提示潜在冲突，不是权限或事实键 |
| normalizedHash | 确定性重复检测 |
| provenance | 版本化来源联合，见下节 |
| candidateDisposition? | 仅 candidate 有 pending/rejected，其他状态省略 |
| replacesRevisionId? | 不同 memoryId 的被替代精确旧修订；supersedesId 仍指本身份上一修订 |

每次编辑/状态变化追加修订。相同内容无变化的提交返回 unchanged，不堆积空修订。终态 deleted/superseded 禁止编辑、确认、续期或恢复。

### 5.3 来源和依赖

`provenance` 为 schemaVersion=1 的联合：

- legacy：`verification:'legacy-unverified'`，保留原 sourceType/sourceId/sourceLocator，不补造来源或确认时间。
- verified：`verification:'verified', authority:'user-instruction'|'derived', capturedAt, sources[1..3], materialDependencies[0..200], memoryDependencies[0..100], originWorkspaceId?, genericDeclaration?`。
- 新自主全局表单可无 originWorkspaceId；所有空间来源必须有真实 originWorkspaceId。user/expert 全局仅允许 user-instruction，来源依赖为空且 genericDeclaration=true。

结构化 SourceRef 分支：

| kind | 必需身份与版本 |
| --- | --- |
| manual | operationId、提交正文哈希 |
| run-user | runId、promptHash |
| run-assistant | runId、真实 message.completed eventId、事件正文哈希 |
| checkpoint | checkpointId、结论/反馈/引用的 contentHash；排除 status/updatedAt，节点被替代不伪造内容变化 |
| artifact-version | artifactId、artifactVersionId、contentHash |

每项附 excerpt、excerptHash、可选 locator。Main 读取已登记实体生成哈希；Renderer 只提交选择器，不能自报来源真实性。摘录使用 code point 起止位置 start/end（左闭右开），Main 验证范围和文本一致。人工表单来源直接使用最终提交内容。

自动候选及从助手/成果提炼的记录继承来源运行直接和重放的材料、记忆依赖；模型无权删依赖。依赖超额或无法证明时跳过自动建议，不静默截断。依赖记忆保存 memoryId、revisionId、contentHash，按版本检查，并在创建时展开来源依赖、拒绝循环。

来源有效性分三层：历史可审计、用户可查看、当前可带入模型。Knowledge 历史修订还在不等于当前登记有效；材料派生内容进入模型仍要求精确依赖在本 Run 允许材料集合。记忆派生内容依赖旧记忆时，后者删除/修改/排除/失效应使前者待复核，不能重新包装后绕过遗忘。

自主口径重新保存是新 manual 来源、空模型依赖；在操作回执保留 fromMemoryRevisionId 供审计，但不假装原资料事实已核实。

### 5.4 确认、拒绝、替代

- create 只接受用户最终表单，Main 决定 confirmed；不接受任意 status。
- 模型候选仅由内部服务写 candidate/pending，无公开“模型确认”API。
- set-status 改成 action：confirm、reject、restore-candidate、expire、delete、reconfirm；由状态转移表验证。
- confirm/reconfirm 可含编辑 patch，检查一个 expectedRevision，在同一事务完成编辑和确认。
- candidate/rejected 只能恢复 pending 或删除；expired 可明确修改有效期并重新确认；deleted/superseded 是终态。
- 替代要求新旧记录处于同一规范 scope；否则提示先明确范围，不允许一条局部例外把全局规则作废。
- replace 事务校验两条 expectedRevision，确认新规则、旧规则追加 superseded、写 replacesRevisionId 和裁决/回执，任一步失败全回滚。

### 5.5 冲突策略

同一非空 topicKey、作用域交集、有效期交集、不同 normalizedHash ⇒ 潜在冲突，不认定真假。无 topicKey 不做语义矛盾识别，本期不调用额外 LLM 或使用不可解释启发式。

candidate 与 confirmed 的冲突提示不阻塞既有 confirmed。两条已确认冲突且未裁决时，当前召回排除这组规则并给出可见“存在待澄清口径”的摘要，不自动挑一个，也不展示越权那条正文。用户可继续无关工作；相关业务结论应先澄清。

keep-both 需用户填写 applicabilityNote（1–300），绑定精确修订对；以后共同召回时同时带入条件说明，组内两条不能因预算只带一条。任一修订变化使该裁决失效。无法写出适用条件时不要确认共存。

本期不声称自动识别新上传材料与记忆的全部语义冲突。当前指令/明确本期规则优先的上下文说明仍保留；自动化验收只证明上下文和冲突组处理，语义冲突处理用人工旅程验证。

### 5.6 幂等与投影

所有用户写命令带 operationId；已有实体另带 expectedRevision。相同 operationId＋相同请求哈希返回原提交效果和当前最新展示状态；同 ID 不同请求返回 IDEMPOTENCY_CONFLICT。

事务包含业务修订和回执；不跨网络持有事务。重复自动候选按 scope＋normalizedHash 抑制；与已拒绝候选相同也抑制；恢复候选后才重新进入待审列表。

投影在数据库提交后重建，使用单实例串行队列、唯一临时路径及原子 rename；合并重建请求但不得旧覆盖新。成功回执可带 PROJECTION_PENDING，不能把已提交误报成保存失败。来源待复核、candidate、deleted、superseded、expired 不进入有效投影。

维护只读 manifest 标识受管投影文件；仅清理 manifest 登记的旧受管文件，不遍历删除用户资料。DB 与跨文件投影不宣称原子，投影失败可见且可本地重建；模型永远不从投影读取。

## 6. 确定性召回与历史上下文

### 6.1 召回输入及算法

Main 构造 MemoryQueryContext：workspaceId、expertId?、taskId、精确 TaskContextRevision、evaluatedAt、prompt、任务标题、已选材料标题、excludedMemoryIds。preview 接受草稿 prompt 但不写读取足迹；真实 Run 独立重新计算。

过滤顺序：最新修订 → confirmed/生效 → scope → 任务排除 → verified 来源可用 → 材料/记忆依赖可用 → 潜在冲突组 → 内容相关性 → 预算。

固定 `memory-recall-v1`：

1. 检索文本 NFKC、英文小写、空白归一，不修改原文哈希。
2. 中文连续汉字重叠 bigram；单汉字查询作低权字符匹配。英文数字 token 为连续字母/数字，可含内部小数点、下划线、连字符。分词为纯函数，不依赖平台词典。
3. 固定过滤词：中文 bigram 为“请帮、帮我、一下、进行、根据、这个、这次、需要、我们、任务”；英文为 a/an/the/and/or/to/of/for/in/on/is/are/please。列表改动需升算法版本并更新 fixtures。
4. 查询＝prompt（≤4,000；超限取首尾各2,000）、任务标题≤200、按精确引用键排序的前10个已选材料标题（各≤120）；不读取材料正文。记录是否截取。
5. 记录检索文本＝topicKey＋content。bigram/英文数字权重3，单汉字权重1；score＝floor(1000×命中 token 权重和/查询与记录 token 并集权重和)。至少2个命中 token；查询本身只有1个 token 时允许1个。
6. 排序：score DESC → scope 特异性 expert-workspace/workspace/expert/user → updatedAt DESC → id 字节序 ASC。confidence 不参与排序。
7. 无命中不拿最近记录填满；无相关记忆是正常结果。

### 6.2 预算

- 通用偏好小池：仅 verified＋user-instruction＋user＋preference，最多2条、600 code points；按更新时间/id稳定选择，可无内容命中。
- 总计最多16条、正文6,000 code points，偏好计入总额；未用配额交还相关记忆。
- 包装/标签/适用条件另限2,000，整体记忆块≤8,000 code points。
- 跳过无法完整容纳的记录后继续尝试更短记录，不先截16条再排除；keep-both冲突裁决组按整组选择或跳过。
- 记录选择顺序、score、理由码、预算计数及排除原因统计。不可记录越权记忆正文；不把预算落选当作授权撤销。

### 6.3 安全历史重放

对所有新 Run 统一处理，包括旧通用入口。已有 TaskContext 的任务必须提交并匹配最新修订；真正没有上下文的任务由 Main 生成明确 general＋空材料上下文，不代表全 Workspace/全知识库可读。

候选历史只取同 Task、completed、createdAt 早于当前 Run、completedAt 不晚于当前准备时点的运行。取按事件 sequence 最后的非工具最终 message.completed；不重放 reasoning、工具调用或别的任务。若不能确认最终回答，跳过并记录原因。

安全性检查使用**直接＋传递依赖**：历史实际记忆修订、重放继承记忆、历史已选/实际读取材料的保守并集。旧记录缺依赖事实则不推断安全。

以下情况使依赖历史不可重放：记忆被删除/排除/替代/过期/改修订/缩scope、来源不可用、依赖材料移除/换版本/哈希不符；相关记忆本次无命中或预算落选不使历史失效。纯增加材料也不应无故截断。

从最近历史向前选连续安全后缀，遇首个不安全轮次停止，不跨过它拼接更早对话。上限8个完整问答对、12,000 code points；容不下完整一对就停止。记录实际重放 runId/finalEventId/promptHash 及依赖；不让更近回答隐藏它继承的已撤销信息。

contextSegmentId 保留为展示分段，不作为唯一授权闸门。历史 UI 保留，模型请求不带不安全历史；没有模型二次摘要绕回被删除内容。理由码：memory-revised、memory-excluded、memory-inactive、source-unavailable、material-removed-or-replaced、legacy-provenance-unknown、history-budget。

### 6.4 运行准备和请求阶段

异步准备不跨 await 持有事务；写入快照前在同步事务重验 TaskContext 最新修订及相关记忆版本，期间变更则返回可操作的上下文冲突。外部来源检查完成后仍须按现有工具边界在实际读取时核验，不能由记忆授予权限。

运行记录阶段：selected → request-prepared → dispatch-attempted，阶段时间单调；旧记录 legacy_unknown。

Main 的 Provider 包装器在首个实际 ModelRequest 装配后计算规范化 requestHash，核对记忆块修订，持久化 request-prepared；开始消费委托 Provider 前持久化 dispatch-attempted。任何阶段持久化失败均不发起该次请求，主 Run 按现有失败机制收口。

不保存完整请求副本、不记录密钥、不把调用尝试当作网络已成功。后续工具回合继续使用固定记忆，无需新建逐回合记忆日志。普通记忆编辑/删除只影响新 Run；活跃 Run 如需刷新，由用户取消并重跑。现有材料/工具撤销机制不因本设计放松。

## 7. 模型提炼作业

### 7.1 模型与 Provider

从 RunService 提取 Main 内共享 `model-provider-factory.ts`，复用 model profiles、默认模型解析和 credential-access；Agent Core 不导入数据库。普通 Run 兼容行为保持，提炼使用 requireConfiguredLanguageModel 模式，禁止生产 FakeProvider 回退。

在新 Run 审计中保存实际解析的 modelProfileId 和非敏感配置指纹；提炼沿用来源 Run 的模型。无 Run 的讨论反馈使用当前 TaskContext 的模型。配置不可用/指纹变化则 skipped，不暗换另一服务；手动重试需展示当前模型并重新同意。配置指纹不含凭据；历史摘要只存清除 query、userinfo 的 endpoint 展示值，不存 URL token。

ModelRequest 增加可选 maxOutputTokens；实际发包为 min(请求上限, profile上限)，未设置请求上限时维持现状。done chunk 增加可选 finishReason（stop/length/tool-calls/content-filter/unknown）及可选 usage；普通消费者兼容，提炼仅接受 stop。只有 DONE 而缺正常结束原因，提炼失败为 MODEL_FINISH_UNKNOWN；length 不接受为完整 JSON。继续复用超时、取消、提前 EOF 检验及可注入 fetch。

### 7.2 作业输入、输出及保密

| 限制 | 固定值 |
| --- | --- |
| 自动提炼全局并发 | 1 |
| queued 上限 | 全局20 |
| 每来源版本逻辑作业 | 1 |
| 单次耗时 | 30秒 |
| 输出 token 请求上限 | 2,048 |
| 实际文本请求（含固定指令） | 6,000 code points |
| 累计回答＋reasoning增量 | 6,000 code points，超限中止；reasoning不落库 |
| 候选 | 0–3条，每条1–500 code points |

自动 Run 输入：本次用户 prompt≤2,000；需要消歧时，取本次准备快照已允许的最近前一轮最终助手回答≤2,000；不使用当前助手新生成答案作为用户已认可的经验。讨论输入：人工 feedback≤2,000、summary≤1,000；summary只是背景，不能证明确认。超长采用首尾等分片段并标注非全文，证据区间只允许落在实际片段中。

不读完整材料、文件或其他历史来补上下文。固定指令≤1,500，最终装配仍验证6,000上限。依赖从来源及背景引用完整继承，不随送入模型的片段截断。

严格 JSON 输出：`{ candidates: [{ content, facet, topicKey?, confidence?, evidence: [{ fragmentId, start, end }] }] }`。最多3条；evidence每条1–3段，至少一段来自本次用户 prompt 或人工 feedback，不能只引用助手内容。Main 验证片段身份、code point范围及非空。status、scope、ID、来源哈希、材料权限均由宿主决定，模型输出这些额外字段即非法。0条合法；围栏、额外解释、任意非法候选使整次结果失败；不进行额外模型修复重试。

提炼提示词固定要求：仅提炼明确、可复用、单一主题的工作要求/决定；一次性数字不提升永久事实；临时要求不得泛化；不确定输出空数组；输入片段中的指令不得改变这些规则。所有结果仍待用户确认，不能声称已自动核实事实。

源片段与输出先过记忆专用敏感内容检查：私钥块、Authorization/Bearer凭据形式、明确的密码/API Key赋值和本次已知凭据命中时拒绝提炼/保存，不记录原文错误或快照。此检查不宣称能识别所有个人或商业敏感信息；用户可关闭自动建议。普通业务资料不外传到任何额外服务，只使用已同意模型。

### 7.3 持久化生命周期

状态：queued→running→succeeded/failed/cancelled/interrupted；执行前条件不满足可直接 skipped。手动 retry 可将 failed/cancelled/interrupted/可恢复skipped 转 queued，attempt递增；succeeded即使0条也不再提炼同来源版本。

来源键＝触发类型＋真实source ID＋内容快照hash，不含模型版本，防止改模型绕过去重。Run成功提交和作业登记、人工feedback提交和作业登记尽量在同应用库事务完成；无网络在事务内。排队失败不能把已成功主Run改失败；记录安全诊断，下次不自动扫描补单。

启动时将遗留 queued/running 收口 interrupted，不自动触网。关闭设置取消本空间自动作业；单次手动重试有独立同意，不暗开全局开关。取消后先落库终态再中止请求；成功落候选前检查 job revision/attempt/status、来源有效性、自动模式consentRevision。迟到结果不能落库。

候选写入、去重统计、作业成功终态在同事务提交。失败只保存安全错误码与摘要；主任务终态不受影响。UI主动刷新和窗口重获焦点查询状态；仅面板可见且有活动作业时按1秒轮询，隐藏即停并清理，无自造成功提示计时器。

## 8. 持久化与迁移清单

### 8.1 既有表增量

字段以 camelCase↔snake_case一一映射；JSON列后缀 `_json` 且用版本化Zod验证，NULL映射省略。所有新时间/枚举/数量校验在共享Schema和领域层一致。

| 表 | 新增字段 |
| --- | --- |
| memory_records | facet、topic_key?、normalized_hash、provenance_json、candidate_disposition?、replaces_revision_id? |
| run_memory_reads | selected_for_injection、replayed_via_run_ids_json、provenance_state（known/legacy_unknown） |

run_memory_reads 继续以 runId＋memoryRevisionId 唯一；直接注入和历史继承可同时成立。MemoryRecord稳定id在修订表不唯一，不得建立指向id的错误单列外键；精确引用指向revision_id。

### 8.2 新增六张内聚表

| 表 | 字段与约束 |
| --- | --- |
| memory_operations | operation_id PK、operation_kind、request_hash、result_json、committed_at。回执保存提交实体/修订/确认动作/来源声明，不复制全文。仅记录成功事务；错误重试不伪装成功。 |
| memory_conflict_decisions | id PK、operation_id UNIQUE、left_revision_id、right_revision_id、decision（keep-both/replace）、winner_revision_id?、applicability_note?、created_at；左右规范排序，绑定精确修订。 |
| run_memory_contexts | run_id PK、schema_version、phase、recall_version、evaluated_at、query_hash、policy_snapshot_json、selected_items_json、replay_json、material_dependency_union_json、memory_dependency_union_json、decision_summary_json、authorization_hash、model_snapshot_json?、request_hash?、selected_at、request_prepared_at?、dispatch_attempted_at?、updated_at。 |
| workspace_memory_settings | workspace_id PK、revision、auto_suggest_enabled默认0、consent_version?、consented_at?、updated_at；无行视为revision0/off。 |
| memory_extraction_jobs | id PK、source_key UNIQUE、workspace_id、task_id、run_id?、checkpoint_id?、source_snapshot_json、source_version_hash、material_dependencies_json、memory_dependencies_json、model_profile_id?、model_snapshot_json?、trigger（automatic/manual-retry）、consent_revision?、status、revision、attempt、input_code_points、output_code_points、usage_json?、result_json?、error_code?、created_at、updated_at、started_at?、finished_at?。 |
| workspace_artifact_references | id PK、workspace_id、artifact_version_id、content_hash、label?、status（active/removed）、revision、selected_at、updated_at；workspace_id＋artifact_version_id UNIQUE，同空间active≤20。 |

run_memory_contexts 中：selectedItems＝memoryId/revisionId/hash/order/score/reason；replay＝runId/finalEventId/promptHash和边界理由；decisionSummary＝各原因计数和合法范围内最多50个身份/原因，不复制被排除正文；policySnapshot保存算法版本及全部预算；依赖union保存精确引用，不得只存摘要文本。

索引：memory最新修订及scope保留，补scope＋normalized_hash、topic_key；job(status,created_at)；reference(workspace_id,status,selected_at)；精确修订/Run外键查询索引。

### 8.3 外键和删除边界

Run审计子表随Run CASCADE；被历史引用的记忆修订及冲突裁决使用RESTRICT，保留解释能力。多态/跨知识库来源使用结构化引用＋Main校验，不声称SQLite能做跨库原子外键。

Workspace/Expert常规移除不得绕过已有历史引用约束；若现有删除入口会物理级联，WM02在其删除边界加引用预检并返回可操作阻止信息，不能静默级联清除历史或关闭外键。本期不新增彻底擦除Workspace历史的流程。测试必须覆盖跨空间引用造成的父对象删除约束，并保留原有无引用对象删除行为。

### 8.4 迁移批次与兼容

不改旧迁移。各批在开工时使用最新连续版本号：WM02治理字段/operations/conflicts；WM05运行依赖与阶段表；WM09设置/jobs；WM12参考标记。不要预填固定v26–v29而与CF争号。

Legacy：保留原id、revision、status、contentHash；facet仅按kind机械映射，来源标legacy-unverified。历史confirmed显示“已确认，来源待复核”，不自动注入新Run；用户补来源生成新修订或重新提交自主口径。旧reads仅标legacy_unknown，不回填发送时间、请求hash或伪造确认人。

WM02先扩展仓储形状，公开旧调用方切换在WM03一起完成；来源新门禁从WM03启用，同时提供复核入口，不能先全禁用再让用户等下一卡。

每批真实SQLite验证：新库、历史数据升级、重新启动幂等、故障回滚、索引重建、完整foreign_key_check。失败不能降级到内存记忆、跳迁移或继续半初始化。Markdown投影可重建，不改用户源文件。

## 9. IPC、DTO与错误契约

### 9.1 统一结果与最小公共对象

仅记忆/简报/参考新增家族使用 `Result<T>`：成功 `{ok:true,data:T,warnings:Warning[]}`；领域失败 `{ok:false,error:{code,message,retryable,currentRevision?}}`。不迁移全仓其他IPC。

- WriteReceipt：operationId、commit:'committed'、effect(created/updated/unchanged/deduplicated/suppressed)、committedRevisionIds、currentMemory?、projectionState(synced/pending/failed)。设置/参考写回执另包含相应currentSettings/currentReference，不能返回不受约束任意data。
- MemoryViewItem：MemoryRecord＋effectiveStatus＋sourceAvailability(available/unavailable/review-required)＋requiresMaterialSelection＋conflicts（精确修订对与状态）。
- ListPage：items、nextCursor?；cursor为updatedAt＋id的版本化结构，limit默认50，上限100；created/modified排序定义在对应响应，非任意SQL游标。
- Scope从现有判别联合复用；Facet与kind由宿主映射，客户端不能提交矛盾组合。
- EditPatch允许content/facet/topicKey/scope/日期patch；topicKey清空同样用clear。来源不作为任意可编辑JSON，单独经verified选择器或人工重新表述构造。

### 9.2 通道与参数

| 通道 | 输入 | 成功data |
| --- | --- | --- |
| memory:list | workspaceId?/expertId?、statuses?、includeCandidates默认true、cursor?、limit? | ListPage<MemoryViewItem>；全局管理可无过滤，Run召回不复用此权限宽查询 |
| memory:get | id、revisionId? | MemoryViewItem，精确旧修订标历史不可直接编辑 |
| memory:create | operationId、content、facet、scope、topicKey?、validFrom?/validUntil?、sourceSelector?、asUserInstruction:boolean、genericDeclaration? | WriteReceipt |
| memory:update | operationId、id、expectedRevision、patch、legacySourceReview? | WriteReceipt；legacy复核须完整选择器/人工声明 |
| memory:set-status | operationId、id、expectedRevision、action、confirmPatch? | WriteReceipt；confirmPatch只在confirm/reconfirm合法 |
| memory:resolve-conflict | operationId、left:{id,expectedRevision}、right:{id,expectedRevision}、decision、winnerId?、applicabilityNote? | WriteReceipt＋ConflictDecision；replace必填winner，keep-both必填说明 |
| memory:preview | taskId、taskContextRevisionId、expectedTaskContextRevision、prompt | selectedItems、预算、排除原因摘要、evaluatedAt；不落运行读取 |
| memory:run-context | runId | phase、精确MemoryViewItem/引用、选择理由、预算、replay摘要、各阶段时间 |
| memory:get-settings | workspaceId | WorkspaceMemorySettings |
| memory:set-settings | operationId、workspaceId、expectedRevision、autoSuggestEnabled、consentVersion? | 设置回执＋cancelledJobCount；开启必须当前consentVersion |
| memory:list-jobs | workspaceId、taskId?、cursor?、limit默认20/最大50 | 脱敏JobSummary列表；不返回原始模型输入/错误 |
| memory:retry-job | operationId、jobId、expectedRevision、consentVersion | JobSummary；单次同意，不修改自动开关 |
| memory:cancel-job | operationId、jobId、expectedRevision | JobSummary |
| memory:rebuild-projection | operationId | projectionState，纯本地重建 |
| workspace:memory-brief | workspaceId、expertId? | WorkspaceBrief |
| workspace:list-reference-versions | workspaceId | active参考标记及版本可用性 |
| workspace:set-reference-version | operationId、workspaceId、artifactVersionId、expectedRevision（新建0）、label? | ReferenceReceipt＋既有MaterialReference |
| workspace:remove-reference-version | operationId、id、expectedRevision | ReferenceReceipt |

sourceSelector联合：run-user(runId,start,end)、run-assistant(runId,eventId,start,end)、checkpoint(checkpointId,field:feedback/summary,start,end)、artifact-version(artifactVersionId,locator,selectedText)。成果selectedText必须由当前已可读取的受管版本验证，不能接受任意伪造摘录；格式无法精确验证时只允许用户独立manual表单，不承诺自动文本定位。

JobSummary字段：id/workspaceId/taskId/status/revision/attempt/trigger/模型展示名?/候选数/错误码?/安全说明?/createdAt/updatedAt，不含密钥或源片段正文。

旧memory四通道在WM03同卡升级共享Schema、Main、Preload、hooks、App和测试；不保留能绕过来源确认的旧写后门。新增通道只随对应卡提供真实实现，不发布空占位API。

### 9.3 错误、警告和边界

错误码固定分组：

- 身份/并发：NOT_FOUND、REVISION_CONFLICT、IDEMPOTENCY_CONFLICT、CONTEXT_REVISION_REQUIRED。
- 治理：INVALID_TRANSITION、TERMINAL_MEMORY、INVALID_VALIDITY、CONFLICT_REVIEW_REQUIRED。
- 范围/来源：SCOPE_MISMATCH、GLOBAL_SCOPE_REQUIRES_DECLARATION、WORKSPACE_FACT_CANNOT_BE_GLOBAL、SOURCE_UNAVAILABLE、SOURCE_MISMATCH、SOURCE_REVIEW_REQUIRED、SOURCE_DEPENDENCY_LIMIT、SOURCE_DEPENDENCY_CYCLE、MATERIAL_NOT_ALLOWED、MATERIAL_HASH_MISMATCH、SENSITIVE_CONTENT。
- 模型/作业：MODEL_UNAVAILABLE、MODEL_PROFILE_CHANGED、CREDENTIAL_UNAVAILABLE、CONSENT_REQUIRED、QUEUE_FULL、JOB_STATE_CONFLICT、INPUT_LIMIT、OUTPUT_LIMIT、TIMEOUT、CANCELLED、INTERRUPTED、INVALID_MODEL_OUTPUT、MODEL_OUTPUT_TRUNCATED、MODEL_TOOL_CALL_REJECTED、MODEL_FINISH_UNKNOWN、MODEL_REQUEST_FAILED。
- 参考/存储：REFERENCE_WORKSPACE_MISMATCH、REFERENCE_LIMIT、REFERENCE_UNAVAILABLE、HISTORY_REFERENCE_BLOCKS_DELETE、STORAGE_ERROR、INTERNAL_ERROR。

成功警告：PROJECTION_PENDING、SOURCE_NEEDS_REVIEW、HISTORY_TRUNCATED。错误message使用可操作中文，不带完整内容、URL凭据或提供商原始响应。

输入/输出Zod错误继续由已有注册helper拒绝；transport拒绝由Hook统一映射IPC_FAILURE，不解析Electron异常字符串来猜业务错误码。领域错误通过Result明确返回。投影失败是已提交成功＋警告，不是领域写失败。

## 10. 简报和成果引用精确规则

WorkspaceBrief字段：workspaceId、expertId?、generatedAt、goals、constraints、decisions、methods、openIssues、referenceVersions及每区total/truncated。确认区每区最多10条，updatedAt DESC/id ASC；只纳入当前有效、verified、来源仍可用的confirmed。workspace视角只取workspace记录，选专家再加相应expert-workspace；不把user偏好混成项目事实。

每个记忆条目返回memoryId/revisionId/hash/content/scope/sourceAvailability/requiresMaterialSelection。资料派生内容可在同空间管理简报中显示，但注明使用时仍需材料，不因此获得模型授权。

openIssues取本空间Task的open checkpoint最近10项，保留summary/feedback/nextAction原有标识；开放不等于“已确认未解决所有问题”，不做LLM状态推断。参考区取最新5个active标记，selectedAt DESC/id ASC；可进入全部参考列表。

源失效、过期和候选不进入确认区；重复/冲突待处理计数作为管理提示。空态不自动补内容，查询失败显示可重试错误，不显示伪造旧简报。

引用流程：选精确版本→Main验证归属及哈希→现有MaterialReference→加入TaskContext，默认purpose为comparison，用户可改structure-reference等已有用途→后续Run按既有工具读取→实际读取后关联本期成果。WM00核对既有purpose枚举实际字符串并机械对齐命名，不新增同义枚举。标记参考或显示简报不算读取Evidence。

## 11. 文件责任和阶段划分

根路径：`/Users/kevin/Dev4AI/BetterWork`。以下均为后续拟改文件，先查等价实现，不本轮创建业务代码。

| 责任 | 既有落点 | 拟新增内聚模块 |
| --- | --- | --- |
| 协议/接线 | packages/agent-protocol/src/index.ts；main/ipc/register-ipc.ts；preload/index.ts | 不另建协议入口 |
| 数据库/装配 | main/db/app-schema.ts；main/persistence/index.ts；main/index.ts | 按下面仓储聚合 |
| 记忆治理 | main/persistence/memory-repository.ts；main/services/memory-service.ts | memory-operation-repository.ts（操作/裁决）；services/memory-provenance.ts；memory-content-policy.ts |
| 召回 | 现有MemoryService | services/memory-retrieval.ts（纯函数） |
| 运行与历史 | services/run-service.ts；persistence/run-context-snapshot-repository.ts | persistence/run-memory-context-repository.ts；services/run-history-policy.ts；run-memory-audit.ts |
| 模型 | agent-core/src/types.ts、openai-compatible-provider.ts；Main credential-access.ts | services/model-provider-factory.ts |
| 提炼 | Run及discussion-checkpoint-service触发点 | persistence/memory-extraction-repository.ts；services/memory-extraction-service.ts；memory-extraction-prompt.ts |
| 简报/参考 | 成果仓储、TaskMaterialService | persistence/workspace-reference-repository.ts；services/workspace-brief-service.ts |
| UI | App.tsx、MemoryView、ContextPanel、WorkspaceSelector、ArtifactView、use-memories、use-artifact-viewer | hooks/use-memory-suggestions.ts、use-run-memories.ts、use-workspace-brief.ts；components/MemorySuggestionList.tsx、WorkspaceBrief.tsx、MemoryEditor.tsx |

测试与实现同目录；已有hook测试后缀按其是否含JSX确定，使用已存在文件不另造并行测试体系。新模块只在对应卡有真实职责时创建，不预铺目录。

## 12. WM唯一任务板与逐卡完成定义

### 12.1 共用规则

状态仅todo/doing/blocked/done；下表全部初始todo。点数为相对复杂度，不是工期或模型耗时承诺。严格串行，前卡done才能下一卡；人工里程碑单独记录，不能将自动测试通过写成人工已通过。

所有代码卡：读必读文档→核对基线/前置→列文件和契约对齐清单→先必要回归→实施→定向测试→typecheck→verify→更新本卡/当日日志→交接停止。不得把测试拖到最后。

缺陷卡执行GATE-0：先只读检查可用SQLite与开发日志，再分析代码；现场数据不具备时明确记录“不适用/不可得”，用隔离真实SQLite测试复现，不编造现场结果、不修改用户数据库。

共同停止条件：用户改动冲突；契约须作实质改变；准备扩大范围/新增外部依赖/访问真实服务；迁移编号冲突；来源安全无法证明；必需验收缺条件。常规编码和本卡缺陷自主解决，不每个小步骤重复请示。

### 12.2 总表

| 卡号 | 主题 | 点数 | 前置 | 状态 |
| --- | --- | --- | --- | --- |
| WM00 | 文档归档与基线核对 | 2 | 本稿 | todo |
| WM01 | 记忆写IPC异步回归修正 | 3 | WM00＋设计批准 | todo |
| WM02 | 治理数据、CAS及幂等事务 | 8 | WM01 | todo |
| WM03 | 来源治理、写契约与投影一致性 | 8 | WM02 | todo |
| WM04 | 确定性相关召回 | 5 | WM03 | todo |
| WM05 | 运行记忆/依赖审计存储 | 5 | WM04 | todo |
| WM06 | 安全历史与真实请求阶段接线 | 8 | WM05 | todo |
| WM07 | 人工治理及运行可见性界面 | 5 | WM06 | todo |
| WM08 | 共享模型解析及Provider提炼边界 | 5 | WM07 | todo |
| WM09 | 自动建议设置和持久作业 | 5 | WM08 | todo |
| WM10 | 严格提炼、触发与候选闭环 | 8 | WM09 | todo |
| WM11 | 建议、同意、取消及重试交互 | 5 | WM10 | todo |
| WM12 | 精确参考成果版本 | 3 | WM11 | todo |
| WM13 | 工作空间确定性简报 | 5 | WM12 | todo |
| WM14 | 简报和成果复用界面 | 5 | WM13 | todo |
| WM15 | 跨任务/空间/重启集成验收 | 8 | WM14 | todo |
| WM16 | 用户验收与交接收口 | 3 | WM15＋人工授权 | todo |

### WM00：文档归档与基线核对

- 只改第15节文档及链接；把本稿完整分拆，契约单一真相源，不复制整套字段到多处。
- 核对HEAD/工作树/迁移最新号/ADR0026占用/并行CF改动/材料purpose实际枚举，不重做产品设计。
- Given本稿完整，When归档，Then设计、ADR、契约、任务卡、提示词五份文档均存在且双向链接有效；Given路径已有用户内容，Then增量合并或报告冲突，不覆盖。
- 文档检查：中文新增片段回读、链接/锚点和字段一致性、git diff --check；未跟踪新文件要单独检查，不能只凭git diff。无需npm构建。
- 文档可在具体方案待评审时保持Proposed；开工WM01前需要用户明确批准。本卡结束不编码。

### WM01：异步响应回归

- 文件：register-ipc.ts/.test.ts，memory-service.test.ts；只修await和响应Promise问题，不提前改整个响应协议。
- Given真实异步服务，When create/update/set-status，Then返回已解析Record且写一次；Given服务reject，Then错误收口且无未处理拒绝。
- 用真实注册回调和SQLite验证，不能mock掉Promise行为。投影成功/失败双路径先建立测试证据；投影已提交语义在WM03统一Result切换时处理，明确记录过渡限制。
- 定向：`npm test -- apps/desktop/src/main/ipc/register-ipc.test.ts apps/desktop/src/main/services/memory-service.test.ts`。

### WM02：治理数据与事务

- 文件：协议、app-schema、memory-repository、memory-operation-repository、persistence装配及同目录测试。
- 实现新增字段、legacy机械标记、CAS/幂等、日期clear、拒绝恢复、原子替代、精确修订外键和父对象删除引用预检；不激活新来源召回门禁直到WM03。
- Given同operationId重复提交，Then一份效果；Given并发同修订或双记录替代任一失败，Then零部分写入；Given终态记录，Then不能复活。
- 定向：migrate.test.ts、memory-repository.test.ts、memory-operation-repository.test.ts；覆盖新库/旧库/回滚/外键/重启。

### WM03：来源、写契约和投影

- 文件：MemoryService、memory-provenance/content-policy、旧四IPC/Preload、use-memories/App/MemoryView及测试。
- 一次升级旧写调用方到Result/operationId/action，提供legacy复核及自主口径表单入口；新门禁启用与入口同卡落地。投影串行、提交成功＋警告、手动重建。
- Given用户自主口径，Then换期材料仍可复用；Given派生结论确认，Then依赖不被解除；Given伪造来源或secret，Then拒绝且不写敏感快照；GivenDB已提交投影失败，Then保存成功但可见待修复，不重复写。
- 定向：memory-service.test.ts、memory-provenance.test.ts、memory-content-policy.test.ts、register-ipc.test.ts及use-memories现有测试。

### WM04：确定性召回

- 文件：memory-retrieval.ts/.test.ts、MemoryService/Repository、RunService召回入口。
- 精确实现第6节分词、score、过滤、冲突组、小偏好池和预算；不增加FTS或分词依赖。
- Given大量无关/已排除项，Then不占预算；Givenemoji/非BMP内容，Thencode point计数正确；Given超预算长记录，Then跳过后补短项；Given无命中，Then仅合法通用偏好或空。
- 定向：memory-retrieval.test.ts、memory-service.test.ts、run-service.test.ts。

### WM05：运行审计数据

- 文件：共享DTO、app-schema、run-memory-context-repository、run_memory_reads扩展、RunService准备写入和装配。
- 保存selected及直接/传递依赖所需结构、精确引用、旧legacy_unknown；提供内部查询，不在存储卡声称历史重放已经安全。
- Given准备成功，Then精确有序修订和budget落库；Given写失败，Then无半运行快照；Given旧记录，Then没有伪造请求hash或时间。
- 定向：run-memory-context-repository.test.ts、migrate.test.ts、run-service.test.ts。下一卡再启用全部安全重放和请求阶段。

### WM06：安全历史与请求接线

- 文件：run-history-policy、run-memory-audit、RunService、TaskContext最新版本校验、memory:run-context/preview接线、必要preload。
- 将新旧入口统一到明确材料范围；最后最终回答、时间边界、传递依赖、连续安全后缀；Provider包装器记录真实request-prepared/dispatch-attempted。
- Given旧记忆撤销或材料替换，Then实际Provider输入无相关旧历史；Given只是预算落选或材料增加，Then保留仍安全历史；Given并发未来轮次，Then不纳入；Given审计失败，Then不调用Provider。
- 定向：run-history-policy.test.ts、run-memory-audit.test.ts、run-service.test.ts、register-ipc.test.ts；必须断言请求messages，不只断言segmentId。

### WM07：人工治理及透明展示

- 文件：MemoryView、MemoryEditor、ContextPanel、use-memories、use-run-memories、App及测试。
- 完成confirm/reject/restore/replace/keep-both/日期clear/Task排除；分开下次预览与本次快照，展示来源和当前/历史状态。相同字段直接复用协议DTO。
- Given修订冲突，Then草稿保留；Given快速切Run/空间，Then迟到响应不覆盖；GivenTask排除，Then其他TaskContext字段完整。
- 定向：MemoryView/ContextPanel测试、use-run-memories测试、App相关测试。人工UI交给用户，不擅自浏览器验收。

### WM08：共享模型与Provider

- 文件：model-provider-factory、RunService模型解析、agent-core types/Provider及测试；不改CF凭据迁移业务。
- 复用配置凭据；新增请求额度及finishReason/usage；Run记录非敏感实际模型身份。提炼严格模式没有Fake回退。
- Givenprofile上限低于2048，Then使用较低值；Givenlength/EOF/unknown/工具调用，Then提炼层可区分；Given普通Run，Then原行为兼容。
- 定向：openai-compatible-provider.test.ts、model-provider-factory.test.ts、run-service.test.ts；fetch替身，禁止真实触网。

### WM09：设置、作业与恢复

- 文件：settings/jobs迁移、memory-extraction-repository、服务调度部分、相关IPC/Preload、Main启动恢复。
- 来源唯一、global concurrency1、queued20、revision/attempt、取消和单次重试同意；执行器通过注入接口单测，不放空生产实现。
- Given默认关闭，Then零自动入队/请求；Given重启queued/running，Theninterrupted且零网络；Given重复来源/迟到结果，Then不重复提交；Given关开关，Then取消该空间自动作业。
- 定向：migrate.test.ts、memory-extraction-repository.test.ts、memory-extraction-service.test.ts、register-ipc.test.ts。

### WM10：严格候选提炼

- 文件：memory-extraction-prompt/service、Run终态/DiscussionCheckpoint保存触发、MemoryService候选内部入口。
- 按第7节最小用户证据＋必要背景、来源依赖、严格JSON、限额、敏感内容检查；候选和作业成功同事务，主Run失败隔离。
- Given合法用户纠正，Then最多3条candidate；Given0条，Then成功；Given工具调用/错误JSON/越权字段/超时/secret，Then不写confirmed且不记录敏感原文；Given原Run完成，Then提炼失败也不改变终态。
- 定向：memory-extraction-service.test.ts、memory-extraction-prompt.test.ts、discussion-checkpoint-service.test.ts、run-service.test.ts。

### WM11：建议交互

- 文件：use-memory-suggestions、MemorySuggestionList、设置记忆页、任务入口/ContextPanel及测试。
- 开关告知与同意版本、候选批次、状态/取消/手动重试、0条与失败区分；可见活动时轮询、离开清理。主动口径保存不依赖模型。
- Given跨空间切换，Then不串候选；Given关闭或取消，Then不接受迟到成功；Given重试，Then只授权一次调用且不开自动建议；Given每条候选，Then无逐条全局Toast。
- 定向：use-memory-suggestions.test.ts、MemorySuggestionList.test.tsx、MemoryView相关测试。

### WM12：参考成果精确版本

- 文件：workspace-reference-repository、迁移、共享协议/IPC/Preload、引用归属校验。
- 同空间active≤20、固定version/hash、CAS/幂等、取消参考；不新增Artifact批准字段，不读全文。
- Given成果新增版本，Then参考仍指旧版本；Given跨空间/失效/哈希不符/超上限，Then拒绝；Given重复提交，Then只一条标记。
- 定向：workspace-reference-repository.test.ts、migrate.test.ts、register-ipc.test.ts。

### WM13：确定性简报

- 文件：workspace-brief-service、对应IPC/Preload、同目录测试。
- 第10节取数/排序/限制/来源状态/未决标识完整；不存正文副本、不调用模型。
- Given同数据，Then内容和排序稳定（generatedAt除外）；Given空空间，Then诚实空态；Given过期/未核来源/其他空间，Then不混入确认区；Given开放节点，Then不标成已确认。
- 定向：workspace-brief-service.test.ts、register-ipc.test.ts。

### WM14：简报与引用UI

- 文件：WorkspaceBrief/use-workspace-brief、WorkspaceSelector、ContextPanel、ArtifactView/use-artifact-viewer、App新任务草稿衔接。
- 简报可关、参考标记、Markdown/PPTX精确引用；新任务不自动发送、不继承原材料/授权，来源专家按第3.6节处理。
- Given选择指定版本，ThenTaskContext固定version/hash；Given目标消失/切空间迟到/保存冲突，Then错误可见且草稿不丢；Given参考标记，Then不冒称业务批准。
- 定向：WorkspaceBrief.test.tsx、use-workspace-brief.test.ts、ArtifactView.test.tsx、use-artifact-viewer.test.tsx、App.test.tsx。

### WM15：系统级合成验收

- 新增 `main/services/work-centered-memory.integration.test.ts`，必要fixture置同目录测试资源，禁止使用公司真实文件。
- 真实SQLite＋mock fetch捕获实际Provider请求；两Workspace同Expert、每空间两个独立Task、重启、替代/删除/排除/到期、中文混合检索、材料更换、legacy、取消迟到、提炼失败、投影故障全覆盖。
- Given自主口径确认，Then第二独立Task正确带入；Given派生记忆依赖没选，Then不带入；Given旧规则被替代，Then直接记忆和历史回答均无旧规则；Given另一个Workspace，Then不泄漏。
- 运行该集成测试、相关全部定向测试、typecheck、verify；自动fixture只证明机制，不能证明真实模型语义质量。

### WM16：用户验收与收口

- 文档/验收记录为主，不扩功能。收集实际代码版本、命令退出码、用户步骤和结果；按WM里程碑收口，不改E/CF状态。
- 用户分别确认：人工保存/修改/来源/排除；开关和候选质量；两期实际交付；简报和精确版本引用。真实模型调用只用用户授权的配置/合成材料。
- 缺人工证据则保持doing/blocked及“人工待验”，不标总体done。签名安装/真实MCP等未完成项仍回原任务板，不绑架本地记忆开发。
- 最终定向回归、typecheck、verify；只交接，不自动提交、推送或发布。

## 13. 测试、里程碑与可观测性

### 13.1 测试数据与硬断言

合成空间甲“经营分析”、空间乙“市场研究”，共用一个专家；每空间两个独立任务。例句：

- 自主口径：“收入按回款金额统计，不使用签约金额。”
- 新规则：“本期改为不含税回款金额。”
- 表达偏好：“先列异常和待决策事项，再列总体指标。”
- 临时事实：“本期续约率为82%”，不得泛化为永久公司事实。
- 去重对照：“不得合并/可以合并”“10万元/100万元”。
- 中英混合：“ARR不含一次性实施费，单位为万元”。

测试覆盖矩阵：协议非法字段/ID归属；CAS与幂等；状态终态；migration回滚/外键；有效期边界/clear；来源移除但修订残留；依赖递归/循环；中文与非BMP预算；conflict组；实际请求与重放；opt-in0调用；无模型/截断/EOF/工具调用；取消/重启/迟到；投影DB成功；UI过期响应；参考精确版本/新任务不带旧授权。

### 13.2 里程碑

| 里程碑 | 范围 | 自动证据 | 人工证据 |
| --- | --- | --- | --- |
| WM-M0 | WM00 | 文档完整性、链接和基线 | 具体设计批准 |
| WM-M1 | WM01–WM07 | 治理、相关召回、安全历史、请求审计 | 保存/复核/排除/冲突/本次记忆 |
| WM-M2 | WM08–WM11 | 无工具提炼、同意、取消、恢复 | 告知与真实候选质量 |
| WM-M3 | WM12–WM14 | 简报、精确版本链路 | 简报与Markdown/PPTX引用 |
| WM-M4 | WM15–WM16 | 系统回归和全量门禁 | 连续两次实际工作与最终确认 |

里程碑使用WM前缀避免与CF的M0–M5混淆。每个里程碑的自动结果、用户UI结果、模型语义结果分栏记录，缺一项不伪造。

### 13.3 本地观察数据

复用operations/jobs/run contexts记录，不新增第三方埋点服务。事件语义：candidate_created、candidate_confirmed、candidate_rejected、memory_replaced、memory_selected、memory_dispatch_attempted、memory_excluded、extraction_finished、reference_selected。属性只含范围ID、任务/运行ID、状态/原因、数量/耗时/真实usage，不含正文/secret。UI可以从这些记录生成诊断计数，不宣称“被选中＝改善成果”。

### 13.4 验证命令

后续代码卡在仓库根执行：

```text
npm test -- <该卡列出的仓库相对测试路径>
npm run typecheck
npm run verify
git diff --check
```

禁止管道截尾掩盖退出码；记录命令、退出码和实际失败原因。Markdown不在Prettier范围；文档卡用中文回读/链接/差异检查，不跑无关构建。新未跟踪文件需单独读取检查。

真实桌面只按 `bash scripts/dev-start.sh` / `bash scripts/dev-stop.sh` 管理，未经用户要求不自动Browser/ComputerUse验收。人工验收由用户执行并反馈；模型语义质量不能由stub测试代替。

## 14. 可复制的后续任务提示词

### 14.1 首次交接：仅归档文档

```text
请执行算台 BetterWork 的 WM00，仅归档设计和开发计划，不写业务代码。
工作区：/Users/kevin/Dev4AI/BetterWork。
先读取我附上的《工作型记忆设计与开发交接》总稿，以及 AGENTS.md、docs/12-engineering-standards.md、docs/development/README.md。
按总稿第15节把已制定的产品设计、ADR、实施契约、WM任务卡和提示词分拆到规范目录，建立双向链接。不要重新设计，不省略字段、迁移、失败语义、任务验收或提示词。
先核对git status、HEAD、迁移最新版本、ADR编号和已存在文件；保留所有用户改动。材料purpose枚举等机械名称以现有协议核对，不自行创造同义概念。遇实质冲突列出后停下。
若我未明确批准具体技术方案，ADR保持Proposed；本卡仍可归档，但不能开始WM01。
只做文档一致性、中文回读、链接和差异检查，记录真实时间和工作日志。不要运行应用、真实模型、测试构建，不提交、不推送。
完成后列出文档路径、检查结果和下一卡；停止，等待我的下一条指令。
```

### 14.2 通用单卡编码指令

```text
我批准《工作型记忆设计与开发交接》对应设计，本次仅授权执行【WM编号】，不要自动实施下一卡。
工作区：/Users/kevin/Dev4AI/BetterWork。
必读：AGENTS.md；docs/12-engineering-standards.md；docs/designs/work-centered-memory.md；docs/development/memory-contracts.md；docs/development/tasks-memory.md；本卡指定ADR与测试要求。
先核对HEAD、工作树、前置卡和迁移号；保留已有改动，不修改E/CF任务状态。先列本卡文件边界、配置字段/Schema/IPC/数据库映射和验收检查清单。缺陷诊断执行GATE-0，缺现场证据如实说明并使用隔离测试复现。
只实现该卡及必要测试/文档；已有等价实现直接复用，不委派其他智能体，不升级无关依赖，不改变已定架构或范围。实质契约冲突需停下说明，不自行简化成“只有提示词”。
真实SQLite测试；HTTP和模型自动测试必须使用注入替身，不触网。Renderer经Hook收口；统一工程规范，不加any、非空断言或豁免注释。
完成定向测试、typecheck、npm run verify，不接管道截尾。每次中文编辑后回读。只更新本卡状态、必要契约和当天日志；缺必需证据不标done。
不要擅自启动应用或做Browser/ComputerUse验收；真实模型/人工验收由我另行安排。不要提交、推送、发布。
结束报告：卡号/状态；实现行为（含失败、取消、恢复）；修改文件；命令/退出码/测试结果；迁移版本；文档日志；人工待验；风险；下一卡前置。报告后停止。
```

### 14.3 逐卡聚焦补充

与通用指令一起粘贴；完整实现边界以任务卡及契约为准。

| 卡号 | 聚焦指令 |
| --- | --- |
| WM01 | 先用实际IPC回调验证内层Promise问题，再修await；不提前重构全仓IPC或误报已运行复现。 |
| WM02 | 保留旧修订；supersedesId与跨记录replacesRevisionId分开；CAS/幂等/替代一次事务；迁移动态取号，legacy不造来源。 |
| WM03 | 旧四通道和所有调用方同卡切换；自主口径与派生依赖分开；DB成功投影失败返回警告而非重复保存；同步提供legacy复核入口。 |
| WM04 | 按memory-recall-v1精确实现分词、排序、无命中、偏好池、冲突组和code point预算，过滤在前，不引入向量或新依赖。 |
| WM05 | 只实现运行阶段/依赖存储及精确DTO，旧reads标unknown，不编造发送事实；不要提前声称安全重放已完成。 |
| WM06 | 接通统一上下文、传递依赖和连续安全历史后缀；断言Provider实际输入，不以segmentId变化代替隔离；审计失败阻止请求。 |
| WM07 | 复用现有记忆页和上下文面板；草稿/CAS/TaskContext完整保存/迟到响应全覆盖，不新增一级导航。 |
| WM08 | 复用模型profiles和credential-access；补请求上限、finishReason及usage；提炼无Fake回退，普通Run保持兼容。 |
| WM09 | 默认opt-in关闭；source唯一、全局并发1、取消和attempt防迟到；重启收口interrupted，绝不自动付费重试。 |
| WM10 | 候选必须有用户发言或人工反馈证据；助手文本仅消歧；严格JSON、0条合法、最多3条、30秒；提炼失败不改变原Run终态。 |
| WM11 | 展示同意/费用说明、候选及作业状态；关闭和取消无迟到污染；每次重试只授权一次，手动保存不依赖模型。 |
| WM12 | 参考标记固定同空间versionId/hash，最多20；不表示审批，不随latest漂移，不自动读全文。 |
| WM13 | 简报只查询已确认事项、开放节点和参考版本；不调用模型、不存二次事实、不混淆未决与确认。 |
| WM14 | 复用Markdown/PPTX精确材料链；新任务创建草稿、不自动发送，不继承旧材料和授权；不扩DOCX。 |
| WM15 | 用合成中文材料、真实SQLite及mock fetch验证跨空间/跨Task/重启/遗忘/来源/预算；不复制用户文件，不触网。 |
| WM16 | 收齐自动、用户UI和真实模型语义三类证据再收口；缺证据保持待验，不代办E/CF，不自动发布。 |

### 14.4 里程碑核验

```text
只核验【WM-M编号】，不授权新功能或下一卡。
核对当前HEAD、相关任务卡、已有定向测试和verify记录，逐项列出自动测试、用户UI、真实模型语义验收的证据与缺口。
本次默认只读核验已有证据；如需补跑本地测试请说明命令，如需真实模型或桌面操作先等待我授权。
不要把“已选中”写成“已影响成果”，不要把fixture通过写成真实业务质量通过；不要修改E/CF状态。缺人工证据明确写人工待验。
```

### 14.5 中断后恢复

```text
恢复【WM编号】，仅恢复这张卡。
先读任务卡、契约、工作日志、git status与HEAD，核对当前迁移和已有用户改动。输出已完成/未完成/基线差异/需重验清单。
不回滚未知改动，不假定上次测试仍有效，不自动继续下一卡。仍在已授权范围且无冲突时完成剩余工作，否则停下说明。
提炼作业只验证取消和interrupted恢复机制，不手动触发生产模型、不扫描历史重跑。按单卡交接模板报告后停止，不提交不推送。
```

## 15. 规范目录归档与链接检查

WM00拆分为五份明确产物：

| 路径 | 唯一职责 |
| --- | --- |
| docs/designs/work-centered-memory.md | 本稿1–3、产品验收和范围；产品行为真相源 |
| docs/adr/0026-work-centered-memory.md | 本稿4及关键取舍、替代关系；编号查重 |
| docs/development/memory-contracts.md | 本稿5–10；字段/状态/算法/迁移/接口唯一真相源 |
| docs/development/tasks-memory.md | 本稿0、11–13；WM唯一任务状态板、卡、里程碑 |
| docs/development/memory-coding-prompts.md | 本稿14；可复制的交接提示词，不重复定义字段 |

归档后总稿作为设计阶段快照保留，后续实施状态只更新tasks-memory，避免两套活动任务板。设计/契约/ADR/任务/提示词相互链接；明确哪个文档负责哪类真相。

必须接入的现有入口：

- AGENTS.md：“任务路由”“当前阶段”新增WM入口及独立授权边界。
- docs/README.md：“技术设计提案”“开发执行规划”。
- docs/development/README.md：顶部增量说明与“文档路由”，不复制WM状态。
- docs/adr/README.md：新ADR及替代关系。
- docs/07-mvp-and-roadmap.md：当前开发顺序的独立增量，不改写旧Phase或E/CF状态。
- docs/04-knowledge-and-memory.md：记忆体系/形成/治理/知识加工闭环，区分已实现与拟实施。
- docs/02-domain-model.md：解释Task是临时上下文，非新增长期记忆scope。
- docs/03-system-architecture.md：新增Main提炼服务/请求审计/派生简报边界。
- docs/10-ui-ux-system.md：记忆页、可关闭上下文、空间简报、参考标记的提案，保留现有导航/反馈规则。
- expert-contracts.md、material-contracts.md、capability-contracts.md：只补相关双向链接及需要调整的上下文兼容说明，不提前实现CF新接口。
- ADR-0015：只追加被新提案细化/拟替代的条款链接，批准前不写成已生效替代。
- docs/logs/实际日期.md：先date、重读、追加；不把设计记录当作实现或验收记录。

文档验证：新增中文逐段回读；Markdown链接逐一确认，内部标题锚点核对；计划中的未来代码路径标“拟新增”而非已存在链接；检查类型/key/枚举/预算在契约与任务提示词一致；新未跟踪文件单独检查；git diff --check。无需修改工程规范、依赖或构建配置。

## 16. 已确定假设与边界

- 自动建议默认关闭、按工作空间同意；人工保存不调用模型。
- 近期不依赖CF远程MCP/API未完成能力；缺可用模型只阻塞相应真实提炼验收，不重做凭据方案。
- 旧来源无法证明时保留历史但需要复核；这是显式兼容策略，必须让用户看见，不偷偷继续注入。
- 来源和记忆内容可在本机保存；远程模型处理遵循已显示的同意，不承诺数据永不离开设备。
- 工作空间之间只有既有显式材料选择能授权跨空间参考；本期新增参考标记只同空间，不由记忆扩权。
- 无性能实测基线、开发工期或采纳率承诺。规模压测先使用1,000条有效记忆的合成集合记录排序耗时；若超出可接受主线程开销，返回设计评审，不擅自引入向量库或长期后台扫描。
- 本稿未修改业务代码、未运行测试、未提交仓库。完成本稿后停止；后续由用户在另一个任务中按提示词授权推进。
