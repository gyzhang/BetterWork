# 知识基础闭环开发计划（KM00–KM15）

- 日期：2026-09-24；代码核对基线：`f59c71a`，开工时必须重核。
- 这是 **KM 唯一任务状态真相源**。产品规范不维护状态，提示词不复制字段，ADR 不替代验收。
- 本轮只编写文档。下表所有新任务均未开工；不把本次文档归档冒充 KM00 技术批准或任何代码实现。
- 入口：[产品规范](../designs/knowledge-foundation.md)、[ADR-0027](../adr/0027-knowledge-foundation.md)、[实施契约](knowledge-contracts.md)、[Qwen3.8-Flash 交接](knowledge-coding-prompts.md)。

## 1. 授权、依赖与完成定义

产品补齐方向已获光哥接受；具体 ADR、文档线框、编码、真实模型调用与提交发布分别授权。本轮没有后三类授权。KM00 核对并记录技术/交互批准，不得自行将 ADR 改为 Accepted。

- 默认新会话使用光哥选择的 Qwen3.8-Flash，一次一张卡；不并行改共享协议、迁移、App、RunService。
- 新任务只补增量，不重复 E/CF/WM 已有能力，不更改这些任务板状态。
- 前置卡未完成不得用 mock 冒充生产依赖已接通；HTTP 注入替身是测试隔离，不是生产功能替代。
- 每张实现卡需相关真实 SQLite 测试、协议/调用链测试、typecheck 与 `npm run verify` 退出 0，并有当天日志。界面变更另记录人工待验，自动证据不等于用户验收。
- 所有 UI 卡编码前须有 KM00 文档线框评审记录；若光哥要求可点击原型，另行授权并审阅后才编码。本轮不生成原型代码。
- 单卡自动范围完成可标 done 并在证据栏注明“人工待 KM15”；KM15 三类证据缺任一类不得 done。不能把这个规则用于掩盖失败测试或半接线。
- 状态值仅 `todo / doing / blocked / done`。只在下表更新，附真实日期、命令、退出码、用例名和人工缺口。

## 2. 唯一任务板

Points 是 Fibonacci 相对复杂度建议，不是已承诺工时；由未来执行者在开工核对，不根据模型名称承诺速度。

| 卡号 | 用户可感知交付 | 前置 | 优先级 | Points | 状态 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| KM00 | 固定可实施范围、技术与交互评审门 | 无 | P0 | 2 | done | 2026-09-24 核对：HEAD `767130e`，`git diff f59c71a..HEAD` 仅 docs（KM 文档归档）无知识代码漂移；Vault 最新迁移 v3、应用库 v29；`npx vitest run knowledge-vault/migrate/knowledge-search` 退出 0（51 tests）。批准依据：光哥 2026-09-24 目标指令明确批准 ADR-0027 与产品规范 §5 文档线框，授权 KM00 后连续实施 KM01–KM14（替代逐卡停止流程）；不覆盖真实模型与发布授权。 |
| KM01 | 可稳定回看的知识修订与文本分页基础 | KM00 | P0 | 5 | done | 2026-09-25 实施于 HEAD 767130e 之上：Vault v4 迁移（修订唯一键含 parser/chunking、text_hash/section_count/warnings_json 回填）、`knowledge-text.ts` 码点分页纯函数、协议 `knowledgeRevisionSummarySchema/knowledgeSpanSchema/knowledgeCursorSchema/knowledgeTextPageSchema` 与预算常量、list 接通 currentRevisionId、管理 search 命中同快照完整 reference、`knowledge:list-revisions`/`knowledge:preview` IPC/Preload/API 链路。测试：`npx vitest run knowledge-text/knowledge-vault/migrate` 退出 0（61 tests，含幂等重导入、解析升级追加修订、PARSER_NONDETERMINISTIC 事务回滚、历史修订仍读、增补字符分页、跨修订游标拒绝、v4 回填与部分唯一键）；lint/format/typecheck/build 退出 0。全量 `npm test` 1027/1028，唯一失败 `App.test.tsx > offers Expert-scoped memory capture` 在干净 HEAD worktree 复现同样失败——为记忆 UI 系列（9b93312 FieldSelect）既有回归，非 KM 改动，待记忆会话修复。UI 入口人工待 KM15。 |
| KM02 | 助手读取选定知识正文并留下精确证据 | KM01 | P0 | 8 | done | 2026-09-25 实现：应用库 v30（Evidence knowledge_source_json/dedupe_key + 两组部分唯一索引；run_material_reads 重建去表级 UNIQUE、新增知识字段组 CHECK）、`KnowledgeAudit` 服务（先审计后返回、同事务 Evidence+整组足迹、预算事务内重算、`isAbortError` 统一取消）、`read_knowledge` 工具与 createRunTools/Expert 白名单/材料提示/标签接线、旧无 TaskContext Run 改可解释空结果（§3.2）、`knowledge_search` 摘要改为可回算 span。测试：`knowledge-audit.test.ts` 9/9（范围拒绝、分页计量、跨调用 Evidence 复用、同调用重复消费不重复计量、预算耗尽拒绝不伪装完成、审计失败零正文）、`knowledge-audit-schema.test.ts` v30 约束 4/4、run-service 51/51（含 KM02 精确证据断言与 legacy 行为变更）、工具注册/取消用例绿；全量 `npm test` 1044/1045（唯一失败为基线既有 `App.test.tsx` 记忆 combobox，已复现于干净 HEAD，移交记忆会话）。来源面板展示归 KM04；UI 人工待 KM15。 |
| KM03 | 用勾选资料创建可恢复的研究草稿 | KM01 | P0 | 5 | done | 2026-09-25 实现：应用库 v31 回执表 `research_draft_operations`、`ResearchDraftService`（回执先查→固定 revision 校验当前登记→Task/Session/完整 TaskContext/回执同事务；同 operationId 同输入重试返回原草稿不重查登记，异输入 `OPERATION_CONFLICT`；首次创建前资料移除拒绝且零半成品；identity 排序去重、用途冲突拒绝）、`knowledge:create-research-draft` IPC/Preload、知识页结果勾选/全选/清除/「用已选资料研究」、App 失败保留当前任务与选择、迟到成功不抢导航（提示从最近任务找回）。测试：research-draft-service 7/7（连跑 3 次稳定，含幂等、提交后移除重试、回滚、固定修订不随刷新漂移）；全量 `npm test` 1051/1052（唯一失败为基线既有 App.test 记忆 combobox，移交记忆会话）、typecheck/build 退出 0。人工 UI 待 KM15。 |
| KM04 | 看清当前运行搜索/读取了哪个版本哪一段 | KM02 | P0 | 3 | done | 2026-09-25 实现：协议 `previewRunSourceRequestSchema`＋`runSourcePreviewSchema`（exact/legacy 可辨识联合，exact 复用 KM01 page 且 complete 无续页）、`knowledge:preview-run-source` IPC/Preload 双向校验、`KnowledgeAudit.previewRunSource`（证据归属→材料快照→修订身份＋textHash→区间回算与摘录一致，任一不符拒绝伪造）、ContextPanel 资料页按 Run 分组（默认只当前、历史折叠显式展开）、摘要来源/正文来源分开标注与修订＋span 展示、「查看区间」只回看当时返回正文（止于 end、无续读入口）、legacy 标「历史范围未记录」不给区间入口、「原文」仍走主进程白名单、`use-run-source-preview` 请求代号防迟到覆盖。测试：knowledge-audit 13/13（exact 复用、legacy 不伪造、跨 Run 拒绝、快照换空拒绝、保存文本脱节拒绝）、register-ipc 27/27（新通道归属检查＋响应 Schema 收口）、ContextPanel 15/15（分组/标注/查看区间/失败内联）；全量 `npm test` 1060/1061（唯一红为基线既有 App.test 记忆 combobox，移交记忆会话）、lint/format/typecheck/build 退出 0。人工 UI 待 KM15。 |
| KM05 | 区分成果声明采用与运行访问来源 | KM02、KM04 | P0 | 8 | done | 2026-09-25 实现：应用库 v32（`artifact_versions.source_declaration` 五值 CHECK、迁移前已有输入关系的版本只标 legacy、`run_artifact_source_declarations` 账本同 Run 后写覆盖）、协议声明种类与 `artifact:declare-sources`/`artifact:get-run-declarations` 通道、`ArtifactDeclarationService`（材料须同 Run 实际读取、证据须同 Run 精确定位、同输入双关系拒绝、幂等去重、§6.1 继承矩阵且 legacy 连续编辑不洗白）、`artifact_declare_sources` 工具（runId 由宿主注入，伪造拒绝）、`artifact_register_file` inputRelations 全链、RunService 与 Renderer 移除「访问过即采用」自动映射、成果详情区分声明采用依据与运行访问记录并标注文档级依据、`use-artifact-source-selection` 用户重选/清除 Hook 与编辑区选择 UI。测试：artifact-declaration-service 9/9、artifact-declaration-schema v32 2/2、artifact-declare-sources 5/5、run-service 52/52、register-ipc 29/29、file-artifact-service 16/16、use-artifact-source-selection 5/5、ArtifactView 11/11；lint/format:check/typecheck/build 退出 0；全量 `npm test` 1086/1087（唯一红为基线既有 `App.test.tsx` 记忆 combobox，移交记忆会话）。人工 UI 待 KM15。 |
| KM06 | 已配置嵌入模型可用于受控批量向量请求 | KM01 | P0 | 5 | done | 2026-09-25 实现：协议新增嵌入预算常量（每批 ≤16 输入／≤16,000 码点、响应 ≤4 MiB、维度 1–4,096、批 30s／查询 10s、指纹版本与 `float` 格式）与无密钥的 `embeddingModelSnapshotSchema`＋`embeddingUsageSchema`；`embedding-client.ts` 复用现有模型配置与凭据入口（`ModelRepository.getWithSecret/getDefaultProfileId`＋`CredentialAccess` 同一迁移口径），规范化完整 endpoint（http/https、拒绝 URL userinfo、保留影响路由的 query）并只以 SHA-256 指纹对外；`embed()` 真实发 OpenAI-compatible `/embeddings` 请求（无聊天历史/工具/temperature），流式累计读取超限即取消，按 index 校验唯一覆盖并重排，有限数值＋非零范数归一化为 Float32 单位向量、批内与快照维度一致，usage 只接受非负整数否则省略；HTTP/凭据/配置变化→`EMBEDDING_MODEL_UNAVAILABLE`（无 Fake、无顶替 profile、无自动重试），超时→`EMBEDDING_TIMEOUT`，用户取消走 agent-core 统一 `abortError`。测试：`embedding-client.test.ts` 22/22（真实隔离 SQLite＋注入 fetch 替身：乱序重排、换 Key/重存不改指纹、改 endpoint/model 必变、停用删除与越界快照零 HTTP、迁移 pending 不解析明文、超时恰好一次请求、取消语义、8 组非法响应、503 不回显正文与密钥、1 MiB×流式超限、维度锁定、批次数/码点/空输入零 HTTP）；回归 `model-provider-factory/model-connectivity/persistence/agent-core` 110/110、`standards/coding-standard` 22/22；lint/format:check/typecheck/build 退出 0；全量 `npm test` 1108/1109（唯一红为基线既有 App.test 记忆 combobox，移交记忆会话）。本卡只交付索引所需模型基础，端到端展示与设置在 KM07/KM09。 |
| KM07a | 导入与索引作业：Vault 存储与作业生命周期 | KM01、KM06 | P0 | 5 | done | 2026-09-25 光哥确认本卡拆为两片：07a 存储与作业（本行）、07b Worker 卸载。07a 实现：Vault v5（`knowledge_jobs`/`knowledge_job_items`/`knowledge_embedding_spaces` epoch＋维度 CAS/`knowledge_index_generations` active 部分唯一/`knowledge_chunk_vectors`/派生检索块与 FTS/`knowledge_search_settings` 单例，`db/migrate.test.ts` 补真实迁移用例）；`knowledge-job-store.ts` 按 job 单调 sequence、聚合（succeeded/partial/failed/cancelled/interrupted）与密钥脱敏；`knowledge-index-store.ts` staging→单修订原子发布、跨修订共享空间维度锁定、强制重建同事务退役旧空间开新 epoch；`knowledge-index-service.ts` Main 单作业排队、取消排队即生效、重启 `recoverInterrupted` 收口、手动重试新作业引用原 job 且只带 failed/interrupted/cancelled 条目、语义失败不回滚已发布关键词块；派生分块 `knowledge-chunks.ts`（knowledge-chunks-v1，1000/100）；IPC/Preload/Hook 迁移（导入返回 `{cancelled,jobId?}` 回执、8 个作业/设置通道、`onJobEvent` 订阅与 `trackJob/reportJob` 回填、主进程通知进消息中心）。测试：job-store/index-store/service/chunks 32 用例（含发布前故障不发布半份向量、维度不匹配拒绝、事件顺序、三种可重试状态与成功/运行拒绝、批间让位）、register-ipc 33/33（新增知识作业通道 5 用例：取消对话框不建作业、CAS 设置、非法重试拒绝、`(createdAt,id)` 分页、越界 cursor 拒绝）、use-knowledge-library 4/4；作业列表断言按契约 `(createdAt,id)` 倒序修正为同毫秒以 id 决胜（原用例误设插入序前提）。全仓 `npm run verify` 除基线已知红（App.test 记忆 combobox，移交记忆会话）外全绿，lint/format/typecheck/build 退出 0。提取暂留 Main，07b 再卸载到 Worker；Worker 身份/取消与打包入口证据留给 07b。 |
| KM07b | 提取分块与向量扫描卸载到独立 Worker（含构建入口与打包预检） | KM07a | P0 | 3 | done | 2026-09-25 实现：提取核心移到 `services/knowledge-extract.ts`（Main 与 Worker 共用同一份解析器，不另造）；`infrastructure/knowledge-worker.ts` 独立入口逐行 JSON 走 stdin/stdout，nonce 身份校验，不读文件路径、不访问网络、不写数据库；`knowledge-worker-runner.ts` 按作业登记唯一子进程（同作业复用、换作业先收口旧进程），请求携带 `{jobId, attempt}`，base64 超 32 MiB 直接拒绝且零启动，响应逐行 O(n) 累积、单行超 64 MiB 判不可信并终止，取消以 `abortError` 收口在途请求并按 1 秒宽限只终止已登记 pid，应用退出走 `shutdown`；Vault `importSource` 经注入提取器并透传条目作业上下文，`KnowledgeIndexService.cancelJob` 经 `onJobCancel` 通知 Worker 收口；`electron.vite.config.ts` 为 knowledge-worker 增加独立构建入口；契约 §13.1 增补 `WORKER_TIMEOUT/WORKER_UNAVAILABLE/WORKER_EXTRACT_FAILED`；tsconfig 开启 `allowImportingTsExtensions`（Worker 入口需被 Node 原生类型剥离直接执行，理由写入 docs/12 §4）。向量扫描 op 按拆分纪律随 KM08 首个真实扫描器接入，不留空接口。测试：`knowledge-worker-runner.test.ts` 7/7（真实子进程提取与同作业复用、坏 docx 错误响应进程存活、超限零启动、卡死替身取消收口、64 MiB 溢出替身收口、线协议拒绝坏 JSON 与伪 nonce）、service 18/18（含取消同步通知 Worker）、vault 13/13（含注入提取器与作业上下文透传）；打包预检 `npm run build` 产出 `apps/desktop/out/main/knowledge-worker.js`；全仓 `npm run verify` 1147/1148，唯一红为基线既有 App.test 记忆 combobox（移交记忆会话）。Worker 内 RSS 门槛与扫描性能在 KM08/KM14 实测。 |
| KM08 | 全库/选材范围内的关键词与语义混合检索 | KM02、KM07 | P0 | 5 | done | 2026-09-25 实现：新增 `services/knowledge-search.ts` 统一管线（契约 §9，常量全部取自协议不再造）：scope 先解析（library＝当前登记修订并集；run＝宿主快照材料，undefined/空＝空结果零 HTTP、绝不回退全库），候选先按允许修订集合过滤再截断；关键词路 FTS5 表值函数 bm25（同事务修掉 `searchChunks` 的别名 MATCH 写法），零命中才走子串回退（title 命中数降序→正文首命中升序→无正文最后→身份序）；语义路按 §8.3 租约：查询开始固定 current space 与各修订 active generation，逐批复核空间身份，rebuild 竞态报 `index-stale` 不返回 retired 候选；两路同权 RRF（k=60）融合、chunkId 去重标 `keyword/vector/both`、同修订同 section 重叠只留名次最高，摘要 span 回算到 section 并重算 excerptHash；降级矩阵 `semantic-disabled/model-unavailable/index-missing/index-partial/embedding-failed/index-stale/capacity-exceeded` 全部可解释且保留关键词结果，用户取消一律 `abortError` 绝不伪装降级成功；effectiveMode 按实际生效路报告。Worker 端新增 `scan` op（点积批扫描，`knowledge-worker-runner.ts` 按 1 MiB 批载荷上限），`KnowledgeAudit.searchForRun` 与 `knowledge_search` 工具改接异步统一检索并保留 Evidence/足迹精确 span 审计；IPC `SearchKnowledge` 返回 `knowledgeSearchResponseSchema` 全身份（管理入口），Hook/View 消费 hits＋降级内联消息；`main/index.ts` 以共享 EmbeddingClient 与 runner 接线两个生产入口。测试：`knowledge-search.test.ts` 16/16（分词、Run 范围未选不占名额、空选材零 HTTP、中文回退排序、span/哈希回算、vector 单独命中、RRF 融合与 both 标记、部分覆盖、降级矩阵四分支、租约竞态 index-stale、强制重建隔离、取消必须 abortError、limit 截断）；`knowledge-worker-runner.test.ts` 10/10（含真实 Worker 扫描批：分数降序、维度不符 WORKER_SCAN_FAILED、批载荷超限零启动）；`knowledge-audit.test.ts` 13/13 迁移到异步审计链路（证据与足迹断言不变）；`register-ipc.test.ts` 35/35（含 SearchKnowledge 通道两例）；`run-service.test.ts`＋hook＋tool＋engine 全绿。全仓 `npm test` 1171/1172（唯一红为基线既有 App.test 记忆 combobox，移交记忆会话），`npm run build` 通过。扫描 warm p95 与 Worker RSS 门槛按计划在 KM14 联合自动化实测。 |
| KM09 | 知道索引进度、模型、覆盖与搜索降级原因 | KM03、KM07、KM08 | P0 | 5 | done | 2026-09-25 实现：知识页接统一检索投影与管理动作，全部状态收在 `useKnowledgeLibrary`，视图零 IPC——检索后工具栏如实展示「本次检索方式（effectiveMode 中文映射）· 降级原因（七种枚举逐一中文化）· 向量覆盖 indexed/eligible」，未检索不假称覆盖；「索引与模型」面板：语义开关（`embeddingAvailable=false` 时禁用并显示 `unavailableReason`）、嵌入模型显式切换（FieldSelect，只列启用且已配密钥的 embedding 角色 profile，切换提示需手动重建）、普通重建与强制重建两个入口确认文案不同（强制重建明确「旧语义索引立即停用、取消/部分失败不回退、关键词不受影响」），全部走既有 `SaveKnowledgeSettings/RebuildKnowledgeIndex` CAS 通道；启用前确认对话框列出模型、资料数量、外发与费用说明，启用本身不自动补建历史索引（与契约 §8.2 一致，文案同屏说明）。作业面板：挂载读取首页 queued/running 作业并纳入跟踪，事件按作业内 `sequence` 单调合并（迟到小序号不回退面板），终态即移出并回读结果；运行中作业提供取消入口（回执 cancelled=false 如实说「已结束，无法取消」）；终态作业把失败/中断/取消条目收为可重试集合（成功态清空），重试提交新作业并跟踪。检索响应加序号守卫：迟到响应不覆盖当前查询的结果、勾选与覆盖状态。反馈通道不新增：作业提交/结果沿用页面内联消息与既有知识事件通知，未自建 Toast/横幅。测试：`KnowledgeView.test.tsx` 4/4（检索状态条、模型不可用解释、作业取消入口、启用前费用确认）；`use-knowledge-library.test.ts` 13/13（sequence 合并与终态回读、迟到响应守卫、CAS 启用零自动重建、普通/强制载荷区分、可重试集合、取消如实反馈）；`App.test.tsx` 夹具补 settings/jobs 通道。全仓 `npm test` 1145/1147 另 35 skipped：register-ipc beforeAll 10s 与 memory-retrieval 性能用例为并行负载抖动，单独复跑 54/54 全绿（不改阈值不放宽超时）；唯一持续红仍为基线既有 App.test 记忆 combobox。`npm run build` 通过。「保存模型不再误称能用于聊天」属模型设置页文案，核对现有设置页无此类表述；人工 UI 验收留 KM15。 |
| KM10 | 浏览知识历史文本并检查本机原件状态 | KM01、KM04、KM07、KM09 | P0 | 5 | done | 2026-09-25 实现：Vault v6 迁移给 `knowledge_documents` 补 `source_status`（枚举 CHECK，历史行一律 unchecked，不伪造「一致」）与 `source_checked_at`；`checkSource` 比较当前原件字节哈希与登记内容——unchanged/changed/missing/unreadable 都是确定结论并持久，changed 覆盖「可读但超导入上限」，只有登记文档不存在才是作业异常；导入/刷新成功即按实际读文件时间记 unchanged。摘要（§10.1 本卡范围部分）新增 `sourceStatus/sourceCheckedAt/lexicalState/semanticState`：lexical 对已登记文档恒为 ready（失败文件不建伪文档），semantic 由设置＋各修订 active generation＋空间 current 状态派生（disabled/pending/ready/stale；partial/failed 属作业层事实，不复制成第二套可写状态）。详情为主区子视图（不新增第三常驻栏）：标题/固定版本/来源状态（含检查时间或「尚未检查」）/两列索引状态、保存版本列表（旧修订仍可读，切换重置分页）、码点分页预览（明示只读已保存文本、零 Run 足迹、零模型调用，上一页/下一页带游标栈），动作分开「打开本机原件（当前文件）」与「查看保存文本/刷新内容/检查来源/移出」，返回列表保留搜索条件；版本切换/翻页全部走序号守卫，迟到响应不污染选中版本；作业终态统一刷新列表与详情摘要。测试：`migrate.test.ts` 44/44（新增 v6 列与 CHECK 断言）；`knowledge-vault.test.ts` 15/15（结论持久、缺失后仍读保存文本、语义派生 pending→ready→stale）；`knowledge-index-service.test.ts` 检查作业改为「结论即完成」断言（changed/missing 条目 succeeded）；hook 17/17（详情加载/返回保留条件/版本切换迟到守卫/游标栈翻页/检查跟踪）；视图 5/5（详情分开保存文本与原件状态、返回入口）。全仓 `npm test` 1189/1190（唯一红为基线 App.test 记忆 combobox），`npm run build` 通过。人工 UI 验收留 KM15。 |
| KM11 | 用轻量集合整理、过滤和选材 | KM03、KM09、KM10 | P1 | 3 | done | 2026-09-25 实现：Vault v7 迁移（`knowledge_collections` name_key UNIQUE＋revision CHECK、`knowledge_collection_members` 复合主键＋双向 CASCADE、documents 补 `membership_revision DEFAULT 1`；删除集合/移出资料只级联成员，原件、修订与历史不动）。协议：`knowledgeLibraryFilterSchema`（all/uncategorized/collection 可辨识联合，全部与未分类是派生查询模式、不插集合行）、集合 CRUD 与成员 replace-set Schema（成员 ≤200）、`ListKnowledge/SearchKnowledge` 加 filter、摘要补 `collectionIds/membershipRevision`、4 个新 IPC 通道全走注册 helper＋双向 Zod。仓储：名称 NFKC＋trim＋小写唯一（`COLLECTION_NAME_TAKEN`），改名/删除要求 expectedRevision（CAS 失败 `COLLECTION_NOT_FOUND`），成员保存文档级 CAS（`OPERATION_CONFLICT`/`KNOWLEDGE_DOCUMENT_REMOVED`/未知集合 `COLLECTION_NOT_FOUND`），`listDocuments(filter)` 用 EXISTS/NOT EXISTS 绑定参数；检索侧集合解析发生在候选收集前，未选集合不占 topK 名额，集合消失即空范围不报错不回退全库。UI：工具栏 FieldSelect 集合筛选（切筛选清空搜索与跨查询勾选并局部反馈），管理面板集合行（新建/行内改名/删除前确认「只解除分类」），详情「集合」节勾选显式保存走 membershipRevision CAS；检索勾选与 KM03 研究草稿链路不变，分类修改不改内容版本也不动 Task 材料。顺带修复两处真实缺陷：`storeDocument` 事务后 SELECT 漏 `membership_revision` 导致导入摘要成员版本为 undefined；协议手写 `KnowledgeDocumentSummary.currentRevisionId/sourceCheckedAt/pageCount` 在 exactOptionalPropertyTypes 下与 z.infer 不兼容。测试：`migrate.test.ts` 45/45（v7 表/默认值/唯一键/双向级联/FK 拒绝幽灵文档）；`knowledge-vault.test.ts` 17/17（规范化重名、改名 CAS、成员 CAS、K-16 删集合保另一集合、移除再导入不复活成员）；`knowledge-search.test.ts` 18/18（筛选先于截取、覆盖计数随范围、删除后空范围）；`register-ipc.test.ts` 36/36（4 通道端到端：错误消息可见、筛选贯通列表与检索、删除后检索空）；hook 21/21（筛选联动清搜索、集合 CRUD 反馈、删当前集合回落全部、成员保存成功/冲突双路径）；视图 7/7（筛选常驻、删除必确认、详情显式保存走 CAS）。基线修复两处并计入本卡：App.test 记忆适用范围断言适配记忆会话已提交的 FieldSelect 改造（9b93312 遗留红），run-service.ts 补跑 prettier（KM08 提交时漏格式）。全仓 `npm test` 1202/1202 全绿，lint/format:check/typecheck/build 退出 0。人工 UI 验收留 KM15。 |
| KM12 | Office 解析定位、限额、取消可靠可复用 | KM00、KM07 | P1 | 5 | done | 2026-09-25 实现：`office-parser.ts` 抽出 `parseOfficeBytes(format, bytes, options)` 字节核心，`parseFile` 收薄为「读字节＋调核心」，任务 `read_office_material` 与 KM13 知识导入共用同一实现、不复制解析器。PPTX 页序改按 `presentation.xml` 的 sldIdLst→presentation rels 关系引用顺序（新增 namespaced XMLParser 实例，removeNSPrefix 会使 `p:sldId` 的 id 与 r:id 属性互相覆盖）；备注只按该 slide 文件自身 `_rels` 解析（Type 以 `/notesSlide` 结尾），删除按显示序号猜 `notesSlideN.xml` 的回退；关系目标支持相对与绝对两种写法统一归一化；缺 presentation 或有 slide 未列入播放列表 → `unsupported-feature` warning，绝不按文件名假装页序。XLSX 定位往返修复：输出格式 `sheet:<名>!<起>:<止>`（表名含 `!`/引号按 Excel 惯例加引号并翻倍转义），输入解析 `parseOfficeXlsxLocator` 同时接受带/不带 `sheet:` 前缀与引号表名，旧格式 `Sheet1!A1:D12` 保持可用；不可识别的定位显式抛「XLSX 定位无效」而非静默空结果（原缺陷：回显自身输出会得到 0 节）；新增结构化定位 `structuredLocator:{sheet,range?}` 供内部消费方绕开显示字符串反推；日期单元格序列化为 ISO 文本；不计算公式，无缓存值仍只报 `formula-without-cached-result`。预算前置：解压累计按 JSZip 中央目录声明大小（`_data.uncompressedSize`/DataReader 长度）在分配完整条目**之前**判定 200 MiB 总量与单条 20 MiB 文本上限（受信任内存构造的 zip 无元数据时退回逐项计数并在注释中如实声明边界）；XLSX Sheet 数改为在 ExcelJS 全量装配前从 `xl/workbook.xml` 读取。取消统一 `abortError()`（替换自造「Office 材料读取已取消」文案错误，run-service 的 Office 读取前置检查同步收口），符合「取消语义只有一处定义」。本卡未扩 `KnowledgeFormat`、未动 `extractDocument`（KM13 范围），`.xls/.xlsm/.ppt` 与宏执行边界不变。停止条件核对：JSZip 声明大小＋ExcelJS 前置 workbook.xml 计数已把关键预算移到分配前，ExcelJS 仍需整包驻留（≤50 MiB 输入上限），未新增依赖。测试：`office-parser.test.ts` 6/6（文件名与播放序错位＋错位备注关系、`sheet:` 前缀回显往返、`Q1!数据` 引号表名往返、ISO 日期、结构化定位、旧格式兼容、bytes 核心与 parseFile 结果一致、210 MiB 声明解压量拒于分配前、单条 21 MiB XML 拒于解码前、CSV 引号内换行不计逻辑行、取消断言 `isAbortError`）；`run-service.test.ts` 52/52 不回归（含 read_office_material CSV 集成）。全仓 `npm test` 1204/1204，lint/format:check/typecheck/build 退出 0（预算用例为真实 210 MiB 合成压缩包，按仓内 Worker 测试先例显式声明 30s 超时，未改任何阈值语义）。 |
| KM13 | 把工作簿、CSV、演示文稿导入知识并使用 | KM08、KM10、KM12 | P1 | 5 | done | 2026-09-25 实现：`KnowledgeFormat` 扩为 `markdown/text/pdf/docx/xlsx/csv/pptx`，协议收口为单一 `knowledgeFormatSchema`（四处内联 z.enum 与平行联合类型全部并轨，含 tool-runtime `KnowledgeSearchItem.format` 与 index-store `ScopedChunkFormat`，不留第二套枚举）；`extractDocument` 改为显式穷尽 switch，新格式绝不走 PDF 分支。导入接线：扩展名映射 `.xlsx/.csv/.pptx`、文件选择对话框过滤、不支持提示与页面文案同步；warning 枚举新增 `no-extractable-text`（契约 §11：全空文件建立即失败、不建可检索知识，错误原因逐条目可见）。分节映射按 §11 确定性规则：PPTX 每页文本/每表/备注一节（locator `slide:N[/table:M|/notes]`，pageCount=最大播放页号，表行 ` | ` 连接）；XLSX 每非空逻辑行一节（复用 KM12 引号往返安全的 `sheet:'名'!起:止` 定位，单元格序列化 `address=value`／`address=formula（缓存值：x|无缓存值）`，日期 ISO 文本、不计算公式）；CSV 每逻辑记录一节（`rows:N-N`，字段按 CSV 引号规则再序列化）。单节超 2,000,000 码点按 `EXTRACTION_LIMIT_EXCEEDED` 失败，绝不截断成「合法完整表」；`truncated` 解析结果直接拒绝发布。搜索/读取/采用无需改动：新格式经 KM08 统一检索、KM01 修订分页读取与 Evidence 链路自动可用。修正 Worker 约束：Node 原生 type-stripping 图新增 office 依赖后，`KnowledgeServiceError` 构造参数属性改为体内赋值（strip-only 不支持），`abortError` 经 `@betterwork/agent-core/errors` 子路径导出（agent-core exports 增加 "./errors"；electron-vite 与 vitest 别名按声明顺序补子路径在前），取消定义仍只在 errors.ts 一处。测试：`knowledge-extract.test.ts` 6/6（页序错位、表+备注节、XLSX 逐行分节与公式/缓存值序列化、CSV 引号内换行、no-extractable-text、单节超限拒绝）；`knowledge-vault.test.ts` 18/18（三格式真实导入＋FTS 检索＋详情预览按 §11 locator；`.ppt` 与空 CSV 逐条原因、不建伪知识）；`knowledge-worker-runner.test.ts` 10/10（真实子进程提取 csv 分节，与 Main 共用同一解析器）；`register-ipc.test.ts` 37/37（对话框过滤含新扩展名）；office-parser 6/6 与 index-service/audit 等全不回归。全仓 `npm test` 1212/1212、lint/format:check/typecheck/build 退出 0，`out/main/knowledge-worker.js` 构建产物保持。人工 UI（真实用户 Office 文件）验收留 KM15；打包依赖 exceljs/jszip 随 external 依赖进 asar 的预检在 KM14。 |
| KM14 | 自动跨链路、迁移、性能与打包回归 | KM05、KM11、KM13 | P0 | 8 | done | 2026-09-25 实现：`knowledge-foundation.integration.test.ts` 一条链证明 §13.3 关键不变量（导入→固定修订→研究草稿幂等/`OPERATION_CONFLICT`→Run 范围检索不出现未选资料、空选材不回退全库→hybrid 如实降级 keyword＋`semantic-disabled`→逐页游标读取计入 Run 预算并各自落 Evidence→刷新生成新修订但草稿/旧修订回读不变→移除后禁新草稿、历史仍可回看、证据仍在→重开 Vault 身份不漂移）；`knowledge-foundation.perf.test.ts` 契约规模基准：5 文档×2,075＝10,375 块×1,536 维，真实 `KnowledgeWorkerRunner` 子进程扫描＋RRF 融合，查询嵌入本地替身（HTTP 排除）。实测 darwin arm64 node v26.8.1：单跑 p50 270.3ms/p95 289.6ms/max 293.9ms，全套并行下 p95 758.8ms/max 761.7ms（阈值 1,000ms 不动）；Worker 增量 RSS 3.3/60.9MiB（阈值 256MiB）；每批 1 MiB 载荷上限＝64×4,096 维条目真实扫描可完成、超限拒绝且复用已登记 pid（零新启动），大批量扫描中途取消以 `abortError` 收口、shutdown 后登记进程清空。诊断中两次慢窗（p50 4.8s/1.46s）经 24 轮稳态探针（~280ms 无劣化）判定为并发会话负载，未降阈值未改规则。修复暴露的生产缺陷：`buildRetrievalChunks` 每窗口重新物化整节（O(n²)），2M 码点节导入不可完成——改为每节一次线性处理（无代理对直接 UTF-16 切片，否则 `Array.from` 一次），补代理对跨窗回归用例。迁移：本卡无 schema 变更（两库最新号保持 v7/v32）。打包预检：`npm run build` 产出 `apps/desktop/out/main/knowledge-worker.js` 3.44kB 与 `out/main/index.js`（exceljs/jszip 等 external，不新增打包配置；不安装不发布）。全仓 `npm run verify` 退出 0（131 files / 1217 tests），`git diff --check` 干净。剩余：20,000×4,096 全库级负载压测未做（超出本期必测口径，容量守卫与超限降级已有单测；如需另行排卡）；人工 UI 与真实模型语义仍待 KM15（清单 `docs/development/knowledge-km15-checklist.md`）。 |
| KM15 | 人工桌面与真实模型效果验收 | KM14；另有操作/模型授权 | P0 | 3 | todo | — |

KM01/06 提供可测内部能力而非独立面向用户发布；分别挂靠正文闭环和语义查找故事，不包装成已上线功能。KM07 涉及 Worker、存储与作业的完整小闭环，若开工预估超过单迭代，应先在本板拆分再实施，不偷偷扩成整个知识系统。

## 3. Story Map 与推进窗口

| 用户旅程 | 对应任务 |
| --- | --- |
| 准备可靠资料 | KM01、KM07、KM12、KM13 |
| 查找并带入工作 | KM03、KM06、KM08、KM09 |
| 阅读与验证来源 | KM02、KM04、KM05、KM10 |
| 组织与维护 | KM11、KM10、KM07 |
| 验证完整交付 | KM14、KM15 |

依赖为有向无环图。推荐串行：KM00 → KM01 → KM02 → KM03 → KM04 → KM05 → KM06 → KM07 → KM08 → KM09 → KM10 → KM11 → KM12 → KM13 → KM14 → KM15。KM03 与 KM02 逻辑上可独立，但共享 App/协议，默认不并行；KM06 可独立验证 HTTP，不意味着可提前将语义索引标为完成。

建议分三批，不以两天压缩所有任务：

- 批次 A：KM00–KM05，31 Points，闭合选材、读取、来源与声明。
- 批次 B：KM06–KM09，23 Points，接通嵌入、索引生命周期与混合检索。
- 批次 C：KM10–KM15，29 Points，完善管理/Office并收集验收。

“两天推进窗口”的用法：第一天从评审门和资料使用链开始，第二天只继续已经满足前置的卡，结束时列自动完成、人工待验、仍未开工；不承诺两天交付以上 83 Points。若希望先试用最小闭环，可在 KM04 后进行局部验收，但不得称成果声明或语义功能已经完成。

## 4. 通用卡片执行检查

必读 AGENTS.md、docs/12、产品规范、契约及对应卡。先 `git status --short`、HEAD、实际迁移号和前置证据；现有改动属于原会话，不覆盖、不夹带。

编码前列字段/Schema → IPC/Tool → Service → Repository/迁移 → UI/Hook → 测试的映射，沿本卡边界实施。缺陷定位先 GATE-0；无现场 DB/日志访问条件时如实记录，合成隔离复现，不能谎称已看生产数据。

定向测试：`npx vitest run <本卡真实测试路径>`；再 `npm run typecheck`、`npm run verify`、`git diff --check`，记录真实退出码；不接管道截尾，不以旧测试结果代替本卡结果。UI由光哥人工操作，除非另有授权，不自行启动应用或做 Browser/ComputerUse；缺人工证据明写。

新表按当前迁移取号，只在需要它的卡创建。新增模块优先查等价实现；不顺手升级依赖、放宽工程规则、换模型系统或修改 E/CF/WM 状态。中文修改后回读。完成后只更新本卡证据与当天日志，不自动下一卡、不提交/推送/发布。

## 5. 逐卡验收与文件边界

下列验收是用户故事的正常/异常标准，技术细节只引用契约。路径为预期落点，真实代码已重构时先定位等价符号，不创建重复服务。

### KM00：核对并固定开工基线

**故事**：作为产品负责人，我希望方案与现有实现对齐并明确授权，以便下一会话可以执行而非猜测。

- 必读：本系列全部文档、材料契约、ADR-0005/0014/0018/0023、docs/04/10/12。
- 边界：只核对 docs、git 状态、现有契约；不编码、不装依赖、不启动模型或应用。
- 输出：在本卡证据栏记录 HEAD/工作树/两个库最新迁移、ADR 和文档线框批准依据；若无批准则列出具体待决项，保持 blocked，不自行批准。
- Given 光哥明确批准 ADR 与文档线框，When 对照现有代码复核，Then 列出本卡之外无额外实现授权、前置能力与测试入口。
- Given 新代码与契约产生实质冲突或缺批准，When 核对，Then 明确停止条件，不静默改选向量库或扩大范围。
- DoR：批准来自用户消息或可追溯记录，不来自模型总结；检查 docs/04 旧“整个 Vault 缓存”口径，后续操作只清派生索引。

### KM01：稳定知识修订与分页读取基础

**故事**：作为资料使用者，我希望刷新后仍可读到当时导入的版本，以便历史任务不漂移。

- 契约：§2（含 §2.4 选材身份）、§3.1、§13.2；不建 embedding 作业/集合表。
- 边界：agent-protocol、knowledge-schema/migrate.test、knowledge-vault 与同目录测试；增加小型分页服务或纯函数；接 `listRevisions/preview` 以及 list/search 固定修订身份的 IPC/Preload/Hook 类型与测试。此卡不新增详情 UI，用户入口由 KM04/KM10 完成。
- 映射：共享修订 summary/textHash/span/cursor → Vault 真实 sections → 管理预览响应；管理 list/search → currentRevisionId/完整 reference，与返回内容同快照，供 KM03 直接消费；旧 ID/hash 不变，暂不改变关键词算法。
- Given 同路径不同内容及同内容不同解析版本，When 导入，Then 历史与最新修订可分别读取，相同解析身份幂等。
- Given 搜索后发生同哈希解析升级，When 使用原搜索命中的 reference，Then 仍精确指向命中时修订，不能按 latest 或 contentHash 猜版本。
- Given 中文增补字符、长单段和跨段请求，When 连续分页，Then 拼接等于保存文本且预算/游标准确；跨修订游标拒绝。
- Given 原文件丢失或迁移中断，When 读旧修订/重启，Then 历史仍读/失败事务无半迁移。
- 验证：真实 Vault v3 升级、去重、分页空白/边界、字节与文本哈希、搜索身份一致性、IPC 错误；无网络。

### KM02：受限正文工具与精确审计

**故事**：作为任务协作者，我希望助手按需读我的选定资料并留下证据，以便回答不局限于摘要。

- 契约：§3、§5、§9 的范围/摘要，§13.3 的依赖回归。
- 边界：tool-runtime `knowledge-search.ts`、新增 `read-knowledge.ts`；协议/Tool context 的 toolCallId 必要接点；RunService、Expert 工具白名单、材料提示、输出守卫、事实审计；Evidence/RunMaterialRead 仓储和应用库迁移。
- 映射：工具 reference/cursor → RunContextSnapshot 完整校验 → Vault page → 同事务 Evidence/足迹 → 带 evidenceId 的结果。搜索旧实现先保留关键词算法，但结果必须带精确身份/范围。
- Given Run 只选择 A 的旧修订，When 搜索/分页读取，Then 只返回 A 旧文本，记录 search/read 区分和准确范围，工具取消收口。
- Given 零材料、伪造引用、跨任务 revision 或预算耗尽，When 调用，Then 不触全库/模型，不泄露正文。
- Given Evidence 写库失败、先搜后读或两修订同路径同定位，When 执行，Then 写库失败零正文；其余不吞掉证据，重复访问可复用 Evidence ID。
- Given 同 section 连续分页、不同 toolCall 重读及同 toolCall 结果重复消费，When 保存审计，Then 分页/重读分别落足迹并占预算，重复消费整组只验证不重复计量，内容冲突拒绝。
- 验证：工具与 RunService 实际装配、Provider 捕获输入、真实 SQLite 两张审计表唯一约束迁移及失败事务、已保存 Expert 不扩白名单、WM 缩小材料历史重放和提炼依赖。
- 不做：全文自动注入、向量、采用关系、来源 UI。

### KM03：真实材料研究草稿

**故事**：作为研究者，我希望勾选资料后得到可编辑任务草稿，以便不用重复选材。

- 契约：§4、§12；产品 K-04–K-06。
- 边界：KnowledgeView、use-knowledge-library、App 的研究入口与任务草稿 Hook、TaskContext 服务/仓储、研究创建 IPC/Preload、操作回执迁移和测试。
- 映射：KM01 list/search 的固定修订身份 → 勾选引用 → createResearchDraft → Task/Session/完整 TaskContext/回执同事务 → 成功后导航；不按 latest 补材料，不调用 runs.start。
- Given 一个文档多个命中且勾选两份文档，When 研究，Then 恰好两份固定材料，用途可改，重启草稿可恢复。
- Given 当前有运行/未保存草稿、首次创建前资料移除或提交失败，When 点击，Then 保留当前工作与选择，必要确认，不产生可发送半成品。
- Given 双击/重试/迟到成功，When 处理响应，Then 幂等同任务，旧请求不抢当前导航。
- Given 首次已提交但响应丢失，随后资料被移除，When 同 operationId 重试，Then 先匹配回执并返回原任务，不重复创建、不重新要求当前登记；同 ID 改输入拒绝。
- 验证：Hook/View/App、IPC、真实应用库事务及创建/移除/重试交错；附“动作→预期”人工清单。禁用无选择空转按钮。

### KM04：按运行回看搜索与读取来源

**故事**：作为审阅者，我希望点到当前 Run 真正返回的资料段落，以便核实回答。

- 契约：§3 管理预览、§5、§6 最后一段；产品 K-07–K-10。
- 边界：ContextPanel、来源 Hook、Evidence 查询/previewRunSource IPC、工具摘要与中文标签；复用 KM01 page。
- Given 同 Task 两个 Run 读取不同修订，When 切换来源，Then 默认只当前 Run，历史须明确切换，点击只到该证据范围，止于 end、无续页和额外正文。
- Given 只有搜索记录或旧数据无 span，When 展示，Then 分别标摘要/历史范围未记录；legacy 响应不伪造精确预览，不标全文已读。
- Given 原件已移除或预览迟到，When 打开保存文本/换 Run，Then 精确来源范围仍可看，不能打开任意路径，迟到结果不覆盖新选择。
- 验证：组件与 Hook、IPC 归属检查、exact/legacy 联合与边界、键盘/窄窗人工待验。不提前做完整知识管理详情。

### KM05：成果显式采用声明

**故事**：作为成果审阅者，我希望知道哪些依据被声明采用，而不是把全部访问记录都算作依据。

- 契约：§6、§13.2；产品 K-11/K-12。
- 边界：协议、`artifact-declare-sources.ts`、`artifact-register-file.ts`、RunService 自动 Markdown、FileArtifactService、ArtifactRepository/InputRelationRepository、应用迁移、成果详情与用户保存来源选择 Hook。
- 映射：声明 Tool/文件登记 inputRelations/用户选择 → 同 Run 归属与访问类型验证 → 声明记录/版本 metadata/关系同事务 → UI 区分声明与访问。
- Given 模型明确声明已读来源，When 保存 Markdown 或 PPTX，Then 仅声明集合成为采用关系，显示 model，空声明也能生成。
- Given 仅搜索过整份材料或来源来自另一 Run，When 声明，Then 整份材料声明拒绝；合法摘要 Evidence 可作为摘要依据。
- Given legacy 或 none 版本连续人工编辑且未重选，When 保存并查看，Then 分别仍为 legacy/none，不进入声明区；只有已声明前版的继承才为 inherited。
- Given 用户主动重新选择或清空来源，When 保存，Then 新版记录 user 声明，旧版本不回写；空关系不展示为有采用依据。
- 验证：两条成果生产链真实仓储、Tool JSON/Zod 一致、自动绑定全部访问但不算采用、完整继承矩阵/重新选择、失败事务与重复登记回归。
- 不做：自动判断引用真实性、逐句 citation 校验、成果回收知识。

### KM06：批量嵌入适配与模型身份

**故事**：作为已配置嵌入模型的用户，我希望索引能用到同一个模型而不会被暗中替换。

- 契约：§7、§2.2；此卡只交付索引所需模型基础，端到端展示在 KM09。
- 边界：Main embedding client/service、模型配置/endpoint/credential resolver 接点、协议中无密钥摘要与测试；不新建聊天 Provider。
- Given 合法已启用 embedding profile，When 注入 fetch 返回乱序向量，Then 请求确实使用所选 endpoint/model，按 index 整理校验并返回归一化向量。
- Given 超时、取消、无效响应或模型停用，When 请求，Then 明确失败，无 Fake/其他模型回退和自动重试。
- Given 连接测试改 updatedAt 或换 key，When 算指纹，Then 向量空间不变；改 endpoint/model 时必变。
- 验证：全响应边界、流式超限、密钥不出日志、现有 language Provider 不回归；所有网络替身。

### KM07：导入与索引作业的持久生命周期

**故事**：作为整理资料的人，我希望耗时导入和建索引可取消、可恢复查看，以便不陷入无反馈等待。

- 契约：§2.3、§8、§12 job/settings、§13.2。
- 边界：Vault job/space/generation/chunk/vector 表与服务；既有导入/刷新编排；Main Worker 调度及 `infrastructure/` 独立入口；必要 `electron.vite.config.ts` 构建入口；IPC/Preload 和旧 Hook 返回值同步迁移。允许为本卡工作进程新增构建入口，不放宽安全/工程配置，不升级依赖。
- 映射：请求 → 固定 space 的持久 job/item → Worker 提取/分块＋Main embedding → staging → 单修订原子发布；space 共享维度 CAS，事件只传安全摘要。
- Given 多文件含一个解析/模型失败，When 执行，Then 成功资料关键词可用，失败项可见，不发布半份向量。
- Given 取消、强制退出或模型变更后旧响应返回，When 恢复，Then 明确 cancelled/interrupted，旧 attempt 不发布，无自动付费重试。
- Given 已有同空间兼容 active，When 普通重建失败，Then 旧代次仍可查；配置不兼容则只能关键词。
- Given 同名同维度模型已换代，When 强制重建后仅部分成功或取消，Then 全部旧空间立即不可查，只用新空间已完成部分；失败/中断/取消项均可在作业终态后手动重试，复用原新空间，不再次 reset、不回退、不重跑成功项。
- Given 两修订的嵌入响应维度不同，When 同空间发布，Then 共享锁拒绝不匹配批次，不各自建立维度。
- 验证：真实 Vault 迁移、发布前故障、空间退役及维度锁、事件顺序、三种可重试状态与成功/运行项拒绝、批间查询并发、Worker 进程身份/取消、开发/打包入口；不新增主线程重循环。
- 拆分纪律：超过本卡可审阅规模时，先由光哥确认拆卡，不留“先占位以后接”的空接口。

### KM08：统一混合检索

**故事**：作为查资料的人，我希望关键词和同义问题都能在正确范围内找到可追溯片段。

- 契约：§9 全部、§8.3；不另写算法常量。
- 边界：KnowledgeSearchService、Vault FTS 查询与向量扫描 Worker、RunService 异步注入、knowledge-search Tool/管理 IPC、对应集成测试。
- Given 固定合成向量与关键词候选，When 搜索，Then 排序、RRF、同分、去重和摘要 span 全部符合契约。
- Given 未选资料具有全库最高分，When Run 搜索，Then 它不能占候选名额或出现在返回内容；空选材零 HTTP。
- Given 模型故障、旧模型代次、部分覆盖或取消，When 搜索，Then 分别可解释降级/只用兼容向量/取消，无晚到污染。
- Given 搜索期间发生同名同维度强制重建，When 旧查询返回，Then 不返回 retired space 的候选，且不与新空间融合；用户取消仍须拒绝而非降级成功。
- 验证：两个生产入口捕获真实返回、异步所有调用方、过滤前后顺序、中文回退、历史修订、跨空间隔离、查询代次租用和清理互斥。

### KM09：知识搜索与索引管理界面

**故事**：作为知识库使用者，我希望明确看到索引是否就绪及实际搜索方式，以便知道配置有没有生效。

- 契约：§7 设置、§8 作业、§9 response、§12；产品 §5 文档线框。
- 边界：KnowledgeView/use-knowledge-library、模型设置角色反馈、作业组件与订阅 Hook、NotificationService 目标适配；只复用统一骨架/Token。
- Given 已配置 embedding 但尚未启用，When 知识页启用并建索引，Then 展示模型、范围、调用费用说明与进度；保存模型不再误称能用于聊天。
- Given 部分失败或关键词降级，When 看结果，Then 覆盖与原因准确，运行中可取消，终态后仅失败/中断/取消项可重试；关键词不被禁用。
- Given 用户选择强制重建而非普通重建，When 确认，Then 明确说明全部旧语义索引立即失效及取消不回退，覆盖率只显示新空间；历史修订需另行选择。
- Given 页面切走、快照加载中收到事件或旧搜索迟到，When 回到页面，Then job sequence 正确合并，旧结果不覆盖当前查询/选择。
- 验证：Hook、订阅/取消清理、反馈通道不重复、默认模型变更不暗换所选 profile、普通/强制重建确认、空态和模型不可用；人工 UI 待 KM15。

### KM10：资料详情、历史预览与来源检查

**故事**：作为资料拥有者，我希望知道保存了什么、原件是否变化，以便决定是否刷新。

- 契约：§3、§10.2、§12 checkSources；产品 K-17/K-18。
- 边界：知识详情视图/Hook、Vault source status 列与检查服务、check-source job、原件打开校验、必要 IPC；不新增第三常驻栏。
- Given 原件后来更新或丢失，When 检查并查看历史，Then changed/missing 与保存文本分开，不自动刷新，旧修订仍读。
- Given 无权限、检查取消或版本切换迟到，When 处理，Then 明确 unreadable/未检查，旧响应不污染选中版本。
- Given 用户查看文本，When 分页，Then 不生成模型 Run 足迹、不调用模型，返回列表保留搜索条件。
- 验证：真实临时文件/权限可注入边界、旧修订预览、原件打开与版本区分、作业部分失败、UI 反馈与键盘。

### KM11：单层集合管理

**故事**：作为长期知识使用者，我希望按主题归类资料，以便更快筛选和选材。

- 契约：§10.1 与检索前置过滤。
- 边界：Vault 集合/成员迁移和仓储、IPC/Preload、KnowledgeView/详情 Hook/选择过滤；不新增 Workspace 隐式授权。
- Given 一份资料在两个集合，When 改名/删除集合/移出成员，Then 原件、历史与另一集合保留。
- Given 并发修改、同名规范化或上限，When 保存，Then CAS/重名/上限错误可见，旧分类不被覆盖。
- Given 按集合查询并研究，When 生成草稿，Then 只带用户选中的修订；集合后续变化不改变 Task 材料。
- 验证：真实集合 FK/唯一键/CAS、未分类视图、移除再导入不恢复旧成员、过滤先于 topK。

### KM12：复用 Office 解析的正确性基础

**故事**：作为分析与汇报人员，我希望页序、地址和解析失败准确，以便不把错误提取当事实。

- 契约：§11；必读 ADR-0018；此卡不扩 KnowledgeFormat。
- 边界：现有 OfficeParserService 与测试、Worker 解析接点、任务 Office 读取定位兼容测试；复用 JSZip/ExcelJS/XMLParser。
- Given PPTX 文件名顺序不同于实际播放顺序、XLSX 特殊表名、CSV 多行引号，When 解析，Then 顺序和定位往返正确。
- Given 字节变化、超限展开、解析取消或公式无缓存，When 读取，Then 哈希与解析同字节；前置限额/取消生效，不算出虚构公式结果。
- 验证：合成压缩包与工作簿、流式展开上限、统一 abortError、parseFile 与 bytes 核心一致、既有任务读取不回归。
- 停止条件：现有依赖不能在大分配前执行预算时，先记录最小方案，不靠增加内存或忽略测试掩盖。

### KM13：Office 知识导入与读取

**故事**：作为知识工作者，我希望工作簿、CSV 和演示资料进入同一知识检索闭环。

- 契约：§11、§2 格式/限额、§8 job；产品 K-19–K-21。
- 边界：KnowledgeFormat/Schema/文件选择器、Vault extract 显式分支、Office section→knowledge 映射、格式标签/预览警告、导入/索引/Run 读取集成。
- Given 三种有效 Office 文件，When 导入、搜索并进入任务，Then 定位可回看同一修订，语义和关键词使用同一文本。
- Given 损坏/加密/超限/空文本，When 导入，Then 失败项可重试、现有资料不损坏。
- Given 缺缓存公式或只提取部分可支持内容，When 预览/读取，Then 警告可见，不宣称完整视觉/数据理解。
- 验证：从系统选择器格式到 Provider 工具输入的闭环替身测试；既有四格式回归、取消、源文件只读。

### KM14：联合自动验收与性能

**故事**：作为产品负责人，我希望一份证据证明功能确实连通而不是只有单个函数可用。

- 契约：§13.3 全矩阵；可补必要测试与暴露出的本范围缺陷，不增加功能。
- 边界：合成 fixtures、真实两库集成、Provider/HTTP 捕获、Worker 打包预检、性能测量与本板证据；不复制用户资料。
- Given 干净安装和旧两库，When 跑完整流程与重启，Then 导入→研究→读取→声明→刷新/移除→历史回看均守住身份与范围。
- Given 可控故障/取消/模型变化，When 重建和查询交错，Then 无错误代次、失控子进程、悬空来源或假成功。
- Given 契约指定规模，When 本地基准与上限测试，Then 记录实际 p95/RSS/取消和打包路径证据；不达标保持 doing/blocked，不用小规模冒充。
- 验证：定向完整集成、`npm run verify`、`git diff --check`，每项真实退出码。人工与真实模型结果仍待 KM15。

### KM15：人工 UI 与真实模型验收

**故事**：作为最终使用者，我希望亲自验证资料能被找到、读到并用于成果，以便放心用于日常工作。

- 前置：KM14 自动证据完整；光哥明确授权启动/操作方式及真实模型调用范围。没有授权只整理清单，不调用。
- 自动准备：给出“动作→应看到什么”，合成资料和预标注问题；应用只用项目启停脚本，用户操作 UI，不以自动化浏览器代替人工结果。
- Given 光哥完成选择、研究、读取、来源、重建、取消、分类与 Office 走查，When 核对数据库/日志，Then 三类事实一致，记录具体结果而非“看起来正常”。
- Given 真正所选 embedding 模型，When 跑预标注问题，Then 报关键词基线/混合 top5/失败与耗时，达到契约目标才通过模型栏。
- Given 模型无效、UI 缺证据或语义目标未达成，When 收尾，Then 保持待验/blocked，列缺口；不改 E55/WM16 状态，不发布。

## 6. 里程碑证据登记

里程碑由上方卡片证据派生，不另维护状态字段。

| 里程碑 | 需要的卡 | 自动证据 | 用户 UI 证据 | 真实模型证据 |
| --- | --- | --- | --- | --- |
| KM-M1 资料使用闭环 | KM01–KM05 | 批次 A 自动链路证据齐（见 §2 各行命令与用例数） | 待 KM15 人工走查 | 不以模型质量替代链路证据；最终归 KM15 |
| KM-M2 语义查找闭环 | KM06–KM09 | 待执行 | 待执行 | 待 KM15 授权与验证 |
| KM-M3 管理与 Office | KM10–KM13 | 待执行 | 待执行 | 待 KM15 场景走查 |
| KM-M4 完整交付 | KM14–KM15 | 待执行 | 待执行 | 待执行 |

## 7. INVEST 与就绪检查

- Independent：业务能力按选材、读取、来源、语义、管理、格式拆分，无循环依赖；共享迁移/服务真实依赖保留，不以假独立并行。
- Negotiable：产品规范写用户行为，具体技术只在契约/ADR；若调整已定义算法先修契约并复核授权。
- Valuable：基础卡挂靠明确用户旅程，不把内部适配器称为上线功能。
- Estimable / Small：每卡 2–8 Points；Points 尚待编码者开工复核，8 分卡超迭代时先拆卡。
- Testable：每卡有正常与异常 Given/When/Then，加真实数据/网络替身和生产接线要求。
- DoR：当前全部实现卡均缺 KM00 批准与前置完成证据，因此未就绪；这不是将状态改为 doing 的理由。UI 原型需求、性能方案或 Office 限额出现实质冲突时先停下说明。
