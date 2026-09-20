# ADR-0024: API Service Profiles and Protected Credentials

- Status: Proposed; design recorded on 2026-09-20. No product implementation is authorized by this record.
- Scope: curated API integrations, service-account selection, and Main-owned credential protection for API, MCP, and model configurations.
- Product design: [API tools and remote MCP](../designs/api-tools-and-remote-mcp.md).
- Contracts: [Capability contracts](../development/capability-contracts.md).
- Proposed replacement: [ADR-0007](0007-search-engine-config-and-web-search-tool.md)'s provider-keyed, globally exclusive enabled selection and plaintext credential storage. Existing search behavior and Evidence remain reusable.
- Related: [ADR-0003](0003-agent-core-boundary.md), [ADR-0014](0014-expert-context-and-material-binding.md), and [ADR-0025](0025-remote-mcp-and-capability-bindings.md).

## Context

The existing search path supports Baidu Qianfan through a built-in `web_search` tool. An Expert can allow that tool, but cannot select a named account/profile. Current search configuration identifies the provider rather than an account, and enabling one configuration disables the others. Search and model keys are currently plaintext SQLite values exposed only to Main; MCP has no managed secret configuration.

The next increment must support multiple accounts, clear Expert/Task selection, and consistent credential handling without building an arbitrary HTTP tool designer or merging unrelated configuration domains.

## Decisions

### 1. Curated operations and named profiles

Maintain separate concepts:
- `ApiToolDefinition`: stable operation and input/output contract.
- Provider adapter: reviewed request construction, endpoint, authentication placement, and result extraction.
- `ApiServiceProfile`: stable local account/configuration identity with lifecycle.
- `ApiServiceProfileRevision`: immutable nonsecret configuration and credential reference.
- `ApiToolBinding`: operation plus selected profile revision.

The first adapter remains `baidu_qianfan` for `web_search`, retaining its fixed HTTPS endpoint, Bearer credential, and `webTopK` range 1–20/default 10. Additional providers require reviewed code and tests but do not require provider-specific configuration tables or independent settings workflows.

Multiple profiles for the same provider are legal. Enablement is independent per profile; one optional default is selected per API tool. Each Run has at most one selected profile per tool. No simultaneous multi-provider search or arbitrary HTTP mapping is added.

### 2. Revision and default semantics

Save, enable, test, and set-default are separate operations. A new profile is disabled and untested. Duplicate copies only nonsecret configuration and carries neither credentials nor a default assignment.

Ordinary edits append an immutable revision; existing task/Run bindings retain their revision. Applying an updated revision is explicit. An Expert may use a specific profile revision or an application-default reference; default references resolve when creating a task draft, not repeatedly while running it.

An unresolved explicitly selected default/profile is a visible blocker, not permission to omit the tool or substitute an account. Ordinary new tasks with no default retain a legal no-API selection. Later default changes affect new drafts only.

### 3. Share credential handling, not configuration tables

Keep API services, MCP connections, and `model_profiles` as separate objects. Introduce one Main-owned credential service, with injectable Electron `safeStorage` protection and SQLite ciphertext/metadata.

Use the asynchronous safeStorage interface available in the installed Electron declarations. Perform encryption/decryption outside long SQLite transactions. Protected-storage failure is explicit and never enables plaintext fallback.

A credential has one owner: API profile, MCP connection/secret slot, or model profile. Reusing credentials across owners is not a user-facing feature. Credentials are not embedded in Expert revisions, task snapshots, Skill packages, model-visible tool arguments, URLs, or process arguments.

The credential store is not a second product configuration truth source: profile and connection metadata remain in their owning aggregates, while SQLite holds the ciphertext and credential references. The OS protects encryption keys.

### 4. Write-only credential mutations

Configuration save operations accept an explicit `keep`, `replace`, or `clear` mutation for each supported credential slot. Empty input means keep; clear is a separate action.

The Renderer may briefly hold a newly typed secret to submit it, then clears it on save/cancel. Never persist it in Renderer storage. List/read responses contain configured/available status and nonsecret references/version counters, not ciphertext or plaintext. Do not expose a secret-read IPC.

Main resolves the credential only for its approved consumer and target. MCP receives neither unrelated model/search credentials nor the whole process environment. Unsaved-draft tests use transient secret input without persisting it or changing active configuration.

### 5. Safety lifecycle and diagnostics

Disable/archive, credential clear, and credential replacement cancel affected active Runs and block use of the old authorization. A replacement increments a nonsecret credential version. New Runs resolve the new value; old secret versions are not retained for replay.

Ordinary nonsecret configuration edits do not interrupt pinned Runs. Remove archives the profile, clears its credential/default assignment, and retains historical metadata after presenting affected objects and Runs.

Sanitize transport errors, progress, test feedback, and echoed managed secrets before model/event/Evidence delivery. Do not serialize raw request headers, transport session IDs, child environments, or raw error causes into ordinary logs or returned diagnostics.

Connection tests have request IDs, cancellation, and stale-result protection. A successful test is not enablement or durable proof of availability. API probes may consume quota and require explicit user action; do not add background polling or paid per-Run probes.

### 6. Migrate search and model keys without changing model behavior

Preserve model profile IDs, roles, defaults, and Expert references. Migrate model API keys into the credential service without redesigning model settings.

Convert legacy search rows into named profiles and initial revisions, preserving options and enablement; the previously enabled profile becomes the default for search. Keep a stable migration mapping for idempotence. Runtime reads then use the new authority, not indefinite dual writes.

Use versioned schema migrations plus a journaled credential data-migration operation after protected storage becomes available. Encrypt and verify round-trip outside the transaction; atomically attach ciphertext references and clear corresponding live plaintext columns with revision checks. Failure preserves recoverability and reports `credential_migration_required`; affected calls cannot fall back to legacy plaintext. See the contracts for ownership, conflict, and historical-interpretation rules.

Do not edit old Expert/Run records to invent provider attribution. Legacy tool policies use an explicit compatibility projection; old Run metadata remains “not recorded.”

## Alternatives and trade-offs

| Alternative | Reason not selected |
| --- | --- |
| One catch-all `external_services` table for models/API/MCP | Conflates distinct contracts, state machines, and update behavior. |
| A separate configuration table/settings workflow for each new API | Repeats account, credential, lifecycle, and readiness behavior. |
| User-defined REST/OpenAPI requests in this release | Requires a larger request-mapping and authorization product outside confirmed scope. |
| Continue plaintext storage or fall back when encryption fails | Makes credential protection conditional and hard to explain. |
| Keychain records as a second authoritative configuration database | Introduces cross-store ownership/recovery complexity; protected SQLite ciphertext keeps application references transactional. |
| Retain old secret values for historical replay | Historical attribution needs metadata, not a usable revoked secret. |
| Resolve defaults or current revisions on every call | Changes a task's destination/account without an explicit selection update. |

The cost is new profile/credential contracts, migration/recovery, and UI repair paths. The benefit is a reusable API capability layer with explicit account selection and consistent security boundaries.

## Security and availability limits

Protected storage does not defend against a compromised host or trusted native scripts. A local plaintext legacy copy may remain when migration fails, but the new runtime must not use it. Successful migration cannot erase old backups or guarantee forensic erasure of old SQLite/WAL pages.

Keychain access may require user interaction. Unsigned and signed builds can have different access behavior; development success does not establish upgrade acceptance. A database restored on another machine may require credential re-entry. History and credential-free operations remain accessible when protected storage is unavailable.

The existing [engineering standard](../12-engineering-standards.md) describes the current plaintext implementation. This proposal does not relabel it as already encrypted. Its storage statement and applicable executable guards change together when implementation is authorized.

## Validation requirements

Use design acceptance cases API-1–API-4, SEC-1–SEC-4, MIG-1, LIFE-1, and END-1. Required coverage includes two profiles of one provider, default pinning, draft testing, secret leakage, cancellation on rotation, interrupted migration, old history, and real user-led configuration/use.

No code, migration, runtime test, Keychain write, or real service call was performed as part of adopting this ADR. The companion contracts define future implementation requirements only.

## Sources

- [Current search repository](../../apps/desktop/src/main/persistence/search-engine-repository.ts).
- [Current search adapter](../../apps/desktop/src/main/services/search-engine-service.ts).
- [Current Expert/Task contracts](../development/expert-contracts.md).
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage): asynchronous APIs, platform protections, availability, and signing limitations; API availability was checked against installed Electron declarations during design.
