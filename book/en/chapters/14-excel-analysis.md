# 14. Analyze Excel Data with Deterministic Tools

[Contents](../manuscript.md) · [Previous](13-evaluation-and-budgets.md) · [Next](15-markdown-and-word.md)

## 1. A recognizable problem

A workbook opens successfully and the agent reports a total. Unfortunately, the total includes duplicated ledger rows, a budget joined once per transaction, and a formula whose cached value was unavailable. None of those failures is repaired by a more polished explanation.

Reading a workbook is only the first stage of analysis. The next stages establish what rows mean, how they relate, and which calculations are justified.

## 2. Learning contract

Outcome: **O6**. Prerequisite: G3; revisit F04. Evidence: workbook inspection, approved field/metric mapping, join-cardinality checks, reconciliation, an independent numeric oracle, and input-to-result locators.

Prerequisite check: define table grain, missing versus zero, and actual minus budget. Explain how a duplicate dimension key can change a sum.

## 3. The mechanism: inspect, normalize, reconcile, calculate

A workbook contains worksheets; a worksheet contains cells addressed by row and column. A **range** such as `A1:G4` names a rectangular region. Cell appearance is not its value: formatting may display a number as a currency or percentage. A formula is an expression; a cached result is a value stored by a calculating application. A parser does not necessarily recalculate formulas.

```text
selected immutable workbook copies
  -> inspect sheets, ranges, cell types, formula/cache state
  -> map reviewed source fields to a normalized schema
  -> validate keys, periods, units, signs, numeric range
  -> aggregate ledger at the required grain
  -> validate dimension/budget joins
  -> reconcile row counts and totals
  -> calculate approved metrics
  -> structured results, locators, warnings, and quality report
```

Record exclusions with reasons. A row that fails validation must not simply disappear from an otherwise plausible total. Distinguish a blocking quality error from a nonblocking warning under the agreed report policy.

Money in this example uses integer minor units. Validate both inputs and accumulated totals within the exact numeric range of the implementation; in JavaScript, individually safe integers can still overflow the safe range when summed. Do not mix currencies or convert implicitly. Hours have their own explicit unit and precision policy.

## 4. Design alternatives

For a tiny dataset, a small deterministic TypeScript transformation is enough. A dataframe or SQL engine can simplify larger joins and aggregations, but cannot choose the correct grain for you. Asking a model to inspect a screenshot can help describe a layout; it cannot replace a validated numeric pipeline.

Normalize the teaching export rather than pretending every ledger has identical signs and field names. A reviewer must approve how source account codes map into the teaching metric. The model may propose a mapping; the host executes only the validated, approved transformation.

## 5. Worked example: three tables and a hand-checked oracle

All rows below are synthetic. P1 is a period identifier, not an actual customer reporting period. One USD unit equals 100 minor units for this fixture.

Ledger, one row per entry:

| entry_id | period | project_id | metric | amount_minor | currency |
| --- | --- | --- | --- | ---: | --- |
| e1 | P1 | A | spend | 12000 | USD |
| e2 | P1 | A | spend | 8000 | USD |
| e3 | P1 | B | spend | 5000 | USD |

Projects, one row per project:

| project_id | label | planned_hours | actual_hours |
| --- | --- | ---: | ---: |
| A | Research | 20 | 18 |
| B | Events | 10 | 12 |

Budget, one row per period/project/metric/currency:

| period | project_id | metric | currency | budget_minor |
| --- | --- | --- | --- | ---: |
| P1 | A | spend | USD | 22000 |
| P1 | B | spend | USD | 8000 |

Aggregate ledger entries first: A = `20000`, B = `5000`, total = `25000`. Join those two aggregate rows to unique project and budget rows. Budget totals `30000`; actual hours total `30`, equal to planned hours `30`, while project-level deviations remain A = `-2` and B = `+2` hours.

| Metric | A | B | Overall |
| --- | ---: | ---: | ---: |
| Actual spend | 20000 | 5000 | 25000 |
| Budget | 22000 | 8000 | 30000 |
| Actual minus budget | -2000 | -3000 | -5000 |
| Budget ratio | -1/11 | -0.375 | -1/6 |

Overall ratio is `-5000 / 30000`, not the unweighted average of project ratios. Compare an independently supplied previous-period total `20000`: change is `5000`, ratio `0.25`. Preserve full precision and round display percentages to two decimal places for this fixture. Include denominator, unit, and period with the result.

If you attach the A budget to each of its two ledger entries before summing, the apparent total budget becomes `22000 + 22000 + 8000 = 52000`. If you duplicate project A in the dimension, the ledger join can inflate actual spend to `45000`. Both queries can execute without a syntax error. Reconciliation detects the semantic failure.

### Formula-cache boundary in the reference

BetterWork source ([BW22](../references.md#bw22), MIT):

```ts
const formula = String(raw.formula);
const result = 'result' in raw ? raw.result : undefined;
cells.push({
  address: cellAddress(rowNumber, columnNumber),
  formula,
  ...(result === undefined ? {} : { value: result }),
});
if (result === undefined) warnings.push('formula-without-cached-result');
```

The parser preserves the formula and marks an absent cache. It does not claim to evaluate it. Even a present cache can be stale; fixture preparation must establish usable value semantics. Require a recalculated/approved export or an explicitly supported recalculation path. See ExcelJS's versioned documentation ([P10](../references.md#p10)).

## 6. Guided practice: L14

1. Inspect the supplied workbook pack and map actual sheet/range locators to normalized fields.
2. Validate entry uniqueness, project uniqueness, budget composite keys, periods, and currencies.
3. Aggregate at the agreed grain and assert join cardinality before combining tables.
4. Reconcile accepted source totals, excluded rows, and final aggregates.
5. Compare the resulting values with the hand-derived table above and the independent fixture oracle.
6. Write two measured findings and two clearly labeled hypotheses requiring additional evidence.

Hint 1: retain source row/cell identities throughout transformations. Hint 2: unmatched projects are visible exceptions, not automatic deletions. Hint 3: a missing project budget makes a complete overall budget comparison unavailable unless a reviewer explicitly defines a partial-coverage report. See [L14](../lab-guides/README.md#l14).

## 7. Deliberate failure: the same number in incompatible units

Replace one currency with another and one hours field with minutes. The pipeline must reject the incompatible aggregation before arithmetic. Add separate mutations for duplicate keys, missing current amount, zero baseline, negative baseline, and missing formula cache.

The course's period and budget ratios use signed denominators; negative baselines carry interpretation warnings. BetterWork's comparison helper uses absolute denominators ([BW08](../references.md#bw08)). Reuse it as a reference for validation and structured results, not as an unmodified oracle for the course's negative-baseline rule. The workbook pipeline also needs transformations that the comparison helper does not implement.

## 8. Independent variation

Analyze synthetic planned/actual project hours with one unmatched project and a zero planned-hours value. Produce a quality report and reconcile the known totals without inventing a ratio for the zero baseline. Explain why aggregate hours matching plan can hide project-level exceptions.

## 9. Transfer and reference

The Office material tool binds reads to selected snapshot/version identities and locators ([BW23](../references.md#bw23)). The parser supplies cells and warnings; the comparison helper supplies bounded arithmetic. Schema mapping, join validation, reconciliation, and independent oracles remain distinct responsibilities. Do not label these components a complete analysis pipeline until the integrated teaching adapter passes those checks.

## 10. Summary and retrieval practice

Trustworthy analysis preserves grain, keys, units, missingness, and provenance. Tools calculate; people approve definitions; models explain supported results and label hypotheses. Reconciliation is a correctness check, not optional bookkeeping.

Why is overall budget deviation not the average of row percentages? What makes `52000` a wrong budget despite valid arithmetic? Can a cached formula result be stale? Delayed transfer: identify every report and slide field affected when e3 changes in Chapter 18.

References: [BW08](../references.md#bw08), [BW09](../references.md#bw09), [BW22](../references.md#bw22), [BW23](../references.md#bw23), [BW30](../references.md#bw30), [P10](../references.md#p10).
