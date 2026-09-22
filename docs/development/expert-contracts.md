# 专家与任务上下文契约（E10）

> **Proposed capability extension — 2026-09-20:** [Capability contracts](capability-contracts.md) define API service-profile selections, versioned/reviewed MCP bindings, category replacement versus preset inheritance, explicit empty selections, and concrete Run metadata. The [product design](../designs/api-tools-and-remote-mcp.md) preserves direct summon-to-conversation and existing Skill execution. These proposed fields and compatibility projections are not implemented changes to the E10/E42 contracts below; historical Expert revisions and existing acceptance statuses remain unchanged.

> **Proposed capability extension — 2026-09-22:** [工作型记忆产品设计](../designs/work-centered-memory.md)、[ADR-0026](../adr/0026-work-centered-memory.md)（Proposed）与[记忆实施契约](memory-contracts.md) 规划在 TaskContextRevision 上继续使用现有 `excludedMemoryIds`，并规定保存排除项时**必须完整保留** executor、skillBindings、materials、modelReference、builtinToolPolicy、mcpToolBindings 等其他字段（CAS 冲突保留草稿）。记忆的来源依赖只引用本契约已定案的精确材料引用，不改变 Expert/TaskContext/Run 的既有边界，也不新增第五种记忆 scope。该增量在 [WM 任务板](tasks-memory.md) 上无验收记录，不修改本文件的 E10/E42 字段定义。

- 状态：E10 已定案并由 E11–E15 实现；E42 已为 ExpertRevision 与 TaskContext 接入 MCP 工具选择。材料增量由 E20 定案，E21–E25 已实现。
- 日期：2026-09-14。
- 依据：[专家与任务材料设计 v0.2](../designs/experts-and-task-materials.md)、[ADR-0014](../adr/0014-expert-context-and-material-binding.md)、[ADR-0012](../adr/0012-composer-capability-binding.md)。
- 范围：本文件定义 E1 专家管理、召唤、执行身份、Skill 预设、内置工具策略、模型引用和任务草稿的精确边界。材料的候选、版本、快照、读取足迹和成果输入关系已在 [材料、快照与运行来源契约](material-contracts.md)（E20）中定案；记忆、MCP 和 Office 输入仍分别由 E30、E40、E50 定案。本文件和 E20 契约都不为尚未实施的切片创建空字段或空表。
- 当前实现补充：E22/E25 已将稳定的 Knowledge 修订与 ArtifactVersion 引用扩展到 `ExpertRevision.referenceMaterials`。它们只在召唤时复制为当前 TaskContext 的 `expert-reference` 材料，任务仍可移除、补充或调整用途；Workspace 输入快照不进入专家修订。字段和跨 Workspace 来源边界见 [ADR-0022](../adr/0022-expert-reference-materials.md)。

## 1. 术语与不变量

| 名称 | 语义 | 生命周期 |
| --- | --- | --- |
| Expert | 用户可召唤的长期工作方式身份 | 可启用、停用、归档；归档不删除历史 |
| ExpertRevision | Expert 的不可变人格、能力和模型配置 | 保存后只读；编辑生成新修订 |
| TaskContextRevision | 某 Task 下一次运行的可见草稿配置 | 可编辑；以期望修订号做并发控制 |
| RunContextSnapshot | 一次 Run 实际采用的执行者和能力快照 | 启动事务成功后固定；不随配置编辑变化 |
| RunSkillBinding | 现有 Run 与 Skill 的执行授权快照 | 仍使用 `run_skill_bindings`，一个 Run 可有 1–6 条 |

必须保持以下关系：

1. 通用助手是合法的无 Expert 模式；不绑定 Expert、Skill 或材料也可以发送澄清任务。
2. Expert 只保存人格与工作方法，不拥有当前任务的全部业务事实。每次任务的材料和记忆范围另由后续切片选择。
3. ExpertRevision、TaskContextRevision 和 RunContextSnapshot 都通过 ID 关联，不能把当前可变配置直接当作历史事实。
4. Expert 变更不热改已有 Task 或 Run；用户必须显式应用新修订。Skill 信任撤销和停用仍按 ADR-0012 实时取消相关 Run。
5. Renderer 不决定 Expert、Workspace、模型或工具的权限。Application 在 IPC 边界解析并在启动边界再次校验。

## 2. Expert 与 ExpertRevision

### 2.1 Expert 身份

目标持久化实体使用以下字段，实际 SQLite 表由 E11 迁移实现：

```ts
type ExpertSourceKind = 'builtin' | 'user';
type ExpertLifecycle = 'active' | 'disabled' | 'archived';

interface Expert {
  id: string;
  sourceKind: ExpertSourceKind;
  lifecycle: ExpertLifecycle;
  currentRevisionId: string;
  createdAt: number;
  updatedAt: number;
}
```

`builtin` Expert 由安装资源提供，用户不能覆盖其原始修订；用户修改时先复制为 `user` Expert。产品发布同一稳定 ID 的新版本时，追加新的 builtin 修订并保留旧修订，沿用用户对该 Expert 的停用/归档状态；用户副本不随发布更新。`archived` Expert 不出现在默认召唤列表，也不能启动新 Run，但旧 Task、Run、Artifact 和修订仍可读取。停用与归档均不删除历史。

### 2.2 ExpertRevision 字段

```ts
interface ExpertRevision {
  id: string;
  expertId: string;
  revision: number;
  name: string;
  summary: string;
  avatarKey?: string;
  identity: string;
  principles: string[];
  inputRequirements: string[];
  deliveryRequirements: string[];
  skillPreset: ExpertSkillPreset[];
  builtinToolPolicy: BuiltinToolPolicy;
  modelReference: ExpertModelReference;
  mcpToolBindings?: McpToolBinding[];
  referenceMaterials?: ExpertReferenceMaterial[];
  createdAt: number;
}

interface ExpertReferenceMaterial {
  reference: MaterialReference;
  purpose: MaterialPurpose;
  note?: string;
}

interface ExpertSkillPreset {
  skillId: string;
  revisionId: string;
}

type BuiltinToolPolicy =
  | { mode: 'application-defaults' }
  | { mode: 'allow-list'; toolNames: string[] };

type ExpertModelReference =
  | { mode: 'application-default' }
  | { mode: 'profile'; modelProfileId: string };
```

`identity`、`principles`、`inputRequirements` 和 `deliveryRequirements` 在执行前由 Application 合成为**一段唯一的 Expert 指令**，不能同时维护另一份可执行系统提示词。字段为空的语义如下：`summary` 可为空字符串；`principles`、`inputRequirements`、`deliveryRequirements` 允许空数组；`identity` 必须是非空文本。名称和摘要供 UI 展示，不能替代人格指令。

保存 Expert 时，Skill 必须解析为当前存在的 `skillId + revisionId`。Skill 缺失、已归档或修订不存在时可以保存草稿，但 Expert 标为不可用，发送时返回具体阻塞原因；不得静默替换成最新 Skill 修订。模型引用同样只保存 `modelProfileId`，不保存 API Key；被删除或停用的模型使发送失败而不是回退到另一个模型。

Skill 预设保持用户顺序，最多 6 项；同一 `skillId` 不能重复。E12 将其转换为现有 `StartRunRequest.skillBindings`，保留顺序和 `revisionId`，再经过既有启用、信任、环境和依赖校验。Expert 不创建第二套 Skill 授权或工具执行器。

### 2.3 Expert 管理操作

后续 IPC 使用结构化输入/输出，名称可在实现时按现有 channel 命名规范落地，但语义固定为：

| 操作 | 输入要点 | 输出/失败 |
| --- | --- | --- |
| list | 可选 `includeArchived` | `ExpertSummary[]`，不含密钥或完整系统指令 |
| get | `expertId` | 当前身份、当前修订摘要和完整可编辑字段；不存在返回 `expert_not_found` |
| create | `ExpertRevisionDraft`、来源只能为 user | 新 Expert、首个修订；字段/引用校验失败时事务回滚 |
| save revision | `expertId`、草稿、`expectedRevision` | 新的不可变修订并成为 current；期望版本不符返回 `expert_revision_conflict` |
| copy | `expertId`、可选名称 | 独立 user Expert；不复制任务历史、记忆、凭据或信任授权 |
| set lifecycle | `expertId`、`active/disabled/archived`、`expectedRevision` | 更新身份状态；归档不删除修订，活跃 Run 按 E12 的取消语义处理 |

所有管理操作在 Main 事务中完成。用户草稿允许缺少 Skill 环境或模型，但非法 ID、重复 Skill、超过 6 项和超长文本在 IPC Schema 边界拒绝。内置 Expert 的原始修订不可被 `save revision` 覆盖，复制后才可编辑。

## 3. TaskContextRevision（E1 基线与后续扩展）

E1 首版只持久化以下下一次运行配置；材料、记忆和 MCP 后续通过各自任务卡以版本化字段接入，不把空数组当作授权：

```ts
type TaskExecutorSelection =
  | { kind: 'general' }
  | { kind: 'expert'; expertId: string; expertRevisionId: string };

interface TaskContextRevisionE1 {
  id: string;
  taskId: string;
  revision: number;
  executor: TaskExecutorSelection;
  skillBindings: SkillBindingDraft[];
  modelReference?: ExpertModelReference;
  builtinToolPolicy?: BuiltinToolPolicy;
  createdAt: number;
  updatedAt: number;
}

interface SkillBindingDraft {
  skillId: string;
  revisionId: string;
  source: 'expert-preset' | 'task-selection';
}
```

规则：

- `executor.kind = general` 时允许 `skillBindings = []`，模型和内置工具走应用默认；这是现有普通 Run 的合法路径。
- `executor.kind = expert` 时 `expertRevisionId` 必须属于 `expertId`，且 Expert 在发送时为 active。保存时把 Expert 预设复制到 `skillBindings`，用户在任务内增删 Skill 后更新同一份草稿；发送时不再从当前 Expert 重新合并，避免编辑 Expert 影响旧草稿。
- `skillBindings` 是有效顺序的唯一来源，去重后不得超过 6 项。启动前转换为现有 `SkillBinding[]`，丢弃仅供 UI 解释的 `source` 字段。
- `modelReference` 和 `builtinToolPolicy` 缺失表示继承 Expert 修订（Expert 模式）或应用默认（通用模式）；显式值只能引用已配置的模型和已登记的内置工具。
- E2 之后扩展 TaskContextRevision 时，只能新增版本化字段并由对应任务卡定案；不得把 `materials: []`、`memory: []` 或 `mcp: []` 当作当前授权。

当前已落地的扩展包括：E22 的 `materials`（精确 Knowledge/ArtifactVersion/输入快照引用）、E31 的记忆排除项与运行记忆快照，以及 E42 的 `mcpToolBindings`。它们仍由 Application 在保存和启动边界校验，不改变 E1 的 Expert 身份固定规则。

草稿更新采用 compare-and-swap：调用方提交 `expectedRevision`，当前修订不同就返回 `task_context_conflict`，保留用户本地草稿供重试。召唤只创建/切换草稿并聚焦输入框，不自动发送或创建 Run；首条非空消息才提交启动。

## 4. 启动事务与执行解析

E12 的启动入口必须接收 `taskContextRevisionId` 和 `expectedTaskContextRevision`。Application 按以下顺序执行，任何一步失败都不创建可执行 Run：

1. 校验 Task、Session、Workspace 归属，以及上下文修订仍属于该 Task 且版本匹配。
2. 读取固定的 `TaskExecutorSelection`。通用模式不读取不存在的 Expert；专家模式校验身份 active、修订归属和修订内容哈希。
3. 将 Expert 的唯一人格指令和 `skillBindings` 解析为执行输入；Skill 按数组顺序逐项检查启用、信任、运行环境、依赖和修订一致性。任一不满足时返回带 `skillId/name` 的错误，不能剔除失败项继续。
4. 解析模型引用。指定模型必须存在、启用且角色为 `language`；未指定时按现有应用默认选择。API Key 只在 Main 内读取。
5. 解析内置工具：可用目录 ∩ Expert allow-list（若有）∩ 本次授权/状态。工具名未知或不允许时启动失败，不能仅从模型传入的工具名称放行。E1 不接入 MCP，故不存在“所有 MCP 工具兜底”。
6. 在一个 Application/SQLite 事务中登记 Run、专家/模型/工具引用快照，并建立现有 `run_skill_bindings`。事务提交后才把解析后的 `AgentRunInput` 交给 Agent Core；事务失败不留下半个 Run 或半套绑定。
7. 运行中 ExpertRevision、TaskContextRevision 和模型配置不热换；取消、停用和撤销仍按现有唯一终态与级联规则收口。

`RunContextSnapshot` 是 E12 的持久化目标。专家 Run 直接保存 `expertId + expertRevisionId`，通用助手省略这两个字段；`taskContextRevisionId` 仍用于回溯本次任务草稿。E10 不新增迁移；E11 会用版本化迁移新增专家身份、修订和 TaskContextRevision，E12 再新增运行快照关联。后续补齐专家快照字段使用独立版本化迁移，迁移必须可回滚、可重开幂等，并以旧库的空上下文解释通用模式。

## 5. 版本、旧任务与历史

### 5.1 冲突与显式应用

- Expert 编辑生成新修订；已有 TaskContextRevision 继续引用旧修订，并显示“有新版本可用”。用户点击应用后，Application 在 CAS 成功时创建新 TaskContextRevision；旧草稿和历史 Run 不回写。
- Skill 修订、模型删除/停用或 Expert 归档不会把旧 Run 改写成新版本。下次发送在启动边界报告缺项，并允许移除或重新选择。
- 运行中的 Run 永远使用已登记快照；Skill 信任撤销与停用属于实时安全撤销，仍可取消活跃 Run。

### 5.2 旧任务迁移

现有 Task 没有 Expert 字段，也没有可回溯的历史 Expert 身份。迁移和首次打开必须遵守：

1. 不从历史 prompt、Skill 绑定、模型名称或文件路径推断 Expert。
2. 旧 Task 在没有上下文修订时解释为 `{ executor: { kind: 'general' }, skillBindings: [] }`；首次编辑或发送时在事务中创建一个通用 TaskContextRevision。
3. 旧 Run 没有 Expert/Context 快照时，历史界面显示“通用助手 / 当时未记录专家”，不补造事实；原有绑定和成果继续按原表读取。
4. 新任务的首次召唤创建独立 Task/Session；切换 Expert 不复用旧专家的完整消息、私有记忆或隐式材料。

## 6. 错误码与消费者

错误在 Main 内转换为稳定 code、可读 message 和可定位对象；Renderer 只按 code 路由当前表单/Composer 内联反馈。

| code | 触发 | 主要消费者 |
| --- | --- | --- |
| `expert_not_found` | ID 不存在 | Expert 页、召唤入口 |
| `expert_disabled` / `expert_archived` | 不能开始新 Run | 召唤、发送边界 |
| `expert_revision_not_found` | 修订已删除或归属错误 | 编辑保存、启动 |
| `expert_revision_conflict` | 保存时 expectedRevision 过期 | Expert 编辑器 |
| `expert_skill_missing` | 预设引用的 Skill/修订不存在 | Expert 详情、启动 |
| `skill_blocked` | Skill 未启用、未信任、环境/依赖不可用 | Composer、发送边界 |
| `skill_limit_exceeded` | 合并后超过 6 项 | Composer、上下文保存 |
| `model_profile_missing` / `model_profile_disabled` | 指定模型不可用 | Expert 编辑器、启动 |
| `builtin_tool_unknown` / `builtin_tool_not_allowed` | 工具不在登记目录或策略外 | Expert 编辑器、启动 |
| `task_context_not_found` | 草稿不属于当前 Task | 任务恢复、发送 |
| `task_context_conflict` | expectedRevision 过期 | 任务草稿保存 |
| `task_context_invalid` | 专家/Skill/模型组合无法解析 | 任务草稿、发送 |

E2–E5 的材料、记忆、MCP 和 Office 错误不得提前复用这些 E1 code；它们在所属契约中新增判别值并保持旧消费者可解释。

## 7. 与现有协议和边界的对应

- `StartRunRequest.skillBindings` 仍是运行时 Skill 输入；Expert/TaskContext 的 `source`、Expert 指令和工具策略由 Application 在 Main 内解析后注入，不让 Agent Core 读取 SQLite。
- Agent Core 只接收已合成的指令、`SkillInstruction[]`、模型和工具集合；不新增 Expert 专属引擎或 Renderer 依赖。
- `run_skill_bindings` 继续是每个 Skill 的授权快照来源；E1 不新增旁路表来绕开信任、启用和依赖。
- IPC 采用共享 Zod Schema；Preload 只暴露最小的专家和任务上下文方法，Renderer 调用按 `reportAction`/`trackAction` 收口。

E10 完成后，E11 才开始迁移和管理服务，E12 才开始运行注入；本文件的类型是实施契约，不代表 Expert、TaskContextRevision 或 RunContextSnapshot 已经存在于当前数据库。

## 6. MCP 工具选择增量（E42）

`ExpertRevision` 可以保存 `mcpToolBindings` 作为长期预设；`TaskContextRevision` 保存本次任务的显式绑定。两者都引用 `connectionId + toolId`，而不是保存可变的工具描述，并在保存边界拒绝重复绑定。设置页检测到的工具只是候选，专家和任务分别选择后才进入 Run；连接删除、工具目录变化或服务断线不会改写历史修订。

当连接或具体工具不存在时，Expert 状态标记 `mcp-unavailable`，用户仍可查看和编辑修订；发送边界由 Main/RunService 再次确认，并将失效绑定收口为可解释失败。
