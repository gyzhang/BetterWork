# Labs, Capstones, and Assessment

Status: lab specifications only. Fixture names and example paths below describe assets to author later; those files and runnable exercises do not yet exist. Chapter IDs and prerequisites are maintained in the [curriculum](curriculum.md).

## 1. Shared exercise model

All learners demonstrate the foundation exits F01–F04, complete L01–L20, and deliver baseline versions of both capstones. Each learner selects one capstone for a deeper final defense and a campus or industry adaptation. Experienced programmers can test out of foundation instruction, not out of core outcomes.

Exercises grow through six stages:

1. Foundation tasks: files, JSON, asynchronous work, tests, and small tables.
2. Scenario comparison, model limitations, one tool exchange, and a bounded loop.
3. Deterministic tools, MCP, measured retrieval, context/memory, and reusable methods.
4. Harness boundaries, persistence, human checkpoints, and evaluation.
5. Excel analysis and complete Markdown, DOCX, and PPTX deliverables.
6. Two integrated journeys, application handoff, and independent adaptation.

Each concept starts with a worked example, proceeds to guided modification, and ends with an unseen variation. Early starters supply transport and setup; learners implement the loop, tools, controls, and transformations being assessed. Later labs reduce scaffolding. A failed mastery checkpoint leads to targeted feedback and a new variant, not advancement based on attendance.

Teaching code remains isolated from production imports. BetterWork is one reference, not a dependency that determines what can be taught. Authors supply tested teaching adapters for every required capability, including those not yet available in the product. Future code follows existing root tooling and engineering standards; this plan itself creates no runtime or tooling configuration.

### Outcome-to-evidence map

| Outcome | Primary exercises | Required evidence |
| --- | --- | --- |
| O1. Scenario design | L01, L05 | Testable brief, non-agent baseline, justified control flow |
| O2. Model and loop mechanics | L02–L05 | Prompt comparison, tool exchange, explained loop, terminal-state tests |
| O3. Tools and integration | L06–L07 | Validated deterministic tool, independent oracle, actual local MCP connection |
| O4. Retrieval and working context | L08–L10 | Labeled retrieval comparison, claim/source mapping, memory/scope tests, two presets |
| O5. Harness engineering | L11–L13 | Boundary tests, persistent-state recovery, redacted traces, evaluation and bounded-stop evidence |
| O6. Data and documents | L14–L16 | Reconciled Excel results, Markdown, editable DOCX/PPTX, structural and human checks |
| O7. Integrated work | L17–L18 | Both capstone packages, feedback/revision, second-period independence |
| O8. Delivery and transfer | L19–L20 | Reproducible CLI/API handoff, capability map, unseen-input debugging and defense |

G0 checks the four foundation exits; G1 checks O1–O2; G2 checks O3–O4; G3 checks O5; G4 checks O6; G5 checks the integrated O1–O8 portfolio. Campus and industry variants use identical technical criteria.

## 2. Environment and data preparation

Before runnable labs are published, the author provides:

- A tested source revision, dependency lock, supported runtime versions, and exact setup/run/test commands.
- An offline scripted provider, fixed embeddings, and injected search/MCP responses for deterministic checks; a synthetic local MCP server for the actual protocol exercise.
- Live-model and embedding instructions using placeholders, explicit network/data policies, and per-exercise call/time/cost budgets. Provide institution-managed access or a tested local option so personal paid accounts are unnecessary.
- Module 00 diagnostics, F01–F04 starters, worked solutions, remediation tasks, and a glossary linking familiar programming concepts to agent concepts.
- Campus and departmental versions of synthetic documents/spreadsheets, a worked domain primer, and redistributable DOCX/PPTX templates.
- Tested Excel reading and Markdown/DOCX/PPTX generation adapters, dependency preflights, and an office application for editability/visual checks, including a tested free option.
- A small retrieval corpus, relevance labels, an embedding adapter, and keyword-versus-embedding comparison instructions.
- Exact headless setup instructions for the declared teaching environment, plus separate optional BetterWork reference instructions. The author must test and publish the teaching OS/runtime matrix rather than inherit product packaging restrictions.
- A supplied thin API/UI adapter, persistent-state fixtures, and a local handoff procedure for L19–L20.

No lab requires proprietary company templates, customer accounts, or private production data. Offline checks need no paid service and run without external requests after documented setup. Live-model, embedding, actual MCP, and Office application checks remain required evidence for the relevant outcomes; recordings and mocks do not replace them. If author-provided access or assets are unavailable, mark the teaching release blocked and reschedule the check without penalizing the learner or silently waiving the outcome.

## 3. Exercise evidence contract

Each lab submission includes:

| Item | Required content |
| --- | --- |
| Scenario | Goal, permitted actions, inputs, expected output, and non-goals |
| Environment | Source revision, tool/dependency versions, provider mode, and relevant non-secret settings |
| Execution | Exact command or UI steps, run identity, observed events, and terminal outcome |
| Tests | Normal case, intentional failure, expected result, actual result |
| Output | Artifact or structured result, exact input references, and validation evidence |
| Reflection | Root cause of a failure, chosen correction, and at least one rejected alternative |
| Independent competence | Explanation of the learner's changes, an unseen variation, and disclosure of coding-assistant or collaborator help |

Use a compact worksheet in early labs; do not require a full runtime dossier before a runtime exists. For discussion-only exercises, mark execution fields not applicable and provide the scenario/decision evidence. Supply the template and a completed example before asking beginners to assemble a portfolio. Coding assistants are allowed during practice; the final teach-back and debugging variation must establish the learner's own understanding.

Do not submit credentials, private model reasoning, raw customer records, or unredacted provider logs. Screenshots supplement structured evidence; they do not replace numeric checks, provenance, or editable files.

## 4. Capstone A: Research to a proposal

### Scenario brief

Choose a campus team evaluating an agent for student-club research/planning, or a departmental team evaluating a business-agent opportunity. Both receive a synthetic platform description, a user brief, constraints, and a small external reference collection. The instructor supplies all domain vocabulary and decision criteria; professional customer-delivery experience is not assumed.

The assignment is a decision-support proposal, not an autonomous organizational decision.

### Planned fixture pack

| Asset | Contents | Deliberate complication |
| --- | --- | --- |
| `business-brief.md` | User role, pain point, current process, desired outcome, constraints | One unspecified requirement that needs clarification |
| `platform-capabilities.md` | Supported integration, runtime, and deployment capabilities | A requested feature is not supported |
| `reference-materials/` | Approved local reference documents with IDs and locators | Two documents disagree on a requirement |
| `recorded-web-responses.json` | Fixed source URL, title, capture metadata, excerpt/body, and content hash | A search summary lacks supporting full text |
| `source-manifest.json` | Stable identities, permissions, version information, and intended use | A source exists but is not selected for the task |
| `injection-example.txt` | A clearly labeled synthetic adversarial document | Source text requests access to unrelated files |
| `review-feedback.md` | A change in audience or recommendation priorities | Requires revision after an initial outline |
| `proposal-template.docx` | Redistributable heading, body, table, and source styles | Long table and heading hierarchy need review |
| `proposal-template.pptx` | Redistributable editable slide layouts | A dense slide requires restructuring |

Captured metadata comes from actual fixture preparation; invented capture dates are not evidence. Live-source exercises retain their own capture provenance and are not expected to reproduce the offline text exactly.

### Required journey

1. Clarify the question, decision owner, missing requirements, and usable sources.
2. Propose a bounded research plan and obtain reviewer confirmation.
3. Retrieve local information and use recorded external responses for the deterministic baseline; separately perform a bounded live-source lookup on approved public material and retain its provenance.
4. Register evidence and distinguish supported facts, conflicts, assumptions, and unanswered questions.
5. Compare at least two implementation approaches, including an appropriate non-agent or fixed-workflow alternative.
6. Review the proposal outline before producing the full document.
7. Produce a Markdown proposal, an editable Word document, and an editable PowerPoint presentation from the reviewed content and evidence.
8. Apply reviewer feedback and preserve the previous artifact version and input relationships.

### Required outputs

- Scenario brief and approved research plan.
- Evidence register with source identity, version/capture metadata, locator, and excerpt.
- Claim-to-evidence table; assumptions and recommendations are labeled separately.
- Markdown and DOCX versions of the proposal covering problem, options, recommendation, architecture boundaries, risks, and acceptance criteria.
- A concise PPTX presentation for the intended decision maker.
- Structural checks, source mappings, and human editability/visual review for both Office formats.
- Evaluation report containing both successful and intentionally unsuccessful cases.

The claim-to-evidence table is a required course deliverable. Authors provide a simple tested representation before introducing a richer citation system; learners are assessed on traceable support, not on copying a product UI.

### Acceptance

- Every material factual claim in the final proposal is supported by a source locator or explicitly identified as unverified.
- Conflicting sources are surfaced, not silently merged into a false consensus.
- Unselected material remains inaccessible through the teaching host's tools.
- Embedded instructions cannot change tool permissions or expand material scope.
- Reviewer feedback creates a new version without overwriting the original.
- The proposal can be read independently of the chat history.
- Both DOCX and PPTX open in the documented office application. Text and tables are editable objects, not full-page screenshots; demonstrate editing and saving a sample of each. Charts retain documented data mappings and an editable chart or editable source table.
- Markdown/DOCX headings, tables, claims, and source references agree; the presentation may summarize but cannot change the verified facts.
- Review finds no clipped required content, unreadable charts, broken source references, or unlabeled uncertainty.

Markdown, DOCX, and PPTX are all required. Missing generation or validation support is a course-authoring issue to resolve before the lab is released, independent of BetterWork's release schedule.

## 5. Capstone B: Operational data to a management presentation

### Scenario brief

A student club or department analyzes spending and project progress from spreadsheet exports, discusses exceptions, and creates a presentation. It repeats the work for another reporting period while preserving definitions and replacing changing input data. Teach a tiny hand-checked example before the full workbook; supply definitions for grain, keys, budget, period, variance, and reconciliation.

The teaching dataset is a normalized synthetic export. It is not a claim that every ledger uses the same sign convention, field names, or accounting rules. Real exports need a reviewed source-to-teaching-schema mapping.

### Planned fixture pack and contracts

| Asset | Grain and required fields | Validation emphasis |
| --- | --- | --- |
| `ledger-entries.xlsx` | One entry per `entry_id`: `reporting_period`, optional `project_id`, `metric_code`, signed `amount_minor`, `currency` | Unique entries, approved metric mapping, integer minor units, period/currency consistency |
| `projects.xlsx` | One row per `project_id`: project label, status, planned hours, actual hours | Unique dimension key, allowed statuses, explicit hour units |
| `budgets.xlsx` | One row per period/project/metric/currency key: `budget_minor` | No accidental duplicate budget rows; missing budget differs from zero |
| `metric-definitions.md` | Scope, signs, units, aggregation grain, formulas, rounding, excluded entries | Business reviewer approves definitions before calculation |
| `expected-metrics.json` | Independently verified expected aggregates, changes, warnings, and reconciliation totals | Oracle is prepared without the model under test |
| `previous-report.pptx` | A synthetic previous-period report | Historical context is not current-period data |
| `report-template.pptx` | A redistributable editable presentation template | Asset rights and dependency availability |
| `period-two/` | New-period input files using the same documented schema | A changed metric and a new data-quality issue |

Fixture authors supply a clean pack and separate mutated cases: duplicated keys, unmatched projects, missing values, incompatible currencies, formula cells without usable cached values, and a source containing instructions.

### Calculation boundaries

- Aggregate ledger facts at their documented grain before combining them with project and budget summaries; validate join cardinality and reconcile totals before/after the join.
- Never replace a missing value with zero without an explicit business rule.
- Preserve currency and unit information; no implicit currency conversion.
- Period change amount is current minus previous; change ratio uses the signed previous value as denominator when nonzero. Negative baselines need an interpretation warning.
- Budget deviation is actual minus budget; its ratio uses budget when nonzero. Whether a deviation is favorable depends on the metric definition.
- A zero denominator yields no numeric ratio and a warning. A missing comparison value yields an unavailable comparison, not a fabricated percentage.
- Preserve exact source amounts in integer minor units within the validated numeric range; rounding and percentage display rules belong to the approved fixture specification.
- Missing formula caches cannot be silently treated as recalculated values. Require a usable export or explicitly supported recalculation path.
- Models may map and explain validated results; tools perform aggregation, joins, and arithmetic.

The teaching implementation must support the documented workbook inspection, joins, reconciliation, and calculations. A bounded comparison helper alone does not satisfy this lab; fixture schemas constrain the problem without removing the required data-engineering work.

### Required journey

1. Inspect the workbook structure, sheets, key fields, periods, and formula/value state.
2. Produce a data-quality report and resolve blocking ambiguities with the reviewer.
3. Confirm metric definitions and the relationship between ledger, project, and budget data.
4. Execute deterministic calculations and compare results with the independent oracle.
5. Separate numerical findings from explanations that require additional evidence.
6. Review the report outline, then generate a management presentation with source locators.
7. Create a second task using approved methods and the selected prior artifact version, but new-period inputs.
8. Demonstrate one cancellation and one restart/rework case without publishing incomplete output.

### Required outputs

- Data-quality report and approved input/metric mapping.
- Structured calculations and reconciliation results checked against the oracle.
- A source-grounded narrative distinguishing observations from hypotheses.
- Two editable, period-specific PPTX files, reviewed outlines, input/version lineage, and revision evidence.
- Cancellation, recovery, and evaluation records. Capstone A supplies the required Markdown/DOCX portfolio; this case deepens spreadsheet and repeated-reporting competence.

### Acceptance

- Required numeric results match the independent oracle under the documented precision policy.
- Totals are not inflated by joins; missing or unmatched records are visible.
- Charts, tables, and narrative figures agree with the computed results.
- Material findings identify the relevant workbook, sheet/range, period, and calculation.
- Causal hypotheses are labeled; the agent does not infer causation solely from a change in a metric.
- Current inputs are not inherited from the previous period as hidden defaults.
- Source workbooks are unchanged and outputs remain editable.
- Restart/cancellation evidence shows explicit state and no duplicate published artifact.

## 6. Scenario and platform transfer

Choose one scenario; all use synthetic data and advisory outputs. Campus work is a full-standard alternative, not a reduced assessment for students.

| Context | Suggested training scenario | Transfer questions |
| --- | --- | --- |
| Campus | Adapt a club-budget agent to a research-project progress report | Which definitions and permissions changed? Who verifies the recommendation? What student information must remain private? |
| Banking | Compare operating procedures and draft a process-improvement proposal | Which policy version applies? Who reviews the recommendation? What data cannot leave the approved environment? |
| Energy | Analyze maintenance/work-order exports and summarize operational issues | What is the data grain? Which conclusions need engineer confirmation? Which operational actions remain prohibited? |
| Manufacturing | Analyze quality/delivery exports and prepare a management report | Are batches and time periods comparable? How are defects defined? Which system owns corrective action? |

The learner provides a platform capability map covering model access, tool registration, identity, material scope, persistence, human checkpoints, traces, evaluation, deployment, and operations. Every gap has a mitigation, responsible role, or explicit unresolved status. Use an instructor-selected framework or documented platform that does not require a customer account. The learner also hands off the local CLI/API application, including setup, safe secret configuration, start/stop, error reporting, and maintenance instructions; a proposal alone does not satisfy application delivery.

No exercise authorizes lending decisions, production control, equipment operation, customer-system writes, or compliance certification.

## 7. Evaluation layers

| Layer | Method | What it establishes | What it does not establish |
| --- | --- | --- | --- |
| Tool/unit | Fixed inputs and independent expected results | Calculation and validation behavior | End-to-end model quality |
| Runtime integration | Scripted provider, injected retrieval/MCP, persistent state tests | Ordering, scope, cancellation, recovery, and binding behavior | A real service connection or useful prose |
| Retrieval | Labeled queries on the same corpus; keyword/embedding comparison with fixed top-k | Recall@k, irrelevant hits, and documented relevance trade-offs | Answer correctness or universal superiority of embeddings |
| Actual integration | Local MCP server, selected embedding adapter, approved live-source lookup | Observed protocol and dependency behavior | Production authorization or service availability guarantees |
| Live-model task | Fixed task set and disclosed provider/configuration | Observed task behavior under that configuration | Universal reliability or exact reproducibility |
| Human deliverable | Review proposal/report, sources, editability, usefulness | Suitability for the stated audience and task | Technical guarantees beyond inspected evidence |
| Delivery and transfer | Fresh-environment handoff, unseen variation, capability/ownership review | Reproducible application and reasoned adaptation | Production deployment or regulatory approval |

The release evaluation set includes at least ten cases per capstone: three normal cases, three missing/ambiguous-input cases, two authorization/injection cases, and two lifecycle/rework cases. Execute the full set with controlled fixtures; numeric unit and document-structure coverage is additional. For live-model evaluation, select at least one normal, one insufficient-information, and one revision case per capstone, run each twice, and record every attempt. This small teaching sample demonstrates evaluation practice, not a production reliability estimate.

Before live runs, freeze the case rubric, provider/model settings, corpus revision, and resource budgets. Report completion rate, groundedness, latency, and token/cost observations when available; unavailable usage is unknown, not zero. Failed cases require diagnosis and a documented correction/retest without erasing earlier results. Human acceptance applies to the final submitted documents. A model grader may assist but cannot replace source checks, independent numeric oracles, or the learner's defense.

## 8. Final assessment rubric

| Dimension | Points | Evidence |
| --- | --- | --- |
| Scenario design and task boundaries | 15 | Scenario brief, alternatives, measurable acceptance |
| Agent mechanics and tool integration | 20 | Explained loop, structured contracts, working MCP integration |
| Data/evidence correctness | 20 | Numeric oracle, retrieval comparison, claim/source mapping, uncertainty handling |
| Harness reliability and controls | 20 | Boundary, cancellation, failure, recovery, and negative tests |
| Usable deliverables | 15 | Both capstones, Markdown/DOCX/PPTX, visual/editability checks, version lineage |
| Reproducibility and teach-back | 10 | Handoff replay, environment evidence, accurate concepts, independent debugging |

Draft pass threshold: at least 80/100, completed G0–G4, and every critical gate below. G5 records the final result. Score each dimension using demonstrated evidence: absent/incorrect earns no credit, assisted-only or incomplete evidence earns partial credit, independent correct execution plus explanation earns full credit. Instructor calibration examples must define intermediate scores before teaching. Neither professional vocabulary nor campus-versus-industry choice changes the score. These are proposed course standards, not measured learner results or product acceptance criteria.

Critical gates cannot be compensated for by presentation quality:

- No credentials or unauthorized private data in the submission.
- No unauthorized tool execution in the defined boundary tests.
- No fabricated source or knowingly unsupported numerical result presented as verified.
- No overwritten original input file.
- No unfinished or cancelled run reported as completed.
- Both baseline capstones and all three required document formats are present and pass their structural/human checks.
- The learner independently explains the loop/Harness, changes behavior for an unseen input, and diagnoses a supplied defect.
- Required deterministic checks pass; required live/integration/human checks have evidence or the result is explicitly incomplete. Missing author-supplied assets trigger remediation of the course, not a lower exit standard.

## 9. Course readiness gates

1. **Plan ready:** both entry routes, O1–O8, chapter dependencies, fixtures, and assessment are specified. This revised planning draft is the current deliverable, pending user review.
2. **Lab ready:** starters/solutions, foundation bridges, fixtures, exact commands, and failure cases are tested at a pinned revision; required adapters do not depend on future product releases.
3. **Pilot ready:** at least one programmer new to agents and one first-year-equivalent learner complete Module 00 as needed and Chapters 01–05, passing G1 with only documented support. Record assistance, misconceptions, time, and remediation; two participants are a usability check, not broad validation.
4. **Capstone ready:** both complete journeys, all three document formats, actual integrations, and the application handoff pass offline and required live/human checks. Repeat the later-course pilot with both entry profiles to test total workload and G5 readiness.
5. **Publication ready:** all chapters meet the authoring checklist, assets are redistributable, links resolve, and learner feedback has been incorporated. Publish measured pacing and any supported-environment limitations.

None of gates 2–5 is satisfied merely by creating this planning directory. The [authoring plan](authoring-plan.md) defines how to reach them.
