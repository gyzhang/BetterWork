# 04. Implement the Agent Loop

[Contents](../manuscript.md) · [Previous](03-one-tool-exchange.md) · [Next](05-react-and-workflows.md)

## 1. A recognizable problem

One calculator exchange is easy. Research is less predictable: a first source can reveal a missing definition, a second can contradict it, and a tool can fail. The application needs a repeatable cycle that allows another decision without allowing endless execution.

The important question is not “how do we keep the model talking?” It is “when may another action occur, and what makes the run stop?”

## 2. Learning contract

Outcome: **O2**. Prerequisite: Chapter 03. Evidence: a learner-owned headless loop, an event trace, and tests for success, unknown tools, failing tools, cancellation, and round exhaustion. The isolated starter is an author-owned release asset; the actual BetterWork loop and its tests are available as the reference reading now.

Prerequisite check: identify the call, observation, and final response in Chapter 03. Which state must survive between model requests?

## 3. The mechanism: a bounded decision cycle

Teaching pseudocode:

```text
start run
initialize messages and permitted tools
for each allowed tool round, plus one final model decision:
  check cancellation
  request the next model response
  collect complete tool calls and answer text
  if no tool calls:
    complete the run and stop
  if tool-round budget is exhausted:
    fail the run and stop
  for each requested call:
    resolve only within the permitted registry
    validate and execute
    append result or recoverable error observation
on cancellation: emit cancelled
on other unrecoverable error: emit failed
```

The messages carry observations forward. The tool registry carries executable authority. The iteration counter limits repeated decisions. None of those responsibilities can be replaced with “please stop when finished.”

The reference runs calls within a model round sequentially. Parallelizing them is not an automatic optimization: calls may depend on each other, consume shared budgets, or perform conflicting effects. Begin with a sequence you can explain.

## 4. Design alternatives

A fixed number of unconditional tool calls is simpler but cannot adapt to missing information. An unlimited loop adapts but has no guaranteed stop under a repeating provider. A bounded loop permits adaptation while preserving an explicit failure outcome.

A failed tool need not always fail the run. A recoverable error can become an observation, allowing the model to explain the limitation or select another permitted source. An unknown tool, however, should not be dynamically created from its name. BetterWork treats it as a run failure.

## 5. Worked example: count rounds correctly

BetterWork source ([BW02](../references.md#bw02), MIT):

```ts
const tools = new Map(input.tools.map((tool) => [tool.name, tool]));
const maxToolRounds = input.maxToolRounds ?? 20;
```

Later in the same method:

```ts
if (pendingToolCalls.length === 0) {
  yield events.create({ type: 'run.completed', finalContent: content });
  return;
}

if (round === maxToolRounds) throw new Error(`Tool round limit exceeded: ${maxToolRounds}`);
```

With `maxToolRounds: 1`, round 0 can execute a tool. Round 1 can receive a final answer but cannot execute another requested tool round. The limit is on **tool rounds**, not the total number of model calls or individual tool calls. Several calls can be requested in one round; an application needing a total-call budget must add that policy separately.

A synthetic trace is: start → request c1 → execute c1 → observation 60 → final answer → completed. A repeating provider instead requests c2 on the next decision and causes failure before c2 executes. The repository test explicitly exercises this case ([BW03](../references.md#bw03)).

## 6. Guided practice: L04

Use the core interfaces and scripted test provider as the reading starter. In the isolated teaching implementation, the author supplies transport and fixtures; you own the loop and its state changes.

1. Implement the no-tool final-answer path.
2. Add one permitted calculator call and append its observation.
3. Add unknown-tool rejection before execution.
4. Turn a tool exception into a structured error observation, with a separate unrecoverable path.
5. Add cancellation and the tool-round counter.
6. Assert one terminal event and contiguous sequence numbers for each ordinary test run.

Hints: keep terminal emission in a small number of explicit branches; do not swallow provider exceptions; test a repeating provider instead of waiting for a real model to loop. The [lab companion](../lab-guides/README.md) identifies the reference command, not a fictitious completed course starter.

## 7. Deliberate failure: a success that never stops

Create a tool that always returns `{ok: true}` and a scripted provider that always asks for it. Every local action succeeds, but the task never completes. This distinguishes tool success from task progress.

Correct the loop with the hard round limit and retain a regression assertion that the run fails at the limit. A later improvement can detect repeated equivalent calls, but repetition detection supplements the hard limit. It must not remove it.

Also cancel during a long-running tool. The engine's cancelled result does not prove an uncooperative tool has physically stopped. The host must manage outstanding work, which Chapter 12 addresses.

## 8. Independent variation

Add a read-only material tool and a script that first requests a missing document, then a selected document, then finishes. Explain which failures are recoverable and prove that no unselected tool executes. Change the round limit to zero and predict whether a direct answer is still allowed.

## 9. Transfer and reference

The engine's `AsyncIterable` exposes ordered events without requiring a UI ([BW01](../references.md#bw01)). A CLI, test, or desktop host can consume that stream. In the desktop application, the host can override the default round limit for bound Skills ([BW18](../references.md#bw18)); neither value is a universal safety budget.

The core terminal event concerns the execution cycle. Business acceptance—whether the answer is supported or the artifact useful—requires additional checks.

## 10. Summary and retrieval practice

A loop coordinates decisions, authority, observations, and stopping. Preserve all four. A recoverable tool error can be part of a successful run; a completed run can still fail content review.

Explain the off-by-one boundary with a one-round budget. Why is a round limit not a cost limit? Why is a tool's successful return not proof of task success? Delayed transfer: revisit these questions after adding subprocess cleanup in Chapter 12.

References: [BW01](../references.md#bw01), [BW02](../references.md#bw02), [BW03](../references.md#bw03), [BW18](../references.md#bw18).
