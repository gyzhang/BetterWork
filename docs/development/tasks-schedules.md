# 定时任务开发计划（SC00–SC11，GPT-6 Luna 执行版）

- 登记：2026-09-25；细化：2026-10-03（本轮 `date`）。本文件是 **SC 系列唯一状态板**，原 SC03–SC10 拆成小卡，原编号保留为范围标题，不另维护父卡状态。
- 产品：光哥于本轮明确「我 review 了你的设计，我的意见是通过」，批准[原型 P1–P6](../prototype/scheduled-tasks/README.md)。此前已确认的长期目录、既有专家只读、历史对比、错过不补跑、后台通知与导航方向保持。
- 本轮：按指令细化产品/技术设计、任务与提示词，供切换 GPT-6 Luna 后编码与测试。生产代码尚未开工；[ADR-0037](../adr/0037-scheduled-work-and-source-snapshots.md)与[实施契约](schedule-contracts.md)是技术提案，未自动 Accepted。切换后用户明确要求按计划开工即记录对应卡/连续范围授权，不逐卡重复请求。真实模型、提交、推送、发布仍独立核对。
- 当前基线：HEAD `9352dcbd5da2c1b5f11ab37ece794b3c475816ae`，应用库 v35、Vault v7、原 ADR 至 0036；本轮新增 ADR-0037。此前原型文档与目录是已有未提交改动，保留；编码前重读实际基线。
- 文档分工：[设计](../designs/scheduled-tasks.md)定产品，[契约](schedule-contracts.md)定字段/算法，[本板](tasks-schedules.md)定任务状态，[编码交接](schedule-coding-prompts.md)提供复制指令。E/WM/MI/KM/CF/A/B0 状态不代签、不重排。

## 1. 为 GPT-6 Luna 的执行方式

官方将 [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)定位为适合聚焦、高吞吐任务的高效模型。以下是针对本仓库风险作出的工程拆分，不是模型性能承诺：一次一张小卡、一个主要完成目标、明确接点与失败断言，完成后交接再续卡。无需给模型加载全部历史聊天或整份其他任务板。

默认串行，不创建新聊天、不委派智能体；若用户授权连续完成某一段，逐卡串行完成和留证，不在每张卡重新请求确认。建议日常卡 medium、原子 Run/权限/恢复卡 high；这是工作负载建议，不修改用户模型设置，也不保证特定推理档效果。

每卡先输出简短「当前基线/前置/文件边界/验收」再动手；边界列的是入口，不是禁止必要测试文件。若超过一张卡的职责，先把独立后续工作留在本板，不顺手实现下一模块。现有等价实现复用，不造同名第二份服务。不能通过删验收用例、静默降级资料范围或扩大授权来闭卡。

### 推荐串行顺序

`SC03-1 → SC03-2 → SC03-3 → SC05-1 → SC03-4 → SC04-1 → SC04-2 → SC04-3 → SC04-4 → SC04-5 → SC04-6 → SC05-2 → SC05-3 → SC06-1 → SC06-2 → SC06-3 → SC06-4 → SC06-5 → SC07-1 → SC07-2 → SC08-1 → SC08-2 → SC08-3 → SC09-1 → SC09-2 → SC09-3 → SC09-4 → SC09-5 → SC09-6 → SC09-7 → SC10-1 → SC10-2 → SC11`。

SC05-1 提前验证日历库，再做依赖它的规则服务；不能为了编号连续先写替代算法。离线实现共 32 张小卡；SC11 为独立人工/真实业务验收。

### 各卡共同完成定义

- 行为符合契约，快乐/失败/取消/恢复中本卡适用路径有可解释证据。
- 定向 functional 测试及 typecheck 通过；文档/中文回读/日志完成。里程碑按 §4 跑完整 verify；提交前 verify 仍强制，不用管道截尾。
- 测试隔离 userData、临时 SQLite/目录、注入时钟和 Fake Provider/HTTP 桩；不触网、不用真实模型。对 bug 的现场诊断按 GATE-0，隔离合成复现另记，不假装查过生产库。
- 仅更新本卡行：todo / doing / blocked / done；证据写命令、退出码、结果、迁移实际版本、文件/日志。代码完成、自动通过、AI 页面走查、人工待验分开；缺本卡必需证据不标 done。
- 无提交/发布指令则不提交、推送或发布。真实业务缺材料不伪造完成。

## 2. 唯一状态板

| 卡号   | 唯一目标                         | 前置                      | 状态 | 证据                                                                                                                                                                                                                                                              |
| ------ | -------------------------------- | ------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SC00   | 设计开工基线与依赖复核           | 原型设计指令              | done | 2026-10-03：[日志](../logs/2026-10-03.md)。原基点 1513fad，应用库 v35/Vault v7、ADR 至 0036，无 Schedule/Occurrence/cron-parser；既有 Task/Run/快照/成果/通知可复用。未把其他系列人工尾项泛化成阻塞。当前细化另核对 HEAD 9352dcb。                                |
| SC01   | 精确实施提案与 Luna 计划         | SC00、原型批准            | done | 2026-10-03：本板、[契约](schedule-contracts.md)、[ADR-0037](../adr/0037-scheduled-work-and-source-snapshots.md)、[提示词](schedule-coding-prompts.md)。完成提案归档及一致性，技术状态仍 Proposed；库/固定命令实测明确留给 SC05-1/SC06-1，不声称技术已批准或实现。 |
| SC02   | 产品低保真交互评审               | SC00；与 SC01 对账        | done | 2026-10-03：光哥明确通过设计，P1–P6 通过；[原型](../prototype/scheduled-tasks/index.html)/[说明](../prototype/scheduled-tasks/README.md)保留评审快照。17 模拟路径、18 场景布局检查是原型证据，不冒充生产组件验收。                                                |
| SC03-1 | 配置/实例/请求 DTO 与 Schema     | SC01、SC02；开工指令      | todo | —                                                                                                                                                                                                                                                                 |
| SC03-2 | 调度表版本化迁移                 | SC03-1                    | todo | —                                                                                                                                                                                                                                                                 |
| SC03-3 | 规则/实例 Repository 与原子占用  | SC03-2                    | todo | —                                                                                                                                                                                                                                                                 |
| SC03-4 | 配置 CAS、暂停、归档服务         | SC03-3、SC05-1            | todo | —                                                                                                                                                                                                                                                                 |
| SC04-1 | 当前目录有界枚举与文件快照       | SC03-3                    | todo | —                                                                                                                                                                                                                                                                 |
| SC04-2 | 文档/集合/个人资料库修订解析     | SC03-3                    | todo | —                                                                                                                                                                                                                                                                 |
| SC04-3 | 不可变来源清单与准备收口         | SC04-1、SC04-2            | todo | —                                                                                                                                                                                                                                                                 |
| SC04-4 | 本期范围引用与有效材料解析       | SC04-3                    | todo | —                                                                                                                                                                                                                                                                 |
| SC04-5 | scoped readers、检索与格式分派   | SC04-4                    | todo | —                                                                                                                                                                                                                                                                 |
| SC04-6 | 有效范围接入记忆及安全历史       | SC04-5                    | todo | —                                                                                                                                                                                                                                                                 |
| SC05-1 | cron 依赖证明、预览与期间函数    | SC03-1                    | todo | —                                                                                                                                                                                                                                                                 |
| SC05-2 | tick、missed 与恢复批次记账      | SC03-4、SC05-1            | todo | —                                                                                                                                                                                                                                                                 |
| SC05-3 | 单实例、readiness、休眠与退出    | SC05-2                    | todo | —                                                                                                                                                                                                                                                                 |
| SC06-1 | Main 专家预检与能力支持清单      | SC04-6、SC03-4            | todo | —                                                                                                                                                                                                                                                                 |
| SC06-2 | 本期 Task/Session 与专家草稿装配 | SC06-1、SC05-3            | todo | —                                                                                                                                                                                                                                                                 |
| SC06-3 | 首个 Run 原子关联与异步消费      | SC06-2                    | todo | —                                                                                                                                                                                                                                                                 |
| SC06-4 | 取消/撤销/重叠/崩溃恢复          | SC06-3                    | todo | —                                                                                                                                                                                                                                                                 |
| SC06-5 | 管理/预览/执行 IPC 与 Preload    | SC06-4                    | todo | —                                                                                                                                                                                                                                                                 |
| SC07-1 | ArtifactVersion 交付回执         | SC06-3                    | todo | —                                                                                                                                                                                                                                                                 |
| SC07-2 | 非覆盖文件保存、恢复及重试 IPC   | SC07-1、SC06-5            | todo | —                                                                                                                                                                                                                                                                 |
| SC08-1 | 事实结果分层与终态接线           | SC06-4、SC07-2            | todo | —                                                                                                                                                                                                                                                                 |
| SC08-2 | 一次通知事务与清空后去重         | SC08-1                    | todo | —                                                                                                                                                                                                                                                                 |
| SC08-3 | 无窗口系统通知与历史目标导航     | SC08-2                    | todo | —                                                                                                                                                                                                                                                                 |
| SC09-1 | UI Hook、导航、规则列表          | SC06-5、SC08-3            | todo | —                                                                                                                                                                                                                                                                 |
| SC09-2 | 整页配置与时间/期间预览          | SC09-1                    | todo | —                                                                                                                                                                                                                                                                 |
| SC09-3 | 文档/集合/资料库范围选择         | SC09-2                    | todo | —                                                                                                                                                                                                                                                                 |
| SC09-4 | 规则详情/历史/本期材料与成果     | SC09-3、SC07-2            | todo | —                                                                                                                                                                                                                                                                 |
| SC09-5 | 人工执行、启停、专家差异动作     | SC09-4                    | todo | —                                                                                                                                                                                                                                                                 |
| SC09-6 | 回到原 Task 协作与本期范围摘要   | SC09-5、SC04-6            | todo | —                                                                                                                                                                                                                                                                 |
| SC09-7 | 生产组件/反馈/焦点/主题验收      | SC09-6                    | todo | —                                                                                                                                                                                                                                                                 |
| SC10-1 | 同目录六期离线端到端             | SC04–SC09 全部小卡        | todo | —                                                                                                                                                                                                                                                                 |
| SC10-2 | 故障矩阵、回归与完整门禁         | SC10-1                    | todo | —                                                                                                                                                                                                                                                                 |
| SC11   | 真实窗口/专家/六期业务验收       | SC10-2；独立人工/模型授权 | todo | —                                                                                                                                                                                                                                                                 |

## 3. 逐卡说明

路径默认相对仓库根；新增文件均为建议职责落点，开卡先核对是否已有等价实现。卡内「必测」加共同完成定义才构成 done。全部技术字段/预算不在此复制，直接依照实施契约指定章节。

### SC03：协议与持久化

#### SC03-1 — 共享 Schema 与 DTO

- 必读：契约 §2/§11；协议 index.ts；docs/03、ADR-0003；docs/12。
- 文件边界：`packages/agent-protocol/src/index.ts` 与其测试；必要映射记录写本卡证据。
- 实现：ScheduleConfig、Occurrence、Source/Output/Result DTO、时间/期间联合、结构化拒绝/CAS 数据、分页请求。复用 MaterialReference、成果类型和用途；暂不添加没有真实 handler 的 IpcChannel/Desktop API。
- 必测：各联合条件、非法日期/时区/范围描述、重复来源、expected version、人工/自动互斥字段、closed 无 Run 与 dispatched 有 Run、不允许未知字段。开卡先核对本轮新增技术提案的实施授权；普通基线/命名无需再问。

#### SC03-2 — 调度表迁移

- 必读：契约 §2/§3；现有 db/app-schema.ts、migrate.ts、migrate.test.ts。
- 文件边界：应用库 schema/迁移测试；不改 Vault 结构，不实现服务。
- 实现：调度八张表、外键、CHECK/唯一索引；按实际末版 +1，不先写固定 v36。只有 ID 关联，不用拼字符串模拟实体关系。
- 必测：旧库/空库升级、重复启动、唯一键、外键归属；新表不改变旧 Task/Run/Artifact；通知清空不级联去重回执。

#### SC03-3 — Repository 与占用

- 必读：契约 §3、既有 persistence/app-store.ts、task/run repositories。
- 文件边界：`apps/desktop/src/main/persistence/schedule-repository.ts`、`schedule-occurrence-repository.ts`（新增）、AppStore 组装及测试。
- 实现：配置不可变追加、历史分页、自动/人工幂等、T2 原子 claim + next/cursor；Source/Output/Notification 的操作各在后续所属卡，不在本卡扩成一个巨大 Repository。
- 必测：重复 timer、同时间不同 configVersion、同 requestKey、回滚、错误状态转换、分页稳定及六个月关联同 Workspace。

#### SC03-4 — 规则服务

- 必读：契约 §2.1/§4；Expert 生命周期/删除检查；Workspace 身份 ADR-0029。
- 文件边界：`apps/desktop/src/main/services/schedule-service.ts`（新增）、schedule repository；必要专家删除 guard 与测试。
- 实现：创建 paused、配置 CAS、更新不热换历史、暂停/归档、改 timing 前结算；能力预检通过注入接口交后续接入，不以假返回 ready 开放 enabled。被规则引用的专家不能硬删。
- 必测：CAS 冲突不改旧数据、名称编辑不改 next、暂停/恢复无历史欠账、归档保留历史、空间隐藏不暂停、引用专家删除拒绝。此卡不接 IPC/UI，不调用模型。

### SC04：材料范围与快照

#### SC04-1 — 目录枚举

- 必读：契约 §5.1；InputSnapshotService/测试；材料契约；docs/04。
- 文件边界：`apps/desktop/src/main/services/schedule-directory-sources.ts`（新增）、必要快照复用接点与测试。
- 实现：有界递归、稳定排序、格式/数量/总量/深度检查、元数据与临时文件排除、无 symlink 跟随；交付目录现存文件可作历史候选；取消不发布半份材料。
- 必测：增/改/删影响下一次、准备中变更拒绝、越界/链接/特殊文件、数量与总量边界、已移除交付不从内部库复活。不得用 mtime 判业务期间。

#### SC04-2 — Knowledge 范围

- 必读：契约 §5.1；KnowledgeVault/Repository、KnowledgeSearchService；知识契约。
- 文件边界：`apps/desktop/src/main/services/schedule-knowledge-sources.ts`（新增）、既有 Vault 窄查询方法及测试。
- 实现：单篇跟随当前、集合/库跟随当前成员，稳定 revision/hash；专家固定参考去重/冲突，记录选择来源；两库无共享事务。
- 必测：集合增删、修订更新、空集合、已选对象消失、固定参考不同修订冲突、跨库准备后删除、超预算不截断；未选知识不能被纳入。

#### SC04-3 — 来源清单准备

- 必读：契约 §2.3/§3/§5；输入快照恢复逻辑。
- 文件边界：`apps/desktop/src/main/persistence/schedule-source-repository.ts`、`apps/desktop/src/main/services/schedule-source-service.ts`（新增）、测试。
- 实现：聚合两种来源、manifest hash、状态与分页；整个 ready 清单发布、准备 Abort/超时、受管文件回收复用既有服务。
- 必测：一项失败无 ready 清单、取消/超时、重复完成不重复材料、准备阶段崩溃、旧快照不热换、分页一致。Task 装配在 SC06-2 接入。

#### SC04-4 — 范围引用与有效材料解析

- 必读：契约 §5.2；材料契约、记忆契约；RunService、TaskMaterialService、RunContextSnapshotRepository、knowledge-search/readers。
- 文件边界：TaskContext/RunContext 增量协议、Repository 与迁移；集中有效材料解析函数及测试。
- 实现：Main 校验本期 snapshotId 与 Task 归属；显式补充仍原上限，有效材料有界合并；明确 null/absent；Run 接线留给后两卡。
- 必测：普通任务上限不变、伪造/跨 Task/未 ready ID 拒绝、重复/修订冲突、补充不回写规则、null 移除与 absent 保留。更新材料契约的 Proposed 增量引用。

#### SC04-5 — 工具读取与格式分派

- 必读：契约 §5.2；RunService scoped readers、KnowledgeSearchService、现有确定性文件提取器及 Office reader。
- 文件边界：Run 有效材料接点、有界提示摘要、读取/检索适配与测试；不改记忆算法。
- 实现：所有工具按固定具体集合过滤；读取审计用真实引用；PDF/DOCX/Office 复用解析器，不向模型全量注入路径和正文。
- 必测：未选材料拒绝、固定修订读取、准备后改原文件不影响、PDF/DOCX 不按 UTF-8 读取、检索先过滤再截断、摘要超限不截掉授权集合、读取与采用分别记录。

#### SC04-6 — 记忆与安全历史

- 必读：契约 §5.2；memory contracts、run-history-policy、memory-recall/provenance 现有实现。
- 文件边界：RunService 的 context segment/召回输入接点、记忆与历史权限消费点及回归测试。
- 实现：同一有效材料集合进入 authorizationHash、materialDependencyUnion、安全重放与参考成果过滤；新期不重放旧 Task 聊天。不得改现有排序/预算或引入定时反思。
- 必测：移除范围/知识成员后的上下文收缩、旧记忆/旧成果传递依赖不复活、原 Task 补充后继续、新期跨 Task 隔离、普通人工任务回归。

### SC05：日历与生命周期

#### SC05-1 — cron 与期间

- 必读：契约 §4、上游 cron-parser 的当次官方包/API；package.json 与 lockfile。
- 文件边界：desktop 生产依赖及根 lockfile；`apps/desktop/src/main/services/schedule-calendar.ts`（新增）、日历测试。将 registry 精确发布版本、API/许可/打包证据记本卡，不用本稿源码版本冒充已安装版。
- 实现：同一 nextTimes、规则转 cron、三次预览、半开期间函数；固定偏移时区白名单；精确依赖锁定。确认六段 strict API、月末 skip、Node/Electron build。
- 必测：非零分钟、周日、闰/非闰年 29 日、30/31 日、跨月/跨年、严格晚于 after、三时区、各期间和无期间、人工 now/原 missed 锚点。遇包/API 不符合契约不能手写 parser 降级。

#### SC05-2 — 派发决策与错过

- 必读：契约 §4.3、T2、恢复批次表。
- 文件边界：`apps/desktop/src/main/services/schedule-scheduler.ts`（新增）、恢复批次 Repository 与测试；通过注入派发回调，尚不实现 Expert/Run。
- 实现：注入时钟/timer、迟到窗、generation、单调 cursor、分批 missed 与持久 batchKey、容量/重叠跳过。把计划事实与通知分开，通知在 SC08 接入。
- 必测：59/60/61 秒、恢复不足 60 秒仍 missed、重复 tick、前/后调、不可信时间、100 条分批中断续记、暂停无欠账、批次恢复无重复。功能测试不测墙钟性能。

#### SC05-3 — 宿主生命周期

- 必读：契约 §7；main/index.ts、application-shutdown.ts/测试；docs/11 §3。
- 文件边界：Main 装配、现有 readiness/shutdown、隔离生命周期测试；index 不放调度业务。
- 实现：单实例在恢复前取得；等待既有恢复 readiness；sleep/resume、关窗仍运行、退出同步先关派发；每个 userData 唯一所有者，窗口重建不新建 timer。
- 必测：第二进程不执行恢复/派发、准备恢复未完成不能 tick、睡眠旧回调失效、before-quit 微任务前无新占用、重复 quit/窗口重建无重复实例。测试/应用停止只操作自身实例。

### SC06：后台专家与 Run

#### SC06-1 — 专家预检

- 必读：契约 §6；ExpertService、RunService 的 resolveRunContext/Skill/model 接点；SkillAdapter/ppt-generation、信任 grants/凭据/MCP 契约。
- 文件边界：`apps/desktop/src/main/services/schedule-preflight.ts`（新增）、既有能力只读校验方法及测试。
- 实现：Main 固定版本装配、预检与 fingerprint；逐命令审阅并记录候选 ppt-generation 支持与不支持证据。既有 grant 不足就拒绝，不把信任叫沙箱；不支持的 MCP/脚本整次阻塞。
- 必测：缺真实模型不 Fake 回退、凭据引用不泄露、专家停用、Skill 更新/撤销/依赖缺失、未审阅命令/MCP 拒绝、预检 stale fingerprint、来源动态更新不每次重新索权；预检不调用模型/安装/自动信任。

#### SC06-2 — 本期 Task 装配

- 必读：契约 T3、§4.2/§5/§6；TaskRepository、TaskContextRepository 与专家召唤行为。
- 文件边界：`apps/desktop/src/main/services/schedule-execution-service.ts`（新增）的准备/草稿部分、对应测试。
- 实现：实例关联的 Task/Session/固定专家草稿一次事务创建；requirements/period/来源摘要入可见初始目标；选中专家的现有 Skill/工具/模型规则保持。不修改 ExpertRevision，不复用上一期 Session。
- 必测：同 Workspace 的不同 Task/Session、T3 回滚无半份关系、材料必要缺失保留无 Run 草稿、now 与 missed 新旧配置差异、失败后能打开原任务。本卡不启动 Run。

#### SC06-3 — 原子首个 Run

- 必读：契约 T4；RunService.start/consume 与其测试；记忆审计启动事务。
- 文件边界：现有 RunService 的窄宿主关联入口、schedule-execution-service 启动部分及测试；不重构全 RunService。
- 实现：Run/上下文/记忆审计/Occurrence.firstRunId 同事务；commit 后 consume。普通 start 行为保持；启动取消/撤销最后重查，失败清 activeRuns。
- 必测：T4 中途抛错 Provider 调用 0、commit 后强杀只能一个 Run、重复完成/启动回调没有第二个 Run、普通人工 Run 回归。不能 start 后补 link，也不允许 Renderer 自传关联绕过归属。

#### SC06-4 — 取消与恢复

- 必读：契约 §7；既有 failInterruptedRuns、Skill execution、InputSnapshot 恢复。
- 文件边界：Schedule execution/scheduler 的取消恢复、已有 Main 恢复装配与测试。
- 实现：准备 Abort、暂停/归档语义、单规则和全局容量、Run 取消、重启对账；首个 Run 已终态后待审阅不阻塞未来。
- 必测：T2/T3/T4 断点逐一恢复无补模型、准备超时、暂停取消准备不取消已 Run、显式停止幂等、实时撤销、自动 overlap 与人工 busy、Run 失败后仍保留部分成果。

#### SC06-5 — 类型化 IPC

- 必读：契约 §11、现有 register-ipc.ts/测试及 Preload。
- 文件边界：共享 IpcChannel/Desktop API、`apps/desktop/src/main/ipc/register-ipc.ts`、Preload 及边界测试。
- 实现：连接已经存在的管理/预览/预检/来源/历史/人工执行/取消服务；apply expert revision 只改 Schedule CAS。保存重试由 SC07-2 同卡接线。变化事件 commit 后发送。
- 必测：输入/输出 Zod、归属校验、CAS、错误结构、人工重复 requestKey、非本规则 missed 拒绝、归档拒绝、expert revision 归属、每个 channel 有真正实现及 Preload 消费；不留 TODO/空 handler。

### SC07：版本交付

#### SC07-1 — 输出回执

- 必读：契约 §8、ADR-0005；FileArtifactService/ExecutionOutputService/Artifact Repository。
- 文件边界：`apps/desktop/src/main/persistence/schedule-output-repository.ts`、`apps/desktop/src/main/services/schedule-output-service.ts`（新增）的版本选择/回执、测试。
- 实现：只选本期真实登记版本，固定目标目录/非覆盖命名、pending 状态与 attempt CAS；不复制另一套 Artifact 登记逻辑。
- 必测：不同 Run/月份产物不冒充、版本重复回调一回执、同类型多成果、缺约定类型、清洗长文件名、同名不同版本稳定区分。不能自动使用 Artifact latest。

#### SC07-2 — 保存与恢复

- 必读：契约 §8；现有导出/版本字节解析与路径安全代码。
- 文件边界：schedule-output-service 的受控文件保存、恢复；retry IPC/Preload 与测试。
- 实现：同目录独占临时写入、flush、非覆盖发布、hash 验证、文件/DB 断点恢复、失败只重试原版本。用户修改副本保留，明确重试才分配新 attempt 路径。
- 必测：重复保存、同名冲突、只读/移走目录、根/子目录链接、写出后回执前崩溃、用户改副本、保存超时、双击重试、模型调用始终 0；只能删除本回执临时文件。

### SC08：结果与通知

#### SC08-1 — 结果投影

- 必读：契约 §8/§9、RunService.notifyTerminal；Notification 既有成功已读规则。
- 文件边界：`apps/desktop/src/main/services/schedule-outcome.ts`（新增纯函数）、Run/交付终态接线与测试。
- 实现：Run/真实产物/保存回执/缺项的事实投影，完成不等于产物或业务通过；首个定时 Run 交由定时收口，普通 Run 通知保持。
- 必测：所有结果矩阵、部分产物+Run 失败、缺类型+保存失败、cancel 无失败通知、有界保存后再收口、不出现成功再失败两次通知。不得新增人工审批工作流。

#### SC08-2 — 持久通知去重

- 必读：契约 T5/§9；NotificationRepository/Service 与既有 200 条淘汰行为。
- 文件边界：schedule notification receipt Repository、NotificationService 窄 persist/publish 接点、恢复测试。
- 实现：同事务保存事实/通知/回执，commit 后广播；缺失补记、清空不重发、恢复批次聚合；与原通知接口兼容。
- 必测：T5 各断点、重复终态、清空/淘汰再重启、聚合批次未完时重启、success 已读、warning/error 未读；普通通知行为回归。不能在事务提交前 Toast/系统通知。

#### SC08-3 — 系统通知与回看

- 必读：契约 §9；Main/window、notifications.tsx、App 的通知 target 路由。
- 文件边界：现有 NotificationService/窗口恢复、Renderer ready 握手与目标路由、测试。
- 实现：无窗口也能通知，点击后建窗并等待 ready、按 ID 打开历史 Task/实例；没有点击不抢焦点。系统权限不可用仍落消息中心。
- 必测：无窗口/失焦/已聚焦、通知点击冷建窗、重复 ready、旧 Task 不在 recent、目标消失、当前输入未被后台结果清空、不重放历史 OS 通知。

### SC09：复用现有组件的生产 UI

本节 UI 路径以 `apps/desktop/src/renderer/src/` 为根；其余路径仍以仓库根为准。所有 UI 卡先读 docs/10 §10.1 的实际台账与对应源码 props、§6/8/9/11/12、docs/12 §5/8/9/10、契约 §10；不得从原型拷贝 HTML/CSS 当生产组件。新增基础组件默认 0；确需扩展基座先给具体缺口、扩展现有 props/槽位，同卡更新台账与测试，不新造平行组件。

#### SC09-1 — Hook 与列表入口

- 文件边界：`renderer/src/hooks/use-schedules.ts`、`views/SchedulesView.tsx`、`lib/schedules.ts`（新增）；App 导航接线、现有导航一致性护栏；Hook/View 测试。
- 实现：专家下方最后的定时任务入口、列表/筛选/首读/空集合/无匹配/刷新失败；PageHeader、ScrollRegion、PageToolbar、ViewContainer、ListRow、Badge/StatusNote、PopoverMenu。IPC 在 Hook，事件只刷新事实。
- 必测：实际各 return 分支保留骨架、页头 lg/工具栏 md/行 sm、动作行不整行点击、迟到响应/刷新不覆盖草稿、导航称呼表一致、后台结果不清 Composer。本卡不造编辑器占位或假成功动作。

#### SC09-2 — 整页配置与预览

- 文件边界：`views/schedules/ScheduleEditor.tsx`（页面私有组合）及 Hook/lib 草稿和测试；不进共享 components 台账。
- 实现：四组表单、Field/FieldSelect/TextField/TextArea/SectionHeader/ActionBar；专家只读、长期空间、要求/交付、频率/期间、保存暂停/启用；Main 三次预览。不用新 Wizard/小弹窗表单。
- 必测：非法时间、快速改动预览迟到丢弃、每月 31 日提示、启用预检失败、保存 CAS 失败保留输入、返回未保存确认、取消不保存、控件名称/size/hint 合法。范围弹窗在下一卡接入，不造假来源数据。

#### SC09-3 — 动态来源选择

- 文件边界：配置页面私有范围选择组合、既有 Knowledge 查询 Hook 的适度扩展、测试。
- 实现：Modal/CheckList/BindingChipBar/FieldSelect/Tabs/TextField，文档/集合/default Vault 三种范围；清晰说明后续成员/修订授权；来源用途复用既有枚举。
- 必测：确认才改 draft、取消/Esc 不改已选、焦点恢复、范围重复去重、搜索无匹配、读取失败/对象删除、整库超预算提示、长路径；不创建第二个共享来源选择器、不误用 ComposerCapabilityPicker 的固定材料契约。

#### SC09-4 — 详情与本期

- 文件边界：`views/schedules/ScheduleDetail.tsx`（页面私有组合）、详情 Hook/lib/测试。
- 实现：规则摘要/历史分页/当期来源与成果，ListRow、真实 RunSummaryRow、Disclosure、SourceRow（真实 Evidence）、既有打开成果入口。没有常驻空右栏；原 Task 协作入口清楚。
- 必测：六期分页、missed 无 Run 文案、可用/已读/采用不同、blocked/failed/interrupted/缺产物/保存失败各自行动、部分成果保留、旧版本/原期间不热换；详情刷新失败不丢已有内容。

#### SC09-5 — 动作与专家更新

- 文件边界：定时页面私有 Modal/ConfirmationDialog 组合、Hook 动作/测试；不编辑 Expert 定义。
- 实现：立即执行/原 missed 补做/停止/启停/归档/只重试保存、专家只读差异与 apply；既有 Modal、ConfirmationDialog、AsyncButton、ActionBar、InlineError、TransientToast。
- 必测：双击 requestKey 幂等、missed 原期间/当前配置说明、busy 打开现有实例、暂停与停止区别、归档不删历史、save retry 不触模型、专家差异固定目标/冲突保留、来源/空间不清空、同反馈单出口。

#### SC09-6 — 原 Task 接续

- 文件边界：App 工作页的现有装配、ContextPanel、Composer 能力/材料接点、相关 Hook/lib 与测试。
- 实现：期间/自动来源快照摘要、原任务按 ID 打开、显式补材料、移除本期范围说明；继续是原 Task 的新 Run，材料仅影响该期。不新建“定时工作区”或复制 Composer。
- 必测：补 GL 后继续原任务不改 Schedule、范围移除后安全历史分段、生成人工续作成果不覆写首个自动结果、打开旧 Task/返回保留草稿、后台其他期结束不抢焦点。

#### SC09-7 — 生产 UI QA

- 文件边界：现有 `scripts/ui-render-check.mjs`、fixture/runner 与行为测试；本轮新增页面必要修复。
- 实现：将新增定时列表/编辑/来源/详情/动作/原任务接续纳入现有生产页面宿主；记录「分支→基座→状态/反馈→截图/读数」；不另建模拟页面代替检查。
- 必测：青玉明暗、760/1380px、普通/减动效、长中文/英文路径、Esc/Tab/焦点返回、错误/冲突保留草稿、12px 下限、Token/表面/几何所有者。完整 ui:check/verify；AI 走查截图，人工验收仍另记。

### SC10：离线联合验收

#### SC10-1 — 六期旅程

- 必读：设计验收矩阵、契约全量关键路径、已完成小卡证据；已有 expert-two-period-acceptance 与真实 IPC 临时库宿主。
- 文件边界：`apps/desktop/src/main/services/schedule-six-period.integration.test.ts`（新增）及现有离线应用旅程 fixture；只做必要接线修复。
- 实现/必测：合成中文材料从 4 月推进到 9 月，目录增改删、集合成员/修订变动、历史季/半年对比、缺本期资料后原 Task 补充、错过人工补做、六期产物与同目录积累。注入时钟，不等真实六个月；断言同 Workspace、不同 Task/Session、稳定实例/Run/版本、普通人工能力未受影响。
- 输出证据必须包含 Provider 实际输入的期间/材料、读取范围、真实登记版本及保存字节；工具可用/文件存在不能替代实际读取/成果来源事实。全部 Fake，无业务质量结论。

#### SC10-2 — 故障与总门禁

- 文件边界：定时故障矩阵测试、现有进程强杀恢复宿主及必要回归修复；不新增功能。
- 实现/必测：T2/T3/T4/T5、写文件/回执各断点；重复 tick/request/终态、重叠、休眠/时钟/关窗/退出、撤销/源损坏、无模型、保存失败、通知清空/淘汰、无窗口点击。断言所有 Run 终态、后台 Provider 无自动重试、普通召唤/材料收缩/记忆/通知/取消回归。
- 完整 verify 通过并记录当前 HEAD/未提交 diff；如新增计时规模断言放 bench，另跑 bench。没有 UI/模型人工证据就列待验，不把 SC11 标 done。

### SC11：人类最终验收

由光哥明确选择真实模型配置显示名、材料目录、允许次数/预算后执行。AI 先准备完整可运行离线场景与预检；真实样本默认同目录月度经营分析、周一调研、工作周报，实际专家由光哥指定。

核验真实窗口 P1–P6、已绑定专家工作方式、资料/历史对比、成果质量、保存/通知与人继续协作；六期离线证明调度链路，真实模型证明语义效果，两者不互代。缺真实材料/模型或人类意见保持 todo/doing，记录具体缺口；不重跑其他系列验收，不自动提交发布。

## 4. 里程碑与具体验证命令

| 里程碑 | 覆盖                             | 完成证据                                                                  |
| ------ | -------------------------------- | ------------------------------------------------------------------------- |
| SC-M0  | SC03 全卡 + SC05-1               | 协议/迁移/幂等/CAS/日历定向测试、typecheck、完整 verify；无 UI 新页面声明 |
| SC-M1  | SC04 全卡 + SC05-2/3 + SC06 全卡 | 真实临时库后台 Fake Run、准备/权限/原子启动/退出/崩溃；完整 verify        |
| SC-M2  | SC07/SC08 全卡                   | 真实版本字节的非覆盖保存、回执恢复、唯一通知和无窗口导航；完整 verify     |
| SC-M3  | SC09 全卡                        | 生产页/组件与离线应用旅程证据；完整 verify；标明人工待验                  |
| SC-M4  | SC10 全卡                        | 六期 + 故障 + 普通任务回归；完整 verify；有 bench 改动另跑 bench          |
| SC-M5  | SC11                             | 光哥真实窗口结论、授权真实模型语义与业务审阅，缺证据不代签                |

下面是命令形状示例，文件名以本卡实际新增/既有测试为准；先确认测试属于 functional/heavy，不能一条 broad glob 重复跑全仓。迁移测试按现有 Vitest 档运行。

```sh
npx vitest run --project functional packages/agent-protocol/src/index.test.ts
npx vitest run --project functional apps/desktop/src/main/services/schedule-calendar.test.ts
npx vitest run --project functional apps/desktop/src/renderer/src/views/SchedulesView.test.tsx
npm run typecheck
npm run verify
```

每卡只跑必要定向测试/typecheck；在上述里程碑跑 verify。新的修改/失败/未解风险才扩大重测，不为了“更保险”反复跑已绿全仓。标准护栏/UI 台账变更还须跑相应护栏及违规反例。所有日期来自 date，中文编辑后回读，最终 git diff --check。

## 5. 切换模型后的第一条指令

使用[编码交接 §1](schedule-coding-prompts.md#1-切换后开工指令)，从 SC03-1 开始；此卡重新核对基线并实现 Schema，不重做已批准原型。若用户只要求读计划/核对，则保持只读；若授权连续开发，按推荐顺序逐卡推进，不自行缩成只有 timer 的功能。

产品评审已结束；技术提案归档已完成；库/API/命令验证、生产编码、自动化和最终业务验收分别按上表真实证据推进。

若光哥新建一个 GPT-6 Luna 任务并希望按目标连续推进，直接使用[编码交接 §6](schedule-coding-prompts.md#6-新任务按目标持续推进完整离线实现)。该提示词授权从 SC03-1 连续完成到 SC10-2，逐卡留证后自动续卡，覆盖单卡提示词的停止要求；SC11 只准备人工/真实业务验收，不代签结果。提示词在当前设计任务中的归档不代表已执行这项未来授权。
