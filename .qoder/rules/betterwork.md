---
trigger: always_on
---

# 算台 BetterWork 开发纪律（常驻规则）

仓库宪法是 [AGENTS.md](../../AGENTS.md)（产品边界、架构硬约束、领域语言、完成定义），本目录不重复其内容，只补充跨场景的执行纪律与场景规则入口。

## 铁律一：时间纪律

**任何涉及日期、时间的操作，必须先执行 `date` 命令获取系统真实时间，禁止凭印象、会话上下文或系统提示中的日期推断。**

**没有执行 `date` 就写日期 = 违规。没有例外。** 追溯历史事件的时间以 `git log` 时间戳为准。

## 铁律二：中文字符编辑纪律

**编辑含中文的内容（文档、注释、UI 文案、提交信息）后，禁止「改完即认为成功」，必须回读校验。**

事故记录：编辑工具在长中文行上做内联替换时会静默损坏字符——工具返回 success、diff 看起来正常，但文件里已是错字。这类错误不会被 tsc / vitest 捕获，只会以错别字形式留在代码和文档里。

**强制流程**：

1. **改**：单处短中文片段可用编辑工具精确替换；长中文行、批量替换优先整文件重写（Write）或 `sed`，避免长行内联替换。
2. **验**：改完立刻 `grep -n "<被改的中文片段>"` 回读，确认字面正确。
3. **禁**：不得依据工具返回的 success 或 diff 判定中文修改成功；未经回读确认不得进入下一步。

## 工作日志纪律

每完成一次对话任务，当天写一篇 `docs/logs/YYYY-MM-DD.md`（当天已有则追加一节）。模板与要求见 [docs/logs/README.md](../../docs/logs/README.md)。

## 场景化规则索引

| 规则文件 | 触发方式 | 职责 |
| --- | --- | --- |
| [betterwork-diagnosis.md](betterwork-diagnosis.md) | model_decision | GATE-0 缺陷诊断顺序与修复纪律 |
| [betterwork-knowledge.md](betterwork-knowledge.md) | model_decision | Knowledge 只读边界与索引纪律 |
| [betterwork-ui.md](betterwork-ui.md) | glob: apps/desktop/src/renderer/**/*.tsx,ts,css | Renderer UI 与主题 Token 纪律 |
| [betterwork-dev-cycle.md](betterwork-dev-cycle.md) | model_decision | 应用启停、验证与提交纪律 |
| [betterwork-ipc-artifact.md](betterwork-ipc-artifact.md) | model_decision | IPC 协议、持久化与 Artifact 版本纪律 |
