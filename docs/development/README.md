# 阶段 A 开发执行手册（供 5.6 Luna 使用）

- 日期：2026-09-08
- 状态：任务规划完成，所有实现任务尚未开始。本手册不自动把 Proposed ADR 改为 Accepted。
- 适用：用户逐项交给 5.6 Luna 执行；任务卡给出明确输入/输出和验收，不依赖模型猜测历史对话，不对模型能力作额外假设。
- 代码基线：编写时 HEAD `3720b25`，开始每项任务必须重新核对 HEAD 与工作区，不用本文旧基线覆盖新代码。

## 1. 用户怎么推进

1. 先执行 **A00** 核对设计决策与实际基线，不写代码。用户已有明确授权直接承接，不要求重复确认已接受的产品规则。
2. 然后按 A01 → A21 顺序逐项执行。一次只派发一个任务，不把整份文档作为“一次全部实现”的要求。
3. 每项完成后检查任务卡的验收证据，未通过不得更新为 done。A06/A12/A17/A21 为四次里程碑验收。
4. 阶段 A 全部完成后再进入专家配置 B；完整研究到汇报 C 在 B 之后。后续分解见 [B/C 规划](phase-b-c-roadmap.md)，它们尚不是可以立即写代码的任务卡。

可直接粘贴的任务提示词：

```text
请使用当前模型执行 BetterWork 开发任务 A01（将编号替换为本次任务）。
先读 AGENTS.md、docs/development/README.md、contracts.md 和任务卡指定必读文档。
只完成该编号及其必要测试/文档，不实现下一编号，不创建子任务或委派其他智能体。
检查前置任务状态及已有授权；不得把 Proposed ADR 自行标记为 Accepted。
遵守现有工程规范，保留已有改动；不要提交、推送、发布或复制公司资料进仓库。
若遇任务卡列明的停止条件，说明具体冲突和可选处理；其余常规实现选择自主完成。
完成后按本手册交接模板报告行为、文件、测试结果、遗留限制，并更新任务状态和当日日志。
```

A00 使用同样提示词，只把编号换成 A00。后续追加“按已审阅方案执行 A01”可以授权该范围实施，不应再重复确认已讨论清楚的普通编码步骤。

## 2. 文档路由

| 文档 | 用途 |
| --- | --- |
| [共享实施契约](contracts.md) | 术语、ID、状态、目录、接口、跨任务约定；设计选择需由 A00 固定 |
| [A00–A06：管理配置](tasks-a1.md) | 基线、协议、存储、目录、信任、IPC、UI |
| [A07–A12：执行依赖](tasks-a2.md) | 执行契约、macOS/Windows supervisor、环境准备、快照、管理 UI |
| [A13–A17：样本接线](tasks-a3.md) | 模型指令、文件工具、Run 收口、PPT 样本适配、真实试运行 |
| [A18–A21：成果分发](tasks-a4.md) | 文件成果、成果 UI、安装资源、跨平台验收 |
| [后续 B/C](phase-b-c-roadmap.md) | 专家配置与研究汇报路径，阶段 A 完成后按模板细化 |
| [依赖验证记录](dependency-verification.md) | 基础 Python 候选、逐字抄录的上游校验值、本机探测结果与待验证清单 |

产品真相源仍是 [产品定义](../01-product-definition.md)、[能力体系](../05-capability-system.md)、[路线图](../07-mvp-and-roadmap.md)、[UI 规范](../10-ui-ux-system.md)、[工程规范](../12-engineering-standards.md)；本文不创建第二套编码规范。

必须区分：ADR-0008/0009/0011 的产品规则已接受；[ADR-0010](../adr/0010-skill-executor-and-dependencies.md) 的执行技术仍 Proposed；[执行器设计](../designs/skill-executor-and-dependencies.md) 给出推荐实现。后者若调整，在 A00/对应决策记录中说明，不能静默偏离。

## 3. 任务板

状态只使用 todo / doing / blocked / done。实现者只更新本次任务行，记录实际完成时间和证据链接；当前全部 todo，不表示当前所有任务都满足开工条件。

| 编号 | 工作 | 前置 | 状态 | 证据/完成时间 |
| --- | --- | --- | --- | --- |
| A00 | 基线与设计决策固定 | 无 | done | [implementation-decisions.md](implementation-decisions.md)，2026-09-08 |
| A01 | Skill 共享协议及输入输出 Schema | A00 | done | [协议测试](../../packages/agent-protocol/src/index.test.ts)，2026-09-08 |
| A02 | Skill 修订/profile/信任持久化 | A01 | done | [迁移测试](../../apps/desktop/src/main/db/migrate.test.ts)、[仓储测试](../../apps/desktop/src/main/persistence/app-store.test.ts)，2026-09-08 |
| A03 | 本地目录导入与资源定位 | A02 | done | [SkillService 测试](../../apps/desktop/src/main/services/skill-service.test.ts)，2026-09-08 |
| A04 | 内置来源、信任与用户副本 | A03 | done | [SkillService 测试](../../apps/desktop/src/main/services/skill-service.test.ts)，2026-09-08 |
| A05 | 管理 IPC/Preload 接线 | A04 | done | [IPC 测试](../../apps/desktop/src/main/ipc/register-ipc.test.ts)，2026-09-08 21:56 |
| A06 | Skill 管理界面及 A1 验收 | A05 | done | [界面测试](../../apps/desktop/src/renderer/src/views/SkillsView.test.tsx)、[Skill 服务测试](../../apps/desktop/src/main/services/skill-service.test.ts)、[协议测试](../../packages/agent-protocol/src/index.test.ts)；A1 手工验收 2026-09-08 23:54 于 macOS 通过（导入/信任/删除/两次重启/三档主题/窄屏/键盘，SQLite 与日志逐字段核对，见 [日志](../logs/2026-09-08.md)） |
| A07 | 执行协议、执行记录及生命周期接口 | A06 | done | [执行服务测试](../../apps/desktop/src/main/services/skill-execution-service.test.ts)、[迁移测试](../../apps/desktop/src/main/db/migrate.test.ts)、[协议测试](../../packages/agent-protocol/src/index.test.ts)，2026-09-09 00:26 |
| A08 | macOS 进程组 supervisor | A07 | done | [supervisor 测试](../../apps/desktop/src/main/infrastructure/mac-process-supervisor.test.ts)（17 项真机进程用例）、[guardian](../../apps/desktop/src/main/infrastructure/skill-guardian.ts) 构建产物在 Electron `ELECTRON_RUN_AS_NODE` 下实测取消/组核验，2026-09-09 01:33 |
| A09 | Windows Job supervisor | A08 | blocked | 本机无 Windows 构建与运行环境。2026-09-09 用户明确授权跳过本卡先行推进 A10–A12；A2/A21 的跨平台门槛保留，不得据此把 Windows 标为已验收 |
| A10 | Python 环境准备作业 | A09 | done | [依赖服务测试](../../apps/desktop/src/main/services/skill-dependency-service.test.ts)（20 项离线注入 + 真实 venv/import 探测验收）、[迁移测试](../../apps/desktop/src/main/db/migrate.test.ts)、[依赖验证记录](dependency-verification.md)，2026-09-09 02:04；按用户授权在 A09 blocked 时先行 |
| A11 | 外部工具链快照与依赖锁 | A10 | done | [快照服务测试](../../apps/desktop/src/main/services/toolchain-snapshot-service.test.ts)、[迁移测试](../../apps/desktop/src/main/db/migrate.test.ts)、[样本包锁](../../resources/dependency-locks/ppt-generation-expert-darwin-arm64-cp312.json)；真实快照 12,981 文件 + 真实环境准备 + CLI 探测于 macOS arm64 通过，见[依赖验证记录](dependency-verification.md) §4/§5，2026-09-09 02:33 |
| A12 | 运行配置/环境 UI 与 A2 验收 | A11 | doing | 代码与自动测试完成：[IPC 测试](../../apps/desktop/src/main/ipc/register-ipc.test.ts)、[面板测试](../../apps/desktop/src/renderer/src/components/skills/DependencyPanel.test.tsx)、`npm run verify` 退出 0（32 文件 / 263 测试），真实启动核对 v6 迁移与无错误日志，2026-09-09 03:13。**A2 里程碑的本机手工旅程待人执行**，通过后才可标 done；Windows 未验收，A2 不标跨平台完成 |
| A13 | Skill 指令及运行绑定进入 Agent | A12 | done | [agent-engine 测试](../../packages/agent-core/src/agent-engine.test.ts)、[协议测试](../../packages/agent-protocol/src/index.test.ts)、[RunService 测试](../../apps/desktop/src/main/services/run-service.test.ts)、[SkillService 测试](../../apps/desktop/src/main/services/skill-service.test.ts)；`npm run verify` 退出 0（276 测试），2026-09-09 20:39 |
| A14 | 资源读取/任务写文件/执行工具 | A13 | done | [skill-read-resource 测试](../../packages/tool-runtime/src/skill-read-resource.test.ts)、[task-write-file 测试](../../packages/tool-runtime/src/task-write-file.test.ts)、[skill-execute 测试](../../packages/tool-runtime/src/skill-execute.test.ts)；`npm run verify` 退出 0，2026-09-09 22:12 |
| A15 | 取消、撤销、终态与恢复收口 | A14 | done | [RunService 测试](../../apps/desktop/src/main/services/run-service.test.ts)（取消/撤销/终态/恢复场景）；`npm run verify` 退出 0，2026-09-09 22:31 |
| A16 | PPT Skill 适配预设与报告契约 | A15 | done | [skill-adapter 测试](../../apps/desktop/src/main/services/skill-adapter.test.ts)、[ppt-generation-preset 测试](../../apps/desktop/src/main/services/ppt-generation-preset.test.ts)；`npm run verify` 退出 0，2026-09-09 22:53 |
| A17 | 真实 Skill 试运行与 A3 验收 | A16 | done | [IPC 测试](../../apps/desktop/src/main/ipc/register-ipc.test.ts)、[协议测试](../../packages/agent-protocol/src/index.test.ts)；`npm run verify` 退出 0（327 测试），2026-09-09 23:09 |
| A18 | PPTX 文件成果与验证状态 | A17 | done | [file-artifact-service 测试](../../apps/desktop/src/main/services/file-artifact-service.test.ts)、[迁移测试](../../apps/desktop/src/main/db/migrate.test.ts)、[IPC 测试](../../apps/desktop/src/main/ipc/register-ipc.test.ts)；`npm run verify` 退出 0（34 文件 / 342 测试），2026-09-09 00:56 |
| A19 | 文件成果 UI、打开与导出 | A18 | done | [ArtifactView 测试](../../apps/desktop/src/renderer/src/views/ArtifactView.test.tsx)、[use-artifact-viewer 测试](../../apps/desktop/src/renderer/src/hooks/use-artifact-viewer.test.tsx)、[IPC 测试](../../apps/desktop/src/main/ipc/register-ipc.test.ts)；`npm run verify` 退出 0（34 文件 / 342 测试），2026-09-09 00:56。**待手工验收**：打开/导出/版本切换/Markdown 回归 |
| A20 | 内置目录与依赖制品打包 | A19 | done | [electron-builder 配置](../../apps/desktop/electron-builder.yml)、[启动注册](../../apps/desktop/src/main/index.ts)、[SkillService 测试](../../apps/desktop/src/main/services/skill-service.test.ts)（6 项新增：开发/安装寻址、缺资源拒绝、用户副本独立、同名并存、无敏感材料）；`npm run verify` 退出 0（39 文件 / 348 测试），2026-09-10 01:06 |
| A21 | 安装包验收与阶段 A 收尾 | A20 | todo | — |

串行是有意选择：共享协议、迁移、App.tsx、RunService 等容易冲突。没有用户要求不并行派发。A09 的真实 Windows 验收若缺设备，标 blocked；用户可明确允许后续非 Windows 任务先行，但 A2/A21 跨平台门槛不因此取消。

## 4. 每项任务的执行规则

### 开始

- 读根 AGENTS.md 和任务必读文档，执行 `git status --short`、`git rev-parse --short HEAD`。
- 查看任务板与前置证据。已存在功能先核对，不重复创建；未完成前置不靠临时 mock 冒充可用。
- 列出本次文件边界。任务卡的“新增文件”只是预期落点，先用 rg 确认没有等价实现。
- 若是缺陷排查，遵守 GATE-0（SQLite → `/tmp/betterwork-dev.log` → 代码），不得因本手册跳过。

### 实现与验证

- 每项最多完成卡中一个主题；发现额外缺口登记，不顺手重构或实现下一卡。
- 先定义失败/取消语义，再编写业务逻辑。协议通过 Zod，新增行为有测试，迁移有真实 SQLite 测试。
- 生产代码不加 any/非空断言/忽略注释；不创建第二套 lint/format/tsconfig，不复制 ClawBible 的旧代码。
- 定向测试使用 `npm test -- <仓库相对测试路径>`；typecheck、相关测试通过后，交接前运行一次 `npm run verify`，不接管道截尾。只改文档的任务用链接/差异检查，不需要运行构建。
- UI 手工验收只通过 `bash scripts/dev-start.sh` 与 `bash scripts/dev-stop.sh`；记录实际步骤及结果。运行日志仍在规定位置。
- 工具/网络测试用可注入实现与合成材料，不访问外部模型。真实 Skill 手工验收与自动测试分开记录。
- 不把用户 Skill、公司模板、外部仓库、本机解释器、venv、wheel、PPT 产物或数据库提交到仓库。

### 交接模板

```text
任务编号与状态：
实现行为（含失败/取消）：
修改文件：
验收证据：命令、退出码、实际结果；手工步骤与平台：
文档/日志位置：
已知限制和未完成项：
下一项任务及前置是否满足：
未提交/未发布；是否保留了本轮外的已有改动：
```

更新 `docs/logs/YYYY-MM-DD.md`，时间只用 date。不要写“全部通过”替代实际证据。功能未完成但测试通过不能标 done。

## 5. 哪些情况停止，哪些不用再问

继续自主处理：既有风格内命名、布局细节、测试组织、错误信息、实现中普通 bug、任务卡允许的局部拆分。

停止依赖该问题的工作并说明：拟突破已确认产品边界；要改变 Proposed 关键选型但无实施授权；已有用户改动与本次相冲突；缺用户资料/平台无法完成必需验收；需要把私有内容发布；发现安全模式与文档承诺不同。不要因看见已有改动就全面停止，无冲突的文件可继续。

不要自行降级为“只有提示词”“仅杀父进程”“假装校验通过”“用其他 PPT 工具替代样本”。不扩大为任意 Shell、MCP 市场、完整专家系统或研究工作流。

## 6. 总验收

从全新安装环境出发，内置资源可发现；用户目录 Skill 可导入并信任；环境可准备；样本可写 SVG/配置并运行原生 PPT 链路；取消/撤销真正收口；结果可校验、登记、打开、导出和回看版本；更新保留用户副本与撤销选择。A1–A4 任意一环未达成，阶段 A 就没有完成。
