# 标准公司模板 PPT 工作流

> 按任务阶段加载本手册。BetterWork 运行时通过当前 Skill 的命令契约执行；文中的旧终端命令仅用于作者维护/离线核验，不要要求普通用户安装 Python 或手动配置路径。

### 1. 内容规划（写 SVG 前必做）

按 `references/styles-playbook.md` 的**选型决策树**选叙事风格——五套常用风格各有专属或内联包（`references/styles/`）：`operating-review`（月报/经营复盘）· `mbb-consulting`（对外方案/决策请示）· `duty-manual`（制度/操作规程）· `consulting-decision`（通用兜底）· `investor-pitch`（争取资源）。每包含**页序模板 + 标题断言写法 + 图表偏好 + 中电金信落地裁决（色/字/装饰）+ 自查清单**，冲突一律按包内裁决表执行。然后列页面角色序列，每页标题写成**断言**而非话题标签。读当前模板档案。

**图形选型（三域，先判关系再挑图）**：查 `references/charts-library.md`——值驱动用 `chart/<key>`（33 个，上游 charts/）、行列定位用 `table/<key>`（6 个，上游 tables/）、拓扑驱动用 `diagram/<key>`（8 个，本 skill `assets/diagrams/`）。**声明即存在**：点名的 key 必须在磁盘上存在且能过上游校验器，`tests/selftest_e2e.py --suite skeletons` 机械校验；每页按需选定，选不出时可不选（"零图表"是合法结论）。


### 2. 初始化 + 写规范化 SVG

1. 在 BetterWork 中用 `skill_execute` 调用 `project-init`，只使用命令返回的 `project_dir`。quick-generate 只建立 `svg_output/`，不会创建 `spec_lock.md` 或 `pages.json`。通常让 `svg-export` 自动生成缺省锁；只有自动脚手架明确失败、且确认锁文件不存在时，才读取 `references/workflows/spec-lock-fallback.md` 并手动补齐。已有锁不得覆盖。
2. 每页一个 SVG，通过 `task_write_file` 写入返回项目目录的 `svg_output/`。语法合同见 `references/svg-native-guide.md §2`（元素白名单、禁 style/animate/foreignObject/HTML 实体、微软雅黑）；布局坐标按模板档案（中电金信：标题区 y58~114 禁入、内容 y135~690、x70~1210）。根元素必须声明 `viewBox="0 0 1280 720"` 与 `data-pptx-page-role`；白底必须使用唯一稳定 id 的根图元，例如 `<rect id="page-background" x="0" y="0" width="1280" height="720" fill="#FFFFFF" data-pptx-role="background"/>`。
3. 数据页/结构页按三域选取对应骨架，读取包内 SVG 后按新数据改写页面；**骨架不能拿来即用，必须过 §2.4 三步转换**。替换数据的同时按新值重算标记几何；几何一律使用已注册工具能力，见 `charts-library.md §4`，**禁止手算**。图标按 §2.4.4 的契约取用。
4. **元素分组（强制，见 svg-native-guide.md §2）**：每个逻辑单元包成带描述性 id 的顶层 `<g>` 并声明完整的 `data-pptx-bounds`；白底 rect 作根图元，不建组。背景示例见上一步。**相邻模块区不得重叠超过 1px**。顶层组导出为可命名的 PowerPoint 分组。

### 3. 检查、合并和验证

1. 用 `skill_execute` 调用 `svg-export`，参数为本次 Run 的项目目录。每次导出会使用新的 attempt 目录；只采信本次调用返回的 stdout/stderr、报告路径、PPTX 路径和 output id。失败后读实际返回的报告并按错误修复；若没有报告路径，不要猜路径。不要对未修改的输入原样重试。
2. 以导出返回的实际 PPTX 路径调用 `template-merge`，`template_path` 使用 `assets/中电金信模板.pptx`。按最终页序创建 `pages.json` 后再传入 `config_path`；不要在创建成功前读取。
3. 用 `pptx-validate` 校验合并后的最终 PPTX。只有结构校验通过后才登记成果；另外按交付手册完成要求的视觉检查。
