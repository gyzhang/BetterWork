# 15. Generate Markdown and Word Documents

[Contents](../manuscript.md) · [Previous](14-excel-analysis.md) · [Next](16-editable-powerpoint.md)

## 1. A recognizable problem

The analyst approves the findings in chat. The exported Word file contains a different percentage, headings made by bolding ordinary text, and a table pasted as an image. It looks like a report but cannot be reliably edited, navigated, or traced back to the approved content.

Document generation is a transformation with contracts. The file is not merely a screenshot of an answer.

## 2. Learning contract

Outcome: **O6**. Prerequisite: Chapter 14 and Chapter 08's evidence model. Evidence: one reviewed content model rendered to Markdown and editable DOCX, structural checks, source mappings, editability/visual review, and preserved version lineage.

Prerequisite check: what identifies a verified metric independently of its displayed string? Why does a document need source context even when the chat already contains it?

## 3. The mechanism: content first, format second

Separate the document's meaning from its presentation. The content model contains title, audience, sections, paragraphs, tables, claims, source references, and typed metric references. The renderer maps those elements into a chosen format. A template supplies typography and layout, not new factual content.

```text
verified results + evidence register
  -> outline and reviewer decision
  -> validated content model
  -> Markdown renderer / DOCX renderer
  -> structural and content checks
  -> office-application editability and visual review
  -> immutable output version with input lineage
```

For Word, use real paragraph/heading styles and table cells. A heading's semantic level matters for navigation and accessibility; increasing font size alone does not establish that structure. Preserve table headers, units, and source notes. Long tables need pagination behavior and repeated headings appropriate to the tested renderer/viewer combination.

The artifact identity represents the ongoing work; a version identifies a specific delivered state. Record content-model revision, source/input revisions, template version, renderer version, file hash, validation status, and the version being revised. A filename such as `final-final2.docx` is not an adequate lineage model.

## 4. Design alternatives

Writing Markdown directly is suitable for a short plain-text deliverable. Asking a model to emit raw Office XML makes package structure and document content hard to separate. Rendering a validated content model provides deterministic control over headings, tables, and references while leaving planning and prose to the model.

A template-based approach can preserve organizational conventions, but “supports templates” must be demonstrated for the specific template features used. A library that creates documents does not automatically import every Word template feature. For the teaching adapter, select and pin a tested library and a redistributable style/template strategy. The `docx` project is a documented candidate ([P11](../references.md#p11)), not an installed or validated course dependency in this draft.

## 5. Worked example: one fact, two renderings

Use Chapter 14's verified overall result. The content model records amount `25000`, currency USD, display amount `250.00`, budget `30000`, deviation `-5000`, ratio `-1/6`, period P1, and references to the ledger/budget calculations. The prose may say:

> P1 spending was USD 250.00, USD 50.00 below the USD 300.00 budget (16.67% below budget). This does not by itself establish greater efficiency; project completion requires separate evidence.

The first sentence is a numeric finding. The second prevents an unsupported interpretation. In both formats, the same metric record supplies every displayed figure.

Teaching content contract—not an existing BetterWork API:

| Element | Required fields | Validation |
| --- | --- | --- |
| Heading | Stable ID, level, text | Legal hierarchy and nonempty text |
| Paragraph | Text, claim IDs | All material factual claims mapped or labeled unverified |
| Metric table | Column definitions, units, metric IDs | No missing referenced metric; consistent row widths |
| Reference | Source revision, locator, excerpt identity | Permitted and available evidence |
| Revision | Parent version, reviewer request, inputs | Existing parent and explicit changed content |

Markdown renders a heading, paragraph, table, and source list. DOCX renders equivalent native structures. Compare normalized extracted headings, table cells, metric values, and source IDs. Binary byte equality is neither expected nor necessary across formats. The deck in Chapter 16 may summarize content but cannot change its facts.

### A reference boundary worth reusing

BetterWork source ([BW20](../references.md#bw20), MIT):

```ts
const fileHash = hashBytes(fileBuffer);
if (fileHash !== output.fileHash || fileBuffer.length !== output.fileSize)
  throw new Error('Output hash does not match its validation report');
```

The surrounding service checks that registered bytes match host-verified output. This is a useful publication invariant: do not attach a passing report to different bytes. That service's concrete registration path is PPTX-specific; it is not a Word generator. BetterWork's workflow document also proposes content/format separation ([BW25](../references.md#bw25)), but a design diagram is not executable DOCX support.

## 6. Guided practice: L15

1. Assemble a short content model with a title, two heading levels, a paragraph, a table, and source references.
2. Freeze the metric records and obtain outline review.
3. Render Markdown and DOCX through the author-supplied teaching adapters.
4. Extract and compare required content from both outputs.
5. Open DOCX in the documented office application; edit a paragraph and a table cell in a review copy, save, reopen, and verify the edits.
6. Request one wording revision, create a new output version, and prove the original file/hash remains unchanged.

Hints: reference metrics by ID instead of duplicating numbers; inspect the last table row, not only the first page; preserve the reviewed content and the manual editability-test copy as different evidence. See [L15](../lab-guides/README.md#l15) for the release prerequisite.

## 7. Deliberate failure: a file exists, therefore it passed

Feed the renderer a missing template or a table with an unresolved metric ID. It must fail visibly rather than silently omit the section. Then use a long paragraph and long table to expose clipping or broken pagination. Structural validity establishes that the package can be read; it does not prove every required word is visible.

Finally attempt to save the revision to the original source path. Reject the write before modifying the source. A new output version is required even when the change seems minor. Retain a failed render as diagnostic material only; do not label it a completed artifact.

## 8. Independent variation

Transform the operations report into a campus research proposal containing two options and a claim/source comparison table. Keep the same renderer boundary. Demonstrate that adding a source changes references without requiring the renderer to understand agent research.

## 9. Transfer and reference

The portable unit is the content contract, not a particular Office library API. A future renderer can implement that contract if its tests preserve structure, facts, sources, editability, and version identity. Company templates, fonts, and images have separate rights and compatibility constraints; the course requires redistributable teaching assets.

Word generation remains a required course outcome. Its executable adapter, pinned versions, templates, and viewer evidence must be prepared before L15 is released; they are not delegated to beginners or excused by product status.

## 10. Summary and retrieval practice

A document renderer transforms reviewed content into a usable format. Validate the input model, output structure, factual consistency, editability, and visible layout separately. Preserve the original and the relation between every revision and its inputs.

Why is a valid ZIP/Office package insufficient? What should a template be allowed to change? How do you prove that a validation report belongs to the delivered bytes? Delayed transfer: carry metric IDs into slide objects in Chapter 16.

References: [BW18](../references.md#bw18), [BW20](../references.md#bw20), [BW21](../references.md#bw21), [BW25](../references.md#bw25), [P11](../references.md#p11).
