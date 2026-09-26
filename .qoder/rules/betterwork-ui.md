---
trigger: glob: apps/desktop/src/renderer/**/*.tsx,ts,css
---

# Renderer UI 与主题纪律

设计真相源是 [docs/10-ui-ux-system.md](../../docs/10-ui-ux-system.md)；变更核心信息架构或视觉语言前先更新该文档。

- **纵向堆叠不得贴死**：同一容器里上下相邻的控件/表单/提示/卡片之间必须有可见垂直间距；间距由容器的 `gap` 拥有，子元素不自带上下 `margin` 凑同一道缝。`components/layout/` 骨架容器必须自带 `display` + `gap`，页面不得用后代选择器替骨架补 `gap`；表单控件不写 `width:100%`（在弹性行里会挤到同排标签逐字断行）。护栏见 `standards/coding-standard.test.ts`，理由见 docs/10 §9.8。
- **新增/修改页面必须复用统一页面骨架**（docs/10 §8.3：`.page-header` 页头带 + `.page-body` 860px 版心）：禁止页面自定版心宽度、页头结构或标题坐标；工作视图的对话列与输入框必须同宽。
- **只用语义化主题 Token**（定义于 `apps/desktop/src/renderer/src/appearance.ts` 与 `styles.css`）：禁止新增硬编码色值，禁止用局部 `.dark` 补丁绕过 Token 契约。建立新 Token 时必须当场迁移所有相关硬编码值，不留半套。
- 外观由两个维度组成：`system / light / dark` 模式 × 可扩展色系；每套正式色系必须同时提供浅色与深色 Variant。
- **应用主题不得改变 Artifact 自身的文档、演示、表格或图表配色**。
- 中文体验优先；正文和常规控件禁止用 9–10px 小字号换取空间，优先折叠、覆盖和响应式重排。`<small>` 已有 12px 全局基线，组件只在此之上放大，不再逐处补 `font-size`。
- `gap` / `row-gap` / `column-gap` 的像素取值只能是 4 / 8 / 12 / 16 / 24 / 32 六档，由护栏强制；要加档位先改 docs/10 §9.8。
- **界面功能图标一律使用内联 SVG 描边图标**（图标集在 `apps/desktop/src/renderer/src/icons.tsx`，`currentColor`、统一 24 网格与笔画粗细）：禁止用 Unicode 字符或 emoji 充当系统操作、导航、按钮等界面图标；新增图标先进图标集再使用，品牌字标与格式徽标（MD/PDF）除外。
- **浮层一律复用 `PopoverMenu` 基座**（docs/10 §10.1）：下拉、菜单、选择器不得用 `<details>` 或 `position:absolute` 面板自造；菜单字号由基座镜像触发控件，破坏性菜单项用 `tone: 'danger'`。护栏锁「`.popover-menu-item` 不自带字号」与「overlay 阴影只允许登记过的浮层表面」。
- 长操作三要素缺一不可：可见状态、取消入口、明确结果。
- 反馈先按 `docs/10-ui-ux-system.md` §11.5.1 决策表归类，只有三个落点：用户当场发起的短时确认（成功/信息）→ 局部 `TransientToast`（自消、不落库）；当前表单/对象可行动的错误 → 内联 `.inline-message.error`（`.inline-message` 只保留错误态）；可能已切走的长操作结果 → `NotificationService` 进消息中心 + 全局 `ToastHost`（同页抑制）。**两个 toast 不可混用**：`TransientToast` 局部自消，`ToastHost` 是已持久化通知的投影；短时确认严禁走 `NotificationService`。禁止页面/Hook 自造 Toast、顶部成功横幅或自动消失计时器；护栏见 `SkillsView.test.tsx` 对 `.inline-message:not(.error)` 为空的断言。具体工程约束见 `docs/12-engineering-standards.md` §8。
- 过程信息按用户目标分组并渐进披露；原始 Run 事件不得成为默认主界面的视觉中心；不展示模型私有思维链。
- Artifact 是一等界面对象；右侧上下文面板按场景出现且必须允许完全收起。
- 模型配置使用独立设置空间，不嵌入 Composer 或任务消息流。
