# MCP 多传输与 OAuth 实现证据

- 范围：用户已审阅设计并批准 D1–D5，授权继续编码；[ADR-0043](../adr/0043-mcp-multi-transport-and-oauth.md) Accepted。
- 代码：`codex/mcp-connections`，基点 `14252db`（已含 PR #15）；下列验证执行时为未提交工作树，本地实现随后提交为 `9479562`。用户已授权推送与合并，实际最终版本及合并结果以 Git/PR 记录为准，不能把基点 SHA 当作实现提交。
- 平台：本机 macOS arm64。测试使用临时/内存 SQLite、确定性 HTTP 替身和 AI 创建的本地夹具进程/loopback 回调；未访问真实业务 MCP/OAuth 账号，未调用真实模型，未修改产品数据库或启停用户应用。
- 状态真相：[CF 任务板](../development/tasks-capability-foundation.md)。CF30–CF32/CF40–CF41 代码与自动化已落地，真实存储/业务及用户验收未关闭；CF33/CF42 保持 partial。

## 已实现

| 范围 | 行为与验证入口 |
| --- | --- |
| 接入与协商 | stdio、Streamable HTTP、旧 HTTP+SSE；官方 SDK 2.0.0 的明确 auto/legacy 协商；2026-07-28 与旧 stdio/HTTP/SSE 报文，JSON/SSE 结果；HTTP 兼容回退默认关闭，仅握手 404/405 可用，401/业务调用不回退、不重发 |
| 网络 | 公网/私网 HTTPS、显式字面 loopback HTTP；授权精确 host/port；DNS 全答案校验与实际 socket pinning、mapped IPv6/特殊地址/混合 DNS/重定向拒绝；OAuth 认证目的地单独授权；每消息/SSE event 1 MiB 上限 |
| OAuth | 先发现并确认 issuer/scope，再系统浏览器；PKCE S256/state/RFC9207 issuer/resource；预注册、真实已有 CIMD、DCR native、缺注册信息修复；临时或固定 loopback 回调，取消/晚回调/CAS 竞争不能落库 |
| 凭据 | Main-only safeStorage；owner/issuer/resource 加密 bundle；keep/replace/clear 与 expectedVersion 原子保存；配置 CAS、refresh 合并与轮换、invalid_grant 重新登录、退出登录/移除清除机密；不返回秘密，不把远端错误正文带到失败消息 |
| 迁移与历史 | v45 从旧 v44 保留连接 ID/stdio command/args/cwd、专家/任务/Run/Evidence/成果；新修订不可变、旧目录 stale、不补造审阅；运行绑定保存修订/hash/alias/凭据版本，移除归档保留历史 |
| 工具与执行 | 具体只读合同审阅；确定性 canonical hash；每 Run 重发现并校验，变化/未审阅/破坏性工具在模型前拒绝；本地 input/output Schema 校验、拒绝远程 ref；最多 200 工具/50 选择/100,000 字符结果；input_required 明确失败 |
| 取消与清理 | Run-owned client，测试独立，旧检测不能覆盖新目录；模型派发前取消也只有一个取消终态；stdio guardian 管探测/服务/子孙，过滤宿主环境并消费固定清理回执；legacy HTTP 有界 DELETE，405 正常收口、失败可见；现代 HTTP 不使用协议会话 |
| 设置与接线 | 新建/编辑、启停、登录/退出、检测/取消、审阅/选择、更多菜单；草稿保留、机密掩码、键盘/Escape/焦点；短保存 TransientToast、就地 InlineError、长操作消息中心，正常取消不报失败；帮助手册已同步 |

预算：连接 10 秒、完整检测/发现 30 秒、调用 60 秒、OAuth 登录 5 分钟、HTTP header/token/refresh 30 秒，legacy session DELETE 3 秒。进度不延长硬限，运行期不弹浏览器、不扩权、不自动恢复失败 Run。退出登录只声明本地授权清除，不声称远端已撤销。

## 自动化证据

本轮按 ADR-0042 运行相关检查，没有运行完整 `npm run verify`。命令、退出码及最终读数在下方收口；相关源码单测包含 migration/repository/credential/client/HTTP/network/OAuth/contract、协议/IPC/Preload、设置/Hook/selection，以及 Run/App/mac supervisor/UI CLI。

已取得的重档证据：`npx vitest run --project heavy` 定向四文件（Run/App/mac-process-supervisor/UI CLI），退出 0，4 文件/139 测试。后续服务收尾变化另补相关回归，不用旧成功覆盖新改动。

日志位于本机 `/tmp/betterwork-mcp-functional.log`、`/tmp/betterwork-mcp-boundaries.log`、`/tmp/betterwork-mcp-heavy.log`、`/tmp/betterwork-mcp-build.log`；最终门禁结果记录在本节末尾。

### 04:25 最终定向门禁

| 检查 | 当前代码的结果 |
| --- | --- |
| 本轮 TS/TSX/MJS 文件 ESLint | 退出 0 |
| 本轮可格式化源文件 Prettier check | 退出 0；package-lock 按仓库约定忽略 |
| `git diff --check` | 退出 0 |
| `npm run typecheck` | 退出 0 |
| 功能档明确指定 15 个相关文件 | 退出 0，235 测试；含新增静态 Bearer/API Key 请求头与目录回声脱敏、加密授权在新 service 恢复、guardian 清理失败回执 |
| 重档重新检查 Run 与 mac supervisor | 退出 0，2 文件/86 测试；App/UI CLI 另已通过 4 文件/139 测试中的对应项，未受最后服务收尾改动影响 |
| `npm run build` | 退出 0，当前 Main/Preload/Renderer 与更新后的帮助内容均构建成功 |
| `npm run docs:check` | 退出 0，154 个结构/文档护栏；证据追加后的文本复核也通过 |

收口检查曾拒绝 finally 中抛错、重复定义取消名称，以及 ESLint 导入排序后的格式变化；已按原规范修正，使用现有 isAbortError，不放宽规则或加入豁免。清理失败判断位于 finally 后，始终释放 client。最终通过对应 `/tmp/betterwork-mcp-final-{lint,format,diff,typecheck,functional,heavy,build}.log`，副本位于附件目录。

04:25 执行 `git fetch origin main` 退出 0，远端仍为 `14252db`；当时 `HEAD...origin/main` ahead/behind 为 0/0，任务基线未落后。当时没有提交、自动 stash/rebase 或合并用户工作树。最终生产源文件与测试/帮助共 42 个文件的 SHA256 清单位于附件目录 `source.sha256`，清单 SHA256 为 `caef87000fd89e2ee4ae7d7986fd6e0215e89cff90c3152482f547301831b258`，用于区分已验证实现与基点 SHA。06:25 本地提交前重新核对，42 个文件均与该清单一致。

### 06:49 PR 首发失败与修正

[PR #16 首次 CI](https://github.com/gyzhang/BetterWork/actions/runs/37855163747) 对 HEAD `f19646b` 的 lint、format、typecheck 与 docs:check 均通过，功能档 226 文件/1975 测试中仅专家服务的重复 MCP 绑定错误码断言失败（1974 通过）；重档因前序失败未运行，PR Gate 未通过。

根因在 Schema 与服务边界：新增共享 Schema 提前拒绝重复选择，导致 ExpertService 直接抛出 ZodError，原有 `expert_invalid_mcp` 未保留。已在本地复现，随后让服务把 MCP 字段校验失败转换回现有错误码，保留 cause，移除不可达的重复检查；没有放宽 Schema 或旧断言。补混用连接修订的保存回归，核对拒绝后原专家修订与绑定不变，重复创建失败不留专家记录。

修正后专家服务、共享协议、IPC 三文件/117 测试、typecheck、定向 ESLint/Prettier 与差异空白检查均退出 0。上述初始 42 文件指纹只对应最初实现；本次另修改专家服务及其测试，最新 SHA 的 CI 结果以 PR 记录和交接为准，不能用首次失败的其他绿灯代替新版本门禁。

## AI 页面走查

`UI_RENDER_OUTPUT_DIR=/tmp/betterwork-mcp-ui node scripts/ui-render-check.mjs --mcp-only` 退出 0：8 组（青玉明暗 × 760/1380px × 普通/减少动效），每组 9 步，共 72 截图。覆盖列表、新建、HTTP/API Key 字段切换、机密输入、保存失败保留草稿、返回、issuer/scope 审阅、登录失败与更多菜单。正文最小字号读数 12px、无横向溢出，反馈有实际绘制。生产组件使用合成状态，覆盖标识为 `production-page-with-synthetic-state`，不能称为完整 App/真实服务验收。

AI 已打开回看本轮窄窗深色保存失败、宽窗浅色授权确认与机密输入截图：失败就地靠近保存操作，草稿/掩码仍在；授权服务器、权限与继续/取消动作可读。更多菜单的 Escape/焦点恢复另有组件测试。没有用纯 DOM 成功代替截图回看。

完整读数在 `/tmp/betterwork-mcp-ui/results.json`；选定截图与读数副本保存到本机 `/Users/kevin/.codex/attachments/mcp-implementation-20261009/`，未提交构建/截图产物。原可视化站点保留原文件与沙盒/CSP，未随实现改写。

## 待用户与真实环境验收

| 项目 | 当前证据边界与操作 |
| --- | --- |
| 真实 stdio 业务 | 提供业务 server，保存→检测→审阅→启用→专家/任务明确选择→调用；核对 Run/Evidence、合同变化、取消、退出/重启。如试用有副作用的工具，只使用用户确认范围内的动作并记录服务端影响。CF33 不因离线夹具通过关闭 |
| 真实 HTTP/SSE | 用实际服务分别确认 modern/legacy、鉴权与断线；只在服务说明需要时开启旧 SSE 回退。CF42 仍 partial |
| 真实 OAuth | 提供账号/服务注册条件，在设置审阅 issuer/scope 后浏览器登录；核对取消、拒绝、缺注册信息、权限不足、登出及重新登录；无法提供有效 CIMD/预注册的服务不保证可直接登录 |
| 真机存储/重启 | 在开发态及签名安装态核对 Keychain 可用/锁定、密文授权重启恢复、refresh rotation、登出/移除后不再使用旧 token。注入加密 adapter 的测试不替代真实 safeStorage 验收 |
| 用户窗口 | 确认日常宽度/主题下新建三种协议、保存失败草稿、登录确认/取消、合同审阅、有副作用工具的单项/批量授权及取消、启停与失效选择修复；AI 页面矩阵是辅助证据 |
| 跨项目原验收 | CF12/A/B0/E 的真实模型、签名与连续两期验收保持独立；本轮不提升其他 Proposed ADR，也不关闭其他任务卡 |

用户已授权 BetterWork 本地提交、推送与合并；产品发布尚未执行。实际 PR 门禁与合并结果由 Git/PR 记录及交接报告补齐，不能用本地成功代替 CI 结论。实现不包含 Resources/Prompts/sampling/elicitation、写型工具、Tasks/MCP Apps、公开市场、云代理或新 Agent 引擎。

## 2026-10-09 有副作用工具授权补充

用户确认写入和破坏性工具在明确承担风险时应可用。实现由 [ADR-0044](../adr/0044-mcp-explicit-side-effect-tool-authorization.md) 补充；上方“原实现不包含写型工具”保留为本轮早先实现范围记录，不再表示当前产品限制。此项代码交接没有调用真实有副作用的 MCP 工具，用户窗口和真实服务行为待验收。

## 07:57 用户实机重试后的补充

- SQLite：`filesystem` ready、14 个工具；`memory` 与 `sequential-thinking` 仍记录 10 秒连接超时；`fetch` 当前命令为 `uvx mcp-server-fetch`，尚未检测。
- 修正：stdio 冷启动/握手预算 60 秒，完整检测/发现 90 秒；HTTP 连接仍为 10 秒。此预算调整已同步 MCP 设计与 CF41。工具合同预览使用全宽、14 行只读区。
- 待验：新时限生效后的真实包安装/握手、`fetch` 可用性与用户界面观感由开发应用中的人工复测确认；本补充不把真实 MCP 验收标为通过。
