# 算台 BetterWork 开发指引

本文件是仓库内所有开发工作的持续约束。开始任何任务前先阅读本文件和与任务相关的 `docs/` 文档；实现与文档冲突时，先修正文档或新增 ADR，不得静默偏离。

## 1. 产品北极星

算台是面向知识工作者的个人 AI 工作台。

> 以我所知，成我所作。

核心价值是利用用户的资料、记忆与工作方法，完成研究、分析、文档与演示。聊天是协作入口，Artifact 是主要交付物。

参考项目及本机路径见 [docs/09-reference-projects.md](docs/09-reference-projects.md)。LobsterAI 用于参考产品 UI 和交互完成度，ClawBible Desktop 用于参考 Agent、工具、知识和 Office 工程实践；两者都不是 BetterWork 的直接代码依赖。

## 2. 当前阶段

Phase 0 教学链路与 UI Foundation 已完成。当前允许进入 `Phase 1：研究报告 MVP` 的第一条知识库垂直切片；范围以 `docs/07-mvp-and-roadmap.md` 为准。

本阶段允许实现：

- Electron Main / Preload / Renderer
- 类型化 IPC
- `AsyncIterable<AgentRuntimeEvent>` Agent Core
- Fake Model Provider 与一个 OpenAI-compatible Provider 接口
- Calculator Tool 与受 Workspace 限制的 Read Text File Tool
- 流式消息、工具调用卡片、取消执行
- SQLite Run Journal
- Execution Timeline
- 单元测试与最小端到端验证

本阶段不得扩张到：

- OpenClaw 兼容
- 编程 Agent 和代码仓库自动修改
- 多 Agent、通用 DAG、IM、定时任务、云同步
- 完整记忆、Office 和 Kit 实现
- 在没有真实产品需求前引入大型框架

当前 Phase 1 仅允许：Workspace / Task / Session 的最小持久化关系、本地 Markdown/Text 导入、源路径与哈希记录、SQLite FTS5 检索、只读 Knowledge Search Tool 及对应类型化 IPC/UI。PDF/Office 解析、Embedding、研究 Agent、Evidence 与 Artifact 仍须在后续切片单独实现。

## 3. 架构硬约束

依赖方向：

```text
Renderer -> Preload API -> Application -> Agent Core / Infrastructure
                                      -> Tool Runtime
```

- Agent Core 不得导入 Electron、React、SQLite Repository 或具体模型厂商 SDK。
- Renderer 不得直接访问 Node.js、文件系统、数据库或模型服务。
- Preload 只暴露最小、类型化 API；保持 `contextIsolation: true` 和 `nodeIntegration: false`。
- IPC channel、输入和输出必须在共享协议中定义，并在边界用 Zod 校验。
- 一次执行的稳定标识是 `runId`；不得用字符串拼接模拟 Task/Session/Run/Message 关系。
- Agent Core 通过 `AsyncIterable<AgentRuntimeEvent>` 输出有序事件，不使用全局 EventEmitter 作为核心协议。
- UI 不是事件的唯一消费者；Application Layer 先持久化，再广播。
- SQLite 是产品状态真相源；缓存、索引和预览必须可重建。
- 用户文件默认只读；任何修改未来都通过 ArtifactVersion 产生新版本。

## 4. 领域语言

代码和文档统一使用：

- Workspace：长期工作上下文
- Task：用户希望完成的工作
- Session：持续协作上下文
- Run：一次 Agent 执行
- Step：可持久化工作步骤
- ToolCall：一次原子工具调用
- Evidence：可回溯证据
- Artifact：可继续使用和版本化的工作成果
- Knowledge：用户拥有的资料
- Memory：协作形成的长期上下文和经验

不要用 Conversation、Session、Task、Run 互相代称。

## 5. 实现原则

- 优先完成端到端垂直切片，不堆积无法运行的抽象。
- 接口保持小而明确；避免 God Object、全局单例和隐式依赖。
- 业务状态使用可辨识联合类型，避免散落的字符串和 `any`。
- 先定义失败、取消、超时和恢复语义，再实现快乐路径。
- Tool 输入输出必须结构化并可测试。
- 数值计算交给确定性工具，模型不负责心算。
- 日志不得记录密钥；避免无必要记录完整文档内容。
- 不为了“以后可能需要”提前实现未进入路线图的系统。

## 6. UI 原则

- UI 实现以 `docs/10-ui-ux-system.md` 为设计真相源；变更核心信息架构或视觉语言时先更新文档。
- 借鉴 LobsterAI 的信息架构和产品完成度，不复制其 OpenClaw 结构。
- 界面服务于任务、过程与成果，不堆叠 AI 装饰。
- 展示计划、状态、工具、来源和产物，不展示模型私有思维链。
- 所有长操作必须有可见状态、取消入口和明确结果。
- 中文体验优先，同时保证内容区域可显示中英文材料。
- 过程信息按用户目标分组并渐进披露，原始运行事件不得作为默认主界面的视觉中心。
- Artifact 是一等界面对象；右侧上下文面板按场景出现且必须允许完全收起。
- 模型配置使用独立设置空间，不嵌入 Composer 或任务消息流。
- 正文和常规控件不得通过 9–10px 小字号换取空间；优先折叠、覆盖和响应式重排。
- 外观由 `system / light / dark` 模式与可扩展色系两个维度组成；每套正式色系必须同时提供浅色和深色 Variant。
- Renderer 组件只能使用语义化主题 Token，不得散落硬编码颜色或用局部 `.dark` 补丁绕过 Token 契约。
- 应用主题不得改变 Artifact 自身的文档、演示、表格或图表配色。

## 7. 代码质量

- TypeScript 开启 strict。
- 新增领域行为必须有单元测试。
- Agent 事件顺序、取消和工具失败必须有测试。
- 提交前至少执行：类型检查、单元测试、构建。
- 修复缺陷时优先添加回归测试。
- 不提交 `.env`、密钥、构建产物、数据库和本地工作文件。

## 8. 变更纪律

- 新增跨模块依赖、修改核心领域关系或替换关键技术时新增 ADR。
- 功能范围变化时同步更新 `docs/07-mvp-and-roadmap.md`。
- 产品语言变化时同步更新 README、产品定义和品牌文档。
- 保持提交聚焦；不混入无关格式化或重构。
- 不删除或覆盖用户已有改动；发现冲突先停下说明。

## 9. 完成定义

一个任务只有在以下条件满足时才算完成：

1. 行为符合当前 Phase 和相关文档。
2. 核心路径可运行。
3. 错误和取消路径可解释。
4. 类型检查与相关测试通过。
5. 必要文档已更新。
6. 没有遗留未说明的临时实现、密钥或生成文件。
