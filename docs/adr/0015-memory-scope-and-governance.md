# ADR-0015：最小记忆的范围、确认与治理

- 状态：Accepted（2026-09-14）
- 关系：细化并约束 [ADR-0004](0004-hybrid-memory.md) 的混合记忆架构；由 [ADR-0014](0014-expert-context-and-material-binding.md) 的专家与任务材料快照引用。
- 实施：E30 定案；E31 已实现存储、作用域检索、运行注入和受管 Markdown 投影；E32 实现管理界面与 E3 验收。

## 背景

专家需要复用长期工作方法和已确认偏好，但不能把聊天全文、历史成果或模型猜测自动变成公司事实。记忆还必须在专家和工作空间之间隔离：同一专家在两个公司空间的经验不能互相泄漏，某个空间的规则也不能因为用户拥有该专家而自动适用到另一个空间。

## 决策

### 1. SQLite 是唯一真相源

首版只允许通过主进程的 Memory Service 创建和修改记录。SQLite 保存不可变内容修订、状态、范围、来源、时间和哈希；Markdown 是可重建的只读投影，E31 不接受手工修改 Markdown 回写数据库，因此不形成双真相源。投影缺失或写入失败不能回滚已提交的数据库状态，也不能让旧投影继续被运行读取。

`MemoryRecord` 的稳定身份与内容修订分开：编辑产生新的 `revision` 和 `content_hash`，旧修订保留以解释历史 Run；删除是状态变化，不物理删除历史事实。

### 2. 适用范围使用判别联合

首版支持四种范围：

- `user`：用户通用偏好，固定 `scope_id = user`。
- `workspace`：只适用于一个 Workspace。
- `expert`：专家通用工作方法，不包含公司事实。
- `expert-workspace`：同时要求同一个 Expert 与 Workspace，不能拆成两个独立条件后取并集。

Record 同时保存 `expert_id` / `workspace_id` 的结构化列（不把两个 ID 拼进自由字符串），由服务校验范围对象存在且与请求上下文一致。首版不提供 `task` 长期记忆；本期目标和临时材料仍属于 TaskContext 与 Run。

### 3. 来源和确认状态

来源类型为 `user-explicit`、`conversation`、`artifact`、`reflection`，并保存来源 ID、简短定位和创建 Run（若有）。用户明确说“记住这个”或在记忆管理页确认时才可写入 `confirmed`；对话、成果和后台整理只能创建 `candidate`。模型不能自行把 candidate 提升为 confirmed，也不能通过内容修改 scope 或工具授权。

状态转移如下：

```text
candidate ──confirm──> confirmed ──supersede──> superseded
    │                       │  └──────────────> deleted
    └────────ignore────────> deleted
confirmed ──expire───────> expired
expired ──explicit edit/confirm──> confirmed (new revision)
```

`deleted`、`superseded` 是终态；历史 Run 的快照仍可解释当时记录，但后续检索和新 Run 不再返回它们。有效期由 `valid_from` / `valid_until` 判断，过期不等于删除，用户可在确认新修订时明确延长。

### 4. 检索、预算与快照

E31 首轮使用 SQLite FTS/稳定前缀匹配，不引入 Embedding、后台反思或向量库。检索只接受 Application 已解析的 `MemoryQueryContext`，按以下顺序取候选：有效 `confirmed` → 范围匹配 → 内容命中 → `user`、`expert-workspace`、`expert`、`workspace` 的稳定优先级 → `updated_at DESC` → `id ASC`。

每次 Run 最多注入 16 条记忆、总计 6,000 个 Unicode 字符；按完整记录截断，不把半条记录送给模型。上下文装配时固定 `memory_revision_id` 和内容哈希到 RunContextSnapshot；运行中确认、编辑、删除或过期不会热改正在执行的 Run。读取足迹记录实际注入的记录，不能由候选列表推断。

### 5. 范围收缩与冲突

用户移除某条记忆或缩小适用范围时，后续 Run 创建新的上下文段，不重放依赖旧记忆的助手回复；历史 UI 保留。适用记忆与本次选定 Knowledge 规则冲突时，两者都可展示来源，专家必须请求澄清或遵循更具体的本期材料；Memory 不能覆盖规则、工具授权或系统指令。删除不撤回已发送给外部模型的内容。

### 6. 投影与治理边界

投影路径按范围组织为 `memory/user/`、`memory/workspaces/<workspaceId>/`、`memory/experts/<expertId>/` 和 `memory/expert-workspaces/<expertId>/<workspaceId>/`。E31 只负责从 SQLite 全量重建 Markdown；E32 的编辑、确认、忽略、删除和“本任务不用”全部走 IPC，不允许 Renderer 直接写文件。投影内容不得包含凭据、完整聊天或未确认候选。

## 失败与恢复语义

- 数据库事务失败时不留下半条记录；投影失败进入可见的同步错误，但不把 SQLite 回滚成旧记忆。
- 并发编辑按期望修订号拒绝覆盖，编辑草稿留在当前界面。
- Workspace 或 Expert 不存在时拒绝写入；跨 Workspace 的 `expert-workspace` 请求拒绝而不是降级成 `expert`。
- 记录内容为空、超出 2,000 字符、有效期倒置或来源类型不合法时在协议边界拒绝。
- 应用重启先恢复/重建投影索引；索引可删除并从 SQLite 重建，不能作为权限或事实来源。

## 验收清单

E31 必须覆盖四种范围的匹配与隔离、candidate/confirmed/expired/deleted 状态、内容修订、预算截断、运行快照、并发冲突、投影重建和失败恢复。E32 必须覆盖两 Workspace 同一专家不串记忆、确认后重启新任务生效、删除后后续 Run 不引用、来源/范围可见、取消建议不写 confirmed，以及“本任务不用”只影响当前 TaskContext。

不在本 ADR 范围内的能力：自动反思、Embedding/向量检索、MCP、网页正文、完整对话摘要、定时记忆维护和把 Artifact 自动导入 Knowledge。
