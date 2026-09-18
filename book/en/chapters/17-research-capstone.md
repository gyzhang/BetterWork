# 17. Capstone A: Research to a Defensible Proposal

[Contents](../manuscript.md) · [Previous](16-editable-powerpoint.md) · [Next](18-operations-capstone.md)

## 1. A recognizable problem

A campus research committee asks, “Should we use an agent to prepare project proposals?” That question is too broad to answer responsibly. Which sources may it use? Who approves the proposal? Is automatic delivery required? What happens when a policy and a platform description disagree?

Your job is to build a decision-support journey, not to produce an enthusiastic sales pitch. A defensible proposal makes the decision, evidence, alternatives, and uncertainties visible outside the chat.

## 2. Learning contract

Outcome: **O7**, integrating O1–O6. Prerequisite: G4. Evidence: scoped brief, approved research plan, evidence and claim registers, reviewed outline, Markdown/DOCX/PPTX outputs, revision lineage, and layered evaluation.

Prerequisite check: can you trace one final claim through a source locator and input revision? Can the host deny an unselected source without relying on the model to refuse?

## 3. The mechanism: bounded stages, adaptive research

Use fixed stage boundaries with bounded model-driven work inside them:

```text
clarify decision -> approve research plan
  -> retrieve/read approved sources -> register support and conflicts
  -> compare alternatives -> approve outline
  -> create common content model -> render three formats
  -> validate and review -> revise as a new version
```

At a direction-changing gap, ask the decision owner. Within an approved subquestion, the loop can choose a further permitted lookup. A research budget limits iteration even if more information might exist. Stop with explicit uncertainty when support remains insufficient.

A decision record captures the reviewer, subject version, choice, rationale, and unresolved items. It is not an assertion that the recommendation is true merely because someone approved it. Source checks and human authorization have different roles.

## 4. Design alternatives

Compare at least a non-agent baseline, a fixed workflow where appropriate, and the agent candidate. A fixed source checklist plus document template may meet a stable need with lower operational complexity. An agent becomes useful when source selection and follow-up depend on intermediate observations. Neither alternative removes the need for review and artifact validation.

Do not add autonomous email, scheduled execution, or customer-system writes because the model proposes them. Unsupported platform capability belongs in the feasibility analysis with a mitigation and owner, not in an implied implementation promise.

## 5. Worked example: a compact proposal from the teaching corpus

Use Chapter 08's synthetic policy, platform description, and interview as the initial evidence. The brief adds: the committee wants a pilot recommendation; all data is synthetic; a human publishes the final proposal. The unspecified requirement is whether overnight delivery is essential or merely desirable.

First clarification: “Is the pilot acceptable if a person starts the workflow and distributes the reviewed output?” Suppose the reviewer says yes. Record that decision rather than silently revising the brief.

### Research plan

- Confirm allowed data and current policy authority.
- Check which retrieval and delivery capabilities exist.
- Compare manual/template, fixed workflow, and bounded-agent approaches.
- Identify evidence needed to evaluate the pilot; do not invent savings.
- Review the outline before producing documents.

### Claim and evidence register

| ID | Claim | Support | Treatment |
| --- | --- | --- | --- |
| Q1 | The pilot may use approved cloud services with synthetic data | C1, policy-v2 §2 | Current policy fact in this fixture |
| Q2 | Scheduled jobs are unavailable in the supplied platform | C2, platform-v1 §4 | Capability limitation |
| Q3 | The team wants overnight reports | C3, interview-v1 §1 | User need, not implemented capability |
| Q4 | The proposed agent will save half the team's time | No measured evidence | Remove as a verified claim; formulate a testable hypothesis |

C4 conflicts with Q1 because it is an earlier policy. Identify the version relationship and the decision owner's confirmation of applicability; do not simply count which policy has more matching words.

### Example proposal passage

> Recommend a bounded, human-started pilot that prepares a proposal from selected synthetic materials. The current policy permits this data use [Q1]. The supplied platform lacks scheduled jobs [Q2], so overnight automation is excluded from the pilot despite the team's stated preference [Q3]. Compare the pilot with a fixed source checklist and template using completion time, supported-claim coverage, correction effort, and usable-output checks. Time savings remain an evaluation hypothesis, not an established benefit.

This recommendation follows the evidence but does not claim that the agent is automatically the best solution. A small comparison table should explain the trade-off: fixed workflow for stable inputs; agent-assisted follow-up for variable questions; human decision ownership in both.

The final content model includes problem, constraints, alternatives, recommendation, architecture boundaries, risks, evaluation plan, and references. Render it into a full Markdown proposal, equivalent editable DOCX, and a concise editable decision deck. The deck may omit detailed prose but must retain material limitations.

## 6. Guided practice: L17

1. Complete the brief and excluded-actions list using the supplied campus or professional fixture pack.
2. Obtain and record research-plan approval.
3. Run recorded-source retrieval for the deterministic baseline; separately perform a bounded lookup of an approved public primary source and retain actual capture provenance.
4. Register claims, conflicts, missing support, and source identity before drafting.
5. Compare alternatives and obtain outline feedback.
6. Produce all three formats, validate them, and apply a reviewer direction change as new versions.
7. Execute the capstone evaluation set from Chapter 13 and keep deterministic, live, integration, and human results separate.

Hints: start with the evidence table, not the prose; ask one decision-focused clarification at a time; propagate a direction change through every format. See [L17](../lab-guides/README.md#l17) and the [capstone specification](../labs-and-assessment.md).

## 7. Deliberate failure: a recommendation outlives its assumptions

The reviewer changes the requirement: overnight unattended delivery is now mandatory. The earlier recommendation no longer meets the supplied platform boundary. Do not keep the same architecture and merely strengthen its wording. Reopen feasibility, explain the gap, and propose a separately owned extension or a different platform evaluation. Do not implement unapproved scheduling as part of this exercise.

Also include an unselected source, an embedded instruction to read unrelated data, and a search summary without full-text support. Test execution denial and source-support handling independently. A generated bibliography full of plausible titles is a failure if the sources were never available.

## 8. Independent variation

Use a different synthetic research pack with two conflicting policy interpretations and one unavailable capability. Without copying the worked recommendation, explain what additional evidence or human decision is needed. The instructor changes the audience after the outline; preserve facts while revising emphasis.

## 9. Transfer and reference

BetterWork's research workflow design supplies a real product motivation for staged research and reviewed artifacts ([BW25](../references.md#bw25)). Its run/checkpoint/artifact code supplies implementation reference seams ([BW18](../references.md#bw18), [BW19](../references.md#bw19), [BW20](../references.md#bw20)). The course's explicit claim table and complete three-format teaching journey must still be demonstrated as an integrated application.

## 10. Summary and retrieval practice

Research produces a defensible decision aid when sources support claims, alternatives remain visible, uncertainty is explicit, and the reviewer controls direction. Deliverables must stand alone and remain revisable.

Which part of Q3 is a fact? Why is Q4 not a result? What must change when an optional feature becomes mandatory? Delayed transfer: apply the same support discipline to causal explanations in the operations capstone.

References: [BW18](../references.md#bw18), [BW19](../references.md#bw19), [BW20](../references.md#bw20), [BW25](../references.md#bw25), [P02](../references.md#p02).
