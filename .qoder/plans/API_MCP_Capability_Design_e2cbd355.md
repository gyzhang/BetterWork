# API Tools and Remote MCP Capability Design

## Status and authorization
- Design baseline: `main` at `7f78515`, inspected on 2026-09-20. The working tree was clean.
- Confirmed by the user: curated API integrations; retain stdio and add Streamable HTTP with static credentials; defer custom HTTP tools, OAuth, and legacy HTTP+SSE.
- The detailed decisions below are proposed for design review, not claims of implemented functionality.
- **No product implementation is authorized.** Confirmation of this design alone must not trigger source changes, migrations, dependency changes, application startup, commits, or deployment. The user will give a separate development instruction.
- Existing A/B0/E acceptance tasks continue independently and retain their current statuses.

## 1. Product outcome and scope

BetterWork should let a user configure a service once, select its capabilities for an Expert, adjust those choices for a Task, and see exactly what each Run actually used.

Target users are the creator and nearby colleagues doing research, analysis, and document preparation. This is a personal desktop workbench, not a multi-tenant integration platform.

| Priority | Module | User outcome |
| --- | --- | --- |
| P0 | API services | Configure named service accounts and select the intended account for each Expert. |
| P0 | Credentials | Replace or clear credentials safely without exposing stored values or losing configuration. |
| P0 | Remote MCP | Connect an explicitly configured remote service, discover tools, and authorize specific read-only tools. |
| P0 | Expert/Task integration | Understand selected capabilities, missing prerequisites, configuration changes, and the effective Run configuration. |
| P0 | Lifecycle and provenance | Cancellation, revocation, restart, and historical attribution remain explainable. |

Release success criteria: all acceptance cases in §11 pass; one real Baidu integration and one real Streamable HTTP MCP service complete the documented user journey; no managed credential values appear in r
[ai-coding: truncated for UI, totalLength=38409]