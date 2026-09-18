# Lab Companion: L01–L20

[Manuscript](../manuscript.md) · [Assessment authority](../labs-and-assessment.md) · [Release status](../draft-status.md)

## Read this before executing a lab

This companion supplies first-draft exercise instructions, evidence worksheets, and runnable **BetterWork reference-test commands**. It does not claim that the isolated teaching application, milestone starters/solutions, workbook packs, embedding fixtures, or Office renderers have been packaged. Each lab below separates what can be read or traced now from its author-owned executable release prerequisites.

Do not interpret a reference test as your independent implementation. Do not edit product code to complete a classroom experiment in the shared development checkout. Use a disposable learner copy or the isolated course starter once published. All reference code is from Kevin Zhang's MIT-licensed [BetterWork repository](https://github.com/gyzhang/BetterWork), at the revision in the [source register](../references.md).

## Available reference execution path

The following commands run from the BetterWork repository root in an **already prepared dependency environment**. This draft used Node `v26.8.1`, npm `11.19.0`, and Vitest `4.1.11` on the author's macOS host. That observation is not a supported course-environment matrix. The manifest declares Node `>=22.12.0`; some process fixtures have stronger practical runtime requirements described in the engineering standards. No fresh-install claim is made.

```sh
npm test -- packages/agent-core/src/agent-engine.test.ts
npm test -- packages/agent-core/src/openai-compatible-provider.test.ts
npm test -- packages/tool-runtime/src/business-metrics.test.ts
npm test -- packages/tool-runtime/src/read-text-file.test.ts
npm test -- apps/desktop/src/main/services/mcp-client-service.test.ts
npm test -- apps/desktop/src/main/infrastructure/office-parser.test.ts
npm test -- apps/desktop/src/main/services/file-artifact-service.test.ts
```

The first six paths were initially executed together and file-artifact tests separately; a final combined run passed all seven suites, as recorded in [verification evidence](../draft-status.md#3-executed-reference-tests). Observed counts at the cited baseline were 21, 26, 2, 2, 4, 4, and 15 passing tests respectively—74 unique tests across seven files. Counts can change at a later revision. These tests use controlled providers/data; the MCP suite launches a real local synthetic server, not a remote customer service. File-artifact tests do not constitute a human Office editability review.

Optional full **product** setup and verification instructions live in [the handoff guide](../../../docs/11-qoder-handoff.md). They include native/Electron preparation and must not be confused with a tested headless course installer. Do not start the desktop application merely to understand the loop. Course authors must publish exact starter/solution revisions and clean-install commands before assigning implementation labs; learners are not responsible for inventing missing setup infrastructure.

## A submission worksheet

Copy this structure into each submission; early discussion exercises can mark execution fields not applicable.

| Field | What to record |
| --- | --- |
| Goal and boundary | User, decision, allowed actions, excluded actions |
| Inputs | Synthetic source identities/revisions, periods/units if relevant |
| Environment | Code revision, dependencies, scripted/live mode, non-secret settings |
| Learner-owned change | What you implemented or changed, distinct from supplied code |
| Expected behavior | Independent oracle or acceptance rule written before execution |
| Actual behavior | Command/steps, run identity, terminal result, relevant observations |
| Failure and correction | Expected versus actual, earliest violated contract, regression check |
| Output evidence | Files/versions, source mappings, numeric/structural/human checks |
| Independent variation | New input/requirement and explanation without copied solution |
| Assistance | Coding-assistant or collaborator contributions and your verification |

Completed paper example: Goal—compare club spending; inputs—current `25000`, previous `20000`, USD minor units; expected change—`5000`, ratio `0.25`; actual—hand calculation agrees; limitation—no causal data; execution—paper exercise only, no run ID; next check—implement and test missing/zero baselines. This is useful practice evidence, not a passing executable L06 submission.

## L01

[Chapter 01](../chapters/01-useful-tasks.md) supplies the worked scenario brief. Write a club-budget variant with one non-agent baseline, one adaptive candidate, three acceptance cases, and two excluded actions. Exchange it with a peer and classify a result against the written criteria. A missing decision owner must cause a clarification, not assumed authority.

Available now: paper scenario exercise and source reading. Release prerequisite: instructor-selected unseen brief and calibrated scoring examples. Exit evidence: another learner can judge success without asking what your criteria mean.

## L02

[Chapter 02](../chapters/02-models-and-prompts.md) supplies two prompt variants and three case categories. Predict failures, freeze the rubric, then run three cases twice per prompt with approved access. Record all twelve attempts, including unsupported claims and missing usage information. Do not run paid experiments without the agreed budget.

Available now: prompt/criteria design and paper analysis. Release prerequisite: tested model access, adapter instructions, safe configuration, and approved time/token/cost limits. Exit evidence: explain why stronger prompting does not prove permission or truth.

## L03

[Chapter 03](../chapters/03-one-tool-exchange.md): trace one calculator exchange, then run the engine and provider reference suites above. Inspect the first engine test; change the arithmetic input in a disposable copy and derive its expected result independently. Test malformed arguments and incomplete stream assembly. Separately record a live exchange when the supplied access is ready.

Available now: real source/test reference. Release prerequisite: isolated transport starter and live access. Exit evidence: distinguish requested, authorized, and executed actions, preserving call identity.

## L04

[Chapter 04](../chapters/04-agent-loop.md): implement the loop, not the transport. Add no-tool completion, one permitted action, returned observation, unknown-tool rejection, recoverable tool error, cancellation, and round exhaustion. Use a repeating scripted provider to prove bounded termination. Explain a one-round budget and a zero-round budget.

Available now: pseudocode and executable engine reference tests. Release prerequisite: tested starter with transport/fixtures and milestone solution, leaving loop logic to the learner. Exit evidence: independently modify a stopping rule and predict affected tests.

## L05

[Chapter 05](../chapters/05-react-and-workflows.md): compare a fixed three-source workflow with observation-driven follow-up under the same selection and budget. Remove authority metadata and require escalation. Record reads and unresolved questions without inventing performance measurements.

Available now: complete paper source table and guided comparison. Release prerequisite: executable source fixtures and a scripted/live comparison harness. G1 evidence combines L01–L05; tracing alone does not replace the implemented loop.

## L06

[Chapter 06](../chapters/06-deterministic-tools.md): specify current/prior/budget comparison before implementing it. Include positive, negative, zero, missing, and incompatible-unit inputs; implement the course's signed-denominator rule. Add a bounded read-only selected-source operation and traversal/symlink cases.

Available now: metric and read-text reference suites. Release prerequisite: isolated adapter with safe-integer/unit checks, byte-bounded input handling, and course-specific oracle. Exit evidence: explain the reference helper's absolute-denominator difference and why return truncation is not an input-read limit.

## L07

[Chapter 07](../chapters/07-mcp.md): run the local MCP reference suite, draw host/client/server roles, and inspect selected bindings and argument validation. In the teaching starter, compare the same synthetic metric through direct and MCP calls. Test unavailable service, malformed arguments, unselected operation, cancellation, and connection closure.

Available now: actual process-backed reference integration. Release prerequisite: isolated server/client starter with a recorded protocol/SDK version and exercise-specific expected values. Exit evidence: discovery never grants all tools to the run.

## L08

[Chapter 08](../chapters/08-retrieval.md): label questions over one corpus; compare lexical and embedding top-k rankings under the same scope. Retain per-query relevance judgments, Recall@k, and irrelevant hits. Produce an answer with claim/source mappings and inspect support manually.

Available now: four-passage corpus and hand-worked ranking/scoring example. Release prerequisite: expanded redistributable corpus, fixed embeddings, tested live embedding adapter, held-out questions, and exact commands. Toy vectors and hypothetical rankings are not measured embedding results.

## L09

[Chapter 09](../chapters/09-context-and-memory.md): reuse one confirmed preference across two tasks with new data. Record context manifests; compare full-history and selected-context payloads. Delete/exclude memory and switch workspace; inspect actual provider inputs for absence, including summaries/caches.

Available now: worked records and memory source walkthrough. Release prerequisite: isolated memory/context starter and fixtures. Exit evidence: a prior report never silently becomes current-period data.

## L10

[Chapter 10](../chapters/10-skills-and-experts.md): configure research and analysis on one engine. Separate methods from data, resolve versions, and assert the effective tool/material scope. Test disabled, untrusted, missing-dependency, and changed-grant cases. Adapt a preset to an unseen input.

Available now: bundled Skill reference and worked preset table. Release prerequisite: tested resolver starter and disposable method packages. G2 requires actual MCP and measured retrieval evidence, not just two configuration files.

## L11

[Chapter 11](../chapters/11-harness-boundaries.md): map threats to enforcement components, submit forbidden calls directly, and inspect operation counts/outputs. Use synthetic source instructions and an explicit empty material selection. Approve a harmless disposable output, then change its payload or destination and require denial.

Available now: boundary diagram and default reader reference tests. Release prerequisite: selected-source and approval fixtures with safe disposable output roots. Exit evidence: distinguish host controls from process isolation and OS sandbox guarantees.

## L12

[Chapter 12](../chapters/12-lifecycle-and-persistence.md): persist state, interrupt/restart a disposable host, and recover collaboration through a new run. Test terminal-state immutability, cross-task references, duplicate publication, cleanup failure, and cancellation on both sides of the commit boundary.

Available now: lifecycle walkthrough and artifact-registration reference suite. Release prerequisite: isolated SQLite starter, controlled interruption points, and checkpoint fixtures. Exit evidence: a durable decision survives without pretending an interrupted model call resumed.

## L13

[Chapter 13](../chapters/13-evaluation-and-budgets.md): freeze cases and rubric, compare two settings, inject a regression, and force a budget stop. Record all attempts and classify model/data/tool/runtime failures. Test error-path redaction with a synthetic marker.

Available now: worked evaluation table and provider/core suites. Release prerequisite: evaluation harness, case corpus, and provider budget/usage policy. G3 requires actual boundary, lifecycle, redaction, and bounded-stop evidence.

## L14

[Chapter 14](../chapters/14-excel-analysis.md): inspect workbook cells and formula/cache state; validate grain, keys, currency, period, and numeric ranges. Aggregate before joining summaries, reconcile counts/totals, and compare metrics with the independent oracle. Inject duplicate keys, missing budget, unmatched project, incompatible units, and missing caches.

Available now: complete small hand-worked tables and Office parser tests. Release prerequisite: workbook files, normalized mapping, signed-formula adapter, join/reconciliation implementation, and independently reviewed oracle. A parser test alone does not pass the analysis lab.

## L15

[Chapter 15](../chapters/15-markdown-and-word.md): create a reviewed content model and render equivalent Markdown and editable DOCX. Compare headings, table cells, figures, and references. Edit/save/reopen a review copy in the declared office application, then generate a new version without overwriting the original.

Available now: content contract, worked passage, and host-registration reference. Release prerequisite: pinned DOCX renderer, redistributable styles/template, structure checks, and tested viewer including a free option. No DOCX teaching generator is claimed in this manuscript release.

## L16

[Chapter 16](../chapters/16-editable-powerpoint.md): produce a reviewed five-slide storyline with native editable text/tables and chart/source-data mappings. Inspect every slide; test overflow and image-only variants. Change a verified input and regenerate, checking all repeated figures and preserved V1 bytes.

Available now: worked outline and artifact-registration tests. Release prerequisite: pinned PPTX renderer/template and structural/editability/visual evidence. G4 includes Excel results plus all three document formats; a preview image is not a substitute.

## L17

[Chapter 17](../chapters/17-research-capstone.md): clarify the research brief, review the plan, inspect selected local/recorded sources, perform the separately approved live lookup, compare alternatives, and review the outline. Deliver Markdown, DOCX, and PPTX; then change direction and preserve revision lineage.

Available now: worked proposal, claims, and decisions. Release prerequisite: complete research fixture pack, prepared generation/runtime adapters, live access, and evaluation cases. Exit evidence: supported claims, visible conflicts, bounded access, and all required files/checks.

## L18

[Chapter 18](../chapters/18-operations-capstone.md): deliver P1, create an independent P2 task with new inputs, handle the missing budget, select its corrected revision, and regenerate. Demonstrate cancellation and restart/rework without duplicate or incomplete publication.

Available now: hand-derived two-period oracle and lineage walkthrough. Release prerequisite: two workbook packs and mutations, full analysis/generation path, and controlled lifecycle harness. Exit evidence: two editable decks whose numbers and source roles remain period-specific.

## L19

[Chapter 19](../chapters/19-delivery-and-transfer.md): hand off the CLI/API application through a supplied thin UI adapter; observe another learner's replay. Demonstrate missing configuration/dependency behavior and safe stop. Map responsibilities to LangGraph and explain one campus/industry adaptation.

Available now: responsibility map and handoff worksheet. Release prerequisite: packaged adapters, tested installation/runtime matrix, exact start/stop/test commands, and a fresh-environment trial. A written deployment proposal does not replace the application handoff.

## L20

[Chapter 20](../chapters/20-independent-assessment.md): index evidence to O1–O8, demonstrate both capstones, defend one in depth, handle an unseen input, and diagnose a supplied defect. Explain the loop, ReAct, and Harness through an actual trace. Disclose assistance and demonstrate independent understanding.

Available now: assessment narrative, worksheet, and draft instructor calibration. Release prerequisite: complete prior gates, calibrated practical variants, and both learner-profile pilots. G5 cannot pass while required author-supplied assets or live/human checks remain absent.

## Milestone preparation and support

Before executable teaching, the author packages one evolving application with milestones after L04, L10, L13, L16, and L19. Each has a tested starter, solution, exact command, expected output, and independent variation. Starters supply infrastructure not being assessed; they do not supply the learner-owned loop, validation, transformations, or boundary decision under assessment.

Use staged help: restate the contract → point to the relevant boundary → show a smaller analogous example. Then reassess with a new variant. Record assistance and elapsed work to revise pacing; do not reduce outcomes to fit an optimistic schedule.
