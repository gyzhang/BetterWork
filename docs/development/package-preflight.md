# macOS arm64 本地打包预检

## 版本来源

产品版本唯一来源是仓库根 `package.json` 的 `version`。当前为 `1.2.0`。调整版本时只改此处，再运行 `npm run version:sync`；开发、构建、预览、打包和测试入口会自动同步桌面应用清单与 `package-lock.json`。运行 `npm run version:check` 可显式核对。electron-builder、MCP client info 和 DMG 文件名均从应用版本派生。

## 当前人工验证包

> 本记录对应 2026-10-15 13:44 构建的安装包，早于首批内置研究与汇报资源重新纳入。当前任务分支源码已登记 1 个 Expert 和 1 个 Skill；尚未基于该分支重建安装包。

- 平台：macOS arm64；2026-10-15 按空白 Skill/Expert 发布策略重新构建。
- 构建命令：`npm run dist:mac --workspace=@betterwork/desktop`。
- 文件：`apps/desktop/dist/BetterWork-1.2.0-arm64.dmg`，323,898,525 字节。
- SHA-256：`3ecf5b52b703caa139befa73c0875c264a2bf1f7d9600cd14513431c636d5b6d`。
- Bundle ID：`dev.betterwork.desktop`；`CFBundleShortVersionString` 和 `CFBundleVersion` 均为 `1.2.0`。
- DMG 安装背景提供 540×380 与 1080×760 Retina 两种分辨率，展示「算台 BetterWork」与「以我所知，成我所作」，保留标准拖放位置。
- `hdiutil verify` 校验有效；只读挂载检查了实际镜像。两份资源发布清单均为空，Skill/Expert 资源目录只含各自的 `release-manifest.json`，`app.asar` 不含已移除的三个样本 ID。镜像中的应用已复制到本机 Applications。

## 随包运行时与空库初始数据

- 2026-10-15 用户确认当前 Skill/Expert 发布清单为空，源码与安装包移除两个 Skill 样本和一个 Expert 定义。新库的技能页和专家页为空，未来内容按用户选择另行纳入发布清单。
- 受管 CPython 3.12.15（release 20261009）与 Node.js 24.21.0 / npm 11.19.0；目标二进制为 arm64。Python 资源共 44 项；本次构建复用并校验资源，下载 0 项。
- 应用完成 schema migrations 后，只有空 Workspace 库会幂等登记「默认工作空间」并创建 `~/BetterWork`；已有 Workspace 的默认路径和身份保持原样。
- 安装包不携带 SQLite 模板库；当前测试库在备份后定向移除两个 Skill 和一个 Expert，修订、运行描述、偏好和信任记录均清空，保留默认工作空间与运行设置，完整性和外键检查通过。

## 验证范围与限制

任务基线为 `6bf894f98537fd38e6125e5c5e3182300d3ad273`。发布与服务定向回归四文件 43 项通过；`npm run check:quick -- --base origin/main` 的 lint、差异格式、类型、文档 156 项、发布预检、实际清单消费者和相关行为测试通过，各阶段用例有重叠，不相加。构建、DMG 校验和挂载后的资源预检通过；源码与安装镜像均为 0 Skill、0 Expert。

本机没有 Developer ID，构建跳过代码签名。该包对应源码基线与安装镜像均为 0 Skill、0 Expert；三个内置 Node MCP 仍存在 `app.asar` 脚本入口被独立 Node 读取时的 `MODULE_NOT_FOUND` 问题，本次只清理发布内容，未修复该运行时问题。该安装包尚未执行真实 UI 走查，完整 `npm run verify` 未运行；后续功能仍由用户人工验收。
