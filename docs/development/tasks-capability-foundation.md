# 能力基础开发计划（API 工具 · MCP · Skill 统一配置）

- 生效：2026-09-20，用户接受 [API tools and remote MCP 设计](../designs/api-tools-and-remote-mcp.md)、[ADR-0024](../adr/0024-api-services-and-credentials.md)、[ADR-0025](../adr/0025-remote-mcp-and-capability-bindings.md) 与 [capability-contracts](capability-contracts.md) 之后，要求以目标为导向拆分开发落地。
- 决策基线：ADR-0024 与 ADR-0025 目前状态为 **Proposed**。CF12 关闭 M1 时把 ADR-0024 转 Accepted；CF42 关闭 M4 时把 ADR-0025 转 Accepted。之前的卡不把 Proposed 视为已接受。
- 核对基线：`main` @ `7f78515`，工作树只含本轮设计文档；每张卡开工前重新核对 HEAD、工作树与任务板，不用旧基线覆盖新代码。
- 平台：本轮 macOS；Windows 按 [ADR-0036](../adr/0036-macos-only-platform-scope.md) 退出范围，A09 原状态仅保留历史记录。
- 执行方式：串行、一次一张任务卡；遵守 [执行手册](README.md)、[工程规范](../12-engineering-standards.md) 与 [capability-contracts](capability-contracts.md)。不创建第二套规范、lint 配置或测试门禁。
- 与旧任务的关系：[阶段 A](README.md) 的 A12/A16/A17/A21、[B0](tasks-b0.md) 的 B00-5、[专家计划](tasks-experts.md) 的 E55/E56 是本计划的耦合项；本计划不重复排期、不改写其状态，只在对应里程碑触发其复跑（见 §5 迁移映射）。
- 验收边界：先验收 API/MCP/Skill 三类能力的技术链路、状态、范围、失败/取消与凭据保护是否自洽；不把示例专家/Skill 的产出业务质量作为功能通过条件。真实业务凭据、外部账号与签名身份缺失时保持 partial 并写明缺项。

> 2026-10-08 MCP 专项：用户确认 [ADR-0043](../adr/0043-mcp-multi-transport-and-oauth.md) 的推荐方案并授权编码，CF30–CF32/CF40–CF41 按已实现 CF10/CF11 底座推进，不前置开发百度 profile。CF12/CF33/CF42 的人工或真实服务验收保持独立；下文旧卡的仅静态认证、排除 SSE/OAuth、自动重建并重放会话及自行运行完整 verify 等条款由 ADR-0043 与 ADR-0042 替代。
> 2026-10-09 内置 MCP 运行时：用户明确要求安装包内置运行时、减少用户安装 Node/Python 和冷启动联网；[ADR-0045](../adr/0045-bundled-runtimes-for-local-mcp.md) Accepted。新增 CF43；真实业务与签名安装验收仍按 CF33/CF42/CF51 边界记录。

## 1. 交付顺序与完成口径

| 里程碑 | 用户得到什么 | 结束位置 |
| --- | --- | --- |
| M0 · 前置收口 | A12/A16/A17 桌面回归证据齐全，B00-5 双 Skill 真实撤销走查有记录，Developer ID 到位 | CF00 |
| M1 · 契约与凭据 | 模型、搜索、MCP 的 Key 全部经 Main-only 加密；旧凭据一次性迁移可恢复；ADR-0024 转 Accepted | CF12 |
| M2 · API 工具一等化 | 专家/任务能选具体百度 profile；`web_search` 从内置 allow-list 迁出；E55 的百度侧复跑 | CF23 |
| M3 · stdio MCP 版本化 | MCP 连接 revision + 契约审阅 + per-Run 客户端；至少一个真实业务 MCP 走通 | CF33 |
| M4 · 远程 MCP | Streamable HTTP/旧 SSE 与 OAuth 真实接入验收；技术方案由 Accepted ADR-0043 管理 | CF42 |
| M5 · 跨类收口 | A21 + E55 + E56 联合收口；设计 §9 验收矩阵逐条对齐；整体完成口径达成 | CF51 |

不承诺未经验证的工期。每张卡记录实际开始/完成时间、变更、测试与遗留；M2 完成后按真实工作量更新后续排程。

## 2. 当前基础与前置

| 范围 | 当前证据 | 处理 |
| --- | --- | --- |
| 协议/迁移/持久化 | v23 迁移；IPC channel 85 项；`packages/agent-protocol` 是唯一定义入口 | 沿用现有分层；CF 系列新增字段按 capability-contracts §10.1 逐步迁移 |
| 内置工具与 allow-list | 12 个内置工具、`BUILTIN_TOOL_NAMES` 常量在 [expert-service](../../apps/desktop/src/main/services/expert-service.ts#L30)、编辑器 checkbox 在 [ExpertsView](../../apps/desktop/src/renderer/src/views/ExpertsView.tsx#L35) | CF22 把 `web_search` 从 allow-list 迁到 API profile 选择，其余 7 个 checkbox 保持不变 |
| 搜索配置 | 单表 `search_engine_configs`；`enabled` 全局唯一；明文 Key | CF11 迁移到 API service profile；CF20–CF22 引入 profile/revision/默认 |
| MCP stdio | 2026-10-09 任务分支已实现 v45 身份/修订、托管 env、合同审阅与 per-Run client | CF30–CF32 代码与自动化证据见本轮记录；真实业务验收留 CF33 |
| MCP 远程 | 2026-10-09 任务分支已实现 Streamable HTTP/旧 SSE、现代/旧版本、静态认证与 OAuth | CF40–CF41 离线协议与页面检查；真实接入留 CF42 |
| Skill 生命周期 | A1–A20 已落地；信任/依赖/沙箱边界不变 | 保持原状；只新增 API/MCP 的选择路径与 Skill 平行 |
| Expert/Task/Run 上下文 | E11–E54 已落地；CAS、revision 与 snapshot 可用 | CF 系列扩字段并保留兼容投影 |
| Developer ID | `security find-identity` 返回 0 身份 | CF00 前置动作；A21/E56 的签名走查依赖此项 |
| 真实业务 MCP 端点 | 当前 `mcp_connections` 空；离线替身不能替代 | CF33 的验收前需用户至少配置一个真实只读端点 |

CF00 不重复此前已证实且未受变更影响的测试；以最新提交、真实日志与任务板对照，缺证据才补。未完成的 A/B0/E 卡继续在原任务板维护。

## 3. 唯一新任务板

本表是 CF 系列状态真相源；下面卡片不重复维护状态。CF 系列与 A/B0/E 是**并行**关系：CF 不关闭 A/B0/E 的状态；反过来 A/B0/E 尾项若与本计划里程碑耦合，在对应 CFx 卡的验收条件里显式列出复跑要求。

| 编号 | 工作 | 前置 | 状态 | 证据 |
| --- | --- | --- | --- | --- |
| CF00 | 前置收口与基线核对 | 无 | doing | 基线核对：HEAD `dee0bdb`，工作树仅含未跟踪 `.qoder/plans/`；`npm run verify` 退出 0（77 文件 / 582 测试 / Electron build，lint+format+typecheck 全绿）。§2 已校准：实测 IPC channel 85 项、schema v23、`mcp_connections` 空、`baidu_qianfan` enabled。桌面走查未完成，不伪造：模型端点 `10.62.64.38:30808` 探测 curl exit 52（空响应），A16/A17 真实样本与 B00-5 双 Skill 撤销受端点阻塞；**【2026-09-21 已失效】同一地址 `GET /api/inference/v1/models` 实测返回 HTTP 401（可达、要求鉴权，不再是空响应），且本机真机三档模型「测试连接」均成功、任务可跑完——A16/A17/B00-5 的端点阻塞已解除，只余人工走查窗口**；A12 依赖代码（4e4a4e5 09-11）与 A16/A17 运行约定解耦（1a380ac 09-13）均晚于上次本机走查，桌面回归仍待人工窗口。Developer ID `security find-identity` 仍 0 身份（外部申请动作，不阻塞 CF10）|
| CF10 | 凭据服务与 safeStorage 契约 | CF00 | done | credentials 表 v24 迁移（新库/旧库 v23→v24/幂等）；`infrastructure/credential-store.ts`（`SafeStorageAdapter` + `ElectronSafeStorageAdapter`，异步 safeStorage、可用性只查一次、`shouldReEncrypt` 有界再解）；`persistence/credential-repository.ts`（put/rotateAndCancel/clear/status/resolveForOwner + onSuperseded 订阅 + `CredentialError`，加密在事务外、失败不写半成品、解密失败不回落明文）；协议新增 `CredentialOwnerKind`/`CredentialMutation`/`CredentialStatus`/`CredentialErrorCode`/`MAX_CREDENTIAL_LENGTH`。单测 store 4 + repository 11 + migrate 2；`npm run verify` 退出 0（79 文件 / 599 测试 / Electron build）。真实 Keychain 桌面走查按里程碑留给 CF12，本卡不宣称密钥已迁移 |
| CF11 | 版本化迁移与 legacy 密钥入库 | CF10 | doing | 代码完成并 `npm run verify` 退出 0（81 文件 / 611 测试）：v25 建 `credential_migration_journal` 并为现存明文 Key 播 pending；`credential-migration-journal.ts`、`credential-migration-service.ts`（§10.2：读明文→事务外加密→回环校验→单事务清空+标 done；失败 recoverable；存储不可用整体 skip；重放幂等）、`credential-access.ts`（migrationStatus/resolveSecret/provision）；AppStore 以注入 safeStorage 适配器暴露 credentials+credentialJournal（保持 Electron-free）；run-service resolveModel/resolveWebSearch “新读优先”+解析前迁移门禁（pending/failed → credential_migration_required 拒绝新 Run，未注入时保持旧行为）；register-ipc 保存双写 + 连接测试新读优先；bootstrap 启动时 runPending 一次。必测均绿：migrate(v25 新库/旧库/幂等)、migration-service(§10.2 全态)、run-service(阻断+新读优先)、credential-access。唯一剩余（需用户）：真机重启两次不重复加密 + 真实模型/搜索可用验收；search legacy key 暂归 `api-service-profile/owner_id=provider`，CF20 须沿用。2026-09-21 11:04 真机验收发现两处未收口的明文读取/回写（详 §CF11 验收发现）：发现一（连接检测回写明文）与发现二（「未配置凭据」误报）均已修，并新增启动不变量与两条结构护栏；本卡仍不得关单，剩真机两次重启验收 |
| CF12 | M1 里程碑与凭据服务验收 | CF11 | todo | 待补 |
| CF20 | API service profile 协议与仓储 | CF12 | todo | 待补 |
| CF21 | API profile 管理 IPC/UI 与设置迁移 | CF20 | todo | 待补 |
| CF22 | 专家/任务/Run 的 API profile 绑定与兼容投影 | CF21 | todo | 待补 |
| CF23 | M2 里程碑与百度端到端复跑 | CF22 | todo | 待补 |
| CF30 | MCP 连接身份/修订与凭据 env 绑定 | CF10/CF11 实现 | doing | v45 保留旧连接/专家/任务/Run/Evidence/成果；配置与所有者凭据原子 CAS、移除清密钥；迁移/仓储/凭据回归通过。待真实存储与用户窗口验收；[完整证据](../acceptance/2026-10-09-mcp-connections.md) |
| CF31 | 工具 contract hash 与审阅记录 | CF30 | doing | 确定性合同 hash、修订内审阅、写/破坏工具禁选、执行前重发现、变更阻断与绑定选择已落地；合同/服务/页面回归通过。待用户审阅操作验收；[完整证据](../acceptance/2026-10-09-mcp-connections.md) |
| CF32 | Per-Run MCP 客户端与取消收口 | CF31 | doing | Run-owned client、测试隔离、旧检测不覆盖新目录、模型前取消终态、guardian 探测/子孙清理与实际绑定 Evidence 已落地；离线回归通过。待真实业务取消/重启验收；[完整证据](../acceptance/2026-10-09-mcp-connections.md) |
| CF33 | M3 里程碑与真实业务 MCP 接入 | CF32 | partial | 真实业务 stdio server 尚未提供；保持未验收，不代签 E55。离线夹具见本轮证据；[完整证据](../acceptance/2026-10-09-mcp-connections.md) |
| CF40 | 三种传输与目的地校验 | CF32 实现 | doing | 三种传输、DNS socket pinning、目的地隔离、JSON/SSE 限额、仅握手 404/405 显式回退已落地；HTTP/网络策略回归通过。待真实端点验收；[完整证据](../acceptance/2026-10-09-mcp-connections.md) |
| CF41 | 版本协商、OAuth 与运行时限制 | CF40 | doing | SDK auto/legacy、PKCE/state/issuer/resource、预注册/CIMD/DCR、refresh 合并/CAS、登录取消/监听器清理、设置与通知已落地；OAuth/运行时/页面回归通过。待真实账号与 Keychain 重启验收；[完整证据](../acceptance/2026-10-09-mcp-connections.md) |
| CF42 | M4 里程碑与远程 MCP 端到端 | CF41 | partial | 真实 HTTP/SSE/OAuth 账号尚未提供；保持未验收，不提升 ADR-0025 或关闭 M4；ADR-0043 已接受只代表方案已定案；[完整证据](../acceptance/2026-10-09-mcp-connections.md) |
| CF43 | 内置 stdio MCP 与随包运行时 | CF32 | partial | ADR-0045 Accepted；三个 Node MCP 与 Python fetch 通过随包 guardian 握手；打包 CPython、fetch wheelhouse 与现有 PPT wheelhouse 均完成离线环境准备。未签名 unpacked 包验证通过；Developer ID 安装态及用户窗口验收待后续窗口；[证据](../acceptance/2026-10-09-mcp-connections.md#2026-10-09-内置-mcp-运行时离线打包验收) |
| CF50 | 跨类迁移回归与用户走查脚本 | CF42, CF43 | todo | 待补 |
| CF51 | M5 里程碑、ADR Accepted 与整体收尾 | CF50 | todo | 待补 |

串行理由：CF 系列几乎每张卡触碰 `packages/agent-protocol/src/index.ts`、`apps/desktop/src/main/db/app-schema.ts` 与 `run-service.ts`；按 [执行手册](README.md) §4 不并行派发。CF20/CF30 之间在协议字段上耦合弱，可以在 M2 完成后并行进入 M3 起点，但仍按串行提交。

## 4. 开发任务卡

### 通用完成条件

每卡开工前读 [AGENTS.md](../../AGENTS.md)、[capability-contracts](capability-contracts.md)、对应 ADR 与卡片"必读"清单；执行 `git status --short` 与 `git rev-parse --short HEAD`；用 rg 确认没有等价实现。代码卡验证按 ADR-0042：typecheck、定向 lint/format、docs:check 与相关功能/重档测试；界面改动补现有 Electron 页面矩阵与 AI 走查。完整 verify 仅用户按需或夜间触发，记录覆盖范围与退出码；真实服务/用户验收未完成时明确列缺项，不能以离线替身代签。文档/契约卡完成：链接、字段一致性与 `git diff --check` 通过，不跑无关构建。每卡写当日日志，任务板行状态与证据同时更新。

外部 HTTP/MCP 调用一律用可注入 `fetch`/transport，测试不触网；真实服务验收另列人工证据。密钥、用户资料、构建产物、`.betterwork/` 工作目录不入库。

### CF00 前置收口与基线核对

- 必读：[A 任务板](README.md)、[B00-5](tasks-b0.md)、[E55/E56 人工验收脚本](../acceptance/2026-09-15-expert-human-acceptance.md)、[2026-09-15 日志](../logs/2026-09-15.md)。
- 目标：把 A12/A16/A17/B00-5 的现有 doing 尾项推到可复核状态；把 A21/E56 依赖的 Developer ID 就位；给后续卡一个干净基线。
- 允许改动：仅原卡规定的文件；不新增产品代码。
- 工作：
  1. 启动 `bash scripts/dev-start.sh`，走 A12 的 Skill 详情 → 依赖面板 → 环境准备 → 状态刷新；A16/A17 用 `ppt-generation-expert` 真实样本走一次 SVG/配置写入、结构校验、最小 PPTX 产物登记；三张卡各自在原任务板补证据行并升 done。
  2. 等模型 endpoint 可用窗口，走一次 B00-5 双 Skill 成功执行 + 撤销其一 → 只产生一次带原因的取消终态；把结果写入 [B0 卡](tasks-b0.md) 与 [2026-09-14 双 Skill 重启记录](../acceptance/2026-09-14-b0-two-skill-restart.md)。
  3. 用户侧启动 Developer ID Application 证书申请（外部动作，不是本机代码），拿到后写入 [package-preflight](package-preflight.md)。CF00 不关闭 A21/E56，只保证证书可用；这两张卡的实际走查留给 CF51 与新凭据模型一起收口。
  4. 记录当前 HEAD、`npm run verify` 数字基线（文件/测试数）与 `git status` 干净。
- 失败：某项桌面走查缺条件时（endpoint 断、证书未到）标 doing/blocked 并列具体缺项，不伪造通过；Developer ID 允许"申请中"，不阻塞 CF10 起步。
- 必测：无新代码；仅 `npm run verify` 与桌面证据。
- 完成：A12/A16/A17/B00-5 状态原卡更新；Developer ID 状态记录；本计划 §2 表格与实际状态一致。
- 不做：不实现 API profile、不引入凭据服务、不改协议字段。

### CF10 凭据服务与 safeStorage 契约

- 前置：CF00。
- 必读：[capability-contracts §4](capability-contracts.md)、[ADR-0024 §3/§4](../adr/0024-api-services-and-credentials.md)、[Electron safeStorage 文档](https://www.electronjs.org/docs/latest/api/safe-storage)、`apps/desktop/src/main/persistence/`、`apps/desktop/src/main/db/app-schema.ts`。
- 目标：在 Main 提供**唯一**凭据存取与保护入口，尚未接入具体消费者。
- 落点：`apps/desktop/src/main/infrastructure/credential-store.ts`（safeStorage 异步封装 + 可注入 adapter）；`apps/desktop/src/main/persistence/credential-repository.ts`；协议层新增 `CredentialStatus`、`CredentialMutation`（`keep/replace/clear`）判别联合与错误码 `credential_missing/credential_unavailable/credential_migration_required`；单元测试。
- 工作：
  1. 新增 `credentials` 表：`id`、`owner_kind`、`owner_id`、`slot`、`ciphertext`（BLOB）、`version`、时间戳；`(owner_kind, owner_id, slot)` 唯一索引。
  2. Repository 只提供 `put`（接受明文，内部加密）、`rotateAndCancel`、`clear`、`status`、`resolveForOwner`（Main 内部使用，不进 IPC 响应）；不返回明文，不接受 Renderer 直接调用。
  3. 封装 `SafeStorageAdapter`，暴露 `isAvailableAsync`、`encryptAsync`、`decryptAsync`；启动时检查一次，失败进入 `credential_unavailable`；测试用可注入 fake。
  4. 明确 secret 生命周期：`rotateAndCancel` 递增 `version`；订阅者（CF11 起接入）在其上注册取消回调，触发时取消使用该旧 version 的活跃 Run。
  5. 单元测试覆盖：round-trip；空/超长输入；`clear` 后 `resolveForOwner` 返回不可用；`isAvailableAsync=false` 时 `put` 抛错但不写入半成品；崩溃前/提交前的原子性。
- 失败/取消：加密失败不写入；解密失败按 `credential_unavailable` 返回，不 fallback 明文。
- 必测：以上单测；`migrate.test.ts` 新增 credentials 表迁移（新库/旧库/幂等）；`npm run verify` 全绿。
- 完成：credentials 表和 API 就绪；无消费者使用；本卡不宣称"密钥已迁移"。
- 不做：不改现有 `model_profiles` 或 `search_engine_configs`；不做 UI；不改 Agent Core。

### CF11 版本化迁移与 legacy 密钥入库

- 前置：CF10。
- 必读：CF10 落点、[capability-contracts §10.2](capability-contracts.md)、`db/migrate.test.ts`、`persistence/model-profile-repository.ts`、`persistence/search-engine-repository.ts`。
- 目标：把 `model_profiles.api_key` 与 `search_engine_configs.api_key` 迁移到 credentials 表，同时保留旧列的可回滚窗口；不改变业务行为。
- 落点：`db/app-schema.ts` 迁移；`db/credential-migration-journal.ts` 新表；`services/credential-migration-service.ts`；模型与搜索 Repository 增加"从 credentials 解析"读取路径，同时保留旧列写入回退用于回滚窗口；`run-service.ts` 在凭据解析前检查迁移状态。
- 工作：
  1. 版本化迁移建立 `credential_migration_journal`（记录 `owner_kind/owner_id/slot`、`status: pending/done/failed`、`error_code`）；不写 secret 值。
  2. 应用启动时，若 `safeStorage` 可用且 journal 存在 pending 项，逐个执行 [§10.2](capability-contracts.md) 的**读明文 → 加密 → 事务内附引用并清空明文 → 标 done**；失败保留 recoverable 状态并显示 `credential_migration_required`，不 fallback。
  3. Repository 读取路径：迁移完成的 owner 只读 credentials；未完成前读取旧明文并拒绝新 Run（`credential_migration_required`）。搜索与模型的现有写入路径暂保留双写（迁移未完成时），但只走"新读优先"。
  4. 迁移冲突与幂等：journal 提交后重启不重复加密；崩溃在附引用前可重来；conflict 走当前状态重试。
  5. 单元测试用 `:memory:` SQLite + fake safeStorage adapter，覆盖成功、加密失败、崩溃重放、Keychain 未解锁。
- 失败/取消：任何失败都不能让模型/搜索调用读到已被清空的明文；未迁移的 owner 保持 `credential_migration_required`；不影响历史 Run 与不受影响的 capability。
- 必测：`migrate.test.ts` 新增用例；`credential-migration-service.test.ts` 覆盖 §10.2 全部状态；`run-service.test.ts` 覆盖 `credential_migration_required` 阻断；`npm run verify` 全绿。
- 完成：一台真实开发机重启两次不重复加密；模型/搜索调用不再读明文；本卡不删旧列，只停止读明文。
- 不做：不做 API service profile；不改 UI；不宣称"已加密"是"已完成 A21"（那是签名安装的口径）。

#### CF11 验收发现（2026-09-21 真机，状态：待修）

证据取自本机 SQLite（只读）与 `/tmp/betterwork-dev.log`：07:56:06 首启迁移日志 `凭据迁移：done=4 failed=0 remaining=0 skipped=false`；`credentials` 4 行均 `version=1`；三条 `model_profiles.api_key` 长度 0；journal 4 行均 `done`。

**发现一：连接检测把已迁移的明文密钥回写数据库（安全回归，已修）**

- 现象：`search_engine_configs` 中 `baidu_qianfan` 的 `api_key` 在 08:00:46 重新变为 75 字节明文，`connection_status=connected`，而 journal 仍为 `done`，不会再被任何机制清理。
- 根因：`register-ipc.ts` 的 `TestSearchEngine` 处理器先从 credentials 新读优先解出密钥，再把它作为参数传给 `store.searchEngines.recordConnection(provider, status, apiKey)`；`search-engine-repository.ts` 的 UPSERT 含 `api_key = excluded.api_key`。于是「只记录连接状态」的动作在用户没有输入任何密钥的情况下重建了明文列。
- 违反本卡第 3 条：双写仅限「迁移未完成时」的窗口；journal 已 `done` 的 owner 不得再写明文。
- 对照组：模型侧 `recordConnection(input.id, status)` 不收密钥参数（`register-ipc.ts` 约 829 行），所以三条模型列仍为 0。修复按模型侧对齐。
- 修复：`SearchEngineRepository.recordConnection` 删除 `apiKey` 形参与 UPSERT 中的 `api_key` 赋值（全仓仅一个调用点）；补回归测试「journal done 后执行连接检测，明文列仍为空」；现存这条泄漏在凭据回环校验可用的前提下直接清空该列即可，不重跑迁移。

**发现一修复落点与新增不变量（2026-09-21）**

同类问题按「三个屏障 + 一条不变量」收口，而不是只堵 08:00 那一个口子：

1. **仓储屏障**：`recordConnection` 的 UPSERT 不再在 `ON CONFLICT DO UPDATE` 里写 `api_key`。保留 INSERT 分支的 `api_key`，因为「先测试、后保存」时行还不存在，需要用用户刚输入的 Key 建行；已存在的配置只能由保存动作更新凭据。
2. **处理器屏障**：`TestSearchEngine` 只把 `input.apiKey`（用户本次输入）交给落库，从 credentials 解出的密钥不再参与任何写路径。
3. **启动不变量**：`CredentialMigrationService.sweepResidualPlaintext()` 在 `runPending()` 之后执行，对所有 journal `done` 的 owner：明文列非空且 `hasSecret(ref)` 为真 → 清空明文列。只有密文确实可用时才动明文，避免销毁用户唯一凭据；受保护存储不可用时整体跳过。启动日志新增 `凭据明文残留清理：cleared=N`，不输出密钥。
4. **停止无限双写**：`SaveModel` / `SaveSearchEngine` 在 `provision` 成功且 `hasSecret(ref)` 为真时立即清空明文列。这落实 [capability-contracts §10.2](capability-contracts.md) 第 7 条「Do not continue dual writes to legacy credential columns」与 [ADR-0024](../adr/0024-api-services-and-credentials.md)「not indefinite dual writes」；没有受保护存储时仍保留明文，作为唯一可用路径。
5. **结构护栏**（`standards/coding-standard.test.ts` 架构边界）：`api_key` 的 SQL 赋值只允许出现在模型与搜索两个仓储；任何 SQL 不得出现 `excluded.api_key`。两条都已用临时探针文件验证会真的报错，不是空跑。

不变量表述：**只要 `credentials` 里有该 owner 的可用密文，旧明文列就必须为空。** 违反它的写入方会被护栏拦住，已存在的残留会被启动扫描清掉。

**发现二：`apiKeyConfigured` 仍读明文列，迁移后设置页恒显示「未配置凭据」（已修）**

- 现象：11:04 真机截图三条模型均为「未配置凭据 · 连接成功 · 已启用」，且「测试连接」弹「模型连接成功」toast；凭据实际已在加密库中可用。
- 根因：`model-repository.ts` 与 `search-engine-repository.ts` 的摘要均以 `row.api_key !== ''` 推导 `apiKeyConfigured`。CF11 清空明文列后该推导恒为 false。这是「清点所有读取方」时漏掉的展示层读者：运行态与 IPC 测试两处已转新读优先，摘要未转。
- 修复：两处摘要的 `apiKeyConfigured` 改由凭据库判定（`CredentialRepository.status`，模型按 `model-profile`/id、搜索按 `api-service-profile`/provider + `api-key` slot）；补测试「明文列为空但凭据存在 → 已配置凭据」。属 CF11 口径内（本卡「不改 UI」指不新增 UI 能力，不含让 UI 继续误报），不改协议字段。
- 关联：`ModelEditorSheet.tsx` 的「留空则保持原有凭据」占位仅由 `editing` 推导，与本发现无关，不需要同步改。

**发现二修复落点（2026-09-21）**

- `persistence/credential-repository.ts`：新增同步 `hasSecret(ref)`（只查行存在性与密文非空，不解密、不碰受保护存储）；`API_KEY_SLOT` 与 `CredentialAvailability` 定在持久层（原定义在 `services/credential-access.ts`，持久层不得反向引用 services），`run-service.ts`、`register-ipc.ts`、`credential-access.test.ts` 改为从持久层引用。
- `persistence/model-repository.ts` 与 `persistence/search-engine-repository.ts`：构造函数接收可选 `CredentialAvailability`；`apiKeyConfigured = 旧明文列非空 || 凭据库已有密文`——未注入受保护存储时完全退回旧行为，不弄断无 Keychain 环境。
- `persistence/index.ts`：`credentials` 仓储先于模型/搜索仓储构建，并把 `hasSecret` 作为谓词注入。
- 测试：`app-store.test.ts` 新增用例，用内存库 + 假受保护存储复现「密文已入表、明文列已清空」，断言 `getWithSecret().apiKey === ''` 同时 `apiKeyConfigured === true`（模型与搜索各一），并保留「从未配过凭据 → false」的假阳性护栏。

### CF12 M1 里程碑与凭据服务验收

- 前置：CF11。
- 目标：M1 达成；ADR-0024 从 Proposed 转 Accepted。
- 工作：
  1. 桌面走查：解锁/锁定 Keychain 两态；替换/清空凭据；观察旧 Run 是否取消一次且新 Run 使用新版本；恢复数据库到另一台机器时的 `credential_missing` 提示；未签名开发态与签名态的 Keychain 弹窗差异。
  2. 日志与文档：把结果写 `docs/logs/YYYY-MM-DD.md`；更新 [docs/12-engineering-standards.md §6](../12-engineering-standards.md) "密钥明文存于 SQLite" 一句，改为"通过 CF10 引入的凭据服务加密存于 SQLite"，同步 `standards/coding-standard.test.ts` 的白名单/护栏。
  3. 把 [ADR-0024](../adr/0024-api-services-and-credentials.md) 状态从 Proposed 改为 Accepted（2026-09-20 生效），保留替代 ADR-0007 部分决策的说明。
  4. 更新 [capability-contracts](capability-contracts.md) 的 §4 与 §10.2 从"proposed"改为"shipped as of CF12"。
- 失败/取消：任何桌面走查项失败退回 CF11；ADR 状态不升。
- 必测：设计验收 SEC-1、SEC-2、SEC-3、SEC-4 全部有真实走查记录。
- 完成：M1 关闭；凭据底座可用；CF20/CF30 可开工。
- 不做：不合并到 CF20 一起做 UI；不引入新表；不宣称远程 MCP 可用。

### CF20 API service profile 协议与仓储

- 前置：CF12。
- 必读：[capability-contracts §2](capability-contracts.md)、[ADR-0024 §1/§2](../adr/0024-api-services-and-credentials.md)、`agent-protocol/src/index.ts` 现有 search/model 类型。
- 目标：引入 `ApiToolDefinition`、`ApiServiceProfile`、`ApiServiceProfileRevision`、`ApiToolDefault` 与 `ApiToolBinding` 的协议与持久化，未接入 UI/Run。
- 落点：协议层 schema/channel；`db/app-schema.ts` 迁移；`persistence/api-service-profile-repository.ts`；`services/api-service-profile-service.ts`；`services/api-tool-registry.ts`（内置 `web_search` 定义与 `baidu_qianfan` provider adapter，adapter 只声明 endpoint/请求构造/结果抽取，不改动 [search-engine-service](../../apps/desktop/src/main/services/search-engine-service.ts) 的 HTTP 逻辑）；单元测试。
- 工作：
  1. 表：`api_service_profiles`（身份 + lifecycle + currentRevisionId）、`api_service_profile_revisions`（providerId + options + credentialId 外键）、`api_tool_defaults`（toolId → profileId 唯一映射）。
  2. Repository 事务：create 生成 disabled/untested 首修订；saveRevision 追加；setDefault 冲突返回 `capability_revision_conflict`；duplicate 复制非敏感配置，清空 credentialId 与 default。
  3. Registry 提供 `list()` 只返回 reviewed descriptors；`web_search` `readOnly: true`，`providerIds: ['baidu_qianfan']`；不允许用户注册新 provider。
  4. 协议输入 `ApiProfileDraft` 只允许 name/provider/options 与 credential `Mutation`；输出 `ApiProfileView` 只回 `credentialConfigured`/`credentialAvailable`/`revision`。
  5. 单元测试：revision 归属、并发 CAS、duplicate 不带凭据、`enabled` 与 `default` 分离。
- 失败/取消：非法 provider、缺失 `credentialId`、`options` 越界均 Schema 边界拒绝；不影响现有搜索配置读取路径。
- 必测：新库/旧库迁移；`npm run verify` 全绿。
- 完成：profile 与 default 可经服务层 CRUD；无 UI、无 Run 影响。
- 不做：不改现有 `search_engine_configs` 行为；不改 [ExpertsView](../../apps/desktop/src/renderer/src/views/ExpertsView.tsx)；不接 Composer。

### CF21 API profile 管理 IPC/UI 与设置迁移

- 前置：CF20。
- 必读：[docs/10 §6.1/§7.5](../10-ui-ux-system.md)、[capability-contracts §5](capability-contracts.md)、`views/SettingsView.tsx`、`hooks/use-search-engine-settings.ts`、`register-ipc.ts`、`preload/index.ts`。
- 目标：设置 → API services 取代现有搜索分区；profile 列表、创建/编辑/复制/启停/设默认/测试/取消测试；旧搜索配置一次性引导。
- 落点：`register-ipc.ts` 与 preload 新增 profile channels；`hooks/use-api-service-profiles.ts`；`views/SettingsView.tsx` 拆分 `ApiServicesSettings`；`styles.css` 语义 Token；`App.test.tsx`/组件测试。
- 工作：
  1. Channel 集合按 [§5](capability-contracts.md) 表；`profile.test`/`test.cancel` 使用 requestId 与 stale 保护。
  2. UI 每个 profile 行显示 name、provider、revision、`enabled/disabled/archived`、credential status（未配/缺失/可用/不可用）、connection status（未测/测试中/成功/失败）与 repair 链接；操作按钮：编辑、复制、启用/停用、测试/取消测试、设为默认/取消默认。
  3. 保存后弹内联提示"请显式启用并测试后再设为默认"；不自动启用。
  4. 旧"搜索"入口跳转到 API services；若 legacy provider 行未迁移，显示一次性提示并允许直接完成 profile 创建向导（背后复用 CF11 迁移）。
  5. 反馈按 [docs/10 §11.5](../10-ui-ux-system.md)：内联错误 + Toast + 消息中心；不新增第二套。
- 失败/取消：IPC 错误按 [§6](capability-contracts.md) 表返回 code + message；测试取消保留编辑器；stale 结果不覆盖新草稿。
- 必测：Renderer 回归覆盖创建→启用→测试→设默认→取消默认→复制→停用；键盘可完整走完；三档主题无溢出；`npm run verify` 全绿。
- 完成：设置页可完整管理 API profile；旧搜索入口引导；本卡不宣称"专家已能选 profile"。
- 不做：不改专家编辑器；不接 Composer；不删 `search_engine_configs`（保留迁移来源）。

### CF22 专家/任务/Run 的 API profile 绑定与兼容投影

- 前置：CF21。
- 必读：[capability-contracts §2.2/§7](capability-contracts.md)、[ADR-0024 §2](../adr/0024-api-services-and-credentials.md)、`agent-protocol` 专家/任务/Run schema、`run-service.ts` `createRunTools/resolveWebSearch/consume`、`expert-service.ts` `BUILTIN_TOOL_NAMES`、`ExpertsView.tsx`。
- 目标：把 `apiToolBindings` 加进 ExpertRevision/TaskContextRevision/RunContextSnapshot；把 `web_search` 从内置工具 allow-list 移到 API profile 选择；提供 §10.3 兼容投影。
- 落点：协议 schema、迁移 vNext、`run-service.ts` 消费路径、`expert-service.ts` 校验与可用性、`ExpertsView.tsx` 编辑器分组、`ContextPanel.tsx`、`ComposerCapabilityPicker.tsx`、`lib/labels.ts`；测试。
- 工作：
  1. 协议：`expertRevisionDraftSchema` 新增 `apiToolBindings`；`taskContextRevisionSchema` 新增；`RunContextSnapshot` 保存具体 profileId/revision；`BUILTIN_TOOL_NAMES` 常量删除 `web_search`（其他 7 个不变）。
  2. 兼容投影：旧 ExpertRevision 的 `builtinToolPolicy.toolNames` 显式包含 `web_search` 视为"应用默认 profile"引用；显式排除的保持排除；旧 TaskContext 无 `apiToolBindings` 时下一次编辑/发送物化一份新草稿；旧 Run 快照缺 provider 元数据 UI 显示"未记录"，不回填。
  3. `resolveWebSearch` 改为按 `apiToolBindings` 中的具体 profileId/revision 解析 credentials 与 options；未选则不注册 `web_search` 工具；不可用配置发送前拒绝，不静默剔除。
  4. 编辑器：新增 **API 工具** 分组，选择 profile + 支持"应用默认"；同分组显示可用性/repair；`web_search` 从"内置工具"分组消失。
  5. Composer `+` 增加 **API 工具** 一级项与二级多选；chip 条扩展 kind = `api-tool`。
  6. `labels.ts` 的 `TOOL_LABELS` 不改变 `web_search` 显示名；profile 名称通过 chip 副标展示。
  7. 撤销 profile：`api_profiles` 停用/归档/凭据清空 → 取消受影响活跃 Run 一次；沿用 [ADR-0012](../adr/0012-composer-capability-binding.md) 撤销语义。
- 失败/取消：profile 缺失/未启用/凭据不可用 → 发送前 `api_profile_missing/api_profile_disabled/credential_unavailable`；不允许 fallback 到"应用当前默认"。
- 必测：`run-service.test.ts` 覆盖两 profile 不串、兼容投影、撤销取消；`expert-service.test.ts` 覆盖 availability；`App.test.tsx` 覆盖编辑器与 chip；`register-ipc.test.ts` 覆盖 IPC；`migrate.test.ts` 覆盖新表新列；`npm run verify` 全绿。
- 完成：真实开发窗口能配置 profile → 专家选 profile → 任务改选 → 撤销取消；不宣称 E55 复跑通过（那是 CF23）。
- 不做：不改 Skill/MCP 选择路径；不宣称远程 MCP；不引入新 IPC channel 之外的旁路。

### CF23 M2 里程碑与百度端到端复跑

- 前置：CF22。
- 目标：M2 达成；E55 中依赖 `web_search` 的腿在新 profile 模型下复跑一次；`docs/acceptance/` 加一份 CF23 走查记录。
- 工作：
  1. 桌面：配置两个真实百度 profile（可用同一 Key 但不同 `webTopK`），两专家分别选；一次搜索成功 Run 记录 profileId/revision；`runs`/`run_events`/`evidence`/`artifact_input_relations` 逐字段核对；一个 Run 中"停用 profile"验证取消一次且不影响另一 Run。
  2. 复跑 E55 中真实网页搜索的那部分（2026-09-15 日志的 `web_fetch → web_search → web_fetch` 腿）；把新的 Run ID、profile 与旧记录一起追加到 [2026-09-15 专家人工验收](../acceptance/2026-09-15-expert-human-acceptance.md) 的新章节，说明"这一腿在新 profile 模型下复跑"。
  3. 更新 [docs/05-capability-system.md §2 表](../05-capability-system.md)：`web_search` 状态改为"由 API service profile 提供"；`docs/07-mvp-and-roadmap.md §0` 加一段 CF 里程碑。
  4. 若桌面走查任一步失败，退回 CF22；M2 不升。
- 失败/取消：设计验收 API-1、API-2、API-3、API-4 全部有真实走查记录。
- 必测：以上真实走查 + `npm run verify` 全绿。
- 完成：M2 关闭。
- 不做：不宣称远程 MCP；不合并 CF20–CF22 的证据。

### CF30 MCP 连接身份/修订与凭据 env 绑定

- 实现依赖：CF10 与 CF11 已落地的凭据代码；CF12 真机验收独立保留。
- 必读：[ADR-0043](../adr/0043-mcp-multi-transport-and-oauth.md)、[capability-contracts §3/§4](capability-contracts.md)、迁移与协议入口。
- 范围：v45 identity + 不可变 revisions + catalogs/reviews/authorizations/run bindings；新建 disabled/untested；旧连接保持 ID、command/args/cwd 及历史引用，不补造审阅。
- stdio `env[]` 区分普通值与 secret slot；`secrets[]` 使用所有者绑定的 keep/replace/clear 与 expectedVersion；环境最小化且禁止运行时注入变量。保存与密钥变更在一个 SQL 事务提交，加密在事务外；普通编辑保留旧 Run 客户端，主动密钥变更取消依赖方。
- 必测：旧 v44→v45 真实 SQLite 迁移、幂等/FK/不可变性、配置 CAS、凭据 CAS/失败回滚、归属与归档清除。
- 状态与范围：代码和离线回归已落地；真实 Keychain/用户窗口验收待完成，不代签 CF12。

### CF31 工具 contract hash 与审阅记录

- 实现依赖：CF30；依据：[capability-contracts §3.3](capability-contracts.md)。
- hash 包含 description/inputSchema/outputSchema/annotations 的 canonical JSON；用户审阅绑定 revision/tool/hash。新或变化工具未审阅；明确只读工具可批量允许，明确可能写入/破坏的工具可单独允许或经风险确认后批量允许；未知读写性质须逐项查看与确认。
- 设置中展开工具说明与参数并明确允许；副作用工具的批量确认说明可能创建、修改或删除数据以及不会逐次弹窗。服务声明不是安全保证。专家/任务选择携带修订/hash。旧未审阅绑定保留历史，下一执行要求审阅并重新选择，不静默剔除。
- 每 Run 首次使用重新发现并核对合同；input/output schema 本地校验，拒绝远程 ref。失败目录保留最后成功内容并标 stale，Run 使用自己的发现快照。
- 必测：hash 顺序稳定/语义变化、未审阅/变更阻断、重复/混修订选择、Schema/输出限制、正确 Evidence 归属。
- 状态：代码与离线回归已落地；待用户工具审阅/选择窗口验收。没有通用审批引擎。

### CF32 Per-Run MCP 客户端与取消收口

- 实现依赖：CF31；依据：[capability-contracts §7](capability-contracts.md)、ADR-0043。
- 同 Run 同连接共享 client，其他 Run/检测独立；取消只作用于所属 operation/client。较旧检测即使晚到也不能覆盖新目录，配置普通编辑不改旧 Run 快照。
- Run 终态前释放 MCP；模型派发前取消也只写一次 cancelled，清理失败显式收口。关闭/退出沿用 macOS guardian，版本探测的短暂进程及子孙同样受管。
- 停用/移除/退出登录/主动凭据轮换取消受影响 Run。历史绑定记录 revision/hash/alias/凭据版本，Evidence 反查实际绑定，不解析 alias；不存 session/token/env。
- 必测：两 Run 隔离、检测取消、晚到结果、主动撤销、模型前取消、探测退出/子孙清理及失败路径。
- 状态：代码与离线回归已落地；真实业务 server 取消/重启验收留 CF33。

### CF33 M3 里程碑与真实业务 MCP 接入

- 验收依赖：CF30–CF32；不阻塞本次 CF40/CF41 实现。
- 真实业务 stdio server 尚未提供，保持 partial。用户配置后审阅合同、专家预设并召唤，记录 revision/hash/Run/Evidence、跨 Workspace 与断线重启/取消；如验证有副作用的工具，须明确记录用户允许范围和调用影响。
- 只在取得真实证据后更新 E55 的 MCP 腿；不关闭 E55 连续两期整卡。离线夹具与页面矩阵不替代本卡。

### CF40 三种传输与目的地校验

- 实现依赖：CF32；依据：ADR-0043、[capability-contracts §3.1](capability-contracts.md)。
- 支持 stdio、Streamable HTTP、明确的旧 HTTP+SSE；静态 none/Bearer/API-key header 与 OAuth 配置分开。旧 SSE 同源 POST endpoint 与协议查询逐请求校验；HTTP 兼容回退默认关闭，仅握手 404/405 可用，认证/工具错误不回退或重放。
- 公网/私网 HTTPS；本机 HTTP 只允许显式授权的字面 loopback；配置 URL 禁 user-info/query/fragment，无证书绕过。所有 DNS 答案校验后在 socket lookup 固定实际地址，拒绝混合/特殊网络与跨目的地重定向。
- 落点：共享 Zod、`mcp-network-policy.ts`、SDK transport、设置表单与可注入 fetch。认证与业务目的地独立，不放宽 web_fetch。
- 必测：modern/legacy/旧 SSE、JSON/SSE、会话隔离、404/405 回退与 401 拒绝、跨源 endpoint、IPv6/mapped/DNS/重定向/限额/abort。
- 状态：代码与离线回归已落地；真实远程验收留 CF42。

### CF41 版本协商、OAuth 与运行时限制

- 实现依赖：CF40；依据：ADR-0043、[capability-contracts §3.2/§8](capability-contracts.md)。
- 官方 SDK 2.0.0 明确 auto/legacy 协商；modern 无会话/initialize/独立 GET/Last-Event-ID，legacy 使用拥有方临时会话。业务断线/401/404 不自动重发不确定调用，下次显式操作可重建。
- stdio 首次启动/安装与握手 60 秒、HTTP connect 10 秒、完整检测/discovery 90 秒（单次 discovery 30 秒）、调用 60 秒；progress 不延长硬限；最多 200 工具、50 选择、1 MiB 消息/事件与 100,000 字符结果。`input_required` 明确失败。
- OAuth 先发现并审阅 issuer/scope，再系统浏览器与 loopback 回调；PKCE S256/state/issuer/resource 校验；预注册、已有 HTTPS CIMD、DCR 兼容及缺注册信息修复。私网认证 origin 独立授权，不虚构 metadata URL。
- token/client/refresh bundle 加密按所有者/issuer/resource 保存；共享有界 refresh、scope 不扩张、轮换 CAS，取消 waiter 不影响另一方；invalid_grant 要求重新登录。Run 不弹浏览器，登出只声明本地清理。授权码/state/verifier 仅内存，取消/超时/退出释放监听器。
- 设置反馈复用 InlineError/TransientToast；登录/检测长操作结果进入消息中心，正常取消不报失败。所有操作使用 UUID 与 revision CAS，失败保留输入。
- 必测：OAuth 预注册/CIMD/DCR、PKCE/state/iss/resource/metadata 拒绝、取消与晚 callback、占用端口、共享 refresh 与 invalid_grant、CAS 竞争、UI 明暗/窄窗/减动效/键盘。
- 状态：代码、自动化与 AI 生产组件页面走查已落地；真实 OAuth/Keychain/重启与用户窗口验收留 CF42。

### CF42 M4 里程碑与远程 MCP 端到端

- 验收依赖：CF40/CF41 的代码与自动化证据；真实服务/账号可用。
- 真实 HTTP/SSE/OAuth 服务尚未提供，保持 partial；配置并审阅后走专家/任务调用、scope 修复、两 Run 取消、logout/重启与 Evidence，逐条记录。
- 方案状态由 Accepted ADR-0043 管理，不以离线测试提升 ADR-0025 或关闭里程碑；API/CF12/A/B0/E 等验收独立保留。
- 不引入 Resources/Prompts/sampling/elicitation、Tasks/MCP Apps 扩展或通用逐次审批引擎。

### CF43 内置 stdio MCP 与随包运行时

- 依据：[ADR-0045](../adr/0045-bundled-runtimes-for-local-mcp.md)、[MCP 连接设计](../designs/mcp-connections.md)、[capability-contracts §3.1](capability-contracts.md)。
- 目标：干净 macOS arm64 安装不要求用户预装 Node.js、npm/npx、Python、uv/uvx；优先使用随安装包资源，缺少资源时才使用登记的固定地址并校验 SHA-256。
- 范围：filesystem、memory、sequential-thinking 三个锁版 Node server 与 mcp-server-fetch Python server；自定义 stdio 命令不变。现有可精确识别配置由 v46 新 revision 迁移，旧 revision、连接身份和历史保留，工具审阅不继承。
- Python：CPython 3.12.14 macOS arm64 制品、PPT Skill wheelhouse 与 fetch 依赖闭包随包；SkillDependencyService 共享基础解释器，各锁仍生成独立受管 venv；进度、取消与失败原因可见。
- 验收：schema/迁移/service/guardian 回归；分别在 PATH 不含 Node/Python 的宿主启动四项内置服务；CPython、wheels 与 Node package 资源确实出现在 unpacked/安装包；断网准备成功；损坏哈希拒绝执行；取消后无孤儿进程/半成品环境；不自动启用连接或授权工具。真实业务服务、签名安装与用户窗口结果继续分开记录。
- 状态：partial；代码、自动化、未签名 unpacked 包、受管 guardian 与禁网环境离线握手已验证；Developer ID 签名安装与人工首装验收仍待后续窗口。

### CF50 跨类迁移回归与用户走查脚本

- 前置：CF42、CF43。
- 必读：[设计 §9 验收矩阵](../designs/api-tools-and-remote-mcp.md)、[E55 走查脚本](../acceptance/2026-09-15-expert-human-acceptance.md)。
- 目标：新增一份覆盖 API + MCP + Skill + 材料 + 记忆 + 撤销 + 重启的连续两期走查脚本；给出 SQLite 只读核对查询。
- 落点：`docs/acceptance/YYYY-MM-DD-capability-two-periods.md`；`scripts/capability-walkthrough-checklist.mjs`（可选，仅只读核对）。
- 工作：脚本化 §9 全部条目 + [E55](../acceptance/2026-09-15-expert-human-acceptance.md) 的两期腿；每一步记录 Run ID/证据；SQL 查询只读；不导出 prompt/API Key/公司材料。
- 完成：脚本评审通过，用户可按脚本一次跑完；CF51 引用它。
- 不做：不实现产品代码；不宣称通过。

### CF51 M5 里程碑、ADR Accepted 与整体收尾

- 前置：CF50。
- 目标：M5 达成；A21 + E55 + E56 一起收口；整体设计验收矩阵逐条对应。
- 工作：
  1. 用 `npm run dist:mac` 生成 macOS arm64；带 Developer ID 签名 + Gatekeeper；安装态按 CF50 脚本走一次；旧凭据模型在升级后仍可用（[capability-contracts §10](capability-contracts.md)）。
  2. [A21](README.md)、[E55](tasks-experts.md)、[E56](tasks-experts.md) 三卡在真实证据到位后升 done；否则保持 partial 并写清缺项。
  3. [AGENTS.md §2](../../AGENTS.md) 与 [docs/07-mvp-and-roadmap.md §0](../07-mvp-and-roadmap.md) 加一段 CF 完成口径；[docs/05-capability-system.md](../05-capability-system.md) 与 [docs/10-ui-ux-system.md](../10-ui-ux-system.md) 把"Proposed"提示改为"已落地"；本计划文档同步状态。
  4. 最终一次 `npm run verify`；写当日日志。
- 失败/取消：任何验收项缺条件时如实标 partial；不把 CF 里程碑写成"整体完成"。
- 完成：整体设计 §9 验收矩阵逐条对齐；A/B0/E 尾项各归各位；工作树干净。
- 不做：不引入 Windows；不引入 OAuth；不引入自动路由或多 Agent。

## 5. 与既有 A/B0/E 卡的唯一归属

| 现有项 | 与 CF 的关系 | 说明 |
| --- | --- | --- |
| A12/A16/A17 | CF00 补证据 | 原卡保持不动；只在 CF00 走查后升 done |
| A21 | CF51 与 E56 一起收口 | 依赖 Developer ID 与新凭据模型 |
| B00-5 | CF00 补真实 endpoint 走查 | 与本计划正交 |
| E55 | CF23 与 CF33 分别复跑百度/MCP 腿；CF51 联合收口连续两期 | 不关闭整卡直到 CF51 |
| E56 | CF51 依赖 Developer ID 与凭据升级保留 | 单独完成签名/Gatekeeper 走查 |
| A09 | 本计划不引入 Windows | 与 A 阶段原授权一致 |
| 阶段 B/C 后续规划 | 与本计划并行；不重复排期 | [phase-b-c-roadmap](phase-b-c-roadmap.md) 保留历史映射 |

CF 系列不产生第二套任务板：A/B0/E 的原卡状态仍以各自原任务板为真相源；本 §3 表格是 CF 系列唯一真相源。里程碑复跑只在 CF 卡验收里补"对应原卡状态"的引用，不改写原卡。

## 6. 交接输出

每卡交接说明按 [执行手册](README.md) §4 交接模板输出：完成的具体行为（含失败/取消）、修改文件、测试命令与退出码、真实验收证据、已更新日志与任务行、下一可执行卡。若只完成代码而缺人工验收，保持 doing 并列缺项；不依靠一句"基本完成"跨过门槛。

CF12、CF23、CF33、CF42、CF51 是里程碑验收点；其余是实现/契约切片。已授权的 MCP 专项实现依赖按 ADR-0043 推进，真实验收依赖分别保留；不得由某项实现通过推导其他里程碑已关闭。
