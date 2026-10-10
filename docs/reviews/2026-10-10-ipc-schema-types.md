# E2：IPC Schema 与处理函数返回类型的编译期关联

记录时间：2026-10-10 16:10 CST。用户接受 E2 建议并授权实施；从干净 main `29fb2f706a70bc402740c53429e3eeb5a668c6a6` 建立 `codex/review-ipc-schema-types`，继续原 checkout，不新建 worktree。

## 实施契约

1. 四个主进程注册 helper 的请求与响应类型由对应 Zod Schema 推导。handler 接收请求的 `z.output`，返回响应的 `z.input` 或其 Promise；Schema 默认值、转换与输出规范化仍由原 `.parse()` 完成。
2. Schema 参数是类型推导来源，回调使用 NoInfer，避免错误返回值把 Schema 泛型放宽。通用必填/可省略/无入参，以及定时的 data 类型均约束；同步和异步返回都必须匹配。
3. 保持请求解析时机、可省略请求 `raw ?? {}`、无入参 event、响应解析、异常传播，以及 Schedule 有界领域错误与 success/rejected 包装。旧 Memory `ok/data/error`、其他 null/异常语义不统一改写。
4. 编译测试使用仓库实际 tsconfig 和 TypeScript checker，在内存中为真实 register-ipc.ts 追加正/反例；不导出仅供测试的注册 API，不创建第二份 tsconfig，不加入禁止的错误抑制注释。错误同步/异步返回、输入类型、Schema transform/default 与 Schedule 数据形状均验证，运行期非法边界回归继续保留。

本批不重拆共享协议、不建立 channel 全局映射、不迁移旧 Preload invoke 或领域错误格式，不启动其他 R08/R10/R11 工作。沿用 ADR-0003，没有跨模块依赖、领域关系、协议字段、迁移、依赖或产品范围变化；无需新增 ADR。当前运行期契约优先于简化泛型。

## 本地实现与验证

2026-10-10 16:20 CST：四个 helper 已完成编译期关联；本地验证完成，最新源 SHA 的 macOS PR Gate、合并与归档待收口。

- 当次 AST 读数：handleInput 112、handleOptionalInput 7、handleNoInput 21、handleScheduleInput 14，共 154 处生产注册调用；全部由全仓 typecheck 核对实际回调。四个 helper 的运行期函数体与批次基点逐个比较一致。
- 首次接线检出五处已有标注不匹配：预检只读 problems 数组在出口复制为 Schema 可接收数组；两处 cleared、一处 ready 回执保留 true 字面类型；窗口无值回调标注 undefined。实际回执值、解析和异常顺序保持，没有把生产类型断言成期望响应。
- 定向回归 5 文件 / 285 项通过：IPC、Preload、共享协议、Schedule 用例和工程护栏。新增 3 项包括一项真实 checker 测试（15 个合法、17 个非法编译样本）与两项运行期边界回归；编译样本数不混作 Vitest 用例数。请求 transform/default、响应 transform/default、同步/异步、固定字面值、缺字段、nullable/undefined 和 Schedule data/envelope 均覆盖。
- 编译测试使用仓库实际 tsconfig，只加与 `tsc --noEmit` 一致的 noEmit；在真实 register-ipc.ts 的内存源追加调用，核对实际签名、诊断位置与类型错误代码。测试留在原 IPC 测试文件中，沿用对生产模块的依赖，避免独立动态读源测试脱离相关测试选择；不导出测试 API、不写临时源码或第二份配置、不加入错误抑制注释。
- 临时把四个回调返回约束改回 unknown 后，checker 回归准确失败：错误同步返回不再产生诊断。已恢复源码，完整定向回归再次通过；探针日志 `/tmp/betterwork-e2-schema-contract-probe.log` 不提交。
- typecheck、定向 ESLint/Prettier、生产 build 通过。真实 App/Preload/IPC/临时 SQLite app-only 一组通过：4 个普通 Run、失败/取消、窗口销毁后的服务重装配恢复，网络尝试 0；定时规则 paused、实例 0。AI 已查看失败与重开截图，读数位于 `/var/folders/kq/ts17kvnd5yg2kjtkx645y1zw0000gn/T/betterwork-ui-render-4u59D4`。这不是完整 UI、真实模型或安装态验收。

Review 核对四个 helper 的实际输入/输出类型、请求解析时机、Schedule catch 范围、五处出口收窄和合法响应默认/转换语义；没有发现协议行为变更。工程规范 §7 与交接说明补记统一实现契约，不改变编码风格、ESLint/Prettier/tsconfig 配置或规范例外；类型约束由生产签名与真实编译回归落实。夹具的必填 invoke 参数和 ts.sys 方法绑定由静态检查检出后修正，未放宽门禁。

原批次基点 drift:check 已保存读数并复查无漂移，护栏 154、例外 203 和规则指纹保持；docs:check 154 项与差异空白通过。

## 后续边界

E2 完成四个注册 helper 的 Schema/handler 关联。编译期仍不能代替长度、数值范围、精细化校验或不可信运行期数据校验；有意使用 unknown 的响应仍保留原不透明语义。channel 与 Schema/API 的全局映射、共享协议拆分、旧 Preload invoke 及领域错误格式尚未统一，本批不宣称 R09 整项完成。

下一步建议 E3 先治理 R10 的材料候选读模型：候选枚举只读元数据、减少版本与文件校验的重复读取，同时保留精确材料引用和来源安全证明；先核对 Knowledge/Artifact/快照契约再形成具体切片，待后续指令。不自动运行完整 verify、不调用真实模型或操作用户数据库/开发窗口，没有协议、迁移、依赖、产品范围或新跨模块依赖变化。
