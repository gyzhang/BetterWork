import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isAbortError } from '@betterwork/agent-core';
import type { McpToolBinding } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SafeStorageAdapter } from '../infrastructure/credential-store';
import { AppStore } from '../persistence';
import { McpClientService } from './mcp-client-service';

const stores: AppStore[] = [];
const services: McpClientService[] = [];
const fixturePath = path.resolve(process.cwd(), 'scripts/fixtures/mcp-finance-readonly-server.mjs');
afterEach(async () => {
  for (const service of services.splice(0)) await service.shutdown();
  for (const store of stores.splice(0)) store.close();
});

const fixture = async () => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const service = new McpClientService(store);
  services.push(service);
  const connection = await service.saveConnection({
    name: '财务替身',
    transport: { kind: 'stdio', command: process.execPath, args: [fixturePath] },
  });
  const discovered = await service.testConnection(connection.id);
  const tool = discovered.tools[0];
  if (!tool?.contractHash || !connection.revisionId)
    throw new Error('Missing MCP fixture contract');
  const binding: McpToolBinding = {
    connectionId: connection.id,
    connectionRevisionId: connection.revisionId,
    toolId: tool.id,
    contractHash: tool.contractHash,
  };
  const workspace = store.workspaces.create('/tmp/mcp-test', 'MCP test');
  const task = store.tasks.create(workspace.id, 'MCP test', 'Read finance');
  const createRun = (): string => {
    const id = randomUUID();
    store.runs.create({
      id,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'Read finance',
      status: 'running',
      createdAt: Date.now(),
    });
    return id;
  };
  const approve = (): void => {
    service.reviewTool({
      ...binding,
      connectionRevisionId: connection.revisionId ?? '',
      contractHash: tool.contractHash ?? '',
      userConfirmed: true,
    });
    service.setLifecycle({
      id: connection.id,
      expectedRevisionId: connection.revisionId ?? '',
      lifecycle: 'enabled',
    });
  };
  return { store, service, connection, tool, binding, createRun, approve };
};
const context = (runId: string, signal = new AbortController().signal) => ({
  runId,
  toolCallId: randomUUID(),
  workspacePath: '/tmp',
  signal,
  reportProgress: () => undefined,
});

describe('McpClientService', () => {
  it('joins pending credential persistence before storage closes', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const encrypt = vi.fn(async (value: string) => {
      await gate;
      return Buffer.from(value);
    });
    const store = AppStore.open(':memory:', {
      isAvailableAsync: async () => true,
      encryptAsync: encrypt,
      decryptAsync: async (value) => value.toString(),
    });
    stores.push(store);
    const service = new McpClientService(store);
    services.push(service);
    const input = {
      name: 'Credential shutdown fixture',
      transport: {
        kind: 'stdio' as const,
        command: process.execPath,
        args: [],
        env: [{ name: 'TOKEN', secret: true }],
      },
      secrets: [
        {
          slot: 'env:TOKEN',
          expectedVersion: 0,
          mutation: { action: 'replace' as const, value: 'synthetic-token' },
        },
      ],
    };
    const saving = service.saveConnection(input);
    await vi.waitFor(() => expect(encrypt).toHaveBeenCalledOnce());
    let finished = false;
    const shutdown = service.shutdown().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await Promise.all([saving, shutdown]);
    store.close();
    stores.splice(stores.indexOf(store), 1);
    await expect(service.saveConnection(input)).rejects.toThrow('退出');
    await service.shutdown();
  });
  it('waits for a cancelled detection to finish before storage closes', async () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requestSignal: AbortSignal | undefined;
    const resolveBundledRuntime = vi.fn(
      async (_serverId: string, _args: readonly string[], signal: AbortSignal) => {
        requestSignal = signal;
        await gate;
        signal.throwIfAborted();
        return { command: process.execPath, args: [fixturePath] };
      },
    );
    const service = new McpClientService(store, { resolveBundledRuntime });
    services.push(service);
    const connection = await service.saveConnection({
      name: 'Shutdown fixture',
      transport: { kind: 'stdio', runtime: { kind: 'bundled', serverId: 'memory' }, args: [] },
    });
    const testing = service.testConnection(connection.id);
    const failure = expect(testing).rejects.toSatisfy(isAbortError);
    await vi.waitFor(() => expect(resolveBundledRuntime).toHaveBeenCalledOnce());
    let finished = false;
    const shutdown = service.shutdown().then(() => {
      finished = true;
    });
    expect(requestSignal?.aborted).toBe(true);
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await Promise.all([shutdown, failure]);
    expect(service.getConnection(connection.id)?.failureMessage).toContain('取消');
    store.close();
    stores.splice(stores.indexOf(store), 1);
    await service.shutdown();
    await expect(service.testConnection(connection.id)).rejects.toThrow('退出');
    expect(resolveBundledRuntime).toHaveBeenCalledOnce();
  });
  it('atomically clears every owned credential when archiving a connection while retaining its revision', async () => {
    const adapter: SafeStorageAdapter = {
      isAvailableAsync: async () => true,
      encryptAsync: async (value) => Buffer.from(value),
      decryptAsync: async (value) => value.toString(),
    };
    const store = AppStore.open(':memory:', adapter);
    stores.push(store);
    const service = new McpClientService(store);
    services.push(service);
    const connection = await service.saveConnection({
      name: 'Archive fixture',
      transport: {
        kind: 'stdio',
        command: process.execPath,
        args: [],
        env: [{ name: 'API_TOKEN', secret: true }],
      },
      secrets: [
        {
          slot: 'env:API_TOKEN',
          expectedVersion: 0,
          mutation: { action: 'replace', value: 'private-token' },
        },
      ],
    });
    expect(connection.credentialSlots?.[0]?.configured).toBe(true);
    await expect(service.deleteConnection(connection.id, 'stale-revision')).rejects.toThrow();
    expect(service.getConnection(connection.id)?.credentialSlots?.[0]?.configured).toBe(true);
    expect(await service.deleteConnection(connection.id, connection.revisionId)).toBe(true);
    const archived = service.getConnection(connection.id);
    expect(archived?.lifecycle).toBe('archived');
    expect(archived?.revisionId).toBe(connection.revisionId);
    expect(archived?.credentialSlots?.every((slot) => !slot.configured)).toBe(true);
    expect(service.listConnections()).toEqual([]);
  });

  it('filters the production guardian environment and forwards only safe defaults and explicit configuration', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mcp-environment-'));
    try {
      const store = AppStore.open(':memory:');
      stores.push(store);
      const service = new McpClientService(store, {
        guardian: {
          executable: process.execPath,
          scriptPath: path.resolve('apps/desktop/src/main/infrastructure/skill-guardian.ts'),
          env: {
            ...process.env,
            MCP_PARENT_SECRET: 'must-not-inherit',
            NODE_OPTIONS: '--no-warnings',
          },
        },
      });
      services.push(service);
      const envFile = path.join(directory, 'env.json');
      const saved = await service.saveConnection({
        name: 'Environment fixture',
        transport: {
          kind: 'stdio',
          command: process.execPath,
          args: [fixturePath, '--modern'],
          env: [
            { name: 'MCP_FIXTURE_ENV_FILE', value: envFile, secret: false },
            { name: 'MCP_EXPLICIT_VALUE', value: 'explicit', secret: false },
          ],
        },
      });
      await service.testConnection(saved.id);
      expect(JSON.parse(await readFile(envFile, 'utf8')) as unknown).toEqual({
        inheritedSecret: null,
        nodeOptions: null,
        electronNode: null,
        explicitValue: 'explicit',
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('sets Electron run-as-Node only on the bundled stdio target', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mcp-bundled-node-'));
    try {
      const store = AppStore.open(':memory:');
      stores.push(store);
      const service = new McpClientService(store, {
        guardian: {
          executable: process.execPath,
          scriptPath: path.resolve('apps/desktop/src/main/infrastructure/skill-guardian.ts'),
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        },
        resolveBundledRuntime: async (_serverId, args) => ({
          command: process.execPath,
          args: [fixturePath, ...args, '--modern'],
          runAsNode: true,
        }),
      });
      services.push(service);
      const envFile = path.join(directory, 'target-env.json');
      const connection = await service.saveConnection({
        name: 'Bundled runtime fixture',
        transport: {
          kind: 'stdio',
          runtime: { kind: 'bundled', serverId: 'memory' },
          args: [],
          env: [{ name: 'MCP_FIXTURE_ENV_FILE', value: envFile, secret: false }],
        },
      });

      await service.testConnection(connection.id);

      expect(JSON.parse(await readFile(envFile, 'utf8')) as unknown).toMatchObject({
        electronNode: '1',
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('surfaces an unsuccessful guardian cleanup acknowledgment', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mcp-cleanup-failure-'));
    try {
      const guardianPath = path.join(directory, 'guardian.mjs');
      await writeFile(
        guardianPath,
        `await import(${JSON.stringify(pathToFileURL(fixturePath).href)});\nprocess.stdin.on('end', () => process.stderr.write('BETTERWORK_MCP_CLEANUP_FAILED\\n'));\n`,
      );
      const store = AppStore.open(':memory:');
      stores.push(store);
      const service = new McpClientService(store, {
        guardian: { executable: process.execPath, scriptPath: guardianPath },
      });
      services.push(service);
      const connection = await service.saveConnection({
        name: 'Cleanup failure fixture',
        transport: { kind: 'stdio', command: process.execPath, args: [] },
      });
      await expect(service.testConnection(connection.id)).rejects.toThrow(/清理/u);
      expect(service.getConnection(connection.id)?.status).toBe('failed');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('negotiates modern stdio without legacy initialize', async () => {
    const f = await fixture();
    const updated = await f.service.saveConnection({
      id: f.connection.id,
      expectedRevisionId: f.connection.revisionId,
      name: 'Modern',
      transport: { kind: 'stdio', command: process.execPath, args: [fixturePath, '--modern'] },
    });
    expect((await f.service.testConnection(updated.id)).connection.protocolVersion).toBe(
      '2026-07-28',
    );
  });

  it('cleans probe and runtime process groups when an old server exits on the modern probe', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mcp-guardian-'));
    try {
      const f = await fixture();
      const pidFile = path.join(directory, 'pids');
      const updated = await f.service.saveConnection({
        id: f.connection.id,
        expectedRevisionId: f.connection.revisionId,
        name: 'Probe cleanup',
        transport: {
          kind: 'stdio',
          command: process.execPath,
          args: [fixturePath, '--exit-on-probe'],
          env: [{ name: 'MCP_FIXTURE_PID_FILE', value: pidFile, secret: false }],
        },
      });
      await f.service.testConnection(updated.id);
      const pids = (await readFile(pidFile, 'utf8')).trim().split(/[\n,]/u).map(Number);
      expect(pids.length).toBeGreaterThanOrEqual(4);
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps detection disabled and rejects unreviewed legacy selections', async () => {
    const f = await fixture();
    expect(f.connection.lifecycle).toBe('disabled');
    expect(f.store.mcpConnections.get(f.connection.id)?.tools[0]?.reviewed).toBe(false);
    await expect(
      f.service.createAgentTools(
        [{ connectionId: f.connection.id, toolId: f.tool.id }],
        f.createRun(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('审阅');
  });
  it('discovers and calls only an explicitly reviewed contract through a Run-owned client', async () => {
    const f = await fixture();
    f.approve();
    const runId = f.createRun();
    const tools = await f.service.createAgentTools(
      [f.binding],
      runId,
      new AbortController().signal,
    );
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toHaveLength(64);
    const output = await tools[0]?.execute({ month: '2026-08' }, context(runId));
    expect(output).toEqual(
      JSON.stringify({
        month: '2026-08',
        revenue: 1200000,
        cost: 760000,
        source: 'fixture-ledger',
      }),
    );
    await f.service.releaseRun(runId);
  });
  it('rejects invalid input, oversized text and structured output', async () => {
    const f = await fixture();
    f.approve();
    const runId = f.createRun();
    const tools = await f.service.createAgentTools(
      [f.binding],
      runId,
      new AbortController().signal,
    );
    await expect(tools[0]?.execute({ month: 'invalid-month' }, context(runId))).rejects.toThrow(
      '输入不符合',
    );
    await expect(tools[0]?.execute({ month: '2099-99' }, context(runId))).rejects.toThrow(
      '输出超过',
    );
    await expect(tools[0]?.execute({ month: '2099-98' }, context(runId))).rejects.toThrow(
      '输出超过',
    );
  });
  it('closing one Run preserves the other Run and detection client', async () => {
    const f = await fixture();
    f.approve();
    const a = f.createRun();
    const b = f.createRun();
    await f.service.createAgentTools([f.binding], a, new AbortController().signal);
    const tools = await f.service.createAgentTools([f.binding], b, new AbortController().signal);
    await f.service.releaseRun(a);
    await f.service.testConnection(f.connection.id);
    expect(await tools[0]?.execute({ month: '2026-08' }, context(b))).toContain('fixture-ledger');
  });
  it('ordinary revisions preserve a running snapshot; disable overrides it', async () => {
    const f = await fixture();
    f.approve();
    const runId = f.createRun();
    const tools = await f.service.createAgentTools(
      [f.binding],
      runId,
      new AbortController().signal,
    );
    const edited = await f.service.saveConnection({
      id: f.connection.id,
      expectedRevisionId: f.connection.revisionId,
      name: '新名称',
      transport: f.connection.transport,
    });
    expect(edited.revisionId).not.toBe(f.connection.revisionId);
    expect(await tools[0]?.execute({ month: '2026-08' }, context(runId))).toContain(
      'fixture-ledger',
    );
    f.service.setLifecycle({
      id: edited.id,
      expectedRevisionId: edited.revisionId ?? '',
      lifecycle: 'disabled',
    });
    await expect(tools[0]?.execute({ month: '2026-08' }, context(runId))).rejects.toThrow('撤销');
  });
});

describe('MCP safe diagnostics and operation ownership', () => {
  const failingRuntime = async (failure: unknown) => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const resolveBundledRuntime = vi.fn(async () => {
      throw failure;
    });
    const reporter = vi.fn();
    const service = new McpClientService(store, {
      resolveBundledRuntime,
      onOperationComplete: reporter,
    });
    services.push(service);
    const connection = await service.saveConnection({
      name: 'Failure fixture',
      transport: { kind: 'stdio', runtime: { kind: 'bundled', serverId: 'memory' }, args: [] },
    });
    if (!connection.revisionId) throw new Error('Missing connection revision');
    return {
      store,
      service,
      connection: { ...connection, revisionId: connection.revisionId },
      reporter,
      resolveBundledRuntime,
    };
  };

  it.each([
    [{ name: 'UnauthorizedError' }, '认证失败'],
    [{ name: 'UnsupportedProtocolVersionError' }, '协议版本不兼容'],
    [{ name: 'TimeoutError' }, '请求超时'],
    [{ status: 401 }, '认证失败'],
    [{ status: 403 }, '权限不足'],
    [{ data: { status: 429 } }, '请求过多'],
    [{ status: 404 }, '地址或旧会话已失效'],
    [{ code: 'CERT_HAS_EXPIRED' }, '证书校验失败'],
    [{ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }, '证书校验失败'],
    [{ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }, '证书校验失败'],
    [{ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }, '证书校验失败'],
    [{ code: 'SELF_SIGNED_CERT_IN_CHAIN' }, '证书校验失败'],
    [{ code: 'ENOTFOUND' }, '服务不可达'],
    [{ code: 'ECONNREFUSED' }, '服务不可达'],
    [{ code: 'EHOSTUNREACH' }, '服务不可达'],
    [{ code: 'ENETUNREACH' }, '服务不可达'],
    [{ cause: { status: 403 } }, '权限不足'],
    [{ code: 'OTHER' }, 'MCP 检测失败'],
    [null, 'MCP 检测失败'],
  ])('returns safe actionable diagnostics for %j', async (metadata, expected) => {
    const error =
      metadata === null
        ? 'private remote payload'
        : Object.assign(new Error('private remote payload'), metadata);
    const h = await failingRuntime(error);
    await expect(h.service.testConnection(h.connection.id)).rejects.toThrow(expected);
    const updated = h.service.getConnection(h.connection.id);
    expect(updated).toMatchObject({ status: 'failed', lifecycle: 'disabled' });
    expect(updated?.failureMessage).toContain(expected);
    expect(updated?.failureMessage).not.toContain('private remote payload');
    expect(h.reporter).toHaveBeenCalledExactlyOnceWith('Failure fixture', false, 'test');
    expect(h.service.listConnections()).toEqual([updated]);
    expect(h.service.getConnection('unknown')).toBeNull();
  });

  it('checks connection ownership before cancelling and joins the original operation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await failingRuntime(new Error('unused'));
    h.resolveBundledRuntime.mockImplementation(async () => {
      await gate;
      throw new Error('late private payload');
    });
    const operationId = randomUUID();
    const input = { id: h.connection.id, expectedRevisionId: h.connection.revisionId, operationId };
    const testing = h.service.testConnection(input);
    const rejected = expect(testing).rejects.toSatisfy(isAbortError);
    await vi.waitFor(() => expect(h.resolveBundledRuntime).toHaveBeenCalledOnce());
    await expect(h.service.testConnection(input)).rejects.toThrow('ID 已在使用中');
    expect(h.service.cancelOperation({ ...input, id: 'another-connection' })).toBe(false);
    expect(h.service.cancelOperation(input)).toBe(true);
    release();
    await rejected;
    expect(h.service.cancelOperation(input)).toBe(false);
    expect(h.service.getConnection(h.connection.id)?.failureMessage).toContain('已取消');
    expect(h.reporter).not.toHaveBeenCalled();
  });

  it('keeps the newest diagnostic when an older detection finishes later', async () => {
    let rejectOld!: (error: Error) => void;
    const h = await failingRuntime(new Error('unused'));
    h.resolveBundledRuntime.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    h.resolveBundledRuntime.mockRejectedValueOnce(
      Object.assign(new Error('private new payload'), { status: 403 }),
    );
    const old = h.service.testConnection(h.connection.id);
    const oldFailure = expect(old).rejects.toThrow('服务不可达');
    await vi.waitFor(() => expect(h.resolveBundledRuntime).toHaveBeenCalledOnce());
    await expect(h.service.testConnection(h.connection.id)).rejects.toThrow('权限不足');
    rejectOld(Object.assign(new Error('private old payload'), { code: 'ECONNREFUSED' }));
    await oldFailure;
    expect(h.service.getConnection(h.connection.id)?.failureMessage).toContain('权限不足');
  });

  it('rejects secret mutations outside the owning transport without writing a connection', async () => {
    const h = await failingRuntime(new Error('unused'));
    await expect(
      h.service.saveConnection({
        name: 'Invalid slot',
        transport: { kind: 'stdio', command: 'node', args: [] },
        secrets: [
          {
            slot: 'http-token',
            expectedVersion: 0,
            mutation: { action: 'replace', value: 'synthetic-token' },
          },
        ],
      }),
    ).rejects.toThrow('凭据槽位');
    expect(h.service.listConnections()).toHaveLength(1);
  });

  it('refuses protected secret writes when no credential store is configured', async () => {
    const h = await failingRuntime(new Error('unused'));
    await expect(
      h.service.saveConnection({
        name: 'Missing storage',
        transport: {
          kind: 'stdio',
          command: 'node',
          args: [],
          env: [{ name: 'TOKEN', secret: true }],
        },
        secrets: [
          {
            slot: 'env:TOKEN',
            expectedVersion: 0,
            mutation: { action: 'replace', value: 'synthetic-token' },
          },
        ],
      }),
    ).rejects.toThrow('受保护存储不可用');
    expect(h.service.listConnections()).toHaveLength(1);
  });

  it.each(['prepare', 'continue'] as const)(
    'reports a refused %s login without spawning a browser',
    async (operation) => {
      const h = await failingRuntime(new Error('unused'));
      const input = {
        id: h.connection.id,
        operationId: randomUUID(),
        expectedRevisionId: h.connection.revisionId,
      };
      const promise =
        operation === 'prepare'
          ? h.service.prepareLogin(input)
          : h.service.continueLogin({ ...input, issuer: 'https://issuer.example', consent: true });
      await expect(promise).rejects.toThrow();
      expect(h.reporter).toHaveBeenCalledExactlyOnceWith('Failure fixture', false, 'login');
      expect(h.resolveBundledRuntime).not.toHaveBeenCalled();
    },
  );

  it('logs out the current revision and refuses a stale revision', async () => {
    const h = await failingRuntime(new Error('unused'));
    await expect(
      h.service.logout({
        id: h.connection.id,
        operationId: randomUUID(),
        expectedRevisionId: 'stale',
      }),
    ).rejects.toThrow();
    const result = await h.service.logout({
      id: h.connection.id,
      operationId: randomUUID(),
      expectedRevisionId: h.connection.revisionId,
    });
    expect(result.id).toBe(h.connection.id);
    expect(result.lifecycle).toBe('disabled');
    expect(result.tools).toEqual([]);
  });
});
