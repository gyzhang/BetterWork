# Module 00. From Basic Programming to an Agent Laboratory

[Book contents](../manuscript.md) · Next: [Chapter 01](../chapters/01-useful-tasks.md)

## The problem: a function is not yet a system

You can write a loop that adds numbers. An agent application adds several complications: the numbers arrive from a file, the file may be malformed, the model response arrives later, the person using the program may cancel, and another person must reproduce the result. None of those complications requires machine learning. They are the foundation on which the agent will depend.

This bridge has four exits, F01–F04. Demonstrating an exit lets you skip its instruction, not its evidence. Budget roughly three guided hours per bridge, adjusted after actual teaching trials. The exercises below can be traced on paper; executable starter packaging remains tracked in the [lab companion](../lab-guides/README.md).

### Entry diagnostic

In your familiar language, write a function that sums only positive values in a list. For `[5, -2, 0, 7]`, explain why the result is `12`. Change it to include negative values and explain why the result becomes `10`. Show what your program does for an empty list. If functions, iteration, and conditionals are unfamiliar, complete introductory programming before this course.

## F01. Programs, files, modules, and changes

A terminal executes commands in a working directory. A relative path such as `inputs/ledger.json` is interpreted relative to a defined base; it is not an identity that means the same thing everywhere. This matters when a program must read only selected material. Later, the host will resolve a source ID into an approved path rather than let the model invent one.

A module gives a program a named boundary. One module exports a calculation; another imports and tests it. A dependency is a separately supplied module. A package manifest declares dependency requirements, while a lockfile records a concrete dependency resolution. Installing a dependency is a software-supply decision, not a harmless way to make an error message disappear.

TypeScript adds static descriptions to JavaScript. In `amount: number`, the annotation says which values the checker permits. It does not validate a spreadsheet cell at runtime. An interface describes an object's required structure, and an optional property such as `previous?: number` may be absent. A union such as `number | undefined` makes that absence something the program must handle.

BetterWork source ([BW01](../references.md#bw01), MIT):

```ts
export interface ModelProvider {
  readonly id: string;
  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>;
}
```

Read this slowly. An implementation has an identifier and a `stream` operation. The operation accepts a request and produces a sequence of chunks over time. You do not need to implement a language model to implement this interface; a test double can supply chunks. This is why the course can test control flow without a paid service.

### Guided practice and exit

1. Locate the root manifest and the core types file using your editor.
2. Explain the difference between a package name, a filesystem path, and an exported symbol.
3. In a disposable learner copy, change one arithmetic input in an existing test. Predict whether the expected result also needs to change.
4. Inspect the version-control diff. Identify exactly which lines are your work.
5. Explain how you would return to a known source revision without overwriting someone else's changes.

Do not begin by running desktop setup. The course's first execution surface is headless. The [lab companion](../lab-guides/README.md) separates reference-test commands from the still-to-be-packaged teaching application.

**Deliberate failure:** run from the wrong working directory. Diagnose “file not found” by checking the command's base path, not by adding random parent-directory segments. **Independent exit:** modify and test a second function, then explain the module boundary and diff without assistance.

## F02. JSON, interfaces, and untrusted values

JSON is a data format, not a TypeScript object declaration. JSON has strings, numbers, booleans, null, arrays, and objects. It has no comments, functions, or `undefined`. Parsing JSON answers “is this syntactically valid JSON?” It does not answer “is this a valid budget record?”

Consider these three synthetic inputs:

```json
{"project":"A","amount_minor":12000,"currency":"USD"}
```

```json
{"project":"A","amount_minor":"12000","currency":"USD"}
```

```json
{"project":"A","currency":"USD"}
```

All three are valid JSON. Only the first meets a contract requiring an integer amount. Converting every input with `Number(value)` is not validation: an empty string and other unintended values can acquire plausible numeric meanings. First check the shape, then the domain constraint, then calculate.

An HTTP request has a method, address, headers, and sometimes a body. A response has a status, headers, and usually a body. Successful transport does not establish valid application data. A `200` response may contain malformed JSON or a tool-level error; an unavailable service may return an HTML error page.

Use this decision sequence:

```text
receive response
  if transport failed: report transport failure
  if status is not accepted: report status failure
  parse body
  validate fields and domain constraints
  return a typed application result
```

Configuration is another input boundary. A service address is not a secret; an access token is. Record whether a key is configured, never its value. Do not paste credentials into exercise evidence or commit them with a sample configuration.

### Guided practice and exit

Classify the three JSON objects. Add a fourth with fractional minor units and a fifth with an unsupported currency. Write the expected error for each before implementing validation. Then design responses for “valid empty list,” “invalid record,” and “service unavailable.” Those outcomes must remain distinguishable.

**Hint 1:** begin with `unknown`, not a forced type assertion. **Hint 2:** check presence before arithmetic. **Independent exit:** validate a project-hours record with a missing field and explain why syntax validation alone is insufficient. Review BetterWork's Zod parsing in [BW08](../references.md#bw08).

## F03. Asynchronous work, errors, and cancellation

A Promise represents an eventual result. `await` waits for that result within an asynchronous function; it does not freeze all other work in the process. Sequential awaits express dependency: you cannot interpret a tool result before the tool finishes. Concurrent work is appropriate only when operations are independent and share a safe resource policy.

Streaming adds a sequence of eventual results. `for await` consumes chunks as they become available. A connection ending is not necessarily proof that the operation completed successfully. A provider must distinguish an accepted completion marker from an unexpected end of stream.

BetterWork source ([BW05](../references.md#bw05), MIT):

```ts
const timeout = AbortSignal.timeout(this.streamTimeoutMs);
const signal = AbortSignal.any([request.signal, timeout]);
```

The surrounding provider passes the combined signal to `fetch`. Either the caller or the timeout can request cancellation. The cause still matters: a person cancelling should not be reported as the service failing. The provider examines the original signals when mapping errors.

An abort signal is cooperative. It cannot magically stop arbitrary synchronous work or undo an external write. A tool must pass the signal to operations that support it and check it at useful boundaries. Child processes require their own lifecycle management. We deepen this distinction in Chapter 12.

### Trace exercise

| Step | Observation | Required interpretation |
| --- | --- | --- |
| 1 | Request begins | Work is running |
| 2 | Text fragment arrives | Partial output, not completion |
| 3A | Completion marker arrives | Provider exchange completed |
| 3B | Connection closes without marker | Incomplete exchange |
| 3C | Caller aborts | Cancellation requested |

Only one branch after step 2 occurs in this exercise. Do not combine partial text from branch 3B with a “completed” badge.

**Guided practice:** trace a delayed Promise, then a streamed sequence, and add a caller-controlled abort. Predict which statements execute before and after `await`. **Deliberate failure:** catch every exception and return an empty list; show how a network failure now looks like “no matching sources.” Correct it by preserving a distinguishable error. **Independent exit:** cancel during a delay and explain why cancellation is not the same as a valid empty result. See [P09](../references.md#p09).

## F04. Assertions, table grain, and numerical evidence

An assertion compares an actual result with an expected result. A fixture supplies controlled input. An oracle supplies an independently justified answer. If the same buggy function generates both the actual result and its expected result, the comparison proves little.

A table's **grain** describes what one row means. Here it is one spending entry, not one project:

| entry_id | project_id | amount_minor | currency |
| --- | --- | ---: | --- |
| e1 | A | 12000 | USD |
| e2 | A | 8000 | USD |
| e3 | B | 5000 | USD |

The totals are A = `20000`, B = `5000`, overall = `25000` minor units. With 100 minor units per unit, the overall displayed amount is USD 250.00. We keep the exact integer representation until display. These examples use USD only to make the arithmetic familiar; currencies can have different minor-unit conventions.

A project table with rows `(A, Research)` and `(B, Events)` can attach names to these entries. If project A appears twice, a join can duplicate both A entries, producing `45000` instead of `25000`. A successful SQL query is not proof of a correct relationship.

A **budget** is an agreed comparison amount, not another spending transaction. If the budget is `30000`, actual minus budget is `-5000`; the ratio is `-5000 / 30000`, approximately `-16.67%`. Whether this is favorable depends on the goal. Underspending can mean efficiency or an unfinished activity.

Missing and zero differ. Zero says a value was measured or specified as zero. Missing says the value is not available. An unknown budget cannot justify “0% deviation.” A zero denominator has no ordinary numeric ratio.

### Guided practice and exit

1. Verify the totals by hand.
2. Define tests for a valid table, a duplicate entry ID, and a missing amount.
3. Inject the duplicated project row and reconcile the pre-join and post-join totals.
4. Correct the join policy before rendering a report.
5. Change e3 to `7000`; independently derive the new overall total, `27000`.

**Staged hints:** identify grain first; count matches per key second; aggregate only after validating the relationship. **Independent exit:** use a new table, add a regression assertion, and explain why a model's confident answer is not an oracle. Later chapters reuse these exact distinctions for larger workbooks.

## G0 evidence and remediation

Submit a small change with an explanation, a validated JSON exercise, an async cancellation trace, and an independently checked table test. The instructor assesses each separately. A learner who can write loops but cannot distinguish missing from zero needs targeted F04 practice, not a repeat of all programming instruction.

Delayed transfer: after Chapter 04, replace a spending record with a sensor reading. Which foundations remain unchanged? The answer should include explicit units, missing values, runtime validation, cancellation, and an independent expected result—not accounting terminology.

## Summary and retrieval practice

- Static types explain trusted program values; runtime checks establish whether external values deserve that trust.
- Paths, source identities, and permissions are different concerns.
- Partial output, valid emptiness, failure, and cancellation are different outcomes.
- Tests require independent expectations and controlled inputs.

Without looking back: why can valid JSON still be invalid input? Why can a join change a sum? Why does `await` not make cancellation automatic? Which claim can you make after reading source, and which requires actually running its test?

References: [BW01](../references.md#bw01), [BW05](../references.md#bw05), [BW08](../references.md#bw08), [BW26](../references.md#bw26), [P09](../references.md#p09).
