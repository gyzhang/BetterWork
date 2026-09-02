# 领域模型

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

## 7. Evidence、Claim 与 Citation

- Evidence：来自本地文档或外部信息源的可回溯证据。
- Claim：报告、分析或演示文稿中的一个事实或判断。
- Citation：Claim 对 Evidence 的引用表达。

```ts
interface Evidence {
  id: string;
  sourceType: "local-file" | "web" | "database" | "user";
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

具体语义见 [能力体系](05-capability-system.md)。

