# 首批内置 MCP 与真实验收

- 日期：2026-10-17。
- 状态：用户已选定五项；GitHub 内置接入代码已编写，真实账号与应用窗口测试待用户执行。
- 工作分支：`codex/mcp-candidate-evaluation`。
- 技术边界：[ADR-0052](../adr/0052-bundled-github-mcp.md)；实施状态只看 [CF 任务板](../development/tasks-capability-foundation.md)。

## 历史回顾

此前已经选择并接入四个随应用分发的 stdio MCP：`filesystem`、`memory`、`sequential-thinking` 和 `fetch`。既有验收覆盖进程握手、工具发现、资源打包和离线准备，没有执行过真实业务工具调用。这轮在此基础上新增 GitHub 官方 MCP；Notion 和 Google Drive 暂未选择。

## 用户选择与接入范围

| MCP | 接入方式 | 真实测试边界 |
| --- | --- | --- |
| `filesystem` | 既有内置 stdio Node 服务 | 仅向服务配置用户指定目录；审阅工具后再测试读写影响 |
| `memory` | 既有内置 stdio Node 服务 | 对比其独立存储与 BetterWork Memory 的使用效果 |
| `sequential-thinking` | 既有内置 stdio Node 服务 | 测工具发现与真实 Run 中的调用是否有实际帮助 |
| `fetch` | 既有内置 stdio Python 服务 | 与 BetterWork `web_fetch` 重叠，比较正文获取和来源记录 |
| GitHub | 新增官方 GitHub MCP Server v2.0.2，固定 SHA 的 macOS arm64 stdio 可执行文件 | 只读启动；使用加密机密变量 `GITHUB_PERSONAL_ACCESS_TOKEN`，建议仅授予测试仓库读取权限；真实 Run 由用户执行 |

候选顺序与入选理由：GitHub 能补 CF33 缺少的真实 stdio 服务；其余四项已实现但尚未做真实业务工具测试。`memory`、`fetch`、`filesystem` 分别与 BetterWork Memory、`web_fetch` 和文件读取能力存在重叠，测试时应关注实际工作收益；这不改变用户本轮选入范围。

## 安全与运行边界

- GitHub MCP 的 `--read-only` 由 Main 启动器强制追加，连接参数不能覆盖。连接默认仍为未启用、未授权工具。
- PAT 通过已有机密环境变量机制加密保存，运行时只注入本地 MCP 子进程。不要把 Token 写入普通环境变量、参数、Issue 或聊天记录。
- 不启用 GitHub 本地 OAuth：GitHub server 的 OAuth Token 只保留在进程内存，而 BetterWork 每个 Run 使用独立 MCP 进程；PAT 由 BetterWork 的受保护存储跨 Run 提供。
- `--read-only` 仅关闭 MCP 写工具，不是 OS 沙箱；PAT 权限仍需按测试范围最小化。
- 连接检测只发现工具，不调用业务工具。工具需先审阅、允许并选择，再由用户发起真实 Run。

## 用户测试步骤

1. 在 worktree 根目录运行 `npm run github:mcp:prepare --workspace @betterwork/desktop`，准备已锁 SHA 的 GitHub 可执行文件；首次准备需要网络。
2. 注意：仓库的 `scripts/dev-start.sh` 会停止旧的 BetterWork 开发实例，并使用系统默认的 BetterWork 用户数据目录。准备好切换实例后，按交接说明从该 worktree 启动；在设置 → MCP 复用/检测已有四项连接，再新建 GitHub 连接。
3. GitHub 连接在机密环境变量中设置 `GITHUB_PERSONAL_ACCESS_TOKEN`。`filesystem` 连接填写测试目录作为服务参数；其余服务按各自配置进行检测。
4. 检测后审阅服务合同；只允许并选择测试目标需要的工具，再完成一次真实 Run。
5. 记录 Run、ToolCall、Evidence、取消/错误和 Token 轮换情况；GitHub 的真实业务验收通过后，更新 CF33/CF43 和本记录。

## 本轮已知证据与未做事项

GitHub 官方 v2.0.2 release 提供 `Darwin_arm64` 归档。归档 SHA-256 与官方 release 元数据一致：`5d9b38511bffc84d2272eb6189129eb721c8900e45784d8ea7eaf25f8d3dd835`；归档含可执行文件和 MIT 许可证。代码增加了打包准备脚本、设置选项与只读/PAT 运行边界。

本轮没有启动 GitHub MCP、没有配置真实 Token、没有调用 GitHub 工具，也没有启动 BetterWork 窗口或执行 MCP 功能测试。文档结构护栏 156 项、TypeScript typecheck、定向 ESLint 和 Prettier 检查通过。因此 CF33 和 CF43 仍保持 `partial`，真实验收留给用户。

## 官方资料

- [GitHub MCP Server v2.0.2 release](https://github.com/github/github-mcp-server/releases/tag/v2.0.2)
- [GitHub MCP server configuration](https://github.com/github/github-mcp-server/blob/v2.0.2/docs/server-configuration.md)
- [GitHub MCP local OAuth login](https://github.com/github/github-mcp-server/blob/v2.0.2/docs/oauth-login.md)
