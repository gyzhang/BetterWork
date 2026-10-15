---
name: ppt-generation-expert
description: >
  中电金信公司模板 PPT 生成专家。只为已注册公司模板生成新演示文稿；以规范化 SVG 生成 PowerPoint 原生可编辑形状，并合入模板交付。适用于按公司模板做汇报、可编辑图表/关系图、SVG 转 PPTX，以及长文档或书稿浓缩为 40 页以上大册。
description_en: >
  CEC GienTech company-template PowerPoint generation expert. Creates new decks only for registered corporate templates, authors standardized SVG, exports editable native PowerPoint shapes, and merges them into the template. Use for company-template decks, editable chart/diagram slides, SVG-to-PPTX, or 40+ slide decks from long source documents.
version: v20261007.5
agent_created: true
disable: false
---

# PPT 生成专家（公司模板 PPT 引擎）

## 定位

本 Skill 只生成已注册公司模板的**新演示文稿**。当前注册模板为中电金信，对应模板文件 assets/中电金信模板.pptx 和唯一模板档案 templates/中电金信.md。SVG 转为原生可编辑 PowerPoint 形状后必须合入公司模板；不负责对既有 PPTX 单页原位修改，也不接手与公司模板无关的通用幻灯片编辑。

## 渐进加载规则

本文件是常驻入口，不承载长篇操作细则。按当前任务阶段，只读取下表中需要的资源：

| 任务阶段 | 精确读取这些包内资源 |
|---|---|
| 普通公司模板 PPT | references/workflows/standard-deck.md、templates/中电金信.md、references/styles-playbook.md；如选完整风格包，再读 references/styles/duty-manual.md、references/styles/mbb-consulting.md、references/styles/operating-review.md 中对应的一份 |
| 图表或关系图选型 | references/charts-library.md；需要看视觉样例时读 references/charts-atlas.md；图册指定预览图时按其中的准确路径读取；拓扑关系读 references/diagrams-library.md |
| SVG 编写与取骨架 | references/svg-native-guide.md、references/workflows/svg-authoring-and-quality-gates.md；按图形类型再读 references/charts-library.md 或 references/diagrams-library.md |
| svg-export 因缺少 spec_lock.md 且自动脚手架失败 | references/workflows/spec-lock-fallback.md（只在该失败发生时读取） |
| 长书稿、长报告或多来源大册 | references/long-doc-deck.md、templates/中电金信.md；再按页面需要读取 references/styles-playbook.md、references/charts-library.md 或 references/diagrams-library.md |
| 导出、原生图表/表格/链接、模板合并与验收 | references/workflows/delivery.md；只在失败时读取 references/workflows/troubleshooting.md |
| 用户只要 SVG 渲染图片 | references/workflows/svg-to-png.md；先核实当前运行确实提供对应渲染能力 |
| 更新 Skill、锁、外部依赖或上游工具链 | references/workflows/maintenance.md、references/doc-writing-discipline.md |

只读取上表列出的准确相对路径；不要按文件名猜测未列入索引的资源。包内资源用 skill_read_resource，并传入当前 Run 提供的 bindingId 和资源相对路径读取。导入时扫描到的工作区线索不是可读授权，也不是已选任务材料；本 Skill 目录资源、用户选定的输入材料和当前 Run 工作文件是三种不同范围。运行中只依据本次 Run 实际提供的工具与运行 profile，不猜测工具名称、路径或参数。

## BetterWork 执行契约

通过 skill_execute 调用 package manifest 声明的 commandId：project-init、icon-sync、svg-export、template-merge、pptx-validate。参数必须符合该 commandId 的 schema；不要直接启动系统 Python、手写绝对解释器路径或让用户自行 pip install。依赖由 Skill 包内锁声明，Python 由 BetterWork 受管运行组件提供，外部 PPT Master 仅在本 Skill 的工具链声明存在并已绑定时可用。以工具返回的工作目录、文件路径和报告作为事实，不猜路径。

project-init 的 quick-generate 只建立 `svg_output/`，不会创建 `spec_lock.md` 或 `pages.json`。普通流程依据模板档案写页，`svg-export` 会在质检前补齐缺失的默认 `spec_lock.md`，通常不必读取它。若该自动步骤失败，先看本次命令返回的 stdout/stderr；确认是 `scaffold-lock` 失败且锁文件不存在后，才按索引读取 `spec-lock-fallback.md` 并创建完整锁。不得不看诊断就盲目重试，也不得覆盖已有锁。若任务要求自定义锁或需要读取 `pages.json`，先用 `task_write_file` 创建该文件，并只在工具确认写入成功后读取。任何读取返回 ENOENT 都表示创建或路径步骤尚未完成；先补建文件或修正路径，不要重复读取。

每次 `svg-export` 都在新的 attempt 工作目录执行；只使用该次命令返回的报告、PPTX 路径和 output id。失败后先按本次 stdout/stderr 与实际返回的报告修复，再重试；不要沿用上次 attempt 的路径、猜测 `validation/` 位置或原样重复失败命令。SVG 每页都必须明确给根 `<svg>` 写 `viewBox="0 0 1280 720"`，白底根图元写成 `<rect id="page-background" ... data-pptx-role="background"/>`；带 `data-pptx-role` 的根图元必须有稳定且页内唯一的 `id`。

输入文件只读取用户实际选择的任务材料；本 Run 创建的工作文件使用当前 Run 提供的 read_text_file、task_write_file 等工作区工具访问。不要把从 Skill 包读取资料等同于获得访问任意 Workspace 文件的权限。

## 永远遵守

- 写页前读取对应公司模板档案；模板中的色板、字号、坐标与版式事实优先。
- 每页标题由模板版式占位符承载，SVG 内不绘制标题。
- 图表数据和主张必须能追溯到输入来源；不能核实的数字不补造。
- SVG 先过配色、版式、数据几何闸门，再导出；任何阻塞错误先修复。
- PowerPoint 以原生可编辑形状为主；图片只能通过包中声明的受控图片流程进入。
- 交付须完成 PPTX 结构校验和可视检查；用户明确要求某些特殊项自行编辑时才选择对应原生注入路线。
- 资料不足或所需外部工具链不可用时，说明具体缺口，不输出伪造的“已验证”交付。

## 五步工作流速览

1. 规划叙事、页面角色和证据；按需读取风格包、模板档案和图形选型手册。
2. 初始化项目，按页面逐个写规范化 SVG。
3. 运行 SVG 检查与导出；三项本 Skill 闸门会随导出流程执行。
4. 将导出页按 pages.json 契约合入公司模板；只有确需客户编辑数据时才注入原生图表或表格。
5. 验证最终 PPTX，完成双轨可视检查并交付文件、报告和路径。

## 历史章节兼容索引

以下编号保留给包内旧引用；详细正文已迁入对应手册。

### 1. 内容规划（写 SVG 前必做）

详见 references/workflows/standard-deck.md §1。

### 1.5 长文档 → 大册派工流水线（源不在上下文、成片 ≥40 页）

满足 references/long-doc-deck.md §1 任一派工判据时，按该手册执行；派工模板和批次隔离操作只在需要时加载。

### 2. 初始化 + 写规范化 SVG

详见 references/workflows/standard-deck.md §2。

### 2.4 骨架取用：三步转换

详见 references/workflows/svg-authoring-and-quality-gates.md §2.4。

#### 2.4.1 换色

详见 references/workflows/svg-authoring-and-quality-gates.md §2.4.1。

#### 2.4.2 剥离上游版式件

详见 references/workflows/svg-authoring-and-quality-gates.md §2.4.2。

#### 2.4.3 删原生图表 marker

详见 references/workflows/svg-authoring-and-quality-gates.md §2.4.3。

#### 2.4.4 图标契约

详见 references/workflows/svg-authoring-and-quality-gates.md §2.4.4。

### 2.5 几何一致性校验

详见 references/workflows/svg-authoring-and-quality-gates.md §2.5。

### 2.6 版式适配校验

详见 references/workflows/svg-authoring-and-quality-gates.md §2.6。

### 2.7 配色合规校验

详见 references/workflows/svg-authoring-and-quality-gates.md §2.7。

### 2.8 分组与容器约束

详见 references/workflows/svg-authoring-and-quality-gates.md §2.8。

### 3. 质检 + 导出

详见 references/workflows/delivery.md §3。

### 4. 合入公司模板

详见 references/workflows/delivery.md §4。

### 4.5 注入原生图表与受控图片

详见 references/workflows/delivery.md §4.5。

### 4.6 原生超链接

详见 references/workflows/delivery.md §4.6。

### 5. 交付校验

详见 references/workflows/delivery.md §5。

## 通用版面纪律

详见 references/workflows/svg-authoring-and-quality-gates.md §2.9。

## 旁路：SVG → PNG

详见 references/workflows/svg-to-png.md §1。

## 铁律

详见 references/workflows/delivery.md §6。

## 排障

详见 references/workflows/troubleshooting.md §1。

## 资源索引

- templates/中电金信.md：模板色板、字号、坐标和版式的唯一档案。
- references/workflows/standard-deck.md：普通公司模板演示文稿的规划和初始化。
- references/workflows/spec-lock-fallback.md：仅在缺省锁自动生成失败时使用的完整锁文件兜底。
- references/workflows/svg-authoring-and-quality-gates.md：SVG 骨架转换、几何/版式/配色闸门和通用版面纪律。
- references/workflows/delivery.md：导出、模板合并、原生注入、交付检查和硬规则。
- references/workflows/troubleshooting.md：校验与导出错误的逐项修法。
- references/workflows/maintenance.md：作者维护、运行资源、脚本、自检和 ppt-master 同步。
- references/workflows/svg-to-png.md：图片旁路，仅按明确需求读取。
- references/long-doc-deck.md：长文档/书稿大册派工。
- references/svg-native-guide.md：SVG 语法、分组、版面和原生导出参考。
- references/charts-library.md 与 references/charts-atlas.md：图表/表格选型与图例。
- references/diagrams-library.md：关系与结构图选型。
- references/styles-playbook.md 与 references/styles/：风格选择和单个叙事风格包。
- references/doc-writing-discipline.md：维护本 Skill 文档前必读的事实源和变更纪律。
