# ADR-0043：MCP 多传输接入与 OAuth 浏览器登录

- 状态：Accepted（2026-10-08；用户审阅可视化后按推荐方案 D1–D5 定案，并授权编码实现）。
- 产品与技术方案：[设置中的 MCP](../designs/mcp-connections.md)。
- 扩展：[ADR-0016](0016-mcp-transport-and-lifecycle.md) 的 stdio 首轮范围；[ADR-0025](0025-remote-mcp-and-capability-bindings.md) 的远程传输与 Run 生命周期目标。
- 替代范围：ADR-0025 的「仅静态认证、排除旧 SSE」、仅 2025 握手/会话假设，以及 OAuth 中仅访问 MCP 配置地址的限制。ADR-0024 的凭据所有权与保护、Agent Core 边界和已有工具/材料授权不变。

## 背景

用户要求设置中的 MCP 按最新规范支持本地与远程 server、不同传输方式，并明确选择本次包含 OAuth 浏览器登录。现行产品只支持 stdio；旧远程设计排除 OAuth 与旧 HTTP+SSE。官方现行版本为 2026-07-28，改为逐请求元数据与无协议会话，不能只在旧 client 上增加 HTTP 字段就宣称兼容。

## 决策

1. 支持 stdio、Streamable HTTP 和明确标注的旧 HTTP+SSE。官方 SDK 明确开启 auto 新旧版本协商；HTTP 到旧 SSE 的握手回退由显式选项授权，默认关闭，不在工具调用中回退或重放。
2. HTTP 认证支持 none、Bearer、API-key header 与 OAuth；stdio 使用普通环境变量及受管机密映射，不通过参数传密钥。
3. OAuth 使用系统浏览器、loopback 回调、PKCE S256、state/issuer 校验及 resource 绑定；客户端身份为 issuer 绑定的预注册信息、已有 HTTPS Client ID Metadata Document 或 DCR 兼容。产品没有已发布 metadata URL 时不捏造、不自动部署；缺身份时显示修复要求。
4. OAuth 的已验证 metadata/issuer/授权/token 端点形成独立目的地集合。私网端点显式确认，拒绝 SSRF/未授权重定向/证书绕过；认证权限变更在设置中处理，运行期不自动打开浏览器或扩权。
5. 凭据复用现有 Main safeStorage 服务，按 connection/issuer/resource 分隔，加密保存 token/refresh token/client secret；授权码/state/verifier 仅内存。刷新与主动撤销区分，晚到取消结果不能落库。退出登录、停用、移除取消受影响 Run，保留历史身份。
6. 保留配置修订、具体工具合同审阅与 Run-owned client 的方案。连接检测与执行独立，现代取消/旧会话清理按实际版本执行；Agent Core 仍只接收 AgentTool，不导入 MCP SDK。
7. MCP 专项复用已有凭据基础，不以前置开发百度 API profile 为条件；实施前在现有 CF 唯一任务板区分实现依赖与验收依赖，不代签 CF12/A/B0/E 等验收。

## 取舍与验收

显式传输选项保留可解释性，自动版本协商减轻用户负担；旧 SSE 兼容需要同源 endpoint 校验。浏览器登录扩大认证网络边界，因此需要独立的 issuer/endpoint 校验与可取消状态机。原生桌面 OAuth 不保证任意服务无需注册即可登录。

本决策不新增资源/提示词、sampling/elicitation、写工具、Tasks/MCP Apps 扩展、公开市场、云代理或新的 Agent 引擎。具体字段、流程、限额和验收矩阵以产品方案为准；实施时同步现有 capability-contracts 与 CF 任务板，不建立第二套工程规范。

设计已由用户确认；代码、迁移、离线报文与真实接入的验证分别记录，Accepted 不代表实施或人工验收已经完成。
