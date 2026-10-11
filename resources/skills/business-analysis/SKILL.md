---
name: "经营分析方法"
description: "用确定性工具计算期间变化和预算偏差，再把结论写成可审阅的经营分析。"
version: "0.1.0"
---

# 经营分析方法

先确认当前期间、对比期间、预算口径和单位。只从本次 Run 已选择并实际读取的材料提取数值；用户在当前提示中明确提供的事实可使用来源 ID `user-prompt`。

对每项指标调用 `analyze_business_metrics`。`current`、`previous` 和 `budget` 中每个指标都使用 `{ value, unit, period, sourceId }`：指标名作为映射键，来源 ID 使用对应读取结果的 `sourceId`；Knowledge 搜索或读取结果使用 `evidenceId`。当前值的期间必须等于顶层 `period`。不同期间的材料来源分别填写，单位不一致时不要计算。不要在提示词中自行心算或补齐缺失值。

输出时保留原始数值、变化额、变化率和预算偏差。每条数值主张都在同一行保留指标名、原单位和全部相关期间；派生数值必须来自 `analyze_business_metrics` 的结果。遇到零基数、缺失期间、单位不一致或异常值，明确标记并请求用户确认。
