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
7. 第二期仅读取当前工作空间下该 Expert 的已确认方法记忆；同一 Expert 在其他工作空间的记忆被排除，并将实际读取写入 `run_memory_reads`。
8. 第二期通过独立 Task/Session/Run 发起，提交给模型的消息只包含第二期目标，不携带第一期对话；两期仍固定同一 Expert 修订。

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

## 2026-09-15 最新端点复核

- 未携带凭据请求 `http://10.62.64.38:30808/api/inference/v1/models`，6 秒上限内返回 0 字节（curl exit 52，约 5 秒）；认证探测也得到同样的空响应。
- E55 继续保持 `partial`；本次未把失败探测写成成功运行或连续两期业务证据。

## 2026-09-15 验收预检 CLI

- 新增 `npm run expert:acceptance-preflight -- --model-url <url> --skip-signing`，模型端点检查使用 5 秒取消边界；可选从指定环境变量读取 API Key，不在输出中显示密钥。
- 当前端点执行预检返回“模型端点在 5000ms 内无响应”，退出码 1；E55 仍保持 `partial`。

## 2026-09-15 真实材料与网页旅程（模型服务恢复后）

- 使用 BetterWork 开发窗口从“专家 → 研究分析专家 → 召唤”直接进入工作台；没有出现启动前任务准备表单。为避免触碰公司资料，本次只在本机临时目录创建三份脱敏 Markdown：财务规则、2026-08 报告和 2026-09 数据，验收结束后删除目录。
- 在同一 Task 中显式添加三份工作区文件，并把用途分别设为“规则口径 / 历史对比 / 本期输入”。真实 Run `55713063-1fbe-41d2-938b-ad8a18fc097c` 完成，SQLite `run_context_snapshots` 保存 `builtin-research-analyst` 与修订 `88c4ef3a-42bf-4d9f-b33c-30ff93942aae`；`run_material_reads` 记录 3 条读取足迹。
- 该 Run 的工具请求实际为 3 次 `read_text_file` 和 1 次 `analyze_business_metrics`。界面输出与脱敏材料一致：9 月收入 120、预算 110、8 月收入 100，预算差异 +10（+9.09%），环比 +20（+20%），并给出现金流回款时点和续约客户动作。
- 第二次真实 Run `c13516ff-2030-4854-a695-c565c2150359` 实际调用 `web_fetch`、`web_search` 和再次 `web_fetch`。Investopedia 返回 HTTP 403 后，专家通过搜索切换到 Microsoft Learn；最终正文读取成功，Evidence 记录了 `https://learn.microsoft.com/en-us/dynamics365/finance/cash-bank-management/cash-flow-forecasting` 的标题、最终 URL 和 HTTP 200。
- 取消/重启走查也完成：Run `eb2fac48-f633-4d14-b297-9edcca697336` 在界面点击“停止”后以唯一 `run.cancelled` 终态收口；同一 Task/固定上下文随后重启为 Run `b9bf6d15-3975-45f4-a046-7fd0460b3a43` 并得到 `run.completed`。两个 Run 都保留同一 Expert 修订快照。

### 仍未通过的边界

- 本次没有配置真实 MCP 连接（`mcp_connections` 当前为空），因此不能把离线 MCP 替身升级为真实业务 MCP 验收；E55/E4 保持 `partial`。
- 重启 Run 的模型回复混入了脱敏材料中不存在的现金流和续约数字（例如 5/15 万元、3/5 个客户）。该回复没有被计入业务结论，暴露出同一 Task 历史对话在重启时仍可能诱发模型使用未核实数字；需要后续增加基于材料读取足迹的事实约束/引用门禁后，才能把“连续两期真实业务闭环”标为通过。
- 当前凭据下 `expert:acceptance-preflight` 的模型检查已经通过；`security find-identity` 仍找不到 Developer ID Application，因此 E56 的签名安装验收继续保持 `partial`。

## 2026-09-15 选定材料清单修复与独立任务复测

- 修复 `RunService`：每次带材料范围的 Run 都向模型注入稳定的材料读取清单，包含工作区相对路径、材料用途和精确的输入快照 ID；清单明确要求只使用选定材料，并在无法读取或缺少数字时停止猜测。补充回归测试验证 Markdown 路径、快照 ID、读取工具和用途均进入模型请求。
- 修复前的独立 Task `287a3d5c-602c-4661-8f68-acca87a1e549` / Run `69a41a1f-70ee-46e4-8f9f-07ca8c2f2da8` 已证明缺口：材料快照虽然写入 `run_context_snapshots`，模型却自行构造 `snapshot1/2/3`、`artifact1/2/3`，没有产生材料读取足迹。
- 重启桌面主进程加载修复后，以同一 Task 的固定材料范围重新执行 Run `31813b3b-a6dc-4306-bd08-d5f439d0e747`，状态为 `completed`。SQLite `run_context_snapshots` 保存 `builtin-research-analyst`、修订 `88c4ef3a-42bf-4d9f-b33c-30ff93942aae` 和三份材料用途；`run_material_reads` 精确记录以下三条成功读取：
  - `e55-samples/financial-rules.md`（规则口径，快照 `766981ac-54b4-452d-8bf1-8f1ab923216b`）；
  - `e55-samples/2026-09-report.md`（历史对比，快照 `99a8afb5-7d6f-4251-9228-04cca22f78f8`）；
  - `e55-samples/2026-10-data.md`（本期输入，快照 `a0da2ecc-b778-4e14-9ccf-88218cf5b245`）。
- 工具足迹为三次 `read_text_file`、一次 `analyze_business_metrics` 和一次 `task_write_file`。界面最终输出 10 月收入 130、预算 125、9 月收入 120、费用 60/58，计算出预算差异 +5（+4.0%）和环比 +10（+8.33%），并只引用材料中出现的回款延期与续约待确认事实；输出的五页 PPT 摘要结构可继续交给成果/PPT 流程。
- 这次复测证明“召唤专家 → 选择材料 → 按范围读取 → 调用方法工具 → 输出摘要”的路径已真实接通。E55 仍保持 `partial`：当前任务还没有配置真实业务 MCP，且前述跨 Run 重启的事实约束问题尚未通过独立门禁；E56 的 Developer ID 签名条件也仍未满足。

## 2026-09-15 重启上下文事实边界加固

- `RunService` 现在把材料清单放在同一 Task 的历史用户/助手消息之后、当前用户请求之前，并明确声明旧助手回复不是本次 Run 的证据；每次重启仍必须重新读取当前清单材料。
- 增加回归断言，确保清单消息位于当前请求前的最后一个上下文段，避免历史报告中的数字遮蔽本次材料约束。`run-service.test.ts` 定向 40 项和全量门禁均通过。
- 这项修复是事实边界的提示与上下文顺序约束，尚未宣称逐句事实门禁；E55 仍需独立的跨 Run 输出审计和真实 MCP 连接后才能升级状态。

## 2026-09-15 材料事实边界复测

- 在材料清单约束中补充了具体禁止项：不同期间客户数不得相加；“本期未提及”不得解释为已续约或已流失；材料未提供的客户数、金额和确定性结果必须写“材料未提供”。
- 同一 Task 的复测 Run `b67a7b4d-9863-405c-9b86-7647539d31dc` 完成，先读取三份相同快照并调用 `analyze_business_metrics`。输出明确保留 9 月 2 家与 10 月 1 家为两个期间事实，没有合并成 3 家；对费用预算、客户总数、延期回款金额、11 月预测及 9 月客户后续状态均标记为材料未提供或不可推断。
- 这次复测改善了实际输出的事实边界，但约束仍通过模型指令实现，尚未形成逐句可计算的硬门禁；E55 继续保持 `partial`，真实 MCP 和安装签名条件也未改变。
