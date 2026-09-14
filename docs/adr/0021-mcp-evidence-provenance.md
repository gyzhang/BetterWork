# ADR-0021：MCP 工具结果的来源证据

- 状态：Accepted（E42/E55，2026-09-14）
- 前置：[ADR-0016](0016-mcp-transport-and-lifecycle.md)、[ADR-0017](0017-web-fetch-and-evidence-boundary.md)、[ADR-0014](0014-expert-context-and-material-binding.md)。

## 背景

MCP 只读工具的结果属于一次 Run 实际查阅的外部来源。原有 Evidence 只区分本地文件和网页，导致 MCP 查询只能在工具活动中回看，不能跟随 Run 的来源和 Artifact 关系保存。

## 决策

1. Evidence 增加 `mcp-tool` 来源类型。RunService 在 MCP 工具成功完成时登记工具名、稳定来源 URI、受限结果摘录和哈希；记录的是原始工具返回，不把它自动表述为已核验的业务事实。
2. 来源 URI 使用 `mcp:<model-tool-name>`，其中模型工具名包含稳定连接前缀和工具名；同一 Run 的相同工具结果沿用已有 `(runId, sourceUri, locator)` 去重约束。
3. `mcp-tool` 证据只能在算台内查看，不能调用本地文件打开动作；Artifact 版本可以沿用既有 Run Evidence 关系展示它。
4. 本次只扩展协议枚举和已有 TEXT 列，不增加迁移；输出摘录限制为 2,000 字符，完整结果仍保留在 Run 事件中并受现有事件访问范围控制。

## 验证边界

离线 MCP stdio 替身验证工具调用、Evidence 登记、去重和 UI 展示。真实业务系统的账号、口径和结果核定仍属于 E55 人工验收；Evidence 不等于用户确认或财务事实。
