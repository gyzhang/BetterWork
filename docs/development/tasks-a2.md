# A07–A12：执行器与依赖管理

共同遵守 [执行手册](README.md)、[共享契约](contracts.md) 与 [执行器设计](../designs/skill-executor-and-dependencies.md)。A00 必须提供相关 Proposed 技术方案的实施依据。本文不授权在用户原始环境中安装包。

## A07 执行协议与持久化生命周期

- 前置：A06。
- 必读：AgentTool/ToolExecutionContext、RunService、执行器设计 §5/6/8、docs/12 §5/6/7。
- 目标：定义 JobSpec/JobResult、ScriptExecution、RunSkillBinding、ProcessSupervisor 接口，以及执行仓储/状态转换；不启动真实用户脚本。
- 允许改动：共享协议、Agent Core 类型的 toolCallId 输入和注入处、执行仓储与新迁移、skill-execution-service 接口及测试。
- 实施：状态以契约为准；模型输入与宿主 JobSpec 分离；executionId 由 Main 生成；执行实例在启动之前登记；取消/终止方法幂等；结果不接受其他 Run/Skill 的 outputId。
- 必测：合法状态迁移/重复结束/迟到结果/跨 Run 归属/错误阶段判别；新增 context 字段对既有四工具无回退；迁移回滚与关联完整性。
- 验收：可注入 fake supervisor 验证整个执行服务生命周期；API 不暴露任意 executable/cwd/env。
- 不做：假环境 ready、全局进程注册单例、永久轮询线程。

## A08 macOS supervisor

- 前置：A07；D3/D5 已固定。若采用其他技术必须先更新设计。
- 必读：执行器设计 §8、进程接口、当前平台 helper 规范；Node/Python 官方进程 API 按实现时核对。
- 目标：guardian 管理独立进程组，启动/输出/超时/取消/父进程断开清理。
- 允许改动：infrastructure/process-supervisor 与 macOS adapter/helper、合成进程 fixture、统一规范/根验证的必要接入。新增跨语言规则只补 docs/12 和根门禁，不另建规则体系。
- 实施：shell=false argv；guardian 与目标组分离；控制通道和 stdout 分离；信号按组发送；TERM→宽限→KILL；事件身份带 nonce；有界输出但持续排空；正常结束也处理残留后代。
- 必测：正常、非零退出、spawn 失败、子孙进程、exec 重执行、超时、重复取消、父通道断开、输出淹没、无 stdout 长操作、中文/空格参数、已有同名无关进程不受影响。
- 验收：实际 macOS 测试展示子孙退出与文件句柄关闭；不给 daemonize 恶意逃逸承诺；用户原 Skill 未执行。
- 停止条件：无法覆盖普通子进程清理时不得退化为只 kill 父 PID 后继续。

## A09 Windows supervisor

- 前置：A08 接口稳定。需要可用 Windows 构建/运行环境，不能在 macOS 模拟后写 Windows 已验收。
- 必读：执行器设计 §8、Microsoft Job Objects 官方资料、A08 结果、统一 helper 规范。
- 目标：实现 suspended 创建→加入不允许 breakaway 的 Job→恢复→KILL_ON_JOB_CLOSE；与同一 ProcessSupervisor 契约一致。
- 允许改动：Windows adapter/native launcher、构建配置、对应平台 tests/fixtures、根验证和 CI 的必要增量。若引入新原生工具链，按 D5 记录，不自行选大型框架。
- 必测：进程启动期间即取消的竞态、孙进程、父通道断开、Job 关闭、超时、UTF-8/Unicode 路径、输出限额、句柄泄露和退出原因。
- 验收：Windows 实测完整生命周期；macOS 回归不受影响；缺平台标 blocked 并说明可先行任务建议。
- 不做：使用 taskkill/名称匹配当作 Job 等价实现；混入 Windows Office 功能。

## A10 Python 环境准备作业

- 前置：A09，或用户明确允许先行且 A08 已通过；D2 已有实施授权。
- 必读：执行器设计 §4、contracts §2/3、现有可注入 HTTP 服务测试、docs/12。
- 目标：基础 Python 定位/探测、专属 venv、环境状态/准备 operation、依赖安装计划执行和恢复。
- 允许改动：dependency-service、runtime environment/operation 仓储与迁移、下载/安装适配器和 tests；本卡不发布实际二进制制品。
- 实施：注入 download/process/filesystem 根；最终唯一目录创建 venv，ready 前不可用；同 environmentKey 独占锁；安装完整 hash lock、只选已批准来源；旧环境保留；失败清理本作业目录。选定实际 Python 发行候选与版本记录在依赖验证记录，不凭空填写 hash。
- 必测：同键重复准备、部分安装失败/取消、重启 preparing 恢复、hash 不匹配、缺 wheel、代理凭据不出日志、解释器无 venv、非目标架构、全局 Python 包不修改、无网络缓存路径可用。
- 验收：自动测试全离线注入；在授权临时目录做真实 venv/import probe，不修改系统环境；依赖未完全探测时不能 ready。
- 不做：读取并直接执行 Skill 中 pip 命令，默认装全量 ppt-master requirements，运行时自更新。

## A11 工具链快照、包锁与样本环境就绪

- 前置：A10。
- 必读：样本 SKILL.md、三个脚本、执行器设计 §4/9、样本边界文档。
- 目标：绑定可复现的 ppt-master 快照及样本真正需要的依赖闭包；形成可用于 A16 的 environment/profile。
- 允许改动：快照服务、dependency 仓储/迁移、依赖锁描述与制品清单格式、测试、依赖验证报告。不得把本机私有 deck 或二进制包加入源码。
- 实施：枚举用户选择的外部目录；记录 commit + 所选内容 hash（包括本地修改）；排除历史 projects、缓存、.git；所有排除项列明；PPTM_HOME 指向快照。生成 OS/ABI 对应精确包锁，使用真实下载校验值，保留许可清单。外部资源不足则显示缺项，不绕过上游 integrity check。
- 必测：dirty tree 快照区别于 HEAD；修改源后已绑定快照不变；失配不执行；缺图标/脚本明确失败；环境共享仅完整 key 相同；撤销/授权指纹随依赖变化失效；升级旧 binding 仍可回看。
- 验收：`import pptx/lxml` 等实际模块探测与关键 CLI --help，在临时环境运行并记录平台；命令入口/路径已经验证；PPT 生成留给 A16/A17。
- 停止条件：无法满足上游完整性或所需 wheel，说明缺项，不能把可选依赖误删以强行标 ready。

## A12 配置/依赖 UI 与 A2 验收

- 前置：A11；Windows 生命周期未验收时只能完成本卡本机部分，A2 不标跨平台完成。
- 必读：docs/10、A06 的组件/hook、执行器设计 §11，docs/12 §7/8。
- 目标：Skill 详情可选择解释器/工具链登记项、查看缺项、准备/取消/修复环境；管理动作响应 operationId，进度可回看。
- 允许改动：依赖 IPC/Preload、use-skills 或单独内聚依赖 hook、配置组件、消息/内联反馈必要接线及 tests。
- 必测：重复点击只启动一个作业；切换 Skill 不显示旧进度；未信任但可准备环境与不可执行区分；准备成功后需要新 grant 时明确提示；关闭页面后状态可恢复；取消/失败有结果。
- 验收：用户不需要输入 Shell 命令就能选择本地 Python/工具链或受管环境；重启后依赖状态真实；全 verify + 本机手工旅程。
- 不做：把试运行按钮接到虚构成功返回；把模型 Key 放进 Skill env。
