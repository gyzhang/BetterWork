---
trigger: model_decision
description: 新增或修改 IPC、协议、channel、Zod Schema、持久化、Artifact、ArtifactVersion、Evidence 相关工作时加载
---

# IPC 协议与持久化纪律

本文件是**速查复述**，不是第二份标准：每条句末括号里是它的唯一出处，与出处不一致时回到出处核对并同轮修好本文件。协议唯一入口：`packages/agent-protocol/src/index.ts`（跨进程协议、领域类型、Zod Schema、IPC channel 的唯一定义处，AGENTS.md §3、docs/12 §7）。

## 依赖方向（不可破坏）

    Renderer -> Preload API -> Application -> Agent Core / Infrastructure
                                          -> Tool Runtime

- Agent Core 不导入 Electron、React、SQLite Repository 或具体模型厂商 SDK；Renderer 不直接访问 Node.js、文件系统、数据库或模型服务。（AGENTS.md §3、docs/03 §2）
- Preload 只暴露最小、类型化 API，保持 `contextIsolation: true`、`nodeIntegration: false`。（AGENTS.md §3、docs/12 §7）
- **新增 IPC 必须先在 agent-protocol 定义输入/输出 Schema 与 channel，再实现**，边界用 Zod 校验。（AGENTS.md §3、docs/12 §7）

## 执行与持久化

- 一次执行的稳定标识是 `runId`；禁止用字符串拼接冒充 Task / Session / Run / Message 关系。（AGENTS.md §3、§4）
- Agent Core 通过 `AsyncIterable<AgentRuntimeEvent>` 输出有序事件；不使用全局 EventEmitter 作为核心协议。（AGENTS.md §3、docs/03 §4）
- Application 层**先持久化，再广播**；UI 不是事件的唯一消费者。（AGENTS.md §3、docs/03 §5）
- SQLite 是产品状态真相源：库与迁移在 `apps/desktop/src/main/db/`，按聚合拆分的 Repository 与 `AppStore` 在 `apps/desktop/src/main/persistence/`；缓存、索引和预览必须可重建。（AGENTS.md §3、docs/12 §2、§6、docs/03 §8）

## Artifact 版本

- Artifact 的任何修改必须产生新的 ArtifactVersion，不覆盖旧版本；人工改动标记为 `user-edit`，不得伪装为 AI Run 结果。（AGENTS.md §3、[ADR-0005](../../docs/adr/0005-artifact-version-evidence.md)）
- AI 版本关联该 Run 实际使用的 Evidence；人工修订继承前一版本的来源关系（见 [ADR-0005](../../docs/adr/0005-artifact-version-evidence.md)）。
- 当前不自动在正文伪造引用标记；未来的 Claim/Citation 与人工来源编修留给完整研究工作流显式设计，开工前先新增 ADR（[ADR-0005](../../docs/adr/0005-artifact-version-evidence.md)、AGENTS.md §8）。
