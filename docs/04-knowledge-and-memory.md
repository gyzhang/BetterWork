# 知识库与记忆

> 2026-09-24：知识基础闭环的补齐方向已获光哥接受，本轮仅归档[产品规范](designs/knowledge-foundation.md)、[ADR-0027](adr/0027-knowledge-foundation.md)（Proposed）、[实施契约](development/knowledge-contracts.md)、[KM 任务板](development/tasks-knowledge.md)和[编码交接](development/knowledge-coding-prompts.md)。正文读取、真实研究选材、混合检索、索引作业、轻量集合和 Office 知识导入均为待实现增量，不能从本入口推断已可用；成果回收知识与 OCR 后置，WM 记忆召回不改为向量。下文知识现状与增量设计分开阅读。

> 2026-09-14：用户已接受[专家与任务材料设计](designs/experts-and-task-materials.md)。知识按文档选取并固定内容修订、Expert/Workspace 适用记忆和范围缩小后的上下文处理按 [ADR-0014](adr/0014-expert-context-and-material-binding.md) 和 [材料、快照与运行来源契约](development/material-contracts.md) 落实；E2/E3 的唯一执行入口为[开发计划](development/tasks-experts.md)。E31/E32 已实现最小长期记忆闭环；自动反思、Embedding 和向量检索仍未实现。现有 RunService 已重建本 Task 历史回复，下文“不读取历史”属于旧实现说明。

> 2026-09-08：长期工作目录与已有知识共同支撑任务，不要求先建完整知识库；一个专家持续协作不等于无限累加聊天历史。当前已交付四种记忆作用域、确认/编辑/删除与运行注入；完整记忆系统和其他格式的旧 Phase 编号以 [新版顺序](07-mvp-and-roadmap.md#0-2026-09-08-生效的开发顺序) 为准。目录发现、自动反思与向量记忆仍以后续切片处理。

> 2026-09-22 归档，2026-09-23 实施收口：**工作型记忆增量已归档为设计、ADR、契约、任务卡与提示词五份文档，WM01–WM15 的代码与自动化测试已落地（证据见任务板 §15），WM16 的人工验收尚未完成。** 产品行为见 [工作型记忆产品设计](designs/work-centered-memory.md)，决策见 [ADR-0026](adr/0026-work-centered-memory.md)（已按该方案实施），字段/算法/迁移/接口唯一真相源见 [记忆实施契约](development/memory-contracts.md)，实施状态只由 [WM 任务板](development/tasks-memory.md) 维护。下文标注「已实现（WM…）」的能力由 WM01–WM15 交付，自动化证据见任务板 §15；界面与真实模型语义的人工验收以任务板状态为准，未完成前不得写成用户已确认。本文不复制 WM 的字段清单。

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

Knowledge Vault 与应用状态库是两个独立的 SQLite 文件：Vault 保存提取内容、块、FTS 和 v3 的不可变内容修订；`betterwork.db` 保存 Workspace、Task、材料选择、Run 快照、读取足迹、成果关系和 Workspace 所属输入快照。两库没有跨库事务。Knowledge 刷新会追加 `knowledge_revisions` 与对应分块，运行引用修订 ID 与 `content_hash`；`knowledge_documents` 仍是当前索引投影，`updated_at` 不能作为历史版本。

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

定位信息的保留程度低于上表目标：PDF 只到页码（未保留页内区块），DOCX 只到按空行切分的段落序号（未保留标题层级与表格结构）。XLSX/CSV/PPTX 已有任务输入解析，但尚未接入知识导入；旧 Phase 2/3 格式排期不再作为本轮入口，补齐按 [KM12/KM13](development/tasks-knowledge.md)独立推进。HTML 与图片 OCR 不进入本轮。

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

分块策略按格式固定：Markdown/Text 整篇作为单块（Locator「全文」），PDF 按页，DOCX 按空行切分的段落。当前去重与版本事实如下：

- **去重口径**：当前文档按 `source_path` 更新，不同路径的相同内容仍是两份资料；修订表以 `(document_id, content_hash)` 去重，因此原始字节哈希已参与同文档修订去重，不只是展示字段。
- **版本元数据**：Vault v3 的 `knowledge_revisions` 已保存 `parser_version` 和 `chunking_version`，既有写入值为 `text-extract-v1` 和 `format-locator-v1`。尚缺的是同原始哈希下解析升级的修订身份、独立提取文本哈希及派生检索小块版本，按 [知识契约 §2](development/knowledge-contracts.md)补齐。
- **重建边界**：当前投影、FTS 和未来向量可重建；已保存修订、文本及其 Task/Run 历史关系必须保留。不得把整个 Vault 当可随意删除的缓存。

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

运行中的检索接收允许的 Knowledge revision 集合，当前对保存修订逐块做全部查询词的大小写不敏感 substring 匹配，并非上述 current 文档的 FTS5 管线。正常 UI 通过 TaskContext/RunContextSnapshot 固定选材，空知识集合返回空结果；旧无 TaskContext 兼容分支仍可全库查询，这是 [ADR-0027](adr/0027-knowledge-foundation.md)拟收窄的范围。E24 已保存搜索摘要足迹，但摘要不等于正文读取，已选择也不等于已访问。

E22 已能把具体 Knowledge revision 的身份、哈希和用途保存到 TaskContextRevision；E23 已把该选择绑定到 Run 并限制 `knowledge_search`，E24 已把返回的修订、Locator 和摘要哈希保存为读取足迹，未选资料不能通过运行时搜索进入模型。E25 已将选择、用途和实际来源呈现在 Composer 与资料面板。

## 6. 三层记忆体系

> **现状：E31/E32 完成最小记忆闭环，WM01–WM15 在其上落地工作型记忆的治理、确定性召回、运行审计与自动提炼（自动化证据见 [WM 任务板](development/tasks-memory.md) §15，界面与真实模型语义的人工验收未完成）。** 属 E3 与 WM 范围（见 [开发计划](development/tasks-experts.md)），架构决策见 [ADR-0004](adr/0004-hybrid-memory.md)、[ADR-0015](adr/0015-memory-scope-and-governance.md) 与 [ADR-0026](adr/0026-work-centered-memory.md)。SQLite 的 `MemoryRecord` 修订是唯一真相源；每次新 Run 只注入有效的 `confirmed` 记录，最多 16 条且总内容不超过 6,000 个 Unicode 字符，并记录实际读取的修订与哈希。设置页支持创建、查看、确认、编辑和删除；对话完成消息支持用户确认后形成记忆；任务资料面板的“本任务不用”只写入当前 TaskContextRevision。Markdown 只读投影按 User/Workspace/Expert/Expert×Workspace 作用域重建，不能回写数据库。自动反思、Embedding、向量索引和批量记忆维护仍未实现。**已实现（WM04/WM05）**：取候选顺序改为 [契约 §6](development/memory-contracts.md) 的确定性管线——先按最新修订、状态与生效期、范围、任务排除、来源可用与待复核、材料与记忆依赖、未裁决冲突逐层过滤（每层只登记身份与原因码，不落正文），再用固定版本 `memory-recall-v1` 按任务相关性打分排序，最后套 16 条／6,000 码点总预算与 2 条／600 码点的通用偏好小池；被排除或不胜任的记录不占预算，预算落选与「不相关」只作为原因码计数，不表示授权被撤销。每个 Run 的实际选择、重放轮次与排除账本按契约 §8 落库，可在运行详情回看。

### Core Memory Files（E31 已实现的受管投影）

短小、透明、可编辑的渐进文档：

```text
memory/
├── user/
│   └── index.md
├── workspaces/<id>/index.md
├── experts/<id>/index.md
└── expert-workspaces/<expertId>/<workspaceId>/index.md
```

E31 先生成每个作用域的单一 `index.md`；后续切片再增加可按需加载的详细文档和检索索引。

### Structured Memory Store（E31 已实现）

SQLite 保存来源、Scope、置信度、状态和时间语义：

```ts
interface MemoryRecord {
  id: string;
  revisionId: string;
  revision: number;
  scope:
    | { kind: "user" }
    | { kind: "workspace"; workspaceId: string }
    | { kind: "expert"; expertId: string }
    | { kind: "expert-workspace"; expertId: string; workspaceId: string };
  kind: "semantic" | "episodic" | "procedural" | "preference";
  content: string;
  sourceType: "user-explicit" | "conversation" | "artifact" | "reflection";
  sourceId?: string;
  confidence: number;
  status: "candidate" | "confirmed" | "superseded" | "expired" | "deleted";
  validFrom?: number;
  validUntil?: number;
  supersedesId?: string;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}
```

### Derived Retrieval Index（后续切片）

Memory 文件和 MemoryRecord 共同生成全文与向量索引。索引不是长期真相源，可以随时重建。

已实现（WM04）的召回第一期**不建派生索引**：召回在 SQLite 范围过滤后使用固定版本 `memory-recall-v1` 的确定性内存文本匹配，不引入 FTS、Embedding 或向量依赖；未来的索引只是可重建优化（[契约 §6.1](development/memory-contracts.md)）。

## 7. 记忆形成

### 用户明确记忆

用户通过“记住这个”直接写入 confirmed 记忆。

### Agent 建议记忆

Agent 发现可能长期有用的信息时，生成 candidate，由用户保存、编辑或忽略。

### 后台反思

任务结束后可整理成功方法、重复偏好、冲突和过期信息。后台反思只产生 candidate，不静默修改长期记忆。

已实现（WM08–WM11）的提炼**不是定时反思**：自动触发只有两处——`run-service.ts` 在 `run.completed` 终态提交后调用 `requestRunExtraction`，`discussion-checkpoint-service.ts` 只在人工 `feedback` 非空时按节点入队（`summary` 不能触发）；每个工作空间独立开关且默认关闭，作业是 Main 层无工具单轮调用，结果一律停在 candidate，模型无权写 confirmed（[产品设计 §3.3](designs/work-centered-memory.md)、[契约 §7](development/memory-contracts.md)）。全量聊天扫描与定时反思明确不在范围内。

## 8. 记忆治理

产品应提供“记忆中心”，支持：

- 查看算台记住了什么
- 查看来源和形成原因
- 按 User/Workspace/Expert 过滤
- 确认、编辑、合并和删除
- 标记过期
- 禁止某类信息再次被建议

已实现（E32）：设置页的创建、查看、确认、编辑、删除与「本任务不用」。**已实现（WM02/WM03）**：幂等操作回执与 `expectedRevision` 并发控制、以 action 表达的状态转移（confirm/reject/restore-candidate/expire/delete/reconfirm）、候选「暂不采用」可恢复、冲突裁决 `keep-both`/`replace` 绑定精确修订对、有效期的 set/clear 语义、legacy 来源复核入口，以及投影「数据库已提交成功＋可见警告」的一致性（[契约 §5.4–§5.6](development/memory-contracts.md)）。本期不做置信度自动覆盖，也不声称能自动识别新材料与记忆的全部语义冲突。

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

**已实现（WM12–WM14）**补上闭环的「继承」一环：用户可把某个精确成果版本指定为本空间参考版本，并在下个任务显式引用（固定 `artifactVersionId` + `contentHash`，不跟随 latest，也**不表示内容正确或已获批准**）；工作空间简报是上述已确认目标/约束/决策/方法加未决讨论节点的可重建只读视图，不整体注入模型（[产品设计 §3.6](designs/work-centered-memory.md)、[契约 §10](development/memory-contracts.md)）。图中「可选择形成记忆」在 WM 下仍要求用户确认，模型只能产出候选；「可选择形成 Skill」不在本期范围。

## 10. 模型角色

```ts
type ModelRole = "language" | "vision" | "embedding" | "reranker" | "ocr";
```

模型配置记录角色、Provider、Endpoint、上下文、工具能力、图片能力和 Embedding 维度。更换 Embedding 模型后应重建对应索引。

当前实现状态：只落地 `language | vision | embedding` 三种角色，`reranker` 与 `ocr` 未落地；配置项记录了 Provider、Endpoint、模型标识、上下文与输出 Token 上限、温度、启用状态与优先级，但未记录工具能力、图片能力与 Embedding 维度。只有 `language` 角色进入 Agent 执行链路，另两种仅完成配置与连通性测试。因为还没有 Embedding 索引，「更换 Embedding 模型后重建索引」目前尚无从触发，该约束应在 Embedding 切片中一并落地。
