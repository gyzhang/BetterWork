# 知识库与记忆

## 1. 核心区分

```text
Knowledge：用户拥有的事实资料
Memory：长期协作中形成的上下文、偏好和经验
```

知识库不能自动等同于记忆，聊天内容也不能未经判断全部进入长期记忆。

## 2. 本地知识库

Knowledge Vault 是用户私有管理的本地知识空间。私有表示个人拥有和使用，不表示只能由本地模型处理。

建议结构：

```text
vaults/<vault-id>/
├── originals/
├── extracted/
├── thumbnails/
├── index/
└── vault.sqlite
```

如果用户选择引用原位置而不是复制文件，Vault 记录文件路径、Hash 和最近索引状态。

## 3. 支持格式

目标格式：

- PDF
- DOCX
- XLSX/CSV
- PPTX
- Markdown/Text
- HTML
- PNG/JPEG 等图片

解析时必须尽量保留定位信息：

- PDF 页码和区块
- Word 标题、段落和表格
- Excel Sheet、Range、字段与公式
- PPT Slide、对象和备注
- 图片 OCR 区域和视觉描述

## 4. 索引流程

```text
发现文件
→ 内容 Hash 与去重
→ 格式解析
→ 结构化提取/OCR
→ 分块
→ 元数据保存
→ FTS5
→ Embedding
→ 摘要和关键词
→ 可检索
```

分块策略、Parser 版本和 Embedding 模型必须记录，以支持重建索引。

## 5. 检索

第一阶段采用混合检索：

```text
关键词检索（FTS5）
+ 向量检索
+ 元数据过滤
→ 融合
→ 可选 Rerank
→ 带 Locator 的结果
```

VectorIndex 必须可替换。第一版优先考虑 SQLite + sqlite-vec；规模和多模态需求增加后可切换或增加 LanceDB 实现。

## 6. 三层记忆体系

### Core Memory Files

短小、透明、可编辑的渐进文档：

```text
memory/
├── user/
│   ├── index.md
│   ├── profile.md
│   ├── preferences.md
│   └── terminology.md
├── workspaces/<id>/
│   ├── index.md
│   ├── context.md
│   ├── conventions.md
│   └── decisions.md
└── experts/<id>/
    ├── index.md
    ├── methods.md
    └── lessons.md
```

索引文件提供概要和链接；详细文档按需加载。

### Structured Memory Store

SQLite 保存来源、Scope、置信度、状态和时间语义：

```ts
interface MemoryRecord {
  id: string;
  scope: "user" | "workspace" | "expert" | "task";
  scopeId: string;
  kind: "semantic" | "episodic" | "procedural" | "preference";
  content: string;
  sourceType: "user-explicit" | "conversation" | "artifact" | "reflection";
  sourceId?: string;
  confidence: number;
  status: "candidate" | "confirmed" | "superseded" | "deleted";
  validFrom?: number;
  validUntil?: number;
  supersedesId?: string;
  createdAt: number;
  updatedAt: number;
}
```

### Derived Retrieval Index

Memory 文件和 MemoryRecord 共同生成全文与向量索引。索引不是长期真相源，可以随时重建。

## 7. 记忆形成

### 用户明确记忆

用户通过“记住这个”直接写入 confirmed 记忆。

### Agent 建议记忆

Agent 发现可能长期有用的信息时，生成 candidate，由用户保存、编辑或忽略。

### 后台反思

任务结束后可整理成功方法、重复偏好、冲突和过期信息。后台反思只产生 candidate，不静默修改长期记忆。

## 8. 记忆治理

产品应提供“记忆中心”，支持：

- 查看算台记住了什么
- 查看来源和形成原因
- 按 User/Workspace/Expert 过滤
- 确认、编辑、合并和删除
- 标记过期
- 禁止某类信息再次被建议

## 9. 知识加工闭环

```text
已有知识
+ 新文件
+ 外部研究
+ 用户输入
→ 检索与分析
→ 新 Artifact
→ 用户确认
→ 可选择回收到知识库
→ 可选择形成记忆或 Skill
```

生成的 Artifact 不自动进入知识库，必须由用户确认，避免知识库充满中间稿和低质量重复内容。

## 10. 模型角色

```ts
type ModelRole = "language" | "vision" | "embedding" | "reranker" | "ocr";
```

模型配置记录角色、Provider、Endpoint、上下文、工具能力、图片能力和 Embedding 维度。更换 Embedding 模型后应重建对应索引。

