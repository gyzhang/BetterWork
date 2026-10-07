# 架构决策记录

| ADR | 决策 | 状态 |
| --- | --- | --- |
| [0001](0001-greenfield-product.md) | BetterWork 采用全新项目设计 | Accepted |
| [0002](0002-artifact-first.md) | 产品采用 Artifact-first 模型 | Accepted |
| [0003](0003-agent-core-boundary.md) | Agent Core 与 Electron/存储解耦 | Accepted |
| [0004](0004-hybrid-memory.md) | 记忆采用文档、结构化记录和派生索引混合架构 | Accepted |
| [0005](0005-artifact-version-evidence.md) | ArtifactVersion 持久化来源 Evidence | Accepted |
| [0006](0006-notification-feedback.md) | 消息中心与三层反馈机制 | Accepted |
| [0007](0007-search-engine-config-and-web-search-tool.md) | 搜索引擎配置与 `web_search` 工具 | Accepted |
| [0008](0008-personal-workbench-and-capability-first.md) | 个人工作台定位、单专家多 Skill 与配置前置顺序 | Accepted |
| [0009](0009-script-skill-baseline.md) | 脚本型 PPT Skill 作为阶段 A 兼容基线 | Accepted |
| [0010](0010-skill-executor-and-dependencies.md) | Skill 执行器、依赖快照与文件成果 | Proposed |
| [0011](0011-skill-trust-and-local-distribution.md) | Skill 信任授权与本地目录分发 | Accepted |
| [0012](0012-composer-capability-binding.md) | 对话内能力绑定与 Composer `+` 菜单（Run↔Skill 改为 1:N） | Accepted（实现尚未落地） |
| [0013](0013-slide-preview-rendering.md) | 幻灯片预览的进程内渲染与本地补丁分发 | Accepted |
| [0014](0014-expert-context-and-material-binding.md) | 专家、任务准备与运行材料快照 | Accepted（E11–E25 已实现） |
| [0015](0015-memory-scope-and-governance.md) | 最小记忆的范围、确认与治理 | Accepted（E30 定案） |
| [0016](0016-mcp-transport-and-lifecycle.md) | MCP 首轮 stdio 传输、工具发现与生命周期 | Accepted（E40 定案） |
| [0017](0017-web-fetch-and-evidence-boundary.md) | 公开网页正文读取与证据边界 | Accepted（E43） |
| [0018](0018-office-input-parsing-boundary.md) | Office 输入解析边界与依赖 | Accepted（E50） |
| [0019](0019-discussion-checkpoints-and-rework.md) | 讨论节点、恢复与返工边界 | Accepted（E52） |
| [0020](0020-deterministic-business-analysis.md) | 经营分析的确定性数值边界 | Accepted（E53） |
| [0021](0021-mcp-evidence-provenance.md) | MCP 工具结果的来源证据 | Accepted（E42/E55） |
| [0022](0022-expert-reference-materials.md) | 专家常用参考材料与召唤注入 | Accepted（E22/E25） |
| [0023](0023-unspecified-material-purpose.md) | 材料“其他”用途与未指定来源关系 | Accepted |
| [0024](0024-api-services-and-credentials.md) | API service profiles and protected credentials | Proposed; documentation only |
| [0025](0025-remote-mcp-and-capability-bindings.md) | Remote MCP and versioned capability bindings | Proposed; documentation only |
| [0026](0026-work-centered-memory.md) | 工作型记忆的召回、来源治理与提炼边界 | Proposed（已按用户开工指令实施，接受状态待用户确认；WM01–WM15 有自动化证据） |
| [0027](0027-knowledge-foundation.md) | 固定知识修订、受限读取与可重建混合检索 | Proposed（仅文档，尚未编码） |
| [0029](0029-workspace-identity-and-sidebar-groups.md) | 工作空间身份与侧栏分组 | Accepted（2026-09-28 实施；迁移 v35，D1–D10 按原型推荐方案拍板） |
| [0030](0030-expert-card-metadata-and-deletion.md) | 专家卡片元信息与硬删除边界 | Accepted（2026-09-28 实施；0029 为工作空间身份记录） |
| [0031](0031-button-base-and-skin-closure.md) | 按钮基座与控件皮封闭清单 | Accepted（2026-09-28 实施；**替代** docs/10 §10.1 与 09-27 审计中「Button 不再组件化」那一条；`Input`／`Textarea` 那一半当时维持不变，2026-10-01 由 [0034](0034-input-control-base.md) 按同一判据反转） |
| [0032](0032-catalog-entry-card-facts.md) | 目录条目卡片的同一份事实 | Accepted（2026-09-30 实施；承接 [0030](0030-expert-card-metadata-and-deletion.md) §决策 1／5 并把它从专家推到技能，不改写 0030 的任何结论） |
| [0033](0033-typography-icon-and-surface-ladders.md) | 排版、图标与表面档位 | Accepted（2026-10-01 实施；六条新轴档位表＋Token＋护栏，**取代** docs/10 §9.7 那张与代码不符的推荐字号层级表；决策 10 挂给批次③的输入框几何同日由 [0034](0034-input-control-base.md) 兑现；决策 6 留开的定宽列段落内缩同日并到 16px 一档，列壳自己那道余量同日随后也并到 16px（两处刻意不并写明了理由），见 docs/10 §9.8） |
| [0034](0034-input-control-base.md) | 输入控件基座 | Accepted（2026-10-01 实施；**替代** [0031](0031-button-base-and-skin-closure.md) 决策 5 里 `Input`／`Textarea` 那一半，勾选轴仍留原生、判据写在 `type` 上） |
| [0035](0035-focus-ring-inside-control-box.md) | 焦点环画进控件自己的盒子 | Accepted（2026-10-01 实施，同日二轮把 `--focus-ring-offset` 由 `-1px` 改为 **`-3px`**——`-1px` 的环带只有一半在盒内，左右仍被贴边的滚动容器裁掉；现值让 2px 环整体住在盒内并留 1px 缝，一处几何，**替代** [0034](0034-input-control-base.md) 表第 7 行「聚焦环 → 1 处出口」的结论——`.composer textarea` 那条 `outline: 0` 当时作为例外留下，任务输入区因此从来没有焦点指示；2026-10-02 第三轮把降级块里那条 `transition-duration: 0.01ms` 改成 `0s`——`transition-property` 的初始值是 `all`，非零时长反过来替没声明过渡的元素造出过渡，把焦点环冻回盒外） |
| [0036](0036-macos-only-platform-scope.md) | 平台范围只有 macOS | Accepted（2026-10-02 光哥指令；门禁 runner 由 ubuntu 改 macos-latest 并去掉 xvfb-run，删掉测试宿主的 Linux `--no-sandbox` 分支；顺带照出 SkillsView 用例间漏偏好的真实缺陷，成对实验已验） |
| [0037](0037-scheduled-work-and-source-snapshots.md) | 周期工作实例与本期来源快照 | Proposed（2026-10-03 产品原型通过后细化；生产未开工） |
| [0038](0038-task-continuity-across-runs.md) | Task 跨 Run 的目标、要求、进度与恢复 | Accepted |
| [0039](0039-task-branches-and-protected-main.md) | 任务分支、PR 门禁与受保护的 main | Accepted（2026-10-05；替代 ADR-0036 的直接在 main 工作流约定） |
| [0040](0040-skill-runtime-requirements-and-app-components.md) | Skill 运行需求声明与应用级运行组件 | Proposed（2026-10-05 用户授权；2026-10-06 落地包内锁与元数据导入切片，完整样本验收未完成） |
| [0041](0041-file-artifact-workspace-delivery.md) | 文件成果在工作空间中的交付副本 | Accepted（2026-10-07 用户确认并授权实现） |

[ADR-0027](0027-knowledge-foundation.md)（Proposed，2026-09-24 文档归档）提出固定知识修订正文读取、嵌入/混合检索、索引作业与显式成果来源声明；延续 ADR-0014/0018，拟细化 ADR-0005 的访问与采用语义，不改变 WM 的非向量记忆召回。产品见[知识基础闭环](../designs/knowledge-foundation.md)，字段见[知识契约](../development/knowledge-contracts.md)，状态只看 [KM 任务板](../development/tasks-knowledge.md)。

ADR 一经 Accepted 不直接重写历史；需要改变时新增 ADR 并标记替代关系。

[ADR-0026](0026-work-centered-memory.md) 延续 [ADR-0004](0004-hybrid-memory.md) 的混合记忆边界，细化 [ADR-0015](0015-memory-scope-and-governance.md) 的来源与失败语义，并**拟替代**其固定范围优先的排序、Unicode 长度的含糊表述与「选中即实际注入」的解释，同时补足其范围缩小后的安全重放要求；它保留 [ADR-0014](0014-expert-context-and-material-binding.md) 的材料范围、[ADR-0005](0005-artifact-version-evidence.md) 的版本与来源、[ADR-0019](0019-discussion-checkpoints-and-rework.md) 的讨论节点事实边界。ADR-0026 获批准前 ADR-0015 全部条款仍然有效，两份记录的接受历史均不被改写。产品设计见 [work-centered-memory](../designs/work-centered-memory.md)，字段与接口见 [memory-contracts](../development/memory-contracts.md)，实施状态见 [tasks-memory](../development/tasks-memory.md)。

The [API/MCP design](../designs/api-tools-and-remote-mcp.md) and [capability contracts](../development/capability-contracts.md) describe the proposed increment. ADR-0024 proposes replacing ADR-0007's global provider selection/plaintext credential decisions; ADR-0025 proposes extending ADR-0016/0021. Existing accepted records and implementation/acceptance statuses are unchanged. Product development requires a separate instruction.
