# ADR-0031：按钮基座与控件皮封闭清单

- 状态：Accepted（2026-09-28，按光哥「按钮收口走造基座并新增 ADR」的拍板实施）。
- 日期：2026-09-28。
- **替代关系**：替代 [docs/10 §10.1](../10-ui-ux-system.md) 台账里「Button / Input / Textarea 不再单独组件化」这一条中**关于 Button 的部分**；`Input`／`Textarea` 的原判断维持不变（它们的几何本来就由 `--control-*` 单一口径覆盖，且结构归 `Field`，没有长出第二套皮）。同时替代 [UI 复用审计](../reviews/2026-09-27-ui-reuse-audit.md)「明确不做」清单中的「Button 组件化」一项。两份记录的日期与结论都不改写，只在此声明被本记录取代。
- 依据：2026-09-28 专家修订页「保存修订」按钮观感异常引发的全仓按钮清点。

## 背景

2026-09-26 与 09-27 两次都判过「不给 Button 造组件」，理由是「避免只为包一层壳而增加第二处真相」，并给出替代解法：把 `height`／`padding` 纳入档位与棘轮护栏，把皮从容器搬到按钮自己的具名类上。

**这条解法只执行了一部分，本记录用实测数据说明它为什么不够。** 下表两列都由脚本对 `styles.css` 与渲染层 `.tsx` 做全量选择器／标签扫描得出（收口前＝HEAD，收口后＝本记录落地后的工作树），不是估算：

| 事实 | 收口前 | 收口后 |
| --- | --- | --- |
| 自带外观的具名按钮皮 | **11 套**（primary／secondary／text／chip／quiet／danger-confirm／knowledge-research／open-source／knowledge-more／evidence-open／back） | **0 套**（`icon-button` 基座与 `sidebar-collapse-button` 定位钩子除外） |
| 页面级容器后代给按钮发外观 | **12 条规则**（20 个选择器块；含 1 条选择卡与 1 条浮层定位钩子） | **0 条** |
| 同一个类名写两遍 | **3 组**：`.secondary-button`（顶层重复，后者静默顶掉前者的 `background`）、`.back-button`、`.composer-footer button` | **1 组**：`.sidebar-collapse-button` 两处各管 `margin-left` 与 `app-region`，职责不重叠 |
| 按钮相关 `padding` 组合 | **18 种** | **5 种**（`Button` 三档 ＋ `Tabs`／`SegmentedControl` 两个基座槽位） |
| 完全没有 `min-height` 的动作按钮规则 | **7 处**——三档 `--control-height-*` 对它们根本不生效 | **0 处** |
| 没有自己外观类的裸 `<button>` | **11 颗**（知识页 5、上下文面板 3、来源行／简报／技能错误条各 1）；另有 8 颗所在容器**根本没有 button 规则**，一直按浏览器默认外观渲染 | **0 颗** |
| 源码里的 `<button>` 标签 | **159 处** | **46 处**：基座内部渲染 ＋ 10 种登记在案的非动作形态 |

关键在于：**皮类方案缺一个封闭清单的执行者**。样式类谁都能新造一档，`styles.css` 里没有任何一处能拦住它，护栏的 `CONTROL_SELECTOR` 口径又只覆盖 `.primary-button`／`.secondary-button`／`.text-button` 三档，另外 8 套皮与 12 条后代规则一条都抓不到。于是「不造组件」省下的那层壳，被 18 种 padding、3 组同名双写和 8 颗按浏览器默认外观渲染的按钮还了回来——**第二处真相不是组件化造成的，是没有唯一出口造成的，它已经存在了。**

上一轮（09-27）把 9 颗裸按钮上收成 `.chip-button`／`.quiet-button` 时，判断依据是「仍然是样式类，只是从容器里搬到按钮自己身上，与不造组件不冲突」。那次搬迁本身没有错，但它没有改变「下一个页面仍然可以自己再造一档」这个结构性缺口，所以本轮又抓到同一类问题。按「同类问题第二次就要沉淀为护栏」的要求，只上护栏不足以解释清楚**谁是唯一出口**；把出口做成组件，护栏才有一个可穷举的对象（`ButtonVariant` 联合类型 ↔ `.btn[data-variant]` 的档位集合）。

## 决策

1. **新建 `components/Button.tsx` 作为按钮的唯一出口。** 生产代码不再出现裸 `<button>`，也不再出现手写的按钮皮类名；`className` 只承载定位钩子。
2. **`variant` 八档 × `size` 三档，`variant` 只管颜色、`size` 只管几何，两者正交。** 这是对现状 11 套皮按「它到底在表达什么」重新切分，而不是给 11 套皮各配一个名字。
3. **皮类只由基座输出**：`.btn` 一个类 ＋ `[data-variant]`／`[data-size]`／`[data-tone]` 三个数据属性，沿用仓库既有的 `.list-row[data-variant]`／`.icon-button[data-size]`／`.tabs[data-fill]` 约定，不引入第二套 BEM 命名。
4. **`AsyncButton` 收成 `Button` 的薄封装**，`busy`／`busyLabel`／`aria-busy` 的语义与既有 8 个调用点不变；`IconButton` 保持独立基座（方块、无文字、`aria-label` 必填，套不进文字按钮的高度档）。
5. **`Input`／`Textarea`／`Select` 不组件化**，本记录不扩大替代范围。
6. **护栏四条**（见「实现边界」），并做变异验证。

### `variant` 归并映射

| 新 `variant` | 底／边框／文字 | 收编自 |
| --- | --- | --- |
| `primary` | `--brand` 实心／透明边框／`--on-brand` | `.primary-button`、`.composer-footer button`、`.knowledge-search button` |
| `secondary` | `--surface`／`--control-border`／`--text-secondary` | `.secondary-button`、`.memory-conflict-actions button`、`.knowledge-admin-row button`、`.knowledge-detail-header／-actions／.knowledge-revision-row／.knowledge-detail-pager button` |
| `text` | `--surface-raised`／`--control-border`／`--text-secondary` | `.text-button`（保留原名，13 处调用点语义不变） |
| `outline` | 透明／`1px solid --border`／`--text-secondary` | `.open-source-button`、`.knowledge-more-button`、`.evidence-open-button`、`.examples button` |
| `quiet` | 透明／透明边框／`--text-secondary`，悬停才出底 | `.quiet-button`、`.back-button`、`.inline-message.error button` |
| `chip` | `--brand-soft`／透明边框／`--brand` | `.chip-button`、`.knowledge-research-button` |
| `danger` | `--danger` 实心／透明边框／`--on-danger` | `.danger-confirm-button` |
| `link` | 透明／透明边框／`--brand`，悬停加下划线 | `.capability-locate-link`、`.material-global-toggle`、`.back-button`、`.inline-message.error button`（错误条里的「重试」） |

`link` 是**清点过程中补上的第八档**。前四种写法说的是同一件事——「只有文字、悬停才认得出可点」——但它一直没有名字，于是四处各造一套，`padding` 从 `0` 到 `5px 0` 到 `5px 6px` 都有。清点里还出现过同构的一例：PageHeader 的「返回」入口在成果页用 `.back-button`（无底无框）、在专家页用 `.text-button`（有底有框），**同一个导航动作在两个页面上长成两种控件**。一档形态没有名字，就等于没有这一档，也等于护栏无从登记它。

`tone`（`neutral`／`brand`／`danger`）**只对 `outline` 生效**，用来收编 `.knowledge-detail-members button`（品牌描边）与 `.knowledge-issues button`（危险描边）。与 `Badge` 的 `tone × shape` 同构：颜色语义是一张表，不是各页一条字色规则。

### `size` 三档

| `size` | `min-height` | `padding` | `font-size` | 缺省 |
| --- | --- | --- | --- | --- |
| `sm` | `--control-height-sm` 28px | 4px 8px | 12px | |
| `md` | `--control-height` 32px | 6px 10px | 12px | ✓ |
| `lg` | `--control-height-lg` 36px | 8px 12px | 13px | |

**不设「按 `variant` 给缺省 `size`」的条件缺省**：`primary` 不自动等于 36px。主行动要不要比同排的次级动作高一档，是页面在那一刻的选择，写成显式的 `size="lg"` 比藏在基座缺省里更可解释——本轮的起点就是「保存修订 36px 与取消 28px 差 8px 被衬成一块砖」，把档位差交回调用点，动作条里才可能出现「同排同档」这个约定。

**这条约定本身也由护栏锁住**：`ActionBar` 是一「排」动作，槽内按钮必须同档。第一版迁移只机械保留了每颗按钮原有的档位，于是那条起点动作条仍然是 28＋36 的落差——**把系统收干净不等于把最初那件事修好，两件事都得做**。全仓 8 条 `ActionBar` 里有 5 条混档，现一律归到 `md`（32px）；`lg` 只留给不在动作条里的整页主行动（专家卡上的「召唤」、专家页空态的「新建专家」）。

### 刻意不进 `Button` 的四类

- **`IconButton`**：方块几何、无文字、`aria-label` 是唯一名称来源。清点时给它补了第三档 `row`（34px，对齐侧栏行高）——消息铃铛原先自写一套 34px 皮，且在折叠侧栏与窄视口下又各自放大到 36px，是「形态没有名字就各造一套」的又一例。
- **选择卡**（外观预览的模式格与色系格）：它是「一组可点卡片」，不是动作按钮；上收成 `.option-card` 具名类并登记进护栏例外。它的选中态从 `className={选中 ? 'selected' : ''}` 改成 `aria-pressed`——CSS 类不是 ARIA，读屏原先听不到「当前是哪一格」。
- **整片可点的领域形态**：卡片主区（`.expert-card-main`／`.skill-card`）、通知行（`.toast-body`）、工具活动条与状态片（`.tool-activity-toggle`／`.tool-pill`）、下拉触发器与浮层菜单项（`.workspace-selector-*`）、投放区（`.workspace-folder-drop`）、缩略图放大触发器（`.artifact-thumbnail-trigger`）。共 10 种，逐一登记在护栏的 `NON_ACTION_BUTTON_SHAPES` 并带理由；不登记即视为在基座外另造皮。
- **基座自己的槽位选择器**：`.tabs button`、`.segmented-control button`、`.btn` 本体。这些是基座在管自己的几何。**`.list-row-actions :where(button)` 已从这一类里删掉**——它原先替行内动作兜底一份「行内文字按钮」皮，于是页面不写档位也能长得像按钮；现在行内动作一律由调用点写明 `variant="quiet" size="sm"`，槽位只留排布。

## 实现边界

- `styles.css` 删除 11 套具名皮与 12 条页面级后代规则，3 组同名双写各留一处。`--control-radius`（6px）成为所有按钮的唯一圆角，`.chip-button`／`.quiet-button` 原用的 `--radius-tag`（5px）与 `.danger-confirm-button`／`.composer-footer button`／`.notification-bell` 原用的 `--radius-row`（8px）并档——**这是有意的视觉变化**，约 50 颗按钮有 1–3px 的 padding 位移与圆角收敛。
- `.page-header button`／`.context-topline button` 的 `app-region: no-drag` 与全局 `button { transition }` 不属于外观，保留。
- 错误条里的「重试／关闭」原先由 `.inline-message.error button { color: inherit }` 替它改字色；现由 `variant="link" tone="danger"` 自己带，容器只留 `float` 这一件排布事实。
- `PopoverMenu` 的字号镜像读的是触发元素计算字号，档位收敛后镜像值只会更规整，不需要改基座。
- 护栏六条（`standards/coding-standard.test.ts` 的「按钮基座纪律」）：
  1. 被收编的皮类与容器后代规则不得复活（进 `RETIRED_UTILITY_CLASSES` 的 `button` 家族，30 条）；
  2. 生产 `.tsx` 出现裸 `<button` 即失败，基座文件按名豁免、非动作形态按理由登记；
  3. `.btn[data-variant|data-size|data-tone]` 的档位集合必须与三个联合类型**穷举相等**（`neutral` 作为「没有规则就是它的实现」显式登记）；
  4. 每一档 `size` 的 `min-height` 必须取 `--control-height-*`；
  5. 选择器含 `button` 或 `.btn` 又声明了 `min-height`／`padding`／`border-radius`／`font-size`／`background`／`border`／`color` 即失败，基座自己的选择器进白名单；
  6. 一条 `ActionBar` 里出现的 `size` 档位不得超过一种。
  `CONTROL_SELECTOR` 的口径同步从三个旧皮类换成 `.btn` 与 `.icon-button`。六条都做过变异验证：新增裸按钮、CSS 多一档、抽掉某档 `min-height`、复活 `.examples button`、页面给 `.btn` 补 `font-weight`、把动作条里的「保存」改回 `lg`，逐一确认门禁转红并还原源文件。
- 迁移不改行为：`onClick`／`type`／`disabled`／`aria-*` 原样透传，可及名称与角色不变（`<button>` 仍是 `<button>`）。`AsyncButton` 的 `variant` 类型从自造的三档扩成 `ButtonVariant`，外观委托给 `Button`；`aria-busy` 语义不变。

## 取舍与后续

代价是 159 处 `<button>` 里 113 处改写、约 50 颗按钮有肉眼可见的 1–3px 变化，需要一轮人工走查；换来的是「按钮长什么样」这件事从此只有一个文件能回答，新增一档 `variant` 必须同时改 `ButtonVariant` 与 `.btn[data-variant]` 并让穷举护栏通过——想绕过出口自己造一档，编译与门禁两道都会拦。

两处已知遗留，不在本记录范围内：`ConfirmationDialog` 的底部仍是自写的 `.confirmation-dialog footer`（`display:flex` ＋ `gap:8`）而不是 `ActionBar` 基座；`.workspace-selector-action` 是浮层里的菜单项，长期看应并入 `PopoverMenu` 的 item 档。两者都是「容器替控件发外观」的同族，但换基座会改到浮层语义与焦点行为，按 ADR 的判据需要各自单独立项，不借本轮按钮收口一并混做。

`Input`／`Textarea` 维持不组件化：它们的几何已经由 `--control-*` 单一口径覆盖，且结构归 `Field`，没有长出第二套皮。若将来 `Select` 类控件再出现同类分叉，按本记录同一判据（**是否存在没有唯一出口的重复**）另立 ADR，而不是沿用「一律不组件化」或「一律组件化」的教条。
