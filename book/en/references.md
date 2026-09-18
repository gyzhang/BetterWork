# References, Source Attribution, and License

[Return to the manuscript](manuscript.md)

## Citation convention

`BW` identifies the BetterWork reference implementation; `P` identifies an independent primary or authoritative source. Chapters link to these entries so source attribution remains visible without duplicating long URLs. Code excerpts are from BetterWork unless explicitly labeled pseudocode or teaching design. Synthetic data and expected outcomes are author-created teaching examples, not measured research findings.

Repository: **Kevin Zhang, BetterWork**, <https://github.com/gyzhang/BetterWork>. License: **MIT**. Copyright: **Copyright (c) 2026 Kevin Zhang**. Source baseline: **`2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b`**. Source inspection spanned **2026-09-17–18 (Asia/Shanghai)**. Successful external retrievals for P01–P13 occurred on **2026-09-17**; P14–P15 were accessed on **2026-09-18**. These are access dates, not publication dates.

GitHub links pin the inspected commit rather than a moving branch. The remote URL, local commit, license, paths, and quoted source were checked locally; this does not claim every GitHub permalink was fetched over HTTP. Source code and tests describe the implementation; older architectural documents may also contain proposed or superseded behavior. An inspected test is not automatically an executed test: see [verification evidence](draft-status.md).

## BetterWork source register

### BW01

Core interfaces: `ModelProvider`, `AgentTool`, `AgentRunInput`, and `AgentEngine`. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/packages/agent-core/src/types.ts) · [Local source](../../packages/agent-core/src/types.ts).

### BW02

Agent engine: message assembly, tool registry, tool observations, event sequence, cancellation, and round limits. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/packages/agent-core/src/agent-engine.ts) · [Local source](../../packages/agent-core/src/agent-engine.ts).

### BW03

Agent engine tests: scripted/recording providers, event order, tool recovery, unknown tools, repeated calls, and instruction composition. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/packages/agent-core/src/agent-engine.test.ts) · [Local source](../../packages/agent-core/src/agent-engine.test.ts).

### BW04

Fake provider: prefix-triggered tool requests and simulated streaming. It does not itself invoke a model service, but a selected tool can still perform network I/O. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/packages/agent-core/src/fake-provider.ts) · [Local source](../../packages/agent-core/src/fake-provider.ts).

### BW05

OpenAI-compatible provider: Chat Completions request mapping, SSE assembly, completion signals, cancellation, and timeout. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/packages/agent-core/src/openai-compatible-provider.ts) · [Local source](../../packages/agent-core/src/openai-compatible-provider.ts).

### BW06

Provider tests with controlled responses, including fragmented streams and credential-redaction cases. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/packages/agent-core/src/openai-compatible-provider.test.ts) · [Local source](../../packages/agent-core/src/openai-compatible-provider.test.ts).

### BW07

Calculator: a small arithmetic parser, not arbitrary JavaScript evaluation. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/packages/tool-runtime/src/calculator.ts) · [Local source](../../packages/tool-runtime/src/calculator.ts).

### BW08

Business metric comparisons: runtime validation, changes, budget deviations, and zero-baseline warnings. The implementation divides by the **absolute** baseline; the course's signed-denominator definition differs for negative baselines. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/packages/tool-runtime/src/business-metrics.ts) · [Local source](../../packages/tool-runtime/src/business-metrics.ts).

### BW09

Business metric tests: exact expected values, missing current metrics, and cancellation. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/packages/tool-runtime/src/business-metrics.test.ts) · [Local source](../../packages/tool-runtime/src/business-metrics.test.ts).

### BW10

Read-text tool: default canonical-path boundary and injected reader extension. The returned-text truncation is not a bound on bytes read into memory. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/packages/tool-runtime/src/read-text-file.ts) · [Local source](../../packages/tool-runtime/src/read-text-file.ts).

### BW11

MCP client service: stdio transport, discovery, selected bindings, schema checks, output limit, and shutdown. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/apps/desktop/src/main/services/mcp-client-service.ts) · [Local source](../../apps/desktop/src/main/services/mcp-client-service.ts).

### BW12

MCP integration tests using a real local fixture process and an in-memory application database. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/apps/desktop/src/main/services/mcp-client-service.test.ts) · [Local source](../../apps/desktop/src/main/services/mcp-client-service.test.ts).

### BW13

Read-only finance MCP fixture. It advertises protocol version `2025-06-18`; it is a deliberately minimal test server, not a general MCP server implementation. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/scripts/fixtures/mcp-finance-readonly-server.mjs) · [Local source](../../scripts/fixtures/mcp-finance-readonly-server.mjs).

### BW14

Knowledge vault: library FTS5 search/fallback and a separate selected-revision substring-search path. Neither path is the embedding exercise described in Chapter 08. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/apps/desktop/src/main/services/knowledge-vault.ts) · [Local source](../../apps/desktop/src/main/services/knowledge-vault.ts).

### BW15

Memory service: applicable records, exclusions, and rebuildable Markdown projections. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/apps/desktop/src/main/services/memory-service.ts) · [Local source](../../apps/desktop/src/main/services/memory-service.ts).

### BW16

Memory repository: status transitions, scope, validity intervals, and revision records. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/apps/desktop/src/main/persistence/memory-repository.ts) · [Local source](../../apps/desktop/src/main/persistence/memory-repository.ts).

### BW17

Bundled business-analysis Skill: instructions to confirm definitions, use selected/read material, and call deterministic calculations. The chapter paraphrases its Chinese prose in English. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/resources/skills/business-analysis/SKILL.md) · [Local source](../../resources/skills/business-analysis/SKILL.md).

### BW18

Run orchestration service: resolved capabilities and context, event persistence before dispatch, cleanup, artifact handling, and host-level failure closure. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/apps/desktop/src/main/services/run-service.ts) · [Local source](../../apps/desktop/src/main/services/run-service.ts).

### BW19

Discussion checkpoint service: task/run/artifact ownership validation. A durable task checkpoint does not resume the stack of an interrupted model request. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/apps/desktop/src/main/services/discussion-checkpoint-service.ts) · [Local source](../../apps/desktop/src/main/services/discussion-checkpoint-service.ts).

### BW20

File artifact service: host-verified output registration, immutable copies, idempotent registration keys, and preview-cache revision. This registration path specifies PPTX MIME type; it is not a generic DOCX renderer. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/apps/desktop/src/main/services/file-artifact-service.ts) · [Local source](../../apps/desktop/src/main/services/file-artifact-service.ts).

### BW21

File artifact tests: altered bytes/reports, cross-run outputs, revocation, duplicate registration, and preview invalidation. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/apps/desktop/src/main/services/file-artifact-service.test.ts) · [Local source](../../apps/desktop/src/main/services/file-artifact-service.test.ts).

### BW22

Office parser: PPTX sections, XLSX cells/formula cache warnings, CSV parsing, and format limits. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/apps/desktop/src/main/infrastructure/office-parser.ts) · [Local source](../../apps/desktop/src/main/infrastructure/office-parser.ts).

### BW23

Office material tool: selected snapshot/version identity, locators, runtime validation, and injected reading. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/packages/tool-runtime/src/read-office-material.ts) · [Local source](../../packages/tool-runtime/src/read-office-material.ts).

### BW24

System architecture: dependency direction and application/core separation. Read status passages against the code baseline. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/docs/03-system-architecture.md) · [Local document](../../docs/03-system-architecture.md).

### BW25

Research and Office workflows: content models and reviewed delivery sequences, including design proposals rather than completed implementations. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/docs/06-knowledge-workflows.md) · [Local document](../../docs/06-knowledge-workflows.md).

### BW26

Engineering standards: one root toolchain, strict typing, asynchronous error handling, migration discipline, and verification gates. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/docs/12-engineering-standards.md) · [Local document](../../docs/12-engineering-standards.md).

### BW27

Dependency lock: actual dependency versions, including ExcelJS `4.4.0` and MCP client `2.0.0`. These are product versions, not a tested course OS/library matrix. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/package-lock.json) · [Local file](../../package-lock.json).

### BW28

Root commands and declared Node requirement. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/package.json) · [Local file](../../package.json).

### BW29

Read-text tests, including traversal and symlink escape rejection. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/packages/tool-runtime/src/read-text-file.test.ts) · [Local source](../../packages/tool-runtime/src/read-text-file.test.ts).

### BW30

Office parser tests with generated synthetic workbook/presentation/CSV fixtures. [GitHub](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/apps/desktop/src/main/infrastructure/office-parser.test.ts) · [Local source](../../apps/desktop/src/main/infrastructure/office-parser.test.ts).

## Independent sources

### P01

Shunyu Yao et al. *ReAct: Synergizing Reasoning and Acting in Language Models*. arXiv:2210.03629, version 3; ICLR 2023. [Paper record](https://arxiv.org/abs/2210.03629v3). Abstract and bibliographic record retrieved; the book distinguishes the paper's interleaved reasoning/action formulation from its own observable tool-calling exercises. No benchmark result is claimed for BetterWork.

### P02

Patrick Lewis et al. *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks*. NeurIPS 2020; arXiv:2005.11401, version 4. [Paper record](https://arxiv.org/abs/2005.11401v4). Abstract and bibliographic record retrieved. The paper's trained retrieval-augmented models are not identical to every modern retrieve-then-prompt pipeline.

### P03

OpenAI. *Function calling*. [Official guide](https://platform.openai.com/docs/guides/function-calling). Retrieved sections on the tool-call cycle and schemas. Living documentation, not a pinned model guarantee. BetterWork's adapter uses Chat Completions wire fields; do not substitute Responses API fields merely because current examples show them.

### P04

Model Context Protocol contributors. *Architecture*, specification `2025-11-25`. [Official specification](https://modelcontextprotocol.io/specification/2025-11-25/architecture). Retrieved for host/client/server responsibilities. The local BetterWork fixture advertises `2025-06-18`, not this revision. A direct retrieval of that older lifecycle page failed during drafting; version-specific conformance remains a release check rather than an asserted result.

### P05

SQLite authors. *SQLite FTS5 Extension*. [Official documentation](https://sqlite.org/fts5.html). Retrieved reference for full-text search and ranking; consult the documentation corresponding to the SQLite version used by a release.

### P06

Christopher D. Manning, Prabhakar Raghavan, and Hinrich Schütze. *Introduction to Information Retrieval*, section “Evaluation of unranked retrieval sets.” Cambridge University Press, 2008. [Author-hosted text](https://nlp.stanford.edu/IR-book/html/htmledition/evaluation-of-unranked-retrieval-sets-1.html). Retrieved definitions of precision and recall; the course applies them to a fixed top-k prefix.

### P07

OpenAI. *Vector embeddings*. [Official guide](https://platform.openai.com/docs/guides/embeddings). Retrieved for vector representations and similarity. An actual lab must pin the selected embedding model and document dimension, distance, and data policy; this citation does not supply a tested adapter.

### P08

SQLite authors. *Transaction*. [Official documentation](https://sqlite.org/lang_transaction.html). Retrieved for explicit transactions, commit/rollback, and concurrency behavior. Database transactions do not make external filesystem or network effects atomic.

### P09

Node.js contributors. *Globals: AbortController*. [Official documentation](https://nodejs.org/api/globals.html#class-abortcontroller). Retrieved for abort signals and listener lifecycle. Cancellation is cooperative and depends on the participating operation.

### P10

ExcelJS contributors. *ExcelJS README*, tag `v4.4.0`. [Versioned source documentation](https://github.com/exceljs/exceljs/blob/v4.4.0/README.md) · [Raw text retrieved](https://raw.githubusercontent.com/exceljs/exceljs/v4.4.0/README.md). Reference for workbook and formula-value semantics; a cached result is not a freshly calculated formula.

### P11

Dolan Miu and docx contributors. *docx*. [Project documentation and examples](https://github.com/dolanmiu/docx) · [Documentation site](https://docx.js.org/). Project description and example index retrieved. Candidate for the isolated TypeScript DOCX teaching adapter; not installed, version-pinned, or verified by this manuscript task. No third-party implementation listing is copied into the book.

### P12

Brent Ely and PptxGenJS contributors. *PptxGenJS*. [Project documentation](https://github.com/gitbrent/PptxGenJS). Repository README retrieved; the documentation-site request failed and the repository was used instead. Candidate for native editable teaching output, not BetterWork's declared generation backend or a certified viewer-compatibility result.

### P13

LangChain contributors. *LangGraph overview*, JavaScript documentation. [Official overview](https://docs.langchain.com/oss/javascript/langgraph/overview). Retrieved for orchestration, durable execution, streaming, and human-in-the-loop responsibilities. Chapter 19 is a responsibility mapping, not an executed port or endorsement of production readiness.

### P14

OpenAI. *Prompt engineering*. [Official guide](https://platform.openai.com/docs/guides/prompt-engineering). Accessed 2026-09-18. Retrieved sections on nondeterministic responses, message roles, model-snapshot variation, and token-bounded context windows. Living documentation; current Responses API examples are not the wire contract of BetterWork's Chat Completions adapter.

### P15

OpenAI. *Structured model outputs*. [Official guide](https://platform.openai.com/docs/guides/structured-outputs). Accessed 2026-09-18. Retrieved structured-output guidance, including refusal and maximum-output-token cases where a normal complete schema result is unavailable. Provider-supported formatting does not establish factual source support; the host still handles incomplete/refused responses and checks domain meaning.

## Reuse and third-party boundaries

BetterWork is the source of the implementation excerpts in this manuscript. Library names, papers, screenshots, fonts, model outputs, and externally supplied templates may have separate rights; BetterWork's MIT license does not relicense them. The draft uses no customer documents or proprietary company templates. Candidate libraries require their own version/license review when executable course assets are prepared.

The following notice is reproduced from BetterWork's [LICENSE](../../LICENSE), also available at the [pinned GitHub revision](https://github.com/gyzhang/BetterWork/blob/2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b/LICENSE):

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
