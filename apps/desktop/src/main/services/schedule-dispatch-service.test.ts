import type {
  ExpertRevisionDraft,
  ScheduleConfigDraft,
  ScheduleResolvedPeriod,
  ScheduleSourceSnapshot,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore, scheduleSourceManifestHash } from '../persistence';
import type { RunService } from './run-service';
import { ScheduleDispatchService } from './schedule-dispatch-service';
import { ScheduleExecutionService } from './schedule-execution-service';
import type { SchedulePreflightResult } from './schedule-preflight';
import type { SchedulePreflightService } from './schedule-preflight';
import type { ScheduleSourceService } from './schedule-source-service';

const expertDraft: ExpertRevisionDraft = {
  name: '合成定时专家',
  summary: '用于离线派发测试',
  author: '',
  tags: [],
  identity: '基于固定来源完成报告。',
  principles: ['不访问外部服务'],
  inputRequirements: ['合成材料'],
  deliveryRequirements: ['保存结论'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
};

const configFor = (expertId: string, expertRevisionId: string): ScheduleConfigDraft => ({
  name: '离线规则',
  expertId,
  expertRevisionId,
  requirements: '依据合成来源完成报告。',
  expectedArtifactTypes: ['markdown'],
  timing: { frequency: 'daily', hour: 9, minute: 0, timeZone: 'UTC' },
  periodRule: 'none',
  knowledgeSources: [],
  outputSubdirectory: '定时成果',
});

const period: ScheduleResolvedPeriod = {
  rule: 'none',
  timeZone: 'UTC',
  anchorAt: 10_000,
  label: '不指定期间',
};

const ready: SchedulePreflightResult = {
  status: 'ready',
  fingerprint: 'confirmed-fingerprint',
  problems: [],
};

const stores: AppStore[] = [];

const fixture = () => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const workspace = store.workspaces.create('/tmp/schedule-dispatch-workspace', '合成工作区');
  const expert = store.experts.create({ sourceKind: 'user', revision: expertDraft });
  const config = configFor(expert.id, expert.revision.id);
  const aggregate = store.schedules.create({
    id: 'schedule-dispatch',
    workspaceId: workspace.id,
    config,
    createdAt: 1,
    activation: {
      enabledAt: 1,
      capabilityFingerprint: ready.fingerprint,
      nextScheduledAt: 20_000,
    },
  });
  const claim = store.scheduleOccurrences.claimManual({
    scheduleId: aggregate.schedule.id,
    trigger: 'manual-now',
    requestKey: 'synthetic-request',
    requestedAt: 10_000,
    period,
  });
  if (claim.kind !== 'created') throw new Error('fixture: occurrence creation failed');

  const prepareSource: ScheduleSourceService['prepare'] = async (occurrenceId, signal) => {
    if (signal?.aborted) throw signal.reason;
    const preparing = store.scheduleSources.createPreparing({
      occurrenceId,
      evaluatedAt: 10_001,
      createdAt: 10_001,
    });
    const snapshot = store.scheduleSources.publishReady({
      snapshotId: preparing.id,
      items: [],
      totalFileBytes: 0,
      manifestHash: scheduleSourceManifestHash([]),
      completedAt: 10_002,
    });
    store.scheduleOccurrences.attachSourceSnapshot(occurrenceId, snapshot.id);
    return snapshot;
  };
  const source = { prepare: vi.fn(prepareSource) } satisfies Pick<ScheduleSourceService, 'prepare'>;
  const preflight = {
    check: vi.fn<SchedulePreflightService['check']>(async () => ready),
  } satisfies Pick<SchedulePreflightService, 'check'>;
  const execution = new ScheduleExecutionService(store, { now: () => 10_003 });
  const start = vi.fn<RunService['start']>((request, association) => {
    if (!association) throw new Error('fixture: scheduled association is missing');
    const context = store.taskContexts.getLatest(request.taskId);
    const task = store.tasks.getSummary(request.taskId);
    if (!context || context.executor.kind !== 'expert' || !task) {
      throw new Error('fixture: scheduled TaskContext is missing');
    }
    const expertId = context.executor.expertId;
    const expertRevisionId = context.executor.expertRevisionId;
    const runId = 'synthetic-scheduled-run';
    store.transaction(() => {
      store.runs.create({
        id: runId,
        taskId: request.taskId,
        sessionId: request.sessionId,
        prompt: request.prompt,
        status: 'running',
        createdAt: 10_004,
      });
      store.runContextSnapshots.create({
        runId,
        taskId: request.taskId,
        workspaceId: task.workspaceId,
        taskContextRevisionId: context.id,
        expertId,
        expertRevisionId,
        contextSegmentId: 'synthetic-scheduled-segment',
        materials: [],
        ...(context.scheduleSourceSnapshotId === undefined
          ? {}
          : { scheduleSourceSnapshotId: context.scheduleSourceSnapshotId }),
        createdAt: 10_004,
      });
      store.scheduleOccurrences.dispatchRun({
        occurrenceId: association.occurrenceId,
        runId,
        taskId: request.taskId,
        sessionId: request.sessionId,
        taskContextRevisionId: context.id,
      });
    });
    return runId;
  });
  const cancel = vi.fn<RunService['cancel']>(() => true);
  const runs: Pick<RunService, 'start' | 'cancel'> = { start, cancel };
  const service = new ScheduleDispatchService(store, source, preflight, execution, runs, {
    now: () => 10_004,
    preparationTimeoutMs: 1_000,
  });
  return { store, config, occurrence: claim.occurrence, source, preflight, service, start, cancel };
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('ScheduleDispatchService preparation boundaries', () => {
  it('aborts a live source preparation idempotently and never creates a Run', async () => {
    const state = fixture();
    const error = new Error('synthetic abort');
    state.source.prepare.mockImplementation(
      (_occurrenceId, signal) =>
        new Promise<ScheduleSourceSnapshot>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(error), { once: true });
        }),
    );
    const preparation = state.service.prepareAndStart(state.occurrence.id);
    await vi.waitFor(() => expect(state.source.prepare).toHaveBeenCalledOnce());

    expect(state.service.cancelPreparation(state.occurrence.id)).toBe(true);
    await preparation;

    expect(state.service.cancelPreparation(state.occurrence.id)).toBe(false);
    expect(state.store.scheduleOccurrences.get(state.occurrence.id)).toMatchObject({
      phase: 'closed',
      preparationOutcome: 'cancelled',
      reasonCode: 'schedule_cancelled',
    });
    expect(state.start).not.toHaveBeenCalled();
    expect(state.store.tasks.getSummary(state.occurrence.taskId ?? '')).toBeUndefined();
  });

  it('times out a stalled preparation with an explicit terminal reason and no Run', async () => {
    const state = fixture();
    const prepare = vi.fn<ScheduleSourceService['prepare']>(
      (_occurrenceId, signal) =>
        new Promise<ScheduleSourceSnapshot>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')),
            { once: true },
          );
        }),
    );
    const service = new ScheduleDispatchService(
      state.store,
      { prepare },
      state.preflight,
      new ScheduleExecutionService(state.store, { now: () => 10_003 }),
      { start: state.start, cancel: vi.fn<RunService['cancel']>(() => true) },
      { now: () => 10_004, preparationTimeoutMs: 1 },
    );

    await service.prepareAndStart(state.occurrence.id);

    expect(state.store.runs.list()).toEqual([]);
    expect(state.store.scheduleOccurrences.get(state.occurrence.id)).toMatchObject({
      phase: 'closed',
      preparationOutcome: 'blocked',
      reasonCode: 'schedule_preparation_timeout',
    });
    expect(state.start).not.toHaveBeenCalled();
  });

  it('rechecks capability after preserving T3 and blocks a live revoke before T4', async () => {
    const state = fixture();
    state.preflight.check
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({
        status: 'blocked',
        fingerprint: 'revoked-fingerprint',
        problems: [{ code: 'skill-trust-unavailable', message: '合成信任授权已撤销。' }],
      });

    await state.service.prepareAndStart(state.occurrence.id);

    const closed = state.store.scheduleOccurrences.get(state.occurrence.id);
    expect(state.preflight.check).toHaveBeenCalledTimes(3);
    expect(closed).toMatchObject({
      phase: 'closed',
      preparationOutcome: 'blocked',
      reasonCode: 'schedule_capability_blocked',
      taskId: expect.any(String),
      sessionId: expect.any(String),
      sourceSnapshotId: expect.any(String),
    });
    expect(state.store.tasks.getSummary(closed?.taskId ?? '')).toBeDefined();
    expect(state.store.runs.list(closed?.taskId)).toEqual([]);
    expect(state.start).not.toHaveBeenCalled();
  });

  it('leaves a dispatched Run alone on preparation cancellation and stops it only on explicit request', async () => {
    const state = fixture();
    await state.service.prepareAndStart(state.occurrence.id);
    const dispatched = state.store.scheduleOccurrences.get(state.occurrence.id);
    if (!dispatched?.firstRunId) throw new Error('fixture: T4 did not persist its Run');

    expect(state.store.scheduleOccurrences.cancelPreparing(dispatched.scheduleId, 10_005)).toEqual(
      [],
    );
    expect(state.store.scheduleOccurrences.get(state.occurrence.id)?.phase).toBe('dispatched');
    expect(state.store.runs.get(dispatched.firstRunId)?.status).toBe('running');
    expect(state.service.stopOccurrence(state.occurrence.id)).toBe('cancel-requested');
    state.cancel.mockReturnValueOnce(false);
    expect(state.service.stopOccurrence(state.occurrence.id)).toBe('already-terminal');
    expect(state.cancel).toHaveBeenNthCalledWith(1, dispatched.firstRunId);
    expect(state.cancel).toHaveBeenNthCalledWith(2, dispatched.firstRunId);
    expect(state.store.runs.get(dispatched.firstRunId)?.status).toBe('running');
  });

  it('preserves an already registered partial ArtifactVersion when the Run fails', async () => {
    const state = fixture();
    await state.service.prepareAndStart(state.occurrence.id);
    const dispatched = state.store.scheduleOccurrences.get(state.occurrence.id);
    if (!dispatched?.firstRunId || !dispatched.taskId) {
      throw new Error('fixture: T4 did not persist its Run and Task');
    }

    const artifact = state.store.artifacts.saveMarkdown({
      taskId: dispatched.taskId,
      origin: 'assistant-run',
      runId: dispatched.firstRunId,
      title: '部分成果',
      content: '# 已登记的部分成果',
    });
    state.store.runs.forceFailure(dispatched.firstRunId, '合成运行失败', 10_005);

    expect(state.store.runs.get(dispatched.firstRunId)?.status).toBe('failed');
    expect(state.store.artifacts.getVersionDetail(artifact.currentVersionId)).toMatchObject({
      content: '# 已登记的部分成果',
      sourceRunId: dispatched.firstRunId,
    });
    expect(state.store.scheduleOccurrences.get(state.occurrence.id)?.phase).toBe('dispatched');
  });
});
