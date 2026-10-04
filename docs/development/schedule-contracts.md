# 定时任务实施契约 v0.1

- 日期：2026-10-03；本轮核对 HEAD `9352dcbd5da2c1b5f11ab37ece794b3c475816ae`，应用库 v35，Knowledge Vault v7。实施时重新读取，不能预占后续迁移号。
- 产品：光哥已通过[低保真原型 P1–P6](../prototype/scheduled-tasks/README.md)。技术：本契约与 [ADR-0037](../adr/0037-scheduled-work-and-source-snapshots.md)为 Proposed；本轮只细化，不写生产代码。
- 唯一职责：定义 SC 字段、状态、时间、范围、事务、接口与失败语义。任务状态只记在[任务板](tasks-schedules.md)，可复制指令只记在[编码交接](schedule-coding-prompts.md)。工程写法仍以 docs/12 为唯一标准。

## 1. 产品与已有实现的对账

| 已批准交互                         | 实施约束                                                                 | 已有接点                                                        |
| ---------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 同一专家与长期目录，每期独立记录   | 固定 ExpertRevision + Workspace；每期 Task/Session；实例最多一个首个 Run | ExpertRepository、TaskContextRepository、RunService             |
| 工作目录与附加知识动态取材         | 保存来源描述；每期生成具体修订/文件快照；历史不热换                      | InputSnapshotService、TaskMaterialService、KnowledgeVault       |
| 错过仅提醒、人工补做原期间         | 自动唯一键；missed 保留；人工新实例关联原实例                            | 新 ScheduleOccurrence，复用 Task/Run                            |
| 成果积累、失败只重试保存           | ArtifactVersion 先落库；非覆盖副本及版本回执                             | FileArtifactService、ExecutionOutputService、ArtifactRepository |
| 无窗口后台执行与通知回看           | Main 装配；进程存活；结果一次通知；恢复导航                              | RunService、NotificationService、Application shutdown           |
| 整页列表/表单/详情、既有工作页协作 | 页面组合现有基座，动作进 Hook，生产组件验证                              | docs/10 §10.1 实际台账；见本契约 §10                            |

不新增调度 Agent、模型设置、知识管理页、Project、工作空间删除、云/OS 调度或自动审批。Workspace 隐藏只影响侧栏，不暂停规则；根目录不可用才阻塞。

## 2. 精确领域字段与状态

ID 使用既有 UUID 约定；时间落库为 UTC epoch milliseconds，显示按规则 timeZone。所有对象在共享协议用 strict Zod 校验。

### 2.1 Schedule 与不可变配置

`Schedule`：`id / workspaceId / revision / currentConfigVersion / lifecycle / nextScheduledAt? / lastProcessedScheduledAt? / enabledAt? / enabledConfigVersion? / capabilityFingerprint? / dispatchBlock? / createdAt / updatedAt`。

- `lifecycle = 'enabled' | 'paused' | 'archived'`。新建默认 paused；归档不可启用，历史只读保留。暂停不取消已开始 Run；取消准备中的自动实例。立即执行允许 paused，不允许 archived。
- `ScheduleConfig`：`scheduleId / version / name / expertId / expertRevisionId / requirements / expectedArtifactTypes / timing / periodRule / knowledgeSources / outputSubdirectory / createdAt`。
- `name` 1–100 字符、`requirements` 1–20,000 字符；`expectedArtifactTypes` 使用现有成果类型的 `markdown | presentation` 非空子集、最多 2 项；presentation 在首版明确校验为实际登记的 PPTX MIME/文件，界面称 PPTX。支持 Markdown、PPTX 或两者，不把格式名称当作新的 Artifact type，不顺带新增 DOCX/XLSX 成果生成或登记。
- Workspace 创建后不变；换长期目录应新建规则。`outputSubdirectory` 首版固定「定时成果」，界面只展示默认位置，不增设任意路径写入权限。
- 更新采用 `expectedRevision` CAS；所有配置/启停/归档变动递增 Schedule.revision；配置变动另外追加 configVersion，禁止覆盖旧配置。单用 configVersion 无法防止并发启停，因此 CAS 比较对象 revision。名称、要求、来源、专家变动保留下一时刻；只有 timing/timeZone 变动重算未来计划，先结算旧计划已过时刻。
- 专家新版本是查询投影：`boundRevision / latestRevision / updateAvailable`。绑定旧版本仍有效时继续运行；显式 apply 只追加 ScheduleConfig，不调用 Expert 的 saveRevision。
- 启用记录 `enabledAt / enabledConfigVersion / capabilityFingerprint`；影响授权/能力的配置变动必须重新预检并确认启用说明。只改名称不重复索取授权。

`knowledgeSources` 最多 50 个描述项，按稳定身份去重：`document(documentId)`、`collection(collectionId)`、`vault(vaultId='default')`；附 `purpose: MaterialPurpose`，默认 background。文档跟随当前有效修订，集合和库跟随后续成员，界面明确这项持续授权。单个 Vault 不支持任意磁盘路径。

### 2.2 ScheduleOccurrence

字段：`id / scheduleId / configVersion / trigger / scheduledAt? / requestedAt / requestKey? / originalOccurrenceId? / period / phase / preparationOutcome? / reasonCode? / reasonDetail? / taskId? / sessionId? / firstRunId? / sourceSnapshotId? / createdAt / preparedAt? / finishedAt?`。

- `trigger = 'scheduled' | 'manual-now' | 'manual-missed'`；`scheduled` 必有 scheduledAt，人工必有 requestKey。`manual-missed` 必引用同规则的 missed 实例，复制其期间，不改其记录。
- `phase = 'preparing' | 'dispatched' | 'closed'`。准备占用在同步事务内建立；只有 preparing 可进入 dispatched；关闭不可重新派发。
- `preparing` 覆盖 T2 至 T4：T3 前允许还没有 Task/Session；T3 原子提交后必须同时保存 `taskId / sessionId / sourceSnapshotId / preparedAt`，并继续保持 `preparing`，直到 T4 写入首个 Run。T4 前中断关闭时保留完整 T3 关联，使原 Task 草稿可人工继续；不创建 Run，也不再次派发。
- 无 Run 时，closed 的 `preparationOutcome = 'missed' | 'skipped-overlap' | 'blocked' | 'needs-material' | 'cancelled' | 'interrupted-before-run'`。允许 needs-material 携带原 Task，不允许伪造 Run。
- dispatched 必有 `taskId / sessionId / firstRunId / sourceSnapshotId`。Run 结束后 closed；Run 状态从真实首个 Run 查询，不另造 `lastRunStatus`。
- 自动唯一 `(scheduleId, scheduledAt)`，**配置版本不进入唯一键**。人工唯一 `(scheduleId, requestKey)`；重发相同键返回原实例，不能在客户端超时后造新键重试。
- 同规则 preparing 或首个 Run 仍活动：自动记录 skipped-overlap；人工返回 `schedule_busy` 与既有实例 ID。首个 Run 终态后等待审阅不占用下一期。
- `OccurrenceView` 结果由事实投影：`preparing / running / needs-material / generated / save-failed / no-target-artifact / failed / cancelled / missed / skipped-overlap / blocked / interrupted`。人工续作结果另外显示，不覆写当次自动工作结论。

### 2.3 本期来源与回执

`ScheduleSourceSnapshot`：`id / occurrenceId / workspaceId / status / configVersion / evaluatedAt / manifestHash / itemCount / totalFileBytes / failureCode? / createdAt / completedAt?`；status 沿用 `preparing | ready | failed | cancelled`。

`ScheduleSourceItem`：`snapshotId / ordinal / reference: MaterialReference / purpose: MaterialPurpose / origin / displayName / sourcePath?`；origin 区分 `workspace-directory | selected-document | selected-collection | selected-vault | expert-reference`。现有 reference/hash/purpose 字面不另造同义类型。内容必须先就绪，随后整个清单才能 ready。

`ScheduleOutputReceipt`：`id / occurrenceId / artifactVersionId / workspaceId / relativePath / contentHash / status / attempt / failureCode? / failureDetail? / createdAt / updatedAt`；status 为 `pending | saving | saved | failed`。同一版本和目标目录仅一个逻辑回执；失败重试递增 attempt，不增加模型 Run。

`ScheduleNotificationReceipt`：`occurrenceId / outcomeKey / notificationId / createdAt`，唯一 `(occurrenceId, outcomeKey)`；通知 ID 是回执值，不因通知清空而级联删除。恢复批次错过通知另有稳定 `batchKey`，覆盖的实例集合落库，不靠内存计数。

## 3. SQLite 与原子边界

应用库新增 `schedules / schedule_configs / schedule_occurrences / schedule_source_snapshots / schedule_source_items / schedule_output_receipts / schedule_notification_receipts / schedule_recovery_batches`。外键指向已有 Workspace、ExpertRevision、Task、Session、Run、ArtifactVersion；历史关系使用 RESTRICT 或保留引用，不新增硬删除 API。原有 Expert 删除检查也必须把 ScheduleConfig 的引用纳入判断。

索引至少覆盖 enabled + nextScheduledAt、规则历史 `(schedule_id, created_at, id)`、自动唯一键（仅 scheduled）、人工 requestKey（仅人工）、source ordinal、版本交付唯一键、通知 outcomeKey。每规则只有一个 preparing 实例由部分唯一索引保护；claim 事务另检查 dispatched 实例关联的真实 Run 是否仍为 running，Run 终态后释放后续周期，不等结果通知收口。分页默认 50、最大 100，游标 `(createdAt,id)`；不能只返回最近 Task 冒充完整历史。

迁移按实施时最后版本 + 1 分配，支持空库、旧库升级及重复启动；禁止启动时探表 ALTER。第一次迁移建新表与必要引用，后续 TaskContext/启用信息增量由所属卡追加迁移；不预分配固定 v36–vN。Vault 不新增调度表。

| 事务             | 同步共同提交                                                                 | 提交后动作                                        |
| ---------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| T1 保存配置      | CAS、配置追加、lifecycle/nextScheduledAt                                     | 通知页面数据变化；不启动模型                      |
| T2 占用计划      | 验证有效版本、插入实例、推进 cursor                                          | 准备文件/知识；重复占用返回既有实例               |
| T3 本期准备      | 已 ready 清单的引用、Task/Session/TaskContext、实例 task/session/source 关联 | 最终能力及撤销检查                                |
| T4 首个 Run 启动 | Run、RunContextSnapshot、既有记忆审计、Occurrence.firstRunId/phase           | 登记 activeRun 并开始异步 consume；事务失败无执行 |
| T5 结果通知      | 实例关闭事实、Notification、持久化去重回执                                   | 广播与最多一次当前系统通知                        |

T4 在 RunService 现有启动事务内增加窄的宿主关联参数/回调；由 Application 提供，禁止 Renderer 传 occurrenceId 启动任意 Run。回调只做同步关联，不启动任务、不调用网络。activeRuns 暂存可在事务前建立，但失败必须清除；consume 严格在 commit 后。测试要直接统计 Provider 调用，不能只数数据库记录。

文件复制、异步模型/凭据访问与两库读取不放进长 SQLite 写事务。Vault 在一次同步读取事务内解析集合成员与当前修订，随后按不可变 revision/hash 保存应用库清单；发送前校验修订仍可用。跨库间删除或撤销会阻塞，不回退 latest/全库，也不声称跨库原子提交。

## 4. 时间、期间与错过

### 4.1 首版规则

`ScheduleTiming` 是 daily `{hour,minute}`、weekly `{weekday:1..7,hour,minute}`、monthly `{day:1..31,hour,minute}` 的判别联合，附 `timeZone = Asia/Shanghai | Asia/Tokyo | UTC`。weekday 7 表示周日。默认每月 5 日 09:00、Asia/Shanghai、上一自然月，与通过的原型一致。分钟 0–59；不接受 Renderer 裸 cron、自定义秒或假期规则。

Main 生成六段表达式，秒固定 0：daily `0 m h * * *`，weekly `0 m h * * w`（周日映射 0），monthly `0 m h d * *`。同一个 `nextTimes(timing, after, count)` 供预览和调度使用，结果严格晚于 after，count 首版 3；月末 29/30/31 不存在则跳过该月，不替换成最后一天。

选择 `cron-parser` v5 API `CronExpressionParser.parse(expression, {currentDate, tz, strict:true})` 后迭代 next。2026-10-03 已核对 [npm 发布包](https://www.npmjs.com/package/cron-parser)为 5.10.1、MIT、Node ≥18；`npm view` 与发布 tarball dry-run 的完整性摘要一致。已将精确版本作为 Desktop 生产依赖并写入根 lockfile。实际 API 的六字段 strict、时区选项和月末 skip 已由 `schedule-calendar.test.ts` 验证；Desktop Electron Vite build 通过，未手写 cron 解析器降级。

### 4.2 期间

`PeriodRule = previous-month | rolling-seven-days | current-week | previous-week | none`。`ResolvedPeriod` 保存 rule、timeZone、anchorAt、`startAt? / endAt? / label`；none 不造起止时间，其余统一半开区间 `[startAt,endAt)`。

- 上一自然月：anchor 所在月前一月 1 日 00:00 至 anchor 所在月 1 日 00:00。
- 过去 7 天：anchor 前 7 个自然日同一时刻至 anchor；首版支持的固定偏移时区无 DST 差异。
- 本周至计划时刻：本周一 00:00 至 anchor；上一自然周：前一周一 00:00 至本周一 00:00。
- 若本周计划时刻恰为周一 00:00，当前周区间是合法空集，保存 `startAt = endAt = anchorAt` 并标示为空期间；其余有界期间必须 `startAt < endAt`。
- 自动以 scheduledAt 为 anchor，即使准备延迟也不改期间；立即执行以请求到达 Main 的 now 为 anchor。
- 人工补做以原 missed 的期间与 scheduledAt 为 anchor，使用**当前有效配置和新材料快照**，展示与原配置差异；不许诺恢复过去网页/文件。
- 历史月/季/半年对比写入 requirements；不按主期间过滤全部历史参考，也不把文件名/mtime 当作业务所属期间的证据。

### 4.3 时钟与生命周期语义

调度唤醒间隔 30 秒；正常连续运行的容许迟到 60 秒。注入 wall clock、monotonic clock、timer 和恢复原因，不在功能测试里等待真实分钟。正常 tick 只有 `0 <= now-scheduledAt <= 60s` 且时钟连续才可占用执行；过窗只 missed。

restart/resume 一律先处理 `scheduledAt < recoveryNow` 为 missed，即便差值不足 60 秒也不补跑。恰好 recoveryNow 的未来边界可供后续正常 tick 处理。休眠、退出或关闭派发期间的旧回调以 generation token 失效；恢复不能重放它。

wall 与 monotonic 的差值变化超过 60 秒判为时钟跳变：前调产生的历史计划只 missed；后调保持 lastProcessedScheduledAt 单调，不重复已处理时刻。检测到无效/不可信时间以 Schedule.dispatchBlock 保存 code/message/detectedAt 并停止派发；用户重新检查并启用时，预检须确认时间有效、清除 block 并重新预览未来计划。不能在错误时间自动发送模型请求。

首次启用/恢复暂停只从启用时刻之后计算，不生成暂停期间 missed。修改时间先结算旧规则已到期实例，再用新规则计算未来；同一时间点仍受自动唯一键保护。处理 missed 每事务最多 100 条，按游标分批让出事件循环；不能因间隔很久静默丢记录。恢复批次开始固定 cutoff，全部分批结算后发一条聚合通知，进程中断恢复同一 batchKey。

网络错误是当次阻塞/Run 失败；网络恢复只影响未来，没有补跑扫描或自动付费重试。

## 5. 来源范围、预算与本期继续协作

### 5.1 每期准备

1. 取得被占用的不可变配置，检查规则仍有效及 Workspace 根目录可访问。
2. 递归枚举当前目录的受支持普通文件：Markdown、Text、PDF、DOCX、XLSX、CSV、PPTX。排除 `.DS_Store`、`._*`、锁文件/临时文件、`.git`、`node_modules`、`.betterwork`；符号链接不跟随。其他格式计入排除摘要，不当作已读材料。
3. 「定时成果」中的文件可作为历史对比候选；仅枚举现存文件，按实际字节重新快照。即使能关联内部 ArtifactVersion，也不从内部存档补回用户已移除的目录文件。其他源文件用途默认 other，由专家依据内容区分本期/历史；候选用途不等于已判定所属期间。
4. 按配置解析知识文档当前有效修订、集合当前成员或 default Vault 当前有效文档。读取使用既有 revision/hash，保存集合身份与当期成员；空集合可以是合法参考范围，已选集合/文档被删除或读取失败则阻塞，不能降为全库。
5. 合并专家固定参考：同一来源、同一修订/hash 去重，保留专家用途；同一知识文档出现不同修订或不同 hash 返回 `schedule_source_conflict`，整期不启动。界面列出来源与版本，下一步为调整知识范围或应用已有专家新修订；不静默选择最新或旧版。
6. 文件调用 InputSnapshotService 复制并稳定校验。清单按稳定 reference key 排序并算 manifestHash；全部有效材料 ready 后一次发布来源快照。准备失败/取消保留原因，不暴露半份可运行清单。输入快照回收的活跃/保留引用查询必须纳入来源清单，不能把尚未创建 Task 的受管文件误当孤儿删除。

技术预算首版固定在共享常量并明确提示：来源描述最多 50 项；实际清单最多 2,000 项（含专家参考），目录文件最多 500 个、单文件 100 MiB（沿用快照上限）、合计 500 MiB、目录深度最多 12。超过预算整期 blocked，显示数量/大小及缩小范围入口，不静默截断。Knowledge 只保存修订引用，不复制全库正文；其读取继续执行既有分段/检索预算。

准备并发 2、总时限 120 秒、最大同时准备实例 2；规则可启用数首版最多 20。达到全局准备上限的准点实例记录 skipped-overlap，原因区分「后台容量已占用」，不排一个最终会补跑的隐藏队列。模型时限/轮数沿用已有 Run 策略，不新增无限重试。预算性能断言进入 bench；功能测试只断言数量、拒绝和取消行为。

PDF/DOCX 快照读取复用现有确定性提取器，Office 复用现有 office parser；不能把二进制当 UTF-8 或另写解析栈。SC04-5 在既有 scoped reader 接入快照格式分派，保持结构化读取足迹与来源定位。格式解析失败给出具体材料，不能表示全文已读。

### 5.2 Task 与 Run 的材料接入

TaskContextRevision 新增可选 `scheduleSourceSnapshotId`；RunContextSnapshot 保存同一 ID 供审计。Main 仅允许 occurrence 关联的 Task/Workspace 使用 ready 快照；普通 Task 不接受伪造 ID。草稿保存采取 **absent=保留 / null=移除 / ID=校验绑定** 的明确语义，旧客户端保存不能意外清除本期范围。

保留 `materials` 作为最多 50 项的显式补充；不修改普通任务上限。Main 在 Run 启动把来源快照 + 显式材料解析为最多 2,000 项的有效具体材料，执行重复/修订冲突校验，固定进 RunContextSnapshot；不经 IPC 传整个资料库，不向模型注入全部路径和正文。

模型材料说明只发送有界摘要：最多 40 项身份、最多 8,000 Unicode code points，带总数与检索/读取指引；没有列进摘要不等于失去已授权检索范围。搜索先按 Run 的有效修订集合过滤再排序/截断；文档读取必须校验精确 revision/hash；文件读取只落到 ready 输入快照。现有 KnowledgeSearchService 的 Run scope 接点优先复用。

`resolveContextSegment`、记忆召回授权、materialDependencyUnion、历史安全重放、读取审计和成果输入关系统一使用这份有效具体材料。不能只扩搜索工具而让记忆仍按 50 项旧数组判权限；Run 记忆查询标题仍按既有预算摘要，但授权键来自完整有效集合，Run 级依赖 union 最多保存 2,000 项，单条记忆的依赖上限不变。下一期是新 Task，旧 Task 历史不全量带入；参考成果若依赖已撤销资料，按既有依赖闭包排除。

本期继续协作保留原快照，新增文件经原材料入口成为显式材料；这些补充不写回 Schedule。允许移除整个本期来源范围（save 请求 null），界面显示权限缩小与后续运行影响，触发现有安全历史分段；不增加逐项修改不可变清单的编辑器。后续 Run 都没有第二次自动 Occurrence。

无配置的“必须有材料”通用推断：只有专家现有结构化约束/来源硬错误能在 Main 阻塞；自然语言要求里的 GL、人员等缺项由专家回复并留原 Task 给人补充。禁止根据文件名正则或模型私有推理伪造 `needs-material` 事实。确定性准备失败产生 blocked；确定性必要材料缺失可产生 needs-material + 原 Task；Run 已开始后的提问按实际回复/讨论节点呈现。

## 6. 无人值守能力预检与启用

保存并暂停可保存尚有阻塞的有效草稿；启用和人工执行均检查有效 ExpertRevision、Workspace、模型 profile/凭据、Skill 信任/启用/修订、环境就绪、MCP 合同与来源身份。后台没有可用真实模型时阻塞，不能采用 FakeModelProvider。自动测试注入 Fake Provider 是独立宿主，不能成为生产回退。

首版支持边界的技术提案：

| 能力                                                                 | 后台处理                                                                                                                                                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 现有计算、受范围约束读取/检索、已配置网页只读搜索/正文、内部成果登记 | 复用既有 Tool policy；凭据与范围有效才开放                                                                                                                                 |
| 仅指令 Skill                                                         | 复用已信任/启用修订；不因指令文字执行任意 Shell                                                                                                                            |
| 已有脚本 Skill 固定命令                                              | 仅允许既有适配预设中经审阅、限定本期 work 目录产物的固定命令；首版候选为 ppt-generation。同时验证现有信任与有效 grant、profile/资源 hash、依赖就绪；无法确认的命令整次阻塞 |
| 其他用户脚本/需交互授权的工具                                        | 整次阻塞，给出回到原任务人工执行入口；不自动扩权或安装                                                                                                                     |
| MCP                                                                  | 当前实现缺少可强制证明的后台效果契约，首版所选 MCP 绑定整次阻塞；将来在独立能力契约批准后开放，不凭 readOnlyHint 或工具名字放行                                            |
| 外部发送、第三方数据写入、业务审批                                   | 不属于本功能首版，整次阻塞                                                                                                                                                 |

SC06-1 实测支持的 Skill 包 hash 为 `4681d64c1736d8162493e9b2da6d2a54bd079338ec46dd92ecdbdaa2f1ee52e1`。它由本机用户提供的 `ppt-generation-expert.zip` 按生产导入算法复算：排除 `.DS_Store` 等操作系统元数据、恢复 ZIP 中的 GBK 路径名、按 Node `localeCompare` 排序；没有解压、复制或修改包。支持命令只有预设登记的 `project-init`、`icon-sync`、`svg-export`、`template-merge`、`pptx-validate`，profile 必须逐字段等于 `suggestedPptProfile(hash)`；命令参数 Schema 或包 hash 有变化即阻塞。

预设解析为固定 managed Python 调用：`project-init` 固定 `init --dir <本期 run work> --quick-generate --format ppt169` 且项目名不得是路径/选项；`icon-sync` 项目目录被限制在本期 work 下，当前工具链脚本还会验证图标 ID 仅为登记图标库和单文件名；`svg-export`、`template-merge`、`pptx-validate` 的脚本路径固定在 Skill 资源内，输入/输出由 `preparePptAttempt` 限定本期 work，输出通过既有执行器校验。Skill 自带两处适配修改仍逐字节核对源码 SHA-256：`svg_native_export.py` 为 `b030b073e27c19524e14a7a9b71b40faeb8f35999e72b4239097e1917140ddd3`，`merge_into_template.py` 为 `c4a874cabefb16c85006fc2d3b082c4f37b2e1848d624b517241eb3cda03b817`；未知脚本修订不能沿用修改。

`project-init` 与 `icon-sync` 依赖随 Skill 包未分发的 `ppt-master`。对照本机干净工作树 `ppt-master` commit `680de11f1bef4628b68d5daad9dffec569fbd51f` 的实际 CLI：init 的 `--dir` 覆盖默认项目根、项目名校验为单个路径段、只在其 base 下新建；icon-sync 校验固定图标库/文件名，目标只在所给项目目录 `icons/`。定时预检要求既有 Skill grant 的 dependency fingerprint 覆盖当前锁 hash 与工具链 manifest hash、一个 macOS arm64 ready 环境、且唯一工具链快照通过完整性复核并含 `skills/ppt-master/scripts/project_manager.py` 和 `icon_sync.py`。这只证明当前固定命令/profile/修订/授权和不可变依赖可用；OS 子进程仍以用户身份运行、能访问宿主授权范围，**不构成原生进程沙箱**。

定时模型必须解析到已启用语言模型 profile；远程 endpoint 缺少凭据时阻塞，本机 loopback 服务允许按既有模型协议使用无 Key profile。预检只读查询 profile 的非敏感 `apiKeyConfigured` 与凭据迁移状态；已完成迁移的密文会在 Main 内解析一次后立即丢弃结果，用于确认受保护存储可用，不返回/记录 API Key，不发模型请求。它不创建 grant、不探测真实模型、不安装依赖。能力 fingerprint 包含 Workspace/固定 ExpertRevision/模型与工具授权/Skill 修订和依赖，但不含期间、要求文本、Knowledge 成员或来源内容，因此已授权的来源动态变化不会每期触发能力重新授权。

其他 hash、profile 改动、未知命令、未就绪或失配依赖、非单一工具链快照及全部 MCP 绑定均阻塞。上述拒绝规则明确显示在预检结果，不能保存后才静默少装 Skill/MCP。技术审阅若要求扩大支持，先更新 ADR/契约；不得凭预设名自动通过，也不得宣称脚本已经沙箱化。

启用说明复用配置页：应用进程运行、电脑不休眠才会执行；会调用已配置模型/工具并可能产生费用；输出待人审阅；错过不自动补做。确认后持久化本配置的 capabilityFingerprint（专家、技能/profile/命令资源、模型引用、授权策略）；不保存密钥。引用能力变动导致 fingerprint 不一致则 blocked 并要求重新检查；纯知识成员/content 变动依照已批准动态范围进入下一期，不逐次索要确认。

实时撤销与暂停/归档在准备结束及 T4 前重查；Skill trust 撤销继续用既有 Run 取消机制。暂停/归档不隐式取消已派发 Run；「停止本次」单独调用既有取消。停用/归档专家阻止后续启动；没有新的有效版本不能自动改用通用助手。

## 7. 后台运行、取消与恢复

启动顺序：获得同一 userData 的单实例锁 → 打开/迁移数据库 → 完成输入快照、Run、脚本执行等既有恢复 → 恢复定时 preparing/保存/通知回执 → 结算错过 → 启动新调度。已有恢复 Promise 必须形成可等待的 readiness，不能以 createWindow 完成当作后台已就绪。

Main 使用窄依赖的 ScheduleService、ScheduleSourceService、ScheduleScheduler、ScheduleExecutionService、ScheduleOutputService；纯日历/结果函数独立。优先复用现有服务，名称是建议文件职责，不是要求创建通用框架。index.ts 只装配/生命周期；单实例锁在破坏性启动恢复前取得。测试全部独立 userData。

每个实例有 AbortController；暂停、归档、关派发取消其 preparing，并有 generation 失效校验。停止已开始的本期调用 `runs.cancel(firstRunId)`；不发失败通知。退出事件须先同步关闭接收与 timer，再异步等待准备/Run/MCP/Worker 收口，最后关库；现有 createQuitHandler 的 Promise 微任务前也不能留下可抢占时隙。

| 恢复断点                            | 唯一处理                                                            |
| ----------------------------------- | ------------------------------------------------------------------- |
| T2 后、未创建 Task                  | closed + interrupted-before-run；不重启、不补模型                   |
| 已创建 Task、T4 前                  | 保留草稿；closed + interrupted-before-run，打开原任务人工继续       |
| T4 已提交、尚未请求模型或模型处理中 | 既有 Run 启动恢复收口 interrupted，实例跟随真实 Run；不再建首个 Run |
| Run 已终态，结果/通知未落库         | 重建事实投影、保存回执核验、补一次缺失通知；不执行模型              |
| 文件写出、saved 回执前              | 核验预登记目标路径与 hash；一致则 saved，不一致保留用户文件并标失败 |
| 通知已落库、广播前                  | 回执阻止重建；页面查询可见，不重放历史系统通知                      |

恢复只能重建派生数据/完成确定性文件回执。未知外部工具副作用显示中断原因，不承诺自动恢复或恰好一次。

## 8. 成果交付与结果投影

目标产物只认可本期首个 Run 实际登记的 ArtifactVersion；验证状态沿用现有校验事实。内部版本登记成功后才建 output receipt；不以目录同名文件、自然语言“已完成”或旧月份成果当作本期输出。

目标目录为 Workspace/rootPath + 「定时成果」；检查 canonical 根、每层 lstat、无符号链接及目录写入边界。文件名是清洗后的规则名 + 期间 label + ArtifactVersion 的版本号 + 完整 versionId + 正确扩展名；不指定期间则用请求时刻标签，名称部分截短到 60 code points。最末的稳定 versionId 防重名，不能仅靠月份。

流程：预登记 relativePath/hash → 读取并校验内部版本 → 在目标目录写独占临时文件并 flush → 以不覆盖的发布操作生成目标文件 → 保存 saved 回执。复用已有导出/版本字节解析；Markdown 保存 UTF-8，其他格式保存真实登记字节。macOS 非覆盖发布可用同目录临时文件 + link，不能使用会覆盖目标的 rename；临时文件仅清理本回执拥有的文件。

目标已存在且有预登记回执、内容 hash 相同：收口 saved；hash 不同：失败 `schedule_output_collision`，保留文件。明确重试保存时可分配带 attempt 的新目标文件名，先 CAS 回执后写新文件；不能覆盖旧交付副本或个人修改。重试保存的成功属于当场短时结果，走 TransientToast，不再发同一期完成通知。

| 实际事实                                  | 主文案/结果                              | 下一步                            |
| ----------------------------------------- | ---------------------------------------- | --------------------------------- |
| 确定性必要材料缺失、未建 Run              | 需要补充材料                             | 打开原 Task；不能暗中自动重新发送 |
| Run completed，全部约定类型存在且保存成功 | 产物已生成，请审阅                       | 打开本期任务/成果                 |
| 已登记部分/全部产物，目录保存失败         | 成果已生成，未保存到目录                 | 只重试保存对应版本                |
| completed 缺任一约定类型                  | 执行已结束，未生成全部约定产物，请看回复 | 打开原任务；部分产物保留          |
| Run failed / startup interrupted          | 执行失败/执行中断 + 原因                 | 打开原任务；已有产物仍保留        |
| cancelled                                 | 本次已停止                               | 保留历史，不发失败通知            |
| missed / skipped-overlap / blocked        | 错过/重叠跳过/启动前阻塞 + 原因          | 规则详情或现有工作                |

failed/interrupted/cancelled 优先于产物成功标签；partial artifacts 不改变 Run 终态。结果初次收口等待有界保存尝试（单次最多 30 秒）；超时记 save-failed，不先发成功再补失败。并存缺类型与保存失败时主状态 save-failed，详情同时列缺项，不能丢事实。

## 9. 通知、导航与错误出口

NotificationTarget 增加 `schedule {scheduleId, occurrenceId?}`；种类增加 schedule，继续使用已有 NotificationService。定时首个 Run 的终态交给 Schedule 结果收口，RunService 不再对它发普通「任务完成」；人工续作 Run 保持普通路径。

通知仓储提供同步 save，NotificationService 允许持久化与 publish 分开；T5 中保存实例结果、通知与唯一回执，commit 后 publish。不把会广播的 create 包进外层事务。成功按现有机制已读，错误/警告未读；generated 成功，missed/overlap/缺材料/保存失败/缺产物 warning，启动阻塞/Run 失败 error。用户取消没有失败通知。

同一期初次结果使用固定 outcomeKey `initial-outcome`；恢复只补缺失，不因状态文案不同再生成第二条。用户明确的保存重试用本地短时反馈，不重新发布初次结果。通知清空或数量淘汰不删除 receipt；恢复批次聚合通知用独立 batchKey。通知 target 使用稳定 ID，回看原事实而不是只读当下缓存。

系统通知在窗口失焦或没有窗口、进程存活时可发；系统权限关闭不影响消息中心。点击保存待消费目标，创建/恢复主窗口，等待 Renderer/preload ready 的显式握手后交付，消耗后清空；重复 ready 不重复跳转。自动结果从不主动聚焦/导航，不清当前 Composer。按 ID 获取旧 Task；不存在时 ErrorPage/InlineError 解释，不跳另一个任务。

领域错误用结构化 `code / message / problems? / existingOccurrenceId? / currentConfigVersion? / currentRevision?`，不由中文字符串反向解析。至少覆盖：`schedule_not_found / schedule_archived / schedule_conflict / schedule_busy / schedule_capacity / schedule_invalid_timing / schedule_workspace_unavailable / schedule_source_missing / schedule_source_conflict / schedule_source_budget_exceeded / schedule_preparation_failed / schedule_preparation_timeout / schedule_capability_blocked / schedule_model_unavailable / schedule_clock_untrusted / schedule_output_collision / schedule_output_save_failed / schedule_cancelled`。底层既有错误保留原 code 为 problem，不新增相同含义第二个 Tool 错误。

## 10. UI 实施清单：组合基座，不新增基础组件

**新生产 UI 的预定新增范围只有定时任务页面业务视图、其 Hook 与纯函数。基础组件新增数为 0。** 较大的业务视图可以拆到 `views/schedules/`，保持页面私有组合；不因此登记为共享基座。不创建 ScheduleButton、ScheduleCard、ScheduleField、ScheduleToast、ScheduleDialog、SchedulePageShell 或通用 CRUD 框架。

| 分支/动作                                | 真实基座及实现边界                                                           | 出口/检查                                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 列表、详情、配置及其 loading/error/empty | PageHeader + ScrollRegion + .page-body；筛选 PageToolbar，集合 ViewContainer | 可见 return 分支都保留普通页骨架；不把 LoadingPage/EmptyPage 当骨架替代                                                                       |
| 列表与一期历史                           | ListRow + Badge/StatusNote + Button/PopoverMenu                              | 行有动作不整行点击；有真实 Run 的摘要复用 RunSummaryRow，missed 无 Run 直接显示实例事实，不能写成“等待开始”                                   |
| 四组整页表单                             | SectionHeader、Field、TextField、TextArea、FieldSelect、ActionBar            | 不使用新 Wizard；四组为专家/来源、工作要求/交付、时间/期间、启用条件                                                                          |
| 专家/工作空间                            | FieldSelect；适用现有 props/几何时用 WorkspaceSelector                       | 不复制专家编辑器；工作空间选择不改变当前工作页选择或 Composer；必要的新建工作空间复用 WorkspaceIdentityDialog                                 |
| 知识文档/集合/库选择                     | Modal + FieldSelect/Tabs + TextField + CheckList + BindingChipBar            | Modal 承担 Esc/焦点；三个范围复用现有查询。ComposerCapabilityPicker 现有 props 面向固定材料和技能，不硬塞动态范围，也不新建共享全能来源选择器 |
| 时间预览与期间                           | Field + FieldSelect/TextField + ListRow/StatusNote                           | 输入展示 Main 预览；不在 Renderer 写第二份日历算法；快速改动迟到响应丢弃                                                                      |
| 专家新版本差异                           | Modal + SectionHeader/ListRow + Disclosure + ActionBar                       | 只读比较旧/新已有修订；CAS 失败保留草稿；保持 Workspace 与知识来源                                                                            |
| 立即执行/补做 missed/归档                | ConfirmationDialog 或 Modal + ActionBar                                      | 明示期间/当前来源/费用；双击同 requestKey；返回焦点；归档保留历史                                                                             |
| 本期详情材料与成果                       | ListRow/SourceRow、Disclosure、既有成果打开入口                              | 可用、已读、采用由分别查询的事实构造；SourceRow 只接真实 Evidence，不用候选伪造 Evidence                                                      |
| 原任务继续协作                           | 现有 App 工作页 + Composer + ContextPanel                                    | 增加期间与范围摘要；现有补材料入口；不新增“定时工作区”                                                                                        |
| 校验、刷新失败、冲突、阻塞               | InlineError（danger/warning）                                                | 失败保留输入；已有对象刷新失败保留旧数据，并就地重试                                                                                          |
| 保存/暂停/应用修订/保存重试的即时确认    | useTransientToast + TransientToast                                           | 不持久化、不自造 timer；同消息只有一个出口                                                                                                    |
| 后台长操作结果                           | NotificationService + 消息中心 + ToastHost                                   | 不并发短 Toast 重复播报；状态 Badge/StatusNote 不是动作反馈                                                                                   |

按钮档位按现有所有者：PageHeader 主行动 lg，leading 返回 sm；PageToolbar/ActionBar md，行内 sm。FieldSelect/TextField 必传 size；Field 单控件 controlId，多个控件 group；ScrollRegion 必有 ariaLabel；Disclosure 不存在 open prop；CatalogCard/CatalogRow 的 EntryFacts 是技能/专家语义，不拿来包装定时规则。

只用现有主题 Token、排版/间距/表面档位与 icons.tsx；不复制原型 CSS、硬编码灰色、创建局部 dark 规则、追加版心或 12px 以下正文。详情不常驻右栏。列表显示专家、空间、频率、下次时间、最近结果；诊断按需展开。

Hook 管理读取/保存/动作及错误；pure lib 负责文案、差异、结果选择和草稿序列化。编辑 draft 不受后台列表刷新覆盖；保存失败、冲突、Esc/返回保留已承诺的输入。返回未保存编辑需确认；取消新建回到列表，不保存规则。Modal 内来源选择只在确认时提交到 draft。

SC09-7 必须给出「分支 → 实际基座 → 状态/反馈出口 → 生产页面验证」证据，复用 scripts/ui-render-check.mjs 的合成宿主。组件矩阵维持正式 8 Variant × 既有尺寸；新增生产路径覆盖青玉明暗、760/1380 宿主、普通/减动效、长中文/英文路径、键盘焦点与草稿。原型 320px 检查不改 macOS 窗口平台承诺。

## 11. IPC 与服务接口清单

全部挂在现有 register-ipc.ts、Preload Desktop API 与共享 IpcChannel/Schema；新增 channel 的同卡必须有 handler、preload 消费与验证，不能留未消费常量或 TODO 端点。Schema 可先定义，端点随真实实现加入。

| 操作                        | 输入                                                                                                                       | 输出/语义                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| listSchedules               | lifecycle/filter、cursor、limit                                                                                            | 配置摘要与事实结果分页                                                             |
| getSchedule                 | scheduleId                                                                                                                 | 配置、专家更新、阻塞理由、历史首屏；缺失明确错误                                   |
| saveSchedule                | create/update 判别；workspaceId（仅 create）、配置、expectedRevision（update）、目标 enabled/paused、preflightFingerprint? | 结构化 success/detail 或 rejected/problems；启用必须预检有效且确认当前 fingerprint |
| setScheduleLifecycle        | scheduleId、expectedRevision、enabled/paused/archived、preflightFingerprint?                                               | CAS 结果；enabled 校验、pause/archived 取消准备                                    |
| previewSchedule             | timing、periodRule                                                                                                         | Main now + 下三次 time/period；不落库、不调用模型                                  |
| preflightSchedule           | 已保存 ID 或 draft 配置                                                                                                    | currentFingerprint、ready/blocked、具体 problems；只读，不安装/信任                |
| applyScheduleExpertRevision | scheduleId、expectedRevision、expertRevisionId、preflightFingerprint?                                                      | 只更新调用绑定；目标必须属于当前 expert；已 enabled 则重新预检                     |
| listScheduleOccurrences     | scheduleId、cursor、limit                                                                                                  | 稳定游标的完整历史，人工/自动分别标识                                              |
| getScheduleOccurrence       | occurrenceId                                                                                                               | 配置快照、period、Task/Run、输出回执、读取/采用统计                                |
| listScheduleSourceItems     | occurrenceId、cursor、limit                                                                                                | 本期材料分页；Main 校验归属，不返回文件内容/密钥                                   |
| executeScheduleNow          | scheduleId、expectedRevision、requestKey、preflightFingerprint                                                             | 当前期间新实例；重复键同结果；accepted 不等于运行完成                              |
| executeMissedSchedule       | scheduleId、originalOccurrenceId、expectedRevision、requestKey、preflightFingerprint                                       | 原期间 + 当前配置/来源的新实例；保留原 missed                                      |
| cancelScheduleOccurrence    | occurrenceId                                                                                                               | 取消 preparing 或已有首个 Run；终态幂等                                            |
| retryScheduleOutput         | receiptId、expectedAttempt                                                                                                 | 只保存原版本，返回更新回执；重试冲突不造 Run                                       |
| onScheduleChanged           | 类型化 scheduleId/occurrenceId/reason 事件                                                                                 | commit 后发送，只提示刷新；不是事实唯一来源；重连先重读                            |

知识/工作空间候选读取优先复用已有接口；如需分页补充，扩展既有查询服务而不创建调度专属知识库。人工执行 preflightFingerprint 只绑定本次 capability/config，Main 仍再次校验；人工按钮不是越权入口。

## 12. 实施验证与批准边界

精确卡片、前置和测试见任务板；本契约不另记状态。全程用临时 SQLite、受控中文文件、注入时钟、Fake Provider、HTTP 桩；不触碰产品 userData、不触网模型、不复制私有材料。卡片定向测试 + typecheck；跨模块里程碑及最后交接跑完整 verify，不以管道截尾判断成功。提交前 verify 要求始终不变。

已批准 P1–P6 不再问。GPT-6 Luna 接手后先执行 SC03-1 的只读基线与映射，按用户当次指定卡/连续范围推进；这次细化指令不代替切换后的开工指令。ADR 的 Proposed 不等于禁止形成具体实现计划，也不等于自动 Accepted；若用户明确授权按本契约实施，记录该授权后推进，无需逐卡重复申请。真实模型/业务材料调用预算、提交、推送、发布仍分别核对。

本轮新增的范围快照、时间/预算、脚本/MCP 后台支持规则属于技术提案。SC06-1 真实命令审阅与 SC05-1 包实测是明确的验证工作，未执行前不能宣称已支持。遇不满足契约的实质安全/关系冲突，先给具体差异和可选方案，不靠猜测编进生产。
