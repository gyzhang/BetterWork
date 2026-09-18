# 10. Package Skills and Configure Experts

[Contents](../manuscript.md) · [Previous](09-context-and-memory.md) · [Next](11-harness-boundaries.md)

## 1. A recognizable problem

Every report begins with the same corrections: confirm the reporting period, check units, calculate outside the model, and label uncertain explanations. Copying those reminders into every task is tedious and inconsistent. Meanwhile, the research team needs a different working method but the same reliable engine.

Reuse the method and configure the role. Do not duplicate the runtime merely to change instructions.

## 2. Learning contract

Outcomes: **O3–O4**, checkpoint **G2**. Prerequisite: Chapter 09. Evidence: two presets on one engine, reusable methods, resolved configuration snapshots, unavailable-capability tests, and an independently modified grounded assistant.

Prerequisite check: distinguish a tool's executable behavior from a memory preference and a source document. Which of these can authorize a filesystem write?

## 3. The mechanism: composition with explicit resolution

A **Tool** executes a bounded operation. A **Skill** packages a reusable working method: instructions, examples, and sometimes scripts or resources. An **Expert** is a configured role and set of methods/capabilities. These are the course's working definitions, not a claim that every ecosystem uses the terms identically.

```text
expert revision + selected methods + explicit task choices
  -> resolve versions and effective configuration
  -> validate enabled/trusted/dependency state
  -> intersect requested capabilities with host policy and task scope
  -> assemble instructions, tool registry, and material manifest
  -> run the same engine
```

Three kinds of configuration must remain separate. Instructions tell the model how to work. Data supplies facts for this task. Capability bindings determine which operations the host can execute. A method saying “read the selected workbook” does not itself select or authorize a workbook.

Resolution should be deterministic and inspectable. The teaching policy gives an explicit task choice precedence over a preset default for configurable behavior, while no lower-level setting can override host restrictions. Conflicting mandatory requirements cause a visible configuration error. Record the resolved result rather than trying to reconstruct it later from mutable defaults.

## 4. Design alternatives

A one-off task can use a direct prompt. A repeated fixed calculation may need only a function and a template. A Skill is useful when a method recurs across tasks and needs versioning or associated resources. An Expert preset is useful when users repeatedly choose a coherent role and method combination.

Separate engines for “research” and “analysis” duplicate cancellation, validation, and persistence behavior. One engine with separate configurations avoids that drift. Multiple independent agents become relevant only when separate responsibility and coordination provide demonstrated value; a different role label alone is insufficient.

## 5. Worked example: two presets, one runtime

BetterWork's bundled business-analysis Skill ([BW17](../references.md#bw17), MIT) instructs the agent to confirm periods, budget definitions, and units; extract numbers only from selected and actually read run materials; call deterministic comparisons; and expose missing/zero/inconsistent inputs. This is an English paraphrase of the source's Chinese instructions, not a verbatim code listing.

The method is useful even without a script. The executable arithmetic lives in a tool, not in the Skill's prose. Its period-ratio convention must still be checked against the Chapter 06 course definition.

Teaching configuration example—not a BetterWork import schema:

| Setting | Research preset | Analysis preset |
| --- | --- | --- |
| Role | Compare feasible options from evidence | Explain measured operational changes |
| Reusable method | Claim/source register; compare alternatives | Validate grain/units; reconcile; calculate |
| Requested capabilities | Selected-material search/read; approved external lookup | Selected workbook read; deterministic metrics |
| Human checkpoint | Research plan and proposal outline | Definitions and report outline |
| Task-specific material | Current brief and selected sources | Current ledger, projects, budget |
| Forbidden default | All files in the library | Previous period treated as current |

Suppose the analysis preset requests workbook reading, but the selected method is disabled. The correct resolution is an explicit preflight failure or an explicitly agreed reduced task—not silently running a prose-only imitation of analysis. Similarly, a script with unavailable dependencies cannot become ready because its instructions are readable.

Trust, enablement, and dependency readiness are independent. Trusted code may be disabled. Enabled code may lack a dependency. Installed code may not be trusted. Updating code or expanding requested access requires a defined authorization decision; a trusted old version is not unconditional approval for arbitrary future behavior.

## 6. Guided practice: L10

1. Extract the reusable steps from your L08 research task and L06 comparison task.
2. Remove task-specific names, figures, and source paths from the methods.
3. Define two presets referring to those methods and the same engine.
4. Resolve a task with an explicit override and record the resulting versions, tools, and material scope.
5. Test disabled, untrusted, missing-dependency, and incompatible-configuration cases.
6. Give another learner an unseen source pack. Ask them to adapt the preset without changing the loop.

Hint 1: if a method contains this month's total, it probably contains data that belongs elsewhere. Hint 2: assert the final tool registry, not just a configuration file. Hint 3: the host must reject unavailable capabilities even if a prompt requests them. See [L10](../lab-guides/README.md#l10).

## 7. Deliberate failure: a method update expands authority

Version 1 reads selected text. A synthetic version 2 requests a new output-writing capability. Make the teaching resolver inherit the earlier grant without comparison, then submit a harmless write request to a disposable output location. The test should expose that authorization was broadened without a new decision.

Correct the resolver so grants are tied to the relevant version/scope contract, with explicit handling for changes and revocation. Do not describe this as an operating-system sandbox: it constrains host-mediated execution, while arbitrary trusted native code can have broader process privileges unless isolated separately.

## 8. Independent variation

Create an expert for reviewing campus project proposals. Reuse the research method, add an explicit feasibility checklist, and exclude external lookup. Show that instructions mentioning a website do not make a web tool appear in the resolved registry.

## 9. Transfer and reference

BetterWork's orchestration service resolves instructions and capabilities before execution ([BW18](../references.md#bw18)). Study that seam, not the entire desktop application. The transferable design is a reproducible configuration boundary around one engine. A method may be portable while its scripts, dependencies, and permission assumptions are not.

## 10. Summary and retrieval practice

Tools execute, Skills package methods, and Experts configure roles. Reuse is safe only when versions, dependencies, trust, and effective scope remain explicit. Configuration composition does not bypass host policy.

Why is a method not a data source? When should an explicit task override a preset, and when must it not? How would you detect a silently expanded grant? For G2, demonstrate the actual MCP exchange, measured retrieval, memory exclusions, and two resolved presets; configuration files alone do not establish mastery.

References: [BW17](../references.md#bw17), [BW18](../references.md#bw18), [BW08](../references.md#bw08).
