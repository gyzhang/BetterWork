# E17：知识检索成功向量路径块读取整理

日期：2026-10-11。批次基点：`0c9326f0e01b6c3b7bf1b2acc1cc3f74f5566d60`（`origin/main`）。任务分支：`codex/e17-knowledge-vector-read`，独立 worktree。

## 问题与范围

知识检索可用向量索引时，服务在查询 embedding 等待前通过 `chunksInScope` 加载允许范围的全部完整块。它只需要块身份来确认向量候选属于范围，并在扫描后按身份稳定处理同分结果，因此大块正文、定位和来源元数据被提前保留在查询内存中。

移除成功向量路的全 scope 完整块映射。保留范围、space、维度和 active generation 快照；继续扫描范围内全部已索引向量，按分数降序、revisionId/sectionOrdinal/start 稳定排序，再仅按 top 50 命中身份读取完整块。补读同时绑定允许修订集合与 chunkId，并按向量排名恢复结果顺序。关键词与 substring 回退、覆盖计算、融合、限额、降级、租约、取消和摘要语义不变；不改 Schema、迁移、协议、索引算法或产品范围，不新增 ADR。

向量行已有 `chunkId`、`revisionId`、`sectionOrdinal` 和 `start`，可支持范围过滤及确定性排序。完整块只在扫描成功且 current space 租约复核通过后，以 `chunksByIdsInScope(revisionIds, hitIds)` 补读；工作空间管理检索与 Run 固定的历史修订继续使用各自既有 scope。

## 回归与验证

- `knowledge-search.test.ts` 新增 80 个合成块的真实 SQLite 回归：最高分块位于扫描顺序末尾，仍进入 top 50；并列分数按块身份稳定排序；向量路径不调用全 scope 完整块读取，只补读 50 个已排名身份。embedding 前的 substring 精简读取边界保持原样。
- 新增历史修订语义检索回归：Run 仍命中已选旧修订，知识页只看当前登记修订。
- 定向功能测试：`npx vitest run --project functional apps/desktop/src/main/services/knowledge-search.test.ts`，1 文件 / 25 项通过。
- `npm run typecheck`、变更 TS 文件 ESLint 与变更文件 Prettier 检查均通过。
- `npm run docs:check`：1 个文件 / 154 项通过。

本地自动化验证不代表全仓完整验证、UI 走查、真实模型语义或安装态验收。本轮没有新增计时预算或产品容量结论。

## 交接边界

E17 实现与自动化回归在此分支/worktree 完成，验证范围见上文。完整 `npm run verify` 未运行；分支提交、PR 与合并状态按仓库流程交接。
