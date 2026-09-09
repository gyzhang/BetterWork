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

## A16 PPT 样本适配预设

- 前置：A15，A11 的依赖/工具链实际就绪。
- 必读：`/Users/kevin/Downloads/ppt-generation-expert/SKILL.md`、scripts 三文件、references、模板档案；运行边界文档与执行器设计 §9。
- 目标：用宿主预设把原目录 Skill 的路径、命令、报告和产物契约接上，不改用户原包。
- 允许改动：通用 adapter 接口与 ppt-generation 预设、公开非敏感配置、合成测试/报告；本地适配副本保存在受管用户目录。
- 实施：project-init 注入 --dir，PPTM_HOME 用快照，Python 用受管解释器；导出每个 attempt 新项目副本，不复制旧 exports/validation；LATEST_PPTX 必须属于本次；validate(path) 的 issues 形成结构结果；zh-Hans/模板标题适配记录原 hash 和差异。
- 必测：exit=0 但 issues 非空失败；错误/缺失/不完整 JSON；导出失败却留旧 PPT 拒绝；超时不发布；未知原包 hash 不套用已验证预设；脚本不修改源模板；路径不依赖 .workbuddy；初始化不写外部仓库 projects。
- 验收：使用合成 SVG/模板直接执行该链路得到正确输出；不是通过替代 PPT 生成库绕过原工具链；原包 hash 前后相同。
- 停止条件：模板/脚本契约矛盾无法适配则报告具体差异，不绕过 quality gate。

## A17 真实 Skill 试运行入口与 A3 验收 ✅ 2026-09-09 完成

- 前置：A16。
- 必读：A13–A16 结果、UI 规范、执行器设计 §11/12。
- 目标：用户在 Skill 详情发起试运行，真实 Task/Session/Run 驱动 Agent 读取方法、写 SVG/JSON、运行模板管线、查看结果报告。
- 允许改动：skills.testRun IPC、试运行标签和视图接线、执行报告显示、集成 tests；不新增独立会话/日志存储体系。
- 实施：Main 建稳定 Task/Session/Run；模型测试用 Fake 确定流程；真实模型手工验收另记。A 尚无专家编辑器，入口明确为 Skill 试运行。二进制成果未登记前显示候选输出和执行报告，不伪装为 Artifact 版本。
- 必测：未授权不可试运行；重复启动、取消、切换视图/重启回看；读取模板/生成文件/工具输出串联；失败后的修改重试用新 executionId；所有步骤状态可见。
- 验收：最小封面+内容页；用户提供模板可在本地实际运行，但不存入 Git。保存运行 ID、环境指纹、命令记录、结构结果和模板前后 hash。手工打开仅通过受控诊断流程或用户操作；A19 才提供正式成果打开入口。
- 不做：宣称 PPTX Artifact/安装包/专家配置已经完成；不把 Fake 通过当作真实模型和 PowerPoint 验收。
