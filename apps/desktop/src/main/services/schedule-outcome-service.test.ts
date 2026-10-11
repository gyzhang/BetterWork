import type { ScheduleOccurrence } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppStore } from '../persistence';
import { AppStore as AppStoreClass } from '../persistence';
import { ScheduleOutcomeService } from './schedule-outcome-service';
import type { ScheduleOutputService } from './schedule-output-service';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStoreClass.open(':memory:');
  stores.push(store);
  return store;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

interface ScheduleFixture {
  store: AppStore;
  workspaceId: string;
  scheduleId: string;
  configVersion: number;
  expertId: string;
}

const createScheduleFixture = (store: AppStore): ScheduleFixture => {
  const workspace = store.workspaces.getOrCreate('/tmp/schedule-outcome-test', 'Test');
  const expert = store.experts.create({
    sourceKind: 'user',
    revision: {
      name: 'Test Expert',
      summary: '',
      author: '',
      tags: [],
      identity: 'Test instruction',
      principles: [],
      inputRequirements: [],
      deliveryRequirements: [],
      skillPreset: [],
      builtinToolPolicy: { mode: 'application-defaults' },
      modelReference: { mode: 'application-default' },
    },
  });
  const schedule = store.schedules.create({
    workspaceId: workspace.id,
    createdAt: 1_000,
    config: {
      name: 'Test Schedule',
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
      requirements: 'Test requirements',
      expectedArtifactTypes: ['markdown'],
      timing: { frequency: 'daily', hour: 9, minute: 0, timeZone: 'UTC' },
      periodRule: 'none',
      knowledgeSources: [],
      outputSubdirectory: '定时成果',
    },
  });
  return {
    store,
    workspaceId: workspace.id,
    scheduleId: schedule.schedule.id,
    configVersion: schedule.schedule.currentConfigVersion,
    expertId: expert.id,
  };
};

const createDispatchedOccurrence = (
  fixture: ScheduleFixture,
  overrides: { runId?: string } = {},
): { occurrence: ScheduleOccurrence; taskId: string; sessionId: string; runId: string } => {
  const { store, scheduleId } = fixture;
  const task = store.tasks.create(fixture.workspaceId, 'Test Task', 'Test task for schedule');
  const sessionId = task.sessionId;
  const runId = overrides.runId ?? 'run-1';
  const taskId = task.task.id;
  const occurrenceId = `occ-${runId}`;

  // Create the run (uses the session created by tasks.create)
  store.runs.create({
    id: runId,
    taskId,
    sessionId,
    prompt: 'test prompt',
    status: 'running',
    createdAt: 2_000,
  });

  // Insert the occurrence directly to satisfy the CHECK constraints for dispatched phase
  const db = (
    store as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }
  ).db;
  db.prepare('PRAGMA foreign_keys = OFF').run();
  db.prepare(
    `INSERT INTO schedule_occurrences
       (id, schedule_id, config_version, trigger, scheduled_at, requested_at, request_key,
        period_json, phase, task_id, session_id, first_run_id, source_snapshot_id,
        prepared_at, created_at)
     VALUES (?, ?, 1, 'manual-now', NULL, 2000, ?,
        '{"rule":"none","timeZone":"UTC","anchorAt":2000,"label":"test"}',
        'dispatched', ?, ?, ?, 'direct-insert', 2500, 1000)`,
  ).run(occurrenceId, scheduleId, `req-${runId}`, taskId, sessionId, runId);
  db.prepare('PRAGMA foreign_keys = ON').run();

  const occurrence = store.scheduleOccurrences.get(occurrenceId);
  if (!occurrence) throw new Error('Occurrence disappeared after setup');
  return { occurrence, taskId, sessionId, runId };
};

const createMockOutputs = (): {
  outputs: Pick<ScheduleOutputService, 'registerOccurrenceOutputs' | 'saveReceipt'>;
  registerSpy: ReturnType<typeof vi.fn>;
  saveSpy: ReturnType<typeof vi.fn>;
} => {
  const registerSpy = vi.fn().mockReturnValue([]);
  const saveSpy = vi.fn().mockResolvedValue({ status: 'saved' });
  return {
    outputs: {
      registerOccurrenceOutputs: registerSpy,
      saveReceipt: saveSpy,
    },
    registerSpy,
    saveSpy,
  };
};

describe('ScheduleOutcomeService constructor', () => {
  it('rejects non-positive outputSaveTimeoutMs', () => {
    const store = openStore();
    expect(
      () =>
        new ScheduleOutcomeService(
          store,
          { registerOccurrenceOutputs: vi.fn(), saveReceipt: vi.fn() },
          { outputSaveTimeoutMs: 0 },
        ),
    ).toThrow('positive safe integer');
  });

  it('rejects non-integer outputSaveTimeoutMs', () => {
    const store = openStore();
    expect(
      () =>
        new ScheduleOutcomeService(
          store,
          { registerOccurrenceOutputs: vi.fn(), saveReceipt: vi.fn() },
          { outputSaveTimeoutMs: 1.5 },
        ),
    ).toThrow('positive safe integer');
  });

  it('accepts a valid outputSaveTimeoutMs', () => {
    const store = openStore();
    const service = new ScheduleOutcomeService(
      store,
      { registerOccurrenceOutputs: vi.fn(), saveReceipt: vi.fn() },
      { outputSaveTimeoutMs: 5000 },
    );
    expect(service).toBeDefined();
  });
});

describe('ScheduleOutcomeService.finalizeRun', () => {
  it('returns undefined when no occurrence matches the runId', async () => {
    const store = openStore();
    const { outputs } = createMockOutputs();
    const service = new ScheduleOutcomeService(store, outputs);
    const result = await service.finalizeRun('nonexistent-run');
    expect(result).toBeUndefined();
  });

  it('deduplicates concurrent finalizeRun calls for the same occurrence', async () => {
    const fixture = createScheduleFixture(openStore());
    const { runId, occurrence } = createDispatchedOccurrence(fixture);
    const { outputs, registerSpy } = createMockOutputs();

    // Complete the run so finalization proceeds
    fixture.store.runs.appendEvent({
      id: 'evt-1',
      type: 'run.completed',
      runId,
      finalContent: 'done',
      sequence: 1,
      createdAt: 3_000,
    });

    const service = new ScheduleOutcomeService(fixture.store, outputs);
    const [first, second] = await Promise.all([
      service.finalizeRun(runId),
      service.finalizeRun(runId),
    ]);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.occurrence.id).toBe(occurrence.id);
    expect(second?.occurrence.id).toBe(occurrence.id);
    // registerOccurrenceOutputs should only be called once due to dedup
    expect(registerSpy).toHaveBeenCalledTimes(1);
  });

  it('transitions dispatched occurrence to closed when run is terminal', async () => {
    const fixture = createScheduleFixture(openStore());
    const { runId } = createDispatchedOccurrence(fixture);
    const { outputs } = createMockOutputs();

    fixture.store.runs.appendEvent({
      id: 'evt-1',
      type: 'run.completed',
      runId,
      finalContent: 'done',
      sequence: 1,
      createdAt: 3_000,
    });

    const nowValue = 10_000;
    const service = new ScheduleOutcomeService(fixture.store, outputs, {
      now: () => nowValue,
    });
    const result = await service.finalizeRun(runId);
    expect(result).toBeDefined();
    expect(result?.occurrence.phase).toBe('closed');
    expect(result?.status).toBe('no-target-artifact');
  });

  it('invokes onChanged when occurrence transitions from dispatched to closed', async () => {
    const fixture = createScheduleFixture(openStore());
    const { runId, occurrence } = createDispatchedOccurrence(fixture);
    const { outputs } = createMockOutputs();

    fixture.store.runs.appendEvent({
      id: 'evt-1',
      type: 'run.completed',
      runId,
      finalContent: 'done',
      sequence: 1,
      createdAt: 3_000,
    });

    const changedSpy = vi.fn();
    const service = new ScheduleOutcomeService(fixture.store, outputs, {
      onChanged: changedSpy,
    });
    await service.finalizeRun(runId);
    expect(changedSpy).toHaveBeenCalledTimes(1);
    expect(changedSpy).toHaveBeenCalledWith({
      scheduleId: occurrence.scheduleId,
      occurrenceId: occurrence.id,
      reason: 'occurrence',
    });
  });

  it('does not invoke onChanged when occurrence is already closed', async () => {
    const fixture = createScheduleFixture(openStore());
    const { runId } = createDispatchedOccurrence(fixture);
    const { outputs } = createMockOutputs();

    fixture.store.runs.appendEvent({
      id: 'evt-1',
      type: 'run.completed',
      runId,
      finalContent: 'done',
      sequence: 1,
      createdAt: 3_000,
    });

    const service = new ScheduleOutcomeService(fixture.store, outputs);
    await service.finalizeRun(runId);

    const changedSpy = vi.fn();
    const service2 = new ScheduleOutcomeService(fixture.store, outputs, {
      onChanged: changedSpy,
    });
    // Second finalize on already-closed occurrence
    await service2.finalizeRun(runId);
    expect(changedSpy).not.toHaveBeenCalled();
  });

  it('calls persistOccurrenceNotification inside transaction and invokes afterCommit after', async () => {
    const fixture = createScheduleFixture(openStore());
    const { runId, occurrence } = createDispatchedOccurrence(fixture);
    const { outputs } = createMockOutputs();

    fixture.store.runs.appendEvent({
      id: 'evt-1',
      type: 'run.completed',
      runId,
      finalContent: 'done',
      sequence: 1,
      createdAt: 3_000,
    });

    const callOrder: string[] = [];
    const persistSpy = vi.fn().mockImplementation(() => {
      callOrder.push('persist');
      return () => {
        callOrder.push('afterCommit');
      };
    });
    const service = new ScheduleOutcomeService(fixture.store, outputs, {
      persistOccurrenceNotification: persistSpy,
    });
    await service.finalizeRun(runId);
    expect(persistSpy).toHaveBeenCalledWith(occurrence.id);
    expect(callOrder).toEqual(['persist', 'afterCommit']);
  });
});

describe('ScheduleOutcomeService.projectOccurrence', () => {
  it('returns undefined for a nonexistent occurrence', () => {
    const store = openStore();
    const { outputs } = createMockOutputs();
    const service = new ScheduleOutcomeService(store, outputs);
    expect(service.projectOccurrence('nonexistent')).toBeUndefined();
  });

  it('projects a dispatched occurrence as running', () => {
    const fixture = createScheduleFixture(openStore());
    const { occurrence } = createDispatchedOccurrence(fixture);
    const { outputs } = createMockOutputs();
    const service = new ScheduleOutcomeService(fixture.store, outputs);
    const result = service.projectOccurrence(occurrence.id);
    expect(result).toBeDefined();
    expect(result?.status).toBe('running');
  });
});

describe('ScheduleOutcomeService.recoverTerminalRuns', () => {
  it('returns zero counts when no dispatched occurrences exist', async () => {
    const store = openStore();
    const { outputs } = createMockOutputs();
    const service = new ScheduleOutcomeService(store, outputs);
    const result = await service.recoverTerminalRuns();
    expect(result.examined).toBe(0);
    expect(result.finalized).toBe(0);
    expect(result.unresolved).toBe(0);
  });

  it('finalizes terminal runs that were left dispatched', async () => {
    const fixture = createScheduleFixture(openStore());
    const { runId } = createDispatchedOccurrence(fixture);
    const { outputs } = createMockOutputs();

    // Mark the run as completed (simulating a process interruption after completion)
    fixture.store.runs.appendEvent({
      id: 'evt-1',
      type: 'run.completed',
      runId,
      finalContent: 'done',
      sequence: 1,
      createdAt: 3_000,
    });

    const service = new ScheduleOutcomeService(fixture.store, outputs);
    const result = await service.recoverTerminalRuns();
    expect(result.examined).toBe(1);
    expect(result.finalized).toBe(1);
    expect(result.unresolved).toBe(0);
  });

  it('skips occurrences whose run is no longer available', async () => {
    const fixture = createScheduleFixture(openStore());
    const { runId } = createDispatchedOccurrence(fixture);
    const { store } = fixture;

    // Delete the run so the dispatched occurrence's firstRunId points to nothing.
    // recoverTerminalRuns should skip it (run is falsy → continue).
    const db = (
      store as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
      }
    ).db;
    db.prepare('PRAGMA foreign_keys = OFF').run();
    db.prepare('DELETE FROM runs WHERE id = ?').run(runId);
    db.prepare('PRAGMA foreign_keys = ON').run();

    const { outputs } = createMockOutputs();
    const service = new ScheduleOutcomeService(store, outputs);
    const result = await service.recoverTerminalRuns();
    expect(result.examined).toBe(1);
    expect(result.finalized).toBe(0);
    expect(result.unresolved).toBe(0);
  });

  it('skips occurrences whose run is still running', async () => {
    const fixture = createScheduleFixture(openStore());
    // Run is still in 'running' status (no terminal event appended)
    createDispatchedOccurrence(fixture);
    const { outputs } = createMockOutputs();
    const service = new ScheduleOutcomeService(fixture.store, outputs);
    const result = await service.recoverTerminalRuns();
    expect(result.examined).toBe(1);
    expect(result.finalized).toBe(0);
    expect(result.unresolved).toBe(0);
  });

  it('counts unresolved when finalization throws', async () => {
    const fixture = createScheduleFixture(openStore());
    const { runId } = createDispatchedOccurrence(fixture);
    const { outputs } = createMockOutputs();

    // Mark run as failed to trigger finalization
    fixture.store.runs.appendEvent({
      id: 'evt-1',
      type: 'run.failed',
      runId,
      error: 'test failure',
      sequence: 1,
      createdAt: 3_000,
    });

    // Make registerOccurrenceOutputs throw so finalization fails before
    // any receipt processing. The mock returns [] by default, which means
    // saveReceipt is never reached; throwing here is the reliable path to
    // unresolved counts.
    vi.mocked(outputs.registerOccurrenceOutputs).mockImplementation(() => {
      throw new Error('register failed');
    });

    const service = new ScheduleOutcomeService(fixture.store, outputs);
    const result = await service.recoverTerminalRuns();
    expect(result.examined).toBe(1);
    expect(result.unresolved).toBe(1);
  });
});
