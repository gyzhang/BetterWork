# SVG 原生管线运行手册

目标：AI 编写**规范化 SVG** → 编译为**原生可编辑 DrawingML 形状** → 合入公司模板版式。产出页面在 PowerPoint 中完全可编辑（非图片）。本文件主要定义 SVG 合同；BetterWork Run 只能调用本 Skill manifest 声明且当前运行已绑定的 commandId。下面的 shell/Python 命令是包作者离线维护示例，不是 Run 可调用工具，也不代表跨平台支持。

## 0. 环境与运行边界

- BetterWork 运行时由受管 Python 与当前 Run 绑定的 ppt-master 工具链执行；不要猜测解释器、绝对路径、shell 或未注册命令。
- 包作者离线维护时，工具链路径与依赖按 `references/workflows/maintenance.md` 和包内锁处理；离线命令不得转化成普通 Run 的操作步骤。
- 公司模板：本 Skill `assets/` 下已注册模板（当前：中电金信模板.pptx，档案 `templates/中电金信.md`；`template-merge` 使用）。模板文件只读。

## 1. 工作区初始化（每个 PPT 项目一次）

```bash
python3 $PPTM_HOME/skills/ppt-master/scripts/project_manager.py init <name> --quick-generate --format ppt169
```

产出 `<name>_ppt169_<日期>/`（含 `svg_output/`、`validation/`）。画布 ppt169 = 1280×720，与公司模板画布一致。

## 2. 编写规范化 SVG（每页一个文件放 svg_output/）

**语法合同**（违反会被质检器拒绝导出）：

- 根元素：`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" font-family="Microsoft YaHei" data-pptx-page-role="content">`，禁止根 transform。白底必须是组外根图元并有稳定、页内唯一的 id：`<rect id="page-background" x="0" y="0" width="1280" height="720" fill="#FFFFFF" data-pptx-role="background"/>`。不要省略 `viewBox`、background 的 `id` 或 `data-pptx-role`。
- 允许元素：`rect / circle / ellipse / line / polyline / polygon / path(受支持形式) / text / tspan / g`
- 内联 style 白名单：`fill, stroke, stroke-width, stroke-dasharray, fill-opacity, stroke-opacity, font-family, font-size, font-weight, font-style, text-anchor, letter-spacing, text-decoration, opacity`
- 文本：`font-family` 必填非空；`font-size` 正数 px；`font-weight` 取 normal/bold/100~900 整百；`text-anchor` 只能放 `<text>`（tspan 上禁止）；换行用多个 `<text>` 或 `<tspan>`，禁止 `foreignObject`
- 禁止：`<style>`、`class`、`<animate*>`、`<script>`、`<foreignObject>`、`textPath`、`@font-face`、HTML 命名实体（`&nbsp;` 等，用原生 Unicode）、`!important`、未知 CSS 属性、混合模式
- 颜色建议大写 `#RRGGBB`，用已注册模板色板（中电金信见模板档案 §2；红 #DF203C 克制）
- 字体只用 Microsoft YaHei（PPT-safe）

**分组与页面角色（强制，2026-09-16 起）**：

上游 `--canonical-authoring --stage final` 把每个**可见的顶层 `<g>`** 视为一个"模块区"，并要求声明其根坐标范围：

- 根 `<svg>` 声明 `data-pptx-page-role`，取值 `cover | toc | section | content | ending`（flat 路线必须声明）
- 每个逻辑单元（结论条 / 图表 / 侧栏 / 卡片区 / 图例 / 脚注…）包成一个**有描述性 id 的顶层 `<g>`**，id 用 kebab-case、页内唯一
- 每个顶层 `<g>` **必须**带 `data-pptx-bounds="x y width height"`，且**完整包住该组的全部元素**（含文字 descender，四周留 ≥4px 余量）
- **相邻模块区不得重叠超过 1px**：判定要求**两条轴同时超过容差 1.0px** 才失败——所以只要在一个轴上留出净距就安全
- 模块区必须落在 viewBox 之内
- 全页白底 `<rect>` 作为**根图元**留在 `<g>` 之外，声明 `data-pptx-role="background"`（**不要**为它建组）
- 嵌套 `<g>` 可匿名、无需 bounds（用于图标+文字、数值+标签等内部子单元）；嵌套组算 1 个动画步，顶层组才算独立单元

**禁止**：整页一个大 `<g>`；大量散落的未分组顶层 `<rect>/<text>/<path>`；每个图标/每行文字各建一组；顶层组缺 id。

**边缘装饰条必须跟随宿主圆角（2026-09-16 起，`verify_layout.py` L5 强制）**：卡片/色带左（顶）边缘的同色装饰条**不要**写成 `<rect width="6" height="H" fill="…"/>`——宿主是 `rx=8` 时条的直角会戳出圆角轮廓约 3.3px（"条是方的、卡是圆的"），而且容易写成比宿主矮一截。正确写法是贴边 `<path>`，纵向覆盖宿主全高：

```svg
<!-- 宿主 <rect x="70" y="200" width="360" height="248" rx="8"/> 的 6px 左侧条 -->
<path d="M76 200.25A8 8 0 0 0 70 208V440A8 8 0 0 0 76 447.75Z" fill="#DF203C"/>
```

生成式：`dx = r − √(2rw − w²)`（r=8, w=6 → dx≈0.25）→ `M{x+w} {y+dx} A{r} {r} 0 0 0 {x} {y+r} V{y+h−r} A{r} {r} 0 0 0 {x+w} {y+h−dx} Z`（两条弧的 sweep 均为 0）。批量改写用 `scripts/round_accent_strips.py`。

**⚠️ 两条 2026-09-20 补充（书稿实战暴露）**：

1. **判据不看条的 rx**：`rect` 的 rx 四角统一，改它修不了这个形状（设小则戳出、设大则右侧也被倒角）。所以**带 rx 的条同样是缺陷**——曾有书稿 29 处全写 `rx="2"`，因判据看 rx 而对 L5 与批量改写**双双隐形**。
2. **横条（贴宿主上边的色带）同样要贴边**：把竖条沿 y=x 镜像即可，但**弧的 sweep 由 0 变 1**（镜像翻转手性），`d` 用条高算 `dx`：

```svg
<!-- 宿主 <rect x="64" y="106" width="270" height="392" rx="10"/> 的 6px 顶边条 -->
<path d="M64.83 112A10 10 0 0 1 74 106H324A10 10 0 0 1 333.17 112Z" fill="#B9CCE4"/>
```
   （`dx = r − √(2rh − h²)`；末段 `H` 走宿主全宽。**sweep 写反会得到内凹形状，改完必须渲染目检。**）

**为什么必须做**（2026-09-16 实测）：分组后导出会产出**真正的 PowerPoint 分组，且组名就是 SVG 的 id**——实测 `grpSp=4`，组名 `summary-band` / `chart-revenue` / `chart-revenue-area`（嵌套）/ `side-panel`。用户在 PowerPoint 里可**一次点选整个卡片**，而不是拖框选几十个 `Rectangle N / TextBox N`；改页有稳定定位点，动画也有锚点。此外质检器**只在有分组时才给出结构 advisory**（未分组元素、缺 page-role），不分组则整条质量通道空转。

**布局规范**（具体坐标以 `templates/<公司>.md` 档案为准；下为中电金信值）：

- **标题规则（无例外）**：页标题一律由公司模板版式 title 占位符承载（merge 时经 pages.json 写入），**SVG 内任何情况下不画标题**——y 58~114 为版式标题占位符区，禁止绘制任何元素
- 内容主体从 **y ≥ 135** 开始（推荐 148 起），左右安全边距 x 70~1210
- 底注/来源行 y ≤ 690
- 页面不做页脚、页码（模板母版负责）

**编码技巧**：图层栈图用 rect+text 居中（text-anchor="middle"）；流程箭头用 polygon 菱形；圆环图用标准 stroke+strokeDasharray 写法保证完整正圆；**文字最小 13px**（字号下限口径，见 styles-playbook.md §2 落地裁决表与 diagrams-library.md §2.5；密度靠减模块/删内容调节，不靠缩字号）；编译后 line/polygon 会成为 freeform（仍可编辑）；小图标按 references/workflows/svg-authoring-and-quality-gates.md §2.4.4 取图标库 `<use data-icon>`（不建议纯手拼形状时才用基本形状拼），不用 emoji；白卡头带 path 写法见 references/workflows/delivery.md §6 第5」。

**目录外图形手绘纪律（2026-09-29 起，漏斗斜率事故沉淀）**：全三域共 47 个骨架（上游 chart 33 + table 6 + 本 skill 自持 diagram 8）覆盖不到的图形（金字塔、阶梯、环形层级、非常规锥体…）现场手写 SVG 时，在通用语法合同之上额外遵守：

1. **分段锥形图的斜边连续性（漏斗 / 金字塔 / 阶梯通吃）**：分段漏斗的**每侧收窄量必须逐层恒定**（官方 `chart/funnel_chart` 为 45/45/45/45，四条斜边平行）；分段金字塔的每侧加宽量同理恒定（`diagram/pyramid_chart` 为 40/40/40/40）。2026-09-29 实测事故：示意图第四层收窄量从 30 拍成 35，斜率突变被一眼抓出。若画**连续斜面**变体（层间不留隙），各层斜边端点必须严格共线。
2. **宽度示意化 vs 数据编码的裁决（互斥边界，不是风格偏好）**：锥形图（漏斗 / 金字塔）的层宽默认**示意化**——按几何美观递变，真实数值靠文字标注；层间数据比例悬殊（如 1200:28）时按真实比例画会让底层窄到无法承载文字。需要严格按数值对比大小 → 改用 `chart/horizontal_bar_chart`。
3. **层内文字宽度预算**：层内文字渲染宽 ≈ 汉字数 × font-size（西文按 0.55× 估算），必须 ≤ 该层中部宽度 − 24px；放不下时**文字外置**（引线 + 右列说明，见 `diagram/pyramid_chart` 的布局），禁止把字号缩到 13px 以下硬塞。
4. **对称性纪律**：锥形类图形必须左右轴对称——每层左右端点 = 中轴 ± 半宽，用公式算坐标，禁止手拍。
5. **几何连续性靠人眼兜底**：斜边平行 / 共线目前不在机械闸门覆盖范围内，手绘锥形图导出前必须渲染目检斜边。

## 3. 质检 + 导出

BetterWork 按 manifest 中的 `svg-export` 契约调用 `scripts/svg_native_export.py`。命令先补全缺失的 spec_lock.md，再执行版式、几何与最终质检；任一闸门失败都会以非零退出码结束，不产生可登记输出。导出脚本必须使用 manifest 传入的 `--output` 目标，不扫描旧 `exports/` 文件猜测最新产物。

成功后使用本次执行返回的 `outputIds` 取得 PPTX 成果，并将 `executionId` 与后续执行记录关联。不要从旧 Run、目录时间戳或固定文件名推断输出路径；后续模板合并使用当前 Run work 中的 `source_pptx` 输入参数。

已知坑：
- 没有输出句柄或命令失败时，先查看该次执行报告和质检错误；修改后以新 executionId 重跑，不复用失败 attempt 的输出路径。
- spec_lock 的 typography 值必须是纯数字（`14` 不是 `14px`）。

## 4. 合并公司模板版式

`template-merge` 命令从 `source_pptx`、包内只读 `template_path` 和 Run work 中的 `config_path` 读取输入；输出目标由 manifest 按 executionId 隔离并通过 `outputIds` 返回。

pages.json 的 `src` 对应 svg_output 中各页的导出顺序（0-based）。标题/副标题/tag 写入版式占位符。脚本会自动跳过 SVG 的全页白底 rect 以露出模板版式底纹。版式名取值与示例见模板档案（中电金信 §10）。

## 5. 验收口径

- 导出 PPTX：`<p:pic>` 数 = 0、`<p:sp>` 数 = 元素数、`<a:t>` 文本齐全
- 合并后：版式 rel 正确、标题占位符有字、无 y 58~114 区域冲突
- 质量门：POSTFLIGHT `quality_gate=passed`
