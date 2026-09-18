# Curriculum: From Scenarios to Reliable Agents

Status: syllabus with a complete first prose draft of Module 00 and Chapters 01–20, available through the [manuscript](manuscript.md). Draft lab guidance is written; executable course assets and learner validation are not complete. Audience and purpose are defined in the [course overview](README.md); executable acceptance is defined in [labs and assessment](labs-and-assessment.md). See [draft status](draft-status.md) for verification and remaining release work.

## Course sequence

The twenty core chapters are independent of product-release progress. Module 00 supplies missing software foundations; it is not a general introduction to programming. Both entry routes complete the same core outcomes O1–O8 from the [overview](README.md).

| Part | Chapters | Guiding question | Mastery checkpoint |
| --- | --- | --- | --- |
| Foundation bridge | 00 / F01–F04 | Can I work with files, APIs, async code, and tests? | G0: independently complete the diagnostic tasks |
| I. Models, scenarios, and the first agent | 01–05 | What does an agent add, and how does it execute? | G1: explain and build a bounded loop |
| II. Tools and working context | 06–10 | How does it act, retrieve, and reuse knowledge? | G2: grounded, reusable capabilities with measured retrieval |
| III. Harness engineering | 11–13 | How do we control and evaluate execution? | G3: reproducible boundary, lifecycle, and evaluation tests |
| IV. Data and document engineering | 14–16 | How do we produce correct and usable work? | G4: Excel analysis plus Markdown, DOCX, and PPTX |
| V. Integrated applications | 17–18 | Can the pieces complete a real task? | Integrated evidence for both capstones |
| VI. Delivery and transfer | 19–20 | Can another person use, adapt, and maintain it? | G5: independent delivery and defense |

Default order is sequential. Prerequisites identify conceptual dependencies. Budget 60 guided core hours, with the additional foundation/practice support described in the overview. Chapters need not have equal duration. A session cycles through a worked example, guided modification, independent variation, and failure analysis; complex labs can span sessions.

## Module 00. From basic programming to the course environment

Entry diagnostic: write a small function using a loop and conditional, explain its result, and correct a simple bug. Learners who cannot yet do this need introductory programming first.

| Bridge | Taught explicitly | Diagnostic or exit task |
| --- | --- | --- |
| F01. Program and project basics | Terminal, modules, dependencies, basic TypeScript, file paths, Git changes | Run a supplied project, modify one function, and explain the change |
| F02. Data and interfaces | Objects, JSON, files, HTTP request/response, status codes, environment configuration | Parse a local response and handle missing/invalid fields without exposing a secret |
| F03. Async work and errors | Promise/await, timeout, exception, cancellation, sequential versus concurrent work | Trace a delayed operation, cancel it, and distinguish failure from a valid empty result |
| F04. Testing and data literacy | Assertions, fixtures, reproducibility, tables, keys, sums, ratios, missing versus zero | Add a regression test and verify a small table calculation against supplied expected values |

Provide a three-hour guided block per bridge and remediation exercises. Experienced learners may demonstrate a bridge's exit task instead of attending it. G0 requires all four exits, not self-reported experience. Banking, accounting, and professional delivery knowledge are never part of G0.

## Part I. Models, scenarios, and the first agent

### 01. Specify a useful task before choosing an agent

- Prerequisite: basic programming; G0 before implementation labs.
- Learn: user goal, inputs/outputs, uncertainty, script versus workflow versus agent, success criteria, human responsibility.
- Lab L01: compare a campus research/budget task with the equivalent departmental case; define a non-agent baseline and an agent candidate.
- Deliverable: a one-page scenario brief, excluded actions, example inputs, and measurable acceptance cases.
- Failure and exit: identify a missing source or decision authority; another learner must be able to judge success from the brief.

### 02. Understand models, prompts, and their limits

- Prerequisite: 01 and G0.
- Learn: tokens, context window, inference versus training, probabilistic output, message roles, instructions/examples, structured output, hallucination, and cost.
- Lab L02: compare an underspecified prompt with an explicit task/output contract; inspect repeated responses on a small fixed set.
- Deliverable: prompt variants, expected answer criteria, observed differences, and a list of facts the model cannot know from the input.
- Failure and exit: a fluent incorrect response and context omission; explain why a better prompt is not a permission system or a correctness proof.

### 03. Make a model request and complete one tool exchange

- Prerequisite: 02; F02–F03.
- Learn: provider boundary, request/response, tool schema, call identity, runtime validation, returned observation, streaming completion.
- Lab L03: first call a scripted provider, then complete a calculator exchange with instructor-provided or individual live-model access.
- Deliverable: a sequence diagram and tests separating requested actions from actually executed actions.
- Failure and exit: reject malformed arguments and incomplete streams; inspect the live exchange without exposing credentials.

### 04. Implement the Agent Loop

- Prerequisite: 03.
- Learn: model → permitted tool → observation → next decision, messages/state, stopping conditions, iteration limits, cancellation, and event order.
- Lab L04: implement a small headless loop using calculator and read-only material tools; a starter supplies transport details, not the loop logic.
- Deliverable: runnable code plus happy-path, unknown-tool, failing-tool, cancellation, and round-limit tests.
- Failure and exit: a provider that repeatedly requests a tool must terminate; each run has exactly one terminal outcome. No unrestricted shell tool.

### 05. ReAct and workflow design

- Prerequisite: 04.
- Learn: reasoning/action/observation, adaptive decisions inside fixed stages, planning versus execution, and when human review is needed.
- Lab L05: compare fixed and observation-driven approaches to the same task; revise the L01 design using measured behavior.
- Deliverable: control-flow diagram, bounded plan, comparison results, and escalation rules.
- Failure and G1: handle conflicting observations and unproductive repetition; independently explain and modify the loop. Do not require private model reasoning to demonstrate ReAct.

## Part II. Tools and working context

### 06. Engineer deterministic tools

- Prerequisite: G1; F04.
- Learn: tool descriptions, schema versus runtime validation, structured results/errors, side effects, units, deterministic arithmetic, and test oracles.
- Lab L06: implement period/budget comparisons and a bounded file-reading tool; start with a student-club table before a departmental export.
- Deliverable: tool contracts, independent expected values, validation tests, and an adapter that leaves calculation outside the model.
- Failure and exit: missing current value, zero denominator, invalid path, and unit mismatch remain explicit instead of producing plausible numbers.

### 07. Integrate tools through MCP

- Prerequisite: 06.
- Learn: host/client/server roles, discovery, schema mapping, transport, selected tool access, connection lifecycle, cancellation.
- Lab L07: expose and call a synthetic read-only metrics tool through a local MCP server; compare it with the direct tool call.
- Deliverable: integration diagram and tests for selection, arguments, result mapping, and clean connection shutdown.
- Failure and exit: handle unavailable service and an unselected tool request; discovery or connectivity never grants authority.

### 08. Build and evaluate retrieval-augmented generation

- Prerequisite: 06–07.
- Learn: document extraction, chunks/locators, keyword retrieval, embeddings and similarity, top-k selection, evidence, retrieval evaluation, and grounded generation.
- Lab L08: build lexical and embedding retrieval over the same small corpus; use fixed embedding fixtures for offline tests and a documented embedding adapter for the live exercise.
- Deliverable: query/relevance labels, retrieval comparison, a source-grounded answer, and claim-to-source mappings.
- Failure and exit: irrelevant hits, conflicting sources, and empty retrieval must not turn into invented evidence; selected, read, and cited are distinct facts.

### 09. Manage context and memory

- Prerequisite: 08.
- Learn: context assembly and budgets, selective reading, history/summaries, knowledge versus memory, scope, confirmation, freshness, and deletion.
- Lab L09: reuse a confirmed preference in a new task while replacing current data; compare full-history input with selected context.
- Deliverable: context snapshots, memory lifecycle tests, and an explanation of what was included, excluded, or summarized.
- Failure and exit: stale facts, deleted memory, and another workspace's material cannot silently reappear; summaries do not replace source evidence.

### 10. Package Skills and configure experts

- Prerequisite: 09.
- Learn: Tool versus Skill versus Expert, reusable instructions/resources, task-specific facts, versions, configuration resolution, and effective capability scope.
- Lab L10: configure research and analysis presets on one engine and verify the resolved methods, material scope, and tools.
- Deliverable: two presets, reusable methods, configuration tests, and a worked example showing composition rather than separate engines.
- Failure and G2: disabled/untrusted methods and missing dependencies yield explicit failures; independently adapt the grounded assistant to an unseen input.

## Part III. Harness engineering

### 11. Harness architecture and trust boundaries

- Prerequisite: G2.
- Learn: runtime responsibilities, model versus host authority, capability allow-lists, untrusted documents, prompt injection, input snapshots, secrets, and least privilege.
- Lab L11: map each control to its enforcing component; implement negative tests at tool/material execution boundaries.
- Deliverable: a threat/boundary diagram and a controlled file-write approval exercise confined to disposable synthetic outputs.
- Failure and exit: injected instructions cannot expand access; host checks, process isolation, and OS sandbox guarantees are distinguished accurately.

### 12. Lifecycle, persistent state, and human checkpoints

- Prerequisite: 11; a short state-machine/SQLite primer is supplied here.
- Learn: task/session/run identity, durable records, terminal states, timeouts, cancellation, idempotency, safe retry, review checkpoints, and rework.
- Lab L12: persist state, interrupt the host, recover a review checkpoint, and start a new run from selected inputs without duplicating effects.
- Deliverable: state-transition diagram and persistence, duplicate-request, cancellation, and ownership tests.
- Failure and exit: distinguish resumed collaboration from an interrupted model call; never publish partial output or blindly retry side effects.

### 13. Observability, evaluation, and operating budgets

- Prerequisite: 12; tests have been used since F04.
- Learn: redacted structured traces, unit/integration/model evaluation, relevance and task success, latency, token/cost data, regression sets, and budget policy.
- Lab L13: compare two instruction/retrieval configurations on fixed tasks, inject a regression, and demonstrate a bounded stop.
- Deliverable: an evaluation report with sample counts, all attempts, settings, expected/actual outcomes, and model/data/tool/runtime error categories.
- Failure and G3: detect fluent unsupported output, classify a controlled regression, and mark missing usage data unknown; a scripted provider is not proof of live-model quality.

## Part IV. Data and document engineering

### 14. Analyze Excel data with deterministic tools

- Prerequisite: G3; revisit F04 using a worked budget/project dataset.
- Learn: workbook/sheet/range, rows and keys, formula/value state, grain, joins, aggregation, metric definitions, units, missing values, and reconciliation.
- Lab L14: inspect two workbooks, validate a join, calculate period/budget comparisons, and produce a quality report plus verified metric results.
- Deliverable: input-to-result locators, calculation tests, expected totals, and explanations separating measured changes from causal hypotheses.
- Failure and exit: detect duplicate joins, incompatible units, zero denominators, and missing formula caches; financial expertise is not assumed.

### 15. Generate Markdown and Word documents

- Prerequisite: 14; evidence and content contracts from 08.
- Learn: structured content model, sections/headings, tables, citations, templates, DOCX rendering, artifact versions, and structural versus visual validation.
- Lab L15: render the same supported content into Markdown and editable DOCX, review it in an office application, and revise it without overwriting the original.
- Deliverable: both files, source mappings, renderer checks, editability evidence, and version lineage.
- Failure and exit: malformed content, missing template, truncated table, and attempted overwrite fail visibly. Word generation is required, regardless of product progress.

### 16. Generate editable PowerPoint presentations

- Prerequisite: 15.
- Learn: audience/storyline, slide purpose, outline, charts/tables, themes/templates, PPTX rendering, source mappings, visual QA, and revision.
- Lab L16: turn a reviewed report into an editable deck; change a number or recommendation and regenerate the affected output version.
- Deliverable: outline, PPTX, source/input lineage, structural checks, and human editability/legibility review.
- Failure and G4: find mismatched figures, overflow, and image-only content; Excel results, Markdown, DOCX, and PPTX must all pass their checks.

## Part V. Integrated applications

### 17. Capstone A: Research to a defensible proposal

- Prerequisite: G4; use the [capstone specification](labs-and-assessment.md).
- Learn: research scope, conflicting evidence, options and feasibility, review decisions, content quality, and end-to-end evaluation.
- Lab L17: research a campus or business-agent opportunity, obtain outline feedback, and deliver Markdown, DOCX, and PPTX with traceable evidence.
- Deliverable: proposal, evidence register, decision record, three-format output package, and evaluation report.
- Failure and exit: incorporate a direction change and address an unsupported claim; recorded sources support replay, while live-model/source trials are recorded separately.

### 18. Capstone B: Operational analysis to a report

- Prerequisite: G4; builds on 14 and the [capstone specification](labs-and-assessment.md).
- Learn: integrating quality checks, deterministic analysis, narrative, charting, reviewer decisions, and repeat-period work.
- Lab L18: analyze one period, generate a management presentation, then repeat with new data and a selected prior artifact.
- Deliverable: quality report, oracle-checked metrics, source-grounded narrative, two period-specific editable decks, and lifecycle evidence.
- Failure and exit: duplicate rows, missing budget, stale context, and an unsupported causal explanation are handled explicitly; the second period uses an independent task.

## Part VI. Delivery and transfer

### 19. Package an application and map it to another platform

- Prerequisite: 17–18.
- Learn: core/host/UI boundaries, CLI/API packaging, environment/dependencies, secret configuration, logs, deployment responsibilities, and framework/platform capability mapping.
- Lab L19: deliver the agent behind a CLI and a supplied thin API/UI adapter; compare its runtime responsibilities with one instructor-selected framework/platform.
- Deliverable: runnable package, operating instructions, capability map, and an adaptation brief for a campus, banking, energy, or manufacturing scenario.
- Failure and exit: missing configuration or a platform capability gap is explicit, with a mitigation/owner. Discuss multi-agent coordination as an architectural comparison, not a mandatory rewrite.
- Boundary: the supplied UI avoids requiring React/Electron expertise; product source is a reference sidebar, and real customer access or production certification is not required.

### 20. Independent delivery, evaluation, and teach-back

- Prerequisite: 19 and the final evidence package.
- Learn: acceptance review, reproducibility, communicating limitations, maintenance ownership, and evaluating changes after delivery.
- Lab L20: another learner runs the handoff; the author handles an unseen input, diagnoses a supplied defect, and explains an adaptation without a copied solution.
- Deliverable: both baseline capstones, one deeper project defense, evaluation evidence, and a concise explanation of ReAct, Agent Loop, and Harness.
- Failure and G5: demonstrate normal execution, a controlled failure, and revision; satisfy the shared rubric and critical gates in [labs and assessment](labs-and-assessment.md).

## Prerequisite and mastery policy

G0 → Chapters 01–05/G1 → 06–10/G2 → 11–13/G3 → 14–16/G4 → 17–20/G5. Chapter 01 discussion can precede G0, but executable work cannot. G0–G4 include corrective feedback and a retry with a new variant; time spent is not the pass criterion. A learner who has not passed G4 does not receive a full-course completion claim for a visually polished capstone.

## Concept discipline

| Term | Working definition in this course | Common misconception to prevent |
| --- | --- | --- |
| Model / agent | A model produces predictions/responses; an agent system combines model decisions with tools, context, state, and controls | A model alone executes tools or enforces application permissions |
| Token / context | Units processed by the model / the bounded information available for a request | Conversation history is unlimited or remembered automatically |
| RAG | Retrieval selects external information to ground generation; retrieval and answer quality require separate checks | Embeddings guarantee relevance or retrieved text is automatically true |
| Agent | A bounded system that uses model decisions, tools, context, and feedback to pursue a task | Any chatbot or any workflow is automatically an agent |
| ReAct | A reasoning/action/observation pattern that can be implemented within a loop | A guarantee of correctness or a need to reveal private reasoning |
| Agent Loop | The execution cycle coordinating model calls, tool execution, observations, and stopping | Merely a prompt or a loop without limits |
| Harness | The runtime and surrounding controls for context, capability access, lifecycle, observability, and evaluation | A universally standardized component name or only a system prompt |
| Tool | An executable capability with a structured contract | Text describing a desired action |
| Skill | A reusable working method with instructions and, where applicable, scripts/resources | A new engine or automatically authorized executable code |
| Expert | A configured role and working-method/capability preset | Necessarily a separate autonomous agent process |
| MCP | A protocol for connecting hosts/clients to tools and resources | An agent engine, authorization policy, or guarantee of trustworthy data |
| Knowledge / memory | Reference material / retained, scoped collaboration context | All previous chat text copied into every future task |
| Evidence / artifact | Traceable support / a usable, versioned work output | A citation-looking string / any file emitted by a script |
