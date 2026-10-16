# 导出、合并、交付与硬规则

> 进入导出、模板合并、特殊原生注入或交付验收阶段时加载；只需要普通生成时不要预先读完本文件。BetterWork 运行时只通过当前 Skill manifest 声明的命令执行；下列终端命令是作者离线核验示例，不要直接要求用户运行。

### 3. 质检 + 导出

BetterWork 中用 `skill_execute` 调用 `svg-export`，并传入 `project-init` 本次返回的项目目录。缺 `spec_lock.md` 时会自动按模板生成；**导出前强制跑三道本 Skill 闸门**（配色 §2.7 + 版式适配 §2.6 + 数据几何 §2.5），任一不过即拒绝并打印诊断；随后上游 final 质检不过也拒绝导出。失败时读取本次命令返回的 stdout/stderr 与实际返回的报告路径；如果自动 `scaffold-lock` 失败，按 `spec-lock-fallback.md` 处理。每次执行使用新的 attempt 目录，只用本次返回的路径和 output id；不要猜报告路径或原样重跑。验收：`<p:pic>`=0、`<p:sp>`=元素数、POSTFLIGHT `quality_gate=passed`。

**导出顺序不可颠倒（2026-09-16 上游新增状态机）**：`quality_gate` 取值 `passed / stale / failed / unverified / not-provided / non-final`，判定含 `source_match` **指纹比对**——质检报告必须与当前 authoring-SVG 指纹匹配。因此必须**先跑质检、再导出**；若中途改了 `svg_output/` 里的 SVG 又直接导出，会拿到 `stale`（报告与源不符），此时重跑 `svg_native_export.py` 即可恢复。`[POSTFLIGHT][WARNING] quality_introduced_warnings=N` 是导出引入的告警计数，已知良好项目也会带，**不阻塞交付**；只要 `quality_gate=passed` 即视为通过。

### 4. 合入公司模板

pages.json 契约（脚本级，模板无关）：逐页 `layout`（版式名）、`title`（写入版式 title 占位符）、`tag`（标题后小字）、`subtitle`（封面副标题）、`src`（源文件页索引 0-based，null=纯版式页）；顶层 `"drop_host_slides": true` 清模板示例页。版式取值见模板档案（中电金信示例在档案 §10）。

BetterWork 中以本次 `svg-export` 返回的源 PPTX 路径调用 `template-merge`，`template_path` 使用 `assets/中电金信模板.pptx`。quick-generate 不会创建 `pages.json`；根据最终页序、版式占位符与 SVG 导出结果，先用 `task_write_file` 创建最终清单，再把路径传给 `template-merge`。只有需要核对时，才在工具确认写入成功后调用 `read_text_file`。创建失败时先修复创建步骤，不要读取尚不存在的预期路径。

### 4.5 注入原生图表与受控图片（B 路线，merge 后、validate 前）

本节展示的是包内离线脚本接口。当前 BetterWork manifest 未声明这些注入命令；只有当前 Run 明确提供相应已绑定能力时才可执行。否则不要尝试 shell/Python 命令，也不要将本节承诺为可交付功能；说明当前运行不支持该注入路线。

**原生可编辑图表**（客户可双击改数据，内嵌 xlsx 自动挂载）：SVG 在图表区**留白**（不画任何形状），数据与几何写 `projects/<name>/native_charts.json`，然后：

```bash
python3 scripts/native_chart_inject.py <最终.pptx> <project_dir>
```

schema 见脚本 docstring。要点：type 支持 column/bar/line/area/pie/doughnut/**radar/radar_filled**（radar 2026-09-08 起支持——此前禁用；LibreOffice 对 radar 中文类别标签渲染失真，**radar 页交付必须由用户在真 PowerPoint 手工验证**，LibreOffice 目检只确认几何/颜色/系列存在）；bar 类别自下而上排列，想"安全治理在最上"就把它放数组末位；radar 类别自顶部顺时针排列；radar 系列默认线+标记，系列加 `"fill": true` 变填充式（fill_alpha 默认 40%）；多系列 bar 用 `overlap` 负值分组。何时用原生图表 vs SVG 形状图表：**给客户演示且数据可能被客户复用改数 → 原生；纯视觉叙事/装饰性图形 → SVG 形状**。

**原生可编辑表格**（客户可双击单元格改数，这个场景用 SVG 形状表就交付不了）：SVG 在表格区**留白**，数据与几何写 `projects/<name>/native_tables.json`，然后：

```bash
python3 scripts/native_table_inject.py <最终.pptx> <project_dir>
```

schema 见脚本 docstring（列宽/行高/表头/斑马行/逐列对齐/首列加粗/强调列/细线色）。**两个必读要点**：① python-pptx 默认表格样式是**蓝色主题**，会引入色板外颜色——本脚本强制改写成 `No Style, No Grid` 并逐格显式设填充，配色完全可控；② SVG px→pt 换算是 **×0.75**（14px = 10.5pt），与导出器一致。**何时用原生表格 vs SVG 形状表**：交出去要给别人改数 → 原生；纯汇报/视觉叙事 → SVG 形状（可控性更强）。

**受控证据图片**：用户维护 `可插入图片/` 目录（人工审核、命名 `P{页码}-{用途}-{描述}.png`），声明写 `projects/<name>/embed_images.json`，然后：

```bash
python3 scripts/embed_images_inject.py <最终.pptx> <project_dir> [--strict]
```

缺图警告跳过不阻塞；`p:pic` 仅允许来自该白名单（铁律 12）。

### 4.6 原生超链接（目录跳转 / 导航按钮 / 外部引用）

需要**可点击**的跳转时（目录页跳章节、附录回正文、引用外部文档），在 SVG 里直接写标准 `<a href>`，上游导出为 PowerPoint 原生 `hlinkClick`，merge 后仍可点：

| 意图 | 写法 |
|---|---|
| 整对象（按钮/卡片/图标） | `<a href="#slide-3"><g id="nav-btn" data-pptx-bounds="...">…</g></a>` |
| 行内文字 | `<text>参见 <a href="https://…"><tspan>产品指南</tspan></a>。</text>` |
| 同册跳转 | `href="#slide-N"`，**N 是 svg_output 页序（源册）的 1-based 页码**——上游按作者页序解释、merge 按宿主映射重写指向（2026-09-29 测试片实测：写"最终册页码"会整体偏移纯版式页数） |
| 外部链接 | 完整 URI（带 scheme），禁止相对路径 / `file:` / `data:` |

**merge 环节的关键处理（2026-09-28 修复，勿回退）**：同册跳转在源 pptx 里是**指向 slide 部件的内部关系**。若按常规 `relate_to(源页部件)` 处理，python-pptx 会把源 pptx 那一页连同它的 layout/master/theme 一起复制进目标包，产生 `ppt/slides/slideN.xml` 等重名条目，**PowerPoint 打开必报"修复"**。因此 `merge_into_template.py` 改为**两阶段**（先建全部页 → 再移植），并按「源页部件 → 宿主页部件」映射重映射跳转；**目标页未进入本册时移除该跳转并告警**，绝不留下悬空关系。

约束与纪律：

- 跳转目标必须是**本册实际存在的页**；`pages.json` 里 `src: null` 的纯版式页也算一页，页码按最终册算
- 外部 URL 必须是用户/来源给定的**真实地址**——未知目标不得编造、不得用搜索结果顶替（数据纪律，铁律 7）
- 不支持：鼠标悬停链接、自定义放映、首尾/上下页导航按钮、宏与 OLE 动作
- 一个锚点包住单个顶层 `<g>` 时该组仍是页面的顶层单元与动画锚点；但**带超链接的组不能同时是交互 `trigger_shape`**

### 5. 交付校验

- **必跑** BetterWork manifest 中的 `pptx-validate`，传入模板合并后的最终 PPTX 路径。它检查 10 类修复触发点（`zip`/`xml`/`ct`/`rels`/`rid`/`pres`/`lay`/`shp`/`media`/`num`），**0 问题才登记成果**；另核对页数、文件大小、导出产物 pic=0
- **必跑渲染目检**（铁律 9）：LibreOffice 转 PDF → pymupdf 渲染逐页过目（核颜色串位/几何）；**中文与溢出改用 pymupdf 直读源 SVG 渲染核对**（本机 LibreOffice 会丢全部 CJK，见铁律 9）
- `cp` 到中文交付目录 → `open` 预览；报告写入页、校验结果、路径


## 6. 铁律（血泪教训，违反必翻车）

1. **管线指纹与风格延续**：svg_to_pptx 产物形状命名指纹是 `Rectangle N / TextBox N` 序列化命名。延续既有页面风格时查 `$PPTM_HOME/projects/` 找源项目工作区，**克隆其 spec_lock**（字号阶梯/色板/图标池）保证同源。
2. **自写移植/拷贝形状代码必须遵守 migrate_shapes 三加固**：① 剥离 `p:custDataLst`（tag 部件不随形状移植，残留 r:id 悬空引用必触发 PowerPoint 修复，WPS/预览器宽容故难察觉）；② 重映射**全部** `r:` 命名空间属性（embed/link/id/dm/lo/qs/cs/pict，外部关系走 `get_or_add_ext_rel`）；③ shape id 重编号。（2026-09-06 实证）
3. **保留原件部分页的移植法**：merge_into_template.py 只向空模板追加，不支持"新页+原件区间"混排——先 merge 新页册，再用 python-pptx 逐页移植原件区间（`add_slide(同名版式)` → `drop_empty_placeholders` → 复用 `migrate_shapes` 深拷贝 spTree → 恢复有内容的备注）。参考：`$PPTM_HOME/projects/gienwork_integration_ppt169_20260906/transplant_original.py`。
4. **导出/合并的解释器纪律**：Run 内 Python 与依赖由 BetterWork 受管运行组件按包内锁提供，**不要直接启动系统 Python、写死解释器绝对路径或让用户自行 pip install**（见 `SKILL.md`「BetterWork 执行契约」）；作者离线核验用的解释器与环境准备见 `references/workflows/maintenance.md §2`。导出脚本内置 PYTHONPATH 剥离防御（宿主会话会经 PYTHONPATH 注入沙箱 shim 令打包报 mkdir EEXIST，2026-09-07 实测），手动兜底 `env -u PYTHONPATH`。
5. **头带 path 几何**（白卡 rx12 顶部彩色头带，防左下角突出尖角）：`<path d="M{x} {y+12} a12 12 0 0 1 12 -12 h{W-12} v{H} h-{W} z"/>`——顶部横移=**卡宽−12**，闭合横移=**−卡宽**。自查：`起点x+12+h(顶)==卡右缘` 且 `卡右缘−卡宽==起点x`。标杆：`M70 228 a12 12 0 0 1 12 -12 h538 v46 h-550 z`（卡宽 550）。
6. **spec_lock 格式坑**：typography 纯数字（`14` 非 `14px`）；`primary_language` 用 BCP-47（`zh-Hans` 非 zh-CN）；未声明字号一页 ≤2 次。
7. **数据纪律**：图表数据真实可查、值与几何一致；经不起追问的主张删除而非弱化。
8. **颜色契约与模板主题对齐（2026-09-08 串色事故）**：spec_lock 的 schemeClr 引用合并后按**公司模板主题**解析。角色→槽位规则与中电金信标准 colors 块见模板档案 §2.1——`text:` 角色恒锁 dk1 黑、extra 角色前 2 名占 accent5/6 槽，浅灰误占 accent6 会整册变红。**新项目一律拷贝标准块**；自定义颜色必须放在 extra 第 3 位以后（落选=显式 RGB=安全）。
9. **交付前渲染目检强制（双轨制，2026-09-08 Kevin 确认）**：validate_pptx.py 只查结构不查视觉，颜色串位/字号溢出只有渲染能暴露。交付前必跑：`soffice --headless --convert-to pdf <最终.pptx> --outdir <tmp>` → `pymupdf` 逐页渲染 PNG → **逐页过目**（至少：封面/每章首页/全部数据页/封底）。**边界**：LibreOffice 中文字形易失真（字体缺失）、radar 类别标签不可靠——LibreOffice 目检的价值在**颜色串位/几何布局/形状存在性/非中文文字**；中文排版与 radar 内容层以**用户在真 PowerPoint 手工验证为准**，含 radar/中文密集页的交付须明确请用户手工核验。无 LibreOffice 时至少抽查 p:sp 的 fill 解析色。
    - **macOS 实测（2026-09-11，本机）：LibreOffice 转 PDF 会静默丢弃全部 CJK 文本**（不只失真——整个中文层消失，只剩数字/拉丁文），因此中文溢出与文案核对**不能**依赖它。补充动作：用 `pymupdf.open(<源>.svg)[0].get_pixmap(matrix=pymupdf.Matrix(1.5,1.5))` 直读 `svg_output/` 里的源 SVG 渲染 PNG 逐页过目——中文、换行、标签碰撞都能看清。两轨各司其职：LibreOffice 看几何/配色/形状，pymupdf 读 SVG 看中文与文案。**数值标签与折线/标杆线、短柱标签与相邻长标签的碰撞只有这一轨能发现**（本次抓到"月均线标签压住末柱数值标签""卡片底注溢出边框"两处）。**2026-09-16 起，标签压条/文字出框/文字互撞三类已改由 `verify_layout.py` 机械检出并挡在导出前**（见 references/workflows/svg-authoring-and-quality-gates.md §2.6），目检从"唯一防线"退为"最后确认"——但**线条与文字的碰撞**（如标杆线穿过标签）仍只能靠这一轨，不要因此省掉目检。
    - **soffice 报 `DeploymentException: Unspecified Application Error` 时**：加独立用户配置目录即可，`soffice -env:UserInstallation=file:///tmp/lo_profile_xxx --headless --norestore --convert-to pdf ...`。
10. **商业片配色审美红线（Kevin 硬偏好）**：内容页一律白底；**禁止大面积红底**（红仅限小字强调/细边框/小红标，≤5% 版面）；**禁止纯黑大色块与黑色页面背景**（深藏青 #0C2864 仅用于标题条/结论条/阶段块）；KPI 数据卡默认白底蓝边蓝字，不用深底大卡阵列；深蓝底白字通栏仅作页尾结论条使用。**深底文字层级（2026-09-20 封面迭代补）**：深底上的高亮文字**最多一层主层**，装饰性回声行（英文副题等）不得夹在两层高亮之间——"白大字→淡蓝小字→白次大字"的**亮度三明治**刺眼（实测），信息行宁可放浅底用深色字；低透明度（≤10%）装饰线/纹理在裁剪、缩放、夜间反色下会显形成"渲染毛刺"，**默认不加**。
    - **效果（渐变/阴影/光晕）与红线的共存边界（2026-09-16 Kevin 定调）**：**绝对禁止**黑色大块与大面积红；**若要用渐变/阴影/光晕，一律不得使用黑或红**——它们与蓝色科技系主题冲突。可用的效果色域只有主题蓝族与中性灰：阴影仅用 `#1B4593` 8~12% 或 `#0C2864` 8~10% 低透明度（**禁止纯黑阴影**）；渐变只走同色系深浅（藏青→主蓝→亮蓝区间）或白色→浅灰（`#FFFFFF`→`#E4E6EA`）；光晕只用于高亮数据点/关键节点，取 `#266DE7` 或 `#00D3E4` 且透明度 ≤25%。红色 `#DF203C` **不得进入任何渐变、阴影或光晕**。同一图元的效果叠加 ≤2 种，且效果**不得改变信息编码**（条长/点位/角度/面积一律不受效果影响）。落地细则见模板档案 §2.2。
11. **原生图表纪律（B 路线，2026-09-08 实装）**：数据叙事（序列/对比/趋势/多维评分）必须视觉成形——孤立统计值用 KPI 卡，其余一律图表化（原生 chart 或 SVG 形状图表），禁止把趋势故事讲成三张并排数字卡。**雷达默认形状版**（charts 库 radar_chart 骨架：渐变填充+虚线标杆，处处渲染一致、观感最佳——2026-09-09 Kevin 定版 v1.4）；原生 radar 仅用于「客户需自行改数」场景，且属「用户手工验证」类：LibreOffice 渲染 radar 中文类别标签失真（2026-09-08 实证），交付前必须请用户在真 PowerPoint 核验维度名/系列/数值标签，未验证不视为交付完成；注入后必须 LibreOffice 渲染目检该页几何与颜色。
12. **受控图片白名单**：`p:pic` 仅允许来自 `embed_images_inject.py` 对「可插入图片/」信任池的注入——用户人工审核放图、文件名即语义标注（`P{页码}-` 前缀可选，仅作一致性提示）；**AI 主动扫描选图并自写 embed_images.json（用户零配置）**；拒绝一切路径穿越写法；除该白名单外全册零位图。证据型图片（真实产品 UI/授权实拍）优先于任何装饰性图片；AI 生成假 UI 禁止入册。
