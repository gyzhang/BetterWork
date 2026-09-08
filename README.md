# 算台 BetterWork

<p align="center"><img src="docs/assets/betterwork-logo.svg" width="96" alt="算台 BetterWork 标志" /></p>

<p align="center"><strong>以我所知，成我所作</strong></p>

算台（BetterWork）是一款面向知识工作者的个人 AI 工作台：它理解并调用你的资料、记忆与工作方法，帮你完成研究、分析、文档与演示。

算台优先服务个人实际工作，先用于自用，再供周边同事使用；当前不以企业管理、组织提效或市场化为目标。教学经验从实际建设中总结，不再作为产品可用性的前置约束。

算台是面向个人知识工作的 AI 工作台。用户通过配置化专家调用多项 Skill，结合长期工作目录、个人知识与协作积累，在持续讨论中完成研究、分析、文档和演示，并让成果成为后续工作的基础。

已确认开发顺序：**Skill 管理与配置 → 专家管理与配置 → 研究到汇报完整路径**。基础配置范围与验收建议见 [产品修订稿](docs/reviews/2026-09-08-product-scope.md)。阶段 A 必须支持首个脚本型 PPT Skill，包含 Python/CLI、外部工具链及真实生成校验，见 [运行边界](docs/reviews/2026-09-08-skill-runtime-boundary.md)；这些是待实现能力。

## 产品定位

算台的核心不是聊天，而是工作成果：

- 有来源、有证据的研究报告
- 可复核、可继续加工的数据分析
- 符合模板和风格要求的 Word 文档
- 逻辑完整、视觉稳定的演示文稿
- 可预览、可修改、可回退的 Artifact

聊天是协作入口，Artifact 是主要交付物。

Skill 配置将提供受信任选项：内置 Skill 默认信任，导入项由用户授权，已授权范围内脚本无需反复确认。产品通过本地目录携带完整 Skill，个人修改保存在用户副本，升级不覆盖。详见 [信任与分发规则](docs/adr/0011-skill-trust-and-local-distribution.md)（已确认、待实现）。

## 核心原则

- **Local-first**：知识、索引和工作成果由用户在本地管理；源资料默认只读，算台只建立可重建的索引。
- **Artifact-first**：对话服务于工作，重要结果沉淀为可版本化的成果。
- **Evidence-backed**：检索与联网搜索的结果按运行去重登记为可回溯证据，并与成果版本关联。
- **Human-in-the-loop**：在大纲、口径、危险工具和最终交付处提供确认点。
- **Progressive disclosure**：过程信息按用户目标分组呈现，原始运行事件不作为主界面内容。
- **Engine-agnostic**：Agent Core 不依赖 Electron、React、SQLite 或任何一家模型厂商 SDK。
- **确定性计算优先**：数值计算交给工具，模型负责理解、规划与解释。
- **Start small, grow cleanly**：功能从简单起步，领域边界从长期产品目标出发。

## 当前能力

项目已完成 Phase 0 与原 Phase 1 的部分知识库、搜索和 Markdown 成果能力。2026-09-08 已调整后续开发顺序，Skill 与专家配置尚未实现。已经可用：

| 领域 | 能力 |
| --- | --- |
| 任务与执行 | Workspace / Task / Session / Run 均有独立持久化标识；流式回复、工具调用卡片、取消执行、按任务回看历史运行与完整事件 |
| 本地知识库 | 导入 Markdown / Text / PDF / DOCX（单文件上限 20 MB），记录源路径与内容哈希；PDF 按页、DOCX 按段落建立 SQLite FTS5 索引；可检索、刷新索引、移出索引、用系统应用打开原文——不修改也不删除源文件 |
| 联网搜索 | 搜索引擎配置（百度千帆 AI 搜索先行），启用后智能体可调用 `web_search`，网页引用落为可回溯证据 |
| 智能体工具 | `calculator`（确定性四则运算）、`read_text_file`（受工作区路径限制）、`knowledge_search`（只读）、`web_search` |
| 证据与成果 | 检索结果自动登记为 Evidence；任务回复可保存为版本化 Markdown Artifact，支持文档化预览、版本历史、人工修订（`user-edit`）、导出 `.md`，并持久化每个版本实际使用的来源 |
| 模型配置 | 语言 / 视觉 / 嵌入三种角色，可保存、启停、按角色设默认与真实连通性测试；Fake Provider 与 OpenAI-compatible Provider（SSE 流式，支持推理增量与工具调用增量拼接） |
| 消息中心 | 三层反馈——页面内联提示 / Toast（同页抑制）/ 消息中心持久留档（200 条滚动上限），通知可点击跳转到对应任务、成果或知识页；窗口失焦时任务终态发系统通知 |
| 外观 | `system / light / dark` 三种模式 × 青玉、纸墨、远洋、暖砂四套成对色系，启动前恢复、跟随系统变化、同步 Electron 标题栏 |

尚未实现（按 [路线图](docs/07-mvp-and-roadmap.md) 分阶段建设）：Embedding 与混合检索、正文 Claim/Citation、大纲确认、网页正文抓取、XLSX/PPTX 解析及 DOCX/XLSX/PPTX Artifact、长期记忆、专家 / Skill / 套件、Python Worker。

## 架构

依赖方向是单向的：

```text
Renderer -> Preload API -> Application -> Agent Core / Infrastructure
                                      -> Tool Runtime
```

- **Agent Core** 通过 `AsyncIterable<AgentRuntimeEvent>` 输出有序事件，不导入 Electron、React、SQLite 或模型厂商 SDK。
- **Application 层**（`apps/desktop/src/main/`）先持久化、再广播；UI 不是事件的唯一消费者。
- **Renderer** 不直接访问 Node.js、文件系统、数据库或模型服务；Preload 只暴露最小类型化 API，保持 `contextIsolation` 与 `sandbox` 开启。
- **IPC** channel、输入与输出全部在 `packages/agent-protocol` 中定义，并在边界用 Zod 校验。
- **SQLite** 是产品状态真相源；缓存、索引和预览都可重建。

```text
BetterWork/
├── apps/desktop/
│   └── src/
│       ├── main/
│       │   ├── index.ts       # 只做装配与生命周期，不含业务逻辑
│       │   ├── db/            # 连接、PRAGMA 与版本化迁移
│       │   ├── persistence/   # 按聚合拆分的 Repository 与 AppStore
│       │   ├── services/      # 运行编排、通知、资料库、搜索、连通性探测
│       │   └── ipc/           # 全部 channel 注册与边界校验
│       ├── preload/           # 最小化、类型化的 Renderer API
│       └── renderer/
│           ├── views/         # 页面级视图（不含 IPC 调用）
│           ├── components/    # 跨视图复用组件
│           ├── hooks/         # 内聚状态簇
│           └── lib/           # 无状态纯函数与常量
├── packages/
│   ├── agent-protocol/    # 跨进程协议、领域类型、Zod Schema 与 IPC channel 的唯一入口
│   ├── agent-core/        # Agent Loop、Model Provider 接口与统一错误词汇
│   └── tool-runtime/      # 可测试的确定性工具实现
├── scripts/               # 带 PID 与日志管理的开发启停脚本
└── docs/                  # 产品、架构、UI 规范、工程规范、ADR 与按天工作日志
```

技术栈：Electron + electron-vite、React 19、TypeScript strict（含 `noUncheckedIndexedAccess` 与 `exactOptionalPropertyTypes`）、better-sqlite3（FTS5）、Zod、react-markdown、pdf-parse、mammoth、Vitest，风格与质量由 ESLint（含类型感知规则）与 Prettier 强制。界面使用手写 CSS 加语义化主题 Token 与自建内联 SVG 图标集，不引入样式框架、通用图标库或全局状态库——取舍理由见 [系统架构](docs/03-system-architecture.md) §10，目录与命名约定见 [工程规范](docs/12-engineering-standards.md) §2。

## 本地开发

要求 Node.js 22.12 或更高版本。

```bash
npm install
npm run setup:runtime   # 安装 Electron 二进制并对 better-sqlite3 做原生重建
npm run dev
```

首次克隆或切换 Node 版本后必须执行 `setup:runtime`。

也可以使用带 PID 和日志管理的开发脚本：

```bash
npm run dev:start
npm run dev:stop
```

默认日志和 PID 文件分别位于 `/tmp/betterwork-dev.log` 与 `/tmp/betterwork-dev.pid`，也可以通过 `BETTERWORK_DEV_LOG`、`BETTERWORK_DEV_PID` 覆盖。请只用这两个脚本启停应用，不要绕开脚本直接启动 Electron，也不要用宽泛的进程匹配杀进程——那会误伤机器上的其他 Electron 应用。

提交前执行完整验证（lint + 格式校验 + 类型检查 + 单元测试 + 构建）：

```bash
npm run verify
```

当前覆盖 20 个测试文件、131 个测试，ESLint 全仓零错误。构建会产生两条来自 Zod 的 Rollup `@PURE` 注释警告，属已知警告，不影响构建成功。

> 不要把 `npm run verify` 的输出接管道后只看末尾：管道的退出码取最后一个命令，`npm run verify | tail` 永远是 0，会把失败读成成功。需要截取输出时用 `npm run verify > /tmp/verify.log 2>&1; echo $?`。

代码风格由 Prettier 与 ESLint 统一强制，全仓只有一套规范——不允许按目录、按文件或按智能体另立风格。规则的理由、目录约定、命名与错误处理纪律写在 [工程规范](docs/12-engineering-standards.md)，`eslint.config.mjs` 与 `.prettierrc.json` 是它的可执行形式；ESLint 管不到的跨文件约定（配置唯一性、分层边界、主题 Token 纪律）由 `standards/coding-standard.test.ts` 守卫，同样跑在 `npm test` 里。日常可用的命令：

```bash
npm run lint        # 或 npm run lint:fix
npm run format      # 或 npm run format:check
```

> 冷 Vite 缓存下首次运行 `npm test`，知识库的 PDF 与 DOCX 两个用例需要现场转换依赖，因此已显式提高超时；若仍失败请先重跑一次确认。

未配置模型时使用 Fake Model Provider，事件顺序与工具行为可稳定复现。输入 `计算: (12 + 8) * 3`、`读取: README.md` 或 `搜索知识: 市场` 可以观察一条完整执行链路；在设置中配置一个 OpenAI-compatible 语言模型后即切换到真实模型。

应用数据存放在 Electron 的 `userData` 目录下（应用状态库与知识库各一个 SQLite 文件），都是本地运行数据，不会也不应提交到 Git。模型与搜索的 API Key 明文存于本地 SQLite，仅主进程可用，列表接口只返回「是否已配置」；日志与错误信息不输出密钥。

## 文档导航

- [文档总览](docs/README.md)与阅读约定
- [产品定义](docs/01-product-definition.md)
- [领域模型](docs/02-domain-model.md)
- [系统架构](docs/03-system-architecture.md)
- [知识库与记忆](docs/04-knowledge-and-memory.md)
- [Tool、Skill、专家与套件](docs/05-capability-system.md)
- [研究与 Office 工作流](docs/06-knowledge-workflows.md)
- [MVP 与路线图](docs/07-mvp-and-roadmap.md)
- [品牌与视觉方向](docs/08-brand.md)
- [参考项目与借鉴边界](docs/09-reference-projects.md)
- [UI/UX 体系与落地计划](docs/10-ui-ux-system.md)（界面设计真相源）
- [Qoder 开发交接](docs/11-qoder-handoff.md)（**当前实现基线、代码地图与已知缺陷**）
- [工程规范](docs/12-engineering-standards.md)（**全仓唯一的代码规范**，配置即执行形式）
- [架构决策记录](docs/adr/README.md)
- [工作日志](docs/logs/README.md)

## 开发约束

仓库内的 [AGENTS.md](AGENTS.md) 是所有开发工作的持续约束：产品边界、架构硬约束、领域语言与完成定义。开始任何任务前，应同时阅读它和对应的产品、架构文档；实现与文档冲突时，先修正文档或新增 ADR，不得静默偏离。

`.qoder/rules/` 下的分层规则由 Qoder 自动加载（常驻铁律加按场景触发），其他编码智能体按 AGENTS.md 的任务路由读取同一套约束，保持单一规则源。每完成一次任务，当天在 `docs/logs/` 追加一篇工作日志。

## 许可

[MIT](LICENSE)
