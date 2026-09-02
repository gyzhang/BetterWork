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

## 4. Agent Core

Agent Core 不允许直接导入：

- Electron
- BrowserWindow 或 IPC
- React
- SQLite Repository
- 具体模型厂商 SDK
- 具体文件选择器

推荐接口：

```ts
interface AgentRunInput {
  runId: string;
  sessionId: string;
  prompt: string;
  messages: AgentMessage[];
  model: ModelProvider;
  tools: AgentTool[];
  signal: AbortSignal;
}

interface AgentEngine {
  run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
}
```

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

## 9. 模型提供层

模型按能力角色配置：

- Language / Reasoning
- Vision
- Embedding
- Reranker
- OCR

优先提供 OpenAI-compatible 协议，同时保留 Provider Adapter，兼容公网、公司内网和本地服务。

## 10. 前端建议

- Electron + electron-vite
- React + TypeScript strict
- Tailwind CSS
- Radix UI
- Lucide Icons
- Zustand
- Zod
- Vitest + Playwright

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

