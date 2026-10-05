# DeepSeek Harness「一切皆插件」对 BetterWork 的架构参考评估

- 日期：2026-10-05
- 状态：研究建议，不构成架构决策、路线图变更或开工授权。
- 核对基线：本机 `/Users/kevin/Dev4AI/deepseek-harness`，tag `dsh-v0.2.1-alpha.1`，commit `5badb15009`（2026-10-03）；并检索官方文档、社区案例与近期独立评测/预印本。
- 方法边界：静态阅读仓库与网页，没有安装或运行 Harness/Desktop，也没有做可复现的产品质量测试。

## 结论

**DeepSeek Harness 值得作为扩展架构的强参考，但当前不建议把 BetterWork 整体迁移到 Cordis 或“一切皆插件”运行时。** 建议吸收它的扩展点设计、显式依赖、配置组合可观察性和卸载生命周期；BetterWork 继续由 Application/Main 管理领域真相、权限和 Run 快照，插件宿主是否成为产品能力留待明确的生态需求出现后再立项。

判断分开看：

| 问题 | 结论 |
| --- | --- |
| 架构是否有借鉴价值 | 高。它把插件提升为运行时组合机制，并把模型、Agent Loop、Session、工具和 UI 纳入可替换边界。 |
| BetterWork 现在是否需要动态插件宿主 | 证据不足。现有接口与契约已围绕 Skill、Expert、Tool、Provider、MCP 和 Run 快照提供受控扩展路径，覆盖当前路线图。 |
| 是否值得整体迁移 | 目前不值得。迁移会改变执行循环、状态组织、权限与历史归因的所有权，收益还没有被 BetterWork 的产品需求证明。 |
| 后续何时重审 | 多个独立团队/作者需要发布运行时代码扩展，且 Skill、MCP 和固定 Tool 接口无法表达时；先做隔离的扩展切片，再比较维护成本和端到端收益。 |

## DeepSeek Harness 实际采用了什么

它不是在固定 Agent 外围增加几个插件入口。Cordis 插件可以提供服务、类型化事件与可撤销副作用；官方架构将模型适配器、Tool 注册、Session 日志和 Agent Loop 都放进同一组合树。Profiles 按有序 Bundles、Profile patch、用户级 patch 和命令行 overlay 合成，配置可热更新时由 HMR 管理组件替换与释放。官方文档还把 Host 与浏览器客户端扩展分成两套协作的模块机制，客户端插件通过声明式依赖图与 Web 启动协议装载。

官方 Desktop 是 Electron 壳：它启动随包交付的 Harness Host/profile runner，再装载完整 Web 应用；插件依赖由随 Desktop 附带的 pnpm 管理。它没有另造一个 Agent 引擎或 Desktop 专属插件格式。这个“宿主负责产品与生命周期、Web 端负责界面”的切分可借鉴，但完整系统也因此包含 profile 合成、包安装、版本兼容、HMR、卸载清理、桌面运行时打包等多套工程问题。

需要把“可组合”和“隔离”分开：官方安全说明称项目仍是未审计的 developer preview；官方 Plugin Manager 文档明确说明，已安装 Host 插件代码在当前进程内执行，并位于 Workspace sandbox 之外。插件启停需要管理共享 Profile，热更新还需协调模块卸载及依赖释放。因此插件信任必须当作代码执行授权，不能把 Cordis 生命周期或配置开关称为进程沙箱。

## 外部反应、评测与使用案例

公开讨论显示出明显的开发者兴趣，也有产品化与易用性担忧。证据主要来自开源社区帖子、个人实测和预印本；它们能说明探索方向，尚不能证明企业级稳定性或“一切皆插件”本身提高了任务成功率。

| 证据/案例 | 观察到的反馈 | 对 BetterWork 的含义 |
| --- | --- | --- |
| [2026-08 的第三方实测](https://deepseekagent.io/zh/deepseek-harness-review)（测试基线为旧版 `0.1.0-rc.6`） | 认为项目更适合想改造 Agent 的开发者，而非只想直接完成编码任务的用户；指出 Bundle、Profile、patch/overlay 有学习成本，故障排查会横跨模型、依赖、配置层和工具；作者没有测任务成功率，并明确说生态仍早期。它不是对当前 `0.2.1-alpha.1` 的复测。 | 架构开放度可以很高，但产品理解成本、诊断和引导仍需单独建设。不要把技术可扩展直接换算成用户价值。 |
| [社区对 Creator Mode 的讨论](https://www.reddit.com/r/DeepSeek/comments/1vthl6g/deepseek_harness_the_everything_is_a_plugin_pitch/) | 一位用户认为复杂插件难以靠提示词一次做对；回复者认可技术路线，但也提到重复集成、质量筛选和普通用户门槛，并举例自己在日常工作中替换搜索实现、按多个 API 路由。讨论同时呈现“可改造很有吸引力”和“插件质量/入口仍混乱”两面。 | 插件最先为懂得调试和承担维护的人创造价值；面向一般用户还需要精选、兼容标注和失效诊断。 |
| [实际插件：Visualizer](https://www.reddit.com/r/DeepSeek/comments/1vytc75/built_visualizer_plugin_for_deepseek_harness/) | 作者展示了把图表、流程图和交互解释以生成 HTML 的方式嵌入 sandboxed iframe，并可导出 HTML。 | 插件 UI 可以试验 BetterWork 尚未定型的表现形式；成果型内容更适合经 Artifact/版本/来源链路登记，不能只留在会话内嵌页面。 |
| [实际插件：会话树](https://www.reddit.com/r/DeepSeek/comments/1vtvbmw/i_built_a_conversation_tree_for_deepseek_harness/) 与 [记忆引擎](https://www.reddit.com/r/DeepSeek/comments/1wv0bfc/operator_memory_plugin_for_deepseek_harness/) | 社区开发者分别扩展旁支会话/Session 行为，以及把 Markdown 记忆与检索逻辑接进 Agent Loop。会话树作者主动提示 Harness 升级后可能需要适配；记忆项目介绍则明确主张改造 Loop，而不是只附加检索 Tool。两者是作者自述案例，不代表独立验收。 | 当扩展必须改变 Agent Loop 或产品状态时，代码插件确实表达力更强；代价是扩展要跟随宿主内部契约和版本演进。BetterWork 的记忆已有独立持久化、确认治理和来源关系，不宜为追求同一插件模型而合并。 |
| [官方社区 RFC：Marketplace 与 Profile 目标](https://github.com/deepseek-ai/deepseek-harness/discussions/8317) | 2026-09-29 的讨论指出 Desktop 安装/管理绑定运行中的 Profile，提出安装时选择 Profile 的需求。 | 即使有可组合 runtime，分发目标、Profile 所有权和 UI 入口仍需要产品决策；市场规模不是运行时架构自动解决的。 |
| [`Finding the Right Fit`](https://arxiv.org/abs/2610.00917)（2026-10-01 arXiv 预印本） | 66 组模型—Harness 配置在三类任务集上比较，最佳 Harness 会随模型和任务集变化；DeepSeek Harness 在部分 DeepSeek/GLM 的 Terminal-Bench 配置中领先，但并非普遍领先，文中 GPT 配 PI 的一项配置在该集合上成本更低、分数更高。作者明确说明工具、预算未完全统一、每题一次运行，不能隔离单个架构部件的因果贡献。 | 可插拔的直接价值之一是让团队实测“模型 × Tool × Loop × 任务”的组合；该研究不证明 DSH 插件架构优于固定/较轻的 Harness，更不证明迁移 BetterWork 会提升效果。 |
| [`CordisBench`](https://arxiv.org/abs/2609.01600)（2026-09-01 arXiv 预印本） | 对依赖、卸载顺序和副作用清理做了 1,200 道受控题；随着相关交互从小规模增多，模型在预测最终状态和跨卸载顺序推理上变得不可靠。论文建议把可形式化的生命周期结果交给程序验证/计算。它测的是模型理解生命周期的能力，不是 DSH 日常用户的满意度。 | 不应依赖模型自己记住当前插件图并安全改装运行时。若有动态扩展，依赖校验、Run 解析、卸载清理、回滚和兼容检查必须由宿主确定性地执行。 |

## 与 BetterWork 的适配

BetterWork 当前强调的核心不是“任意重组整个 Agent”，而是“以确定的材料、能力和来源完成知识工作，并能回到精确成果版本”。已有架构已提供若干清晰接点：

- [Agent Core 边界](../03-system-architecture.md#4-agent-core)由 Main/Application 注入 `ModelProvider`、`AgentTool` 和已解析上下文，Core 只产生有序运行事件，不读取 SQLite 或 Electron。
- [Expert/Task/Run 契约](../development/expert-contracts.md)把 Skill 和模型引用绑定到具体修订；配置变更不热换进行中的 Run。
- [材料契约](../development/material-contracts.md)将 Knowledge、ArtifactVersion 和输入快照解析为 RunContextSnapshot；搜索/读取和成果来源都按这份范围约束。
- [API 与 MCP 契约](../development/capability-contracts.md)要求 Main 检查启用状态、归属、凭据和 Run 成员关系，并保留 Skill/MCP 等不同能力类别的各自边界。
- [工程规范](../12-engineering-standards.md#2-目录结构)已经采用“Tool 工厂 + 闭包注入”，让执行模块不依赖 Electron、SQLite 或厂商 SDK。

两者可以共用“明确的扩展点与可观测组合”思想，但归属不同：DeepSeek Harness 将 Agent Loop 和 Session 实现也作为可替换插件；BetterWork 当前把 Workspace/Task/Run、Artifact/Evidence、Knowledge 和 Memory 当成用户工作的持久领域关系，由 Main 和 SQLite 保持真实。把后者整体交给开放插件树，会放大数据迁移、历史 Run 解释、权限撤销和 Artifact 来源兼容的范围。

另外，Skill 与代码插件不是一个概念。BetterWork 的 Skill 是有版本、信任状态、任务绑定、命令声明和运行结果记录的工作方法；MCP 是单独的远端工具连接；Expert 是配置化角色；Provider/Tool 是宿主认可的接口实现。把它们统一塞进一个泛化 `Plugin` 类型，会失去各自不同的授权、来源和快照语义。

## 建议采取的借鉴范围

**现在可吸收：**

1. 为 Provider、Tool、Skill executor、MCP adapter 等接点维护简短的“契约定义—实现—使用者”图和扩展点索引，新增能力时检查数据所有者、权限、版本、失败、取消和生命周期。
2. 让有效 Run 能力集合可解释、可审阅、可复现：从稳定 ID 和具体修订解析；在 Main 固定进 Run 快照；配置变化作用于后续 Run。不要依赖任意启动顺序或隐式“最后覆盖者胜出”。
3. 若未来出现 Renderer 扩展需求，先考虑产品批准的语义化槽位和类型化声明，保持主导航、主题 Token、反馈出口和 Artifact 结构的所有权；不开放任意注入页面/样式代码。
4. 将插件安装/启停与运行中能力装配分开验证；插件包升级、卸载、取消及失败清理都要有可诊断状态，且历史 Run 仍能说明当时实际用了什么。

**当前不建议：**

- 把 Agent Loop、SQLite 领域模型、Artifact/Evidence、Knowledge/Memory 或 IPC 边界迁移为开放的 Cordis 插件。
- 为支持“万物皆插件”先建设社区市场、动态 HMR、任意第三方 JS 执行或通用 Extension SDK。
- 将用户 Skill、MCP 工具、Expert、Provider 和 UI 插件合并成一种同质能力；或让模型仅凭对话直接永久更改全局运行 Profile。

## 重审迁移的触发条件

当多个独立作者需要分开发布 BetterWork 的代码扩展，且当前 Skill、MCP、受控 Tool/Provider 接口确实表达不了所需行为时，可发起新的架构评估。先挑一个边界清晰、可撤销、非核心领域状态的能力做垂直试点，验证安装/升级兼容、显式信任、最小权限运行、取消和卸载、失败恢复、Run 快照与审计，以及对开发/支持成本的实际影响。若扩展要在主进程内拥有任意代码权限，应把它作为用户信任选择明确呈现；若需要对不可信扩展作隔离承诺，就必须设计进程/Worker 隔离和窄协议，而不能只借用 Cordis 的卸载机制。

因此当前更合适的定位是：**研究并采用它的扩展治理经验，保留 BetterWork 已验证的领域与运行边界；是否把扩展宿主产品化，等需求和试点证据出现后再决定。**

## 资料来源

- 官方仓库快照：[`deepseek-harness` @ `5badb15009`](https://github.com/deepseek-ai/deepseek-harness/tree/5badb15009)、[README](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009/README.md)、[架构说明](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009/docs/architecture.md)、[Desktop 说明](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009/apps/desktop/README.md)、[客户端模块说明](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009/docs/subsystems/client-modules.md)、[Plugin Manager](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009/packages/boot/plugin-manager/README.md)、[安全说明](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009/SAFETY.md)。
- 社区实测：[DeepSeek Harness 实测：插件架构、使用体验与优缺点](https://deepseekagent.io/zh/deepseek-harness-review)（标注测试基线 `0.1.0-rc.6`）。
- 社区反馈/案例：[Creator Mode 讨论](https://www.reddit.com/r/DeepSeek/comments/1vthl6g/deepseek_harness_the_everything_is_a_plugin_pitch/)、[Visualizer 插件](https://www.reddit.com/r/DeepSeek/comments/1vytc75/built_visualizer_plugin_for_deepseek_harness/)、[会话树插件](https://www.reddit.com/r/DeepSeek/comments/1vtvbmw/i_built_a_conversation_tree_for_deepseek_harness/)、[记忆插件](https://www.reddit.com/r/DeepSeek/comments/1wv0bfc/operator_memory_plugin_for_deepseek_harness/)、[Profile 分发 RFC](https://github.com/deepseek-ai/deepseek-harness/discussions/8317)。均为作者/用户帖子，非审计或独立验收。
- 近期研究：[Finding the Right Fit: Model–Harness Interactions across Agent Tasks](https://arxiv.org/abs/2610.00917)（2026-10-01 预印本）；[CordisBench: Can Language Models Reason About Component Lifecycles in Dynamic Agent Harnesses?](https://arxiv.org/abs/2609.01600)（2026-09-01 预印本）。
