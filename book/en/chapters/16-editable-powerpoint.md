# 16. Generate Editable PowerPoint Presentations

[Contents](../manuscript.md) · [Previous](15-markdown-and-word.md) · [Next](17-research-capstone.md)

## 1. A recognizable problem

A report becomes a presentation by placing every paragraph on a slide. The text is tiny, a chart rounds a value differently from the table, and the recipient cannot edit anything because each slide is a single image.

A presentation is a different communication format, not a smaller Word page. It must preserve the facts while changing the amount and arrangement of information.

## 2. Learning contract

Outcome: **O6**, checkpoint **G4**. Prerequisite: Chapter 15. Evidence: reviewed slide outline, editable PPTX, metric/evidence mappings, structural and visual checks, editability demonstration, and a revised output version.

Prerequisite check: what may a renderer change about approved content? Which parts of document validation require an office application rather than a package parser?

## 3. The mechanism: purpose, content, layout, validation

Begin with the audience's decision. A slide needs a purpose, a main message, supporting evidence, and a layout that makes their relationship legible. A theme supplies consistent typography and colors. A template may supply reusable layouts, but its actual editable structures must be tested.

```text
reviewed report -> audience and decision
  -> slide purposes and outline -> reviewer checkpoint
  -> content blocks bound to metric/source IDs
  -> native text, tables, shapes, charts or editable source tables
  -> layout and PPTX rendering
  -> structure, consistency, editability, and visual QA
  -> new artifact version
```

A deck's theme is a property of the deliverable. Changing the host application's light/dark appearance must not unexpectedly recolor a company presentation. Keep application UI tokens and document styling in separate contracts.

Editability has a concrete meaning here: required text and tables are real Office objects, not page-sized pictures. A chart has either editable chart data or a documented editable source table. A decorative illustration may be an image; flattening the whole required deliverable into images fails the course requirement.

## 4. Design alternatives

Manual slide creation remains a useful baseline for one-off work. Screenshot-based slides preserve a visual appearance but prevent meaningful revision and inspection. A structured renderer can preserve editable content and consistent formatting, at the cost of layout rules and QA.

PptxGenJS is a candidate for the TypeScript teaching adapter ([P12](../references.md#p12)); a course release must pin and test it or another suitable implementation. BetterWork's artifact handling is a reference for registration and provenance, not proof that a particular library/template combination meets this chapter's generation requirements.

## 5. Worked example: a five-slide operational report

Use the same verified P1 metrics as Chapters 14–15:

| Slide | Purpose | Main content | Traceability |
| --- | --- | --- | --- |
| 1 | State the decision | Review exceptions before approving next-period work | Reviewer brief |
| 2 | Summarize spending | Actual USD 250; budget USD 300; deviation USD -50 | Overall metric IDs |
| 3 | Explain distribution | A: USD 200/220; B: USD 50/80, actual/budget | Project metric IDs |
| 4 | Expose uncertainty | Hours match overall, but project deviations differ; efficiency unproven | Hours metrics and labeled hypothesis |
| 5 | Request action | Confirm project completion and investigate exceptions | Recommendation, not a measured fact |

A bar chart can compare actual and budget using a shared axis and clearly labeled currency. Do not encode “favorable” solely as green: underspending may reflect unfinished work. Source notes should be readable, and a source register or appendix should preserve full locators even when the main slide is concise.

Now change the current total to USD 270 through a reviewed source revision—not by editing a text box in isolation. Recompute the affected metrics, update the content model, regenerate the affected presentation version, and check every repeated figure. The old deck remains a valid historical artifact of its old inputs. A manual editability demonstration is a separate copy, not a substitute for reproducible generation.

### Host-verified output in BetterWork

BetterWork source ([BW20](../references.md#bw20), MIT):

```ts
if (execution.status !== 'succeeded') {
  throw new Error('Only succeeded executions can register artifacts');
}
if (!execution.outputIds.includes(input.outputId)) {
  throw new Error('Output is not registered for this execution');
}
```

The surrounding service verifies run ownership, structure-report identity, actual bytes, active authorization, and duplicate registration. Its previews are derived caches associated with a renderer revision. A preview is useful for review, but neither a thumbnail nor successful registration proves business correctness or native editability. Those checks remain separate.

## 6. Guided practice: L16

1. Reduce the report to five slide purposes and obtain outline review.
2. Bind each figure to a metric ID and each factual statement to supporting evidence.
3. Render a native editable deck using the prepared teaching adapter/template.
4. Inspect slide count, required text, table cells, and chart/source-data mappings.
5. Open the deck in the declared office application, inspect every slide, edit a text object and a table cell, save a review copy, and reopen it.
6. Change one verified input and generate V2; demonstrate that V1 is unchanged and all affected figures agree.

Hint 1: fix an overcrowded slide by splitting its purpose or reducing content, not by shrinking text until it fits. Hint 2: inspect long labels and source notes as well as titles. Hint 3: a successful parser may still miss a visual overlap. See [L16](../lab-guides/README.md#l16).

## 7. Deliberate failure: structure passes, communication fails

Create three harmless variants: a chart label with the wrong unit, an overflowing source note, and a slide flattened to one image. Each fails a different check: factual consistency, visual legibility, and editability. Record the category and correction.

Also alter an output file after its structure report is generated. Registration should detect the mismatched content identity rather than accepting stale validation. This is the same boundary shown in Chapter 15, now applied to an editable presentation.

## 8. Independent variation

Convert the research proposal into a decision deck for a campus committee. Compare two approaches, label uncertainties, and ask for a bounded pilot decision. Reuse the generation boundary while changing the storyline. Do not invent measured benefits to make the recommendation more persuasive.

## 9. Transfer and reference

BetterWork's workflow design separates audience, narrative, slides, evidence, and notes ([BW25](../references.md#bw25)). The transferable idea is a reviewed intermediate representation. Template fidelity, font substitution, chart support, and viewer behavior still need testing for the selected output stack.

## 10. Summary and retrieval practice

A good deck changes presentation, not facts. Native objects make revision possible; versioned content and input mappings make it explainable. Structure, numbers, sources, editability, and visible layout are distinct acceptance dimensions.

Can an image be part of an editable deck? Why does a source note need visual QA? What happens when V2's input changes a number repeated on four slides? For G4, submit reconciled Excel results, Markdown, editable DOCX, and editable PPTX with all required checks; no format can be replaced by screenshots.

References: [BW20](../references.md#bw20), [BW21](../references.md#bw21), [BW25](../references.md#bw25), [P12](../references.md#p12).
