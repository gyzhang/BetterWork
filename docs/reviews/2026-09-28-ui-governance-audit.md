# 2026-09-28 UI 治理全面校准（账本）

本轮目标不是再抽一个基座，而是**让「声明」与「强制点」重新对齐**：过去两周多轮局部收口在文档、规则、护栏里留下了一批互相矛盾或已失效的表述，它们不会变红，只会让下一个会话拿到相反的指令。

## 0. 基线与口径

- HEAD `8ce9d7f`（`fix(ui): 35 处内联错误表面 100% 迁入 InlineError`），工作树干净，未推送 0 笔。
- 护栏：`standards/coding-standard.test.ts` 单文件，2,802 行、90 条 `it()`、24 个 `describe` 节。
- 渲染层：171 文件 / 36,895 行；`components/` 下 40 个基座（含 `layout/`、`skills/`）。
- 生产源码口径：`apps/desktop/src/**/*.{ts,tsx,css}` + `packages/*/src/**/*.ts`，**排除** `*.test.*` 与 `standards/`。CSS 命中按护栏自己的口径——注释被抹平后不计入选择器。
- 调查方式：四路只读扫描（护栏前半 48 条、护栏后半 42 条、docs/10 声明回对、五份规则文件口径互斥），**每条 P1 与每条要动手的 P2/P3 都由主线自己 grep 复核过**，子代理清单只当候选。

## 1. 处置分级与裁决顺序

| 档 | 含义 | 处置 |
| --- | --- | --- |
| **P1** | 护栏静默空转：锚点在生产源码命中 0，或豁免清单里点名的东西已不存在 | 改锚点到基座并升级为绝对断言；死豁免直接删。每条做变异验证 |
| **P2** | 文档声明与强制点断线：写「已落地／清零／全仓无 X／共 N 种」而代码不成立 | 二选一：补齐，或把措辞改准。不许留「看起来已完成」 |
| **P3** | 口径互斥：同一件事在五份指令文件里说法不同甚至相反 | 归一到单一真相源 |
| **P4** | 抽取缺口：该抽没抽、抽了没人用、基座无测试 | 只登记交光哥拍板，本轮不实施 |

**裁决顺序（冲突时以谁为准）**：护栏与代码是地面真相 → 文档向它们对齐；三份文档互斥时，以与护栏一致的那份为准。依据是 `.qoder/rules/betterwork-code-style.md`：「三者冲突时以配置与护栏测试为准，并同时修正文档」。

**本文的 P1–P4 是「处置分级」，不是缺陷编号**，与两份评估报告里 `§3.1 P1`／`P10` 那套 `P` 编号无关（那套编号的归属见 docs/10 §10.1 开头新加的「引用约定」）。三套 P 编号同仓并存是本轮新造的歧义源，引用本文时写「校准账本 P1-3」这种带出处的前缀。

**退役绊线不算 P1**：`RETIRED_UTILITY_CLASSES`（73 条 pattern）与 `retiredSurfaces`（9 条）这类「不得复活」规则，命中 0 是它们**正在正常工作**的状态，不是空转。只有「必须存在／必须走基座／豁免清单」这三类锚点命中 0 才是 P1。这条判据是本轮与上一轮 `.inline-message` 事故的分界。

## 2. P1 护栏静默空转与死豁免（8 条，已逐条复核）

| # | 位置 | 事实 | 处置 |
| --- | --- | --- | --- |
| P1-1 | `standards:2416` | 「状态 · 时间」护栏的锚点是 `runStatusName[…]} · ${formatTime`，而基座 `RunSummaryRow.tsx:25` 已改成局部变量 `time`（`compact` 档走 `relativeTime`、常规档走 `formatTime`）。页面若复制 compact 档措辞（`· ${relativeTime(…)}`）不会被拦 | 锚点放宽为 `runStatusName\[[^\]]*\]\}\s·\s\$\{`，覆盖两种时间格式 |
| P1-2 | `standards:1684` | `ROW_HOOK_CLASSES = ['memory-row']`，但生产还有第二个行钩子 `.suggestion-job-row`（`styles.css:1789` 声明 `background`，`MemorySuggestionList.tsx:222` 使用）。谁往它身上加 `gap`／`padding`，护栏不红 | 补进清单；`docs/10:667`「现登记 `.memory-row` 一个」改为两个 |
| P1-3 | `standards:448`、`standards:1514` | 两条 `.current-badge` 豁免是死条目：生产 0 命中，`docs/logs/2026-09-27.md:31` 记录它已改走 `Badge tone="brand" shape="tag"` | 删两条豁免；连带修 `docs/12:166`、`docs/10:434` 的「当前模型徽标」 |
| P1-4 | `standards:1508` `MICRO_MARK_RADII` | `.artifact-evidence-list b` 死条目：该后代规则已不存在（容器本体在 `styles.css:4257`） | 删条目；`docs/10:515`「5 处」改 3 处 |
| P1-5 | `standards:1531` `NON_BADGE_CHIP_CLASSES` | `.chip-button` 死条目：活代码 0，仅 `styles.css:1061`／`3633` 注释提及；同名类另在 button 家族的退役清单里 | 删条目 |
| P1-6 | `standards:2216` `NAV_BASE_FILES` | `NavList.tsx` 死条目：登记的豁免理由是「基座自己渲染 `' active'` 高亮」，而该文件活代码已无 `active`（`NavList.tsx:100` 是注释），改用 `aria-current`／`data-selected` | 删条目并核对护栏仍绿 |
| P1-7 | `standards:1828`、`standards:2043` | 两条豁免都「从未被行使」，但**性质不同**：`BUTTON_BASE_OWNERS` 的 `/^\.icon-button\b/` 是**结构性不可达**——`stylesAButton`（`standards:2170`）要求 `button` 前面是 `,`／`>`／空白／`(`／`+`，连字符不算，`.icon-button` 永远进不了 population；`HEADING_RULE_OWNERS` 的 `/^\.section-header/` 是**可达但当前未行使**（`.section-header h2` 一旦出现就会用到它） | 前者已删（纯噪声，还会误导读者以为图标按钮需要豁免；它的外观另由「图标按钮与动作条的外观只由基座的选择器拥有」那条管）；后者**保留**，它是基座的正当登记而非死条目。子代理把两条归成一类，判定被主线推翻 |
| P1-8 | `standards:758` | `sheet-backdrop\|dialog-backdrop` 全仓 0 命中，但这是**退役绊线**——命中 0 正是它在工作，按 §1 判据不算 P1（子代理归类错误）。真缺陷是它躲在 `if (owners.includes(relative)) continue` 后面：最可能把旧背板类写回来的正是 `Modal.tsx`／`notifications.tsx` 这两个 owner，而它们被整文件跳过 | 已把这条检查提到 owners 豁免之前；变异验证：往 `Modal.tsx` 的 JSDoc 里写一个 `sheet-backdrop` → 精确报红 |

## 3. P2 文档声明与强制点断线（10 条）

| # | 位置 | 声明 | 实际 |
| --- | --- | --- | --- |
| P2-1 | `docs/10:838` | 「`.action-note.ok`／`.success-copy` 两条内联成功通道已收（2026-09-28）」 | 两者都还活着：`.action-note` 规则在 `styles.css:3756/3761/3764`、渲染于 `App.tsx:1505-1506`；`.success-copy` 在 `styles.css:2355`、用于 `SkillsView.tsx:332` 与 `DependencyPanel.tsx:185`。**且 `docs/10:836` 同一节又说 `.action-note` 不迁进基座——文档自相矛盾** |
| P2-2 | `docs/10:750` | `MessageBlock`／`Composer`／`ConnectionStatus`／`RunSummary`／`SourceList`「只是宿主文件里的内联 JSX（ConnectionStatus 三份、RunSummary 四份）」 | 五者均已是独立基座并在用（MessageBlock 6、Composer 1、ConnectionStatus 3、RunSummaryRow 5、SourceRow 2）。同段「尚未落地的只剩 Skeleton」与 `:583` 自列的待落地清单矛盾；「App.tsx 1,876 行」实际 1,829 行 |
| P2-3 | `docs/10:623` 自称「本表是组件层的唯一台账：新增基座必须登记在此」 | 台账漏登记 7 个已存在并在用的组件 | `WorkspaceSelector`（`Composer.tsx:13/106`）、`WorkspaceIdentityDialog`（`App.tsx:50/1796`，ADR-0029）、`ComposerCapabilityPicker`、`DiscussionCheckpointPanel`、`MemoryCaptureSource`、`MemorySuggestionList`、`WorkspaceBrief` |
| P2-4 | `docs/10:665` | 「共 10 种…登记进 `NON_ACTION_BUTTON_SHAPES`」 | 数组实为 **8 条**（`standards:2012-2024`，主线逐条数过） |
| P2-5 | `docs/10` 多处 | 计数类漂移 | Field 37→**48**、SectionHeader 26→**49**、IconButton 7→**10**、ActionBar 7→**12**、ListRow 12→**31**、Disclosure 6→**11**、InlineError 35→**38**、RunSummaryRow 2→**5**；`:466/468` gap/margin 六档计数全不符（**值域仍全在标尺，偏离 0 成立**）；`:434` <12px 仍是 5 处但构成不同（`.current-badge` 已消失，见 P1-3） |
| P2-6 | `docs/10:628` | 点名 `applyWorkspaceDirectory(failureMessage)` | 全仓 0 命中；`Composer.tsx:34/106` 现走 `workspacePicker` prop |
| P2-7 | `docs/10:572` | 「`components/ContextPanel.tsx` **导出的** `ActivityGroupRow`」 | 函数存在（`ContextPanel.tsx:972`）但**无 export**，模块私有 |
| P2-8 | `docs/10:605` | 位置列把 `notifications.tsx` 与 `components/TransientToast.tsx` 并列 | 它在 `renderer/src/notifications.tsx`，不在 `components/` 下 |
| P2-9 | `docs/10:744` | 「`ConfirmationDialog`…以 `Modal` 的 `alertdialog` 变体实现」 | `ModalVariant`（`Modal.tsx:24`）无该档；`alertdialog` 是 `alert` prop 推出的 role，`ConfirmationDialog.tsx:30` 用的是 `variant="dialog"` |
| P2-10 | `docs/10` 15 处 | 引用 `§3.1`／`§3.2`／`§3.4`／`§4.3`／`§4.4`／`§4.5` | 这些编号在 docs/10 内**不存在**（§3、§4 都无子节）；实际对应 `docs/reviews/2026-09-26-ui-consistency.md` §3.x 与 `2026-09-27-ui-reuse-audit.md` §4.x，但 15 处引用**均未点名文件** |

## 4. P3 规则文件口径互斥（18 条）

裁决：以护栏与代码为准。下表「以谁为准」列已按此判定。

| # | 主题 | 互斥双方 | 以谁为准 |
| --- | --- | --- | --- |
| P3-1 | 内联错误承载 | `AGENTS.md:111`「用内联 `.inline-message.error`」 vs `rules/betterwork-ui.md:44`＋`docs/12:160`「用 `InlineError`」 | 后者。`.inline-message` 规则已删（`styles.css` 只剩 718/2360/2394/4245 四行注释），且被 `standards:2678` 列入「不得复活」——**照宪法写即门禁红** |
| P3-2 | 间距标尺覆盖面 | `docs/12:167`「`margin` 与 `padding` 暂未纳入，仍待逐页收口」 vs `docs/10:468`「margin 已并入」＋`rules/ui:14`＋护栏 `SPACING_PROPERTIES`（`standards:586-596`）已含 margin 全系 | 护栏。`docs/12` 落后一轮 |
| P3-3 | 字号豁免清单 | `docs/12:166` 列「当前模型徽标」 | 删（见 P1-3） |
| P3-4 | 台账指针 | `rules/betterwork-ui.md` **22 处**「组件台账（docs/10 §10.1）」；护栏错误消息 `standards:2406/2417`、CSS 注释 `styles.css:1792/1795` 同样写 §10.1 | 台账实在 **§10.2**（589-632）。§10.1（555-558）是 4 行基础组件清单，其中 **10 个名字在 `components/` 下不存在**：Input、Textarea、Select、Popover、Menu、Dialog、Sheet、Toast、Progress、Skeleton（实为 `PopoverMenu`／`Modal`／`TransientToast`＋`ToastHost`；Input/Textarea 只有样式类无组件；Progress/Skeleton 未落地） |
| P3-5 | Button `tone` 生效范围 | `docs/10:607`＋`:661`「只对 `outline` 生效」 vs `rules/ui:27`＋`Button.tsx:18`「带边框的三档」 | **三处全错，已按 CSS 与调用点改准**：`styles.css:525-541` 为 `secondary`／`text`／`outline`／`quiet` 四档写了 brand 规则、danger 另含 `link`；生产实际用在 quiet(8)／secondary(3)／outline(2)／text(2)。`link`＋tone 与 `neutral` 生产未用。台账行改为指向正文，不再抄第二遍数字 |
| P3-6 | 卡片可点区 | `docs/10:730`「整卡仍是进入配置的点击区」 vs `rules/ui:25`「只包住身份＋说明」 | 后者（`Card.tsx:78-97`：只有 `.card-main` 是 `<button>`） |
| P3-7 | Disclosure 入口 | `docs/10:734`「只有 `label`／`defaultOpen`／`className` 三个入口」 vs `rules/ui:26`「`open` 是受控属性、`onToggle`」 | **两者都不完全对**：`Disclosure.tsx:8-14` 既无 `open` 也无 `onToggle`（内部 `useState(defaultOpen)`）。以代码为准改两处 |
| P3-8 | 裸标题例外处数 | `docs/10:671` 同段并存「两处登记例外」与「三处例外」；`rules/ui:24` 写三处 | 护栏是**两张表**：TSX 侧 `HEADING_FILE_EXEMPTIONS` 2 项、CSS 侧 `HEADING_RULE_OWNERS`。两份文档都把两张表当一张 |
| P3-9 | 字号下限 | `AGENTS.md:120`＋`rules/ui:17`「9–10px」／`docs/10:436`「9–11px」／`docs/12:166`＋护栏「12px」 | 12px（护栏 `standards:443`） |
| P3-10 | 硬编码色值例外 | `AGENTS.md:122` 零例外／`docs/10:949`「只剩色系预览卡一处」／`rules/code-style:30` 四处／`docs/12:193` 三项且混入字号豁免 | `rules/code-style:30`（与护栏两套机制一致：CSS 侧 `SWATCH_SELECTOR`＋TS 侧 `allowedFiles` 三文件） |
| P3-11 | IPC 收口判据 | `AGENTS.md:131`＋`rules/code-style:24`「按失败要不要让用户看见」 vs `docs/12:160`＋`rules/ui:44`＋`docs/10:833`「按是否已有内联／浮层承载」 | 后者（更新的判据）。**2026-09-29 更正**：本行原文还写了「且配护栏『同一动作链既写内联又上传全局即失败』」——`standards/coding-standard.test.ts` 里没有这条 `it()`，是主线自己写下的假声明（正是本文 P2 类「文档声明与强制点断线」的同一病灶，出现在账本自己身上）。docs/10 §11.5.1 的「护栏锁四条」同步改准：该判据静态测不到（要跨调用链做数据流分析），只能靠评审 |
| P3-12 | 图标 SVG 例外 | `docs/12:169` 无例外 vs `rules/ui:18`「品牌字标与格式徽标除外」 | 后者（实现里品牌字标确为文字） |
| P3-13 | 定宽列宽度 | `rules/ui:35`＋`docs/10:446`「宽度写死」 vs `docs/10:279/282`「可在 220–320／340–440px 调整」（§8.1 又注「拖拽未实现」） | 写死。删掉可调整那句或标明未实现 |
| P3-14 | 空态档数 | `docs/10:643` 两档 vs `rules/ui:20`＋`docs/10:673` 三档 | 三档（`EmptyState.tsx` 导出五个） |
| P3-15 | 多选控件 | `docs/10:649`「一律留原生 checkbox」＋`docs/10:691`「一律用 `CheckList`／`McpToolBindingsPicker`」 vs `rules/ui:32` 只说原生 checkbox | 两条并存不矛盾但 `rules/ui` 漏了后半，补指针 |
| P3-16 | Toast 数量 | `docs/10:558/800` 单一 Toast vs `docs/10:834`＋`rules/ui:44` 两个；`docs/12:158` 只点名 `TransientToast` 并写「禁止第二套 Toast」 | 两个。**只读 docs/12 会把合法的 `ToastHost` 当违禁** |
| P3-17 | 覆盖缺口 | `AGENTS.md` §7 未提 `npm run bench` 与 `*.bench.test.ts`；Button／ListRow／SectionHeader／NavList／Composer 等基座纪律在 `docs/12` §8 与 `AGENTS.md` §6 里一条都没有 | 补指针（不复述正文） |
| P3-18 | 规则文件自我声明 | `rules/code-style.md:11`「本文件只是速查入口，不复述也不另立标准」，实际 `:15-31` 有 14 条是完整规则正文，`:24` 已因复述产生 P3-11 的分叉 | 登记为 P4，改法要光哥拍板（降级成指针会牺牲速查性） |

## 5. P4 只登记，本轮不实施

- **8 个基座无同名测试**（2026-09-29 由 9 减为 8：`TransientToast` 已补，见 §7 的 C3）：`InlineError`（全仓 38 处调用的唯一出口）、`FieldSelect`、`MemoryCaptureSource`、`ModelEditorSheet`、`Welcome`、`WorkspaceGroupList`、`WorkspaceIdentityDialog`、`WorkspaceSelector`。
- **R3-D 遗留**：`ContextPanel.tsx` 25 个局部组件下沉、`ArtifactCard` 两份合并、`ListRow` 缺「整行可点＋卡片底部动作区」档（`.expert-card`／`.skill-card` 因此各写一套）、容器后代选择器发的皮改具名皮。
- ~~**被回退那轮的四条已核实缺陷**~~ **四条已全部落地（2026-09-29，见 §7 的 C1–C4）**：`.memory-*-hint` 字色被 `.memory-row small` 特异性吞（换基座后 tone 由 `[data-tone]` 出，才真落得上）；`TransientToast` 自消 `useEffect` 把内联箭头 `onDismiss` 列为依赖（**修法改在基座**：回调经 ref 转发，依赖只剩 `[tone, message]`——包五个 `useCallback` 拦不住下一个页面，全仓当时还有 3 处内联箭头没被那轮的 patch 覆盖）；`.memory-projection` 是反馈收口漏掉的第 8 个带底错误条（迁进 `InlineError`）；`.action-note` 实为动作结果（拆成失败进 `InlineError`、成功进 `TransientToast`，三条规则删除）。成品备份仍在 `/tmp/bw-status-axis-20260928/`。
- `docs/10` §3／§4 无子节编号，是 P2-10 那 15 处引用落空的根因。
- **护栏只校验 `tone` 的值集合，不校验 `tone` × `variant` 矩阵**（`standards:2124` 只做三组档位穷举相等）：写 `variant="primary" tone="danger"` 不会红，但 CSS 里没有这条组合规则，语义色静默无效。要不要补一条矩阵护栏交光哥拍板。
- **护栏判据盲区：状态片的判据只看类名尾词，元素选择器不参与匹配**（`standards:1543-1566`，判据是「选择器里出现的类名以 `chip|badge|status|state|kind|pill` 结尾」）。`DiscussionCheckpointPanel.tsx:186` 的 `<span data-status>` 因此逃过「只读状态片必须由 Badge 画」——它的选择器是 `.discussion-checkpoint-history span`，唯一类名不以那些词结尾。附带：`data-status` 在 `styles.css` **0 命中**，该属性当前不驱动任何外观（死属性）。要不要把判据扩到「元素选择器 ＋ 片状三件套」交光哥拍板。
- **`DiscussionCheckpointPanel.tsx:147-165` 手写复选框组未走 `CheckList`**：`<fieldset>`＋`.map()` 出 `<label><input type="checkbox">`，而 `CheckList.tsx:16-18` 的注释正好写了这种场景的用法（已在 `<fieldset><legend>` 里就不传 `label`）。护栏 `standards:788` 只把 `.discussion-checkpoint-artifacts label` 登记进 label 排版豁免，**豁免的不是结构**，所以门禁不红。
- ~~**`WorkspaceBrief` 的空态自造，但与既有登记打架**~~ **已落地（2026-09-29，光哥拍板：判为漏迁，不是有意例外）**：四处空态（`:73-79`／`:84-94` 的 `.context-placeholder`＝`EmptyNotice` block 档同形，`:114`／`:150` 的 `.brief-empty`＝line 档同形）改用 `EmptyNotice`；「谁给水平内缩」与「空态由谁渲染」因此拆开——内缩仍由已登记的 `.brief-panel` 这件分段壳负责，两个自造类删除并进 `RETIRED_UTILITY_CLASSES`（`empty` 族）。同步改完 `ContextPanel.test.tsx:736` 的 `INSET_OWNERS`（删 `context-placeholder` 一行、`brief-panel` 的理由补上「简报空态也套这件壳」）、docs/10 §9.8 的壳清单（改为以 `INSET_OWNERS` 为唯一清单，不再在正文复述件数）、`.qoder/rules/betterwork-ui.md` 的同条。
- **`MemorySuggestionList.tsx:100-108`** 候选为空时写 `<p className="context-hint">` 而非 `EmptyNotice`（轻微：`.context-hint` 是通用提示类，`ContextPanel` 13 处在用，不是占位专用类）。
- **`MemoryView.tsx:984` 用内容当 React key**：`<li key={line}>{line}</li>`，两行文字相同时 key 重复。2026-09-29 跑 `MemoryView.test.tsx`（MI07 冲突来源回看那例）时 React 打出实测警告「Encountered two children with the same key … may cause children to be duplicated and/or omitted」。**经核不是本轮引入**：`git show HEAD:` 与本轮工作树的 `key=` 集合逐字相同（只有行号平移）。修法是一行（`key={`${index}:${line}`}`），但它改的是列表协调行为、与状态轴无关，留待拍板。
- **`MemoryCaptureSource` 的可及名称有竞争**：包裹式 `Field` 的标签被 `<textarea aria-label="回答原文">`（`:51`／`:57`）覆盖，读屏听到的是后者。
- **`WorkspaceSelector` 生产路径零覆盖**：无同名测试，`Composer.test.tsx:26` 传的是桩 `workspacePicker`。它是输入区顶部的空间入口，改坏了没有测试会红。
- **同一条规则在 docs/10 内部写两遍**（台账行 ＋ 正文段）是本轮实测踩到的坑：修 `tone` 时先改了正文、漏了台账行，靠回读 grep 才发现。凡改这类规则，必须同时 grep 台账行与正文段两处。
- **表格中间插散文或空行会把台账在渲染时截成几块**（实测 docs/10 §10.1：一行「本表是唯一台账」的散文夹在第 620 与 622 行之间，另有两处空行，45 行的表被切成三段，而全仓约 100 处指针指向它）。已修：散文移到表前、空行删净，并在表前写下这条约束。

## 6. 验证车道（本轮硬约束）

上一轮「状态呈现轴」就是因为验证窗口本身成了交付阻塞而被叫停（机器负载 26→9→20→56→150，全量测试每次换一组红项，单文件复跑却绿）。本轮据此定：

1. 改护栏 → 只跑 `standards/coding-standard.test.ts` 单文件；改组件 → 只跑该组件与引用它的视图测试。
2. 全量 `npm run verify` 只在收口跑一次，**跑前先看负载**（`sysctl -n vm.loadavg`）：1 分钟 ≥10 就按「p50／p95 是否同比例放大」取证并写明未追红，不拿墙钟当阻塞。
3. 每条 P1 修复做变异验证：打穿后必须**只让该红的那条红**，还原后 `git diff --stat` 确认生产源码干净。
4. **红项第一次轮换就当场说明**，不等第三次。

## 7. 进度

| 批次 | 内容 | 状态 |
| --- | --- | --- |
| B1 | 账本建立＋四路扫描＋主线复核 | ✅ 本文 |
| B2 | P3-1／P3-2／P3-3／P3-11：`AGENTS.md:111`（改指 `InlineError`）、`AGENTS.md:131`（补 IPC 二选一判据）、`docs/12:166`（删「当前模型徽标」豁免）、`docs/12:167`（margin 已入六档尺、padding 走控件档位） | ✅ 已回读 |
| B3 | P3-4：**改法是让节号对上既有指针，而不是改约 100 处指针**——删掉 §10.1 那份 4 行假清单（17 个名字里 10 个不存在），把原 §10.2 改名为「§10.1 组件台账与基座纪律」。全仓 181 处 `§10.1` 引用中属于 docs/10 的那约 100 处（`rules/ui` 22、`standards` 41、`styles.css` 31、10 个组件注释）自动变正确，一处未改；docs/10 自身 4 处 `§10.2` 引用改写为「上面那份清单」，两处「§10.1 对 Input／Textarea 的口径」改为就地陈述 | ✅ 已回读，残留 `§10.2` = 0 |
| B5 | P2-1／P2-2／P2-4／P2-6／P2-7／P2-8／P2-9 ＋ P2-5 的三项（字号构成、圆角 5→3 处、`App.tsx` 1,876→1,829 行） | ✅ 已回读 |
| B6 | P3-5（`tone` 四档，三处全错）、P3-6（卡片可点区只包 `.card-main`）、P3-7（Disclosure 四个入口，`open`／`onToggle` 是内部状态） | ✅ 已回读 |
| — | 门禁：`npx vitest run --project functional standards/coding-standard.test.ts` → **90 passed / EXIT=0**（负载 100.25 下跑的；本批只动文档与一处 JSDoc 注释） | ✅ |
| B4 | P1-1～P1-8：护栏锚点与死豁免。已修 6 条（运行摘要锚点放宽、`.suggestion-job-row` 补进行钩子清单、`.current-badge`×2／`.artifact-evidence-list b`／`.chip-button` 四条死豁免删除、`NavList.tsx` 白名单删除＋其 JSDoc 里那个会挡枪的 `className={…'active'…}` 字面量改写、`/^\.icon-button\b/` 删除、旧背板绊线提到 owners 豁免之前）；P1-7 的 `/^\.section-header/` 与 P1-8 的绊线本体经复核**保留**，理由见 §2 | ✅ |
| — | B4 变异验证四发，每发都精确点名注入点、还原后工作树无残留：**M1** 探针文件写 compact 档措辞 → 报红；再用 node 单独跑两个正则证明**旧锚点对同一串命中 false**（漏洞是真的，不是我想象的）。**M2** 给 `.suggestion-job-row` 加 `gap: 8px` → 报红；把清单退回 `['memory-row']` 后同一条变异 **EXIT=0 静默通过**（反证成立）。**M3** 往 owner `Modal.tsx` 的 JSDoc 写 `sheet-backdrop` → 报红（改前该文件被 `continue` 整文件跳过）。**M4** 追加 `.mutation-probe { font-size: 10px }` → 报红，证明删掉 `.current-badge` 豁免没有把字号护栏一起拔掉 | ✅ |
| — | 门禁：护栏＋`NavList.test.tsx`＋`Button.test.tsx` → **3 文件 / 103 用例全绿，EXIT=0**；`prettier --check` 干净；`tsc --noEmit` EXIT=0（负载 7.67） | ✅ |
| B6′ | P3-8～P3-12、P3-14～P3-17 已归一：字号下限**五处落点**统一到 12px（AGENTS／docs/10 两处／docs/12／规则文件；此前 9–10px、9–11px、12px 三个阈值并存）；硬编码色值例外**四套清单**统一到护栏真实的两套机制，并把 docs/12 里混在一句的色值轴与字号轴拆开；docs/12「禁止第二套 Toast」改为「第三套」并点明既有两套分工（原文会让只读工程规范的智能体把合法的 `ToastHost` 当违禁删掉）；docs/12 §8 与 AGENTS §7 各补一条指针（基座纪律归 docs/10 台账、bench 车道归 §9）；空态补 `EmptyPage`／`LoadingPage`／`ErrorPage`；裸标题例外改准为 TSX 侧与 CSS 侧**两张**白名单；规则文件的成组勾选补 `CheckList`／`McpToolBindingsPicker` 指针。**P3-13 经核降级为不算互斥**：docs/10 §8.1 是「规格／现状」两列，现状列已注明拖拽未实现 | ✅ 提交 `95bc1ab` |
| B7 | P2-5 计数与 P2-10 指针已处理：14 处（docs/10）＋12 处（护栏注释）裸 `§3.x`／`§4.x` 改为**三处消歧约定**（点名两份报告各自的小节范围与 `P` 编号上限，判据「P4 及以上一定在 09-27」），逐处改写 26 处成本高且会再漂；规则文件那条就地补报告名。计数类改成「快照处数＋不变量」两段式（gap／margin 逐档处数、IconButton 7→**10**、ActionBar 7→**8**，且 IconButton 那份清单里还列着已删除的错误横幅）。**过程中主线自己写错一个指针**（把 `§3.1 P10` 归给 09-26，实际在 09-27），已修——写新指针前必须先验目标存在 | ✅ 提交 `103ddaa` |
| B7′ | P2-3：台账补 7 行（`WorkspaceSelector`／`WorkspaceIdentityDialog`／`ComposerCapabilityPicker`／`DiscussionCheckpointPanel`／`MemoryCaptureSource`／`MemorySuggestionList`／`WorkspaceBrief`），台账 38→**45 行**。**判定：7 个都不是「跨视图基座」**——只有 `MemorySuggestionList` 有两个生产消费者（`ContextPanel:228`、`MemoryView:435`），其余各一个。但按既有口径它们**仍应登记**：那条「单消费者不抽」的判据是「抽出来会不会制造第二处真相」（`SettingsLayout` 是三行壳、`ModelProfileRow` 就是 `ListRow` 填槽），不是消费者数量；这 6 个各自承载不可归约的领域推导。台账已有先例（`McpToolBindingsPicker` 行明写「不是新基座，是 `CheckList` 之上的领域组件」），7 行照此措辞登记。顺带修两处：`Composer` 行的「工作区两颗按钮（打开本地文件夹／新建工作区）」已过期（`App.tsx` 里 `selectDirectory` 0 命中，2026-09-28 合并成唯一入口 `onNewWorkspace`）；台账表被一行散文与两处空行**从中间截断**，45 行的表渲染成三块 | ✅ 护栏 90/90 绿 |
| B8 | 收口：全量 `npm run verify` **EXIT=1，归因并发争抢、非本轮回归**——`lint`／`format:check`／`typecheck` 三关全过，`test` 阶段 15 条失败**全是超时、断言失败 0 条**（13 条撞 5s，`mac-process-supervisor` 连 40s 的都撞线），跑时负载 37.26。取证三步：6 文件串行复跑 → 5 个全绿、只剩 `App.test.tsx` 2 条超时**且红的用例与全量跑时那 6 条完全不同**（红项轮换）；`App.test.tsx` 单独跑 → **35/35 绿**（43.27s，负载 14.04）；`git diff 8ce9d7f..HEAD -- apps packages` → 本轮对生产源码只动了 **2 文件 3 行 JSDoc 注释**。未改阈值、未跳用例、未写成「已绿」。当日日志 `docs/logs/2026-09-29.md`；记忆已更新（工作空间身份改为已落地、核对法补入本轮判据、被回退那轮加接手指针） | ✅ |
| B9 | **门禁构成问题（新浮出，待拍板）**：`App.test.tsx` 整文件渲染全应用，同文件里已有用例被显式放宽到 15s、其余仍吃 5s 默认值，只要机器有别的会话在跑，红哪几条就是随机的。可选：把重型渲染文件挪进串行档（与 `*.bench.test.ts` 同机制、不同项目）／给整文件一个 `describe` 级统一超时／在 `verify` 里对它单独串行一遍。**不是本轮引入的，也不该靠调阈值掩盖** | ⬜ |
| C1 | **接回被回退那轮的成品**：`git apply` 分三段——先 `--check` 逐段验，渲染层 7 文件与 `standards/` 两段都干净直应用；docs/10 两段**手写**（patch 在这里冲突：它基于更早的文本，而 B5 已把同一处措辞改准为「已查出、尚未收口」）。两个新文件 `cp` 回 `components/`。落地前先量负载：12.32，故本轮**不在批次中途跑全量 verify** | ✅ |
| C2 | **状态轴落地**：`StatusNote` 基座＋8 处收编；`.memory-projection`（第 8 个带底错误条）迁 `InlineError`；`.action-note` 三条规则连同唯一调用点拆给 `TransientToast`／`InlineError`；`.danger`／`.danger-text` 两条裸字色 utility 清掉（源码零引用，留着就是下一条内联成功通道的入口） | ✅ |
| C3 | **`TransientToast` 的自消缺陷修在基座**：那轮的 patch 只把 `App.tsx` 两处 `onDismiss` 包进 `useCallback`，实测全仓还有 3 处内联箭头（`App.tsx:1830`、`WorkspaceBrief.tsx:181`、`ArtifactView.tsx:844`）没被覆盖——同一类缺陷没在共享层收口。改为回调经 ref 转发、依赖只剩 `[tone, message]`，并补同名测试 5 例（P4「9 个基座无测试」→**8**）。`App.tsx` 那两个 `useCallback` 随之撤回：基座修好后它们的注释「回调必须稳定」就成了仓库里的假陈述 | ✅ |
| C4 | **`WorkspaceBrief` 四处空态归 `EmptyNotice`**（光哥已拍板），`.context-placeholder`／`.brief-empty` 退役进 `empty` 族；`INSET_OWNERS`、docs/10 §9.8、规则文件三处同步 | ✅ |
| C5 | 护栏 90→**95**（「状态呈现纪律」4 条＋「反馈通道纪律」1 条），**变异验证 9 发**逐条自证：M1 复活 `.appearance-note` → 1 红；M2 复活 `.danger` → 1 红；M3 给 `.status-note` 加 padding → 1 红；M3b 加 `[data-tone='info']` 第五档 → 1 红；M4 加未登记语义字色 → 1 红（**第一发不净**：拿已存在的 `.brief-note` 注入，连带触发「独立类选择器不得被拆成两处」，换新类名重跑才是 1 红）；M4b 把已登记例外的字色改掉 → 1 红且报的是**清单自核**那句；M5 把 `onDismiss` 塞回依赖 → 恰好 2 红（护栏＋组件测试，后者的报错正是旧行为「累计 6s 一次都没调用」）；M5b 拆掉 ref 转发 → 1 红；M6 复活 `.context-placeholder` → 1 红。还原后 `diff` 对生产源码为空 | ✅ |
| C6 | **文档对齐**：docs/10 台账补 `StatusNote` 行（45→**46**）＋ 更正 `InlineError` 行那句「`.action-note` 已删」（实际当时没删干净，本轮才删）＋ 新增 §11.5.2 ＋ §11.5.1 的「护栏锁四条」改准；docs/12 §8 补状态轴一段与「计时器 effect 的依赖不是回调标识」判据；`.qoder/rules/betterwork-ui.md` 的 `.action-note` 误判作废、补 `StatusNote` 条与「内缩／空态是两件事」 | ✅ |
| — | 门禁（按 §6 车道，负载 12.32 下不跑全量）：`npm run typecheck` **EXIT=0**；改动文件 `eslint` **EXIT=0**、`prettier --check` 干净；`vitest run --no-file-parallelism` 10 文件（护栏＋`TransientToast`＋`StatusNote`＋`ContextPanel`＋`DependencyPanel`＋`MemoryView`／`SettingsView`／`SkillsView`／`KnowledgeView`／`ArtifactView`）→ **202 passed / EXIT=0**。**收口全量 `npm run verify` EXIT=0**（07:54 负载 2.33，五关全过，169 文件 / 1601 用例全绿；对基线 167／1586 是 +2 文件 / +15 用例，恰为两个新测试文件与 5 条新护栏，算术闭合） | ✅ |

## 8. 下一轮

§8 原先写的「先动状态呈现轴」已于 2026-09-29 落地（C1–C6）。**「一句界面文字该由谁出口」这条轴到此收完**：反馈轴（§11.5.1）与状态轴（§11.5.2）各立一条，两轴各只有一个出口组件，任何一句界面文字都能被问到「它是哪一轴的、由谁渲染」。

剩下按优先级排的候选，都还**待光哥派发**：

1. **R3-D 大块**（P4 里唯一还剩的结构性欠账）：`ContextPanel.tsx` 25 个局部组件下沉、`ArtifactCard` 两份合并、`ListRow` 缺「整行可点＋卡片底部动作区」档（`.expert-card`／`.skill-card` 因此各写一套）、容器后代选择器发的皮改具名皮。
2. **8 个基座补同名测试**，`InlineError` 优先（全仓 38 处调用的唯一出口，改坏了没有测试会红）。
3. **B9 门禁构成**：`App.test.tsx` 整文件渲染全应用、超时档位不齐，红哪几条随机器负载而变。这个不解决，每一轮的收口取证都要重做一遍。
4. **护栏判据补强**：`tone` × `variant` 矩阵、状态片判据的元素选择器盲区（`DiscussionCheckpointPanel` 的 `<span data-status>` 逃过 Badge 那条，且 `data-status` 在 CSS 0 命中＝死属性）、`DiscussionCheckpointPanel:147-165` 手写复选框组未走 `CheckList`。
5. **零碎**：`MemoryView.tsx:984` 用内容当 React key（实测已打出重复 key 警告）；`MemorySuggestionList` 的空态未走 `EmptyNotice`；`MemoryCaptureSource` 的可及名称被内层 `aria-label` 覆盖；`WorkspaceSelector` 生产路径零覆盖。
6. **`betterwork-code-style.md` 的自我声明**（仍未拍板）：它自称「只是速查入口、不复述也不另立标准」，实际 14 条是完整规则正文并已因复述产生过一次口径分叉（IPC 判据）。降级成指针会牺牲速查性；保留则要改那句声明，并加「改规则必须同步两处」的硬约束。

**本轮新沉淀的一条判据**：文档里写「已配护栏」之前，必须 `grep` 到那条 `it()` 的标题。P3-11 那行假声明是主线自己上一轮写下的——账本也会犯它正在查的那种错。
