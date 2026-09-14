# ADR-0019：讨论节点、恢复与返工边界

- 状态：Accepted（E52，2026-09-14）
- 前置：[ADR-0014](0014-expert-context-and-material-binding.md)、[ADR-0005](0005-artifact-version-evidence.md)。

## 决策

1. 讨论节点属于 Task 的持久化协作事实，阶段固定为理解与目标、研究完成、报告大纲、报告完成、PPT 大纲、PPT 完成和迭代返工。节点保存结构化结论、可选审阅反馈、下一步、来源 Run 和精确 ArtifactVersion 引用。
2. 节点有 `open` / `superseded` 两种状态。返工创建新节点并用 `supersedesId` 标记旧节点，不覆盖历史成果，也不重新发送旧请求；客户端 ID 幂等，重复提交返回原节点。
3. 节点创建只接受结构化请求，不从模型自然语言猜测阶段或自动推进。Run 结束后任务回到可编辑协作状态，用户可在重启后继续查看节点并决定下一步。
4. Main 校验 Task、Run、成果版本归属；Renderer 只通过 IPC 读写。节点不授予材料或工具权限，下一次 Run 仍必须提交新的 TaskContextRevision 和材料快照。
5. 首轮不引入 `run.waiting`、通用 DAG 或自动审批；讨论条作为工作页的轻量恢复入口，完整审阅体验和更多节点关系留后续切片。

## 验证边界

迁移、Repository、IPC 注册、客户端 ID 幂等、旧节点替代、成果版本归属和 Renderer 结构化提交均有测试。重启恢复依赖 SQLite 重新打开后按 Task 查询，不保持内存状态。
