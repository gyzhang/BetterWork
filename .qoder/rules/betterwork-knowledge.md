---
trigger: model_decision
description: 资料导入、知识索引、FTS5 检索、Evidence、打开源文件、knowledge vault 相关工作时加载
---

# Knowledge 只读边界与索引纪律

产品与架构背景见 [docs/04-knowledge-and-memory.md](../../docs/04-knowledge-and-memory.md)；实现主体在 `apps/desktop/src/main/knowledge-vault.ts`。

## 源文件绝对只读

- 导入的 Markdown / Text / PDF / DOCX **源文件永远只读**：任何功能不得修改、移动、重命名或删除用户源文件。
- BetterWork 只拥有自己的派生数据：SQLite 索引、分块、Locator、内容哈希。从资料库移除文档只删除本地索引记录，不触碰源文件。
- 打开源文件的入口必须经 Main 进程验证该路径是**已登记的 Knowledge 来源**，防止借"打开"能力访问任意系统路径。

## 索引可重建

- Knowledge Vault 的 SQLite（FTS5）是**可重建缓存**，不是真相源；真相源是源文件与登记的 `source_path` / `content_hash`。
- PDF 按页、DOCX 按提取段落建立 Locator。改动解析逻辑时必须同步考虑既有索引的迁移或重建，不做静默的格式漂移。

## 数据与检索边界

- 数据文件在 Electron userData 下（`~/Library/Application Support/@betterwork/desktop/`），绝不提交 Git；日志避免记录完整文档内容。
- 检索走 FTS5 `MATCH`，无结果时回退 LIKE 模糊匹配；`knowledge_search` Tool 保持只读，其结果在 Run 内去重登记为 Evidence。
