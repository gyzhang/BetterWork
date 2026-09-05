# ADR-0006：消息中心与三层反馈机制

- 状态：Accepted
- 日期：2026-09-05

## 背景

应用缺少统一的通知机制：长操作结果只存在于页面内联提示，用户切换视图或离开窗口后无法得知任务完成或失败，结果也无法回溯。参考 ClawBible Desktop 的实践（Toast 与通知中心共用一份落库数据）与教训（通知条目缺跳转字段、铃铛组件未接线、系统通知缺失）。

## 决策

- 新增 Notification 领域对象：`id`、`level`（info / success / warning / error）、`kind`（run / knowledge-import / artifact / system）、`title`、`detail`、`target`、`read`、`createdAt`。`target` 携带可跳转目标（任务 / 成果 / 知识页），进入领域语言。
- 三层反馈模型：页面内联反馈、Toast（瞬时）、消息中心（持久）。所有长操作结果统一落消息中心；Toast 按「同页抑制」规则弹出——用户正在对应页面时不弹，只落档。
- 持久化与 Run Journal 同库：SQLite `notifications` 表，200 条滚动上限，超限淘汰最旧；通知由 Application 层先持久化再广播，经 `notification:event` 推送增量与未读数。
- 触发源（首期）：run 完成 / 失败（取消静默，不记录）、知识导入结果、成果导出结果。
- 系统通知仅在窗口失焦且 run 终态时发出（Electron Notification），点击聚焦窗口并跳转对应任务；导入与导出不发系统通知。
- Agent Core 不感知通知；触发挂接在 Application 层事件发布与长操作完成点。

## 结果

长操作的「明确结果」要素有了统一落点，用户切走后仍可回溯；run 取消不再产生噪音。通知偏好设置、免打扰、后台定时任务通知可在此模型与表结构上扩展，不需要迁移领域对象。
