import { randomUUID } from 'node:crypto';

import type { McpToolBinding } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

let store: AppStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
});
const fixture = () => {
  const db = AppStore.open(':memory:');
  store = db;
  const repo = db.mcpConnections;
  const connection = repo.save({
    name: 'Original',
    transport: {
      kind: 'stdio',
      command: 'node',
      args: ['server.mjs', 'a b'],
      env: [{ name: 'API_KEY', secret: true }],
    },
  });
  if (!connection.revisionId) throw new Error('Missing revision');
  return { db, repo, connection, revisionId: connection.revisionId };
};
describe('MCP immutable configuration and review repository', () => {
  it('uses revision CAS, keeps snapshots immutable and creates disabled drafts', () => {
    const f = fixture();
    expect(f.connection.lifecycle).toBe('disabled');
    const next = f.repo.save({
      id: f.connection.id,
      expectedRevisionId: f.revisionId,
      name: 'Edited',
      transport: f.connection.transport,
    });
    expect(next.revision).toBe(2);
    expect(f.repo.get(f.connection.id, f.revisionId)?.name).toBe('Original');
    expect(() =>
      f.repo.save({
        id: f.connection.id,
        expectedRevisionId: f.revisionId,
        name: 'Stale',
        transport: f.connection.transport,
      }),
    ).toThrow();
    expect(() => f.repo.get(f.connection.id, 'foreign-revision')).toThrow();
    expect(f.repo.get(f.connection.id)?.name).toBe('Edited');
  });

  it('binds review to an exact visible contract and preserves history after archival', () => {
    const f = fixture();
    const hash = 'a'.repeat(64);
    const tool = {
      id: `${f.connection.id}/read`,
      connectionId: f.connection.id,
      name: 'read',
      description: 'Read',
      inputSchema: { type: 'object' },
      schemaHash: hash,
      contractHash: hash,
      discoveredAt: 1,
    };
    f.repo.updateDiscovery(
      f.connection.id,
      { status: 'ready', tools: [tool], lastCheckedAt: 1 },
      f.revisionId,
    );
    const binding: McpToolBinding = {
      connectionId: f.connection.id,
      connectionRevisionId: f.revisionId,
      toolId: tool.id,
      contractHash: hash,
    };
    expect(f.repo.isReviewed(binding)).toBe(false);
    f.repo.review({
      ...binding,
      connectionRevisionId: f.revisionId,
      contractHash: hash,
      userConfirmed: true,
    });
    expect(f.repo.isReviewed(binding)).toBe(true);
    const workspace = f.db.workspaces.create('/tmp/mcp-repository', 'Repository');
    const task = f.db.tasks.create(workspace.id, 'Read', 'Read');
    const runId = randomUUID();
    f.db.runs.create({
      id: runId,
      taskId: task.task.id,
      sessionId: task.sessionId,
      status: 'running',
      prompt: 'Read',
      createdAt: 1,
    });
    f.repo.saveRunBinding(runId, binding, 'mcp_alias', { 'http-token': 2 });
    f.repo.updateDiscovery(
      f.connection.id,
      {
        status: 'ready',
        tools: [{ ...tool, contractHash: 'b'.repeat(64), annotations: { destructiveHint: true } }],
        lastCheckedAt: 2,
      },
      f.revisionId,
    );
    const changedBinding = { ...binding, contractHash: 'b'.repeat(64) };
    f.repo.review({
      ...changedBinding,
      connectionRevisionId: f.revisionId,
      userConfirmed: true,
    });
    expect(f.repo.isReviewed(changedBinding)).toBe(true);
    f.repo.delete(f.connection.id, f.revisionId);
    expect(f.repo.list()).toEqual([]);
    expect(f.repo.get(f.connection.id, f.revisionId)?.lifecycle).toBe('archived');
    expect(f.repo.affectedReferences(f.connection.id)).toBe(1);
    expect(f.db.runs.get(runId)).toBeDefined();
  });
});
