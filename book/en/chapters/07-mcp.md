# 07. Integrate Tools Through MCP

[Contents](../manuscript.md) · [Previous](06-deterministic-tools.md) · [Next](08-retrieval.md)

## 1. A recognizable problem

Your calculator lives inside the application. A department's reporting service lives in another process, and several applications need to use it. Reimplementing the same custom connection in each application creates unnecessary coupling. A shared protocol can describe the available tools and carry calls and results across that boundary.

It cannot decide whether this particular task is allowed to use every advertised tool. Connectivity and authority answer different questions.

## 2. Learning contract

Outcome: **O3**. Prerequisite: Chapter 06. Evidence: a host/client/server diagram, an actual local protocol exchange, selected-tool and argument checks, structured observations, and clean shutdown.

Prerequisite check: what is the difference between a tool description, a validated call, and an executed operation? Identify where each occurred in Chapter 03.

## 3. The mechanism: a protocol adapter, not another agent

The **host** is the application coordinating the task and its policies. A **client** maintains a connection to a **server**. The server exposes capabilities such as tools and resources. Our exercise uses a tool; a list of resources is not interchangeable with a list of executable operations. MCP provides the message and lifecycle conventions connecting these roles ([P04](../references.md#p04)).

```text
host starts an approved local server process
  -> client/server initialization and capability negotiation
  -> client requests the tool list
  -> host validates descriptions and selects permitted tools
  -> model requests one exposed tool
  -> host validates arguments and current authority
  -> client sends a tool call
  -> server returns a result or tool-level error
  -> adapter returns an observation to the existing Agent Loop
  -> host closes the connection when finished
```

The model does not need to know that the implementation is out of process. It sees the same narrow executable contract used for a local tool. The adapter translates identity, arguments, observations, progress, and errors. A remote tool name must remain associated with its connection; two servers may publish the same name.

With **stdio**, protocol messages travel through a launched process's standard input and output. Human diagnostic messages belong on a separate channel so they do not corrupt the protocol. Network transports introduce additional deployment, authentication, and network-policy questions. This chapter does not need a network deployment to demonstrate an actual connection.

## 4. Design alternatives

A direct function call is simpler and appropriate when the capability belongs to the same process. A custom HTTP API can be appropriate when an established service contract already exists. MCP is useful when a common discovery and invocation boundary improves interoperability. Adding it to every helper merely adds lifecycle and serialization work.

Use one read-only synthetic server first. Do not begin with a server that can execute arbitrary commands or connect to customer records. A local process still runs with operating-system privileges; describing its tools as read-only does not sandbox its executable.

## 5. Worked example: selected metrics access

BetterWork provides a minimal local finance fixture, not a production ledger service ([BW13](../references.md#bw13)). Its tests launch a real child process and exercise the client ([BW12](../references.md#bw12)). Follow that path before considering a remote service.

BetterWork source ([BW11](../references.md#bw11), MIT), inside a selected tool adapter:

```ts
execute: async (input, context) => {
  validateToolInput(tool, input);
  return await this.callTool(tool, input, context);
},
```

The order matters. The discovered schema is not only sent to the model; the host validates incoming arguments before invocation. The surrounding service builds adapters from explicit connection/tool bindings. It passes the run's cancellation signal into the SDK and enforces an output-character limit for text and structured results.

Trace these four synthetic requests:

| Request | Expected host behavior |
| --- | --- |
| Selected metrics tool, valid period argument | Invoke server, retain call identity, return observation |
| Selected tool, malformed period | Reject before the server operation |
| Discovered but unselected tool | No executable adapter for this run; reject the request |
| Selected tool, server reports a tool error | Preserve failure; do not reinterpret it as empty metrics |

A transport-level success can carry a tool-level failure. A successful tool response can still contain bad business data. Keep protocol validation separate from the metric validation taught in Chapter 06.

## 6. Guided practice: L07

Use the [lab companion](../lab-guides/README.md#l07) for the existing reference-test command and teaching-asset boundary.

1. Draw the three roles and label which component launches the process.
2. Inspect discovery, selected binding resolution, argument validation, and result mapping in the reference.
3. Run the local integration test in the prepared reference environment. Record the process-backed test separately from mock-only tests.
4. In the supplied teaching starter, expose one synthetic metric operation and connect it to the same loop used in L04.
5. Compare a direct call and an MCP call using identical inputs and independently expected values.
6. Test malformed arguments, an unselected operation, unavailable process, cancellation, and shutdown.

Hint 1: start by asserting which tool names reach the loop. Hint 2: count server invocations to prove a rejected call did not execute. Hint 3: distinguish an error returned by the tool from a connection that never initialized.

## 7. Deliberate failure: discovery becomes permission

Change the teaching host to register every discovered operation. Add a second fixture operation that returns a harmless synthetic record outside the exercise's selected scope. The model can now request it even though the user never selected it.

Restore binding-based exposure and enforce access at execution. Add a regression test that submits the forbidden name directly, bypassing any user interface. Also consider stale discovery: a server can change its schema or behavior after selection. Version/schema checks and renewed approval may be needed; discovery metadata alone is not proof that a server remains trustworthy.

## 8. Independent variation

Replace the finance fixture with a campus room-availability service. Return synthetic availability only; booking is excluded. Demonstrate that a request to book a room fails even when the server advertises a booking tool. Explain how cancellation reaches the adapter and what happens if the server ignores it.

## 9. Transfer and reference

The reference uses stdio and a fixture advertising protocol version `2025-06-18`. The architecture reference in the bibliography is a different specification revision. Do not claim full version conformance from these examples; a teaching release must record the negotiated version and tested SDK/transport combination. The source lock records the product dependency, not a universal compatibility promise.

## 10. Summary and retrieval practice

MCP standardizes a connection boundary. The host still owns selection, validation, material scope, budgets, and lifecycle. A tool result enters the same observation path as a local result.

Explain why a successful connection is insufficient authorization. Which tests require an actual child process? What must happen to an unselected request sent directly to the adapter? Delayed transfer: use this role diagram to identify the network and identity responsibilities added by a remote deployment in Chapter 19.

References: [BW11](../references.md#bw11), [BW12](../references.md#bw12), [BW13](../references.md#bw13), [BW27](../references.md#bw27), [P04](../references.md#p04).
