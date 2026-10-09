# ADR-0045：本地 MCP 使用随应用分发的运行时

- 状态：Accepted（2026-10-09；用户明确要求安装后即可使用内置 MCP/CLI/Skill/Expert，尽量不要求用户安装 Node.js、Python 或联网下载运行时，并授权继续实现）。
- 延续：[ADR-0036](0036-macos-only-platform-scope.md) 的 macOS arm64 产品范围、[ADR-0043](0043-mcp-multi-transport-and-oauth.md) 的连接与生命周期、[ADR-0044](0044-mcp-explicit-side-effect-tool-authorization.md) 的工具授权。
- 影响范围：为产品登记的本地 stdio MCP 提供内置启动描述，并让共享 `SkillDependencyService` 使用安装包中的 CPython 3.12.14 基础制品。满足该解释器版本要求的受管 Python Skill/CLI 各自仍使用独立依赖锁与 venv；用户自定义命令、远程 MCP 及未随包登记的外部 CLI 继续遵循各自既有配置和依赖契约。

## 背景

Electron 应用内有 Node.js 运行时，但不等同于为系统提供 Node.js/npm/npx 命令。现有三个 Node stdio MCP 通过 `npx` 启动，Python fetch MCP 通过 `uvx` 启动；因此干净用户环境仍会依赖外部运行时、包管理器与联网下载。PPT Skill 已有 CPython 3.12.14 受管候选和独立依赖锁，但 Python 发行包仍在首次准备时下载，且 PPT wheelhouse 不含 MCP fetch 的依赖闭包。

## 决策

1. 内置 Node MCP 由应用锁定版本并作为生产依赖打包。Main 使用当前 Electron 可执行文件 `process.execPath` 配合 `ELECTRON_RUN_AS_NODE=1` 启动包内服务入口；只对该受管子进程设置此变量。用户自定义 stdio 仍使用其保存的可执行文件和参数。
2. 内置 Python fetch MCP 使用锁定的 CPython 3.12.14 darwin/arm64 发行包、精确哈希的依赖锁和随应用分发的 wheelhouse。首次运行在用户数据目录提取基础解释器，并用现有 `SkillDependencyService` 准备独立 venv；不复用 PPT Skill venv 或系统 Python。该服务也为使用同一基础版本的 Python Skill/CLI 复用 CPython 制品；每套依赖锁仍隔离安装。
3. 安装包构建阶段下载或复用固定 URL 的运行时制品，并逐项校验登记的 SHA-256；用户安装包默认可离线完成上述首次准备。开发/安装包缺少制品时，才允许用已登记 URL 下载，下载结果仍逐项校验。哈希不匹配必须失败，不得运行未经校验的内容。
4. 协议使用显式内置 server ID 区分内置 MCP 与用户命令。只有迁移能精确识别的 `npx -y @modelcontextprotocol/...` 与 `uvx mcp-server-fetch` 配置才映射到内置 ID；未知命令原样保留。
5. v46 为精确识别的旧连接追加不可变 revision，旧 revision 与运行历史保留，新目录标记为未检测；不复制旧 revision 的工具审阅或授权。连接启停状态、专家/任务选择与工具审阅继续由用户决定。
6. 内置服务仍是本地子进程，继承有限环境并受 guardian 取消/收尾；本地权限不因打包而成为 OS 沙箱。安装包不自动启用新连接、不代用户允许工具。
7. 当前仅构建 macOS arm64 产品制品。其他平台的 Python 候选与 Electron 打包目标不纳入本决策。

## 取舍

共享 Electron Node 能免去用户另外安装 Node，但仅限 Electron 启动的受管进程，不能当作系统 Node/npm 使用。Python 发行包与 fetch wheel 会增加安装包体积和首次解压时间；换来的结果是受管环境不依赖用户系统配置或首次联网。隔离 venv 仍保留包锁、可重建和与 PPT 依赖分离的能力。明确 ID 和精确迁移避免把用户任意 `npx`/`uvx` 命令误认成内置服务。

## 兼容与验收

共享 stdio schema 新增内置运行时描述，旧的 `command/args/cwd/env` 仍作为自定义命令的兼容形状。必须验证 v45→v46 对已知四个服务保留连接 ID 和旧 revision、生成内置 revision、使新目录失效且不复制审阅；其他命令保持不变。自动化须覆盖无外部 Node/Python 的内置启动、CPython 与 wheel 的离线准备、哈希拒绝、取消和随包资源存在性。签名安装包冷启动与用户窗口验收另记在 CF43，不替代真实业务服务验收。
