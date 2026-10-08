# 设置中的 MCP：多传输接入与 OAuth

- 日期：2026-10-08。
- 状态：用户已确认推荐方案 D1–D5，授权继续编码实现；实施状态以 CF 任务板为准。
- 用户需求：设置中的 MCP 支持本地和远程 MCP server、不同传输方式；用户明确选择本次同时支持 OAuth 浏览器登录。
- 实现基线：`main` / `codex/mcp-connections` @ `14252db`（已纳入 PR #15 的设置动作规范）。
- 决策记录：[ADR-0043](../adr/0043-mcp-multi-transport-and-oauth.md)。现有 CF 系列状态仍只在[能力基础任务板](../development/tasks-capability-foundation.md)维护。

## 1. 用户得到什么

设置 → MCP 保留现有入口。用户可以添加命令启动的本地服务，也可以通过 URL 连接本机、内网或公网运行的 MCP 服务；配置好后检测连接、登录、查看工具，再为专家或当前任务选择具体工具。

这是 BetterWork 作为 MCP 客户端接入已有 server 的范围。服务所在机器与传输类型是两个维度：本机服务也可以使用 HTTP；远程服务不等于另一种 MCP 业务协议。

| 设置中显示 | 配置内容 | 对应协议与兼容行为 |
| --- | --- | --- |
| 本地命令 · stdio | 可执行文件、参数、可选工作目录、普通环境变量与机密环境变量 | 优先探测 `2026-07-28`；按官方规则兼容使用 initialize 的旧服务 |
| HTTP · Streamable HTTP | 精确服务地址、认证方式、网络范围 | 支持 `2026-07-28` 及旧 Streamable HTTP；处理 JSON 与请求内 SSE 两种响应 |
| 旧版 SSE · HTTP+SSE | 精确 SSE 地址、认证方式、网络范围 | 明确标为旧服务兼容；使用旧握手与双端点传输 |

不把 Streamable HTTP 中的 SSE 响应误标为旧 HTTP+SSE。协议版本自动协商，诊断中展示实际版本；用户只需选择传输方式。未知自定义传输、WebSocket 不列为已支持。

HTTP 首次连接可在高级选项中开启「兼容旧 SSE 服务」；默认关闭，明确选择旧 SSE 同样可用。仅握手阶段、仅官方兼容条件允许回退；401/403、证书错误、DNS/超时不得触发协议回退。工具调用中绝不换传输重发。

## 2. 已核对的官方基线

官方 specification 当前指向 `2026-07-28`。相比 `2025-11-25`，新版本移除了 initialize、协议会话、独立 GET 通知流和 Last-Event-ID 恢复；请求携带版本/客户端能力元数据，HTTP 同步必需头；发现使用 `server/discover`。结果有 `resultType`，需要额外客户端输入的结果不能误当普通工具成功。

现有锁定依赖 `@modelcontextprotocol/client@2.0.0` 的实际安装源码和声明已核对：提供 `ClientOptions.versionNegotiation`、`getProtocolEra`、`getNegotiatedProtocolVersion`、`StreamableHTTPClientTransport`、`SSEClientTransport`、`OAuthClientProvider`、`auth` 和可注入 fetch。**默认版本模式仍为 legacy**，实现必须明确设置自动协商，不能依据包版本声称已支持新规范。

声明核对不等于运行验收。落地时必须分别证明现代 stdio/HTTP、旧 stdio/HTTP/SSE、OAuth 的实际报文、取消和失败路径。保留依赖锁，不为添加设置选项盲目升级 SDK；如实际测试发现缺口，先记录具体 SDK 行为与方案，再决定升级或适配。

## 3. 设置页交互

### 3.1 列表

标题「连接外部工作能力」，说明改为「接入本地或远程 MCP 服务，登录并检测后，为专家和任务选择工具」。空态说明三种连接方式，主动作仍为「新建连接」。

每条连接展示名称、传输标签、脱敏的命令或地址、启用状态、登录状态、检测状态、已发现工具数及最后检测时间。协议版本、服务声明、诊断和工具详情放在展开区；初次读取失败保留重试出口，不能显示成空集合。

行内动作：检测／登录或重新登录／编辑／更多。停用、退出登录、移除在更多菜单中；移除需说明受影响的专家/任务/活跃 Run，保留历史身份。成功检测不自动启用，也不自动选择工具。

### 3.2 编辑

复用现有设置表单与组件基座。先选连接方式，再显示必要字段；高级字段用现有 Disclosure 收起。表单采用「取消 / 保存」，沿用 PR #15 的主次按钮、布局和反馈规则。

- stdio：名称、启动命令、参数（每行一个，保持参数原文，不能 shell 拼接）、可选工作目录；高级项为环境变量。普通值与机密值显式区分，机密值只写不读。进程使用最小运行环境，不继承整个父进程环境。
- HTTP/SSE：名称、服务地址、认证方式。地址 placeholder 分别为 `https://example.com/mcp` / `https://example.com/sse`，不猜测或自动拼接路径。
- 无认证：不展示密钥输入。
- Bearer Token：一个机密输入；保存后只显示「已配置」，空白编辑表示沿用，清空是独立动作。
- API Key：合法自定义请求头名及机密值；Authorization 由 Bearer 模式负责。禁止 Cookie、传输控制头和 CR/LF。
- OAuth：默认自动发现；「保存后登录」在保存后出现。高级项支持绑定授权服务器的预注册 Client ID、可选 Client Secret、可选 Client ID Metadata Document URL；私有配置需要精确 issuer，不能让同一 Client ID/Secret 被不同 issuer 复用。

「保存」只保存配置，不启动进程、不联网、不打开浏览器。检测不调用业务工具。草稿检测如后续加入，也必须独立且不能隐式保存凭据；本轮先做已保存配置的检测，避免扩大表单语义。

### 3.3 登录、检测与反馈

1. 保存 OAuth 连接后点击「登录」。
2. Main 发现受保护资源与授权服务器，页面显示服务地址、授权域名和请求权限。多个 issuer 由用户选择；单一 issuer 也不能默许未来更换。
3. 用户点击「在浏览器中继续」，使用系统浏览器完成服务商登录/同意。
4. 页面显示「等待浏览器授权」与「取消登录」。浏览器回调成功后先完成校验与凭据保存，再恢复检测。
5. 检测成功显示工具目录；审阅具体工具，显式启用连接，再到专家或任务选择工具。

登录、检测各有独立 operationId、取消入口和终态。失败保留配置或输入，错误提示给出就地修复动作；超时、拒绝授权、端口占用、存储不可用、网络不可达、鉴权/权限不足、协议不兼容分开解释。重试新建 operationId，旧结果不能覆盖新状态。

反馈按 [UI/UX §11.5.1](../10-ui-ux-system.md#1151-反馈通道决策表所有界面反馈的唯一归类入口)：短时保存确认走局部 TransientToast；可行动错误走 InlineError；跨页仍需回看的登录/检测长操作终态走消息中心，页面只显示对象当前状态，不重复播报。StatusNote 用于只读状态。取消正常收口，不作为失败通知。

## 4. OAuth 方案与兼容边界

采用 OAuth 2.1 Authorization Code + PKCE S256，BetterWork 是原生桌面客户端，DCR 使用 `application_type: native`。使用系统浏览器，回调仅监听 `127.0.0.1` 的临时端口与固定路径；监听器绑定成功后才生成 redirect URI，回调精确匹配路径、随机 state、issuer 和当前 operationId，授权码单次消费。

发现遵循 RFC 9728（WWW-Authenticate 与 well-known 均支持），授权服务器元数据同时支持 RFC 8414 和 OIDC；验证 issuer 一致性与 PKCE S256 支持。授权、兑换均携带与 MCP 地址绑定的 resource。SDK 必须保留 issuer/PKCE 校验，不设置跳过验证选项。每个 callback 的 `iss` 按 RFC 9207 校验；state 校验由宿主实现，不能误认为 SDK 已负责。

客户端身份优先级：已配置且绑定 issuer 的预注册信息 → 服务支持且已有有效 HTTPS 文档时使用 Client ID Metadata Document → 服务支持时使用 DCR 兼容 → 引导用户填写预注册信息。当前没有可证实已发布的 BetterWork HTTPS metadata URL，**不虚构产品域名、不自动发布站点**。文档只能接纳用户/产品提供且已核验的真实 URL；只接受此方式且没有有效客户端文档的服务标为「需要客户端注册」，不能宣称任意 OAuth server 均可直接登录。

预注册/metadata 方式的回调必须符合其登记值；不支持临时端口的服务显示明确配置失败，本轮不默默切换 custom scheme、不放宽 redirect 校验。实现时为有需要的预注册服务提供经校验的固定 loopback 端口高级字段，端口占用则失败且保留输入。

token、refresh token、client secret 经现有 Main-owned safeStorage 凭据服务加密存 SQLite。存储按 connection + issuer + resource 分隔；不跨连接复用 token；凭据读接口只返回配置/可用状态。授权码、state、verifier 仅内存保存，取消/超时/退出销毁。重启保留密文授权状态，refresh token 刷新串行合并，轮换原子写入；invalid_grant 进入「需要重新登录」。

Run 中可对同权限进行一次有界 refresh，但不自动打开浏览器、扩权或重放不确定工具调用。insufficient_scope 返回修复入口，由设置页发起新的可审阅登录；登录成功也不自动恢复失败 Run。退出登录清理本地 token/refresh token 并取消使用旧凭据的 Run；支持且已验证 revocation_endpoint 时可尝试远端撤销，失败如实说明，本地清理不宣称远端已撤销。

## 5. 网络与进程边界

沿用 [ADR-0025](../adr/0025-remote-mcp-and-capability-bindings.md) 的目的地规则：公网/内网 HTTPS，内网需明确授权精确 host/port；本机 HTTP 仅明确授权的 loopback。用户配置的 MCP/issuer URL 拒绝 user-info、query、fragment；SDK 生成的 OAuth 查询和旧 SSE 同源 session POST 查询仍逐请求校验目的地；没有忽略证书选项；DNS 与实际连接地址一致校验，不能二次未经验证解析。`localhost` 输入可明确转换为字面 loopback 并在保存前展示规范化目标，不让任意域名获得 HTTP 例外。

OAuth 需要访问配置地址以外的认证端点，因此在旧「仅 MCP 地址」规则之上新增独立授权目的地集合：已验证的资源元数据、选定 issuer 的元数据、登记/授权/token/撤销端点。默认公共 HTTPS；私网认证域名必须另行确认精确 host/port。这些授权只属于本连接的 OAuth 操作，不扩大业务工具或 web_fetch 的网络范围。拒绝 metadata/link-local、未授权私网和跨目的地重定向，不向 metadata/浏览器地址发送 MCP Bearer Token。

旧 SSE 的 server-supplied POST endpoint 必须同源、落在同一已授权 host/port，逐请求走相同检查；不因收到 endpoint 事件而接受另一个服务器。连接握手回退同样不扩大目的地。SDK 的 EventSource 和 POST、OAuth fetch 均经过可注入的策略适配器，不能有旁路网络请求。

stdio 由 Main 启动；进程与取消清理复用 macOS supervisor。新旧版本自动探测可能启动短暂探测进程，它也必须受监督并被清理。原生进程仍具有本地用户权限，环境变量白名单不称为 OS 沙箱。

## 6. 持久化、工具与 Run

沿用 ADR-0025 的稳定连接身份、不可变配置修订、具体工具合同审阅与 Run-owned client；本次补充新旧传输、OAuth 状态和安全边界，不新建 Agent Engine。

- 保存新连接为 disabled/untested。编辑普通配置生成新修订，运行中的 Run 继续持有其旧非机密快照。
- 连接身份和修订通过版本化迁移建立；旧 stdio 配置保留稳定 ID、参数、工作目录与历史引用，生成初始修订。旧工具选择在新执行前需要一次合同审阅，不能补造批准事实。
- 机密更新采用 keep/replace/clear，精确归属与期望版本校验；轮换/撤销取消依赖旧凭据的 Run。OAuth refresh 的生命周期独立于用户主动撤销，不能因同权限 token 自动刷新把活跃 Run 当成被撤权取消。
- 每条新绑定固定 connectionRevisionId、toolId、contractHash。hash 包含描述、输入/输出 Schema 和 annotations，确定性 canonical JSON；顺序变化不产生假变更。
- 新工具未审阅、未选择；明确非只读/破坏性工具不可用。缺 annotations 不能视为自动只读，审阅也不能证明不可信服务实际无副作用。
- 发现失败保留最后成功目录并标为 stale；每 Run 首次使用该连接前重新发现并核对所选合同，变更/缺失/未批准则在模型派发前失败。
- 每 Run 独立 client；同 Run 同连接共享，测试和其他 Run 独立。Run 结束释放；停用/移除/退出登录取消受影响 Run；历史身份与 Evidence 不删除。
- 模型工具别名 ≤64 字符，基于完整连接/工具身份生成并检查碰撞。Evidence 由实际绑定反查，不解析别名，也不存 token、传输 sessionId 或环境。
- 仍只适配工具。Resources、Prompts、sampling、elicitation、Tasks/MCP Apps/Skills 扩展未进入本轮；新 `input_required` 结果返回明确不支持的客户端输入需求，不伪造成功或继续额外模型调用。

## 7. 按版本执行的失败与取消

| 情况 | modern · 2026-07-28 | legacy · 2025-11-25 及以前 |
| --- | --- | --- |
| 初次连通 | server/discover 与逐请求元数据 | initialize 与通知握手 |
| HTTP 会话 | 没有协议会话，不生成/持久化 MCP-Session-Id | 有 sessionId 时正确携带；与 BetterWork Session 分开 |
| HTTP 取消 | 关闭该请求的响应流 | 依协议发取消；关闭本操作连接只影响其所属 Run/测试 |
| stdio 取消 | notifications/cancelled，忽略晚到结果 | 传递请求 AbortSignal，按协商版本发取消 |
| HTTP 响应断线 | 失败并允许用户显式重试，不自动重发业务调用 | 有界恢复只取原响应；不能重发不确定 tools/call |
| 旧 HTTP 会话 404 | 不适用 | 失效会话清理，下次显式操作可重建；不重放当次业务调用 |

复用现有契约预算：连接 10 秒，完整发现 30 秒，调用 60 秒，发现最多 200 工具，消息/SSE event 解码最多 1 MiB，可用结果最多 100,000 字符。OAuth 等待浏览器单独设 5 分钟硬限，页面显示取消；HTTP 每次发现/token 请求有独立有界超时。进度不延长硬限，禁止远程 Schema ref 与无界累计。

## 8. 建议实施顺序与验证

本方案已确认，实施时更新现有 CF 唯一任务板及 capability-contracts，不在本稿另维护实施状态。MCP 专项复用已实现的 CF10/CF11 凭据基础，其自动化与 MCP 真机存储证据自行核对；不要求先开发无关百度 profile，不代签 CF12 或其他人工验收。CF 的既有前置改为「实现依赖」与「验收依赖」区分，变更需随方案确认记录。

1. 协议与版本化迁移：三种 transport、认证判别联合、修订/CAS、机密 slots、审阅记录、operationId；迁移测试用旧 stdio/专家/任务/Run/Evidence 夹具，不重置用户库。
2. 本地与远程 runtime：官方 SDK 的 auto/legacy 模式、受管进程、策略 fetch、发现限额、合同核对、Run 归属与清理；modern/legacy 和 JSON/SSE 离线报文验证。
3. OAuth：发现、issuer/client 注册分隔、PKCE/state/callback、token 加密/refresh、取消/超时/登出；全部 HTTP 注入离线响应，不触网。
4. 设置与现有专家/任务接线：连接列表/编辑/启停/登录/检测/工具审阅/修复入口；沿用 UI 台账，验证 PR #15 的动作几何与反馈出口。
5. 定向集成、真实窗口走查、提供真实 server 后完成对应真实接入验收。记录实现、自动化、AI 页面走查和用户验收四层证据。提交、推送与发布仍按用户授权处理。

| 验收 | 必须证明 |
| --- | --- |
| 传输 | modern stdio/HTTP、旧 stdio/Streamable HTTP/HTTP+SSE；JSON 与 SSE；仅握手允许的回退；实际版本显示 |
| 认证 | 无认证/Bearer/API Key；OAuth RFC9728/RFC8414/OIDC；预注册、已有 CIMD、DCR 兼容与缺身份的修复出口 |
| OAuth 安全 | state/issuer 不匹配、缺 PKCE、码复用、错误回调路径、取消后晚到 callback、未授权私网、metadata SSRF、token 回声/日志脱敏 |
| 生命周期 | 两 Run 同连接独立取消，测试独立，主动轮换撤销，refresh 合并，重启后密文授权可恢复，退出无孤儿进程/监听器 |
| 工具 | 新/变更工具未选择，旧目录 stale，破坏性工具拒绝，合同变更阻断，别名碰撞与正确 Evidence 归属 |
| UI | 空/首读失败/保存失败保留输入，键盘/焦点/取消，明暗与窄窗口，OAuth 不在 Run 里弹浏览器 |
| 真实接入 | 用户提供的 stdio、HTTP/SSE 和 OAuth 服务按实际可得范围验收；未有账号/端点的项留缺口，离线替身不能替代 |

按 ADR-0042 执行 typecheck、定向 ESLint/Prettier、相关测试与 docs:check。完整 verify 只由用户按需或夜间计划运行，不因本任务自行启动。

## 9. 已定案的具体方案

需求「三种接入 + OAuth」已授权，不重复询问功能范围。用户已按推荐方案定案以下技术边界：

| 决策 | 建议 |
| --- | --- |
| D1 版本与传输 | 官方 SDK 明确 auto 协商；旧 SSE 单独选项，HTTP 兼容回退默认关闭 |
| D2 浏览器与身份 | 系统浏览器 + loopback callback + PKCE；预注册/已有 CIMD/DCR；未有产品 HTTPS 文档时明确注册缺项 |
| D3 OAuth 网络授权 | MCP 目的地与认证目的地分开；issuer/权限变更在设置里审阅，Run 不自动弹窗扩权 |
| D4 状态和历史 | 修订、合同审阅、Run-owned client；增量迁移保留历史，token 仅加密本地保存 |
| D5 实施依赖 | MCP 专项复用已有凭据基础，独立验证，不先开发百度 API profile；原 CF/其他验收不代关闭 |

## 10. 官方依据

- [当前 Specification](https://modelcontextprotocol.io/specification/2026-07-28) 与 [Key Changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog)。
- [Versioning and Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)。
- [stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio) 与 [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)。
- [旧传输兼容规则](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#backwards-compatibility)。
- [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)、[Server Discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery)、[Client Registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration) 与 [Security](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations)。

## 11. 当前证据边界

用户已批准 D1–D5 并授权实现。任务分支 `codex/mcp-connections` 基于含 PR #15 的 `main` @ `14252db`，已实现三种传输、OAuth、v45 增量迁移、修订/凭据 CAS、合同审阅、Run 绑定与设置交互。锁定现有官方 SDK 2.0.0，显式增加 undici 6.28.0 以在真实 socket lookup 中固定已校验 DNS 地址；没有更换 Agent 引擎。

实现、自动化、AI 页面走查及待人工验收分别记录在 [CF 任务板](../development/tasks-capability-foundation.md) 与 [本轮验收证据](../acceptance/2026-10-09-mcp-connections.md)。生产组件的离线 Electron 页面矩阵不等于真实服务验收；真实 OAuth 账号、业务 server、真机 Keychain/重启与签名包验收仍待条件具备。退出登录只声明本地授权已清除，不声明远端 token 已撤销。

[可点击预览](https://betterwork-mcp-settings-preview.xprogrammer-net.chatgpt.site/)保留原始文件、沙盒 iframe 和 CSP，只演示交互，不联网、不保存真实凭据。它不替代已实现页面或协议验收。本地实现提交为 `9479562`，用户已授权推送与合并，实际版本及合并结果以 Git/PR 记录为准；BetterWork 产品发布尚未执行。实现验证阶段未调用真实模型、未修改产品数据库或启停用户应用；随后已按用户要求启动开发应用供人工检查。
