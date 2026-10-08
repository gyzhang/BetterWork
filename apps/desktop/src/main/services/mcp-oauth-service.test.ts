import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import type { SafeStorageAdapter } from '../infrastructure/credential-store';
import { AppStore } from '../persistence';
import { McpOAuthService } from './mcp-oauth-service';

const adapter: SafeStorageAdapter = {
  isAvailableAsync: async () => true,
  encryptAsync: async (value) => Buffer.from(Buffer.from(value).map((byte) => byte ^ 0x7f)),
  decryptAsync: async (value) =>
    Buffer.from(Buffer.from(value).map((byte) => byte ^ 0x7f)).toString(),
};
const opened: Array<{ service: McpOAuthService; store: AppStore }> = [];
afterEach(() => {
  for (const { service, store } of opened.splice(0)) {
    service.shutdown();
    store.close();
  }
});
const fixture = async (
  options: {
    expiresIn?: number;
    wrongState?: boolean;
    wrongIssuer?: boolean;
    pkce?: boolean;
    dynamic?: boolean;
    metadataIssuer?: string;
    resource?: string;
    clientMetadata?: boolean;
    callbackPort?: number;
  } = {},
) => {
  const store = AppStore.open(':memory:', adapter);
  const connection = store.mcpConnections.save({
    name: 'OAuth',
    transport: {
      kind: 'streamable-http',
      endpoint: 'https://mcp.example/mcp',
      networkMode: 'public',
      networkApproved: false,
      authentication: {
        mode: 'oauth',
        ...(options.clientMetadata
          ? { clientMetadataUrl: 'https://client.example/oauth/client.json' }
          : {}),
        ...(options.callbackPort ? { callbackPort: options.callbackPort } : {}),
        ...(options.dynamic
          ? {}
          : { issuer: 'https://auth.example', clientId: 'registered-client' }),
      },
    },
  });
  const operation = {
    id: connection.id,
    expectedRevisionId: connection.revisionId ?? '',
    operationId: randomUUID(),
  };
  const requests: Array<{ url: string; headers: Headers; body: string }> = [];
  const browserUrls: URL[] = [];
  let tokenCalls = 0;
  let refreshCalls = 0;
  let refreshFailure = false;
  let refreshGate: Promise<void> | undefined;
  let browserAction: ((url: URL) => Promise<void>) | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const headers = new Headers(init?.headers);
    const body = String(init?.body ?? '');
    requests.push({ url, headers, body });
    if (url === 'https://mcp.example/mcp')
      return new Response(null, {
        status: 401,
        headers: {
          'www-authenticate':
            'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource/mcp", scope="report.read"',
        },
      });
    if (url.includes('oauth-protected-resource'))
      return Response.json({
        resource: options.resource ?? 'https://mcp.example/mcp',
        authorization_servers: ['https://auth.example'],
        scopes_supported: ['report.read'],
      });
    if (url.includes('oauth-authorization-server'))
      return Response.json({
        client_id_metadata_document_supported: options.clientMetadata ?? false,
        issuer: options.metadataIssuer ?? 'https://auth.example',
        authorization_endpoint: 'https://auth.example/authorize',
        token_endpoint: 'https://auth.example/token',
        registration_endpoint: 'https://auth.example/register',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        code_challenge_methods_supported: options.pkce === false ? ['plain'] : ['S256'],
        authorization_response_iss_parameter_supported: true,
      });
    if (url === 'https://auth.example/register')
      return Response.json({
        client_id: 'dynamic-client',
        client_id_issued_at: 1,
        redirect_uris: (JSON.parse(body) as { redirect_uris: string[] }).redirect_uris,
        token_endpoint_auth_method: 'none',
      });
    if (url === 'https://client.example/oauth/client.json')
      return Response.json({
        client_id: url,
        redirect_uris: [`http://127.0.0.1:${options.callbackPort ?? 1}/mcp/oauth/callback`],
      });
    if (url === 'https://auth.example/token') {
      const params = new URLSearchParams(body);
      if (params.get('grant_type') === 'refresh_token') {
        refreshCalls += 1;
        await refreshGate;
        if (refreshFailure) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return Response.json({
          access_token: 'refreshed-secret',
          token_type: 'Bearer',
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
          scope: 'report.read',
        });
      }
      tokenCalls += 1;
      return Response.json({
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        token_type: 'Bearer',
        expires_in: options.expiresIn ?? 3600,
        scope: 'report.read',
      });
    }
    return new Response(null, { status: 404 });
  };
  const service = new McpOAuthService(store, {
    fetch,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    openBrowser: async (raw) => {
      const url = new URL(raw);
      browserUrls.push(url);
      if (browserAction) return browserAction(url);
      const callback = new URL(url.searchParams.get('redirect_uri') ?? '');
      callback.searchParams.set(
        'state',
        options.wrongState ? 'attacker-state' : (url.searchParams.get('state') ?? ''),
      );
      callback.searchParams.set(
        'iss',
        options.wrongIssuer ? 'https://evil.example' : 'https://auth.example',
      );
      callback.searchParams.set('code', 'one-time-code');
      const response = await globalThis.fetch(callback);
      await response.text();
    },
  });
  opened.push({ store, service });
  const login = async () => {
    await service.prepare(operation);
    await service.login({ ...operation, issuer: 'https://auth.example', consent: true });
  };
  return {
    store,
    service,
    connection,
    operation,
    requests,
    browserUrls,
    login,
    tokenCalls: () => tokenCalls,
    refreshCalls: () => refreshCalls,
    failRefresh: () => {
      refreshFailure = true;
    },
    gateRefresh: (value: Promise<void>) => {
      refreshGate = value;
    },
    onBrowser: (value: (url: URL) => Promise<void>) => {
      browserAction = value;
    },
  };
};

describe('MCP OAuth browser flow', () => {
  it('rehydrates an encrypted authorization in a fresh service without another browser login', async () => {
    const f = await fixture();
    await f.login();
    f.service.shutdown();
    const rehydrated = new McpOAuthService(f.store, {});
    try {
      expect(rehydrated.summary(f.connection).oauthStatus).toBe('authorized');
      expect(await rehydrated.accessToken(f.connection, new AbortController().signal)).toBe(
        'access-secret',
      );
      expect(f.browserUrls).toHaveLength(1);
      expect(rehydrated.activeSecrets(f.connection.id)).toContain('access-secret');
    } finally {
      rehydrated.shutdown();
    }
  });

  it('uses a verified client metadata document and exact registered loopback port instead of DCR', async () => {
    const listener = createServer();
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Missing callback port');
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    const f = await fixture({ dynamic: true, clientMetadata: true, callbackPort: address.port });
    await f.login();
    expect(f.browserUrls[0]?.searchParams.get('client_id')).toBe(
      'https://client.example/oauth/client.json',
    );
    expect(f.requests.some((request) => request.url.endsWith('/register'))).toBe(false);
    const mismatched = await fixture({ dynamic: true, clientMetadata: true });
    await expect(mismatched.login()).rejects.toThrow();
    expect(mismatched.tokenCalls()).toBe(0);
  });

  it.each([false, true])(
    'uses PKCE, resource, issuer and sealed owner slots; dynamic registration=%s',
    async (dynamic) => {
      const f = await fixture({ dynamic });
      await f.login();
      const url = f.browserUrls[0];
      expect(url?.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url?.searchParams.get('state')).toHaveLength(43);
      const tokenRequest = f.requests.find((request) => request.url.endsWith('/token'));
      const params = new URLSearchParams(tokenRequest?.body);
      expect(params.get('resource')).toBe('https://mcp.example/mcp');
      expect(params.get('code_verifier')?.length).toBeGreaterThanOrEqual(43);
      expect(params.get('client_id')).toBe(dynamic ? 'dynamic-client' : 'registered-client');
      expect(
        f.requests
          .filter((request) => request.url.includes('.well-known'))
          .every((request) => !request.headers.has('authorization')),
      ).toBe(true);
      expect(await f.service.accessToken(f.connection, new AbortController().signal)).toBe(
        'access-secret',
      );
      expect(
        JSON.stringify(
          f.service.summary(f.store.mcpConnections.get(f.connection.id) ?? f.connection),
        ),
      ).not.toContain('access-secret');
      expect(f.service.summary(f.connection).oauthStatus).toBe('authorized');
      await f.service.logout(f.connection.id);
      expect(f.service.summary(f.connection).oauthStatus).toBe('signed-out');
      await expect(
        f.service.accessToken(f.connection, new AbortController().signal),
      ).rejects.toThrow();
    },
  );

  it.each([
    { wrongState: true },
    { wrongIssuer: true },
    { pkce: false },
    { metadataIssuer: 'https://evil.example' },
    { resource: 'https://other.example/mcp' },
  ])('rejects invalid identity and security metadata %j before storing tokens', async (options) => {
    const f = await fixture(options);
    await expect(f.login()).rejects.toThrow();
    expect(f.tokenCalls()).toBe(0);
    expect(f.service.summary(f.connection).oauthStatus).toBe('signed-out');
  });

  it('cancels browser handoff and refuses a late callback without writing a grant', async () => {
    const f = await fixture();
    let openedBrowser: (() => void) | undefined;
    const browser = new Promise<void>((resolve) => {
      openedBrowser = resolve;
    });
    f.onBrowser(async () => {
      openedBrowser?.();
    });
    const pending = f.login();
    await browser;
    expect(f.service.cancel(f.operation)).toBe(true);
    await expect(pending).rejects.toThrow();
    const redirect = f.browserUrls[0]?.searchParams.get('redirect_uri');
    if (!redirect) throw new Error('Missing redirect');
    await expect(globalThis.fetch(redirect)).rejects.toThrow();
    expect(f.tokenCalls()).toBe(0);
    expect(
      f.store.mcpConnections.authorization(f.connection.id, f.operation.expectedRevisionId),
    ).toBeUndefined();
  });

  it('coalesces refresh, keeps another waiter alive when one Run cancels, and detects invalid_grant', async () => {
    const f = await fixture({ expiresIn: 0 });
    await f.login();
    let release: (() => void) | undefined;
    f.gateRefresh(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const cancelled = new AbortController();
    const a = f.service.accessToken(f.connection, cancelled.signal);
    const b = f.service.accessToken(f.connection, new AbortController().signal);
    cancelled.abort();
    await expect(a).rejects.toThrow();
    release?.();
    expect(await b).toBe('refreshed-secret');
    expect(f.refreshCalls()).toBe(1);
    const invalid = await fixture({ expiresIn: 0 });
    await invalid.login();
    invalid.failRefresh();
    await expect(
      invalid.service.accessToken(invalid.connection, new AbortController().signal),
    ).rejects.toThrow();
    expect(invalid.service.summary(invalid.connection).oauthStatus).toBe(
      'reauthorization-required',
    );
  });

  it('rejects a grant when configuration changes before token exchange completes', async () => {
    const f = await fixture();
    f.onBrowser(async (url) => {
      f.store.mcpConnections.save({
        id: f.connection.id,
        expectedRevisionId: f.operation.expectedRevisionId,
        name: 'Edited',
        transport: f.connection.transport,
      });
      const callback = new URL(url.searchParams.get('redirect_uri') ?? '');
      callback.searchParams.set('state', url.searchParams.get('state') ?? '');
      callback.searchParams.set('iss', 'https://auth.example');
      callback.searchParams.set('code', 'code');
      await (await globalThis.fetch(callback)).text();
    });
    await expect(f.login()).rejects.toThrow();
    expect(
      f.store.mcpConnections.get(f.connection.id)?.credentialSlots?.some((slot) => slot.configured),
    ).toBe(false);
  });
});
