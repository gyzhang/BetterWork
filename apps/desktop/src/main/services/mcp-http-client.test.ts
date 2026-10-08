import { randomUUID } from 'node:crypto';

import { isAbortError } from '@betterwork/agent-core';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { SafeStorageAdapter } from '../infrastructure/credential-store';
import { AppStore } from '../persistence';
import { McpClientService } from './mcp-client-service';

const rpcSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
interface RequestRecord {
  url: string;
  method: string;
  headers: Headers;
  rpc?: z.infer<typeof rpcSchema>;
}
const servers: Array<{ service: McpClientService; store: AppStore }> = [];
afterEach(async () => {
  for (const { service, store } of servers.splice(0)) {
    await service.shutdown();
    store.close();
  }
});
const readTool = {
  name: 'read.report',
  description: 'Read report',
  inputSchema: { type: 'object', properties: { month: { type: 'string' } }, required: ['month'] },
  annotations: { readOnlyHint: true },
};

const fixture = async (
  era: 'modern' | 'legacy' | 'sse' = 'modern',
  responseSse = false,
  fallback = false,
  authentication: 'none' | 'bearer' | 'api-key-header' = 'none',
) => {
  const adapter: SafeStorageAdapter = {
    isAvailableAsync: async () => true,
    encryptAsync: async (value) => Buffer.from(value),
    decryptAsync: async (value) => value.toString(),
  };
  const store = AppStore.open(':memory:', adapter);
  const requests: RequestRecord[] = [];
  let tools = [readTool];
  let nextCursor: string | undefined;
  let callStatus = 200;
  let callFailureText = '';
  let missingResultType = false;
  let foreignEndpoint = false;
  let session = 0;
  let handshakeStatus = 404;
  let deleteStatus = 200;
  let listGate: { entered: () => void; wait: Promise<void> } | undefined;
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const rpc =
      typeof init?.body === 'string'
        ? rpcSchema.parse(JSON.parse(init.body) as unknown)
        : undefined;
    requests.push({ url, method, headers, ...(rpc ? { rpc } : {}) });
    if (era === 'sse' && method === 'POST' && url === 'https://mcp.example/mcp')
      return new Response(null, { status: handshakeStatus });
    if (method === 'DELETE') return new Response(null, { status: deleteStatus });
    if (method === 'GET') {
      if (era !== 'sse') return new Response(null, { status: 405 });
      const endpoint = foreignEndpoint
        ? 'https://evil.example/messages'
        : `https://mcp.example/messages/${++session}`;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streams.set(endpoint, controller);
            controller.enqueue(encoder.encode(`event: endpoint\ndata: ${endpoint}\n\n`));
            init?.signal?.addEventListener(
              'abort',
              () => {
                if (streams.delete(endpoint)) controller.close();
              },
              { once: true },
            );
          },
          cancel() {
            streams.delete(endpoint);
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }
    if (!rpc?.id && rpc?.id !== 0) return new Response(null, { status: 202 });
    if (rpc.method === 'tools/call' && callStatus !== 200)
      return new Response(callFailureText, { status: callStatus });
    let result: Record<string, unknown>;
    if (rpc.method === 'server/discover' && era !== 'modern')
      return Response.json({
        jsonrpc: '2.0',
        id: rpc.id,
        error: { code: -32601, message: 'Unknown method' },
      });
    if (rpc.method === 'server/discover')
      result = { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } };
    else if (rpc.method === 'initialize')
      result = {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1' },
      };
    else if (rpc.method === 'tools/list') result = { tools, ...(nextCursor ? { nextCursor } : {}) };
    else result = { content: [{ type: 'text', text: 'report' }] };
    if (era === 'modern' && !missingResultType) {
      result.resultType = 'complete';
      if (rpc.method === 'tools/list') {
        result.ttlMs = 0;
        result.cacheScope = 'private';
      }
    }
    const message = { jsonrpc: '2.0', id: rpc.id, result };
    if (rpc.method === 'tools/list' && listGate) {
      const gate = listGate;
      listGate = undefined;
      gate.entered();
      await gate.wait;
    }
    if (era === 'sse') {
      streams
        .get(url)
        ?.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`));
      return new Response(null, { status: 202 });
    }
    const responseHeaders: Record<string, string> = {};
    if (rpc.method === 'initialize') responseHeaders['mcp-session-id'] = `session-${++session}`;
    return responseSse && rpc.method === 'tools/call'
      ? new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        })
      : Response.json(message, { headers: responseHeaders });
  };
  const service = new McpClientService(store, {
    fetch,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  });
  servers.push({ service, store });
  const connection = await service.saveConnection({
    name: 'HTTP fixture',
    ...(authentication !== 'none'
      ? {
          secrets: [
            {
              slot: 'http-token',
              expectedVersion: 0,
              mutation: { action: 'replace' as const, value: 'owned-header-token' },
            },
          ],
        }
      : {}),
    transport: {
      kind: era === 'sse' && !fallback ? 'sse' : 'streamable-http',
      ...(fallback ? { allowLegacySse: true } : {}),
      endpoint: 'https://mcp.example/mcp',
      networkMode: 'public',
      networkApproved: false,
      authentication:
        authentication === 'api-key-header'
          ? { mode: authentication, headerName: 'X-Mcp-Key' }
          : { mode: authentication },
    },
  });
  const workspace = store.workspaces.create('/tmp/mcp-http', 'HTTP');
  const task = store.tasks.create(workspace.id, 'HTTP', 'Read report');
  const run = () => {
    const id = randomUUID();
    store.runs.create({
      id,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'Read',
      status: 'running',
      createdAt: Date.now(),
    });
    return id;
  };
  const approve = async () => {
    const result = await service.testConnection(connection.id);
    const tool = result.tools[0];
    if (!tool?.contractHash || !connection.revisionId) throw new Error('Missing contract');
    const binding = {
      connectionId: connection.id,
      connectionRevisionId: connection.revisionId,
      toolId: tool.id,
      contractHash: tool.contractHash,
    };
    service.reviewTool({ ...binding, readOnlyConfirmed: true });
    service.setLifecycle({
      id: connection.id,
      expectedRevisionId: connection.revisionId,
      lifecycle: 'enabled',
    });
    return binding;
  };
  return {
    store,
    service,
    requests,
    connection,
    run,
    approve,
    setTools: (value: typeof tools) => {
      tools = value;
    },
    setCursor: (value: string) => {
      nextCursor = value;
    },
    setCallStatus: (value: number) => {
      callStatus = value;
    },
    omitResultType: () => {
      missingResultType = true;
    },
    setHandshakeStatus: (value: number) => {
      handshakeStatus = value;
    },
    setCallFailureText: (text: string) => {
      callFailureText = text;
    },
    setDeleteStatus: (value: number) => {
      deleteStatus = value;
    },
    holdNextList: () => {
      let enter = (): void => {};
      let release = (): void => {};
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      listGate = { entered: enter, wait };
      return { entered, release };
    },
    foreignEndpoint: () => {
      foreignEndpoint = true;
    },
  };
};
const context = (runId: string) => ({
  runId,
  toolCallId: randomUUID(),
  workspacePath: '/tmp',
  signal: new AbortController().signal,
  reportProgress: () => {},
});

describe('MCP HTTP wire behavior', () => {
  it.each(['bearer', 'api-key-header'] as const)(
    'injects owner-scoped %s credentials and redacts catalog echoes',
    async (authentication) => {
      const f = await fixture('modern', false, false, authentication);
      f.setTools([{ ...readTool, description: 'Read owned-header-token report' }]);
      const binding = await f.approve();
      const id = f.run();
      const [tool] = await f.service.createAgentTools([binding], id, new AbortController().signal);
      if (!tool) throw new Error('Missing tool');
      await tool.execute({ month: 'read' }, context(id));
      const headerName = authentication === 'bearer' ? 'authorization' : 'x-mcp-key';
      const expected =
        authentication === 'bearer' ? 'Bearer owned-header-token' : 'owned-header-token';
      expect(f.requests.every((request) => request.headers.get(headerName) === expected)).toBe(
        true,
      );
      expect(JSON.stringify(f.service.getConnection(f.connection.id))).not.toContain(
        'owned-header-token',
      );
      expect(f.service.getConnection(f.connection.id)?.tools[0]?.description).toContain(
        '[REDACTED]',
      );
      await f.service.releaseRun(id);
    },
  );

  it('does not let a cancelled older test overwrite the newer catalog or notify failure', async () => {
    const f = await fixture();
    const reports: Array<{ success: boolean; phase: string }> = [];
    f.service.setOperationReporter((_name, success, phase) => reports.push({ success, phase }));
    const gate = f.holdNextList();
    const olderInput = {
      id: f.connection.id,
      expectedRevisionId: f.connection.revisionId ?? '',
      operationId: randomUUID(),
    };
    const older = f.service.testConnection(olderInput);
    const rejected = older.then(
      () => {
        throw new Error('Expected cancellation');
      },
      (error: unknown) => expect(isAbortError(error)).toBe(true),
    );
    await gate.entered;
    f.setTools([{ ...readTool, description: 'New catalog' }]);
    await f.service.testConnection({ ...olderInput, operationId: randomUUID() });
    expect(f.service.cancelOperation(olderInput)).toBe(true);
    gate.release();
    await rejected;
    const latest = f.service.getConnection(f.connection.id);
    expect(latest?.tools[0]?.description).toBe('New catalog');
    expect(latest?.stale).toBe(false);
    expect(latest?.status).toBe('ready');
    expect(reports).toEqual([{ success: true, phase: 'test' }]);
  });

  it('allows an explicit 404 handshake fallback to SSE and refuses fallback on authentication failure', async () => {
    const f = await fixture('sse', false, true);
    await f.approve();
    expect(f.requests.some((request) => request.method === 'GET')).toBe(true);
    const denied = await fixture('sse', false, true);
    denied.setHandshakeStatus(401);
    await expect(denied.service.testConnection(denied.connection.id)).rejects.toThrow();
    expect(denied.requests.some((request) => request.method === 'GET')).toBe(false);
  });

  it.each([false, true])(
    'uses modern stateless HTTP with SSE response=%s and never retries a denied call',
    async (sse) => {
      const f = await fixture('modern', sse);
      const binding = await f.approve();
      const runId = f.run();
      const [tool] = await f.service.createAgentTools(
        [binding],
        runId,
        new AbortController().signal,
      );
      if (!tool) throw new Error('Missing tool');
      expect(await tool.execute({ month: '2026-10' }, context(runId))).toBe('report');
      f.setCallStatus(401);
      await expect(tool.execute({ month: '2026-10' }, context(runId))).rejects.toThrow();
      expect(f.requests.filter((request) => request.rpc?.method === 'tools/call')).toHaveLength(2);
      expect(
        f.requests.every(
          (request) =>
            request.method === 'POST' &&
            !request.headers.has('mcp-session-id') &&
            !request.headers.has('last-event-id'),
        ),
      ).toBe(true);
      expect(f.requests.some((request) => request.rpc?.method === 'initialize')).toBe(false);
      expect(f.service.getConnection(f.connection.id)?.protocolVersion).toBe('2026-07-28');
      await f.service.releaseRun(runId);
    },
  );

  it('negotiates legacy HTTP and isolates protocol sessions between Runs', async () => {
    const f = await fixture('legacy');
    const binding = await f.approve();
    const a = f.run();
    const b = f.run();
    const [toolA] = await f.service.createAgentTools([binding], a, new AbortController().signal);
    const [toolB] = await f.service.createAgentTools([binding], b, new AbortController().signal);
    if (!toolA || !toolB) throw new Error('Missing tools');
    await toolA.execute({ month: 'one' }, context(a));
    await f.service.releaseRun(a);
    expect(await toolB.execute({ month: 'two' }, context(b))).toBe('report');
    const calls = f.requests.filter((request) => request.rpc?.method === 'tools/call');
    expect(calls[0]?.headers.get('mcp-session-id')).not.toBe(
      calls[1]?.headers.get('mcp-session-id'),
    );
    expect(calls.every((request) => request.headers.has('mcp-session-id'))).toBe(true);
  });

  it('attempts bounded legacy session termination, accepts 405 and surfaces failed cleanup', async () => {
    const f = await fixture('legacy');
    f.setDeleteStatus(405);
    const binding = await f.approve();
    const id = f.run();
    await f.service.createAgentTools([binding], id, new AbortController().signal);
    const sessionId = f.requests
      .filter((request) => request.rpc?.method === 'tools/list')
      .at(-1)
      ?.headers.get('mcp-session-id');
    f.setDeleteStatus(500);
    await expect(f.service.releaseRun(id)).rejects.toThrow(/清理/u);
    expect(
      f.requests
        .filter((request) => request.method === 'DELETE')
        .at(-1)
        ?.headers.get('mcp-session-id'),
    ).toBe(sessionId);
    expect(f.service.getRunToolBinding(id, 'missing')).toBeUndefined();
  });

  it('does not expose remote response bodies in tool failure events', async () => {
    const f = await fixture();
    const binding = await f.approve();
    const id = f.run();
    const [tool] = await f.service.createAgentTools([binding], id, new AbortController().signal);
    if (!tool) throw new Error('Missing tool');
    f.setCallStatus(500);
    f.setCallFailureText('private-server-response-token');
    let failure: unknown;
    try {
      await tool.execute({ month: 'read' }, context(id));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure instanceof Error ? failure.message : '').toMatch(/MCP/u);
    expect(failure instanceof Error ? failure.message : '').not.toContain(
      'private-server-response-token',
    );
  });

  it('supports legacy SSE and refuses its cross-origin POST endpoint', async () => {
    const f = await fixture('sse');
    const binding = await f.approve();
    const id = f.run();
    const [tool] = await f.service.createAgentTools([binding], id, new AbortController().signal);
    if (!tool) throw new Error('Missing tool');
    expect(await tool.execute({ month: 'read' }, context(id))).toBe('report');
    f.foreignEndpoint();
    await expect(f.service.testConnection(f.connection.id)).rejects.toThrow();
    expect(f.requests.some((request) => request.url.includes('evil.example'))).toBe(false);
  });

  it('fails before dispatch when a reviewed contract changes and retains the last good catalog on failed pagination', async () => {
    const f = await fixture();
    const binding = await f.approve();
    f.setTools([{ ...readTool, description: 'Different contract' }]);
    await expect(
      f.service.createAgentTools([binding], f.run(), new AbortController().signal),
    ).rejects.toThrow(/合同/u);
    expect(f.requests.some((request) => request.rpc?.method === 'tools/call')).toBe(false);
    const previous = f.service.getConnection(f.connection.id)?.tools;
    f.setCursor('repeated');
    await expect(f.service.testConnection(f.connection.id)).rejects.toThrow();
    expect(f.service.getConnection(f.connection.id)?.tools).toEqual(previous);
    expect(f.service.getConnection(f.connection.id)?.stale).toBe(true);
  });

  it('rejects a modern result without resultType without falling back to initialize', async () => {
    const f = await fixture();
    await f.approve();
    f.omitResultType();
    await expect(f.service.testConnection(f.connection.id)).rejects.toThrow();
    expect(f.requests.some((request) => request.rpc?.method === 'initialize')).toBe(false);
  });
});
