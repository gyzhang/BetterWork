# API Tools and Remote MCP Capability Design

- Version: v1.0, 2026-09-20.
- Status: design recorded; product implementation has not started under this design. The accompanying ADRs remain Proposed.
- Confirmed scope: curated API integrations; retain stdio and add Streamable HTTP with static credentials. Custom HTTP tools, OAuth, and legacy HTTP+SSE are deferred.
- Authorization: this delivery adopts documentation only. Source changes, migrations, dependency changes, application startup, commits, and deployment require a separate instruction.
- Baseline: `main` at `7f78515`. Existing A/B0/E acceptance tasks retain their statuses and continue independently.

## 1. Purpose and document ownership

BetterWork should let a user configure a service once, select its capabilities for an Expert, adjust the choices for a Task, and see exactly what each Run used.

The target users are the creator and nearby colleagues doing research, analysis, and document preparation. This is a personal desktop workbench, not a multi-tenant integration platform. There are no new administrator roles, tenant permissions, or enterprise identity features.

| Document | Authority for this increment |
| --- | --- |
| This design | Product scope, user journeys, selection behavior, acceptance, and release boundaries |
| [ADR-0024](../adr/0024-api-services-and-credentials.md) | API service/account separation and protected credential ownership |
| [ADR-0025](../adr/0025-remote-mcp-and-capability-bindings.md) | Remote MCP transport, reviewed contracts, and lifecycle |
| [Capability contracts](../development/capability-contracts.md) | Shared fields, operations, states, errors, execution, and migration semantics |
| [UI/UX system](../10-ui-ux-system.md) | Existing visual language, layout, accessibility, and feedback rules |
| [Expert plan](../development/tasks-experts.md) | Existing implementation and acceptance evidence; not replaced by this proposal |

The new documents describe target behavior. They do not retroactively change accepted ADR history or claim that current code already satisfies these contracts.

## 2. Three capability categories

API tools, MCP, and Skills are three user-facing categories, not three sequential execution layers.

```text
Expert preset -> Task selections -> Run resolution and immutable snapshot
                                      |
                   +------------------+------------------+
                   |                  |                  |
           API tool + service    MCP connection       Skill revision
                profile          + selected tool     + runtime binding
                   |                  |                  |
                   +------- existing AgentTool boundary-+
                                      |
                               existing Agent Core
```

| Category | What the user selects | What it does not grant |
| --- | --- | --- |
| API tools | A reviewed operation and a named service profile | Arbitrary HTTP requests or another account's credentials |
| MCP tools | A connection revision and specifically reviewed tool contracts | All discovered tools, resources, or business write access |
| Skills | Existing ordered Skill revision bindings | Automatic API/MCP access or OS sandbox isolation |

Native helpers remain infrastructure: calculator, deterministic metrics, material readers, knowledge search, and `web_fetch`. Show them in an advanced **Built-in tools** section, not as credential-bearing API services. Model configuration stays separate from all three categories.

### Current baseline and corrections

- `web_search` already respects the Expert tool policy and affects execution. It lacks a first-class service-account binding; it is not a nonfunctional checkbox.
- `web_fetch` is a credential-free built-in tool.
- Search configuration currently has one supported provider, Baidu Qianfan, with a global enabled selection.
- MCP currently exposes command, arguments, and working directory, but no managed credential/environment configuration. Execution uses an application-wide mutable client cache.
- Skill management, trust, dependencies, ordered bindings, and execution are reusable foundations. Their remaining acceptance work is not resolved by this design.

## 3. Scope and success criteria

| Priority | Module | User story |
| --- | --- | --- |
| P0 | API services | As an Expert author, I can configure named service accounts and choose the intended account for each Expert. |
| P0 | Credentials | As the local user, I can replace or clear credentials without exposing saved values or losing nonsecret configuration. |
| P0 | Remote MCP | As a knowledge worker, I can connect an explicitly configured service and select suitable read-only tools. |
| P0 | Expert and Task integration | As a task owner, I can understand selections, missing prerequisites, and changes without a preparation wizard. |
| P0 | Lifecycle and provenance | As a returning user, I can cancel, restart, and identify the exact configuration behind earlier results. |

Release gates:

1. Every acceptance case in §9 passes with evidence appropriate to its layer.
2. One real Baidu integration and one real Streamable HTTP read-only MCP complete the user journey.
3. Managed credential values are absent from configuration read responses, model inputs, Run events, ordinary logs, Evidence, and exports in the credential-leakage acceptance cases.
4. Existing Skill, material-scope, cancellation, and Artifact-version behavior remains intact.

These are future gates, not reported test results. No delivery date, uptime target, or provider availability is assumed.

Excluded from this increment: arbitrary REST/OpenAPI builders; speculative additional providers; OAuth/browser login; legacy HTTP+SSE; MCP Resources, Prompts, sampling, and elicitation; business write tools; a general approval engine; marketplace; automatic routing; background polling; Windows completion; and OS sandbox claims.

## 4. API service experience

### 4.1 Configure once, select explicitly

Separate the stable operation, reviewed provider adapter, named account configuration, and secret:

| Object | Example |
| --- | --- |
| API tool definition | `web_search` |
| Provider adapter | `baidu_qianfan` |
| Service profile | Research search account |
| Credential | The profile's API key |
| Binding | Search using profile A, revision 2 |

Start with Baidu only. Support multiple profiles for that provider, independently enabled and tested. An optional application default exists per API tool. Multiple profiles may be enabled, but one Run selects at most one profile for a given tool. Two Experts may choose different profiles; simultaneous multi-provider search is not included.

The provider defines the endpoint, authentication placement, request/response contracts, and safe result extraction. Users configure supported options, not scripts or arbitrary request mappings. Baidu retains its fixed HTTPS endpoint, Bearer authentication, and `webTopK` of 1–20, default 10.

### 4.2 Settings journey

1. Open **Settings → API services**, choose the reviewed integration, and create a named profile.
2. Enter its credential and supported options. Save creates a disabled, untested profile.
3. Optionally test the saved profile or an unsaved draft. Explain that a provider test may consume quota; it uses a minimal adapter-defined request, not user materials.
4. Enable the profile explicitly and optionally set it as the default for its tool.
5. Return to the Expert or task and select the profile. Setting a default and enabling are not the same action.

Saving, enabling, successful testing, and setting a default are separate states and operations. Testing never silently saves an unsaved credential, enables a profile, creates a Run, or registers Evidence. Canceling a test preserves the editor; late test results cannot replace a newer draft's state.

Failure handling:
- Invalid fields remain inline with the draft preserved.
- An unavailable credential store offers unlock/retry; it never falls back to plaintext.
- Authentication, quota, network, and timeout failures have distinct messages and retry actions.
- Untested is a warning, not failure. A configured, enabled profile may make its first real call without an extra paid preflight request.

### 4.3 Edits, duplicates, and removal

Editing creates an immutable configuration revision. Existing task bindings keep their selected revision and offer **Update configuration**. Ordinary edits do not interrupt active Runs.

Duplicate copies nonsecret configuration only and creates a disabled profile with no credential or default assignment. Disable/remove/credential revocation are safety actions: show affected Experts, Tasks, and active Runs, then cancel affected Runs and block new use.

Remove archives the identity, clears its credential and default assignment, and retains referenced metadata for history. Removing a service cannot erase the attribution of an earlier result.

## 5. MCP connection experience

### 5.1 Supported choices

| Transport | User configuration | Authentication |
| --- | --- | --- |
| stdio | Executable, argument array, optional working directory | None or explicit secret-to-environment mappings |
| Streamable HTTP | Exact MCP endpoint and per-connection network mode | None, Bearer token, or one named API-key header |

Static credentials support services that accept them; this is not complete MCP OAuth support. An OAuth-required service receives an actionable unsupported-authentication message, not a browser flow or silent fallback.

Streamable HTTP must accept its JSON and SSE response forms. Deferring the legacy HTTP+SSE transport does not exclude SSE within Streamable HTTP.

### 5.2 Configure, discover, review, select

1. Open **Settings → MCP connections**, choose local or remote transport, and fill its configuration.
2. For a remote connection, show the exact destination and require explicit confirmation of private-network or literal-loopback access where applicable.
3. Save the new connection as disabled and untested, then test initialization and paginated discovery. Testing does not enable the connection or call an arbitrary business tool.
4. Review tools for read-only use. Remote descriptions and annotations are hints, not proof; tools advertised as destructive or non-read-only are unavailable in this release.
5. Enable the connection explicitly and select individual reviewed tools for an Expert or Task. Discovering a tool does not select it.
6. At execution, verify the selected contract against fresh discovery before that connection's first use in the Run.

A changed contract requires reconfirmation; new tools remain unselected. A failed connection preserves the last successful catalog as stale rather than presenting it as currently available. Review authorizes only the recorded connection revision and contract, not every future tool version.

Failure handling:
- Invalid destinations, redirects, TLS errors, and authentication errors identify the configuration to repair.
- Missing or changed tools remain visible as unavailable selections; they are not substituted.
- Connection tests are cancelable and do not disrupt active Runs.
- Disconnect, session expiry, or uncertain tool completion never causes an automatic business-call replay.

### 5.3 Network and trust boundaries

Require HTTPS and normal certificate verification for public/private endpoints. The only HTTP exception is an explicitly confirmed literal loopback address. Private access is limited to the configured host/port and never relaxes `web_fetch` restrictions.

Do not accept URL credentials, query parameters, fragments, redirects, ambient cookies, or an ignore-TLS-errors option. Validate DNS and the actual connected address; block metadata/link-local and disallowed address classes. Authentication headers and stdio secret environment values come only from their owning credential slots.

The server and its account permissions remain the business authorization boundary. A local review flag cannot prove that an untrusted server is read-only. Native subprocesses still run with local-user privileges.

## 6. Expert and Task behavior

### 6.1 Navigation and presentation

Keep the existing navigation structure:
- Settings → API services replaces the search-only section; old search navigation redirects there.
- Settings → MCP connections contains transport, credential, discovery, review, and lifecycle controls.
- Existing Skill management remains the only Skill installation/trust/dependency interface.
- Models retain their own settings section.

The Expert editor shows parallel **API tools**, **MCP tools**, and **Skills** groups, with native helpers under advanced **Built-in tools**. No additional top-level Tool administration page is introduced.

Each selected row shows a human-readable name, profile/connection, revision, readiness reason, and repair link. Descriptors come from the host, not independently maintained UI tool-name lists. API selection owns `web_search`; the new built-in editor must not expose a duplicate search switch. `web_fetch` remains a native helper.

### 6.2 Defaults and task overrides

- An API Expert preset selects a specific profile revision or an explicit application-default reference. Resolve defaults once when creating the task draft, then pin the concrete profile/revision.
- If a selected default cannot resolve, preserve an unresolved selection with a repair action. Sending is blocked until it is fixed or explicitly removed.
- An ordinary new task starts with current configured API defaults. No default means no API selection, not a block on local conversation.
- MCP presets pin connection revisions and reviewed tool contracts. Skills retain ordered revision bindings and the existing six-Skill limit.
- Summon opens a conversation immediately, without network calls, automatic sending, or a preparation form. An incomplete Expert can still be opened for configuration repair.
- Task adjustments update TaskContextRevision only. The effective task selection replaces that category's preset; sending does not merge removed preset entries back in.
- The user may select another host-authorized capability, but cannot override host restrictions, credential failures, lifecycle blocks, or Skill trust.
- Later application-default changes affect new drafts only. Applying an updated profile, connection, or Expert revision to an existing task is explicit.

### 6.3 Task journey

Composer `+` offers API tools and MCP tools alongside existing Skill/material entries. Show compact selected-service summaries; full details remain collapsible. **Configure** navigates to the relevant settings object and returns without losing the task draft.

Removing/replacing an external account, MCP connection/tool, or Skill starts a new context segment for the next Run. Keep the current request and explicitly selected materials, not old-segment assistant/tool content. Historical UI remains readable; previously sent data cannot be retracted.

Selecting an external capability authorizes its bounded operation arguments and makes its destination visible. It does not authorize unselected materials, automatically upload attachments, or provide content-level data-loss prevention.

A Skill's text never creates API/MCP grants. Machine-readable Skill dependency manifests and credential injection into arbitrary Skill scripts remain outside this increment.

## 7. Credentials, states, and feedback

The detailed credential design is in ADR-0024. User-facing requirements are:
- Enter a new value, keep the existing value, replace it, or explicitly clear it; never retrieve a saved secret through the UI/API.
- A blank editor field means keep, not clear. Clear is a separate action.
- Show whether credentials are configured and available without exposing their values.
- Credential rotation cancels Runs using the old version; the next Run resolves the new version.
- A locked/unavailable protected store blocks affected capabilities, not access to history or credential-free features.
- Database restoration to another machine may require re-entry; unsigned/signed application changes require separate Keychain acceptance.

Keep configuration validity, lifecycle, credential availability, connection status, and MCP contract approval separate. Connected is not authorized, and a past successful test does not prove current service availability. Readiness follows the selected revision, not an unrelated current revision.

Reuse existing inline feedback, transient toasts, and notification routing. Long operations remain visibly cancelable. No new feedback framework or external analytics is introduced.

## 8. Provenance and measurements

Record local capability binding, request correlation, duration, result code, and sanitized failure category. Connection tests record only their own diagnostic result and do not become business Evidence.

Baidu keeps `web-page` Evidence; MCP keeps `mcp-tool` Evidence. Associate successful tool results with the precise Run binding and tool call. Preserve old source URIs; new MCP attribution uses stored identities, not parsing a model alias. Evidence means returned by a source, not verified business truth or sentence-level Citation.

Do not record credential values, request headers, transport session IDs, or child-process environments. Redact managed-secret echoes before model, event, and Evidence delivery. At-rest protection does not protect a compromised host or guarantee forensic erasure of legacy plaintext backups.

## 9. Acceptance matrix

These are requirements for later development, not tests run during documentation adoption.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| API-1 | Two Baidu profiles | Two Experts choose different profiles | Each Run uses the selected options/account without credential crossover. |
| API-2 | A task pins profile A | The default changes to B | The existing task keeps A; a new default-based draft uses B. |
| API-3 | An explicit profile lacks a credential or is disabled | The user sends | An actionable error occurs before a model request; selection is not silently dropped. |
| API-4 | An unsaved profile draft | Test or cancel test | No profile/default/credential is silently saved; stale results cannot overwrite a newer draft. |
| SEC-1 | Legacy search/model plaintext fixtures | Migration succeeds or is interrupted | Success protects live values; failure is recoverable and cannot use plaintext fallback. |
| SEC-2 | A credential and an active Run | Replace or clear | Affected Runs cancel once; future Runs use the new version or fail clearly. |
| SEC-3 | Secret-bearing errors, progress, and echoed results | They cross host boundaries | No managed secrets reach summaries, model input, events, Evidence, or ordinary logs. |
| SEC-4 | Locked Keychain or a restored database | Request a protected capability | Offer a repair path while history and local features remain usable. |
| MCP-1 | Streamable HTTP fixtures for none/Bearer/custom-header auth | Connect, discover, and call | All three modes work; JSON and SSE responses are handled. |
| MCP-2 | Changed/new server tools | Discover | New tools remain unselected; changed contracts require review. |
| MCP-3 | Two connections with identical tool names | Select both | Stable identities/model aliases remain distinct; results map to the right source. |
| MCP-4 | Concurrent Runs and an independent connection test | Cancel one operation | Unrelated Runs continue; late canceled output creates no Evidence/artifact. |
| MCP-5 | Session expiry, timeout, 401/403/429, or disconnect | A call fails | No uncertain business-call replay; failure and explicit retry are visible. |
| MCP-6 | Private, redirected, metadata, or invalid-certificate targets | Connect/call | Only explicitly allowed destinations pass; TLS bypass and metadata access fail. |
| EXP-1 | An Expert with all three categories | Summon, adjust, restart | Direct conversation entry and draft recovery work without changing the Expert. |
| EXP-2 | A selected API/MCP/Skill capability | Remove or replace before the next Run | A new context segment prevents old assistant/tool content from carrying over. |
| EXP-3 | A Skill mentions unselected search/MCP | Attempt access | Text creates neither a grant nor executable tool exposure. |
| MIG-1 | Historical Expert/Task/Run fixtures | Upgrade and reopen twice | IDs/history survive; no invented provider attribution or duplicate migration rows. |
| LIFE-1 | Active Runs | Edit versus disable/archive a configuration | Ordinary edits preserve pinned revisions; safety actions cancel once and block new use. |
| END-1 | Real Baidu and a supported read-only remote MCP | Configure → select in Expert → run → inspect sources → restart/retry | Preserve sanitized journey evidence; do not report offline fixtures as live acceptance. |

Automated implementation tests use injected HTTP/protected-storage adapters and synthetic SQLite fixtures, without external network. Later implementation requires full `npm run verify` and user-led desktop acceptance. Missing live credentials/endpoints remain explicit acceptance limitations.

## 10. Delivery and subsequent work

This documentation delivery introduces no runtime behavior. The contracts specify compatibility projections, protected-secret conversion, initial MCP revisions, and honest legacy history. Existing acceptance cards remain untouched.

Suggested later slices, requiring a separate development instruction:
1. Shared contracts and credential service/migration.
2. Baidu profiles and Expert/Task selection as an end-to-end slice.
3. Versioned stdio MCP configuration, credentials, reviewed contracts, and cancellation.
4. Streamable HTTP destination, authentication, and session controls.
5. Cross-category migration, isolation, provenance, and user-led acceptance.

Do not create a second implementation task board or infer that these slices are approved for immediate execution. The existing engineering standard remains authoritative; its current plaintext-storage statement must change together with implementation and applicable executable guards, not be relabeled as already fixed by this document.

## References

Current source anchors: [shared protocol](../../packages/agent-protocol/src/index.ts), [search repository](../../apps/desktop/src/main/persistence/search-engine-repository.ts), [Run service](../../apps/desktop/src/main/services/run-service.ts), [MCP client](../../apps/desktop/src/main/services/mcp-client-service.ts), [MCP settings](../../apps/desktop/src/renderer/src/views/SettingsView.tsx), and [Expert readiness](../../apps/desktop/src/main/services/expert-service.ts).

Technical references checked during design: [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), and [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). Installed MCP client and Electron declarations establish API availability, not runtime acceptance or universal protocol compatibility.
