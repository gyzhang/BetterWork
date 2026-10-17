# ADR-0052：将 GitHub 官方 MCP 作为只读内置服务随包分发

- 状态：Proposed（2026-10-17 用户选定 GitHub 并直接授权内置接入；技术边界待用户真实测试后确认）。
- 延续：[ADR-0036](0036-macos-only-platform-scope.md) 的 macOS arm64 范围、[ADR-0043](0043-mcp-multi-transport-and-oauth.md) 的 MCP 生命周期与 [ADR-0044](0044-mcp-explicit-side-effect-tool-authorization.md) 的逐工具授权。
- 关联：[ADR-0045](0045-bundled-runtimes-for-local-mcp.md) 的本地服务随包原则、[ADR-0047](0047-bundled-node-runtime.md) 的受管 Node 运行时、[CF43](../development/tasks-capability-foundation.md)。

## 背景

用户选定已有的 `filesystem`、`memory`、`sequential-thinking`、`fetch` 四个本地 MCP，并新增 GitHub 官方 MCP，供后续真实验收。现有四个 runtime 已由 CF43 登记；GitHub 官方 stdio server 使用 Go，不能经现有 Node/Python 入口运行。BetterWork 按 ADR-0043 为每个 Run 建立独立 MCP client，GitHub 官方本地 OAuth 又只将令牌保留在该服务进程内存，故它无法跨 Run 复用，也会把授权浏览器流程放进 Run。

## 决策

1. 把 GitHub 官方 MCP Server v2.0.2 的 `Darwin_arm64` release 作为显式内置 `serverId: 'github'`。版本、下载 URL 与 SHA-256 固定登记；构建准备脚本先校验归档，再提取官方可执行文件与 MIT 许可证。随安装包分发，不要求用户安装 Go、Docker 或 Node 包。
2. GitHub server 以 stdio 启动，并在命令行末尾强制传入 `--read-only`。过滤用户提供的同名覆盖参数；服务端只读模式关闭所有写工具。MCP 工具仍须经 BetterWork 的合同审阅、明确允许、Run 选择与连接启用流程。
3. GitHub 凭据使用现有 MCP 机密环境变量存储：`GITHUB_PERSONAL_ACCESS_TOKEN` 必须登记为机密环境变量，并通过既有受保护凭据服务加密保存；未配置时在连接前返回可行动提示。建议用户自行签发仅对测试仓库有读取权限的 Fine-grained PAT。令牌只在启动 GitHub 子进程时注入，不写入 MCP 修订或日志。
4. 不使用 GitHub MCP 的本地 OAuth 流程：其进程内存令牌随每次 Run 结束销毁，无法满足本应用的 per-Run 客户端生命周期。也不使用官方远程 endpoint；本轮的选择目标是补足 CF33 的真实 stdio 接入。
5. 不将旧的自定义 GitHub 命令迁移到新 `serverId`，不自动创建、启用连接或允许工具。用户在 MCP 设置中自行添加内置 GitHub 连接；其 token 范围仍由 GitHub 账号与用户签发的 PAT 决定。
6. 本 ADR 不改变现有四个内置 MCP，也不改变其连接创建、工具审阅或授权状态。

## 取舍与边界

锁定官方原生制品避免安装时构建 Go 或依赖容器运行时，但会增加安装包体积，并要求维护版本、哈希、许可证和代码签名链。`--read-only` 限制 GitHub MCP 暴露的工具，不是 OS 沙箱；进程仍以 BetterWork 用户权限运行。PAT 的权限高于 MCP 只读工具集时，server 只读标志不能收窄 PAT 本身，故界面建议使用仓库范围的只读 token。

## 验收

- 自动化/构建验证按 CF43 记录：锁定归档 SHA-256、arm64 可执行文件、许可证和安装包资源落点；无 PAT 时拒绝启动；用户参数不能覆盖只读模式。
- 用户真实验收另按 CF33/CF43 记录：用真实 GitHub 账号配置 PAT，连接检测只发现工具、不调用业务工具；只读工具经用户审阅/允许/选择后执行一次真实 Run，并核对 Run、ToolCall 和 Evidence。未完成前 CF33 与 CF43 保持 `partial`。

## 官方来源

- [GitHub MCP Server v2.0.2 release](https://github.com/github/github-mcp-server/releases/tag/v2.0.2)
- [GitHub MCP Server configuration：read-only mode](https://github.com/github/github-mcp-server/blob/v2.0.2/docs/server-configuration.md)
- [GitHub MCP Server local OAuth：stdio token lifecycle](https://github.com/github/github-mcp-server/blob/v2.0.2/docs/oauth-login.md)
- [GitHub MCP Server LICENSE](https://github.com/github/github-mcp-server/blob/v2.0.2/LICENSE)
