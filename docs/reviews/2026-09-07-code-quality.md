# BetterWork 代码质量与规范遵循审查

- 日期：2026-09-07；审查基线：`e39a854`。
- 范围：工程配置与结构护栏、协议/IPC/Preload、Agent/Provider/Tool、持久化与迁移、Knowledge/Evidence/Artifact、Renderer 状态与交互、测试及文档一致性。
- 方法：静态审查、完整质量门禁、使用合成数据的隔离实验。没有修改业务代码、产品数据库或用户资料，没有调用真实模型/搜索服务。
- 快照说明：开始时存在未提交界面改动；审查过程中由其他操作提交为上述基线。验证包含这些改动。

## 总体判断

工程基础较好，当前主要欠账是运行边界和行为回归。统一配置、严格类型、领域分层、事件持久化、版本化迁移和主题 Token 已形成有效约束；但“门禁通过”尚不能证明关键用户路径正确。建议先处理下面三个 P1，再收敛 P2，不建议因此引入大型框架或进行全仓重写。

P1 表示优先修复的权限或核心正确性问题；P2 表示应安排修复的可靠性、交互或规范问题。本报告没有确认到 P0。

## 验证结果与边界

| 项目 | 结果 | 能证明什么 |
| --- | --- | --- |
| `npm run verify` | 退出码 0 | lint、format:check、typecheck、test、build 全部成功 |
| Vitest | 21 个文件、133 个测试通过 | 已有断言通过，不代表分支覆盖率 |
| 结构护栏 | 17 条通过 | 当前扫描规则覆盖的配置、分层、Token 等约定通过 |
| 构建 | 成功；两条已知 Zod PURE 注释警告 | electron-vite 构建可用，尚不是安装包验证 |
| 隔离实验 | 符号链接越界、多工具丢失、搜索取消等待、Task/Session 错配、提前 EOF 均确认 | 使用实际源码转译执行或真实内存 SQLite；不触网 |
| 产品库只读连接 | 文档登记的应用库路径无法打开 | 不推断用户现有数据正常或损坏；未继续查询业务内容 |
| 开发日志 | 检查 `/tmp/betterwork-dev.log` 最近输出 | 看到成功开发构建与已知警告；不能代替运行验收 |

本次未做真实桌面全键盘/多主题验收、真实服务商兼容性测试、安装包验证或依赖漏洞数据库审计，也没有生成代码覆盖率百分比。UI 竞态等静态发现会明确标注，不能当作已完成桌面复现。

## 优先修复的发现

### 1. P1：文件工具可以通过符号链接读取工作区外文件

位置：[packages/tool-runtime/src/read-text-file.ts](/Users/kevin/Dev4AI/BetterWork/packages/tool-runtime/src/read-text-file.ts:21)

`path.resolve` / `path.relative` 只检查路径字符串，之后 `readFile` 会跟随符号链接。隔离实验在临时工作区建立 `link.txt -> ../outside.txt`，工具成功返回区外合成标记 `SYNTHETIC_OUTSIDE_MARKER`。这违反 Workspace 文件访问边界；真实模型调用工具时，区外内容还可能进入后续模型请求。

建议：对工作区与目标解析真实路径并校验包含关系，明确符号链接策略；同时考虑文件替换竞态。增加区内链接、区外链接、目录链接和正常文件的回归测试。当前仅有普通 `..` 越界测试。

### 2. P1：Main 直接信任 Renderer 提供的工作区路径，且未验证 Session 归属

位置：[apps/desktop/src/main/services/run-service.ts](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/main/services/run-service.ts:133)；[packages/agent-protocol/src/index.ts](/Users/kevin/Dev4AI/BetterWork/packages/agent-protocol/src/index.ts:75)

`StartRunRequest.workspacePath` 只是非空字符串，Main 直接把它传给工具。Renderer 可在调用时扩大根路径，而 Main 没有从已登记 Task → Workspace 关系加载根目录。这与架构文档“由 Application 从 Workspace 注入”不一致。此问题不依赖符号链接；修复第 1 项后仍然存在。

同时，Run 的 Task、Session 分别有外键，但缺少两者一致性校验。真实内存 AppStore 实验使用 Task A 与 Task B 的 Session 创建 Run，写入成功。

建议：Main 根据 Task 读取 Workspace 和 rootPath，验证 Session 属于该 Task；协议移除可由客户端指定的权限根，或至少拒绝与登记值不符的值。补跨 Task Session、伪造根路径和不存在对象测试。协议职责变化按仓库制度同步文档/ADR。

### 3. P1：一轮多个工具调用只执行最后一个，Run 仍成功

位置：[packages/agent-core/src/agent-engine.ts](/Users/kevin/Dev4AI/BetterWork/packages/agent-core/src/agent-engine.ts:71)

Provider 已支持按 index 组装多个调用，但 Agent Loop 只保留单个 `pendingToolCall`，每次赋值覆盖前一个。隔离实验返回 first、second 两个调用，记录为 `requested=[first,second]`、`executed=[2]`，最终 `run.completed`。前一个工作被静默丢弃，事件也没有相应工具终态。

建议：收集整轮调用并逐个串行执行，完整回传每个 tool result；这不要求多 Agent 或并行执行。若当前只允许单工具，应显式拒绝额外调用并在请求端声明限制，不能静默丢弃。补 Provider → Engine 的跨模块回归测试。

### 4. P2：模型流缺少超时，并把提前 EOF 视为正常完成

位置：[packages/agent-core/src/openai-compatible-provider.ts](/Users/kevin/Dev4AI/BetterWork/packages/agent-core/src/openai-compatible-provider.ts:68)

正式执行只传 `request.signal`，没有 docs/12 要求的 HTTP 超时。连接/流读取停滞时，Run 缺少应用定义的等待上限。`[DONE]` 被忽略，读取到 EOF 后无条件产生 `done`，也不检查 `finish_reason`。

合成响应只有一条 `partial` 文本事件，没有结束标记，实际输出仍是 `text-delta(partial), done`；Engine 随后会按正常回复完成。被截断的报告因此可能被当成完整成果。

建议：定义首包/流空闲超时、取消与截断语义；识别正常结束标记及完成原因，区分兼容服务的合法结束和异常中断；确保 reader 在退出时释放。补挂起流、提前 EOF、正常结束、长度截断、用户取消测试。配置表单与正式 Provider 的 endpoint 校验也应统一，目前仅连通性探测显式限定 http/https。

### 5. P2：网页搜索取消没有传到 HTTP，进度在结束后才发布

位置：[packages/tool-runtime/src/web-search.ts](/Users/kevin/Dev4AI/BetterWork/packages/tool-runtime/src/web-search.ts:40)；[apps/desktop/src/main/services/search-engine-service.ts](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/main/services/search-engine-service.ts:67)；[packages/agent-core/src/agent-engine.ts](/Users/kevin/Dev4AI/BetterWork/packages/agent-core/src/agent-engine.ts:107)

搜索函数签名只接收 query，Tool 仅开始前检查取消；HTTP 使用独立 20 秒 timeout。隔离实验在搜索开始后 abort，Promise 在响应释放前仍未结束。用户点击停止后仍可能等待服务响应或超时。

Agent 同时把 `tool.progress` 暂存在数组，等 `await tool.execute` 返回才 yield；长搜索过程中无法实时收到这条进度，失败分支还会丢弃已缓冲进度。

建议：把 Run 的 signal 传到搜索适配器并与 timeout 合并；定义工具进度的实时交付方式和取消后的事件顺序。知识批量导入同样没有执行中的取消协议，可作为后续长操作专项补齐。

### 6. P2：保存 Artifact 使用所有轮次的文本，而非最终回复

位置：[apps/desktop/src/renderer/src/App.tsx](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/renderer/src/App.tsx:165)；[apps/desktop/src/renderer/src/App.tsx](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/renderer/src/App.tsx:301)

`assistantText` 拼接整个 Run 的所有 `message.delta`，保存时直接使用该字符串。模型在工具前输出“我先检索资料”，工具后输出报告时，保存内容会混入前一轮的过程文本，且轮次间没有明确分隔。协议已有 `run.completed.finalContent`，但保存路径没有使用。

这是静态确认的数据流问题，尚未做桌面操作复现。建议把会话显示文本与成果正文的选取分开，保存完成事件的最终正文，并用“文本 → 工具 → 最终文本”补回归。

### 7. P2：成果版本加载失败在正常预览界面不可见

位置：[apps/desktop/src/renderer/src/hooks/use-artifact-viewer.ts](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/renderer/src/hooks/use-artifact-viewer.ts:64)；[apps/desktop/src/renderer/src/views/ArtifactView.tsx](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/renderer/src/views/ArtifactView.tsx:197)

版本列表/详情失败被写入 `error`，但唯一错误提示位于 `editing` 表单分支。用户正常查看历史版本时发生错误，页面没有可见反馈，违背统一异步收口的产品目的。交接文档关于“版本列表失败不再静默”的结论尚未在视图端完整兑现。

建议：把加载/切换错误呈现在预览与编辑都可见的区域，并提供重试；增加 IPC 拒绝后的组件测试。

### 8. P2：异步切换缺少过期响应保护，可能混用任务或版本数据

位置：[apps/desktop/src/renderer/src/App.tsx](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/renderer/src/App.tsx:270)；[apps/desktop/src/renderer/src/hooks/use-artifact-viewer.ts](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/renderer/src/hooks/use-artifact-viewer.ts:64)

`selectRun` 先切换 activeRunId，再等待旧请求返回并无条件 `setEvents`；`listVersions` effect 没有 cleanup/请求代号，`selectVersion` 也无归属或最新请求校验。快速切换 A、B，若 A 后返回，当前 B 可显示 A 的事件或历史版本。事件初始快照也可能覆盖等待期间收到的流式增量。

此项是静态竞态风险，未通过实际 Electron 乱序响应复现。建议给加载操作增加请求代号/当前对象校验，并对事件快照与增量按 id/sequence 合并；用受控 Promise 模拟倒序返回。发送与保存也应有请求进行中的防重入状态，避免快速重复操作创建多次 Run/版本。

### 9. P2：IPC 校验没有形成完整的输入输出闭环

位置：[apps/desktop/src/main/ipc/register-ipc.ts](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/main/ipc/register-ipc.ts:72)；[apps/desktop/src/preload/index.ts](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/preload/index.ts:12)；[apps/desktop/src/main/ipc/register-ipc.test.ts](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/main/ipc/register-ipc.test.ts:80)

`SelectWorkspace`、`ImportKnowledge` 仍直接调用 `ipcMain.handle`，绕过三种注册 helper；多数 invoke 返回值直接经过 Preload，只有 TypeScript 返回类型，没有输出 Zod 校验。输入/输出在边界校验的硬约束尚未全部落地。

当前 IPC 测试只有三条“通道齐全、合法、唯一”的注册断言，没有执行 handler，因此不会发现非法入参、返回形状错误、导出失败或归属判断问题。结构护栏只限制 `ipcMain.handle` 出现在哪个文件，也不能证明文件内每次注册都用了 helper。

建议：统一 request/response schema 注册映射，补非法输入、错误输出、导出取消/写盘失败/跨成果版本，以及来源打开白名单的 handler 测试。无需再建一套平行规范。

### 10. P2：资料移除重复确认，自定义 Dialog 缺少键盘焦点管理

位置：[apps/desktop/src/renderer/src/views/KnowledgeView.tsx](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/renderer/src/views/KnowledgeView.tsx:202)；[apps/desktop/src/renderer/src/hooks/use-knowledge-library.ts](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/renderer/src/hooks/use-knowledge-library.ts:97)；[apps/desktop/src/renderer/src/components/ConfirmationDialog.tsx](/Users/kevin/Dev4AI/BetterWork/apps/desktop/src/renderer/src/components/ConfirmationDialog.tsx:9)

视图先显示 `ConfirmationDialog`，确认后调用 `onRemove`；hook 中仍有 `window.confirm`，所以一次移出要再确认一次。这是确定的调用链问题。

自定义 Dialog 设置了 `aria-modal`，但没有初始焦点、焦点约束、关闭后焦点恢复或 Escape 处理，背景也未被 inert。键盘用户可能继续操作背景。此结论来自源码，未做真实键盘验收。

建议：确认职责只保留在界面一处；完善共享 Dialog 的键盘行为，补取消、确认次数与焦点测试。

### 11. P2：工程规范中的 SQLite 事务解释有事实错误

位置：[docs/12-engineering-standards.md](/Users/kevin/Dev4AI/BetterWork/docs/12-engineering-standards.md:130)

规范称 `foreign_key_check` 看不到同一事务内先前的 DELETE，因而不应在事务内使用。实际在同连接 SQLite 内存库构造孤儿行，BEGIN 后 DELETE，`pragma_foreign_key_check` 返回 0；ROLLBACK 后返回 1。该检查可以看到同一事务的修改。

现有“迁移前清理历史孤儿”的做法仍有价值，但不能用这条错误解释禁止最终完整性检查。当前迁移统一关闭外键，提交前没有最终 foreign_key_check；未来迁移若制造孤儿，重新打开外键不会自动拒绝已经存在的孤儿。

建议：先修正文档的事实说明；再考虑在每条迁移完成、打戳和提交前校验完整性，异常则回滚，并增加“迁移制造孤儿”的测试。不得修改已发布迁移来掩盖历史问题。

## 规范与维护改进建议

| 维度 | 当前评价 | 建议 |
| --- | --- | --- |
| 类型与格式 | 好；strict 四项、统一 lint/format、生产禁 any/非空断言通过门禁 | 保持现有标准，不另立风格 |
| 分层 | 主体清晰；Main 装配、Repository、Service、Core、Tool 职责已分开 | 优先补信任边界；不必提前拆 application package |
| 错误词汇 | 仍有局部 `describeError`（IPC、搜索服务）和多种手写 catch 文案 | 统一底层错误分类与展示转换；允许具体业务文案，但不要复制通用错误工具 |
| 自动化规则 | 结构护栏有效，但以字符串扫描为主 | 逐步覆盖动态 import、裸 Node 模块名、persistence → services 反向依赖及 helper 实际使用；AST 规则按需增加 |
| Renderer 可维护性 | App 726 行，CSS 3013 行；异步动作分布于 App 与 hooks | 先补行为测试，再按内聚状态拆任务加载/运行管理；文件长度本身不是缺陷 |
| 测试 | 协议/核心/数据库/纯函数已有保护；缺组件与完整 UI 旅程 | 先覆盖上述失败与竞态，之后建立 Fake Provider 的“导入→任务→保存→编辑→导出→重开”旅程 |
| 测试发现机制 | Vitest 只匹配 `.test.ts`、默认 node 环境 | 引入组件测试时同步纳入 `.test.tsx` 与所需环境，避免新增测试未被执行 |
| 持续集成 | 仓库未见 `.github` 工作流；现有 verify 是本地命令 | 若使用 GitHub，增加 PR 自动 verify；其他托管平台使用等价门禁 |
| 资源边界 | 文件工具全文读取后才截 20,000 字符；Knowledge 只有输入文件 20 MB 上限 | 后续补读取字节上限、解析后大小/时长限制；不把输出截断当内存限制 |
| 可观测性 | Run 持久化、启动中断收口已有实现 | 区分存储失败与广播失败；`start` 在写库前登记 activeRuns，写库失败的条目应清理 |
| 文档 | 多处已过时/冲突 | docs/11“无 IPC 测试”改为“只有注册测试”；20/131 更新或取消手工计数；Dialog 状态更新；AGENTS 当前切片与 ADR-0007/路线图的 Web Search 范围对齐 |

不应把尚未排入当前切片的 Embedding、完整 Memory、DOCX/PPTX、审批流等列为代码缺陷。已有 API Key 本地明文存储是文档明确记录的取舍，本次也不将其包装成新发现；变更时另立 ADR。

## 建议讨论的实施顺序

1. 权限与执行正确性：第 1–3 项，每项配最小回归测试，保持聚焦提交。
2. 运行可靠性：第 4–5 项，统一流完成、超时、取消、进度语义。
3. 成果与界面：第 6–8、10 项，同时建立首批组件/受控异步测试。
4. 规范闭环：第 9、11 项，补 IPC 行为测试、迁移完整性与文档修正；再接 CI 和端到端旅程。

优先按风险闭环推进，避免先做大规模目录搬迁或仅增加测试数量。讨论后再实施修复；本次交付仅为报告与审查日志。
