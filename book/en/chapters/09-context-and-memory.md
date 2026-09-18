# 09. Manage Context and Memory

[Contents](../manuscript.md) · [Previous](08-retrieval.md) · [Next](10-skills-and-experts.md)

## 1. A recognizable problem

Last period, the club spent USD 250. This period, it spent USD 270. The assistant remembers a useful preference—“lead with exceptions”—but also reuses the old total as current data. The problem is not simply too little memory. It is a failure to distinguish a durable working preference from a time-bound observation.

Good continuity preserves methods while replacing facts that must change.

## 2. Learning contract

Outcome: **O4**. Prerequisite: Chapter 08. Evidence: two context snapshots, confirmed-memory lifecycle tests, scope/exclusion checks, and a comparison of full-history and selected-context inputs.

Prerequisite check: which source identity establishes that a number belongs to the current period? Why is a summary not a substitute for that source?

## 3. The mechanism: assemble, do not accumulate

A model request receives finite context. The host assembles that context from instructions, selected materials, recent history, tool observations, and applicable memory. Information stored somewhere in the application is not automatically present in the current request.

**Knowledge** is reference material: a policy, a workbook, or a prior artifact. **Memory** is retained collaboration context: a confirmed preference, a reusable agreement, or an experience with explicit applicability. **History** records interaction. **A summary** compresses selected history. These categories may point to each other, but none should silently inherit another's authority.

```text
start a new run
  -> resolve current task and approved input revisions
  -> select applicable, confirmed, nonexpired memories
  -> apply exclusions and current revocations
  -> add relevant recent interaction and labeled summaries
  -> reserve output space; budget all request components
  -> persist a context manifest
  -> call the provider
```

A context manifest records identities and decisions: included source revisions, memory revisions, method versions, omissions, and summary provenance. It need not duplicate every document in a log. Sensitive content requires its own storage and retention policy.

An illustrative allocation for an 8,000-token model limit reserves 1,500 tokens for output and 500 for overhead. That leaves at most 6,000 for instructions, schemas, history, and evidence together. This is a planning example, not a tokenizer-independent guarantee. Measure with the selected model's accounting and keep a safety margin. When space is insufficient, selectively read or summarize; do not truncate a warning while preserving the claim it qualifies.

## 4. Design alternatives

Copying the whole history is easy to implement but preserves obsolete facts, increases cost, and makes inclusion hard to explain. Aggressive summarization reduces size but can erase uncertainty and source identity. A selected-context approach requires more metadata but offers deliberate scope and freshness.

For a single short task, persistent memory may add no value. Begin with explicit inputs and a small recent history. Add durable memory only for a demonstrated cross-task need, with confirmation and deletion behavior defined first.

## 5. Worked example: reuse the preference, replace the ledger

Consider four synthetic records:

| Record | Meaning | New-period treatment |
| --- | --- | --- |
| M1 | Confirmed preference: lead with exceptions | Include if its scope matches |
| M2 | Candidate claim: project B always overspends | Exclude; unconfirmed and overgeneralized |
| K1 | Prior-period ledger, revision 1 | Historical comparison only if selected |
| K2 | Current-period ledger, revision 1 | Current data source |

The new request should state the roles explicitly. “Prior report supplied as historical context” is different from “reuse its figures.” If the current ledger is missing, the correct result is missing current data—not an automatic fallback to K1.

BetterWork source ([BW15](../references.md#bw15), MIT):

```ts
const excluded = new Set(excludedMemoryIds);
return this.store.memories
  .listApplicable(workspaceId, expertId, now)
  .filter((memory) => !excluded.has(memory.id));
```

Applicability is resolved by the repository; the service also applies explicit per-run exclusions. Read the repository's scope, status, and validity conditions ([BW16](../references.md#bw16)) rather than assuming that a scope label alone is sufficient. BetterWork's Markdown memory files are rebuildable projections of SQLite state, not a second authoritative store.

A teaching memory lifecycle can be described as candidate → confirmed → revised, disabled, or deleted. Exact state names belong to the implementation. Preserve revision history for audit where policy allows, but exclude deleted content from future context. Deleting a memory does not retroactively remove text already transmitted to a provider or stored in old artifacts; explain retention and historical-access behavior honestly.

## 6. Guided practice: L09

1. Prepare two tasks with separate period inputs and one shared confirmed preference.
2. Write a context manifest for each before invoking a model.
3. Compare full-history and selected-context payloads for size, obsolete content, and answer support.
4. Disable or delete the preference and build a third request. Assert its content is absent.
5. Change workspace and assert workspace-specific records are absent.
6. Add a summary containing an old number; ensure it cannot establish the new period's current value.

Hint 1: test the assembled provider request, not only the memory-management screen. Hint 2: test exclusions after applicability selection. Hint 3: check cached summaries and retrieval indexes as well as the primary record. See [L09](../lab-guides/README.md#l09) for required evidence.

## 7. Deliberate failure: deletion that does not affect execution

Remove M1 from the visible list but leave an earlier context cache unchanged. The next run still receives M1. The user interface appears correct while execution violates the deletion expectation.

Make derived context rebuildable and bind it to current revisions. Add a regression test that assembles a fresh request after deletion and inspects the actual provider input. For an already-running request, define whether revocation cancels it or only affects future actions; do not imply that sent context can be recalled. Snapshot reproducibility and present-day permission checks serve different purposes.

## 8. Independent variation

A research group prefers concise recommendations, but one task needs a detailed methods appendix. Design a precedence rule in which the explicit current task can override a preference without rewriting the preference globally. Explain which settings are instructions and which require host enforcement.

## 9. Transfer and reference

A useful memory is small, scoped, attributable, and revisable. “Use this report structure” may transfer to the next period; “revenue is 100” normally does not transfer as a timeless fact. A selected prior artifact remains evidence of prior work, not evidence that its observations remain true.

## 10. Summary and retrieval practice

Context is constructed for each request. Memory supports continuity but must have applicability, freshness, confirmation, exclusion, and deletion semantics. A manifest explains why information was included; a source supports whether a claim is true.

Which record should survive into a new period? Why can deleting a database row fail to remove future context? What does a context snapshot preserve that a conversation summary does not? Delayed transfer: inspect the second-period task in Chapter 18 for hidden inherited inputs.

References: [BW14](../references.md#bw14), [BW15](../references.md#bw15), [BW16](../references.md#bw16), [BW18](../references.md#bw18).
