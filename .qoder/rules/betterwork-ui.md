---
trigger: glob: apps/desktop/src/renderer/**/*.tsx,ts,css
---

# Renderer UI 与主题纪律

设计真相源是 [docs/10-ui-ux-system.md](../../docs/10-ui-ux-system.md)；变更核心信息架构或视觉语言前先更新该文档。

- **写 UI 交互前先查组件台账**（docs/10 §10.1）：已有基座必须复用；缺基座时先补基座再接页面，不得就地自造同类控件。绕过台账的代价已经发生过一次——用 `<details>` 手搓「更多」菜单，结果点外面不收起、能同开两个、菜单字号比自己的触发按钮还大。
- **纵向堆叠不得贴死**：同一容器里上下相邻的控件/表单/提示/卡片之间必须有可见垂直间距；间距由容器的 `gap` 拥有，子元素不自带上下 `margin` 凑同一道缝。`components/layout/` 骨架容器必须自带 `display` + `gap`，页面不得用后代选择器替骨架补 `gap`；表单控件不写 `width:100%`（在弹性行里会挤到同排标签逐字断行）。护栏见 `standards/coding-standard.test.ts`，理由见 docs/10 §9.8。
- **新增/修改页面必须复用统一页面骨架**（docs/10 §8.3：`.page-header` 页头带 + `.page-body` 860px 版心）：禁止页面自定版心宽度、页头结构或标题坐标；工作视图的对话列与输入框必须同宽。
- **只用语义化主题 Token**（定义于 `apps/desktop/src/renderer/src/appearance.ts` 与 `styles.css`）：禁止新增硬编码色值，禁止用局部 `.dark` 补丁绕过 Token 契约。建立新 Token 时必须当场迁移所有相关硬编码值，不留半套。
- 外观由两个维度组成：`system / light / dark` 模式 × 可扩展色系；每套正式色系必须同时提供浅色与深色 Variant。
- **应用主题不得改变 Artifact 自身的文档、演示、表格或图表配色**。
- 中文体验优先；正文和常规控件禁止用 9–10px 小字号换取空间，优先折叠、覆盖和响应式重排。`<small>` 已有 12px 全局基线，组件只在此之上放大，不再逐处补 `font-size`。
- `gap` / `row-gap` / `column-gap` 的像素取值只能是 4 / 8 / 12 / 16 / 24 / 32 六档，由护栏强制；要加档位先改 docs/10 §9.8。
- **界面功能图标一律使用内联 SVG 描边图标**（图标集在 `apps/desktop/src/renderer/src/icons.tsx`，`currentColor`、统一 24 网格与笔画粗细）：禁止用 Unicode 字符或 emoji 充当系统操作、导航、按钮等界面图标；新增图标先进图标集再使用，品牌字标与格式徽标（MD/PDF）除外。
- **浮层一律复用 `PopoverMenu` 基座**（docs/10 §10.1）：下拉、菜单、选择器不得用 `<details>` 或 `position:absolute` 面板自造；菜单字号由基座镜像触发控件，破坏性菜单项用 `tone: 'danger'`。护栏锁「`.popover-menu-item` 不自带字号」与「overlay 阴影只允许登记过的浮层表面」。
- **空态一律用 `EmptyContext`（区域级，可换图标）或 `EmptyNotice`（行内与小节级）**（`components/EmptyState.tsx`，docs/10 §10.1）：不得再写 `.empty-*`／`.setting-placeholder` 之类的自造占位类。
- **状态徽标一律用 `Badge`**（`components/Badge.tsx`，docs/10 §10.1）：只读状态文字用 `tone` × `shape` 表达，不得再写 `*-chip`／`*-badge` 自造一套外观；圆角一律取 `--radius-*`／`--control-radius` 档位，24–40px 高度一律取 `--control-height-*`／`--row-height-*` 档位；带内裸值已清零，例外（文本钳制高度、3–4px 微标）按清单只降不升。
- **页签一律用 `Tabs`、切换按钮组一律用 `SegmentedControl`**（`components/Tabs.tsx`，docs/10 §10.1）：`tablist`／`tab`／`aria-selected`、roving tabindex 与左右方向键只有一份实现，页面不得再手拼；选中态样式只住在 `.tabs` 与 `.segmented-control` 上。
- **表单字段一律用 `Field` 基座、下拉一律用 `FieldSelect`**（docs/10 §10.1）：标签 + 控件 + 说明的纵向结构只有一份，页面不得再写 `label { gap / font-size }` 各调一遍；需要说明文字时给 `controlId` 走 `htmlFor` 关联。原生 `<select>` 已全仓清零，不得回归——它的弹层由系统绘制，字号与暗色都脱离 Token。护栏锁「渲染层出现 `<select>`／`<option>`」与「`label` 选择器自带 gap／margin」。
- **区块头一律用 `SectionHeader` 基座**（`components/SectionHeader.tsx`，docs/10 §10.1）：「小标题（可带 eyebrow）＋ 一句说明 ＋ 右槽动作」用 `title`／`hint`／`eyebrow`／`actions` 四个槽表达，层级由 `block`（页面区块，h2）与 `panel`（面板小节，h3）两档决定；不得再用 `<strong>` 冒充标题，也不得在页面里手写 `section-header*` 槽位类。面板自己的内缩与分隔线写在传进 `className` 的领域钩子类上，不写 `.某面板 .section-header { padding }`；右槽按钮自带皮（三档主皮之外的 `.chip-button`／`.quiet-button`），不得靠容器后代选择器发外观。护栏锁三条，见 `standards/coding-standard.test.ts`「区块头基座纪律」。
- **一次就地动作的 busy 态一律用 `AsyncButton`，独立加载行一律用 `InlineLoading`**（`components/AsyncButton.tsx`，docs/10 §10.1）：`disabled`、`aria-busy` 与文案切换由基座一次负责，页面不再写 `busy ? '正在保存…' : '保存'`；只渲染当前那一行文字，两份标签叠占位会把 busy 文案读进可及名称。spinner 只有一枚 `.spinner`，不得再写第二套 `@keyframes`。
- **只装一个图标的按钮一律用 `IconButton`，一排「主按钮＋取消」一律用 `ActionBar`**（docs/10 §10.1）：图标按钮的 `label` 必填，方块只有 `sm` 23px／`md` 28px 两档，不得写 `<button><XIcon /></button>` 也不得靠 `.某容器 button` 发外观；`ActionBar` 把说明钉在左、主行动钉在最右，`children` 按视觉顺序给按钮，并带 `role="group"` 与动作条名称——「取消」一律排在主行动左侧。
- **纵向导航一律用 `NavList`／`NavItem`，切换同一块内容的视图用 `SegmentedControl`**（docs/10 §10.1）：「当前在哪一项」走 `aria-current`（或 `aria-pressed`），不得再用 `className={当前 ? 'active' : ''}` 表达选中；`NavList` 的 `label` 必填，窄栏折叠只换 `--nav-item-*` 自定义属性、不重述几何，文字用 `clip-path` 收掉而不是 `font-size: 0`。护栏锁「已收编导航类不得复活」「`.nav-item`／`.nav-list` 的几何只住在基座」「生产代码的 `className` 里不再出现 `active`」。
- **列表行一律用 `ListRow` 基座**（`components/ListRow.tsx`，docs/10 §10.1）：「图标／徽标 + 标题 + 说明 + 次要信息 + 右侧动作」用 `leading`／`title`／`detail`／`meta`／`actions`／`trailing` 槽位表达，外壳只取 `divider`／`card`／`plain` 三档；结构特殊的行把额外内容作为 `children` 交进主区，不得另起一套行几何。整行可点时给 `onClick` + `label`（此时 `actions` 里不能再放按钮），选中走 `selected`，降饱和走 `tone="muted"`／`disabled`；行内文字的字号（标题 13、说明与 meta 12）也只在基座写。护栏锁「§3.4 那 12 个已收编类的样式不得复活」「行的 `gap`／`padding` 只能由 `.list-row*` 自己的选择器声明」与「留在行上的领域钩子类不得再写行骨架」。
- **布尔设置一律用 `Switch`，多选／全选留原生 `checkbox`**（`components/Switch.tsx`，docs/10 §10.1）：「这一项是开还是关」与「这些项里勾了哪几个」是两种事实，不得为了观感统一互相塞。开关的 `label` 是**恒定名称**，状态走 `aria-checked`——禁止再用「开启 X／关闭 X」的按钮文案翻转充当开关（那会让可及名称随状态改变）。需要确认才能改的状态仍由页面弹确认框，未确认前开关保持原状态：开关只负责表达与触发，不接管确认流程。
- **只读状态片一律用 `Badge`；连接状态用 `ConnectionStatus`**（`components/ConnectionStatus.tsx`，docs/10 §10.1）：`Badge` 的 `tone` 缺某一档（如「成好」）时**补档**，不得回头写「按状态改字色」的领域规则——`Badge` 管外观、tone 表管语义色、页面管措辞，三层各只在一处。
- **卡片描述一律三行定高，截断处交给 `Tooltip` 补全**（`components/Tooltip.tsx`，docs/10 §10.1）：一行也占满三行的高度，卡片才真正等高；`Tooltip` 只在锚点**真的被裁切**时出现，没裁切就不弹——短描述悬停弹一句全文，读起来像控件坏了。不得用 CSS `::after` 或 `title` 属性自造提示。
- **同一块内容的卡片／列表切换一律用 `ViewContainer` ＋ `SegmentedControl`，模式偏好走 `hooks/use-view-mode.ts`**（docs/10 §10.1）：读写与 storage 兜底只有一份，每页用自己的 storage key；不得在页面里再写一遍 `localStorage.getItem` 读模式。
- **模态与覆盖层一律复用 `Modal` 基座**（docs/10 §10.1）：夺走整页焦点的表面用 `components/Modal.tsx` 的 `dialog`／`sheet`／`viewer` 三变体；锚定在触发器局部的覆盖层（消息中心）用同文件的 `useOverlaySemantics`，只借语义不借定位。inert、Esc、背板关闭、初始焦点、Tab 循环、焦点归还、`aria-modal` 全仓只有一处实现，页面里不得再写一遍；触发元素必须带 `aria-haspopup="dialog"` 与 `aria-expanded`。护栏拦「出现 `role="dialog"`／`aria-modal`／`key === 'Escape'` 却没接基座」的情况。模态内可以开 `PopoverMenu`：层级上浮层高于模态，Esc 被浮层吃掉时模态不关，焦点在浮层里时面板 Tab 循环不抢焦点——这三件事都由基座负责，页面不得自己补。
- **一条发言与任务输入区一律走 `MessageBlock`／`Composer`**（docs/10 §10.1）：气泡的发言者标签、正文排版与**就地动作**是一个块——动作住在气泡外面时只能靠负 margin 追回下缘，那条负 margin 记录的是「这两块本来属于同一件事」这个没写下来的事实。整段 `<form className="composer">` 归 `Composer`，页面只给状态与回调：提交与 ⌘／Ctrl＋↵ 共用一个 `onStartRun`，输入法组合中的 Enter 不提交；`submit` 用 idle／starting／running 三档可辨识联合表达「这颗主按钮现在是什么」，与「运行中是否锁绑定区」分列——停止按钮要求确实有一次可停的运行。护栏锁两条：基座之外出现气泡或 composer 表单结构、以及「状态 · 时间」这句运行摘要在 `RunSummaryRow` 之外再拼一次，即失败。
- 长操作三要素缺一不可：可见状态、取消入口、明确结果。
- 反馈先按 `docs/10-ui-ux-system.md` §11.5.1 决策表归类，只有三个落点：用户当场发起的短时确认（成功/信息）→ 局部 `TransientToast`（自消、不落库）；当前表单/对象可行动的错误 → 内联 `.inline-message.error`（`.inline-message` 只保留错误态）；可能已切走的长操作结果 → `NotificationService` 进消息中心 + 全局 `ToastHost`（同页抑制）。**两个 toast 不可混用**：`TransientToast` 局部自消，`ToastHost` 是已持久化通知的投影；短时确认严禁走 `NotificationService`。禁止页面/Hook 自造 Toast、顶部成功横幅或自动消失计时器；护栏见 `SkillsView.test.tsx` 对 `.inline-message:not(.error)` 为空的断言。具体工程约束见 `docs/12-engineering-standards.md` §8。
- 过程信息按用户目标分组并渐进披露；原始 Run 事件不得成为默认主界面的视觉中心；不展示模型私有思维链。
- Artifact 是一等界面对象；右侧上下文面板按场景出现且必须允许完全收起。
- 模型配置使用独立设置空间，不嵌入 Composer 或任务消息流。
