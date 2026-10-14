# 单元测试覆盖完善计划（TC00–TC07）

- 生效：2026-10-11。本文件是测试覆盖系列**唯一任务状态板**。
- 背景：产品功能基本成型，进入重构为主阶段。当前文件级覆盖率 314 源文件 / 266 测试文件，72→29 个源文件缺专属测试。最大缺口在 persistence 层（18/38 repository 无单元测试）。
- 授权：2026-10-11 光哥批准分阶段实施。
- 平台：macOS。与现有 E/CF/WM 系列并行，不重复排期。
- 执行方式：严格串行、每次一个批次；遵守全仓唯一[工程规范](../12-engineering-standards.md)。

## 0. 已拍板决策

1. **Batch 3（大型仓储）延后**：等重构分支合并后再做，避免在旧 API 上写测试然后重构时再改。
2. **Batch 5（Renderer）排在 persistence 之后**：与计划一致。
3. **CI 覆盖率门槛**：Batch 0 完成后加阈值，新代码行覆盖 ≥80%。

## 1. TDD 工作流

- 新增领域行为/缺陷修复执行最小反例的 Red → Green → Refactor，证据记录按[工程规范 §1.1](../12-engineering-standards.md#11-aihuman-执行与证据)；既有实现补测标记特征测试。2026-10-14 的门禁实施与验证见 [TQ 任务板](tasks-tdd-quality.md)，不把 TC 历史补测改称测试先行。
- 新增 `*.ts` 必须伴随 `*.test.ts`，同一 PR。
- 测试行为而非实现：断言输入/输出和可观测副作用，`vi.spyOn` 只用于优化验证。
- 用公共 API 构造 fixture（`AppStore.open(':memory:')` + 仓储公共方法种子数据）。
- 按业务场景分组 describe，不按方法名。
- 仓储最低覆盖：happy path + 一个错误路径 + 一个幂等/并发场景。
- 纯函数用 `it.each` 参数化覆盖边界值和异常输入。

## 2. 测试约定

- 框架：Vitest，`describe`/`it`/`expect`/`vi`/`afterEach` 从 `vitest` 导入。
- 数据库：使用真实 SQLite `:memory:`，不 mock 仓储。
- 命名：英文描述性句子，读如规格说明。
- 拆卸：模块级 `stores` 数组 + `afterEach` 统一关闭 + `vi.restoreAllMocks()`。
- 参数化：`it.each(...)` 覆盖腐败/边界/状态矩阵。
- 重文件（≥20s）放入 `HEAVY_TEST_FILES` 串行档。

## 3. 批次总表

| 批次 | 内容 | 新测试文件 | 预估用例 | 预估工时 | 状态 |
|------|------|-----------|---------|---------|------|
| TC00 | 覆盖率基础设施 | 0 | 0 | 0.5 天 | done |
| TC01 | 纯函数 + 简单仓储 | 12 | 194 | 1 天 | done |
| TC02 | 中等仓储 + 纯逻辑服务 | 10 | 285 | 1.5 天 | done |
| TC03 | 大型复杂仓储 | 7 | 339 | 2 天 | done |
| TC04 | 进程入口 | 2 | 23 | 1.5 天 | done |
| TC05 | Renderer hooks + 组件 | 16 | 104 | 1.5 天 | done |
| TC06 | 低优先级类型/数据（可选） | 3 | 36 | 0.5 天 | done |
| TC07 | 跨层行为与错误/并发补齐 | 2 | 576 | 按本轮证据 | done |

TC00–TC06 全部完成（50 文件 / 981 用例）。

## 4. TC00 覆盖率基础设施

**目标**：让 `npm run test:coverage` 能跑出行级 + 分支级覆盖率报告，建立基线。

**文件变更**：
- `package.json` — 添加 `@vitest/coverage-v8` devDependency，新增 `test:coverage` 脚本
- `vitest.config.ts` — 添加 coverage 配置段
- `.gitignore` — 添加 `coverage/`

**验收**：
- `npm run test:coverage` 跑通，输出文本摘要 + HTML 报告
- 记录基线数字（行覆盖率、分支覆盖率、文件覆盖率）

**历史问题**：TC00 当时在原配置下收集到 0% V8 覆盖，根因未定。2026-10-14 TQ03 改为复用主配置的 functional → heavy 独立调用与报告合并，并用真实 V8 正反例校验覆盖门槛；不将配置修订推导为旧 0% 的已证实根因。当前读数、范围和未验项以 [TQ 任务板](tasks-tdd-quality.md) 与当日日志为准。

**门槛落地（2026-10-14）**：代码快检对新增/修改的可执行生产 TypeScript 行执行整体 ≥80% 门槛，并核对必需报告、本轮时间与源码快照；覆盖例外只登记于 `scripts/coverage-policy.json`。完整覆盖率由 `scripts/test-coverage.mjs` 串行收集并合并，不再维护第二套测试分档。

## 5. TC01 纯函数 + 简单仓储

**目标**：用最低成本覆盖纯逻辑代码，建立仓储测试模板。

| 文件 | 难度 | 测试重点 |
|------|------|----------|
| `services/file-artifact-format.ts` | S | 纯 MIME→扩展名映射，`it.each` 参数化 |
| `services/knowledge-errors.ts` | S | 错误类构造 + code 属性 + cause 传播 |
| `infrastructure/dependency-lock-catalog.ts` | S | 注入 fake FileSystem，ID 路径遍历校验，Zod 校验失败 |
| `renderer/lib/mcp-config-import.ts` | M | JSON 解析 + 512K 限制 + 50-server 限制 + Zod 校验 + secret slot |
| `renderer/lib/async-action.ts` | S | `reportAction`/`trackAction`/`describeActionError` |
| `persistence/research-draft-operation-repository.ts` | S | 2 方法幂等 CRUD |
| `persistence/run-settings-repository.ts` | S | 单行 get/save + boolean↔int |
| `persistence/run-artifact-source-declaration-repository.ts` | S | upsert + Zod JSON 解析 |
| `persistence/schedule-notification-repository.ts` | S | 幂等创建 + 冲突检测 |
| `persistence/notification-repository.ts` | M | 200 条滚动驱逐 + target 联合类型 + markRead |
| `persistence/search-engine-repository.ts` | M | JSON 列容错解析 + enabled 互斥 + 凭据集成 |
| `persistence/runtime-environment-repository.ts` | M | 状态条件更新 + JSON Zod + 动态 IN 子句 |

## 6. TC02 中等仓储 + 纯逻辑服务

| 文件 | 难度 | 测试重点 |
|------|------|----------|
| `persistence/dependency-operation-repository.ts` | M | 状态机 queued→running→terminal + CAS + 启动恢复 |
| `persistence/evidence-repository.ts` | M | SHA-256 去重键 + 知识证据 Run-Task 归属校验 |
| `persistence/task-repository.ts` | M | Task→Session→Run JOIN + 最近任务分页 |
| `persistence/schedule-recovery-batch-repository.ts` | M | 游标前进 + JSON 数组累积 + 幂等完成 |
| `persistence/dependency-snapshot-repository.ts` | M | JSON exclusions + 跨 5 表 usage + canDelete |
| `persistence/skill-execution-repository.ts` | L | 执行状态机 + 跨表授权 + JSON 数组 + 中断恢复 |
| `services/task-continuity-context.ts` | M | 多级预算裁剪（6 档限额）+ omission 累积 |
| `services/workspace-brief-reader.ts` | M | 多仓储扇出 + 5 种来源可用性 + 冲突对阻塞 |
| `services/schedule-outcome-service.ts` | M | finalizer 去重 + 事务内投影 + 启动恢复 |
| `packages/agent-core/src/fake-provider.ts` | M | 正则触发工具分发 + 流式 chunk + 取消 |

## 7. TC03 大型复杂仓储（done）

**前置**：重构分支合并回 main 后再开工。2026-10-11 开工，同日收口。

| 文件 | 行数 | 方法数 | 核心复杂度 | 状态 |
|------|------|--------|------------|------|
| `persistence/model-repository.ts` | ~350 | 11 | 优先级事务 + 凭据双轨 + upsert | done（34 项） |
| `persistence/schedule-output-repository.ts` | 384 | 8 | 7 表 JOIN 校验 + 状态机 + attempt CAS | done（32 项） |
| `persistence/skill-repository.ts` | 492 | 18+ | 6 表 CRUD、trust 模型、JSON frontmatter | done（54 项） |
| `persistence/schedule-source-repository.ts` | 514 | 10+ | manifest hash + 预算限额 + 去重 | done（48 项） |
| `services/knowledge-job-store.ts` | 481 | ~18 | 作业状态聚合 + sequence 递增 + 分页 | done（55 项） |
| `services/knowledge-index-store.ts` | 740 | ~20 | 向量空间 CAS + staging→active + BM25 | done（57 项） |
| `persistence/schedule-occurrence-repository.ts` | 943 | 16+ | 多阶段状态机、跨 6 表事务、cursor 分页 | done（59 项） |

## 8. TC04 进程入口

| 文件 | 难度 | 测试策略 |
|------|------|----------|
| `infrastructure/knowledge-worker.ts` | M | spawn 子进程 + NDJSON 协议 + nonce 校验 |
| `infrastructure/skill-guardian.ts` | L | spawn 子进程 + 进程组管理 + 超时/取消/清理 |

放入 `HEAVY_TEST_FILES` 串行档。

## 9. TC05 Renderer hooks + 组件

**Hooks（13 个）**：提取共享 `installMockIpc()` helper 减少模板代码。

重点：`use-run-settings`（防抖 + 过期丢弃）、`use-memories`（分页）、`use-search-engine-settings`（启用互斥）、`use-skill-dependencies`（多步 IPC + 轮询）。

**组件（6 个）**：`FieldSelect`、`ModelEditorSheet`、`Welcome`、`WorkspaceGroupList`、`WorkspaceIdentityDialog`、`WorkspaceSelector`。

## 10. TC06 低优先级（可选）

- `node-distribution.ts` / `python-distribution.ts` — 静态数据完整性
- `packages/agent-core/src/errors.ts` — 运行时函数
- 纯类型/接口/barrel 文件跳过

## 11. PR 拆分

- TC00 单独 PR
- TC01 拆 2 个 PR：纯函数（5 文件）+ 简单仓储（7 文件）
- TC02 一个 PR
- TC04 单独 PR
- TC05 拆 2 个 PR：hooks + 组件

## 12. 预期效果

- 文件覆盖率：77% → ~95%
- 行覆盖率：建立基线后预计提升 15-25 个百分点
- 新代码 CI 门槛：行覆盖 ≥80%

## 13. TC07 行为级覆盖补齐（2026-10-15，done）

- 授权：用户明确要求「全面补齐单元测试」。从 main `69e76f45` 创建 `codex/unit-test-completion`，独立 worktree 实施；TC00–TC06 的历史状态和 WM/CF/SC 人工验收状态保持原记录。
- 口径：不以“有没有同名测试文件”判断是否已测试。核对生产源文件、公共导出、现有直接/集成消费者与真实 V8 未命中分支；类型、转发模块、已由集成场景覆盖的组件和测试夹具分别识别。宿主/纯视觉的精确例外仍只在 `scripts/coverage-policy.json`。
- 基线：沿用 TQ 同口径代码专项报告，行 86.27%（21,473/24,888）、分支 74.51%（15,161/20,346）；排除 `scripts/ui-render-check.test.ts`。本轮不把专属文件覆盖误称业务路径全部覆盖，也不追求用私有方法调用或扩大例外凑 100%。

| 覆盖簇 | 具体行为 | 状态 |
| --- | --- | --- |
| IPC / Preload | 全部请求通道拒绝非对象载荷；Knowledge/Skill/材料/讨论/Memory 请求路由、非法输入、非法响应、错误传递与治理回执 | 定向通过 |
| Application / 持久化 | 输入快照只读/限额/路径/损坏/失败恢复；MCP 安全诊断、操作归属、迟到检测、凭据槽；Run 的资源归属与命令结果；来源读取用真实 SQLite 固定版本并拒绝缺审计 | 定向通过 |
| Renderer 状态 | Knowledge 失败、研究选择与幂等键；技能导入/取消/授权/导出；环境检查、防重入和旧 Skill 请求；定时专家选择、预览、保存和实例切换 | 定向通过 |
| Renderer 呈现 | MCP 导入部分失败、精确工具合同审阅、机密只写表单；通知状态、浮层寿命与退订；工具摘要、定时状态、记忆来源/日期和标题栏交互 | 定向通过 |
| Agent Core | 并发 Run 的事件身份与顺序、工具等待中取消、输出上限、运行约定预算 | 定向通过 |
| 统一验收 | 代码专项全量 functional → heavy 覆盖率、相关差异快检与治理巡检 | done |

已有实现补测均为特征测试。生产修复之一为 `use-schedule-detail.ts`：选择新实例时，立即使旧来源/证据刷新请求失效。最小正反例先在原实现失败（两例），再增加两个请求代号更新并绿跑；现行依据是 docs/12 §5 的过期响应保护，不引入新领域关系或迁移。具体命令、结果与最终读数追加于当日日志。

第二处生产修复为 `notifications.tsx`：首次列表读取期间按顺序保存变更事件，迟到快照按同一列表归并规则重放；created 按稳定 ID 去重，read/read-all/deleted/cleared 不被快照撤销，浮层仍只由实时事件投影一次。六个最小反例在原实现失败，通知整文件 26 例绿跑；仍只沿用 docs/12 §5 的快照与增量合并要求。

环境准备终态与隔离补测另外发现并修复 `use-skill-dependencies.ts` 两处：轮询收到 `interrupted` 后停止 busy 状态；旧 Skill 的准备失败回调按请求代号丢弃，不覆盖新面板或清除新作业的 in-flight 标记。终态/切换五例在原实现三绿两红，修复后同文件 25 例通过。

最终本地收口（2026-10-15 02:41）：18 个测试文件新增 576 例（两个新文件）；代码专项 326 文件/4,403 例通过，行 88.62%、分支 76.97%。快检 lint/格式/类型/文档/相关测试及生产差异行 27/27 通过，批次巡检无漂移。四处生产缺陷均留最小反例先红后绿；模块读数、证据与未验范围见 [TC07 验证报告](../reviews/2026-10-15-unit-test-completion.md)。done 仅指本地实现与自动化交接，尚未提交推送合并，也不代签产品人工验收。
