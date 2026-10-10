# E5：记忆召回读模型整理（R10）

## 范围与依据

用户已授权推进 E5。本轮从 `12b0e3bdba9406cdeb070434e5b7fcfc2d6d51c6` 新建 `codex/e5-memory-recall-read-model`，沿用原 checkout。

召回已有范围候选查询，但排除账本另用 `memories.list({})` 加载全域最新记录，并对每个 Task 排除 ID 线性查找。账本实际只消费 `id`、`revisionId`、`scope`；正文、来源 JSON、有效期和评分字段不参与这一步。

本轮增加内部审计投影，保留最新修订、全部状态和范围、完整计数、身份顺序及单条理由归属。完整候选读取与来源安全验证继续沿用现有流程；历史重放、来源事件查询、冲突两两枚举留给后续切片。本轮不改 IPC、表结构或召回算法版本。

## 实现与 Review

`MemoryRepository.listRecallAuditEntries()` 的 SQL 只选 `id / revision_id / scope_kind / workspace_id / expert_id`，复用完整列表的最新修订判据与 `updatedAt DESC / id ASC` 顺序，复用规范 scope 映射并校验。没有状态过滤、分页或 LIMIT。召回用候选 ID 集合与审计身份 Map 补账；Task 排除按首次出现的输入顺序去重，未知 ID 不计数。

审查确认：每条非候选仍只有一个理由；Task 排除优先于 scope/inactive；每因计数保持完整，展示身份仍最多 50 个。候选完整读取、来源与传递依赖验证、冲突装配、三池选择、预算格式化和历史安全重放未变。范围外非法来源载荷不再导致无关召回整体失败；范围内候选的非法来源仍被完整解析拒绝。审计 scope 不完整仍明确失败。

## 本地验证（2026-10-10 20:36 CST）

- 相关 functional 13 文件 / 181 项、RunService heavy 1 文件 / 87 项，去重共 14 文件 / 268 项通过；新增功能回归 4 项，均使用真实 SQLite。覆盖四种 scope、最新修订、deleted/expired/superseded/candidate、稳定排序、60 条 scope 与 55 条 inactive 的完整计数及 50 身份样本、重复/未知/跨范围 Task 排除、来源与依赖失效、keep-both 和 Run 请求集成。
- SQL 扩大为 `SELECT *` 的探针检出 1 项失败；恢复全域 `list({})` 的探针检出 2 项失败。恢复后上述定向测试全部通过。日志为 `/tmp/betterwork-e5-sql-probe.log`、`/tmp/betterwork-e5-full-read-probe.log`。
- typecheck、全仓 lint / format:check、docs:check（154 项）和 build 均退出 0。初次新增夹具的摘要格式、JSON 合法性和 verbose 回调类型已按真实约束修正，没有放宽生产边界。构建保留依赖 Zod 的既有 Rollup 注释告警。
- 最后独立串行 bench 2 文件 / 2 项通过，日志 `/tmp/betterwork-e5-bench-final.log`；功能测试与静态检查结束后再测，未与本轮测试并行。

合成库有 4,000 个修订行、3,000 个最新身份。两种查询输出身份集合、修订和顺序完全一致；这是全量轻投影，返回行数没有减少。

| 测量口径 | 完整记录 | 审计投影 |
| --- | ---: | ---: |
| 返回读模型 JSON 的 UTF-8 字节数 | 14,878,391 | 496,501 |
| 返回正文 UTF-8 字节数 | 12,982,890 | 0 |
| 返回 provenance JSON 字节数 | 249,000 | 0 |
| 9 次读取中位耗时 | 57.41 ms | 3.09 ms |
| 9 次读取 p95（本样本最大值） | 69.23 ms | 3.46 ms |

机器为 darwin/arm64、Node v26.8.1；上述载荷是返回读模型的序列化读数，不是 SQLite 文件大小、峰值内存或模型请求量。SQL 读取列的反例测试另外证明正文与来源没有进入投影。既有 1,000 条排序 bench 为 10.7 ms，原 200 ms 上界保持。这是合成样本证据，不构成产品容量承诺。

## 边界与后续

E5 完成 R10 的召回排除账本切片，仍需全域元数据扫描；未增加缓存、索引、迁移或新算法。本轮没有 UI 改动；UI 走查、完整 verify、真实模型语义和安装态人工验收未运行。最新源 SHA 的 macOS PR Gate、合并和归档待远端收口。

建议下一步 E6 整理历史重放与来源事件读模型，保留完整依赖证明和连续安全后缀，不能先 LIMIT 掉安全检查所需的来源；等待后续指令。R10 的冲突枚举与知识正文检索仍属独立后续范围。
