# 专家连续两期验收记录（合成数据）

- 日期：2026-09-14
- 范围：E55 自动化验收切片；不包含公司的真实财务资料。
- 专家路径：研究分析专家 → 经营分析方法 Skill → `analyze_business_metrics`。

## 已核验

1. 第一期开立独立 Task/Session/Run，保存 2026-08 报告版本。
2. 第二期开立不同的 Task/Session/Run，输入当前收入 120、对比收入 100；确定性工具返回变化额 20、变化率 0.2。
3. 第二期报告版本通过 `ArtifactInputRelation` 关联第一期精确 Markdown 版本，来源关系为 `comparison`；历史版本仍可读取。
4. 第二期 `DiscussionCheckpoint` 关联报告版本，第一期任务查询不到第二期节点，证明任务和上下文未串联。
5. 经营分析 Expert 修订保存第一期 ArtifactVersion 作为常用参考；第二期 TaskContext 固定同一 Expert 修订，并以 `expert-reference` 来源注入第一期精确版本。
6. 第二期 Run 的 `RunContextSnapshot` 直接保存 `expertId + expertRevisionId`，因此即使 Task 草稿继续编辑，历史运行仍能回溯实际采用的专家修订。

自动化证据位于 [`expert-two-period-acceptance.test.ts`](../../apps/desktop/src/main/services/expert-two-period-acceptance.test.ts)。真实桌面验收仍需在 macOS 上用脱敏的规则、上期 PPT 和本期表格执行 E55 路径，并记录人工核定数值、网页/MCP 来源和取消/重启操作。自动化测试覆盖 Expert 绑定，但不替代真实窗口走查。

## 限制

本记录不把合成数据当成公司的经营结果；没有把任何公司材料、密钥或外部账号写入仓库。真实两期验收完成后，应在本文件追加脱敏步骤和 SQLite 关系证据。

## 2026-09-15 条件复核

- CUA 桌面状态仍返回 macOS 锁屏，自动解锁失败；因此没有启动开发或安装态 App，也没有读取或操作用户窗口。
- `http://10.62.64.38:30808/api/inference/v1/models` 在 4 秒连接/读取超时内返回 0 字节（curl exit 28），模型端点仍不可用于 B00-5 双 Skill 成功运行、取消走查或 E55 真实连续两期。
- E55/E56 继续保持 `partial`，下一步是用户解锁 macOS 并提供可用模型端点后，按本记录的脱敏路径补做人工证据。

## 2026-09-15 01:21 条件复核

- CUA 再次返回 macOS 锁屏，自动解锁失败；真实窗口仍不可操作。
- 模型端点 `http://10.62.64.38:30808/api/inference/v1/models` 再次在 4 秒连接/读取超时内返回 0 字节（curl exit 28）。
- E55/E56 继续保持 `partial`；本次未生成新的业务验收证据。

## 2026-09-15 01:34 条件复核

- CUA 仍返回 macOS 锁屏，自动解锁失败；浏览器请求头策略也未能加载，无法进行真实窗口或网页旅程。
- 模型端点 `http://10.62.64.38:30808/api/inference/v1/models` 在 4 秒超时内返回 0 字节（curl exit 28）。
- 本次只记录阻塞状态，没有把离线 MCP 替身和自动化测试升级为真实业务验收。

## 当前条件复核

- CUA 能看到 Chrome 标签页，但原生 macOS 窗口仍处于锁屏状态，无法启动或操作 BetterWork Electron 窗口。
- 模型端点 `http://10.62.64.38:30808/api/inference/v1/models` 仍在 4 秒内无响应（curl exit 28）。
- 因此真实两期 Run、取消/重启、MCP 业务调用和安装态旅程仍没有可记录的新证据。

## 2026-09-15 真实窗口召唤走查

- CUA 已确认 macOS 解锁并启动开发态 Electron 窗口；从“专家”列表点击“研究分析专家 → 召唤”后，工作台显示当前专家和“经营分析方法” Skill，未出现任务准备表单或二次确认页。
- 使用脱敏的经营分析输入启动一次真实 Run；界面先进入“进行中”，随后进入“失败”，消息中心显示具体原因：`无法连接模型服务（http://10.62.64.38:30808/api/inference/v1）：fetch failed`。SQLite `run_events` 同步记录 `run.started → run.failed`，Run 终态完整。
- 本次走查证明专家召唤和失败反馈已真实接线；模型服务不可用，因此不把该次 Run 记为连续两期业务成功，E55/E56 继续保持 `partial`。

## 2026-09-15 认证探测补充

- 使用当前语言模型配置的本地凭据发送认证请求，凭据未写入日志；模型端点仍返回空响应（curl exit 52，约 5 秒）。
- 因此 E55/B00-5 的成功模型执行、工具活动、取消与重启后继续仍没有可升级为通过的新证据。
