# API and MCP Capability Contracts

- Version: v1.0, 2026-09-20.
- Status: proposed implementation contracts, adopted as documentation only. No fields, tables, IPC handlers, or runtime behavior below have been added by this task.
- Product authority: [API tools and remote MCP design](../designs/api-tools-and-remote-mcp.md).
- Decisions: [ADR-0024](../adr/0024-api-services-and-credentials.md) and [ADR-0025](../adr/0025-remote-mcp-and-capability-bindings.md), both Proposed.
- Existing contracts: [Expert/Task](expert-contracts.md), [materials](material-contracts.md), and [Skill execution](contracts.md).

## 1. Invariants and ownership

1. API tools, MCP tools, and Skills are separate capability categories resolved into the existing Agent execution boundary.
2. Renderer chooses configuration references, not authority. Main validates configuration, ownership, live enablement/revocation, and Run membership before dispatch.
3. ExpertRevision is an immutable preset; TaskContextRevision is an explicit task selection; RunContextSnapshot records the resolved execution configuration.
4. Skill execution continues through existing `RunSkillBinding`. Do not rename or collapse the existing Skill `CapabilityBinding` into a generic execution table.
5. API service profiles, MCP connections, and model profiles remain separate aggregates. A common credential service protects their secrets.
6. Stable object IDs do not identify a configuration revision. Foreign keys and service validation must check that a revision belongs to the referenced identity.
7. All new Run bindings are concrete. Defaults and unresolved selections are legal draft states, never executable bindings.
8. No new secret value is returned by read/list APIs, included in a model-visible argument, or copied into a Run snapshot. Secret values are resolved in Main only.
9. Network/crypto preparation occurs outside SQLite transactions. Recheck revocation and revisions after asynchronous work and before committing/dispatching.
10. Revocation overrides an immutable snapshot. It prevents future dispatch and cancels affected active Runs; it does not erase history.

## 2. API contracts

The names below are the shared contract vocabulary for later implementation. Shared public schemas belong in `packages/agent-protocol/src/index.ts`; the private credential record does not become a Renderer read DTO.

### 2.1 Definitions, profiles, and defaults

| Contract | Fields and constraints |
| --- | --- |
| `ApiToolDefinition` | `toolId`, `name`, `description`, `inputSchema`, `outputSchema`, `readOnly`, `providerIds`. Definitions/adapters are supplied by reviewed product code, not arbitrary user JSON. |
| `ApiServiceProfile` | `id`, `lifecycle` (`enabled/disabled/archived`), `currentRevisionId`, `createdAt`, `updatedAt`. Creation is disabled; no network request is implicit. |
| `ApiServiceProfileRevision` | `id`, `profileId`, positive `revision`, `name`, `providerId`, adapter-validated `options`, optional `credentialId`, `createdAt`. Revision content is immutable. |
| `ApiToolDefault` | `toolId`, `profileId`, concurrency revision. Zero or one mapping per tool. Resolve the profile's current revision when creating a new draft. |

IDs are opaque, nonempty host-assigned identifiers. Use the existing millisecond timestamp convention and omit unavailable optional fields in public responses rather than inventing values.

First adapter: `baidu_qianfan`; first API tool: `web_search`; options: `webTopK`, integer 1–20/default 10. Endpoint and Bearer authentication are adapter-owned. Users cannot override endpoint, request construction, or response parsing through `options`.

One Run selects at most one profile per `toolId`. Multiple enabled profiles, including profiles of the same provider, are legal. A default is not another enablement mechanism. Setting a default validates provider/tool compatibility; disabling a selected default blocks its use rather than choosing another profile. Archiving clears the default mapping.

### 2.2 Preset and task selections

Logical shape:

```ts
type ApiServiceSelection =
  | { mode: 'application-default' }
  | { mode: 'profile'; profileId: string; profileRevisionId: string };

interface ApiToolBinding {
  toolId: string;
  service: ApiServiceSelection;
}

interface TaskApiToolBinding extends ApiToolBinding {
  source: 'expert-preset' | 'task-selection' | 'application-default';
}
```

- Expert presets may use either selection mode. Task draft creation resolves available defaults to `profile` references exactly once.
- A default that cannot resolve stays as an unresolved `application-default` draft selection. Only an explicit repair/reselection resolves it later; send does not substitute a newly available account silently.
- Selecting a profile requires a revision belonging to that profile and an adapter supporting the tool. Missing/deleted/disabled references can remain visible in an existing draft but cannot execute.
- Duplicate `toolId` selections are rejected. New `apiToolBindings: []` means explicitly none; absence is reserved for versioned legacy interpretation.
- Ordinary new tasks materialize currently configured API defaults. With no defaults, the result is `[]` and local conversation remains legal.
- Task category selections replace copied presets. Saving or sending does not union removed entries back into the task.
- New native-tool policies do not include `web_search`; its selection is owned by `apiToolBindings`. Preserve `web_fetch` and the existing native readers/calculators in the built-in policy. Legacy projection is specified in §10.

## 3. MCP contracts

### 3.1 Configuration identity and revisions

Preserve the existing connection ID. Separate mutable lifecycle/current-revision metadata from immutable `McpConnectionRevision` content: `id`, `connectionId`, positive `revision`, `name`, `transport`, and `createdAt`.

The target lifecycle vocabulary is `enabled/disabled/archived`; lifecycle is independent of discovery/test status. New MCP connections start disabled and untested; testing/review does not enable them. An ordinary edit appends a revision and does not close an active Run's client. Archived identities remain available for historical attribution.

Proposed transport vocabulary:

```ts
type McpAuthentication =
  | { mode: 'none' }
  | { mode: 'bearer'; credentialId?: string }
  | { mode: 'api-key-header'; headerName: string; credentialId?: string };

type McpTransport =
  | {
      kind: 'stdio';
      command: string;
      args: string[];
      cwd?: string;
      envBindings: { name: string; credentialId: string }[];
    }
  | {
      kind: 'streamable-http';
      endpoint: string;
      networkMode: 'public' | 'private' | 'loopback';
      authentication: McpAuthentication;
    };
```

Missing credentials make a draft incomplete, not implicitly anonymous. `none` is an explicit mode. stdio mappings have unique valid environment variable names and owner-validated credential slots; they carry references, never secret values. Keep the minimal executable runtime environment, not the whole parent environment. Do not support secret values in command arguments.

Network validation:
- `public` permits only public HTTPS destinations; `private` requires explicit confirmation and HTTPS for the exact configured host/port; `loopback` requires explicit confirmation and a literal loopback address and may use HTTP.
- All modes reject URL user-info, query parameters, fragments, and redirects. TLS certificate verification cannot be disabled.
- Validate DNS and the actual socket destination, including IPv6/mapped forms. Reject link-local/metadata, multicast, unspecified, and out-of-mode addresses. There must be no unchecked second DNS resolution.
- Apply the policy to every transport operation, including SSE and session termination. Do not relax public `web_fetch` restrictions.
- Header names must be valid HTTP tokens. Reject CR/LF, cookies, and overrides of transport-controlled Host, Content-Length, Content-Type, Accept, Authorization, and MCP protocol/session headers. Bearer mode owns Authorization.

### 3.2 Tool identity and review

Extend `McpToolBinding` with:
- `connectionId` and `connectionRevisionId`;
- existing stable `toolId`;
- reviewed `contractHash`.

The connection revision must belong to the identity, and the tool must belong to that connection. A task's tools for one connection use one configuration revision; mixed revisions for one connection are rejected rather than creating ambiguous model aliases.

Compute the contract hash from deterministic canonical JSON of the tool's description, input/output schemas, and advertised annotations. Object-key order is irrelevant; meaningful schema/description/annotation changes invalidate review. A review record identifies connection revision, tool ID, contract hash, and confirmation time. It is not a general-purpose approval engine.

New tools are unreviewed and unselected. Explicit user review is required for read-only suitability; advertised destructive/non-read-only tools are unavailable. Missing annotations are not proof of safety. Compile/check schemas locally and do not resolve remote Schema references.

Keep the last successful catalog on discovery failure and mark it stale. Fresh discovery before each connection's first use in a Run must match selected reviewed contracts. A stale catalog alone cannot authorize a call.

Existing maximum selection count remains 50 MCP tools. Duplicate connection/tool pairs are rejected. New `mcpToolBindings: []` means none, not inherit from Expert.

## 4. Credential contracts

`CredentialRecord` is private to Main/persistence. Its logical fields are `id`, `ownerKind` (`api-service-profile/mcp-connection/model-profile`), `ownerId`, `slot`, optional `ciphertext`, nonsecret `version`, and timestamps. A cleared record can retain identity/version metadata without a usable secret.

- API/model owners have their API-key slot; MCP supports its selected HTTP credential or named stdio environment slots.
- A credential reference must belong to the consumer's owner and slot. A guessed credential ID from another configuration is rejected.
- Store ciphertext in SQLite using the Main-owned, injectable asynchronous safeStorage adapter. Profile/revision/Run read responses never include ciphertext.
- Public credential status contains only reference/version metadata and `configured`/availability information. There is no read-secret operation.

Write-only mutation vocabulary:

```ts
type CredentialMutation =
  | { action: 'keep' }
  | { action: 'replace'; value: string }
  | { action: 'clear' };
```

Empty editor input is normalized to `keep`, not `replace` or `clear`. Replacement must provide a nonempty value. Clear is an explicit action. Renderer-held new values are transient and cleared on save/cancel; no localStorage persistence.

Secret replacement/clear checks the expected credential version, increments that version, and cancels Runs using the prior version. Do not keep decryptable old secrets for replay. Future Runs may use the current credential version for a pinned nonsecret configuration; the Run records that exact version without the secret value.

Before broadcasting/persisting diagnostics or delivering external output to the model, sanitize errors, progress, and any managed-secret echoes. Do not serialize raw causes, HTTP headers, MCP session IDs, or child environments. Main-only secret access is not permission to log it.

Locked/unavailable protected storage produces `credential_unavailable`. Incomplete legacy conversion produces `credential_migration_required`; neither permits a plaintext fallback. Local history and credential-free operations remain available. At-rest encryption is not protection against a compromised host/native script and cannot erase prior backups.

## 5. Operations and IPC boundary

These are logical operation names for the shared protocol. They do not establish a second IPC implementation or a direct Renderer-to-service path. Implement channels and schemas only in the existing protocol entry and register them through existing IPC helpers when separately authorized.

| Operation group | Input and behavior | Result |
| --- | --- | --- |
| API definitions: list | No secret input | Reviewed descriptors and supported providers |
| API profiles: list/get | Profile ID for get; include archived only explicitly | Nonsecret current/history metadata plus availability |
| API profiles: create/saveRevision | Validated draft; expected revision for an existing profile; owner-scoped credential mutations | Saved identity/revision; create is disabled/untested |
| API profiles: duplicate | Source identity/revision and optional name | Independent disabled profile; no credential/default |
| API profiles: setLifecycle/remove | Identity, expected revision, selected lifecycle; removal is archive | Result plus affected-reference information; safety cancellation when applicable |
| API defaults: set/unset | Tool ID, optional profile ID, expected default revision | One mapping or none; no task-history edits |
| API/MCP tests: test | Request ID and saved revision or unsaved draft; transient credential mutation if testing a draft | Sanitized test/discovery result correlated to request and tested configuration |
| API/MCP tests: cancelTest | Request ID owned by the originating operation | Idempotent cancellation acknowledgment; no unrelated client shutdown |
| MCP: list/get/save | Reuse existing boundary; save includes versioned transport and expected revision | Nonsecret configuration/revision and availability |
| MCP: setLifecycle/remove | Identity, expected revision; remove archives referenced identity | Safety cancellation and visible invalid historical selections |
| MCP: reviewToolContract | Connection revision, tool ID, expected contract hash, explicit read-only confirmation | Review for that exact contract only |
| Task context: save/read | Extend existing revision/CAS operations with API bindings and versioned MCP selections | Explicit category selections plus host-derived availability |

Mutations of existing objects require expected revisions/versions; creation has no existing revision to claim. Unknown fields, invalid modes, ownership mismatches, duplicate selections, and incompatible providers are rejected at the boundary. A conflicting save preserves the local draft.

A profile/connection test is not a Task, Run, or Evidence. A saved-revision test may update only diagnostics for that tested revision. An unsaved-draft test cannot save credentials, configuration, enablement, defaults, or durable tool reviews. Cancellation/stale responses do not overwrite a newer result or revision. Tests may run without enabling a saved configuration, but execution requires enablement.

Credential fields appear only in write/test requests to the owning configuration. Read/list/notification payloads return statuses, not values. The host's availability resolver serves Expert details, task repair UI, and send-time validation so they cannot disagree through separate rules.

## 6. Availability and failures

| Dimension | Values | Interpretation |
| --- | --- | --- |
| Configuration | valid / incomplete | Required fields and references are present |
| Lifecycle | enabled / disabled / archived | User-controlled ability to start execution |
| Credential | not-required / missing / available / unavailable | Missing and protected-store failure are distinct |
| Connection | untested / testing / connected / failed / disconnected | Past test result is not authority or a guarantee |
| MCP contract | unreviewed / approved / changed / missing | Review is tied to the selected revision and hash |

`CapabilityAvailability` identifies the category, selected identity/revision, these applicable dimensions, and actionable reasons. Derive readiness from the selected revision, not an unrelated current profile/connection. API `untested` is a warning when configuration, credentials, and enablement are valid. MCP requires reviewed contracts and execution-time discovery.

| Code | Trigger / repair |
| --- | --- |
| `api_profile_missing`, `api_profile_disabled` | Select or enable the intended profile; no automatic substitution |
| `credential_missing`, `credential_unavailable`, `credential_migration_required` | Enter a secret, unlock/retry protected storage, or complete migration |
| `capability_revision_conflict` | Reload/apply a revision; retain the draft |
| `mcp_tool_missing`, `mcp_contract_changed`, `mcp_tool_not_approved` | Discover/review/reselect the exact tool |
| `endpoint_not_allowed`, `redirect_not_allowed`, `tls_failed` | Correct destination/network/trust settings |
| `authentication_failed`, `authorization_denied`, `oauth_required` | Correct credentials/account rights or choose a supported service |
| `rate_limited`, `connection_timeout`, `tool_timeout`, `result_too_large` | Explain the boundary and provide an explicit retry path |

Keep existing ownership, invalid-input, Skill, model, and task-context errors where applicable; do not repurpose them into generic credential or network failures. Return a safe message, code, and repair target. Reuse current inline/toast/notification routing and the existing cancellation vocabulary.

## 7. Run resolution and execution

### 7.1 Preparation order

1. Validate Task/Session/Workspace ownership, expected task revision, and fixed Expert identity.
2. Read task selections, including explicit empty arrays. Never infer authorization from prompt text, past calls, Skill text, or remote descriptions.
3. Validate profile/connection revision ownership, live lifecycle, credential availability, MCP review, and existing Skill trust/dependencies.
4. Resolve credentials in Main. Report configuration blockers before any model request or business tool dispatch; do not remove unavailable explicit selections and continue.
5. Perform cancelable MCP initialization/discovery outside SQLite transactions. If a Run already exists and preparation fails, give it exactly one failed/cancelled terminal event and make no model request.
6. Recheck relevant revisions/credential versions/revocation after asynchronous preparation. Commit concrete resolved bindings atomically before model execution. Incomplete preparation cannot become a successful binding set.
7. Build the existing AgentTool list and invoke the existing Agent Core. Keep provider/MCP/credential services out of Core and Renderer.

A newer ordinary configuration revision does not invalidate a deliberately pinned older revision; rechecks verify ownership, completeness, and live revocation rather than silently switching to current.

### 7.2 Run binding metadata

`RunToolBinding` records the concrete API/MCP execution selection:
- host-generated binding ID and `runId`;
- capability kind (`api-tool/mcp-tool`), stable tool identity, and model-visible alias;
- API profile/revision or MCP connection/revision, as a discriminated reference;
- input/contract identity hash and nonsecret credential reference/version metadata;
- credential metadata as a collection where a stdio connection has multiple secret slots.

Existing `RunSkillBinding` stays authoritative for Skill execution; native helpers retain the built-in policy snapshot. Model credential resolution also retains the credential version in Main-side Run metadata for rotation cancellation, without changing the model's role/default contract.

Associate each tool call with its binding by stored IDs and existing tool-call correlation. Never parse a model alias to authorize a request. API names remain stable (`web_search`). MCP aliases are deterministic from the full connection/tool identity, no longer than 64 characters, with collision rejection and a persisted reverse mapping.

At every dispatch, validate binding membership in the Run and current revocation. Model arguments cannot select credentials, another service profile, or an arbitrary endpoint. API input and MCP discovered schemas are validated before transport; external output is bounded and sanitized before event/model delivery.

### 7.3 Lifecycle and context

| Action | Active Runs | Future Runs / history |
| --- | --- | --- |
| Save nonsecret configuration revision | Continue on pinned revision | Explicit update applies new revision; old attribution remains |
| Change application default | Unchanged | Only new drafts resolve the new default |
| Disable/archive profile or connection | Cancel affected Runs once | Block new use; keep referenced metadata |
| Replace/clear credential | Cancel old-version users once | New version or explicit missing/unavailable error |
| Cancel one Run or test | Cancel only its owned operation/client | No unrelated shutdown; ignore late output |
| Remove/replace task API/MCP/Skill selection | Current Run cannot be hot-edited | New context segment for next Run; preserve historical UI |

Each Run owns its MCP clients; same-connection tools in that Run share one client. Other Runs/tests use separate clients. Close them on terminal cleanup/application exit. Attempt remote session termination where supported and retain stdio supervisor cleanup semantics. MCP session identifiers are transient and distinct from BetterWork Session IDs.

Handle HTTP session expiry by invalidation/reinitialization without replaying uncertain `tools/call`. Fail uncertain calls with an explicit retry path. A bounded SSE response resume may retrieve the original result without reposting the call; the original deadline/cancellation still applies. Do not retry business calls automatically for timeout, 401/403/429, or disconnect. Cancellation cannot promise remote rollback or charge reversal.

When a capability removal/replacement starts a new context segment, retain the current user request and explicitly selected materials, not old-segment assistant/tool content. Explicit category replacement is not an instruction to copy an old preset back in. Previously transmitted content cannot be recalled.

## 8. Runtime limits

| Boundary | First-release value |
| --- | --- |
| Baidu API call | Existing 20-second hard deadline |
| MCP connect | 10 seconds |
| Complete MCP discovery, including pages | 30 seconds |
| Individual MCP tool call | 60 seconds |
| Discovered tools | Maximum 200 per connection catalog |
| Selected MCP tools | Existing maximum 50 |
| Decoded HTTP message or SSE event | Maximum 1 MiB each |
| Usable MCP result | Existing 100,000-character maximum for text and serialized structured output |
| Skills | Existing maximum six ordered bindings |
| API account selection | At most one profile per API tool per Run |
| MCP model-visible alias | Maximum 64 characters |

Progress cannot reset hard deadlines. Enforce byte limits while receiving/decoding before unbounded parsing/accumulation, and character limits before model/event delivery. Bound schema/catalog accumulation by the message and tool limits. Reject remote JSON Schema references rather than fetching them. Test size, timeout, cancellation, and stale-result paths with injectable adapters.

## 9. Provenance and local diagnostics

Baidu search retains `web-page` Evidence; MCP retains `mcp-tool` Evidence. Connect new successful results/Evidence to exact Run bindings and tool calls. Preserve old source URIs; do not retroactively translate aliases into invented historical accounts.

Only successful accepted results become Evidence; canceled late output and configuration tests do not. Reuse existing Artifact-version relations without equating source material with verified facts or sentence-level Citation.

Local diagnostic records contain capability binding, request correlation, duration, outcome code, and sanitized failure category. They exclude raw credentials, headers, child environments, session IDs, and unnecessary business content. No external analytics or general-purpose new logging platform is required.

## 10. Migration and recovery

### 10.1 Schema and data responsibilities

Use sequential versioned schema migrations, with real SQLite foreign-key/ownership checks and rollback tests. Recheck the actual migration baseline when implementation begins; this document reserves no numeric schema version.

Logical storage additions are API identities/revisions/defaults, credential ciphertext/metadata and migration progress, MCP revisions/reviews/catalog metadata, and Run tool-binding references. Physical migrations must keep parent identity → revision → selection/Run binding → call/Evidence references consistent. Do not collapse model/API/MCP configurations or existing Skill execution tables.

Search conversion creates one API profile/initial revision per legacy provider row, preserves options and enablement, and maps the formerly enabled provider to the search default. Persist an idempotent legacy-provider mapping. Model conversion preserves profile IDs, roles, defaults, and Expert references.

### 10.2 Protected-secret conversion

1. Apply schema changes without assuming Keychain availability and keep credential-backed dispatch blocked for unconverted owners.
2. After protected storage is available, run a journaled, versioned conversion with per-owner pending/completed/failed status; the journal contains no secret values.
3. Read the owner's expected version, encrypt through the injectable adapter, and verify decryption round-trip outside the SQLite transaction.
4. In one transaction, recheck the owner/version, attach the ciphertext reference, clear the corresponding live plaintext value, and mark that owner complete.
5. A crash before commit leaves the owner pending and recoverable; a conflict retries from current state rather than overwriting it. A committed owner is not duplicated on restart.
6. On encryption/decryption failure, preserve recoverability, show `credential_migration_required`, and refuse plaintext fallback. History/local operations remain usable.
7. Runtime reads switch to the new authority. Do not continue dual writes to legacy credential columns or maintain a second authoritative secret store.

Do not claim secure erasure of old database pages, WAL, external backups, or user-held originals. Database restoration can require credential re-entry. Test Keychain access across development/signed/upgrade conditions separately; declarations are not acceptance evidence.

### 10.3 Expert, task, and historical compatibility

| Legacy state | Forward interpretation |
| --- | --- |
| Expert explicitly excludes `web_search` | API search remains excluded |
| Expert explicitly selects `web_search` | Compatibility projection produces an application-default search reference |
| Expert uses old application-default tools | New task draft materializes currently available API defaults |
| Existing Task has no API field | Next capability edit/send creates a new visible context revision through the compatibility projection |
| Old Run lacks provider/binding metadata | Display not recorded; never infer an account from the current default |
| Existing MCP connection | Preserve identity, create an initial configuration revision, and retain enabled eligibility; new execution still requires contract review |
| Old MCP binding lacks reviewed hash | Keep visible but require one explicit review before new execution |
| New API/MCP arrays are empty | Explicitly none; never inherit/repopulate from Expert |

Never rewrite old ExpertRevision or Run facts. For an existing task, project its explicitly saved native-tool policy first; otherwise use its pinned Expert revision or legacy general defaults, never the current unrelated Expert revision. An explicit task exclusion of `web_search` must stay excluded. Resolve compatibility into a new task context when needed, and remove duplicate `web_search` selection from that new native policy. The old search settings route redirects to API services; no indefinite dual runtime configuration path remains.

Remove archives referenced identities, clears owned credentials/defaults, and retains historical metadata. Preserve Expert, Skill, Task, Session, Run, and Artifact IDs and all existing acceptance evidence.

## 11. Implementation routing and verification

No implementation is scheduled by this document. After a separate instruction, changes follow the existing structure:
- Shared types/Zod/channels: `packages/agent-protocol/src/index.ts`.
- Versioned schema and migration tests: `apps/desktop/src/main/db/`.
- Aggregate repositories: `apps/desktop/src/main/persistence/`.
- Main services/adapters: existing search, MCP, Expert, TaskContext, and Run services; protected storage remains a Main dependency.
- Typed handler registration and preload: existing IPC helpers and minimal preload API.
- Renderer: existing Settings/Experts/task views through hooks, host-derived descriptors, and established feedback components.
- Agent Core: retains the existing engine/interface boundary; it must not import transport, SQLite, or Electron.

Required future verification is the [design acceptance matrix](../designs/api-tools-and-remote-mcp.md#9-acceptance-matrix), including negative isolation/credential cases, real SQLite migrations, cancelable injectable network tests, and user-led real-service acceptance. Automated tests do not use external services. Implementation requires `npm run verify`; documentation-only adoption checks links, consistency, and scope without claiming runtime results.

Old A/B0/E task cards and statuses are not changed or duplicated. Credential storage changes require a coordinated update to the existing engineering standard and applicable guards when implemented; documentation adoption alone does not change the current plaintext implementation.
