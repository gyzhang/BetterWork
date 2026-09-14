# B0 双 Skill 与重启回看记录

- 日期：2026-09-14
- 范围：B00-5 的 macOS 开发窗口人工走查；使用脱敏输入，不代表真实业务验收。
- 环境：`npm run dev`、macOS Electron、已就绪的 `ppt-generation-expert` 与内置「经营分析方法」。

## 已验证

1. Composer `+ → 技能` 列表同时显示两个可用 Skill；选择后任务页标题为 `ppt-generation-expert、经营分析方法`，chip 区按选择顺序显示两项。
2. 点击“开始工作”后，运行中两个 chip 均显示为不可修改，界面出现“运行中不可修改”；SQLite 的 Run `230babfc-df0c-4cb1-a163-3389d83336d3` 在同一 `runId` 下保存两条 `run_skill_bindings`，分别指向 `ppt-generation-expert` 和「经营分析方法」。
3. 结束开发进程并重新启动后，打开最近任务“请用当前值 120、对比值 100 计算收入变化，并说明当前双 Skill 绑定已生效。”，历史消息下重新显示两项已选能力 chip；旧任务没有把绑定带到新任务。
4. 验收中发现能力页从依赖详情返回列表不会自动刷新环境状态；已修复 `useSkills.deselect` 返回时刷新列表，并新增 Renderer 回归测试。

## 未完成

- 当前配置的模型 endpoint 返回 `fetch failed`，因此该次 Run 终态为 failed，没有成功的模型请求、工具活动或 PPT 产物；这不能冒充“带指令注入的成功执行”。离线单元测试仍覆盖双 Skill 指令顺序、绑定快照和撤销原因。
- 尚未在真实窗口执行撤销/停用其中一个 Skill 后只取消包含它的活跃 Run；B00-5 继续保持 `doing`。
