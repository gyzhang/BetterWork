# 01. Specify a Useful Task Before Choosing an Agent

[Contents](../manuscript.md) · [Next](02-models-and-prompts.md)

## 1. A recognizable problem

A student-club committee spends an afternoon collecting references for each proposal. Someone suggests building an agent. Another person suggests a shared folder and a template. Both may help, but they solve different problems. Before choosing technology, determine whether the difficult part is finding files, interpreting conflicting evidence, performing arithmetic, or deciding what question to investigate next.

A departmental version replaces the club committee with a planning team. The engineering question is unchanged: what observable work should improve, and what responsibility remains with a person?

## 2. Learning contract

Outcome: **O1**. Prerequisite: basic programming; complete G0 before implementation. Evidence: a one-page scenario brief, a non-agent baseline, an agent candidate, and acceptance cases another learner can judge.

Prerequisite check: explain the difference between an input and an output. Is “be intelligent” an output someone can test? If not, rewrite it as an observable action or result.

## 3. The mechanism: locate the variable decision

A **script** executes prescribed operations. A **fixed workflow** chooses among paths whose structure the developer defined. A **retrieval application** selects information for an answer; it need not choose a sequence of actions. An **agent** uses model decisions and observations to select permitted next actions toward a goal.

These categories overlap. An agent may operate inside a fixed workflow, and a workflow may contain retrieval. The useful distinction is where the next-action decision happens and how its consequences are controlled.

```text
user goal
  -> identify inputs, decisions, outputs, and authority
  -> build the simplest adequate baseline
  -> identify decisions requiring adaptation
  -> bound those decisions with tools, evidence, and stopping rules
  -> compare delivered outcomes
```

For a known spreadsheet schema, summing expenses is a script problem. For a proposal with conflicting source requirements, deciding which selected document to inspect next can justify an agent. The arithmetic still belongs to a tool.

## 4. Design alternatives

| Option | Good fit | Main limitation |
| --- | --- | --- |
| Shared template | Stable reporting structure | People still find and check evidence |
| Scripted report | Known inputs and formulas | New ambiguities need explicit handling |
| Retrieve-then-answer | A bounded question over documents | One retrieval may not resolve conflicts |
| Bounded research agent | Follow-up questions depend on observations | More cost, variability, and control obligations |

Choose the agent only when the adaptive decision adds measurable value. A larger model does not remove the need for a baseline. Without a baseline, an attractive demonstration can conceal extra time, cost, or risk.

## 5. Worked example: a scenario brief

**Goal:** help a campus committee decide whether to trial a reference-organizing assistant. **Owner:** the committee chair decides; the application advises. **Inputs:** a synthetic user brief, a platform-capability note, and three approved source documents. **Output:** a proposal comparing at least two approaches, with source locators and an explicit limitation section.

**Permitted actions:** read selected materials, perform approved public-source lookup during the live exercise, calculate stated comparisons, and write new output versions. **Excluded actions:** read unrelated student files, purchase software, publish the proposal, or change official policy.

**Success cases:** every material factual claim has support or an uncertainty label; conflicting sources remain visible; the reviewer can change the audience and obtain a new version without losing the first. **Failure case:** a required integration is absent from the capability note. The system must record the gap rather than promise the integration.

These criteria intentionally do not say “finish in five minutes” or “save 80% of effort.” Those would require a measured baseline. A first evaluation can record elapsed time and review effort without inventing an improvement claim.

## 6. Guided practice: L01

Use the preceding brief as the supplied worked example. Replace its problem with a club-budget report, keeping the decision-owner and excluded-actions fields.

1. Name the report's reader and the decision it informs.
2. List the inputs needed to answer the question; mark missing inputs.
3. Write one deterministic baseline and one possible adaptive step.
4. Define three accepted outputs and two rejected behaviors.
5. Exchange briefs with another learner. Ask them to classify a sample result without asking what you meant.

Hint 1: replace adjectives with evidence. Hint 2: separate “calculate the change” from “explain why it changed.” Hint 3: a permitted read is not a permitted publication.

## 7. Deliberate failure: the absent decision owner

The brief says “choose the best tool and deploy it.” No one has granted deployment authority, and “best” has no criteria. Reproduce the failure by giving two reviewers different priorities; one chooses price, the other privacy. Both can defend incompatible answers.

Correct the brief by naming the owner, criteria, and a review checkpoint. The regression check is simple: when approval is absent, the system may produce an advisory comparison but cannot report deployment as completed. This is a scope correction, not a prompt-strengthening exercise.

## 8. Independent variation

Design a maintenance-summary assistant using synthetic work orders. Do not grant equipment-operation authority. Explain which steps remain scripts and which, if any, require an agent. Submit the brief without borrowing the campus solution's criteria verbatim.

## 9. Transfer and BetterWork reference

BetterWork organizes work around tasks and reusable artifacts. Its architecture supplies a concrete host/core separation ([BW24](../references.md#bw24)), and its workflow document separates research, calculation, and rendering ([BW25](../references.md#bw25)). Those documents contain both design targets and implementation notes; they are not evidence that a particular workflow has passed acceptance.

The transferable lesson is to specify the delivered work, not the chat experience. A proposal must remain understandable when the conversation is closed.

## 10. Summary and retrieval practice

An agent is an implementation choice, not the goal. Locate the adaptive decision, compare a simpler baseline, and define evidence and authority before tools.

Without looking back: can a retrieval application be non-agentic? Why is an unknown requirement different from a missing feature? What would establish that an agent saves time? Delayed transfer: after Chapter 05, revise this brief using your actual control-flow comparison.

References: [BW24](../references.md#bw24), [BW25](../references.md#bw25). Next, examine what a model can and cannot contribute to that work.
