# 算台 UI 一致性评估报告（2026-09-26）

> 历史评估与分期实施记录：其中缺口、数量、别名和“待开工”只对当时基线有效。当前组件与 AI 工作流程查 [UI/UX §10.1](../10-ui-ux-system.md#101-组件台账与基座纪律)，本轮对齐结果见 [2026-10-02 评估](2026-10-02-ui-governance-alignment.md)；不得直接按本报告重建旧组件或扩大任务范围。

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
| EmptyState | **2026-09-26 深夜已收口**（6 处内联占位全部迁入 `EmptyContext`／新增 `EmptyNotice`） | `SettingsView.tsx:156`(`.empty-models`)、`SettingsView.tsx:508` 与 `MemoryView.tsx:463`(`.setting-placeholder`)、`App.tsx:1300`(`.empty-runs`)、`notifications.tsx:244`、`WorkspaceBrief.test`/`DependencyPanel.tsx:162` |
| Switch / Tooltip / Progress / Skeleton | ❌ 未落地 | docs/10 §10.1 落地现状已如实登记 |

---

## 3. 缺陷清单（按严重度）

### 3.1 浮层与模态没有唯一基座 —— 高

同一件事（把内容抬到页面之上并接管焦点）有 4 份实现，能力各不相同：`ConfirmationDialog` 有 inert/Esc/焦点归还，`ModelEditorSheet` 只有 `aria-modal` 外壳，放映层自己写键盘，消息中心连 `aria-expanded` 都没有。**这是“下一次还会自造”的直接原因**：没有可复用的模态基座，每个人只能挑一个最近的抄。

**我自己的一个错误要单独记**：本轮新增的护栏 `OVERLAY_SURFACES`（`standards/coding-standard.test.ts`）把 `.notification-panel`、`.slide-viewer` 等**现状**登记成了白名单。护栏因此只拦“新自造”，把两处**已知缺陷合法化了**。白名单应当是“待收敛的存量 + 基线只降不升”，不是“允许保留”。

→ 归属：新建 `Modal`（含 `Sheet` 变体）基座，收编 `ConfirmationDialog`、`ModelEditorSheet`、放映层、消息中心四处；`PopoverMenu` 继续拥有菜单类浮层。

**2026-09-26 深夜已收口**：`components/Modal.tsx` 落地 `dialog`／`sheet`／`viewer` 三变体，锚定不居中的消息中心复用同文件导出的 `useOverlaySemantics`（只借语义、不借定位）。四处现在共享同一份 inert／Esc／背板关闭／初始焦点／Tab 循环／焦点归还实现；铃铛补上 `aria-haspopup="dialog"` 与 `aria-expanded`，`.sheet-backdrop` 与 `.dialog-backdrop` 两套旧背板类删除，浮层阴影存量棘轮从 6 降到 4（`.modal-panel`、`.popover-menu`、`.toast`、`.action-error-banner`）。新增护栏：渲染层出现 `role="dialog"`／`aria-modal`／`key === 'Escape'`／旧背板类而没接基座即失败（已用探针文件变异验证会红）。

### 3.2 表单控件没有几何 Token —— 中高

9 处原生 `<select>` 与 `FieldSelect` 并存；输入类控件的 padding / 边框 Token / 圆角在 6 个视图里各写一遍。（**2026-09-26 深夜已收口**：`Field` 基座落地、9 处原生下拉清零、37 处字段与 12 条标签几何规则收进基座，见 §5 P1。）后果是同一屏里出现两种高度和两种边框色（知识页搜索框 `10px 12px` + `--border` + 圆角 8，模型抽屉 `8px 9px` + `--input-border` + 圆角 7）。

→ 归属：`Field`（label + 控件 + 提示）与控件几何 Token（`--control-height`、`--control-padding`、`--control-radius`）。

### 3.3 Tabs 语义三套 —— 中

`ContextPanel.tsx:203,215` 有 `role="tablist"/"tab"` + `aria-selected`，语义角色正确，但**同样缺 roving tabindex 与左右方向键**（WAI-ARIA 页签模式要求方向键切换、Tab 只进出页签列表）；`MemoryView.tsx:491-497` 此前更严重——在普通 `<button>` 上写 `aria-selected` 而无 `role="tab"`，该属性对这个角色无效，读屏不会播报选中态（2026-09-26 晚已补 `role="tablist"/"tab"`）。`SkillsView.tsx:154` 的 `role="group"` + `aria-pressed` 是视图模式切换，语义上属于另一类（切换按钮组），**不算错**，但应当显式命名这个模式而不是每次重新发明。（**2026-09-26 深夜已收口**：`components/Tabs.tsx` 落地 `Tabs`（roving tabindex + 方向键 + Home／End）与 `SegmentedControl` 两个基座，记忆页、任务上下文、技能页三处已收编；护栏锁「写了页签语义却没接基座」与「选中态样式长在页面选择器上」。）

→ 归属：`Tabs` 基座（tablist + roving tabindex + 方向键）；`SegmentedControl` 基座（group + aria-pressed）。

### 3.4 行卡片 9 套、chip 6 套 —— 已收口（2026-09-27，`Badge` ＋ `ListRow`）

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

→ 归属：`ListRow`（左槽/主区/右槽 + 分隔线模式）与 `Badge`。（**2026-09-26 深夜 `Badge` 半边已收口**：`components/Badge.tsx` 落地 `tone` × `shape`，技能卡状态片、依赖面板环境片、记忆状态片、MCP 工具名片合并；`.skill-chip`／`.dependency-status-chip`／`.memory-status-badge` 三条类样式删除并由护栏锁死不得复活。）（**2026-09-27 清晨 `ListRow` 半边收口**：`components/ListRow.tsx` 落地 `divider`／`card`／`plain` 三档 + 六个槽位，上表 9 类连同 `.completed-work-card`／`.context-row`／`.suggestion-job-row` 共 12 类行几何并入一处，`.model-main`／`.memory-actions`／`.knowledge-card-actions` 之类的主区与右槽规则同时删除；护栏锁「12 个已收编类不得复活」「行的 `gap`／`padding` 只能由 `.list-row*` 自己的选择器声明」与「留在行上的领域钩子不得再写行骨架」三条。本表之外的 `-row`（如 `.activity-row`、`.knowledge-revision-row`、`.artifact-version-list button`）不是「图标 + 标题 + 右动作」这一种结构，未纳入本轮，留下轮。）

### 3.5 视觉刻度没有 Token —— 中

`styles.css` 实测（本轮改造前）：`min-height` 21 种取值（控件档混用 23/25/26/28/29/30/32/34/36/40）、`border-radius` 12 种（5/6/7/8/9/10/12/999/4/3/50%/0）、`z-index` 10 种且无层级表、焦点环**两种**写法（`outline: 2px solid var(--focus-ring)` ×8、`outline: 1px solid var(--focus-ring)` ×1）。另有 `.text-button` 在 654 与 974 **重复定义两次**：后者覆盖高度与背景、前者留下边框，实际渲染成"带边框的 25px 小胶囊"，既不是文字按钮也不是次级按钮，且没有任何报错。

> 核实修正：初稿把 `box-shadow: 0 0 0 4px var(--brand-soft)` 的 3 处也算作焦点环，**不成立**——它们位于 `.abacus i`、`.status-dot.running`、`.activity-row.running .activity-marker`，是状态点的脉冲光晕，不是聚焦指示。

**2026-09-26 晚已收口的部分**：控件几何 50 处声明改取 `--control-*` 档位（表单控件裸值残留 0，`.primary-button` 补上 36px 一档的消费者）、焦点环统一为一种写法、`z-index` 13 处全部改取 `--z-*` 档位、`.text-button` 合并为单一定义；四项均加护栏并做变异验证。仍待收口的是密集控件与行高的 23–40px 档位（裸值残留 30 处）与卡片/徽标圆角（见 §5 P2）。

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

**P0（先止血并建立台账）——2026-09-26 晚已完成 5/5（页签方向键并入 P2 的 `Tabs` 基座）**

- ✅ `OVERLAY_SURFACES` 改为**棘轮基线** `OVERLAY_SHADOW_BASELINE = 6`：只许降不许升，降了必须同步改小基线；`.notification-panel` 与 `.slide-viewer` 的 reason 改成「待迁入 Modal 基座」，不再是"合法浮层"。
- ✅ 护栏四条：`z-index` 必须取 `--z-*` 档位；焦点环只允许一种写法；表单控件的边框/圆角/高度必须取 `--control-*`；独立类选择器不得被拆成两处并写出冲突值。每条都做过变异验证。
- ✅ 控件几何落地：新增 `--control-*` 与 `--z-*` 档位表，50 处迁移（含 `.primary-button` 补上 36px 档的消费者），`.text-button` 合并为单一定义；docs/10 新增 §9.10 控件几何与浮层字号、§9.11 叠放层级。
- ✅ 组件台账表已落进 docs/10 §10.1（组件名 → 路径 → 用途 → 状态：已落地/缺位/待迁入），「写 UI 交互前先查台账」已写进 `.qoder/rules/betterwork-ui.md` 第一条。
- ✅ 快改：`MemoryView` 页签补 `role="tablist"/"tab"` 与 `aria-selected`，回归断言见 `MemoryView.test.tsx`。方向键与 roving tabindex 未做——`ContextPanel` 的任务上下文页签同样缺这两项，两者一起等 P2 的 `Tabs` 基座收口，避免在两个页面各写一遍键盘逻辑。

**P1（2–3 天，补最缺的两个基座）——2026-09-26 深夜两项均完成**

- ✅ `Modal`（含 `sheet` 变体）基座：inert + 焦点陷阱 + 归还 + Esc + `aria-modal`，从 `ConfirmationDialog` 抽出；已迁移 `ConfirmationDialog`、`ModelEditorSheet`、放映层、消息中心四处，**消息中心的 `aria-haspopup`/`aria-expanded` 一并补齐**（锚定面板走 `useOverlaySemantics`，不套居中外壳）。
- ✅ `Field` 基座落地（`components/Field.tsx`：标签 + 控件 + 说明，`controlId` 走 `htmlFor`，否则整个 `Field` 就是 `<label>`）；9 处原生 `<select>` 全部迁 `FieldSelect`（为此给 `FieldSelect` 补上不可选项、禁用触发器与 `id`）。顺手把 37 处字段统一改用 `Field`，删掉 12 条页面级 `label { gap / font-size }` 规则（模型抽屉、搜索设置、MCP 编辑器、专家编辑器、记忆编辑与捕获、成果编辑器、依赖面板、讨论检查点、记忆冲突行），删除对应的页面级规则与 6 条已死的 `select` 样式。护栏两条：渲染层出现 `<select>`／`<option>` 即失败；除登记过的两条勾选行外，`label` 选择器写 `gap`／上下 `margin` 即失败（均用探针文件做过变异验证）。交互语义测试见 `components/Field.test.tsx`。

**P2（3–5 天，收重复结构）**

- ✅ `ListRow` 基座（2026-09-27 收口）：`components/ListRow.tsx` 落地三档外壳（`divider`／`card`／`plain`）+ 六个槽位（`leading`／`title`／`detail`／`meta`／`actions`／`trailing`）＋整行可点（`onClick` → 单个 `<button>` + `label`，`selected` → `aria-current`）；§3.4 的 9 套行几何连同 `.completed-work-card`／`.context-row`／`.suggestion-job-row` 共 12 类逐类迁移，页面侧的主区／右槽规则（`.model-main`、`.memory-actions`、`.knowledge-card-actions`、`.knowledge-job-actions` 等）与 `.current-badge` 一并删除（后者改走 `Badge`）。语义测试见 `components/ListRow.test.tsx`，护栏三条见 `standards/coding-standard.test.ts`「列表行基座纪律」。
- ✅ 档位与棘轮（2026-09-27 收口，产品已拍板并档）：圆角立成 `--radius-tag 5 / --control-radius 6 / --radius-row 8 / --radius-card 10 / --radius-surface 12 / --radius-pill 999 / --radius-circle 50%` 七档，样式表 150 处裸圆角换成档位（7→8、9→10 是有意并档），3–4px 的 5 处微标按 `MICRO_MARK_RADII` 只降不升；密集高度 26→28、30→32、34→`--row-height`、23→`--row-height-sm`，24–40px 带内裸值清零，唯一例外是 `.expert-card-desc` 的两行文本钳制。护栏由「清单」升级为「零容忍」。
- ✅ 空态全部走 `EmptyState`：6 处内联占位收编（区域级 `EmptyContext` 加 `icon` 参，行内与小节级新增 `EmptyNotice` 的 line／block 两变体），四个自造占位类的样式删除并由护栏锁死不得复活。行内加载提示（如「正在计算依赖计划…」）留在 `muted-text` 状态行，不塞进空态块——它表达的是「正在忙」而不是「这里没有东西」。
- ✅ `Tabs` / `SegmentedControl` 分两个基座落地（同在 `components/Tabs.tsx`），`Tabs` 自带左右方向键与 roving tabindex，一次性收掉 `MemoryView` 与 `ContextPanel` 两处页签；`SkillsView` 的视图模式切换也显式收进 `SegmentedControl`。密集高度顺带收了两条：页签与切换组的 29／30px 裸值改取 `--control-height-sm`，圆角改取 `--control-radius`。

**P3（持续）**

- ✅ 附带发现已修（2026-09-26 21:15，光哥拍板）：`npm test` 里三个**墙钟预算门**（KM14 向量扫描 p95、`memory-retrieval` 1,000 条排序、office-parser 解压预算）在 137 个文件并发跑时随机红。现在计时断言只住在 `*.bench.test.ts`，由 `npm run bench` 串行跑（`fileParallelism: false`），`verify` 只跑功能档；阈值一格没放宽，样本值每次照旧打印，护栏锁「功能档里不得出现 `performance.now()`」。office-parser 那项测的是压缩炸弹边界、不是耗时，因此留在功能档、只把**夹具超时**放宽到 180 秒（安静机实测约 4 秒）。串行档实测 KM14 p95 303ms／基准总耗时 9.3 秒，功能档 12.9 秒全绿。口径见 docs/12 §1、§9。

- `views/` 里重复的领域卡片下沉到 `components/`；`SettingsView`/`SkillsView`/`ExpertsView` 补齐 `components/layout/` 骨架。
- 每个新基座必须带一个交互语义测试（Esc 能关、焦点能归还、方向键能走），照 Cloud 的 `agent-picker.test.tsx` 那条断言写。

**明确不做**：不引入 Tailwind / shadcn / Radix 等外部组件体系（我们的 Token 与零豁免口径已成型，换栈等于重做）；不做 Storybook（台账表 + 同目录测试已覆盖它的价值）；不为“以后可能需要”提前抽象——P1/P2 的每个基座都有本报告里的重复计数作为依据。

---

## 6. 核实修正（记录两条不成立的调研结论）

1. 调研称「违规小字号 9px×2、10px×4」。**不成立**：这 6 处分别是 `.brand small`(373)、`.current-badge`(2484)、`.knowledge-format`(3859)、`.completed-work-icon.markdown`(4130)、`.completed-work-icon.file`(4135)、`.notification-badge`(5184)，全部落在 docs/12 §8 声明的图形化标识豁免内，且字号护栏通过。
2. 调研称「知识卡片更多菜单仍需修复」。实际本轮已迁入 `PopoverMenu` 并落地护栏，只是尚未提交。

（另有一处口径修正：`SkillsView.tsx:154` 的 `role="group"` + `aria-pressed` 用于视图模式切换，语义正确，不计入缺陷；真正的缺陷只有 `MemoryView.tsx:496` 的 `aria-selected` 无宿主角色。）
