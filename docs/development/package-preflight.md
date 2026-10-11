# macOS arm64 本地打包预检

## 版本来源

产品版本唯一来源是仓库根 `package.json` 的 `version`。当前为 `1.1.0`。调整版本时只改此处，再运行 `npm run version:sync`；开发、构建、预览、打包和测试入口会自动同步桌面应用清单与 `package-lock.json`。运行 `npm run version:check` 可显式核对。electron-builder、MCP client info 和 DMG 文件名均从应用版本派生。

## 当前人工验证包

- 平台：macOS arm64。
- 构建命令：`npm run dist:mac --workspace=@betterwork/desktop`。
- 文件：`apps/desktop/dist/BetterWork-1.1.0-arm64.dmg`，323,830,831 字节。
- SHA-256：`ce68c7f803f9fa71010e62257a6d52718fe42be7c2df244cf339f330544688d8`。
- Bundle ID：`dev.betterwork.desktop`；`CFBundleShortVersionString` 和 `CFBundleVersion` 均为 `1.1.0`。
- `hdiutil verify` 校验有效；只读挂载包含 `BetterWork.app` 与 Applications 链接。应用 Resources 中没有 `.db`、`.sqlite` 或 `.sqlite3` 文件，也没有随包 SQLite 模板库。

## 随包运行时与空库初始数据

- 受管 CPython 3.12.15（release 20261009）与 Node.js 24.21.0 / npm 11.19.0；目标二进制为 arm64。Python 资源共 44 项并逐项通过哈希校验。
- 应用完成 schema migrations 后，只有空 Workspace 库会幂等登记「默认工作空间」并创建 `~/BetterWork`；已有 Workspace 的默认路径和身份保持原样。

## 验证范围与限制

主线重放前，版本同步与核对、`npm run typecheck`、相关功能测试 19/19、`npm run docs:check` 155/155、定向 ESLint/Prettier、`npm ls --depth=0` 和 `git diff --check` 通过。重放到最新 `origin/main` 后重新完成应用生产构建与 DMG 校验、只读挂载检查；重放后的 PR Gate 将核验当前代码提交。

本机没有 Developer ID，构建跳过代码签名。本轮未从 DMG 安装或启动应用，完整 `npm run verify` 未运行；安装、启动和产品功能由后续人工测试验证。
