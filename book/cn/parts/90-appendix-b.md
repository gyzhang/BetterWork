# 附录 B 代码来源登记

> 本附录登记本书引用的全部参考实现代码，并说明如何逐条核对。**它不是致谢，是复核路径。**

## B.1 参考实现的身份

| 项 | 内容 |
|---|---|
| 项目名 | **BetterWork** |
| 仓库地址 | `https://github.com/gyzhang/BetterWork` |
| 许可 | **MIT** |
| 版权 | Copyright (c) 2026 Kevin Zhang |
| **本书锚定的提交** | `8ce7b7763bd8a79cf0ac917745d6739d6037bee4` |
| 规模（锚定时） | 223 个 TypeScript/TSX 文件、约 50,551 行；77 个测试文件、582 个测试用例 |
| Node 版本要求 | `>=22.12.0`（见根目录 `package.json`） |
| 源码检视时间 | 2026-09-17 至 2026-09-18（Asia/Shanghai） |

**为什么锚定提交号而不是分支名？**因为分支会移动。一条指向 `main` 的链接，三个月后可能指向完全不同的代码。**提交号不会变。**

> **锚定号前移的说明（2026-09-18）**：本书写作期间仓库从 `2d8a79f4…` 前移到 `8ce7b776…`（两个提交：中文稿入库、英文稿入库）。**已核对该区间内 `packages/` 与 `apps/` 下的代码文件零改动**（变更仅为 `book/` 稿件、`docs/logs/` 与 `.prettierignore`），因此全部代码引用在两个提交上同等有效。**这件事本身就是一个教训**：锚定号不是一次写死的——仓库在你写作期间会继续前进，**每轮交付前都要重验一次锚定号与代码的对应关系**。

## B.2 引用约定

本书用三种标注区分三类材料，它们的可信度不同：

| 标注 | 含义 | 你能核到什么程度 |
|---|---|---|
| **参考实现源码** | 锚定提交上的真实代码片段 | 可以。按 B.3 的路径逐条打开 |
| **工作示例** | 合成输入 + 手工推导的预期结果 | 可以复算，但**它不是任何真实模型或客户部署的观测** |
| **教学设计 / 伪代码** | 一个要在隔离实验里自己实现并测试的机制 | 不能核——**它还不存在** |

**片段不是可独立运行的应用。**本书印出的代码片段**刻意取小**：它们所在的完整文件还包含导入、周边校验与集成细节，这些被省略了。**请把片段和它的测试一起读。**

## B.3 引用文件清单

下表是本书引用到的参考实现文件。**路径相对于仓库根目录。**

| 章 | 文件路径 | 它提供什么 |
|---|---|---|
| 0 | `docs/12-engineering-standards.md` | 工具链三层、类型纪律、异步收口与错误词汇、持久化迁移、IPC、测试、例外机制 |
| 19、20 | `docs/03-system-architecture.md` | 依赖方向、应用层与核心层的分离 |
| 5、15、16 | `docs/06-knowledge-workflows.md` | 内容/格式分离与分阶段交付的工作流设计（**设计意图，非可执行实现**） |
| 19 | `package-lock.json` | 实际依赖版本（含 ExcelJS 4.4.0、MCP client 2.0.0） |
| 0、2、3、4、5、9 | `packages/agent-core/src/types.ts` | `ModelProvider` / `AgentTool` / `ToolExecutionContext` / `AgentRunInput` / 流式片段联合类型 |
| 2、4、9 | `packages/agent-core/src/agent-engine.ts` | 消息装配、系统提示、Skill 说明预算、事件工厂、循环与边界、进度转发、终态收口 |
| 4、20 | `packages/agent-core/src/agent-engine.test.ts` | 脚本化与录制式提供方、事件顺序、工具恢复、未知工具、重复调用 |
| 3、14 | `packages/agent-core/src/openai-compatible-provider.ts` | 端点归一化、SSE 装配、分片工具参数聚合、完成信号、超时与取消分类、凭据脱敏 |
| 3、4、13 | `packages/agent-core/src/fake-provider.ts` | 触发词式的脚本化提供方、模拟流式、可取消延时与监听器清理 |
| 3、6 | `packages/tool-runtime/src/calculator.ts` | 手写递归下降解析器、零除检查、结果有限性检查 |
| 0、6 | `packages/tool-runtime/src/business-metrics.ts` | 运行时长校验、期间与预算偏差、零基线标记、绝对值分母 |
| 0、6 | `packages/tool-runtime/src/business-metrics.test.ts` | 精确预期值、缺失指标、取消 |
| 6、11 | `packages/tool-runtime/src/read-text-file.ts` | 规范化路径边界、符号链接处理、截断标记、工厂注入 |
| 11 | `packages/tool-runtime/src/read-text-file.test.ts` | 路径穿越与符号链接逃逸用例 |
| 11 | `packages/tool-runtime/src/read-office-material.ts` | 选定快照与版本身份、定位符、运行时长校验 |
| 14、16、18 | `apps/desktop/src/main/infrastructure/office-parser.ts` | PPTX 分节与表格、XLSX 单元格与公式缓存告警、CSV 解析、格式上限 |
| 7 | `apps/desktop/src/main/services/mcp-client-service.ts` | stdio 传输、发现与绑定分离、schema 校验与指纹、超时分层、生命周期与竞态守卫、输出上限、取消透传 |
| 7 | `apps/desktop/src/main/services/mcp-client-service.test.ts` | 用真实本地替身进程与内存数据库的集成测试 |
| 7 | `scripts/fixtures/mcp-finance-readonly-server.mjs` | 只读的 MCP 测试替身（刻意最小，不是通用 MCP 服务端实现） |
| 8 | `apps/desktop/src/main/services/knowledge-vault.ts` | FTS5 全文检索与 `LIKE` 回退、定位符与内容哈希 |
| 8 | `apps/desktop/src/main/services/knowledge-vault.test.ts` | 检索与回退路径 |
| 9 | `apps/desktop/src/main/services/memory-service.ts` | 四个作用域、生效条件、投影重建、清单路径校验 |
| 9 | `apps/desktop/src/main/persistence/memory-repository.ts` | 状态流转、作用域、有效区间、修订记录 |
| 10 | `resources/skills/business-analysis/SKILL.md` | 内置 Skill 的方法说明（本书用中文原文引用） |
| 10 | `resources/skills/sample-assistant/SKILL.md` | Skill 包的最小骨架 |
| 10 | `resources/skills/release-manifest.json` | 内容哈希、能力哈希、依赖指纹、范围哈希、输出契约 |
| 10 | `apps/desktop/src/main/services/skill-dependency-service.ts` | 环境三元组、先探测后操作、操作收口、错误码、信任检查、取消汇合超时 |
| 10 | `apps/desktop/src/main/services/expert-service.ts` | 专家配置校验与修订 |
| 10 | `docs/05-capability-system.md` | 能力体系的分层设计（**设计文档，非可执行实现**） |
| 12 | `apps/desktop/src/main/services/discussion-checkpoint-service.ts` | 检查点的五道归属校验 |
| 12、15 | `apps/desktop/src/main/services/file-artifact-service.ts` | 登记前的四层校验、事务内复查授权、幂等键、内容与报告双哈希、不可变落盘、失败清理、派生缓存版本标记 |
| 12 | `apps/desktop/src/main/services/file-artifact-service.test.ts` | 字节被改、跨运行输出、撤销、重复登记、预览失效 |
| 4、12 | `apps/desktop/src/main/services/run-service.ts` | 能力解析、上下文装配、事件持久化、清理、产物处理、宿主级失败收口 |
| 2、4、12、13 | `packages/agent-protocol/src/index.ts` | 跨进程协议、运行时事件词汇、输入输出的 Zod Schema |
| 2、4、12 | `packages/agent-core/src/errors.ts` | 取消语义的唯一处定义（`abortError` / `isAbortError` / `describeError`） |
| 6 | `packages/tool-runtime/src/calculator.test.ts` | 算术解析的预期值用例 |

### B.3.1 已知的实现缺口（本书明确标注，不掩盖）

| 项 | 状态 |
|---|---|
| **token 与成本计量** | **参考实现没有。**运行时事件词汇里没有任何用量或成本事件。第 13 章要求你自行补上（见第 13.6 节），并规定"无数据即未知" |
| **嵌入向量检索** | **参考实现没有。**知识库只有 FTS5 词法检索与 `LIKE` 回退。**第 8 章要求你自建并对比两种检索**，那是教学实现，不是现成 API |
| **Word / DOCX 生成** | 参考实现的产物登记中固定的是演示文稿的 MIME 类型；**它不是一个通用的 DOCX 渲染器**。第 15 章的 Word 生成是必须完成的成果 |
| **多智能体协作** | 参考实现是单循环 + 配置化角色的结构。多智能体在第 19 章只作架构对比，不是必修实现 |
| **生产环境的身份、租户隔离与合规认证** | 超出课堂与本书范围。第 19 章讲责任归属，不做认证 |
| **缺语言模型配置时的静默回退（2026-09-18 实测/核查发现）** | **桌面装配路径存在与第 19.5 节规则冲突的行为**：`run-service.ts:1393` 在未配置语言模型时回退到 `FakeModelProvider`，其事件流无"这是假的"标记（详见 19.5 节"本书实测"）。**教学用途可以接受，交付必须修**——预检查拦截或显式标记 |
| **typecheck 对安装方式敏感（2026-09-18 实测发现）** | `npm ci --ignore-scripts` 会跳过 `patch-package`，补丁（含 `.d.ts` 段）缺失使 `npm run typecheck` 报 2 处错误；**带 postinstall 的完整安装下 typecheck 通过**（开发环境实测 exit 0）。见第 19.2.2 节 |

**把这一节写出来的理由**：一份把缺口藏起来的来源登记，会让读者在动手时才发现"原来这里没有"。**先说不缺什么，比事后解释更有用。**

## B.4 测试状态

**结论：`npx vitest run` 全量通过（77 个测试文件 / 582 个测试用例）。**

```bash
cd <仓库根目录>
npx vitest run
```

### B.4.1 一条必须保留的前提说明

测试结果**对执行环境敏感**，而这一点值得写下来，因为它本身是一个工程论点。

一处实测对照：

| 环境 | 结果 | 原因 |
|---|---|---|
| 具备完整进程探测能力的普通 macOS 环境 | **77 个文件全部通过** | — |
| 不允许调用 `ps` 的受限执行环境 | `2 failed \| 75 passed (77)`；`14 failed \| 568 passed (582)` | `ps` 不可用（`operation not permitted`，退出码 127） |

**失败集中在一条链上**：`apps/desktop/src/main/infrastructure/mac-process-supervisor.test.ts`（13 项）与依赖它的 `apps/desktop/src/main/services/execution-output-service.test.ts`（1 项）。

对照实验说明这是**环境策略**而非代码缺陷：同一进程内 `/bin/echo` 的子进程派生正常，只有 `ps` 被单独阻断；放开会话沙箱后结果不变。

**为什么这条要写进书里而不是删掉？**因为它正好是第 13 章那条纪律的实例：

> **一个测试通过与否，取决于它所依赖的环境前提。把前提写下来，比把结论喊得更响更有用。**

**依赖操作系统进程工具的测试是环境敏感的**——这不是缺陷，是必须被知晓的前提。**如果你在自己的环境上跑，请以你本机的输出为准，并记下你的环境。**

## B.5 如何自行复核

```bash
# 1) 取到仓库并锚定提交
git clone https://github.com/gyzhang/BetterWork.git
cd BetterWork
git checkout 8ce7b7763bd8a79cf0ac917745d6739d6037bee4

# 2) 安装依赖（需要 Node >= 22.12）
npm install

# 3) 跑完整门禁（lint → 格式校验 → 类型检查 → 测试 → 构建）
npm run verify
```

**一条容易踩的坑**：不要把 `npm run verify` 的输出接管道后只看末尾——`cmd | tail` 的退出码是 `tail` 的，会把失败读成成功。需要截取输出时用：

```bash
npm run verify > log 2>&1; echo $?
```

## B.6 复用与第三方边界

参考实现是本书实现类引用的来源。但**库名、论文、截图、字体、模型输出与外部提供的模板可能各有各的权利**，参考实现的 MIT 许可不会把这些一并授权。

本书**未使用任何客户文档或专有公司模板**。书中提到的候选库（文档生成、演示文稿生成等）在准备可执行的课程资产时，各自需要单独的版本与许可审查。

技术名词、协议名称与标准编号属于各自的权利人；本书引用它们是为了说明，不构成任何背书。

## B.7 MIT 许可全文

以下声明转自参考实现的 `LICENSE` 文件（锚定提交）：

```text
MIT License

Copyright (c) 2026 Kevin Zhang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**复制或分发本软件或其实质部分时，请保留上述版权与许可声明。**
