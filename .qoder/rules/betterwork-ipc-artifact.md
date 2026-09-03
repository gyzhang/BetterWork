---
trigger: model_decision
description: 新增或修改 IPC、协议、channel、Zod Schema、持久化、Artifact、ArtifactVersion、Evidence 相关工作时加载
---

# IPC 协议与持久化纪律

协议唯一入口：`packages/agent-protocol/src/index.ts`（跨进程协议、领域类型、Zod Schema、IPC channel 的唯一定义处）。

## 依赖方向（不可破坏）

    Renderer -> Preload API -> Application -> Agent Core / Infrastructure
                                          -> Tool Runtime

- Agent Core 不导入 Electron、React、SQLite Repository 或具体模型厂商 SDK；Renderer 不直接访问 Node.js、文件系统、数据库或模型服务。
- Preload 只暴露最小、类型化 API，保持 `contextIsolation: true`、`nodeIntegration: false`。
- **新增 IPC 必须先在 agent-protocol 定义输入/输出 Schema 与 channel，再实现**，边界用 Zod 校验。

## 执行与持久化

- 一次执行的稳定标识是 `runId`；禁止用字符串拼接冒充 Task / Session / Run / Message 关系。
- Agent Core 通过 `AsyncIterable<AgentRuntimeEvent>` 输出有序事件；不使用全局 EventEmitter 作为核心协议。
- Application 层**先持久化，再广播**；UI 不是事件的唯一消费者。
- SQLite（`apps/desktop/src/main/run-journal.ts`）是产品状态真相源；缓存、索引和预览必须可重建。

## Artifact 版本

- Artifact 的任何修改必须产生新的 ArtifactVersion，不覆盖旧版本；人工改动标记为 `user-edit`，不得伪装为 AI Run 结果。
- AI 版本关联该 Run 实际使用的 Evidence；人工修订继承前一版本的来源关系（见 [ADR-0005](../../docs/adr/0005-artifact-version-evidence.md)）。
- 当前不自动在正文伪造引用标记；未来的 Claim/Citation 与人工来源编修留给完整研究工作流显式设计。
