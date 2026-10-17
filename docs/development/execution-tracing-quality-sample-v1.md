# AT21 离线执行追踪固定合成样本报告 v1

## 范围

每个场景单独创建内存 SQLite、Workspace、Task 和稳定 Run ID，固定输入修订 `synthetic-input-v1` 与配置修订 `synthetic-config-v1`。样本写入经 Schema 校验的合成事件，再读取生产 `RunDiagnosticsRepository` 投影。报告只比较 Run 状态、完整性、调用计数、节点状态、模型结束原因和实时到历史投影交接。

样本不创建 Provider、不发送模型请求、不访问 HTTP 或外部工具。预期与观测都只代表结构和链路；所有场景的业务内容质量均**未验**。现有 Agent Core、RunService、生命周期和 Renderer 测试继续分别覆盖真实编排及组件行为；本报告不复刻执行引擎或建立第二套评测平台。

## 比较结果

“期望”与“观测”均来自确定性投影断言；Run ID 在每次运行中保持固定，数据库和 Run 每场景新建。`M/T/X` 分别表示模型调用、工具调用、实际工具执行；所有节点状态列表按名称排序。

| 场景 | Run ID | 输入 / 配置修订 | 期望 | 观测 |
| --- | --- | --- | --- | --- |
| 正常完成 | `at21-success-v1` | `synthetic-input-v1` / `synthetic-config-v1` | `completed / complete / v1`；M1 T0 X0；`model:completed, round:completed`；结束原因 `stop`；round 0 首字耗时已记录 | 上述状态与节点，round 0 首字耗时已记录 |
| 模型截断 | `at21-truncation-v1` | `synthetic-input-v1` / `synthetic-config-v1` | `failed / complete / v1`；M1 T0 X0；`model:failed:output-limit, round:failed`；结束原因 `length`；round 0 首字耗时已记录 | 上述状态与节点，结束原因 `length`，首字耗时已记录 |
| Tool-only 轮次后恢复 | `at21-tool-only-v1` | `synthetic-input-v1` / `synthetic-config-v1` | `completed / complete / v1`；M2 T1 X1；round 0 无首字耗时，round 1 已记录；`model:completed` ×2、`round:completed` ×2、`tool:completed`；结束原因 `tool-calls` → `stop` | 上述状态、计数与逐轮首字/结束原因 |
| 可恢复工具失败 | `at21-recoverable-tool-v1` | `synthetic-input-v1` / `synthetic-config-v1` | `completed / complete / v1`；M2 T1 X1、失败执行 1；`model:completed` ×2、`round:failed` + `round:completed`、`tool:failed:tool-error`；结束原因 `tool-calls` → `stop` | 上述状态与计数，失败轮后 Run 完成 |
| Skill 结构化拒绝 | `at21-skill-rejection-v1` | `synthetic-input-v1` / `synthetic-config-v1` | `completed / partial / v1`；M2 T1 X1、失败执行 1；`host:failed:validate:validate-failed`、`model:completed` ×2、`round:failed` + `round:completed`、`tool:failed:skill-command-failed` | 上述状态与计数；拒绝结果可回看，Run 后续完成 |
| 用户取消 | `at21-cancelled-v1` | `synthetic-input-v1` / `synthetic-config-v1` | `cancelled / complete / v1`；M1 T0 X0；`model:cancelled, round:cancelled`；模型结束原因未记录，首字耗时未记录 | 与期望一致 |
| 清理失败 | `at21-cleanup-failed-v1` | `synthetic-input-v1` / `synthetic-config-v1` | `failed / partial / v1`；M0 T0 X0；`host:failed:skill-cleanup:cleanup-failed` | 与期望一致 |
| 实时到历史交接 | `at21-handoff-v1` | `synthetic-input-v1` / `synthetic-config-v1` | `completed / complete / v1`；M1 T0 X0；`model:completed, round:completed`；实时 `running` → 历史 `completed` | 上述状态、节点与投影交接 |
| 诊断版本缺失 | `at21-missing-version-v1` | `synthetic-input-v1` / `synthetic-config-v1` | `completed / unavailable / 无版本`；M0 T0 X0；无诊断节点 | 与期望一致 |

固定比较器对结构差异返回具体字段名。定向测试共 2 项通过，9/9 场景匹配；差异字段反例先红（1 项失败），实现后绿（2 项通过）。

## 关联行为回归

- Core 成功、截断拒绝、tool-only、可恢复工具错误：`packages/agent-core/src/agent-engine.test.ts`。
- 结构化 Skill 输出、取消及真实 Run 诊断跨层投影：`apps/desktop/src/main/services/run-service.test.ts` 与 `apps/desktop/src/main/persistence/run-diagnostics-repository.test.ts`。
- 清理失败收口：`apps/desktop/src/main/services/run-event-lifecycle.test.ts`。
- 历史 Run 选择与详情呈现：`apps/desktop/src/renderer/src/components/context/RunExecutionDetails.test.tsx`。

本报告不替代真实 Electron UI 走查、真实模型语义验收或人工质量判断。
