# 13. Observability, Evaluation, and Operating Budgets

[Contents](../manuscript.md) · [Previous](12-lifecycle-and-persistence.md) · [Next](14-excel-analysis.md)

## 1. A recognizable problem

A demonstration works twice. The team concludes that the agent is reliable. A week later it encounters a missing budget, repeats the same lookup indefinitely, and writes a confident unsupported explanation. None of those cases appeared in the demonstration.

Evaluation begins by deciding what evidence would disprove your confidence. Observability makes that evidence available without exposing secrets or private model reasoning.

## 2. Learning contract

Outcome: **O5**, checkpoint **G3**. Prerequisite: Chapter 12. Evidence: a redacted trace, fixed evaluation set, configuration comparison, classified regression, and a demonstrated budget stop.

Prerequisite check: what does an offline scripted provider establish? What remains unknown even when every lifecycle test passes?

## 3. The mechanism: separate the layers of evidence

A structured trace records events such as request started, tool requested, tool rejected/completed, checkpoint created, output registered, and run terminated. Include task/run/call identities, sequence, duration, error category, input revision references, and available usage. Prefer references and bounded summaries over full document dumps.

```text
fixed cases + frozen rubric + source/configuration versions
  -> deterministic checks
  -> actual integration checks
  -> live-model attempts
  -> source/numeric/document review
  -> classify failures
  -> revise one factor and retest without deleting prior results
```

| Layer | Correct oracle | Typical failure |
| --- | --- | --- |
| Arithmetic | Independently derived values | Wrong denominator or duplicate sum |
| Runtime | State and event invariants | Two terminal outcomes or escaped scope |
| Retrieval | Question-specific relevance labels | Necessary evidence absent from top-k |
| Model task | Frozen task rubric plus source checks | Unsupported claim despite available evidence |
| Office output | Structure, editability, visual review | Correct content clipped or flattened |
| Delivery | Another person's replay | Undocumented dependency or missing configuration |

Do not average these into a single score that hides a critical boundary failure. A beautifully written report cannot compensate for an unauthorized read.

## 4. Design alternatives

A screenshot demonstration is useful communication but weak regression evidence. Exact-string assertions are appropriate for deterministic tool outputs but often too brittle for legitimate model paraphrases. A model grader can assist with consistent questions, but it can share the generator's mistakes. Material claims still need source checks; numbers still need an independent oracle.

Start with small, interpretable cases and explicit criteria. Large benchmark totals without visible failure categories can hide the very behavior you need to repair.

## 5. Worked example: compare configurations without inventing certainty

Imagine two retrieval configurations evaluated on four synthetic cases. The following is a worked scoring example, not a measured BetterWork result:

| Case | Required behavior | A | B |
| --- | --- | --- | --- |
| Normal proposal | Cite supported constraints | Pass | Pass |
| Missing source | Ask or label unknown | Fail: invented fact | Pass |
| Unselected document | Deny read | Pass | Pass |
| Reviewer revision | New version, unchanged verified figures | Fail: altered figure | Fail: altered figure |

A completes 2/4 cases under the rubric; B completes 3/4. B improved this tiny set, but both still fail revision. Report that defect explicitly. Four cases do not establish a production reliability rate, and one successful output is not evidence about unseen conditions.

For the final course evaluation, use at least ten controlled cases per capstone: three normal, three missing/ambiguous, two authorization/injection, and two lifecycle/rework cases. For each capstone's live-model checks, select one normal, one insufficient-information, and one revision case, running each twice. That is twelve live attempts across both cases. Preserve all attempts, including failures and retests; additional numeric/document tests are still required.

### Bound the experiment

Choose budgets before execution: maximum model rounds, tool calls, elapsed time, returned content, and output tokens; add a spend ceiling when service pricing and usage support it. These are independent limits. A short response can take too long, and a tool can produce huge output in one call.

Illustrative teaching policy: at most 6 model calls, 8 tool calls, and 120 seconds per case. Before another call, check remaining time and capacity. A single request also needs its own timeout. If usage data is unavailable, record `unknown`; do not calculate zero cost from missing fields. Estimated cost must be labeled and tied to a recorded price schedule. Hard spend guarantees may require provider-side enforcement, not merely post-response counting.

## 6. Guided practice: L13

1. Freeze a small case set and write pass/fail criteria before running it.
2. Capture a redacted event trace with identities and terminal status.
3. Compare two instruction or retrieval configurations while holding other variables fixed.
4. Inject one deterministic regression and one unsupported model claim; classify them separately.
5. Force repeated tool requests and demonstrate that the run stops under its budget.
6. Record all attempts, latency, and available token/cost data, including unknown fields.

Hint 1: classify by the earliest violated contract, not the most visible symptom. Hint 2: compare actual tool inputs to expected inputs before blaming arithmetic. Hint 3: retain failed attempts so improvements remain auditable. See [L13](../lab-guides/README.md#l13).

## 7. Deliberate failure: redaction only on the happy path

Use a synthetic credential marker in a controlled provider error response. The normal trace redacts it, but an exception message includes it. Search all learner-visible error/log outputs in the test and fail if the marker appears. Correct error mapping at the boundary rather than teaching people to manually erase secrets afterward.

A second failure is selection bias: run a case five times and publish only its best answer. Restore the full attempt record. “Passed once” and “passed all five attempts” are different observations.

## 8. Independent variation

A new configuration reduces tool calls but omits a qualifying source. Design an evaluation that can distinguish lower operating cost from lower task quality. Decide which result is unacceptable even if average latency improves.

## 9. Transfer and reference

BetterWork's provider tests exercise controlled transport, stream assembly, cancellation, and error redaction ([BW06](../references.md#bw06)); its core tests exercise loop behavior ([BW03](../references.md#bw03)). These are valuable but not evidence of live-model usefulness or Office layout quality. The root verification command also cannot establish those human/task outcomes merely by compiling and testing software.

## 10. Summary and retrieval practice

Observe decisions, actions, state, and outputs. Evaluate each against an appropriate oracle. Freeze settings, disclose every attempt, and distinguish unknown usage from zero. Budgets are runtime policies, not a request that the model “be efficient.”

Why is a scripted provider not a prose-quality evaluation? What would invalidate the A/B comparison? Which tests expose a fluent unsupported claim? For G3, demonstrate boundary, persistence, redaction, regression, and bounded-stop evidence together.

References: [BW03](../references.md#bw03), [BW06](../references.md#bw06), [BW26](../references.md#bw26), [BW28](../references.md#bw28), [P06](../references.md#p06).
