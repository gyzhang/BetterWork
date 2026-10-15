# 图形选型总指南（charts / tables / diagrams 三域）

本 skill 的页面图形来自**三个不同命名空间**，各有归属与校验方式，不要混用：

| 域 | 判据 | 骨架位置 | 规模 | 选型校验 |
|---|---|---|---|---|
| `chart/<key>` | **值驱动**：数值决定条长/点位/角度/面积/半径 | `$PPTM_HOME/skills/ppt-master/templates/charts/` | 33 | `visualization_recall.py validate chart/<key>` |
| `table/<key>` | **行列定位**：行表头 × 列表头共同定位每个事实 | `$PPTM_HOME/skills/ppt-master/templates/tables/` | 6 | `visualization_recall.py validate table/<key>` |
| `diagram/<key>` | **拓扑驱动**：顺序/分组/包含/因果决定形状 | **本 skill** `assets/diagrams/` | 8 | 见 diagrams-library.md §1 |

**铁律 — 声明即存在**：任何文档里点名的骨架 key 必须在磁盘上真实存在，且必须能通过对应校验器。上游 `visualization_recall.py validate` 对未知 key 直接判 `invalid`（本 skill 2026-09-16 实测：`flow_chart`、`org_chart`、`roadmap_chart` 等 7 个曾用名全部被拒）。`tests/selftest_e2e.py --suite skeletons` 会机械校验本表与 diagrams-library 的全部 key。

## 1. `chart/` 选型表（值驱动，33 项，按上游 chart-vocabulary.md 六类归口）

| 信息关系 | 骨架 | 典型场景 |
|---|---|---|
| 随时间变化 | `chart/line_chart` · `chart/area_chart` · `chart/stacked_area_chart` · `chart/dual_axis_line_chart` · `chart/stock_chart` · `chart/waterfall_chart` | 营收趋势、算力规模、开高低收、增减归因 |
| 类别比较/排名 | `chart/column_chart` · `chart/horizontal_bar_chart` · `chart/grouped_bar_chart` · `chart/stacked_bar_chart` · `chart/butterfly_chart` · `chart/dumbbell_chart` · `chart/pareto_chart` | 涨幅榜、厂商对比、两期变化、主因排序 |
| 目标与进度 | `chart/bullet_chart` · `chart/progress_bar_chart` · `chart/gauge_chart` | KPI 完成度、渗透率、预算执行 |
| 分布与多变量 | `chart/histogram_chart` · `chart/box_plot_chart` · `chart/scatter_chart` · `chart/bubble_chart` · `chart/heatmap_chart` · `chart/radar_chart` · `chart/matrix_2x2` | 估值分布、竞争象限、多维评分 |
| 部分与整体/层级 | `chart/pie_chart` · `chart/donut_chart` · `chart/pie_of_pie_chart` · `chart/bar_of_pie_chart` · `chart/treemap_chart` · `chart/sunburst_chart` | 收入构成、资金流向、层级拆解 |
| 流程与计量 | `chart/funnel_chart` · `chart/sankey_chart` · `chart/gantt_chart` · `chart/word_cloud` | 转化漏斗、传导链、任务排期、词频 |

> 完整定义以 `$PPTM_HOME/skills/ppt-master/templates/charts/chart-vocabulary.md` 为准（每条给出"编码了什么关系"）；机读索引 `charts_index.json` 每项带 Pick for / Skip if。

**不属于本表**：组织架构、流程图、关系网络、事件时间轴、里程碑、路线图、项目排期表——它们是拓扑驱动，属 `diagram/`，见 [`diagrams-library.md`](./diagrams-library.md)。

## 2. `table/` 选型表（行列定位，6 项）

| 信息关系 | 骨架 | 典型场景 |
|---|---|---|
| 一行一条扁平记录，列是稳定异构字段 | `table/record_table` | 明细台账、清单 |
| 实体为行、指标为列（含值/变化/状态/进度） | `table/metric_table` | 经营指标表、KPI 总表 |
| 准则 × 方案 交叉格放精确值或文字 | `table/comparison_matrix` | 选型对比、供应商比较 |
| 能力 × 产品 交叉格放支持状态 | `table/feature_matrix` | 能力矩阵、功能对照 |
| 准则 × 方案 交叉格放同一序数量表 | `table/rating_matrix` | 评分矩阵、评估打分 |
| 分组/缩进行保留明细层级（含小计合计） | `table/hierarchical_table` | 分层成本表、科目汇总 |

判据：**行表头与列表头共同定位每个事实**才用表格；格子里有数值本身不构成图表，也不构成"值驱动"。

## 3. 取用流程（工作流第 2 步「写 SVG」内执行）

1. **选型**：写下本页的信息关系 → 判定属于值驱动 / 行列定位 / 拓扑驱动 → **先看 `references/charts-atlas.md` 指向的图册 PNG（`assets/atlas/`）确认图形长什么样**，再锁定 1 个 key（不常见图形如拐点图/蝴蝶图/桑基图，光看名字最容易选错）。
2. **机械校验**（防幻名）：`python3 $PPTM_HOME/skills/ppt-master/scripts/visualization_recall.py validate chart/<key>`（或 `table/<key>`）；`diagram/<key>` 走自检。
3. **取骨架 + 三步转换（2026-09-29 实测定版，必须先做）**：上游 chart/table 骨架带的是**上游样例配色与上游版式**，直接 `cp` 会被三道闸门连续拒绝（实测单页：配色越板 96 处 → 版式越界 8 处 → 质检拒绝导出）。依次执行：
   - **① 换色**：`python3 scripts/recolour_skeleton.py "$PPTM_HOME/skills/ppt-master/templates/charts/<key>.svg" <project>/svg_output/slideNN.svg`（`table/` 同理；本 skill 自持的 `diagram/` 骨架已经过换色，可直接 `cp assets/diagrams/<key>.svg`）
   - **② 剥离上游版式件**：删掉 `<g id="header">`（标题/副标题）、`<g id="source">`（页脚）、`<g id="legend">`（图例，与图表区 bounds 重叠）——标题一律由模板版式占位符承载
   - **③ 删原生图表 marker**：形状路线（A 路线）删 `data-pptx-replace-with="chart"`，否则质检报 `requires data-pptx-fallback-sha256` 直接拒导出
   - 完整原理与判定见 references/workflows/svg-authoring-and-quality-gates.md §2.4
4. **填数据（关键纪律）**：
   - 替换数据值的同时**必须按新值重算标记几何**（条长、柱高、坐标、顶点）——骨架里的长度是旧数据的编码
   - **几何不要手算**：用上游 `scripts/svg_position_calculator.py` 直接产出坐标，见 `charts-library.md §4`
   - 保留"值→标记映射"一致性：同系列同色、单位与坐标轴保留
   - 标签、单位、类别名替换为真实内容；来源行保留
   - **数值标签必须放对位置**（2026-09-16 四页事故）：横向条图的数值标签一律 `x = 条尾 + 8`、`text-anchor="start"`，**绝不用 `text-anchor="end"` 锚在固定 x**——锚点落进条内，深色字压深色条就"消失"了。选 `value-range` 时要预留**标签车道**：`最长条长度 + 8 + 标签估宽 ≤ 绘图区右边界`；放不下就加大 range 上限（不是缩短条、不是缩字号）。同一张图内标签格式统一（都带占比或都不带）
   - **同柱双标签留 16px 以上行距**：柱顶合计与段值若都在柱外会挤成一团；段值优先放**段内白字居中**（`fill="#FFFFFF"`，既清晰又天然不触发 L1）
   - 修改后仍需遵守布局规范（标题区禁入、内容区与底注边界，坐标按模板档案）
5. **配色**：chart/table 骨架的换色已在第 3 步由 `recolour_skeleton.py` 完成（105 种上游色 → 中电金信 9 色板）。手工补色时按图表配色序列取（中电金信：`#0C2864 → #1B4593 → #266DE7 → #048AE3 → #00D3E4`；风险/负值 `#DF203C`，正向 `#00D3E4`/`#266DE7`；**禁止色板外颜色**）
6. **分组与标记**（强制）：图表包成带 `data-pptx-bounds` 的顶层 `<g id="<object-key>">`，内部再放 `<g id="<object-key>-area">`（上游兼容写法 `<object-key>-chartArea`）包住绘图区；绘图区内写两条注释标记——`chart-plot-area`（上游契约）+ `chart-data`（本 skill 契约，供几何校验重算），见 references/workflows/svg-authoring-and-quality-gates.md §2.5
7. **三项校验都要绿**（导出器内置为闸门，任一不过即拒跑）：
   - `verify_palette.py <project_dir>` → 颜色只在 spec_lock 声明的色板内（骨架换色后的复检点）
   - `verify_geometry.py <project_dir>` → 数据⇄几何一致（`status=ok`）
   - `verify_layout.py <project_dir>` → 文字放得下（无 L1 压条 / L2 出框 / L4 互撞）；报 L1 时会直接给出「加大 range 到多少」或「锚点改到哪」的修法
8. 走 `svg_native_export.py` 质检导出。

## 4. 几何计算器（值→坐标，禁止手算）

上游提供 `$PPTM_HOME/skills/ppt-master/scripts/svg_position_calculator.py`，直接输出坐标表，**这是"数据与几何一致"的机械保障**（本 skill 2026-09-16 实测）：

```bash
# 柱状/条形：--gap-width 走 PowerPoint 槽位模型（默认 150，自动推导条宽）；只给 --bar-width 则条等距居中排布
python3 svg_position_calculator.py calc bar --data "1月:80,2月:60,3月:135" --area "140,440,1180,600" --gap-width 100 --value-range=0,200
python3 svg_position_calculator.py calc bar --data "A:10,B:20" --area "..." --bar-width 90 --horizontal   # 横条
# 折线/面积/散点
python3 svg_position_calculator.py calc line --data "1:36,2:90,3:135" --area "160,255,680,430" --y-range=0,200
# 饼/环（环加 --inner-radius）
python3 svg_position_calculator.py calc pie --data "S1:42,S2:31,S3:27" --center "500,380" --radius 200 --start-angle -90
# 雷达（直接给出 polygon points，替代手写 sin/cos 公式）
python3 svg_position_calculator.py calc radar --data "性能:90,安全:85,易用:75" --center "500,380" --radius 200 --max-value 100
```

输出含 `X / Y / Width / Height` 或 `points="..."`，并会打印 `Value scale: axis ticks (0-200)` 之类的刻度来源——**没有刻度时须回读轴标签并显式传 `--value-range`**，否则会静默按 `max*1.1` 归一化，造成"图变了但说不清为什么"。

## 5. 高频推荐（月报/汇报/方案场景）

| 场景 | 首选 | 次选 |
|---|---|---|
| 指数/板块月度涨幅榜 | `chart/horizontal_bar_chart` | `chart/column_chart` |
| 营收/算力规模趋势 | `chart/column_chart` | `chart/line_chart` |
| 两年/两期对比（估值等） | `chart/dumbbell_chart` | `chart/butterfly_chart` |
| 渗透率/完成度 | `chart/progress_bar_chart` | `chart/bullet_chart` |
| 竞争格局定位 | `chart/matrix_2x2` | `chart/radar_chart` |
| 资金流向/收入构成 | `chart/sankey_chart` | `chart/donut_chart` |
| 增减归因（从 A 到 B） | `chart/waterfall_chart` | `chart/stacked_bar_chart` |
| 经营指标总表 | `table/metric_table` | `table/comparison_matrix` |
| 能力/功能对照 | `table/feature_matrix` | `table/rating_matrix` |
| 组织架构 / 汇报线 | `diagram/org_chart` | — |
| 审批流 / 作业流程 | `diagram/flow_chart` | — |
| 系统集成 / 依赖强弱 | `diagram/network_graph` | — |
| 演进历程 / 政策节点 | `diagram/timeline_chart` | `chart/gantt_chart` |
| 项目阶段 + 验收点 | `diagram/milestone_chart` | `chart/gantt_chart` |
| 多线并行路线 | `diagram/roadmap_chart` | `chart/gantt_chart` |
| 交付排期与进度 | `diagram/project_schedule_table` | `chart/gantt_chart` |

## 6. 原生 chart 路由（何时不用 SVG 骨架）

数据可能被客户复用/改数、或需要 PowerPoint「双击编辑数据」时，用**原生 chart**（references/workflows/delivery.md §4.5，`native_chart_inject.py` + `native_charts.json`，SVG 图表区留白）而非 SVG 骨架。二选一：

| 场景 | 用哪个 |
|---|---|
| 售前/交付给客户、数据需客户可编辑 | 原生 chart（column/bar/line/area/pie/doughnut/radar/radar_filled） |
| 纯视觉叙事、装饰性数据图形、复杂定制（甘特/桑基/瀑布/蜂群等 33 类） | SVG 骨架（本库） |
| 表格需要客户改数 | 原生 table（`native_table_inject.py` + `native_tables.json`，见 references/workflows/delivery.md §4.5） |
| 雷达图 | **形状版 `chart/radar_chart` 骨架为默认**（渐变填充+虚线标杆，处处渲染一致——2026-09-09 定版 v1.4）；原生 radar 仅当客户需双击改数时选用（交付须用户在真 PowerPoint 核验维度名，LibreOffice 渲染中文类别标签失真） |

（注：上游另有 SVG 内嵌 `<metadata>` + `data-pptx-replace-with` 的 marker 原生机制（可替换为 chart/formula/table 三型），需 `data-pptx-fallback-sha256` 绑定形状与 JSON、且导出须传 `--native-charts-and-tables`——**本管线统一走 `native_chart_inject.py` / `native_table_inject.py`，不采用 marker 替换机制**。因此：**若取用上游 chart 骨架走 SVG 形状路线（A 路线），必须先删掉 `data-pptx-replace-with="chart"`**，否则质检要求 sha256 而拒导出（见第 3 步 ③ 与 references/workflows/svg-authoring-and-quality-gates.md §2.4.3）。上游 `radar_chart.svg` 同样带 marker——仓库保持上游原样（不打本地补丁，见 references/workflows/maintenance.md §4），按同一三步删除后即得形状版雷达。）

## 7. 纪律

- 数据必须真实（来源可查），禁止为视觉效果编造数值
- 值与几何必须一致（长度编码造假比没有图更糟）；几何一律由 §4 计算器产出，不手算
- 每页一个主图表；多图表并列时共享同一配色语义
- 图表选型服务于页面主张（见 styles-playbook 的"断言式标题"）
- 同册同类图必须用同一骨架与同一配色序列——这是"风格稳定"的落地方式
