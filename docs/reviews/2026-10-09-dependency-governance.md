# B3：依赖治理（R17）

## 范围与基线

2026-10-09 21:18，用户授权推进 B3。原 checkout 的任务分支为 `codex/review-dependency-governance`，批次基点为 `0276fd1ae3f39f3c2213f671bcaa667cbe1b9bb5`。本批处理 npm 依赖与 macOS arm64 构建链，不改变网络授权、Office 解析、运行时分发或产品范围。

只读 `npm audit --json` 为 **27 项包告警：6 moderate、20 high、1 critical**；`npm ls --all --json` 通过。这个数字包含依赖传播告警，不代表 27 个独立漏洞或 27 条可利用路径。初始 JSON 位于本机 `/tmp/betterwork-b3-audit-before.json` 与 `/tmp/betterwork-b3-tree-before.json`，最终结论以本页归档的版本、依赖链和检查结果为准。

GATE-0：对已知产品 SQLite 路径执行只读探针，路径不可打开；开发日志没有本任务相关依赖故障。未操作用户数据库或重启正在运行的开发应用。

## 处置方案

| 依赖链 | 基线与实际路径 | 本批处置 |
| --- | --- | --- |
| HTTP / OAuth | `@modelcontextprotocol/client@2.0.0`；应用直接使用 `auth()`，HTTP Transport 使用应用提供的 token provider。 | 升级同主版本已修复 SDK；验证已保存 issuer、预注册客户端、重新载入与刷新路径，不把升级等同于旧凭据自动安全。 |
| 网页与 MCP 网络 | 应用 `undici@6.28.0`；Electron 下载器另有 `undici@7.29.0`。 | 分别更新各自主版本；重跑 B2 的真实 Undici→Node TCP/TLS 绑定回归和 MCP 网络策略。应用未使用 WebSocket、BalancedPool、retry/cache/dump interceptor；7.x 专属告警不归到应用 6.x。 |
| 原生重建与制品构建 | builder 25.1.8 → rebuild 3.6.1 → node-gyp 9.4.1 → tar 6.2.1；根 rebuild 4.2.0 / tar 7.5.22 没有覆盖此链。 | 通过 electron-builder 上游新版迁移到 rebuild 4.x / tar 7.x，不对旧 node-gyp 强制覆盖 tar 主版本。验证实际安装树、原生模块重建、macOS arm64 制品及随包资源。 |
| 构建/测试叶依赖 | brace-expansion 1.1.18 / 2.1.4 / 5.0.9、source-map-js 1.2.1、http-cache-semantics 4.2.0。 | 定向更新到父依赖允许的修复版本；核对嵌套副本。 |
| 内置 stdio MCP 与代理下载 | ip-address 10.7.0 来自 SDK 的 express-rate-limit 与构建 socks。 | 同主版本更新；内置 stdio 不启用 HTTP rate limiter，仍保留修复而不依赖该不可达性。 |
| patch 工具 | patch-package 8.0.1 → find-yarn-workspace-root 2.0.0 → micromatch 4.0.8 → braces 3.0.3。 | 查询稳定修复版并核对输入来源；不能接受 audit 建议的 patch-package 6.0.7 降级。已有 pptx-glimpse 0.10.4 patch 必须继续应用。 |
| Office 传递依赖 | mammoth 1.12.2 → argparse 1.0.10 → sprintf-js 1.0.3；exceljs 4.4.0 → uuid 8.3.2。 | 检查实际 API 与漏洞触发功能，保留可解释的未修复项；不降级 Office 主包或强行跨主版本覆盖 uuid。 |

本批不使用 `npm audit fix --force`，不新增库、不更换关键工具。electron-builder 26.x 的配置兼容性与产物由实际 macOS 打包验证；若出现不能直接解决的技术障碍，按仓库纪律停在具体方案层。

## 上游证据

- [MCP OAuth issuer 绑定公告](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h)：2.2.0 修复；自定义 provider 必须保存 issuer，预注册凭据必须返回 issuer，旧凭据缺失 issuer 不能仅靠升级消除风险。直接 `refreshAuthorization()` 不由该修复覆盖，须检查应用自身固定授权服务器与目的地的路径。
- [tar 解压资源耗尽公告](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw)：7.5.19 修复该 critical；本批还按当次审计的其他 tar 公告核对最终版本。
- [Undici 发布记录](https://github.com/nodejs/undici/releases)：当次 npm 版本元数据与审计给出的 6.x / 7.x 修复范围分别核对，不混用主版本。

## 已实施的版本与安装树

2026-10-09 21:25，干净 `npm ci` 后的完整审计为 **16 项：12 moderate、4 high、0 critical**；生产依赖审计 `npm audit --omit=dev --json` 为 **5 moderate、0 high、0 critical**。剩余项没有隐藏或从 audit 中忽略，判断仅覆盖本次版本与调用路径。

| 项目 | 最终锁定/安装结果 |
| --- | --- |
| MCP client / core | 2.3.1 / 2.3.1；client 允许范围下限提高到 `^2.3.1`。内置三个 server 仍锁定 2026.8.31，其 SDK 为 1.32.1。 |
| Undici | 应用精确锁定 6.29.0；`@electron/get@5.1.0` 的副本为 7.30.0。jsdom 原有 8.10.2 保留，未借治理做无关升级。 |
| macOS 打包器 | electron-builder、app-builder-lib、builder-util、dmg-builder、electron-publish、squirrel-windows 均为 26.15.3；builder-util-runtime 9.7.0。 |
| 重建 / tar | builder 与根目录共用 rebuild 4.2.0 → node-gyp 12.4.0；tar 只有 7.5.22，旧 6.2.1 与 rebuild 3.6.1 / node-gyp 9.4.1 子树已消失。 |
| brace-expansion | 所有 1.x 副本 1.1.21、2.x 副本 2.1.7、5.x 副本 5.0.12，逐节点核对，未跨主版本覆盖。 |
| 其他兼容叶升级 | source-map-js 1.2.2、http-cache-semantics 4.3.0、ip-address 10.7.3。 |
| 既有 patch | pptx-glimpse 0.10.4 精确版本保留；`npm ci` 自动应用成功，最终包内 ESM/CJS 均与应用 patch 后的源码逐字节一致。 |

上述版本消除 MCP、Undici、tar、builder-util-runtime、AppImage、brace-expansion、source-map-js、http-cache-semantics 和 ip-address 的本次告警。AppImage、Windows 打包与发布路径本来不在 macOS 产品流程内，但本次仍通过上游整体升级消除相关告警；不将「非目标平台」作为所有构建依赖的豁免。

升级没有使用 overrides，也没有新增直接依赖、IPC、Schema 或迁移。lockfile 删除/新增的大部分条目来自旧 builder 子树替换；plist、rimraf 等版本变化是新版 builder 的上游约束，最终安装树与包内行为均已验证。

## 剩余 high：四项包告警、同一个漏洞来源

[braces 上游问题 #70](https://github.com/micromatch/braces/issues/70) 描述不可信深度嵌套 glob 的栈耗尽；当次 npm 元数据中 braces 最新稳定版仍为 3.0.3，patch-package 最新稳定版仍为 8.0.1。上游对风险描述存在争议，本项目仍保留告警记录，不以争议否定漏洞。

| 包告警 | 实际版本 / 链路 | 调用与触发条件 | 处置与再次核查条件 |
| --- | --- | --- | --- |
| braces | 3.0.3；micromatch 的唯一副本。 | `find-yarn-workspace-root/index.js:28` 将 package.json 的 workspaces 作为 glob。当前只有仓库控制的 `apps/*`、`packages/*`；用户文档、网页、Skill/MCP 返回值不进入该入口。 | 暂留：无稳定修复版，不降级 patch 工具；上游发布修复或 workspace glob 输入来源变化时重新核查。 |
| micromatch | 4.0.8 → braces 3.0.3。 | 同一 workspace root 检测，传递 high。 | 同上；不是第二个独立漏洞。 |
| find-yarn-workspace-root | 2.0.0 → micromatch 4.0.8。 | patch-package 的 `detectPackageManager` / `getPackageResolution` 调用，发生在开发安装/补丁准备。 | 同上；若将工具用于外部不可信仓库或放开 glob 输入，须先重新评估。 |
| patch-package | 8.0.1 → find-yarn-workspace-root 2.0.0。 | 根 postinstall 应用仓库内固定补丁；当前参数没有动态 glob。 | 保留现有补丁链，不采用 audit 建议的 6.0.7 降级。确认四包均没有进入最终 app.asar。 |

这四项影响安装/开发工具进程；当前没有从产品输入到其危险 glob 的调用路径。它们仍是未修复依赖，不能表述为已修复或普遍无风险。

## 剩余 moderate 与新版构建链

| 来源及传播项 | 版本 / 触发条件 | 当前证据与处置 |
| --- | --- | --- |
| sprintf-js → argparse → mammoth（3 项） | sprintf-js 1.0.3、argparse 1.0.10、mammoth 1.12.2；格式字符串中攻击者控制的超大 precision。 | 应用仅在 `knowledge-extract.ts` 调用 `mammoth.extractRawText({ buffer })`；argparse 仅由 Mammoth CLI 入口导入，应用不调用该 CLI。DOCX 正文不是 sprintf 的格式字符串。最新稳定 sprintf-js 1.1.3 仍在告警范围内，保留并等待上游修复，不采用 mammoth 0.3.29 降级。 |
| uuid → exceljs（2 项） | uuid 8.3.2、exceljs 4.4.0；漏洞要求调用 v3/v5/v6 并传入越界输出 buffer。 | ExcelJS 中仅 `cf-rule-ext-xform.js` 两处 `uuidv4()`，没有 buffer 参数；应用仅使用 ExcelJS 读取器。[uuid 上游公告](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq) 明确区别这些 API。保留兼容版本，不跨主版本覆盖 CommonJS 依赖，也不降级 ExcelJS 3.4.0。 |
| sprintf-js → roarr → global-agent → @electron/get → builder 相关传播（7 项） | 新版 builder 引入 `@electron/get@3.1.0` → global-agent 3.0.0 → roarr 2.15.4 → sprintf-js 1.1.3；另有 app-builder-lib / dmg-builder / electron-builder / squirrel-windows 传播告警。 | 构建期可达，不能仅以 dev 依赖排除。核对 global-agent 的 Agent / ProxyController / createGlobalProxyAgent：日志模板均为源码固定字符串，URL、响应和错误进入 context，未作为 sprintf precision 模板；无当前远程格式字符串入口。最终 app.asar 不含 global-agent 或 builder。保留上游约束，等待 sprintf-js 或下载器兼容修复，不采用 audit 建议的 builder 26.5.0 回退。 |

生产审计的 5 项即上表前两行。全树审计新增的构建期传播项已单独归档，不用告警总数下降遮盖它们。今后升级这些父依赖、开放 CLI/格式字符串输入或改变下载器调用时须重新审计该结论。

## OAuth 与旧凭据边界

应用的自定义 provider 原样保存 SDK 返回的 clientInformation/tokens（包括 issuer），预注册 clientInformation 显式携带用户选定的 issuer，登录过程固定 discoveryState。回归现已直接核对 DCR 与预注册两条路径加密保存的 issuer；现有测试覆盖重载、PKCE/state/resource、取消、配置变化和 refresh 合并。

Transport 使用应用的 token provider，刷新走应用的 `refreshAuthorization()`，而非让 HTTP Transport 重新选择授权服务器。应用读取持久化授权时要求 discovery AS 与授权记录一致，已存在 token issuer 时还要求它一致；刷新使用已批准的缓存 token endpoint 与禁止重定向的目的地策略。旧 bundle 即使缺 token issuer，也只能沿这个已经固定的授权记录/目的地刷新，并在写回时补 token issuer，不会按 MCP 新提示迁往另一 AS。新增回归验证登录后 MCP 提示变成恶意 AS，刷新仍只调用原批准 token endpoint。未读改用户凭据或代用户重新登录；真实账号与 Keychain 人工验收继续由 CF41/CF42 承接。

## 验证证据与边界

2026-10-09 21:25，本批本地检查：

- 干净 `npm ci`、`npm ls --all --json` 通过，patch-package 自动应用成功。
- TypeScript typecheck、变更测试的 ESLint、变更 JSON/TS 的 Prettier、差异空白检查通过。
- 10 个相关 functional 文件 **322 项通过**：MCP client/HTTP/OAuth/network、内置运行时、web_fetch、Knowledge 提取、PPTX 渲染与结构护栏。包含实际 Undici→Node TCP/TLS socket 绑定回归，不访问外网。
- Office parser heavy **6 项通过**；合成 PPTX/XLSX/CSV `office:probe` 通过，共 **328 项相关测试**，不代表全仓完整验证。
- 生产 `npm run build` 通过；运行时资源准备逐哈希复核 **44 项 / 43,465,695 字节**，全部复用已有本地制品。
- `CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac --arm64 --publish never` 生成 `/tmp/betterwork-b3-dist/BetterWork-0.0.1-arm64.dmg`；实际执行 rebuild 4.2.0 的 better-sqlite3 重建与新版 dmgbuild tar 下载/提取；`hdiutil verify` 通过。未上传、签名或公证。
- 包内 client/core 2.3.1、Undici 6.29.0、ip-address 10.7.3、三个 MCP server 固定版本核对通过；四个 high 包及 builder/global-agent 没有进入 app.asar；既有 PPTX patch 的 ESM/CJS 与包内文件一致。
- 使用**包内 Electron 可执行文件和 app.asar 依赖**、空 PATH、临时目录，内存 SQLite `SELECT 42` 成功，三个内置 stdio MCP 均完成握手与 tools/list（filesystem 14、memory 9、sequential-thinking 1）。44 项随包 Python/wheel 文件的 SHA-256 与大小均通过。

安装包测试覆盖依赖装配、原生模块与三个 Node MCP 的离线启动，不代替 Developer ID/Gatekeeper 安装态、用户窗口或真实 OAuth 服务验收；CF43 的原人工尾项不在本批关闭。没有自动运行完整 verify，没有修改用户数据或启停开发应用。

2026-10-09 21:29，docs:check 与带批次基点的 drift:check 通过并保存读数；护栏 154、例外 203 保持，未修改规范或扩大例外。PR Gate 与最终合并证据随本批收口补充。


## PR 与合并收口

2026-10-09 21:40，源提交 `5ecc080e5f7feeb0fb93b9f7fb3660f692928b88` 的 [macOS PR Gate](https://github.com/gyzhang/BetterWork/actions/runs/37937420161) 通过：干净安装、lint、format、typecheck、文档检查均成功；按 PR 基点与依赖图选择的 functional 229 文件 / 2117 项、heavy 8 文件 / 216 项通过，合计 **237 文件 / 2333 项**，不重复累加单独 docs:check 的护栏。Full verify 按规则跳过。

[PR #28](https://github.com/gyzhang/BetterWork/pull/28) 已 squash 合入 main，合并提交 `c021db2ebab354ebbea79557e8bd7f8dfbaeffc9`。原 checkout 已同步，代码任务分支本地/远端均已删除，没有创建 worktree。本页最终证据通过纯 Markdown 收口 PR 归档。

B3/R17 的依赖修复、逐链风险分析与自动化证据完成。四个开发期 high 和十二个 moderate 保留为有明确条件的未修复依赖，不宣称全仓零漏洞。人工安装态/真实账号尾项仍由既有 CF 任务承接，后续重构批次 C–F 未自动开工。
