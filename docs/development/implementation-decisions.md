# 阶段 A 实施决策记录

- 日期：2026-09-08
- 对应任务：A00
- 基线：`3720b25`（开始核对时的 HEAD）
- 状态：A00 完成；A01 可开始

## 核对范围

本记录只固定阶段 A 的实施边界，不把 ADR-0010 的 Proposed 状态改为 Accepted，也不宣称阶段 A 的运行能力已经实现。核对依据为 [执行手册](README.md)、[共享实施契约](contracts.md)、A00–A06 任务卡、[ADR-0008](../adr/0008-personal-workbench-and-capability-first.md)、[ADR-0009](../adr/0009-script-skill-baseline.md)、[ADR-0010](../adr/0010-skill-executor-and-dependencies.md)、[ADR-0011](../adr/0011-skill-trust-and-local-distribution.md) 和[执行器设计](../designs/skill-executor-and-dependencies.md)。

## 设计决策

### D1：执行模式

- 决策：采用受信任本地代码模式；信任授权范围内的 Skill 脚本和子进程可以自动执行，但不承诺恶意代码沙箱或操作系统级文件/网络隔离。
- 授权依据：ADR-0010 §提议第 6 项为执行提案；ADR-0011 已接受相同的产品信任边界；用户授权按本执行手册逐项实施。
- 状态：产品规则 Accepted；执行实现待 A04/A15 验证。
- 负责切片：A02–A06 建立配置与信任状态，A15 完成撤销和取消收口。
- 验证证据：当前仅完成文档核对；不得把配置中的 trusted 或 UI 文案视为沙箱能力。

### D2：依赖分发

- 决策：默认采用受管 Python、目标平台固定制品和带完整 hash 的 wheels；本机 Python 仅作为显式高级选项，并始终创建 BetterWork 自有环境，不修改全局 site-packages。
- 授权依据：ADR-0010 §提议第 2 项及执行器设计 §4；用户授权按执行手册推进 Proposed 技术方案，但未授权将其提前宣称为已验证或将 ADR-0010 改为 Accepted。
- 状态：实施方向已获本轮授权；技术方案仍 Proposed，须由 A10/A11 的实际探测、锁文件和失败路径验证。
- 负责切片：A10/A11；A12 做配置与状态验收。
- 验证证据：本机有 Python 3.9.6 和 3.13.11；尚无目标平台制品、完整 wheel lock 或 ready 环境，因此当前不能声明环境可用。

### D3：进程生命周期

- 决策：macOS 使用 guardian/独立进程组；Windows 使用 suspended 启动并加入 Job Object 的 helper；取消、超时、父进程断开和 Run 终态都必须等待本次执行清理。
- 授权依据：ADR-0010 §提议第 5 项、执行器设计 §8；用户授权按执行手册推进该 Proposed 方向。
- 状态：实施方向已获本轮授权；技术方案仍 Proposed，跨平台验收未完成。
- 负责切片：A07 定义契约，A08/A09 实现平台 supervisor，A15 接入 Run 收口。
- 验证证据：当前主机为 macOS arm64，具备 clang；Windows 编译器、helper 和真实 Windows 验收不可用，A09 及依赖它的跨平台门槛在本机不能标记通过。

### D4：包结构

- 决策：保留目录型 Skill 原包，按内容 hash 登记不可变修订；开发资源、安装资源和用户数据分别使用 `resources/skills/`、安装包 `skills/` 和 userData `skills/`；宿主运行配置独立保存，目录导入/导出先行。
- 授权依据：ADR-0009 已接受的目录 Skill 兼容要求、ADR-0011 已接受的本地分发规则、共享契约 §3；用户授权按任务卡顺序实施。
- 状态：产品与交换边界 Accepted；具体字段和落盘实现由 A01–A04 完成。
- 负责切片：A01 定义协议，A02 持久化，A03 导入/导出，A04 内置核验和用户副本。
- 验证证据：当前仓库尚不存在 `resources/skills/`，因此不能声称已有内置 Skill 发现或安装资源。

### D5：工程扩展

- 决策：新增 Python/native helper 仍遵守全仓唯一工程规范和同一 `npm run verify` 门禁；新增跨语言规则先补充 `docs/12-engineering-standards.md`、可执行检查和测试，再实现 helper。不得另立格式、lint、tsconfig 或提交第三方/本机运行制品。
- 授权依据：AGENTS.md §7/§8、docs/12 §1、共享契约 §6；用户授权按执行手册推进，未授权绕过现有门禁。
- 状态：约束 Accepted；具体 helper 规则在 A08/A09 需要时补充。
- 负责切片：A08/A09 负责平台 helper，A20 负责安装资源和构建接线。
- 验证证据：当前可用 clang；未发现 Windows toolchain，Windows helper 的构建和真实验收待具备平台后完成。

### D6：PPT 产物

- 决策：以 `presentation` 文件型成果承载 PPTX；结构、视觉、人工编辑三项验证独立记录，结构失败不得作为成功交付，结构通过但视觉未检查只能作为待检查草稿。A17 先验证执行输出，A18 才登记文件型 Artifact。
- 授权依据：ADR-0009 已接受的真实 PPT 兼容基线、ADR-0010 §提议第 8 项、共享契约 §5；用户授权按 A13–A19 任务卡顺序实施。
- 状态：产品范围 Accepted；文件成果和验证协议待 A16–A19 实现与真实样本验收。
- 负责切片：A16/A17 样本适配与试运行，A18/A19 文件成果、打开和导出。
- 验证证据：本轮未执行用户 Skill、未安装依赖、未生成 PPTX；公司模板和原始 Skill 不进入仓库。

## 阻塞与开工结论

- A01：可以开始。A00 已固定共享协议的身份、状态、授权和目录边界；A01 只实现协议与 Schema，不注册未实现 handler。
- A09：当前主机没有 Windows 验收条件。到达 A09 时若仍无 Windows 环境，只能记录为 `blocked`，不能用 macOS 替代跨平台验收，也不能继续宣称 A2 或阶段 A 已跨平台完成。
- A10/A11：不能把本机 Python 或候选依赖组合直接写成 `ready`；必须保留实际探测、完整锁和失败证据。
- 其他 Proposed 技术：本记录只确认“按任务手册实施”的授权，不改变 ADR-0010 的状态；实现过程中若需改变安全边界、依赖分发方式或进程模型，先更新 ADR/设计并停止受影响切片。
