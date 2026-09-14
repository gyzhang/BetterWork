# ADR-0017：公开网页正文读取与证据边界

- 状态：Accepted（E43，2026-09-14）
- 前置：[ADR-0007](0007-search-engine-config-and-web-search-tool.md)、[ADR-0016](0016-mcp-transport-and-lifecycle.md)。

## 决策

1. `web_fetch` 是 Main 注入的只读 AgentTool；Core 只看结构化 `WebFetch` 函数，不导入 Electron、网络客户端或 Renderer。
2. 输入只接受 `http`/`https` URL。宿主拒绝带凭据的 URL、localhost、`.local`、环回、私有 IPv4/IPv6 和非正文 Content-Type；重定向最多 3 次，每一跳重新校验目标。
3. 请求有 15 秒超时、AbortSignal 取消和 1 MiB 响应上限。HTML 去除脚本、样式和标签后提供正文与标题；超长正文明确标记截断。失败、取消、非正文和 HTTP 错误进入 Run 失败/取消终态，不伪造来源。
4. 成功读取在 `tool.completed` 后登记 `web-page` Evidence，保存最终 URL、抓取时间、内容哈希、HTTP/Content-Type 定位和正文摘录。搜索摘要与正文读取是两条独立 Evidence，不能互相冒充。
5. 网页正文是不可信外部内容，只能作为模型输入和可回看的证据，不能改变系统指令、Expert 能力、材料范围或触发业务写入连接器。

## 验证边界

使用注入的 `fetch` 替身覆盖正文提取、重定向、私网目标、二进制响应、超长响应和取消；真实搜索→正文→来源旅程留给有外部网络和账号条件的人工验收。
