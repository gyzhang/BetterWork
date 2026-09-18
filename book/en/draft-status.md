# Draft Status and Verification Evidence

[Manuscript](manuscript.md) · [Source register and MIT notice](references.md) · [Authoring plan](authoring-plan.md) · [Assessment gates](labs-and-assessment.md)

## 1. Delivered manuscript scope

This is the first English prose draft of *Practical Agent Design and Development*, prepared at the user's request before executable course packaging. It covers Module 00/F01–F04 and all twenty chapters. The manuscript-first sequence does not waive the original teaching or publication gates.

| Material | Current state |
| --- | --- |
| Preface and reading map | Written in `manuscript.md`, with navigation through the entire book |
| Foundation bridge | Written diagnostic, programming/interface/async/data explanations, worked examples, remediation, and G0 exits |
| Chapters 01–20 | Written ten-part chapters with learning contracts, mechanisms, alternatives, worked examples, guided practice, deliberate failures, independent variations, transfer, and retrieval practice |
| Continuing cases | Research-to-proposal and two-period operational analysis, using synthetic campus examples with professional transfer |
| Lab companion | Written L01–L20 instructions, submission worksheet, reference-test commands, and explicit release prerequisites |
| Glossary | Written definitions with first-use pointers and recurring conceptual distinctions |
| Instructor notes | Written expected reasoning, arithmetic derivations, staged hints, practical variants, draft score anchors, and pilot worksheet |
| Attribution and bibliography | Thirty BetterWork source entries, fifteen independent references, commit-pinned GitHub links, and the full MIT notice |
| Original English specifications | Updated preparation status and navigation; O1–O8, G0–G5, both learner routes, both capstones, and all required formats retained |

Paper exercises, synthetic expected results, and hypothetical evaluation rankings are labeled as such. They are not recorded live-model outcomes. No production source, dependencies, product roadmap, or `book/cn` files were changed by this manuscript task.

## 2. Source baseline and citation checks

Reference implementation: **Kevin Zhang's BetterWork**, <https://github.com/gyzhang/BetterWork>, **MIT licensed**, **Copyright (c) 2026 Kevin Zhang**.

Pinned code revision: `2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b`.

The repository remote, commit, license notice, source paths, and small quoted implementation fragments were checked against the local checkout. Excerpts omit their enclosing imports/context and remove common leading indentation for readability; they are not standalone programs. The source register supplies pinned GitHub and local links. Design proposals are distinguished from implemented behavior.

When work resumed, HEAD had advanced to `41645daac7bd9f6112b08edae267fce8f9dceeb2` through a separate Chinese-book commit. A Git comparison found no changes from the pinned baseline in `packages`, `apps`, `scripts`, `resources`, the root manifest/lockfile, or `LICENSE`. The English manuscript therefore retains its original reference revision. Existing staged manuscript files and separate Chinese-book work were preserved.

Chapter coverage, navigation, source/lab references, terminology, and continuing-case arithmetic were inspected locally. This is not an automated web-wide link crawl. External retrieval successes and limitations are recorded in the bibliography; not every GitHub permalink was independently fetched over HTTP.

## 3. Executed reference tests

Verification date: **2026-09-18, Asia/Shanghai**, confirmed against the host clock. The combined reference run started at **00:13:46**. Environment: author's existing macOS development checkout, Node **v26.8.1**, npm **11.19.0**, Vitest **4.1.11**. Dependencies were already prepared; this is not a fresh-install or supported teaching-platform claim.

Executed from the repository root:

```sh
npm test -- agent-engine.test.ts openai-compatible-provider.test.ts business-metrics.test.ts read-text-file.test.ts mcp-client-service.test.ts office-parser.test.ts file-artifact-service.test.ts
```

Vitest resolved the filename filters to these exact suites:

| Test path | Passing tests | Relevant evidence |
| --- | ---: | --- |
| `packages/agent-core/src/agent-engine.test.ts` | 21 | Ordered events, observations, tool failures, bounded rounds, cancellation, instruction composition |
| `packages/agent-core/src/openai-compatible-provider.test.ts` | 26 | Controlled provider streams, completion/error handling, cancellation, credential redaction |
| `packages/tool-runtime/src/business-metrics.test.ts` | 2 | Product comparison values, missing-current behavior, cancellation |
| `packages/tool-runtime/src/read-text-file.test.ts` | 2 | Workspace containment, traversal/symlink rejection |
| `apps/desktop/src/main/services/mcp-client-service.test.ts` | 4 | Actual local synthetic MCP process, selected adapters, schema/errors, cleanup |
| `apps/desktop/src/main/infrastructure/office-parser.test.ts` | 4 | Synthetic Office/CSV parsing and expected value/warning behavior |
| `apps/desktop/src/main/services/file-artifact-service.test.ts` | 15 | Verified-byte registration, ownership, duplicate/revocation checks, preview behavior |
| **Total** | **74** | **Seven suites passed** |

Earlier split runs covered these same tests; they are not added again to the unique total. These checks support the cited reference mechanisms, not completion of the course labs. A passing parser or registration test does not prove document editability, a full workbook-analysis workflow, or live-model quality.

Git whitespace checks cover the manuscript changes separately from runtime tests. Markdown is excluded from the root formatter's normal scope. The original drafting task did not run the full product gate, start the desktop, perform a clean installation, package a release, commit, or push.

Subsequent commit preflight, **2026-09-18**: at the user's request to commit and push the documents, `npm run verify` passed lint, formatting, type checking, **77 test files / 582 tests**, and the desktop production build. The test stage started at **14:10:38**. The build emitted the two known nonblocking Zod annotation warnings. This product verification does not satisfy the outstanding live-model, Office, or learner acceptance gates.

## 4. Deliberate implementation distinctions

| Area | What the reference establishes | What the teaching release must still establish |
| --- | --- | --- |
| Metric ratios | BetterWork uses absolute previous/budget denominators | The course adapter uses signed denominators and negative-baseline warnings; independently test both conventions |
| Retrieval | Local lexical and selected-revision search paths | A labeled lexical/embedding comparison, fixed offline vectors, tested live embedding adapter, and actual measurements |
| File access | Default canonical workspace containment; injected readers own their policy | Selected immutable inputs, byte-bounded handling, and direct negative tests; host checks are not an OS sandbox |
| MCP | A passing real local process-backed fixture integration | Isolated learner setup and declared SDK/protocol compatibility; the fixture advertises `2025-06-18`, while the cited architecture specification is `2025-11-25` |
| Workbook handling | Cell/formula-cache extraction and warnings; a separate numeric helper | Reviewed mapping, join-cardinality checks, reconciliation, safe ranges, complete two-period fixture packs, and independent oracles |
| Office delivery | PPTX-oriented host-verified registration and preview handling | Pinned teaching DOCX/PPTX renderers, redistributable templates, reviewed content, and structural/editability/visual checks |
| Framework comparison | Responsibility mapping to LangGraph's JavaScript documentation | No executed framework port is claimed; the required responsibility comparison remains separate from application handoff |
| Course delivery | Reference commands work in the prepared development checkout | One isolated evolving application, milestone starters/solutions, exact commands, a supplied thin API/UI adapter, and clean-environment replay |

These distinctions do not reduce the course requirements or imply that the product must be changed to satisfy them. Missing teaching assets remain author-owned preparation work.

## 5. Remaining release work

1. Package the isolated headless teaching application, beginning with Module 00 and Chapters 01–05. Supply infrastructure without supplying the learner-owned loop and decisions being assessed.
2. Prepare redistributable foundation, retrieval, research, operations, and template fixtures; independently review numeric oracles and relevance labels.
3. Pin and test model/embedding access, MCP integration, workbook transformations, DOCX/PPTX generation, and the CLI/API/UI handoff. Publish supported environments and safe configuration instructions.
4. Execute the controlled capstone sets: at least ten cases per capstone, with normal, missing/ambiguous-input, authorization/injection, and lifecycle/rework cases. Add numeric and document-structure tests.
5. Run the separate live-model evaluation: at least one normal, one insufficient-information, and one revision case per capstone, each twice—twelve attempts total. Freeze budgets and record every attempt; this does not replace the introductory L02 prompt experiment.
6. Verify native Office editability, save/reopen behavior, source/number consistency, and visual quality in declared applications, including a tested free option.
7. Pilot early and later material with both learner profiles; record assistance, misconceptions, timing, and retries. Calibrate scoring, revise the manuscript, and complete a fresh-environment handoff.

No live-model/embedding evaluation, Office application review, learner pilot, or fresh-environment course handoff has been completed by this manuscript task. None of the lab-ready, pilot-ready, capstone-ready, or publication-ready gates is satisfied merely by this draft. Use the existing assessment gates without weakening required outcomes.
