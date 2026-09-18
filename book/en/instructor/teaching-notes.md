# Instructor Notes: Facilitation, Answers, and Calibration

[Manuscript](../manuscript.md) · [Lab companion](../lab-guides/README.md) · [Assessment authority](../labs-and-assessment.md) · [Draft status](../draft-status.md)

These are first-draft teaching notes, not evidence of a learner pilot. The answers below support feedback; learners still demonstrate independent work on new inputs. Executable starters, practical variants, and scoring calibration must be tried before assessed teaching. Essential setup instructions belong in learner-facing lab guides, never only here.

## 1. Facilitate two routes without creating two standards

Begin with the Module 00 diagnostic in the learner's familiar language. Accept a correct Python, Java, C, or other-language explanation as evidence of basic programming. Use the TypeScript bridge to teach the course's reference syntax. Do not infer API, asynchronous, or testing competence from a learner's job title or university year.

For each new mechanism, use this sequence:

1. State the problem and ask for a prediction.
2. Trace a small example before introducing implementation details.
3. Let the learner change one input or boundary and explain the expected effect.
4. Introduce the deliberate failure; ask for expected versus actual behavior.
5. Give staged help only where needed.
6. Assess a new variant after the help is removed.
7. Revisit the same invariant in a different domain later.

An experienced programmer may skip instruction after demonstrating an exit. A first-year learner may receive more supervised practice. Both must meet the same implementation, evidence, safety, and document requirements. Explain unfamiliar financial or organizational terms before scoring technical reasoning. Confidence, English fluency, and industry vocabulary are not substitutes for correctness.

The initial ten-week and sixteen-week schedules are estimates. Record actual work and assistance before endorsing either schedule. If setup consumes a session, record an authoring problem; do not reduce the learner's score or silently remove an outcome.

## 2. Foundation diagnostic and remediation

| Exit | Expected reasoning | Frequent misconception | Targeted remediation |
| --- | --- | --- | --- |
| Entry | Positive-only sum of `[5, -2, 0, 7]` is `12`; all-value sum is `10`; an empty sum is `0` under the stated contract | Copying a function without explaining the conditional | Trace one iteration at a time with a different four-value list |
| F01 | A module exports a contract; a path locates a file; a manifest and lockfile have different roles; the diff identifies the learner's change | A successful installation proves the program is correct | Modify a small function, predict its test, and explain only the changed lines |
| F02 | All three sample objects are valid JSON; only the integer-valued record meets the required amount contract | Parsing JSON or adding a static type validates external data | Classify missing, string, fractional, and unsupported-unit values before implementing checks |
| F03 | A partial stream is not completion; an abort signal requires cooperation; empty success differs from failure | Catching every exception and returning `[]` is robust handling | Compare delayed success, explicit empty success, transport failure, and caller cancellation |
| F04 | Row grain and join cardinality determine totals; missing and zero differ; the oracle is independent | A query that executes successfully must have computed the correct business result | Count matches per key and reconcile a three-row table by hand |

G0 needs all four exits. Remediation is specific to the failed exit. Supply a new variant for the retry and retain the original result; do not make learners repeat already demonstrated foundations.

## 3. Chapter-by-chapter answer guide

These are criteria for a defensible answer, not a required script. Ask learners to connect each explanation to their own trace, test, or artifact.

| Chapter | Expected answer or demonstration | A useful probe |
| --- | --- | --- |
| 01 | Select the simplest system that meets the brief. An agent is justified by bounded, observation-dependent decisions, not by the presence of a model | If every input and stage is fixed, what does an agent add? |
| 02 | Explicit prompts improve specification, but cannot supply absent facts, enforce permissions, or guarantee truth. Record all repeated attempts | Which requested statement cannot be known from the supplied material? |
| 03 | The model proposes a named call; the host validates and permits it; the tool executes; the result returns under the same call identity | What happens if JSON is complete but the provider exchange ends unexpectedly? |
| 04 | A bounded loop returns observations and has explicit terminal outcomes. One permitted tool round can contain multiple calls | With a one-round limit, can a final model response follow the first tool observation? |
| 05 | Fixed stages and adaptive loops can coexist. Conflicting authority requires explicit resolution or escalation | Which observation changes the next action, and which transition is fixed? |
| 06 | Runtime contracts include values, units, missingness, permissions, and numeric range. The course uses signed comparison denominators | Why do `-100` to `-80` produce a positive amount change but a negative signed ratio? |
| 07 | MCP supplies a protocol boundary. Discovery and a successful connection do not grant tool access | Show an advertised operation that the current run cannot call |
| 08 | Measure retrieval separately from answer support. Relevance is judged for a particular question and corpus | Can perfect Recall@k coexist with an unsupported answer? |
| 09 | Reuse a confirmed method/preference while replacing changing facts. Exclusion must affect the actual request, including derived context | After deletion, where could a stale summary still reintroduce the memory? |
| 10 | Tools execute, Skills package methods, and Experts configure roles/capabilities; two presets can share one engine | Which effective permissions changed when the preset changed? |
| 11 | Host enforcement is tested by directly submitting forbidden operations. Prompt wording is not the enforcement boundary | What does a canonical-path check fail to guarantee? |
| 12 | Stable identities and durable state support recovery. Retrying a side effect needs outcome reconciliation and logical identity | If publication committed before an abort arrived, what fact must remain true? |
| 13 | Evaluation separates deterministic, integration, model, human, and delivery evidence. Missing usage is unknown | Where are failed attempts recorded, and what happens at the budget limit? |
| 14 | Validate grain/keys, aggregate facts, join summaries, and reconcile. Formula caches are not evidence of fresh recalculation | Which test would catch multiplying one project's budget by its number of entries? |
| 15 | Reviewed meaning is separate from a renderer. Markdown and DOCX must agree on facts and sources; text/tables remain editable | Could a structurally valid DOCX still fail the assignment? |
| 16 | A slide has a communicative purpose, verified numbers, and native editable objects. Preview success is insufficient | Change one source number: where must it change across the deck? |
| 17 | Research produces supported claims, visible conflicts, options, and a reviewable recommendation—not invented certainty | Why is an interview request not proof of platform capability? |
| 18 | P2 has new task/input identities; the prior report is historical context. A missing budget blocks the complete budget comparison | What changes when a corrected budget revision is selected? |
| 19 | A recipient can run and stop the package with documented configuration. Framework transfer maps responsibilities, not API names alone | Which authorization responsibility remains yours after adopting LangGraph? |
| 20 | Portfolio, replay, teach-back, unseen variation, and defect correction together establish competence | Which critical gate can invalidate a numerically high rubric score? |

For Chapter 04's pinned reference, a zero tool-round budget still permits the initial model exchange. A no-tool answer can complete; a requested tool round cannot execute. With a one-round budget, the first tool round can execute and a following no-tool answer can complete. Another requested tool round fails at the limit. Ask learners to distinguish this from a total-call or cost budget.

For Chapter 08's illustrative broad query, the relevant set is `{C1, C2}`. The hypothetical lexical top two `{C2, C3}` give precision and recall `1/2`; the hypothetical embedding top two `{C1, C2}` give `1`. These are answers to the printed example, not actual embedding measurements. Zero relevant labels require a declared metric policy; do not invent a denominator.

For Case A, C1 is the newer cloud-policy statement, C2 describes the platform's local retrieval and lack of scheduling, C3 expresses a desire, and C4 preserves a historical policy. The recommendation must respect the applicable policy and actual capability while labeling missing information. Metadata, ownership, and applicability determine whether a source supersedes another; a convenient conclusion does not.

## 4. Independent arithmetic oracle

These derivations use the printed synthetic tables. Have a second reviewer reproduce them without invoking the application under assessment before turning them into executable fixture assertions.

### P1: totals, comparisons, and bad joins

- A has `12000 + 8000 = 20000` minor units; B has `5000`; overall actual is `25000`, displayed as USD 250.00 under this fixture's currency convention.
- Budget is `22000 + 8000 = 30000`. Deviation is `25000 - 30000 = -5000`; ratio is `-5000 / 30000 = -1/6`, approximately `-16.67%`.
- A's deviation is `-2000`, ratio `-2000 / 22000 = -1/11`, approximately `-9.09%`.
- B's deviation is `-3000`, ratio `-3000 / 8000 = -0.375`, or `-37.5%`.
- Against a previous overall actual of `20000`, change is `5000`, ratio `5000 / 20000 = 0.25`, or `25%`.
- Duplicating the A dimension row duplicates A's two spending entries: `20000 + 20000 + 5000 = 45000`. Reject the key violation; do not compensate by arbitrarily dropping joined rows.
- Joining budget to individual ledger rows and summing repeats A's budget: `22000 + 22000 + 8000 = 52000`. Budget is not measured at ledger-entry grain.
- Planned hours total `20 + 10 = 30`; actual hours total `18 + 12 = 30`. Equal totals do not imply that each project matched its plan or that spending was efficient.

### P2: missing input and corrected revision

- A actual is `20000`, B actual is `7000`; overall actual is `27000`.
- Change from P1 is `27000 - 25000 = 2000`; ratio is `2000 / 25000 = 0.08`, or `8%`.
- With B's budget missing, the complete P2 budget total and overall budget ratio are unavailable. A subtotal must be labeled incomplete; zero substitution is incorrect.
- With the corrected selected budget, `22000 + 9000 = 31000`. Overall deviation is `27000 - 31000 = -4000`; ratio is `-4000 / 31000 = -4/31`, approximately `-12.90%`.
- The corrected budget changes budget comparisons, not actual spending or the P1-to-P2 change. A new artifact version identifies the newly selected input revision and preserves the earlier artifact.

### Edge cases and interpretation

For previous `-100` and current `-80`, amount change is `20`. The course's signed ratio is `20 / -100 = -0.2`. BetterWork's pinned helper divides by `Math.abs(previous)` and returns `0.2`; this intentional teaching-contract difference is documented, not silently corrected in product code. Negative baselines need an interpretation warning under the course rule. Zero yields no numeric ratio; missing yields an unavailable comparison. Neither justifies a displayed `0%`.

A decrease in spending is not automatically favorable. A causal statement about membership, supplier prices, productivity, or project success needs additional evidence. Credit a learner who identifies that limitation; do not reward an unsupported explanation merely because it sounds managerial.

## 5. Staged hints and independent variants

Use three hint levels: **contract** (restate the required behavior), **boundary** (identify the relevant input/state transition), and **analogy** (solve a smaller different example). Only then discuss the supplied solution. Record which level was needed, and retry on new data.

| Difficulty | First hint | New assessment variant |
| --- | --- | --- |
| Missing value became zero | What fact does zero assert? | Missing planned hours instead of missing budget |
| Tool request treated as success | Which component owns the actual effect? | A schema-valid but unselected MCP call |
| Endless loop | What count changes on each permitted transition? | Several calls within a round, followed by a final answer |
| Deleted memory reappears | Inspect the complete provider input | Remove a preference that was also summarized |
| Duplicated total | State the grain of both tables | Duplicate a different project with different amounts |
| Stale validation accepted | Which exact bytes were validated? | Alter a document after structural validation |
| Incorrect cancellation badge | Locate the durable terminal transition | Deliver an abort immediately after successful commit |
| Attractive but unusable deck | Which required objects can the recipient edit? | Replace one native table with a screenshot |

Do not use actual private files, credentials, customer endpoints, or production processes for negative tests. Supply disposable fixtures and controlled interruption points. A final practical defect must be prepared and verified by the instructor, not improvised against the shared development checkout.

## 6. Draft scoring calibration

The [assessment specification](../labs-and-assessment.md#8-final-assessment-rubric) owns the six dimensions and critical gates. The anchors below make intermediate scores concrete. They require instructor calibration before use; they are not observed learner results.

| Dimension | Absent/incorrect | Partial anchor | Strong but incomplete anchor | Full-credit anchor |
| --- | --- | --- | --- | --- |
| Scenario, 15 | 0: no judgeable goal or boundary | 7: goal and outputs present, acceptance or simpler baseline incomplete | 12: testable cases and alternatives, one unresolved noncritical ownership detail | 15: independently justified brief, exclusions, alternatives, measurable acceptance |
| Mechanics, 20 | 0: cannot trace a real exchange | 10: guided loop works, independent modification or MCP evidence incomplete | 16: working loop/MCP and explained failures, one noncritical contract explanation weak | 20: independently implemented and modified bounded loop with validated integration |
| Data/evidence, 20 | 0: no defensible results | 10: partial calculations or source mappings, incomplete retrieval comparison | 16: correct checked results, minor noncritical evaluation analysis incomplete | 20: independent oracle, measured retrieval, source support, explicit uncertainty |
| Harness, 20 | 0: no demonstrated controls | 10: normal lifecycle and some negative checks, recovery or redaction incomplete | 16: required boundary/state tests pass, one noncritical operational explanation weak | 20: independently explained and tested scope, failure, cancellation, recovery, budgets |
| Deliverables, 15 | 0: no usable output package | 7: some required files or checks absent | 12: required files pass, minor presentation/readability refinement remains | 15: both journeys, all formats, editability, source/number consistency, revision lineage |
| Reproducibility, 10 | 0: cannot reproduce or explain | 5: own replay works, recipient or independent change incomplete | 8: recipient replay and independent work pass, maintenance guidance slightly incomplete | 10: documented handoff, accurate teach-back, independent diagnosis and transfer |

Assign intermediate integers by explaining which observable evidence lies between anchors. Do not infer credit from file count. Apply the critical gates separately: an incomplete or unsafe portfolio does not pass merely because its arithmetic score exceeds 80.

Hypothetical calibration cases:

- **82 points, incomplete:** `13 + 17 + 17 + 15 + 12 + 8 = 82`, but cancellation lacks durable-state evidence. Require targeted remediation and reassess; do not mark G5 passed.
- **89 points, pass:** `14 + 18 + 18 + 18 + 13 + 8 = 89`, with G0–G4 and every critical gate supported by inspected evidence. Record remaining noncritical improvement suggestions separately.
- **Nominally 95, fails a gate:** an otherwise strong package exposes a credential or reports unauthorized execution as successful. Stop distribution, follow the declared incident procedure, and reassess only after the issue is resolved. A high score cannot compensate.

Have two reviewers independently score the same synthetic submission, compare evidence judgments, and resolve disagreement before grading learners. Publish the assistance policy and gates in advance. Accommodations can change timing or presentation method without changing the technical competence assessed.

## 7. Pilot protocol and maintenance

Run an early B1 pilot with at least one programmer new to agents and one first-year-equivalent learner once tested starters exist. Then pilot the later material and both capstones with both profiles. Two people can reveal usability problems; they do not establish broad learning effectiveness.

For every pilot exercise, record:

| Field | Required observation |
| --- | --- |
| Participant profile | Prior programming and demonstrated foundation exits; avoid unnecessary personal data |
| Asset baseline | Manuscript, starter, solution, fixture, dependency, model/configuration revisions |
| Intended evidence | Which outcome and mastery gate the exercise assesses |
| Work and assistance | Active time, setup delay, hint level, assistant/collaborator use |
| Misconception | Learner's prediction and the observed mismatch |
| Result | Passed, incomplete, or failed, with evidence and a specific reason |
| Remediation | Material change, targeted practice, and new retry variant |
| Follow-up | Delayed transfer result, pacing adjustment, and owner of unresolved work |

Do not mark a pilot completed from an instructor's own walkthrough. Retain failed attempts and course-asset defects. Refresh affected tests and evaluations when provider behavior, dependencies, metric definitions, permissions, templates, or source revisions change. Preserve the distinction between a newly written chapter, a passing reference test, an executable lab, and demonstrated learner competence.
