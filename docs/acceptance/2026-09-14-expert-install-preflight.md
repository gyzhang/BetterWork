# 专家安装资源预检记录

- 日期：2026-09-14
- 范围：E56 的资源、打包和打包 App 启动冒烟；不是完整业务验收。
- 环境：macOS arm64，Node.js 26.8.1，electron-builder 25.1.8，Electron 44.1.1。

## 已验证

1. `npm run expert:preflight` 通过：仓库内 1 个内置专家、2 个内置 Skill 的清单结构、资源目录、Skill 内容 hash 和专家 Skill 引用均匹配；`electron-builder.yml` 包含 `skills/`、`experts/` 与 `dependency-locks/` 的复制规则。
2. `npm run dist:mac --workspace @betterwork/desktop` 退出码为 0，生成 arm64 与 x64 DMG 及对应 App 目录。构建日志确认 `resources/skills`、`resources/experts`、`resources/dependency-locks` 已进入安装资源目录。
3. `npm run expert:preflight -- --packaged-root apps/desktop/dist/mac-arm64/BetterWork.app/Contents/Resources` 与 x64 对应路径 `apps/desktop/dist/mac/BetterWork.app/Contents/Resources` 均通过，分别验证了两种架构打包后的清单、Skill 目录和内容 hash。
4. 挂载 arm64 DMG 后，把其中的 `BetterWork.app` 复制到临时安装目录并启动；打包副本的 macOS 可访问性树显示：专家列表 →“研究分析专家”→“召唤”→工作输入框，并显示“当前专家”。路径没有“返回任务准备”或启动前配置表单；窗口可正常关闭。
5. 在修复内置 Skill 启动幂等后连续启动两次开发 App，SQLite 中两个内置 Skill 均保持 1 个 revision，第二次启动没有新增 revision 或 active grant（历史重复 grant 仍保留，未在用户库中做破坏性清理）。

## 限制与后续

- 本机没有 Developer ID Application 证书，构建日志明确记录 App 未签名；本记录不能替代签名 DMG 的安装、升级和 Gatekeeper 验收。
- 本次执行的是 DMG 挂载后复制到临时目录的安装冒烟，没有把 DMG 拖入 `/Applications`，也没有覆盖升级旧版本的用户数据保留测试。
- E55 的真实公司材料、网页正文、MCP、取消/重启及连续两期人工旅程仍未完成；当前只有脱敏合成数据的自动化证据，详见[两期验收记录](2026-09-14-expert-two-periods.md)。
- `dist/` 仅为本次本地验证生成，已在提交前清理，不进入 Git。

## 2026-09-15 资源复核

- `npm run expert:preflight` 重新通过：1 个内置 Expert、2 个内置 Skill，清单、内容哈希和 builder 资源规则均匹配。
- 本次只复核静态发布资源，没有把锁屏状态下无法执行的安装/业务窗口验收记为通过。

## 2026-09-15 资源路径泄漏预检补强

- `expert-release-preflight` 现在对 `skills/`、`experts/` 和 `dependency-locks/` 资源扫描仓库/用户目录绝对路径，并拒绝 Skill manifest 的资源路径逃逸。
- 正常资源预检通过；临时打包副本注入 `/Users/kevin/Dev4AI/BetterWork` 后按预期失败。该检查不能替代真实签名安装和升级旅程。

## 2026-09-15 签名校验入口

- `expert-release-preflight` 新增 `--signed-app <path/to/BetterWork.app>`，在 macOS 上调用 `codesign --verify --deep --strict`，将签名校验纳入同一发布预检入口；不带该参数时仍只校验资源，便于开发态使用。
- 本机用不存在的 `.app` 路径验证参数失败诊断；当前没有 Developer ID 身份，待生成签名 App 后再执行成功路径。该入口不会把未签名构建误报为可安装发布。

## 2026-09-15 模型显示改动后的打包复核

- `npm run dist:mac --workspace @betterwork/desktop` 通过，重新生成 arm64/x64 DMG 与 App 目录；构建日志仍明确记录未找到 Developer ID Application 身份并跳过签名。
- 对 `apps/desktop/dist/mac-arm64/BetterWork.app/Contents/Resources` 与 x64 对应目录分别运行 `npm run expert:preflight -- --packaged-root ...`，两者均通过：1 个内置 Expert、2 个 Skill，清单、内容 hash、资源路径和 builder 资源规则匹配。
- `codesign --verify --deep --strict` 未通过：arm64 报告代码签名声明资源但没有资源，x64 报告代码对象完全未签名。签名安装、Gatekeeper 和升级保留仍未验收；本次 `dist/` 已在提交前清理。

## 2026-09-15 签名身份复核

- `security find-identity -v -p codesigning` 返回 `0 valid identities found`；当前没有可用于 `--signed-app` 成功校验的 Developer ID 身份。
- 资源预检仍可独立通过；签名安装、Gatekeeper 与升级保留继续保持未验收。

## 2026-09-15 验收预检入口

- 新增 `npm run expert:acceptance-preflight`：可独立检查模型端点与 macOS 代码签名身份，支持跳过其中一项但禁止两项同时跳过；CLI 使用本地 HTTP 替身覆盖成功、不可用端点和参数边界。
- 当前机器的签名身份检查仍返回 0 个有效身份；E56 签名安装、Gatekeeper 和升级保留继续保持未验收。
