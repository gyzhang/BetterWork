# 记忆改进开发计划（MI00–MI10）

- 日期：2026-09-25；状态：**D1–D5 推荐方案已批准，MI00–MI10 全部未开工**。
- 依据：[改进 Spec](../designs/memory-improvements.md)、[记忆契约 §11](memory-contracts.md#11-mi-改进契约proposed)、[ADR-0028](../adr/0028-memory-reliability-improvements.md)、[评审原型](../prototype/memory-improvements/index.html)。逐卡派发使用[编码提示词](memory-improvement-coding-prompts.md)。
- 本文是 MI 唯一状态板，不修改 WM00–WM16 的历史状态；WM16 与 MI10 可复用相同场景的证据，但不能互相代签。

## 1. 下午怎样推进

**建议优先完成 MI-M0，不承诺当天下午做完全部改进。** 以下是顺序与停止点，不是工时估算或隐含开工授权。

1. D1–D5 推荐方案已获光哥批准，无需重复评审未变化的方案；仍可只安排 MI-M0，后续阶段另行派卡。
2. MI00 已核对，MI01–MI03 的代码与自动化已落地（见状态表）；MI-M0 仍需光哥在真实应用完成两条人工路径后才算通过。
3. MI-M0 的门槛：来源链与排除恢复自动化通过、应用中完成两条人工路径；未通过就停在此里程碑，不带病叠加新策略。**当前状态**：自动化与提交已完成（MI01 done、MI02/MI03 doing＝UI 待光哥走查）；MI04/MI05 在同日持续指令下已推进，若 MI-M0 人工走查发现问题，回对应卡补回归后再继续 MI06+。
4. MI-M0 通过且取得对应卡授权后，再执行 MI04 → MI05 → MI06。MI04 是迁移基础，不单独宣布优先策略可用。
5. MI07 → MI08 完成治理与换期；MI09 做离线联合回归；MI10 单独安排真实 UI 与已授权的真实模型效果评审。
6. 每卡串行。协议、迁移、App.tsx、RunService 是共享高冲突文件，不并发派给多个编码会话。与 KM/CF 的并行会话保持文件边界，不抢改其测试。

### 1.1 授权与完成维度

- 当前审批事实：2026-09-25，光哥查看原型后明确「批准 D1～D5 的建议」。五项设计推荐均已批准；MI00 尚未执行，MI01–MI10 尚未获开发指令；真实应用验收、真实模型调用、提交、推送与发布均未授权，ADR-0028 正式状态仍为 Proposed。
- 文档评审：批准产品/技术推荐，不等于授权执行 MI00、开发、真实模型调用或发布。
- 单卡开发：后续「按推荐方案执行 MIxx」授权本卡必要实现、测试与文档；不自动执行下一卡。
- UI 验收：启动只用 `bash scripts/dev-start.sh`，光哥操作真实应用；提供「动作→预期」。如果使用浏览器测试 Renderer，必须为专用测试环境，不操作用户既有应用状态。没有实际 UI 使用证据不得宣称 UI 通过。
- 真实模型：须明确模型配置、合成场景和调用上限；不得仅因 Qwen 是编码模型就修改算台配置或开始付费调用。
- 提交/推送/发布：分别取得指令；本计划不授权。

## 2. 基线与状态表

初始静态核对 HEAD `0b7da6f`；交付复核 HEAD 已为 `7ba8761`，初查时其他会话未提交的知识测试现已进入其提交。当前本轮仅有文档增量；这不是允许后续清理工作树的依据。迁移号、测试总数和文件行号只作定位线索，MI00 必须重新查实并保护当时已有改动。不得把历史日志的测试通过数当本卡结果。

| 卡片 | 交付 | 前置 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| MI00 | 基线、原型决策与授权核对 | 无 | done | 2026-09-25 14:43 核对：HEAD `7ba8761`；`apps/desktop/src/main/db/app-schema.ts` 实际最新迁移 **32**（MI04 只能用 33 起）；工作树只有本增量文档与原型（docs/ 6 改 5 新），无并行会话未提交代码；静态问题仍存在——`memory-provenance-reader.ts:11–18` 只匹配 message.completed 不验最终无工具、`:29–32` 只读快照材料，`memory-service.ts:150–164` 手工解析固定 `memoryDependencies: []`，`ContextPanel.tsx` 排除行仍随 selectedItems 重算。审批：D1–D5 方案已批；MI01+ 逐卡开发、真实模型、真实 UI 与提交推送各自仍需指令。 |
| MI01 | Main 手工来源依赖闭环 | MI00；D1 | done | 提交 `cd36d2a`。`memory-provenance.ts` 新增最终无工具回答＋真实空间归属＋依赖闭包校验，`ResolvedMemorySource.memoryDependencies` 由解析结果传入（原 `memory-service.ts:162` 硬编空数组已消除）；缺快照/审计→`SOURCE_REVIEW_REQUIRED`，缺修订/哈希不符/失效同码，循环→`SOURCE_DEPENDENCY_CYCLE`，超限→`SOURCE_DEPENDENCY_LIMIT`，501 码点摘录→`SOURCE_MISMATCH`；checkpoint 与 artifact-version 分支不再允许空依赖降级。协议层拒绝 `sourceSelector` ＋ `asUserInstruction=true`。证据：`memory-provenance.test.ts` 19 例、`work-centered-memory.integration.test.ts` 真实 SQLite 两例（继承等式/幂等重放/非最终事件/缺审计/零写入），后续补强（提交 `8074a97`）：材料侧 200 依赖上限与「摘录区间为空」各补一条负例，确认超额是整条拒绝而不是截断，空区间不会被当成已保留来源。全仓 `npm run verify` 通过 131 文件 1225 测试。 |
| MI02 | 回答原文选择与保留来源保存 | MI01；D1 | doing | 自动化通过，UI 待验。提交 `c3a5348`：`lib/memory-capture.ts`（最终回答判定、UTF-16→码点换算、半代理对拒绝、唯一命中定位）、`components/MemoryCaptureSource.tsx` 只读原文重选、`MemoryEditor` 新增 `requireSource`，未确认选区不能提交且不再静默转 manual；捕获范围过滤掉 user/expert 全局。`App.test.tsx` 新增选区保留来源与不提供全局两例，`memory-capture.test.ts` 8 例含非 BMP 与重复片段；`MemoryEditor.test.tsx` 把「未确认选区」的错误落点钉在 `.inline-message.error` 槽，并断言不存在非错误态内联消息（`1a530b3`）。 |
| MI03 | 持久化排除列表与恢复 | MI00；D2；建议在 MI02 后 | doing | 自动化通过，UI 待验。提交 `f914bcc`：新只读通道 `memory:task-exclusions`（不要求 prompt）＋ `TaskMemoryExclusionItem` strict 联合，越范围/不存在统一 `unavailable` 占位；`MemoryRecallService.taskExclusions` 直接投影 TaskContext 顺序、去重、上限 100（`MEMORY_TASK_EXCLUSION_MAX` 与 TaskContext/保存 Schema 共用），写入仍走 `SaveTaskContextRequest`＋CAS，未新建排除表。证据：`task-memory-exclusions.test.ts` 真实 SQLite 4 例（含不泄露他空间正文、修订冲突回 `REVISION_CONFLICT`＋当前修订号）、`ContextPanel.test.tsx` 独立清单在预览失败时仍可恢复；`use-task-memory-exclusions.test.ts` 4 例钉住钩子行为（不要求 prompt、上下文未建立时不请求也不报错、切任务后迟到响应被丢弃、读取失败可重试且与预览错误互不牵连）；面板层再补读取失败落点用例——错误留在「本任务已排除」原位并带重试、已读到的条目不被清掉、该小节无非错误态内联消息（`1a530b3`）。 |
| MI04 | recallPolicy 字段与真实迁移 | MI-M0；D3 | done | 提交 `dd7bb58`。迁移 **v33** 给 `memory_records` 补 `recall_policy TEXT NOT NULL DEFAULT 'relevant' CHECK IN ('relevant','pinned')`；仓储读写映射、追加修订与治理动作均原样携带策略（不被默认值清掉），新建与自动候选固定 relevant。证据：`migrate.test.ts` v33 用例（旧库两次迁移幂等、身份/正文哈希/状态/来源逐行不变、非法枚举被 CHECK 拒、`foreign_key_check` 为空）、`memory-repository.test.ts` 用真实文件库把历史行 forge 成 pinned 后编辑与 expire 仍保留策略、协议枚举用例。另核对回执的持久化形状：`memory_operations.result_json` 只写 `effect`、`committedRevisionIds` 等身份，不内嵌 `MemoryRecord`，所以旧回执读取不需要补策略字段的兼容分支（AC3 的读取适配在此为空，重放用例已覆盖）。全仓 verify 通过。 |
| MI05 | 优先策略写入与 v2 召回/历史兼容 | MI04 | done | 自动化通过（真实 ModelRequest 断言已在 MI09 落齐）。协议新增 `memory-recall-v2`/algorithmVersion=2、`MEMORY_RECALL_PINNED_ITEM_LIMIT=6`、`MEMORY_RECALL_PINNED_CODE_POINT_BUDGET=2000`、冻结 v1 快照 Schema＋严格 v2 Schema、`pinned-rule` 选择理由，并在 `runMemoryContextSchema` 拒绝「版本与快照不一致」和「v1 快照里出现 pinned-rule」。`MemoryService.update` 落资格门禁：仅已确认、当前生效、用户口径、零材料/零记忆依赖且非事实/经验可 pinned，否则 `INVALID_TRANSITION`；已 pinned 记录被编辑成不合格形状时要求先取消优先。`applyRecallBudgetV2` 按优先池→偏好池→相关池分配，keep-both 分量整体进出、优先组排序不用 updatedAt 偏袒，新 Run 写 v2。证据：`memory-recall-v2.test.ts` 9 例（零词面命中仍入选且 score 如实为 0、6/7 条与 2,000/2,001 码点边界、三分量整组进整组出、排除项不能穿透、真实 SQLite preview 快照为 v2）。资格补口（`d8c0bd8`）：五条拒绝原因逐条有用例，并修出实现缺陷——写入门禁原先只看 `deriveEffectiveStatus`，未到 `validFrom` 的规则也能设优先，而召回按 `isMemoryEffectiveAt` 判定不会带入；现两侧口径一致，回归用例先失败后通过。 |
| MI06 | 优先规则管理与原因展示 | MI05；D3 | doing | 自动化通过，UI 待验。记忆列表按记录显示「按相关性选择 / 优先带入」徽标，已确认且非终态的记录给「设为优先带入 / 取消优先带入」开关，走既有 `memory:update`＋新 operationId 与 expectedRevision，不新建页面、开关或全局配额；不合格原因（如事实类）由 Main 的 `INVALID_TRANSITION` 文案直接内联显示，前端不另写一套判定。说明文案明确「只免词面门槛、不免范围/有效期/排除/来源/冲突门禁、只影响下次运行、不表示模型一定采用」。证据：`MemoryView.test.tsx` 新增 4 例（提交形状与幂等键、pinned 取消、错误内联、终态不给开关）。 |
| MI07 | 冲突来源与并存条件可回看 | MI-M0；D4 | doing | 自动化通过，UI 待验。冲突 DTO 改为按 state 判别：`keep-both` 必带 `applicabilityNote`（1–300），`unresolved`/`replaced` 严格不带该字段，缺条件的旧并存裁决降级显示为未裁决而不是补空串（仓储映射见 `memory-operation-repository.ts:328`）。记忆视图并列两侧正文、适用范围与有效期，并在同一位置回显并存适用条件。证据：`packages/agent-protocol/src/index.test.ts` DTO 分支用例、`memory-operation-repository.test.ts` 裁决回传、`memory-service.test.ts` 真实 SQLite 回看。补齐：`use-memories.loadRevision` 复用既有 `memory:get(id,revisionId)`，冲突卡「查看两侧来源」按 pair 的精确修订分别读取，只回显来源类型/修订/依赖计数/摘录前 60 码点，不显示原始事件载荷；另一侧不在当前列表时不发起读取、只显示占位，异步经 `trackAction` 收口。仍未做：UI 人工走查。 |
| MI08 | 换期恢复引导与来源专家修正 | MI-M0；D5 | doing | 自动化通过，UI 待验。新增只读通道 `artifact:get-version-executor`（strict 请求 `{artifactId,artifactVersionId}`，响应 `ArtifactVersionExecutorSummary｜null`，general/expert/unavailable 三分支互斥）＋ `resolveArtifactVersionExecutor`：从该精确版本的来源 Run 快照取身份，user-edit 沿同成果前版回溯，断链/循环/缺快照一律 unavailable 且绝不改取 latest；版本不属于所给成果返回 null。`App.tsx` 的「从此版本开始新任务」不再读旧 Task 当前 executor，也不复制来源任务的技能/模型绑定；专家修订已更新时明确提示按当前配置使用，不可用时按原因提示并回退通用助手。证据：`artifact-version-executor.test.ts` 真实 SQLite 3 例（含回溯、缺快照、停用专家、跨成果不泄露）、`App.test.tsx` 两条更新为快照来源断言。补齐（`f79eb6e`）：「历史上下文调整」在解释截断原因后给出三个可返回入口——选择本期材料、查看上期成果版本、到记忆详情保留方法，并写明「引用只固定所选版本、标记参考不等于已读取、不自动摘要旧回答」；界面不提供也不文案化「恢复全部历史」。`ContextPanel.test.tsx` 断言入口存在、跳转参数正确且无恢复全部历史按钮。另按 AC4/AC5 补守卫：来源身份读取失败改为「保留原任务＋一次可重试错误」，重复点击时旧响应作废不覆盖后一次结果（`App.test.tsx` 2 例）。剩余仅人工走查。补口（`8074a97`）：真实 general 运行快照的来源身份断言为 `general`＋精确 sourceRunId，不再与 `unavailable` 混淆（AC5）。 |
| MI09 | 离线联合回归与效果验收数据集 | MI01–MI08 | doing | 已跑通并计入本卡：Q1–Q8 八种无词面问法 8/8 经真实 RunService＋可注入 Provider 的实际 ModelRequest 带入目标规则、审计里 reason=pinned-rule、score=0、recallVersion=memory-recall-v2；R3（user pinned 无需历史）、R6（一条 pinned＋两条并存整组带入且附适用条件）、R7（改新修订后只注入最新修订，旧 Run 审计的 revisionId 不变）；N1（排除父规则后派生记忆与注入段都不回流）、N2（父记忆删除后派生记忆不注入且**不擦除**依赖登记）、N3（过期优先规则不注入）、N7（未裁决冲突两侧都不注入，不按时间或置信度挑胜者）；AC3 重启重开库后旧 v1 快照原样解析、不回填新字段。同目录另复用 MI01/MI03/MI05 的真实 SQLite 用例覆盖 R5、N6、N8 与 N4 的越范围不泄露。本轮再补：R2/R4（专家与专家工作空间优先按范围带入）、N4（他空间优先规则既不入请求，也只能以 `unavailable` 占位出现在排除投影里，不暴露正文）、N5（派生记忆依赖的材料换版本后 `dependency-unavailable` 拒绝进入请求，且源文件仍只读、内容未被改写）。AC4 变异验证两次并已精确还原（`git status` 仅本卡测试文件变更）：① 把 MI01 的缺审计拒绝改成 `?? 空依赖` → MI01 集成用例失败；② 关掉 MI05 的 pinned 资格门禁 → `memory-recall-v2.test.ts` 的资格用例失败。另按契约 §11 逐条回扫「条款要求 vs 测试锚点」，补出七处原先无断言的条款（`8074a97`：v1/v2 快照与 recallVersion 必须同侧、v1 上下文里伪造 `pinned-rule` 拒绝、v2 缺优先预算字段、预算字面量与任务排除上限 100、材料 200 依赖上限与空摘录区间、来源执行身份 `general` 分支、替代不继承败者 pinned／改写正文不缩减已登记依赖；`d8c0bd8`：未到生效期不得设优先，并修出该实现缺陷）。剩余：MI01–MI08 的人工 UI 记录（走 §6.1 清单），故本卡保持 doing。证据：`npm run verify` 退出 0，136 文件 / 1296 测试。本卡完成不代表真实模型语义通过。 |
| MI10 | 人工 UI 与真实模型语义验收 | MI09；独立真实模型授权 | blocked | 前置未满足，未开工：人工走查已整理为 [MI 人工验收清单](memory-mi10-checklist.md)（§1–§7 对应本计划 §6.1 八条路径与 MI02/MI03/MI06/MI07/MI08 的 UI 门槛，由光哥在真实窗口逐格记录）；§8 六个成对场景需光哥书面给出模型配置显示名与整数调用预算（下限 14、建议上限 18）后才是可执行状态。当前自动提炼开关与作业状态未经光哥确认，Qoder 不擅自改设置或开始调用。 |

状态仅 todo/doing/blocked/done。代码完成但必需 UI 验收未测时标 doing，证据写「自动化通过，UI 待验」。测试失败、数据不可证明或迁移冲突写 blocked/doing 与具体原因，不写 done。若只批准 MI-M0，后续卡保持 todo，不为赶下午目标跳过门槛。

## 3. 每卡统一执行约束

**必读**：AGENTS.md、docs/12-engineering-standards.md 对应小节、Spec 对应 F 段、本契约 §11 对应小节、本卡。缺陷现场按 GATE-0 先只读 SQLite 与开发日志，再分析代码；没有复现数据可用真实 SQLite 合成回归证明，不把推断称现场复现。

**固定节奏**：

1. `date`、`git status --short`、HEAD；核对前置状态和授权。只为本卡列出预期文件；已有同名实现先阅读，不能另建平行系统。
2. 先补会在旧行为失败的回归用例，记录失败点；再实现最小闭环。协议修改同卡完成 Schema/生产消费/测试，禁止空 channel、零生产者 DTO 或孤儿阈值。
3. 运行 `npm test -- <本卡测试路径>`、`npm run typecheck`；完成后运行一次 `npm run verify`，保留真实退出码，不接截尾管道；`git diff --check`。只读/文档卡不跑构建。
4. UI 卡启动应用并交付人工操作清单，实际使用后记录结果；若环境不具备则写未验，不以组件测试替代。
5. 核对 diff 仅本卡范围；中文编辑用 Grep 回读，避免全仓 format 改到并行文件；更新本卡证据与当日日志。不提交推送。

**共同不变量**：真实 SQLite，不 mock 仓储；HTTP 注入且自动测试不触网；源文件只读；Main 校验身份/范围；Application 先持久化再广播；当前 Run 固定快照；TaskContext 保存保留所有非目标字段；错误/超时不会暗换模型或把已提交写入报失败。

**立即停止并报告**：已有用户修改与本卡目标冲突；要关门禁/降类型严格度/改权限；契约必须突破；旧数据无法满足当前完整性且没有已定义拒绝路径；需要真实模型/私有资料/发布而未获授权。命名、局部拆分与常规测试修复无需再问。

## 4. 任务卡

### MI00：基线和开工检查（不编码）

- 输入：本计划、原型 D1–D5、当前 Git 与现有 WM 证据。
- 输出：在本卡证据栏记 HEAD、真实最新迁移号、当前测试脚本、已有改动归属、哪些 D 已批准、哪些模型/UI/提交动作未授权。
- 核对路径：`App.tsx` 回答捕获、`MemoryEditor.tsx`、`memory-provenance-reader.ts`、`memory-service.ts`、`ContextPanel.tsx`、`use-run-memories.ts`；确认本 Spec 的静态问题是否仍存在，已修则查回归证据而非重复实现。
- 不做：修改生产代码、先接受 ADR、调用模型、改 WM16 状态。
- AC：Given 新会话，When 核查 HEAD，Then 不使用文档旧迁移号覆盖当前库；Given 已有未跟踪测试，When 定义范围，Then 保留且不纳入本增量；Given D1–D5 已批准但后续卡未授权，When 排顺序，Then 只给出前置条件，不自动开始后续卡。
- 完成门槛：基线可追溯，下一卡无未定义的产品选择。D1–D5 的既有批准事实见 §1.1；核对时仍须区分设计批准与单卡实施授权。

### MI01：Main 来源完整性（P0）

- 输入：契约 §11.1、既有 §5.3；先核对 shared SourceRef 的摘录上限和实际 Run/Event 结构。
- 预期修改：`packages/agent-protocol/src/index.ts` 与 `.test.ts`（请求互斥校验）；Main `services/memory-provenance.ts`、`memory-provenance-reader.ts`、`memory-service.ts` 及同目录测试；必要时对现有材料/依赖读取方法作最小查询增补。不得改自动提炼算法或新建证据存储。
- 实现：补最终非工具事件身份与归属校验；Main 生成摘录/hash；ResolvedMemorySource 传递真实 memoryDependencies；完整依赖并集、递归展开、循环和超额拒绝；checkpoint/Artifact 共用入口无法证明时安全拒绝，禁止空依赖降级。
- 复用依据：`runMemoryContexts.get/listDependencyUnion` 区分无记录和合法空依赖；`RunContextSnapshot`、材料读取足迹、现有记忆展开。不得直接照抄 extraction-source-reader 的空值回退。
- 不做：重构整个提炼服务、放宽来源门禁、猜修历史 manual、预占迁移。
- AC1：Given 完整 Run 来源含材料与被重放记忆，When 普通创建，Then 保存 derived、精确 eventId/hash 和全部去重依赖。
- AC2：Given 非最终/工具轮/非 completed/跨 Run/跨空间事件，When 提交，Then 拒绝且零修订零回执。
- AC3：Given 无审计记录、循环、超限或缺依赖修订，When 保存，Then 明确失败；Given 真实完整快照且两数组均空，Then 可保存，不误判缺证据。
- AC4：Given 501 码点摘录或半代理对，When 解析，Then SOURCE_MISMATCH；500 码点合法，不依靠输出 Zod 兜底。
- AC5：Given checkpoint/AI Artifact/user-edit 版本来源，When 共用解析器保存，Then 可证明则完整继承，缺链拒绝；不伪造“人工版本无依赖”。
- AC6：Given 原样重复 operationId，When 重试，Then 一次提交；同 ID 换正文失败；投影失败仍回已提交成功警告。
- 定向验证：provenance、memory-service、协议测试；为真实库追加 `work-centered-memory.integration.test.ts` 来源修订与撤销用例。只有测试 fixture 而无完整生产依赖读取，不算通过。

### MI02：回答捕获 UI（P0）

- 输入：F1、D1 原型；前置 MI01 安全门禁完成。
- 预期修改：Renderer `App.tsx`、`components/MemoryEditor.tsx`、`hooks/use-memories.ts` 及相关测试；选区纯函数放 `lib/`（先找是否已有），必要时独立领域呈现组件，不把 Node/IPC 放视图。
- 实现：从当前 Run 事件确定真实最终 eventId；捕获表单持有来源 selector 和编辑正文；唯一匹配预填、原文 textarea 重选、code point 区间、选择不合法阻止提交；保留来源文案与空间范围；普通表单不能转成空依赖，重述跳到已有详情路径。
- 不做：新建富文本编辑器、全页选区当来源、默认截回答前 500 字、自动提炼、改流式渲染。
- AC1：Given 回答含 Markdown 与非 BMP 汉字，When 原文选择再编辑正文保存，Then selector 与原始事件精确对应、asUserInstruction=false，数据库依赖完整。
- AC2：Given 重复片段/跨节点或别处选区/无选区，When 打开捕获，Then 引导原文重选，不能提交或静默 manual。
- AC3：Given 请求失败或来源变失效，When 保存，Then 保留草稿显示错误；未提交取消不写库；切任务迟到结果不覆盖新表单。
- AC4：Given 独立手工输入或已有自主重述，When 操作原入口，Then 仍可用且不被本卡误禁。
- UI 走查：普通捕获、原文重选、关闭、失败重试、中文/非 BMP、窄屏、键盘 Tab/Enter/Esc。实际操作结果记本卡；只跑 jsdom 不算 UI 完成。

### MI03：排除列表与恢复（P0）

- 输入：F2、契约 §11.2；本卡是 protocol→Main→preload→hook→UI 垂直切片。
- 预期修改：协议与测试；`services/memory-recall-service.ts`；`ipc/register-ipc.ts`；`preload/index.ts`；Renderer `hooks/use-run-memories.ts`、`components/ContextPanel.tsx` 及测试。
- 实现：新增真实 `memory:task-exclusions`，从 TaskContext 返回完整范围投影；独立列表状态；恢复只从排除 ID 集合移除；保留 SaveTaskContextRequest 全部绑定字段；请求序号保护与 CAS 冲突恢复。
- 不做：从全局 memory:list 补正文、扩大任务权限、新增排除表、清空全部 TaskContext、依赖非空 prompt 或预览成功。
- AC1：Given 本任务排除一条，When 重算/换 prompt/重开面板/重启，Then 仍可在独立列表恢复，且不改变其他任务。
- AC2：Given 恢复但无词面/来源失效，When 重算，Then 不保证入选且原因可见；恢复不是重新确认记忆。
- AC3：Given 100 个排除 ID，含越范围/不存在/过期项，When 查询，Then 不受 50 项摘要限制，不泄露越范围正文；不可查看项可移除此排除。
- AC4：Given 另窗口已改材料/模型，When 提交过期上下文，Then 冲突不覆盖；刷新后目标操作保留其他字段；双击和传输失败不出现 toggle 反转。
- AC5：Given prompt 为空或 preview IPC 失败，When 打开已排除，Then 列表仍可加载；切 Task 的旧响应丢弃。
- UI 门槛：完成「排除→重算→重启→恢复→仍不相关」与「只显示不可查看占位」两条人工路径后，MI-M0 才通过。

### MI04：策略字段与迁移（P1）

- 输入：契约 §11.3，D3 已批准；MI-M0 完成。
- 预期修改：协议 MemoryRecord 与测试、`main/db/app-schema.ts`、`main/db/migrate.test.ts`、`persistence/memory-repository.ts`、`memory-operation-repository.ts` 与相关测试、现有记忆写入/投影映射。
- 实现：新增 recall_policy；所有新建与旧记录默认 relevant；追加修订继承字段；旧回执读取适配，不改原 operationId/hash；自动候选拒绝任意模型自报策略。
- 本卡不开放 pinned update 或新增未消费预算常量；公共可设置策略与召回同在 MI05 落地，UI 在 MI06。
- AC1：Given 升级前历史库，When 迁移两次，Then 旧身份、修订、正文哈希、来源/状态不变且全 relevant。
- AC2：Given 故障注入或非法枚举，When 迁移/写入，Then 原子回滚、版本戳不前进、外键完整。
- AC3：Given 旧 JSON 回执，When 原样 operationId 重放，Then 可读且不新建修订；新请求不同内容仍冲突。
- AC4：Given relevant 记录正常编辑/删除/确认，When 写下一修订，Then 策略不丢，旧行为与候选规则不变。
- 门槛：真实库升级与旧回执用例，不做用户数据库手工 ALTER；不单独声明产品特性完成。

### MI05：v2 实际召回与历史兼容（P1）

- 输入：契约 §11.3–§11.4；先读 v1 literal Schema 和现有 keep-both 预算算法。
- 预期修改：协议与测试；`memory-service.ts`、`memory-retrieval.ts`、`memory-recall-service.ts`、`memory-dispatch-gate.ts`（仅必要类型/快照校验）、`run-memory-context-repository.ts` 与相关测试。Agent Core 不加数据库依赖。
- 实现：同卡开放 update.patch.recallPolicy 的资格校验与原子修订；优先池→偏好池→相关池；稳定组序、组原子性、包装先算、真实分数；生产新 Run 写 v2，旧 v1 快照原样读。
- 不做：向量召回、把新 literal 覆盖所有历史解析、修改旧数据的 recallVersion、追加来源权限、无关 provider 重构。
- AC1：Given 满足资格的 pinned 且 query 零匹配，When preview 与真实 Run，Then 均入选且 reason=pinned-rule；独立 relevant 记录在不属于通用偏好池、也不属于 pinned 并存组且零匹配时不入选，不否定这两种合法免词面路径。
- AC2：Given 过期/排除/来源失效/跨空间/未裁决冲突，When pinned 召回，Then 均不能穿透；设置不合格策略在写入时即拒绝。
- AC3：Given 6/7 条、2,000/2,001 码点、总预算边界，When 分配，Then 完整计数、无法容纳项有 budget 原因、不截断，后续短组仍可入选。
- AC4：Given A–B、B–C 并存分量，仅 A pinned，When 预算只够部分，Then 整组不入选；足够则三条和全部条件同带、不重复占偏好池。
- AC5：Given 历史 v1 与新 v2 混合数据库，When 重启/回看/重放，Then v1 原样可读，新策略字段不强塞历史；版本与快照不匹配或 v1 内出现 pinned reason 被拒绝。
- AC6：Given 记忆 revision 在异步准备中变化，When 写快照，Then 上下文冲突而非发送旧数据；审计失败零 Provider 请求；已活跃 Run 的快照不被策略更新改写。
- 门槛：实际 ModelRequest 断言，不能只断言 rank 函数或 selectedItems；旧 request-prepared/dispatch-attempted 与空记忆块用例继续通过。

### MI06：策略管理 UI（P1）

- 输入：F3、原型 D3；MI05 完成。
- 预期修改：`views/MemoryView.tsx`、`components/MemoryEditor.tsx`、`components/ContextPanel.tsx`、相关 hooks/lib 标签/测试；复用现有详情与设置布局，无新导航。
- 实现：详情「按相关性选择/优先带入」、不合格原因、修订变化影响下次运行的说明；预览展示 pinned-rule 与预算/冲突原因；不制造“模型已阅读”文案。
- AC1：Given 已确认自主 constraint，When 设优先并用同义 prompt 预览，Then 状态与真实选择一致；取消优先后恢复按相关性。
- AC2：Given derived/legacy/candidate/事实或经验，When 查看详情，Then 不能设优先且原因明确；不能借编辑 facet 绕过 Main 来源校验。
- AC3：Given CAS 冲突/投影失败，When 保存，Then 分别显示重试错误/已提交警告，不能错报保存失败或产生双修订。
- UI 门槛：范围切换、预算不足、策略取消、窄屏/键盘路径；运行时调整明确影响下次，不篡改本次记录。

### MI07：冲突可解释性（P1）

- 输入：F4、契约 §11.5，D4。
- 预期修改：协议 conflicts DTO、`memory-operation-repository.ts` 的裁决查询投影、`memory-service.ts`、`MemoryView.tsx`、`use-memories.ts` 与对应测试；来源详情复用 memory:get，不建新裁决表。
- 实现：两侧来源/范围/有效期可展开、明确“潜在”；keep-both note 回传并可重开；旧操作回执刷新视图不缺条件。
- AC1：Given 同 topicKey 的互补规则，When 展示，Then 只称可能冲突；填写条件后可并存，刷新/重启后条件仍显示。
- AC2：Given 空条件或超过上限，When 保存，Then 拒绝；变更任一修订后旧裁决失效，不套旧条件。
- AC3：Given 另一侧不可查看或查询失败，When 打开卡片，Then 不泄露正文/来源，不替用户裁决；保存并发冲突无部分替代。
- UI 门槛：展开两侧来源→填写条件→保存→重开；确认既有 replace、候选重复提示无回归。保持冲突算法不变。

### MI08：连续工作恢复（P1）

- 输入：F5、契约 §11.5、docs/10 §6.1.2；D5。
- 预期修改：协议与测试、Main 现有 Artifact 读取服务/IPC 装配、`preload/index.ts`、`ContextPanel.tsx` 与 App/hook 导航及相关测试。查询复用 `artifact-repository.ts` 的 `getVersionSourceRunId/getPreviousVersionId` 和 `run-context-snapshot-repository.ts:get`；当前没有来源执行器 DTO，须同卡补齐只读通道至真实 UI 消费，不让 Renderer 猜来源。
- 实现：`artifact:get-version-executor` 的严格三分支 DTO 和版本归属核验；历史截断原因→本次材料/精确成果/记忆详情的可返回入口；原任务草稿保留。只在既有版本开始任务路径读取来源 Run，不重构专家系统，不复制旧权限或原 Task 最新绑定。
- AC1：Given 材料换新版导致历史截断，When 查看原因与材料入口，Then 历史仍可读但不重放，不自动重新加旧材料。
- AC2：Given 精确成果 v1 与当前 latest v2，When 引用/新任务，Then 保持用户选定 v1 和既有用途；实际读取才产生读取关系。
- AC3：Given 来源 Run 专家 A、原 Task 已换成 B，When 从来源成果建任务，Then 默认身份来自 A 快照；A 当前修订不同先确认当前版，A 不可用/快照缺失时显式选择，不暗用 B，也不继承 B 的 Skill/MCP/模型。
- AC4：Given 用户取消选择或返回原任务，When 恢复界面，Then prompt、专家、材料/能力绑定未丢；无新增 Run 或网络调用。
- AC5：Given user-edit 前版链、缺快照、伪造版本归属或查询失败，When 读取执行器，Then 分别正确回溯、unavailable、null、可重试错误；真实 general 与未知来源不能混淆。选择期间专家发生变化则重选，迟到响应不覆盖当前任务。
- UI 门槛：换期材料、打开参考版本、返回、专家缺失四条可操作路径，补来源专家当前版确认。不得通过削弱 run-history-policy 来让测试通过。

### MI09：离线联合回归（P0 验收）

- 输入：MI01–MI08 自动化与 UI 证据；本计划 §5。
- 预期修改：优先扩展 `services/work-centered-memory.integration.test.ts` 及相关同目录测试；必要时新增同目录命名的集成测试。合成材料只用匿名虚构内容；不导入真实用户数据库。
- 实现：真实 SQLite，真实 service/repository/IPC 组合与可注入 provider；记录实际 ModelRequest，重启重新开库；分别跑 Q1–Q8 问法、R1–R8 技术正例与 N1–N8 负例，三组分母独立。必要的来源事件/父对象由公开正常 API 建立，不伪造外键 ID 或在测试中跳过来源门禁。
- AC1：Given Q1–Q8 八个无词面命中查询，When 用生产准备/发送链路，Then 8/8 实际请求含目标规则且分数为 0；另行记录 R1–R8 的来源、分组和连续性结果，不拿技术正例充当八种问法。
- AC2：Given 八个撤销/隔离负例，When 新 Run，Then 8/8 禁止项既不直接注入也不由历史/派生记忆回流。
- AC3：Given 崩溃重启/旧 v1 回看/传输重试/投影失败，When 复测，Then 状态可解释、无重复写、无伪造审计或源文件变更。
- AC4：Given 移除来源或任务排除的关键门禁，When 临时变异只运行目标测试，Then 对应用例必须失败；还原仅自己的变异，不用 reset 覆盖其他改动。记录变异点与测试证据，不提交变异。
- 门槛：`npm run verify` 实际退出 0，列本次文件/用例数；新场景可复现，不能只引用旧 WM 的通过日志。本卡完成不代表真实模型语义通过。

### MI10：真实 UI 与工作效果（P0 验收）

- 前置：MI09；专用合成工作空间自动提炼已关闭，且无排队/运行中的提炼作业；光哥明确批准模型配置与调用预算。任何前置不满足则 blocked，不擅自修改开关、取消已有作业或开始调用。
- 不改业务实现或调模型默认值；若发现缺陷，回对应卡补回归后重测，不当场弱化 AC。
- UI：执行本计划 §6.1，全链路经过实际窗口；代码质量门与截图/人工结果分开保存。
- 语义：§6.2 六个成对场景使用相同模型配置与固定任务输入；每对独立上下文，S5 在各自已建立审计历史的原 Task 续跑。工具回合合并时至少 14 次真实模型请求；建议授权上限 18 次而非保证足够，逐场景下限见 §6.2。工具循环、重试及意外后台请求均计数，到额即停；发现后台提炼启动也立即停止并记录污染，不自行补测。无需工具的场景关闭工具；历史 fixture 只在隔离测试库通过生产服务及可注入 Provider 建立，不花真实模型生成、不伪造读取事实。
- AC1：Given 八条 UI 路径，When 人工操作，Then 每条结果有实际记录，失败/未测不算通过。
- AC2：Given 六个成对场景，When 比较基线与改进，Then 改进至少 5/6 达成规则且撤销/隔离两项全通过，列原始结果与重复纠正次数，不编造“用户满意”。
- AC3：Given 未带入和已带入但未遵从两种失败，When 归因，Then 分别记录装配问题与语义问题，不把 dispatch-attempted 当模型已读。
- 完成：光哥确认人工结果；MI10 状态更新不自动关闭 WM16、E55 或 KM15，也不自动允许提交/发布。

## 5. 离线固定验收矩阵

每条包含 Given、When、Then；正例应在预先满足合法依赖与预算的条件下测试，不能把规则原文塞进 query 来证明「同义召回」。

### 5.0 八个无词面问法（Q1–Q8，独立 8/8）

Given：每个隔离 Task 的唯一目标规则为 workspace、confirmed、verified/user-instruction、空依赖的 pinned constraint「金额按万元保留两位」，有效且未排除、无冲突、预算充足；无历史，材料标题不补查询关键词。When：分别通过生产准备/发送链路使用下表 prompt。Then：每次目标词面分数断言为 0，preview 与实际 ModelRequest 均完整携带目标规则，reason=pinned-rule。零分前提不成立属于 fixture 错误，须先查分词规则，不允许删掉零分断言凑通过。

| ID | prompt |
| --- | --- |
| Q1 | 做份经营回顾 |
| Q2 | 请整理本季简报 |
| Q3 | 准备董事会汇报提纲 |
| Q4 | 输出经营分析 |
| Q5 | 撰写本期摘要 |
| Q6 | 做一版管理层汇报 |
| Q7 | 整理财务概览 |
| Q8 | 请汇总近期业务表现 |

### 5.1 八个技术正例（R1–R8，独立 8/8）

| ID | Given | When | Then |
| --- | --- | --- | --- |
| R1 | workspace pinned constraint「金额按万元保留两位」 | prompt「做份经营回顾」，材料标题无该规则词 | 实际请求带规则，词面分数如实为 0 或真实值 |
| R2 | expert-workspace pinned method「结论、证据、建议依次输出」 | prompt「请整理下一场管理层沟通稿」 | 当前专家与空间匹配则带入 |
| R3 | user pinned preference「给出表格后附限制说明」 | 新 Task，无历史 | 无需旧聊天即可入选 |
| R4 | expert pinned method，当前专家匹配 | prompt 只写「继续处理这件事」 | 即使检索语义弱仍经优先池出现 |
| R5 | 原文含非 BMP 汉字和重复句 | 指定第二处原文区间保存 | eventId、区间、摘录/hash 和依赖一致 |
| R6 | 一个 pinned 与两个 relevant 有并存连通关系 | 预算充足且均合法 | 整组三条与两份条件完整带入，无重复 |
| R7 | 用户将金额规则改为新修订并明确再次设优先 | 新 Task 使用新输入 | 只注入最新修订；旧 Run 回看不变 |
| R8 | 本期新材料＋明确选定旧成果结构参考＋自主方法 | 建新 Task 后运行 | 方法与精确引用合法，旧期间数字不是默认事实 |

### 5.2 八个负例（8/8）

| ID | Given | When | Then |
| --- | --- | --- | --- |
| N1 | 当前 Task 排除 pinned A，B 派生于 A | 新 Run | A/B 及继承它们的历史均不得回流 |
| N2 | A 删除/替代/改修订 | 使用 A 的旧回答/派生记忆再准备 | 依赖不再有效，拒绝/排除而不擦依赖 |
| N3 | pinned 过期或未生效 | 同义 prompt | 不注入 |
| N4 | expert-workspace 只在另一空间/专家适用 | 当前 Task 查询与恢复列表 | 不注入、不泄露正文；仅已有排除 ID 可占位 |
| N5 | 派生记忆依赖材料旧版本 | 移除或换新版本 | 派生记忆/相关历史不进入请求，源文件不修改 |
| N6 | 旧来源缺完整审计、非最终事件或伪造区间 | 捕获保存 | 零修订、可解释拒绝；不降 manual |
| N7 | pinned 与另一规则未裁决冲突 | 预览/运行 | 相关冲突规则不注入，不按时间/置信度挑胜者 |
| N8 | 优先条数/正文/包装不足，且含并存组 | 准备请求 | 组原子落选、有 budget 原因，不能从别的池绕上限 |

## 6. 人工与真实模型验证

人工走查项已按「操作 → 该看到什么 → 结果记录」逐格整理为 [MI 人工验收清单](memory-mi10-checklist.md)；走查结果写进那份清单，状态仍以本板为准，两者不互相代签。

### 6.1 实际窗口八条路径

1. 回答原文选段→改写记忆正文→保存→详情查看来源与完整依赖。
2. 选中别的区域/重复片段→原文重选→取消；确认没有误记。
3. 排除→重算→关面板→重启→恢复；确认其他绑定原样。
4. 空 prompt、预览失败下查看排除列表；不可查看项不出现正文。
5. 自主规则设优先→同义 prompt→看下次与本次记录；取消优先可撤回。
6. 潜在冲突→展开双方来源→填共存条件→重开；编辑任一方后需重新裁决。
7. 换期选材→看到历史未发送原因→精确成果引用→返回原任务草稿仍在。
8. 运行中改策略→明确下次生效→取消当前 Run 并重跑；旧审计不改写。

同轮检查浅/深色、窄窗口、键盘焦点、Esc 返回和错误反馈；不重做全站视觉验收。

### 6.2 六个成对业务场景

S1–S4 的基线是**同版本实现下的本任务排除目标记忆**，不是回滚源码或使用不同模型；每对两个独立 Task，材料/专家/模型/输入相同且无额外历史。S5/S6 是两侧均须安全的控制场景，不为展示增益主动发送越权内容，也不将它们的差值解释成收益。

S5 专门验证同 Task 历史：两侧先各自建立等价、有完整审计的旧 Run（使用规则 A）和派生记忆 B（依赖 A），再只排除 A，在各自原 Task 续跑。准备轮用可注入 Provider 经真实服务写入隔离测试库，标明 fixture 来源；必须先证明准备前 A、B 与历史均可用，再验证撤销后的直接注入、派生、历史三条路径均不回流。不能改用一个没有历史的新 Task，也不能手工伪造 request-prepared/dispatch-attempted。

| 场景 | 提问与检查规则 | 结果评分 | 每侧真实请求下限 |
| --- | --- | --- | --- |
| S1 同义约束 | 已确认金额按万元两位；不在 prompt 重复口径，固定合成经营数据随输入提供 | 单位、精度正确且没有旧单位 | 1，工具关闭 |
| S2 专家方法 | 已确认结论→证据→建议；换用管理层问法 | 三部分齐全、不是机械复制记忆 | 1，工具关闭 |
| S3 纠正复用 | 旧规则已替代，新规则指定同比而非环比；两侧同一组合成数字随输入提供 | 不再重复旧口径；记录需要再纠正几次 | 1，工具关闭 |
| S4 连续两期 | 固定上期合成成果作结构参考，选择本期确定性资料；两者必须通过已有工具实际读取 | 继承结构/方法，不把上期数值当本期，不声称未读材料已读 | 至少 2；首轮读取两项，后续生成；分开读取会更多 |
| S5 撤销不回流 | 按上方准备历史，只排除 A 后在原 Task 明确当前口径并续跑 | 请求不含 A、B 和污染历史，输出不回流；记录截断原因 | 1，准备轮零真实模型调用 |
| S6 跨空间隔离 | A 空间有专用口径，B 空间相似问题；两侧均在各自 B 空间执行 | 请求不含 A 内容，输出不凭空当 B 事实 | 1，工具关闭 |

下限合计 `2×(1+1+1+2+1+1)=14`；建议申请 18 次以容纳 S4 分开读取，不是自动重试授权或完成保证。每次真实 Provider 请求发出前核对剩余额度；重试、工具后续及意外后台请求都计数。专用空间自动提炼必须关闭且无活动作业；不满足先停，不自行更改用户设置。fixture 的零真实调用不能计入语义结果，也不能替代 S4 实际读取。

每项 0/1；改进后 ≥5/6 且 S5/S6 必须为 1。记录基线得分、改进得分、差值与实际调用上限；这只是小样本验收，不是统计结论。若基线本就通过，则如实写没有观察到增益；未完成的场景记未测，不冒充 0 分或通过。

### 6.3 证据记录格式

追加当日日志或经用户要求建立的验收文件：场景 ID、HEAD、模型展示名/非敏感配置指纹、Run ID、上下文修订、入选与排除身份、请求阶段、预期/实际、0/1、重复纠正次数、人工确认、实际请求数、失败归因。模型原文只用合成数据且按需留摘录，不保存密钥、完整请求或公司材料。

## 7. 交接模板

```text
MIxx：doing/blocked/done
本卡授权与范围：
实际修改文件与行为：
回归先失败的证据、修复后命令/退出码：
UI 实际动作与结果（未测必须写未测）：
真实模型调用次数（默认 0）：
已知限制与未完成项：
任务板/日志位置：
下一卡与前置：
未提交、未推送；既有改动保留情况：
```

不要把“实现完毕＋测试通过”合并成业务效果结论。若卡片必须的 UI 或真实模型尚缺，保留 doing/blocked；文档原型评审不能代替应用验收。
