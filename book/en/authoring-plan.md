# Authoring and Maintenance Plan

Status: maintenance and release plan accompanying the first English manuscript draft. Module 00 and Chapters 01–20 now have prose, worked examples, practice, and references. Tested teaching implementations and pilots remain release work. This manuscript task adds no dependencies and does not modify product scope; see [draft status](draft-status.md).

## 1. Responsibilities of the documents

- [Course overview](README.md): audience, purpose, technical baseline, and scope.
- [Curriculum](curriculum.md): chapter order and learning outcomes; the authoritative chapter numbering.
- [Labs and assessment](labs-and-assessment.md): fixture contracts, capstone acceptance, scoring, and readiness gates.
- This document: writing sequence, chapter structure, repository reference map, and maintenance requirements.

Course objectives are set by learner needs and O1–O8, independently of BetterWork's release progress. Product requirements, ADRs, and implementation status remain in `docs/`; they inform case studies but do not determine which course outcomes are available. A teaching implementation can precede the corresponding product feature without changing the product roadmap.

Use backward design: observable exit evidence → assessment → prerequisites → guided practice → explanation and references. Preparing a missing adapter, dataset, or setup guide is author work, not grounds for dropping an outcome or asking beginners to invent the infrastructure.

## 2. Content layout and remaining assets

The manuscript and supporting prose now exist alongside the four English course specifications. Paths explicitly marked future remain release work, not completed assets. The separate `book/cn/` directory is outside this revision; no files are moved or synchronized automatically.

```text
book/en/
  README.md
  curriculum.md
  labs-and-assessment.md
  authoring-plan.md
  manuscript.md                   # Preface, attribution, complete reading map
  references.md                   # Pinned code sources, bibliography, MIT notice
  draft-status.md                 # Verification and remaining release work
  foundations/                    # Draft Module 00, F01–F04, diagnostic, glossary
  chapters/                       # Draft chapter prose, 01 through 20
  lab-guides/                     # Draft L01–L20 companion and reference commands
  examples/agent-lab/              # Future isolated, incremental teaching application
  fixtures/foundations/            # Future tiny hand-checked programming/table examples
  fixtures/retrieval/              # Future corpus, relevance labels, fixed embeddings
  fixtures/research/               # Future campus and professional research inputs
  fixtures/operations/             # Future two-period workbooks and independent oracle
  fixtures/templates/             # Future redistributable DOCX and PPTX templates
  assets/                         # Future diagrams and approved screenshots
  instructor/                     # Draft answers, rubric anchors, facilitation/pilot notes
```

Use chapter IDs from the curriculum and descriptive kebab-case filenames. Do not create empty chapter placeholders. Add each file when it contains an actual teaching deliverable.

The future example is one evolving laboratory. Every guide names a tested starter revision, the learner-owned change, and the milestone solution; avoid twenty unrelated agents. The learner implements a small loop, then extends it without importing unfinished desktop internals. This is a teaching application, not another product runtime. Before executable files are added, integrate their discovery with existing root type/test tooling; do not introduce separate lint, formatter, or TypeScript policies.

The TypeScript/Node.js baseline supplies one consistent reference path. Module 00 bridges learners from their existing language; pseudocode explains mechanisms before syntax. SQL/state machines and domain concepts receive just-in-time primers. No parallel full Python course, frontend-framework prerequisite, or production architecture change is implied.

## 3. Writing batches and exit conditions

These are authoring batches, not product milestones or calendar commitments. At the user's request, the full prose manuscript was drafted before executable preparation and learner pilots. B1–B7 retain their original release exit conditions: written prose alone does not pass a batch. Preparation track P resolves teaching dependencies before dependent labs are released; existing product reference tests are recorded separately.

| Batch | Deliverables | Exit condition | Status |
| --- | --- | --- | --- |
| B0. Outcome-based planning | Two entry routes, O1–O8, revised curriculum, assessment, authoring plan | Links, chapter dependencies, required formats, and outcome/evidence map agree | Specifications retained; manuscript navigation added |
| P. Teaching infrastructure | Tested model/embedding access, local MCP fixture, workbook reader, DOCX/PPTX renderers/templates, thin API/UI adapter | Minimal feasibility checks, pinned dependencies, supported-environment matrix, and named role for each asset | Course packaging pending; reference code/tests available |
| B1. Foundations and first agent | Module 00/F01–F04, Chapters/Labs 01–05, diagnostic, glossary, starter/solution milestones | Both entry profiles pass G0/G1 using documented support; early pilot corrections applied | Prose/guidance drafted; executable and pilot exit conditions pending |
| B2. Useful capabilities | Chapters/Labs 06–10, metrics, MCP, lexical/embedding retrieval, context/memory, Skill/Expert presets | O3–O4 evidence passes G2, including actual protocol use and measured retrieval | Prose/guidance drafted; executable and pilot exit conditions pending |
| B3. Harness engineering | Chapters/Labs 11–13, threat cases, lifecycle/SQLite primer, evaluation set and budgets | Boundary, recovery, redaction, regression, and bounded-stop evidence passes G3 | Prose/guidance drafted; executable and pilot exit conditions pending |
| B4. Data and document engineering | Chapters/Labs 14–16, workbook oracle, content model, Markdown/DOCX/PPTX renderers and QA | Reconciled data and all three formats pass G4, including editability and visual checks | Prose/guidance drafted; executable and pilot exit conditions pending |
| B5. Integrated cases | Chapters/Labs 17–18, campus/professional research packs, two-period reporting | Both journeys pass deterministic, live-model/source, and human review requirements | Prose/guidance drafted; executable and pilot exit conditions pending |
| B6. Delivery and final assessment | Chapters/Labs 19–20, runnable handoff, platform map, calibrated rubric and independent variants | Another learner runs the application; both entry profiles demonstrate G5 | Prose/guidance drafted; executable and pilot exit conditions pending |
| B7. Publication preparation | Pilot corrections, glossary, checked sources, redistribution review, release evidence | Publication gate in the assessment plan is satisfied | Prose/guidance drafted; executable and pilot exit conditions pending |

The manuscript-first request changes writing order, not pilot requirements. Pilot B1 before assessed teaching with at least one programmer new to agents and one first-year-equivalent learner; use the results to revise the already drafted later chapters. Record assistance, misconceptions, completion time, and retry results. Repeat later-course trials with both profiles before publication; passing the first loop does not validate the full workload. These small pilots identify usability issues, not population-level learning effectiveness.

The initial pacing budgets are ten weeks/60 guided core hours plus about 40 independent hours for the accelerated route, or sixteen weeks/84 guided hours plus about 48 independent hours for the supported route. The latter includes 12 foundation and 12 supervised-practice hours. Use observed task times to revise pacing or add support; do not remove required outcomes to fit an optimistic timetable.

### Preparation ownership and release dependencies

Assign people to these roles before executable preparation and pilots; one person may hold several roles, but an independent reviewer checks solutions and numeric oracles.

| Workstream | Accountable role | Required before |
| --- | --- | --- |
| Diagnostics, scaffolding, glossary, route pacing | Curriculum author/instructor | B1 pilot |
| Runtime, model access, fixtures, tests, MCP and embeddings | Teaching engineer | Relevant B1/B2 labs |
| Workbook mappings, arithmetic oracles, campus/domain equivalence | Data author plus independent reviewer | B4 data labs |
| Content models, DOCX/PPTX templates, rendering/editability checks | Teaching engineer plus document reviewer | B4 document labs |
| API/UI adapter, setup matrix, handoff and platform comparison | Teaching engineer | B6 delivery lab |
| Rubric calibration, learner trials, redistribution and release evidence | Instructor/reviewer | Respective pilots and B7 |

If an asset fails its feasibility or acceptance check, repair or replace the teaching implementation and move the affected teaching date. Do not wait for a product feature or substitute screenshots for required editable files.

## 4. Standard chapter structure

Each chapter is authored in this order:

1. **A recognizable problem:** a campus or professional task, with unfamiliar domain terms explained.
2. **Learning contract:** outcome IDs, prerequisites, expected evidence, and a short prerequisite check.
3. **The mechanism:** plain-language definition, pseudocode, and a traceable data/control-flow example.
4. **Design alternatives:** at least one simpler option and the reason for the chosen approach.
5. **A worked example:** a minimal runnable change, expected result, and explanation of each new abstraction.
6. **Guided practice:** tested starter, partial implementation, exact steps, output checks, and staged hints.
7. **A deliberate failure:** reproduce it, distinguish the cause, correct it, and add a regression check.
8. **An independent variation:** change the input/requirement, reduce scaffolding, and assess explanation as well as output.
9. **Transfer and reference:** a different scenario and, where useful, a verified BetterWork sidebar; product internals are not required to understand the lesson.
10. **Summary and retrieval practice:** concept questions, a delayed transfer task, checked references, and the next dependency.

Instructor notes separately contain expected answers, likely misconceptions, fixture oracles, staged hints, remediation variants, and scoring examples. Learner material does not hide essential setup steps in instructor-only notes. Distinguish author-supplied infrastructure from code the learner must implement so completing a supplied example cannot masquerade as independent mastery.

## 5. Capture evidence from product and teaching development

For a product or teaching change that illustrates a concept, preserve a small teaching record:

- The work problem and a sanitized example.
- The observed failure or limitation; expected versus actual behavior.
- The alternatives considered and the reason for the decision.
- The smallest relevant code path and regression test.
- The resulting behavior, remaining limitations, and reusable lesson.
- A verified source revision and links to the decision/test evidence.
- Candidate chapter and exercise IDs.

Capture the record while the decision is fresh; rewrite it into a learner-facing explanation later. Development chronology is not the book's chapter order. Avoid copying full logs or large source files into prose. Use product experience when relevant, and create a teaching experiment when no suitable product example exists. Learning objectives remain stable while the implementation used to teach them can change.

## 6. Reference map into BetterWork

These are optional case-study entry points, not course prerequisites or a claim that every teaching exercise already exists. Before citing product behavior, verify it against current code and focused tests. General concepts also need independent primary sources and teaching examples.

| Chapters | Reading entry points | What to extract |
| --- | --- | --- |
| 01, 17–19 | [Product definition](../../docs/01-product-definition.md), [research/Office workflows](../../docs/06-knowledge-workflows.md) | User value, workflow boundaries, research and reporting cases |
| 03–05 | [Core contracts](../../packages/agent-core/src/types.ts), [engine](../../packages/agent-core/src/agent-engine.ts), [engine tests](../../packages/agent-core/src/agent-engine.test.ts) | Provider/tool boundaries, event ordering, observations, cancellation, loop limits |
| 03, 13 | [Scripted provider](../../packages/agent-core/src/fake-provider.ts), [live provider](../../packages/agent-core/src/openai-compatible-provider.ts), [provider tests](../../packages/agent-core/src/openai-compatible-provider.test.ts) | Offline reproducibility, transport, streaming, error handling |
| 06, 14, 18 | [Calculator](../../packages/tool-runtime/src/calculator.ts), [business metrics](../../packages/tool-runtime/src/business-metrics.ts), [metric tests](../../packages/tool-runtime/src/business-metrics.test.ts), [ADR-0020](../../docs/adr/0020-deterministic-business-analysis.md) | Deterministic comparison as one component of the broader teaching analysis pipeline |
| 07, 11 | [MCP client](../../apps/desktop/src/main/services/mcp-client-service.ts), [MCP tests](../../apps/desktop/src/main/services/mcp-client-service.test.ts), [ADR-0016](../../docs/adr/0016-mcp-transport-and-lifecycle.md) | Protocol adaptation, selected tools, lifecycle, cancellation |
| 08–09, 11 | [Expert/material design](../../docs/designs/experts-and-task-materials.md), [ADR-0014](../../docs/adr/0014-expert-context-and-material-binding.md), [ADR-0015](../../docs/adr/0015-memory-scope-and-governance.md) | Material selection, snapshots, scope contraction, history, confirmed memory |
| 10 | [Capability system](../../docs/05-capability-system.md), [ADR-0011](../../docs/adr/0011-skill-trust-and-local-distribution.md), [ADR-0012](../../docs/adr/0012-composer-capability-binding.md) | Tool/Skill/Expert distinctions, trust, capability bindings |
| 11–12, 19 | [Run service](../../apps/desktop/src/main/services/run-service.ts), [run tests](../../apps/desktop/src/main/services/run-service.test.ts), [architecture](../../docs/03-system-architecture.md) | Application/core separation and persistence boundaries |
| 12 | [Checkpoint service](../../apps/desktop/src/main/services/discussion-checkpoint-service.ts), [ADR-0019](../../docs/adr/0019-discussion-checkpoints-and-rework.md) | Task-level checkpoints, rework, ownership, restart semantics |
| 14–18 | [File artifact service](../../apps/desktop/src/main/services/file-artifact-service.ts), [artifact tests](../../apps/desktop/src/main/services/file-artifact-service.test.ts), [Office read tool](../../packages/tool-runtime/src/read-office-material.ts), [ADR-0018](../../docs/adr/0018-office-input-parsing-boundary.md) | Input versus output responsibilities, validation, versioned deliverables |
| 13, 20 | [Engineering standards](../../docs/12-engineering-standards.md) | Reproducible verification and evidence-based acceptance |

Read the smallest relevant function and test before navigating the full orchestration service. Large files are reference material, not the opening lesson.

Product references require accurate attribution, not constant product-status warnings in learner prose. Put implementation/version notes in author metadata or a case-study sidebar. A missing product feature does not change the chapter's learning contract; cite the tested teaching implementation instead. Check historical product statements before reusing them.

## 7. Primary-source research to perform during writing

The final chapters need checked references, not an invented bibliography. For each source, record its title, author/publisher, stable URL, version where relevant, and actual access date.

- Model and prompt fundamentals: official descriptions of tokens, message roles, context, structured output, limitations, and usage reporting for the demonstrated provider.
- ReAct: the original paper, distinguishing its research formulation from the course's tool-calling implementation.
- Tool calling: official documentation for the protocol used by the tested example.
- MCP: the official specification matching the demonstrated transport and implementation version.
- Retrieval: primary descriptions of lexical retrieval, embeddings/similarity, RAG, and the chosen relevance metrics; evaluate methods rather than advertise a vector database.
- Framework/platform transfer: official documentation for the single comparison required in Chapter 19; keep the mapping of responsibilities central.
- Data and document engineering: authoritative workbook/value semantics and documentation for the pinned DOCX/PPTX generation libraries, templates, and tested viewers.
- Runtime safety and persistence: documentation for the actual state, process, file, and network controls; distinguish mitigations from guarantees.
- Scenario material: publicly usable or explicitly authorized campus/industry sources, with no implied regulatory certification.

Harness is used as an explicitly defined engineering term in this course. Do not attribute a universal standard definition or mandatory component list to the industry.

## 8. Chapter completion checklist

A chapter is complete for teaching release only when all applicable items hold. The current first-draft prose does not claim this checklist has passed:

- [ ] The learner prerequisites, outcome IDs, exit evidence, and prerequisite check are explicit.
- [ ] Both entry profiles can access the required background through a bridge, glossary, or worked example; domain expertise is not silently assumed.
- [ ] Definitions agree with the curriculum and the demonstrated implementation.
- [ ] A tested starter, solution, exact commands, expected outputs, and learner-owned implementation tasks are provided.
- [ ] Required teaching adapters and model access are ready independently of product releases; setup failures are not delegated to beginners.
- [ ] Code follows the existing engineering standards and passes relevant tests/type checks.
- [ ] At least one realistic failure is reproduced and explained.
- [ ] Offline tests do not depend on a live model, internet availability, or private data.
- [ ] Live-model, actual integration, and human checks are recorded separately from deterministic tests, with budgets and all attempts disclosed.
- [ ] Model-generated text is not treated as a correctness oracle.
- [ ] Permissions, resource limits, provenance, and failure behavior are described where relevant.
- [ ] Dependencies, assets, and example data are redistributable and contain no credentials.
- [ ] Product sidebars cite verified behavior; teaching outcomes are supported by tested course examples rather than product-roadmap promises.
- [ ] Required DOCX/PPTX outputs pass structural, editability, and visual checks; screenshots alone are insufficient.
- [ ] Fresh learners from both entry profiles can reproduce the exercise using the documented support; observed time and assistance inform pacing.
- [ ] Links and cited revisions are checked; screenshots and prose match the tested behavior.
- [ ] Independent variations, staged hints, remediation, delayed transfer, and calibrated instructor assessment guidance are present.

No chapter, fixture, or lab should be marked complete solely because text or source code was generated.

## 9. Recommended next release task

Prepare the isolated B1 laboratory from the drafted Module 00 and Chapters 01–05: exact setup commands, foundation starters, scripted/live provider access, learner-owned loop exercises, milestone solutions, and controlled failure fixtures. Preserve the existing headless-first sequence and root engineering standards.

- Independently review the printed arithmetic and assessment anchors before encoding fixture oracles.
- Test a clean installation and publish the supported OS/runtime matrix.
- Validate required model/embedding access and Excel/DOCX/PPTX adapters in preparation track P, without waiting for a product release.
- Pilot B1 with both entry profiles and use observed misconceptions, assistance, and timing to revise the manuscript.
- Continue executable batches in dependency order; retain both capstones, all three formats, and all live/human gates.

These are next release tasks, not implementations performed by the manuscript request. The [lab companion](lab-guides/README.md) identifies prerequisites per exercise; [instructor notes](instructor/teaching-notes.md) supply draft answers and pilot worksheets.
