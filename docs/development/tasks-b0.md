# B0：对话内能力绑定（阶段 B 前置切片）

共同遵守 [执行手册](README.md)、[契约](contracts.md) 与 [ADR-0012](../adr/0012-composer-capability-binding.md)。本组只解决「用户在任务对话里选哪些技能，以及这些选择如何真实进入执行」，不做专家 CRUD、不做附件、不做知识范围过滤。B01–B04 在本组验收后重新评估，其中 B04 的「任务选择 Skill」部分由本组承接。

前置：A13/A14/A15 已完成，A17 的真实样本验收可与本组并行推进但不互为门槛。本组不新增 SQLite 迁移；若实现发现必须迁移，停下回报，先修正 ADR-0012 的成本结论。

串行理由：本组五张卡都触碰 `agent-protocol/src/index.ts`、`run-service.ts` 与 `App.tsx`，按手册 §4 不并行派发。

## B00-1 StartRun 协议与绑定解析改 1:N

- 前置：无（本组起点）。
- 必读：agent-protocol skillBinding/startRunRequest、preload runs.start、RunService resolveBindingId/resolveSkillInstructions/consume、app-schema run_skill_bindings、ADR-0012 §设计落实。
- 目标：一次 Run 携带 1..6 个 Skill 绑定，每个 Skill 独立快照，任一不满足则整个 Run 不启动。
- 允许改动：startRunRequestSchema 字段与类型、preload 签名、RunService 绑定解析与 ActiveRun 结构、register-ipc 相应校验、run-service/protocol/IPC/preload tests。
- 实施：skillBinding 替换为 skillBindings 数组，不保留旧字段；元素按 skillId 去重，保持用户选择顺序；resolveBindingId 返回 bindingIds；每个 binding 独立执行现有启用/信任/修订一致性/资源根校验；工具注册条件由有 binding 改为 bindings 非空；删除无显式绑定时回落 findLatestBindingByTask 的隐式继承。
- 必测：两技能绑定各自生成一条 run_skill_bindings 且 revision/profile/grant 不串；第二个技能未信任时整 Run 失败且错误指明是哪个；重复 skillId 去重；超过 6 项 Schema 拒绝；revisionId 不匹配拒绝；无绑定的普通 Run 行为与工具集不变；取消与终态唯一性不回归。
- 验收：typecheck 与相关测试通过，migrate.test.ts 版本数不变，无新表新列。
- 不做：不改 agent-core（skillInstructions 已是数组）；不改工具入参（已带 bindingId）；不引入 expertId 占位字段。

## B00-2 指令注入顺序与运行约定解耦

- 前置：B00-1。
- 必读：RunService resolveSkillInstructions 现约 L432–L464、skill-adapter、ppt-generation-preset、agent-core engine messages 构造、执行器设计 §6。
- 目标：N 份 Skill 指令按绑定顺序注入，命令表携带 bindingId 与技能名，样本专属约定不再泄漏给其他 Skill。
- 允许改动：RunService 指令组装、SkillAdapter 接口增加 per-skill 运行约定、ppt 预设承接专属段落、相应 tests。
- 实施：每条指令正文前缀 `[Skill: <名称>]`；通用段落保留 task_write_file 写本 Run work 目录、覆盖必须 expectedHash、不得自行声明验证状态、必须使用所给 bindingId；svg-export/template-merge/pptx-validate 等 PPT 口径移入预设，仅对匹配的 Skill 生效；命令表每项显式带 bindingId 与 skillName。
- 必测：两技能同时注入时模型请求里两份指令顺序正确、PPT 段落只出现在 PPT 技能那一份里；单技能路径与 B00-1 前行为等价；Fake Provider 断言 messages 结构；指令为空时不产生空 system 段。
- 验收：Fake Provider 离线断言完整注入结果，不触网。
- 不做：不做上下文预算截断，超限由 B00-1 的显式上限承担；不把指令拼进 user prompt。

## B00-3 受控弹层基座

- 前置：无（与 B00-1/B00-2 可同批但需串行提交）。
- 必读：docs/10 §9.3 Token 契约、§8.1 尺寸、betterwork-ui 规则、现有 ConfirmationDialog 与 ModelEditorSheet 的焦点与背板处理、icons.tsx。
- 目标：一个可复用的受控弹层基座，供 `+` 菜单与后续浮层共用。
- 允许改动：components 目录新增弹层组件与测试、styles.css 新增 Token 化样式、icons.tsx 按需补图标。
- 实施：受控 open 状态；Esc 关闭、点击背板关闭、焦点归还触发元素、方向键与 Home/End 导航列表项、aria-expanded/aria-haspopup/role=menu；定位用 CSS 变量或内联偏移，不引入定位库；样式只消费 overlay、surface-raised、border、selection 与既有阴影 Token，不写 rgba 字面量；命中区不小于 32px。
- 必测：打开后焦点进入首项；Esc 后焦点回到触发按钮；背板点击关闭；键盘可完整选择一项；三档主题与窄屏无溢出；不使用 emoji 或 Unicode 字符作图标。
- 验收：组件测试覆盖键盘与焦点路径；Renderer 组件内不出现 window.betterwork。
- 不做：不抽通用 UI 库，不引入 Radix/Headless UI 等新依赖；不做二级菜单动画体系。

## B00-4 Composer `+` 菜单与 chip 条

- 前置：B00-1、B00-3。
- 必读：App.tsx Composer 现约 L751–L814 与 startRun/selectRun/startNewTask、use-skills hook、SkillsView 试运行接线、docs/10 §7.1/§7.2、ADR-0012 决策 1/2/4/7。
- 目标：用户在任务对话内直接增删技能绑定，界面上始终看得见当前绑定与其状态。
- 允许改动：新增 Composer 能力选择组件与测试、App.tsx 绑定状态与提交接线、use-skills 增加列表读取（不新增 IPC）、styles.css。
- 实施：`+` 按钮一级项为技能、专家（禁用并说明阶段 B 提供）、添加文件（禁用并说明未开放）；技能二级列表带搜索、多选勾选、blockedReasons 置灰与定位入口；已选以 chip 条显示于工作区行与 textarea 之间，替换现有「已选择 Skill：{name}」纯文本；chip 结构含 kind/id/name/status，首版只产 skill；绑定集合按任务维护，切换历史任务读取该任务最近 Run 的绑定集合，新任务从空开始；试运行入口改为写入同一状态，不再另设一套草稿字段。
- 必测：打开草稿试运行后 chip 可见且可移除，移除后提交不带绑定；切换历史任务不残留上一任务选择；提交失败保留 chips；运行中禁止修改绑定并给出可见原因；不可用技能无法勾选；键盘可完成一次选择。
- 验收：App 集成测试覆盖选择、取消、切换任务与提交绑定；真实开发窗口手工走一遍。
- 不做：不做拖拽排序；不做附件；不在 Composer 内提供模型或 Skill 配置入口。

## B00-5 撤销级联与 B0 验收

- 前置：B00-2、B00-4。
- 必读：RunService cancelRunsForSkill、skill-service 撤销与停用接线、ADR-0011 决策 3/5、docs/10 §11.5 反馈路由。
- 目标：多绑定下的信任撤销与停用级联可解释，B0 端到端成立。
- 允许改动：ActiveRun 结构与级联判断、撤销原因文案、通知与过程面板显示、tests。
- 实施：skillId 标量改为 skillIds 数组，相等判断改成员判断；取消原因写明是哪个技能触发了哪次 Run 终止；只影响包含该技能的 Run；撤销不删除已产出成果。
- 必测：两技能 Run 中撤销其一，该 Run 取消且原因指名，另一技能的独立 Run 不受影响；停用其一同理；撤销后新 Run 不能带上该技能并在菜单内显示不可用；活跃 Run 无绑定时撤销任何技能都不误取消。
- 验收：一个真实任务同时绑定两个技能（其中一个是 ppt-generation-expert），完成一次带指令注入的执行，SQLite 中两条 run_skill_bindings 归属同一 runId，过程面板能区分两个技能的工具活动；重启后历史 Run 显示当时的绑定集合。
- 不做：不宣称专家系统可用；不把 Fake 通过当作真实模型验收；不在本组实现知识范围过滤。
