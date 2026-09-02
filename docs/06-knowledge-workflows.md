# 研究与 Office 工作流

## 1. 通用原则

- 模型负责理解、规划、解释和写作。
- 工具负责计算、解析、检索、修改和渲染。
- 复杂交付使用显式 Workflow 和检查点。
- 生成与修改是不同任务，分别设计 Skill。
- 所有文件默认另存为新 ArtifactVersion。
- 交付前必须经过结构验证；Office 文件还应经过渲染和视觉检查。

## 2. 深度研究

```text
明确问题
→ 拆分子问题
→ 生成研究计划
→ 用户确认范围
→ 检索本地知识
→ 搜索与获取新来源
→ 建立 Evidence
→ 来源评估与去重
→ 提取事实和观点
→ 识别矛盾与研究缺口
→ 补充研究
→ 形成 Claims
→ 生成大纲
→ 用户确认大纲
→ 撰写报告
→ 引用与事实检查
→ Artifact
```

第一条产品级垂直切片采用此流程的精简版本。

## 3. Excel 分析

```text
导入 Workbook
→ 识别 Sheet 和数据区域
→ 字段类型推断
→ 数据质量报告
→ 用户确认指标口径
→ 生成分析计划
→ 确定性计算和变换
→ 图表
→ 洞察与异常解释
→ 输出分析 Workbook
→ 可选 Word/PPT 报告
```

数据引擎优先采用 Python Worker：

- pandas/openpyxl：Excel 兼容与修改
- DuckDB 或 Polars：分析和查询
- 图表库：生成可复用图表 Artifact

必须保留：

- 数据来源
- 使用的 Sheet/Range
- 变换步骤
- 公式和查询
- 输出版本

## 4. Word 文档

内容与格式分离，先生成中间模型：

```ts
interface DocumentModel {
  title: string;
  metadata: Record<string, unknown>;
  sections: DocumentSection[];
  references: Citation[];
  styleProfile?: string;
}
```

```text
资料与研究结果
→ 大纲
→ 用户确认
→ DocumentModel
→ 模板和样式
→ DOCX
→ PDF/页面图片预览
→ 结构和视觉验证
→ 修改与新版本
```

## 5. PPT

使用 PresentationModel，而不是让模型直接拼装 OOXML：

```text
Presentation
├── Audience / Purpose
├── Narrative
├── Theme
├── Slides
│   ├── Purpose
│   ├── Content Blocks
│   ├── Visual Intent
│   ├── Evidence
│   └── Speaker Notes
└── Assets
```

流程：

```text
明确受众和目的
→ 故事线
→ 页面大纲
→ 用户确认
→ 页面内容和证据
→ 图表与视觉资产
→ 布局
→ PPTX
→ 页面截图
→ 视觉 QA
→ 修改与新版本
```

## 6. 修改已有 Office 文件

修改必须采用操作模型：

```text
Inspect
→ Plan Patch
→ User Confirmation（必要时）
→ Apply Patch to Copy
→ Render
→ Validate
→ Save New Version
```

尽量保留未知元素、主题、母版和现有格式。第一阶段优先做好“创建”，后续再逐步提高“修改已有文件”的保真度。

## 7. Artifact 预览

右侧 Artifact 面板根据类型展示：

- Research：Sources、Evidence、Outline、Claims
- Excel：Sheets、Fields、Charts、Findings
- Word：Outline、References、Pages、Versions
- PPT：Slide Outline、Assets、Slide Preview、Versions

