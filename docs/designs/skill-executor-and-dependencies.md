# Skill 执行器与依赖管理设计

- 日期：2026-09-08
- 状态：执行技术仍为提案，配套 ADR-0010 为 Proposed；其中信任与本地目录/分发规则已由用户确认，见 [ADR-0011](../adr/0011-skill-trust-and-local-distribution.md)。用户未因此确认所有解释器、平台 helper 或协议字段。
- 必需范围：遵循 [ADR-0009](../adr/0009-script-skill-baseline.md)，阶段 A 实际支持 `ppt-generation-expert`。
- 本轮不安装依赖、不执行用户脚本、不修改原始 Skill、外部工具链或产品数据库。

## 1. 方案摘要

采用「目录 Skill + 宿主运行配置 + 独立 Python 环境 + 受管理子进程 + 文件型成果」方案。

1. 保留原始 Skill 目录和 frontmatter，导入为不可变修订；运行适配独立保存。
2. 默认使用算台管理的 Python 和依赖环境，提供本机解释器高级选项；不修改系统 Python。
3. Python 与 CLI 在 Electron Main 之外的子进程执行，由宿主执行服务管理；不嵌入 Python，不创建通用 DAG，不为 PPT 单独创建 Agent Engine。
4. 外部 ppt-master 登记为版本化本地工具链，支持用户提供的带本地修改快照，不在运行时自动 git pull。
5. 通过明确的参数、目录和工具配置启动进程；取消覆盖该次执行的进程组/Job，Run 终态发布前等待清理。
6. 首版执行模式为「受信任本地代码」，不是恶意代码沙箱。文件代理有强制路径校验，原生脚本拥有当前用户的系统权限；这项限制在启用说明中明确，详见 §7。
7. PPT 质量报告和本次输出文件一起校验，再登记不可变成果版本；不以日志中的 Done 或退出码 0 独立判成功。

## 2. 现有代码约束与需要修改的接点

| 当前证据 | 设计变化 |
| --- | --- |
| `packages/agent-core/src/types.ts` 已有 AgentTool、signal、reportProgress | 工具通过工厂注入执行服务；ToolExecutionContext 增加 toolCallId，关联执行记录 |
| `agent-engine.ts` 只有内置系统提示、默认 8 轮工具循环 | 增加受信任运行指令输入，拼装专家/Skill 指令；宿主配置轮次，样本试运行初值 40，达到上限明确失败，不无限循环 |
| 引擎 Abort 后可不等 Tool Promise 就产生 run.cancelled | RunService 持有 Run 范围的进程注册表，发布终态前执行 finishRun，见 §8 |
| `read_text_file` 只读取工作区内 UTF-8 | 保留它；新增带资源句柄的 Skill 资源读取与任务文件写入工具，不扩大原工具的默认边界 |
| Artifact 仅 markdown，内容存在 SQLite | 新增 presentation 文件型变体、资源登记及质量状态，保留已有 Markdown 接口 |
| SQLite schema 是版本化迁移 | 配置/执行表和 Artifact 字段通过新迁移建设，不修改已发布 migration |

### 模块落点

- `apps/desktop/src/main/services/skill-service.ts`：导入、修订、启停、导出与绑定。
- `.../services/skill-dependency-service.ts`：检测、安装作业、环境健康状态、锁与修复。
- `.../services/skill-execution-service.ts`：运行快照、执行校验、结果适配、Run 级清理。
- `.../infrastructure/process-supervisor.ts`：进程创建、输出读取、OS 进程组/Job、超时与父进程断开处理；不持有业务 Repository。
- `.../services/file-artifact-service.ts`：文件成果校验、落盘、版本登记及导出。
- `packages/tool-runtime`：小型工具工厂，依赖注入 read/write/execute 函数；不得反向依赖上述 Electron 应用模块。
- `resources/skill-adapters`：宿主维护的样本路径/结果适配资源；运行环境制品通过构建清单引入，不提交解释器、wheel 或公司模板。

执行服务以普通 CLI 为外部协议；受管 supervisor 的控制消息采用版本化 JSON，与脚本 stdout 分开。现阶段不引入常驻 Python RPC 服务，未来 Office Worker 可复用进程管理边界。

## 3. Skill 导入与运行配置

### 3.1 导入不执行代码

目录选择由 Main 完成；检查 SKILL.md、YAML 数据结构、文件数量/总大小、相对资源路径和普通文件类型。拒绝逃出根目录的路径及符号链接，拒绝特殊设备文件；导入器只解析文本与复制文件，禁止 Python import、pip、Shell 和安装钩子。

保留未知 frontmatter 字段用于导出，已知字段映射为宿主元数据。`version: v20260907` 作为原版本字符串保留，不强制改为 semver；以内容 hash 区分真实修订。来源 name 不是数据库主键，不同来源同名时仍有独立 ID。

用户导入原包逐文件计算 hash，临时复制校验完成后落到用户 skills 的不可变修订目录；SQLite 事务登记修订。文件成功、事务失败留下未登记目录，由回收流程清除；不向 UI 返回半安装成功。

用户编辑通过新修订保存；内置修改采用用户副本。运行中锁定旧修订，后续 Run 才使用新修订。只信任指定代码/依赖修订的执行授权，发生代码或权限范围变化时重新说明变化。

### 3.2 两层配置

| 层 | 内容 | 真相源 |
| --- | --- | --- |
| 原始 Skill | SKILL.md、scripts、references、templates、assets、原始元数据 | 不可变导入文件及其 hash |
| 宿主配置 | 解释器需求、依赖绑定、执行入口、参数 Schema、资源作用域、结果适配器、超时、授权记录 | SQLite 中版本化配置；可导出描述，不导出本机路径/密钥 |

不是要求每个作者制作专有 manifest。首个样本使用产品提供的适配预设，根据原包文件特征建议配置，用户能检查/调整。对未识别 Skill 自动发现脚本与依赖提示，但绝不从自然语言直接推断「已验证可运行」。

运行时先给模型 Skill 简介，按需读取完整指令和资源。宿主附加环境说明：当前 Skill 根、任务输出目录、依赖根以及可用命令。已识别的 WorkBuddy 绝对路径在渲染给模型的副本中显式映射，并记录 adapterRevision；不做系统级软链接、不改原包、不对未知任意字符串进行静默全局替换。

## 4. 依赖管理

### 4.1 默认路径与高级路径

**默认：算台管理的 Python 环境。** 按目标 OS/架构分发固定版本的 Python 运行时和锁定 wheels；首次准备在用户数据目录创建专属 venv。基础 Python 建议使用 python-build-standalone 的固定发行制品，发布时记录下载来源、SHA-256、许可证与目标平台，不能跟随 latest。该项目提供可再分发 Python 构建，具体选中的版本仍需执行样本验证。[上游说明](https://github.com/astral-sh/python-build-standalone)

**高级：选用本机 Python 作为基础解释器。** 探测路径、版本、架构与 venv 能力后仍创建算台专属环境，不向该解释器的全局 site-packages 安装；不直接复用用户 Conda 中随时会变化的包集合。检测在用户选择/准备环境后进行，不能在纯 Skill 导入时执行。

环境隔离解决包冲突，不提供文件或网络沙箱。venv 在最终路径创建，不从临时目录重命名，也不随安装包复制整套 venv，因为其脚本可能绑定绝对路径；搬家后重建。[Python venv 文档](https://docs.python.org/3/library/venv.html)

### 4.2 锁定与准备

环境键由基础解释器制品 hash、OS/架构/ABI、完整包锁 hash 组成。不同 Skill 只有在环境键完全一致时共享环境；工具链快照独立绑定到 Run，不通过工作目录共享可变状态。

产品内置样本生成完整传递依赖锁（精确版本 + 每个目标 wheel 的 hash），默认只从随包 wheelhouse 离线安装。使用 `python -m pip install --no-index --find-links <wheelhouse> --only-binary=:all: --require-hashes -r <lock>`；不用宽松 `>=` 作为最终安装依据。pip hash 模式要求完整依赖覆盖，只有 wheel 时缺包明确失败，不在用户机静默编译源码。[pip 安装约束](https://pip.pypa.io/en/stable/topics/secure-installs/)

用户导入 Skill 的 requirements 只作为待解析输入。环境准备界面列出依赖计划与来源；可以选择已准备的依赖包或显式启动联网准备。解析/下载作业独立于模型 Run，不由模型临时 pip install。自定义索引凭据不写入 Skill/导出包或日志。首次准备需联网时说明下载内容，之后同一 lock 的任务执行不重复下载。

不能直接安装 ppt-master 全量 requirements：其中包含语音、图片生成、Web 编辑器等与样本无关能力。首个 profile 从 python-pptx、lxml、PyYAML、Pillow、XlsxWriter 和导出所需模块闭包开始；skia-pathops、uharfbuzz 等按所选管线路径纳入并测试。最终版本锁在实现首个验证切片时产生，本稿不虚构已通过的包版本组合。缺少能力时不得悄悄降低原生可编辑标准。

### 4.3 外部工具链

- 导入本地 ppt-master 目录或选取产品提供的固定工具链包，复制为受管不可变快照；`PPTM_HOME` 指向快照，不指向可被 git pull 修改的开发仓库。
- 本机当前 HEAD 为 `82dd5cccec652cbcff342cbdabce85a1ae7af1e5`，另有 decks_index 修改和未跟踪公司 deck。因此快照记录 originCommit 与完整所选文件 hash，不能仅记录 commit；用户本地公司资产不进入公共制品。
- 默认包含完整所需脚本与静态模板/图标资产，排除 `.git`、缓存、历史 projects 和无关用户文件；所有被排除内容在导入摘要列明。工具链的完整性检查保持有效，不能为精简体积绕过它。
- 输入材料中引用的旧项目 spec_lock 由用户选择后复制到本次任务；不能通过扫描开发仓库 projects 自动获取其他项目资料。
- 普通运行不更新依赖、不修改 snapshot；增加公司模板或升级工具链创建新快照。

### 4.4 准备作业与恢复

状态：`unprepared → preparing → ready`，准备过程可进入 `failed / cancelled`；已准备环境健康检查失败变 `invalid`。每次作业有 operationId、进度、错误和持久化记录。

对环境键加独占构建锁。同一环境只准备一次；其他请求观察已有作业。环境直接在唯一最终目录创建，准备完成前没有 ready 标记、不能被任务使用。失败清理该作业专属目录，旧 ready 环境不受影响；崩溃后把 preparing 作业标为 interrupted，再重建，不把部分包集当作可用。

升级先建新环境并通过 probe/import/最小样例，成功才切换绑定。旧环境有活跃执行或版本引用时不清理；移除 Skill 不删除用户源目录。环境可从 lock 重建，实际成果和原始 Skill 资产必须备份。

## 5. 存储与运行快照

目录职责已确认，具体存储键仍属实现设计（均未创建，不表示已存在）：

```text
repo/resources/skills/<name>/                # 内置 Skill 的源码目录
appResources/skills/<name>/                  # 安装包内只读使用的完整资源
userData/
  skills/<skillId>/revisions/<contentHash>/   # 导入、自建与内置用户副本
  dependency-assets/<snapshotHash>/           # 工具链快照
  python/<distributionHash>/                 # 基础 Python
  environments/<environmentKey>/<instance>/  # 在此创建 venv，ready 前不可消费
  execution-logs/<executionId>/               # 有界日志，用户按需查看
  artifact-files/<versionId>/                 # 不可变文件成果与来源清单
workspace/
  .betterwork/tasks/<taskId>/runs/<runId>/
    inputs/                                  # 本次选定输入副本
    work/                                    # SVG、spec_lock、项目文件
    attempts/<executionId>/                   # 本次报告及候选输出
```

物理文件夹嵌套只是定位，归属以 SQLite 外键为准，不能用拼接路径替代 Task/Run 关系。禁止覆盖工作区已有同名内容；遇目录冲突生成新运行目录或报错。源码目录/生产输入不直接作为脚本输出目录。

建议新增表：`skills`、`skill_revisions`、`skill_runtime_profiles`、`dependency_snapshots`、`runtime_environments`、`dependency_operations`、`run_skill_bindings`、`script_executions`、`artifact_files`。具体列在实现 Schema 时定义，但至少固定下列关系：

- run_skill_bindings：Run → Skill 修订、配置修订、环境、工具链快照、授权修订。
- script_executions：executionId、Run、toolCallId、binding、命令 ID、参数摘要、输入 hash 清单、执行目录、状态、终止原因、报告/输出 hash。
- artifact_files：ArtifactVersion → 相对存储键、MIME、大小、hash、生成 executionId。

SQLite 记录有效配置、关联和状态；文件承载不可重建资产，不能将成果文件称为可随意清理的缓存。落盘和 DB 无跨介质事务：先写临时文件并同文件系统 rename 到最终资源位，再提交关联；无 DB 关联的遗留文件延迟回收。引用存在但文件缺失时显示「文件缺失」，不伪造可用成果。

### 5.1 本地目录发现与版本升级（产品规则已确认）

开发模式从仓库 resources/skills 发现内置项；生产模式由 Main 从安装资源根解析 skills。具体打包路径由 electron-builder 配置和资源定位器统一，Renderer 不构造绝对路径。安装目录业务上只读；产品清单记录稳定 ID、内容 hash 和依赖 profile，执行前匹配。发现内容改变时失去内置信任并提示修复，不按文件夹名字兜底放行。

用户导入/创建/复制存放在 userData/skills 下，数据库维护来源与修订索引。直接在磁盘修改受管修订不会静默热加载，而是失配报错或显式导入为新修订。知识工作目录不是 Skill 自动发现目录，不能把任意材料中的 SKILL.md 自动当作可执行能力。

同名内置与用户项可并存，以稳定 ID 与来源区分。应用升级新增内置修订，保留用户副本、当前明确绑定、历史授权与撤销选择；旧内置版本被历史成果/运行引用时保留可恢复快照。产品回滚不自动恢复被撤销的信任。按所有有效引用与保留策略回收，不删除用户源目录。

默认导出配置与资源，不导出信任授权、API Key 或本机绝对路径；本地私有模板可由用户选择随特定包导出，但不自动混入公开分发。共享 Python/依赖/工具链资源由依赖服务管理，避免每个 Skill 重复打包。


## 6. 模型工具与宿主执行契约

### 6.1 模型侧工具

| 工具 | 输入 | 行为 |
| --- | --- | --- |
| skill_read_resource | bindingId、resourceRootId、相对路径、读取范围 | 读取指令、参考/图表骨架；二进制返回元信息或由指定解析工具处理 |
| task_write_file | task 内相对路径、文本、可选 expectedHash | 写入本次工作目录，拒绝覆盖输入/旧版本；hash 不匹配不覆盖并提示重读 |
| skill_execute | bindingId、commandId、结构化参数 | 宿主把 command 映射为 executable + argv，无 shell 拼串 |
| artifact_register_file | executionId、outputId、title、可选 artifactId | 登记宿主已验证的本次输出，不接受任意机器路径 |

模型不能设置 runId/workspacePath/解释器路径/原始 env/超时上限或把 executable 换为任意程序。ID 归属从当前 Run 注入。CLI command 可配置，不把全部执行器写成三个 PPT 专用入口；当前 profile 必须包含初始化、图标同步、质检、导出、合并、校验。

首版命令调用不提供自由 Shell 文本。Python 脚本本身及其子进程仍能完成样本需要的代码执行；这不是只允许调用原有内置工具。未注册脚本入口先在 Skill 配置新增并验证，新 profile 下一次运行生效。需要模型生成的额外 Python 脚本时作为扩展执行 profile 单独设计，本样本的 SVG/JSON 文本生成不需要此能力。

### 6.2 宿主内部 JobSpec / JobResult

JobSpec 必需字段：protocolVersion=1、executionId、runId、toolCallId、bindingId、commandId、绝对 executable、argv 数组、cwd、筛选后的 env、timeoutMs、输出捕获限额、expectedOutputs、validatorId。Main 校验构造，不由 Renderer 或模型直接提交。

JobResult 使用判别联合：

- succeeded：退出信息、输出句柄/hash、结构校验报告、duration。
- failed：阶段（spawn/execute/validate/publish/cleanup）、错误码、可展示摘要、有界日志引用、是否可重试。
- cancelled/timed-out：清理是否完成、已生成但未发布的诊断文件引用。

stdout/stderr 是不可信文本，不作为控制通道。结构化报告使用宿主约定位置读取并做 Zod 校验；文件存在不代表报告完整。控制通道只由宿主 supervisor 持有。

建议初值：单命令最长 5 分钟、样本 profile 最多 30 分钟、输出给模型最多 32 KiB、单执行日志最多 10 MiB，超过日志上限继续排空但截断并标注。按 profile 与实测调整，不因无 stdout 判定失败；每秒最多一次阶段状态更新，不伪造百分比。输入/输出大小另设限额并显示错误，避免超限截断产生有效性误判。

## 7. 文件、环境与信任边界

### 7.1 信任语义与状态（产品规则已确认）

首版提供「受信任」选项，允许已授权范围内的脚本和子进程默认执行。适用于用户信任的本地代码及产品随包审查的代码，不是恶意代码沙箱。正常步骤不逐命令重复询问；仅导入和查看不执行代码。

三个维度独立：enabled；trust（未信任/有效/需重新确认/已撤销）；environment（未准备/准备中/就绪/失败）。可执行条件为 enabled 且 trust 有效且环境就绪且本次请求符合授权。纯指令读取不因脚本未信任而被阻止，但涉及执行的试运行必须先取得信任。

拟增 skill_trust_grants：skillId、Skill 内容 hash、profile hash、依赖快照/lock hash、授权 scope hash、来源 builtin-release/user、授予时间及撤销时间。run_skill_bindings 记录所用 grantId，执行启动时实时检查是否撤销，不能只看 Run 开始时快照。

| 场景 | 信任与执行行为 |
| --- | --- |
| 产品随包内置 | 宿主核对产品发布清单和实际内容，匹配后默认信任；包自报来源不可信 |
| 用户导入/复制内置 | 默认未信任，用户可在导入完成或详情勾选；复制不会自动复制授权 |
| 同一内容重新启动应用 | 有效授权继续使用，不重复确认 |
| 用户更新内容、脚本、依赖或范围 | 新修订显示差异，授权不自动继承；仅改展示名不改变有效内容 hash 时可保留 |
| 产品发布已审查的新内置版本 | 新版本按发布清单获得默认策略；旧的用户停用/撤销选择优先，不因升级重新启用或恢复信任 |
| 用户撤销信任 | 即时阻止排队/新启动，取消该 Skill 的活跃执行；清理成功后再显示完全停止，已有成果不删 |
| 用户停用 | 禁止后续调用，停止正在执行的该 Skill 脚本；保留 trust 记录，重新启用时仍检查修订和依赖 |

撤销/停用与启动使用同一服务内串行裁决；已启动的进程进入取消收口。与该 Skill 关联的当前 Run 取消，不能把授权撤销当作普通工具失败让模型换入口继续执行；其他不相关 Run 不受影响。更新不打断仍获授权的旧修订，撤销旧授权才触发停止。

已有授权内的正常执行自动批准。新依赖安装由环境准备作业单独授权；扩大文件范围、覆盖源文件、外部发送仍按实际操作授权处理。受信任脚本自行发起系统调用在本模式下无法被宿主权限代理全面拦截，这条必须与 UI 描述一致。

### 7.2 实际执行限制


宿主文件工具强制真实路径校验：资源只读、任务 work/attempts 可写、原始输入复制、已登记成果不可覆写。写新文件检查最近存在父目录并拒绝符号链接跳转，目标存在时再次核对类型；发布时只接受普通文件，不接受符号/硬链接等借道引用。

原生脚本并不能被这些代理路径校验限制，仍可调用操作系统读取其他文件或联网。清理 env、设 cwd、复制输入、启动/结束时检查资源 hash 有助防误操作，但都不是安全隔离，hash 变化只能检测、不能阻止。恶意代码硬隔离若成为需求，要另立 OS 沙箱/容器方案，不能静默把本模式包装成安全沙箱。

默认不传模型/搜索密钥；移除 PYTHONPATH、PYTHONHOME、用户 site 注入及非必要宿主变量；使用受管解释器和必要 OS 变量，设置 UTF-8、无缓冲及不写 pycache。TMP/TEMP 与用户缓存位置指向任务临时目录。PPTM_HOME 指向绑定快照。代理、证书等由明确设置进入依赖下载作业，普通 PPT profile 不需要服务凭据。

本样本不需要任务期网络；配置标为「无网络需求」，但此模式不宣称操作系统级断网。安装下载是独立作业。系统打开文件仅通过主进程对已登记成果执行；不开放任意 Shell open。

## 8. 进程、取消与恢复

Node 子进程 kill 不等于杀掉整个后代树，采用单次执行的 supervisor。[Node child_process 文档](https://nodejs.org/api/child_process.html)

- macOS：独立 guardian 控制目标进程组；脚本在新 session/process group 内执行，guardian 留在组外监控控制管道。取消先 SIGTERM 整组，2 秒后 SIGKILL，等待组退出及管道关闭。execve 保持进程身份可覆盖样本重执行。明确不支持脚本 daemonize/setsid 逃逸；对此模式不提供恶意进程树清理保证。
- Windows：小型原生 launcher 创建 Job Object，目标以 suspended 状态创建、加入 Job 后再恢复，不允许 breakaway；设置 KILL_ON_JOB_CLOSE，取消通过 Job 终止。不能以 taskkill 或 Node detached 作为等价替代。Windows Job 默认关联其普通子进程，可整体终止，但不等于安全沙箱。[Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- 两端都只管理自己的 executionId 对应实例，不按进程名全局 kill。父进程控制通道断开时 guardian/launcher 清理目标；Run 结束时任何残留后台工作也必须结束。

新增的具体 OS helper 是实现切片 A2 的交付，不作为「未来再考虑」。macOS 与 Windows 都通过后才能声明跨平台可用；先在本机 macOS 做样本验证。

RunService 在消费到引擎终态后先保留候选终态，调用 executionService.finishRun(runId)：禁止新启动、清理全部活跃执行、持久化结束状态，再持久化并广播 run 终态和通知。引擎 Abort 后的 Tool Promise 即使尚未返回也仍在此注册表中。清理最长 5 秒，清理失败走既有 forceFailure 兜底并说明可能残留；不能发布已安全取消。迟到结果不得登记成果，状态迁移采用条件更新防重复终态。

清理失败的执行保留隔离状态，禁止新执行复用其任务目录，提供重新清理入口。正常关闭应用先清理再退出；强杀主进程由 guardian 处理；若 guardian 也被外部杀死，启动恢复显示未确认执行并核实，不凭旧 PID 杀新进程。实例 nonce、创建时间与 OS 对象身份匹配后才尝试清理。

脚本状态：`queued → running → succeeded/failed/cancelled/timed-out`；running 期间可派生 UI「正在停止」，cleanup failure 记录为 failed。启动时所有非终态执行标为 interrupted failure；不自动重放脚本。重试创建新 executionId 和 attempt，用户源输入与已登记版本不变。

## 9. PPT 样本适配预设

| 步骤 | 注册入口/适配 |
| --- | --- |
| 初始化 | ppt-master project_manager.py init，注入 `--dir <run.work>`、`--quick-generate --format ppt169`，避免默认写工具链 projects |
| 图标 | icon_sync.py，项目路径必须是本次已登记项目，图标名作为参数数组 |
| 编写 | Agent 根据模板/骨架写 SVG、pages.json、spec_lock；宿主使用文件工具，模板不变 |
| 质检与导出 | 原 svg_native_export.py 在受管 Python 中运行；适配层检查 exporter 状态、当前 attempt 输出和报告，不依靠历史 LATEST_PPTX |
| 合并 | 原 merge_into_template.py；source/template/config 为句柄解析，输出为新 attempt 文件 |
| 静态校验 | 宿主 Python adapter 调用原 validate(path)，输出含 issues 的 JSON，并以存在 issues 设置失败状态；不只看原 CLI 退出码 |
| 登记 | 验证输出属于本次执行，报告绑定相同 hash，再写文件型 ArtifactVersion |

适配预设按样本内容 hash 匹配，未知更新标为需复核，不冒充已兼容。

原包装把输出写 project/exports，首版每次导出在独立 attempt 的项目副本执行，复制当前 SVG/spec_lock/templates 而不复制旧 exports/validation，杜绝历史产物回收。保留逻辑项目源用于下一次修改。若需修改包装传递 exporter 返回码，补丁只进入可追溯适配副本，同时保存原文件 hash 与差异。

补齐 spec_lock 时显式使用样本要求的 zh-Hans，不依赖包装默认 zh-CN。封面/内容标题按模板版式验证；merge 默认写死字号的问题通过适配副本修正，不在不了解模板时统一改成一个值。字体缺失给可操作诊断，不声称系统自动具备微软雅黑，也不随包分发无权分发字体。

最小默认使用 flat → merge；structured 不作为 A 首个样例的前提。该 Skill 的生成内容必须为原生可编辑形状；模板图像与生成内容分别计数，不能用整个 ZIP 没有图片作为通用验收。

## 10. 成果与验证

PPTX 新增 `presentation` 文件型内容，与 markdown 文本型组成判别联合。读取详情返回文件元信息、验证摘要和预览句柄，不把二进制塞进 content 字符串。新增文件导出/打开 IPC，以 artifactId/versionId 解析，Renderer 不提供任意目标路径；保存对话框选择目标由 Main 掌管。

验证拆为结构、视觉、人工编辑三项，各自 `pending/passed/failed/not-checked`，总状态不得掩盖未检查项：

- 结构：ZIP/XML、关系、页数、标题、生成内容原生形状、报告绑定输出 hash。
- 视觉：用可用渲染后端逐页预览并检查布局；阶段 A 至少提供系统 PowerPoint 打开与人工页面验收，自动页面渲染可单列切片，但不能标自动视觉检查已通过。
- 人工编辑：PowerPoint 打开无修复提示，标题和正文/图形逐元素编辑、保存再打开；作为首个样本发布验收，静态校验不能替代。

结构失败的文件仅作诊断，不作为可交付成果。结构通过但视觉未检查的文件可登记「待检查草稿」，不能标「已验收」。完整 C 交付仍要求页面检查。原始公司模板 hash 前后相同。

模型返回「生成完成」不触发登记。artifact_register_file 校验 execution 归属、终态、输出 hash、验证记录、取消状态，事务登记后再广播。Run 可以在后续步骤取消，但此前已成功登记的版本保留；取消发生后的迟到输出不得登记。登记与取消请求须在 Application 内串行裁决。

来源保持 ADR-0005：登记版本关联本 Run 已登记 Evidence。研究报告派生 PPT 时显式选定 sourceArtifactVersionId 并继承其 Evidence，不能只依赖聊天摘要；这项派生关系迁移在 C 前完成，A 的合成样例没有来源时保持空，不虚构引用。

## 11. IPC 与用户流程

新 IPC 统一在 agent-protocol 用 Zod 定义 input/output，再由现有 handleInput/handleNoInput 收口。拟增动作：

- skills：list/detail/importDirectory/saveRevision/export/enable/disable/remove；trust/revokeTrust 接受修订 ID 与可见范围指纹，Main 重算比对后登记授权，不接受裸 trusted=true 放行任意内容。
- dependencies：inspectPlan/prepare/cancelPreparation/status；操作有 operationId 和持久化进度，不能占用一个长等待 IPC。
- skills.testRun：传 Skill/config 修订 ID 与测试输入，主进程创建真实 Task/Session/Run 并记录试运行标签；不提供任意命令执行 IPC。
- artifacts：fileDetail/exportFile/openFile 与校验状态读取；保留既有 Markdown 接口。

用户流程：导入 → 看到用途/所需依赖 → 选择信任并启用（可保持不可运行草稿）→ 准备环境 → 试运行 → 检查成果。内置 Skill 默认信任，用户撤销/停用优先；自定义 Skill 未信任时试运行提示先授权。已准备资源不重复请求；内置分发已验证的环境无需用户手工运行 pip/git。失败提示分清「缺环境」「脚本失败」「质量未通过」「清理未完成」，给出对应动作。

## 12. 实施与验收顺序

| 切片 | 交付 | 关键验收 |
| --- | --- | --- |
| A1 | Skill 修订/配置、信任、目录与分发索引、依赖快照、迁移、导入 UI | 原包不变、未知字段往返、同名共存、伪造 builtin 拒绝、默认信任与撤销、升级不覆盖用户选择、导入不执行 |
| A2 | 进程 supervisor、Python/环境准备、平台 helper | 锁与断电恢复、离线安装、父进程崩溃、子进程取消、超时、输出限额 |
| A3 | 指令加载、资源/写文件/执行工具、样本适配 | 工具归属、快照固定、依赖缺失、0 退出码+issues 失败、旧产物拒绝 |
| A4 | PPTX 文件成果、试运行页面、安装包资源 | 同一样本完整生成、模板 hash 不变、PowerPoint 编辑、脱离 WorkBuddy 路径 |

A1–A4 共同完成阶段 A，不能只交付 A1 就宣布 Skill 已支持。B 再建设专家配置；C 完善研究与报告流程。

额外覆盖信任撤销与进程启动竞态、停用后不调用、内容/依赖变化授权失效、导出授权不转移、内置升级不恢复用户撤销、安装目录资源被修改时拒绝默认信任。

测试用合成模板/非敏感数据加入仓库，用户公司模板仅作本地验收。自动测试不触网，依赖下载使用注入 fetch/本地制品替身，进程测试用受控小程序模拟孙进程、exec 重执行、超时与异常退出。真实跨平台打包测试另外执行。

发布制品尚需实测确定：Python 精确版本、每个平台 wheels 完整锁、ppt-master 快照完整性与体积、Windows Job helper、字体/PowerPoint 检查。这里提供选择机制和验收标准，不声称这些组合已经验证。

## 13. 未采用的方案与原因

- 直接 exec 任意 Shell 字符串：难以约束参数和归属，不是本样本必要条件。
- 全局 pip / 每次运行自动安装：会污染环境、无法复现且增加任务失败点。
- 只开放三个硬编码 PPT 工具：无法覆盖项目初始化、图标、资源及后续 Skill。
- 每个 Skill 建独立 Agent：增加上下文交接，不符合单专家多 Skill。
- 首版强制 Docker/VM：增加安装门槛；本提案选择明确限制的受信任本地模式。若必须保证恶意脚本也无法越界，此选择需推翻并重新设计，不能以提示词补齐。

## 14. 2026-09-10 审查补救实施契约

本轮用户授权修正阶段 A 已发现的代码缺口；不扩大到 B/C，不将 Windows 或真实 Office 验收标为通过。

- v8 迁移保存授权对应的包锁/快照选择和执行输出元数据。执行输出包含宿主确定的相对路径、字节 hash、报告 hash 和分项状态；模型提交的 validation 不作为可信输入。
- 旧授权未保存依赖选择时，脚本执行要求重新确认现有依赖选择，不猜测全局最新快照。Run 固定 revision/profile/environment/snapshot/grant。
- 样本原校验 CLI 只有文本输出。宿主仅接受该已核验版本的完整单文件报告（parts/slides 头、明确 OK 结尾、无 issues、无捕获截断），转换为结构化报告并绑定文件 hash；空白/JSON/未知输出拒绝。该适配不执行 stdout 中的指令、不改写原校验脚本；未来原包支持 JSON 时需更新适配版本。
- 输出由应用层在进程清理后检查并复制为本次 execution 专属文件，SQLite 成功结果与输出记录一起提交。文件成果登记只消费结构通过的宿主输出，视觉与人工状态保持 not-checked。
- 文件代理检查所有现存父目录和叶节点，拒绝软/硬链接；小文件写入在同步检查区间原子替换。原生受信任代码仍拥有 OS 权限，此措施不构成恶意进程沙箱。

- 生成尝试使用独立目录，拒绝复用旧输出；模板与 SVG 项目以副本执行。工具链清单本身也必须匹配已登记 hash，不能只相信清单中的文件 hash。执行日志按 execution 持久化并限制体积。
