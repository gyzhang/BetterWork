# R14：macOS/arm64 平台路径整理

## 范围

实现代码重构 Review §9.2 的 R14：产品只支持 macOS/arm64，清除窗口和 Skill 依赖准备中的退役 Windows/Linux 执行分支，并在宿主及解释器边界明确拒绝其他平台。

## 变更与兼容边界

- 应用启动在初始化服务和数据库前检查宿主必须是 `darwin/arm64`，其他宿主得到明确错误。
- 窗口固定使用 macOS `hiddenInset` 标题栏；移除 Windows `titleBarOverlay`、标题栏符号颜色以及对应 IPC 传输字段。双击标题栏统一读取 macOS 系统偏好。
- Skill 依赖服务只创建 macOS arm64 的 `bin/python3` 环境；本地解释器、受管解释器、环境计划和依赖锁均在运行前校验平台。
- 持久化 `TargetPlatform` Schema 保留 `win32` / `linux` 的历史值，不改数据库迁移。旧记录仍可列出和读取；尝试解析可执行路径或复核环境时明确拒绝，并由既有校验流程标记为 `invalid`。
- 测试宿主夹具固定为 ADR-0036 的 `darwin/arm64`，不按当前机器动态构造跨平台测试路径。

## 验证

- functional 定向测试：3 个文件、69 项通过，覆盖平台谓词、Skill 执行环境绑定与 IPC 协议。
- heavy 定向测试：`skill-dependency-service.test.ts` 1 个文件、37 项通过，包含不支持解释器拒绝和历史 Windows 环境记录兼容回归。
- `npm run typecheck`、改动文件 ESLint 与 Prettier 检查通过。
- `docs:check` 1 个文件、154 项通过；最新源 PR Gate 与合并证据在任务收口后补记。

## 明确不变

不调整平台 Schema、SQLite 迁移、Python 制品清单、检索或 Skill 授权语义；不新增跨平台 runner 或兼容开关。
