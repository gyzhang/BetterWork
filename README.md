# 算台 BetterWork

<p align="center"><img src="docs/assets/betterwork-logo.svg" width="96" alt="算台 BetterWork 标志" /></p>

算台（BetterWork）是一款面向知识工作者的个人 AI 工作台。

它帮助用户利用个人知识库、长期记忆和新获得的信息，持续完成深度研究、Excel 分析、Word 文档编写以及 PPT 创建与修改。

算台首先是一个结构清晰、便于学习的桌面智能体教学项目；同时从领域模型和技术边界上为后续成长为个人知识工作台做好准备。

## 产品定位

> 以我所知，成我所作

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
- [参考项目与借鉴边界](docs/09-reference-projects.md)
- [UI/UX 体系与落地计划](docs/10-ui-ux-system.md)
- [架构决策记录](docs/adr/README.md)

## 当前阶段

当前正在开发 Phase 0：项目骨架与教学链路。仓库已经具备 Electron 三层结构、类型化 IPC、最小 Agent Loop、工具调用、SQLite Run Journal 与执行时间线。

在进入知识库与研究报告开发之前，项目先完成 [UI Foundation](docs/10-ui-ux-system.md)：统一应用外壳、任务工作区、过程/资料/成果上下文面板和模型设置体验。现有界面只作为工程链路原型，不作为长期产品视觉基线。

Phase 0 当前使用 Fake Model Provider，让事件顺序和工具行为可以稳定复现。输入 `计算: (12 + 8) * 3` 或 `读取: README.md` 可以观察一条完整执行链路。

## 本地开发

要求 Node.js 22.12 或更高版本。

```bash
npm install
npm run setup:runtime
npm run dev
```

也可以使用带有 PID 和日志管理的开发脚本：

```bash
npm run dev:start
npm run dev:stop
```

默认日志和 PID 文件分别位于 `/tmp/betterwork-dev.log` 与 `/tmp/betterwork-dev.pid`，也可以通过 `BETTERWORK_DEV_LOG`、`BETTERWORK_DEV_PID` 覆盖。

提交前执行完整验证：

```bash
npm run verify
```

仓库内的 [AGENTS.md](AGENTS.md) 是持续开发约束。开始新功能前，应同时阅读它和对应的产品、架构文档。
