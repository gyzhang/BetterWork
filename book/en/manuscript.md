# Practical Agent Design and Development

> From a small program to a reliable, evidence-grounded application.

**First manuscript draft · English edition**

## Preface: the answer is not the whole product

Imagine a student-club treasurer who receives three spreadsheets and must explain why spending changed. An assistant produces a convincing paragraph: expenditure rose because membership grew. The sentence sounds useful. Unfortunately, the spreadsheets contain no membership figures, one project has been counted twice, and the presentation cannot be edited. Has the assistant completed the task?

Now imagine a research team comparing ways to organize its reference materials. An assistant retrieves a relevant page, follows an instruction embedded in it, and reads a file the team never selected. Its final recommendation may be sensible, but the application has crossed its authority boundary. Good prose does not repair that failure.

These are software-engineering problems as well as model-behavior problems. A useful agent must decide what information to seek, execute permitted actions, inspect observations, and stop. Around that cycle, an application must preserve identity, validate data, control access, make failures visible, and deliver usable work. This book teaches that complete responsibility without requiring prior knowledge of machine learning, accounting, React, or Electron.

Our starting point is modest: you can explain a function, a loop, and a conditional. Module 00 bridges the remaining programming foundations. If you already build software, demonstrate those foundations and move ahead. You still complete the same core chapters and independent assessments.

The book follows two continuing cases. In **Case A**, a campus team researches a proposal and produces source-grounded documents. In **Case B**, a club analyzes synthetic ledger and project exports, produces a management report, and repeats it for a new period. Departmental variants change vocabulary and constraints, not the standard of evidence. Neither case authorizes decisions about real customers, equipment, money transfers, or production systems.

## How the book is organized

The sequence moves from explanation to tracing, modification, implementation, evaluation, and transfer. Each chapter begins with a problem and a learning contract, explains a mechanism, works through concrete inputs and outputs, and ends with deliberate failures and independent practice. Do not skip the failures: the first successful response tells you much less than an intentionally rejected action.

| Part | Read in order |
| --- | --- |
| Foundations | [Module 00: Programming, interfaces, async work, and data](foundations/00-foundation-bridge.md) · [Glossary](foundations/glossary.md) |
| I. First agent | [01. Specify a useful task](chapters/01-useful-tasks.md) · [02. Models and prompts](chapters/02-models-and-prompts.md) · [03. One tool exchange](chapters/03-one-tool-exchange.md) · [04. The Agent Loop](chapters/04-agent-loop.md) · [05. ReAct and workflows](chapters/05-react-and-workflows.md) |
| II. Capabilities and context | [06. Deterministic tools](chapters/06-deterministic-tools.md) · [07. MCP](chapters/07-mcp.md) · [08. Retrieval](chapters/08-retrieval.md) · [09. Context and memory](chapters/09-context-and-memory.md) · [10. Skills and experts](chapters/10-skills-and-experts.md) |
| III. Harness engineering | [11. Trust boundaries](chapters/11-harness-boundaries.md) · [12. Lifecycle and persistence](chapters/12-lifecycle-and-persistence.md) · [13. Evaluation and budgets](chapters/13-evaluation-and-budgets.md) |
| IV. Data and documents | [14. Excel analysis](chapters/14-excel-analysis.md) · [15. Markdown and Word](chapters/15-markdown-and-word.md) · [16. Editable PowerPoint](chapters/16-editable-powerpoint.md) |
| V. Integrated cases | [17. Research to proposal](chapters/17-research-capstone.md) · [18. Repeat-period reporting](chapters/18-operations-capstone.md) |
| VI. Delivery | [19. Packaging and platform transfer](chapters/19-delivery-and-transfer.md) · [20. Independent assessment](chapters/20-independent-assessment.md) |
| Supporting material | [Lab companion](lab-guides/README.md) · [Instructor notes](instructor/teaching-notes.md) · [References and license](references.md) · [Draft evidence and release work](draft-status.md) |

The [curriculum](curriculum.md) owns chapter numbering and prerequisites. The [assessment specification](labs-and-assessment.md) owns the final acceptance standard. This manuscript supplies the narrative and worked practice for those requirements.

## The reference implementation and its license

All implementation excerpts labeled **BetterWork source** come directly from **Kevin Zhang's BetterWork GitHub repository, <https://github.com/gyzhang/BetterWork>**, an **MIT-licensed open-source project**. The reference revision for this draft is `2d8a79f4e4c52b9a5c44e3f024064ab5b9db7d0b`. The [source register](references.md) provides revision-pinned GitHub links, local navigation, and the full MIT notice: **Copyright (c) 2026 Kevin Zhang**.

The excerpts are intentionally small. Their enclosing files contain imports, surrounding checks, and integration details omitted from the printed fragment. A fragment is not advertised as a standalone runnable application. Read its source and associated tests together. Preserve the copyright and permission notice when copying or distributing copies or substantial portions of the software.

BetterWork is a reference application, not the ceiling of the course. A reference can demonstrate a bounded loop without providing every teaching adapter. We distinguish three kinds of material:

- **BetterWork source:** an actual excerpt or source walkthrough at the pinned revision.
- **Worked example:** synthetic inputs and explicitly derived expected results, not an observation from a live model or customer deployment.
- **Teaching design / pseudocode:** a mechanism to implement and test in the isolated laboratory, not an existing BetterWork API.

In particular, workbook parsing is not a complete analysis pipeline, Office-file registration is not document generation, and an embedding configuration is not a measured embedding retriever. Required Word generation and embedding exercises remain required even where additional teaching infrastructure must be prepared.

## How to study and use assistance

Before reading a worked result, predict it. After reading it, close the page and reconstruct the important decision. During practice, explain which part you changed and why its test would fail before the change. After a few chapters, revisit the idea in a different scenario without copying the earlier solution.

You may use coding assistants. Record what they supplied, what you verified, and what you can explain independently. An assistant can accelerate implementation; it cannot serve as your independent numeric oracle, supply evidence for a source it never read, or take your final teach-back.

Keep four questions visible throughout the book:

1. What exactly is the system permitted to do?
2. What evidence supports this result?
3. What happens if this step fails or is interrupted?
4. Could another person reproduce and revise the delivered work?

## What this draft does and does not claim

The manuscript covers Module 00 and all twenty chapters. It includes paper exercises, source-reading exercises, lab instructions, synthetic worked data, and assessment guidance. Existing reference tests are identified separately from exercises that require teaching assets.

This is not yet a lab-ready or publication-ready release. No learner pilot, fresh-environment course handoff, live-model evaluation, or Office editability review is implied by the prose. The exact verification performed and the remaining author-owned work appear in [draft status](draft-status.md). Missing assets are the author's responsibility, not an excuse to lower a learner's exit standard.

Start with [Module 00](foundations/00-foundation-bridge.md), or demonstrate its four exits and continue to [Chapter 01](chapters/01-useful-tasks.md).
