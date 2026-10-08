# ADR-0040: Skill 包运行需求与应用级运行组件

- 状态：Proposed；2026-10-05 用户确认应用运行时和 Skill 需求分层，并授权以 `ppt-expert-skill` 为例重构导入和配置。2026-10-06 已实现包内锁/运行元数据导入切片；完整样本执行与分发验收仍未完成。本 ADR 不代表 ADR-0010 已 Accepted。
- 日期：2026-10-06
- 相关：ADR-0009、ADR-0010、ADR-0011；[Skill 执行器与依赖管理设计](../designs/skill-executor-and-dependencies.md)、[Skill 包作者指南](../development/skill-package-authoring.md)

## 背景

办公效率产品的 Skill 由 BetterWork 内置或服务端分发。普通用户不应自行安装 Python、查包版本或编辑通用 JSON；Skill 包必须声明自己的依赖、工具链和执行契约，由应用解析并呈现对应配置。设置只负责管理应用级公共运行时。Skill 信任、依赖准备和工具链准备是不同状态。

旧版依赖锁集中在 `resources/dependency-locks/`，使一个 Skill 的锁看起来像全局配置。导入扫描又将任意大写 `*_DIR` 常量当作外部目录，因而把 `SKILL_DIR`、`DIAGRAMS_DIR`、`STYLES_DIR` 误报成用户配置。用户提供的 `/Users/kevin/Downloads/ppt-expert-skill` 明确使用 `PPTM_HOME` 引用 `ppt-master`；其 README 还写有作者机器默认路径，但该路径不能进入包或被自动读取。

## 决策

1. **BetterWork 管理公共 Python。** CPython 固定版本、制品来源、校验和落地状态归应用设置「运行」分区管理；该分区同时承载运行策略与内置 Skill／专家开关。Skill 只声明 Python 兼容要求；创建和验证 venv 时才需要已有受管解释器。锁 JSON 可独立存在、导入和分发。
2. **Skill 包是需求配置边界。** 格式 v2 的 `betterwork.skill.json` 随 Skill 目录/ZIP 分发，可通过 HTTPS ZIP 导入。它声明经 Schema 校验的 runtime profile、包版本、依赖 bundle 和工具链 requirements。导入不执行包内代码、不调用 pip/git、不读取元数据提及的本机目录；Schema 有效不代表代码已获信任或已经过兼容验证。
3. **锁和可选 wheelhouse 随 Skill 归属。** `dependencyBundle.lockPath` 与可选 `wheelhousePath` 是包内相对路径。锁记录目标平台、Python 兼容版本、完整传递包闭包、精确版本、wheel 名、来源 URL/SHA-256、许可证线索和 import probes。BetterWork 先复用 Skill 包 wheelhouse，缺 wheel 时可按锁里的 HTTPS URL 下载并校验 hash；缺少有效 wheel 和下载来源则准备失败。旧版应用级锁仅保留兼容读取，不作为新 Skill 包的作者维护入口。开发者用显式 `requirements.in`、目标 CPython pip report 和仓库生成脚本维护锁，不从静态扫描结果推导锁。
4. **静态扫描仅提供未映射线索。** Python/依赖文件、安装提示、Python 运行时说明和 shell/env 外部目录变量访问附相对路径与行号供作者/用户核对。外部工具链 ID、版本、环境变量和命令入口只认 manifest 的结构化声明；不从 Skill ID、目录名或文档自由文本推断。内部变量赋值不视为外部资源；扫描绝不自动生成执行命令、锁、快照绑定或授权。
5. **Skill 声明外部工具链，路径留在本机。** 每项需求可含 ID、名称、环境变量、版本提示和完整 expected commit。导入后详情按声明动态呈现工具链项；用户登记的源路径进入本机不可变快照元数据，不进入包。当前实现可登记本地目录并核对版本；远程固定工具链制品的获取、解包、校验与恢复还未实现，不能以元数据声明冒充自动下载。
6. **命令契约由 Skill 包声明，通用运行时解释。** 每条命令在 `betterwork.skill.json` 中声明入口（包内资源或已声明工具链快照）、参数 Schema、argv 模板、路径参数所属根、超时、输出来源/格式和验证状态。BetterWork 的通用运行时只解释受限的 argv token，不执行 Shell；仍负责受管 Python、快照校验、路径边界、子进程取消/超时、输出完整性与成果登记。不得按 Skill ID、资源 hash、命令 ID 注册产品专属 adapter 或 validator。profile 声明和有效授权仍不能替代 Skill 信任及实际兼容性验收。
7. **分发入口分离且身份/信任不混淆。** `skills/` 是本机忽略的 authoring workspace，不进入 Git 或安装包。产品内置包放 `resources/skills/` 并由 release manifest 固定；对客户发布的目录/ZIP 可托管于服务端。信任授权不导出，首次导入仍按用户 Skill 信任规则处理。`betterwork.skill.json` 中的 `skillId` 是包内来源标识，不是信任凭据。

## 影响与当前实现

- `SkillService` 支持目录、ZIP 和 HTTPS ZIP 导入；v2 manifest 导入会校验 profile 与其包内 lock，并恢复运行声明。包内 lock 路径与 wheelhouse 路径必须在 Skill 根目录内。
- `SkillDependencyService` 使用包内 lock 与 wheelhouse；环境键包含 CPython 制品身份、目标平台和完整 lock hash。CPython 落地与锁/轮子文件的保存不互相创建或删除。
- Skill 修订保留发布者 package ID；它与本机 Skill 数据库 ID 分开，不用于自动授权。相同包 ID 的自动更新/替换流程还未实现。
- 依赖锁生成脚本由 pip report 提取 HTTPS wheel URL 和 SHA-256，可选下载并校验 wheelhouse。许可证和 import probes 仍须作者审查；脚本不取代运行环境验证。
- `DependencyPanel` 按 package manifest 生成锁与工具链控件；工具链数量和入口只按结构化声明绑定，扫描到的外部目录变量仅作待确认线索。
- Main 的通用命令解释器读取 profile 中的入口、路径范围、argv token 和输出契约；输出报告不解析某个 Skill 的专有 stdout 格式。
- `ppt-generation-expert` 的命令入口、PPT Master 路径、参数、attempt 输出位置和校验器均由包声明/包内脚本承担，不再在 BetterWork 中登记样本 hash 或修补脚本源码。
- 样例元数据声明 `PPTM_HOME` 及 ppt-master 固定版本/commit，不带 `/Users/kevin/...` 路径。`SKILL_DIR`、`DIAGRAMS_DIR`、`STYLES_DIR` 不应提示用户配置。

## 验收边界与未完成事项

自动化验证覆盖安全导入、路径校验、ZIP/HTTPS ZIP、包内依赖锁加载与 wheel hash 处理、扫描线索位置，以及零/多项工具链配置。完整接收标准还包括：

- 以 BetterWork 管理的 CPython 3.12.14 验证该 Skill 真实依赖闭包、命令和产物，不把现有 8 项锁基线当作已验证结论。
- 完成通用声明式命令解释、受管路径与输出报告校验，并以合成 fixture 覆盖包内脚本、工具链脚本、取消/超时和产物登记。
- 运行预检按 `toolchainRequirements` 的声明顺序校验零项、一项或多项快照，并检查所有工具链入口；不从 `environmentRequirements` 或 Skill 名称推断工具链。
- 在 BetterWork Electron 中用新版包完成人工导入、信任/依赖授权、快照绑定与真实 Run；完成前不声称 A16/A17 样本验收通过。
- 决定 `ppt-master` 公共工具链的固定制品、发布来源、SHA-256/许可证、体积和自动下载/解包/恢复流程；当前用户仍需选择本机工具链目录。
- 通过完整 `verify`、安装包资源核对和真实 UI 导入旅程后，再更新 A2/A 阶段验收状态。自动化测试通过本身不代表真实样例或发布已通过。
