# LobsterAI 内置 Skill 与 Expert 借鉴评估

- 审阅日期：2026-10-15；时间取自本机 `date`。
- 参考快照：`/Users/kevin/Dev4AI/LobsterAI`，`main`，提交 `e8f80e566bb4c415fb337e7f5485e25ce80f12ea`（包版本 `2026.10.13`；检查时工作树干净）。
- 本报告是内容与产品形态分析，不是采纳或开工授权；未改 BetterWork 的路线图、ADR、实现或发布清单。

## 1. 结论

LobsterAI 的主要参考价值是**如何把若干 Skill 组合成可发现的重复工作角色**，以及 Office Skill 对模板保留、格式检查和结果校验的关注。建议吸收这些产品思路与方法主题，按 BetterWork 自己的来源、材料、成果版本与运行授权边界重新设计；不建议移植仓库里的完整 Skill 目录、提示词或运行时结构。

配置清单有 29 个 Skill ID，其中 27 个默认启用、2 个默认关闭；README 写的是 28 个，数字不一致。静态预设有 6 个 Agent。另有一类叫 **Expert Kits** 的能力包，和预设 Agent 不是同一个对象。LobsterAI 当前以 OpenClaw 为运行时，因此其资源和配置不能直接当作 BetterWork 的实现方案。

BetterWork 的 2026-10-15 路线图明确要求两份内置资源清单保持为空，后续内置内容须重新挑选并单独纳入发布清单。因此下面只列候选，没有代替用户恢复或选入任何内置资源。

## 2. LobsterAI 内置资源概况

### 2.1 Skill 分类

| 类型 | Skill ID | 对 BetterWork 的相关性 |
| --- | --- | --- |
| Office 文件 | `docx`、`xlsx`、`pptx`、`pdf` | 与文档、表格、演示交付最接近；重点参考工作流要求，不能复制受限资源。 |
| 搜索、写作与领域资料 | `web-search`、`content-planner`、`article-writer`、`daily-trending`、`stock-analyzer`、`stock-announcements`、`stock-explorer`、`films-search`、`music-search`、`technology-news-search`、`weather` | 体现从搜集、筛选到写作的组合；多数依赖特定网站、外部服务或领域场景。 |
| 视觉、媒体与创作 | `remotion`、`seedance`、`seedream`、`canvas-design`、`frontend-design`、`develop-web-game` | 能力范围较宽，当前 BetterWork 的研究、分析、报告与演示主路径不需要一次纳入。 |
| 工作流与外部接入 | `playwright`、`create-plan`、`local-tools`、`imap-smtp-email`、`youdaonote`、`skill-vetter`、`skill-creator` | 可参考其特定场景流程；本机、邮件、云笔记和计划类工具应按 BetterWork 已接受的范围逐项核对。 |
| 外观定制 | `skin-creator` | 默认关闭，和 BetterWork 的工作成果主路径关系较弱。 |

目录中的 29 项均有对应 `SKILL.md`；两项默认关闭的是 `skin-creator` 与 `technology-news-search`。除逐个目录内的许可证以外，还需核对脚本、依赖、数据源和外部服务，不能仅凭 Skill 名称判断可分发或可运行。

### 2.2 预设 Agent

LobsterAI 的 6 个预设使用双语名称/说明、身份描述、系统提示词和明确的 Skill ID 列表；用户选择后将模板写成一个本地 Agent。它们的绑定如下：

| 预设 | 绑定 Skill | 判断 |
| --- | --- | --- |
| 股票助手 `stockexpert` | `stock-analyzer`、`stock-announcements`、`stock-explorer`、`web-search` | 很好地展示一个角色编排多项能力；投资建议和实时行情依赖不适合作为 BetterWork 默认样本。 |
| 内容创作 `content-writer` | `content-planner`、`article-writer`、`daily-trending`、`web-search` | 展示选题→撰写→资料补充的连续工作；公众号热文与热搜数据源较产品特定，可提炼工作步骤。 |
| 备课出卷专家 `lesson-planner` | `docx`、`xlsx`、`web-search` | 展示一个专家跨 Word/Excel Skill 完成输出；教育领域需明确教材、课标和适龄审核边界。 |
| 内容总结助手 `content-summarizer` | `web-search` | 摘要结构清楚，但描述涉及音视频、链接和文档；应先逐项验证产品实际输入能力，再采用类似承诺。 |
| 医疗健康解读 `health-interpreter` | `web-search` | 高风险领域；角色描述接近全科医生，而绑定只有通用搜索，不建议照搬。 |
| 萌宠管家 `pet-care` | `web-search` | 有清晰的宠物健康升级就医提示，但场景偏离 BetterWork 当前主目标。 |

这组样本证明“一个 Expert 绑定多个 Skill”有清楚的用户价值，但也提示需要逐项核对角色说明、Skill 绑定、真实工具和风险约束是否相符，不能仅凭完整的提示词让样本看起来可用。

### 2.3 Expert Kits 是另一类产品对象

LobsterAI 文档把 Expert Kit 定义为可单独安装、选择的能力包，最初以一组 Skills 为主；当前实现还将目录从远端商店获取，并存在 Computer Use、AI Skin Designer 等内置 Kit 路径。它们不是 Agent 模板，也不是单个 Skill。

BetterWork 的 Expert 已承担重复工作角色、Skill/工具预设与偏好；任务再选择本次材料，Run 固定实际配置与来源。另建“专家套件”会增加并行的能力打包和选择概念，现阶段不建议吸收这层产品形态。

## 3. 候选吸收项

| 候选 | 建议 | 原因与适配方式 |
| --- | --- | --- |
| 多 Skill 的 Expert 组合 | **优先吸收组合方法** | 参考 `content-writer`、`stockexpert`、`lesson-planner` 的角色与技能绑定方式。BetterWork 应绑定已发布且真实可用的 Skill；本次材料仍由 TaskContext 选择，不把 Expert 预设当作材料授权。 |
| 研究与汇报专家 | **优先讨论首批 Expert 候选** | 更贴近 BetterWork 既定的研究、分析、报告、可编辑 PPT 路径。可参考 `content-summarizer` 的摘要层次和 `content-writer` 的阶段拆分，但重写为来源可追溯、事实与推断分开、成果版本可继续使用的 BetterWork 流程。 |
| Office 生成与校验方法 | **随 Office 能力成熟分批设计** | 参考其按创建/读取/编辑分流、保留用户模板、检查公式/结构和输出可编辑文件的关注点。由 BetterWork 自有实现与兼容样本验证，不复制 LobsterAI Skill 资源。 |
| 摘要、纪要与行动项 | **可作为 Expert 方法，不急于独立成 Skill** | 一句话结论、要点、分段摘要、行动项，以及区分事实和观点，适合作为输出约定；若没有独立可执行能力，放进 Expert 方法比新增一个泛提示型 Skill 更清楚。 |
| Skill 质量检查/创建流程 | **后续可研究** | `skill-vetter` 展示来源、脚本、权限和依赖的检查清单；`skill-creator` 展示草稿、样例、评估、迭代的循环。它们可启发本产品的检查/验收流程，但静态检查不能证明脚本安全，也不能替代 BetterWork 的信任、授权、撤销机制。 |
| Expert Kit 商店 | **暂不吸收** | 和 BetterWork Expert 的能力预设存在重叠，会扩张概念与安装范围；若未来确定需要统一分发多类资产，应先做产品设计和 ADR。 |
| 股票、医疗、宠物等垂直专家 | **暂不作为默认内置** | 行业数据、专业责任和用户材料要求不同；医疗与投资尤其需要单独的准确性与风险治理。 |

### 授权与内容来源限制

`docx`、`xlsx`、`pptx`、`pdf` 目录的许可证标为 Proprietary，且明确限制复制、制作衍生作品和再分发。它们的具体说明、脚本、资产不能作为 BetterWork 内置资源或改写底稿。可以观察到它们覆盖的任务类别和质量目标；BetterWork 的 Skill 正文与实现必须根据自己的已接受需求独立编写。

`skill-creator` 目录含 Apache-2.0 许可证；其他目录需逐项审核其 `LICENSE`、来源、依赖和数据服务。不能把一个目录的许可证推断到整个 29 项清单。

## 4. 我建议的候选顺序

1. **先挑一个端到端 Expert 样本**：围绕“研究分析与汇报”选定角色目标、真实绑定的 Skill/工具和输出；延续 Expert 负责工作方式、Task 负责本次材料、Run 记录实际执行与来源的既定模型。
2. **再挑一个能独立复用的 Skill**：优先从真实可执行、能形成成果或提供可核验方法的工作出发；Office 资源按实际支持的输入、模板、依赖、质量报告逐步纳入。
3. **把摘要结构作为候选方法**：可嵌入首个 Expert，先不因为一个输出格式就新增 Skill。
4. **最后评估垂直样本与能力包**：内容营销、教育、金融、医疗等需由目标用户和数据/责任边界决定；Kit 商店暂不进入当前范围。

特别说明：BetterWork 的路线图当前要求空白发布清单。提交 `4167ed53` 清空前，随包样本是 `builtin-research-analyst` Expert、`builtin-business-analysis` Skill 和 `builtin-sample-assistant` Skill；专家任务板对经营分析方法与研究分析预设的记录不等同于当前仍随包分发。重新挑选时不应把这三项视作已自动获准恢复；应由用户从候选中选定，再更新对应设计/路线图与发布清单。

## 5. 证据位置

- LobsterAI 技能目录与默认启用状态：`/Users/kevin/Dev4AI/LobsterAI/SKILLs/skills.config.json`。
- LobsterAI 预设 Agent 定义和多语言转本地 Agent 的转换：`/Users/kevin/Dev4AI/LobsterAI/src/main/presetAgents.ts`、`/Users/kevin/Dev4AI/LobsterAI/src/main/agentManager.ts`。
- LobsterAI README 对 Expert Kits、28 个 Skill 的描述：`/Users/kevin/Dev4AI/LobsterAI/README.md`；Expert Kit 设计：`/Users/kevin/Dev4AI/LobsterAI/specs/features/kit/2026-05-27-kit-marketplace-design.md`。
- BetterWork 空清单决策：`docs/07-mvp-and-roadmap.md`；Expert 与材料模型：`docs/designs/experts-and-task-materials.md`；脚本 Skill 兼容与用户模板边界：`docs/adr/0009-script-skill-baseline.md`；信任和内置分发边界：`docs/adr/0011-skill-trust-and-local-distribution.md`。
