# ADR-0048：对话内联 ECharts 图表渲染

- 状态：Proposed（2026-10-11 设计定案；已按用户开工指令完成代码实现与自动化测试，ADR 接受状态与人工验收待用户确认）
- 日期：2026-10-11
- 背景：算台回复里需要把经营分析、研究结论等数据以图表呈现。当前对话输出只能走 `MarkdownPreview`（`react-markdown` + `remark-gfm`）渲染文本、表格与代码块，图表能力为绿地——全仓无 `echarts`/`d3`/`plotly`/`recharts`/`chart.js` 任何依赖。数据侧已有确定性工具 `calculator`（`packages/tool-runtime/src/calculator.ts`）与 `analyze_business_metrics`（`packages/tool-runtime/src/business-metrics.ts`）产出结构化数值，但这些数值目前只能以文字或 Markdown 表格出现。用户要求先解决「模型能在对话里画出一张图」这一件事，图表成为可保存/可版本化的成果（Artifact）不在本次范围。
- 关系：延续 [ADR-0013](0013-slide-preview-rendering.md)「能由 Renderer 就地渲染的绝不外派子进程」的哲学；落实 [ADR-0020](0020-deterministic-business-analysis.md) 的确定性数值边界（数据来自工具而非模型心算）；遵守 [ADR-0003](0003-agent-core-boundary.md) 进程边界（渲染只发生在 Renderer，不触主进程、文件系统或模型服务）；反馈落点遵循 [ADR-0006](0006-notification-feedback.md) 与 `docs/10-ui-ux-system.md` §11.5.1（错误用 `InlineError` 基座，不进消息中心）；不改变 [ADR-0005](0005-artifact-version-evidence.md) 的成果与版本契约。

## 决策

1. **范围＝对话内联渲染，不做成果化。** 本 ADR 只解决「模型回复正文里的一张图就地渲染」。图表**不**新增 Artifact 类型、**不**进 `agent-protocol` schema、**不**触发持久化迁移、**不**出现在成果面板与版本谱系。把图表沉淀为可保存、可版本化、可导出的成果牵动协议、存储与 UI 治理白名单，是独立议题，列为后续、需另行设计与 ADR。

2. **三层分工，正交解耦。**
   - **生成层（模型）**：模型在回复正文里直出 ```` ```echarts ```` 围栏代码块，围栏内是一段 ECharts `option` 的 **JSON**。生成靠模型直出围栏，不新增「让模型描述图表再由代码拼装」的中间 DSL。
   - **数据层（确定性工具）**：图表所依赖的数值仍由既有确定性工具产出——`calculator` 做算术、`analyze_business_metrics` 做期间变化与预算偏差（ADR-0020）。模型负责把工具结果映射进 `option`，**不得心算、补齐缺失值或伪造比例**。本 ADR **不新增任何出图工具**：数据与视觉是正交两层，工具只负责产出确定性数据，不负责画图。
   - **渲染层（Renderer）**：新增 Renderer 侧 React 组件 `EChartsBlock`，解析围栏内的 `option` JSON，用 `echarts` 依赖在 Renderer 进程的 canvas/SVG 上就地渲染。接入点是 `markdown-preview.tsx` 的代码块渲染：现有 `CodeBlock`（注册为 `components.code`）按 `language-(\w+)` 取到语言名，`EChartsBlock` 通过 `MarkdownPreview` 已支持的 `componentOverrides` 覆盖 `code`，命中 `language-echarts` 时改走图表渲染，其余语言保持原语法高亮路径不变。

3. **`echarts` 是 Renderer 普通前端依赖，不碰主进程、不碰 managed Node/CF44。** `echarts` 进 `apps/desktop` 的 renderer 依赖，随构建打进 asar，在浏览器进程里执行。**明确不引入 managed-node、不依赖 CF44（Node-based Skill 执行链）**：ECharts 是需要 DOM/canvas/SVG 的浏览器渲染库，Node Skill 是主进程 spawn 的无 DOM 子进程，要它出图反而得再启 headless 浏览器截图，层级错配（详见「为什么不是出图工具」）。

4. **安全立场（不可妥协）：只允许 JSON 子集，Renderer 绝不 `eval` 模型 JS。**
   - 围栏正文只按 **JSON** 解析（`JSON.parse`），只接受 ECharts `option` 中可用纯 JSON 表达的子集：数值、字符串、布尔、数组、普通对象。
   - **禁止**任何函数体、回调（`formatter` 函数、`tooltip.formatter` 的 JS 形式）、`new Date()`、`eval`、`Function` 构造、字符串形式的可执行代码。需要格式化时用 ECharts 支持的**字符串模板**（如 `'{b}: {c}'`），不用函数。
   - Renderer **绝不**把模型输出的任何字符串当作 JS 执行——不 `eval`、不 `new Function`、不注入 `<script>`。这是本 ADR 的红线：模型输出永远是**数据**，不是**代码**。
   - 因为 `echarts` 是打包进 asar 的自执行 JS、渲染在进程内 canvas/SVG 完成、不加载任何外部资源，**不需要改 CSP**（与 ADR-0013 内联 `data:` 图片必须放行 `img-src data:` 的情况不同）。

5. **失败与流式：非法 option 回退代码块 + `InlineError`；围栏闭合后再解析。**
   - **流式期不闪错**：回复是流式拼接的，未闭合的 ```` ```echarts ```` 围栏里的 JSON 必然是残缺的。渲染只在**围栏闭合后**尝试解析；仍在流式、围栏未闭合时按普通代码块呈现，**不**弹 `InlineError`，避免边流边报错的抖动。
   - **终态非法才报错**：围栏已闭合（消息进入终态）后 JSON 仍解析失败、或含被禁止的函数/可执行内容、或 `option` 结构不被 ECharts 接受时，**回退为原始代码块**（用户仍能看到模型写了什么）并在其旁挂 `InlineError`（`danger`/`warning` 档，遵循 §11.5.1），说明「图表无法渲染」及原因。回退而非空白，不静默吞掉。
   - `EChartsBlock` 渲染本身抛错（如运行时异常）走同一回退路径：代码块 + `InlineError`，不 crash 整条消息。

6. **不新增 Artifact 类型、不动协议与持久化。** 图表只是回复正文的一种呈现，随消息内容一起持久化在既有 Run/Message 记录里（就是那段 Markdown 文本），不引入新的存储实体、不进成果面板、不参与导出与版本谱系。

## 为什么不是「echarts 出图工具」/ Node Skill

一个诱人的错误方案是：新增一个内置工具或 Skill，在服务端/子进程用 ECharts 出图（PNG/SVG），再把图片塞回对话。它错在层级：

- **ECharts 是浏览器渲染库**，运行需要 DOM、canvas/SVG 与布局引擎。主进程 spawn 的 Node Skill 子进程没有 DOM，要出图就得再拉一个 headless 浏览器（Puppeteer 之类）截图——为一个「对话里画张图」的需求引入一整个浏览器运行时，与 ADR-0013 明确否决的「LibreOffice headless 截图」是同一类过度工程。
- **Renderer 本来就有画布**。图就在用户眼前的浏览器进程里渲染，零外部进程、零临时文件、零 IPC 图片往返，还能天然跟随 light/dark 外观与响应式尺寸。
- **出图工具会把「数据」和「视觉」耦进一层**，违背 ADR-0020 的正交分工：确定性工具只该产出数值，视觉编码属于呈现层。

结论：**能由 Renderer 画的绝不外派子进程**，与幻灯片预览走进程内渲染的哲学一致。

## 被否决的替代方案

- **新增 `render_chart` 内置工具 / Node Skill 出图**：见上，层级错配、引入 headless 浏览器、耦合数据与视觉。
- **让模型直出 SVG/`<img>` 内联**：模型手写 SVG 不可控、无法交互、且把渲染保真度压在模型身上；内联 `<img src>` 又回到 ADR-0013 的 CSP/`data:` 复杂度，且失去 ECharts 的交互与主题能力。
- **自定义图表 DSL 再由代码翻译成 ECharts option**：多一层需要维护的中间语言，且限制表达力；直接用 ECharts option 的 JSON 子集即可，模型对 ECharts option 已有充分先验。
- **允许完整 JS option（含 formatter 函数）**：直接违反安全红线——等于让 Renderer 执行模型写的任意 JS，坚决不做。
- **本次顺带把图表做成 Artifact**：牵动协议、迁移与 UI 治理，超出「内联渲染」范围，明确推迟。

## 已知代价与后续触发条件

- **表达力受 JSON 子集限制**：需要函数回调的高级格式化（动态 tooltip、自定义 formatter 逻辑）暂不支持，只能用字符串模板。若后续确有需求，须在**不放开 `eval`** 的前提下设计受限的声明式格式化，另行记录，不得以「方便」为由破红线。
- **inline 图表的外观归属**：内联图表是对话消息面的一部分，应随应用 light/dark 外观与色系协调（文字、轴线等），这与「应用主题不得改变 Artifact 自身图表配色」不冲突——本 ADR 的图表不是 Artifact。具体 Token 与主题映射遵循 `docs/10-ui-ux-system.md`，实现时按 UI 治理白名单落地。
- **成果化是后续独立议题**：一旦要把图表沉淀为可保存/可版本化/可导出的成果，即触发 `agent-protocol` schema、持久化迁移、成果面板 UI 与 UI 治理白名单变更，须新设计 + 新 ADR，不在本记录内 implied。
- **依赖体积**：`echarts` 进 renderer bundle 会增加包体，按需引入（只 import 用到的图表类型与组件）以控制体积；这是常规前端优化，不构成新的架构选择。

## 验收要求

- 模型回复里的 ```` ```echarts ```` 围栏，在围栏闭合后能在对话内就地渲染为图表；非 echarts 语言的代码块渲染路径不受影响（仍走语法高亮）。
- 图表数据来自确定性工具（`calculator`/`analyze_business_metrics`）而非模型心算；缺数按 ADR-0020 的失败语义处理，不伪造。
- 非法 JSON、含函数/可执行内容的 option、ECharts 拒绝的结构，三类失败均**回退为代码块 + `InlineError`**，不空白、不 crash 整条消息；错误不落消息中心（走 `InlineError` 基座）。
- 流式过程中未闭合的围栏按代码块呈现，**不闪 `InlineError`**；闭合后才尝试解析。
- Renderer 全程不 `eval`、不 `new Function`、不执行任何模型输出字符串；该红线由代码审查与针对性测试守住（对含函数/脚本的 option 断言被拒绝）。
- 图表在 light/dark 与全部色系下文字与图形可辨识；不改变任何 Artifact 自身配色。
- `echarts` 只作为 renderer 依赖存在于 `apps/desktop`，主进程与 managed Node 不引入该依赖；未配置 Python/Node Skill 运行时的机器上，内联图表仍可用。
