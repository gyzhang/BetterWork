import { createHash } from 'node:crypto';

import type {
  AgentRuntimeEvent,
  RunDiagnosticsCursor,
  RunDiagnosticsRecording,
} from '@betterwork/agent-protocol';
import { agentRuntimeEventSchema, memoryRecallPolicyV1 } from '@betterwork/agent-protocol';
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

const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

describe('RunDiagnosticsRepository', () => {
  it('filters exact Workspace history and aggregates fixed run, usage, and duration samples', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/diagnostic-history', 'history');
    const runIds = ['history-a', 'history-b', 'history-c', 'history-d'] as const;
    const contexts = new Map<string, { taskId: string; sessionId: string }>();
    for (const [index, runId] of runIds.entries()) {
      const task = store.tasks.create(workspace.id, `history-task-${index}`, 'history fixture');
      const createdAt = (index + 1) * 1_000;
      store.runs.create(
        {
          id: runId,
          taskId: task.task.id,
          sessionId: task.sessionId,
          prompt: 'private history prompt',
          status: 'running',
          createdAt,
        },
        { version: 1, sections: ['core'] },
      );
      contexts.set(runId, { taskId: task.task.id, sessionId: task.sessionId });
      store.runs.appendEvent(
        event(runId, 0, {
          type: 'run.started',
          taskId: task.task.id,
          sessionId: task.sessionId,
          createdAt,
        }),
      );
      store.runs.appendEvent(
        event(runId, 1, {
          type: 'model.started',
          modelCallId: `model-${runId}`,
          round: 0,
          providerId: 'fixture',
          messageCount: 1,
          toolDefinitionCount: 1,
          createdAt: createdAt + 1,
        }),
      );
    }
    const append = (runId: string, sequence: number, fields: Record<string, unknown>): void => {
      store.runs.appendEvent(event(runId, sequence, fields));
    };
    const finish = (
      runId: string,
      modelEnding: Record<string, unknown>,
      terminal: Record<string, unknown>,
      sequence: number,
    ): void => {
      append(runId, sequence, {
        modelCallId: `model-${runId}`,
        round: 0,
        createdAt: 2_000 + sequence,
        ...modelEnding,
      });
      append(runId, sequence + 1, { createdAt: 3_000 + sequence, ...terminal });
    };
    append('history-a', 2, {
      type: 'tool.requested',
      modelCallId: 'model-history-a',
      round: 0,
      toolCall: { id: 'history-tool-a', name: 'fixture', input: {} },
    });
    append('history-a', 3, {
      type: 'tool.started',
      modelCallId: 'model-history-a',
      round: 0,
      toolCall: { id: 'history-tool-a', name: 'fixture', input: {} },
    });
    append('history-a', 4, {
      type: 'tool.completed',
      modelCallId: 'model-history-a',
      round: 0,
      toolCallId: 'history-tool-a',
      output: { ok: true },
    });
    finish(
      'history-a',
      {
        type: 'model.completed',
        durationMs: 10,
        finishReason: 'tool-calls',
        usage: { promptTokens: 0, totalTokens: 0 },
      },
      { type: 'run.completed', finalContent: 'done' },
      5,
    );
    append('history-b', 2, {
      type: 'tool.requested',
      modelCallId: 'model-history-b',
      round: 0,
      toolCall: { id: 'history-tool-b-local', name: 'fixture', input: {} },
    });
    append('history-b', 3, {
      type: 'tool.started',
      modelCallId: 'model-history-b',
      round: 0,
      toolCall: { id: 'history-tool-b-local', name: 'fixture', input: {} },
    });
    append('history-b', 4, {
      type: 'tool.failed',
      modelCallId: 'model-history-b',
      round: 0,
      toolCallId: 'history-tool-b-local',
      error: 'local execution failed',
    });
    append('history-b', 5, {
      type: 'tool.requested',
      modelCallId: 'model-history-b',
      round: 0,
      toolCall: { id: 'history-tool-b-rejected', name: 'fixture', input: {} },
    });
    append('history-b', 6, {
      type: 'tool.failed',
      modelCallId: 'model-history-b',
      round: 0,
      toolCallId: 'history-tool-b-rejected',
      error: 'invalid input',
      diagnostic: { kind: 'invalid-arguments', source: 'model-provider-output' },
    });
    finish(
      'history-b',
      {
        type: 'model.failed',
        durationMs: 20,
        errorCode: 'provider-error',
        errorSummary: 'fixture failure',
        usage: { completionTokens: 4 },
      },
      { type: 'run.failed', error: 'fixture failure' },
      7,
    );
    finish(
      'history-c',
      { type: 'model.cancelled', durationMs: 30 },
      { type: 'run.cancelled', reason: 'fixture cancellation' },
      2,
    );

    const context = contexts.get('history-a');
    if (!context) throw new Error('Missing fixture Task context');
    const expert = store.experts.create({
      id: 'history-expert',
      revisionId: 'history-expert-revision',
      sourceKind: 'user',
      revision: {
        name: 'History expert',
        summary: 'fixture',
        author: '',
        tags: [],
        identity: 'fixture',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    });
    store.runContextSnapshots.create({
      runId: 'history-a',
      taskId: context.taskId,
      workspaceId: workspace.id,
      expertId: expert.id,
      expertRevisionId: 'history-expert-revision',
      contextSegmentId: 'history-segment',
      materials: [],
      createdAt: 1_000,
    });
    store.runMemoryContexts.recordSelection({
      runId: 'history-a',
      evaluatedAt: 1,
      queryHash: hash('history-query'),
      policySnapshot: memoryRecallPolicyV1,
      selectedItems: [],
      decisionSummary: {
        budget: {
          totalItems: 2,
          preferenceItems: 0,
          contentCodePoints: 120,
          wrapperCodePoints: 40,
          blockCodePoints: 160,
        },
        exclusions: [],
        queryTruncated: false,
        conflictReviewRequired: false,
      },
      authorizationHash: hash('history-authorization'),
      selectedAt: 1,
    });
    store.runMemoryContexts.markRequestPrepared({
      runId: 'history-a',
      requestHash: hash('history-request'),
      at: 2,
      modelSnapshot: { fingerprint: 'history-model-fingerprint' },
    });
    store.skills.save({
      id: 'history-skill',
      name: 'History Skill',
      description: '',
      sourceKind: 'user',
      currentRevisionId: 'history-skill-revision',
    });
    store.skills.saveRevision({
      id: 'history-skill-revision',
      skillId: 'history-skill',
      contentHash: 'history-content-hash',
      resourceKey: 'user/history-skill/content',
      frontmatter: {},
    });
    store.skills.saveProfile({
      id: 'history-skill-profile',
      skillId: 'history-skill',
      profileHash: 'history-profile-hash',
      profile: { commands: [], environmentRequirements: [], outputContract: { outputPaths: [] } },
    });
    store.skills.save({
      id: 'history-skill',
      name: 'History Skill',
      description: '',
      sourceKind: 'user',
      currentRevisionId: 'history-skill-revision',
      currentProfileRevisionId: 'history-skill-profile',
    });
    store.skills.setTrustPreference('history-skill', 'trusted');
    const grantId = store.skills.saveTrustGrant({
      id: 'history-skill-grant',
      skillId: 'history-skill',
      revisionId: 'history-skill-revision',
      profileHash: 'history-profile-hash',
      dependencyFingerprint: 'history-dependencies',
      scopeHash: 'history-scope',
      source: 'user',
    });
    store.executions.createBinding({
      id: 'history-skill-binding',
      runId: 'history-a',
      skillRevisionId: 'history-skill-revision',
      profileRevisionId: 'history-skill-profile',
      dependencySnapshotIds: [],
      grantId,
    });

    const firstPage = store.runDiagnostics.getHistoryPage({
      workspaceId: workspace.id,
      pageSize: 2,
    });
    expect(firstPage.runs.map(({ summary }) => summary.runId)).toEqual(['history-d', 'history-c']);
    expect(firstPage.nextCursor).toMatchObject({
      workspaceId: workspace.id,
      afterCreatedAt: 3_000,
      afterRunId: 'history-c',
    });
    expect(firstPage.stats).toMatchObject({
      runCount: 4,
      statusCounts: { completed: 1, failed: 1, cancelled: 1, running: 1 },
      runFailure: {
        failedRunCount: 1,
        denominatorRunCount: 2,
        excludedCancelledRunCount: 1,
        excludedRunningRunCount: 1,
        rate: 0.5,
      },
      modelCallCount: 4,
      toolCallCount: 3,
      toolExecutionCount: 2,
      failedToolExecutionCount: 1,
      rejectedToolCallCount: 1,
      usage: {
        promptTokens: { knownSubtotal: '0', knownCallCount: 1, missingCallCount: 3 },
        completionTokens: { knownSubtotal: '4', knownCallCount: 1, missingCallCount: 3 },
        totalTokens: { knownSubtotal: '0', knownCallCount: 1, missingCallCount: 3 },
      },
      modelCallDurationMs: {
        sampleCount: 3,
        p50: 20,
        p95: 30,
        excludedCounts: { running: 1 },
      },
    });
    const secondPage = store.runDiagnostics.getHistoryPage({
      workspaceId: workspace.id,
      pageSize: 2,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.runs.map(({ summary }) => summary.runId)).toEqual(['history-b', 'history-a']);
    expect(secondPage.stats).toEqual(firstPage.stats);
    expect(secondPage.runs[1]).toMatchObject({
      expertId: 'history-expert',
      expertRevisionId: 'history-expert-revision',
      skillRevisionIds: ['history-skill-revision'],
      modelFingerprint: 'history-model-fingerprint',
    });
    expect(secondPage.runs[0]).not.toHaveProperty('expertRevisionId');
    for (const filter of [
      { taskId: context.taskId },
      { fromCreatedAt: 1_000, throughCreatedAt: 1_000 },
      { expertRevisionId: 'history-expert-revision' },
      { skillRevisionId: 'history-skill-revision' },
      { modelFingerprint: 'history-model-fingerprint' },
    ]) {
      expect(
        store.runDiagnostics
          .getHistoryPage({ workspaceId: workspace.id, filter })
          .runs.map(({ summary }) => summary.runId),
      ).toEqual(['history-a']);
    }
    expect(
      store.runDiagnostics.getHistoryPage({
        workspaceId: workspace.id,
        filter: { expertRevisionId: 'missing-expert-revision' },
      }).runs,
    ).toEqual([]);

    const otherWorkspace = store.workspaces.getOrCreate('/tmp/diagnostic-history-other', 'other');
    const otherTask = store.tasks.create(otherWorkspace.id, 'other-task', 'other');
    store.runs.create({
      id: 'history-outside-workspace',
      taskId: otherTask.task.id,
      sessionId: otherTask.sessionId,
      prompt: 'outside',
      status: 'running',
      createdAt: 9_000,
    });
    expect(store.runDiagnostics.getHistoryPage({ workspaceId: workspace.id }).runs).toHaveLength(4);
  });

  it('projects HostDiagnosticEvent with its own sequence and explicit cross-source parents', () => {
    const store = openStore();
    const runId = 'host-tree';
    seedRun(store, runId, { version: 2, sections: ['core', 'host'] });
    store.runs.appendEvent(
      event(runId, 0, {
        type: 'tool.started',
        toolCall: { id: 'skill-tool', name: 'skill_execute', input: {} },
      }),
    );
    const appendHost = (input: Parameters<typeof store.runHostDiagnostics.append>[0]): void => {
      store.runHostDiagnostics.append(input);
    };
    appendHost({
      id: 'prepare-start',
      runId,
      operationId: 'prepare-op',
      kind: 'run-host',
      phase: 'prepare',
      state: 'started',
      createdAt: 100,
    });
    appendHost({
      id: 'prepare-finish',
      runId,
      operationId: 'prepare-op',
      kind: 'run-host',
      phase: 'prepare',
      state: 'completed',
      createdAt: 110,
      durationMs: 10,
    });
    appendHost({
      id: 'dispatch-start',
      runId,
      operationId: 'dispatch-op',
      toolCallId: 'skill-tool',
      kind: 'skill-host',
      phase: 'dispatch',
      state: 'started',
      createdAt: 100,
    });
    appendHost({
      id: 'dispatch-finish',
      runId,
      operationId: 'dispatch-op',
      toolCallId: 'skill-tool',
      kind: 'skill-host',
      phase: 'dispatch',
      state: 'completed',
      createdAt: 120,
      durationMs: 20,
    });
    appendHost({
      id: 'execute-start',
      runId,
      operationId: 'execute-op',
      parentOperationId: 'dispatch-op',
      toolCallId: 'skill-tool',
      kind: 'skill-host',
      phase: 'execute',
      state: 'started',
      createdAt: 110,
    });
    appendHost({
      id: 'execute-finish',
      runId,
      operationId: 'execute-op',
      parentOperationId: 'dispatch-op',
      toolCallId: 'skill-tool',
      kind: 'skill-host',
      phase: 'execute',
      state: 'completed',
      createdAt: 115,
      durationMs: 5,
    });

    const nodes = store.runDiagnostics.getPage({ runId })?.nodes ?? [];
    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'host:dispatch-op',
          sourceKind: 'host-diagnostic',
          sourceSequenceStart: 2,
          parentId: 'tool:skill-tool',
          operationId: 'dispatch-op',
          occurredAt: 100,
        }),
        expect.objectContaining({
          id: 'host:execute-op',
          sourceSequenceStart: 4,
          parentId: 'host:dispatch-op',
          durationMs: 5,
        }),
      ]),
    );
    expect(nodes.find((node) => node.id === 'tool:skill-tool')).toMatchObject({
      sourceKind: 'core-journal',
      sourceSequenceStart: 0,
      occurredAt: 100,
    });
    expect(store.runDiagnostics.getSummary(runId)?.integrity).toBe('partial');

    const pagedIds: string[] = [];
    let cursor: RunDiagnosticsCursor | undefined;
    do {
      const page = store.runDiagnostics.getPage({
        runId,
        pageSize: 2,
        ...(cursor ? { cursor } : {}),
      });
      if (!page) break;
      pagedIds.push(...page.nodes.map((node) => node.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(pagedIds).toEqual(nodes.map((node) => node.id));
    expect(new Set(pagedIds).size).toBe(nodes.length);
  });

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

  it('saves one problem mark per Run with same-Run node validation and revision CAS', () => {
    const store = openStore();
    const workspaceId = store.workspaces.getOrCreate(
      '/tmp/run-diagnostics/mark-shared',
      'marks',
    ).id;
    const taskA = store.tasks.create(workspaceId, 'mark-task-a', 'diagnostics fixture');
    const taskB = store.tasks.create(workspaceId, 'mark-task-b', 'diagnostics fixture');
    store.runs.create(
      {
        id: 'mark-run-a',
        taskId: taskA.task.id,
        sessionId: taskA.sessionId,
        prompt: 'private prompt',
        status: 'running',
        createdAt: 1,
      },
      { version: 1, sections: ['core'] },
    );
    store.runs.create(
      {
        id: 'mark-run-b',
        taskId: taskB.task.id,
        sessionId: taskB.sessionId,
        prompt: 'private prompt',
        status: 'running',
        createdAt: 2,
      },
      { version: 1, sections: ['core'] },
    );
    for (const { runId, callId } of [
      { runId: 'mark-run-a', callId: 'call-a' },
      { runId: 'mark-run-b', callId: 'call-b' },
    ]) {
      store.runs.appendEvent(
        event(runId, 0, {
          type: 'model.started',
          modelCallId: callId,
          round: 0,
          providerId: 'fixture',
          messageCount: 1,
          toolDefinitionCount: 0,
        }),
      );
      store.runs.appendEvent(
        event(runId, 1, {
          type: 'model.completed',
          modelCallId: callId,
          round: 0,
          durationMs: 12,
        }),
      );
    }

    const scopedInput = {
      workspaceId,
      taskId: taskA.task.id,
      runId: 'mark-run-a',
    };
    const input = {
      ...scopedInput,
      expectedRevision: null,
      category: 'model' as const,
      diagnosticNodeId: 'model:call-a',
    };
    expect(store.runDiagnostics.setIssueMark(input, 100)).toMatchObject({
      runId: input.runId,
      category: 'model',
      diagnosticNodeId: 'model:call-a',
      revision: 1,
      updatedAt: 100,
    });
    expect(store.runDiagnostics.getIssueMark(input.runId)).toMatchObject({ revision: 1 });
    expect(() => store.runDiagnostics.setIssueMark(input, 101)).toThrow(/已在别处更新/u);
    expect(() =>
      store.runDiagnostics.setIssueMark(
        {
          ...scopedInput,
          expectedRevision: 1,
          category: 'model',
          diagnosticNodeId: 'model:call-b',
        },
        102,
      ),
    ).toThrow(/不属于当前 Run/u);

    const updated = store.runDiagnostics.setIssueMark(
      { ...scopedInput, expectedRevision: 1, category: 'tool' },
      103,
    );
    expect(updated).toMatchObject({ category: 'tool', revision: 2, updatedAt: 103 });
    expect(
      store.runDiagnostics.setIssueMark(
        { ...scopedInput, expectedRevision: 2, category: null },
        104,
      ),
    ).toBeNull();
    expect(store.runDiagnostics.getIssueMark(input.runId)).toBeUndefined();
    expect(
      store.runDiagnostics.setIssueMark(
        { ...scopedInput, expectedRevision: null, category: 'other' },
        105,
      ),
    ).toMatchObject({ category: 'other', revision: 1 });
    const db = (store as unknown as { db: Database.Database }).db;
    db.prepare('DELETE FROM runs WHERE id = ?').run(input.runId);
    expect(store.runDiagnostics.getIssueMark(input.runId)).toBeUndefined();
  });
});
