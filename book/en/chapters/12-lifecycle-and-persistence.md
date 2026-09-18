# 12. Lifecycle, Persistent State, and Human Checkpoints

[Contents](../manuscript.md) · [Previous](11-harness-boundaries.md) · [Next](13-evaluation-and-budgets.md)

## 1. A recognizable problem

The assistant has written half a report when the application closes. On restart, the interface still says “running.” Another attempt creates two copies of the same output. Meanwhile, the reviewer approved an outline, but that decision disappeared with the window.

The application has confused transient execution with durable collaboration. A process, a task, and a review decision have different lifetimes.

## 2. Learning contract

Outcome: **O5**. Prerequisite: Chapter 11. Evidence: a state-transition diagram, persistent journal, restart and cancellation tests, idempotent output behavior, and task-owned review checkpoints.

Prerequisite check: why must permission be checked immediately before a side effect? What is the difference between a partially streamed answer and a completed result?

## 3. The mechanism: identity and transitions before storage

A **Workspace** is a long-lived work context. A **Task** identifies the work to accomplish. A **Session** maintains an ongoing collaboration context. A **Run** is one execution attempt. A **ToolCall** identifies one requested operation. These entities need explicit relationships, not strings assembled to imitate ownership.

For the small teaching runtime, start with this state machine:

```text
running -> completed
running -> failed
running -> cancelled
```

A terminal run never becomes running again. A retry creates a new run linked to the same task and selected inputs. Timeout is recorded with a cause under the chosen terminal policy; a user cancellation remains distinguishable from an unavailable provider. More states are possible, but each adds transition and recovery obligations.

### A just-in-time SQLite primer

A table contains rows; a primary key identifies a row; a foreign key constrains a relationship. A transaction groups database changes so they commit together or roll back together. A journal can record ordered events while a run row stores the current status. A uniqueness constraint can prevent duplicate event identities or registration keys.

The host validates an event, persists it, and only then notifies the UI. Otherwise the UI can display something that vanishes after restart. If database persistence fails, report the storage failure; do not claim a durable terminal record that was never committed. Database transactions do not make a network call or filesystem write atomic with a row update ([P08](../references.md#p08)).

On startup, a single-host teaching runtime finds runs left active by its previous process and records interruption as failure. It does not pretend that the old model connection resumed. A multi-worker deployment needs ownership/lease rules before deciding that another worker's run is abandoned.

## 4. Design alternatives

In-memory state is sufficient for an isolated unit test but cannot preserve collaboration across process death. Saving a final transcript loses partial progress and failure evidence. A durable journal adds storage complexity but explains what happened and supports rebuilding views.

An **idempotent** operation produces the same intended effect when retried with the same identity. This is stronger than “the caller retries only once.” Use a stable key tied to the logical operation and input identity. Never reuse a key for changed content. If an external effect's outcome is unknown, inspect or reconcile it before retrying; do not promise exactly-once behavior from a local database constraint.

## 5. Worked example: review survives; execution does not

Task T1 has run R1, reviewed outline version V1, and checkpoint C1. The process closes. On restart, R1 is marked interrupted/failed if it was still active; C1 remains a durable decision. The reviewer requests a shorter report. The host creates R2 with selected inputs and C1's decision context, then produces V2. It does not mutate R1 back into running or overwrite V1.

BetterWork source ([BW19](../references.md#bw19), MIT):

```ts
if (input.taskId !== taskId)
  throw new Error('Discussion checkpoint task does not match request');
if (input.runId && !this.store.runs.belongsToTask(input.runId, taskId)) {
  throw new Error('Discussion checkpoint Run does not belong to Task');
}
```

The service also checks ownership of superseded checkpoints and referenced artifact versions. A valid-looking ID is not enough; it must belong to the task whose decision is being recorded.

Cancellation needs a publication policy. In the teaching runtime, request abort, stop participating operations, finish cleanup, and prevent unfinished output from being promoted as a completed deliverable. Define the commit boundary: if completion was durably committed before cancellation arrived, report completion and “too late to cancel”; if cancellation won before promotion, keep the output staged and report cancellation. Test the race rather than assigning both outcomes.

BetterWork's run service persists events before dispatch, holds terminal handling while cleanup runs, and has host-level failure closure ([BW18](../references.md#bw18)). Its file registration also rechecks active run/authorization state and uses an execution/output registration key ([BW20](../references.md#bw20)). These are concrete reference mechanisms, not a blanket exactly-once guarantee for every external effect.

## 6. Guided practice: L12

1. Define allowed transitions and assert that a terminal state cannot be replaced.
2. Persist a synthetic run and ordered events in a disposable SQLite database.
3. Interrupt the teaching host before completion, restart it, and inspect the durable result.
4. Create a checkpoint, restart again, and begin a new run from selected inputs.
5. Submit the same output-registration request twice; assert one logical registration.
6. Test cross-task IDs, cancellation before promotion, cancellation after completion, and cleanup failure.

Hint 1: store IDs and relationships explicitly. Hint 2: inject interruption points instead of relying solely on timing. Hint 3: count published versions and compare content hashes, not just filenames. See [L12](../lab-guides/README.md#l12).

## 7. Deliberate failure: the engine catches everything—except the host

Make provider configuration loading fail before the engine starts. If terminal handling exists only inside the loop, the run remains running forever. Add an orchestration-level failure path that conditionally closes an active run without overwriting an existing terminal result.

Now fail the UI notification after persistence. The journal must remain authoritative. Reopening the task should reconstruct its state from durable records, not from whether the notification was seen. These two tests locate failures on opposite sides of the engine boundary.

## 8. Independent variation

Design safe retry for a synthetic report export whose file was written but whose registration acknowledgment was lost. Explain how you distinguish “not executed,” “executed and registered,” and “outcome uncertain.” No exercise needs a real payment or message-sending service to expose this problem.

## 9. Transfer and reference

A human checkpoint is a durable record of a decision and its subject. It is not automatically a suspended interpreter frame. Supporting continuation means preserving the right collaboration state and selecting valid inputs for another execution. If a framework offers durable execution, inspect which operations it replays and how side effects are deduplicated.

## 10. Summary and retrieval practice

Identity makes ownership testable. State machines make termination explicit. Persistence precedes presentation. Checkpoints preserve decisions; retries create new attempts and must account for effects already performed.

Why can a database transaction not undo a sent network request? What should happen when configuration fails before the loop? Which version does a reviewer approve? Delayed transfer: test the second-period report's cancellation and rework path in Chapter 18.

References: [BW18](../references.md#bw18), [BW19](../references.md#bw19), [BW20](../references.md#bw20), [BW26](../references.md#bw26), [P08](../references.md#p08), [P09](../references.md#p09).
