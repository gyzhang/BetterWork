# 参考项目与借鉴边界

BetterWork（算台）是全新建设的项目。以下三个本机项目是产品设计和工程实现的重要参考，但不是 BetterWork 的代码依赖，也不是直接合并或 Fork 的来源。

## 参考项目

| 项目 | 本机仓库路径 | 主要参考内容 |
| --- | --- | --- |
| 网易有道龙虾 LobsterAI | `/Users/kevin/Dev4AI/LobsterAI/` | 桌面产品的信息架构、任务交互、界面设计、视觉完成度和用户引导 |
| ClawBible Desktop | `/Users/kevin/Dev4AI/ClawBible.AI/clawbible-desktop/` | Agent Loop、工具运行时、模型接入、知识处理、Office 能力和桌面应用工程实践 |
| ClawBible Cloud | `/Users/kevin/Dev4AI/ClawBible.AI/clawbible-cloud/` | 面向 AI Agent 的协作资产组织方式：分层规则、任务路由、SOP、工作日志与规则门禁 |

## 借鉴原则

### LobsterAI

重点观察：

- 用户如何发现并启动任务
- 工作区、任务、运行状态和结果如何组织
- 复杂 Agent 过程如何逐步呈现
- 产物、设置和能力入口如何降低学习成本
- 视觉语言如何服务于长期使用，而不是只服务于演示

不得继承：

- OpenClaw 作为运行引擎
- 与 OpenClaw 深度耦合的会话、插件、IM、任务和打包结构
- 不符合 BetterWork 领域模型的历史业务状态

### ClawBible Desktop

重点观察：

- Agent 执行循环和工具调用实践
- 模型、视觉模型、嵌入模型等能力的接入方式
- 知识库、文档处理和 Office 工作流经验
- Electron 应用的启动、停止、构建和发布工程脚本
- 已经经过实际验证的错误处理和用户交互细节

不得直接继承：

- 旧项目的 Electron 主进程、IPC、数据库和业务状态
- 与 ClawBible 产品定位绑定的领域对象和界面结构
- 未经重新评估的全局状态、历史兼容代码和临时补丁

### ClawBible Cloud

重点观察：

- `.qoder/rules/` 的分层方式：常驻铁律与按场景触发（关键词、glob）的规则拆分
- 按任务类型的必读路由表，以及"AGENTS.md 为入口、多工具共用同一套规则"的单一规则源实践
- 工作日志的按天模板，以及"教训回流为规则"的机制
- 面向 Agent 的确定性脚本入口（启动、停止、数据库、验证）

不得直接继承：

- 其业务代码、后端架构和多租户领域模型
- 与 Cloud 产品绑定的具体规则内容——借鉴时必须按 BetterWork 的领域语言和实际路径重写

## 查阅顺序

实现相关功能时，先阅读 BetterWork 自己的产品和架构文档，再查阅参考项目中的对应实现。参考项目用于获取经验和验证假设；如果参考实现与 BetterWork 的产品目标、`AGENTS.md` 或领域边界冲突，以 BetterWork 的约束为准。

本文件记录的是开发环境中的本机路径。路径不存在时，不应自行复制或创建替代仓库；应先确认项目位置是否发生变化。
