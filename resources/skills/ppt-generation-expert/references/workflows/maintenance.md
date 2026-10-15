# Skill 包维护手册

> 仅供 Skill 包作者和维护者使用。BetterWork 用户不需要照此安装 Python、pip 或手动选择解释器；运行环境由包内 runtime profile 与 BetterWork 管理的运行组件提供。

## 1. 模板接入（新公司模板，用户通知后执行）

1. 模板 pptx 放入 `assets/<公司>模板.pptx`
2. 从模板文件提取规范：色板（读"配色及辅助图形"页）、字体、字号阶梯、辅助图形、**可用版式清单与占位符几何**（决定标题禁入区与内容区起点）→ 写 `templates/<公司>.md` 档案（结构对照中电金信档案）
3. 上表登记一行

## 2. 环境与脚本

| 项 | 值 |
|---|---|
| 依赖 | 使用 Skill 锁定依赖对应的 Python 环境；外部 `ppt-master` checkout 通过 `PPTM_HOME` 显式指定，BetterWork 注入用户已绑定且校验过的快照，离线维护者可按本包声明的版本自行准备 checkout。**已校验基线：ppt-master `v6.6.0`（commit `680de11f`）**——本文档所有上游契约与资产计数以此版本为准；上游升级后按 §ppt-master 同步并重跑自检，再更新此处版本号。**仓库模式（2026-09-29 起，无需 fork）**：`$PPTM_HOME` 是源仓库 `https://github.com/hugohe3/ppt-master` 的普通 clone，`origin` 直连上游，同步即 `git pull`，**不做任何本地提交、不打本地补丁**；自持资产全部在 Skill 包内，pull 后运行 `selftest_e2e.py --suite all` 验证 |
| 外部服务 | 无 |
| 脚本 | `scripts/svg_native_export.py`（**三闸门**：配色/版式/几何→质检门→导出到调用方声明的输出路径）；`scripts/verify_layout.py`（**版式适配校验：文字⇄容器/标记空间冲突**，容器归属规则见 references/workflows/svg-authoring-and-quality-gates.md §2.8）；`scripts/verify_palette.py`（**配色合规校验：只允许 spec_lock 声明的色板**）；`scripts/verify_geometry.py`（**数据⇄几何一致性校验**）；`scripts/gatecheck.py`（**批次闸门隔离：建 `/tmp/gatecheck_<批次>/`，只拷 spec_lock + 本批页再跑三闸门，并行派工专用；`--batch` 无默认值、漏传即拒跑，命令落点见 `references/long-doc-deck.md §5`**）；`scripts/round_accent_strips.py`（**边缘装饰条→跟随宿主圆角的贴边 path**，批量改写）；`scripts/native_table_inject.py`（**原生可编辑表格注入**，客户可双击改数）；`scripts/merge_into_template.py`（移植进模板版式；**两阶段**：先建全部页再移植，含同册跳转重映射，见 references/workflows/delivery.md §4.6）；`scripts/validate_pptx.py`（交付前校验门）。**无 LibreOffice 时的替代核验见 references/workflows/svg-authoring-and-quality-gates.md §2.8**。上游配套：`$PPTM_HOME/skills/ppt-master/scripts/svg_position_calculator.py`（值→坐标几何计算，禁止手算）· `visualization_recall.py validate`（选型机械校验，拒幻名）· `icon_sync.py`（图标同步） |
| 自检 | `tests/selftest_e2e.py`（端到端回归基线，**ppt-master 每次 pull 后必跑**） |
| 解释器路径 | 作者自检使用当前已准备的 Skill Python 环境；脚本通过 `sys.executable` 和显式 `PPTM_HOME` 定位运行时资源，不依赖作者机器的解释器或工具链绝对路径 |

### 2.1 自检（回归基线）

```bash
env -u PYTHONPATH PPTM_HOME=/path/to/ppt-master python3 tests/selftest_e2e.py --suite all
```

配套**文档一致性审计**（上游每次升级后与自检一起跑，退出码非 0 即有漂移）：

```bash
env -u PYTHONPATH PPTM_HOME=/path/to/ppt-master python3 scripts/audit_consistency.py
```

它核对：上游版本、六类资产计数（charts/tables/icons/styles/layouts/brands）、本 skill 脚本与骨架、自检套件数、同步模式与文档指引一致性、上游文件原样性（radar 未打本地补丁）、7 个上游依赖脚本、以及全部文档（`references/` 各册 + 本文 + 模板档案）的上游路径引用。

覆盖 `init → 写页 → 导出 → merge → 校验` 全链路，十套件共 **118 项**断言：

| 套件 | 覆盖 |
|---|---|
| `mainline` | `quality_gate=passed`、`<p:pic>=0`、**原生分组数>0 且分组名与 SVG 的 g id 一一对应**、页数、标题占位符、版式名存在性、`validate_pptx` 零问题 |
| `lockless` | 「缺 spec_lock 自动生成」便捷路径的默认值合规（BCP-47 / consumption_mode / colors 标准块 / 无残留 `[fill]`） |
| `skeletons` | **声明即存在**：`chart/`(33) `table/`(6) `diagram/`(8) 全部存在、过上游选型校验器、8 个自持骨架整体过质检门；**图册 `charts-atlas.md` 的 47 个裸 key 一并校验**，并强制三份文档的 key 集合完全一致（2026-09-29 修：此前图册因用裸 key 名而完全绕过自检）；**三份叙事风格包点名的骨架／脚本／skill 内路径／章节引用全部可解析**（同批修复：风格包此前同样零覆盖，`chart/comparison_matrix` 幻名因此存活至今） |
| `geometry` | **几何一致性双向验证**：阳性须通过；**注入「改数未重算几何」的页面必须被判失败**（守卫要有牙齿）；带标记的页面仍过质检门 |
| `layout` | **版式适配双向验证**：合规夹具通过；注入四类空间冲突（`layout_defect.svg`：标签压条 / 文字出框 / 文字互撞 / 装饰条戳出圆角）必须全被判失败且给出修法；**移除缺陷页后须恢复退出码 0**；含冲突的工作区被导出闸门拒绝 |
| `palette` | **配色合规双向验证**：色板内页面通过；注入色板外颜色（`palette_defect.svg`：琥珀 `#EF9F27`）必须被判失败并报出具体色值；移除后恢复 0；越板页被导出闸门拒绝。**另锁批次闸门隔离 `gatecheck.py`**（把 `long-doc-deck.md §5` 的人工变异验证沉为断言）：同目录里有别人的坏页时只验本批好页须通过、本批输出不得出现别人的页名、点名坏页须失败并原样报色值、**漏传 `--batch` 须拒跑**（exit 2）、页名模式打不中任何页须拒跑（防验了个空目录却报全绿） |
| `table` | **原生表格注入**：留白页 → 导出 → merge → 注入全链路；断言产出真 `graphicFrame + a:tbl`、**已关掉 python-pptx 默认蓝色主题**（No Style, No Grid）、行数/列宽按声明落位、表格用色落在色板内、`validate_pptx` 零问题 |
| `hyperlink` | **原生超链接**：同册跳转 + 外部链接穿过 merge 仍可点；断言**包内无重名条目**、跳转指向宿主册对应页、`hlinkClick` 落到原生、`validate_pptx` 零问题（锁 2026-09-28 修复的包污染坑，见 references/workflows/delivery.md §4.6） |
| `recolour` | **骨架换色**：39 个上游骨架经 `recolour_skeleton.py` 后**用色全部收敛到色板内**（锁 2026-09-29 实测的「39/39 骨架全部越板」坑）；并断言显式语义映射表仍命中上游高频色（上游换色系时会在此报警） |
| `discipline` | **文档写作纪律**：把 `doc-writing-discipline.md` 变成可执行项——SSOT 登记表登记的事实源位置真实存在、全部跨文档章节引用指向真实章节、**无裸引用**（缺文档名的「见 §N」会悬空且无法校验）、L2/L3 未脱离指向复述 L0 数值档位、每份参考文档都在资产索引登记（2026-09-29 立，防最后一类漂移） |

退出码 0 = 全绿。`--keep` 保留临时工作区排查。


## 3. 资产索引

- `templates/中电金信.md`：已注册模板档案（色板/字号/版式/坐标唯一事实源）；新公司模板档案照此结构建
- `references/svg-native-guide.md`：SVG 语法合同/编码技巧/导出合并手册
- `references/styles/`：**3 套完整风格包**（operating-review / mbb-consulting / duty-manual，含页序模板与落地裁决）；另 2 套（consulting-decision / investor-pitch）内联在 `styles-playbook.md §3`/§4——合计 5 套，与上游 14 套 styles 的对应关系见下条
- `references/charts-atlas.md`：**47 个骨架的可视化选型索引**（key → 一句话适用 + 视觉特征 + 图册位置）；配 `assets/atlas/*.png` 对照图册——**选型时先看图册再回本文档读规则**，可显著降低选错率
- `references/charts-library.md`：**图形选型总指南**——`chart/` 33 个 + `table/` 6 个的选型表、取用流程、几何计算器用法、原生 chart 路由
- `references/diagrams-library.md`：**本 skill 自持 8 个关系/结构图骨架**（org/flow/network/timeline/milestone/roadmap/project_schedule/pyramid）的逐类指引与互斥边界
- `references/styles-playbook.md`：consulting-decision / investor-pitch 叙事方法论（另 9 套 styles 速查，见其 §6）；2 套内联 + 9 套速查 + 3 套完整包 = 上游 14 套全覆盖
- `references/long-doc-deck.md`：**长文档 → 大册（≥40 页）派工手册**——`_digest/` 每章十段字段模板（含「数值／口径／时点／来源／证据级别」五字段行）、`_plan.md` 派工单三块与页面条目格式、批次子代理的四项输入与产出边界、`gatecheck.py` 闸门隔离与变异验证记录、`pages.json` 与演讲者备注的页序契约。判据与入口在 `references/long-doc-deck.md §1`，本文管模板全文
- `references/doc-writing-discipline.md`：**本 skill 自身的文档养护规程**——事实源四层分级（L0 档案/spec_lock > L1 本文件 > L2 手册 > L3 风格包）、六条硬纪律（数值只在 L0 落一次 / 规则只详写一次 / 引用必须带文档名 / 新文档必进校验范围 / key 写全名 / 改动必留痕）、SSOT 登记表、变更养护清单。由自检套件 `discipline` 机械校验。**改任何文档前先读它**
- `scripts/`：svg_native_export.py（**三闸门**）/ verify_palette.py / verify_layout.py / verify_geometry.py / **gatecheck.py**（批次闸门隔离：并行派工专用，见 `references/long-doc-deck.md §1`）/ round_accent_strips.py / native_chart_inject.py / native_table_inject.py / embed_images_inject.py / merge_into_template.py / validate_pptx.py / **recolour_skeleton.py**（骨架换色：上游配色 → 公司色板，取骨架第一步）/ **audit_consistency.py**（文档↔磁盘↔ppt-master 一致性审计，**上游每次升级后必跑**，见下节）
- `assets/`：已注册模板 pptx；`assets/diagrams/`：8 个关系/结构图骨架 SVG（边缘装饰条已统一为跟随宿主圆角的贴边 path）；`assets/atlas/`：9 张骨架对照图册 PNG
- `tests/`：selftest_e2e.py 端到端回归基线（十套件 118 项）+ fixtures/（2 页合规夹具、留白表格页 `t03`、超链接夹具 `h01`/`h02`、pages.json、两份 spec_lock 样板、`layout_clean.svg` / `layout_defect.svg` 版式校验对照夹具）
- ppt-master 外部资产（`$PPTM_HOME/skills/ppt-master/`）：图表骨架 `templates/charts/`(33) · 表格骨架 `templates/tables/`(6) · 图标库 `templates/icons/`(12027)——五库明细与取用契约见 references/workflows/svg-authoring-and-quality-gates.md §2.4.4 · 叙事 styles `templates/styles/`(14 套 + 索引) · 结构版式 `templates/layouts/`(7 族) · 品牌系统 `templates/brands/`(21) · 几何计算器 `scripts/svg_position_calculator.py` · 选型校验器 `scripts/visualization_recall.py`
  - ⚠️ `templates/brands/` 是**品牌风格模板**（每家仅一个 `templates/design_spec.md`，描述该品牌的配色气质），**不是 logo 库**；真实品牌 mark 在图标库的 simple-icons 子集（3675 枚，见 references/workflows/svg-authoring-and-quality-gates.md §2.4.4），按该节第 5 条只用于真实品牌/技术栈标识


## 4. ppt-master 同步（pull 前后必看）

**约定（2026-09-29 定版）：不 fork、不打本地补丁、不做本地提交。** `$PPTM_HOME` 是源仓库 `https://github.com/hugohe3/ppt-master` 的普通 clone，远程直连上游源仓库（clone 后默认名为 origin），同步就是 `git pull`——仓库脏了随时 `rm -rf` 重 clone，**我们没有任何东西只存在于仓库里**（自持资产全部在 skill 内）。

radar_chart 形状版补丁同样已弃用：§2.4.3 把「删 `data-pptx-replace-with` marker」升级为所有 chart 骨架的通用三步之一，仓库保持上游原样（radar 带原生 marker），形状版由三步转换按需产出。

**同步流程（每次上游升级）**：

```bash
cd $PPTM_HOME && git pull           # 远程直连 hugohe3，一把梭
env -u PYTHONPATH PPTM_HOME=/path/to/ppt-master python3 tests/selftest_e2e.py --suite all
env -u PYTHONPATH PPTM_HOME=/path/to/ppt-master python3 scripts/audit_consistency.py
```

> **给分发对象的零配置承诺**：同事只需 ① clone 上游仓库、② 装 python-pptx、③ 把本 skill 装进 WorkBuddy——无需任何 GitHub fork 或权限。

同步后**必跑自检**——上游质检器（checker）每次升级都可能新增拒绝项，只有自检能暴露。

### 4.1 v6.5.0 / v6.6.0 升级要点（2026-09-28 接入）

上游这两个版本主要动了四处，**与我们相关的只有两处**：

| 上游变化 | 对我们 | 处置 |
|---|---|---|
| **原生超链接契约**（`<a href="#slide-N">` → 原生 `hlinkClick`）+ checker 新增超链接锚点比对 | 新能力 | **已引入**：§4.6 + `hyperlink` 回归套件；顺带修掉 merge 的包污染坑 |
| `font_advances.json` +3682 行（Segoe UI/Cambria/Trebuchet/Tahoma/Garamond 度量）、Unicode 固定宽度空格、重音字母 fallback | 上游文字度量更准 | **未引入**：`font_advances` 无 Microsoft YaHei，中文仍走 `verify_layout.py` 自有度量；混排西文的理论收益小于耦合成本 |
| `spec_review` 浏览器评审面（design_spec 评审走网页） | 交互范式 | **未引入**：本 skill 不走 design_spec 全流程；但其「AI 起服务 + 用户可视化评审」思路可用于日后做校验报告评审页 |
| `--kiosk` 循环放映、`beautify_inventory --verify`、edit-native 增强、`slice_images` 容差重试 | 边缘 | 未引入；展台循环放映如真需要，透传 `--kiosk` 即可 |

**已确认不受影响**：我们依赖的 `project_manager.py` / `svg_position_calculator.py` / `visualization_recall.py` / `icon_sync.py` 在这 70 个 commit 里**零改动**；`templates/charts/`（33 骨架）与 `templates/tables/`（6 骨架）也零改动——所以 `skeletons` 套件仍全绿。
