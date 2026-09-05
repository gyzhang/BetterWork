# Tool、Skill、专家与套件

## 1. 概念关系

```text
Kit
├── Skills
├── Expert Presets
├── Templates
├── MCP / Connectors
└── Sample Tasks

Expert
├── Identity / Instructions
├── Skills / Kits
├── Tool Policy
├── Knowledge Scopes
├── Memory Scope
└── Model / Output Preferences

Skill
├── Instructions / Workflow
├── Tools
├── Templates
├── Validation
└── Artifact Outputs

Tool
└── Atomic Execution
```

## 2. Tool

Tool 是可执行的原子能力，不包含人格和复杂业务流程。

Tool 名统一使用 `snake_case`，与模型侧 function calling 的函数名一致，不使用点号命名空间。

现行接口（`packages/agent-core/src/types.ts`）：

```ts
interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>;
}

interface ToolExecutionContext {
  runId: string;
  workspacePath: string;
  signal: AbortSignal;
  reportProgress(message: string): void;
}
```

`inputSchema` 是给模型的 JSON Schema，执行时用 Zod 独立校验实际入参——两者刻意分开，避免把模型可见的 Schema 与运行时校验耦合。`outputSchema` 与 `permissions` 字段尚未存在，属 Phase 5 权限体系（见 §7）的一部分，引入时需要同时改动 Agent Core 与 Tool Runtime。

能力清单与落地状态：

| Tool | 状态 | 说明 |
| --- | --- | --- |
| `calculator` | 已落地 | 确定性四则运算，自带递归下降解析器 |
| `read_text_file` | 已落地 | 受 `workspacePath` 边界限制，超长截断并回报 `truncated` |
| `knowledge_search` | 已落地 | 只读，由 Application 层注入检索函数（工厂模式） |
| `web_search` | 已落地 | 只读，仅在存在已启用且配置了 Key 的搜索引擎时注册（见 [ADR-0007](adr/0007-search-engine-config-and-web-search-tool.md)） |
| `web_fetch` | 未落地 | Phase 1 后续切片：网页正文抓取 |
| `excel_profile` / `excel_query` | 未落地 | Phase 2，依赖 Python Worker |
| `document_render` / `presentation_render` | 未落地 | Phase 3 |
| `artifact_save` | 未落地为 Tool | 成果保存当前是用户在界面上的显式动作，经类型化 IPC 直达 Application 层，不由模型调用 |

需要 Application 层资源的 Tool 一律采用「工厂 + 闭包注入」形式（`createKnowledgeSearchTool`、`createWebSearchTool`），使 `tool-runtime` 不依赖 Electron、SQLite 或具体服务商 SDK。

## 3. Skill

Skill 是完成一类工作的可复用方法，可以是纯指令、结构化 Workflow、脚本或 MCP 组合。

建议 Manifest：

```yaml
id: market-research
version: 1.0.0
name: 市场研究
description: 生成带证据引用的市场研究报告

inputs:
  topic: { type: string }
  region: { type: string }

outputs:
  report: { artifactType: research-report }

requires:
  tools: [web_search, web_fetch, knowledge_search, document_render]
  skills: [source-evaluation]

permissions:
  network: true
  filesystem: workspace-write

templates:
  - market-research-report.docx

validation:
  - citations-required
  - executive-summary-required
```

Skill 必须可测试，至少包含一个输入示例和预期输出约束。

## 4. Expert

Expert 是配置化的 ReAct 智能体，不是独立 Agent Engine，也不需要为每个专家编写 Class。

```ts
interface ExpertDefinition {
  id: string;
  name: string;
  description: string;
  identity: string;
  instructions: string;
  skillIds: string[];
  kitIds: string[];
  knowledgeScopes: string[];
  memoryScope: string;
  toolPolicy?: Record<string, unknown>;
  modelPolicy?: Record<string, unknown>;
  outputPreferences?: Record<string, unknown>;
  templateIds?: string[];
}
```

初期由用户显式选择专家；自动路由延后，并且必须让用户看见路由结果和原因。

## 5. Kit

Kit 是可安装、可升级的工作解决方案包，而不是单纯 UI 分组。

例如“市场研究套件”：

- 市场研究专家
- 竞品分析 Skill
- 行业扫描 Skill
- 来源核验 Skill
- Web Search Connector
- 研究报告 Word 模板
- 市场汇报 PPT 模板
- 示例任务

Kit Manifest 应记录版本、依赖、安装内容和兼容性。文件格式在 Phase 5 定义（见 [MVP 与路线图](07-mvp-and-roadmap.md) §7），不实现市场和在线安装；当前仓库没有 `resources/kits` 目录，也没有任何 Manifest 文件。

## 6. Workflow

Workflow 表示具有稳定阶段、可恢复检查点和用户确认点的工作过程。

Skill 可以使用 Workflow，但 Skill 不等于 Workflow。简单 Skill 可以由 ReAct 自主完成，复杂文档任务应采用显式 Workflow。

MVP 期间不建设通用 DAG 引擎，只支持顺序步骤、条件步骤、重试和等待用户。

当前实现状态：Workflow 与 Step 均未落地——没有 Workflow 引擎，也没有 `run_steps` 表。执行过程是 `ReActAgentEngine` 的单个 ReAct 循环，工具轮次上限 8，超限以 `run.failed` 终止；循环内没有显式阶段、检查点或恢复位置。

界面上看到的「理解任务 / 处理工作材料 / 整理结果 / 任务完成」阶段分组，是 Renderer 从事件流实时派生的展示层聚合（`renderer/src/activity.ts`），不是持久化的 Step，刷新后由已落库的 `run_events` 重新派生。「等待用户」需要先定义 `approval.requested` / `approval.resolved` 与 `run.waiting` 事件（见 [系统架构](03-system-architecture.md) §5），属 Phase 1 大纲确认能力的前置条件。

## 7. 权限

权限主要保护用户设备和文件，而不是限制知识片段发送到模型。

建议权限：

- `filesystem:read`
- `filesystem:workspace-write`
- `filesystem:external-write`
- `network`
- `shell`
- `desktop-control`
- `mcp:<server-id>`

危险操作需要审批：

- 覆盖原文件
- 写入 Workspace 外部
- Shell 命令
- 批量删除或移动
- 向外部系统提交或发送内容

当前实现状态：上述权限声明、Policy 检查、审批与审计层**均未建设**，`AgentTool` 上也没有 `permissions` 字段。

现已存在的强制边界只有两条：`read_text_file` 在执行前校验目标路径解析后不越出 `workspacePath`；主进程在处理「打开原文」请求前，先用知识库登记记录做白名单校验，未登记路径一律拒绝交给 `shell.openPath`。

当前不存在能覆盖原文件、写入 Workspace 外部、执行 Shell 或批量移动文件的工具——危险操作是靠「不授予该能力」规避的，而不是靠权限系统拦截。引入写操作类 Tool（例如 Phase 3 修改已有 Office 文件）之前，必须先落地本节的权限与审批设计，否则 AGENTS.md 的「默认非破坏性」原则没有执行机制。

## 8. 初始内置能力

教学链路（Phase 0，已落地）：

- `calculator`
- `read_text_file`

产品能力（Phase 1 起）：

| 能力 | 状态 | 归属与说明 |
| --- | --- | --- |
| Knowledge Search | 已落地 | `knowledge_search` Tool + 知识页手动检索，FTS5 关键词加子串兜底 |
| Web Search | 已落地 | `web_search` Tool，百度千帆 AI 搜索先行（[ADR-0007](adr/0007-search-engine-config-and-web-search-tool.md)） |
| Web Fetch | 未落地 | Phase 1 后续切片：抓取网页正文 |
| Evidence 登记 | 已落地 | 不是独立 Tool：Application 层观察 `knowledge_search` / `web_search` 的 `tool.completed` 输出后自动去重落库 |
| Markdown Artifact | 已落地 | 保存、预览、`user-edit` 修订、导出 `.md` |
| Artifact Version | 已落地 | 版本历史、按版本查看与导出、版本—Evidence 关联（[ADR-0005](adr/0005-artifact-version-evidence.md)） |
| File Preview | 部分落地 | 已落地：成果 Markdown 的文档化预览、按登记白名单用系统应用打开原文。未落地：应用内 PDF/DOCX/图片预览 |
| DOCX Render | 未落地 | 按 AGENTS.md 范围约束留待后续切片，不在当前 Phase 1 切片内；渲染管线设计见 [知识工作流](06-knowledge-workflows.md) §4 |

