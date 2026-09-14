# 专家连续两期验收记录（合成数据）

- 日期：2026-09-14
- 范围：E55 自动化验收切片；不包含公司的真实财务资料。
- 专家路径：研究分析专家 → 经营分析方法 Skill → `analyze_business_metrics`。

## 已核验

1. 第一期开立独立 Task/Session/Run，保存 2026-08 报告版本。
2. 第二期开立不同的 Task/Session/Run，输入当前收入 120、对比收入 100；确定性工具返回变化额 20、变化率 0.2。
3. 第二期报告版本通过 `ArtifactInputRelation` 关联第一期精确 Markdown 版本，来源关系为 `comparison`；历史版本仍可读取。
4. 第二期 `DiscussionCheckpoint` 关联报告版本，第一期任务查询不到第二期节点，证明任务和上下文未串联。
5. 经营分析 Expert 修订保存第一期 ArtifactVersion 作为常用参考；第二期 TaskContext 固定同一 Expert 修订，并以 `expert-reference` 来源注入第一期精确版本。

自动化证据位于 [`expert-two-period-acceptance.test.ts`](../../apps/desktop/src/main/services/expert-two-period-acceptance.test.ts)。真实桌面验收仍需在 macOS 上用脱敏的规则、上期 PPT 和本期表格执行 E55 路径，并记录人工核定数值、网页/MCP 来源和取消/重启操作。自动化测试覆盖 Expert 绑定，但不替代真实窗口走查。

## 限制

本记录不把合成数据当成公司的经营结果；没有把任何公司材料、密钥或外部账号写入仓库。真实两期验收完成后，应在本文件追加脱敏步骤和 SQLite 关系证据。
