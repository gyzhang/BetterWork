---
trigger: glob: apps/desktop/src/renderer/**/*.tsx,ts,css
---

# Renderer UI 与主题纪律

设计真相源是 [docs/10-ui-ux-system.md](../../docs/10-ui-ux-system.md)；变更核心信息架构或视觉语言前先更新该文档。

- **只用语义化主题 Token**（定义于 `apps/desktop/src/renderer/src/appearance.ts` 与 `styles.css`）：禁止新增硬编码色值，禁止用局部 `.dark` 补丁绕过 Token 契约。建立新 Token 时必须当场迁移所有相关硬编码值，不留半套。
- 外观由两个维度组成：`system / light / dark` 模式 × 可扩展色系；每套正式色系必须同时提供浅色与深色 Variant。
- **应用主题不得改变 Artifact 自身的文档、演示、表格或图表配色**。
- 中文体验优先；正文和常规控件禁止用 9–10px 小字号换取空间，优先折叠、覆盖和响应式重排。
- 长操作三要素缺一不可：可见状态、取消入口、明确结果。
- 过程信息按用户目标分组并渐进披露；原始 Run 事件不得成为默认主界面的视觉中心；不展示模型私有思维链。
- Artifact 是一等界面对象；右侧上下文面板按场景出现且必须允许完全收起。
- 模型配置使用独立设置空间，不嵌入 Composer 或任务消息流。
