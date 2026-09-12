# 领域模型

> 2026-09-08 产品关系补充：长期目录承接 Workspace，一个专家调用多项 Skill 持续完成任务，成果是持续协作对象。见 [ADR-0008](adr/0008-personal-workbench-and-capability-first.md)。本文接口仍需按实现状态阅读；配置快照、知识范围和持久化讨论节点的具体 Schema 待实现 ADR，不视为已落地。

> 2026-09-12 领域关系变更：Run 与 Skill 由 1:1 改为 1:N，命名为能力绑定，见 §4.1 与 [ADR-0012](adr/0012-composer-capability-binding.md)。该变更尚未实现。

## 1. 总览

```text
Workspace
├── Knowledge Vault
├── Workspace Memory
├── Task
│   ├── Conversation
│   │   └── Message
│   ├── Run
│   │   ├── Step
│   │   └── Tool Call
│   ├── Evidence
│   └── Artifact
│       └── Artifact Version
└── Assigned Experts / Skills / Kits
```

## 2. Workspace

Workspace 是长期工作上下文，而不只是文件目录。

示例：

- 一个客户
- 一个产品
- 一个项目
- 一个部门
- 一次市场研究
- 一个季度经营分析

主要属性：

```ts
interface Workspace {
  id: string;
  name: string;
  description?: string;
  rootPath: string;
  defaultExpertId?: string;
  knowledgeVaultIds: string[];
  enabledSkillIds: string[];
  enabledKitIds: string[];
  createdAt: number;
  updatedAt: number;
}
```

## 3. Task、Session 与 Conversation

- Task：用户希望完成的一项工作，有明确目标和交付物。
- Session：用户与算台围绕任务进行协作的连续上下文。
- Conversation：Session 中可见的对话记录。
- Message：用户、助手、系统、工具等产生的一条可持久化消息。

第一版可以让一个 Task 对应一个 Session，但 ID 和表结构应分开，避免长期绑定。

## 4. Run

Run 表示一次 Agent 执行，而不是一整段对话。

```ts
interface Run {
  id: string;
  taskId: string;
  sessionId: string;
  expertId?: string;
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  startedAt?: number;
  completedAt?: number;
  error?: string;
}
```

必须区分：

- `taskId`：用户要完成的工作
- `sessionId`：持续协作上下文
- `runId`：一次执行
- `messageId`：一条消息
- `toolCallId`：一次工具调用

不得通过拼接字符串表达这些关系。

当前实现状态：`status` 只落地 `running | completed | failed | cancelled`；`queued` 与 `waiting` 依赖尚未建设的审批/确认点语义（需要先在 `agent-protocol` 增加对应事件，见 [系统架构](03-system-architecture.md) §5）。`error` 以 `run.failed` 事件的形式持久化在 Run Event Journal 中，不是 `runs` 表的列。

### 4.1 能力绑定

Run 通过能力绑定使用 Skill。一个 Run 绑定 1–6 个 Skill，每个绑定是一次不可变快照：固定 Skill 修订、运行配置修订、环境、依赖快照与信任授权。绑定顺序即指令注入顺序。

```ts
interface CapabilityBinding {
  id: string;
  runId: string;
  skillRevisionId: string;
  profileRevisionId: string;
  environmentId?: string;
  dependencySnapshotIds: string[];
  grantId: string;
  createdAt: number;
}
```

约束：

- 绑定属于 Run，不属于 Task 或 Session。Task 的「当前绑定」由其最近一个 Run 的绑定集合推导，只用于界面呈现，不是独立存储的事实；不得存在界面上看不见、也撤不掉的隐式绑定。
- 任一绑定不满足启用、信任或依赖前置条件时整个 Run 不启动，不静默剔除后继续。
- 撤销信任或停用某个 Skill 会取消所有包含它的活跃 Run，即使它只是多个绑定中的一个。
- 运行期不增删绑定；调整绑定属于下一次 Run。

当前实现状态：`RunSkillBinding` 与 `run_skill_bindings` 表已按上述结构落地，表上 `run_id` 只有普通索引、无唯一约束，存储层天然支持一个 Run 多条绑定；`skill_read_resource` 与 `skill_execute` 的入参携带 `bindingId`，`AgentRunInput.skillInstructions` 是数组。应用层已按本节约束改造：`StartRunRequest.skillBindings` 是 1–6 项数组（顺序即注入顺序，重复 `skillId` 在 Schema 层拒绝），RunService 先整体校验前置条件再逐个建立快照，任一不合格则整个 Run 不启动且不留下任何绑定记录；工具桥接按模型传入的 `bindingId` 寻址，并先校验该绑定属于本 Run。「未显式指定时延续同 Task 最近一次绑定」的隐式继承连同其查询已删除。剩余缺口在界面：Composer 还没有能力选择入口，技能仍只能从 Skill 试运行带入，chip 条与 `+` 菜单见 [ADR-0012](adr/0012-composer-capability-binding.md)。

## 5. Step

Step 是持久化的工作步骤，用于表达长任务进度和恢复位置。第一版不是通用 DAG。

```ts
interface RunStep {
  id: string;
  runId: string;
  kind: string;
  title: string;
  status: "pending" | "running" | "waiting" | "completed" | "failed" | "skipped";
  input?: unknown;
  output?: unknown;
  startedAt?: number;
  completedAt?: number;
}
```

## 6. Artifact

Artifact 是用户可继续使用的工作成果。

```ts
type ArtifactType =
  | "research-report"
  | "spreadsheet"
  | "document"
  | "presentation"
  | "dataset"
  | "chart"
  | "markdown"
  | "pdf"
  | "image";

interface Artifact {
  id: string;
  workspaceId: string;
  taskId?: string;
  type: ArtifactType;
  title: string;
  currentVersionId: string;
  createdAt: number;
  updatedAt: number;
}
```

ArtifactVersion 保存：

- 文件路径或内容位置
- 来源版本
- 创建它的 Run/Step
- 使用的 Evidence
- 生成参数
- 内容 Hash
- 预览和缩略图
- 验证状态

ArtifactVersion 还必须携带 `origin`，用于区分成果版本的产生方式（见 [ADR-0005](adr/0005-artifact-version-evidence.md)）：

```ts
type ArtifactVersionOrigin = "assistant-run" | "user-edit";
```

`assistant-run` 必须关联真实 Run 并持久化该 Run 实际使用的 Evidence；`user-edit` 不得伪装为 AI 运行产物，并继承前一版本的来源关系。

当前实现状态：`ArtifactType` 只落地 `markdown`；ArtifactVersion 已实装内容、内容 Hash、`versionNumber`、`origin`、创建它的 Run（`sourceRunId`）与 Evidence 关联，预览以文档化 Markdown 渲染呈现。生成参数、缩略图和验证状态尚未实装。

## 7. Evidence、Claim 与 Citation

- Evidence：来自本地文档或外部信息源的可回溯证据。
- Claim：报告、分析或演示文稿中的一个事实或判断。
- Citation：Claim 对 Evidence 的引用表达。

```ts
interface Evidence {
  id: string;
  sourceType: "local-file" | "web-page" | "database" | "user";
  sourceUri: string;
  title?: string;
  locator?: string;
  excerpt: string;
  author?: string;
  publishedAt?: number;
  capturedAt: number;
  contentHash?: string;
}
```

`locator` 可以是页码、段落、Sheet 和 Range、Slide 编号或网页区块。

当前实装取值为 `local-file`（本地 Knowledge 检索结果）与 `web-page`（`web_search` 返回的网页引用）；`database` 与 `user` 为后续阶段预留。

## 8. Knowledge Vault

Knowledge Vault 是由用户管理的一组本地知识来源，具有独立索引和逻辑范围。

知识来源可以同时被多个 Workspace 引用，但默认不复制原始文件。

## 9. Memory Scope

记忆至少分为：

- User：跨 Workspace 的个人偏好
- Workspace：客户、项目或部门上下文
- Expert：某个专家积累的方法和经验
- Task：只对特定任务有效的上下文

## 10. Capability

Capability 是运行时可使用能力的统一抽象，来源包括：

- 内置 Tool
- Python Worker Tool
- MCP Tool
- Skill
- Kit 安装的能力

Skill 进入某次运行的唯一途径是能力绑定（§4.1）：启用与信任是 Skill 的全局状态，绑定才是本次运行的授权依据。

具体语义见 [能力体系](05-capability-system.md)。

## 11. Notification

Notification 是一次操作结果的可回溯通知，承担长操作的「明确结果」要素（见 [ADR-0006](adr/0006-notification-feedback.md)）。

```ts
interface Notification {
  id: string;
  level: "info" | "success" | "warning" | "error";
  kind: "run" | "knowledge-import" | "artifact" | "system";
  title: string;
  detail?: string;
  target?: NotificationTarget;
  read: boolean;
  createdAt: number;
}

type NotificationTarget =
  | { kind: "task"; taskId: string }
  | { kind: "artifact"; artifactId: string }
  | { kind: "knowledge" };
```

约束：

- `target` 是必填设计意图——没有跳转目标的通知无法回溯，条目点击后复用既有导航入口（最近任务、成果详情、知识页），不另造导航路径。
- Notification 由 Application 层先持久化再广播；Agent Core 不感知通知。
- 与 Run 的关系是弱引用：`kind: "run"` 的通知通过 `target.taskId` 指向任务，不在 Notification 上冗余 Run 状态。

当前实现状态：与 Run Journal 同库的 `notifications` 表已落地，200 条滚动上限、超限淘汰最旧；触发源为 run 完成/失败（取消静默）、知识导入结果与成果导出结果；窗口失焦且 run 终态时额外发系统通知。通知偏好与免打扰尚未建设。

