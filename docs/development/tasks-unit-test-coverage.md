# 单元测试覆盖完善计划（TC00–TC06）

- 生效：2026-10-11。本文件是测试覆盖系列**唯一任务状态板**。
- 背景：产品功能基本成型，进入重构为主阶段。当前文件级覆盖率 ~77%（314 源文件 / 263 测试文件），72 个源文件缺专属测试。最大缺口在 persistence 层（18/38 repository 无单元测试）。
- 授权：2026-10-11 光哥批准分阶段实施。
- 平台：macOS。与现有 E/CF/WM 系列并行，不重复排期。
- 执行方式：严格串行、每次一个批次；遵守全仓唯一[工程规范](../12-engineering-standards.md)。

## 0. 已拍板决策

1. **Batch 3（大型仓储）延后**：等重构分支合并后再做，避免在旧 API 上写测试然后重构时再改。
2. **Batch 5（Renderer）排在 persistence 之后**：与计划一致。
3. **CI 覆盖率门槛**：Batch 0 完成后加阈值，新代码行覆盖 ≥80%。

## 1. TDD 工作流

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
| TC00 | 覆盖率基础设施 | 0 | 0 | 0.5 天 | doing |
| TC01 | 纯函数 + 简单仓储 | 12 | ~90 | 1 天 | todo |
| TC02 | 中等仓储 + 纯逻辑服务 | 10 | ~130 | 1.5 天 | todo |
| TC03 | 大型复杂仓储（**延后**） | 7 | ~175 | 2 天 | blocked |
| TC04 | 进程入口 | 2 | ~40 | 1.5 天 | todo |
| TC05 | Renderer hooks + 组件 | 19 | ~100 | 1.5 天 | todo |
| TC06 | 低优先级类型/数据（可选） | 2-3 | ~15 | 0.5 天 | todo |

TC03 前置：重构分支合并回 main。其余批次按编号串行。

## 4. TC00 覆盖率基础设施

**目标**：让 `npm run test:coverage` 能跑出行级 + 分支级覆盖率报告，建立基线。

**文件变更**：
- `package.json` — 添加 `@vitest/coverage-v8` devDependency，新增 `test:coverage` 脚本
- `vitest.config.ts` — 添加 coverage 配置段
- `.gitignore` — 添加 `coverage/`

**验收**：
- `npm run test:coverage` 跑通，输出文本摘要 + HTML 报告
- 记录基线数字（行覆盖率、分支覆盖率、文件覆盖率）

**已知问题**：V8 覆盖率在此项目配置下收集到 0% 覆盖（文件路径正确但 covered=0）。已安装 istanbul 备选但速度过慢。根因待查：可能是 esbuild transform 与 V8 coverage source map 不匹配。不阻塞后续批次——测试编写不依赖覆盖率数字。

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

## 7. TC03 大型复杂仓储（延后）

**前置**：重构分支合并回 main 后再开工。

| 文件 | 行数 | 方法数 | 核心复杂度 |
|------|------|--------|------------|
| `persistence/schedule-occurrence-repository.ts` | 943 | 16+ | 多阶段状态机、跨 6 表事务、cursor 分页 |
| `persistence/skill-repository.ts` | 492 | 18+ | 6 表 CRUD、trust 模型、JSON frontmatter |
| `persistence/schedule-source-repository.ts` | 514 | 10+ | manifest hash + 预算限额 + 去重 |
| `persistence/schedule-output-repository.ts` | 384 | 8 | 7 表 JOIN 校验 + 状态机 + attempt CAS |
| `persistence/model-repository.ts` | ~350 | 11 | 优先级事务 + 凭据双轨 + upsert |
| `services/knowledge-index-store.ts` | 740 | ~20 | 向量空间 CAS + staging→active + BM25 |
| `services/knowledge-job-store.ts` | 481 | ~18 | 作业状态聚合 + sequence 递增 + 分页 |

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
