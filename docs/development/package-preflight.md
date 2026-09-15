# macOS arm64 本地打包预检

- 日期：2026-09-15
- 命令：`npm run build && npx electron-builder --dir --mac`
- 配置：`apps/desktop/electron-builder.yml`
- 输出：`apps/desktop/dist/mac-arm64/BetterWork.app`
- 包大小：717,471,259 字节（约 684 MiB）
- `Contents/Resources/app.asar` SHA-256：`338e1277bdec87fc8302d5f71e1aded1301affda7060bc7c5a17c6a68b315da2`
- builder 预检记录：`apps/desktop/dist/builder-debug.yml`，SHA-256 `c556a94eb432df06057c1063a97abe274e01f91deb0f0ad57af95bb41fd33b2d`

## 包内资源

`Contents/Resources` 只包含应用运行资源和以下受控制品：

- `experts/release-manifest.json`
- `skills/sample-assistant/SKILL.md`
- `skills/business-analysis/SKILL.md`
- `skills/release-manifest.json`
- `dependency-locks/ppt-generation-expert-darwin-arm64-cp312.json`
- `wheelhouse/`：8 个锁定 wheel、`manifest.json` 许可/大小清单和 `README.md`，wheel 二进制合计 20,462,319 字节
- `fonts/SourceHanSansSC-Regular.otf`

使用 `asar list`、资源目录扫描，并将 `app.asar` 解包后对文本/脚本内容执行路径扫描确认，包内没有 `artifact-files`、`betterwork.db`、`.env`、`.git`、`Downloads`、`ppt-master`、用户模板或 `/Users/kevin/Dev4AI`、`/Users/kevin/Library` 等开发机绝对路径。逐个重算 wheelhouse 文件 hash，8 个 wheel 均与锁文件和 `manifest.json` 一致。

## 边界

- 本次是 unpacked 静态包预检，没有安装或启动安装包，也没有把构建产物提交到 Git。
- electron-builder 明确报告 `0 valid identities found` 并跳过 macOS 代码签名；Developer ID 安装验收仍属于 A21 的外部条件。
- 受管 Python 制品已按锁定 hash 完成 macOS arm64 真实下载、解压和 `3.12.14 / arm64 / Darwin / venv / ensurepip` 探测；随后用真实 `SkillDependencyService`、Node 文件系统/进程适配器和包内 wheelhouse 完成冷环境建 venv、8 个 wheel 离线安装和 import 探测，详见[依赖验证记录](dependency-verification.md) §2/§7。签名安装仍属于 A21 的外部条件。
