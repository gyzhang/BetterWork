# Practical Agent Design and Development

> Learn to understand, design, build, evaluate, and deliver agents—from basic programming to complete applications.

Status: tutorial planning draft. This directory contains the course plan, not completed chapters, runnable labs, or evidence that learners have passed them.

## 1. Who this course serves

This course serves two entry profiles with the same final competencies:

| Entry profile | Starting strengths | Support provided |
| --- | --- | --- |
| Programmer new to agents | Can build programs; may know APIs, debugging, and tests | Diagnostic-based exemption from already mastered foundation exercises |
| First-year computer-science student with some programming | Can use variables, conditions, loops, functions, and simple lists/maps | Explicit preparation for files, JSON, HTTP, asynchronous work, modules, Git, tests, and domain vocabulary |

Neither profile is assumed to know agents, machine learning, professional software architecture, accounting, or customer delivery. Prior TypeScript, React, Electron, databases, linear algebra, and model training are not entry requirements.

The actual minimum is the ability to write and explain a small program with a function, a loop, and a conditional. Learners below that point first complete a separate introductory-programming course. Having basic programming experience must not be mistaken for knowing how to build a software system.

The goal is transferable engineering competence, not training to use BetterWork or memorize a framework API. Employees serving banking, energy, and manufacturing customers are one application audience; students can demonstrate the same competence with a campus scenario.

## 2. Learning objectives determine the course

The curriculum is designed backward from what a learner must independently demonstrate. BetterWork's current feature set, release schedule, and implementation gaps do not limit those objectives.

| Concern | Governing question | Relationship to the other track |
| --- | --- | --- |
| Product development | What should the working desktop product deliver next? | Supplies authentic problems, decisions, and examples |
| Course design | What must learners understand and demonstrate? | Defines its own prerequisites, exercises, outputs, and assessment |
| Course preparation | What teaching implementations, datasets, and instructions are needed? | Builds missing teaching assets without waiting for a product release |

For example, Word generation is a required learning outcome alongside Markdown and PowerPoint. If a suitable implementation is unavailable when a chapter is authored, preparing a tested teaching implementation is author work—not a reason to make the outcome optional.

The product and course can inform each other without sharing a completion checklist. This plan changes course scope, not the product roadmap, and does not claim that planned teaching assets already run.

## 3. The two continuing cases

### Case A: Deep research and proposals

Question and selected materials → research plan → local and external evidence → comparison and synthesis → reviewed proposal → Markdown, DOCX, or PPTX → revision.

Emphasis: research scope, evidence quality, conflicting information, uncertainty, human checkpoints, and reusable deliverables.

### Case B: Departmental operational analysis

Excel exports from general-ledger and project-management systems → schema and quality inspection → agreed metric definitions → deterministic calculations → interpretation → presentation → next-period reuse.

Emphasis: period/unit consistency, join correctness, missing values, numerical verification, traceability, and separation of facts from causal hypotheses.

Both cases use synthetic or explicitly approved, sanitized materials. Customer accounts, company templates, and internal data are not prerequisites for core teaching.

A low-domain-knowledge entry uses a campus research proposal and a student-club budget/project report. Professional variants use business-agent proposals and departmental operations. The same source, calculation, permission, and output requirements apply; industry familiarity does not affect the technical pass standard. Before financial examples, teach table grain, joins, periods, units, budget, and variance using a small worked dataset.

## 4. Exit capabilities

| ID | Observable exit capability | Primary chapters |
| --- | --- | --- |
| O1 | Compare a script, fixed workflow, retrieval application, and agent; specify a scenario with measurable success | 01, 05 |
| O2 | Explain model limits, prompts, context, structured output, ReAct, and Agent Loop; implement a bounded loop | 02–05 |
| O3 | Design validated deterministic tools and connect a selected MCP tool without confusing transport with permission | 06–07 |
| O4 | Build and evaluate retrieval, context selection, scoped memory, and reusable working methods | 08–10 |
| O5 | Implement and test Harness boundaries, state, cancellation, recovery, observability, and operating budgets | 11–13 |
| O6 | Analyze Excel data and generate source-grounded, versioned Markdown, editable DOCX, and editable PPTX | 14–16 |
| O7 | Complete research and operational-reporting journeys, incorporate feedback, and verify results | 17–18 |
| O8 | Package a reproducible application, explain deployment responsibilities, and transfer it to another scenario/platform | 19–20 |

The [assessment plan](labs-and-assessment.md) maps these outcomes to observable evidence. Recall questions alone cannot establish any implementation outcome.

## 5. Learning design

- Progress from explain → trace → modify → implement → evaluate → transfer.
- Use pseudocode and worked input/output examples before framework or product internals.
- Teach concepts just before use; provide a glossary and a small domain primer instead of assuming professional experience.
- Scaffold practice with a worked example, partially completed exercise, independent variation, and delayed transfer task; reduce scaffolding over time.
- Introduce tool allow-lists, cancellation, and iteration limits with the first loop; deepen them in the Harness chapters.
- Keep one evolving application, with milestone snapshots and a tested starter for every lab.
- Teach tests and failure analysis from the foundation stage, not only in the final evaluation chapter.
- Separate deterministic checks, live-model evaluations, and human document review. Instructor-provided shared model access can support learners without personal accounts.
- Allow coding assistants, but require learners to explain, modify, and debug their submissions independently and disclose assistance.
- Assess observable decisions, actions, outputs, and state; private model reasoning is not required.

## 6. Technical baseline for the draft

| Area | Teaching choice and rationale |
| --- | --- |
| Reference language | TypeScript/Node.js for a single consistent runnable path with explicit contracts; not an entry prerequisite. Pseudocode and an assessed language bridge support Python/C/Java learners |
| First execution surface | A small terminal program and tests; no frontend framework is needed to understand the loop |
| Models | A minimal provider contract, scripted responses for deterministic checks, and a real model for behavior evaluation; teach limitations before abstractions |
| Tools and integrations | Structured contracts, runtime validation, deterministic calculations, explicit access; one read-only MCP integration |
| Retrieval | Hands-on lexical and embedding retrieval on a small corpus; compare retrieval quality before adding complexity |
| Testing | Small assertions first, then Vitest and integration/evaluation suites; existing repository conventions apply to contributed examples |
| Data and documents | Excel inspection/joins/metrics; Markdown, DOCX, and PPTX generation with content models, templates, provenance, and revision |
| State and delivery | State machines and persistence, then SQLite; a usable CLI/API delivery with a supplied thin UI adapter; desktop IPC as a comparative case |
| Frameworks | Understand the loop first, then map its responsibilities to one framework/platform in Chapter 19; no framework survey |

The author must select and pin teaching-library versions when preparing each executable lab. Missing product functionality is implemented in an isolated teaching adapter when necessary. Course examples do not import unfinished application internals or introduce a second product runtime. Changes to product architecture remain separate decisions; contributed code follows [engineering standards](../../docs/12-engineering-standards.md).

## 7. Reading and planning map

| Document | Purpose |
| --- | --- |
| [Curriculum](curriculum.md) | Foundation module 00, twenty chapters, learning outcomes, exercises, and mastery checkpoints |
| [Labs and assessment](labs-and-assessment.md) | Dataset contracts, two capstones, failure cases, scoring, and readiness gates |
| [Authoring plan](authoring-plan.md) | Writing sequence, chapter template, source map, and evidence requirements |

### Two entry routes, one exit standard

| Route | Proposed pacing | Guided work | Independent work |
| --- | --- | --- | --- |
| Accelerated programmer route | Ten weeks | 60 hours for Chapters 01–20; foundation modules assigned only where diagnostic evidence shows a gap | About 40 hours |
| Supported first-year route | Sixteen weeks | 60 core hours + 12 foundation hours + 12 supervised practice/feedback hours | About 48 hours |

These are planning budgets, not a claim that every chapter takes exactly three hours. The instructor allocates blocks according to lab complexity and pilot results. Extra foundation work extends the accelerated timetable if required. Neither route skips core outcomes or final gates; only pacing and scaffolding differ. A shorter workshop may award milestone completion, not full-course completion.

## 8. Scope boundaries

Core coverage includes model/prompt fundamentals, Agent Loop and ReAct, tools/MCP, practical RAG, context/memory, Skills/Expert presets, Harness, data analysis, all three document output formats, two capstones, and deployment/transfer. Scope is selected for a coherent beginner-to-independent-builder progression, not copied from current product features.

The following are orientation or optional extensions, not prerequisites:

- Model training and fine-tuning: explain where they fit; mathematical derivation and training infrastructure are specialization topics.
- Multi-agent coordination: compare responsibilities and failure modes after mastering one agent; a multi-agent build is an extension, not a beginner prerequisite.
- Browser/desktop automation and generic workflow editors: discuss tool and control implications; mastering those platforms is a separate specialization.
- Enterprise identity, tenant isolation, deployment, and compliance: teach requirements and ownership; production certification is outside a classroom assessment.
- Rebuilding a complete Office editor or every UI component: unrelated to demonstrating reliable document-generating agents.

Industry exercises teach how to recognize these requirements and assign ownership. A successful local lab is not evidence of production banking, energy, or manufacturing readiness.

## 9. Course authority and preparation status

This overview and the linked curriculum define the course's target competence. The [product roadmap](../../docs/07-mvp-and-roadmap.md) and [product task board](../../docs/development/tasks-experts.md) describe the evolving reference application; they do not gate or reduce course outcomes.

Learning objectives, available teaching assets, and verified lab results are three different facts. All required outcomes stay in scope while authors prepare the necessary material. An unavailable teaching implementation is an authoring blocker to resolve, not a learner exemption or a reason to relabel a required topic as optional.

This directory contains the English planning documents. Chapters, examples, datasets, and evaluated teaching releases are still to be authored. Publication must cite tested revisions and distinguish course examples from product behavior. Changes here do not automatically revise the separate `book/cn` materials.
