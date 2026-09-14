# ClawBible Desktop 专家定义调研

- 日期：2026-09-13。
- 状态：调研记录，不含实现承诺。结论与算台既有设计冲突时以算台文档为准。
- 核对基线：ClawBible Desktop `724f1911`（本机 `/Users/kevin/Dev4AI/ClawBible.AI/clawbible-desktop/`，核对时工作区无未提交改动）；BetterWork `94263d2`（B00-1…B00-5 已提交）。
- 方法：只读源码与决策记录静态核对；未启动参考应用、未运行其测试、未验证其安装包。
- 衔接：[专家工作模型](2026-09-13-expert-work-model.md) §4 是首轮浅核对，本稿补齐字段、执行链路与分发细节；设计建议见 [专家与任务材料设计 v0.1](../designs/experts-and-task-materials.md)，架构关系见 Proposed [ADR-0014](../adr/0014-expert-context-and-material-binding.md)。

## 1. 一句话结论

ClawBible 的专家是**一行数据库配置**：人格 = 一段系统提示词，技能 = 一组 Skill ID，工具 = 运行时由 Skill 展开得到的派生集合（**不是专家字段**）。知识范围、记忆、模型、MCP、版本修订都不在 `Expert` 接口里。

## 2. 数据结构

`src/main/services/expert-service.ts:12` 的 `Expert`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 自定义专家回退为 `expert_${Date.now()}`（`:91`），非稳定标识 |
| `name` | string | 展示名 |
| `role` | string | 称号，**不参与执行**（仅用于搜索命中与前端图标匹配） |
| `description` | string | 简介 |
| `source` | `'builtin' \| 'enterprise' \| 'custom'` | 表上有 CHECK 约束（`database-schema.ts:137`） |
| `enabled` | `number`（0\|1） | 类型未用布尔；列表默认只显示启用（`:53`） |
| `systemPrompt` | string | 人格真身；内置专家此列常为空，实际取 `.md` 文件 |
| `boundSkills` | string[] | JSON 文本列，仅存 Skill ID |
| `defaultPptScope` | string? | **样本专属字段进了通用表** |
| `createdAt` | number | 没有 `updatedAt`，没有修订概念 |

`routing_keywords` / `routing_priority` / `user_id` 由后续 `ALTER TABLE` 追加（`database-migrations.ts:1179`、`:783`），未出现在 `Expert` 接口与 `EXPERT_COLS`（`ExpertRepository.ts:33`）中——列、类型、UI 三者不同步。

**同一概念存在三份定义**：`src/shared/types/index.ts:181`（含 `avatar`、`specialties`、`model`、`temperature`、`maxTokens`，与数据库不符，属遗留）、`expert-service.ts:12`（真相）、`ExpertsPage.tsx:29`（前端裁剪版）。任何字段变更都要人肉对齐，是算台协议单源要防住的典型形态。

## 3. 人格：提示词即人格，`role` 是装饰品

- 执行时只拼 `config.systemPrompt + 绑定 Skill 指令`（`agent/expert-agent.ts:201`）。`role` 全链路没有进入模型输入。
- 内置专家提示词不入库，改为构建期内联：`expert-prompts-index.ts:7` 用 Vite `?raw` 引入 8 个 `expert-*.md`，`rowToExpert`（`expert-service.ts:401`）按 ID 覆盖 DB 值。好处是提示词随代码评审与版本控制；代价是同一专家有两个写处，且 DB 里那列变成死数据。
- 提示词模板结构（`expert-prompts/expert-deep-research.md`）：核心能力 → 工作流程（含**明确的调用预算**，例如“最多 10 次搜索”）→ 输出文件规范 → 禁止事项。把预算与禁止项写进提示词，是样本验证过的高密度写法。
- 编辑弹窗（`ExpertsPage.tsx:679`–`:879`）只有 4 个输入框加一个 Skill 多选器；`experts:optimizePrompt`（`ipc/experts-handler.ts:36`）提供“AI 优化提示词”按钮，用固定的提示词工程模板重写当前提示词。
- 图标与渐变色由前端硬编码 `id → icon` 表和 `role`/`name` 关键词规则（`ExpertsPage.tsx:54`–`:113`），数据库没有 `avatar` 或 `icon` 列——与 Skill 表有 `icon` 列形成对照，属未收口的临时方案。
- 内置列表里有 10 个专家（`expert-service.ts:228`–`:323`），提示词文件只有 8 个：`expert_drawio` 与 `expert_all_purpose` 的提示词分别来自 Skill 与硬编码字符串，来源不统一。

## 4. 技能：唯一对外抽象，三层渐进披露

- `boundSkills` 是专家唯一的绑定单位。运行时 `resolveSkillTools`（`expert-agent.ts:73`）只取 `findEnabledByIds`，即**停用技能不展开工具**；但见 §5 的兜底例外。
- 指令分层注入（`expert-agent.ts:175`–`:193`）：
  - L2：每个 Skill 的 `system_prompt` 摘要，标题为“技能 [名称] 指令”；
  - L3：存在 `working_dir/SKILL.md` 时只给**路径**，让模型自行 `file_read`，并解释 `<this-skill-dir>` 变量含义。
- 编辑器把 3 个基线元技能从候选里剔除（`ExpertsPage.tsx:693`），因为它们无条件继承、不允许通过专家配置增减。
- 与算台的关系：这条链路与 ADR-0012 的 1:N 绑定、B00-2 的“通用约定层 + 适配预设层”拆分同构，且算台已有 `run_skill_bindings` 快照、信任与依赖校验。**专家的 Skill 预设应继续落到现有 Run 绑定，不建专家专属旁路**（ADR-0014 建议 4）。差异是 ClawBible 没有数量上限、没有快照、没有绑定顺序保证（依赖 `findPromptsByIds` 的 SQL 返回顺序）。

## 5. 工具：曾经能勾，后来删了

这是本轮最重要的调研结论，直接回答“专家要不要有工具”。

- 历史上 `experts` 表**有过** `bound_tools` 与 `bound_mcps` 两列，专家配置 UI 允许直接勾选裸工具。ADR-030（`docs/DECISIONS.md:1169`）判定这使“技能抽象形同虚设”，随后**物理删列**（`database-migrations.ts:755`–`:779`，注释明写“删除已废弃的 bound_tools 和 bound_mcps 列”）。
- 现行三条铁律（`DECISIONS.md:1197`）：Meta Tool 对专家、用户、第三方技能作者不可见；Skill 是唯一对外抽象；MCP 在 Skill 层组合。ADR-030 原因 5 的原话是“UI 极简：专家配置页只剩已绑定技能一个面板”。
- 实际工具集合 = **Tier 0 基线元技能展开 ∪ boundSkills 展开 ∪ 本次消息临时注入**（`expert-agent.ts:109`–`:164`），用 Map 按工具名去重合并。基线三件套：`skill_digital_worker_basics`（file_read/file_write/file_understand/shell_exec/fetch_page）、`skill_memory_basics`（memory 三件）、`skill_environment_basics`（environment_context）。
- **隐式兜底**（`:126`–`:136`）：基线元技能缺失或**被禁用**时，改从硬编码 `BASE_META_TOOL_NAMES` 直接加载工具，包含文件写入与 shell。这等于停用与撤销可以被绕过，算台不能照搬（对应 ADR-0012 实时撤销优先、设计稿 §9 的“必需 Skill 被撤销不兜底”）。
- MCP：专家侧没有 MCP 字段。MCP 挂在 **Skill** 上（`skills.mcp_server_id`），`resolveSkillTools:101` 命中即把该 Server 的**全部**适配工具加入；唯一的“选具体工具”入口是前端临时参数 `extraMcpTools`（`ExpertAgentContext:27`，万金油场景，逐条消息传），不落库。
- 结论：ClawBible 用一次删列的代价换来“工具不是配置维度”。算台设计稿 §3.1 目前把“内置工具、MCP 下的具体工具”列为专家可配字段，与这条经验冲突，需要明确取舍（见 §9）。

## 6. 专家身上没有、但算台要求有的东西

| 维度 | ClawBible 现状 | 差距 |
| --- | --- | --- |
| 知识范围 | 无字段；知识检索是 `skill_knowledge_ops` 提供的工具，默认全库 | 设计稿 §4 的两级材料范围必须自研 |
| 记忆 | 侧表 `memories.expert_id`（`memory-engine.ts:5`，`user_self` 表示用户级）；`ensureExpertMemory` 建空间；删除专家连带 `hardDeleteByExpert` | 无适用范围（Expert × Workspace）、无 confirmed/candidate 状态、无修订 |
| 记忆注入 | `agent/memory-injection.ts:60`–`:97`：画像常驻并受 `PROFILE_CHAR_BUDGET` 截断，动态记忆混合检索后注入，按 `conversationId:expertId` 缓存 | 预算与缓存策略可借鉴；确认门必须自加 |
| 模型与参数 | 专家无字段；模型在 `conversations.model_id` 与 `task_overrides.modelId`（`agent-handler.ts:444`–`:456`） | 算台的“模型偏好”放专家还是放任务/工作空间，未决 |
| 版本与快照 | `UPDATE` 原地改，只有 `created_at` | 算台要求 ExpertRevision 与 RunContextSnapshot（ADR-0014 建议 7） |
| 运行归属 | `conversations.expert_id`（`ConversationRepository.ts:130`）；`tool_audit_log` 与执行记录带 `expert_id`/`skill_id`（`AuditLogRepository.ts:63`） | 与算台“Task 记执行者、Run 记快照”方向一致，可作佐证 |
| 自动路由 | `BUILTIN_ROUTING` 关键词加优先级（`expert-service.ts:201`）、`RoutingEngine.match`（`routing-engine.ts:54`）、LLM 兜底 | 算台已明确不做自动专家路由，本轮不引入 |

## 7. 内置专家与分发

- 启动时 `initBuiltinSkills()` 再 `initBuiltinExperts()`（`src/main/index.ts:286`、`:296`）。内置列表写死在代码里（`expert-service.ts:228`–`:323`），含名称、职责、描述与 `boundSkills`。
- 同步策略：存在则 UPDATE 覆盖、不存在则 INSERT，随后**清理不在列表里的孤儿内置专家**并连带硬删其记忆（`:365`–`:376`）。
- 权限矩阵：`enterprise` 不可编辑（`:125`）、只有 `custom` 可删除（`deleteExpert` 带 `AND source = 'custom'`）、`expert_all_purpose` 万金油不可禁用且前端完全锁定（`ExpertsPage.tsx:748`）。
- 服务层写法问题：`getExperts` 手拼 SQL 字符串、参数是 `any[]`、异常时 `catch` 后返回空数组（`:36`–`:68`），列表读取失败与“确实没有专家”对用户不可区分。
- 问题汇总：UPDATE 覆盖会冲掉用户对内置专家的修改（ADR-0011 明确不允许升级静默改变授权或覆盖用户副本）；硬删遗留专家连带删记忆没有用户确认；“万金油”是**为承载临时能力组合而造的系统特殊专家**，把一次性配置塞进常驻实体。

## 8. 运行链路（谁在什么时候变成哪个专家）

1. 前端 `agent.sendMessage(message, convId, { preferredExpert, boundSkills, boundMcpTools })`（`preload/api/agent-api.ts:11`）。
2. 主进程交 MrK 调度（`agent-handler.ts:485`）：显式 `preferredExpert` 优先，否则走关键词与 LLM 路由。
3. `new ExpertAgent(expertId, ctx)` → `load()` 读 DB → `resolveTools()` 合并工具 → `run()` 拼提示词后调用共用的 `runReActLoop`（`expert-agent.ts:167`–`:212`）。
4. 所有专家是**同一个类的实例，差异全部来自数据**（文件头注释原话），不复制引擎。
5. 另有“专家构建者”走 `skill_agent_meta`（`expert_create`/`expert_list`/`skill_list`/`prompt_generate`，`skill-service.ts:510`），支持在对话里直接生成专家配置入库（`agent/tools/expert-create.ts:50`），并顺手 `ensureExpertMemory` 建记忆空间。

**全部专家共用一个引擎、差异只来自配置**这一点，与算台 ADR-0003 的核心边界和 ADR-0014 建议 1 一致，是本轮调研能确认的最大公约数。

## 9. 给算台的取舍建议

**建议借鉴**

1. 配置驱动加单一引擎：专家不产生第二套 Agent 执行路径。
2. Skill 指令三层渐进披露（名称 → 摘要 → 资源路径按需读）：与 B00-2 的分层一致，可作为专家预设的注入格式。
3. 提示词里写调用预算与禁止事项：可直接用于算台内置专家的默认人格模板。
4. 记忆注入的字符预算与“画像常驻 / 动态按需”二分。
5. 内置专家随安装包初始化并做孤儿清理——但清理必须改成“标记失效并保留历史”，不连带删数据。
6. 运行审计同时带 `expert_id` 与 `skill_id`：算台 `run_skill_bindings` 已有 Skill 侧，缺 Expert 侧。
7. “AI 优化提示词”作为编辑器里的独立动作：低耦合，可用注入模型做离线测试。
8. 对话内“保存为专家”作为创建路径之一（对应设计稿 §5.3 的成果复用方向），但必须走与 UI 相同的协议校验，不能像 `expert_create` 那样绕过校验直接入库。

**明确不采纳**

1. 专家裸工具白名单回潮——已由一次删列换来的教训。
2. 停用或缺失时的隐式工具兜底。
3. `role` 与 `systemPrompt` 双份且只有后者生效：算台要么让人格字段真实进入模型输入，要么砍成单字段。
4. 样本专属字段进通用表（`defaultPptScope`）。
5. 内置配置 UPDATE 覆盖用户副本；无确认的记忆级联硬删。
6. 同一类型多份定义（协议、服务、渲染端各写一遍）。
7. 为临时能力组合增设“特殊常驻专家”；临时组合继续走 B0 的 Composer 绑定。
8. 关键词与 LLM 自动路由（本轮不做）。
9. 手拼 SQL 与 `catch` 后返回空集合的错误语义。

## 10. 开工前必须定的三件事

1. **“工具”在算台专家里到底是什么**：A 只由 Skill 派生（沿用 ClawBible 删列后的结论）；B Skill 与专家白名单取交集（设计稿现建议，需要新表与装配处过滤）；C 首版取 A，MCP 与更细粒度工具授权后置到 E4。
2. **专家与 Skill 预设的关系**：专家只存 Skill ID 列表，还是存带顺序与修订引用的预设——决定是否需要 `expert_skill_bindings`，以及是否触碰 ADR-0014 建议 3 的 TaskContextRevision。
3. **首版切片边界**：只交付“专家 CRUD 加执行者注入加多 Skill 预设生效”（ADR-0014 的 E1），还是把材料快照 E2 一并做完。

三者都需要先落 ADR 与任务卡再写码；ADR-0014 目前是 Proposed，其末节已声明实现前需按 E1–E5 拆独立任务卡。
