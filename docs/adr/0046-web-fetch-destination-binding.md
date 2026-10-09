# ADR-0046：公开网页 DNS 与实际连接绑定

- 状态：Accepted（2026-10-09，用户选择“同意完整方案并实施”；实现与验收证据另记）
- 前置：[ADR-0017](0017-web-fetch-and-evidence-boundary.md)、[R05 与 B2](../reviews/2026-10-09-code-refactoring-review.md)。

本记录补强 ADR-0017 的目的地条款，替代其“真实 DNS 解析仍属人工验收”的实现边界，并明确 15 秒为一次读取的总预算；原接受历史保留。工具错误沿用 Core 的可恢复策略：超时产生带原因的 `tool.failed`，不伪造 `tool.completed`/Evidence，也不直接把 Run 标成取消；用户取消产生 `run.cancelled`。Run 最终是否失败或继续完成由既有 Agent 策略决定，B2 不修改该策略。

## 既有契约修正

B2 已授权修正字面目的地分类与取消原因：先用 `node:net.isIP` 区分域名/IP，再用网段分类；正常 `fc`/`fd` 域名可以读取，私网、环回、未指定、链路本地、共享地址、组播及保留地址拒绝。IPv4 映射 IPv6 沿用 ADR-0017 的拒绝规则；localhost、`.localhost` 和 `.local` 的绝对域名尾点表示也拒绝。用户取消沿用 Core 的取消词汇，15 秒请求超时明确工具失败。

## 决策

1. `web_fetch` 继续只读公开网页，不新增私网授权入口、不借用 MCP 的 private/loopback 授权；保留 HTTP/HTTPS、无 URL 凭据、最多三次重定向、现有正文与 Evidence 接口。
2. Main 使用已安装的 Undici 6.28.0，为每一跳创建独立 Agent；不新增依赖，也不跟随全局 dispatcher、环境代理或 Electron 代理配置。原 URL 的域名保留在 HTTP Host、TLS SNI 与证书验证中，证书验证始终开启。
3. 每一跳先 `lookup(hostname, { all: true, verbatim: true })`。空结果、非法地址或混合公网/禁用地址全部拒绝；字面 IP 无须 DNS，但同样校验。禁止地址策略与第 1 节一致，另排除 IPv4 文档/基准测试/协议保留网段及 IPv6 文档、转换、隧道与非全球单播目的地。完整列表随实现与测试固定，依据 IANA 登记；不是“做过一次 lookup 就算安全”。
4. 选择已验证的第一个地址，Agent 的实际 socket lookup 只返回该地址（包含 Node 的单地址与 `all` 两种回调形状），不得再次调用系统 DNS；本跳连接失败明确失败，不自动尝试未验证地址。不改 URL 为 IP，不关闭 TLS 验证。
5. 请求固定 `redirect: 'manual'`。先释放本跳响应与 Agent，再校验、重新解析、绑定下一跳，即使是同主机重定向也重新解析。禁止自动重定向、跨跳连接池复用和从返回正文触发额外请求；重定向到内网在发出下一次 HTTP 请求前拒绝。
6. 一次网页读取共用 15 秒预算，覆盖 DNS、连接、所有重定向与正文；用户取消和超时分别保留第一原因。DNS 无法强制撤销时只结束等待，迟到结果不得建 Agent、派发请求或产生 Evidence。
7. 成功、拒绝、HTTP/正文错误、截断、取消和超时都取消未读响应并销毁本跳 Agent。RunService 既有在途工具消费负责等待网页调用结束，不新增后台所有者或数据库迁移。既有响应截断数值与 Evidence 字段保持，单位整理不在本方案范围。
8. 可注入 DNS、fetch 与 Agent 工厂作离线测试；生产默认必须走上述绑定适配器。测试既验证混合回答、重解析与逐跳拒绝，也调用生产传给 Agent 的 lookup，证明 socket 所得地址与批准地址一致，并核对 URL/Host/TLS 语义和资源释放。替身证据不冒充真实公网或安装包验收。

## 取舍

本次落实完整绑定：把公开网页的目的地规则兑现到连接层，但会明确拒绝某些此前可连接的特殊地址，也不自动使用系统代理；需要代理才能访问的网页会返回可解释错误。只落实字面校验的备选方案未采用。

采用首个已验证地址使行为可解释；多地址故障转移、代理支持和私网网页读取均不进入 B2。MCP 的连接授权、OAuth、重定向与传输策略独立保持。

## 技术依据

固定地址策略：IPv4 拒绝 `0/8`、`10/8`、`100.64/10`、`127/8`、`169.254/16`、`172.16/12`、`192.0.0/24`、`192.0.2/24`、`192.88.99/24`、`192.168/16`、`198.18/15`、`198.51.100/24`、`203.0.113/24` 及 `224/3`。IPv6 仅接受 `2000::/3`，再排除 `2001::/23`、`2001:db8::/32`、`2002::/16` 与 `3fff::/20`，拒绝 zone id。前述 IPv6 入口同时排除未指定、环回、映射、转换、私网、链路本地、旧站点本地和组播。协议用途网段整体保守排除，包括其中部分 IANA 标为全球可达的特殊分配；这是公开网页工具的策略选择，不声称与 IANA 的全球可达列逐项等价。未进行远程连接探测，不声称所有通过分类的地址都可实际访问。

核对本仓 Undici `types/connector.d.ts` 与 `lib/core/connect.js`：connect options 传给 Node TCP/TLS，hostname 与 TLS servername 仍来自原请求。网段解析使用 [Node BlockList](https://nodejs.org/docs/latest-v24.x/api/net.html#class-netblocklist)，地址性质参照 [IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry/) 与 [IANA IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry/) 登记；不引入仅靠字符串前缀的判断。
