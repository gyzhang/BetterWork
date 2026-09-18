# 06. Engineer Deterministic Tools

[Contents](../manuscript.md) · [Previous](05-react-and-workflows.md) · [Next](07-mcp.md)

## 1. A recognizable problem

A report says spending increased by 25%, but the prior value was missing. Another report divides by zero and displays infinity. These are not problems to solve by asking the model to be more careful. The calculation contract must represent unavailable results and enforce its assumptions.

A tool should make invalid work difficult to confuse with a valid answer.

## 2. Learning contract

Outcome: **O3**, preparing O6. Prerequisites: G1 and F04. Evidence: a deterministic comparison contract, independent expected values, invalid-input tests, and a bounded read-only file tool.

Prerequisite check: explain missing versus zero and why a ratio needs a defined denominator and unit.

## 3. The mechanism: validate, calculate, return evidence

A useful tool has a narrow purpose, structured arguments, runtime validation, explicit side effects, and a result that preserves enough context to verify it. Its schema helps a model construct arguments; runtime validation decides whether those arguments are acceptable now.

```text
untrusted arguments
  -> structural validation
  -> domain validation: units, periods, required values, permitted source
  -> deterministic operation
  -> structured result + warnings + input identity
```

For arithmetic, define formulas before implementation. For file reading, define allowed sources and size behavior before exposing a path argument. A deterministic tool is reproducible for the same valid inputs and relevant environment; determinism does not make a wrong formula correct.

## 4. Design alternatives

A free-form calculator is useful for elementary expressions but knows nothing about currencies, reporting periods, or budget definitions. A named metric tool can validate a more meaningful contract. A full workbook pipeline additionally needs schema mapping, joins, and reconciliation; a comparison helper cannot replace it.

BetterWork's calculator parses a small grammar rather than evaluating arbitrary JavaScript ([BW07](../references.md#bw07)). That narrows executable behavior. The business comparison helper accepts already prepared numeric maps; unit validation and workbook transformations are not supplied by that map alone.

## 5. Worked example: the formula is part of the contract

Synthetic current amount `25000`, previous `20000`, budget `30000`, all USD minor units:

| Result | Formula | Expected value |
| --- | --- | ---: |
| Period change | current − previous | 5000 |
| Period ratio | change / previous | 0.25 |
| Budget deviation | current − budget | -5000 |
| Budget ratio | deviation / budget | -1/6 |

Keep exact amounts and full calculation precision; round only when displaying percentages under an agreed policy.

BetterWork source ([BW08](../references.md#bw08), MIT):

```ts
if (previous !== undefined) {
  result.previous = previous;
  result.change = current - previous;
  if (previous === 0) warnings.push('comparison-zero-baseline');
  else result.changeRate = (current - previous) / Math.abs(previous);
}
```

This is a valuable real implementation, but note the denominator: **`Math.abs(previous)`**. The course specification uses the **signed previous value**. With previous `-100` and current `-80`, the product helper returns `+0.2`; the course formula returns `-0.2`. Both compute a change of `+20`. They express different ratio conventions.

Do not silently copy the implementation and call it the course formula. The teaching adapter must implement the approved signed convention and warn on negative baselines. Preserve the product behavior as a clearly labeled comparison example; this manuscript does not modify it. Whether the underlying change is favorable requires the metric definition, not the sign alone.

## 6. Guided practice: L06

Read the helper and its independent expected-value test ([BW09](../references.md#bw09)). Then prepare your own contract before code.

1. Declare units, period identity, required current values, and optional comparisons.
2. Specify results for positive, negative, zero, and missing baselines.
3. Reject unit mismatch before calling numeric comparison.
4. Implement the approved signed-denominator teaching rule and its warning behavior.
5. Add a bounded source-reading exercise with selected synthetic material.
6. Compare the teaching results with the reference helper and explain the negative-baseline difference.

Hints: test `undefined` explicitly rather than using truthiness; do not let a missing current metric disappear from the result; separate display rounding from stored values. The current helper validates finite numbers, not safe-integer currency ranges; the workbook adapter must add that constraint.

## 7. Deliberate failure: a plausible default

Replace a missing budget with zero, then suppress the zero-denominator warning. The narrative can now claim “on budget” without any budget evidence. Correct the input/result types so missing comparison values produce unavailable comparisons and a visible explanation.

For file access, test a path escaping the workspace and a symlink pointing outside it. BetterWork's default reader canonicalizes paths before checking containment ([BW10](../references.md#bw10)). Its injected-reader branch delegates policy to the supplied reader. The reference's 20,000-character return limit does not cap bytes read from disk: it reads the file before slicing. A stronger teaching byte limit must be enforced before or during reading, and must be tested as its own behavior.

## 8. Independent variation

Design a tool comparing planned and actual project hours. Reject minutes supplied as hours. Require an explicit unavailable ratio when planned hours are zero. State whether the tool performs side effects and how cancellation is observed.

## 9. Transfer and reference

The same pattern applies to exchange-rate conversion, defect-rate analysis, or file export: define the business rule, bind it to permitted inputs, and test independently. A tool description is a model-facing guide, not the final enforcement point.

## 10. Summary and retrieval practice

Deterministic tools remove arithmetic from model inference, but they still require approved definitions and input validation. Preserve missingness, units, signs, and warnings.

Explain why finite numbers are insufficient for money. What changes under a negative baseline? Where does permission live when a reader is injected? Delayed transfer: identify every additional transformation required when this helper receives workbook data in Chapter 14.

References: [BW07](../references.md#bw07), [BW08](../references.md#bw08), [BW09](../references.md#bw09), [BW10](../references.md#bw10), [BW29](../references.md#bw29).
