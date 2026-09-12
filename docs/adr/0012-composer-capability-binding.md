# ADR-0012：对话内能力绑定与 Composer `+` 菜单

- 状态：Accepted（决策 3/4/5 与决策 8 的成本结论已落地并经代码验证；决策 1/2 的界面与决策 6 的原因文案待 B00-3…B00-5）
- 日期：2026-09-12
- 背景：任务对话目前无法选择技能。唯一入口是 Skill 详情页的「试运行」，它把所选 Skill 放进一张新任务草稿；对话界面本身既不能选、不能看全、也不能撤销。用户要求参考 WorkBuddy 的 `+` 菜单与 ClawBible Desktop 的模式选择器，并指出后续还要在对话中召唤专家。
- 关系：把 [阶段 B](../development/phase-b-c-roadmap.md) B04 的「任务选择专家与 Skill」前置为独立切片，为 B01–B03 建立领域前提；落实 [ADR-0008](0008-personal-workbench-and-capability-first.md) 的「一个专家调用多项 Skill」中「多项 Skill」这一半；不改变 [ADR-0011](0011-skill-trust-and-local-distribution.md) 的信任、启用、依赖三态分离规则，只扩展其级联语义。

## 决策

1. **能力入口是 Composer 内的 `+` 菜单，不是独立页面、不是斜杠命令。** 一级项为「技能 / 专家 / 添加文件」，每项进入二级列表；二级列表支持搜索与多选，并显示每项的可用状态。
2. **已选能力以 chip 条呈现于输入框上方，可逐个移除。** chip 是通用结构 `{ kind, id, name, status }`，`kind` 首版只有 `skill`；专家与文件将来是新增 `kind`，不新增控件形态。
3. **Run 与 Skill 的关系由 1:1 改为 1:N，命名为「能力绑定」（CapabilityBinding）。** 一个 Run 同时绑定至多 6 个 Skill，绑定顺序即指令注入顺序，由用户选择顺序决定，首版不提供排序交互。
4. **取消「未显式指定时自动延续同 Task 最近一次绑定」的隐性行为。** 绑定成为任务级可见状态：Task 的当前绑定集合由其最近一个 Run 的绑定集合推导并在界面显示，用户增删 chip 后以下一次 Run 的绑定为准。不再存在界面上看不见、也撤不掉的运行期能力。
5. **任一绑定不满足前置条件时，Run 不启动。** 不可用项在 `+` 菜单内即置灰并给出 `blockedReasons` 原因与定位入口；运行期真失效才以 `run.failed` 收口。不得把未信任、已停用或依赖未就绪的 Skill 静默剔除后继续跑。
6. **撤销信任或停用某个 Skill 时，取消所有包含该 Skill 的活跃 Run**，即使它只是 N 个绑定中的一个。取消原因必须指明是哪个 Skill。运行中热插拔能力被否决——它破坏决策 3 的绑定快照语义。
7. **专家入口在阶段 B 前只占位。** `+` 菜单的「专家」显示为禁用项加一句说明，不接任何 IPC、不在协议里预留 `expertId` 字段。Run 与 Expert 的关系由阶段 B 的独立 ADR 定义。
8. **本决策不引入数据库迁移。** 见 §设计落实 的成本核对；若实现时发现需要迁移，说明本 ADR 判断错误，必须回写本文并说明原因。

## 为什么是 `+` 菜单

两个参考系各选了其一：

- WorkBuddy：`+` 菜单（添加文件 / 模式 / 专家 / 技能 / 连接器，一级带箭头进二级）+ 输入框上方一排意图 chip。
- ClawBible Desktop：`ChatInput.tsx` 用 `/` 斜杠命令 + `@` 文件选择器；`chat/ModeSelector.tsx` 用输入框左侧单个下拉承载 MrK / 万金油 / 召唤专家；`SkillSelector.tsx` 是多选 Badge 列表，发送时携带 `{ preferredExpert, boundSkills: string[] }`。

选 `+` 菜单的理由按权重排列：

1. **可扩展容器。** 专家、文件、连接器都要二级列表和状态标注，塞进斜杠命令面板承载不了；`+` 菜单加一类条目不改布局。
2. **可发现性。** 斜杠把能力藏在键盘之后，用户需要先知道有这回事。当前阶段的目标恰恰是让用户意识到「技能是可以被选中的」。
3. **中文输入冲突。** `/` 与 `@` 在 IME 组字过程中会误触发菜单，ClawBible 的实现需要靠 `isComposing` 与光标位置推断规避，这类补丁不应进入新代码。
4. **概念分离。** ClawBible 把「模式」「专家」「技能」压进一个下拉，长期会糊。本决策固定：专家是身份（单选、替换），技能是能力（多选、叠加），两者在 `+` 菜单里是不同的一级项。

## 设计落实

### 成本核对（这是本决策最重要的结论）

单绑定的假设**不在基础设施层**，只在应用层的四处：

| 层 | 现状 | 结论 |
| --- | --- | --- |
| `run_skill_bindings` 表 | `id` 为主键，`run_id` 为外键，只有普通索引 `idx_run_skill_bindings_run`，**无 `run_id` 唯一约束** | 存储层天然允许 1:N，无需迁移 |
| `script_executions.binding_id` | 已按单条 binding 关联 | 天然支持 |
| `AgentRunInput.skillInstructions` | 类型已是 `SkillInstruction[]` | agent-core 与引擎无需修改 |
| `skill_read_resource` / `skill_execute` 入参 | 已经要求显式传 `bindingId` | 工具层天然按绑定寻址，多 Skill 不产生命令 ID 冲突 |

需要改动的四处：`startRunRequestSchema`（协议）、`RunService.resolveBindingId`、`RunService.resolveSkillInstructions`、`ActiveRun.skillId` 与 `cancelRunsForSkill` 的级联判断。

### 协议

- `StartRunRequest.skillBinding?: SkillBinding` → `skillBindings?: SkillBinding[]`，`.min(1).max(6)`，元素按 `skillId` 去重；`SkillBinding` 本身不变（仍带可选 `revisionId` 用于快照校验）。上限 6 的取值理由是指令注入的上下文预算与 chip 条的可读性，不是技术极限。
- Preload 的 `runs.start` 同步收窄为该类型；不保留旧字段名的兼容路径——本仓库无外部客户端，串行开发下没有并存版本。
- 不新增 IPC channel，不新增事件类型。绑定集合的展示复用 `RunSkillBinding` 的读取。

### 指令注入与命令表

- 每个 Skill 一条 `SkillInstruction`，正文前缀 `[Skill: <名称>]`，按绑定顺序拼接。
- **移除 `run-service.ts` 中把 PPT 专用约定注入给任意带命令 Skill 的硬编码段**（现约 L456–L462，含 `svg-export`、`template-merge`、`pptx-validate`）。拆分方式：通用段落（`task_write_file` 写本 Run work 目录、覆盖已有文件必须提供 `expectedHash`、不得自行声明验证状态）保留在 RunService；样本专属段落由 `SkillAdapter` 按 Skill 提供。这是 1:N 的前置修复——两个 Skill 时该段文字会重复且互相误导。
- 注入的命令表每项显式携带 `bindingId` 与所属 Skill 名称，并在通用段落说明必须使用所给 `bindingId`。

### 绑定解析

`resolveBindingId` 返回单个 id → 返回 `bindingIds: string[]`；`resolveSkillInstructions` 对每个 binding 独立执行现有的启用/信任/修订一致性/资源根校验，任一抛错整个 Run 失败。工具注册条件由「有 binding」改为「bindings 非空」。

### 级联

`ActiveRun.skillId?: string` → `skillIds: string[]`；`cancelRunsForSkill` 的相等判断改为成员判断，取消原因写入具体 Skill 名称。

### UI

- 新增受控弹层组件（仓库目前没有任何 Popover/Dropdown，只有 `ConfirmationDialog` 与 `ModelEditorSheet`），一次性满足：`Esc` 关闭、点击背板关闭、焦点归还触发元素、方向键导航、`aria-expanded` / `aria-haspopup`、只消费语义 Token（`overlay`、`surface-raised`、`border`、`selection`、`--shadow-color-overlay`）。`+` 菜单是它的第一个消费者，通知面板等后续浮层应复用同一基座。
- chip 条位于工作区行与 textarea 之间，取代现在的 `已选择 Skill：{name}` 纯文本提示。
- 命中区不小于 32px（`docs/10` §8.1 的既有未达标项不得继续扩大）。
- 反馈路由不变：菜单内的状态是内联反馈，不产生 Toast。

## 验收要求

- 在任务对话内直接选择与取消技能，不切页、不重启；chip 显示的状态与 `blockedReasons` 一致，不可用项置灰并给出原因与定位入口。
- 一个 Run 绑定两个 Skill：两份指令按序注入、两个 Skill 的命令各自可执行、绑定快照互不污染，`script_executions` 的 `binding_id` 可区分归属。
- 撤销其中一个 Skill 的信任：包含它的活跃 Run 被取消，且原因指明是哪个 Skill；不含它的 Run 不受影响。
- 历史 Run 展示的是它当时绑定的集合，后续修改任务绑定不回写历史。
- 新任务草稿不再继承上一个任务的绑定（现有行为保持），同时运行中的任务不再隐式继承上一次绑定（决策 4 的新行为）。
- 无新增 SQLite 迁移；`db/migrate.test.ts` 版本数不变。
- `+` 菜单键盘与读屏可达；所有新样式只用语义 Token。

## 实现进度

2026-09-13 B00-1 已落地：协议 `skillBindings` 1–6 项数组 + Schema 层去重、`RunService.resolveSkillBindings` 绑定解析、取消隐式继承、工具桥接改按 `bindingId` 寻址并校验归属。成本核对的结论成立：**未新增任何迁移，`run_skill_bindings` 未新表新列**。agent-core 一行未改，`buildSkillMessages` 本来就支持多技能去重与预算。

实现中发现两处本 ADR 未记载的成本，已一并处理：

1. **前置校验原本只在有绑定快照时生效。** 旧 `resolveSkillInstructions` 在 `skillExecutionService` 缺失时走 `trustStatus` 分支，有快照时走 `isBindingAuthorized` 分支；拆成「先建快照、后读指令」两步后，若快照建立前短路，一个技能都不会被校验。现改为单次遍历内先整体校验后落快照。
2. **不合格绑定会留下半个快照。** 逐个处理时，第一个技能已写入 `run_skill_bindings`，第二个才报错，于是一个失败 Run 持有授权记录。现在校验全部通过后才开始建立快照，失败 Run 的绑定记录为空。

2026-09-13 B00-2 已落地：运行约定拆为通用层（`skill-runtime-conventions.ts`）与预设层（`SkillAdapter.runtimeConventions`）。`svg-export` / `template-merge` / `pptx-validate` 等样本专属口径移入 `ppt-generation-preset`，只对该预设匹配的 Skill 生效；通用层负责 `bindingId`、`expectedHash`、work 目录、不自行声明验证状态等对所有带命令 Skill 都成立的契约。命令表每项显式带上 `bindingId` 与 `skillName`，多绑定下模型能寻址到正确 Skill。正文为空的 Skill 不再注入空 system 段。

顺带删除：`SkillExecutionRepository.findLatestBindingByTask`——它只服务隐式继承，没有别的调用方。不保留备用查询：界面需要的是「某任务最近一个 Run 的绑定集合」（多条），不是「最近一条」；到 B00-4 按真实需求重新定义。

## 被否决的方案

- **保留试运行专用入口，对话内不做选择**：能力入口只服务教学演示，与「个人工作台」定位冲突。
- **`/` 斜杠命令为主入口**：可发现性差、IME 冲突、承载不了状态与二级列表（见 §为什么是 `+` 菜单）。
- **多选 UI 但主进程只允许一个生效**：用户会理解为 bug，且与 B02「同一专家两 Skill 共用任务上下文」直接矛盾。
- **`skillIds: string[]` 而不带 `revisionId`**：失去「运行期间不受后续编辑影响」的快照校验。
- **把技能内容拼进 prompt 字符串而不建绑定记录**：绕过信任、依赖与快照，等于放弃 ADR-0010/0011 的全部执行约束。
- **运行中动态增删 Skill**：绑定快照不可回退，热插拔会让已发出的工具调用失去授权依据。

2026-09-12 本轮仅文档修订，未改动任何代码、协议或数据库；此后的代码落地见 §实现进度。
