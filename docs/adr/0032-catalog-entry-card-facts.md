# ADR-0032：目录条目的同一份事实

- 状态：Accepted（2026-09-30，按光哥「按方案 A 出 Plan，命名取 `CatalogCard`／`CatalogRow`、专家页测试同轮补、`onOpen` 拆给外层」的拍板实施）。
- 日期：2026-09-30。
- 依据：[ADR-0030](0030-expert-card-metadata-and-deletion.md) §决策 1 与 §决策 5（一张卡片要能自我介绍；卡片与列表行共用同一组就地动作）、[ADR-0031](0031-button-base-and-skin-closure.md) 的「唯一出口」判据，以及 [UI 治理账本](../reviews/2026-09-28-ui-governance-audit.md) R3-D 那条自记缺口。
- 关系：**不改写** ADR-0030 的任何结论，只把它给专家定的那份内容清单推到同类对象上，并把清单从散文与注释变成类型与护栏。

## 背景

ADR-0030 给专家卡定了固定顺序「图标 → 名称＋署名与版本号 → 描述 → 用途标签与状态片 → 就地动作」，并规定卡片与列表行共用同一组就地动作。2026-09-28 落地时只有专家页遵守；2026-09-30 G4 轮（提交 `10dce19`）把同口径推到技能页，**手段是照抄专家页的写法**。

抄完之后现场是这样的（行号为当轮实测）：

| 事实 | 实测 |
| --- | --- |
| 两套同构装配 | 专家 `ExpertsView.tsx:169-290`（122 行）＋ 技能 `SkillsView.tsx:52-181`（130 行，其中 66-87 的 `SkillChips` 是领域内容） |
| 逐字同构的动作档 | 「详情」第一颗、启用↔停用文案翻转、「内置给复制副本／否则给 `tone="danger"` 的删除」——两页措辞与结构一致，只有回调名不同 |
| 卡片↔行的槽位对照 | 8 格，此前**没有任何一处文档或类型写过**，只存在于四个函数的摆布里 |
| 身份块的包法不对称 | `Card` 的 `leading` 由基座套 `CardMark`（`Card.tsx:63`），`ListRow` 的 `leading` 要页面自己套——两页各手包一次 |
| 已经丢过的一格 | G4 之前技能**列表档没有署名行**，卡片档有；同一条数据两种视图读起来少一件事 |
| 「行档不做整行可点」 | 靠两页各自的注释维持。G4 在账本 R3-D 里自己写下：「**列表行是靠『右槽有按钮就撤掉整行点击区』这条人工约定维持的，没有基座表达**」 |

`Card` 基座的六个槽**故意全是可选的**，因为它同时服务四种形状差异很大的卡（记忆建议卡整块走 `children`、成果输入卡本来就是行、外观预览的选择卡根元素是 `<button>`）。所以「哪些格子必须填」这条清单**不属于基座，属于目录条目这一类对象**：专家与技能都是「目录里的一条可召唤／可启用条目」，它们的卡片必须自我介绍。

于是有两个去处，都被付过代价：把清单压进 `Card`＝给那三种正当异形发豁免，基座的可选性被改成必填是为少数对象重写多数对象的契约；清单留在页面＝每加一个实体抄一遍，G4 已经抄了第一遍并当场丢过一格。第三个去处是本记录选的：**在页面与基座之间加一层「一份事实、两种排布」**。

## 决策

1. **新建 `components/CatalogCard.tsx`，导出 `EntryFacts` ＋ `CatalogCard` ＋ `CatalogRow`。** 它是目录条目卡片与列表行的唯一装配出口；`Card` 与 `ListRow` 继续做外壳，本记录不改动它们的槽位契约与 `styles.css` 的共用外壳规则。
2. **`EntryFacts` 里 `mark`／`name`／`byline`／`description`／`actions` 五格必填**，`notes`／`primary`／`className` 可选。漏署名、漏说明从此是编译错误，不是评审时靠眼睛找——G4 丢的那一格正是这条。
3. **那张对照表只住在一个地方**（卡片档与行档各吃什么槽；`Card` 与 `ListRow` 的槽位名不同，这一层负责把它们对上）：

   | 条目要交代的这件事 | 卡片档（`Card` 槽） | 列表档（`ListRow` 槽） |
   | --- | --- | --- |
   | 身份块（图标或首字） | `leading`（基座套 `CardMark`） | `leading`（**同由基座套**，页面不再手包） |
   | 名称 | `title` | `title` |
   | 说明 | `description`（三行定高＋Tooltip） | `detail`（行的单行省略） |
   | 署名（作者·版本／来源） | `byline` | `meta` |
   | 用途标签与状态片 | `children` | `children` |
   | 一排就地动作 | `footer` | `actions` |
   | 悬停才显形的主动作 | `topTrailing`，并由基座包进 `.card-primary` | 排在 `actions` 之前，原样常驻 |
   | 领域钩子（网格定位、悬停显形） | `className`（从外层给） | 不吃这一格 |

4. **整行可点不进 `CatalogRow` 的类型。** 行的右槽站着动作按钮，按钮套按钮是无效 DOM，所以行永不做成整行按钮——这条约定第一次由基座的**类型**表达而不是注释。真需要「整行可点＋底部动作」时应当给 `ListRow` 加一档，`CatalogRow` 是唯一改点；不由两页各猜一次。
5. **`onOpen` 与 `className` 拆给外层**（光哥拍板）：`EntryFacts` 只装「这条条目说的几件事」，交互与定位钩子从外面给——`CatalogCard({ facts, onOpen, className })`，`CatalogRow({ facts })` 没有这两个入参。代价是配对件多一层参数，收益是同一份 facts 将来可以在详情页头部那类地方复用，而不会夹带一个只有一档吃得到的格子。
6. **主行动的「悬停与聚焦才显形」改由基座拥有**：`.expert-card-summon` 这个页面类退役，卡片档把 `primary` 包进 `.card-primary`（`styles.css` 里紧挨 `.card-top` 的那条），行档原样交出这颗按钮常驻。原因很直接：`primary` 是**同一份事实里的一格**，而显形规则在两档不同——让页面用一个只有自己那一档看得懂的类名去表达它，等于把差异藏回抄写里。`.card-footer` 那条同理收掉：卡片那排动作归 `Card` 的 `footer` 槽，页面上那颗 `.expert-card-actions` 是无人引用的死声明，一并删掉（`.expert-detail-actions` 是详情页小节，保留）。
7. **领域差异留在页面，不抽。** 专家的「召唤」`primary`、`blockedReasons` 的 `StatusNote`、用途标签；技能的信任↔撤销信任、四枚状态 `Badge`、名称首字；两页 byline 的字面（`作者 · v{修订号}` 对 `内置/用户 Skill`）与删除语义（专家 RESTRICT 对技能 CASCADE，后者是 G4 登记、**仍待光哥拍板**的那条）。页面各自只留一个纯函数 `expertFacts()`／`skillFacts()` 把领域数据翻成 `EntryFacts`。
8. **护栏四条并各带变异验证**（`standards/coding-standard.test.ts` 新增「目录条目卡片纪律」，101→**105** 条）：
   - 配对件与 `Card` 之外，生产 `.tsx` 不得再出现 `<Card`——拦的就是「新页面自己手摆一遍六槽」；今天唯一的豁免是记忆候选卡（整块走 `children`，没有身份块与署名两格），理由写在白名单里。变异：新建一个手摆 `Card` 的视图 → 恰好 1 红。
   - `CatalogRow` 的实现里不得出现 `onClick`——拦「整行可点」回到私搭。变异：给行档加 `onClick={() => undefined}` → 恰好 1 红。
   - `EntryFacts` 的 `mark`／`name`／`byline`／`description`／`actions` 不得改成可选。变异：`byline` 放宽一格 → 恰好 1 红，且报的是「这五格是内容底线」那句而不是「解析不出」的空跑话（先按两种写法确认解析得到，再判可选——顺序反过来会指错方向，这条本轮真踩过）。
   - `.expert-card-actions`／`.expert-card-summon` 不得复活，CSS 选择器与 `.tsx` 的 `className` 两侧都扫。变异两发：页面把 `expert-card-summon` 写回 `Button` 的 `className` → 1 红；把 `.expert-card-actions` 加回样式表 → 1 红并报出该选择器。同轮把三处按旧钩子点名处改到新出口：`App.test.tsx` 的 `.expert-card` → `.expert-cards .card`、`.expert-card-summon` → `.card-primary`，`AsyncButton.test.tsx` 那枚拿来当占位类名的 `expert-card-summon` 一并换掉——**它没被护栏扫到（护栏不吃测试文件），但把退役名留在测试里，等于给下一次复用留了样本**。

## 实现边界

- 不动 `Card.tsx`、`ListRow.tsx`、外壳 CSS 那条共用规则（`.card, .option-card, .list-row[data-variant='card']`）与 `--card-padding`／`--card-gap` 档位。
- 不并 `KnowledgeDocumentCard`：它是 `ListRow`＋`PopoverMenu`，形状正当，只有名字名实不符（登记为待办，不在本记录处理）。不并 `MemorySuggestionList` 与外观页 `option-card`，理由同上表的三种异形。
- 不改 `SkillsView.test.tsx` 现有 12 例的断言：它们测的是「哪一张卡有哪颗按钮」的业务映射，不是摆布方式；重构把它们改红就是行为被改错了。同轮补 `ExpertsView.test.tsx` 两条——**专家页此前没有「同名测试文件」，但不是没有测试**：卡片行为由 heavy 档 `App.test.tsx` 的四条兜着（切换、图标与署名与用途标签、卡片上直接停用、内置不给编辑）。新两条与那四条不重复，钉的是逐卡动作映射与「两档同一份事实」。这两条也确实是本轮的保险绳：接入第一条就抓红了 `App.test.tsx` 里对 `.expert-card` 的选择器。
- 范围只到「已有两个真实消费者」：专家与技能。**没有第三消费者就不再往外推**，MCP 服务与 Kit 都不在当前路线图里。

## 取舍与后续

- **正面代价**：docs/10 §10.1 那句「同一份几何两种排布」推进为「同一份事实两种视图」；G4 自记的那条「人工约定没有基座表达」由 `CatalogRow` 的类型收掉；下一次加同类条目只需要写一个 facts 函数。
- **接受的代价**：多一层间接——读专家页时要看 `expertFacts()` 才知道卡片上那几行从哪来；`EntryFacts` 的 `description` 在两档分别是三行定高与单行省略，**同一格两种截断**是本记录明确保留的差异（行的密度本来就与卡不同），不是待修项。
- **仍待光哥拍板**（不在本记录范围）：`ListRow` 要不要长「整行可点＋底部动作」那一档（R3-D）；技能删除的 `ON DELETE CASCADE` 与专家的 `RESTRICT` 两种语义是否向专家靠（要迁移与另立 ADR）。
- 命名说明：`Catalog` 指「目录里的一条条目」，**不给页面当名字**——一级导航的正式称呼只看 [docs/10 §6.1](../10-ui-ux-system.md) 那张表（工作／成果／知识／技能／专家，加侧栏底部设置）。「能力」是模型／技能／MCP／搜索的总称且不含专家，所以本基座不叫 `Capability*`。
