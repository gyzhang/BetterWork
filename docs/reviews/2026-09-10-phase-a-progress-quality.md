# 阶段 A 开发进展与质量审查（2026-09-10）

## 结论与范围

**不能认定已经完成 A21，也不能认定阶段 A 已形成真实 PPT 交付闭环。** 管理、协议、迁移、依赖服务和 macOS supervisor 已有较多实现与自动测试；A13–A20 的运行装配、成果可信性和取消收口仍有实质缺口。建议先完成阶段 A 补救及真实验收，再推进 B。

本轮是检查，不是执行手册里的开发派单。没有修改业务实现、任务状态、用户数据或发布制品。开始 HEAD 为 `f89a8af`，已有 `electron-builder.yml` 用户改动；审查期间外部提交 `a67629f` 收录了该文件的资源配置修正，未改动本报告引用的业务代码。本轮未提交。

环境：macOS arm64，Node v26.8.1。按 GATE-0 先尝试只读连接规定的 SQLite 路径，再查看 `/tmp/betterwork-dev.log`，两者本机均不可用。因此未对用户历史 Run、真实 PPT 或手工验收作数据库确认；以下区分代码证据、临时复现与既有日志记载。

## 进度核对

| 范围 | 仓库证据与审查判断 |
| --- | --- |
| A00–A06 | 任务板 done，存在协议、仓储、服务、UI 测试和 A1 手工记录；本轮相关既有测试通过，未重跑完整桌面旅程。 |
| A07–A11 | 执行/依赖/快照服务已实现，macOS supervisor 有真实受控进程测试；A09 明确 blocked，Windows 未完成。 |
| A12 | 任务板 doing，但 09-09 日志记载用户于 17:56 完成本机手工验收；这是状态与证据不同步，应核对后统一，不能简单断言从未手工验收。 |
| A13–A16 | 有实现和单元测试，但适配器、受管环境绑定及质量门未形成可靠装配；不满足真实样本链路验收。 |
| A17 | 标 done，但同日日志明确“真实模型和 PPT 生成的人工验收未做”；完成的是入口接线，A3 真实验收证据不足。 |
| A18–A19 | 文件成果存储/UI/IPC 已实现；真实输出登记缺口和质量门问题见下文。A19 明确待手工打开、导出、版本与 Markdown 回归。 |
| A20 | 有 builder 配置、本地 `dist/mac-arm64/BetterWork.app` 及 skills/依赖锁资源；存在制品不代表冷安装旅程通过，未发现完整制品 hash/安装验收报告。 |
| A21 | 任务板 todo，必需的 `docs/reviews/phase-a-acceptance.md` 不存在，当前能力交接仍保留旧阶段描述。不能标完成。 |

不采用“done 行数/总任务数”的百分比：任务大小不同，里程碑明确要求真实旅程，完成标签也已有证据不一致。

## 必须优先修复的问题

### R1 · P1：生产装配的 PPT 适配器永远不会命中

位置：`apps/desktop/src/main/index.ts:157`，`services/skill-adapter.ts`。

生产入口用 `register(pptGenerationAdapterFactory, [])` 注册，兼容判断只检查 hash 是否在列表中。因此任何导入样本都不会进入已写的五命令适配路径，而是进入通用 executableKey/argv 分支。单测给工厂注入合成 hash，无法证明生产入口可运行样本。

修复验收：建立本地原包核验及适配预设登记流程；通过真实组合根导入受支持样本，证明 project-init 等命令进入适配器；未知 hash 明确拒绝或解释未支持，不能把通用执行当作样本已兼容。

### R2 · P1：运行没有使用已准备环境和绑定的工具链快照

位置：`services/run-service.ts:611`、`:649`，`services/skill-execution-service.ts:99`。

创建 binding 只传 runId/skillId，没有传环境或快照；适配分支把 managedPythonPath 写为 `python3`，工具链取全局最新快照。环境准备成功并不意味着脚本会使用该 venv；PATH 中的解释器可能没有已准备的包。新增其他快照也能改变后续命令使用的工具链，违反固定 binding 的运行语义。

修复验收：绑定并验证环境、依赖指纹、profile 修订和快照 ID，从 binding 解析真实解释器及工具链；运行中新增快照/改 profile 不应改变本次执行。此问题即使修好 R1 仍会存在。

### R3 · P1：真实执行不产生输出句柄，无法登记 PPTX 成果

位置：`infrastructure/mac-process-supervisor.ts:489`，`services/skill-execution-service.ts:175`，`services/file-artifact-service.ts:45`。

macOS supervisor 的成功结果固定为 `outputIds: []`，没有处理 expectedOutputs/validatorId；执行服务原样保存，而登记服务要求 outputId 在执行记录内。因此真实脚本即使落盘 PPTX，也会在登记时遭遇“Output is not registered for this execution”。文件成果测试直接向数据库注入非空 outputIds，绕过了实际缺失的环节。

修复验收：宿主收集本次 attempt 的输出、内容 hash 和验证报告，登记稳定句柄；用真实 supervisor→执行服务→文件成果服务的合成集成测试验证完整链路及旧文件拒绝。

### R4 · P1：质量门对缺失报告放行，校验状态可由模型自行声明

位置：`services/ppt-generation-preset.ts:212`、`:236`，`packages/tool-runtime/src/artifact-register-file.ts`，`services/file-artifact-service.ts:83`。

校验只扫描以 `!!` 开头的行；退出状态 succeeded 加空 stdout、错误 JSON 或任意非报告文字都会得到“OOXML 校验通过”。模型可以提交 structure/visual/manualEdit 状态，服务端直接持久化，没有验证与输出 hash 绑定的真实报告。适配器返回 failed 也未同步改写已经 succeeded 的执行记录。

临时复现：空串、`{"issues":["broken relationship"]}`、`invalid JSON` 全部被解释成 succeeded；直接调用文件服务，普通文本文件配 structure=failed 仍登记成功。工具 Schema 虽拒绝显式 failed，模型声明 passed 仍不需要真实验证证据。

修复验收：由宿主读取完整结构化报告，缺失/格式错/截断拒绝；校验绑定本次文件 hash；只有真实验证结果能改变状态，视觉/人工未检默认保持 not-checked。补齐 exit=0 但 issues 非空、缺报告和伪造状态用例。

### R5 · P1：任务文件写入可通过父目录符号链接越界

位置：`services/run-service.ts:471`。

对尚不存在的新文件，realpath 失败后回落到字符串路径，只做词法范围判断。若 work/linked 是指向目录外的符号链接，`linked/new.txt` 尚不存在时会通过检查，writeFile 最终跟随父级链接写出工作目录。

临时复现：使用真实规范化工作区路径，在受控临时目录内创建父目录符号链接，调用现有 writeTaskFile，成功在另一个临时目录写入 new.txt。未触碰用户文件。初次使用 macOS 临时路径别名时被提前拒绝，改用 realpath 后稳定复现。

修复验收：对目标现存祖先逐级核验，拒绝符号链接借道，并处理检查到写入之间的竞态；补新文件、嵌套父目录及正常中文路径用例。

### R6 · P1：Run 忽略清理失败报告，仍可能宣布完成或取消

位置：`services/run-service.ts:267`，`services/skill-execution-service.ts:227`。

finishRun 将清理失败作为 `{ cleanupFailed }` 返回，而调用方只捕获异常，没有检查返回值。真实 supervisor 返回 cleanupCompleted=false 时，不会触发该 catch，候选 run.completed/run.cancelled 仍会发布。现有 RunService 测试模拟的是 finishRun 抛异常，未覆盖实际返回报告的失败路径。

修复验收：显式检查清理报告，将失败收口为可见 run.failed；补“正常返回 cleanupFailed=1”的跨服务测试，并验证只有一个 Run 终态。编排 catch 也应保证异常路径先清理再发布失败。

### R7 · P1：退出钩子没有阻止 Electron 退出，不能保证等待 shutdown

位置：`apps/desktop/src/main/index.ts:230`。

before-quit 回调启动 Promise 但没有调用 event.preventDefault，也没有清理完成后再退出的状态控制。Electron 不会自动等待此回调里的异步清理，当前“关闭前等待全部 Run”的注释无法由装配代码保证。guardian 的父通道断开清理仍有价值，但不等于正常退出能等待持久化及取消收口。

修复验收：用有重入保护的退出流程先阻止退出、等待受控清理/持久化、再最终退出；验证真实正在运行子孙进程时关闭应用，终态和日志都完整。

### R8 · P2：文件登记缺少幂等及取消提交保护

位置：`services/file-artifact-service.ts:35`，`persistence/artifact-repository.ts:250`。

每次请求都创建新 UUID，没有 executionId/outputId 去重。临时复现同一执行和输出连续登记得到两个不同 Artifact。服务在多次 await 后提交，没有重新检查 Run 的取消/终态及授权；工具执行后的 abort 检查也不能撤销已经入库的版本。此外未核对报告对应 hash、硬链接数，先 read/hash 再 copyFile 会使复制字节与记录 hash 有竞态。

修复验收：以本次输出建立幂等键，在同一提交裁决边界检查运行与授权；复制已验证字节或校验落盘副本；补重复请求、撤销/取消与落盘并发、硬链接和字节变化测试。

## 验证结果与测试质量

| 本轮命令 | 退出码 | 结果 |
| --- | --- | --- |
| `npm run verify` | 1 | lint、format:check、typecheck 通过；39 文件中 38 通过、1 失败；348 测试中 347 通过、1 失败；因短路未运行 build。 |
| `npm run build` | 0 | 单独构建通过；存在 Zod Rollup 注释警告。 |
| 临时 `review-probe.test.ts` 定向运行 | 0 | 3 个复现用例确认上述不安全行为；这是“缺陷复现成功”，不是功能验收通过。临时测试已删除。 |

门禁失败位置：`apps/desktop/src/main/services/skill-dependency-service.test.ts:686`，真实 venv 测试断言 `sitePackages.startsWith(venvRoot)` 为 false；此前 ready 和解释器退出码断言已经通过。该断言需要进一步输出规范化后的非敏感路径诊断，不能据此直接断言依赖安装损坏，也不能忽略失败宣布 verify 通过。

本轮原始输出：`/tmp/betterwork-review-verify.log`、`/tmp/betterwork-review-build.log`、`/tmp/betterwork-review-probes.log`。临时目录日志不是长期验收资产，关键结果已在本文固化。

已有质量基础：类型与分层护栏、真实 SQLite 迁移、隔离的 HTTP 测试、macOS 真进程测试均有价值。主要缺口是跨服务装配与真实使用旅程：预设工厂用合成 hash，文件测试直接注入输出记录，清理测试模拟抛错；局部测试通过没有覆盖生产实际连接方式。

其他可见缺口：入口日志 sink 将输出仅放内存并在 close 清空，没有可重启回看的执行日志；A20/A21 尚缺冷环境、制品清单/hash、升级保留授权/副本和 PowerPoint 可编辑验收记录。本轮没有新启动桌面 UI、调用真实模型或验证 Windows，因此不对这些项目追加通过声明。

## 建议收敛顺序

1. 优先修 R5 文件边界、R6/R7 清理语义、R4/R8 成果可信性与提交保护，并补跨层回归。
2. 修 R1/R2/R3，打通“受信任样本→固定环境/快照→真实执行→质量报告→输出句柄→Artifact”的集成测试。
3. 定位当前门禁失败，重新通过完整 verify。
4. 在全新用户数据目录执行 A17/A19/A21 的真实 macOS 旅程，记录 Run/Execution、模板前后 hash、制品 hash、导出、PowerPoint 编辑和重启结果；失败旅程独立记录。
5. 统一任务板、日志和 docs/11/路线图；Windows 继续如实 blocked，除非另有明确限缩平台决策。完成验收后再进入 B。
