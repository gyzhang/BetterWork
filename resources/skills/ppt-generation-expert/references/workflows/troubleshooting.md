# 质量闸门与导出故障排查

> 只有遇到对应错误时加载本表，并按错误类型定位到一个具体修法。BetterWork 运行时只调用 manifest 声明的命令；下列辅助脚本示例供包作者离线排查，不能据此假设 Run 提供了 shell 或未声明工具。

## 1. 排障

- 质检拒绝 → 按错误清单修 SVG（常见：越界标题区/HTML 实体/未声明字号超限/text-anchor 放 tspan 上）
- **质检报 `... data-pptx-bounds overlaps ...`** → 两个顶层模块区在**两条轴上同时**超出 1px 容差。只需在任一轴上留出净距（≥2px 即安全）即可；**不要**为了消除它把组删掉（那就退回无分组状态、丢掉可编辑性与质量 advisory 通道）
- **质检报 `text ... exceeds <g id="..."> data-pptx-bounds on the horizontal/vertical axis: overflow ... 8.1% (error above 5%)`** → **这是错误级、会直接拒绝导出**。实测（2026-09-16 真实交付）最常踩的是**长注释句/长口径说明行**：一行 14px 混排文字约 11.9px/字符，760px 的组只能放约 63 字、1000px 的底注只能放约 80 字。**修法是折行或缩短文案，不是缩字号**；底注确实需要长句时，把 `page-footnote` 的 bounds 加宽到 1140（页宽允许）。垂直方向同样适用：行数多了就把组高度补足（如 240→248）
- **质检报 `... without explicit data-pptx-bounds`** → 有顶层 `<g>` 没声明 bounds。白底 rect 等静态框架**不要**建组，改成根图元 + `id` + `data-pptx-role="background"`；带 `data-pptx-role` 的根图元**必须**有稳定 `id`（否则报 `<rect> with data-pptx-role requires a stable id`）
- **质检报 XML 不合法** → 几乎总是 **XML 注释内出现连续两个连字符**。最典型的复发原因：**把计算器 CLI 参数原样抄进 `<!-- -->`**（`--data` / `--area` / `--horizontal` / `--bar-width` / `--value-range` 都含 `--`）。注释里只写参数名（如「条形横向模式」）或改散文描述。实测一次交付中 4 个页面同时因此失败
- `verify_geometry.py` 报 `status=mismatch` → 页面上画的标记与数据声明不一致（典型：改了数没重跑计算器）。**用计算器重算并逐值替换坐标**，不要手改某个数字去凑
- `verify_geometry.py` 报 `group-missing` → 图表标记没包在 `<g id="<object>-area">`（或上游写法 `<object>-chartArea`）里，或 object 名与 `chart-plot-area` 标记不一致
- **`verify_layout.py` 报 `[L1] ... 文字不可读`** → 深色数值标签与深色条重叠。两种修法（校验器会指明该用哪种）：① 标签放得下却没放——`text-anchor="end"` 锚点落进了条内，改为 `text-anchor="start"` + `x=条尾+8`；② 标签放不下——**加大 `value-range` 上限**（不是缩短条）或缩短标签，上限值校验器已算好（`修法：value-range 上限 ≥ N`）。改 range 后必须**用计算器重算全部条块坐标**并同步更新 `chart-data` 声明，否则几何校验会失败
- **`verify_layout.py` 报 `[L2] ... 越过边框 → 下切断 N px`** → 容器高度不够：把卡片加高（同时改 `data-pptx-bounds` 高度）**并检查下方模块是否被挤到**，或把末行整体上移。同页多张卡片要保持等高
- **`verify_layout.py` 报 `[L2] ... 距边框 下仅余 N px`（warn）** → 未切断但过紧，交付前顺手调开（挪 4~8px 即可），不阻塞导出
- **`verify_layout.py` 报 `[L4] 文字互撞`** → 两段文字基线间距 <1.05em。同柱双标签场景改为把段值放**段内白字居中**（`fill="#FFFFFF"`），既消除碰撞又天然不触发 L1
- **`verify_palette.py` 报 `VIOLATION`** → 页面用了色板外颜色。**不要改检查器**：要么换成色板内最近色（琥珀→`#266DE7`、浅蓝底→`#E4E6EA`），要么先在 `spec_lock.md` 的 `## colors` 里加角色再引用。骨架库越板要一并修（`assets/diagrams/`），否则会被复制到每一页
- **`verify_layout.py` 报 `[L3]`** → 文字进了标题区（y<120）或越出页面/页脚带，按模板档案的内容区坐标回位
- **`verify_layout.py` 报 `[L5] ... 戳出宿主圆角轮廓`** → 装饰条直角与宿主圆角不吻合（规则见「通用版面纪律」第 5 条）。跑 `scripts/round_accent_strips.py <project_dir> --apply` 批量改写成贴边 path（会同时把不等高的条补齐到宿主全高）；报错信息里也直接给了该条的 path。**改完必须重跑导出**（闸门会再验一遍）
- `svg-export` 失败或没有返回 `outputIds` → 检查当前 Run 的完整执行报告与质检错误；修复后用新 executionId 重跑，不读取历史 `exports/` 猜最新 PPTX
- **上游整体拒跑且只报一句通用文案**（`PPT Master skill integrity check failed...`）→ 是 ppt-master 的署名守卫 **fail-closed** 触发（2026-09-16 起装进 `svg_to_pptx.py` / `svg_quality_checker.py` / `register_template.py` 等 gate 文件）。它校验 `LICENSE` 的 sha256、`SPONSORS.md`/`SPONSORS_CN.md` 存在、ppt-master 自身 `SKILL.md` frontmatter 的版权/许可/仓库地址精确值、以及各 gate 文件的 AST 结构。**不要试图绕过或修复它**，用 `git -C $PPTM_HOME checkout -- <被改文件>` 复原后重跑；先用 `python3 $PPTM_HOME/skills/ppt-master/scripts/attribution_guard.py` 单跑确认（exit 0 = 正常）
- PowerPoint 报"修复" → 跑 validate_pptx.py 定位；对照铁律 2
- **工作区里冒出 `.pptx-build-*` 目录** → 这是**上游 exporter 的 PPTX 装配脚手架**（`svg_to_pptx/pptx_package/builder.py: _create_writable_work_dir`），不是本 skill 的产物。它的候选目录顺序是 `[输出文件所在目录, 当前工作目录, 系统临时目录]` 且**第一个恒胜**，所以正常都落在 `<project>/exports/` 下，并在 `finally: shutil.rmtree()` 里自删——**只有进程被中断（Ctrl-C / kill）时才残留**。本 skill 的 `svg_native_export.py` 每次导出前会自动清扫 `exports/` 下超过 10 分钟的残留，无需人工处理。若在 `$PPTM_HOME` 仓库根目录看到它们，那是旧版上游 + 在仓库根作为 cwd 运行时留下的历史残渣，直接删除即可（内含仅 `.write-probe` / `base.pptx` / `pptx_content` 等中间件，**无任何交付物**）。**不要**为此改 `.gitignore`，也不要把上游的候选顺序改掉（会让本地方与上游分叉）。
- 更多：`references/svg-native-guide.md §3` 已知坑
