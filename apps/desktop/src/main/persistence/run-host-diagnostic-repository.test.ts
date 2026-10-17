import type { RunDiagnosticsRecording } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { RunHostDiagnosticRecorder } from '../services/run-host-diagnostic-recorder';
import type { AppStore } from './index';
import { AppStore as AppStoreClass } from './index';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStoreClass.open(':memory:');
  stores.push(store);
  return store;
};
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const seedRun = (
  store: AppStore,
  id: string,
  recording: RunDiagnosticsRecording = { version: 2, sections: ['core', 'host'] },
) => {
  const workspace = store.workspaces.getOrCreate(`/tmp/host-diagnostics/${id}`, id);
  const task = store.tasks.create(workspace.id, id, 'host diagnostics fixture');
  store.runs.create(
    {
      id,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'private prompt',
      status: 'running',
      createdAt: 1,
    },
    recording,
  );
  return task.task.id;
};

const createRecorder = (store: AppStore) => {
  let wall = 100;
  let monotonic = 5;
  let id = 0;
  const recorder = new RunHostDiagnosticRecorder(store.runHostDiagnostics, {
    wallNow: () => wall,
    monotonicNow: () => monotonic,
    createId: () => `host-${++id}`,
  });
  return {
    recorder,
    setWall: (value: number) => (wall = value),
    setMonotonic: (value: number) => (monotonic = value),
  };
};

describe('RunHostDiagnosticRepository and recorder', () => {
  it('assigns a separate sequence atomically and measures a paired operation with the injected clock', () => {
    const store = openStore();
    seedRun(store, 'host-run');
    const coreEvent = {
      id: 'host-run-core-0',
      runId: 'host-run',
      sequence: 0,
      createdAt: 10,
      type: 'run.started' as const,
      taskId: 'task-host-run',
      sessionId: 'session-host-run',
    };
    store.runs.appendEvent(coreEvent);
    const { recorder, setMonotonic, setWall } = createRecorder(store);

    const started = recorder.start({
      runId: 'host-run',
      operationId: 'prepare-1',
      kind: 'run-host',
      phase: 'prepare',
    });
    setMonotonic(21);
    setWall(200);
    const completed = recorder.finish(started, { state: 'completed' });

    expect([started.diagnosticSequence, completed.diagnosticSequence]).toEqual([0, 1]);
    expect(completed).toMatchObject({ state: 'completed', durationMs: 16, createdAt: 200 });
    expect(store.runHostDiagnostics.listByRun('host-run')).toEqual([started, completed]);
    expect(store.runs.listEvents('host-run').map((event) => event.sequence)).toEqual([0]);
  });

  it('serializes concurrent appends without duplicate sequences', async () => {
    const store = openStore();
    seedRun(store, 'concurrent-run');
    const { recorder } = createRecorder(store);

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        Promise.resolve().then(() =>
          recorder.start({
            runId: 'concurrent-run',
            operationId: `operation-${index}`,
            kind: 'run-host',
            phase: 'prepare',
          }),
        ),
      ),
    );

    expect(
      store.runHostDiagnostics.listByRun('concurrent-run').map((event) => event.diagnosticSequence),
    ).toEqual(Array.from({ length: 12 }, (_, index) => index));
  });

  it('makes identical terminal writes idempotent and rejects a conflicting terminal state', () => {
    const store = openStore();
    seedRun(store, 'terminal-run');
    const { recorder, setMonotonic } = createRecorder(store);
    const started = recorder.start({
      runId: 'terminal-run',
      operationId: 'audit-1',
      kind: 'run-host',
      phase: 'audit',
    });
    setMonotonic(15);
    const completed = recorder.finish(started, { state: 'completed' });

    expect(recorder.finish(started, { state: 'completed' })).toEqual(completed);
    expect(() => recorder.finish(started, { state: 'failed', errorCode: 'audit-failed' })).toThrow(
      /conflicting terminal/iu,
    );
    expect(store.runHostDiagnostics.listByRun('terminal-run')).toHaveLength(2);
  });

  it('rejects cross-Run parent, ToolCall and Skill execution references', () => {
    const store = openStore();
    const taskA = seedRun(store, 'source-run');
    seedRun(store, 'other-run');
    store.runs.appendEvent({
      id: 'source-tool-request',
      runId: 'source-run',
      sequence: 0,
      createdAt: 2,
      type: 'tool.requested',
      toolCall: { id: 'source-tool', name: 'fixture', input: {} },
    });
    const parent = store.runHostDiagnostics.append({
      id: 'parent-operation',
      runId: 'source-run',
      operationId: 'parent-operation',
      kind: 'run-host',
      phase: 'prepare',
      state: 'started',
      createdAt: 3,
    });
    expect(taskA).toBeTruthy();
    expect(() =>
      store.runHostDiagnostics.append({
        id: 'cross-parent',
        runId: 'other-run',
        operationId: 'child-operation',
        parentOperationId: parent.operationId,
        kind: 'run-host',
        phase: 'audit',
        state: 'started',
        createdAt: 4,
      }),
    ).toThrow(/parent operation.*same Run/iu);
    expect(() =>
      store.runHostDiagnostics.append({
        id: 'cross-tool',
        runId: 'other-run',
        operationId: 'other-tool-operation',
        toolCallId: 'source-tool',
        kind: 'skill-host',
        phase: 'dispatch',
        state: 'started',
        createdAt: 5,
      }),
    ).toThrow(/ToolCall.*same Run/iu);

    store.skills.save({
      id: 'host-skill',
      name: 'Host Skill',
      description: '',
      sourceKind: 'user',
      currentRevisionId: 'host-skill-revision',
    });
    store.skills.saveRevision({
      id: 'host-skill-revision',
      skillId: 'host-skill',
      contentHash: 'host-skill-content',
      resourceKey: 'user/host-skill/content',
      frontmatter: {},
    });
    store.skills.saveProfile({
      id: 'host-skill-profile',
      skillId: 'host-skill',
      profileHash: 'host-skill-profile-hash',
      profile: { commands: [], environmentRequirements: [], outputContract: { outputPaths: [] } },
    });
    store.skills.save({
      id: 'host-skill',
      name: 'Host Skill',
      description: '',
      sourceKind: 'user',
      currentRevisionId: 'host-skill-revision',
      currentProfileRevisionId: 'host-skill-profile',
    });
    store.skills.setTrustPreference('host-skill', 'trusted');
    const grantId = store.skills.saveTrustGrant({
      id: 'host-skill-grant',
      skillId: 'host-skill',
      revisionId: 'host-skill-revision',
      profileHash: 'host-skill-profile-hash',
      dependencyFingerprint: 'host-skill-dependencies',
      scopeHash: 'host-skill-scope',
      source: 'user',
    });
    store.executions.createBinding({
      id: 'host-skill-binding',
      runId: 'source-run',
      skillRevisionId: 'host-skill-revision',
      profileRevisionId: 'host-skill-profile',
      dependencySnapshotIds: [],
      grantId,
    });
    store.executions.createExecution({
      id: 'source-execution',
      runId: 'source-run',
      bindingId: 'host-skill-binding',
      toolCallId: 'source-tool',
      commandId: 'python',
      argumentDigest: 'argument-digest',
      inputHashes: [],
      workDirKey: 'workdir-key',
      attemptKey: 'attempt-key',
    });

    expect(() =>
      store.runHostDiagnostics.append({
        id: 'cross-execution',
        runId: 'other-run',
        operationId: 'other-skill-operation',
        executionId: 'source-execution',
        kind: 'skill-host',
        phase: 'execute',
        state: 'started',
        createdAt: 6,
      }),
    ).toThrow(/execution.*same Run/iu);
  });

  it('validates damaged metadata on reads and rolls back sequence allocation on failed writes', () => {
    const store = openStore();
    seedRun(store, 'recovery-run');
    const db = (store as unknown as { db: Database.Database }).db;
    db.exec(`CREATE TRIGGER fail_host_event BEFORE INSERT ON run_diagnostic_events
      WHEN NEW.operation_id = 'rollback-operation'
      BEGIN SELECT RAISE(ABORT, 'synthetic observer write failure'); END`);
    const { recorder } = createRecorder(store);

    expect(() =>
      recorder.start({
        runId: 'recovery-run',
        operationId: 'rollback-operation',
        kind: 'run-host',
        phase: 'prepare',
      }),
    ).toThrow(/synthetic observer write failure/iu);
    db.exec('DROP TRIGGER fail_host_event');
    recorder.start({
      runId: 'recovery-run',
      operationId: 'valid-operation',
      kind: 'run-host',
      phase: 'prepare',
      metadata: { outputBytes: 1 },
    });
    db.pragma('ignore_check_constraints = ON');
    db.prepare("UPDATE run_diagnostic_events SET metadata_json = '{' WHERE run_id = ?").run(
      'recovery-run',
    );
    db.pragma('ignore_check_constraints = OFF');

    expect(() => store.runHostDiagnostics.listByRun('recovery-run')).toThrow();
    expect(
      db
        .prepare('SELECT diagnostic_sequence FROM run_diagnostic_events')
        .all()
        .map((row) => (row as { diagnostic_sequence: number }).diagnostic_sequence),
    ).toEqual([0]);
  });

  it('does not backfill host recording onto an older Run', () => {
    const store = openStore();
    seedRun(store, 'legacy-host-run', { version: 1, sections: ['core'] });
    const { recorder } = createRecorder(store);

    expect(() =>
      recorder.start({
        runId: 'legacy-host-run',
        operationId: 'legacy-operation',
        kind: 'run-host',
        phase: 'prepare',
      }),
    ).toThrow(/host diagnostics were not enabled/iu);
    expect(store.runHostDiagnostics.listByRun('legacy-host-run')).toEqual([]);
  });
});
