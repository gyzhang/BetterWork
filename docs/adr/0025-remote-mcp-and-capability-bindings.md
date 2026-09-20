# ADR-0025: Remote MCP and Versioned Capability Bindings

- Status: Proposed; design recorded on 2026-09-20. This record authorizes no product implementation.
- Scope: stdio plus Streamable HTTP, static credentials, selected read-only tool contracts, and Run-owned execution clients.
- Product design: [API tools and remote MCP](../designs/api-tools-and-remote-mcp.md).
- Contracts: [Capability contracts](../development/capability-contracts.md).
- Proposed extension of [ADR-0016](0016-mcp-transport-and-lifecycle.md): add remote transport and managed credentials; replace mutable application-wide execution clients with Run-owned clients.
- Proposed extension of [ADR-0021](0021-mcp-evidence-provenance.md): keep `mcp-tool` Evidence while attributing new results through stored binding/tool identities instead of deriving authority from model aliases. Historical source URIs remain unchanged.
- Preserved: [ADR-0003](0003-agent-core-boundary.md)'s dependency direction, [ADR-0014](0014-expert-context-and-material-binding.md)'s Expert/Task/Run boundaries, and [ADR-0011](0011-skill-trust-and-local-distribution.md)'s native-process limitations.

## Context

The current MCP implementation supports stdio discovery and explicit connection/tool selection. Its configuration has no managed credential fields, connection edits close a cached application-wide client, and stored bindings contain connection/tool IDs without a reviewed contract hash.

The confirmed next scope includes remote MCP services that accept static credentials. It must not become an arbitrary business connector, an OAuth platform, or a second Agent Engine. Existing stdio and Skill capabilities remain part of the same application execution boundary.

## Decisions

### 1. Two transport variants

- `stdio`: executable, argument array, optional working directory, and explicit secret-to-environment-variable mappings.
- `streamable-http`: an exact MCP endpoint, per-connection network mode, and authentication mode `none`, `bearer`, or one named `api-key-header`.

Use the installed official `@modelcontextprotocol/client` public API. Its inspected v2.0.0 declarations export `Client` and `StreamableHTTPClientTransport`, injectable fetch, per-request cancellation, and session APIs. This design does not require a dependency upgrade or claim runtime compatibility from declarations alone.

Streamable HTTP accepts JSON and SSE responses. Legacy HTTP+SSE is excluded; do not fall back to a server-supplied legacy endpoint. Negotiate the protocol through the SDK, record the negotiated version, and use its version-appropriate cancellation semantics.

### 2. Static authentication, not OAuth

Use [ADR-0024](0024-api-services-and-credentials.md)'s Main-owned credential service. Values are injected into the designated header or stdio environment slot, never into an Expert, tool argument, URL, process argument, or event payload.

Static credentials are compatible only with services accepting them. An OAuth-required challenge produces an explicit unsupported-authentication result. Do not navigate authorization metadata, open a browser, refresh tokens, expand scopes, or automatically retry with another account.

An API-key header name must be a valid HTTP token and cannot replace transport-controlled headers, including Host, Content-Length, Content-Type, Accept, Cookie, Authorization, or MCP protocol/session headers. Use Bearer mode for Authorization. Reject CR/LF in header names and values.

No ambient cookies or unrelated model/search credentials are sent. stdio processes receive only a minimal runtime environment and explicitly configured secret mappings, not unrestricted `process.env`. Secret-in-argument configurations are unsupported.

### 3. Explicit network scope

Public/private connections require HTTPS and normal certificate verification. There is no ignore-TLS-errors option. A per-connection local-development exception permits HTTP only for explicitly confirmed literal loopback addresses.

Private-network mode requires confirmation for the configured host/port. It never widens `web_fetch` or authorizes arbitrary intranet URLs. Endpoint configuration rejects user-info, query parameters, and fragments. Redirects fail with a request to configure the final URL; no credentials are forwarded.

Validate the hostname's resolved addresses and the address used by the connection. Handle IPv4, IPv6, and mapped forms; block link-local/metadata, multicast, unspecified, and addresses outside the chosen network mode. The request must not perform a second unchecked DNS resolution after validation.

These controls apply to initialize, discovery, calls, notifications, SSE connections/resumption, and session termination. Server-supplied content cannot choose another target or change this grant.

### 4. Immutable configuration and reviewed contracts

Each MCP connection retains its stable ID and gains immutable configuration revisions. New connections start disabled and untested; testing and tool review do not implicitly enable them. Ordinary edits create a revision; active Runs remain on the old configuration. New bindings identify a connection revision, stable tool ID, and reviewed contract hash.

The contract hash covers canonicalized tool description, input/output schemas, and advertised annotations. Canonicalization is deterministic, so object-key ordering alone does not invalidate a review. New or changed contracts require review; remote descriptions cannot silently expand authorization.

Testing initializes and performs paginated discovery, not arbitrary `tools/call`. Preserve the last successful catalog as stale on failure. Before a connection's first use in a Run, fresh discovery verifies the selected contracts. Missing/changed/unapproved selections block model dispatch rather than disappear from the tool list.

The user reviews suitability for read-only use. Tools advertised as destructive or non-read-only are unavailable in this release. Missing annotations are not automatic approval; explicit review is still required. Server/account permissions remain the business authority. This review cannot prove that an untrusted server has no side effects.

### 5. Run-owned clients and cancelable tests

Each Run owns its execution clients/sessions. Tools using the same connection within that Run share one client; separate Runs and connection tests use separate clients. This deliberately replaces the current application-wide execution cache so editing/testing one connection cannot mutate another Run's active client.

Connection tests have their own request ID and cancellation. Results apply only to the tested revision; canceled or stale requests cannot overwrite newer configuration/discovery state. Testing an unsaved draft neither saves a connection nor persists its secret.

Disable/archive/credential revocation cancel affected Runs and block new use. Cancellation reaches the individual SDK request. Ignore late output after cancellation and do not register it as Evidence or a formal Artifact.

Remote cancellation is a local acceptance boundary and a protocol cancellation request where supported, not proof that the server stopped or reversed a charge. stdio cleanup must meet the existing supervisor guarantees; cleanup failure remains visible rather than falsely reporting successful shutdown.

### 6. Session, retry, and limit semantics

MCP session identifiers are transient secret-like transport state, not BetterWork Session IDs. Never persist them as business identity or ordinary diagnostic text.

Invalidate and reinitialize an expired HTTP session as required by the negotiated protocol, but do not replay an uncertain business call. Timeout, disconnection, 401, 403, and 429 fail with an explicit retry path. A bounded SSE resume may retrieve the original response without reposting `tools/call`, within the original deadline and cancellation signal.

Close clients at Run completion and application exit. Attempt remote session termination where supported. No connection pool, background polling, automatic business-call retry, or persistent remote session restoration is added.

First-release limits are defined once in [capability contracts](../development/capability-contracts.md#8-runtime-limits): 10-second connect, 30-second complete discovery, 60-second tool calls, 200 discovered tools, 1 MiB decoded HTTP messages/SSE events, and 100,000-character usable results. Progress cannot extend hard deadlines. Reject remote Schema references and oversize accumulation.

### 7. One runtime and explicit provenance

Application/Main owns transport, credentials, authorization, revision checks, and binding construction. Agent Core receives only the existing `AgentTool` interface; it does not import MCP, Electron, or repositories. Skill execution still uses `RunSkillBinding`, not a new generic execution table.

MCP model aliases are deterministic, bounded to 64 characters, and based on the full connection/tool identity. Reject collisions and persist reverse mappings. Authority comes from the Run binding, never parsing or truncating the alias.

Keep `mcp-tool` Evidence and existing Artifact relations. Link successful results to the precise Run binding/tool call; preserve old source URIs. Results represent returned source material, not verified business facts. Sanitize managed secrets and transport diagnostics before persistence, model input, or UI broadcast.

## Alternatives and trade-offs

| Alternative | Reason not selected |
| --- | --- |
| Keep only stdio | Does not satisfy the confirmed remote-service scope. |
| Add OAuth and legacy HTTP+SSE at the same time | Expands authentication and compatibility beyond the user's chosen first release. |
| Treat every discovered tool as authorized | Discovery is mutable and cannot establish user intent or read-only suitability. |
| Share one mutable client across all Runs | Configuration edits, testing, cancellation, and server session state can affect unrelated tasks. |
| Retry uncertain calls automatically | Can duplicate server work or charges and hide indeterminate outcomes. |
| Use the public web-fetch path for remote MCP | Confuses public-content access with an explicitly configured private-service grant. |
| Infer grants from Skills or remote descriptions | Instructions and discovery content do not establish authority. |

Run-owned connections add initialization cost and may launch more local processes than the current cache. The proposal takes this trade-off to obtain explicit ownership and isolation in the first personal-workbench release. Future pooling requires a separate design and measured need.

## Compatibility and verification

Existing MCP connections gain an initial revision. Old bindings without contract hashes remain visible but require explicit review before new execution. Do not rewrite historical Expert/Task/Run records or invent old approvals. New empty selection arrays mean no selection and cannot restore presets implicitly.

Future tests cover design cases MCP-1–MCP-6, EXP-1–EXP-3, MIG-1, LIFE-1, and END-1, including independent Run cancellation, stale discovery, redirection/DNS/TLS boundaries, and live read-only service acceptance. Offline fixtures are not evidence of a real business connection.

No product code, connections, credentials, or acceptance-card statuses were changed by adopting this ADR.

## Sources

- [Current MCP service](../../apps/desktop/src/main/services/mcp-client-service.ts) and [connection repository](../../apps/desktop/src/main/persistence/mcp-connection-repository.ts).
- [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports): Streamable HTTP, JSON/SSE responses, sessions, cancellation, and legacy transport distinction.
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): HTTP authorization and stdio credential separation.
