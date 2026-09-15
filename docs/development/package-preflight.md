# macOS arm64 本地打包预检

- 日期：2026-09-15
- 命令：`npm run build && npx electron-builder --dir --mac`
- 配置：`apps/desktop/electron-builder.yml`
- 输出：`apps/desktop/dist/mac-arm64/BetterWork.app`
- 包大小：478M
- `Contents/Resources/app.asar` SHA-256：`c9b9ffab30cd154b51ffd50925679b370c3b38724ea6e9e782659697ce83887f`
- 有效配置：`apps/desktop/dist/builder-effective-config.yaml`，SHA-256 `87a751dbc2e53d49f17d96b8bd336da9e287fe15e5429766c5b988036ae4a371`

## 包内资源

`Contents/Resources` 只包含应用运行资源和以下受控制品：

- `experts/release-manifest.json`
- `skills/sample-assistant/SKILL.md`
- `skills/business-analysis/SKILL.md`
- `skills/release-manifest.json`
- `dependency-locks/ppt-generation-expert-darwin-arm64-cp312.json`
- `fonts/SourceHanSansSC-Regular.otf`

使用 `asar list` 和资源目录扫描确认，包内没有 `artifact-files`、`betterwork.db`、`.env`、`.git`、`Downloads`、`ppt-master`、用户模板或 `/Users/kevin/Dev4AI`、`/Users/kevin/Library` 等开发机绝对路径。

## 边界

- 本次是 unpacked 静态包预检，没有安装或启动安装包，也没有把构建产物提交到 Git。
- electron-builder 明确报告 `0 valid identities found` 并跳过 macOS 代码签名；Developer ID 安装验收仍属于 A21 的外部条件。
- 受管 Python 制品、wheelhouse 许可清单和冷环境依赖准备尚未随包实测；A20 继续保持 `doing`。
