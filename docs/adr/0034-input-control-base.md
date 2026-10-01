# ADR-0034：输入控件基座（批次③）

- 状态：Accepted（2026-10-01，按光哥「确认补 TextField 基座」与批次顺序 ①→②→③ 的拍板实施）。
- 日期：2026-10-01。
- 依据：[UI/UX 体系 §9.10／§9.13 规矩 11／§10.1](../10-ui-ux-system.md)、[ADR-0031](0031-button-base-and-skin-closure.md) 的「唯一出口」判据、[ADR-0033](0033-typography-icon-and-surface-ladders.md) 决策 10（本记录是它挂账的那一笔的实现）。
- 关系：**替代 [ADR-0031](0031-button-base-and-skin-closure.md) 决策 5 里关于 `Input`／`Textarea` 的那半句**（「不组件化」），不改写它当时的其它结论；`Select` 一条已由 `FieldSelect` 落实，**勾选轴（`type="checkbox"`／`"radio"`）不在替代范围内**，仍按 ADR-0031 与 §10.1 的口径留原生。不替代 ADR-0033，只兑现它留给批次③的实现。

## 背景

2026-09-28 那次「不给 Input／Textarea 造组件」的判断，理由在 ADR-0031 里已经被自己纠正过一次：它当时写的「几何本来就由 `--control-*` 单一口径覆盖」不成立。本批次把这句话彻底查了一遍，两列数字都由脚本对 `styles.css`（HEAD）与渲染层 `.tsx` 做全量选择器／标签扫描得出，不是估算。**口径**：CSS 侧算的是「选择器点名 `input`／`textarea`、且真的声明了外观或几何属性」的规则块，勾选轴（`type=` 与 `check-list`／`card-select` 一类）与 `.artifact-input-*` 这种名字里带 input 的卡片件都排除在外。

| 事实 | 收编前（HEAD） | 收口后 |
| --- | --- | --- |
| 生产代码里的原生 `<input>` | **37 处** | **9 处**：8 处勾选轴（`checkbox` 7 ＋ `radio` 1）＋ `TextField` 内部那一处 |
| 生产代码里的原生 `<textarea>` | **13 处** | **2 处**：`Composer` 的任务输入区 ＋ `TextArea` 内部 |
| 迁入基座的调用点 | 0 | **41 处**（`TextField` 29 ＋ `TextArea` 12），跨 13 个文件 |
| 基座之外替输入控件写外观／几何的规则 | **30 条**（选择器点名输入控件的共 34 条） | **6 条**：一条全局 `:focus-visible` 复位、`Composer` 输入区两条、只钉 `min-height` 的布局钩子三条；另有基座自己 9 条 |
| 底色 | **4 种**（`--surface`／`--surface-raised`／`--canvas`／`transparent`） | 1 处出口 |
| 字号 | 跨 `caption`／`body`／`emphasis` **三档** | 1 处出口（`--font-size-body`） |
| 内距 shorthand | **4 种**（一把裸 `11px 0` ＋ 三档 Token） | 三档，与高度**成对** |
| 聚焦环 | **3 种处置**：档位环／`outline: none` 只改 `border-color`／`outline: 0` | 1 处出口（后两种等于把焦点环换成一条边框或干脆关掉） |
| 只读态 | 30 条里**只有 1 条**写过（`.memory-capture-source textarea[readonly]`）——别处的只读框长得和可编辑框一样 | 基座一条 `[readonly]` 规则，全仓只读框一起变 |
| 勾选轴 | 6 条 | 5 条——`.memory-editor input[type='checkbox']` 那条是给勾选框撤销页面后代规则的，被撤销的那条先走了，它也就没了存在理由 |

**为什么这不是「再补一层壳」，而是 ADR-0031 同一判据的第二次应用**：那个判据是「是否存在没有唯一出口的重复」。上表第 4 行就是答案——30 条规则在描述同一个控件的同一格几何，而 `styles.css` 里没有任何一处能拦住第 31 条。档位表（§9.10 的高度与内距）当时**有档、没有消费者**：30 条里只有零星几条取了 Token，其余把同一格内距写成裸值或干脆不写，于是「已收进 `--control-*` 三档」这句规范话在输入框这一轴上只是账面成立。

另一条证据只有批次①②做完才看得见：**动作排门禁数不到输入控件**。批次①把契约单位从 `ActionBar` 换成动作排、批次②给 `Tabs`／`SegmentedControl`／`FieldSelect` 补上 `size` 之后，`rowControlOf` 仍然认不出原生 `<input>`——所以「页头那一排里主按钮 36px、检索框 28px 且没有内距档」在两道门禁下都不报错。**档位表越严密，缺出口的那条轴就越安静**：它不会红，只会让相邻两个控件差 8px，并把这件事解释成「输入框本来就不是按钮」。

## 决策

1. **新建 `components/TextField.tsx` 作为输入控件的唯一出口**，内含 `TextField`（单行）与 `TextArea`（多行）。生产代码的文本输入不再出现原生 `<input>`／`<textarea>`。
2. **`size` 必填，类型复用 `Button.tsx` 的 `ControlSize`**，与 `Button`／`FieldSelect` 同一张「`--control-height-*` × `--control-padding-*`」成对档位表；三档在 CSS 里**成对穷举**——`min-height` 与 `padding` 一对一绑死，只对齐高度不对齐内距，同排的输入框与按钮仍是一个饱满一个瘦。
3. **`TextArea` 没有档位**：档高管的是单行控件的命中区，多行的高度由 `rows` 与内容决定，配档等于给一条没有档的轴配档；它的内距一律取最大那一档 `--control-padding-lg`，等宽正文另走 `mono` 属性（字体栈只有 `--font-mono` 一份）。
4. **底色、边框、圆角、聚焦环、字号、行高、占位符与只读态归基座**。底色定 `--surface`——下拉触发器 `FieldSelect` 用它，同排并立的输入框不能一个白一个灰；`[readonly]` 说的是「这块内容你能看不能改」，这是输入控件的通用事实不是某一页的事实，所以它进基座，收编前那唯一一处自写规则随之删除。
5. **勾选轴留原生，判据写在 `type` 上而不是文件清单上**（护栏的 `CHECK_AXIS_TYPES`）：方框由操作系统绘制，套上控件档高反而把它撑歪，而「勾了哪几个」「这一档是不是当前档」已分别由 `CheckList` 与 `SingleSelectPicker` 包住。这样新增一处勾选行不必改护栏，新增一个文本框则必须走基座。`Composer` 的任务输入区留自己的 `<textarea>`——它有自身的皮、快捷键与输入法组合语义（§10.1）。
6. **结构与说明仍归 `Field`，基座不管布局**：不写 `width: 100%`，放进 `Field` 的纵向结构里由 stretch 撑满，放进横向行里按内容取宽；label 与 hint 由 `Field` 的 `controlId` 走 `htmlFor` 关联（§9.13 规矩 5）。
7. **领域钩子只留位置与尺寸**，留在其上的唯一一处外观例外按 `selector` ＋ `property` 登记，并要求**存量与清单等量**——清单里不许留着已经改掉的条目。
8. **四条护栏，并让动作排门禁开始计数 `TextField`**。

## 实现边界

- `rowControlOf` 新增 `TextField` 分支，按 `--control-height-*` 把档位换算成 px 参与同排比对；`TextArea` 不参与（无档可取）。`size` 在类型上已经必填、省略即编译错误，护栏那一格「隐式 md」仍然保留——它是给「有人日后把它改成可选」留的牙，与本批次起点同族。
- 例外清单只有一条：`.memory-editor-counted > .text-field { padding-right: 62px }`——给绝对定位的码点角标腾出右缘，不是重述控件内距。三条只钉 `min-height` 的钩子（技能详情正文区、成果编辑器的两处撑满）不写任何外观属性，由「页面不得替输入控件发几何与外观」的属性清单天然放过。
- 新增一条**文档 ↔ 代码同值比对**护栏：§9.10 那张表与 §9.13 的四张档位行逐格回查 `styles.css` 的 `:root` 定义，实比 25 条以上；解析不出档位行即报「本条护栏已空跑」。§9.7 那次「文档写 20px、代码是 19px、还盖了达标章」的失真不能在这两张表上重演。
- 迁移不改行为：`value`／`onChange`／`type`／`placeholder`／`disabled`／`readOnly`／`aria-*` 原样透传，`<input>` 仍是 `<input>`，角色与可及名称不变。`TextFieldProps` 上的 `Omit<ComponentProps<'input'>, 'size'>` 挡掉的是原生那个 `size`（字符宽度），它与档位无关。
- 护栏四条（`standards/coding-standard.test.ts`「输入控件基座纪律」）：
  1. 生产 `.tsx` 出现裸 `<input`／`<textarea` 即失败，基座文件按名豁免、勾选轴按 `type` 放行；
  2. 三档 `min-height` 与 `padding` 必须成对取指定 Token、缺一档即失败，`.text-area[data-size]` 出现即失败，基座本体的字号／行高／底色／边框／圆角必须交回指定档位（找不到基座声明本身就算空跑自检）；
  3. 选择器含 `.text-field`／`.text-area` 又声明 `background`／`border`／`padding*`／`color`／`font-*` 即失败，例外按 `selector`＋`property` 登记且存量与清单等量；
  4. docs/10 两张档位表与 `:root` Token 双向同值。

## 后果

- **可见变化**：模型抽屉与搜索设置的输入框底色由 `--canvas` 变 `--surface`；只读框一律变灰（此前只有一处灰）；记忆冲突条的说明输入框与集合改名框字号 12 → 13px（并入 `body`）；聚焦环统一成 2px 档位环（此前两处只改 `border-color`、一处 `outline: 0`）；代码与 Markdown 编辑区仍等宽。其余是内距与高度成对后的 ≤2px 位移。待光哥在真实界面回看。
- **一次性 diff 大**：41 处调用点 ＋ 13 个文件 ＋ 24 条 CSS 规则退役 ＋ 基座 9 条新规则。这与批次①②同一形状：分小批做，每批都会留下两套并存的状态。
- **「有档位」与「有出口」是两件事**，这条结论现在有三份证据（按钮＝ADR-0031、排版五轴＝ADR-0033、输入控件＝本记录）。今后核查一条轴要问两句：这张表有没有档位，档位有没有一个只有它能写、别人写了就红的出口。
- **不做的事**：不为「输入框专用字号」另立一档；不把勾选框上收成组件；不借本轮去动 `Field` 的标签结构或 `Composer` 的快捷键语义；不引入受控／非受控之外的第三份输入状态。

## 验证

十发变异全部逐一转红、还原后复绿（探针脚本按字节写回并对每发做 sha256 比对，不一致即中止，不留半改状态）：档高与内距脱钩、抽掉 `sm` 一档、基座底色改 `--canvas`、给多行区配 `data-size`、页面替输入控件发底色、例外清单留着已改掉的、生产代码出现裸 `<input>`、docs/10 把 `--control-height-sm` 写成 30px、`font:` 简写藏字号（批次②补的那条）——这九发打进的是护栏自己的判据。

第十发验的是**真实槽位而不是夹具**：把知识页检索那一排（`PageToolbar.children`）里的 `TextField` 从 `md` 降成 `sm`，动作排门禁报出「`FieldSelect·md` | `TextField·sm` | `Button·primary·md` | `Button·outline·md` | `Button·text·md`（高度 32／28px）」——`rowControlOf` 那个新分支在真页面上有牙，而不只是在护栏自己的样例里。

`standards/coding-standard.test.ts` 用例由 113 增至 **118**（输入控件四条 ＋ `font` 简写一条）；`components/TextField.test.tsx` 另有 5 条用例钉住基座自己的输出（类名顺序、`data-size`、原生属性透传、`onChange` 取值、`TextArea` 不吃档高 ＋ `data-mono`）。全量 `npm run verify` 结果见 [2026-10-01 工作日志](../logs/2026-10-01.md)。
