# ADR-0029：工作空间身份与侧栏分组

- 状态：Accepted（2026-09-28，按光哥对低保真原型 D1–D10 全部推荐方案的批准开工实施）。
- 日期：2026-09-28。
- 依据：[低保真评审原型](../prototype/workspace-identity/index.html)与 [README](../prototype/workspace-identity/README.md)、[2026-09-28 工作日志](../logs/2026-09-28.md)、[领域模型](../02-domain-model.md) §2、[UI/UX 体系](../10-ui-ux-system.md) §6.1.7、§6.2、§9.12、§10.1。
- 关系：细化 ADR-0008 的「长期工作目录承接持续项目」；为 §6.1.5 定时任务的「先选长期工作目录」提供同一份身份呈现；不改 Run 快照、材料边界或记忆作用域的既有事实。

## 背景

Workspace 此前只有 `id / name / root_path / created_at / updated_at` 五列，`name` 由 `getOrCreate(rootPath, path.basename(rootPath))` 直接取目录名，Repository 只有 `getOrCreate / get / listAll`——建完即不可改，也没有隐藏或删除。侧栏是一句「最近任务」加一条不分组的平铺列表，并被当前空间过滤，「持续项目」在导航里不存在；`RECENT_TASKS_LIMIT = 100` 是全局名额，一个活跃空间就能让别的空间整批消失。同时「工作区」一词在本产品指两件事：UI 的中栏（任务工作区）与 Workspace 实体，侧栏分组标题一旦叫「工作区」就同名不同义。

## 决策

1. **命名收口**：Workspace 的中文一律「工作空间」；中栏继续叫「任务工作区」。默认空间名、材料来源标签、选择器与对话框文案同步改（「我的工作空间」「工作空间文件」）。
2. **身份三件事落在数据上**：`name` 变成用户可改的显示名（别名），新增 `iconId`（12 档）与 `accentId`（8 档）；`hiddenAt` 只表达侧栏可见性。档位由协议枚举 `workspaceIconIdSchema` / `workspaceAccentIdSchema` 定死，图标集与色板各按 `Record` 穷举，漏一档即编译不过。
3. **身份色是外观的第三个维度**，与 `AppearanceMode × ColorScheme` 正交：它表达「这是哪个空间」，不表达「应用长什么样」，因此只提供浅色与深色两套值，不随四套色系各出一份。不提供取色器（沿用 §9.2 的理由）。护栏锁「每一档明暗成对定义」，删一档深色值即红。
4. **侧栏按空间分组**：一次列出最近活跃的前 12 个空间（含还没有任务的空空间），按各空间最近任务活动排序；默认只展开当前空间，展开偏好按「默认值＋例外」存 `localStorage`。组内折叠给 3 条、「展示更多」就地展开到已加载的 20 条，`k` 来自仓储统计的真实总数。
5. **点空间行只展开收起**：不切换当前空间、不清草稿、不打断运行中的任务。切换当前空间只有两条路——打开别的空间里的任务（这是「打开任务」的必然结果），或在输入区的选择器里选。这是「动作不得破坏进行中的任务上下文」在导航层的落法。
6. **隐藏而非删除**：`tasks / artifacts / input_snapshots / run_context_snapshots / memory_records` 等对 `workspaces.id` 全是 `ON DELETE CASCADE`，删一个空间会带走整棵子树，因此菜单不提供删除入口；恢复隐藏走选择器（它列全部空间，选中即解除）。真删需要自己的确认设计与迁移，本轮不做。
7. **选目录与登记拆成两步**：`workspace:select`（选完顺手 `getOrCreate`）改为 `workspace:pick-directory`（只回路径），登记必须走 `workspace:create`。新建对话框取消时不再留下半行数据。原「新建工作空间」与「打开本地文件夹」两颗做同一件事的按钮合并为一个对话框入口。
8. **不放「工作空间索引」开关**：算台没有工作空间级索引这件事——知识是全局库加集合，协议里写明「集合仅个人分类，不代表工作空间授权」，检索范围由任务材料约束。放一个开关等于让用户对一个不存在的能力做承诺。已有的按空间开关（记忆自动提炼）留在设置里，它带同意条款流程，不适合塞进创建对话框。
9. **协议类型不再两份**：`WorkspaceSummary`、`RunSummary`、`RecentTaskSummary` 改为由各自 Schema `z.infer` 派生。此前接口与 Schema 各写一份，`exactOptionalPropertyTypes` 下 `completedAt?: number` 与 `?: number | undefined` 是两种类型；分组查询第一次把「校验后的行」直接交给行组件，这个分歧就从潜在变成编译错误。

## 实现边界

- 应用库迁移 v35：`workspaces` 加 `icon_id TEXT NOT NULL DEFAULT 'folder'`、`accent_id TEXT NOT NULL DEFAULT 'moss'`、`hidden_at INTEGER`。带默认值或可空，历史行不回填也不替旧库猜一个图标。
- 新增通道：`workspace:create`（路径已登记抛中文说明，不静默复用）、`workspace:update-identity`（至少改一项，Zod refine 拦在边界）、`workspace:set-hidden`、`workspace:list-task-groups`（每空间一页任务＋真实总数）。`rootPath` 是 Renderer 回传的字符串，登记前在主进程重新解析并确认仍是目录——它同时是 Tool 的文件沙箱边界。
- 名称留空由主进程回落 `path.basename(rootPath)`，界面不自己拼第二份规则。
- 新基座两个（登记在 docs/10 §10.1）：`SingleSelectPicker`（原生 radio 语义，图标格与色板格共用）、`WorkspaceGroupList`（复用 `NavItem`／`RunSummaryRow`／`EmptyNotice`／`PopoverMenu`，只新增分组外壳这一层）。`NavItem` 补 `iconColor`、`PopoverMenuItem` 补 `leading`、`RunSummaryRow` 补 `compact` 档，都是可选属性，不改既有几何与措辞归属。
- 侧栏任务行的可及名称仍含状态与时间；`compact` 只是把「已完成」这类多数派状态词省掉，不省「进行中／失败」。

## 取舍与后续

代价是侧栏一次只看 12 个空间、每组只看 20 条任务，更多的要靠选择器搜索定位；换来的是「回到哪段持续工作」在一屏里可读，且分组查询不必为翻页机制让路。窄栏（88px）用着色图标代替整组隐藏，代价是折叠态少了一层任务信息。

后续未纳入：真删工作空间的确认设计与迁移、按空间的独立知识索引（要先有那个概念）、置顶与自定义排序、跨空间任务搜索、从空间行直达工作空间简报（简报入口现在只在上下文面板）。相邻但本轮未改的一处已知问题：`startNewTask()` 会清 prompt，因此「先打字再新建空间」的草稿仍可能丢——本轮只在换空间的路径上把 prompt 带回来，不改新建任务本身语义。
