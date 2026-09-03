---
trigger: model_decision
description: 启动应用、停止应用、调试、运行开发环境、构建、验证、提交代码、打包发布时加载
---

# 应用启停、验证与提交纪律

## 启停（只用脚本）

    bash scripts/dev-start.sh   # 启动：先准确停止旧的开发实例，再写 PID
    bash scripts/dev-stop.sh    # 停止：按 PID 文件精确停止

- 开发日志固定在 `/tmp/betterwork-dev.log`。
- **禁止绕开脚本直接启动 Electron，禁止 `pkill -f electron` 等宽泛进程匹配**——那会误杀用户的其他 Electron 应用；必要时按 PID 并用 lsof 校验工作目录后再操作。
- 生产构建存在两条来自 Zod 的 Rollup `@PURE` 注释警告，属已知警告；构建成功即通过，**不得因此作无关依赖升级**。

## 提交前最低验证

    npm run typecheck
    npm test
    npm run build
    git diff --check

## 提交纪律

- 每次开始先 `git status --short`；工作树中的既有改动属于用户，不得删除、覆盖或夹带进无关提交。
- 每个提交聚焦一件事；必要的测试、文档与 ADR 和实现放在同一变更中。
- 禁止提交：`.env`、API Key、SQLite/数据库文件、构建产物、用户资料、本地工作文件。
- 产品范围、数据迁移策略或安全边界不明确时，先停在文档 / ADR 层澄清，不把猜测固化为实现。

## 密钥

- `model_profiles.api_key` 存于本地 SQLite；日志、错误消息、测试输出**绝不打印密钥**。如未来引入系统钥匙串，先新增 ADR 并设计迁移。
