# 首个内置「研究与汇报」Expert 与「PPT 生成」Skill 内容提案

- 日期：2026-10-15。
- 状态：**用户已选定内容并授权实施；当前分支已登记 Skill/Expert 资源并通过定向发布回归，安装包与人工端到端验收待完成。**
- 依据：[LobsterAI 内置资源借鉴评估](2026-10-15-lobsterai-builtin-skills-experts.md)、[路线图](../07-mvp-and-roadmap.md)、[专家与任务材料设计](../designs/experts-and-task-materials.md)、[技能执行器与依赖设计](../designs/skill-executor-and-dependencies.md)、[ADR-0009](../adr/0009-script-skill-baseline.md)、[ADR-0011](../adr/0011-skill-trust-and-local-distribution.md)。

## 1. 已选方向

首个内置 Expert 暂以「研究与汇报」为工作名称。它使用用户在当前 Task 中选择的内部材料，并可在公开搜索配置可用时补充网页来源，最终交付有依据的报告；用户可继续从报告生成可编辑 PPT。

首个独立 Skill 现选择用户提供的 `/Users/kevin/Dev4AI/ppt-expert` 包：`skillId` 为 `ppt-generation-expert`，包版本 `v20261007.5`，其 `LICENSE` 标为 MIT。用户确认整个 Skill 包可随 BetterWork 分发，并说明 README 中「仓库私有、不得公开或转发」的限制已过期；公司模板也可随包分发。上轮提出的抽象「PPT 生成」是能力方向，不另建一份重复 Skill。

该 Skill 当前定位为使用已登记的中电金信模板创建新演示文稿；不承诺任意模板，也不支持对已有 PPTX 原位修改。已将完整包复制至 `resources/skills/ppt-generation-expert/`，包含 76 个文件、约 22.47 MiB，低于 50 MiB 导入上限；其中保留了 Python wheelhouse、模板、质量工作流、测试、README 与 MIT 许可。发布副本的 README 已移除过期的私有分发限制和作者机器 Python 绝对路径，源目录未修改。Skill 依赖 CPython 3.12，并要求外部注册/绑定 `ppt-master` 6.6.0 工具链。`/Users/kevin/Dev4AI/ppt-master` 当前源码 HEAD 与包中锁定 commit `680de11f1bef4628b68d5daad9dffec569fbd51f` 一致；它没有放进发布包，也没有登记成本机快照，运行前仍需走现有工具链登记和依赖准备流程。

首批仅包含这一组通用 Expert 与 Skill，不加入经营分析工具、其他通用 MCP、行业垂直 Expert 或 Expert Kit。发布资源使用 Skill ID `ppt-generation-expert`、界面名「PPT 生成（中电金信模板）」与 Expert ID `builtin-research-and-reporting`、界面名「研究与汇报」。两份资源清单已加入对应条目，启动注册沿用现有 Skill/Expert 服务。

## 2. Expert 内容草案

### 工作目标

围绕用户提出的研究问题，综合当前 Task 授权的内部材料和可选公开来源，形成可追溯的结论、限制说明和下一步建议。用户确认或修订报告后，可继续制作演示文稿。

### 建议报告结构

1. 摘要与核心发现。
2. 研究问题和范围，包括采用的材料、时间范围及检索条件。
3. 主要发现，标明支撑材料或公开来源。
4. 分开呈现材料事实、外部来源主张、分析推断和建议。
5. 证据不足、来源冲突和待核实事项。
6. 行动建议及来源清单。

来源必须能回溯到实际使用的 Evidence。Evidence 登记不自动等于逐句 Claim/Citation；若要做逐句引用，应另行定义引用数据与呈现契约。

### 能力绑定草案

- Skill：用户提供的 `ppt-generation-expert`（`v20261007.5`）；「PPT 生成」是能力分类，不另造相似资源。
- 内部资料：`knowledge_search`；`read_text_file` 与 `read_office_material` 只处理当前 Task 已选择且运行时允许读取的材料。
- 公开资料：用户已有可用配置时按需调用 `web_search` 与 `web_fetch`。没有可用配置时，Expert 仍可仅基于所选内部材料工作，并明确公开资料未检索。
- 输出：报告沿用现有 Markdown Artifact 版本路径；PPTX 作为版本化文件成果登记，并关联本次实际使用的报告版本和输入材料。
- 不默认绑定：`analyze_business_metrics`、通用 MCP 服务或任意外部写入能力。将来明确出现经营分析或业务连接需求时再单独评审。

## 3. PPT 生成 Skill 内容草案

### 输入和输出

- 输入：一个明确版本的报告 Artifact 和当前 Skill 包内的公司模板。用户已确认该模板可公开发行。
- 输出：标准可编辑 PPTX 文件成果和结构化质量报告。后续修改通过新 Run 生成新版本，不覆盖旧版本；该 Skill 不承诺对已有 PPTX 原位编辑。
- 来源：沿用 Run 实际读取的报告和材料关系。报告中的来源清单可供演示稿呈现；具体到页面或主张的引用形式需后续定案。

### 质量检查目标

- PPTX 包结构可读，主要页面元素为可编辑对象，不是整稿栅格化图片。
- 页面尺寸、文本框、图像和字体等结构检查能给出通过项与警告；适用时发现溢出或缺失内容。
- 可提取的关键数字、单位和期间与输入报告保持一致；检查失败时保留诊断，不登记为成功交付。
- 检查报告说明检查对象、结论和未覆盖项，不把自动布局检查描述成完整的审美或事实正确性保证。

包内已有配色、版式、数据几何三道导出闸门及最终 PPTX 结构校验流程，并要求交付前做视觉检查；接入 BetterWork 时需核对这些报告、产物路径和检查失败如何映射到 Skill command 返回及 Artifact 登记。具体检查字段和视觉验收出口仍需按当前 Run 能力定案。

### 执行和信任边界

- 按现有 Skill Runtime 使用随包/受管 Python 执行路径，包含可锁定依赖、明确输入输出目录、子进程取消与超时处理、质量报告验证及最小 PPTX 产物登记。
- 这属于受信任本地代码执行，不宣称是原生进程沙箱；内置资源信任、启用状态与依赖状态仍彼此独立。
- 用户提供的 `ppt-generation-expert` 原本就是 BetterWork 必须支持的兼容与验收样本；用户现已选它作为首个内置 Skill，并确认整个包可分发，README 的私有发布声明已过期。上游 `ppt-master`、wheelhouse 依赖和其他第三方材料仍需按各自来源核对许可证与分发形式，MIT 文件不能替代第三方许可。
- 不移植 LobsterAI Proprietary Office Skill 内容；LobsterAI Office 目录仍只作为任务类别和质量目标的参考。

## 4. 既定产品边界

- Task 负责本次材料选择；Expert 预设不授予对整个 Knowledge 库或 Workspace 文件夹的隐式访问。
- 公共搜索是可选来源，不应把搜索摘要伪装成已读取的网页正文；具体来源范围由现有配置和 Run 记录决定。
- 摘要、发现和建议中区分证据事实、第三方主张和 Expert 推断；不得编造来源、数字或校验结果。
- 不在首批重新添加 `builtin-research-analyst`、`builtin-business-analysis` 或 `builtin-sample-assistant`。历史实现和验收记录只作参考，不等于新内容已通过审阅。
- 不创建 Expert Kit 商店、自动专家路由、通用 DAG 或新的市场分发概念。

## 5. 实施与待验收

- 内容名称、稳定 ID、工具绑定和默认模型策略已按用户选择写入发布资源。Expert 默认使用应用语言模型，预设上述 Skill，并允许知识搜索、受限的任务材料读取及可用时的网页搜索/读取。`knowledge_search` 复用现有知识检索设置，语义检索已启用且向量索引可用时会使用应用配置的嵌入模型；Expert 本身不重复绑定嵌入模型。
- Skill 的包路径、注册配置、内容 hash、依赖锁、wheelhouse 与模板已纳入资源。预检和内存 SQLite 中的真实 Skill/Expert 注册回归均通过；发布预检与运行时内容 hash 已统一为排除 `betterwork.skill.json` 和 wheelhouse 的同一规则，wheelhouse 每个 wheel 仍由锁中 SHA-256 校验。
- 尚未重建安装包或在桌面应用中用当前模型、百度搜索完成真实 Run；也没有在用户数据中创建 `ppt-master` 快照。后续人工验收需登记匹配的工具链快照、准备 CPython/依赖环境，检查研究报告与 PPTX 是否按现有 Artifact/Evidence 路径登记，并确认错误/超时报告可见。
- 本次没有把外部 `ppt-master` 工具链打包，也未修改 `/Users/kevin/Dev4AI/ppt-expert` 或 `/Users/kevin/Dev4AI/ppt-master` 源目录。源码仓库当前资源已登记，不等于安装包已发布或人工验收完成。
