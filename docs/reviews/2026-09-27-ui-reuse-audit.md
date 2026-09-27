# 算台 UI 复用度与发布就绪度评估（2026-09-27）

评估对象：`apps/desktop/src/renderer/src/`（渲染层 32,418 行，其中 `styles.css` 5,564 行、17 个视图与大组件文件占约 9,000 行）。

与 2026-09-26 [UI 一致性评估](2026-09-26-ui-consistency.md) 的关系：那份报告的 P0／P1／P2（浮层、模态、表单字段、列表行、状态徽标、空态、页签）已全部收口并有护栏锁定，本文不重复审视那批结论，只做两件事——**核对基座的真实使用面**（有没有被绕过），以及**盘出基座之外仍在重复的部分**（本轮的账几乎全在这里）。

口径说明：所有计数由脚本静态统计并逐项抽查复核，未启动应用做视觉判断。统计脚本在 `/tmp`，未入库。文中 file:line 均可直接跳转核对。

---

## 1. 结论

**基座层已达可发布标准；业务组件层没有，且"重复造轮子"的问题已经整体从「通用控件」迁移到「跨页面业务块」和「控件皮」两处。**

| 维度 | 判定 | 依据 |
| --- | --- | --- |
| 通用控件基座（浮层／模态／字段／行／徽标／空态／页签） | **达标** | 12 项基座落地，49 条护栏，自造浮层与模态已清零（本文 §2） |
| 业务组件（§10.2 声明的 22 项） | **未达标** | 10 项零实现、7 项内联在宿主文件、多份重复（§3.2） |
| 结构模式复用 | **未达标** | 区块头 26 处／13 个类名、底部动作条 8 处、图标按钮 7 处、就地 busy 文案 14 处（§3.1） |
| 控件皮（按钮／输入／搜索框／卡片几何） | **未达标，但不该靠新组件解决** | 按钮族 `padding` 裸值 37 条、25 种组合，**取 Token 者为 0**；`1px solid var(--border)` 在 67 条规则里各写一遍（§5） |
| Token 卫生（色／z-index／动效／小字号） | **达标** | 硬编码色仅 23 行且全在外观预览；z-index 12 处全走 `var(--z-*)`；动效 14 条全走 `--motion-*`；9–11px 仅 5 处且在豁免内；死代码类 8／434 |
| 契约兑现（文档声称 vs 代码） | **有破口** | 四处滚动区逃逸、三处手写选中态绕开 Tabs 护栏、`.inline-message` 仍带成功配色、文档三处称 `App.tsx` 约 720 行而实为 1,879 行（§4） |
| 发布门禁 | **未成形** | 无成文发布门槛，唯一门禁是 `npm run verify`；Developer ID 签名跳过、Dock 图标无导出管线、4 个页面无窄屏断言（§7） |

一句话给光哥的判语：**作为个人日常使用的技术预览，UI 已经够统一；作为对外发布的产品，卡点不在"控件不像一套"，而在"跨页面的业务块各写一遍、文案与状态互相分叉、错误与加载态没有统一契约"。** 这三件事都会在真实使用中变成可见的不一致（本文 §3.3 已给出现成的例子：同一个依赖就绪状态在两个文件里分别叫「已就绪」和「就绪」）。

---

## 2. 已提取基座：声明 vs 落地 vs 真实使用面

台账在 docs/10 §10.1。这里补上此前没有量化的**使用面**——一个基座只有 importer 数说明它是不是真在被复用。

| 基座 | 位置 | importer | 渲染点 | 护栏 | 本轮结论 |
| --- | --- | --- | --- | --- | --- |
| 页面骨架 PageHeader／PageToolbar／ScrollRegion／ViewContainer | `components/layout/` | 4／2／3／3 | — | 部分 | **有逃逸**：Skills 与 Experts 共四处用裸 `div.page-scroll` 代替 `ScrollRegion`，Knowledge 那处是裁剪容器误用滚动类（§4.1） |
| PopoverMenu | `components/PopoverMenu.tsx` | 4 | 6 | 3 条 | 达标。`onBlur`+`relatedTarget` 与"点击外部关闭"手写全站 0 处 |
| Modal（dialog／sheet／viewer）＋ `useOverlaySemantics` | `components/Modal.tsx` | 4＋1 | 5 | 1 条 | 达标。夺焦点表面全部收口，无第二套 Esc／inert 实现 |
| Field | `components/Field.tsx` | 4 | 37（累计迁移） | 2 条 | 达标 |
| FieldSelect | `components/FieldSelect.tsx` | 5 | — | `<select>` 零出现 | 达标，全站无原生下拉回归 |
| ListRow | `components/ListRow.tsx` | 11 | 15 | 3 条 | **接近达标**：5 处结构上仍是行却自造（§4.5）；`card` 变体表达不了专家卡与技能卡 |
| Badge | `components/Badge.tsx` | 4 | 9 | 3 条 | **有绕过**：5 套新写状态片（§4.4） |
| Tabs／SegmentedControl | `components/Tabs.tsx` | 3 | 3 | 1 条 | **有绕过**：3 处手写 `active` 类选项组（§4.2） |
| EmptyContext／EmptyNotice／EmptyPage／LoadingPage／ErrorPage | `components/EmptyState.tsx` | 7 | 11 | 退役类 | 基本达标。残留 `.brief-empty`／`.context-placeholder` 自造占位（`WorkspaceBrief.tsx:70,74,86,117,147`） |
| TransientToast／ToastHost | `components/TransientToast.tsx`、`notifications.tsx` | 5 局部点 | 全局 1 | 反馈档位 | 达标，全站唯一 `setTimeout` 消失计时器在基座内 |
| ConfirmationDialog | `components/ConfirmationDialog.tsx` | 若干 | — | Modal 护栏 | 达标 |
| Button／Input／Textarea | 只有样式类 | — | — | 部分 | **明确不再组件化**（§10.1 既有决定），但几何标尺没补齐（§5） |
| Switch／Tooltip／Progress／Skeleton | — | 0 | 0 | — | 仍全未落地；处置建议见 §6 |

一句话总结这一节：**有护栏的基座守住了，没有护栏的契约在被逃逸。** 上一轮的收口是有效的——浮层、模态、字段、行四类现在全站只有一份实现；本轮新发现的重复全部落在"从来没有基座"的地方，而不是"有基座却没人用"。

---

## 3. 仍未组件化的重复（本轮新账）

### 3.1 结构性重复模式（按次数排序）

| # | 模式 | 次数 | 代表证据 | 分叉在哪 | 建议基座 |
| --- | --- | --- | --- | --- | --- |
| P1 | 区块头「标题＋说明＋右动作」 | **26 处／13 个类名** | `SettingsView.tsx:136,232,318,513`、`ContextPanel.tsx:323,363,664,779,915,1013`、`WorkspaceBrief.tsx:112,142,201`、`SkillsView.tsx:264,325`、`KnowledgeView.tsx:292,486,608`、`MemoryView.tsx:351,614`、`notifications.tsx:249`、`DependencyPanel.tsx:56`、`ModelEditorSheet.tsx:41` | `gap` 4／8／12／16／24 全档并存，`display` 有 flex-row／column／grid 三种；16 处用 `<strong>` 充当标题、不进大纲 | **SectionHeader**（title／hint／counter／actions） |
| P2 | 底部动作条「主按钮＋取消」 | **8 处** | `MemoryEditor.tsx:416`、`ExpertsView.tsx:447`、`SettingsView.tsx:614`、`ComposerCapabilityPicker.tsx:421`、`DiscussionCheckpointPanel.tsx:162`、`ArtifactView.tsx:458`、`ModelEditorSheet.tsx:131`、`KnowledgeView.tsx:737` | 取消键一处在最前一处最后；`<footer>` 与 `div.-actions` 混用；全部无 `role="group"`／`aria-label` | **ActionBar**（primary／secondary／cancel／hint） |
| P3 | 图标按钮（面板头关闭／折叠） | **7 处** | `App.tsx:1237,1351`、`ContextPanel.tsx:209`、`ModelEditorSheet.tsx:46`、`notifications.tsx:429`、`KnowledgeView.tsx:294`、`ArtifactView.tsx:728` | 图标尺寸 12／13／14／15／16／22 各写一遍；几何靠 7 个专属类；`IconButton` 在 §10.1 有声明但从未落地 | **IconButton** |
| P4 | 就地 busy 文案（`saving ? '正在保存…' : '保存'`） | **14 处** | `App.tsx:1690`、`ContextPanel.tsx:539,750,785,822`、`MemoryEditor.tsx:426`、`DiscussionCheckpointPanel.tsx:170`、`MemorySuggestionList.tsx:161`、`ComposerCapabilityPicker.tsx:407`、`ExpertsView.tsx:449`、`KnowledgeView.tsx:232,599`、`SkillsView.tsx:176`、`ArtifactView.tsx:808` | `disabled`＋文案翻转＋无 `aria-busy` 三件事各写；部分有 `aria-busy` 部分没有 | **AsyncButton**（busy／idleLabel） |
| P5 | 独立加载文本行（无指示器） | **11 处** | `App.tsx:1543`、`ContextPanel.tsx:600,678,932`、`WorkspaceBrief.tsx:70`、`KnowledgeView.tsx:517,729`、`MemoryView.tsx:469`、`SettingsView.tsx:526`、`DependencyPanel.tsx:161`、`ArtifactView.tsx:563` | 只有 `MemoryView.tsx:469` 走了 `EmptyNotice`；其余是裸 `<p>`，既无 `aria-live` 也无 spinner | **InlineLoading**（并合并两套 spinner，§5） |
| P6 | 绕过 Badge 的状态片 | **5 套** | `.memory-kind`／`.memory-state`（`MemorySuggestionList.tsx:271`，`styles.css:1423`）、`.tool-pill-status`（`ToolActivity.tsx:95`，:5415）、`.expert-card-status`（`ExpertsView.tsx:127`，:1821）、`.artifact-input-card-meta`（`ArtifactView.tsx:303`）、`.model-role-icon`（`SettingsView.tsx:174`） | 各自 padding／圆角／配色组合；不在 Badge 退役白名单里，所以护栏看不见 | 迁 `Badge`，或按 §10.1 口径登记为图形化标识例外 |
| P7 | 可移除 chip（图标＋名＋移除钮） | **3 处** | `ComposerCapabilityPicker.tsx:251-263,275-311`、`App.tsx:1613-1631` | 第三份是复制，且**跨文件借用他人 CSS 类** `.capability-chip-remove`（`styles.css:3280`） | **CapabilityChip** |
| P8 | 错误呈现表面 | **5 类并存** | `.inline-message.error` 约 27 处、`.field-error` 3 处、`.action-note.error` 2 处（`App.tsx:1433,1485`）、`.action-error-banner`／`.artifact-action-error`／`.memory-warnings`／`.knowledge-issues` 各 1 | 其中 4 处内嵌「重试」按钮（`ContextPanel.tsx:680,789,925`、`WorkspaceBrief.tsx:59`，三处逻辑一模一样）、1 处内嵌 `<ul>` 多条问题（`MemoryEditor.tsx:410`） | **InlineError**（message／onRetry／problems[]／onDismiss） |
| P9 | `<details>` 折叠段 | **6 处＋1 份手搓等价物** | `ContextPanel.tsx:243,577,850`、`ModelEditorSheet.tsx:101`、`SettingsView.tsx:352`（两份都是「高级参数」）、`ToolActivity.tsx:28`；`MemoryView.tsx:914-946` 手搓 `aria-expanded`＋文案翻转 | 语义合法（就地展开，非浮层），但视觉与摘要排版各写 | **Disclosure**（低优先，只求观感一致） |
| P10 | class-only 选中态（无 ARIA） | **5 族／17 个按钮** | 侧栏一级导航 `App.tsx:1249,1256,1268,1275,1287,1320`；设置导航 `SettingsView.tsx:69-88`；模型筛选 `SettingsView.tsx:150`；执行记录 `ContextPanel.tsx:246`；版本历史 `ArtifactView.tsx:320` | 全站生产代码里 `aria-current` 只出现在 `ListRow.tsx:92`，这 5 族一个都没有；无 `role="tablist"`／键盘导航 | **NavItem**（复用 Tabs 的 roving tabindex 决定） |
| P11 | `ul > li「A · B · C」` 信息列表 | **13 处** | `WorkspaceBrief.tsx:120,152,206`、`ContextPanel.tsx:618,859,1024`、`KnowledgeView.tsx:520,546`、`MemorySuggestionList.tsx:170`、`MemoryView.tsx:408,950`、`ExpertsView.tsx:567`、`SkillsView.tsx:351` | 「共 N 条，只列最近 M 条」的截断脚注写了 5 份 | 暂缓（先并入 SectionHeader 的 hint 槽） |
| P12 | 带来源图标的引用行 | **3 份** | `ContextPanel.tsx:501-555`（已用 ListRow）、`ArtifactView.tsx:337-378`（裸 `<article>`）、`KnowledgeDocumentCard.tsx:66-128` | 前两份重复同一条三元式 `isWeb ? GlobeIcon : isMcp ? CapabilityIcon : KnowledgeIcon`（`ContextPanel.tsx:504`／`ArtifactView.tsx:340`）与同一组「MCP 工具／网页来源／本地资料」标签 | **SourceRow** ＝§10.2 欠账的 EvidenceChip／SourceList |

### 3.2 docs/10 §10.2 业务组件清单核对

| 组件 | 状态 | 实际在哪 | 份数 |
| --- | --- | --- | --- |
| ConfirmationBlock、PlanStep、EvidenceChip、RunSummary、SettingsLayout／SettingsNav、ModelProfileRow、ConnectionStatus、ArtifactVersionMenu | **0 份实现，全部内联在宿主** | 消息块与计划步骤内联于 `App.tsx:1380-1550`；证据行内联于 `ContextPanel.tsx:474-587`；设置导航 `SettingsView.tsx:65-90`；模型行 `SettingsView.tsx:169-216`；版本"菜单"实为 `ArtifactView.tsx:314-333` 的按钮列表 | RunSummary 4 份（`ContextPanel.tsx:229,243`、`App.tsx:1310`、`ArtifactView.tsx:319`）；ConnectionStatus 3 份同结构（`SettingsView.tsx:192,387,541`） |
| MessageBlock | 1 份内联 | `App.tsx:1418-1431`，其 `.message-action` 已被第二个文件借用（`MemoryCaptureSource.tsx:60,65`） | 1，但已跨文件借用 |
| Composer | 1 份内联（137 行） | `App.tsx:1558-1694` | 1 |
| ArtifactCard | 2 份 | `ContextPanel.tsx:435-452`、`ArtifactView.tsx:507-533`，同类信息不同标签源 | 2 |
| ArtifactPreview | 4 分支内联 | `ArtifactView.tsx:471,543,559,586` | 1（文件内） |
| ActivityGroup | 伪导出 | `ContextPanel.tsx:1061` 导出，却只被同文件 `:239` 消费 | 1 |
| ToolCallRow | 以 `ToolActivity` 存在 | 被 `App.tsx:1422` 与 `ContextPanel.tsx:241` 消费，两处都靠 `key` hack 复位内部 state | 1（有两处调用变通） |
| Sidebar／SidebarItem／TaskListItem | 仍在 `App.tsx` | `App.tsx:1226-1343`（约 120 行内联） | 1 |
| AppShell、TitleBar、TaskHeader、ContextPanel、WorkspaceBrief、DiscussionCheckpointPanel | 已存在 | 各自文件 | — |

**§10.2 结尾那句"ConfirmationBlock、PlanStep、EvidenceChip、RunSummary 未落地"是准确的，但低估了范围**：MessageBlock、Composer、ArtifactCard、SettingsNav、ModelProfileRow、ConnectionStatus 六项同样只是内联 JSX，台账没有登记为欠账。

### 3.3 纯逻辑重复（零 UI 成本，先修这一档最划算）

| 内容 | 份数 | 证据 | 已造成的分叉 |
| --- | --- | --- | --- |
| 材料身份 key（`referenceKey`／`materialKey`） | **4 份完全相同** | `App.tsx:109`、`ContextPanel.tsx:85`、`ComposerCapabilityPicker.tsx:62`、`ExpertsView.tsx:82` | 尚无，但任一处改口径即分叉（`use-knowledge-library.ts:509` 是另一域，不计入） |
| `MIME_LABEL_MAP` | 2 份 | `ContextPanel.tsx:66`、`ArtifactView.tsx:41` | 格式徽标文案两处独立维护 |
| `SOURCE_STATE_LABELS` | 2 份 | `KnowledgeDocumentCard.tsx:24`、`KnowledgeView.tsx:33` | 同上 |
| 依赖环境状态词表 | 2 份**已分叉** | `SkillsView.tsx:29` `ready: '已就绪'` vs `DependencyPanel.tsx:33` `ready: '就绪'` | **用户可见的文案不一致已经发生** |
| 工作空间适用性谓词／`isGlobalScope` | 各 2 份 | `App.tsx:100`／`ExpertsView.tsx:91`；`MemoryEditor.tsx:123`／`MemoryView.tsx:818` | 尚无 |
| 相对时间（刚刚／x 分钟前／M 月 D 日） | 1 份留在业务文件 | `notifications.tsx:185-192`（`lib/format.ts` 只有 16 行、仅绝对 `HH:mm`） | 下一个需要"3 天前"的页面必然写第二份 |

### 3.4 文件内局部组件（应下沉的 25 个）

`ContextPanel.tsx` 10 个（`EvidenceSection:474` 114 行、`NextRunScopeSection:643`、`ExcludedTaskMemoriesSection:762`、`HistoryAdjustmentSection:997` 等）；`MemoryView` 3 个；`SkillsView` 4 个；`ExpertsView` 3 个；`ArtifactView` 3 个；`MemorySuggestionList` 3 个；`WorkspaceBrief`、`ToolActivity` 各 1 个。其中 `MemoryScopeRow`、`ExclusionRow`、`BriefSection`、`SuggestionJobRow`、`SkillListItem` 已是"ListRow 填槽"形态，**下沉成本接近零**；`EvidenceSection`、`ConflictPair`、`SkillDetail` 带独立状态与 IPC，应先拆文件再谈基座，不要为抽而抽。另有一处 export 面泄漏：`SettingsView.tsx:123,224,301,417` 四个函数导出后只被同文件 `:92-108` 消费。

---

## 4. 基座逃逸与契约偏离（优先修，因为文档已声称达标）

### 4.1 页面骨架被绕过，滚动区有两套实现

`ScrollRegion` 输出 `.scroll-region`（`styles.css:606`，带 `role="region"`＋`tabIndex`＋`aria-label`＋`aria-busy`），另有裸类 `.page-scroll`（`styles.css:601`，只有 `flex:1`＋`overflow:auto`）。**四处走的是后者**：`SkillsView.tsx:190`、`ExpertsView.tsx:195,532,775` 用 `<div className="page-scroll skills-scroll">`。后果是这些页面的滚动区对辅助技术不可发现、也没有 busy 状态，且键盘用户无法用方向键滚动该区域。

`KnowledgeView.tsx:241` 是另一回事：它写 `.page-scroll .knowledge-scroll`，而 `.knowledge-scroll` 把 `overflow` 改成 `hidden`——它本来就是**裁剪容器**而不是滚动区（真正的滚动在里面的两个 `ScrollRegion`）。这里不该并入骨架基座，而是换个诚实的类名（R1 里改成 `.knowledge-stage`），否则「页面没接骨架」的账会算错一处。

同时 **Experts 页自定版心宽度**：`styles.css:1849-1852` 给 `.expert-editor-body, .expert-detail-body` 写 `width: min(720px, 100%)`，而骨架 `.page-body` 是 `min(860px, …)`（`:643`）——直接违反 §8.3「禁止页面自定版心宽度」。另有两处用后代选择器替骨架补样式：`.messages > .page-body { display:flex; padding:28px 0 12px }`（`:776`）、`.settings-layout-fixed .settings-content { display:flex }`（`:1631`）。

### 4.2 Tabs 护栏以 ARIA 为触发条件，不写 ARIA 即绕过

`standards/coding-standard.test.ts:838` 的页签护栏只在出现 `role="tablist"`／`aria-selected`／`aria-pressed` 时要求接基座。于是 §3.1 P10 那 5 族手写 `active` 类的选项组**结构性隐身**。全站生产代码中 `aria-current` 只有 `ListRow.tsx:92` 一处——这既是可及性缺口，也是护栏机制缺口。

### 4.3 `.inline-message` 基础规则仍带成功配色

`styles.css:2306-2312`：

```css
.inline-message {
  margin: 15px 0;
  padding: 9px 11px;
  color: var(--success);
  background: var(--success-soft);
  ...
}
```

§11.5.1 与 UI 规则都要求「`.inline-message` 只保留错误态」。当前 TSX 里没有裸用法（所以 `SkillsView.test.tsx` 的断言仍绿），但任何人写一句 `<p className="inline-message">` 就会渲染成绿色成功横幅——**短时确认伪装成内联提示的通道还开着**。顺带：这条规则的 `margin: 15px 0` 也与 §9.8「间距由容器 gap 拥有」相冲。

### 4.4 ListRow 的 5 处漏网与 1 处能力缺口

该进基座而未进：`ContextPanel.tsx:246-252`（执行记录行：`<span>` 状态＋`<strong>` prompt＋`<small>` 时间＋`className={... ? 'active' : ''}`）、`ArtifactView.tsx:319-331`（版本行同构）、`WorkspaceBrief.tsx:121-131,153,205-211`（`.brief-list > li > button`＋标题＋`<small>`＋Chevron）、`ContextPanel.tsx:349-356,973-985`（只读行）、`MemorySuggestionList.tsx:146-163`（与已用基座的 `SettingsView.tsx:169` 同类）。

不该进的（判读要留痕，避免下轮误并）：`KnowledgeView.tsx:329,374,394,412,441,664` 的控件簇与重命名／哈希行、`ArtifactView.tsx:562-620` 的 label／value 定义列表与缩略图网格、`MemoryEditor.tsx:328,332` 的 diff 行。

**能力缺口**：`ListRow.tsx:22` 明确 `onClick` 与 `actions` 互斥（避免按钮套按钮），因此 `ExpertsView.tsx:113-132` 的 `.expert-card` 与 `SkillsView.tsx:71-81` 的 `.skill-card` 这种「整行可点＋卡片底部独立动作区」当前无法表达。要么给 `card` 变体补 `children` 承载动作区，要么这两套卡片几何继续漂移。

### 4.5 跨文件借用他人 CSS 类（复用了皮，没复用结构）

`App.tsx:1618` 借 `.capability-chip-remove`；`MemoryCaptureSource.tsx:60,65` 借 `.message-action`；`ContextPanel.tsx:383`、`ExpertsView.tsx:354,361` 借 `.expert-option-list`／`.selected-mcp-list`（后者是 ContextPanel 的领域类）。这类借用在 CSS 侧制造了"改一处炸三处"的耦合，是 P7／P12 该抽基座的直接信号。

### 4.6 文档与代码的三处漂移

- docs/10:567 与 docs/11:105,143 均称 `App.tsx` 约 720 行，**实际 1,879 行**（其中侧栏 120 行、消息流 170 行、Composer 137 行为内联）。
- docs/11:78 称护栏 37 条，**实际 49 条 `it()`**。
- 台账里"Button／IconButton"并列，但 `IconButton` 从未落地（§3.1 P3）。

---

## 5. 控件皮与视觉刻度：问题真实，但结论不是"再造一个 Button"

脚本统计（`styles.css` 901 条规则）：

- **按钮族 `padding`：裸值 37 条，取 Token 0 条，共 25 种组合**，高频为 `6px 10px`×3、`5px 10px`×3、`8px 12px`×2、`7px 9px`×2。
- `margin` 裸值且偏离六档：**73 条**（44 种取值）；`padding` 裸值且偏离六档：**157 条**（89 种）。护栏只钉了 `gap`（`coding-standard.test.ts:545`），margin／padding 无标尺。
- **`height` 24–40px 裸值 28 条，而 `min-height` 裸值只有 1 条**——护栏查的是 `min-height`（`:975`），高度逃逸在另一个属性名上。
- `1px solid var(--border)` 出现在 **67 条规则**里；带 `border-radius` 的 panel／drawer／card／sheet／detail 类规则 21 条，即"描边＋圆角＋raised 底"这套卡片配方基本每条规则重写一次。
- 搜索框 **4 套实现**（`styles.css:921-937`、`3319`、`3584-3611`、`4831-4861`）：padding 三种、底色三种（`--surface`／`--surface-raised`／`--canvas`）、**焦点态三套**（`outline:none`＋换边框色 vs `outline:2px solid` vs 全局 `:focus-visible`），两处仍写 `width:100%`。
- 输入／文本域外观 14 处各写 `padding/background/border/font-size`（`.field` 只管结构不管皮）；字号 13px 为默认但 `:4104` 用 14px。
- **两套 spinner**：`@keyframes page-spinner`（`:1586`，供 `EmptyState.tsx:73`）与 `@keyframes spin`（`:3864`，供 `.run-running-indicator::before`／`ContextPanel.tsx:231`），几何几乎相同。`role="progressbar"` 全站 0 处，Skeleton 0 条规则。
- 干净的部分（明确记账以免下轮重复劳动）：硬编码色仅 23 行且全在 `.mode-preview`／`.scheme-preview`；9–11px 仅 5 处且全在豁免清单；z-index 12 处全部走 `var(--z-*)`；动效 14 条全部走 `--motion-*`；滚动条 1 套；**死代码类 8 个／434 个（1.8%）**——`.sidebar-footer`、`.selected-memories-panel`、`.expert-summon-button`、`.memory-create-form`、`.memory-capture-footer`、`.artifact-row-clickable`、`.artifact-row-chevron`、`.refresh-knowledge-button`（已逐个 grep 复核生产代码零引用）。

**判读**：按钮与输入不该包一层组件（§10.1 既有决定，理由成立——只为壳而壳会制造第二处真相）。这一档的正解是**把几何档位补成可选 Token 并把护栏从 `min-height` 扩到 `height`／`padding`／`margin`**，用"只降不升"的棘轮吃掉 73＋157＋28 条存量裸值。上一轮 150 处圆角与密集高度上档（`0ad81fe`）已经证明这条路径走得通。

---

## 6. 缺失原语的处置建议（避免为抽而抽）

| 原语 | 建议 | 依据 |
| --- | --- | --- |
| **IconButton** | 做，P0 | 7 处、6 种图标尺寸；§10.1 已声明却零实现，属于欠账而非例外 |
| **SectionHeader** | 做，P0 | 26 处、13 个类名，量最大且每处都在重画同一道缝；顺带把 `<strong>` 冒充标题升成真实标题层级 |
| **ActionBar** | 做，P1 | 8 处，取消键位置与语义容器不一致，是可直接读出视觉与键盘顺序分叉的那一类 |
| **AsyncButton ＋ InlineLoading（含合并 spinner）** | 做，P1 | 14＋11 处；一次收口 `disabled`／文案翻转／`aria-busy` 三件事，并补 §10.1 的 Progress 缺口 |
| **NavItem** | 做，P1 | 5 族 17 个无 ARIA 选中态按钮；与 SettingsNav、侧栏一级导航、版本列表三处一次收口，可复用 `Tabs` 的 roving tabindex 决策 |
| **InlineError** | 做，P1 | 错误表面 5 类并存，其中"重试"内联按钮写了 4 份 |
| **Switch** | 小范围做，P2 | 13 处 `type="checkbox"` 中只有 4 处是布尔设置（`KnowledgeView.tsx:330` 类名已叫 `knowledge-admin-switch`、`MemorySuggestionList.tsx:146` 用按钮文案翻转充当开关、`SettingsView.tsx:208` 用文本按钮、`SkillsView.tsx:309`）。**多选与全选保留原生勾选框是正确语义**，不要为了统一把它们塞进 Switch |
| **CapabilityChip／SourceRow** | 做，P2 | 各 3 份，且已出现跨文件借类 |
| **Disclosure** | 可选，P3 | 6 处 `<details>` 语义合法（就地展开、不是浮层），只为观感一致 |
| **Tooltip** | **暂缓** | 全站仅 5 处原生 `title=`，其余 20+ 处 `title` 是组件 prop。真正该收的是"截断兜底"（`FieldSelect.tsx:80` 与 `ComposerCapabilityPicker.tsx:280` 同一需求）和 MCP 工具说明两处重复（`ContextPanel.tsx:408`／`ExpertsView.tsx:383` 字节级相同） |
| **Skeleton** | **暂缓** | 全站 0 处，无真实诉求；等首屏耗时成为可测量问题再说 |
| **Button／Input／Textarea 组件化** | **明确不做** | 与 §10.1 现有口径一致，改走 Token＋护栏（§5） |

---

## 7. 发布就绪度（组件之外的事实）

- **阶段与门禁**：docs/07:51 显示 E55 真实桌面旅程待执行、E56 的签名安装与真实业务旅程仍待执行。仓库**没有成文发布门槛**，唯一门禁是 `npm run verify`（docs/11:63-65，CI 也只跑它）。
- **签名与图标**：`docs/acceptance/2026-09-14-expert-install-preflight.md:39` 明确记录构建"未找到 Developer ID Application 身份并跳过签名"；`.icns`／PNG 导出管线缺失（docs/11:158 第 16 条）。macOS 上未签名包对普通用户是 Gatekeeper 拦截，这是**比 UI 一致性更硬的发布卡点**。
- **窄屏**：`@media` 仅 6 处（`styles.css:3517,3534,4359,4741,5092,5254`），覆盖上下文面板、全局最小宽、知识、成果、侧栏与 reduced-motion。**专家／记忆／技能／设置四页无任何窄屏断言**。
- **色系**：`appearance.ts:2` 四套色系 × light／dark 共 8 个 Variant 全部存在（`styles.css:49,82,114,146,178,210,242,274`）→ §10 契约达标。
- **人工验收未收口**：WM16、MI10、KM15 三条清单仍在光哥手上（docs/07:11,23,45）。UI 侧还有 6 笔本地提交待回看（ListRow、知识页抽屉方案 B 等）。
- **测试覆盖**：渲染层 26 个 `.test.tsx`＋18 个 `.test.ts`。**`views/ExpertsView.tsx`（802 行）无测试**；`components/layout/` 四个骨架、`FieldSelect.tsx`、`ModelEditorSheet.tsx`、`WorkspaceSelector.tsx`、`TransientToast.tsx`、`MemoryCaptureSource.tsx`、`Welcome.tsx` 均无测试文件。
- **可及性半成品**：40 个 `<button>` 无显式 `type`；13 处 checkbox 无一有 `fieldset`／`legend` 分组；P5 那 11 处加载行无 `aria-live`。

---

## 8. 后续建议（三期，每期带门禁，可独立停）

**R1 收口与补洞（零设计决策，建议先做）**

1. 删 `.inline-message` 基础规则里的 `color: var(--success)`／`background: var(--success-soft)` 与 `margin: 15px 0`，并把护栏从"只看渲染层用法"扩到"只看 CSS 定义"，让这条契约真正无法回退。
2. 三个页面骨架逃逸改回 `ScrollRegion`（Skills／Experts／App）；`.expert-editor-body`／`.expert-detail-body` 的 720px 改回骨架 `min(860px, 100%)`（若专家编辑页确实需要窄版心，先在 docs/10 §8.3 登记为特例，再落代码）。
3. §3.3 的纯逻辑全部并进 `lib/`（材料身份 key、MIME／来源状态／依赖环境词表、`relativeTime`），**并顺手修掉「已就绪／就绪」的实际分叉**。
4. 清 8 个死 CSS 类；修 docs/10:567、docs/11:78,105,143 三处数字漂移。

完成判据：`npm run verify` 退出 0；词表与 key 函数全仓各只剩 1 份；三条文档陈述与代码一致。

**R2 高频结构基座（新基座 5 个，逐个带用例与护栏）**

`IconButton` → `SectionHeader` → `AsyncButton`＋`InlineLoading`（合并两套 keyframes）→ `ActionBar` → `NavItem`（含 `.settings-nav-list`、`.filter-bar`、侧栏一级导航、版本列表），并把 §4.4 的 5 处 ListRow 漏网与 §4.5 的跨文件借类一并迁掉。

护栏补三条：① 选中态语义改为"以结构为触发"而非"以 ARIA 为触发"（同一容器内 ≥3 个互相排斥的 `active` 类按钮即要求接 Tabs／NavItem）；② `height`／`padding`／`margin` 像素值按"只降不升"棘轮入白名单（存量 28／157／73）；③ 视图不得声明自己的版心宽度，也不得用后代选择器给 `.page-*`／`.scroll-region` 补 `display`／`padding`。

完成判据：新基座各有测试；P1／P2／P3／P4 四类模式的生产代码命中数降为 0；三条护栏在改前会红、改后绿，并做变异验证（先把规则打穿确认能抓到，再修）。

**R3 业务组件层（补 §10.2 欠账，按用户可见价值排序）**

`MessageBlock`＋`Composer`（让 `App.tsx` 从 1,879 行真正降下来）→ `SourceRow`（＝EvidenceChip／SourceList）→ `RunSummary`（4 份合 1）→ `SettingsLayout`／`SettingsNav`／`ModelProfileRow`／`ConnectionStatus` → `ArtifactCard` 两份合并 → `Switch`（仅 4 处布尔）。同步把 `ContextPanel.tsx` 的 10 个局部组件按"能填槽的先下沉、带独立 IPC 的先拆文件"处理。

完成判据：§10.2 清单里每项要么有实现并登记位置，要么在文档里明确"不做并说明为什么"；`App.tsx` 与 `ContextPanel.tsx` 行数下降幅度写进台账，不再留下与代码不符的陈述。

**明确不在本轮做**：Button／Input／Textarea 组件化、Tooltip、Skeleton、CSS 按模块拆分（最后一项是**规范变更**——docs/12 §2 对 CSS 文件放置没有规定，而 `coding-standard.test.ts` 有 10 个 describe 块用 `cssPaths().find(r => r.endsWith('styles.css'))` 定位样式文件，拆分前必须先把护栏改成显式文件清单，否则覆盖面会静默缩水）。

---

## 9. R1 落地状态（2026-09-27 14:14）

光哥批准先做 R1，本轮四项全部完成，`npm run verify` 退出码 0（功能档 146 文件／1,416 用例，含护栏 50 条）。

**R1-1 内联提示收口。** `.inline-message` 基础规则去掉 `color: var(--success)`、`background: var(--success-soft)` 与 `margin: 15px 0`，只留排版；配色由 `.inline-message.error` 独占。27 处用法逐个定位承载容器：22 处所在容器已有 `gap`（8／12／16 档），缝就此归容器；其余 5 处由承载位置声明——技能页与专家页页头下的横带写成 `.skills-page > .inline-message`（`12px 28px`，与页头 28px 内缩对齐），知识页版心里那条写 `12px 0`，上下文面板段间写 `.context-content > .inline-message`（`12px 14px`）；`.evidence-preview` 与「本空间参考版本」小节（此前**整段没有任何样式**，三块内容贴死）改成 `grid + gap` 自己拥有纵向缝；`.model-sheet .inline-message { margin: 0 }` 这条「替骨架抵消设定」的补丁随基础 margin 一起删除。护栏加一条（现 50 条），两条断言各自做过变异验证：把 `color: var(--success)` 或 `margin-block: 15px` 写回基础规则都会立刻转红。

**R1-2 页面骨架回归。** Skills 一处、Experts 三处改接 `ScrollRegion`（补 `role="region"`、`tabIndex`、`aria-label`、`aria-busy`），`.page-scroll` 与 `.skills-scroll` 两条重复规则随之删除；Knowledge 那处按 §4.1 的判断改为诚实的裁剪容器 `.knowledge-stage`，不再冒充滚动区。专家编辑与详情正文回到 `.page-body` 的 860px 版心，只保留 `padding-top` 微调。

**R1-3 纯逻辑上收 `lib/`。** 新增 `lib/materials.ts`：材料身份投影（六份副本）合 1，工作空间适用性谓词（两份）合 1；`lib/labels.ts` 增 `materialPurposeName`（两份合 1）、`knowledgeSourceStateName`（两份合 1）、`skillEnvironmentName`（两份**已分叉**的词表合 1）、`fileTypeLabel`（两份 MIME 表合 1）；`lib/format.ts` 增 `relativeTime`（此前只有消息中心一份，而列表行 meta 天然要同一口径）；`lib/memory-labels.ts` 增 `isGlobalMemoryScope`（两份合 1）。用户可见的分叉已收：`ready` 统一「已就绪」（依赖面板原写「就绪」，其测试断言同步改）、`failed` 统一「准备失败」、`invalid` 统一「已失效」。补 `lib/materials.test.ts` 与 `lib/format.test.ts` 共 11 例。

**R1-4 死样式与文档。** 8 个死类共 16 处规则清除（13 处整块删除，`.sidebar-collapsed` 与窄屏媒体查询里两处混排分组只摘掉死选择器，活选择器保留），`styles.css` 5,564 → 5,507 行。docs/10 §9.8 补两条契约（配色只能由错误态提供、内联提示不自带上下缝），§10.1 台账登记 `IconButton` 未落地并把 §10.2 那批内联欠账写明（`MessageBlock`／`Composer`／`ArtifactCard`／`SettingsNav`／`ModelProfileRow`／`ConnectionStatus` 等），三处「`App.tsx` 约 720 行」与「护栏 37 条」按实测改为 1,876 行与 50 条；docs/11 的视图与组件清单补齐到当前文件。

**需要光哥窗口回看的四个视觉点**（结构改动无法由 tsc／vitest 判定）：① 内联提示在 gap 容器里的上下缝从原来的 15px 收成容器自己的 8／12／16 档，视觉上会变紧；② 技能页与专家页页头下的错误横带由通栏贴边改为左右内缩 28px；③ 专家编辑与详情从 720px 版心回到 860px；④ 证据回看块与「本空间参考版本」小节新增的纵向缝（后者此前完全无样式）。

**R1 未包含、仍在 R2 的**：Tabs 护栏仍以 ARIA 为触发条件（不写 `role="tablist"` 就绕过，P10 那 5 族 17 个按钮仍在）；`margin`／`padding` 标尺与 `height` 档位护栏（存量 157／73／28 条）；以及 §3.1 全部结构基座。

---

## 10. R2 前两档落地状态（2026-09-27 15:40）

`npm run verify` 退出码 0（功能档 148 文件／1,429 用例，护栏 50 → 53 条）。

**R2-A `AsyncButton` ＋ `InlineLoading`（§3.1 P4／P5）。** 新增 `components/AsyncButton.tsx`：`busy` 同时负责 `disabled`、`aria-busy` 与文案切换，四档主皮靠 `variant` 映射到既有的 `.primary-button`／`.secondary-button`／`.text-button`，不给变体就只留行为不带外观。`InlineLoading` 收 11 处裸 `<p>正在…`。spinner 归一：`page-spinner` 与 `spin` 两套 keyframes 画的是同一个圈，合并成 `.spinner` ＋ `spinner-rotate`，尺寸走 `--spinner-size`（默认 12px，整页加载态覆写 16px）。**一处设计回退值得记**：初版为了不让按钮在 busy 时抖动，把两份标签叠在一起用 `visibility: hidden` 占位，结果 `textContent` 里同时留着两个文案，两条 ContextPanel 断言立刻红了——可及名称把「正在保存」和「保存」读成一句。现在只渲染当前那一行，宽度抖动交给 `min-width` 也不值得，理由写在组件注释里。补 `AsyncButton.test.tsx` 5 例。

**R2-B `SectionHeader`（§3.1 P1）。** 新增 `components/SectionHeader.tsx`，两档变体：`block`（页面区块头，h2 ＋ eyebrow ＋ 13px／630px 说明）与 `panel`（面板与卡片小节头，h3 ＋ 12px 弱化说明）。**迁移 23 个渲染点**：ContextPanel 6、SettingsView 4、WorkspaceBrief 3、SkillsView 2、MemoryView 2，ArtifactView／MemorySuggestionList／ToolActivity／DiscussionCheckpointPanel／DependencyPanel／消息中心各 1。13 个类名与 36 条选择器一并删除（`.settings-heading`、`.selected-materials-heading`／`-actions`、`.skill-detail-heading`／`.skill-section-heading`／`.skill-detail-actions`、`.memory-group-heading`、`.memory-heading-actions`、`.artifact-reference-heading`／`-actions`、`.notification-panel-header`／`-actions`、`.tool-detail-heading`、`.brief-section-head`、`.discussion-checkpoints-header`），`styles.css` 5,507 → 5,410 行。原来用 `<strong>` 冒充标题的 16 处升级为真 `h2`／`h3`，读屏与文档大纲从此能跳。

三处**刻意没有迁**，登记在此以免被当成漏网：`Modal` 的 sheet 表头（`ModelEditorSheet.tsx` 与知识页抽屉的 `.knowledge-drawer-head`）——那里的标题与关闭按钮是模态外壳的一部分，几何归 `Modal`，拆给区块头会把壳与内容混起来；`.knowledge-detail-header`——「返回列表 ＋ 标题 ＋ 分页」的导航式页头，不是「标题＋说明＋动作」；`.context-topline`——拖拽带上的面板标题，双击行为与 `PageHeader` 同源。`.knowledge-jobs-head`（昨天方案 B 抽屉里新写的作业头）也留在原位，等光哥回看抽屉那轮一起定：它只有「标题＋一个清空按钮」，迁过去会把单行变两行。

**顺带修掉的一个真实外观风险。** 区块头右槽里原本有 7 个按钮（材料面板的「文件／知识／成果」、范围预览的「重新试算」、两处「刷新」、经验建议的「集中管理」）与消息中心的两个动作，**都没有自己的外观类**，全靠 `.selected-materials-actions button`、`.context-section .selected-materials-heading > button`、`.notification-panel-actions button` 这类容器后代选择器发力。槽位结构一换，它们会整片掉回浏览器默认外观——这正是 §5 说的「皮住在容器里」的账，本轮把三档皮上收成两枚具名类：`.chip-button`（品牌底小胶囊，原 3px 6px 与 3px 8px 两档并成 3px 8px）与 `.quiet-button`（无底、悬停才出底）。`standards/coding-standard.test.ts` 新增「区块头基座纪律」三条护栏（已收编类不得复活／含 `.section-header` 的选择器里只有基座自己能写几何／基座外任何 `.tsx` 不得出现 `section-header*` 类名），三条都做过变异验证：分别把 `.settings-heading { display: flex }`、`.context-section .section-header { gap: 4px }` 与页面里手写一个 `section-header-text` 写回去，都能抓到。补 `SectionHeader.test.tsx` 5 例，含「空槽不渲染节点」这条——否则 `gap` 会在没有动作时撑出一道看不见的缝。

**字号收敛（需要光哥窗口回看）**：区块头标题统一到 13px（panel）／21px（block）。因此记忆页分组标题 14px → 13px、工具详情标题旁的状态由继承主文本改为 12px 弱化、工作空间简报的「标题＋说明」从同行 baseline 改为上下两行、消息中心头部动作按钮之间的缝 4px → 8px。都是同一族内的并档，但没有一条是 tsc／vitest 能判定的。

---

## 11. R2-C 落地状态（2026-09-27 16:30）

`npm run verify` 退出码 0（功能档 150 文件／1,442 用例，护栏 53 → 57 条）。

**`IconButton`（§3.1 P3）。** 新增 `components/IconButton.tsx`：`label` 必填（图标按钮没有文字，名称只能由属性给），方块两档——`sm` 23px／字形 12 给密集条带，`md` 28px／字形 14 给面板头；`aria-expanded`、`aria-haspopup`、`ref`（浮层锚点）与 `trailing`（徽标）由基座转发。**迁移 6 个渲染点**：侧栏折叠、错误横幅关闭、上下文面板折叠、模型抽屉关闭、结果提示关闭、能力选择器触发器。删掉的四套专属几何原本是 24／26／28／30px 四种边长、`--control-radius` 与 `--radius-tag` 两种圆角、字形 10／12／14／15px，另有两处 `font-size: 19px／22px`——那是 Unicode `×` 字符时代的残留，图标换成 SVG 之后它只负责把盒子撑高。 `.capability-picker-trigger` 与 `.sidebar-collapse-button` 作为领域钩子保留：前者只留带边框的皮（border／background／color），后者只留 `margin-left: auto`。

三处**刻意不迁**：① 消息中心的铃铛（34px 方块 ＋ 未读角标 ＋ 锚点 ref，它是侧栏导航件而不是面板头控件）；② 芯片里的 `.capability-chip-remove`（10px 命中区属于整枚芯片，塞进 24／28px 方块会把芯片撑破，随 R3-A 的 `CapabilityChip` 一起收，登记在护栏的 `ICON_BUTTON_EXEMPT_CLASSES`）；③ 知识详情的分页 `footer`（「上一页／读到哪了／下一页」不是「主行动＋取消」）。

**`ActionBar`（§3.1 P2）。** 新增 `components/ActionBar.tsx`：说明钉在左（`.action-bar-hint`，`margin-right: auto`），按钮按视觉顺序排、主行动恒在最右，容器 `as='footer' | 'div'`，并带 `role="group"` 与动作条名称——**这是全仓第一次给一排按钮一个语义容器**，此前 8 处一个 `role` 都没有。**迁移 7 个渲染点**：记忆编辑、材料选择、MCP 编辑、讨论节点、模型抽屉、成果修订、专家修订。删掉 `.memory-editor-footer`、`.material-picker-actions`、`.mcp-editor-actions`、`.discussion-checkpoint-footer`、`.expert-editor-actions`、`.model-sheet footer` 与 `.artifact-editor footer`（含它的 `> div` 与 `> button` 后代）七套自造排布，`gap` 8／12 与 `justify-content` flex-end／space-between 的分叉并掉。

**一处按约定改掉了现状**：MCP 编辑与专家修订这两排的「取消」原本在主行动**左侧**，另有五排在右侧——同一产品给出相反的按钮顺序。迁移时统一翻成「取消在左、保存在右」。这是本轮唯一一处会改变肌肉记忆顺序的改动，回看时请重点看这两处。

**护栏 53 → 57 条**：① 只装图标的裸 `<button>` 即失败（开始标签按引号与花括号配对解析，`onClick={() => x()}` 里的 `>` 不再骗过扫描）；② `.memory-editor-footer` 等 6 个动作条类不得复活（`RETIRED_UTILITY_CLASSES` 新增 `action-bar` 一档）；③ `.icon-button`／`.action-bar` 的外观与排布只由基座自己的选择器声明；④ 留在图标按钮上的领域钩子不得再写 `display`／`width`／`height`／`place-items`／`padding`／`border-radius`／`cursor`。四条各自做过变异验证：手写一个 `<button aria-label="关闭"><CloseIcon size={12} /></button>`、写回 `.memory-editor-footer { display: flex }`、写回 `.context-panel .icon-button { padding: 4px }`、写回 `.sidebar-collapse-button { width: 30px }`，以及把基座里的 `aria-label={label}` 删掉——五种变异都会被抓到并已在验证后原样回滚。新增 `IconButton.test.tsx` 5 例、`ActionBar.test.tsx` 4 例。

**需要光哥窗口回看的五个视觉点**：① 侧栏折叠按钮 24px → 28px 方块、字形 15px → 14px；② 模型抽屉关闭 30px → 28px，上下文面板折叠 26px → 28px，错误横幅与结果提示关闭 24px → 23px；③ 能力选择器触发器的悬停底色由 `--selection` 保持，但禁用时光标从 `default` 改为全局的 `not-allowed`；④ MCP 编辑与专家修订两排按钮**左右顺序互换**；⑤ 成果编辑器底部那两颗按钮回到标准档内边距（原本是页面自己覆写的 `8px 11px` ＋ `--radius-row`），讨论节点动作条的缝 12px → 8px。

---

## 12. R2-D 落地状态（2026-09-27 17:40）

`npm run verify` 退出码 0（功能档 151 文件／1,450 用例，护栏 57 → 60 条）。

**P10 的账收完了，但不是靠一个新基座。** 那 5 族 17 个「只有一个 `.active` 类」的按钮，其实是三种不同的事实，各自都有正路：

| 这族按钮在说 | 收口到 | 属性 |
| --- | --- | --- |
| 「现在在哪一页」（侧栏一级导航 5 项、设置左侧分区 6 项、侧栏「新建任务」与底部「设置」两颗单行） | **新增 `NavList`／`NavItem`** | `aria-current` ＋ `data-selected`，`<nav aria-label>` 区域名 |
| 「同一块内容换一种显示」（模型角色筛选 4 项） | **已存在的 `SegmentedControl`** | `role="group"` ＋ `aria-pressed` |
| 「这一行是当前查看的对象」（上下文面板执行记录、成果版本历史） | **已存在的 `ListRow`**（`variant="plain"`） | `selected` → `aria-current` |
| 「面板正开着」（消息中心铃铛） | 不需要选中态 | 复用它已经发布的 `aria-expanded`，删掉另写的 `.active` |

**新基座只有一个**：`components/NavList.tsx`。它的 `label` 是必填项——一串按钮没有区域名称，读屏听不出这是导航；折叠成窄栏时不换一套几何，只换 `--nav-item-width`／`--nav-item-padding`／`--nav-item-gap`／`--nav-item-label-clip` 四个自定义属性，窄屏媒体查询用的也是这同一组属性。**标签用 `clip-path` 收掉而不是 `font-size: 0`**：原先 `.sidebar-collapsed` 与 ≤720px 媒体查询各写了一份 `font-size: 0` ＋ `span { font-size: 15px }` 的把戏，而零号字号的文字在可及名称计算里是不可靠的——只剩图标的那一行可能整个没有名字。

删掉的自造定义：`.new-task` 全套行几何、`.primary-nav button`／`.settings-nav` 那一族（含 hover 与 `.active`）、`.primary-nav span` 图标列宽、`.settings-nav-list button`（含 `button + button { margin-top: 4px }`）、`.filter-bar` 三档、`.task-run-history button` 五段、`.artifact-version-list button` 四段，以及折叠态那两组重复规则。`.primary-nav` 作为钩子只留它自己的上下内缩，`.model-filter` 只留在清单上方的留白（`25px 0 9px` 并档为 `24px 0 12px`）。

**护栏 57 → 60 条**：① `RETIRED_UTILITY_CLASSES` 新增 `nav` 一档，上面那些类不得复活；② 含 `.nav-item`／`.nav-list` 的选择器里只有基座自己能写几何与配色（媒体查询换自定义属性因此合法）；③ **生产代码的 `className` 值里再出现 `active` 一词即失败**——这条是 P10 的真正收口，它不问你用哪个类名，只问「选中」这件事是否还由 CSS 类表达。三条各做过变异验证：把铃铛改回 `open ? 'notification-bell active' : …` → ③ 转红；写回 `.filter-bar { display: flex }` → ① 转红；写一条 `.sidebar .nav-item { padding: 4px 2px }` → ② 转红。三次验证后都整文件回滚并复绿。

第③条一开始误伤了 `ExpertsView.tsx:586`：那一行的 `onClick={() => onLifecycle('active')}` 里 `'active'` 是**专家生命周期**的领域值，不是类名。判据因此收到「只看 `className=` 之后、遇到下一个属性就停」的范围内——**护栏误伤要改判据，不是把误伤项塞进白名单**。

**需要光哥窗口回看的四个视觉点**：① 侧栏「设置」行在设置页时现在**常驻高亮**（原先只有悬停才有底，`.settings-nav.active { background: transparent }` 是特意压掉的）；② 侧栏折叠与窄屏折叠的图标行现在是 36px 方块＋裁切文字，视觉与原先的 `font-size: 0` 一致但命中区更规矩；③ 模型筛选四片从「无边框透明底＋品牌色选中」变成 `SegmentedControl` 的一体外框；④ 上下文面板的执行记录行与成果版本行改用 `ListRow`，选中底色从 `--surface` 变成 `--selection`，字号取基座的 13／12 两档。

**P10 记账归零**：全站生产代码里 `aria-current` 现在由 `NavList` 与 `ListRow` 两处产出，`.active` 作为**选中态**在渲染层已无实例（`PopoverMenu` 里剩下的那个 `active` 是键盘高亮，不是选中态，已在护栏里按文件排除）。

## 13. R2-E 落地状态（2026-09-27 18:20）

R2-E 是 R2 的收口档：把护栏补齐、把 §4.4 的行漏网与 §4.5 的借类清干净。它新增的基座仍然只有一个
（`CheckList` 在 R2-E 开工时就已落地，`BindingChip` 是本档新增），其余工作都是**把已经存在的能力认出来**：

| 本档动到的结构 | 处理 |
| --- | --- |
| 简报三条列表（`.brief-list button`，3 个渲染点） | 改 `ListRow variant="plain"`＋`multiline`，行几何与行内字号交回基座 |
| 本次材料行（`.selected-material-row`）、本运行记忆行（`.context-row`） | 改 `ListRow`（只读行，`title`＋`meta`） |
| 自动建议开关行（`.suggestion-setting-row`） | 改 `ListRow`，右侧 `AsyncButton` 进 `actions` 槽 |
| 上下文面板与专家页**逐字相同**的 MCP 工具勾选分组 | 合成 `components/McpToolBindingsPicker.tsx`，`.selected-mcp-list`／`.selected-mcp-connection` 两个借类退役 |
| Composer 三片（`.capability-chip`／`.material-chip`／`.expert-chip`）共用 `.capability-chip-remove`，且 `App.tsx` 直接借能力片的皮 | 合成 `components/BindingChip.tsx`（`BindingChip`＋`BindingChipBar`），三套几何并成一份，身份差异降成 `tone` 一档 |
| 建议卡的两个状态片（`.memory-kind`／`.memory-state`） | 改 `Badge shape="tag"`，`tone` 按生效状态映射 |
| `.tool-pill-status`／`.expert-card-status`／`.artifact-input-card-meta`／`.model-role-icon` | **判读为不是徽标**：分别是胶囊按钮内的状态词、卡片内的一句警示文案、卡片的次要信息文本、以字形成立的图形化角色标识。四者按理由登记进护栏的例外表，避免下一轮被误并 |

**基座能力补了一档**：`ListRow` 的 `multiline`（`.list-row[data-overflow='wrap']`）。三处漏网此前留着自造行几何，
真实原因不是懒——基座的标题与 meta 是单行省略号，而简报条目与被选记忆**整句就是内容**，
套默认档会把用户要看的那句话切掉。**基座表达不了就说基座表达不了**，把能力补进基座，而不是让页面留在外面。

**版心收成一个 Token**（§4.1 的后半段）：新增 `--page-body-width: 860px`，由 `.page-body` 消费。
讨论节点卡原先 760px、设置页正文原先 850px，与对话列（860px）在同一屏里三种行长；
现在 `.discussion-checkpoints`、`.settings-section`、`.composer` 与 `.page-body` 读同一个值，
「对话列与输入框同宽」这条规则第一次由 Token 而不是由两处相同的字面量保证。

**护栏 60 → 65 条**，五条都做过变异验证（每次验证后整文件回滚并复绿）：

| 新护栏 | 变异注入 | 结果 |
| --- | --- | --- |
| 被基座收编的借类不得复活（`borrow` 档，含 `.expert-option*`、`.message-action`、`.selected-mcp-*`） | 写回 `.selected-mcp-list { gap: 8px }` | 转红 |
| 页面不得替骨架补几何 | 写 `.workspace > .page-body { gap: 8px }` | 转红 |
| 版心宽度全仓只有一处 | 写 `.fake { width: min(700px, 100%) }` | 转红 |
| 版心 Token 只有一个定义点并被骨架消费 | 在第二个 `:root` 再定义一次；把 `.page-body` 改成 `width: 860px` | 两次都转红 |
| 只读状态片必须由 Badge 画 | 写 `.fake-status-chip { padding＋background＋border-radius }` | 转红 |

第③④条是**先被自己的判据咬了一口**再定型的：判据最初把 `Modal` 三档表面宽度（420／1080／480px）
也算成"第二套版心"，但浮层面板的宽度不是版心，是基座自己的表面几何——按理由登记例外而不是放宽判据；
同时把「例外」写成必须带理由字段的表，新增一行就得写为什么。

**门禁**：功能档 154 个文件／1,471 项测试（本档新增 `BindingChip` 6 项、`McpToolBindingsPicker` 6 项），
`CheckList` 4 项在开工段已落；护栏 65 条全绿；ESLint 与类型检查干净。

**需要光哥窗口回看的四个视觉点**（都属于"并档"必然带来的观感变化）：
① Composer 三片现在等高（28px）、同圆角，专家片仍是品牌色但不再是胶囊，材料片仍是描边；
② 简报条目、本次材料、本运行记忆三类行从"描边小卡"变成裸行（悬停才出底），密度由 `ul` 的 8px 缝控制；
③ 讨论节点卡从 760px 放大到 860px，与对话列、输入框同宽；设置页正文 850 → 860px；
④ 上下文面板的"本次材料／本次 MCP 工具"两节改用与记忆小节同一个 `.context-section` 壳，
MCP 那一节不再是灰底圆角卡，而是与相邻小节一样的分隔线小节。

## 14. R3-A 落地状态：SourceRow（2026-09-27 19:50）

§3.1 P12 记的是**同一条三元式写了两遍**：`isWeb ? GlobeIcon : isMcp ? CapabilityIcon : KnowledgeIcon`
与「MCP 工具／网页来源／本地资料」这组标签，在上下文面板的「已查阅来源」与成果详情的「运行访问记录」
各有一份。合并时暴露出的不只是重复——**两份拷贝的细节并不一样**：面板会区分「摘要来源／正文来源」
并注明「历史范围未记录」，成果页只会说「本地资料」；图标一个 12px 一个 10px；右槽按钮一个用行内动作皮、
一个自造 `.evidence-open-button`。也就是说同一条 Evidence 在两处报出**不同的身份**，
这比"重复"更糟：用户无法从界面上确认自己看的是不是同一件事。

`components/SourceRow.tsx` 是 `ListRow` 的一个**具名用法**，不是第二套行几何：
来源类型→图标与类型标签的映射收成一张表（三元式在渲染里造组件会被 `react-hooks/static-components` 拦下），
`showExcerpt`／`metaExtra`／`actions`／`onOpenSource` 四个入口把差异留在页面上——
「要不要显示摘要」是版面事实，「查看区间」带着页面的 hook 状态，「打开原文」才是来源行共有的动作，
并且**只有本地资料会渲染它**（网页与 MCP 的来源就是那次调用本身）。
成果详情顺手把「版本历史／运行访问记录」两个 `<strong>` 小节头换成 `SectionHeader`，
`.artifact-evidence-list` 的五条后代行几何删除并登记退役。

**护栏 65 → 66 条**：① 渲染层生产代码里再出现 `sourceType === 'web-page'|'mcp-tool'` 判据即失败
（只有 `SourceRow.tsx` 允许）；② `.artifact-evidence-list` 的 `article|b|div|span|small` 后代几何入退役清单。
两条都做过变异验证：在 `Welcome.tsx` 里写一条同样的三元式判据 → ① 转红；写回
`.artifact-evidence-list span { color }` → ② 与行几何档一起转红。每次验证后整文件回滚并复绿。

**一次真实事故记录（写在这里，因为它正是"回读校验"这条纪律的适用面）**：变异验证时用了
`cp 原文件 /tmp/s3.bak && … && cp /tmp/s3.bak 原文件` 的备份套路，但 `/tmp/s3.bak` 是**上一轮会话留下的同名文件**，
`cp` 因链式命令前一步失败而没有覆盖它，还原时把 `styles.css` 退回了 R2 之前的状态——
23 条护栏同时转红才暴露。处置：`git checkout HEAD -- styles.css` 回到 R2-E 提交态，
再逐条重放本轮 CSS 编辑（脚本里每条 `assert count==1`），并用 `git diff --stat` 确认
最终只剩 8 增 63 删。**教训**：临时备份必须用本轮新建的唯一文件名（带时间戳），
且**还原动作之后必须看一次 `git status`／`git diff --stat`**——工具报成功不代表文件是想要的那份。

**RunSummary 不在本档做**：它的四处拷贝有三处住在 `App.tsx` 的消息流与侧栏里（§3.2 已定位），
与 R3-B 的 `MessageBlock`＋`Composer` 外提是同一片代码，先外提再抽摘要行才不会改两遍。
本档只做 `SourceRow`，任务 #11 的范围据此收窄，RunSummary 并入 #12。

---

## 附：本轮核查方式

静态统计（Python／grep 脚本，产物在 `/tmp`）＋ 大文件逐一目视阅读＋ 关键结论二次复核（`.inline-message` 配色、`.page-scroll` 双实现、720px 版心、两套 keyframes、8 个死类、13 处 checkbox、`aria-current` 全站唯一、词表分叉）。**未做**：启动应用做视觉判断（按既有分工，界面验收归光哥）、真实模型下的长链路状态观察、`.app` 冷启动。上述"未做"意味着本文所有观感结论都是结构层面的，不能替代一次人工走查。
