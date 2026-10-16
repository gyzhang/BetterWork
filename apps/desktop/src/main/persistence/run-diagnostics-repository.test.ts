import type { AgentRuntimeEvent, RunDiagnosticsRecording } from '@betterwork/agent-protocol';
import { agentRuntimeEventSchema } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const seedRun = (store: AppStore, id: string, recording?: RunDiagnosticsRecording): string => {
  const workspace = store.workspaces.getOrCreate(`/tmp/run-diagnostics/${id}`, id);
  const task = store.tasks.create(workspace.id, id, 'diagnostics fixture');
  store.runs.create(
    {
      id,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'private prompt must not appear in diagnostics summary',
      status: 'running',
      createdAt: 1,
    },
    recording,
  );
  return task.task.id;
};

const event = (
  runId: string,
  sequence: number,
  fields: Record<string, unknown>,
): AgentRuntimeEvent =>
  agentRuntimeEventSchema.parse({
    id: `${runId}-event-${sequence}`,
    runId,
    sequence,
    createdAt: 100,
    ...fields,
  });

describe('RunDiagnosticsRepository', () => {
  it('projects model/tool events in stable pages and keeps unknown usage separate from real zero', () => {
    const store = openStore();
    const taskId = seedRun(store, 'trace', { version: 1, sections: ['core'] });
    const modelCallId = 'model-call-1';
    store.runs.appendEvent(
      event('trace', 0, { type: 'run.started', taskId, sessionId: 'session-1' }),
    );
    store.runs.appendEvent(
      event('trace', 1, {
        type: 'model.started',
        modelCallId,
        round: 0,
        providerId: 'fixture',
        messageCount: 1,
        toolDefinitionCount: 1,
      }),
    );
    store.runs.appendEvent(
      event('trace', 2, {
        type: 'tool.requested',
        toolCall: { id: 'rejected', name: 'calculator', input: {} },
        modelCallId,
        round: 0,
      }),
    );
    store.runs.appendEvent(
      event('trace', 3, {
        type: 'tool.failed',
        toolCallId: 'rejected',
        error: 'invalid arguments',
        modelCallId,
        round: 0,
        diagnostic: { kind: 'invalid-arguments', source: 'model-provider-output' },
      }),
    );
    store.runs.appendEvent(
      event('trace', 4, {
        type: 'tool.requested',
        toolCall: { id: 'executed', name: 'calculator', input: { expression: '1+1' } },
        modelCallId,
        round: 0,
      }),
    );
    store.runs.appendEvent(
      event('trace', 5, {
        type: 'tool.started',
        toolCall: { id: 'executed', name: 'calculator', input: { expression: '1+1' } },
        modelCallId,
        round: 0,
      }),
    );
    store.runs.appendEvent(
      event('trace', 6, {
        type: 'tool.failed',
        toolCallId: 'executed',
        error: 'tool error with private detail',
        modelCallId,
        round: 0,
      }),
    );
    store.runs.appendEvent(
      event('trace', 7, {
        type: 'model.completed',
        modelCallId,
        round: 0,
        durationMs: 25,
        usage: { promptTokens: 0 },
      }),
    );
    store.runs.appendEvent(event('trace', 8, { type: 'run.completed', finalContent: 'answer' }));

    const summary = store.runDiagnostics.getSummary('trace');
    expect(summary).toMatchObject({
      runId: 'trace',
      taskId,
      status: 'completed',
      modelCallCount: 1,
      toolCallCount: 2,
      toolExecutionCount: 1,
      rejectedToolCallCount: 1,
      recordingVersion: 1,
      enabledSections: ['core'],
      integrity: 'complete',
      usage: {
        promptTokens: { knownSubtotal: '0', knownCallCount: 1, missingCallCount: 0 },
        completionTokens: { knownSubtotal: '0', knownCallCount: 0, missingCallCount: 1 },
      },
    });
    expect(JSON.stringify(summary)).not.toContain('private prompt');
    expect(JSON.stringify(summary)).not.toContain('private detail');

    const firstPage = store.runDiagnostics.getPage({ runId: 'trace', pageSize: 2 });
    expect(firstPage?.nodes.map((node) => node.kind)).toEqual(['round', 'model']);
    expect(firstPage?.nodes[1]).toMatchObject({ modelCallId });
    expect(firstPage?.nextCursor).toBeDefined();
    const secondPage = store.runDiagnostics.getPage({
      runId: 'trace',
      pageSize: 2,
      cursor: firstPage?.nextCursor,
    });
    expect(secondPage?.nodes.map((node) => [node.kind, node.status])).toEqual([
      ['tool', 'rejected'],
      ['tool', 'failed'],
    ]);
    expect(secondPage?.nodes[0]).toMatchObject({ toolCallId: 'rejected', modelCallId });
    expect(secondPage?.nodes[0]).not.toHaveProperty('durationMs');
  });

  it('keeps legacy recording unknown while projecting tool-only and on-demand bounded details', () => {
    const store = openStore();
    seedRun(store, 'old');
    store.runs.appendEvent(
      event('old', 0, {
        type: 'tool.started',
        toolCall: { id: 'old-call', name: 'fixture', input: { text: 'old' } },
      }),
    );
    store.runs.appendEvent(
      event('old', 1, { type: 'tool.completed', toolCallId: 'old-call', output: { ok: true } }),
    );
    store.runs.appendEvent(event('old', 2, { type: 'run.completed', finalContent: 'done' }));

    const legacy = store.runDiagnostics.getSummary('old');
    expect(legacy).toMatchObject({
      modelCallCount: 0,
      toolExecutionCount: 1,
      integrity: 'unavailable',
    });
    expect(legacy).not.toHaveProperty('recordingVersion');

    const largeRunId = 'large';
    seedRun(store, largeRunId, { version: 1, sections: ['core'] });
    const largeInput = { text: '😀'.repeat(20_000) };
    store.runs.appendEvent(
      event(largeRunId, 0, {
        type: 'tool.requested',
        toolCall: { id: 'large-call', name: 'fixture', input: largeInput },
      }),
    );
    store.runs.appendEvent(
      event(largeRunId, 1, {
        type: 'tool.started',
        toolCall: { id: 'large-call', name: 'fixture', input: largeInput },
      }),
    );
    const detail = store.runDiagnostics.getNodeDetail(largeRunId, 'tool:large-call');
    expect(detail).toMatchObject({ truncated: true });
    expect(Buffer.byteLength(detail?.payloadJson ?? '', 'utf8')).toBeLessThanOrEqual(65_536);
    expect(JSON.parse(detail?.payloadJson ?? '{}')).toMatchObject({ truncated: true });
    expect(store.runDiagnostics.getNodeDetail('old', 'tool:large-call')).toBeUndefined();
  });

  it('propagates terminal model failure to its derived round', () => {
    const store = openStore();
    seedRun(store, 'failed-model', { version: 1, sections: ['core'] });
    store.runs.appendEvent(
      event('failed-model', 0, {
        type: 'model.started',
        modelCallId: 'failed-call',
        round: 0,
        providerId: 'fixture',
        messageCount: 1,
        toolDefinitionCount: 0,
      }),
    );
    store.runs.appendEvent(
      event('failed-model', 1, {
        type: 'model.failed',
        modelCallId: 'failed-call',
        round: 0,
        durationMs: 1,
        errorCode: 'provider-error',
        errorSummary: 'Provider failed in fixture',
      }),
    );
    store.runs.appendEvent(
      event('failed-model', 2, { type: 'run.failed', error: 'provider failed' }),
    );

    const page = store.runDiagnostics.getPage({ runId: 'failed-model' });
    expect(page?.integrity).toBe('complete');
    expect(page?.nodes).toContainEqual(
      expect.objectContaining({ id: 'round:0', kind: 'round', status: 'failed' }),
    );
  });

  it('marks damaged and cross-run payloads partial without returning their nodes', () => {
    const store = openStore();
    seedRun(store, 'damaged', { version: 1, sections: ['core'] });
    const started = event('damaged', 0, {
      type: 'model.started',
      modelCallId: 'unfinished',
      round: 0,
      providerId: 'fixture',
      messageCount: 1,
      toolDefinitionCount: 0,
    });
    store.runs.appendEvent(started);
    store.runs.appendEvent({ ...started, id: 'damaged-event-1', sequence: 1 });
    const db = (store as unknown as { db: Database.Database }).db;
    db.prepare('UPDATE run_events SET payload = ? WHERE id = ?').run('{', 'damaged-event-0');
    db.prepare('UPDATE run_events SET payload = ? WHERE id = ?').run(
      JSON.stringify({ ...started, runId: 'other-run', sequence: 1 }),
      'damaged-event-1',
    );

    const summary = store.runDiagnostics.getSummary('damaged');
    expect(summary).toMatchObject({ integrity: 'partial', modelCallCount: 0 });
    const page = store.runDiagnostics.getPage({ runId: 'damaged' });
    expect(page?.integrity).toBe('partial');
    expect(page?.nodes).toEqual([]);
  });

  it('marks terminal Runs with duplicate or unclosed model calls partial without inventing endings', () => {
    const store = openStore();
    seedRun(store, 'unclosed', { version: 1, sections: ['core'] });
    store.runs.appendEvent(
      event('unclosed', 0, {
        type: 'model.started',
        modelCallId: 'interrupted-call',
        round: 0,
        providerId: 'fixture',
        messageCount: 1,
        toolDefinitionCount: 0,
      }),
    );
    store.runs.appendEvent(event('unclosed', 1, { type: 'run.failed', error: 'provider failed' }));
    const unclosed = store.runDiagnostics.getPage({ runId: 'unclosed' });
    expect(unclosed?.integrity).toBe('partial');
    expect(unclosed?.nodes).toMatchObject([
      { id: 'round:0', kind: 'round', status: 'interrupted' },
      { id: 'model:interrupted-call', status: 'interrupted', evidenceState: 'missing' },
    ]);
    expect(unclosed?.nodes[1]).not.toHaveProperty('durationMs');

    const duplicateTaskId = seedRun(store, 'duplicate', { version: 1, sections: ['core'] });
    const duplicate = event('duplicate', 0, {
      type: 'model.started',
      modelCallId: 'duplicate-call',
      round: 0,
      providerId: 'fixture',
      messageCount: 1,
      toolDefinitionCount: 0,
    });
    store.runs.appendEvent(duplicate);
    store.runs.appendEvent({ ...duplicate, id: 'duplicate-event-1', sequence: 1 });
    store.runs.appendEvent(event('duplicate', 2, { type: 'run.failed', error: 'provider failed' }));
    const repeated = store.runDiagnostics.getPage({ runId: 'duplicate' });
    expect(repeated?.integrity).toBe('partial');
    expect(repeated?.nodes).toContainEqual(
      expect.objectContaining({ id: 'model:duplicate-call', status: 'unknown' }),
    );
    expect(repeated?.summary.taskId).toBe(duplicateTaskId);
  });
});
