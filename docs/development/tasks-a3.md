# A13–A17：把真实脚本 Skill 接入 Agent

共同遵守 [执行手册](README.md)、[契约](contracts.md)。本组结束产出可验证的候选 PPT，A18/A19 再登记和展示文件 Artifact，不能在本组提前复制一套临时成果系统。

## A13 Skill 指令与运行绑定

- 前置：A12。
- 必读：Agent Core types/engine/provider tests、RunService、执行器设计 §3/6/11、docs/03。
- 目标：现有 Agent 能在试运行时绑定 Skill 固定修订，接收简介/指令与运行资源说明。
- 允许改动：AgentRunInput 解析后指令字段、engine messages 构造、RunService 绑定快照及 tests、必要协议/仓储增量。
- 实施：Core 不读文件或 SQLite，Application 解析并注入；模型实际日期提示保留；普通任务不绑定 Skill 时行为不变；重复 Skill 去重；上下文长度有显式上限，超限给出读取分段工具，不默默截断关键指令。
- 必测：Provider 请求看到正确指令；user prompt 不变成 system；普通 Run 原有工具行为保持；运行中编辑 profile 不影响当前 binding；工具轮数达到上限明确终止；未信任/缺依赖拒绝启动并解释。
- 验收：Fake Provider 验证输入快照，无需真实网络。
- 不做：专家 CRUD、跨任务长期记忆、自动路由。

## A14 资源、文件与执行工具

- 前置：A13。
- 必读：tool-runtime 工厂、read-text-file 边界、执行器设计 §6/7、contracts §4。
- 目标：skill_read_resource、task_write_file、skill_execute 工具真实可用。
- 允许改动：tool-runtime 新工具及 tests、Main 注入资源/执行函数、RunService 工具组装、lib/labels 和 tool-summary 显示。
- 实施：工具输入 Zod 和模型 JSON Schema 同步；资源句柄指向登记根；任务文件写入有 expectedHash；执行 commandId 映射 structured argv；环境和 Run 身份由 Main 注入；二进制资源不作为 UTF-8 返回。
- 必测：路径穿越、符号链接、越权 binding、不同 Run 文件、写入冲突、Unicode/空格；不允许模型构造 executable/env/runId；禁用/撤销后调用拒绝；stderr 不被当作控制消息；不同错误阶段可解释。
- 验收：合成脚本能读取资源、写任务文件、通过 supervisor 执行并得到结构化结果；原 read_text_file 的权限不扩大。
- 不做：任意 Shell、Python -c、进程内 eval、Node 直接暴露 Renderer。

## A15 取消、撤销与启动恢复

- 前置：A14。
- 必读：RunService consume/dispatch/finalizeFailure、AgentEngine abort 行为、main before-quit、notification-service、执行器设计 §8。
- 目标：引擎终态前等待进程清理；撤销/停用取消相关运行；启动/退出有一致收口。
- 允许改动：RunService、skill-execution-service、skill-service 撤销接线、main 生命周期、执行仓储及 tests。
- 实施：注册先于启动；Run 候选终态暂存；finishRun 禁新启动→清理→持久化执行状态→发布唯一 Run 终态；超时/取消/撤销/cleanup failure 区分；终态后 Promise 结果丢弃；不做重复通知。
- 必测：模型正在流式时撤销；子进程在运行时撤销；grant 检查与 spawn 竞态；普通 Tool 不响应取消；已退出但 stdout 尚未关闭；清理失败；用户关闭应用；主进程被杀后恢复；不按旧 PID 误杀新进程；其他 Run 不受影响。
- 验收：真实受控子孙进程测试 + 单元时序；Run 一定有唯一终态且先清理后宣布安全取消；cleanup failure 可见，不冒充成功。
- 不做：删除已登记成果或取消其他 Skill 的全部任务。

## A16 Skill 包声明式命令契约与通用运行时

- 前置：A15，A11 的依赖/工具链实际就绪。
- 必读：样例 Skill 包的 `SKILL.md`、manifest、相关脚本与模板档案；运行边界文档、ADR-0040 和执行器设计 §6/9/10。
- 目标：命令入口、参数、工具链需求、输出和验证契约由 Skill 包自包含声明；BetterWork 的通用运行时解释声明并保留平台职责。
- 允许改动：共享协议、通用命令解释器、Run/输出服务、调度预检、样例 Skill 包分支、合成测试和文档；不得新增按 Skill ID/content hash 分流的 adapter/validator。
- 实施：manifest 以受限字段声明包内或工具链脚本入口、argv token、路径参数根、超时、输出来源/MIME/扩展名/验证状态；由宿主使用受管 Python、验证快照和真实路径、运行 supervisor、处理取消/超时、拒绝截断报告并绑定输出 hash。样例包负责调用自身 validator 并以退出码表达质量结果；不在宿主解析样本 stdout 或修补 Skill 脚本。
- 必测：包内与工具链入口解析、argv 与重复参数、路径穿越/符号链接拒绝、未绑定工具链拒绝、executionId 输出隔离、只读输入 hash 不变、validator 退出码与完整 stdout 契约、失败/取消/超时不发布输出。
- 验收：合成 fixture 通过通用 runtime 执行链；Skill 包无需 BetterWork 内的样本 hash 注册即可导入并形成 profile。真实 Electron 导入、授权、快照绑定和 Run 另由 A17 人工验收；未完成不得上调 A16/A17 的真实样本状态。
- 停止条件：无法在不增加 Skill 专属宿主分支的情况下表达必要契约时，先更新 ADR/Schema 说明具体缺口，不绕过路径、质量或取消约束。

## A17 真实 Skill 试运行入口与 A3 验收（入口已实现，真实验收待完成）

- 前置：A16。
- 必读：A13–A16 结果、UI 规范、执行器设计 §11/12。
- 目标：用户在 Skill 详情发起试运行，真实 Task/Session/Run 驱动 Agent 读取方法、写 SVG/JSON、运行模板管线、查看结果报告。
- 允许改动：skills.testRun IPC、试运行标签和视图接线、执行报告显示、集成 tests；不新增独立会话/日志存储体系。
- 实施：Main 建稳定 Task/Session/Run；模型测试用 Fake 确定流程；真实模型手工验收另记。A 尚无专家编辑器，入口明确为 Skill 试运行。二进制成果未登记前显示候选输出和执行报告，不伪装为 Artifact 版本。
- 必测：未授权不可试运行；重复启动、取消、切换视图/重启回看；读取模板/生成文件/工具输出串联；失败后的修改重试用新 executionId；所有步骤状态可见。
- 验收：最小封面+内容页；用户提供模板可在本地实际运行，但不存入 Git。保存运行 ID、环境指纹、命令记录、结构结果和模板前后 hash。手工打开仅通过受控诊断流程或用户操作；A19 才提供正式成果打开入口。
- 不做：宣称 PPTX Artifact/安装包/专家配置已经完成；不把 Fake 通过当作真实模型和 PowerPoint 验收。
