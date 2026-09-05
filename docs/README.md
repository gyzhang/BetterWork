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

## 架构决策记录

ADR 用于记录会影响多个模块、后续修改成本较高的决策。详见 [ADR 索引](adr/README.md)。

## 文档状态

- 版本：v0.2
- 状态：产品与架构已达成初步共识；UI Foundation 已落地，当前处于 Phase 1 研究报告 MVP 的知识库垂直切片
- 目标读者：产品设计者、开发者、贡献者和学习者

## 阅读约定

本目录同时承载**产品愿景**与**实现现状**两类内容：`01`–`06`、`08`、`10` 以长期目标和规范为主，`07` 定义阶段范围，`11` 记录当前真实实现基线。

判断「现在到底做到了什么」时，以 [Qoder 开发交接](11-qoder-handoff.md) 第 2 节的能力表为准，不要把其他文档中的目标管线、接口示例或能力清单直接当成现状。范围归属以 [AGENTS.md](../AGENTS.md) 与 [MVP 与路线图](07-mvp-and-roadmap.md) 为准；两者冲突时 AGENTS.md 让位不了，应先修路线图。
