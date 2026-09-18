# Working Glossary

[Contents](../manuscript.md) · [Foundation bridge](00-foundation-bridge.md)

These definitions describe this course's usage. Reconstruct an example for each term; memorizing the sentence alone is not mastery.

## Programming and interfaces

| Term | Meaning | First use |
| --- | --- | --- |
| Module | A named unit of code with explicit imports and exports | F01 |
| Dependency / lockfile | Separately supplied code / recorded dependency resolution | F01 |
| Static type | A checker-visible description of program values; not runtime validation | F01 |
| Runtime validation | Checking actual input values before treating them as trusted application data | F02 |
| Schema | A structural contract; domain rules and permissions can require additional checks | F02, 03 |
| JSON | A data format with objects, arrays, strings, numbers, booleans, and null | F02 |
| HTTP | A request/response protocol; successful transport does not imply valid business data | F02 |
| Promise / await | An eventual result / syntax for waiting within asynchronous code | F03 |
| Async iterable | A sequence whose elements become available over time | F03, 03 |
| Cancellation | A request to stop work; participating operations must cooperate or be controlled separately | F03, 12 |
| Fixture | Controlled test input or a synthetic dependency | F04 |
| Oracle | An independently justified expected result | F04, 14 |
| Regression test | A check preserving behavior that a change must not break | F04 |

## Models and execution

| Term | Meaning | First use |
| --- | --- | --- |
| Model | A system producing predictions/responses from supplied context | 02 |
| Token | A model/tokenizer processing unit, not necessarily a word or character | 02 |
| Context window | A bounded capacity for a model request and relevant output allocation | 02 |
| Training / inference | Changing model parameters / using a model to produce a result | 02 |
| Prompt | Instructions and information shaping a candidate response | 02 |
| Structured output | Output constrained to a representation such as a schema; not a truth guarantee | 02 |
| Hallucination | Plausible generated content lacking the required factual support | 02 |
| Provider adapter | A boundary translating an external model protocol into the application's contract | 03 |
| Tool | An executable capability with structured inputs, outputs, and failure behavior | 03, 06 |
| Observation | The result or failure returned from an action to inform the next decision | 03 |
| Agent | A bounded system using model decisions, tools, context, and feedback to pursue a task | 01, 04 |
| Agent Loop | The execution cycle coordinating model calls, permitted actions, observations, and stopping | 04 |
| ReAct | An interleaved reasoning/action/observation pattern; private reasoning is not assessment evidence | 05 |
| Workflow | An explicitly designed arrangement of stages and transitions; may contain agent loops | 01, 05 |
| Harness | This course's term for runtime and surrounding context, access, lifecycle, observability, and evaluation controls | 11 |

## Context and reusable capabilities

| Term | Meaning | First use |
| --- | --- | --- |
| MCP | Model Context Protocol: a connection protocol, not a permission policy or agent engine | 07 |
| Host / client / server | Application owning coordination/policy / connection participant / capability provider | 07 |
| Discovery | Learning which capabilities a server advertises; not granting their use | 07 |
| RAG | Retrieval-augmented generation: select external information to support generation | 08 |
| Chunk / locator | A retrievable piece / an address within its source | 08 |
| Lexical retrieval | Retrieval based on words/tokens and related ranking signals | 08 |
| Embedding | A learned numeric representation used for similarity and other tasks | 08 |
| Recall@k | Relevant items in the top-k results divided by all labeled relevant items for the query | 08 |
| Precision@k | Relevant items divided by returned items in the evaluated top-k prefix | 08 |
| Knowledge | Reference material such as policies, workbooks, and documents | 09 |
| Memory | Retained collaboration context with scope, provenance, and lifecycle | 09 |
| Context snapshot | A recorded set of resolved inputs/settings for one execution; not automatic present-day permission | 09, 11 |
| Skill | A reusable working method with instructions and possibly scripts/resources | 10 |
| Expert | A configured role and method/capability preset, not necessarily another process | 10 |

## State, authority, and deliverables

| Term | Meaning | First use |
| --- | --- | --- |
| Workspace | Long-lived work context | 12 |
| Task | Work the user wants accomplished | 12 |
| Session | Ongoing collaboration context | 12 |
| Run | One execution attempt with stable identity and terminal outcome | 03, 12 |
| Step | A persistable unit of work within a larger execution/process | 12 |
| ToolCall | One atomic requested tool operation with its own identity | 03 |
| Evidence | Traceable support tied to a source identity/revision and locator | 08 |
| Claim | A proposition whose support can be inspected independently of its phrasing | 08 |
| Artifact / version | A usable work output / an identified state of that output | 15 |
| Notification | A traceable operation-result notice; not the authoritative run state | 12 |
| Checkpoint | A durable decision/progress record with an identified subject and owner | 12 |
| Idempotency | Repetition under the same logical identity preserves the intended effect | 12 |
| Transaction | A group of database operations committed or rolled back together | 12 |
| Prompt injection | Untrusted content attempting to redirect instructions or privileged behavior | 11 |
| Least privilege | Grant only the capabilities and resource scope needed for the task | 11 |
| Provenance / lineage | Where information came from / how inputs and versions contributed to an output | 08, 15 |

## Data and documents

| Term | Meaning | First use |
| --- | --- | --- |
| Grain | What one table row represents | F04, 14 |
| Key / join cardinality | A row identifier / the number of matches allowed between related rows | F04, 14 |
| Minor unit | A currency's smaller exact unit under a defined currency convention | F04, 14 |
| Budget | An agreed comparison amount, not another spending transaction | F04 |
| Deviation | Actual minus budget under this course's fixture definition | 06, 14 |
| Reconciliation | Accounting for totals and record counts across a transformation | 14 |
| Formula cache | A stored formula result; not proof of fresh recalculation | 14 |
| Content model | A format-independent representation of reviewed document meaning | 15 |
| Renderer | A deterministic transformation from a content model to a document format | 15 |
| Native editability | Required text/tables remain editable Office objects, not full-page images | 15–16 |
| Structural validation | Checks on package/content structure; does not establish visible layout quality | 15–16 |
| Visual QA | Inspection for legibility, clipping, overlap, and communication at the intended viewing size | 15–16 |

## Three distinctions to keep returning to

1. **Selected → read → cited → supported:** none of these facts automatically implies the next.
2. **Requested → authorized → executed → completed → accepted:** model intent is not evidence of an effect or a usable result.
3. **Planned → authored → tested → piloted → published:** generating chapter text is not completing a teaching release.
