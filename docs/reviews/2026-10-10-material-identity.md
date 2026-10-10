# E4：材料身份判定整理（R11）

记录时间：2026-10-10 17:32 CST。用户授权区分列表身份、精确版本相等和持久化指纹；从干净 main `2eeeb8f197b2857c3570bb53c6496efbfda4a852` 建立 `codex/e4-material-identity`，沿用原 checkout，不新建 worktree。

## 语义与实施

| 规则 | 实际用途 | 必须保留的差别 |
| --- | --- | --- |
| materialListIdentity | Main/Renderer 的选择去重、候选匹配、工具结果的选定项定位、材料段与记忆召回键 | kind + 修订/版本/快照 ID，不能证明哈希或空间相等。 |
| sameMaterialVersion | 读取足迹、成果/输入快照的声明范围、定时精确合并 | 知识完整字段含可选 originWorkspaceId；成果含归属空间；输入含 workspaceId、hash、format、fileKey，原始展示路径不参与读取身份。 |
| materialReferenceFingerprint | 现有足迹写入/重复消费、声明去重、定时读取/采用计数、连续性完整引用比较 | 严格 Schema 固定字段顺序，保存全部引用字段；包括知识来源空间和输入原始路径，可选字段省略与 undefined 等价。 |

三条纯规则定义在现有 agent-protocol 导出入口，不引入新 package、宿主依赖或通用 equals。材料契约 §2.1.1 是语义真相源，文件、数据库、来源归属和全局显式入口仍由 Main 验证。

知识旧兼容比较 sameKnowledgeReference 继续用于原知识工具、定时合并与声明范围，不含可选来源空间；足迹保存与正文审计保持完整快照比较，没有删除原来源空间检查。定时来源准备按 documentId / artifactVersionId / snapshotId 检查冲突，来源与补充合并按 documentId / artifactId / snapshotId 检查冲突，两处分别具名，保留其原策略。记忆来源依赖键改名为 materialDependencyIdentity，原有去掉 sourcePath 的排序投影保持；召回列表键与此投影不混用。连续性仍比较完整审计引用，不因列表 ID 相同而放行。

JSON 格式、material_key 的两种历史写入方式、唯一索引与定时清单哈希保持，没有 schema 迁移或历史数据重写。非知识正文足迹查询改为类型化引用，在同 Run、内容哈希和 read/parse 范围内解析已存 JSON，按精确版本判断；解决字段顺序或输入展示路径不同造成的误拒绝，非法历史 JSON 不能证明已读。新版知识同 toolCall/part 的重复消费用完整指纹核验材料，其余组内审计字段仍逐项校验。

专家整份配置变化判断、定时整份配置比较、操作幂等输入哈希、提示词序列化和原始清单哈希分别承载完整记录/顺序语义，未机械替换成材料身份函数。E3 的资产校验三元组缓存仍只用于单次候选调用，不承担材料身份或权限。

## 本地证据与 Review

- 2026-10-10 定向 functional 17 文件 / 240 项，知识管理 Hook 另跑 1 文件 / 29 项，heavy 2 文件 / 148 项（RunService 与 App）通过，按三次调用合计 20 文件 / 417 项；恢复后核心身份/足迹/定时 3 文件 / 36 项再次通过，单列不重复加总。
- 纯函数覆盖三种材料的同 ID 不同 hash、同内容不同空间、kind/父实体/版本/格式/fileKey/sourcePath 差异、可选字段省略、反向字段顺序、完整指纹字段与历史知识比较。真实 SQLite 覆盖重复写入、精确范围拒绝、其他 Run、历史 JSON 顺序、输入展示路径省略、损坏 JSON、search 摘要不算正文；声明集成回归验证展示路径差异可采用但 workspace/hash/format/fileKey 伪造仍拒绝。
- 临时把精确比较退化为列表 ID 比较后，2 文件中 16 项准确失败（退出 1），源码在 finally 恢复；恢复后回归通过。反例日志 `/tmp/betterwork-e4-identity-probe.log` 不提交，不作为绿跑。
- typecheck、定向 ESLint/Prettier、生产 build 退出 0。app-only 一组通过：真实 App、生产 Preload/IPC、临时 SQLite，4 个普通 Run、失败/取消及窗口销毁后重装配恢复；网络尝试 0，定时 paused、实例 0。AI 已查看首期和重开截图，读数目录 `/var/folders/kq/ts17kvnd5yg2kjtkx645y1zw0000gn/T/betterwork-ui-render-i9oWqH`。
- Review 对照原比较字段、旧知识分支、持久化 JSON/唯一索引/清单哈希和全部消费方；没有把列表键升级为授权依据，没有删除审计字段。新增回归先遇到测试工厂返回联合类型未收窄，已显式检查知识分支；初次整理漏掉定时仓储的一处函数引用，已修正。最终类型与检查通过，没有放宽规范或例外。
- 2026-10-10 docs:check 154 项通过；以原批次基点 drift:check --save 留档，静态读数 254 文件 / 2216 个粗读用例，护栏 154、例外 203 与规则指纹保持，未发现漂移。该静态读数不是展开参数化用例后的运行结果。

macOS 最新源 SHA 的 PR Gate、合并与归档待收口；完整 verify、全 UI 矩阵、OS 进程恢复、真实模型与安装态人工验收未执行。本批只完成 R11 材料身份整理；R10 其他读取路径与 R09 协议文件规模等后续范围不自动开工。
