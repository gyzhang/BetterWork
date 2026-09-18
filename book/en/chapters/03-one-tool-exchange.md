# 03. Make a Model Request and Complete One Tool Exchange

[Contents](../manuscript.md) · [Previous](02-models-and-prompts.md) · [Next](04-agent-loop.md)

## 1. A recognizable problem

An assistant says it used a calculator. Did a calculator execute, or did the model merely write that sentence? An application needs evidence of a requested action, a host decision, an execution, and a returned result. Text claiming success cannot replace those events.

We begin with `(12 + 8) * 3`. Its independently known result is `60`, so the exchange can be inspected without debating domain knowledge.

## 2. Learning contract

Outcome: **O2**, preparing O3. Prerequisites: Chapter 02, F02, and F03. Evidence: a sequence diagram, a scripted exchange, argument-validation checks, and a separately recorded live exchange when approved access is available.

Prerequisite check: why should an asynchronous network response enter your application as untrusted data? What distinguishes a function's type annotation from runtime validation?

## 3. The mechanism: a request is not an execution

```text
host -> provider: messages + available tool definitions
provider -> host: call c1, calculator, {expression: "(12 + 8) * 3"}
host -> validator: validate c1's input
host -> permitted tool: execute under run context
tool -> host: {expression: "(12 + 8) * 3", result: 60}
host -> provider: observation associated with c1
provider -> host: final answer
```

The model sees the tool's name, description, and input schema. The host owns the executable implementation. A **call ID** associates one requested action with its observation. A **run ID** associates the exchange with a complete execution. They are not interchangeable: a run can contain many calls.

BetterWork source ([BW01](../references.md#bw01), MIT):

```ts
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown>;
}
```

The schema describes the request; `execute` performs the action. The context carries host-owned run and call identities, a workspace path, a cancellation signal, and progress reporting. Those values should not be taken from model-generated arguments.

## 4. Design alternatives

Hard-coding provider-specific JSON throughout the engine makes every provider change an engine change. A small adapter instead translates wire messages into stable chunks such as text deltas and complete tool calls. For a first exercise, one protocol adapter is enough; building a universal provider framework is unnecessary.

You can test a direct tool call before involving a model. That simpler step isolates calculation behavior. Then a scripted provider tests the exchange. Finally, a live provider tests actual protocol behavior and model tool selection. These layers answer different questions.

## 5. Worked example: preserve the observation identity

BetterWork source ([BW02](../references.md#bw02), MIT), inside the successful tool branch:

```ts
messages.push({
  id: randomUUID(),
  role: 'tool',
  toolCallId: toolCall.id,
  toolName: toolCall.name,
  content: JSON.stringify(outcome.output),
});
```

The message is not a new user instruction. It is a tool observation associated with the original call. The provider adapter maps the internal `toolCallId` to its protocol's `tool_call_id`. Do not mix that Chat Completions field with similarly named fields from another API.

In the first engine test ([BW03](../references.md#bw03)), the fake provider requests the calculator, the tool runs, and the response is streamed. The test asserts event order as well as contiguous sequence numbers. Its synthetic explanation event is not private model reasoning and is not required evidence for course assessment.

## 6. Guided practice: L03

The supplied reference exercise is the first engine test plus the calculator implementation. See the [lab companion](../lab-guides/README.md) for its exact command and baseline.

1. Draw the exchange before reading the expected event list.
2. Label the point where the model request becomes host execution.
3. In a disposable learner copy, change the expression and independently calculate the expected result.
4. Send a malformed argument, such as a numeric `expression`, to the tool boundary. It must reject it.
5. Inspect the provider tests for fragmented tool-call arguments; explain why fragments cannot execute immediately.
6. Record the equivalent live exchange separately, without keys or raw private data.

Hints: look for `inputSchema.parse`; keep call identity unchanged when returning the observation; compare event types before comparing incidental generated IDs.

## 7. Deliberate failure: the unfinished stream

A service emits partial tool arguments and closes the connection. Executing those partial arguments could produce a wrong or unintended action. The provider must complete protocol assembly and recognize an accepted completion signal before emitting an executable call.

BetterWork's adapter accumulates fragments by call index and rejects a stream that ends without its accepted completion signal ([BW05](../references.md#bw05)). This is transport-level completion; it is not proof the answer is useful, and accepted finish reasons can still represent output limitations. Tests must cover both assembly and downstream validation.

Reproduce the failure with controlled chunks, not an unreliable internet connection. Remove the completion marker from an otherwise valid fixture, expect an error, and verify that no tool executes from incomplete data. The correction belongs at the provider boundary, not in the final-answer prompt.

## 8. Independent variation

Use two calculator calls in one model response. Give them different IDs and results. Explain how the adapter separates fragments and how the host associates both observations. Then introduce an unknown tool name and require zero executions of that tool.

## 9. Transfer and reference

The same pattern applies to retrieving a document or calling an approved metrics service. The observation may be a table instead of a number, but it still needs identity, validation, permission, and explicit failure semantics. Official function-calling documentation describes the application-side execution cycle ([P03](../references.md#p03)); protocol connectivity never transfers host authority to the model.

## 10. Summary and retrieval practice

The provider proposes a call; the host validates and executes; the observation returns under the same call identity. Streaming makes assembly a first-class responsibility.

Without notes: why is `tool.requested` not enough to claim success? Why are run and call IDs different? What should happen after an incomplete stream? Delayed transfer: use the same sequence diagram for MCP in Chapter 07.

References: [BW01](../references.md#bw01), [BW02](../references.md#bw02), [BW03](../references.md#bw03), [BW05](../references.md#bw05), [BW06](../references.md#bw06), [P03](../references.md#p03).
