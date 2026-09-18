# 08. Build and Evaluate Retrieval-Augmented Generation

[Contents](../manuscript.md) · [Previous](07-mcp.md) · [Next](09-context-and-memory.md)

## 1. A recognizable problem

A campus proposal asks whether a pilot can use cloud services. The answer is in a short policy, but the assistant instead quotes a marketing page about cloud features. The retrieved page is relevant to the vocabulary and irrelevant to the decision authority. Putting it into a model's context does not make it an acceptable policy source.

Retrieval is a selection problem before it is a writing problem. We must measure both.

## 2. Learning contract

Outcome: **O4**. Prerequisites: Chapters 06–07. Evidence: one corpus with stable locators, labeled queries, lexical and embedding rankings, Recall@k and irrelevant-hit counts, and a claim-to-source table.

Prerequisite check: explain why a successful read does not establish truth, and why a document outside the selected scope must not enter retrieval.

## 3. The mechanism: preserve identity while reducing context

A practical retrieve-then-generate pipeline extracts usable text, divides it into addressable chunks, retrieves candidates, selects bounded context, and asks the model to answer from that context. The original RAG paper studies trained retrieval-augmented models; our application-level pipeline borrows the grounding idea without claiming to reproduce that training procedure ([P02](../references.md#p02)).

```text
selected document revisions
  -> extraction with locators and content identities
  -> chunks with stable IDs
  -> lexical or embedding index
query -> ranked permitted chunks -> bounded context
  -> answer with claim/source mapping -> support checks
```

A **chunk** is a retrievable piece of a document. Split at meaningful headings or paragraphs where possible. Tiny chunks lose qualifying context; very large chunks consume budget and can dilute useful information. Overlap can preserve continuity but also duplicate evidence. Evaluate the policy rather than treating a particular chunk length as universal.

**Lexical retrieval** compares words or tokens. It is often strong for exact names, identifiers, and specialized terms. **Embedding retrieval** maps queries and chunks into numeric vectors so proximity can represent learned similarity. The same embedding model and compatible preprocessing must be used for both sides. Vectors from unrelated models cannot be mixed just because they have the same length.

For nonzero vectors, cosine similarity is the dot product divided by the product of their lengths. You need not know linear algebra beyond multiplying matching components and adding them to follow a tiny example. For a toy query `[1, 0]`, vector `[1, 0]` has similarity `1`, `[0, 1]` has `0`, and `[1, 1]` has about `0.707`. These hand-created vectors explain the arithmetic; they are not embeddings measured from a model. Define explicit behavior for a zero vector.

## 4. Design alternatives

For three short documents, reading all selected content may be simpler than indexing. For a stable terminology-heavy corpus, lexical retrieval can be sufficient. Embeddings can help with paraphrases but may retrieve topically similar material that does not answer the question. Hybrid retrieval and reranking are later alternatives after a measured baseline, not prerequisites for every application.

Scope filtering must happen before unauthorized content can enter returned candidates or model context. Taking global top-k and then filtering can also leave too few authorized results; the ranking strategy should account for the permitted corpus.

## 5. Worked example: separate relevance from support

Use this synthetic corpus on paper before implementing the adapters:

| Chunk | Locator | Content |
| --- | --- | --- |
| C1 | policy-v2, §2 | The pilot may use approved cloud services with synthetic data only. |
| C2 | platform-v1, §4 | The platform provides local file retrieval; scheduled jobs are unavailable. |
| C3 | interview-v1, §1 | The team wants overnight reports and automatic email delivery. |
| C4 | policy-v1, §2 | An earlier policy prohibited cloud use for all pilots. |

For “What data may the current cloud pilot use?”, label C1 relevant, C2/C3 irrelevant, and C4 historical conflict context rather than current authority. Freeze these labels before comparing retrieval settings. If the task instead asks how the policy changed, C4 becomes relevant; labels belong to a question and judgment policy, not permanently to a document.

Suppose a broader query has relevant set `{C1, C2}`. A hypothetical lexical top-2 is `[C2, C3]`; a hypothetical embedding top-2 is `[C1, C2]`. Recall@2 is respectively `1/2` and `2/2`. Precision@2 is respectively `1/2` and `2/2`; irrelevant-hit counts are `1` and `0`. These rankings are illustrative, not experimental results. If a query has no relevant documents, report that case separately rather than dividing by zero. Compare methods on the same questions, corpus, scope, and k ([P06](../references.md#p06)).

Now write an answer: “Use only synthetic data in the approved cloud pilot [C1, §2]. Scheduled reports remain an unmet requirement [C2, §4; C3, §1].” The first claim is a policy fact. The second combines an implemented limitation with a stated need. “The platform is secure” is not established by any of these excerpts.

Selected, retrieved, read, and cited are separate events. A source register should record identity/revision, locator, excerpt, and whether each final claim is supported, conflicted, or unverified.

## 6. Guided practice: L08

1. Assign stable IDs and locators to the four passages, then expand them with instructor-supplied distractors.
2. Write relevance labels for at least five questions before tuning a retriever.
3. Implement a lexical baseline in the teaching starter and record every top-k list.
4. Compare fixed embedding fixtures offline; then use the selected live embedding adapter and retain model/dimension/settings metadata.
5. Produce Recall@k and irrelevant-hit counts per query, not just one favorable average.
6. Generate an answer and manually verify each material claim against the cited passage.

Hint 1: a retrieval miss and a generation hallucination are different defects. Hint 2: preserve source revisions through chunking. Hint 3: reserve a few unseen questions so tuning does not simply memorize the evaluation set. The [lab companion](../lab-guides/README.md#l08) records the author-owned fixture and adapter requirements.

## 7. Deliberate failure: a title becomes evidence

Retrieve a search summary saying “the platform supports scheduling,” but provide no full-text support. Ask the assistant to reconcile it with C2. A defensible answer reports the conflict and the lack of verified support; it does not upgrade a summary into a confirmed feature.

Also test empty retrieval. The model may offer a general explanation labeled as such, ask for a source, or stop. It must not invent a locator. Add assertions that every cited ID exists in the permitted, actually available evidence set; separately inspect whether its content supports the claim. Identifier validity alone is insufficient.

## 8. Independent variation

Replace the policy corpus with synthetic equipment-maintenance guidance. Include one superseded procedure and a current procedure with similar wording. Explain how revision authority and relevance interact. No exercise authorizes operating equipment.

## 9. Transfer and reference

BetterWork's vault provides library FTS5 retrieval with a fallback and a separate selected-revision search path ([BW14](../references.md#bw14)). The selected-revision path requires each query term to appear in the revision title/chunk text and returns empty for an empty selection. It is not the embedding implementation in this chapter. Read the two paths separately; a product's library search does not establish its run-scoped search semantics. FTS5 is documented in [P05](../references.md#p05).

## 10. Summary and retrieval practice

Retrieval narrows information while preserving source identity. Embeddings offer another ranking signal, not a truth detector. Evaluate retrieval against labels, then evaluate answer support against sources.

Why might C4 be irrelevant to one question and essential to another? What does Recall@2 fail to measure? How can every citation ID be valid while the answer remains unsupported? Delayed transfer: carry the claim/source table into Chapter 15's document content model.

References: [BW14](../references.md#bw14), [P02](../references.md#p02), [P05](../references.md#p05), [P06](../references.md#p06), [P07](../references.md#p07).
