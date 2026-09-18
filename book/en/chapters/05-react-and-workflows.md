# 05. ReAct and Workflow Design

[Contents](../manuscript.md) · [Previous](04-agent-loop.md) · [Next](06-deterministic-tools.md)

## 1. A recognizable problem

A club's planning note says proposals need a two-week review. A newer committee note says four weeks. A fixed report script can copy both statements, but deciding what to do with the disagreement requires a policy: inspect version and authority, ask the owner, or present the conflict explicitly.

An agent can choose the next permitted information-gathering action. It should not silently decide which committee policy is authoritative merely because one statement appears first.

## 2. Learning contract

Outcomes: **O1–O2**. Prerequisite: Chapter 04. Evidence: a fixed/adaptive comparison, a control-flow diagram, a bounded plan, escalation rules, and an independent explanation of the loop. This chapter closes **G1**.

Prerequisite check: trace a recoverable tool error through the loop. Does the error automatically justify a new tool or broader access?

## 3. The mechanism: action changes the next decision

The ReAct paper studies interleaved reasoning and action, where interaction with an environment supplies observations used in subsequent decisions ([P01](../references.md#p01)). This course implements an observable tool-calling cycle inspired by that pattern. It does not reproduce the paper's benchmark setup or require access to a model's private reasoning.

A useful execution record shows the requested action, its permitted execution, the observation, and the resulting public decision. A short rationale such as “the two selected sources disagree; request owner review” can explain behavior without exposing hidden reasoning.

```text
fixed stage: define question and source boundary
  adaptive stage: retrieve -> inspect -> select permitted follow-up
fixed checkpoint: reviewer resolves direction or uncertainty
  adaptive stage: synthesize alternatives from supported information
fixed stage: validate and publish a new artifact version
```

A **plan** describes intended work. Execution supplies facts about what actually happened. Plans can change when observations expose a gap, but a changed plan must remain inside the authorized task.

## 4. Design alternatives

Use a fixed workflow when every case needs the same inspection and calculation. Use bounded adaptation when the next useful read depends on an observation. A hybrid often works well: fixed acceptance and review stages surround adaptive research.

Avoid treating multi-agent coordination as the default answer. Two role names do not establish two necessary processes. First identify a responsibility that actually benefits from separate state, permissions, or independent review. In this course, one engine with different presets is sufficient for the core cases.

## 5. Worked example: compare two approaches

Synthetic sources:

| ID | Content | Authority metadata |
| --- | --- | --- |
| S1 | Proposals need two weeks of review | Earlier draft, unapproved |
| S2 | Proposals need four weeks of review | Approved committee note |
| S3 | Venue availability is limited | Facilities note, no review policy |

**Fixed baseline:** read S1, S2, S3, then produce a comparison table. **Adaptive candidate:** retrieve review-policy passages; inspect conflicting passages and their metadata; request a decision if authority remains unresolved.

For this particular input, metadata makes S2 the applicable rule. The result should still record that S1 is superseded rather than present a false consensus. Now remove S2's approval metadata. The correct outcome changes: the system cannot establish authority and should escalate.

Do not invent measured speedups. Count reads, elapsed time, unsupported claims, and review effort during the exercise. The fixed baseline may be better for three short documents. Adaptation becomes useful only if its observed benefits justify its additional complexity.

BetterWork reference: the engine appends tool observations before the next provider request and allows a tool failure to become an error observation ([BW02](../references.md#bw02), [BW03](../references.md#bw03)). Its class name does not itself prove successful research behavior.

## 6. Guided practice: L05

Use the three-source table as the worked input. Keep the source boundary fixed for both approaches.

1. Draw the fixed baseline and adaptive candidate.
2. Specify a maximum of three information-gathering rounds for this exercise.
3. Define escalation when authority metadata is absent or sources remain contradictory.
4. Trace both approaches on the complete input and the missing-metadata variant.
5. Record which decisions are model-selected and which are host-enforced.
6. Revise your Chapter 01 brief using the comparison.

Hints: a “search again” step needs a different information goal; a repeated observation is not new evidence; reviewer authority cannot be inferred from source wording alone.

## 7. Deliberate failure: repeated research without information gain

The provider repeatedly searches “review period” and receives the same passages. Each search returns valid data, but no uncertainty is reduced. Reproduce this with a repeating scripted response.

The hard loop bound guarantees eventual stop. A more informative control records the unresolved question and detects equivalent repeated queries/results. Correct the workflow by escalating with the known conflict rather than searching indefinitely. The regression check requires an explicit unresolved outcome and no tool calls after the budget.

An empty answer is not necessarily an error; “the selected sources cannot establish the current policy” can be a successful advisory result if that is the honest task outcome.

## 8. Independent variation

Replace review policy with conflicting supplier lead-time estimates. One estimate is a quote; another is an old planning assumption. Design an evidence-sensitive follow-up without authorizing purchases. Explain why choosing the shortest estimate would be an unsupported optimization.

## 9. Transfer and G1 defense

In a short teach-back, explain a model, an agent, ReAct, the Agent Loop, and a fixed workflow. Then change one stopping condition and predict the affected tests. You pass G1 through implementation and explanation, not by reciting vocabulary.

The research stages in BetterWork's workflow design provide a comparison point ([BW25](../references.md#bw25)). Their presence in a design document does not establish executable checkpoint semantics; Chapter 12 inspects that boundary separately.

## 10. Summary and retrieval practice

ReAct describes an interaction pattern. The loop executes it. A workflow determines where adaptation is allowed and where review is required. Authority remains with the host and designated people.

Why can the fixed baseline win? What makes a second search useful? How can you assess ReAct-style behavior without private reasoning? Delayed transfer: in the research capstone, explain every adaptive step in terms of an unresolved question and a permitted observation.

References: [P01](../references.md#p01), [BW02](../references.md#bw02), [BW03](../references.md#bw03), [BW25](../references.md#bw25).
