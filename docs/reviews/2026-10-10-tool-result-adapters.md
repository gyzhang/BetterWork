# C3：Run 工具结果适配

2026-10-10 02:33，用户授权继续 C3。从干净 main `de6f9c7be508e5d53cef60b866e0cc8d1a2e7e29` 建立 `codex/review-tool-result-adapters`，使用原 checkout，不新建 worktree。

## 边界与失败契约

同一结果的事实、读取足迹和 Evidence 原先各自按工具名和手写守卫解析。本次在同一 Application 层增加具名结果契约与小范围适配器；Core 的 `Promise<unknown>` 和事件协议保持，消费者只调用一次适配入口，不增加 package、IPC、Schema 迁移或事件总线，无需新增 ADR。

结果 Schema 定义宿主实际消费的字段，接受无关附加字段，不用截断/变换悄悄改模型可见原结果。Text、Artifact、Office、Knowledge、Web、任务文件结果只校验一次再使用；经营分析按确定性结果形状核查，事实输入仍序列化原结果。MCP 的任意业务结果继续作为不透明值序列化，不推断本地材料事实；未绑定 MCP 维持不登记来源的行为。calculator、Skill 资源/执行、成果登记/采用声明由原工具回调负责自己的行为，明确无额外结果副作用。

已适配工具的非法结果、缺失工具名和未知工具名抛出含工具名/字段位置的契约错误，不附原始正文。已落库的 tool.completed 保留，编排层既有 catch、清理和 forceFailure 负责 Run 失败终态；非法结果不登记事实、读取或来源。此处落实 R12 的明确失败要求，不删除防护或扩展业务质量验收。

## 保持的顺序与身份

- 事件先持久化，再适配结果，再广播；Markdown 写入跟踪、事实采集、读取足迹、Evidence 的顺序保留。
- KnowledgeAudit 在工具执行回调内同事务写 Evidence 与精确足迹；适配器只核验 Evidence 的 Run 归属，不补造或重复插入。事实池只用返回的 excerpt/parts.text。
- Text 保留材料身份匹配与旧路径回退、内容哈希限制、工作文件排除、空/多片段的 read/parse 差别；Artifact 保留 ID/版本/哈希同时匹配；Office 保留当前身份匹配和 locator/摘录哈希规则。
- Web/MCP 继续使用原来源 URI、locator、截断与哈希规则，不自动成为私有材料读取。Markdown 只跟踪 .md 工作文件，正式成果继续在 Run 成功和审计/清理后登记。
- 取消、迟到结果、撤权、来源采用、成果登记和通知/定时终态编排保持；终态职责整理留后续切片。C2 的启发式许可限制不在 C3 改写。

## 验证与状态

开始治理巡检的规范/例外/规模正常（护栏 154、例外 203），只要求本批新增日志。将验证结果契约、非法结果零副作用、材料匹配/哈希、空片段、Knowledge 来源复用、Web/MCP 摘录与 Markdown 跟踪，再跑现有 RunService 与相关集成回归。完整 verify 不自动触发，不调用真实模型、不访问用户数据库或启停用户应用；精确 SHA 的 PR Gate 与合并事实完成后追加。


2026-10-10 02:42 本地证据：契约 43 项、真实 SQLite 适配 23 项通过；相关功能合计 8 文件 / 320 项、RunService heavy 84 项，去重共 9 文件 / 404 项。回归覆盖单次解析、工作文件排除、路径回退/哈希、空/多片段、成果版本身份、Office 值与元数据区别、Knowledge 来源复用和跨 Run 拒绝、Web/MCP 哈希/去重及 Markdown 跟踪。新增 malformed web_fetch 的端到端回归在旧实现中以 completed 结束而失败，恢复新入口后通过；临时探针日志 `/tmp/betterwork-c3-malformed-probe.log` 不提交。

初次静态检查发现仍供材料清单使用的 Office 格式判断误随输出守卫移除，已恢复原函数。新增夹具/断言先后修正 originWorkspaceId、参数化 sections、终态筛选、MCP 既有去重及仓储 API/成果类型收窄；没有放宽产品 Schema、数据库约束或失败断言。typecheck、定向 lint/format 与生产 build 通过，最终应用、文档/治理和最新 SHA 的 PR Gate 继续核对。


2026-10-10 02:44 本地终检：docs:check（154 项）、差异空白与原批次基点的 drift:check 通过，读数已保存，护栏 154、例外 203 和规则指纹保持。app-only 一组真实 App/Preload/IPC/临时 SQLite 旅程通过，4 个 Run、失败/取消和窗口销毁后重组服务恢复，网络尝试 0；AI 已查看首次完成与失败截图。证据在 `/var/folders/kq/ts17kvnd5yg2kjtkx645y1zw0000gn/T/betterwork-ui-render-9m07Si`。不代表完整 UI、真实模型或安装态验收，最新源 SHA 的 macOS PR Gate 与合并继续收口。
