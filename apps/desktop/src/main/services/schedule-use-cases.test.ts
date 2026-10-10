import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppStore } from '../persistence';
import {
  createScheduleUseCaseFixture,
  dispatchFixtureOccurrence,
} from './fixtures/schedule-use-case-fixture';
import { resolveSchedulePeriod } from './schedule-calendar';
import type { SchedulePreflightResult } from './schedule-preflight';
import {
  ScheduleManualExecution,
  type ScheduleManualInput,
  ScheduleQueries,
} from './schedule-use-cases';

const stores: AppStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.restoreAllMocks();
});

const fixture = () => {
  const f = createScheduleUseCaseFixture();
  stores.push(f.store);
  const preflight = vi.fn(async (): Promise<SchedulePreflightResult> => ({
    status: 'ready',
    fingerprint: 'fixture',
    problems: [],
  }));
  const prepareAndStart = vi.fn(async () => undefined);
  const onChanged = vi.fn();
  const manual = new ScheduleManualExecution({
    store: f.store,
    schedules: f.schedules,
    preflight: { check: preflight },
    dispatch: { prepareAndStart },
    onChanged,
    now: () => f.now,
  });
  const input: ScheduleManualInput = {
    scheduleId: f.schedule.schedule.id,
    expectedRevision: f.schedule.schedule.revision,
    requestKey: 'manual',
    preflightFingerprint: 'fixture',
    trigger: 'manual-now',
  };
  return { ...f, manual, input, preflight, prepareAndStart, onChanged };
};

describe('ScheduleManualExecution without Electron', () => {
  it('claims before broadcasting and dispatches the persisted occurrence once', async () => {
    const f = fixture();
    f.onChanged.mockImplementation((event) => {
      expect(f.store.scheduleOccurrences.get(event.occurrenceId)).toMatchObject({
        phase: 'preparing',
      });
      expect(f.prepareAndStart).not.toHaveBeenCalled();
    });
    const result = await f.manual.execute(f.input);
    expect(result).toMatchObject({
      accepted: true,
      duplicate: false,
      occurrence: {
        requestedAt: f.now,
        trigger: 'manual-now',
        period: resolveSchedulePeriod(f.config.periodRule, f.config.timing.timeZone, f.now),
      },
    });
    expect(f.prepareAndStart).toHaveBeenCalledExactlyOnceWith(
      result.occurrence.id,
      undefined,
      'fixture',
    );
    expect(f.onChanged).toHaveBeenCalledExactlyOnceWith({
      scheduleId: f.input.scheduleId,
      occurrenceId: result.occurrence.id,
      reason: 'occurrence',
    });
  });

  it('replays a request before stale CAS and changed capabilities without redispatch', async () => {
    const f = fixture();
    const first = await f.manual.execute(f.input);
    f.preflight.mockRejectedValue(new Error('Capabilities no longer available'));
    const replay = await f.manual.execute({
      ...f.input,
      expectedRevision: 999,
      preflightFingerprint: 'stale',
    });
    expect(replay).toEqual({ ...first, duplicate: true });
    expect(f.preflight).toHaveBeenCalledTimes(1);
    expect(f.prepareAndStart).toHaveBeenCalledTimes(1);
    expect(f.onChanged).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'revision', 'archived'] as const)(
    'rejects %s rules before preflight',
    async (kind) => {
      const f = fixture();
      if (kind === 'archived')
        f.store.schedules.setLifecycle(
          f.input.scheduleId,
          { expectedRevision: f.input.expectedRevision, updatedAt: f.now },
          { lifecycle: 'archived' },
        );
      const input = {
        ...f.input,
        scheduleId: kind === 'missing' ? 'missing' : f.input.scheduleId,
        expectedRevision: kind === 'archived' ? 2 : kind === 'revision' ? 999 : 1,
      };
      await expect(f.manual.execute(input)).rejects.toMatchObject({
        domainError: {
          code:
            kind === 'missing'
              ? 'schedule_not_found'
              : kind === 'archived'
                ? 'schedule_archived'
                : 'schedule_conflict',
        },
      });
      expect(f.preflight).not.toHaveBeenCalled();
      expect(f.prepareAndStart).not.toHaveBeenCalled();
    },
  );

  it.each(['blocked', 'fingerprint'] as const)(
    'rejects %s preflight without claiming',
    async (kind) => {
      const f = fixture();
      f.preflight.mockResolvedValue(
        kind === 'blocked'
          ? {
              status: 'blocked',
              fingerprint: 'fixture',
              problems: [{ code: 'model-disabled', message: '合成阻塞' }],
            }
          : { status: 'ready', fingerprint: 'changed', problems: [] },
      );
      await expect(f.manual.execute(f.input)).rejects.toMatchObject({
        domainError: {
          code: kind === 'blocked' ? 'schedule_capability_blocked' : 'schedule_conflict',
        },
      });
      expect(
        f.store.scheduleOccurrences.listBySchedule({ scheduleId: f.input.scheduleId }).items,
      ).toHaveLength(0);
      expect(f.onChanged).not.toHaveBeenCalled();
      expect(f.prepareAndStart).not.toHaveBeenCalled();
    },
  );

  it('returns busy with the existing occurrence and does not dispatch another request', async () => {
    const f = fixture();
    const first = await f.manual.execute(f.input);
    await expect(f.manual.execute({ ...f.input, requestKey: 'other' })).rejects.toMatchObject({
      domainError: { code: 'schedule_busy', existingOccurrenceId: first.occurrence.id },
    });
    expect(f.prepareAndStart).toHaveBeenCalledTimes(1);
  });

  it('lets atomic claim deduplicate simultaneous preflight completions', async () => {
    const f = fixture();
    const results = await Promise.all([f.manual.execute(f.input), f.manual.execute(f.input)]);
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(results[0]?.occurrence.id).toBe(results[1]?.occurrence.id);
    expect(f.prepareAndStart).toHaveBeenCalledTimes(1);
    expect(f.onChanged).toHaveBeenCalledTimes(1);
  });

  it('rechecks CAS after preflight and does not dispatch a stale claim', async () => {
    const f = fixture();
    f.preflight.mockImplementation(async () => {
      f.store.schedules.setLifecycle(
        f.input.scheduleId,
        { expectedRevision: 1, updatedAt: f.now },
        { lifecycle: 'paused' },
      );
      return { status: 'ready', fingerprint: 'fixture', problems: [] };
    });
    await expect(f.manual.execute(f.input)).rejects.toMatchObject({ currentRevision: 2 });
    expect(
      f.store.scheduleOccurrences.listBySchedule({ scheduleId: f.input.scheduleId }).items,
    ).toHaveLength(0);
    expect(f.prepareAndStart).not.toHaveBeenCalled();
  });

  it('accepts a committed occurrence and logs an asynchronous dispatch failure', async () => {
    const f = fixture();
    const error = new Error('synthetic dispatch failure');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    f.prepareAndStart.mockRejectedValue(error);
    const result = await f.manual.execute(f.input);
    expect(result.accepted).toBe(true);
    expect(f.store.scheduleOccurrences.get(result.occurrence.id)).toBeDefined();
    expect(logged).toHaveBeenCalledWith('Manual Schedule preparation failed', error);
  });

  it('copies a missed period and rejects foreign or non-missed originals', async () => {
    const f = fixture();
    const scheduledAt = f.now - 100_000;
    const enabled = f.store.schedules.create({
      id: 'enabled',
      workspaceId: f.workspace.id,
      config: f.config,
      createdAt: f.now,
      activation: {
        enabledAt: scheduledAt - 1,
        capabilityFingerprint: 'fixture',
        nextScheduledAt: scheduledAt,
      },
    });
    const period = resolveSchedulePeriod(
      f.config.periodRule,
      f.config.timing.timeZone,
      scheduledAt,
    );
    const missed = f.store.scheduleOccurrences.claimMissedScheduled({
      scheduleId: enabled.schedule.id,
      scheduledAt,
      requestedAt: f.now,
      nextScheduledAt: f.now + 100_000,
      period,
      reasonDetail: '合成错过',
    });
    if (missed.kind !== 'created') throw new Error('Missed fixture was not created');
    const input: ScheduleManualInput = {
      ...f.input,
      trigger: 'manual-missed',
      originalOccurrenceId: missed.occurrence.id,
    };
    await expect(f.manual.execute(input)).rejects.toMatchObject({
      domainError: { code: 'schedule_conflict' },
    });
    const retry = await f.manual.execute({ ...input, scheduleId: enabled.schedule.id });
    expect(retry.occurrence).toMatchObject({
      originalOccurrenceId: missed.occurrence.id,
      period,
      trigger: 'manual-missed',
    });
    await expect(
      f.manual.execute({
        ...input,
        requestKey: 'not-missed',
        originalOccurrenceId: retry.occurrence.id,
        scheduleId: enabled.schedule.id,
      }),
    ).rejects.toMatchObject({ domainError: { code: 'schedule_conflict' } });
  });
});

describe('ScheduleQueries without Electron', () => {
  it('returns missing identities and unavailable outcome errors explicitly', () => {
    const f = fixture();
    expect(() => f.queries.getSchedule('missing')).toThrow('定时规则不存在');
    expect(() => f.queries.getOccurrence('missing')).toThrow('定时实例不存在');
    expect(() => f.queries.listOccurrences({ scheduleId: 'missing' })).toThrow('定时规则不存在');
    expect(() => f.queries.listSourceItems({ occurrenceId: 'missing' })).toThrow('定时实例不存在');
    const occurrence = dispatchFixtureOccurrence(f);
    const queries = new ScheduleQueries(f.store, f.schedules, {
      projectOccurrence: () => undefined,
    });
    expect(() => queries.getOccurrence(occurrence.occurrenceId)).toThrow('定时实例结果不可用');
  });

  it('keeps fixed expert revision, six recent items and complete cursor pagination', () => {
    const f = fixture();
    for (let index = 0; index < 8; index++) {
      const claim = f.store.scheduleOccurrences.claimManual({
        scheduleId: f.input.scheduleId,
        trigger: 'manual-now',
        requestKey: `page-${index}`,
        requestedAt: f.now + index,
        period: resolveSchedulePeriod(f.config.periodRule, f.config.timing.timeZone, f.now),
      });
      if (claim.kind !== 'created') throw new Error('History fixture failed');
      f.store.scheduleOccurrences.closePreparation({
        occurrenceId: claim.occurrence.id,
        outcome: 'cancelled',
        finishedAt: f.now + index + 1,
      });
    }
    const updated = f.store.experts.saveRevision(
      f.expert.id,
      { ...f.expertDraft, name: '新修订' },
      f.expert.revision.revision,
    );
    const detail = f.queries.getSchedule(f.input.scheduleId);
    expect(detail.expertUpdate).toMatchObject({
      available: true,
      boundRevision: { id: f.expert.revision.id },
      currentRevision: { id: updated.revision.id },
    });
    expect(detail.history.items).toHaveLength(6);
    expect(detail.history.nextCursor).toBeDefined();
    const rest = f.queries.listOccurrences({
      scheduleId: f.input.scheduleId,
      cursor: detail.history.nextCursor,
      limit: 6,
    });
    expect(rest.items).toHaveLength(2);
    expect(
      new Set([...detail.history.items, ...rest.items].map((item) => item.occurrence.id)).size,
    ).toBe(8);
  });

  it('counts distinct reads and adoptions by output source Run including another relation author', () => {
    const f = fixture();
    const materials = [0, 1, 2].map((index) => ({
      kind: 'knowledge-revision' as const,
      knowledgeDocumentId: `document-${index}`,
      knowledgeRevisionId: `revision-${index}`,
      contentHash: `hash-${index}`,
      sourcePath: `/tmp/material-${index}.md`,
    }));
    const first = dispatchFixtureOccurrence(
      f,
      materials.map((reference) => ({
        reference,
        purpose: 'current-input',
        addedFrom: 'user-input',
      })),
    );
    const nextRun = 'run-follow-up';
    f.store.runs.create({
      id: nextRun,
      taskId: first.draft.task.id,
      sessionId: first.draft.sessionId,
      prompt: '人工继续',
      status: 'running',
      createdAt: f.now + 5,
    });
    for (const [index, operation] of (['read', 'parse', 'search'] as const).entries()) {
      const material = materials[index]!;
      f.store.materialReads.save({
        id: randomUUID(),
        runId: first.runId,
        material,
        operation,
        locator: '合成定位',
        contentHash: material.contentHash,
        capturedAt: f.now + 6,
      });
    }
    const artifact = f.store.artifacts.saveMarkdown({
      taskId: first.draft.task.id,
      runId: first.runId,
      origin: 'assistant-run',
      title: '首期',
      content: '不读取的正文',
    });
    f.store.artifactInputRelations.saveForRun(
      artifact.currentVersionId,
      nextRun,
      [
        { input: materials[0]!, relation: 'data' },
        { input: materials[0]!, relation: 'rule' },
        { input: materials[1]!, relation: 'background' },
      ],
      () => true,
    );
    const followup = f.store.artifacts.saveMarkdown({
      artifactId: artifact.id,
      taskId: first.draft.task.id,
      runId: nextRun,
      origin: 'assistant-run',
      title: '续作',
      content: '续作正文',
    });
    f.store.artifactInputRelations.saveForRun(
      followup.currentVersionId,
      nextRun,
      [{ input: materials[2]!, relation: 'data' }],
      () => true,
    );
    const bodyRead = vi.spyOn(f.store.artifacts, 'getVersionDetail');
    const allArtifacts = vi.spyOn(f.store.artifacts, 'list');
    const allVersions = vi.spyOn(f.store.artifacts, 'listVersions');
    const detail = f.queries.getOccurrence(first.occurrenceId);
    expect(detail).toMatchObject({
      readMaterialCount: 2,
      adoptedMaterialCount: 2,
      run: { id: first.runId },
      task: { id: first.draft.task.id },
      sourceSnapshot: { id: first.snapshot.id },
    });
    expect(bodyRead).not.toHaveBeenCalled();
    expect(allArtifacts).not.toHaveBeenCalled();
    expect(allVersions).not.toHaveBeenCalled();
    expect(f.queries.listSourceItems({ occurrenceId: first.occurrenceId }).items).toHaveLength(3);
  });
});
