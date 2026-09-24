# 算台文档总览

本目录是算台 BetterWork 的产品与技术决策真相源。产品方向或关键架构发生变化时，应先更新相关文档或新增 ADR，再修改实现。

## 产品文档

| 文档 | 作用 |
| --- | --- |
| [产品定义](01-product-definition.md) | 说明为谁解决什么问题，以及明确不做什么 |
| [领域模型](02-domain-model.md) | 定义 Workspace、Task、Run、Artifact、Evidence 等核心对象 |
| [系统架构](03-system-architecture.md) | 定义 Electron、Agent Core、工具运行时、存储与 Worker 的边界 |
| [知识库与记忆](04-knowledge-and-memory.md) | 定义个人知识库、渐进记忆、检索与模型角色 |
| [能力体系](05-capability-system.md) | 定义 Tool、Skill、Expert、Kit、Workflow 的职责和关系 |
| [知识工作流](06-knowledge-workflows.md) | 定义研究、Excel、Word、PPT 的目标管线 |
| [MVP 与路线图](07-mvp-and-roadmap.md) | 定义第一阶段范围、验收标准和演进顺序 |
| [品牌](08-brand.md) | 定义“算台 BetterWork”的名称、文案与图标方向 |
| [参考项目与借鉴边界](09-reference-projects.md) | 记录 LobsterAI、ClawBible Desktop、ClawBible Cloud 的本机路径与借鉴边界 |
| [UI/UX 体系与落地计划](10-ui-ux-system.md) | 定义界面信息架构、视觉语言、组件规范和 Terra 实施顺序 |
| [Qoder 开发交接](11-qoder-handoff.md) | 记录当前实现基线、运行方式、架构入口、续作边界与验证要求 |
| [工程规范](12-engineering-standards.md) | 全仓唯一的代码规范：工具链、目录、命名、类型、异步与错误处理、持久化、IPC、测试与例外机制 |

## 技术设计提案

- [知识管理与使用基础闭环](designs/knowledge-foundation.md)：2026-09-24 归档的知识补齐产品规范；[ADR-0027](adr/0027-knowledge-foundation.md) 为 Proposed，[知识实施契约](development/knowledge-contracts.md) 定义固定修订读取、精确来源、嵌入/混合检索、索引生命周期与 Office 导入。只写文档，尚未编码，不改变 WM 的非向量召回。
- [API tools and remote MCP](designs/api-tools-and-remote-mcp.md): documented next capability increment for named API service profiles, protected credentials, and remote MCP; [ADR-0024](adr/0024-api-services-and-credentials.md) and [ADR-0025](adr/0025-remote-mcp-and-capability-bindings.md) remain Proposed. Documentation only; product development requires a separate instruction.
- [Skill 信任与本地分发](adr/0011-skill-trust-and-local-distribution.md)：已确认的产品规则，具体实现未落地。
- [Skill 执行器与依赖管理](designs/skill-executor-and-dependencies.md)：首个 PPT Skill 的执行、环境、文件成果与阶段 A 验收，配套 ADR-0010 为 Proposed。
- [工作型记忆产品设计](designs/work-centered-memory.md)：2026-09-22 归档，同日开工、2026-09-23 收口。近期产品范围已获用户确认；[ADR-0026](adr/0026-work-centered-memory.md) 仍记为 Proposed 但已按其技术方案实施，WM01–WM15 有自动化验收记录，人工验收见任务板（实施状态以任务板为准）。字段/算法/迁移/接口唯一真相源是[记忆实施契约](development/memory-contracts.md)。

## 开发执行规划

- [知识基础闭环 KM00–KM15](development/tasks-knowledge.md)：知识补齐的唯一任务板，全部新卡未开工；[Qwen3.8-Flash 编码交接](development/knowledge-coding-prompts.md)提供基线核对、单卡、恢复和里程碑指令。先评审 ADR 与文档线框，再在新会话逐卡编码；不改写 E/CF/WM 状态。
- [API/MCP capability contracts](development/capability-contracts.md): proposed fields, operations, readiness, Run resolution, migration, and acceptance requirements. Not a new implementation task board; existing A/B0/E statuses remain unchanged.
- [能力基础开发计划 CF00–CF51](development/tasks-capability-foundation.md)：把 API tools 与远程 MCP 设计拆成 M0–M5 六个里程碑与 17 张任务卡，与现有 A/B0/E 并行。里程碑入口不自动开工，需单独开发指令。
- [阶段 A 执行手册（供 5.6 Luna 使用）](development/README.md)：22 项顺序任务、共享实施契约、逐项验收与可复制派发提示词；仅规划，未开始实现。
- [阶段 B/C 后续规划](development/phase-b-c-roadmap.md)：专家配置、研究到汇报与积累复用。
- [工作型记忆开发计划 WM00–WM16](development/tasks-memory.md)：2026-09-22 建立的唯一 WM 任务状态板；[记忆实施契约](development/memory-contracts.md) 定义字段与算法，[记忆编码提示词](development/memory-coding-prompts.md) 提供逐卡可复制指令。仅 WM00（文档归档）已执行；WM01 起需用户先批准 [ADR-0026](adr/0026-work-centered-memory.md) 的技术方案，且与 A/B0/E/CF 任务状态互不改写。

## 架构决策记录

ADR 用于记录会影响多个模块、后续修改成本较高的决策。详见 [ADR 索引](adr/README.md)。

## 文档状态

- 版本：v0.2
- 状态：现有知识库/搜索/Markdown 能力作为实现基线；2026-09-08 已确认 Skill 配置 → 专家配置 → 研究到汇报的新顺序，细节见 [产品修订稿](reviews/2026-09-08-product-scope.md)
- 目标读者：产品设计者、开发者、贡献者和学习者

## 阅读约定

本目录同时承载**产品愿景**与**实现现状**两类内容：`01`–`06`、`08`、`10` 以长期目标和规范为主，`07` 定义阶段范围，`11` 记录当前真实实现基线。

判断「现在到底做到了什么」时，以 [Qoder 开发交接](11-qoder-handoff.md) 第 2 节的能力表为准，不要把其他文档中的目标管线、接口示例或能力清单直接当成现状。范围归属以 [AGENTS.md](../AGENTS.md) 与 [MVP 与路线图](07-mvp-and-roadmap.md) 为准；两者冲突时 AGENTS.md 让位不了，应先修路线图。
