# ADR-0010：Skill 执行器与依赖管理

- 状态：Proposed
- 日期：2026-09-08
- 背景授权：用户要求设计支撑首个 PPT Skill 的执行器与依赖管理；执行技术仍未确认、未实现。后续信任选项、默认执行和本地目录分发规则已单独确认，见 [ADR-0011](0011-skill-trust-and-local-distribution.md)。
- 关系：落实 ADR-0009 的脚本兼容要求，保留 ADR-0003 内核边界；扩展 ADR-0005 到文件成果，来源派生的具体迁移在相应切片完成。

## 背景

样本依赖完整目录、Python 包、本地 ppt-master、项目文件写入和质量门。现有 Agent Tool 已有取消与进度输入，但引擎取消后不等待工具退出；Artifact 仅支持 Markdown。单独增加配置页面不能满足样本。

## 提议

1. Skill 原包不可变修订 + SQLite 宿主运行配置；路径和结果适配可追溯，不要求用户重写专有 manifest。
2. 默认受管 Python + 以目标平台/完整包锁确定的 venv；支持本机基础解释器，但不向系统包目录安装。不在任务中临时 pip/git。
3. 本地外部工具链导入为带 hash 的快照，包含所选本地修改；运行绑定 Skill/config/environment/dependency 的固定修订。
4. Application 组装 executable/argv/cwd/env，Tool Runtime 工厂注入执行服务。使用 CLI 子进程与 supervisor，不采用常驻 Python RPC 引擎。
5. macOS 使用 guardian 和独立进程组，Windows 使用 suspended 启动并加入 Job Object；正常、失败、取消和父进程断开都清理本次进程树。RunService 在 Run 终态发布前等待清理，失败明确收口。
6. 首版采用受信任本地代码模式；宿主代理路径受限，原生脚本仍有当前用户权限。不是恶意代码文件/网络沙箱。启用授权按修订记住，不逐条脚本重复确认；具体限制见设计 §7。
7. 模型通过资源读取、任务文件写入、注册 CLI 执行和结果登记工具完成工作，不提供任意 Shell 字符串执行 IPC。
8. 增加 presentation 文件成果、执行报告与分项验证状态；检测 issues 即失败，不能仅按原校验器退出码判断。发布关联本次执行和文件 hash，拒绝旧产物与取消后的迟到结果。

## 影响

需新增版本化配置/依赖/执行记录、文件成果迁移、协议输入输出与取消收口测试；小型平台 supervisor 及安装制品也属于阶段 A 的工作量。venv 是依赖隔离，不是权限隔离。恶意代码隔离如果成为要求，需另立方案，不能沿用本提案的保护承诺。

## 验收与未验证项

实施按 A1 配置和快照、A2 执行与环境、A3 样本接线、A4 PPTX 与安装包推进。最小样本需要真实导出、合入模板、校验、PowerPoint 编辑及失败/取消验证，才能认定 A 完成。

精确 Python/wheel 版本锁、工具链快照、平台 helper 和模板显示仍需实现阶段实验验证。本 ADR 不把候选制品称为已经兼容。

详见 [完整设计](../designs/skill-executor-and-dependencies.md)，包含数据关系、执行契约、信任限制、状态与恢复、PPT 适配、IPC 和测试计划。
