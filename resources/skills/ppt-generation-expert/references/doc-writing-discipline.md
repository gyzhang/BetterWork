# 文档写作纪律（本 skill 自身的养护规程）

> 这份文档不参与 PPT 生成，它是**本 skill 的内部宪法**：规定规则写在哪一层、怎么互相引用、改了之后要同步什么。
> 立文起因：2026-09-29 三轮通读审出 18 处前后不一致，根因全部是"同一规则在多份文档各抄一遍 + 引用不校验"，而非能力缺失。

## 1. 事实源四层（谁说了算）

| 层 | 文档 | 承载什么 | 什么时候改 |
|---|---|---|---|
| **L0 硬事实** | `templates/<公司>.md`（档案）、`spec_lock.md` | 色值、字号档位、坐标阈值、版式名 | 换模板 / 换 design spec 时一次性定 |
| **L1 入口** | SKILL.md | 常驻范围、执行主线、不可违背的短约束、精确资源路由 | 调整触发范围或加载结构时 |
| **L2 手册** | references/*.md（含 references/workflows/） | 按阶段加载的操作步骤、SVG/交付/维护细则、图形选型 | 补新手法或拆分操作手册时 |
| **L3 风格包** | references/styles/duty-manual.md、references/styles/mbb-consulting.md、references/styles/operating-review.md | 叙事裁决（页序 / 标题形态 / 落地映射） | 接新叙事风格时 |

**裁决顺序 L0 > L1 > L2 > L3。** 低层**不得**改写、稀释或另行解释高层事实——只能**指向**。发现低层与高层冲突时，一律改低层，不允许在两侧各写一套"调和说明"。

## 2. 六条硬纪律

1. **数值只在 L0 落一次。** 禁止在 L1/L2/L3 复述色值、字号档位、坐标阈值。需要提及时写 `见 <文档> §N`，不重抄数字。
   *唯一例外*：风格包的「上游默认 → 本管线取值」映射表可以出现取值（它的职责就是映射），但必须在同一节写明 `色板唯一事实源 = spec_lock.md` / `档案 §N`。
2. **规则只在最低需要它的那一层详写一次。** 上层保留"判据 + 指向"，下层保留"为什么 + 怎么做"。同一规则在两处都用完整句式写全 = 缺陷。
3. **跨文档引用必须写 `<文档名> §<章节号>`。** 禁止裸 `见 §2.4`（无法判定指向哪份文档），禁止只给文件名不带章节。
4. **新文档必须进校验范围。** 新增 `references/` 下任何文档，同步做两件事：① 登记到 SKILL.md 资产索引；② 确认它被某个自检套件覆盖（至少要有"声明即存在"级的引用解析）。**styles 三份包零覆盖导致 `chart/comparison_matrix` 幻名存活数月，这是最贵的一条教训。**
5. **骨架 key 一律写全 `<域>/<key>`。** 禁止裸 key（图册曾用裸名，因而完全绕过存在性校验）。
6. **改动必须留痕。** 每次修订更新 SKILL.md 的 `version:`，并在当日工作日志记一行改了什么。禁止静默改文档。

## 3. 引用格式速查

| 要指向的对象 | 规范写法 | 校验方式 |
|---|---|---|
| 模板档案章节 | `档案 §4`（等价于 `templates/中电金信.md §4`） | 必须命中档案的 `## N.` |
| 工作流参考章节 | 各 reference 文件中的编号章节 | 使用准确文件名与真实章节号；必须命中对应文件中的编号标题 |
| 其他参考文档 | `` `charts-library.md §3` `` | 必须命中该文件的 `## N` |
| 某一层 | `先补进去再指向` — 先在一处写全，再让别处指向它 | — |

**明令禁止的四种写法**：`见 §2.4`（缺文档名）· `见 SKILL.md`（缺章节，SKILL 主入口较短，正文按资源索引加载）· `档案 §2` 与 `见模板档案 §2` 与 `见档案 §2` 混用（同一对象统一叫 `档案`）· `中电金信 §10`（档案不是按公司名索引的）。

**最后一层保障**：`spec_lock.md` 与 `templates/<公司>.md` 里的色值与坐标由 `verify_palette.py` / `verify_layout.py` **机械执行**——这类事实不需要任何文档再解释一遍，写错也会被闸门挡下。纪律要管的，是闸门管不到的那些口径。

## 4. SSOT 登记表（每条规则在哪一处落定）

| 规则 | 唯一事实源 | 其余文档应写成 |
|---|---|---|
| 色值与色板 | `spec_lock.md` `## colors` · 档案 §2 | 风格包内映射表（带指向），其余指向 |
| 字号档位 | `spec_lock.md` `## typography` · 档案 §4 | 只写"下限 13px，口径见 `spec_lock`"，不重抄档位串 |

**字号口径的仲裁规则**（唯一说明处，三份风格包均指向本节）：`spec_lock.md` `## typography` 声明的是**角色值**（13 辅助注释 / 14 正文 / 16 节点与小标题 / 21 强调 / 22 大数字 / 24 卡片标题），档案 §4 另有一张母版 **pt→px 档位表**（16/21/24/27/32/37/59）。两者口径不同，**遇冲突一律按 spec_lock 角色值执行**，并复核 spec_lock 里是否已声明该角色。硬约束：**下限 13px，禁止 11~12px**；密度不足时删内容或减模块，不缩字号。
| 布局坐标 / 标题禁入区 | 档案 §6 | references/workflows/svg-authoring-and-quality-gates.md §2.6 / §2.8 引用 |
| 版式名 | 档案 §10 | pages.json 示例 |
| 三闸门判据 | references/workflows/svg-authoring-and-quality-gates.md §2.4~§2.8 + 闸门脚本 | delivery.md §3 指向 |
| 骨架清单 | 上游 `charts/` `tables/` + `assets/diagrams/` | 三份库/图册/风格包一律全名引用 |
| 装饰条圆角 | references/workflows/svg-authoring-and-quality-gates.md §2.9 | SVG guide（公式）、L5 表格（判据）、排障（修法）三处只指向 |
| 骨架三步转换 | references/workflows/svg-authoring-and-quality-gates.md §2.4 | charts-library.md §3 指向 |
| 图标契约 | references/workflows/svg-authoring-and-quality-gates.md §2.4.4 + 上游 icons/README.md | SVG guide 指向 |
| 叙事裁决 | 各风格包 §6 | playbook §2 只做汇总 + 混用禁令 |

> \* 这张表是**机械可校验**的：自检套件 `discipline` 会逐行解析它，确认每个事实源位置真实存在。

## 5. 变更养护清单

| 改了这个 | 必须同步 | 必须跑 |
|---|---|---|
| `templates/<公司>.md` 章节增删或改标题 | 全库搜 `档案 §N` 引用（含本表第 4 节登记项） | `discipline` 套件 |
| 工作流手册章节增删 | 全库搜对应 references/workflows/<topic>.md §N 引用 | discipline 套件 |
| `spec_lock` 色板或字号 | 三份风格包 §6 映射表、`recolour_skeleton.py` 的语义映射表 | `recolour` 套件 |
| 上游骨架增删 / 改名 | charts-library、charts-atlas、风格包页序表三处 key | `skeletons` 套件 |
| 新增 references 文档 | SKILL.md 资源索引 + 进某个套件 | discipline 套件 |
| 脚本参数或提示文案变更 | references/workflows/maintenance.md §2 脚本清单、含该命令的手册 | audit_consistency.py |
| ppt-master 升级 | references/workflows/maintenance.md §4 版本与同步记录 | audit_consistency.py + --suite all |

**交付前两条命令**（每次文档改动都要跑，不跑视为未完成）：

```bash
env -u PYTHONPATH PPTM_HOME=/path/to/ppt-master python3 tests/selftest_e2e.py --suite discipline
env -u PYTHONPATH PPTM_HOME=/path/to/ppt-master python3 scripts/audit_consistency.py
```

## 6. 漂移的六个已知诱因（已各配防线）

| # | 诱因 | 实例 | 现有防线 |
|---|---|---|---|
| 1 | 抄一遍而非指向 | 字号档位在 6 份文档各写一套（其中 3 套不同） | 本纪律 §2.1 + `discipline` 套件的数值复述检测 |
| 2 | 章节号引用不校验 | `档案 §3`（字体）被当成字号章节引用了数月 | `discipline` 套件解析全部 `档案/SKILL.md/xxx.md §N` |
| 3 | 裸 key 绕过正则 | 图册用裸名，`selftest` 完全看不见 | `skeletons` 套件纳入图册 + 强制三处集合一致 |
| 4 | 新文档不入校验范围 | styles 三份包零覆盖，幻名存活数月 | `skeletons` 套件纳入风格包的四类引用 |
| 5 | 断言从未反向验证 | 第一版风格包断言缺右侧反引号，`key_ZZZ` 被截成存在的 `key` | 本纪律 §7（新增断言必须注入缺陷自测） |
| 6 | 提示文案与实现脱节 | `--skip-verify` 实际跳三项，提示只说两项 | 文案改动纳入 §5 养护清单 |

## 7. 给维护者的两条自诫

**① 新断言必须反向注入验证。** 写完任何断言后，手动注入一处它应该抓住的缺陷，确认它真的 FAIL；通过后再还原。**未做这一步的断言不算防线**——2026-09-29 的风格包断言第一版就是反例，它全绿但实际什么都没检查。

**② 修文档优先"收敛"而非"增补"。** 发现两处冲突时，第一选择是把其中一处改成指向；第二选择才是写一段"两者如何调和"的解释。**解释型增补是漂移的温床**——它会让第三条发生时更难分辨谁说了算。
