import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { McpToolBinding } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

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
