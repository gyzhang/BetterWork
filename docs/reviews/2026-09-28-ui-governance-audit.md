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

- **11 个基座无同名测试**（2026-09-29 三度改数：9→8 是 `TransientToast` 已补；**「8」本身就是错的**——那份清单只扫了 `components/` 根目录，漏掉 `components/layout/` 的四件骨架；11 是再补上 `MemoryCaptureSource` 之后的当前值）。**E3 之后这条清单只剩 6 个**：`FieldSelect`、`ModelEditorSheet`、`Welcome`、`WorkspaceGroupList`、`WorkspaceIdentityDialog`、`WorkspaceSelector`。已出列的五个：`InlineError`（**40** 处调用的唯一出口，原文 38 是没重数的旧值）已补 8 例同名测试；`components/layout/` 四件经分诊**判定不补**——纯壳（93 行、状态 hook 0 命中）且被 6 个生产消费者渲染、其中 5 个有测试，D2 那句「全仓连间接测试引用都是 0」量的是名字被提及的次数、不是覆盖，**已证伪**（见 §7 的 E3）。判据两条：扫「无同名测试」要按 `components/**` 整棵树枚举，不能只看根目录那一层；**「无同名测试」不等于「无覆盖」，判定要不要补之前先数它的生产消费者里有几个带测试**。
- **R3-D 遗留**：`ContextPanel.tsx`（983 行）**11 个文件内局部组件**下沉（2026-09-29 复核改数：原文写 25，实数 11——`grep "^function \|^  function "` 得 `EvidenceSection`／`EvidencePreview`／`RunActivityList` 等 11 个非导出组件，加 1 个导出。又一处「别人给的计数没自己数」）、`ArtifactCard` 两份合并、`ListRow` 缺「整行可点＋卡片底部动作区」档（`.expert-card`／`.skill-card` 因此各写一套；`ListRowVariant` 现只有 `divider`／`card`／`plain` 三档）、容器后代选择器发的皮改具名皮。
- ~~**被回退那轮的四条已核实缺陷**~~ **四条已全部落地（2026-09-29，见 §7 的 C1–C4）**：`.memory-*-hint` 字色被 `.memory-row small` 特异性吞（换基座后 tone 由 `[data-tone]` 出，才真落得上）；`TransientToast` 自消 `useEffect` 把内联箭头 `onDismiss` 列为依赖（**修法改在基座**：回调经 ref 转发，依赖只剩 `[tone, message]`——包五个 `useCallback` 拦不住下一个页面，全仓当时还有 3 处内联箭头没被那轮的 patch 覆盖）；`.memory-projection` 是反馈收口漏掉的第 8 个带底错误条（迁进 `InlineError`）；`.action-note` 实为动作结果（拆成失败进 `InlineError`、成功进 `TransientToast`，三条规则删除）。成品备份仍在 `/tmp/bw-status-axis-20260928/`。
- `docs/10` §3／§4 无子节编号，是 P2-10 那 15 处引用落空的根因。
- **护栏只校验 `tone` 的值集合，不校验 `tone` × `variant` 矩阵**（`standards:2124` 只做三组档位穷举相等）：写 `variant="primary" tone="danger"` 不会红，但 CSS 里没有这条组合规则，语义色静默无效。要不要补一条矩阵护栏交光哥拍板。
- **护栏判据盲区：状态片的判据只看类名尾词，元素选择器不参与匹配**（`standards:1543-1566`，判据是「选择器里出现的类名以 `chip|badge|status|state|kind|pill` 结尾」）。`DiscussionCheckpointPanel.tsx:186` 的 `<span data-status>` 因此逃过「只读状态片必须由 Badge 画」——它的选择器是 `.discussion-checkpoint-history span`，唯一类名不以那些词结尾。附带：`data-status` 在 `styles.css` **0 命中**，该属性当前不驱动任何外观（死属性）。要不要把判据扩到「元素选择器 ＋ 片状三件套」交光哥拍板。
- **`DiscussionCheckpointPanel.tsx:147-165` 手写复选框组未走 `CheckList`**：`<fieldset>`＋`.map()` 出 `<label><input type="checkbox">`，而 `CheckList.tsx:16-18` 的注释正好写了这种场景的用法（已在 `<fieldset><legend>` 里就不传 `label`）。护栏 `standards:788` 只把 `.discussion-checkpoint-artifacts label` 登记进 label 排版豁免，**豁免的不是结构**，所以门禁不红。
- ~~**`WorkspaceBrief` 的空态自造，但与既有登记打架**~~ **已落地（2026-09-29，光哥拍板：判为漏迁，不是有意例外）**：四处空态（`:73-79`／`:84-94` 的 `.context-placeholder`＝`EmptyNotice` block 档同形，`:114`／`:150` 的 `.brief-empty`＝line 档同形）改用 `EmptyNotice`；「谁给水平内缩」与「空态由谁渲染」因此拆开——内缩仍由已登记的 `.brief-panel` 这件分段壳负责，两个自造类删除并进 `RETIRED_UTILITY_CLASSES`（`empty` 族）。同步改完 `ContextPanel.test.tsx:736` 的 `INSET_OWNERS`（删 `context-placeholder` 一行、`brief-panel` 的理由补上「简报空态也套这件壳」）、docs/10 §9.8 的壳清单（改为以 `INSET_OWNERS` 为唯一清单，不再在正文复述件数）、`.qoder/rules/betterwork-ui.md` 的同条。
- ~~**`MemorySuggestionList.tsx:100-108`** 候选为空时写 `<p className="context-hint">` 而非 `EmptyNotice`~~ **已落地（2026-09-29，见 §7 的 E4）**，且原记「轻微」是低估：那一个 `<p>` 用三元把**空态与状态塞进同一个元素**（「本轮没有待确认的建议。」／「当前有 N 条待确认候选」），分类时拆开各归各轴。`.context-hint` 也不是「通用提示类」——它与 `.context-note`、`.context-phase` 三个类只差字色，是同一件事的三处真相。
- ~~**`MemoryView.tsx:984` 用内容当 React key**~~ **已修（2026-09-29，提交 `8e3b6ac`）**：`<li key={line}>` 换成带序号的复合 key，并补一条回归用例。经核**不是校准轮引入**：`git show HEAD:` 与当时的 `key=` 集合逐字相同（只有行号平移）。同批把 `MemoryCaptureSource` 的 `aria-label` 覆盖问题一并修掉（提交 `c9ac2d6`，见 §7 的 D2）。
- ~~**`MemoryCaptureSource` 的可及名称有竞争**~~ **已修（2026-09-29，提交 `c9ac2d6`）**：包裹式 `Field` 的标签被 textarea 自带的 `aria-label="回答原文"` 覆盖，读屏听到的是后者、丢掉「只读，可拖选或用键盘选择」；删掉内层 `aria-label` 后名称交回 `Field`，并补上该基座的首份同名测试。**连带改了 4 处既有断言**（`App.test.tsx` 三处、`MemoryCapturePanel.test.tsx` 一处）——它们按精确名称 `'回答原文'` 查控件，钉的正是被覆盖后的错误名称；改成钉完整标签而不是 `/回答原文/` 宽松正则，因为宽松写法在修复前后都通过，会把这次修复重新变成测不出来的东西。
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
| D1 | **派发试验：把两条「改错了会自己报警」的零碎缺陷交给低端模型做**。判据是先按「错误会不会产生红信号」分拣，不按工作量——文档假声明、护栏锚点、口径措辞这三类 tsc 与 vitest 全都拦不住，本轮我在 Max＋极高推理档下仍写下两条，所以不派。派出去的是：`MemoryView.tsx:984` 重复 React key（提交 `8e3b6ac`）、`MemoryCaptureSource` 的 `aria-label` 覆盖可及名称（提交 `c9ac2d6`）。两条都要求**先证红再改**，并写死硬停线（不得碰 `docs/**`、`.qoder/rules/**`、`standards/**`，不得加豁免，不得 commit） | ✅ |
| — | D1 的取证：A 改前跑出 1 条 `Encountered two children with the same key` 而 **22 个用例全绿、EXIT=0**（警告走 stderr，不影响退出码——正是「不产生红信号」那一类）；改后警告 0、用例数不变、`diff` 只有 2 行。补的回归用例做过变异：把 key 退回 `key={line}` → **`Failed Tests 1`**，失败信息 `expected 'Encountered two children with the sam…' not to match`，其余 22 条不受影响；恢复后 23/23 绿。B 的红是 `expected null not to be null`（前一句断言已证控件渲染出来，**不是**「找不到元素」那种假红），另两例当场通过 | ✅ |
| — | **D1 的两处越界与两处补漏（都需光哥过目）**：① 修 B 打断了 4 处既有精确名称断言，那 4 句钉的正是 bug，已改成钉完整标签（超出开工单，属必要连带）；② A 按开工单本来只要求「警告清零」，但那样谁改回 `key={line}` 都不会红，按 AGENTS.md §7「修复缺陷优先添加回归测试」补了那条用例。收口全量 `npm run verify` **EXIT=0，170 文件 / 1605 用例**（跑时 1 分钟负载 11.24 ≥10，但一次通过、无红项轮换，不需归因） | ✅ |
| D2 | **修 D1 暴露出的账本自身数字**：§5「无同名测试的基座」8 → **11**（我先前只扫 `components/` 根目录，漏了 `components/layout/` 四件骨架）；§5 R3-D 的「`ContextPanel.tsx` 25 个局部组件」→ 实数 **11**（外加 1 个导出）。docs/10:635 台账行里「无同名测试」与「可及名称有一处竞争」两句随 B 的落地改准。**D2 自己又写下一条假声明**：同一格里那句「那四件全仓零测试引用」量的是**名字被提及的次数**、不是覆盖，E3 已证伪（实为 6 个生产消费者渲染、其中 5 个有测试），见 E3 行 | ✅（其中一句由 E3 更正） |
| E1 | **B9 门禁构成落地：加第三条串行车道**。照既有 `bench` 档的机制在 `vitest.config.ts` 里立 `heavy` 档，`HEAVY_TEST_FILES` 收录单文件墙钟 ≥20s 的 **6 个**文件（门槛是实测定出来的：第 6 名 23.1s、第 7 名 15.9s，中间断档），`npm test` 改成「functional 并发 → heavy 串行」两次独立调用。functional 档墙钟 **199.7s → 17.4s**。分档后 164＋6＝**170 文件**、1473＋133＝**1606 用例**，对基线 1605 差一条恰为新增护栏——**没有文件被静默丢掉**这件事是算出来的，不是假设的 | ✅ 提交 `fc22cfa` |
| — | E1 的护栏与变异：95→**96**（一条由「两条车道」改名扩断言、一条新增），各做一发变异。「三条车道的配置与脚本各就各位」新增断言 `test` 脚本必须含 `--project heavy`（去掉后半 → `Failed Tests 1`，因为 heavy 档文件同时被 functional 的 `exclude` 排掉、又没人跑它）；「heavy 档清单里的每个文件都真实存在」是**清单自核**（塞一个不存在的路径 → `Failed Tests 1`）。清单解析出 6 条且全部存在另用 node 单独验过——`> 0` 那种断言在只解析出 1 条时同样绿，不验就是空跑 | ✅ |
| — | **E1 必须说清的边界**：串行档只隔离「我们自己这 170 个文件互相抢核」，隔离不了本机其它进程。同晚实测——负载 36 时 functional 档唯一的红是 `App.test.tsx` 一条 `Test timed out`（AssertionError **0 条**）；把它单独跑（负载 31、CPU 只吃到 23%）仍红 **5 条超时**，且红项与并发那次**完全不同**（红项轮换＝争抢特征）。所以「红哪几条随负载而变」只被消掉一半；另一半是 functional 档 5s 默认超时对重文件到底算不算「墙钟预算」——属口径问题，**未拍板前不动阈值**（见 §8 候选 3） | ⬜ 半个 |
| E2 | **速查文件改自我声明＋加同步约束**（光哥在「降级成指针」与「保留正文」之间选了后者）。`.qoder/rules/betterwork-code-style.md` 标题改为「速查复述，标准在 docs/12」，自我声明那段点名 P3-11 那次真实分叉（IPC 判据），并写死硬约束「**改 docs/12 的任一小节，必须同轮 grep 本文件**」；14 条复述逐条补 `（docs/12 §N）`／`（AGENTS.md §N）` 出处，其中 IPC 那条顺带把判据补全（「这句话是否已有内联或浮层承载」）。新护栏「编码规范速查文件的每条复述都要带出处」→ 96→**97** | ✅ 提交 `f84a9c8` |
| — | **E2 有意不扩到另外 5 个规则文件**：它们共有 **38 条**无出处复述（ui 9／diagnosis 2／knowledge 7／ipc-artifact 10／dev-cycle 10）。不是漏了——每个指针都得先验目标小节真的存在，而 B7 里我自己就写错过一个指针。这是一份**有尺寸**的待办，记进 §8 候选，不混进本轮 | ⬜ 待派发 |
| E3 | **`InlineError` 补同名测试**（§8 候选 2 的头号目标：全仓 40 处调用的唯一出口，此前改坏了没有测试会红）。8 例覆盖 `role="alert"`＋缺省 danger、warning 档、**只给 `problems` 不给 `message`**（契约 §9.1 的「保存成功但带警告」）、子节点顺序、动作顺序（领域动作→重试→关闭）、无动作时不长空行、`className` 只叠加不替换皮、以及重复明细的 key。顺带修真缺陷：`<li key={problem}>` → `` key={`${index}:${problem}`} ``（两条相同的校验问题会撞 key，与 D1 的 A 同源）。变异：把 key 退回 → **`Failed Tests 1`** | ✅ |
| — | **E3 的分诊结论推翻了账本自己的一句话**。`components/layout/` 四件（`PageHeader` 31 行／`ScrollRegion` 28／`ViewContainer` 19／`PageToolbar` 15，共 **93 行**）`useState`／`useEffect`／`localStorage` **0 命中**，是纯壳；且被 **6 个**生产消费者渲染（`App`／`ArtifactView`／`SkillsView`／`ExpertsView`／`KnowledgeView`／`MemoryView`），其中 **5 个有测试**。D2 那句「全仓零测试引用」量的是**名字被提及的次数**、不是覆盖——**判定：四件不补同名测试**，给纯壳写同名测试只会把 JSX 抄两遍。`ViewContainer` 是规则文件写着「一律用」的基座这件事，由护栏锁几何、不由同名测试锁 | ✅ |
| — | **分诊反而找出一处真缺口**：`hooks/use-view-mode.ts`（37 行）是卡片／列表偏好在**全仓的唯一 storage 出口**（docs/10 §10.1），只有 `SkillsView`／`ExpertsView` 两个消费者，此前**无同名测试**。`SkillsView.test.tsx:252` 间接覆盖了切换的快乐路径，但三条兜底分支无人钉。补 7 例，**三发变异各恰好 1 红**：把「只认 `'list'` 字面量」改成「非 null 即 list」→ 只有「存的是别的字面量时退回卡片视图」红；拆掉读的 `try/catch` → 只有「storage 读不了时兜底成卡片视图」红；把 `setViewMode` 挪到 `setItem` 之后并拆掉写的 `try/catch` → 只有「storage 写不了时本次会话内仍然生效」红。还原后对生产源码 `diff` 为空 | ✅ |
| E4 | **空态轴收口，范围比账本记的大一圈**。账本 §8 候选 5 写的是「`context-hint` 16 处」，实际是 `.context-hint`／`.context-note`／`.context-phase` **三个只差字色的类、24 处**（ContextPanel 21＋MemorySuggestionList 3）：`--text-muted`／`--text-secondary`／`--text-secondary` 且第三个连行距都没有。只做那 16 处会留下半套——`.context-note` 里同时住着对象状态与读法说明。逐句分类后：**空态 10 处 → `EmptyNotice`、对象状态 12 处 → `StatusNote`、读法说明 3 处留 `.context-note`**，`.context-hint`／`.context-phase` 连同 CSS 规则退役 | ✅ |
| — | **E4 的判据（第三类怎么认）**：把这句话换成「这里没有东西」或「这个对象现在是 X」念一遍，两句都不通才是**读法说明**——「以上是范围预览，以下方为准」「旧轮次只是这次不发送，对话没有被删除」「引用旧成果只固定你选定的那一版」三句都属这一类。它不属两条轴，硬塞进 `EmptyNotice` 或 `StatusNote` 都是错的，所以留一个类、但只留一个。`.context-note` 的字色从「与 `.context-hint` 并存」变成唯一一件说明色。**一处有意接受的观感变化**：`EmptyNotice` 的 line 档自带 `padding: 8px 9px`，进了 `.context-section`（`13px 14px 12px`）之后空态文字比同段的列表行多缩 9px。这是基座自己的几何，C4 那轮 `WorkspaceBrief` 进 `.brief-panel` 时已经如此并已验收；用容器后代选择器把 `padding` 抹平正是护栏要拦的「页面替基座改几何」，所以不动 | ✅ |
| — | **E4 顺带拆掉一处「空态与状态混在一个元素里」**：`MemorySuggestionList` 那一个 `<p>` 用三元同时输出「本轮没有待确认的建议。」（空态）与「当前有 N 条待确认候选」（状态），分类时拆成两个分支各归各轴。另修一处与 D1 的 A、E3 同源的缺陷：`StatusNote` 的 `<li key={problem}>` 换成带序号的复合 key，并补一条回归用例（变异：退回 → `Failed Tests 1`，报的正是 `two children with the same key`） | ✅ |
| — | E4 的护栏与变异：`retiredStatusSurfaces` 9→**11**（这条清单同时查 TSX 的 `className` 与 CSS 的选择器，比 `RETIRED_UTILITY_CLASSES` 的 empty 族只查 CSS 更严，所以两个类都登在这里），断言措辞随之改准为「空态归 `EmptyNotice`、对象状态归 `StatusNote`」——清单里现在两类都有。变异两发：把 `.context-hint` 的 CSS 规则加回去 → `Failed Tests 1` 且报 `styles.css → .context-hint`；把一处 `className="context-note"` 改成 `context-phase` → `Failed Tests 1` 且报 `ContextPanel.tsx → .context-phase`。还原后两处 grep 均零命中 | ✅ |
| F1 | **IPC「收口」的字面与 59% 的现实对不上，改的是字面而不是代码**。按候选 2 去 `hooks/` 补收口测试前先量了一遍：`hooks/` 里 100 个 `window.betterwork` 调用点，只有 **41 处**字面走 `reportAction`／`trackAction`。照 AGENTS.md 原文「只有两种方式」的字面读，其余 **59 处**全是违规；逐处看过后它们是三种合法形状——手写 `try/catch`（`use-knowledge-library.ts` 22 处；`reportAction` 只有一个 `onError` 出口，表达不了「成功也要播报一句」）、`return` promise 交回调用方（`use-experts.ts` 六处等）、`await` 写在上层 `try/catch` 包里，而**没有一处失败被静默吞掉**。所以这不是「59 处待修」，是**口径缺陷**：先停下来报给光哥拍板（选项含「把 59 处迁到 helper」），选了「改字面，护栏钉真不变量」 | ✅ 提交 `153750b` |
| — | F1 的落点是一次改完 **7 处字面**：docs/12 §5 的 Renderer 小节重写（处置表加「缺省实现」一列、三种形状点名带处数、把「不处理」列成第三种**处置**并写明 `no-floating-promises` 的 `ignoreVoid: false` 就是它的结构拦截、末尾留实测口径）、AGENTS.md §7、`.qoder/rules/betterwork-code-style.md`、`.qoder/rules/betterwork-ui.md`、docs/12 §8、docs/10 台账、`lib/async-action.ts` 的 JSDoc；另把 `docs/development/tasks-memory.md` §3.7 那句「五个记忆 Hook 的 18 个调用点全部收口」就地更正（实测只有 8 处字面走 helper）。**判据沉淀**：「让用户看见」的出口不必是全局的，接在局部 `TransientToast` 上同样合规——问「这句话有没有出口」，不问「出口有多大」 | ✅ |
| F2 | **空体 `catch` 必须写明降级理由**（护栏 97→**98**）。两种形态各一条正则：`catch {}`（含跨行空体）与 `.catch(() => undefined)`／`.catch(() => {})`，要求同一行或上一行有 `//` 理由。落地即抓出 `DiscussionCheckpointPanel.tsx:86` 一处——它其实**合规**（失败已由 `App.tsx` 的 `createDiscussionCheckpoint` 呈现并重新抛出，抛出只是为了让 `submit()` 里清空表单那几行不执行），只是看起来像吞掉，把理由写进注释即可 | ✅ 提交 `153750b` |
| — | **F2 的两处自伤**：① 新护栏第一次跑就红在自己刚写的文档上——它匹配到 `async-action.ts` 里我用来解释「什么是不处理」的那段 JSDoc，改成先清空块注释（保留换行以维持行号）再匹配；② **变异第二发是绿的**：正则写的是 `[ \t]*\}`，跨行空体 `catch {\n}` 永远匹配不上。改成 `\s*\}` 后才恰好 1 红。护栏自己也有牙没长齐的时候，这就是每一发都要变异的原因 | ✅ |
| F3 | **五处「失败让 loading 永久挂住」的真缺陷**（补测试时扫出来的，不是假设）：`use-skills.ts` 的 `refresh`／`select`、`use-experts.ts` 的 `refresh`、`use-mcp-connections.ts` 的 `refresh`、`use-skill-dependencies.ts` 的 `inspect`。它们走 `trackAction`，而 `loading` 只在 `.then` 的成功路径清除——一次 IPC 失败既没有呈现出口、也不把转圈停下，用户看到的是「正在加载 Skill…」永远转下去，没有内容、没有报错、没有重试入口。修法照仓内既有先例 `use-knowledge-library.ts:205`（链上 `.catch` 交给 error、`.finally` 清 loading），不另立第二套抽象 | ✅ 提交 `f79d435` |
| — | **F3 带出两层下游**：`use-mcp-connections` 的连接清单接口原本**连 `error` 字段都没有**，修它要先补出口；补完发现 `SettingsView` 的三态缺错误那一档——读失败会掉进「还没有 MCP 连接」的空态，把「我不知道」说成「它是空的」，已补成 loading／error（带重试）／empty。`use-skills` 的 `select` 带过期请求守卫，失败路径同样要守：否则一次迟到的报错会停掉新一次详情的转圈，用户看到「上一次的错误」配「这一次的内容」 | ✅ |
| — | F3 的测试：四个新文件（`use-model-settings` 7 例、`use-skills` 4 例、`use-experts` 2 例、`use-mcp-connections` 2 例）＋ `DependencyPanel` 一条视图级回归。`use-model-settings` 那七例钉的是两类处置的分界：编辑器里保存失败留在表单错误（错误留得住，用户才改得了配置），行内切换失败走局部浮层，**同一次失败不得两个通道各播一遍**；「仅已启用模型可以设为默认」是业务拒绝不是失败，走浮层而不进控制台 | ✅ |
| — | **F3 的变异与本轮最值钱的一发**：M1 把 `refresh` 改成 `reportAction` → 1 红（两个通道各播一遍）；M2 让 `onSave` 的失败同时进 error 和 toast → 1 红；M3 让行内切换同时写 error → 1 红；M4 把 `refresh` 退回旧形状 → 1 红；M6 把 `inspect` 退回旧形状 → 1 红。**M7 第一发是绿的**：那条「迟到失败不覆盖新界面」的用例只 `select` 了第二个 Skill，可拒绝的第一个请求根本没被创建，`rejectFirst` 一直是 `undefined`，断言 `error === ''` 是白过的。补上「先真的发出第一次并让它悬住」＋一条夹具自检（`rejectFirst` 必须是函数，否则当场报「本条用例是空跑」）后，同一发变异才红在 `+ 上一次的失败`。它证的不只是守卫有牙，而是**我自己写的那条用例当时没有牙** | ✅ |
| F4 | **busy 标志护栏**（98→**99**）：`hooks/` 里 `trackAction` 上方三行内出现 `set*(Loading|Busy|Preparing|Saving)(true)` 时，其链式调用必须含 `.catch(`／`.finally(`／`settle*Call(`。只管 `trackAction`——`reportAction` 的 `onError` 是调用方写的回调，静态判不出它有没有清 busy，那一半由 F3 那批行为测试守。**落进前先用脚本在今日树上验过零假阳**，不把护栏写成一批待办 | ✅ 提交 `f79d435` |
| — | **F 轮的两处操作纪律问题（都已就地纠正）**：① 还原变异时用了 `git checkout apps/desktop/src/renderer/src/hooks/use-skills.ts`，把同文件里**尚未提交的修复**一起清掉了（`describeActionError`、`.finally` 全部归零），靠 grep 回读才发现——此后对该文件一律用 `Edit` 逐处还原，不再用 `git checkout`；② 首次全量 `npm run verify` **EXIT=1**，原因是我只按改动文件跑了 `eslint`，漏了新写的 `use-skills.test.ts`（`no-misused-promises`）。门禁前跑仓内 `npm run lint`，不按文件跑 | ⚠️ |
| — | 门禁（F 轮收口）：全量 `npm run verify` **EXIT=0**（负载 2.19，五关全过），**176 文件 / 1641 用例**；对 E4 基线 172／1623 是 **+4 文件 / +18 用例**，恰为四个新测试文件的 15 例＋`DependencyPanel` 1 条＋两条新护栏——「没有文件被静默丢掉」是算出来的，不是假设的 | ✅ |

## 8. 下一轮

§8 原先写的「先动状态呈现轴」已于 2026-09-29 落地（C1–C6）。**「一句界面文字该由谁出口」这条轴到此收完**：反馈轴（§11.5.1）与状态轴（§11.5.2）各立一条，两轴各只有一个出口组件，任何一句界面文字都能被问到「它是哪一轴的、由谁渲染」。同日的 E 轮又收掉两项候选：候选 3（B9 门禁）落地一半、候选 7（速查文件自我声明）已拍板落地，见 §7 的 E1–E3。次日（09-30）的 F 轮收掉候选 2 的 `hooks/` 那一半，代价是发现**规范的字面与 59% 的现实对不上**——改的是字面，见 §7 的 F1–F4。

剩下按优先级排的候选，都还**待光哥派发**：

1. **R3-D 大块**（P4 里唯一还剩的结构性欠账）：`ContextPanel.tsx` **11 个**文件内局部组件下沉（983 行；原文 25 是别人给的数、我没自己数就写进账本）、`ArtifactCard` 两份合并、`ListRow` 缺「整行可点＋卡片底部动作区」档（`.expert-card`／`.skill-card` 因此各写一套）、容器后代选择器发的皮改具名皮。
2. ~~**「无同名测试」清单的枚举范围**~~ **E3 定的那句「下一轮该把枚举范围扩到 `hooks/`」已在 F 轮做完，且量出来的形状和预期不同**：`hooks/` 有 **23 个**生产 hook，此前 **15 个**无同名测试，F 轮补掉 4 个（`use-model-settings`／`use-skills`／`use-experts`／`use-mcp-connections`）后**还剩 11 个**。这 11 个里 **9 个带 IPC 调用**（合计 31 处调用点），最大的一件是 `use-skill-dependencies.ts`（394 行、12 处 IPC，只有一条 `DependencyPanel` 视图级回归守着），其次是 `use-memories.ts`（328 行／7 处）与 `use-workspace-identity.ts`（182 行／3 处）。`use-artifact-source-selection.ts` 与 `use-transient-toast.ts` 是 0 处 IPC 的纯状态壳，按 E3 的判据不必补。组件侧**还剩 6 个基座**未动：`FieldSelect`、`ModelEditorSheet`、`Welcome`、`WorkspaceGroupList`、`WorkspaceIdentityDialog`、`WorkspaceSelector`。**分诊判据沿用 E3**：先数它的生产消费者里有几个带测试，纯壳且有间接覆盖的不补。
3. **B9 门禁构成**（E1 已落地一半）：`heavy` 串行档把「我们自己 170 个文件互相抢核」这一半消掉了，functional 档墙钟 199.7s → 17.4s；但同一台机器上别的进程照旧能把 `App.test.tsx` 弄红（负载 31、CPU 23% 时单跑仍红 5 条超时且红项轮换）。剩下的半个是**口径问题**：functional 档 5s 默认超时对重渲染文件到底算「墙钟预算」还是「防挂死的保险丝」——若是后者就该整体抬到一个不随负载抖的值，若是前者就该把重文件全挪进 heavy。**未拍板前不动阈值。**
4. **护栏判据补强**：`tone` × `variant` 矩阵、状态片判据的元素选择器盲区（`DiscussionCheckpointPanel` 的 `<span data-status>` 逃过 Badge 那条，且 `data-status` 在 CSS 0 命中＝死属性）、`DiscussionCheckpointPanel:147-165` 手写复选框组未走 `CheckList`。
5. ~~**空态轴还剩一整条**~~ **已落地（2026-09-29，见 §7 的 E4），且定量又错了一次**：原记「`context-hint` 16 处」只数了**一个类名**，实际是 `.context-hint`／`.context-note`／`.context-phase` **三个只差字色的类、24 处**（ContextPanel 21＋MemorySuggestionList 3）。只做那 16 处会留下半套——`.context-note` 里同时住着对象状态与读法说明，迁走 hint 之后它就成了「两个类干同一件事」的新版本。分类结果：空态 10 处 → `EmptyNotice`、对象状态 12 处 → `StatusNote`、读法说明 3 处留在 `.context-note`（第三类，不属两条轴），`.context-hint`／`.context-phase` 连同 CSS 规则退役并进「不得复活」清单（9→**11**）。**判据沉淀**：把这句话换成「这里没有东西」或「这个对象现在是 X」念一遍，两句都不通才是说明。
6. **`WorkspaceSelector` 生产路径零覆盖**：无同名测试，`Composer.test.tsx:26` 传的是桩 `workspacePicker`——它是输入区顶部的空间入口，改坏了没有测试会红。属「决定断言什么」那一类，与 `InlineError` 同源。
7. ~~**`betterwork-code-style.md` 的自我声明**~~ **已拍板并落地（2026-09-29，光哥选「保留正文」，见 §7 的 E2）**：标题与自我声明改准为「速查复述，标准在 docs/12」，点名 P3-11 那次真实分叉，写死「改 docs/12 的任一小节，必须同轮 grep 本文件」，14 条复述逐条配出处，并加护栏锁「每条复述都要带出处」。
8. **把「复述必须带出处」这条护栏扩到另外 5 个规则文件**（E2 有意没做，因为它不是一句话的事）：`betterwork-ui.md` 9 条、`betterwork-diagnosis.md` 2 条、`betterwork-knowledge.md` 7 条、`betterwork-ipc-artifact.md` 10 条、`betterwork-dev-cycle.md` 10 条，共 **38 条**无出处复述。扩之前每条指针都得先验目标小节真的存在——B7 那轮我自己就写错过一个（把 `§3.1 P10` 归给 09-26，实际在 09-27）。**这是本轮唯一一份「知道有多大、也知道会踩什么坑」的待办**，适合按文件分五次派发。
9. **F 轮扫出来的三处小账**（都定位清楚、都不该由本轮顺手改）：① `components/MemorySuggestionList.tsx:112` 的空态文案把上限写死成「每次运行最多产生 3 条」，而同一个数在 `lib/memory-suggestions.ts:75` 是常量 `MEMORY_CANDIDATE_PER_JOB_LIMIT`（转发给 `MEMORY_EXTRACTION_MAX_CANDIDATES`）——同一句「每轮上限」在文案里有一份、在常量里有一份，改后端上限时界面那句不会红；② 同文件第 5 行 `import { InlineError } from '../components/InlineError'`：它自己就在 `components/` 里，却先上一级再折回来，是目录内自指的写法异味；③ `use-skill-dependencies.ts` 的 12 处 IPC 只有一条视图级回归守着（已并入候选 2 的剩余清单）。

**D1 的派发试验结论**（2026-09-29，可复用的分拣判据）：按**「改错了会不会产生红信号」**分拣，不按工作量大小。两条零碎缺陷交给低端模型完成且取证齐全，说明「缺陷定位清楚、验收标准写死、错误会自己变红」这一档可以下放；反过来，文档假声明、护栏锚点、口径措辞这三类 tsc 与 vitest 全都拦不住（本轮在高档模型＋极高推理下仍写下两条），不适合下放。下放时**验收标准要预先写死**并明确禁止它碰 `docs/**`、`.qoder/rules/**`、`standards/**`。

**本轮新沉淀的一条判据**：文档里写「已配护栏」之前，必须 `grep` 到那条 `it()` 的标题。P3-11 那行假声明是主线自己上一轮写下的——账本也会犯它正在查的那种错。

**F 轮新沉淀的三条**（2026-09-30）：
1. **规范的字面与代码现实冲突时，先判是「字面错了」还是「代码错了」，再决定动不动手**。这一步的产出是**口径**而不是违规清单：59 处「不匹配字面」的调用逐处归类后是三种合法形状，没有一处失败被静默吞掉。反过来照字面报「59 处待修」，会把一次文档缺陷变成一次 59 点的重构。**不变量要由护栏钉，不由函数名钉**——护栏守的是「失败有没有出口」，而函数名只是出口的一种可被合法绕过的形状。
2. **「测试有没有牙」要在写它的当下验，不能等变异阶段**。M7 那一发红的是**用例本身**：夹具没让请求悬住，断言就是白过的。补一条夹具自检（该是函数的必须是函数）比多写三条断言便宜，而且它把「空跑」变成一条会自己报的错误。
3. **计数类结论写成命令，不写成数字**。日志与账本里「未推送 N 笔」这类每提交一次就过期的数，改成指向 `git rev-list --count origin/main..HEAD`；文档里必须写数字的地方，注明测量日期与口径（F1 那句「100／41／59」带的是 2026-09-30 的实测日期）。
