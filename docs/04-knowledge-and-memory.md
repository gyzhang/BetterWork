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

当前落盘结构只有 `vaults/default/vault.sqlite` 一个文件——上面的 `originals/`、`extracted/`、`thumbnails/`、`index/` 子目录均未创建，因为现行策略是引用原位置、不复制原件，提取文本与索引直接存放在 SQLite 内。引入缩略图或需要落盘的中间产物时再按需创建对应子目录。

当前实现状态：Markdown/Text 以“全文”为 Locator；PDF 使用跨平台解析器按页提取，检索结果保留“第 N 页”Locator；DOCX 使用 Mammoth 提取文本并以“段落 N”定位。原件仍引用原路径，SQLite 中保存的是可重建的提取文本和索引。

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

当前实现状态：已支持 **Markdown、Text、PDF、DOCX** 四种格式，导入对话框也只提供这四类扩展名过滤。单文件上限 20 MB；格式不支持、超限、读取失败或提取不到可检索文本时，该文件被跳过并回报具体原因，不中断整批导入。

定位信息的保留程度低于上表目标：PDF 只到页码（未保留页内区块），DOCX 只到按空行切分的段落序号（未保留标题层级与表格结构）。XLSX/CSV 属 Phase 2，PPTX 属 Phase 3，HTML 与图片 OCR 未排入 MVP。

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

当前实现状态：已落地的步骤是「发现文件（用户在系统对话框中选择）→ 内容 Hash（对原始字节做 SHA-256）→ 格式解析 → 提取 → 分块 → 元数据保存 → FTS5 → 可检索」；Embedding、摘要和关键词三步未做。

分块策略按格式固定：Markdown/Text 整篇作为单块（Locator「全文」），PDF 按页，DOCX 按空行切分的段落。与本节要求相比有两处差距：

- **去重口径**：唯一约束建在 `source_path` 上，因此实际语义是「同一路径重复导入即更新既有记录」，不是按内容 Hash 去重——同一份内容放在两个不同路径会被当作两份资料分别入库。Hash 已保存但当前只用于展示与刷新比对，未参与去重判定。
- **可重建性元数据**：分块策略与 Parser 版本都没有记录在库中。索引确实可以重建（FTS5 虚表在探测到结构变化时会丢弃并从 `knowledge_documents.content` 重灌），但重建时无法判断历史数据是用哪一版解析器产生的。引入 Embedding 时必须一并补上这两项，否则更换模型后无法定向重建。

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

当前实现状态：只有关键词一路。查询按空白与标点切词，每个词加引号后以 `AND` 连接交给 FTS5 `MATCH`，按 `rank` 排序；若命中为空，回退到对标题与分块内容的 `LIKE` 子串匹配（用于覆盖 FTS5 分词器切不出的中文子串，例如检索 `etterWork` 命中 `BetterWork`）。两路结果都带 Locator 与围绕命中位置截取的摘要。

结果上限 50 条；`knowledge_search` Tool 侧再截到 8 条，避免把长清单塞进模型上下文。向量检索、元数据过滤、融合与 Rerank 均未落地，Embedding 按 AGENTS.md 的范围约束留待后续切片。

## 6. 三层记忆体系

> **现状：本节至 §8 全部为设计目标，Memory 零实现。** 属 Phase 4 范围（见 [MVP 与路线图](07-mvp-and-roadmap.md) §6），架构决策见 [ADR-0004](adr/0004-hybrid-memory.md)。当前没有 `memory/` 目录、没有 `MemoryRecord` 表、没有记忆中心与后台反思。Run 历史与 Session 标识已持久化，但执行链路尚未把历史作为模型上下文传入，因此也不存在任何形式的隐式记忆。

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

当前实现状态：只落地 `language | vision | embedding` 三种角色，`reranker` 与 `ocr` 未落地；配置项记录了 Provider、Endpoint、模型标识、上下文与输出 Token 上限、温度、启用状态与优先级，但未记录工具能力、图片能力与 Embedding 维度。只有 `language` 角色进入 Agent 执行链路，另两种仅完成配置与连通性测试。因为还没有 Embedding 索引，「更换 Embedding 模型后重建索引」目前尚无从触发，该约束应在 Embedding 切片中一并落地。
