# 专家安装资源预检记录

- 日期：2026-09-14
- 范围：E56 的资源、打包和打包 App 启动冒烟；不是完整业务验收。
- 环境：macOS arm64，Node.js 26.8.1，electron-builder 25.1.8，Electron 44.1.1。

## 已验证

1. `npm run expert:preflight` 通过：仓库内 1 个内置专家、2 个内置 Skill 的清单结构、资源目录、Skill 内容 hash 和专家 Skill 引用均匹配；`electron-builder.yml` 包含 `skills/`、`experts/` 与 `dependency-locks/` 的复制规则。
2. `npm run dist:mac --workspace @betterwork/desktop` 退出码为 0，生成 arm64 与 x64 DMG 及对应 App 目录。构建日志确认 `resources/skills`、`resources/experts`、`resources/dependency-locks` 已进入安装资源目录。
3. `npm run expert:preflight -- --packaged-root apps/desktop/dist/mac-arm64/BetterWork.app/Contents/Resources` 通过，验证了打包后的清单、Skill 目录和内容 hash。
4. 挂载 arm64 DMG 后，把其中的 `BetterWork.app` 复制到临时安装目录并启动；打包副本的 macOS 可访问性树显示：专家列表 →“研究分析专家”→“召唤”→工作输入框，并显示“当前专家”。路径没有“返回任务准备”或启动前配置表单；窗口可正常关闭。
5. 在修复内置 Skill 启动幂等后连续启动两次开发 App，SQLite 中两个内置 Skill 均保持 1 个 revision，第二次启动没有新增 revision 或 active grant（历史重复 grant 仍保留，未在用户库中做破坏性清理）。

## 限制与后续

- 本机没有 Developer ID Application 证书，构建日志明确记录 App 未签名；本记录不能替代签名 DMG 的安装、升级和 Gatekeeper 验收。
- 本次执行的是 DMG 挂载后复制到临时目录的安装冒烟，没有把 DMG 拖入 `/Applications`，也没有覆盖升级旧版本的用户数据保留测试。
- E55 的真实公司材料、网页正文、MCP、取消/重启及连续两期人工旅程仍未完成；当前只有脱敏合成数据的自动化证据，详见[两期验收记录](2026-09-14-expert-two-periods.md)。
- `dist/` 仅为本次本地验证生成，已在提交前清理，不进入 Git。
