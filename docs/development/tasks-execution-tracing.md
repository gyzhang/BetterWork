# 执行追踪开发任务卡（AT00–AT25）

- 日期：2026-10-16，时间来自 `date`。
- 授权：用户已接受[调研建议](../reviews/2026-10-16-agent-execution-tracing-analysis.md)，本轮授权准备适合 **GPT-6 Luna** 的任务卡与目标模式交接；**产品代码未开工**。具体技术提案见 [ADR-0050](../adr/0050-run-execution-diagnostics.md)（Proposed）和[实施契约](execution-tracing-contracts.md)。后续用户提交目标指令时，按该指令限定的连续范围实施，不在每卡之间重复申请授权。
- 唯一状态源：本文。契约拥有行为/字段，本文拥有卡片状态与实施证据，[目标提示词](execution-tracing-coding-prompts.md)只负责派发。本系列不重排、代签或覆盖 A/B0/E/CF/WM/MI/KM/SC/TC/QI/TQ 状态。
- 编排：同一时刻只推进一张卡；共享协议、数据库、RunService、App 不并行写。完成单卡闭环后在已授权的目标范围内继续，**不把“一次一张卡”误解为每卡结束整个目标**。不创建其他聊天、不委派子智能体、不自动切换模型。

## 1. 目标与里程碑

让一次 Run 的每轮模型调用、工具、宿主收口、版本依据都可持久回看；能定位耗时与失败，积累可比较的问题样本。只读观察不改变授权、工具行为和 Run 终态。

| 里程碑 | 卡片 | 可感知交付 | 独立目标的完成条件 |
| --- | --- | --- | --- |
| AT-M0 | AT00 | 文档与交接包 | 文档/链接/任务依赖校验通过，产品代码未开工 |
| AT-M1 | AT01–AT10 | 模型与工具执行链 | 正常/失败/取消/历史回看离线链路通过；第 1 期详情入口可用，UI 实测另列 |
| AT-M2 | AT11–AT16 | 宿主阶段、来源和时间轴 | 准备、清理、Skill 校验/发布与精确版本可关联；观测失败/中断不污染业务终态 |
| AT-M3 | AT17–AT20 | 统计、问题标记和诊断包 | 同筛选同口径聚合，问题 Run 可标记/清除，元数据包可本地导出且无正文泄漏 |
| AT-M4 | AT21–AT22 | 离线质量样本与证据交接 | 合成场景/固定版本比较、最终快检、原有关键路径回归与交接齐全 |
| 独立验收/扩展 | AT23–AT25 | 真实 UI、真实模型、可选 OTLP | 分别获得用户指令后执行，不属于默认离线目标的完成分母 |

推荐首次只授权 AT-M1，之后可按里程碑推进；也提供 AT01–AT22 的完整离线目标。目标完成不等于整份任务板所有卡 done，更不等于人工验收或发布完成。不承诺未经实测的工期、token 预算或特定模型成功率。

## 2. 唯一任务板

状态只用 `todo / doing / blocked / done`。todo 可以表示尚未授权；blocked 必须写实际原因和解锁条件，不拿“尚未轮到”充当阻塞。AT00 的 done 只表示本次文档包完成。

| 卡 | 交付 | 前置 | 阶段 | 状态 | 证据/边界 |
| --- | --- | --- | --- | --- | --- |
| AT00 | 调研承接、契约与 Luna 目标交接 | 无 | M0 | done | 本轮仅文档；调研、任务卡与文档快检证据见 2026-10-17 日志；ADR 技术状态仍 Proposed |
| AT01 | 模型生命周期与关联 Schema | AT00 | M1 | done | 602dc92f；协议最小反例红 1、定向 60 项绿、check:quick 退出 0，差异覆盖 12/12（100%）；迁移仍 v46 |
| AT02 | Core 逐轮模型记录与收口 | AT01 | M1 | done | 602dc92f；Core 红 3 项、绿 46 项；check:quick 首轮 lint 红后修复、复跑退出 0，差异覆盖 78/78（100%）；迁移 v46 |
| AT03 | Provider 元数据与用量边界 | AT02 | M1 | done | 602dc92f；Provider 红 1、Provider/Schema 绿 113 项；快检含 RunService/App heavy，退出 0，覆盖 96/96（100%）；迁移 v46 |
| AT04 | 工具轮次关联与实际执行判定 | AT03 | M1 | done | 602dc92f；Core/投影/组件红 4 项、定向 55 项绿；快检第三轮退出 0，193 文件/3141 项 + 动态 IPC 211 项 + heavy 208 项，覆盖 105/105（100%）；v46 |
| AT05 | 诊断版本标记与核心只读投影 | AT04 | M1 | done | 602dc92f；v47 迁移/回滚与只读投影 red→green；定向功能 66 项、协议/RunRepository 78 项、RunService heavy 2 项通过；check:quick 退出 0（functional 194 文件/3148 项、动态 272 项、heavy 210 项；覆盖 360/395=91.14%）；旧 Run 指标未知，详情合法 JSON 且不超过 64 KiB |
| AT06 | 查询 IPC/Preload 与归属校验 | AT05 | M1 | done | 602dc92f；新增 summary/page/detail 共享 Schema、Main handler 与 Preload 方法；先行红测 3 失败，IPC/Preload 定向 4 文件/457 项通过；Workspace/Task/Run 越权与缺失返回 null，异常和两侧 Schema 拒绝；check:quick 退出 0（functional 194/3154、动态 IPC 277、heavy 210；覆盖 392/424=92.45%）；迁移 v47 |
| AT07 | 历史/实时合并 Hook | AT06 | M1 | done | 602dc92f；Hook 先订阅后查 summary/全量分页，按 node/event ID 合并并按 Core sequence 从 0 检测缺口后补取；切 Run/卸载丢弃迟到响应；红 3、定向 2 文件/10 项绿；check:quick 退出 0（functional 196/3164、动态 277、heavy 210；覆盖 512/544=94.12%）；迁移 v47 |
| AT08 | 执行链详情领域组件 | AT07 | M1 | done | 602dc92f；placeholder 最小行为反例红 7 项；定向 10 项绿；check:quick 最终退出 0（lint/format/typecheck/docs:check 156、functional 197/3174、动态消费者 277、heavy 5 文件/210；覆盖 587/625=93.92%）；迁移 v47 |
| AT09 | 工作页当前/历史 Run 详情入口 | AT08 | M1 | done | 当前/历史 scoped 入口、切 Task/收起面板不取消 Run；ContextPanel 33 项、快检含 App heavy 通过；覆盖 604/643=93.93%，迁移 v47 |
| AT10 | 第 1 期离线跨层回归 | AT09 | M1 | done | RunService＋临时文件 SQLite 重装配 red→green；IPC/Preload/Hook/React 合约 446 项通过；初始 check:quick 退出 0（functional 197/3175、动态 277、heavy 211；覆盖 605/643=94.09%）；同步最新 main 后保留模型角色 v47、诊断元数据迁移为 v48；整合 check:quick 退出 0（functional 196/3157、动态 278、heavy 212；覆盖 605/643=94.09%）；ExpertsView 焦点竞态测试改用 waitFor；PR #214 head 70158c0d 的 Code lint、Quick code check、PR Gate 均通过并于 2026-10-17 squash 合并为 1d94b898；完整验证及真实 UI/模型/性能/安装未验，ADR-0050 仍 Proposed，AT11–AT25 不在本次范围 |
| AT11 | 宿主事实流迁移与记录器 | AT10 | M2 | done | 起点/当前 HEAD `05f4d8b3`；迁移 v49。严格宿主事件 Schema、独立序号仓储与注入时钟记录器；旧 Run 不回填，新 Run 的 host 记录尚未投影时摘要为 partial。Schema/迁移/仓储反例红跑退出 1，四文件定向绿跑 140 项通过；状态摘要完整性反例另红 1 项后转绿；AT10 RunService 跨层旧预期改为 partial，heavy 定向 1 项通过。最终 `npm run check:quick -- --base 05f4d8b3` 退出 0：docs:check 156、functional 195 文件/3159 项、动态 2 文件/280 项、heavy 6 文件/212 项；覆盖 93/108=86.11%。UI/模型/性能/安装未验，详见 2026-10-17 日志 |
| AT12 | Run 准备、审计、清理、提交观测 | AT11 | M2 | done | RunService/RunEventLifecycle 在原边界记录 prepare/audit/skill-cleanup/mcp-cleanup/artifact-commit；Main 显式注入记录器与 wall/monotonic clock。生命周期最小反例红跑退出 1；Lifecycle functional 33 项、RunService heavy 111 项通过；关闭/故障观测与正常观测的业务调用顺序、终态和产物一致，清理失败仍尝试 MCP，提交后取消拒绝，afterCompleted 失败不回写已完成 Run；观测 SQLite 写故障安全日志不含错误正文，业务 Journal 失败仍单独沿用既有终态。最终 `npm run check:quick -- --base 05f4d8b3` 退出 0（含未提交 AT11+AT12 差异：docs 156、functional 195/3162、动态消费者 280、heavy 6/214；覆盖 149/167=89.22%）；迁移仍 v49，UI/模型未验，详见 2026-10-17 日志 |
| AT13 | Skill 宿主阶段与执行关联 | AT12 | M2 | done | 本地 `codex/at11-at25`；dispatch/execute/validate/publish/cleanup 关联真实 executionId/toolCallId，输出只记录受控字节数、截断标志和结果元数据。派发最小反例红 1→恢复后绿 1；Skill/协议定向 77 项、RunService 桥接 heavy 5 项通过；最终 check:quick 退出 0（functional 195/3165、动态消费者 280、heavy 6 文件/215；覆盖 249/279=89.25%）；迁移 v49，真实 PPT/UI/模型未验，ADR-0050 保持 Proposed，详见 2026-10-17 日志 |
| AT14 | 精确工作依据联查 | AT13 | M2 | done | 固定 Run 修订、材料实际读取、记忆/连续上下文与成果输入关系按精确 ID 联查；严格 DTO/同 Workspace IPC/Preload/Hook/详情来源页；配置变更和最新版本不漂移，搜索不算正文读取，跨范围引用拒绝，响应不含正文/路径/fileKey/locator/endpoint。Schema 与读取判定反例红→绿；定向 6 文件/486 项、typecheck 通过；最终 check:quick 退出 0（docs 156、functional 196/3174、动态消费者 2/281、heavy 6/215；差异覆盖 359/447=80.31%）；迁移仍 v49，真实 UI/模型未验，详见 2026-10-17 日志 |
| AT15 | 双来源执行树与时间轴 | AT14 | M2 | done | Core/Host 保留各自原序号，按显式关联建树、稳定复合游标分页并合并最小诊断失效推送；运行详情提供键盘可读时间轴与文本替代。修复 ContextPanel 假 API 缺失订阅方法；8 个定向文件/530 项、ContextPanel 33 项通过；最终 check:quick 退出 0（functional 198/3341、动态消费者 2/281、heavy 6/215；差异覆盖 537/631=85.10%）；无新迁移，仍 v49；真实 UI/模型未验，详见 2026-10-17 日志 |
| AT16 | 观测故障、中断与恢复回归 | AT15 | M2 | done | 补测验证 Recorder 写入失败不改变成功/取消终态、业务 Journal 拒绝事件不派发且失败只收口一次；临时文件 SQLite 重开后启动恢复仅追加一个根失败终态，未闭合 Host 节点为 interrupted 且无结束时间/耗时，不触发 Provider 重跑。定向 lifecycle 35 项、RunService AT10 恢复 1 项及完整 check:quick 通过（functional 198/3342、动态消费者 2/281、heavy 6/215；差异覆盖 537/631=85.10%）；无新迁移，仍 v49；未强杀进程/操作用户库/验真实 UI 或模型，详见 2026-10-17 日志 |
| AT17 | 统计筛选与确定性聚合 | AT16 | M3 | done | 闭区间 `runs.created_at` 与精确 Run 快照筛选；游标绑定 Workspace/筛选，聚合跨全部匹配 Run。失败分母仅 completed+failed，token 保留 0/未知，工具执行失败/拒绝分开，模型调用单调耗时 nearest-rank。定向 4 文件/474 项通过；check:quick 退出 0（docs 156、functional 198/3345、动态消费者 2/282、heavy 6/215；覆盖 634/729=86.97%）；无新迁移，v49，详见 2026-10-17 日志 |
| AT18 | 执行记录筛选与统计呈现 | AT17 | M3 | done | 详情内接入任务/Workspace、日期、固定修订与模型指纹筛选；统计覆盖全部匹配 Run、显示失败分母、完整性、token 已知/未知调用、耗时样本与排除数；迟到筛选响应丢弃，可分页并返回具体 Run。定向 React 15 项通过；关闭请求世代校验的变异测试红 1、恢复后绿；check:quick 退出 0（docs 156、functional 2 文件/48 项、heavy App 56 项；差异覆盖 102/114=89.47%）；无迁移，v49，真实 UI 留 AT23，详见 2026-10-17 日志 |
| AT19 | 用户问题标记 | AT18 | M3 | done | v50 追加每 Run 单标记表，CAS revision 防并发覆盖并随 Run 级联删除；Main 验证 Workspace/Task/Run 归属，节点必须属于该 Run。协议/IPC/Preload/Hook/执行链分类与节点选择已接通；保存失败保留草稿，成功/清除各只有一枚局部 TransientToast。跨层定向 6 文件/560 项通过；check:quick 退出 0（docs 156、functional 197/3195、动态消费者 2/285、heavy 6/215；覆盖 119/124=95.97%）。修复协议测试既有嵌套用例收集错误；不含自由文本/Memory，真实 Electron UI 留 AT23，详见 2026-10-17 日志 |
| AT20 | 本地脱敏 JSON 诊断包 | AT19 | M3 | done | `schemaVersion: 1` 严格白名单包；Main 在同一 AppStore 事务验证范围并取 Run、完整诊断投影、来源与问题标记；UTF-8 5 MiB 超限拒绝、保存对话框取消静默、权限 0600、写失败可重试，结果不回传路径。协议最小用例先红后绿；服务/IPC/Preload/详情页覆盖密钥、prompt、reasoning、嵌套工具输出、路径脱敏、错误范围与来源完整性降级。定向跨层 5 文件/495 项通过；最终 check:quick 退出 0（docs 156、functional 198 文件/3203 项、动态消费者 1/221、heavy 6/215；覆盖 115/138=83.33%）。迁移仍 v50；未连接远端、未调用模型，真实 Electron UI 留 AT23，详见 2026-10-17 日志 |
| AT21 | 固定合成样本与版本比较 | AT20 | M4 | done | 9 类固定事件样本逐场景新建内存 SQLite/Run；比较输入/配置修订、Run ID、期望与生产仓储观测，9/9 匹配，业务质量明确未验。比较器反例红 1 项失败、修复后定向绿 2 项；`check:quick -- --base 44709041` 退出 0（lint、format、typecheck、docs 156、functional 1 文件/2 项、heavy 无差异用例）；无迁移。详见 [AT21 离线样本报告](execution-tracing-quality-sample-v1.md) 与 2026-10-17 日志 |
| AT22 | 离线总收口与人工验收清单 | AT21 | M4 | done | 核对 AT01–AT21 提交、当前分支/HEAD、v50 与 Main 生产装配；帮助 §8.3 补当前/历史入口和筛选、标记、导出说明。离线回归：11 文件/540 项、RunService/SQLite 跨层 1 项、App 回答保存 2 项均通过；`check:quick -- --base 2e57b337` 退出 0（本卡仅文档差异，docs 156）。人工清单已写入但待人执行；UI、真实模型、安装、性能未验；详见日志 |
| AT23 | 真实 UI 专项与人工走查 | AT22 | 独立 | doing | 用户已安排本轮继续 AT11–AT25；`--diagnostics-only` 覆盖青玉明/暗 × 760/1380 × 普通/减动效 8 组，验证实时宿主阶段、长双语载荷无横向溢出、问题标记失败保留后重试、导出取消、工作空间筛选、失败/停止 Run 回看、Tab/Esc 焦点归还及 reasoning 不显示；专项 8 组、全量 `ui:check` 82 组和 app-only 1 组通过，真实 App/Preload/IPC/临时 SQLite 重开旅程 17 步与进程恢复通过。`check:quick -- --base 18daa331` 退出 0（lint、format、typecheck、docs 156；无匹配 Vitest 用例，页面行为由独立 UI 门禁覆盖）。AI 截图走查读数正文最小 12px、无横向溢出，未发现页面缺陷；截图在 `/tmp/betterwork-at23-fullui.Eg4foa` 与 `/tmp/betterwork-at23-appfinal.n0Rb7s`。实际人工验收仍待填写，不代签 |
| AT24 | 真实模型语义与业务验收 | AT22 | 独立 | todo | 待模型配置/预算授权，未计入离线目标 |
| AT25 | 固定版本 OTel/OTLP 出口 | AT22 | 可选 | todo | 用户于 2026-10-17 明确决定本轮跳过；未实施且未授权对外发送。状态保留 todo，OTLP 不是本地主链路前置 |

## 3. 所有代码卡共同执行

1. 读 AGENTS、共同纪律、docs/12 相关章节、ADR-0050、契约指定章节、前置卡证据和本卡源文件。UI 卡再读 docs/10 §6.1/§8/§9/§10.1/§11.5/§12；新增稳定组件登记真实台账。
2. 先执行 date、核对 HEAD/分支/git status、最新迁移和测试档位。每个实现目标使用任务分支；未合并计划可能仍在本地分支，先保留/确认其可见性，不通过 reset/clean/stash 删除它。并行任务另用独立 worktree，不共享写目录。
3. 一张卡只解决一个行为或一个层次。允许修正被本卡协议直接影响的消费者与测试，但记录原因；无关重构、新包、第二套引擎、通用框架不进入卡片。
4. 新增领域行为/缺陷用最小反例先红，再实现绿跑并记录必要重构回归。已有行为不重复造测试，核对覆盖后标记特征测试。不要为了比例写镜像断言、改断言预算或放宽护栏。
5. 日常执行 `npm run check:quick -- --base <本次有效基点>`，由工具链完成类型、相关测试和差异覆盖；失败修复后才推进下一卡。定向运行 Vitest 时按当前 `vitest.config.ts` 选择 functional 或 heavy；RunService/App 目前在 heavy，禁止用 functional 空跑当通过。
6. `npm run verify`、`npm run ui:check`、真实 UI 走查只在用户明确安排或既有夜间计划执行；不要照抄旧 TC/SC 文档的自动全验要求。迁移/业务测试使用临时 SQLite；模型/HTTP 使用注入替身；墙钟/内存断言只放 bench。
7. 中文编辑回读，`git diff --check`，更新本表当卡证据与 `docs/logs/YYYY-MM-DD.md`。证据包括代码版本、红/绿命令与退出码、迁移号、主要行为和未验项；测试命令必须真的选中用例。
8. 用户已经授权一个连续目标时，常规文件/实现选择自主完成，不在每卡间等待“继续”。遇用户改动冲突、产品/数据/安全边界不明，或方案连续两层障碍，先停止受影响变更并给具体事实/可选方案；不能静默换架构。预算耗尽、需要人工验收或缺少授权不算目标完成。提交、推送、发布另看用户授权。

## 4. 源码阅读组

下列路径相对仓库根目录；新增模块应按 docs/12 放在对应层级，卡片不要求创建另一套目录。开工必须重新确认实际文件，不能假定历史函数名未变。

| 组 | 真实现有入口 |
| --- | --- |
| P：协议与 Core | `packages/agent-protocol/src/index.ts`、`index.test.ts`；`packages/agent-core/src/types.ts`、`agent-engine.ts`、`agent-engine.test.ts`、`openai-compatible-provider.ts` 及其测试 |
| J：Journal/迁移 | 以 `apps/desktop/src/main/` 为根：`db/app-schema.ts`、`db/migrate.test.ts`；`persistence/run-repository.ts` 及其测试、`persistence/index.ts` |
| R：运行编排 | 以 `apps/desktop/src/main/services/` 为根：`run-service.ts`、`run-event-lifecycle.ts`、`model-provider-factory.ts`、`memory-dispatch-gate.ts` 及其测试 |
| I：进程边界 | `apps/desktop/src/main/ipc/register-ipc.ts` 及其测试、`apps/desktop/src/preload/index.ts`、现有 Preload 契约/编译测试 |
| U：工作页 | 以 `apps/desktop/src/renderer/src/` 为根：`App.tsx` 及其测试、`lib/run-events.ts`、`lib/tool-activity.ts`、`components/ToolActivity.tsx`、`components/context/ProcessContext.tsx`、`components/Modal.tsx`、`hooks/use-task-selection.ts` |
| S：Skill 宿主 | 以 `apps/desktop/src/main/` 为根：`services/skill-execution-service.ts`、`services/execution-output-service.ts`、`services/skill-command-runtime.ts`、`infrastructure/process-supervisor.ts`、`persistence/skill-execution-repository.ts` 及其测试 |
| X：历史依据 | 以 `apps/desktop/src/main/` 为根：`persistence/run-context-snapshot-repository.ts`、`persistence/run-material-read-repository.ts`、`persistence/run-memory-context-repository.ts`；`services/run-context-resolver.ts`、`services/artifact-query-service.ts` 和 AppStore 中现有精确版本查询 |

每组相对路径按该行指定父目录解析。先看所属聚合，不把 `artifact-version-executor.ts` 的“成果版本来源专家解析”误当成脚本执行器。

## 5. AT-M1：模型与工具执行链

### AT01：模型生命周期与关联 Schema

- 前置/必读：AT00；契约 §2–§3、§6；P，ADR-0003 和 docs/03。
- 范围：定义四类模型事件、严格用量/元数据和工具可选关联；共享类型由 Schema 派生，旧事件保持可解析。调整必要的直接消费者以保持类型检查，不发射新事件。
- 反例/验收：负数/小数 token、过长标识、缺 modelCallId、非法结束类型被拒绝；旧 Run/tool/message 夹具仍通过。不要在本卡声明无人消费的 IPC channel。
- 验证/停点：协议 Schema 定向测试和快检；无迁移、Provider 请求变化或 UI。
- 实际证据：红跑 `node_modules/.bin/vitest run --project functional packages/agent-protocol/src/index.test.ts` 退出 1（正例被当前 Schema 以未知 discriminator 拒绝）；同命令绿跑 60 项退出 0。`npm run check:quick -- --base 602dc92ffe64a9f1010cd344933891f84addfc39` 退出 0，差异覆盖 12/12（100%）；详见 2026-10-17 日志。

### AT02：Core 逐轮模型记录与收口

- 前置/必读：AT01；契约 §3.1/§5；P、R 中 Provider 包装审计。
- 范围：同一事件工厂输出模型开始与唯一结束；独立 modelCallId、round、调用计数、单调 duration 和可选首个文本时间；done 元数据进入对应结束事件。
- 反例/验收：模型→工具→模型两轮、tool-only、同步 stream 抛错、流中断、空流、length/filter/unknown、每个 yield 恢复处取消；失败也保留已收到的 usage。无迟到工具/下一轮、无重复终态、无 reasoning 展示。
- 验证/停点：Core 确定性 clock/Fake Provider 测试及快检；不修改模型配置、不新增重试。
- 实际证据：`node_modules/.bin/vitest run --project functional packages/agent-core/src/agent-engine.test.ts` 新增反例红 3 项；实现及旧顺序断言同步后 46 项通过。`check:quick` 首轮因 import-sort 退出 1，定向 ESLint 修复后以相同基点复跑退出 0，差异覆盖 78/78（100%）；详见 2026-10-17 日志。

### AT03：Provider 元数据与用量边界

- 前置/必读：AT02；契约 §3.1；P 的 SSE 解析和现有健壮性回归。
- 范围：核对实际 done 数据和诊断 Schema 兼容；只修本增量暴露的真实边界问题，不重复重写已经存在的解析器。
- 反例/验收：usage 缺失/真实 0/部分字段、非法数字、finish_reason 后 usage、tool-only、服务请求/响应标识、超长或非法元数据；未知不变 0，`[DONE]` 不等待 HTTP EOF，取消/异常释放 reader。
- 验证/停点：注入 fetch/ReadableStream，无触网；已有覆盖明确复用并记特征证据。不得强塞 include_usage、新设置或服务商分支。
- 实际证据：Provider 反例红 1，Provider+协议定向回归 113 项绿。`check:quick -- --base 602dc92ffe64a9f1010cd344933891f84addfc39` 最终退出 0，覆盖 96/96（100%）；选中 RunService/App heavy（208 项）。首次 lint 的 control-regex 错误已定向修复；详见 2026-10-17 日志。

### AT04：工具轮次关联与实际执行判定

- 前置/必读：AT03；契约 §3.2；P、U 的现有工具状态纯函数。
- 范围：Core 工具事件关联 modelCallId/round，投影区分调用请求、实际 started、参数拒绝和执行失败；保留已有 ToolActivity 行为。
- 反例/验收：损坏参数、未知工具、同批合法/非法、工具抛错、Skill 返回 failed/timed-out/cancelled、取消后迟到进度；未执行无伪造 started/duration，工具纠正后 Run 可成功。
- 验证/停点：Core 与 tool-activity 定向回归、快检；不改变工具输入、授权与模型历史消息内容。

### AT05：诊断版本标记与核心只读投影

- 前置/必读：AT04；契约 §2/§5/§6；J、R。新增 Main 诊断查询模块按当前工程规范命名。
- 范围：版本化迁移为 Run 保存 diagnostics recording version/已启用部分，旧值未知；新 Run 创建事务写入标记。由 Journal 产生 summary、轮次/模型/工具节点、分页与按需详情；只加已证明需要的索引。
- 反例/验收：历史无模型事件、tool-only、被拒绝工具、重复/未闭合事件、损坏 JSON、同毫秒排序、跨 Run 关联、迁移回滚和新 Run 事务失败；不回填旧指标、不重置用户数据、不扫描无关正文。
- 验证/停点：临时库迁移/Repository/Service 测试及快检；本卡不注册 IPC，不加宿主事件表。

### AT06：查询 IPC/Preload 与归属校验

- 前置/必读：AT05；契约 §6；I、J。读 docs/03、ADR-0003。
- 范围：有消费者地接入 summary、节点分页与节点详情查询；共享请求/结果 Schema、Main handler、Preload 与最小调用测试同卡完成。
- 反例/验收：非法页大小/游标、跨 Workspace/Task/Run 节点、不存在对象、查询异常、过大详情截断；输入输出两侧校验，不向 Renderer 暴露 SQL/路径。
- 验证/停点：Main IPC 与 Preload 契约测试、快检；不把原始事件全文广播。

### AT07：历史/实时合并 Hook

- 前置/必读：AT06；契约 §6；U 的 App 订阅和 mergeRunEvents、I；参考调研中 replay/live 反例。
- 范围：新增一个内聚诊断 Hook 与纯合并逻辑；先订阅再读快照、稳定 ID 去重、缺口补取；只承接诊断查询，不顺手重构整个 App 状态。
- 反例/验收：快照期间到事件、重复/乱序回执、切 Run/Task 迟到、卸载、失败重试、终态到达；旧任务事件不串入新选择，失败到可见出口。
- 验证/停点：Hook/纯函数用最小 IPC 替身回归及快检；不运行 Electron、不改停止 Run 行为。

### AT08：执行链详情领域组件

- 前置/必读：AT07；契约 §1/§6、docs/10 相关章节；U 和台账真实 props。
- 范围：组合现有 Modal sheet、Tabs、ListRow、Disclosure、InlineError 等基座呈现 summary、轮次/模型/工具、按需详情；仅新增必要领域组件并登记台账。
- 反例/验收：首读、空记录、旧记录、加载失败/重试、partial、运行中/失败/取消、长中英文、截断载荷；首个文本指标名称准确，未知不用 0，私有推理不显示。
- 验证/停点：React 组件行为/键盘语义测试与快检；真实窗口、视觉与 UI 专项留待 AT23，不自造 Token/Toast。

### AT09：工作页当前/历史 Run 详情入口

- 前置/必读：AT08；契约 §1/§6；U 中 ProcessContext、App、ContextPanel，docs/10 §11。
- 范围：过程页签“执行详情”入口连接真实 Hook/组件；历史 Run 走同一路径；关闭焦点归还，关闭右栏或详情不取消 Run。
- 反例/验收：运行中打开、完成后回看、切 Run/Task、关闭重开、右栏收起、失败重试；原工具摘要/旁白/回答保存和来源不退化。
- 验证/停点：组件/Hook 与 App heavy 回归、快检；无新一级导航和真实模型。

### AT10：第 1 期离线跨层回归

- 前置/必读：AT09；契约 §3/§5/§6/§10；P/J/R/I/U 当前实现与前九卡证据。
- 范围：用实际 RunService、临时 SQLite、Fake Provider，验证事件→Journal→查询 DTO；通过现有 IPC/Preload 合约与 React 替身检查入口，不把该证据称为真实 Electron 旅程。
- 反例/验收：两轮调用与 tool-only 用量、失败/取消、重装配读取、旧 Run 未知字段、跨任务拒绝、snapshot/live 交接；原成功 Run/Artifact/来源集合不变，无网络请求。
- 验证/停点：定向跨层测试及快检，整理 AT-M1 证据；授权只到 M1 时结束目标，AT23/24 保持未验。

## 6. AT-M2：宿主阶段与工作依据

### AT11：宿主事实流迁移与记录器

- 前置/必读：AT10；契约 §2/§4/§5；J、R，ADR-0050。
- 范围：追加宿主事件表/严格 Schema/Repository 与独立定序记录器；升级新 Run 的 recording version/sections，旧 Run 保留原记录范围。
- 反例/验收：并发追加不冲突、跨 Run 父/工具/执行关系拒绝、重复幂等与冲突终态、JSON 损坏、事务回滚、级联删除；Core sequence 完全不受影响。
- 验证/停点：迁移/仓储/记录器离线测试、快检；此卡不改实际运行阶段。

### AT12：Run 准备、审计、清理、提交观测

- 前置/必读：AT11；契约 §4/§5；R 和现有应用退出协调。
- 范围：在真实 Main 边界记录 prepare/audit/skill-cleanup/mcp-cleanup/artifact-commit，不重排执行；生产装配显式注入记录器与时钟。
- 反例/验收：准备失败、候选成功后取消、清理失败仍尝试另一清理、提交开始后取消拒绝、完成后回调失败；开启/关闭/故障观测时业务调用次数、终态、成果与授权相同。
- 验证/停点：Lifecycle functional、RunService heavy 及快检；观测写失败与业务 Journal 失败必须分测，不吞业务错误。

### AT13：Skill 宿主阶段与执行关联

- 前置/必读：AT12；契约 §4/§5；S、R 的 RunSkillBinding 与工具桥接。
- 范围：以 executionId/toolCallId 关联调度、执行、真实可观察的 validate/publish/cleanup；联查现有结果/报告引用与截断标志，不复制日志正文或开放任意路径读取。
- 反例/验收：启动失败、非零退出、验证拒绝、发布失败、超时/撤权/取消与清理失败、迟到结果；未埋点 CLI 内部显示未记录，不能伪造细分时间或新增业务失败种类。
- 验证/停点：Supervisor/Skill 服务合成替身回归、必要动态消费者与快检；不运行真实 PPT 工具链、不改变脚本授权。

### AT14：精确工作依据联查

- 前置/必读：AT13；契约 §6；X、材料/记忆/成果现行契约，docs/04、ADR-0005。
- 范围：按 Run 固定修订联查专家、技能/环境、模型、材料读取、记忆与连续上下文、成果版本；查询/IPC/Hook/详情来源区域同卡接通，不复制正文。
- 反例/验收：配置已编辑/删除、材料最新版本变化、只选未读/已读未采用、跨 Workspace/Run 伪造引用、旧字段缺失；不取 latest、不把选中当采用或 dispatch-attempted 当送达。
- 验证/停点：查询/IPC/Hook/组件的精确 ID 与范围断言、快检；不修改权限、索引和引用业务状态。

### AT15：双来源执行树与时间轴

- 前置/必读：AT14；契约 §4–§7；Main 查询、AT07 Hook、AT08 详情组件。
- 范围：查询和 UI 纳入 HostDiagnosticEvent；新增只含 runId/游标的诊断失效推送并接入完整消费者；按显式关系组树，以已知时间绘制瀑布和文本替代。
- 反例/验收：两来源同时间/乱序、父节点缺失、部分宿主观测丢失、运行中、零/异常时间、子进程区间未知；不伪造全局 sequence，不以累计子耗时冒充根耗时，键盘可查看每个节点。
- 验证/停点：投影/两路合并/IPC/组件及快检；图形使用语义 Token，不新增图表依赖和真实 UI 启动。

### AT16：观测故障、中断与恢复回归

- 前置/必读：AT15；契约 §5/§6/§10；J/R/S 与现有恢复测试。
- 范围：在隔离库/合成宿主验证观测事件不可写、业务 Journal 不可写、缺口、重装配与已有启动恢复；保留失败发生在哪一层的证据。
- 反例/验收：可选 recorder 失败不改变业务成功或取消；业务审计失败零派发/现行失败；不完整节点不补造成功/时长，不自动重跑，根终态只提交一次。
- 验证/停点：离线回归和快检；真正进程强杀/真实 Electron 恢复仍走用户安排的 AT23，禁止强杀用户应用或操作其库。

## 7. AT-M3：统计与问题样本

### AT17：统计筛选与确定性聚合

- 前置/必读：AT16；契约 §7；诊断查询与现有版本/Run 仓储。
- 范围：Workspace 内按 Task、时间窗、精确专家/技能修订、模型指纹过滤；同一筛选返回列表和统计；有实际消费者地增加 DTO/IPC/Preload 查询。
- 反例/验收：取消/运行中不混失败分母、局部失败后 Run 成功、0 与未知用量、tool-only、父子用量去重、nearest-rank p50/p95、空样本/缺版本、跨范围游标；结果能追到 Run。
- 验证/停点：固定数值合成样本独立计算期望值、查询/IPC 测试及快检；不建后台采样器/价格表/预聚合真相库。
- 实施口径：创建时间窗按 `runs.created_at` 闭区间；仅查 Run 固定的 Expert/Skill 修订与请求准备时模型指纹，游标绑定 Workspace 和完整筛选；统计跨全部匹配样本。耗时只聚合模型节点实际记录的单调 `durationMs`，pending/running/interrupted/unknown/缺测分别列出排除数。

### AT18：执行记录筛选与统计呈现

- 前置/必读：AT17；契约 §1/§7；U 和当前诊断 Hook/详情组件。
- 范围：在现有执行详情空间接入记录列表、有限筛选和统计；缺失调用数、样本数与时间口径可见，可返回具体 Run。
- 反例/验收：空记录/无匹配/失败/重试、快速切筛选、迟到结果、清除条件、旧模型版本；不把未知变零，不用统计筛选扩大材料权限。
- 验证/停点：Hook/React 行为测试与快检；不新增一级页面，不做全局监控大屏。

### AT19：用户问题标记

- 前置/必读：AT18；契约 §8；J/I/U 当前诊断链路。
- 范围：追加最小标记表与归属/CAS 或等效并发保护，接通用户显式设置/更改/清除分类和可选本 Run 节点引用；成功短时确认复用局部 TransientToast。
- 反例/验收：跨 Run 节点、重复提交/并发修改、删除 Run 级联、保存失败保留选择；标记不改 Run/Expert/Memory，不产生两条反馈。
- 验证/停点：迁移/仓储/服务/IPC/Hook/组件最小行为回归与快检；不加自由文本备注或自动分类模型。

### AT20：本地脱敏 JSON 诊断包

- 前置/必读：AT19；契约 §8；现有 Main 文件导出设施与当前诊断查询。
- 范围：字段白名单重新构造有版本的本地包，导出入口、保存取消、大小限制、错误可见；同次 Run 状态与诊断快照一致，不从原始 JSON 全量拷贝。
- 反例/验收：合成密钥/绝对路径/私有正文埋在 prompt、工具结果、错误、嵌套字段和 reasoning 中均不得出现在导出；保存取消不报错、写失败可重试、5 MiB 超限明确拒绝，未授权范围拒绝。
- 验证/停点：确定性导出数据测试、文件替身/临时目录、IPC/Hook/组件及快检；不连接远端、不新建 Artifact 类型、不做 OTLP。

## 8. AT-M4 与独立验收

### AT21：固定合成样本与版本比较

- 前置/必读：AT20；契约 §9；本系列现有测试/夹具和当前代码。
- 范围：复用现有测试层建立固定合成场景与可复核比较报告，记录输入/配置版本、Run ID、期望与观测；已有场景直接复用，不复制第二套引擎/评测平台。
- 反例/验收：契约所列正常、截断、tool-only、可恢复工具失败、Skill 拒绝、取消/清理失败、交接与缺版本；比较只声称结构/链路差异，不由 fake 产物评业务质量。
- 验证/停点：确定性场景/比较器测试与快检，真实模型请求为 0；无付费重跑按钮、自动优化或真实内容质量验收。

### AT22：离线总收口与人工验收清单

- 前置/必读：AT21；契约 §10；AT01–AT21 实际证据与最新 docs/10、docs/12。
- 范围：核对全部代码卡、当前 HEAD/迁移与生产装配；更新现有文档/帮助中的实际入口，生成本任务板内的人工验收步骤与未验项，不另造状态板。
- 验收：覆盖“发送→查看模型/工具→历史恢复→宿主阶段→精确来源→筛选→标记→导出”的离线集成；现有回答保存、来源隔离、取消/终态不回退；快检成功，日志/中文回读/差异与敏感内容检查齐全。
- 验证/停点：最后一个基于准确当前快照的 check:quick 结果与必要跨层回归。未运行的 UI、真实模型、安装、性能专项明确列出；不能自动跑完整 verify。授权 AT01–AT22 的目标在这里完成，不等待 AT23–AT25，也不将它们标 done。

#### AT22 人工验收清单（待人工执行）

以下步骤用于后续在隔离验收数据中逐项填写“实际结果”；当前表格不表示人工验收已执行或通过。使用确定性 Provider 替身和临时 Workspace/Task/材料，不调用真实模型或外部工具。

| 步骤 | 动作 | 预期 | 实际结果 |
| --- | --- | --- | --- |
| 1. 提交与回答 | 在隔离验收宿主通过正常工作页入口提交合成任务，等待完成并查看回答 | 新 Run 有唯一终态；回答按原消息/成果入口查看，不展示 reasoning | 待人工填写 |
| 2. 执行链与宿主阶段 | 从当前摘要打开“执行详情”，查看模型、工具与 prepare/audit/清理/提交阶段 | 调用关联、实际执行与拒绝分开；失败/取消不伪装成功；未测耗时不补数 | 待人工填写 |
| 3. 历史恢复 | 展开“过程 → 执行记录”，打开已完成、失败和取消的历史 Run | Run 身份、消息、终态与既有成果不变；打开历史项不创建新 Run 或重放 Provider | 待人工填写 |
| 4. 精确来源 | 在“工作依据”核对固定 Expert/Skill/model、材料修订、读取足迹和 Artifact 输入关系 | 展示精确修订；已选材料与实际读取分开；不以当前配置替代缺失历史，不泄露正文/路径 | 待人工填写 |
| 5. 筛选与统计 | 在“记录与统计”切换工作空间/任务、日期、修订和模型指纹，打开匹配项 | 列表与全样本统计同筛选；未知值与缺失记录保持可见；具体 Run 可再打开 | 待人工填写 |
| 6. 问题标记 | 在执行链设定类别、关联同 Run 节点、保存后回看并清除 | 标记可回看且只保留当前一条；保存/清除不改变 Run、来源或成果 | 待人工填写 |
| 7. 诊断包 | 导出到临时目录，查看 JSON 版本和白名单字段；另试保存取消 | `schemaVersion` 与受控元数据齐全；不含 prompt、消息/工具正文、reasoning、路径或凭据；取消不落文件 | 待人工填写 |
| 8. 保存成果与隔离 | 将已完成回答按现有入口保存为新版本，并检查其他 Task/Workspace 的记录 | 新版本关联正确来源 Run；失败/取消 Run 不回退终态；跨范围 ID 不暴露其他对象 | 待人工填写 |

**尚未取得的验收证据：**真实 Electron UI/视觉与键盘焦点走查（AT23）；真实模型语义、用量和内容质量（AT24）；签名安装包/安装运行；性能专项与 bench；人工表格实际结果。未运行完整 `npm run verify`。ADR-0050 仍为 Proposed。AT23–AT25 状态保持独立，不因 AT22 收口而标 done。

### AT23：真实 UI 专项与人工走查（单独指派）

- 前置：AT22，用户明确安排真实 UI 验证；不是默认代码目标隐含动作。
- 范围：按现有 ui:check 架构扩展合成夹具，覆盖明暗/窄宽窗口、键盘/焦点归还、长内容、历史/实时、失败/取消、重开恢复；真实应用启动/停止走仓库脚本。
- 验收：专项自动化与 AI 页面走查分别留截图/读数；用户最终验收逐项记录“动作、预期、实际”。只能操作隔离验收数据，不能用截图代签人工通过。
- 停点：若同时未授权修复产品代码，只报告发现与最小复现；本卡不自动调用真实模型或发布。

### AT24：真实模型语义与业务验收（单独指派）

- 前置：AT22，用户指定模型配置显示名、调用/费用边界、可用测试材料与允许工具范围。
- 范围：小样本真实调用，核对每轮模型元数据、工具/Skill、用量缺失与错误说明、成果版本和来源；只在获得本次授权后执行。
- 验收：如实记录真实请求数/用量、失败与未知字段；业务质量由用户按固定标准判定，不以结构测试代签。重跑新建 Run，有副作用工具先核对授权。
- 停点：预算或外部服务阻塞保留事实，不切换模型/扩大预算；未验不计本卡 done，不阻塞已完成的离线目标。

### AT25：固定版本 OTel/OTLP 出口（可选扩展）

- 前置：AT22，用户单独授权 exporter 方向与目标端点/数据边界；实施前补目标 semconv/协议版本适配到 ADR/契约。
- 范围：Main 侧从已有持久事实导出，Core 不导入 SDK；受控队列、超时、失败读数、退出排空；session/run 分字段，元数据最小化。
- 验收：注入 HTTP/collector 桩覆盖成功、不可达、重复、队列满与退出；导出故障不改变 Run/取消/成果，不触网测试，不引入服务端/云账户或 Studio 依赖。
- 停点：实际外部上报需要相应端点授权；本卡不启用完整请求捕获和自动优化。

## 9. 证据记录格式

在唯一任务板该卡证据列写结论，在当日日志写实际命令与事实；避免把整份输出粘进本文。每卡至少记录：目标/起止 HEAD、相关文件、最小反例与红绿退出码、迁移号或无迁移、定向及 quick 结果、UI/真实模型/性能/安装未验项、技术偏差及批准依据。

切换聊天或上下文压缩后，从本表恢复第一张未完成且已获授权的卡；先核对现存代码、日志和最新工作树，再决定续做还是补证据，不重新生成计划、不回滚他人改动、不把前置旧 SHA 的绿灯当当前版本通过。
