# 系统架构

## 1. 目标

系统既要适合教学，也要支持未来扩展为成熟知识工作台：

- 内核与 UI 解耦
- 事件和数据关系清晰
- 支持长任务与失败恢复
- 支持多种模型和工具后端
- 支持 Office 与数据处理 Worker
- 支持 Skill、Expert、Kit 扩展
- 保持单一 Electron 主进程和单一产品状态源

## 2. 逻辑架构

```text
┌──────────────────────────────────────────┐
│ Renderer                                 │
│ Tasks / Chat / Evidence / Artifacts / UI │
└───────────────────┬──────────────────────┘
                    │ typed IPC
┌───────────────────▼──────────────────────┐
│ Preload                                  │
│ 最小、安全、类型化 Desktop API           │
└───────────────────┬──────────────────────┘
                    │
┌───────────────────▼──────────────────────┐
│ Electron Main / Application Layer        │
│ Workspace / Task / Run / Permission      │
└───────┬───────────────┬──────────────────┘
        │               │
┌───────▼────────┐ ┌────▼─────────────────┐
│ Agent Core     │ │ Infrastructure       │
│ Loop / Events  │ │ SQLite / Files / MCP │
│ Context / Plan │ │ Models / Indexes     │
└───────┬────────┘ └────┬─────────────────┘
        │               │
┌───────▼───────────────▼─────────────────┐
│ Tool Runtime / Worker Runtime           │
│ TypeScript / Python / MCP / Desktop     │
└─────────────────────────────────────────┘
```

## 3. 建议目录

```text
BetterWork/
├── apps/
│   └── desktop/
│       ├── src/main/
│       ├── src/preload/
│       └── src/renderer/
├── packages/
│   ├── agent-core/
│   ├── agent-protocol/
│   ├── application/
│   ├── tool-runtime/
│   ├── model-provider/
│   ├── knowledge/
│   ├── memory/
│   ├── artifacts/
│   ├── persistence/
│   └── shared/
├── workers/
│   └── python/
├── resources/
│   ├── skills/
│   ├── experts/
│   ├── kits/
│   └── templates/
├── examples/
└── docs/
```

教学阶段不要求一次创建所有 Package；可以先保持物理目录较少，但依赖方向必须遵守。

当前实现状态：仓库只有 `apps/desktop`（`src/main`、`src/preload`、`src/renderer`）与三个 package——`agent-protocol`、`agent-core`、`tool-runtime`。三个 package 通过 tsconfig `paths` 与 electron-vite alias 直接指向源码，不做预构建。

上图中的 Application Layer 目前没有独立 package，落在 `apps/desktop/src/main/`，并已按职责分层：`db/`（连接、PRAGMA、版本化迁移与各库 schema）、`persistence/`（按聚合拆分的 Repository 与组装它们的 `AppStore`）、`services/`（运行编排、通知、资料库、搜索服务商客户端、模型连通性探测）、`ipc/`（全部 channel 注册与边界校验）、`window.ts`（窗口构造与首帧主题常量），`index.ts` 只做装配与生命周期，不含业务逻辑。当出现第二个应用形态（CLI、Worker 宿主）需要复用这一层时，应把它整体提升为 `packages/application`；在那之前保持现状，不要为了对齐上图而提前建包。

`workers/`、`resources/`、`examples/` 与其余 package 均属后续阶段，当前不存在。

## 4. Agent Core

Agent Core 不允许直接导入：

- Electron
- BrowserWindow 或 IPC
- React
- SQLite Repository
- 具体模型厂商 SDK
- 具体文件选择器

现行接口（`packages/agent-core/src/types.ts`）：

```ts
interface AgentRunInput {
  runId: string;
  taskId: string;
  sessionId: string;
  prompt: string;
  workspacePath: string;
  messages?: AgentMessage[];
  model: ModelProvider;
  tools: AgentTool[];
  signal: AbortSignal;
  maxToolRounds?: number;
}

interface AgentEngine {
  run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
}
```

`workspacePath` 由 Application 层从 Workspace 注入，是 Tool 的文件系统沙箱边界来源；`messages` 用于携带既有历史，首版执行链路尚未把完整历史作为上下文传入；`maxToolRounds` 默认 8，超限以 `run.failed` 终止而不是静默截断。

使用 `AsyncIterable` 表达一次执行的顺序事件，便于取消、测试、多任务并发和在 CLI 中复用。

## 5. 运行时事件

第一版事件至少包括：

```text
run.started
run.status_changed
message.started
message.delta
message.completed
reasoning.delta
tool.requested
tool.started
tool.progress
tool.completed
tool.failed
approval.requested
approval.resolved
artifact.created
artifact.updated
evidence.added
run.waiting
run.completed
run.failed
run.cancelled
```

事件应有明确版本，并由 Application Layer 持久化。UI 订阅事件，但不能成为唯一消费者。

当前实现状态：`agent-protocol` 以 `type` 为判别式的 Zod discriminated union 定义了 13 种事件——`run.started`、`message.started`、`message.delta`、`message.completed`、`reasoning.delta`、`tool.requested`、`tool.started`、`tool.progress`、`tool.completed`、`tool.failed`、`run.completed`、`run.failed`、`run.cancelled`。

尚未实装的事件及其阻塞点：

- `run.status_changed`、`run.waiting`、`approval.requested`、`approval.resolved`：依赖确认点与审批语义，Tool Runtime 还没有 Policy 与审批层（见 §6）。
- `artifact.created`、`artifact.updated`、`evidence.added`：当前 Artifact 与 Evidence 的写入发生在 Application 层的请求-响应路径上，Renderer 通过重新拉取列表感知变化，没有走事件流。

事件 Schema 目前**没有版本号字段**；跨进程边界靠 Zod 校验保证形状一致。引入持久化事件版本策略时应新增 ADR，因为已落库的 `run_events.payload` 需要迁移方案。

## 6. Tool Runtime

Tool Runtime 统一处理：

```text
Schema 校验
→ Policy 检查
→ 用户审批（如需要）
→ 执行
→ 进度
→ 结果限制与结构化
→ Artifact/Evidence 登记
→ 审计记录
```

支持后端：

- TypeScript Tool
- Python Worker Tool
- MCP Tool
- Desktop Integration Tool

当前实现状态：只有 TypeScript Tool 一种后端，落地四个工具——`calculator`、`read_text_file`、`knowledge_search`、`web_search`。管线中已实装的是 Schema 校验（Zod）、执行、进度上报（`reportProgress`）与结构化结果；进度事件在 Tool 仍在执行时立即进入 `AsyncIterable`，取消信号同时传入 Tool 与联网搜索请求。Policy 检查、用户审批与审计记录尚未建设。

唯一强制的安全约束是 `read_text_file` 内建的 Workspace 路径边界（对真实路径校验，符号链接也不得越界）。Evidence 与 Artifact 的登记不在 Tool Runtime 内完成，而是由 Application 层（`RunService`）在观察到 `tool.completed` 事件后落库。

## 7. Python Worker

Python Worker 用于 Excel、数据分析、图表、复杂 Office 处理和 OCR 等生态明显优于 JavaScript 的场景。

边界要求：

- 使用版本化 JSON 协议通信
- Worker 不直接访问 UI
- 每次任务有明确 workspace 和临时目录
- 支持进度、取消和超时
- 输出文件必须由 ArtifactService 登记
- Python 不是 Agent Core 的必要依赖

## 8. 持久化

第一版使用 SQLite，建议表：

```text
workspaces
tasks
sessions
messages
runs
run_steps
tool_calls
artifacts
artifact_versions
evidence
model_profiles
app_settings
```

知识和记忆表见对应专题文档。

SQLite 是产品状态真相源；向量索引、缩略图和解析缓存均可重建。

当前实现状态：使用两个相互独立的 SQLite 文件。

应用状态库 `userData/betterwork.db`：`workspaces`、`tasks`、`sessions`、`runs`、`run_events`、`evidence`、`artifacts`、`artifact_versions`、`artifact_version_evidence`、`model_profiles`、`search_engine_configs`、`notifications`。

知识库 `userData/vaults/default/vault.sqlite`：`knowledge_documents`、`knowledge_chunks`、`knowledge_fts`（FTS5 虚表）。

与建议清单的差异：

- `messages`、`run_steps`、`tool_calls` 未建表。消息与工具调用目前以 `run_events` 的事件载荷形式持久化，可按 `sequence` 完整重放；Step 语义尚未落地（见 [领域模型](02-domain-model.md) §5）。
- `app_settings` 未建表。外观偏好（模式与色系）与侧栏折叠状态存放在 Renderer 的 `localStorage`，属于可重建的界面偏好而非产品状态；需要跨设备一致或被主进程读取的设置项应迁入该表。
- 表结构演进走 `db/` 下的版本化迁移：`schema_migrations` 记录已应用版本，迁移制度之前建立的历史库会被识别、对账到 v1 形状、打版本戳后继续走增量迁移，因此不会漏掉后续变更；补外键这类无法 `ALTER` 的变更按 SQLite 官方流程重建表，重建前按实际引用关系清掉历史孤儿行。每条迁移在打戳后、提交前执行 `foreign_key_check`，发现违反项即回滚，确保不会提交孤儿行。
- 已开启 `PRAGMA foreign_keys`，任务、运行、证据、成果与版本之间的级联删除真实生效；删除工作区会带走它的整棵子树。

## 9. 模型提供层

模型按能力角色配置：

- Language / Reasoning
- Vision
- Embedding
- Reranker
- OCR

优先提供 OpenAI-compatible 协议，同时保留 Provider Adapter，兼容公网、公司内网和本地服务。

当前实现状态：`model_profiles` 表支持 `language | vision | embedding` 三种角色，可保存、启用/停用、按角色设默认（以 `priority` 排序）并做真实连通性测试。只有 `language` 角色进入 Agent 执行链路，`vision` 与 `embedding` 仅完成配置层。

一个 ModelProfile 只承担一个角色；[UI/UX 体系](10-ui-ux-system.md) §11.4 提出的「同一模型可以承担多个角色」需要改动表结构，属后续切片。`reranker` 与 `ocr` 角色未落地。

Provider 侧现有 `FakeModelProvider`（教学，按前缀正则触发工具）与 `OpenAICompatibleProvider`（SSE 流式，支持 `reasoning_content` 与 `tool_calls` 增量拼接）。后者以 120 秒整体超时包住请求与流读取，要求 `[DONE]` 或服务端 `finish_reason` 作为完成信号；用户取消优先映射为 Run 取消，提前 EOF 作为失败处理。尚未抽象出独立的 Provider Adapter 层，新增非 OpenAI 兼容协议时需要先在 `agent-core` 增加实现。API Key 明文存于本地 SQLite，列表接口只回 `apiKeyConfigured`；迁移到系统钥匙串须先新增 ADR。

## 10. 前端

现行技术栈：

- Electron + electron-vite
- React + TypeScript strict
- 手写 CSS + 语义化主题 Token 变量（`renderer/src/styles.css`、`renderer/src/appearance.ts`）
- 自建内联 SVG 描边图标集（`renderer/src/icons.tsx`，`currentColor`、统一 24 网格）
- react-markdown（成果预览，不渲染原始 HTML）
- Zod（协议边界校验）
- Vitest（单元与集成测试）

明确不引入：

- Tailwind CSS、Radix UI 等样式与组件框架：视觉语言由 [UI/UX 体系](10-ui-ux-system.md) 的 Token 契约定义，引入原子化样式或第三方组件主题会与 Token 契约形成双真相源。
- Lucide 等通用图标库：界面图标必须服从统一网格与笔画粗细，并随色系以 `currentColor` 适配，自建图标集成本更低且可控。
- Zustand 等全局状态库：当前 Renderer 状态规模尚不需要；引入前应先出现真实的跨组件状态共享需求。

上述取舍以 [UI/UX 体系](10-ui-ux-system.md) 为设计真相源；该文档与本节冲突时以该文档为准。

端到端 UI 自动化（Playwright 或等价方案）尚未建设；当前改动核心用户路径时以单元测试加一次真实桌面验收兜底。

借鉴 LobsterAI 的信息架构、任务交互、Artifact 面板和视觉语言，但不复制其 OpenClaw 运行时与历史业务结构。

## 11. 可观测性

作为教学项目，应内置 Execution Timeline，能够查看：

- 运行事件
- 模型调用
- 工具调用
- 证据加入
- Artifact 版本
- Token、耗时和错误

默认日志不得记录 API Key；完整文档内容不应无必要写入普通日志。
