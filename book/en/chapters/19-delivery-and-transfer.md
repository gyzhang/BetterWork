# 19. Package an Application and Map It to Another Platform

[Contents](../manuscript.md) · [Previous](18-operations-capstone.md) · [Next](20-independent-assessment.md)

## 1. A recognizable problem

Your agent works on your laptop. A classmate cannot start it because a dependency was installed globally, an input path points into your home directory, and the only setup instructions are “use my configuration.” That is a demonstration, not a handoff.

Delivery means another person can install, configure, run, stop, inspect, and revise the application within its declared environment and authority.

## 2. Learning contract

Outcome: **O8**. Prerequisites: Chapters 17–18. Evidence: reproducible CLI/API package, supplied thin UI adapter, operating guide, fresh-environment replay, platform responsibility map, and a campus or industry adaptation brief.

Prerequisite check: identify the engine, host, provider, tools, and persistence boundary in your application. Which of these changes when a terminal interface becomes an API?

## 3. The mechanism: package a contract, not your machine

Keep a headless core behind a host-owned application interface. The CLI and thin API/UI call the same application operations. They must not independently reimplement permission checks or calculate report metrics.

```text
CLI / supplied thin UI
  -> validated application request
  -> host: identity, scope, configuration, lifecycle, persistence
  -> core loop + provider + bounded tools
  -> durable events and versioned outputs
  -> presentation adapter
```

A release package needs a source revision, dependency lock, supported runtime/OS matrix, setup commands, non-secret configuration template, fixture inputs, start/stop/test commands, data/output locations, and known limitations. The author must test these instructions in a clean environment; a list of plausible commands is not reproducibility evidence.

For the local teaching API, bind to loopback by default and document who can call it. Do not casually expose an unauthenticated local service to a network. Validate request and response boundaries, limit payloads, and route cancellation through the same host operation. A remote deployment adds identity, transport security, resource isolation, and operational ownership that a local lab does not establish.

## 4. Design alternatives

A CLI is the smallest useful delivery surface for technical users. A supplied thin UI makes the workflow accessible without requiring learners to rebuild a desktop framework. A complete Electron application may improve file integration and packaging, but those concerns should not obscure the agent-learning objectives.

BetterWork provides a comparative desktop architecture: renderer → typed preload API → application → core/infrastructure/tools ([BW24](../references.md#bw24)). Its source demonstrates separation; the course's first runnable delivery remains headless with a thin adapter. Product packaging support does not automatically define the teaching OS matrix.

## 5. Worked example: one framework responsibility map

Use **LangGraph's JavaScript documentation** as the single comparison in this draft ([P13](../references.md#p13)). The overview describes graph orchestration, durable execution, streaming, and human-in-the-loop support. Map responsibilities rather than assuming that adopting the framework completes the application.

| Responsibility | Current teaching application | LangGraph comparison | Still owned by the application |
| --- | --- | --- | --- |
| Model/tool cycle | Bounded loop | Graph nodes and transitions can express orchestration | Provider settings, budgets, validated tool inputs |
| Working state | Typed run/context state | Graph state carries execution information | Scope, source revisions, retention policy |
| Persistence | Run journal and task records | Checkpoint/durable execution facilities | Storage configuration, identity, migrations, failure policy |
| Human review | Durable task decision plus a new attempt | Interrupt/resume patterns can represent interaction | Reviewer authority and approved subject identity |
| Streaming | Ordered runtime events | Streaming facilities expose progress | Redaction, durable/UI ordering, user-visible interpretation |
| Tools | Host-selected registry | Tool execution can be placed in graph steps | Permission checks, process/network restrictions |
| Evaluation | Independent fixtures and rubrics | Integrate chosen testing/evaluation tools | Numeric/source oracles and all-attempt reporting |
| Artifacts | Validated versioned files | Generated output can be graph state/result | DOCX/PPTX rendering, editability, lineage, publication |

This is a documented comparison, not an executed port. Before migration, pin the framework version and prove preservation of the boundary/lifecycle tests. Framework thread/checkpoint IDs are not automatically equivalent to the course's Task/Session/Run identities; define an explicit mapping.

A tempting rewrite creates three agents—researcher, writer, reviewer. Ask what failure it solves. More agents add coordination, shared-state, budget, and conflicting-authority concerns. A deterministic fact checker plus a human reviewer may be simpler and more auditable. Multi-agent architecture is an optional comparison, not a graduation requirement.

### Handoff worksheet

| Question | Required answer |
| --- | --- |
| What runs offline? | Named commands and fixtures, with no external requests after setup |
| What uses a service? | Selected provider/integration, approved data, configuration, budgets |
| Where are inputs and outputs? | Declared read-only inputs and writable generated-output scope |
| How is it stopped? | Cancellation command/UI action, cleanup semantics, terminal result |
| How is failure inspected? | Redacted logs, run identity, status and recovery procedure |
| Who maintains it? | Owners for code, dependencies, data definitions, and templates |

## 6. Guided practice: L19

1. Package the two-capstone application with the supplied CLI/API/UI adapters.
2. Remove machine-specific assumptions and document the tested environment.
3. Have another learner execute setup and an offline case using only the guide.
4. Demonstrate live configuration using approved shared access without transferring credentials in the submission.
5. Compare the application's responsibilities with the framework map above; label every gap and owner.
6. Write one adaptation brief that changes domain inputs and policy while preserving the engineering invariants.

Hints: observe the recipient's first failed step; distinguish installation network needs from offline execution; test missing configuration before the successful run. See [L19](../lab-guides/README.md#l19). Exact course release commands remain an author-owned prerequisite, not commands invented in this prose.

## 7. Deliberate failure: missing configuration becomes a fabricated answer

Remove the selected model configuration from a controlled installation. The application must explain the missing configuration, keep secrets out of errors, and avoid claiming task completion. It must not silently substitute a fake provider for a live evaluation or use an unintended service.

Next, remove a document-rendering dependency. The output stage should fail with an actionable preflight or runtime result. An empty file with the expected extension is not a successful fallback. Add both cases to the handoff smoke checks.

## 8. Independent variation

Choose one advisory scenario: campus project progress, banking procedure comparison, energy work-order analysis, or manufacturing quality reporting. Identify changed source definitions, sensitive fields, decision owners, prohibited actions, and deployment obligations. Use synthetic inputs only. A successful local exercise does not certify production security, regulatory compliance, or operational suitability.

## 9. Transfer and reference

Portability is demonstrated by preserving contracts under a changed adapter or platform. The loop may move into a graph and the UI may become a web page, but numeric correctness, source scope, review authority, terminal states, and editable output remain obligations. Keep a platform gap explicit until it has an owner and verified mitigation.

## 10. Summary and retrieval practice

A delivered application is reproducible and operable by someone else. Frameworks can supply mechanisms; the host still owns policy and domain correctness. Transfer changes context and adapters without discarding evidence and boundaries.

Which responsibilities do checkpoints not solve? Why does a loopback API need a declared caller model? What would make a migration equivalence claim credible? Delayed transfer: defend the package under an unseen input in Chapter 20.

References: [BW01](../references.md#bw01), [BW18](../references.md#bw18), [BW24](../references.md#bw24), [BW26](../references.md#bw26), [BW28](../references.md#bw28), [P13](../references.md#p13).
