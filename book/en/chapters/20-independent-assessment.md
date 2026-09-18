# 20. Independent Delivery, Evaluation, and Teach-Back

[Contents](../manuscript.md) · [Previous](19-delivery-and-transfer.md) · [Lab companion](../lab-guides/README.md)

## 1. A recognizable problem

A learner can replay a polished example but cannot explain why its tool call was permitted, change the input schema, or diagnose a duplicated total. The example demonstrates that an artifact exists. It does not yet demonstrate independent engineering competence.

The final assessment asks whether you can explain, change, evaluate, and transfer the system you deliver.

## 2. Learning contract

Outcomes: **O1–O8**, checkpoint **G5**. Prerequisite: Chapter 19 and the final evidence package. Evidence: both baseline capstones, one deeper defense, another learner's handoff replay, an unseen input, a controlled defect diagnosis, and an adaptation brief.

Prerequisite check: can you point to evidence for every outcome without using a screenshot as a substitute for executable behavior or a usable file?

## 3. The mechanism: triangulate competence

A strong assessment combines several observations:

```text
portfolio review -> recipient replay -> learner explanation
  -> unseen input/requirement -> controlled defect
  -> justified correction and regression check -> transfer discussion
```

The portfolio establishes breadth. The replay tests delivery. The explanation tests conceptual ownership. The unseen task tests transfer. The defect tests whether the learner can reason from evidence rather than copy a known sequence.

Coding assistance is permitted during practice and must be disclosed. The final assessment follows the instructor's declared assistance policy and must still establish the learner's own understanding. A memorized explanation of a solution is insufficient if the learner cannot modify its behavior.

## 4. Design alternatives

A quiz can assess vocabulary but cannot establish implementation. A single capstone can demonstrate depth but may omit the other required journey. An oral defense alone can reward confident speech without operational evidence. Use the combined portfolio and practical assessment, with the same technical standard for campus and industry cases.

Do not penalize a learner for author-supplied infrastructure that does not work. Mark the affected release/assessment incomplete, repair the course asset, and provide a retry. Missing Word support is not a reason to replace the required DOCX outcome with a PDF or screenshot.

## 5. Worked example: inspect a portfolio

A learner submits a supported research proposal in Markdown and DOCX, one editable research deck, two period-specific operational decks, numeric/retrieval tests, a redacted trace, and a handoff guide. The reviewer finds that the second-period deck uses current data correctly, but cancellation has only a screenshot and no durable state evidence.

The missing evidence is specific: demonstrate cancellation at a controlled point, inspect terminal state, and prove no incomplete output was promoted. Do not ask the learner to repeat every chapter. Targeted remediation preserves the standard while avoiding irrelevant work.

The shared rubric allocates:

| Dimension | Points |
| --- | ---: |
| Scenario design and task boundaries | 15 |
| Agent mechanics and tool integration | 20 |
| Data/evidence correctness | 20 |
| Harness reliability and controls | 20 |
| Usable deliverables | 15 |
| Reproducibility and teach-back | 10 |
| Total | 100 |

The draft threshold is 80/100, completed G0–G4, and every critical gate in the [assessment specification](../labs-and-assessment.md). A score above 80 cannot compensate for unauthorized execution, fabricated support, overwritten input, false completion, missing required formats, or absent independent competence. Scores are evidence judgments, not a sum of how many files were submitted.

### A concise teach-back

Explain these distinctions in your own words:

- **ReAct:** a reasoning/action/observation pattern; our assessment examines observable decisions, calls, and observations, not private model reasoning.
- **Agent Loop:** the bounded execution cycle that requests model decisions, executes permitted tools, returns observations, and stops.
- **Harness:** the surrounding runtime controls for context, access, lifecycle, persistence, observability, and evaluation, under this book's definition.

Then trace a real case: which input was selected, which call was requested, where it was validated, what observation returned, why execution stopped, and which output version was produced. Vocabulary without that trace earns only partial evidence.

## 6. Guided practice: L20

1. Assemble an outcome-indexed portfolio with exact run/file/test references.
2. Let another learner follow the handoff guide without undocumented help; record assistance honestly.
3. Demonstrate a normal run, a controlled failure, and a reviewed revision.
4. Receive an unseen input and explain the required change before implementing it.
5. Diagnose a supplied defect using persisted state, bounded logs, inputs, and tests; add a regression check for the correction.
6. Defend one capstone in depth and explain a new scenario/platform mapping.

Hints: begin from expected versus actual behavior; locate the earliest violated contract; keep each result tied to its evidence rather than narrating every implementation detail. See [L20](../lab-guides/README.md#l20) and [instructor guidance](../instructor/teaching-notes.md).

## 7. Deliberate failure: an impressive package with a critical defect

Use a synthetic submission with polished slides and a duplicated join that inflates actual spend. Ask whether it passes. It does not: verified numerical correctness is a critical obligation. The correction is to repair grain/cardinality and regenerate affected outputs, not to soften the slide wording.

A second submission reports a cancelled run as completed. Again, visual quality does not compensate. The learner must demonstrate the actual terminal state and repair the reporting/publication logic before reassessment.

## 8. Independent variation

Without reusing the worked answer, adapt the system to a new synthetic project-progress scenario. Identify changed fields, metric definitions, sources, permissions, reviewer roles, and output needs. Explain what remains invariant. The instructor selects a defect from a different layer than the one used in practice so diagnosis is not a memorized fix.

## 9. Transfer and reference

BetterWork's engineering standards illustrate a reproducible code gate and architectural guardrails ([BW26](../references.md#bw26)). A clean build and test suite are necessary software evidence, but they do not establish live-model quality, source truth, Office editability, or successful learner transfer. Keep product verification and course acceptance distinct.

After delivery, assign ownership for dependency updates, model/configuration changes, fixture refresh, metric definitions, template changes, retention, and incident handling. Rerun the relevant evaluation when any of those changes can affect behavior. A previously passing report does not certify an indefinitely changing system.

## 10. Summary and retrieval practice

Independent competence means you can explain why the system works, recognize where it fails, make a bounded change, and verify the result. The final portfolio must include both journeys and all required output formats, not just the most visually impressive example.

Which critical gate could invalidate a score of 95? What does a recipient replay reveal that your own replay misses? How would you distinguish a course-asset failure from a learner misconception?

The book began with four questions: What is permitted? What supports the result? What happens on failure? Can someone else reproduce and revise it? A completed agent application has concrete answers to all four—and evidence that those answers remain true under change.

References: [BW03](../references.md#bw03), [BW21](../references.md#bw21), [BW26](../references.md#bw26), [BW28](../references.md#bw28).
