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
| P3-11 | IPC 收口判据 | `AGENTS.md:131`＋`rules/code-style:24`「按失败要不要让用户看见」 vs `docs/12:160`＋`rules/ui:44`＋`docs/10:833`「按是否已有内联／浮层承载」 | 后者（更新的判据，且配护栏「同一动作链既写内联又上传全局即失败」） |
| P3-12 | 图标 SVG 例外 | `docs/12:169` 无例外 vs `rules/ui:18`「品牌字标与格式徽标除外」 | 后者（实现里品牌字标确为文字） |
| P3-13 | 定宽列宽度 | `rules/ui:35`＋`docs/10:446`「宽度写死」 vs `docs/10:279/282`「可在 220–320／340–440px 调整」（§8.1 又注「拖拽未实现」） | 写死。删掉可调整那句或标明未实现 |
| P3-14 | 空态档数 | `docs/10:643` 两档 vs `rules/ui:20`＋`docs/10:673` 三档 | 三档（`EmptyState.tsx` 导出五个） |
| P3-15 | 多选控件 | `docs/10:649`「一律留原生 checkbox」＋`docs/10:691`「一律用 `CheckList`／`McpToolBindingsPicker`」 vs `rules/ui:32` 只说原生 checkbox | 两条并存不矛盾但 `rules/ui` 漏了后半，补指针 |
| P3-16 | Toast 数量 | `docs/10:558/800` 单一 Toast vs `docs/10:834`＋`rules/ui:44` 两个；`docs/12:158` 只点名 `TransientToast` 并写「禁止第二套 Toast」 | 两个。**只读 docs/12 会把合法的 `ToastHost` 当违禁** |
| P3-17 | 覆盖缺口 | `AGENTS.md` §7 未提 `npm run bench` 与 `*.bench.test.ts`；Button／ListRow／SectionHeader／NavList／Composer 等基座纪律在 `docs/12` §8 与 `AGENTS.md` §6 里一条都没有 | 补指针（不复述正文） |
| P3-18 | 规则文件自我声明 | `rules/code-style.md:11`「本文件只是速查入口，不复述也不另立标准」，实际 `:15-31` 有 14 条是完整规则正文，`:24` 已因复述产生 P3-11 的分叉 | 登记为 P4，改法要光哥拍板（降级成指针会牺牲速查性） |

## 5. P4 只登记，本轮不实施

- **9 个基座无同名测试**：`InlineError`（全仓 38 处调用的唯一出口）、`TransientToast`、`FieldSelect`、`MemoryCaptureSource`、`ModelEditorSheet`、`Welcome`、`WorkspaceGroupList`、`WorkspaceIdentityDialog`、`WorkspaceSelector`。
- **R3-D 遗留**：`ContextPanel.tsx` 25 个局部组件下沉、`ArtifactCard` 两份合并、`ListRow` 缺「整行可点＋卡片底部动作区」档（`.expert-card`／`.skill-card` 因此各写一套）、容器后代选择器发的皮改具名皮。
- **被回退那轮的四条已核实缺陷**（成品在 `/tmp/bw-status-axis-20260928/`，`tracked.patch` 832 行＋两个新文件）：`.memory-*-hint` 字色被 `.memory-row small` 特异性吞；`TransientToast` 自消 `useEffect` 把内联箭头 `onDismiss` 列为依赖，运行中每次重渲染都重新计时；`.memory-projection` 是反馈收口漏掉的第 8 个带底错误条；`.action-note` 实为动作结果（＝P2-1 的根因）。
- `docs/10` §3／§4 无子节编号，是 P2-10 那 15 处引用落空的根因。
- **护栏只校验 `tone` 的值集合，不校验 `tone` × `variant` 矩阵**（`standards:2124` 只做三组档位穷举相等）：写 `variant="primary" tone="danger"` 不会红，但 CSS 里没有这条组合规则，语义色静默无效。要不要补一条矩阵护栏交光哥拍板。
- **同一条规则在 docs/10 内部写两遍**（台账行 ＋ 正文段）是本轮实测踩到的坑：修 `tone` 时先改了正文 661、漏了台账行 607，靠回读 grep 才发现。凡改这类规则，必须同时 grep 台账行与正文段两处。

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
| B6′ | P3-8～P3-10、P3-12～P3-17：其余口径归一（标题例外两张表、字号阈值三档、色值例外四套、图标例外、定宽列、空态档数、多选、Toast 数量、AGENTS/docs12 覆盖缺口） | ⬜ |
| B7 | P2-3（台账补 7 行）、P2-5 余下计数校准、P2-10（15 处 §3.x／§4.x 引用点名到 reviews 文件） | ⬜ |
| B8 | 收口：全量 verify（跑前看负载）＋当日日志＋记忆更新 | ⬜ |
