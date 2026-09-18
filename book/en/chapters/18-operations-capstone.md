# 18. Capstone B: Operational Analysis Across Two Periods

[Contents](../manuscript.md) · [Previous](17-research-capstone.md) · [Next](19-delivery-and-transfer.md)

## 1. A recognizable problem

The first report looks correct. The next period uses new inputs, but an old total survives in a slide title and a missing budget is silently replaced by last period's figure. The agent has reused the wrong things.

Repeated reporting tests whether the system preserves method and lineage while refreshing facts. It is a stronger test than running the same prompt twice.

## 2. Learning contract

Outcome: **O7**, integrating O3–O6. Prerequisite: G4 and Chapter 14. Evidence: quality reports, approved mappings, independently checked metrics, source-grounded narrative, two period-specific editable decks, and cancellation/restart/rework records.

Prerequisite check: why must the next period be a new task with explicitly selected inputs? Which parts of a prior artifact are useful context, and which cannot establish current facts?

## 3. The mechanism: repeat the process, not the answer

```text
Task P1: selected ledger/projects/budget -> quality and definitions
  -> deterministic analysis -> reviewed narrative/outline
  -> editable report deck -> validation and versioned delivery

Task P2: new selected inputs + approved method + selected P1 artifact
  -> fresh quality checks -> fresh calculations
  -> compare with authorized prior-period evidence
  -> reviewed narrative/outline -> new period-specific deck
```

The prior deck supplies historical context and presentation structure. If comparisons require underlying prior metrics, select their verified records or source inputs explicitly. A chart image is not an independent numeric oracle. Reuse a confirmed preference such as “lead with exceptions,” not a hidden current-value default.

Each finding needs period, unit, source locator, and calculation identity. Separate the quantitative fact from a proposed explanation. “Spending increased by 8%” can be computed. “Membership growth caused the increase” needs membership and causal evidence not present in a ledger alone.

## 4. Design alternatives

A fixed reporting pipeline may be the strongest baseline when the export schema and output structure are stable. An agent can assist with schema questions, exception investigation, and explanation, while deterministic tools retain arithmetic responsibility. Manual spreadsheet work remains a useful comparison for effort and error detection.

Do not turn a reporting task into autonomous budget approval or operational control. A management report supports a human decision; it does not authorize changing the source system.

## 5. Worked example: fresh facts and a visible missing budget

P1 uses Chapter 14's three entries: A totals `20000`, B totals `5000`, and overall actual is `25000` minor units. Budget is `30000` and deviation is `-5000`.

P2 contains new entry identities and a new period. A remains `20000`; B becomes `7000`; overall actual is `27000`. Initially, P2's B budget is missing. Do not copy P1's `8000` into it.

| P2 result before clarification | Expected treatment |
| --- | --- |
| Actual total | 27000 minor units; complete for the accepted ledger |
| Change versus P1 | 2000 minor units; ratio 2000/25000 = 0.08 |
| A budget | Available if explicitly present in P2 input |
| B budget | Missing |
| Complete overall budget deviation | Unavailable until the required budget coverage is resolved |

The report may say, “Actual spending is USD 270.00, up USD 20.00 (8.00%) from P1. A complete budget comparison is unavailable because B's P2 budget is missing.” It cannot say the club is on budget. A partial comparison requires explicit coverage labeling and reviewer agreement.

Suppose the reviewer supplies a new P2 budget revision: A `22000`, B `9000`. Recompute from the new selected revision:

| Metric | P1 | P2 | Interpretation |
| --- | ---: | ---: | --- |
| Actual | 25000 | 27000 | Increase of 2000, or 8.00% |
| Budget | 30000 | 31000 | Each belongs to its own period |
| Actual minus budget | -5000 | -4000 | Underspend narrows by 1000 |
| Budget ratio | -1/6 | -4/31 | Approximately -16.67% and -12.90% |

All currency figures in the table are minor units. A and B's P2 budget deviations are each `-2000`. The overall ratio is `-4000 / 31000`, not an average of project ratios. These are hand-derived teaching expectations, not live-model observations.

An acceptable narrative is: “P2 spending increased while remaining below the newly supplied P2 budget. The data establishes the amount of change, not its cause. Confirm project completion and activity changes before describing the underspend as efficiency.”

### Provenance for the repeated result

Retain links from the P2 deck to the P2 ledger revision, P2 budget revision, project data, approved metric definition, selected P1 comparison evidence, template/method versions, and reviewer decision. The original incomplete-budget attempt remains visible as an attempt; its later correction does not rewrite history.

## 6. Guided practice: L18

1. Run P1 from the clean fixture pack; verify quality, calculations, and deck checks.
2. Start a new task for P2 and select new-period inputs explicitly.
3. Use the missing-budget variant; record the unavailable comparison and clarification.
4. Select the corrected budget revision, recompute, and render the reviewed P2 deck.
5. Cancel a controlled run before publication; show an explicit terminal state and no incomplete deliverable promoted as complete.
6. Interrupt another run, restart, recover its task/checkpoint context, and create a new attempt without duplicate publication.
7. Execute the required case set and compare every repeated chart/table/narrative figure with the oracle.

Hints: compare task IDs and input manifests first; inspect the old-number locations after regeneration; verify both decks remain editable. See [L18](../lab-guides/README.md#l18) and the [assessment contract](../labs-and-assessment.md).

## 7. Deliberate failure: a prior report overrides current evidence

Insert “current spending is USD 250” into a selected prior-report summary. Keep P2's ledger at `27000`. If the new report repeats 250 as current, inspect the context role and content-model bindings. Correct the source selection/role contract and add a test asserting that current metrics derive from current inputs.

Also inject a duplicate project key into P2. Block the unsafe join rather than producing a smooth explanation of the inflated total. Finally supply a causal sentence without supporting evidence and require it to be removed or labeled as a hypothesis. These failures test context, data, and interpretation separately.

## 8. Independent variation

The instructor supplies a third period with a negative comparison baseline for one metric and a newly added project. Independently define the signed-ratio warning, validate the dimension relationship, and identify which past preferences remain applicable. Do not change the metric convention to make the percentage look intuitive.

## 9. Transfer and reference

BetterWork supplies deterministic comparison, selected Office reading, context/memory, checkpoint, and artifact-registration seams ([BW08](../references.md#bw08), [BW23](../references.md#bw23), [BW15](../references.md#bw15), [BW19](../references.md#bw19), [BW20](../references.md#bw20)). The chapter integrates those ideas into a teaching journey with full workbook transformations and the course's signed denominator. Component tests alone do not establish the repeated reporting journey.

## 10. Summary and retrieval practice

Repeat-period competence means reusing approved methods while replacing facts, rerunning quality checks, preserving independent identities, and verifying changed outputs. Missing data remains missing until an authorized source resolves it.

Why is P2's initial overall budget ratio unavailable? Which facts support 8.00%? What evidence would be needed to claim causation? Delayed transfer: explain these source and operating responsibilities to the person receiving your application in Chapter 19.

References: [BW08](../references.md#bw08), [BW09](../references.md#bw09), [BW15](../references.md#bw15), [BW19](../references.md#bw19), [BW20](../references.md#bw20), [BW23](../references.md#bw23).
