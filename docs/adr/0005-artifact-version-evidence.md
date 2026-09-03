# ADR-0005：ArtifactVersion 持久化来源 Evidence

- 状态：Accepted
- 日期：2026-09-03

## 背景

Artifact 需要可继续修改，但同一成果的不同版本可能基于不同的资料。仅在 Task 级别保留 Evidence 会使用户无法判断某个版本实际使用了哪些来源。

## 决策

- Evidence 与 ArtifactVersion 建立多对多关系，而不是只关联 Artifact 当前状态。
- AI Run 保存 Markdown Artifact 时，只关联该 Run 已持久化的 Evidence。
- `user-edit` 版本继承其前一当前版本的 Evidence；不声明人工新增、删除或验证了任何来源。
- 来源以产品元数据显示在成果页，不自动修改正文或伪造 Citation 标记。

## 结果

每个成果版本可回看实际来源，后续 Claim/Citation、DOCX 报告和版本对比可以复用同一关系。人工编辑后若需要精确更新来源，将在完整研究工作流中以显式操作实现。
