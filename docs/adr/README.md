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

ADR 一经 Accepted 不直接重写历史；需要改变时新增 ADR 并标记替代关系。

The [API/MCP design](../designs/api-tools-and-remote-mcp.md) and [capability contracts](../development/capability-contracts.md) describe the proposed increment. ADR-0024 proposes replacing ADR-0007's global provider selection/plaintext credential decisions; ADR-0025 proposes extending ADR-0016/0021. Existing accepted records and implementation/acceptance statuses are unchanged. Product development requires a separate instruction.
