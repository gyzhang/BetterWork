# 算台 UI 一致性评估报告（2026-09-26）

评估范围：`apps/desktop/src/renderer/src/`（14 个视图与组件文件族、单一样式表 `styles.css`）。方法：全仓只读扫描 + 逐条人工核实（本报告里每条结论都有可核对的 file:line；调研子代理给出的两处判断经核实**不成立**，已在文末「核实修正」中记录）。参考对照：ClawBible Cloud 前端（`/Users/kevin/Dev4AI/ClawBible.AI/clawbible-cloud/frontend/`）。

---

## 1. 结论：反复自造不是纪律问题，是基座覆盖不全

产品负责人的质疑是「为什么你总要自造 UI 组件」。诚实的答案分三层：

1. **仓库只有 4 个真正的共享基座**：`PopoverMenu`、`ConfirmationDialog`、`FieldSelect`、`components/layout/`（4 个骨架组件）。docs/10 §10.1 自己列出的 17 个基础组件里，**Tabs、Select、Dialog/Sheet、Switch、Tooltip、Progress、Skeleton 都没有基座**。
2. **没有基座时，人会就近模仿最近的例子**。「更多」菜单当初就是照 `ContextPanel` 里的 `<details>` 内联披露抄的——`<details>` 在文档流内做折叠是对的，搬到脱离文档流的浮层上就同时丢了背板、Esc、焦点归还和字号契约。**一次“看起来像”的模仿产出了三个真实缺陷**。
3. **约束的承载方式错了**：我们把 UI 规则写进文档，但只有极少数有护栏（间距、色值、字号、动效有；浮层、控件几何、层级没有）。文档不阻塞 PR，护栏才阻塞。

> 推论：**先补基座和门禁，再谈纪律**。只加规范文字不会改变结果。

---

## 2. 组件台账：声明 vs 落地

| docs/10 §10.1 声明的基础组件 | 现状 | 证据 |
| --- | --- | --- |
| Button | 无组件，12 个 `*-button` 类各写 | `.primary-button` `.secondary-button` `.text-button` `.danger-confirm-button` `.back-button` `.open-source-button` `.knowledge-more-button` `.refresh-knowledge-button` `.knowledge-research-button` `.sidebar-collapse-button` `.evidence-open-button` `.expert-summon-button` |
| Input / Textarea | 无组件，几何值逐视图定义 | `styles.css` 中 `padding` 至少 6 套：`7px 8px` / `9px 10px` / `7px 9px` / `6px 9px` / `10px 12px` / `8px 9px`；边框 Token 三套 `--border` / `--border-subtle` / `--input-border` |
| Select | **基座已有，仍 9 处用原生 `<select>`** | `ModelEditorSheet.tsx:56`、`DiscussionCheckpointPanel.tsx:108`、`ComposerCapabilityPicker.tsx:280`、`skills/DependencyPanel.tsx:65,95,122`、`SettingsView.tsx:315`、`ExpertsView.tsx:320`、`MemoryView.tsx:970`；`FieldSelect` 只有 3 个消费者 |
| Popover / Menu | ✅ 基座 `PopoverMenu`，4 个消费者 | `WorkspaceSelector`、`FieldSelect`、`ComposerCapabilityPicker`、`KnowledgeDocumentCard`（2026-09-26 迁入） |
| Dialog / Sheet | **三套实现，只有一套有完整无障碍** | 正例 `ConfirmationDialog.tsx:26-39`（inert + 焦点落取消 + 归还 + Esc）；`ModelEditorSheet.tsx:26-30` 有 `role=dialog`/`aria-modal` 但**无 Esc、无焦点陷阱与归还**；`ArtifactView.tsx:678-699` 放映层第三套，自写 Esc 与左右键 |
| 消息中心浮层 | **自造，且缺语义** | `notifications.tsx:225-227`：`.notification-overlay` + `.notification-panel role="dialog"`，触发器**无 `aria-haspopup`/`aria-expanded`**，全文件无 Escape 分支、无焦点管理 |
| Tabs | 三套语义（见 §3.3） | `ContextPanel.tsx:203,215` 正确 `role=tablist/tab`；`MemoryView.tsx:496` 只有 `aria-selected` 无 role |
| Toast | ✅ 两套且职责已分（`TransientToast` / `ToastHost`），有护栏 | docs/10 §11.5.1、`SkillsView.test.tsx` |
| EmptyState | 基座已有，**6 处绕开** | `SettingsView.tsx:156`(`.empty-models`)、`SettingsView.tsx:508` 与 `MemoryView.tsx:463`(`.setting-placeholder`)、`App.tsx:1300`(`.empty-runs`)、`notifications.tsx:244`、`WorkspaceBrief.test`/`DependencyPanel.tsx:162` |
| Switch / Tooltip / Progress / Skeleton | ❌ 未落地 | docs/10 §10.1 落地现状已如实登记 |

---

## 3. 缺陷清单（按严重度）

### 3.1 浮层与模态没有唯一基座 —— 高

同一件事（把内容抬到页面之上并接管焦点）有 4 份实现，能力各不相同：`ConfirmationDialog` 有 inert/Esc/焦点归还，`ModelEditorSheet` 只有 `aria-modal` 外壳，放映层自己写键盘，消息中心连 `aria-expanded` 都没有。**这是“下一次还会自造”的直接原因**：没有可复用的模态基座，每个人只能挑一个最近的抄。

**我自己的一个错误要单独记**：本轮新增的护栏 `OVERLAY_SURFACES`（`standards/coding-standard.test.ts`）把 `.notification-panel`、`.slide-viewer` 等**现状**登记成了白名单。护栏因此只拦“新自造”，把两处**已知缺陷合法化了**。白名单应当是“待收敛的存量 + 基线只降不升”，不是“允许保留”。

→ 归属：新建 `Modal`（含 `Sheet` 变体）基座，收编 `ConfirmationDialog`、`ModelEditorSheet`、放映层、消息中心四处；`PopoverMenu` 继续拥有菜单类浮层。

### 3.2 表单控件没有几何 Token —— 中高

9 处原生 `<select>` 与 `FieldSelect` 并存；输入类控件的 padding / 边框 Token / 圆角在 6 个视图里各写一遍。后果是同一屏里出现两种高度和两种边框色（知识页搜索框 `10px 12px` + `--border` + 圆角 8，模型抽屉 `8px 9px` + `--input-border` + 圆角 7）。

→ 归属：`Field`（label + 控件 + 提示）与控件几何 Token（`--control-height`、`--control-padding`、`--control-radius`）。

### 3.3 Tabs 语义三套 —— 中

`ContextPanel` 是正确实现；`MemoryView.tsx:491-497` 在普通 `<button>` 上写 `aria-selected` 而无 `role="tab"`，这个属性对该角色无效，读屏软件不会播报选中态，也没有左右键切换。`SkillsView.tsx:154` 的 `role="group"` + `aria-pressed` 是视图模式切换，语义上属于另一类（切换按钮组），**不算错**，但应当显式命名这个模式而不是每次重新发明。

→ 归属：`Tabs` 基座（tablist + roving tabindex + 方向键）；`SegmentedControl` 基座（group + aria-pressed）。

### 3.4 行卡片 9 套、chip 6 套 —— 中

「图标/徽标 + 标题 + 副文本 + 右侧动作」这一种结构有 9 份独立几何：

| 类 | gap | padding | radius |
| --- | --- | --- | --- |
| `.run-item` | 4 | 8px 9px | 7 |
| `.skill-list-item` | 12 | 12px 16px | 10 |
| `.model-row` | 12 | 16px 4px | — |
| `.memory-row` | 16 | 16px 4px | — |
| `.evidence-row` | 8 | 10px 2px | — |
| `.knowledge-job-row` | 12 | — | — |
| `.notification-item` | 12 | 11px 14px | — |
| `.mcp-connection-row` | 8/16 | 16px 4px | — |
| `.knowledge-card` | 12 | 15px 3px | — |

这些差异没有一条来自业务需求，全部是逐页现写的结果。`styles.css` 里把多个选择器并列以复用同一条声明的写法（如 `.knowledge-search, .memory-search`）就是“各写一遍”的自证。

→ 归属：`ListRow`（左槽/主区/右槽 + 分隔线模式）与 `Badge`。

### 3.5 视觉刻度没有 Token —— 中

`styles.css` 实测：`min-height` **21 种**取值（控件档混用 23/25/26/28/29/30/32/34/36/40）、`border-radius` **12 种**（5/6/7/8/9/10/12/999/4/3/50%/0）、`z-index` **10 种且无层级表**、焦点环 **3 种写法**（`outline: 2px solid var(--focus-ring)` ×6、`outline: 1px` ×1、`box-shadow: 0 0 0 4px var(--brand-soft)` ×3）。另有 `.text-button` 在 654 与 974 **重复定义两次**。

### 3.6 页面骨架未全覆盖 —— 中

`SettingsView.tsx`（623 行）对 `PageHeader` / `PageToolbar` / `ScrollRegion` / `ViewContainer` 的使用数为 **0**；`ExpertsView.tsx`、`SkillsView.tsx` 未用 `ScrollRegion`；`MemoryView.tsx` 未用 `PageHeader`。docs/10 §8.3 要求“所有主内容页共用同一页面骨架”，设置类页面是声明过的特例，但技能/专家页不是。

---

## 4. 对照 ClawBible Cloud：借什么、不借什么

它更规范的地方（值得直接借）：

1. **组件台账 + 铁律**：`.qoder/rules/cloud-ui.md` §3「写任何 UI 交互前必须先搜 `components/` 确认是否已有封装」，并给出四级组件层级图。可核对、可执行，比散落的形容词有效。
2. **棘轮（ratchet）**：`frontend/scripts/check-ui-conventions.mjs` 用 `H_SCREEN_BASELINE = 6` 记录存量违规数，**只许降不许升，降了要求收紧基线**。这是我们处理 §3.4/§3.5 这类“存量不一致”的正确手法——白名单不该是永久豁免，而是待收敛的基线。
3. **把唯一入口做成编译期事实**：`eslint.config.js:172-200` 按 app 边界配 `no-restricted-imports`，Toast 只有两个文件能 import 库。我们的 `reportAction`/`trackAction` 收口是同一思路，可以推广到浮层与控件。
4. **圆角单源派生**：`--radius: 0.625rem` 乘系数生成 7 档，比逐档写死更适合多色系扩展。
5. **组件与测试同目录**，且直接断言交互语义（它的 `agent-picker.test.tsx:106` 测「Escape 能关闭浮层」）。我们的浮层护栏应当照此补断言。

它不对、**不要照搬**的地方：

1. **它的 §17 把一次集成失败写成了铁律**：「Dialog 内禁用 Popover，改用 state + absolute 手搓」→ 结果 `apps/admin/src/components/pickers/` 下 7 份逐字相同的外点关闭逻辑（`dept-picker.tsx:125-133` 与 `model-picker.tsx:136-145`），且都没有焦点陷阱与归还。**这和我们的 `<details>` 缺陷是同一类，只是被制度化并放大了**。我们应反向做：加固基座让它能在 Dialog 内使用。
2. **规范与门禁严重不对称**：366 行规范，机械校验只有 1 条棘轮；§10 禁止清单里的裸 `<select>`、手写遮罩弹窗没有任何脚本覆盖。
3. **Token 只有半套**：颜色和圆角有，间距/字号/阴影/动效没有 → `button-variants.ts:20` 里 `text-[0.8rem]`（12.8px）与 `h-6/h-7/h-10/h-11` 混排。我们已有 gap 档位护栏与 12px 字号下限，**不能退化**。
4. **基座不统一**：Tooltip/Slot 用 Radix，其余用 Base UI；行为差异靠人记。
5. **豁免泛滥**：70 处 `eslint-disable`、`no-explicit-any: warn`，与其 AGENTS.md「禁止 any」矛盾。我们源码零豁免的口径更严，保持。

---

## 5. 改进建议（分四期，每期都要带门禁）

**P0（1 天，先止血并建立台账）**

- 把 `OVERLAY_SURFACES` 从“允许清单”改成**棘轮基线**：记录当前数量，只许降；同时把 `.notification-panel`、`.slide-viewer` 标注为「待迁入 Modal 基座」而不是「合法浮层」。
- 新增护栏：`z-index` 取值必须来自层级表；焦点环只允许一种写法；`.text-button` 去重。
- 在 docs/10 §10.1 建**组件台账表**（组件名 → 文件路径 → 用途 → 状态：已落地/缺位/待迁入），并把「动手写 UI 交互前先查台账」写进 `.qoder/rules/betterwork-ui.md` 第一条。
- 快改：`MemoryView` 页签补 `role="tablist"/"tab"` 与方向键，或改用新 `Tabs`。

**P1（2–3 天，补最缺的两个基座）**

- `Modal`（含 `Sheet` 变体）基座：inert + 焦点陷阱 + 归还 + Esc + `aria-modal`，从 `ConfirmationDialog` 抽出；迁移 `ModelEditorSheet`、放映层、消息中心四处。**消息中心顺带补齐 `aria-haspopup`/`aria-expanded`**。
- `Field` + 控件几何 Token（`--control-height` / `--control-padding` / `--control-radius` / `--control-border`），9 处原生 `<select>` 迁到 `FieldSelect`，并加护栏禁止裸 `<select>`。

**P2（3–5 天，收重复结构）**

- `ListRow` 与 `Badge` 基座，按 §3.4 的表逐类迁移；`min-height` 与 `border-radius` 建档位表并加棘轮。
- 空/加载态全部走 `EmptyState`；`Tabs` / `SegmentedControl` 分两个基座落地。

**P3（持续）**

- `views/` 里重复的领域卡片下沉到 `components/`；`SettingsView`/`SkillsView`/`ExpertsView` 补齐 `components/layout/` 骨架。
- 每个新基座必须带一个交互语义测试（Esc 能关、焦点能归还、方向键能走），照 Cloud 的 `agent-picker.test.tsx` 那条断言写。

**明确不做**：不引入 Tailwind / shadcn / Radix 等外部组件体系（我们的 Token 与零豁免口径已成型，换栈等于重做）；不做 Storybook（台账表 + 同目录测试已覆盖它的价值）；不为“以后可能需要”提前抽象——P1/P2 的每个基座都有本报告里的重复计数作为依据。

---

## 6. 核实修正（记录两条不成立的调研结论）

1. 调研称「违规小字号 9px×2、10px×4」。**不成立**：这 6 处分别是 `.brand small`(373)、`.current-badge`(2484)、`.knowledge-format`(3859)、`.completed-work-icon.markdown`(4130)、`.completed-work-icon.file`(4135)、`.notification-badge`(5184)，全部落在 docs/12 §8 声明的图形化标识豁免内，且字号护栏通过。
2. 调研称「知识卡片更多菜单仍需修复」。实际本轮已迁入 `PopoverMenu` 并落地护栏，只是尚未提交。

（另有一处口径修正：`SkillsView.tsx:154` 的 `role="group"` + `aria-pressed` 用于视图模式切换，语义正确，不计入缺陷；真正的缺陷只有 `MemoryView.tsx:496` 的 `aria-selected` 无宿主角色。）
