# 跨任务实施契约

本文件为执行器设计的编码落点建议，不另设风格规范。A00 确认决策范围后，后续任务遵守同一契约；如确需改变，在实现前更新 ADR/本文并说明调用方影响。新路径均是计划，不是已有功能。

## 1. 范围与身份

首个支持对象是目录型 `ppt-generation-expert`，不是重新创建一个 PPT Expert。Skill 可以被一个专家绑定；阶段 A 用现有 Agent 的 Skill 试运行入口，阶段 B 再增加 Expert。

不要以 name/目录名/声明的 version 作为唯一 ID。建议身份链：

| 对象 | 关键字段与约束 |
| --- | --- |
| Skill | id、name、description、sourceKind（builtin/user）、enabled、currentRevisionId；sourceKind 由 Main 判定 |
| SkillRevision | id、skillId、contentHash、originalVersion、resourceKey、原 frontmatter、createdAt；内容不可变 |
| RuntimeProfileRevision | id、skillId、profileHash、命令/环境/输出约定；不可变；纯指令 Skill 可无可执行命令 |
| TrustGrant | id、skillId、revisionId、profileHash、dependencyFingerprint、scopeHash、source、grantedAt、revokedAt；不能是单个 trusted 布尔字段 |
| DependencySnapshot | id、origin、originCommit 可选、manifestHash、resourceKey、许可证清单；包含所选本地修改 |
| RuntimeEnvironment | id、environmentKey、finalPathKey、状态、锁定依赖指纹；ready 之前不可运行 |
| RunSkillBinding | id、runId、skillRevisionId、profileRevisionId、environmentId、dependencySnapshotIds、grantId；归属由 Application 注入 |
| ScriptExecution | id、runId、toolCallId、bindingId、commandId、status、reason、attemptKey、报告和输出句柄 |

外部资料路径、基础 Python 路径、输出路径不由 Renderer 直接进入执行器；文件选择/登记在 Main 完成，调用方提交登记 ID。实际数据库整数/文本编码与 nullable 策略按 docs/12。

## 2. 状态和权限

- Skill enabled 与 trustStatus 与 environmentStatus 独立，不保存易过期的 canRun；在 Application 派生并给出 blockedReasons。
- trustStatus：untrusted / trusted / needs-review / revoked。纯文本查看不需要 trust；脚本试运行必须 trusted。
- environmentStatus：unprepared / preparing / ready / failed / cancelled / invalid。作业失败理由可以 interrupted，不增加未设计的新 Run 状态。
- ScriptExecution：queued / running / succeeded / failed / cancelled / timed-out。stopping 作为过程信息；cleanup failure 为 failed 且 reason=cleanup-failed。
- Run 暂时仍沿用既有 running/completed/failed/cancelled；不因引入 Skill 擅自加 run.waiting。C 的六节点恢复另立设计。
- 运行必须满足 enabled、有效 grant、环境就绪、命令及范围匹配；每次启动实时检查撤销。
- 内置 grant 只来自核验的发布清单；用户包中的 trusted、source、builtin 等字段不能授予权限。
- 用户 revoke/disable 是持续偏好，新内置发布不能覆盖。复制内置生成新 user Skill，默认不复制授权。
- 启动、撤销、登记在同一 Application 事务/串行裁决边界，避免检查通过后撤销却仍启动或登记。
- 本地代码信任不等于 OS 文件/网络沙箱。不得靠 UI 文案扩大实际保护能力。

A01 可先定义完整配置形状，A02 只创建当前需要的 Skill/profile/trust 表。依赖/执行表在 A07/A10/A11 增量迁移，不提前建空表占位。没有依赖锁时可保存启用的草稿并记录用户信任意图，但 canRun=false；有效授权在依赖准备完成、scope 指纹确定后建立或确认，不能用空指纹代替最终 grant。

## 3. 目录与资产

- 开发内置：repo/resources/skills/<name>，通过定位器读取。
- 安装内置：appResources/skills/<name>，完整目录只读使用，执行前 hash 与发布清单匹配。
- 用户 Skill：userData/skills/<skillId>/revisions/<contentHash>。
- 依赖、Python、venv、日志与成果位置按执行器设计 §5；不把 venv 暂存后 rename，直接在独占最终目录准备。
- 原件不变；临时目录复制 Skill 后核验再登记，失败不留下可见半安装；资源先落盘后提交 DB，孤儿目录可回收，丢失资源不得报成功。
- 目录导入/导出为 A 的必需；ZIP 解析不是自动前置。资源原样保留，frontmatter 未知字段往返；产品内部配置通过额外描述文件导出，信任/密钥不导出。
- 模板可在用户明确选择后包含于用户本地包；测试/公共内置只用通用合成模板。不能自动把 Downloads 样本复制进 resources/skills。
- 文本相对路径支持中文和空格；路径穿越、符号链接、特殊文件与包大小超限有明确拒绝。

## 4. 运行命令与输出

模型输入 `bindingId + commandId + args对象`；Main 根据参数 Schema 解析为 `executable + argv数组 + cwd + env`。不提供 Shell 字符串、任意可执行路径、任意环境变量、用户指定 runId 的执行 IPC。

首个 profile 命令语义固定为：project-init、icon-sync、svg-export、template-merge、pptx-validate；svg-export 包含其原有 SVG 质量门。名称是 profile 的命令 ID，不是新增一组模型 PPT 专用工具。

模型工具名称：skill_read_resource、task_write_file、skill_execute、artifact_register_file，均 snake_case。资源读取支持长度/范围，二进制不强行解码；文本生成工具足够编写 SVG/JSON，不要求自由 Python -c。

ToolExecutionContext 添加 toolCallId，由 Agent Engine 注入；不能由模型传入伪造。tool.completed 输出经宿主确定的结果适配器校验，不将脚本 stdout 当成控制协议。

取消后不得发布新结果。RunService 缓存引擎候选终态，先 finishRun 清理全部子进程，再先持久化后广播；cleanup failure 用统一失败兜底，终态唯一。迟到 promise 的完成事件不可改写终态。

## 5. 文件成果

A17 先验证执行输出/结构报告，诊断路径只存执行记录，不冒充 Artifact。A18 完成 `presentation` 文件型变体后才可登记真正 PPTX 成果。

Markdown 接口保持可用，文件详情通过判别联合与文本内容区分。输出只通过 executionId/outputId 引用，Main 校验本次归属、普通文件类型、内容 hash 与报告 hash 一致性。

验证为 structure/visual/manual-edit 分项，状态 pending/passed/failed/not-checked；结构失败不可作为成功交付。结构通过但视觉未检查可保存待检查草稿。现有 ArtifactVersion 的 assistant-run/user-edit 和 Evidence 关系保持。

A 不引入 Claim/Citation 或跨报告派生来源；C 独立处理 sourceArtifactVersion 的继承，不能伪造来源。

## 6. 文件修改定位

| 主题 | 既有入口 | 预期新增落点 |
| --- | --- | --- |
| 协议 | packages/agent-protocol/src/index.ts / index.test.ts | 同一共享协议来源；如拆文件须 re-export 并保持单一边界 |
| 迁移 | apps/desktop/src/main/db/app-schema.ts / migrate.test.ts | 按最新版本追加，不预设迁移编号 |
| 仓储 | apps/desktop/src/main/persistence/index.ts | skill-repository、skill-execution-repository 等按聚合拆分 |
| 服务 | apps/desktop/src/main/services/run-service.ts | skill-service、skill-dependency-service、skill-execution-service、file-artifact-service |
| 进程 | 尚无 | apps/desktop/src/main/infrastructure/process-supervisor.ts 与平台实现 |
| IPC | apps/desktop/src/main/ipc/register-ipc.ts | 继续在此统一注册，不散落 ipcMain.handle |
| Preload | apps/desktop/src/preload/index.ts | 最小类型化 API，输出校验 |
| UI | App.tsx、lib/view-types.ts、styles.css | views/SkillsView.tsx、hooks/use-skills.ts、components/skills/ |
| 工具 | packages/tool-runtime/src/index.ts | 工厂与纯 Schema，不导入 main 服务 |
| 运行指令 | packages/agent-core/src/types.ts / agent-engine.ts | 解析后的 trusted instructions，Core 不读目录/DB |
| 资源打包 | apps/desktop/electron.vite.config.ts | 明确 extraResources 构建配置，不能仅 alias 开发路径 |

新增 Python/native helper 若不被现有规范覆盖，A00/A08/A09 先补 docs/12 的同一份跨语言规则和根门禁；不另立子目录风格，不复制第三方脚本后按自创规则批量格式化。

## 7. 需要保持的设计决策记录

在 A00 结果中为每项写：决策、用户已有授权依据、状态、负责切片、验证证据。

| 决策 | 推荐 | 谁处理 |
| --- | --- | --- |
| D1 执行模式 | 受信任本地代码，不承诺恶意代码沙箱 | 产品已确认范围；A00 核对，A04/A15 验证 |
| D2 依赖分发 | 受管 Python + 固定 wheels；本机 Python 仅作可选基础 | ADR-0010 Proposed，A00 确定实施依据，A10/A11 验证 |
| D3 进程生命周期 | macOS guardian/进程组 + Windows Job helper | ADR-0010 Proposed，A00 固定方向，A08/A09 实证 |
| D4 包结构 | 目录原包 + 宿主配置，目录导入导出先行 | A00 固定交换描述格式，A01/A03 实现 |
| D5 工程扩展 | 新 helper 进入现有全仓规范和 CI | A00 规划，A08/A09/A20 落实 |
| D6 PPT 产物 | presentation 文件型，分项质量状态 | A00 明确契约，A18/A19 验证 |

不要因为包版本尚待下载实验就阻止 A01–A06；但 A10/A11 不能在没有完整锁/实际探测情况下声称 ready。涉及 Proposed 选型若用户已授权按本设计实现，记录授权即可，不再强制额外审批回合。
