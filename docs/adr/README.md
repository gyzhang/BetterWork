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

ADR 一经 Accepted 不直接重写历史；需要改变时新增 ADR 并标记替代关系。
