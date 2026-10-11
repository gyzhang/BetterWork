# E14：历史重放最终回答批量读取（R10）

2026-10-11 用户授权推进 E14。原 checkout 同步 main 后的批次起点为 `6f369a1de5242e83993d75f3cab9e9fa54f24077`，任务分支 `codex/e14-history-final-answers`，未新开 worktree。本文只评审历史重放的最终回答读取；此前合入 main 的图表及独立 Node.js 运行时保持原样。

## 变更与边界

`RunRepository.listLatestNonEmptyMessageCompletions` 用 json_each 单参数接收去重后的完整请求集合，一次查询替代逐 Run 查询。递归读取每个 Run 的最后一条消息；仅当正文是字符串空值时继续向前，遇首个非空消息停止。消息子查询的 LIMIT 1 只选该 Run 下一条消息，成员子查询的 LIMIT 1 只取末个 content 字段，不限制候选数量、空消息深度或返回集合。

SQL 只控制读取窗口，返回的每条消息仍经原 `parseStoredEvent` 的完整协议 Schema 和 journal id/runId/type/sequence 校验，包括空消息。损坏 JSON、非字符串正文、缺字段或身份不符均报错，不能跳过损坏消息寻找更早回答。空白字符串及 NUL 保持非空；全空或无消息保持无回答。更早消息、无关事件及未请求 Run 的载荷不进入解码窗口。

提交后的 Review 发现 SQL 路径取首个同名字段，而原 JSON.parse 取末项；新增回归实际检出多读旧回答。修正为 json_each 按成员遍历 rowid 取末项，匹配重复、转义字段名与 NUL 的原解码语义。已检查所用 better-sqlite3 内嵌 SQLite 的 jsonEachNext/jsonEachRowid 实现，不用仅保证唯一性的 JSON id 推断顺序；[SQLite JSON 文档](https://www.sqlite.org/json1.html#the_json_each_and_json_tree_table_valued_functions)说明 id 属内部编号。成员判断仍不替代完整事件校验。

`collectPriorRunFacts` 在现有合法候选过滤后，一次装配调用内回答 Map，再按原候选顺序读取。人工来源最后消息、第一条终态及其他单 Run API 保留；来源审计、准备快照、实际足迹、精确记忆依赖、材料实体与来源可用性继续按原规则校验。完整候选、连续安全后缀、预算、失效理由及输出顺序保持，无跨调用缓存。

未改协议、Schema、迁移、索引、算法版本、权限、UI 或 WM/MI 任务状态。契约补充位于 [memory-contracts §6.3](../development/memory-contracts.md)。

## 正反向验证

原单 Run 方法作为独立对照，比较真实 SQLite 中的完整事件与完整重放输出：

- 1,103 个 Run、反向请求、缺项与重复请求，返回 1,101 个回答，消费 2,204 条消息；空集合不查询，完整集合一次查询，按请求首见顺序返回。
- 两种 1,308 条消息深度样本覆盖长空尾和全空，完整消费及校验，不受 1,000 项限制。
- 九类损坏分别施加于回答与末端空消息，保持原报错语义；异常后追加新回答可再次读取。更早损坏消息和无关载荷不被消费。
- 五种重复 content 组合覆盖转义字段名、空与非空倒序、首项 null、NUL；完整答案与实际解码条数与原方法一致。
- 14 个真实历史 Run 的完整重放与原读取相等，跨 Task 和未来 Run 先过滤；下一次调用读取新增最终回答。预算外合法候选的损坏空消息仍使重放失败。

最初新增服务回归在旧实现上检出 14 次逐项读取。最终五个退化探针分别恢复逐 Run 回答读取、全局截为八项、跳过空消息校验、同名字段取首项、继续读取更早消息，检出 2、7、10、1、13 项失败；每次以 finally 恢复源文件字节。修正后核心 2 文件 / 49 项通过；恢复后阻断真实 Electron 导入的 changed functional 69 文件 / 784 项、heavy 2 文件 / 120 项通过，两档共 71 文件 / 904 项，核心不重复相加。lint、format:check、typecheck 和 build 退出 0；未启动完整 verify、UI、真实模型或安装态人工验收。

## 串行读取基准

2026-10-11 10:45 CST，darwin arm64 / Node v26.8.1，最终串行 bench 3 文件 / 4 项通过。新样本包含 256 个真实 Run、6,400 条窗口外旧消息，比较原生逐项方法与完整批量结果；一次预热、九次计时。

| 空消息尾部 | 查询次数 | 完整解码消息数（两者相同） | 消费消息 JSON 字节（两者相同） | 中位耗时 | p95 耗时 |
| --- | --- | --- | --- | --- | --- |
| 无空尾 | 256→1 | 256 | 60,562 | 2.56→0.85 ms | 2.61→2.08 ms |
| 各 Run 为 0/1/2 条 | 256→1 | 511 | 117,172 | 2.79→1.72 ms | 2.89→2.91 ms |

两组完整回答数组与原方法相等，输出均为 60,819 JSON 字节。消费字节按进入完整 Schema 的对象重新序列化计数，不是数据库 I/O；没有减少必需校验。混合空尾的 p95 基本持平，不能声称所有延迟指标都改善。递归结果及排序仍随实际消费窗口增长，不据此声称 RSS 降低、端到端收益或产品容量。

既有 E13 来源阶段查询保持 768→3，完整 1,536 行 / 1,261,860 字节相等，中位 19.98→9.75 ms；E6 样本保持目标解码 160 行，中位 22.48→2.06 ms。两者仅用于相关读取回归，不算 E14 新收益。

## 当前 checkout 依赖核对

用户要求按新增依赖执行 npm install。本次先安装、后核对的顺序不妥，已补查根目录及四个工作区的全部 dependency/dev/optional/peer 声明，均与锁文件一致。desktop 的 echarts 声明为 ^6.1.0，锁定及安装为 6.1.0；zrender@6.1.0 和两处 tslib@2.3.0 一致，Renderer ECharts 导入及新增运行时准备脚本存在。npm install 退出 0，声明与锁文件零差异；现有审计提示 12 moderate / 4 high 及 install-scripts 提示保留，不在 E14 自动升级或放宽脚本授权。以后安装前先检查声明、锁定和宿主要求。

## 后续范围

E14 完成 R10 的最终回答读取切片；材料实体检查、完整历史事实装配及成功向量路完整块映射仍有后续范围。来源证明不得以轻投影替代，也不得为了批量化跳过失效校验。最新 SHA 的 macOS PR Gate、合并及归档证据将在收口时追加。

## 远端门禁与合并交接

2026-10-11 10:55 CST，最终源 `03397d4a5e3662ea025cf12d995a97db63db8e62` 的 [Actions 38106364657](https://github.com/gyzhang/BetterWork/actions/runs/38106364657) 在 macos-26-arm64 上通过 PR Gate。lint、format:check、typecheck、docs:check 1/154、changed functional 69/784、heavy 2/120 成功，Full verify 跳过；三次调用合计 72 文件 / 1,058 项，不当作全仓或去重规模。首发源的成功门禁不代替本次最终源证据。

[PR #70](https://github.com/gyzhang/BetterWork/pull/70) 已 squash 为 main `455eafc42b4efbe3950d7e77fa2b06f79a530fac`，文件树与最终源一致。原 checkout 的 main/origin/main 对齐、工作树干净，代码分支本地及远端删除；合并后仍以原批次起点巡检，退出 0。纯 Markdown 分支 codex/e14-closeout 归档本节、总 Review 和日志，继续核对其最新源文档门禁及合并清理。

E14 代码与自动化收口；完整 verify、UI、真实模型、安装态及 WM/MI 人工验收保持原边界。下一项建议 E15：历史重放材料实体校验整理，保留精确版本与来源安全判据，另按用户指令开工。
