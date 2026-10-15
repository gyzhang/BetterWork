# 图形骨架可视化图册索引（charts-atlas）

> **用途**：看图选型，而不是只读名字。拐点图、蝴蝶图、桑基图、旭日图这类不常见骨架，光看 key 名极易选错——请先在下方对应图册 PNG 里找到「长什么样」的那一帧，确认视觉匹配，再回 [`charts-library.md`](./charts-library.md) 或 [`diagrams-library.md`](./diagrams-library.md) 读完整选型规则（含 Skip if / 互斥边界）。

> **图册位置**：`SKILL/assets/atlas/`。每帧下方标注了 key 名，方便人与 AI 对应。

## 1. 值驱动图表（33 项，`chart/<key>`）

来源骨架：`$PPTM_HOME/skills/ppt-master/templates/charts/<key>.svg`（以 `charts_index.json` 为准）。

| key | 一句话适用 | 视觉特征 | 图册位置 |
|---|---|---|---|
| `area_chart` | 1–2 条累积趋势，强调体量随时间变化 | 填充面积折线，强调体量 | charts-01.png 第1格 |
| `bar_of_pie_chart` | 饼图长尾小类拆出成条形细看 | 饼图＋侧边堆叠条 | charts-01.png 第2格 |
| `box_plot_chart` | 各组分布形态（中位/四分位/离群） | 箱体＋须线＋离群点 | charts-01.png 第3格 |
| `bubble_chart` | 三轴数据（x 位置、y 位置、大小） | 带大小的气泡散点 | charts-01.png 第4格 |
| `bullet_chart` | 3–7 个 KPI 各有目标值与实际值 | 条＋目标刻度线 | charts-01.png 第5格 |
| `butterfly_chart` | 两组镜像数据共用中轴对比 | 左右镜像条形 | charts-01.png 第6格 |
| `column_chart` | 3–8 类单系列数值比较 | 竖直柱 | charts-02.png 第1格 |
| `donut_chart` | 3–6 部分占比，中心强调总数 | 环形带中心数字 | charts-02.png 第2格 |
| `dual_axis_line_chart` | 两指标单位/量纲不同的时间对比 | 双 Y 轴折线 | charts-02.png 第3格 |
| `dumbbell_chart` | 5–10 项的前后/两态差异 | 两点连线哑铃形 | charts-02.png 第4格 |
| `funnel_chart` | 3–5 阶段单调递减转化 | 漏斗梯形递减 | charts-02.png 第5格 |
| `gantt_chart` | 6–12 任务起止时长＋可选依赖 | 横向时间条 | charts-02.png 第6格 |
| `gauge_chart` | 单一有界指标对目标/阈值 | 仪表盘指针 | charts-03.png 第1格 |
| `grouped_bar_chart` | 2–4 系列同类的并排对比 | 分组并排柱 | charts-03.png 第2格 |
| `heatmap_chart` | 二维矩阵每格一个强度值 | 色块网格 | charts-03.png 第3格 |
| `histogram_chart` | 大量观测的数值分布分箱 | 频数分布柱 | charts-03.png 第4格 |
| `horizontal_bar_chart` | 5–12 项排名，标签较长 | 横向条 | charts-03.png 第5格 |
| `line_chart` | 1–3 条时间序列看走势 | 折线 | charts-03.png 第6格 |
| `matrix_2x2` | 4–10 项落四象限，第三维用半径 | 四象限＋气泡 | charts-04.png 第1格 |
| `pareto_chart` | 80/20 贡献，降序柱＋累计线 | 柱＋累计折线 | charts-04.png 第2格 |
| `pie_chart` | 3–6 部分占一个整体的简单比例 | 整圆扇区 | charts-04.png 第3格 |
| `pie_of_pie_chart` | 小扇区拆出第二个饼细看 | 双饼 | charts-04.png 第4格 |
| `progress_bar_chart` | 3–8 项各带完成百分比 | 进度条 | charts-04.png 第5格 |
| `radar_chart` | 4–8 能力维度跨 1–3 主体 | 雷达多边形 | charts-04.png 第6格 |
| `sankey_chart` | 3 段带量的流向（源→节点→汇） | 分流带 | charts-05.png 第1格 |
| `scatter_chart` | x–y 相关、聚类、离群扫描 | 散点 | charts-05.png 第2格 |
| `stacked_area_chart` | 2–4 序列总量＋构成随时间 | 堆叠面积 | charts-05.png 第3格 |
| `stacked_bar_chart` | 类内分 2–4 部分的构成对比 | 堆叠柱 | charts-05.png 第4格 |
| `stock_chart` | 开高低收价格走势 | K 线/烛台 | charts-05.png 第5格 |
| `sunburst_chart` | 2–3 层环状的层级占比 | 同心环 | charts-05.png 第6格 |
| `treemap_chart` | 多层分组、大小不一的面积占比 | 矩形块 | charts-06.png 第1格 |
| `waterfall_chart` | 逐步增减从起点桥接到终点 | 浮桥柱 | charts-06.png 第2格 |
| `word_cloud` | 20–30 关键词字号编码权重 | 大小不一的词 | charts-06.png 第3格 |

## 2. 行列定位表格（6 项，`table/<key>`）

来源骨架：`$PPTM_HOME/skills/ppt-master/templates/tables/<key>.svg`（以 `tables_index.json` 为准）。

| key | 一句话适用 | 视觉特征 | 图册位置 |
|---|---|---|---|
| `record_table` | 一行一条扁平记录，列为稳定异构字段 | 扁平行列表 | tables-01.png 第1格 |
| `metric_table` | 实体为行、指标为列（值/变化/状态/进度） | 指标网格 | tables-01.png 第2格 |
| `comparison_matrix` | 准则×方案交叉格放精确值或文字 | 交叉对比格 | tables-01.png 第3格 |
| `feature_matrix` | 能力×产品交叉格放支持状态 | 状态标记格 | tables-01.png 第4格 |
| `rating_matrix` | 准则×方案交叉格放同一序数量表 | 打分等级格 | tables-01.png 第5格 |
| `hierarchical_table` | 分组/缩进行保留层级（含小计合计） | 缩进分层表 | tables-01.png 第6格 |

## 3. 拓扑驱动关系/结构图（8 项，`diagram/<key>`）

来源骨架：`SKILL/assets/diagrams/<key>.svg`（本 skill 自持）。

| key | 一句话适用 | 视觉特征 | 图册位置 |
|---|---|---|---|
| `org_chart` | 谁向谁汇报、谁归谁管 | 层级节点树 | diagrams-01.png 第1格 |
| `flow_chart` | 先后顺序、有分支有回退 | 流向框＋箭头 | diagrams-01.png 第2格 |
| `network_graph` | 主体与多外部系统的往来强度 | 中心辐射图 | diagrams-01.png 第3格 |
| `timeline_chart` | 关键事件按时间先后排列 | 时间轴节点 | diagrams-01.png 第4格 |
| `milestone_chart` | 把周期切成阶段并标验收点 | 阶段带＋菱形 | diagrams-01.png 第5格 |
| `roadmap_chart` | 多条线在同一时间轴并行推进 | 泳道×阶段 | diagrams-01.png 第6格 |
| `project_schedule_table` | 任务×期次的排期与进度 | 期次甘特表 | diagrams-02.png 第1格 |
| `pyramid_chart` | 层级构成、越往上价值密度越高 | 四层对称梯形塔＋右列引线 | diagrams-02.png 第2格 |

## 4. 最容易选错的四组（互斥边界）

以下四组是实测最高频的选错点，来自 `diagrams-library.md §1` 的互斥边界与 `charts-library.md` 的 Skip if：

**① 时间点 / 区间 / 任务工时（时间类四选一）**
- 要表达**时间点事件**按先后排列 → `diagram/timeline_chart`
- 要表达**区间/时长**（把周期切成阶段、标验收点）→ `diagram/milestone_chart`
- 要表达**任务级起止与工时**（带资源泳道/依赖线）→ `diagram/project_schedule_table`；若还要显式依赖线则 `chart/gantt_chart`

**② 层级归属 / 带数值排序（组织 vs 条形）**
- 只表达**谁归谁管**的层级归属 → `diagram/org_chart`
- 节点上**挂数值并按大小排序**（值驱动）→ `chart/horizontal_bar_chart`（层级图不编码数值）

**③ 往来强度 / 明确先后（网络 vs 流程）**
- 表达主体与多系统的**往来强度/接口依赖**（中心辐射）→ `diagram/network_graph`
- 有**明确先后、分支、回退**的流程 → `diagram/flow_chart`

**④ 层级构成 / 数值精确对比（金字塔 vs 条形 vs 漏斗）**
- 层级构成、越往上价值密度越高（层宽示意化）→ `diagram/pyramid_chart`
- 层宽编码真实数值并按大小排序 → `chart/horizontal_bar_chart`
- 逐层转化递减（漏斗语义）→ `chart/funnel_chart`
