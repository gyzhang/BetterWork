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

示例：

- `knowledge.search`
- `web.search`
- `web.fetch`
- `excel.profile`
- `excel.query`
- `document.render`
- `presentation.render`
- `artifact.save`

基本接口：

```ts
interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  permissions: ToolPermission[];
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}
```

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
  tools: [web.search, web.fetch, evidence.save, document.render]
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

Kit Manifest 应记录版本、依赖、安装内容和兼容性。第一阶段只定义文件格式，不实现市场和在线安装。

## 6. Workflow

Workflow 表示具有稳定阶段、可恢复检查点和用户确认点的工作过程。

Skill 可以使用 Workflow，但 Skill 不等于 Workflow。简单 Skill 可以由 ReAct 自主完成，复杂文档任务应采用显式 Workflow。

第一阶段不建设通用 DAG 引擎，只支持顺序步骤、条件步骤、重试和等待用户。

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

## 8. 初始内置能力

教学 Demo：

- Calculator Tool
- Read Text File Tool

产品 MVP：

- Knowledge Search
- Web Search / Fetch
- Evidence Save
- Markdown Artifact
- DOCX Render
- File Preview
- Artifact Version Save

