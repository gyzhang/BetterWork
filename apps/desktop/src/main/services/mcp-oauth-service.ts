import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { abortError } from '@betterwork/agent-core';
import type {
  McpConnectionSummary,
  McpLoginContinueRequest,
  McpOAuthPreparation,
  McpOperationRequest,
} from '@betterwork/agent-protocol';
import {
  auth,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  extractWWWAuthenticateParams,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type OAuthProtectedResourceMetadata,
  refreshAuthorization,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
  validateAuthorizationResponseIssuer,
} from '@modelcontextprotocol/client';
import { z } from 'zod';

import type { AppStore } from '../persistence';
import { CredentialError } from '../persistence/credential-repository';
import {
  createMcpPolicyFetch,
  type McpNetworkGrant,
  type McpNetworkOptions,
  resolveMcpDestination,
  validateMcpEndpoint,
} from './mcp-network-policy';
import { mcpContractHash } from './mcp-tool-contract';

class McpOAuthConfigurationError extends Error {}

interface OAuthOptions extends McpNetworkOptions {
  openBrowser?: (url: string) => Promise<void>;
}
interface LoginOperation {
  connection: McpConnectionSummary;
  controller: AbortController;
  timer: NodeJS.Timeout;
  metadata: OAuthProtectedResourceMetadata;
  scope?: string;
  server?: Server;
  started: boolean;
  timedOut: boolean;
  disposeCallback?: () => void;
}
interface TokenBundle {
  tokens: StoredOAuthTokens;
  clientInformation: StoredOAuthClientInformation;
  discovery: OAuthDiscoveryState;
  expiresAt: number;
}
const tokenBundleSchema = z.object({
  tokens: z
    .object({
      access_token: z.string().min(1),
      token_type: z.string().min(1),
      refresh_token: z.string().optional(),
      expires_in: z.number().nonnegative().optional(),
      scope: z.string().optional(),
      issuer: z.string().optional(),
    })
    .passthrough(),
  clientInformation: z
    .object({
      client_id: z.string().min(1),
      client_secret: z.string().optional(),
      issuer: z.string().optional(),
    })
    .passthrough(),
  discovery: z
    .object({
      authorizationServerUrl: z.string().url(),
      authorizationServerMetadata: z.record(z.string(), z.unknown()).optional(),
      resourceMetadata: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough(),
  expiresAt: z.number().nonnegative(),
});
const constantEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export class McpOAuthService {
  private readonly operations = new Map<string, LoginOperation>();
  private readonly refreshes = new Map<
    string,
    { connectionId: string; controller: AbortController; promise: Promise<TokenBundle> }
  >();
  private readonly secrets = new Map<string, Set<string>>();
  constructor(
    private readonly store: AppStore,
    private readonly options: OAuthOptions,
  ) {}

  summary(connection: McpConnectionSummary): McpConnectionSummary {
    if (
      connection.transport.kind === 'stdio' ||
      connection.transport.authentication.mode !== 'oauth'
    )
      return connection;
    const authorization = connection.revisionId
      ? this.store.mcpConnections.authorization(connection.id, connection.revisionId)
      : undefined;
    const configured =
      authorization &&
      this.store.credentials?.hasSecret({
        ownerKind: 'mcp-connection',
        ownerId: connection.id,
        slot: authorization.slot,
      });
    return {
      ...connection,
      oauthStatus: configured
        ? 'authorized'
        : authorization
          ? 'reauthorization-required'
          : 'signed-out',
    };
  }
  activeSecrets(id: string): string[] {
    return [...(this.secrets.get(id) ?? [])];
  }

  async prepare(input: McpOperationRequest): Promise<McpOAuthPreparation> {
    const connection = this.store.mcpConnections.assertRevision(input.id, input.expectedRevisionId);
    if (
      connection.transport.kind === 'stdio' ||
      connection.transport.authentication.mode !== 'oauth'
    )
      throw new Error('此连接没有使用 OAuth。');
    if (this.operations.has(input.operationId)) throw new Error('登录操作 ID 已在使用中。');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      operation.timedOut = true;
      controller.abort();
      this.finish(input.operationId);
    }, 300_000);
    const operation: LoginOperation = {
      connection,
      controller,
      timer,
      metadata: { resource: connection.transport.endpoint, authorization_servers: [] },
      started: false,
      timedOut: false,
    };
    this.operations.set(input.operationId, operation);
    try {
      const fetchFn = this.discoveryFetch(connection, controller.signal);
      const challenge = await fetchFn(connection.transport.endpoint, {
        method: 'GET',
        signal: controller.signal,
      });
      const hints = extractWWWAuthenticateParams(challenge);
      await challenge.body?.cancel();
      const metadata = await discoverOAuthProtectedResourceMetadata(
        connection.transport.endpoint,
        {
          ...(hints.resourceMetadataUrl ? { resourceMetadataUrl: hints.resourceMetadataUrl } : {}),
        },
        fetchFn,
      );
      const endpoint = new URL(connection.transport.endpoint);
      const resource = new URL(metadata.resource);
      if (
        resource.origin !== endpoint.origin ||
        !(
          endpoint.pathname === resource.pathname ||
          endpoint.pathname.startsWith(resource.pathname.replace(/\/$/u, '') + '/')
        )
      )
        throw new Error('OAuth resource 元数据与 MCP 地址不匹配。');
      const issuers = metadata.authorization_servers ?? [];
      if (!issuers.length || issuers.length > 20)
        throw new Error('此 MCP 服务没有提供有效的授权服务器。');
      for (const issuer of issuers) {
        const url = new URL(issuer);
        if (url.search || url.hash || url.username || url.password)
          throw new Error('OAuth issuer 必须是不含凭据、查询或片段的地址。');
        this.checkDestination(connection, issuer);
      }
      if (
        connection.transport.authentication.issuer &&
        !issuers.includes(connection.transport.authentication.issuer)
      )
        throw new Error('服务提供的 issuer 与预注册配置不匹配。');
      controller.signal.throwIfAborted();
      this.store.mcpConnections.assertRevision(input.id, input.expectedRevisionId);
      operation.metadata = metadata;
      const scope = hints.scope ?? metadata.scopes_supported?.join(' ');
      if (scope && scope.length > 8_192) throw new Error('OAuth 权限集合超过上限。');
      if (scope) operation.scope = scope;
      return {
        operationId: input.operationId,
        resource: metadata.resource,
        issuers,
        scopes: scope?.split(' ').filter(Boolean) ?? [],
      };
    } catch (error) {
      this.finish(input.operationId);
      if (operation.timedOut)
        throw new McpOAuthConfigurationError('OAuth 登录超过 5 分钟，请重新开始。');
      if (controller.signal.aborted) throw abortError();
      throw new Error('OAuth 发现失败，请检查资源元数据与授权目的地。', { cause: error });
    }
  }

  async login(input: McpLoginContinueRequest): Promise<void> {
    const operation = this.operations.get(input.operationId);
    if (
      !operation ||
      operation.started ||
      operation.connection.id !== input.id ||
      operation.connection.revisionId !== input.expectedRevisionId ||
      !operation.metadata.authorization_servers?.includes(input.issuer)
    )
      throw new Error('OAuth 登录操作已失效，请重新开始。');
    this.store.mcpConnections.assertRevision(input.id, input.expectedRevisionId);
    operation.started = true;
    const connection = operation.connection;
    const config = connection.transport;
    if (config.kind === 'stdio' || config.authentication.mode !== 'oauth')
      throw new Error('OAuth 配置无效。');
    const signal = operation.controller.signal;
    try {
      const discoveryFetch = this.discoveryFetch(connection, signal);
      const metadata = await discoverAuthorizationServerMetadata(input.issuer, {
        fetchFn: discoveryFetch,
      });
      if (
        !metadata ||
        metadata.issuer !== input.issuer ||
        !metadata.code_challenge_methods_supported?.includes('S256') ||
        !metadata.authorization_endpoint ||
        !metadata.token_endpoint
      ) {
        this.finish(input.operationId);
        throw new McpOAuthConfigurationError(
          '授权服务器必须提供匹配的 issuer、授权/token 端点及 PKCE S256。',
        );
      }
      if (
        !config.authentication.clientId &&
        !(
          config.authentication.clientMetadataUrl &&
          'client_id_metadata_document_supported' in metadata &&
          metadata.client_id_metadata_document_supported === true
        ) &&
        !metadata.registration_endpoint
      )
        throw new McpOAuthConfigurationError(
          '此服务需要客户端注册，请在高级选项填写该 issuer 的预注册 Client ID，或提供服务支持的客户端元数据文档。',
        );
      const endpoints = [
        metadata.authorization_endpoint,
        metadata.token_endpoint,
        ...(metadata.registration_endpoint ? [metadata.registration_endpoint] : []),
        ...('revocation_endpoint' in metadata && metadata.revocation_endpoint
          ? [metadata.revocation_endpoint]
          : []),
      ];
      for (const endpoint of endpoints) this.checkDestination(connection, endpoint);
      const fetchFn = createMcpPolicyFetch(
        endpoints.map((endpoint) => this.grant(connection, endpoint)),
        this.options,
        false,
        signal,
      );
      const state = randomBytes(32).toString('base64url');
      let verifier = '';
      let discovery: OAuthDiscoveryState = {
        authorizationServerUrl: input.issuer,
        authorizationServerMetadata: metadata,
        resourceMetadata: { ...operation.metadata, authorization_servers: [input.issuer] },
      };
      let clientInformation: StoredOAuthClientInformation | undefined;
      let tokens: StoredOAuthTokens | undefined;
      const slot = `oauth:${mcpContractHash([input.issuer, operation.metadata.resource])}`;
      const credentials = this.store.credentials;
      if (!credentials || !(await credentials.isStorageAvailable())) {
        this.finish(input.operationId);
        throw new McpOAuthConfigurationError('受保护存储不可用，无法保存 OAuth 授权。');
      }
      const expectedVersion = (
        await credentials.status({ ownerKind: 'mcp-connection', ownerId: input.id, slot })
      ).version;
      const callback = await this.callback(
        operation,
        state,
        input.issuer,
        metadata.authorization_response_iss_parameter_supported === true,
        config.authentication.callbackPort,
      );
      if (config.authentication.clientId) {
        if (config.authentication.issuer !== input.issuer)
          throw new Error('预注册客户端不属于所选 issuer。');
        const secret = credentials.hasSecret({
          ownerKind: 'mcp-connection',
          ownerId: input.id,
          slot: 'oauth-client-secret',
        })
          ? (
              await credentials.resolveForOwner({
                ownerKind: 'mcp-connection',
                ownerId: input.id,
                slot: 'oauth-client-secret',
              })
            ).plaintext
          : undefined;
        clientInformation = {
          client_id: config.authentication.clientId,
          issuer: input.issuer,
          ...(secret ? { client_secret: secret } : {}),
        };
      }
      if (config.authentication.clientMetadataUrl) {
        const response = await discoveryFetch(config.authentication.clientMetadataUrl);
        if (!response.ok) throw new Error('客户端元数据文档不可读取。');
        const document: unknown = await response.json();
        const parsed = z
          .object({
            client_id: z.literal(config.authentication.clientMetadataUrl),
            redirect_uris: z.array(z.string().url()).min(1),
          })
          .passthrough()
          .parse(document);
        if (!parsed.redirect_uris.includes(callback.redirectUrl))
          throw new Error('客户端元数据未登记此 loopback 回调，请配置固定端口。');
      }
      const provider: OAuthClientProvider = {
        redirectUrl: callback.redirectUrl,
        ...(config.authentication.clientMetadataUrl
          ? { clientMetadataUrl: config.authentication.clientMetadataUrl }
          : {}),
        clientMetadata: {
          client_name: 'BetterWork',
          redirect_uris: [callback.redirectUrl],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method:
            clientInformation && 'client_secret' in clientInformation
              ? 'client_secret_post'
              : 'none',
          application_type: 'native',
        },
        state: () => state,
        clientInformation: (context) =>
          !context?.issuer || context.issuer === input.issuer ? clientInformation : undefined,
        saveClientInformation: (value, context) => {
          if (context?.issuer && context.issuer !== input.issuer)
            throw new Error('客户端注册 issuer 不匹配。');
          clientInformation = value;
        },
        tokens: () => undefined,
        saveTokens: (value, context) => {
          if (context?.issuer && context.issuer !== input.issuer)
            throw new Error('token issuer 不匹配。');
          tokens = value;
        },
        saveCodeVerifier: (value) => {
          verifier = value;
        },
        codeVerifier: () => verifier,
        discoveryState: () => discovery,
        saveDiscoveryState: (value) => {
          if (value.authorizationServerUrl !== input.issuer)
            throw new Error('授权服务器发生变化。');
          discovery = value;
        },
        redirectToAuthorization: async (url) => {
          if (
            url.origin !== new URL(metadata.authorization_endpoint).origin ||
            url.pathname !== new URL(metadata.authorization_endpoint).pathname ||
            url.searchParams.get('state') !== state
          )
            throw new Error('浏览器授权地址不匹配。');
          await resolveMcpDestination(
            url,
            this.grant(connection, url.toString()).networkMode,
            this.options,
            AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
          );
          signal.throwIfAborted();
          if (!this.options.openBrowser) throw new Error('系统浏览器不可用。');
          await this.options.openBrowser(url.toString());
        },
      };
      const result = await auth(provider, {
        serverUrl: config.endpoint,
        ...(operation.scope ? { scope: operation.scope } : {}),
        fetchFn,
        forceReauthorization: true,
      });
      if (result !== 'REDIRECT') throw new Error('OAuth 没有进入浏览器授权。');
      const response = await callback.result;
      signal.throwIfAborted();
      const exchanged = await auth(provider, {
        serverUrl: config.endpoint,
        authorizationCode: response.code,
        ...(response.iss ? { iss: response.iss } : {}),
        fetchFn,
      });
      if (exchanged !== 'AUTHORIZED' || !tokens || !clientInformation)
        throw new Error('OAuth 授权未完成。');
      signal.throwIfAborted();
      const bundle: TokenBundle = {
        tokens: {
          ...tokens,
          ...(tokens.scope === undefined && operation.scope ? { scope: operation.scope } : {}),
        },
        clientInformation,
        discovery,
        expiresAt:
          tokens.expires_in !== undefined
            ? Date.now() + tokens.expires_in * 1000
            : Number.MAX_SAFE_INTEGER,
      };
      await credentials.mutateOwned(
        input.id,
        [{ slot, expectedVersion, mutation: { action: 'replace', value: JSON.stringify(bundle) } }],
        () => {
          signal.throwIfAborted();
          this.store.mcpConnections.assertRevision(input.id, input.expectedRevisionId);
          this.store.mcpConnections.authorize({
            connection_id: input.id,
            revision_id: input.expectedRevisionId,
            issuer: input.issuer,
            resource: operation.metadata.resource,
            slot,
          });
        },
      );
      this.rememberSecrets(input.id, bundle);
    } catch (error) {
      if (operation.timedOut)
        throw new McpOAuthConfigurationError('OAuth 登录超过 5 分钟，请重新开始。');
      if (signal.aborted) throw abortError();
      if (error instanceof CredentialError) throw error;
      if (error instanceof McpOAuthConfigurationError) throw error;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE')
        throw new McpOAuthConfigurationError(
          'OAuth 回调端口已被占用，请更换固定端口或使用临时端口。',
        );
      throw new Error('OAuth 登录失败，请检查客户端注册、回调与授权范围。', { cause: error });
    } finally {
      this.finish(input.operationId);
    }
  }

  async accessToken(
    connection: McpConnectionSummary,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const authorization = connection.revisionId
      ? this.store.mcpConnections.authorization(connection.id, connection.revisionId)
      : undefined;
    if (!authorization || !this.store.credentials)
      throw new Error('MCP 需要登录，请到设置 → MCP 完成授权。');
    const ref = {
      ownerKind: 'mcp-connection' as const,
      ownerId: connection.id,
      slot: authorization.slot,
    };
    const stored = await this.store.credentials.resolveForOwner(ref);
    let bundle = tokenBundleSchema.parse(
      JSON.parse(stored.plaintext) as unknown,
    ) as unknown as TokenBundle;
    if (
      bundle.discovery.authorizationServerUrl !== authorization.issuer ||
      (bundle.tokens.issuer && bundle.tokens.issuer !== authorization.issuer)
    )
      throw new Error('OAuth token 不属于此授权服务器。');
    if (bundle.expiresAt <= Date.now() + 30_000) {
      const key = mcpContractHash([connection.id, authorization.slot]);
      let refreshing = this.refreshes.get(key);
      if (!refreshing) {
        const controller = new AbortController();
        const promise = this.refresh(
          connection,
          authorization.slot,
          authorization.resource,
          bundle,
          stored.version,
          AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        ).finally(() => {
          if (this.refreshes.get(key)?.promise === promise) this.refreshes.delete(key);
        });
        promise.catch(() => {
          /* Every caller receives this failure; cancellation can leave no waiter. */
        });
        refreshing = { connectionId: connection.id, controller, promise };
        this.refreshes.set(key, refreshing);
      }
      const pending = refreshing.promise;
      bundle = await new Promise<TokenBundle>((resolve, reject) => {
        const abort = (): void => reject(abortError());
        signal.addEventListener('abort', abort, { once: true });
        pending.then(
          (value) => {
            signal.removeEventListener('abort', abort);
            resolve(value);
          },
          (error: unknown) => {
            signal.removeEventListener('abort', abort);
            reject(error instanceof Error ? error : new Error('OAuth 刷新失败。'));
          },
        );
        if (signal.aborted) abort();
      });
    }
    signal.throwIfAborted();
    this.rememberSecrets(connection.id, bundle);
    return bundle.tokens.access_token;
  }

  cancel(input: McpOperationRequest): boolean {
    const operation = this.operations.get(input.operationId);
    if (!operation || operation.connection.id !== input.id) return false;
    operation.controller.abort();
    this.finish(input.operationId);
    return true;
  }
  cancelConnection(id: string): void {
    for (const refresh of this.refreshes.values())
      if (refresh.connectionId === id) refresh.controller.abort();
    for (const [operationId, operation] of this.operations)
      if (operation.connection.id === id) {
        operation.controller.abort();
        this.finish(operationId);
      }
  }
  async logout(id: string): Promise<void> {
    this.cancelConnection(id);
    const slots =
      this.store.mcpConnections
        .get(id)
        ?.credentialSlots?.filter((item) => item.slot.startsWith('oauth:') && item.configured) ??
      [];
    await this.store.credentials?.mutateOwned(
      id,
      slots.map((item) => ({
        slot: item.slot,
        expectedVersion: item.version,
        mutation: { action: 'clear' },
      })),
      () => this.store.mcpConnections.clearAuthorization(id),
    );
    this.secrets.delete(id);
  }
  shutdown(): void {
    for (const refresh of this.refreshes.values()) refresh.controller.abort();
    for (const operation of this.operations.values()) operation.controller.abort();
    for (const id of [...this.operations.keys()]) this.finish(id);
    this.secrets.clear();
  }

  private async refresh(
    connection: McpConnectionSummary,
    slot: string,
    resource: string,
    bundle: TokenBundle,
    version: number,
    signal: AbortSignal,
  ): Promise<TokenBundle> {
    if (!bundle.tokens.refresh_token) {
      await this.store.credentials?.mutateOwned(
        connection.id,
        [{ slot, expectedVersion: version, mutation: { action: 'clear' } }],
        () => undefined,
      );
      throw new Error('OAuth 授权已过期，需要重新登录。');
    }
    const metadata = bundle.discovery.authorizationServerMetadata;
    const tokenEndpoint = metadata?.token_endpoint;
    if (!tokenEndpoint) throw new Error('OAuth token 端点不可用。');
    try {
      const tokens = await refreshAuthorization(bundle.discovery.authorizationServerUrl, {
        ...(metadata ? { metadata } : {}),
        clientInformation: bundle.clientInformation,
        refreshToken: bundle.tokens.refresh_token,
        resource: new URL(resource),
        fetchFn: createMcpPolicyFetch(
          [this.grant(connection, tokenEndpoint)],
          this.options,
          false,
          signal,
        ),
      });
      const approvedScopes = new Set((bundle.tokens.scope ?? '').split(' ').filter(Boolean));
      if (
        tokens.scope
          ?.split(' ')
          .filter(Boolean)
          .some((scope) => !approvedScopes.has(scope))
      ) {
        await this.store.credentials?.mutateOwned(
          connection.id,
          [{ slot, expectedVersion: version, mutation: { action: 'clear' } }],
          () => undefined,
        );
        throw new Error('OAuth 刷新改变了授权范围，请重新审阅并登录。');
      }
      const result: TokenBundle = {
        ...bundle,
        tokens: {
          ...tokens,
          issuer: bundle.discovery.authorizationServerUrl,
          refresh_token: tokens.refresh_token ?? bundle.tokens.refresh_token,
          ...(tokens.scope === undefined && bundle.tokens.scope
            ? { scope: bundle.tokens.scope }
            : {}),
        },
        expiresAt:
          tokens.expires_in !== undefined
            ? Date.now() + tokens.expires_in * 1000
            : Number.MAX_SAFE_INTEGER,
      };
      await this.store.credentials?.mutateOwned(
        connection.id,
        [
          {
            slot,
            expectedVersion: version,
            mutation: { action: 'replace', value: JSON.stringify(result) },
          },
        ],
        () => {
          signal.throwIfAborted();
          if (this.store.mcpConnections.get(connection.id)?.lifecycle === 'archived')
            throw new Error('连接已移除。');
        },
        false,
      );
      return result;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'invalid_grant')
        await this.store.credentials?.mutateOwned(
          connection.id,
          [{ slot, expectedVersion: version, mutation: { action: 'clear' } }],
          () => undefined,
          false,
        );
      if (signal.aborted) throw abortError();
      throw new Error('OAuth 刷新失败，需要重新登录或重试。', { cause: error });
    }
  }

  private grant(connection: McpConnectionSummary, raw: string): McpNetworkGrant {
    const config = connection.transport;
    if (config.kind === 'stdio' || config.authentication.mode !== 'oauth')
      throw new Error('OAuth 配置无效。');
    const url = new URL(raw);
    const explicit = config.authentication.approvedOrigins?.find(
      (item) => new URL(item.origin).origin === url.origin,
    );
    return { origin: url.origin, networkMode: explicit?.networkMode ?? 'public' };
  }
  private checkDestination(connection: McpConnectionSummary, raw: string): void {
    const grant = this.grant(connection, raw);
    validateMcpEndpoint(raw, grant.networkMode, grant.networkMode === 'public' || !!grant);
  }
  private discoveryFetch(connection: McpConnectionSummary, signal: AbortSignal): typeof fetch {
    if (
      connection.transport.kind === 'stdio' ||
      connection.transport.authentication.mode !== 'oauth'
    )
      throw new Error('OAuth 配置无效。');
    const config = connection.transport;
    if (config.authentication.mode !== 'oauth') throw new Error('OAuth 配置无效。');
    return createMcpPolicyFetch(
      [
        { origin: new URL(config.endpoint).origin, networkMode: config.networkMode },
        ...(config.authentication.approvedOrigins ?? []),
      ],
      this.options,
      true,
      signal,
    );
  }
  private rememberSecrets(id: string, bundle: TokenBundle): void {
    const values = this.secrets.get(id) ?? new Set<string>();
    if (values.size > 128) values.clear();
    values.add(bundle.tokens.access_token);
    if (bundle.tokens.refresh_token) values.add(bundle.tokens.refresh_token);
    if (
      'client_secret' in bundle.clientInformation &&
      typeof bundle.clientInformation.client_secret === 'string'
    )
      values.add(bundle.clientInformation.client_secret);
    this.secrets.set(id, values);
  }
  private finish(id: string): void {
    const operation = this.operations.get(id);
    if (!operation) return;
    this.operations.delete(id);
    clearTimeout(operation.timer);
    operation.disposeCallback?.();
    operation.server?.close();
  }

  private async callback(
    operation: LoginOperation,
    state: string,
    issuer: string,
    issSupported: boolean,
    port?: number,
  ): Promise<{ redirectUrl: string; result: Promise<{ code: string; iss?: string }> }> {
    let resolve: ((value: { code: string; iss?: string }) => void) | undefined;
    let reject: ((error: Error) => void) | undefined;
    let consumed = false;
    const result = new Promise<{ code: string; iss?: string }>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Rejection can precede the browser handoff; retain it until the login awaits the callback.
    result.catch(() => {
      /* Login's callback await owns the visible error. */
    });
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      response.setHeader('Content-Security-Policy', "default-src 'none'");
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      if (request.method !== 'GET' || url.pathname !== '/mcp/oauth/callback') {
        response.writeHead(404);
        response.end('回调地址无效。');
        return;
      }
      try {
        if (
          consumed ||
          operation.controller.signal.aborted ||
          url.searchParams.getAll('state').length !== 1 ||
          !constantEqual(url.searchParams.get('state') ?? '', state)
        )
          throw new McpOAuthConfigurationError('OAuth state 不匹配或回调已消费，请重新登录。');
        const iss = url.searchParams.get('iss') ?? undefined;
        if (url.searchParams.getAll('iss').length > 1) throw new Error('OAuth issuer 参数重复。');
        validateAuthorizationResponseIssuer({
          iss,
          expectedIssuer: issuer,
          issParameterSupported: issSupported,
        });
        if (url.searchParams.has('error'))
          throw new McpOAuthConfigurationError('用户或服务商拒绝了授权，可重新登录。');
        const code = url.searchParams.get('code');
        if (!code || code.length > 8_192 || url.searchParams.getAll('code').length !== 1)
          throw new Error('授权码缺失或无效。');
        consumed = true;
        resolve?.({ code, ...(iss ? { iss } : {}) });
        response.end('授权已返回算台，可以关闭此页面。');
      } catch (error) {
        consumed = true;
        reject?.(new Error('OAuth 回调校验失败。', { cause: error }));
        response.writeHead(400);
        response.end('授权校验失败，请返回算台重试。');
      }
    });
    operation.server = server;
    const cancel = (): void => {
      reject?.(abortError());
      server.close();
    };
    operation.controller.signal.addEventListener('abort', cancel, { once: true });
    operation.disposeCallback = () => {
      operation.controller.signal.removeEventListener('abort', cancel);
      cancel();
    };
    await new Promise<void>((yes, no) => {
      server.once('error', no);
      server.listen(port ?? 0, '127.0.0.1', () => {
        server.removeListener('error', no);
        yes();
      });
    });
    if (operation.controller.signal.aborted) {
      cancel();
      throw abortError();
    }
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('OAuth 回调监听器没有获得端口。');
    return {
      redirectUrl: `http://127.0.0.1:${address.port}/mcp/oauth/callback`,
      result,
    };
  }
}
