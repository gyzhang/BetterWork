# ADR-0030：专家卡片元信息与硬删除边界

- 状态：Accepted（2026-09-28，按光哥「完善专家卡片，需要补数据库字段就补」的开工指令实施）。
- 日期：2026-09-28。
- 依据：[专家与任务材料设计 v0.2](../designs/experts-and-task-materials.md)、[ADR-0014](0014-expert-context-and-material-binding.md)、[专家与任务上下文契约](../development/expert-contracts.md)、[ADR-0005](0005-artifact-version-evidence.md)。
- 关系：细化 ADR-0014 的 Expert 生命周期操作；不改 RunContextSnapshot 的快照事实，也不新增执行注入路径。
- 编号说明：ADR-0029 预留给进行中的「工作空间身份与侧栏任务分组」记录（见 [2026-09-28 工作日志](../logs/2026-09-28.md)），本记录直接占用 0030，不占用该号。

## 背景

专家页卡片此前只有图标、名称、状态词、一句描述和一颗占满整行的「配置详情」按钮，既认不出是谁做的、第几版、擅长什么，也没有启用／停用与删除的入口。补齐这些展示字段需要落到 `ExpertRevision`；而「删除」在算台不是简单的 `DELETE`：`run_context_snapshots.expert_id` 是 `ON DELETE RESTRICT` 外键，历史 Run 必须能解释当时用的是哪位专家（[ADR-0005](0005-artifact-version-evidence.md) 的证据可追溯同一口径），而 `expert_revisions` 与 `memory_records.expert_id` 是 `ON DELETE CASCADE`。

## 决策

1. **署名与用途标签是修订自带的展示字段**：`ExpertRevision` 新增 `author`（≤160 字符，可为空串）与 `tags`（≤6 项、每项 ≤40 字符、不得重复）。它们只服务展示与识别，不进入人格指令合成，不影响执行注入与工具授权。
2. **卡片版本号就是修订号**，显示为 `v{currentRevision}`，不引入独立的版本字符串字段。每次保存配置产生新的不可变修订，`revision` 自动 +1，因此它是天然递增且不会撒谎的号；一个可由用户随意填写的版本字段会与「改过几次」这个事实脱钩。内置专家随发布清单更新同样推进修订号。
3. **删除是硬删除，但只在历史不再引用它时允许**。`expert:delete` 的语义固定为：不存在 → `expert_not_found`；`sourceKind = builtin` → `expert_builtin_readonly`（每次启动都由发布清单重新登记，删了还会回来）；被任意 `run_context_snapshots` 引用 → `expert_in_use`，并提示改用归档。删除成功会连带移除该专家的全部修订与挂名在其下的长期记忆（外键级联），确认框必须把这一点讲在前面。
4. **归档仍是「有历史可看」的退出方式**。停用与归档不改写任何历史事实；只有从未参与过 Run 的专家可以被真正删除。运行快照的专家引用不得置空、不得改写——那等于伪造证据链。
5. **卡片与列表行共用同一组就地动作**（详情／编辑或复制副本／删除＋启用停用），召唤是悬停与聚焦才显形的主动作，但始终留在 DOM 与可及树里。内置专家不给编辑与删除入口，改给「复制副本」，与配置详情页同口径。

## 实现边界

- 应用库迁移 v34 为 `expert_revisions` 补 `author TEXT NOT NULL DEFAULT ''` 与 `tags_json TEXT NOT NULL DEFAULT '[]'`；旧修订填空值，不替历史行猜一个作者。
- `ExpertSummary` 一并携带 `author` 与 `tags`，卡片不需要再取一次详情。
- 内置发布清单（`resources/experts/release-manifest.json`）可声明 `author` 与 `tags`；`ExpertService` 的幂等比较包含这两个字段，避免启动注册丢失或重复追加修订。
- 「悬停才出现」由 CSS `opacity` 表达，位置常驻不引起布局抖动；`prefers-reduced-motion` 与键盘路径都不受影响。这是卡片的视觉语言，不是新的组件基座。

## 取舍与后续

代价是「已用过的专家删不掉」，用户会看到一句解释而不是静默失败；换来的是历史 Run 的专家身份永远可解释。若将来需要「删除但保留历史」，正解是把引用改成软删除标记并新增迁移与 ADR，而不是放开 RESTRICT 外键。作者与用途标签后续可服务于专家分发与筛选，但本期不做市场、不做按标签检索，也不引入 Embedding。
