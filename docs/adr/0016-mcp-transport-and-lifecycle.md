# ADR-0016：MCP 首轮传输、工具发现与生命周期

- 状态：Accepted（E40，2026-09-14）
- 范围：MCP 连接、工具发现、调用、取消和退出的首轮宿主边界；具体设置 UI 与 Expert/Task 选择留 E42。
- 前置：[ADR-0014](0014-expert-context-and-material-binding.md)、[专家与任务材料开发计划](../development/tasks-experts.md)。

## 背景

专家需要接入业务系统的只读查询，例如财务月度经营数字。MCP 工具描述可以帮助模型理解输入输出，但不能因此自动获得调用授权。首轮还没有可稳定提供账号的外部业务系统，因此必须先用离线替身验证协议生命周期，再把同一客户端适配到真实只读服务；不能用假连接宣称真实验收通过。

## 决策

1. 首轮支持 MCP **stdio** 传输：Main 按用户配置启动一个受管子进程，使用 JSON-RPC 消息完成 initialize、`tools/list`、`tools/call` 和关闭。stdio 适合本地业务 CLI，生命周期可复用现有进程树监督、超时和取消设施。Streamable HTTP 是后续连接类型，不在 E41 之前混入本地进程协议。
2. E41 使用官方 `@modelcontextprotocol/client` v2.0.0，Node `>=20` 与仓库 `>=22.12` 兼容；Core 和 Tool Runtime 不导入 SDK，MCP 客户端留在 Infrastructure/Main，通过宿主适配成结构化 `AgentTool`。
3. 连接身份只包含 BetterWork 客户端名与版本；stdio 子进程的 stdout 只允许 JSON-RPC，诊断写 stderr，密钥不进入参数日志。首轮样本不需要账号；真实连接的凭据由 Main 的本机安全存储负责，Renderer 只看是否配置和连接状态。
4. 每个连接维护稳定的 `connectionId`；发现的工具稳定 ID 为 `connectionId/toolName`。同名工具不覆盖：没有稳定连接前缀的调用拒绝进入 Run。工具描述、输入 Schema 和输出均在 Main 用 Zod/JSON Schema 边界校验，描述不等于授权。
5. `tools/list` 结果只形成候选目录。新发现工具默认未授权；ExpertRevision 和 TaskContextRevision 在发送边界固定具体工具 ID，运行中只暴露这份交集。连接、工具发现或 Schema 变化不会静默修改历史绑定。
6. `callTool` 的 AbortSignal、超时和 Run 取消必须传到连接层；共享连接取消一个请求不能关闭其他 Run。进程退出先关闭 stdio，再按现有 supervisor 处理 SIGTERM/SIGKILL；断线只报告失败，不自动重试可能有副作用的调用。
7. 首个业务样本是只读 `finance.monthly_summary`：输入 `month`，返回结构化经营数字和来源标识。离线替身放在 `scripts/fixtures/`，探测脚本必须验证启动、握手、发现、调用、非法响应和干净退出；没有外部账号时，真实服务验收标记为阻塞。

## 生命周期

```text
configured -> starting -> connected -> discovering -> ready
     |            |             |             |
   invalid      failed       disconnected  failed
```

- `starting` 只表示子进程已创建，不能调用工具。
- `connected` 完成 initialize 后可执行 `tools/list`，但工具仍是候选。
- `ready` 保存本次发现的工具 Schema 哈希；Schema 改变要求重新确认绑定。
- `disconnected` 收口进行中的调用，保留历史 Run 事件和失败原因；下次显式检测或新 Run 才重新连接。
- 应用退出统一关闭连接，不能留下孤儿 MCP 进程。

## 依据与验证边界

MCP 官方文档说明 stdio 由客户端启动子进程、通过 stdin/stdout 传输 JSON-RPC；官方 TypeScript SDK 提供 `Client`、`StdioClientTransport`、`listTools`、`callTool` 和 `close()` 生命周期。首轮实现依据 [MCP transports](https://modelcontextprotocol.io/specification/draft/basic/transports)、[TypeScript SDK client](https://ts.sdk.modelcontextprotocol.io/client) 与 [stdio client API](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/client/client/stdio.html)。

E40 的可执行验证仅覆盖离线替身与协议生命周期；未配置外部业务账号，因此真实财务系统调用仍是 E43/E4 人工验收前置，不能在测试报告中写成已通过。

## 不在本 ADR 范围内

- Streamable HTTP、SSE 兼容、OAuth 动态注册和远程连接池；
- 写入型业务工具、审批、批量变更和凭据导出；
- 自动把新工具加入 Expert、Task 或普通助手；
- MCP Resource/Prompt 全量支持；首轮只适配工具调用。
