# 专家与任务材料人工验收脚本

- 日期：2026-09-15
- 对应任务：E55 连续两期真实验收、E56 安装态与整体收尾
- 验收主次：人工走查是功能是否可用的主证据；自动化测试、SQLite 查询和 CUA 操作只提供辅助证据。

## 本轮验收边界

本脚本验证功能链路是否接通：专家召唤、材料选择与用途、运行范围、Skill/内置工具/MCP 绑定、网页来源、成果保存、第二期复用、取消/重启以及安装态资源。不要用内置示例专家的提示词、Skill 文案、人格表现或示例报告的业务质量来判断本轮功能是否完成；这些内容应使用真实业务专家和真实任务另行评审。

## E55 开发态人工走查

使用脱敏或专门准备的测试材料，避免把公司文件复制进仓库。每一步在记录表中填入日期、操作者和 Run ID。

1. 运行 `bash scripts/dev-start.sh`，打开 BetterWork。
2. 进入“专家”，在目标专家卡片点击“召唤”。确认直接进入工作页，当前专家和预设 Skill 已显示，不出现独立的“任务准备”页面。
3. 选择本次允许的工作区。添加三类材料：规则/知识、上一期成果、本期输入。分别设置用途，打开上下文面板，确认三项都显示在当前任务材料中。
4. 在同一任务中补充一个本次允许的外部资料来源（网页搜索/正文，若任务要求 MCP 则再选择一个已配置的 MCP 工具）。开始工作。
5. 只核对功能结果：Run 进入进行中并有可见工具活动；材料读取、网页正文或 MCP 调用有记录；Run 有明确的 completed/failed/cancelled 终态；产生的 Markdown/PPT 等成果可以在“成果”页打开，且详情能看到本 Run 的输入关系。不要以示例专家的回答措辞或数字分析质量作为通过条件。
6. 从第一期成果入口开始新任务，换成本期输入，再次召唤同一专家。确认新 Task、Session、Run 均有新的 ID；上一期聊天没有自动注入新任务；上一期成果按固定版本作为输入显示。再次运行并检查同样的工具活动、终态和成果入口。
7. 在一次长运行中点击“停止”，确认界面显示取消结果；随后用同一任务上下文重新开始，确认新 Run 可以完成或给出明确失败原因，旧 Run 不被覆盖。
8. 如需留存可复核证据，可在应用库执行以下只读查询（不要导出 prompt、API Key 或公司材料正文）：

```sql
SELECT id, task_id, session_id, status, created_at
FROM runs
ORDER BY created_at DESC
LIMIT 10;

SELECT run_id, operation, locator, content_hash, captured_at
FROM run_material_reads
WHERE run_id = '<本次 Run ID>'
ORDER BY captured_at;

SELECT sequence, type, created_at
FROM run_events
WHERE run_id = '<本次 Run ID>'
ORDER BY sequence;

SELECT artifact_version_id, relation_type, run_id
FROM artifact_input_relations
WHERE run_id = '<本次 Run ID>';
```

E55 的人工通过条件是：上述链路能够由用户独立完成，材料和运行范围可见且可追溯，第二期是新的任务运行，取消/重启可恢复，成果可打开。真实业务 MCP 未配置时，必须在记录中标为“未验收”，不能用离线替身冒充真实连接。

## E56 安装态人工走查

1. 先执行 `npm run verify`。
2. 执行 `npm run dist:mac --workspace @betterwork/desktop`，分别对 arm64 与 x64 App 运行：

   ```bash
   npm run expert:preflight -- --packaged-root <BetterWork.app>/Contents/Resources
   ```

   核对内置 Expert、Skill、依赖锁和模板资源存在，且没有开发机绝对路径、数据库、`.env` 或用户成果。
3. 将打包 App 复制到独立目录，使用新的 `--user-data-dir` 启动。按 E55 第 2–7 步至少走一次“召唤 → 材料读取 → 工具/MCP → 成果 → 新任务”。确认开发态配置不会被当作安装态数据使用。
4. 在具备 Developer ID Application 身份后，再执行：

   ```bash
   npm run expert:acceptance-preflight -- --model-url <url> --api-key-env <ENV_NAME>
   npm run expert:preflight -- --packaged-root <BetterWork.app>/Contents/Resources --signed-app <BetterWork.app>
   ```

   最后用 Gatekeeper 可接受的安装包重复第 3 步，并升级到新版本，确认用户专家、Skill、MCP 配置和成果仍在。

当前机器 `security find-identity -v -p codesigning` 返回 0 个有效身份，因此签名安装、Gatekeeper 和升级保留不能在本机标记为完成；这属于外部签名条件，不应由开发态或未签名 App 的通过结果替代。

## 记录表

| 项目 | 人工结果 | 证据 | 操作者/日期 |
| --- | --- | --- | --- |
| 专家召唤直达工作页 | 待填写 | 截图或 Task ID | |
| 三类材料选择与用途 | 待填写 | TaskContext/材料面板 | |
| Skill/内置工具运行 | 待填写 | Run 事件 | |
| 真实网页/MCP 来源 | 待填写 | Evidence/MCP ToolCall | |
| 第一期开成成果 | 待填写 | ArtifactVersion | |
| 第二期独立任务复用 | 待填写 | 两组 Task/Session/Run ID | |
| 取消后重启 | 待填写 | cancelled + 新 Run | |
| arm64/x64 安装态 | 待填写 | 包预检/人工启动 | |
| 签名、Gatekeeper、升级 | 当前受阻 | Developer ID 身份缺失 | |
