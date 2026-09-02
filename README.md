# 算台 BetterWork

算台（BetterWork）是一款面向知识工作者的个人 AI 工作台。

它帮助用户利用个人知识库、长期记忆和新获得的信息，持续完成深度研究、Excel 分析、Word 文档编写以及 PPT 创建与修改。

算台首先是一个结构清晰、便于学习的桌面智能体教学项目；同时从领域模型和技术边界上为后续成长为个人知识工作台做好准备。

## 产品定位

> 以我所知，成我所作。

算台理解并调用你的资料、记忆与工作方法，帮你完成研究、分析、文档与演示。

算台的核心不是聊天，而是工作成果：

- 有来源、有证据的研究报告
- 可复核、可继续加工的数据分析
- 符合模板和风格要求的 Word 文档
- 逻辑完整、视觉稳定的演示文稿
- 可预览、可修改、可回退的 Artifact

## 核心原则

- Local-first：知识、记忆、索引和工作成果由用户在本地管理。
- Artifact-first：聊天是协作入口，Artifact 是主要交付物。
- Evidence-backed：重要结论尽量关联可回溯证据。
- Human-in-the-loop：在大纲、口径、危险工具和最终交付处提供确认点。
- Progressive disclosure：知识和记忆按需加载，不把全部内容塞入模型上下文。
- Engine-agnostic：Agent Core 不依赖 Electron、React、SQLite 或某一家模型服务。
- Start small, grow cleanly：功能从简单起步，领域边界从长期产品目标出发。

## 文档导航

- [文档总览](docs/README.md)
- [产品定义](docs/01-product-definition.md)
- [领域模型](docs/02-domain-model.md)
- [系统架构](docs/03-system-architecture.md)
- [知识库与记忆](docs/04-knowledge-and-memory.md)
- [Tool、Skill、专家与套件](docs/05-capability-system.md)
- [研究与 Office 工作流](docs/06-knowledge-workflows.md)
- [MVP 与路线图](docs/07-mvp-and-roadmap.md)
- [品牌与视觉方向](docs/08-brand.md)
- [架构决策记录](docs/adr/README.md)

## 当前阶段

当前为产品与架构基线 `v0.1`。下一步是搭建桌面应用骨架，并完成第一条最小端到端执行链路。
