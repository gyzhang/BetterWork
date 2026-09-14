# ADR-0022：专家常用参考材料与召唤注入

- 状态：Accepted（2026-09-14，作为已评审设计 v0.2 的实现补充）。
- 日期：2026-09-14。
- 依据：[专家与任务材料设计 v0.2](../designs/experts-and-task-materials.md)、[ADR-0014](0014-expert-context-and-material-binding.md)、[材料、快照与运行来源契约](../development/material-contracts.md)。
- 关系：细化 ADR-0014 的 ExpertRevision 与 TaskContextRevision 边界；不改变 RunContextSnapshot 的运行时快照规则。

## 背景

重复性工作通常有稳定的参考材料。例如月度经营报告会持续参考财务规则和上一期报告，但每一期仍需要加入本期输入和新的外部资料。把这些资料写进专家提示词会失去版本、来源和可移除性；把整个工作区自动暴露给专家又会越过任务材料范围。

## 决策

1. `ExpertRevision` 可保存最多 50 个 `referenceMaterials`。每项只允许稳定的 Knowledge revision 或 ArtifactVersion 引用，带 `purpose` 和可选备注；不允许保存 Workspace input snapshot，因为它属于某次任务或某个工作区的当期事实。
2. 专家配置页从当前工作区的材料候选中选择常用参考。不可读取的候选不可新增，已保存但后来失效的引用仍可被移除；保存不复制内容，也不授予新的工具权限。
3. 召唤专家时，应用把当前 ExpertRevision 的常用参考复制到新 TaskContextRevision 的材料选择中，来源标记为 `expert-reference`。用户可以在任务资料面板移除、补充或调整用途；召唤不创建独立的任务准备向导。
4. 常用参考保留原始内容哈希和来源工作区。Knowledge 修订视为全局参考；ArtifactVersion 只在其来源工作区适用。召唤到其他工作区时不自动注入该成果，用户仍可通过任务里的显式全局搜索来源跨工作区选择；任务材料校验继续拒绝伪造或过期引用。
5. Expert copy 复制常用参考的稳定引用，但不复制任务历史、记忆、凭据、信任授权或当期输入。若引用在下一次运行前失效，发送边界报告具体材料冲突，用户可以先移除或重新选择。

## 实现边界

- 协议字段是 `ExpertRevisionDraft.referenceMaterials`，以 JSON 列存于 `expert_revisions.reference_materials_json`；应用库迁移 v20 为旧行填充空数组。
- ExpertRepository 在读取时重新解析引用；ExpertService 的幂等比较包含引用列表，避免内置专家启动注册丢失或重复追加配置。
- TaskMaterialService 在保存和启动前执行版本、哈希、归属和可读性校验；此字段不是提示词约定，也不是对文件系统的原生沙箱。
- 运行时仍只使用 TaskContextRevision 产生的材料快照。常用参考没有单独的运行时旁路，也不会自动带入后续任务的所有对话内容。

## 取舍与后续

这项设计让稳定参考材料和当期事实分开，既支持“召唤即开始工作”，又保留逐任务可审计、可收缩的材料范围。ArtifactVersion 的适用范围由来源工作区决定；后续如需按 Expert×Workspace 管理更细的默认参考，应新增协议和迁移 ADR，不把当前引用字段扩展成隐式全局材料权限。
