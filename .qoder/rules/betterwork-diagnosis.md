---
trigger: model_decision
description: 排查缺陷、修 bug、测试失败、行为异常、诊断问题、分析回归原因时加载
---

# GATE-0：缺陷诊断顺序（数据优先）

**排查 BetterWork 缺陷必须按以下顺序执行，禁止跳步：**

1. **先查数据（ground truth）**——产品状态与知识索引都在本地 SQLite：
   - Run Journal（Workspace/Task/Session/Run/Event/Evidence/Artifact）：`~/Library/Application Support/@betterwork/desktop/betterwork.db`
   - Knowledge Vault（FTS5 索引）：`~/Library/Application Support/@betterwork/desktop/vaults/default/vault.sqlite`
   - 诊断时用 `sqlite3 -readonly "<路径>" "SELECT ..."` 只读查询；禁止在诊断过程中写入产品库。
2. **再看运行日志**——`tail -200 /tmp/betterwork-dev.log`。
3. **最后才看代码**——代码是最后一环，不是第一环。

**反面教训**：在代码层反复推演渲染与交互问题，实际根因是数据库里的字段或状态与预期不符。数据不会说谎，代码会。

分支规则：编译错误、构建警告、纯静态资源问题先查构建输出，不强制查库；根因范围不明时只做一次只读连接确认，在证据指向数据层之前不查业务表。

## 特征优先于机制

排查违规或异常时，先搜索问题的**特征字符串本身**（错误码、日志模式、channel 名、SQL 关键词），而不是搜索实现机制或调用方法签名。机制会随重构变化，特征是稳定的。

## 修复纪律

- 先定位根因再动手；禁止补丁式修复，禁止为消除报错而绕过校验（`--no-verify`、吞异常、放宽 Schema）。
- 修复缺陷时同步补回归测试（AGENTS.md §7 的要求）。
- **技术方案遇到两层以上障碍，必须停下来与用户讨论**，不要埋头修一座不该修的桥；沉默、让步或"先这样吧"均不构成继续的授权。
