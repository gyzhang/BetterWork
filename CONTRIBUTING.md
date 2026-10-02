# 贡献指南

感谢你考虑为 BetterWork 做出贡献！本文档会指导你如何参与项目开发。

## 开始之前

### 了解项目

- 阅读 [AGENTS.md](AGENTS.md) 了解项目的产品定位、架构约束和开发纪律
- 阅读 [工程规范](docs/12-engineering-standards.md) 了解代码风格和质量要求
- 浏览 [路线图](docs/07-mvp-and-roadmap.md) 了解当前开发阶段和优先级

### 开发环境

BetterWork 是 macOS 专属的 Electron 桌面应用，开发需要：

- macOS (darwin/arm64)
- Node.js 24（LTS；版本真相源是 `.nvmrc`，CI 也读它，`engines.node` 下限 24.0.0）
- npm

克隆仓库后运行：

```bash
npm install
npm run verify  # 跑完整门禁：lint + typecheck + test + build + ui:check
```

## 如何贡献

### 报告 Bug

如果你发现了 Bug，请开一个 [Bug 报告 Issue](https://github.com/gyzhang/BetterWork/issues/new?template=bug-report.yml)，提供：

- 清晰的标题和描述
- 复现步骤
- 期望行为 vs 实际行为
- 环境信息（macOS 版本、应用版本）
- 如果可以，附上日志文件（`~/.betterwork/logs/` 或 `/tmp/betterwork-dev.log`）

### 提出新功能

有新想法？先开一个 [功能需求 Issue](https://github.com/gyzhang/BetterWork/issues/new?template=feature-request.yml) 讨论，避免重复劳动。

### 提交代码

#### 1. Fork 仓库

点击 GitHub 页面右上角的 "Fork" 按钮，创建你自己的副本。

#### 2. 创建分支

```bash
git checkout -b feature/your-feature-name
# 或
git checkout -b fix/issue-number-short-description
```

分支命名建议：
- 功能：`feature/xxx`
- 修复：`fix/xxx`
- 文档：`docs/xxx`
- 重构：`refactor/xxx`

#### 3. 开发和提交

**写代码前**：

- 阅读 [AGENTS.md](AGENTS.md) 里的任务路由表，找到对应类型必读的文档
- 阅读 [工程规范](docs/12-engineering-standards.md) 的相关小节
- 如果使用 Qoder 或 Codex，确保 AI 读取了 `AGENTS.md` 和 `.qoder/rules/`

**提交前**：

```bash
npm run verify  # 必须全绿
```

**提交信息格式**：

```
type(scope): 简短描述

详细说明（可选，解释为什么做这个改动）

Fixes #123  # 如果修复了某个 Issue
```

类型：
- `feat`: 新功能
- `fix`: 修复 Bug
- `docs`: 文档更新
- `style`: 代码格式（不影响逻辑）
- `refactor`: 重构（不是新功能也不是修复）
- `test`: 添加或修改测试
- `chore`: 构建、依赖、工具链

示例：

```
feat(knowledge): 支持 PDF 文档导入

添加 PDF 解析和索引能力，用户可以导入本地 PDF 文件到知识库。
使用 pdf-parse 库提取文本，走现有的 Knowledge 索引流程。

Fixes #42
```

#### 4. 推送到你的 Fork

```bash
git push origin feature/your-feature-name
```

#### 5. 开 Pull Request

在 GitHub 上从你的 Fork 开 PR 到主仓库的 `main` 分支。

**PR 描述要求**：

- 清晰描述这个 PR 做了什么
- 如果是修复 Bug，说明如何复现和验证
- 如果有 UI 改动，附上截图
- 列出相关 Issue 编号（用 `Fixes #123` 或 `Relates to #456`）

**PR 检查清单**：

- [ ] `npm run verify` 全绿
- [ ] 新增功能有对应的测试
- [ ] 修复的 Bug 有回归测试
- [ ] 文档已更新（如果适用）
- [ ] 没有引入新的 lint 警告
- [ ] 提交信息清晰，说明了"为什么"

#### 6. Code Review

PR 开出来后，至少需要一位核心成员 Review。Reviewer 可能会：

- 提出修改建议
- 询问设计决策
- 要求补充测试或文档

保持沟通，及时响应反馈。

## 代码规范

### 核心原则

- **TypeScript strict**：禁止 `any`、`!` 非空断言
- **单一规范源**：[工程规范](docs/12-engineering-standards.md) 是唯一标准
- **测试覆盖**：新增行为必须有单元测试
- **错误处理**：所有异步操作必须有明确的失败处理

### 关键约束

- Agent Core 不得导入 Electron、React、SQLite
- Renderer 不得直接访问 Node.js、文件系统
- IPC 必须在共享协议中定义，用 Zod 校验
- Schema 变更必须走版本化迁移
- 只支持 macOS (darwin/arm64)，不为其他系统写兼容代码

详细规则见 [工程规范](docs/12-engineering-standards.md) 和 `.qoder/rules/`。

### 验证

提交前必须跑：

```bash
npm run verify
```

这会检查：
- ESLint（代码风格）
- Prettier（格式化）
- TypeScript（类型检查）
- Vitest（单元测试）
- 构建（确保能打包）
- UI 检查（渲染质量）

## 开发流程

### Issue 驱动

所有工作都应该有对应的 Issue：

1. 开 Issue 描述问题或需求
2. 讨论并确认方案
3. 认领任务（在 Issue 下评论 "I'll work on this"）
4. 开发、测试、开 PR
5. Review、合并、Issue 自动关闭

### 分支策略

- `main` 是稳定分支，始终可运行
- 所有开发在 feature/fix 分支上进行
- PR 合并后删除分支

### CI/CD

每次 push 和 PR 都会触发 GitHub Actions：

- 在 macOS runner 上跑 `npm run verify`
- 失败时上传 UI 检查截图和读数
- 只有 CI 通过的 PR 才能合并

## 获取帮助

- 有问题？在 [Discussions](https://github.com/gyzhang/BetterWork/discussions) 提问
- 发现 Bug？开 [Issue](https://github.com/gyzhang/BetterWork/issues)
- 需要讨论设计？在相关 Issue 下评论

## 行为准则

- 尊重所有参与者
- 专注于技术讨论，不进行人身攻击
- 接受建设性批评
- 以社区利益为重

## 许可证

贡献的代码将遵循项目的开源许可证。

---

感谢你的贡献！🎉
