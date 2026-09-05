# ADR-0007：搜索引擎配置与 web_search 工具

- 状态：Accepted
- 日期：2026-09-05

## 背景

研究报告 MVP 需要「网络新信息」（路线图「Web Search / Fetch」）。市场上存在多家搜索服务商，本切片先接入百度千帆 AI 搜索（`/v2/ai_search/web_summary`），但配置与工具层必须允许后续接入其他服务商而无需重构。

## 决策

- 配置持久化在 SQLite 新表 `search_engine_configs`，每个服务商一行（provider 为主键），`enabled` 全局唯一（保存时事务清零其他行）；API Key 与 `model_profiles` 一致明文存储，列表接口只回 `apiKeyConfigured`，原文 Key 仅主进程内部可用。密钥只经设置 UI 录入，不入代码、测试、日志与错误信息。
- 服务商标识 `searchProviderIdSchema` 当前仅含 `baidu_qianfan`；HTTP 客户端按 provider 放在主进程（`apps/desktop/src/main/search-engine-service.ts`）。新增服务商 = 增加一个枚举值 + 一个请求构造实现 + 一个设置页选项。
- 智能体通过 `packages/tool-runtime` 的 `web_search` 工具使用搜索：工具工厂只接收注入的检索函数，与 `knowledge_search` 同构；RunService 仅在存在已启用且已配置 Key 的引擎时注册该工具。
- web_summary 返回的 references（title/url/content/site/date）在同一 Run 内去重登记为 `sourceType: 'web-page'` 的 Evidence，与本地文件 Evidence 共用同一张表和 ArtifactVersion 关联；本切片不提供打开外部网页的能力。

## 结果

联网搜索成为与本地知识检索并列的来源通道，成果版本的来源清单可同时呈现本地资料与网页来源。密钥的 safeStorage 化、网页正文 Fetch、更多服务商接入留待后续切片，各自评估后另立决策。
