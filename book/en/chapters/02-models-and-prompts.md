# 02. Understand Models, Prompts, and Their Limits

[Contents](../manuscript.md) · [Previous](01-useful-tasks.md) · [Next](03-one-tool-exchange.md)

## 1. A recognizable problem

The club asks, “Explain why spending increased.” A model replies that more events attracted more members. The supplied material contains only spending totals. The response is fluent, relevant-sounding, and unsupported. The model has filled a missing causal explanation with plausible language.

Our goal is not to forbid interpretation. It is to distinguish what the inputs establish from what someone still needs to investigate.

## 2. Learning contract

Outcome: **O2**. Prerequisites: Chapter 01 and G0. Evidence: two prompt variants, a fixed test set, repeated observed responses when live access is available, and a list of facts unavailable from the input.

Prerequisite check: can a valid JSON object contain a false claim? Explain why syntax and truth are separate properties.

## 3. The mechanism: bounded information, probabilistic output

A language model processes **tokens**, units produced by its tokenizer. Tokens are not reliably equivalent to words or characters. The **context window** bounds the information available in a request. Instructions, history, tool definitions, observations, and output allocation all consume resources; the exact accounting is provider-specific.

**Training** changes model parameters. **Inference** uses the model to produce a response. Adding a document to a request changes the inference context; it is not the same as training the model on that document. A previous conversation is not automatically available unless the application or provider supplies retained state.

Message roles help express instruction priority and conversational structure. They do not turn document text into trusted policy. A prompt can ask the model to follow a contract, but the host must enforce permissions and validate executable requests. The provider's prompt-engineering guide documents roles, response variation, and context limits ([P14](../references.md#p14)); always check the model and API revision actually used.

```text
task contract + selected evidence + output requirements
  -> model inference
  -> candidate response
  -> structural validation
  -> source/numeric checks
  -> accepted output or correction
```

Structured output narrows representation. A schema can require a list of claims and source IDs. It cannot by itself establish that a cited source supports a claim. Refusals and output-limit interruptions also need explicit handling rather than assuming every response is a complete schema instance ([P15](../references.md#p15)). Lower randomness may reduce variation for some settings, but it does not guarantee truth or identical results across service revisions.

## 4. Design alternatives

A single broad instruction is easy to write but leaves audience, evidence, and uncertainty handling unspecified. A long prompt can be explicit but consume context and create contradictory demands. Use the smallest contract that states the task, evidence boundary, expected output, and behavior when information is missing.

Do not demand confident language for every answer. If evidence is missing, an honest unknown is the correct result. Conversely, do not bury every ordinary fact under generic disclaimers; attach uncertainty to the particular unsupported claim.

## 5. Worked example: two prompts

Synthetic input: current spending `25000` minor units; prior spending `20000`; no attendance or event-count data. The deterministic change is `5000`, or `25%` against the positive baseline.

**Prompt A:** “Write an impressive management summary explaining the increase.”

**Prompt B:** “Summarize the supplied calculation for the club treasurer. Separate measured observations from hypotheses. The input establishes spending, not causes. Do not invent attendance, event counts, or sources. Return an observation, a limitation, and a question for the reviewer.”

An acceptable target response is: “Spending rose by USD 50.00, or 25%. The supplied data does not establish why. Were there changes in event count, attendance, or supplier prices?” This is an authored expected answer, not a recorded model response.

BetterWork source ([BW05](../references.md#bw05), MIT) exposes two request controls:

```ts
temperature: this.config.temperature ?? 0.7,
max_tokens: this.config.maxOutputTokens ?? 8192,
```

These lines occur inside a Chat Completions request. They are reference defaults, not recommended universal classroom budgets. The adapter's type and wire format must match the service you actually use. The official tool-calling guide is [P03](../references.md#p03).

## 6. Guided practice: L02

Prepare three fixed cases: complete numeric evidence without causes, a missing prior value, and two contradictory source notes. Write acceptance criteria before running either prompt.

1. Predict one likely failure for each case.
2. Compare Prompt A and Prompt B on the same cases.
3. When approved live access is supplied, run each case twice per prompt: twelve attempts total.
4. Retain every attempt, configuration, observed completion, and unsupported claim.
5. Report counts, not “the better prompt always works.”

For this introductory experiment, propose a cap of twelve model requests, 512 output tokens per request, and a 60-second request timeout. The instructor must approve a monetary ceiling based on the selected provider before live use. If cost cannot be bounded with the supplied access, do not begin paid runs. Paper prediction is useful preparation but does not replace live evidence.

Hints: score evidence use separately from writing quality; freeze the cases before comparing prompts; mark absent usage information unknown.

## 7. Deliberate failure: omitted context

Remove the prior-period value but leave an earlier answer mentioning 25% in the history. Ask for a current comparison. A response that reuses 25% without current support fails even if its arithmetic was correct earlier.

The cause is stale or ambiguous context, not necessarily poor arithmetic. Correct the context contract by naming current inputs and stating which previous information is historical. Add a regression case where the missing baseline must produce an unavailable comparison. Do not fix it by inserting the old number into every prompt.

## 8. Independent variation

Replace spending with project hours. Supply actual hours but omit planned hours. Design an output contract that allows a factual total and requires an explicit gap for schedule performance. Explain why “the team is behind schedule” is unsupported.

## 9. Transfer and reference

BetterWork separates a provider contract from its engine ([BW01](../references.md#bw01)) and includes a scripted provider ([BW04](../references.md#bw04)). The latter is useful for execution tests, not a substitute for this chapter's model-quality experiment. Its predictable wording cannot establish that a live model follows an evidence contract.

## 10. Summary and retrieval practice

Prompts shape candidate behavior. Context supplies bounded information. Schemas constrain form. Host checks enforce authority, and source checks evaluate support.

Explain without notes: inference versus training; tokens versus characters; structurally valid versus factually supported output. Delayed transfer: in Chapter 13, return to these twelve-attempt results and classify failures by model, data, tool, or runtime cause.

References: [BW01](../references.md#bw01), [BW04](../references.md#bw04), [BW05](../references.md#bw05), [P03](../references.md#p03), [P14](../references.md#p14), [P15](../references.md#p15).
