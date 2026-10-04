import type { ExpertRevisionDraft, ScheduleConfigDraft } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore, type ScheduleOccurrencePage } from '../persistence';
import { NotificationService } from './notification-service';
import { ScheduleNotificationService } from './schedule-notification-service';
import { ScheduleOutcomeService } from './schedule-outcome-service';
import { SCHEDULE_TICK_INTERVAL_MS, ScheduleScheduler } from './schedule-scheduler';

const stores: AppStore[] = [];
const DAILY_AT = Date.UTC(2025, 0, 1, 9, 0);
const DAY_MS = 24 * 60 * 60 * 1_000;

const expertDraft: ExpertRevisionDraft = {
  name: '合成定时专家',
  summary: '用于调度器离线测试',
  author: '',
  tags: [],
  identity: '使用合成输入完成验证。',
  principles: ['不访问外部服务'],
  inputRequirements: ['合成材料'],
  deliveryRequirements: ['记录离线结果'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
};

const configFor = (expertId: string, expertRevisionId: string): ScheduleConfigDraft => ({
  name: '每日离线调度',
  expertId,
  expertRevisionId,
  requirements: '验证计划事实和恢复记录。',
  expectedArtifactTypes: ['markdown'],
  timing: { frequency: 'daily', hour: 9, minute: 0, timeZone: 'UTC' },
  periodRule: 'none',
  knowledgeSources: [],
  outputSubdirectory: '定时成果',
});

const fixture = (scheduleIds = ['schedule-a']) => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const workspace = store.workspaces.create(
    `/tmp/betterwork-scheduler-${scheduleIds.join('-')}`,
    '定时调度合成工作区',
  );
  const expert = store.experts.create({ sourceKind: 'user', revision: expertDraft });
  for (const scheduleId of scheduleIds) {
    store.schedules.create({
      id: scheduleId,
      workspaceId: workspace.id,
      config: configFor(expert.id, expert.revision.id),
      createdAt: 1,
      activation: {
        enabledAt: DAILY_AT - DAY_MS,
        capabilityFingerprint: 'synthetic-capabilities',
        nextScheduledAt: DAILY_AT,
      },
    });
  }
  return { store, scheduleIds };
};

const allOccurrences = (store: AppStore, scheduleId: string) => {
  const occurrences: ScheduleOccurrencePage['items'] = [];
  let cursor: ScheduleOccurrencePage['nextCursor'];
  do {
    const page = store.scheduleOccurrences.listBySchedule({
      scheduleId,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    });
    occurrences.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return occurrences;
};

const noError = (error: unknown): void => {
  throw error;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('ScheduleScheduler', () => {
  it.each([
    { secondsLate: 59, outcome: 'preparing' },
    { secondsLate: 60, outcome: 'preparing' },
    { secondsLate: 61, outcome: 'missed' },
  ] as const)(
    'applies the normal $secondsLate-second late boundary',
    async ({ secondsLate, outcome }) => {
      const { store } = fixture();
      let wallAt = DAILY_AT + secondsLate * 1_000;
      const dispatched: string[] = [];
      const scheduler = new ScheduleScheduler(store, {
        wallClock: () => wallAt,
        monotonicClock: () => 1_000,
        dispatch: (occurrence) => {
          dispatched.push(occurrence.id);
        },
        onError: noError,
      });

      await scheduler.tick();

      const [occurrence] = allOccurrences(store, 'schedule-a');
      expect(occurrence?.preparationOutcome ?? occurrence?.phase).toBe(outcome);
      expect(dispatched).toHaveLength(outcome === 'preparing' ? 1 : 0);
      if (secondsLate === 60) {
        wallAt += 1;
        await scheduler.tick();
        expect(allOccurrences(store, 'schedule-a')).toHaveLength(1);
      }
    },
  );

  it('records restart recovery as missed even when the occurrence is only milliseconds old', async () => {
    const { store } = fixture();
    const completedBatchKeys: string[] = [];
    const scheduler = new ScheduleScheduler(store, {
      wallClock: () => DAILY_AT + 10,
      monotonicClock: () => 0,
      dispatch: () => {
        throw new Error('recovery must never dispatch');
      },
      onRecoveryBatchCompleted: (batchKey) => {
        completedBatchKeys.push(batchKey);
      },
      onError: noError,
    });

    const batch = await scheduler.recover();

    expect(batch?.phase).toBe('completed');
    expect(batch?.notificationId).toBeUndefined();
    expect(completedBatchKeys).toEqual([batch?.batchKey]);
    expect(allOccurrences(store, 'schedule-a')).toMatchObject([
      {
        scheduledAt: DAILY_AT,
        phase: 'closed',
        preparationOutcome: 'missed',
        requestedAt: DAILY_AT + 10,
      },
    ]);
  });

  it('keeps tick dispatch idempotent and persists an occurrence before dispatch', async () => {
    const { store } = fixture();
    let dispatchCount = 0;
    const scheduler = new ScheduleScheduler(store, {
      wallClock: () => DAILY_AT,
      monotonicClock: () => 0,
      dispatch: () => {
        dispatchCount += 1;
        expect(allOccurrences(store, 'schedule-a')).toHaveLength(1);
      },
      onError: noError,
    });

    await scheduler.tick();
    await scheduler.tick();

    expect(dispatchCount).toBe(1);
    expect(allOccurrences(store, 'schedule-a')).toHaveLength(1);
  });

  it('closes a rejected preparation callback as blocked and reports the original failure', async () => {
    const { store } = fixture();
    const failure = new Error('synthetic preparation failure');
    const reported: unknown[] = [];
    const scheduler = new ScheduleScheduler(store, {
      wallClock: () => DAILY_AT,
      monotonicClock: () => 0,
      dispatch: () => {
        throw failure;
      },
      onError: (error) => {
        reported.push(error);
      },
    });

    await scheduler.tick();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(allOccurrences(store, 'schedule-a')).toMatchObject([
      {
        phase: 'closed',
        preparationOutcome: 'blocked',
        reasonCode: 'schedule_preparation_failed',
      },
    ]);
    expect(reported).toContain(failure);
  });

  it('misses forward-jumped occurrences, suppresses a backward-jump tick, and blocks invalid time', async () => {
    const forwardFixture = fixture();
    let forwardWall = DAILY_AT - 120_000;
    let forwardMono = 10;
    let dispatches = 0;
    const forwardScheduler = new ScheduleScheduler(forwardFixture.store, {
      wallClock: () => forwardWall,
      monotonicClock: () => forwardMono,
      dispatch: () => {
        dispatches += 1;
      },
      onError: noError,
    });
    await forwardScheduler.tick();
    forwardWall = DAILY_AT + 61_000;
    forwardMono += 1;
    await forwardScheduler.tick();
    expect(allOccurrences(forwardFixture.store, 'schedule-a')).toMatchObject([
      { preparationOutcome: 'missed', reasonCode: 'schedule_clock_untrusted' },
    ]);
    expect(dispatches).toBe(0);

    const backwardFixture = fixture();
    let backwardWall = DAILY_AT - 1_000;
    let backwardMono = 20;
    const backwardScheduler = new ScheduleScheduler(backwardFixture.store, {
      wallClock: () => backwardWall,
      monotonicClock: () => backwardMono,
      dispatch: () => {
        dispatches += 1;
      },
      onError: noError,
    });
    await backwardScheduler.tick();
    backwardWall -= 120_000;
    backwardMono += 1;
    await backwardScheduler.tick();
    expect(allOccurrences(backwardFixture.store, 'schedule-a')).toHaveLength(0);
    expect(dispatches).toBe(0);

    const invalidFixture = fixture();
    const invalidScheduler = new ScheduleScheduler(invalidFixture.store, {
      wallClock: () => Number.NaN,
      monotonicClock: () => 1,
      dispatch: () => {
        dispatches += 1;
      },
      onError: noError,
    });
    await invalidScheduler.tick();
    expect(invalidFixture.store.schedules.get('schedule-a')?.schedule.dispatchBlock).toMatchObject({
      code: 'schedule_clock_untrusted',
    });
    expect(allOccurrences(invalidFixture.store, 'schedule-a')).toHaveLength(0);
  });

  it('persists a fixed 100-item batch cursor and resumes without duplicate occurrences', async () => {
    const { store } = fixture();
    const notifications = new NotificationService(store.notifications, () => null);
    const outcomes = new ScheduleOutcomeService(store, {
      registerOccurrenceOutputs: () => [],
      saveReceipt: async () => {
        throw new Error('Recovery-only fixture must not save Run outputs');
      },
    });
    const scheduleNotifications = new ScheduleNotificationService(store, notifications, outcomes);
    const recoveryAt = DAILY_AT + 200 * DAY_MS - 1;
    const interrupted = new ScheduleScheduler(store, {
      wallClock: () => recoveryAt,
      monotonicClock: () => 0,
      dispatch: () => {
        throw new Error('missed recovery must not dispatch');
      },
      onError: noError,
      yieldToEventLoop: async () => {
        throw new Error('synthetic process interruption');
      },
    });

    await expect(interrupted.recover()).rejects.toThrow('synthetic process interruption');
    const partialBatch = store.scheduleRecoveryBatches.getProcessing();
    expect(partialBatch).toMatchObject({
      phase: 'processing',
      cutoffAt: recoveryAt,
      cursor: { scheduleId: 'schedule-a', scheduledAt: DAILY_AT + 99 * DAY_MS },
    });
    expect(partialBatch?.coveredOccurrenceIds).toHaveLength(100);
    expect(partialBatch?.notificationId).toBeUndefined();
    expect(notifications.list()).toHaveLength(0);
    expect(allOccurrences(store, 'schedule-a')).toHaveLength(100);

    const completedBatchKeys: string[] = [];
    const resumed = new ScheduleScheduler(store, {
      wallClock: () => recoveryAt + 10_000,
      monotonicClock: () => 0,
      dispatch: () => {
        throw new Error('resumed missed recovery must not dispatch');
      },
      onError: noError,
      onRecoveryBatchCompleted: (batchKey) => {
        completedBatchKeys.push(batchKey);
        return scheduleNotifications.persistRecoveryBatchWithinTransaction(batchKey).afterCommit;
      },
      yieldToEventLoop: async () => Promise.resolve(),
    });
    const completed = await resumed.recover();
    expect(completed).toMatchObject({ phase: 'completed', cutoffAt: recoveryAt });
    expect(completed?.coveredOccurrenceIds).toHaveLength(200);
    const occurrences = allOccurrences(store, 'schedule-a');
    expect(occurrences).toHaveLength(200);
    expect(new Set(occurrences.map((item) => item.id)).size).toBe(200);
    expect(completed?.batchKey).toBeDefined();
    expect(completed?.notificationId).toBeDefined();
    expect(completedBatchKeys).toEqual([completed?.batchKey]);
    expect(notifications.list()).toHaveLength(1);
    expect(notifications.list()[0]).toMatchObject({
      kind: 'schedule',
      level: 'warning',
      target: { kind: 'schedule', occurrenceId: completed?.coveredOccurrenceIds[0] },
    });
    if (!completed) return;
    const repeated = await resumed.recover({ batchKey: completed.batchKey });
    expect(repeated?.batchKey).toBe(completed?.batchKey);
    expect(completedBatchKeys).toEqual([completed.batchKey]);
    expect(allOccurrences(store, 'schedule-a')).toHaveLength(200);
  });

  it('does not accrue missed debt while paused and uses the new future cursor on resume', async () => {
    const { store } = fixture();
    const schedule = store.schedules.get('schedule-a');
    expect(schedule).toBeDefined();
    if (!schedule) return;
    store.schedules.setLifecycle(
      'schedule-a',
      { expectedRevision: schedule.schedule.revision, updatedAt: DAILY_AT },
      { lifecycle: 'paused' },
    );
    const resumedAt = DAILY_AT + 10 * DAY_MS;
    const pausedScheduler = new ScheduleScheduler(store, {
      wallClock: () => resumedAt,
      monotonicClock: () => 0,
      dispatch: () => {
        throw new Error('paused schedule cannot dispatch');
      },
      onError: noError,
    });
    expect(await pausedScheduler.recover()).toBeUndefined();

    const paused = store.schedules.get('schedule-a');
    expect(paused).toBeDefined();
    if (!paused) return;
    store.schedules.setLifecycle(
      'schedule-a',
      { expectedRevision: paused.schedule.revision, updatedAt: resumedAt },
      {
        lifecycle: 'enabled',
        enabledAt: resumedAt,
        capabilityFingerprint: 'synthetic-capabilities',
        nextScheduledAt: DAILY_AT + 11 * DAY_MS,
      },
    );
    expect(await pausedScheduler.recover()).toBeUndefined();
    expect(allOccurrences(store, 'schedule-a')).toHaveLength(0);
  });

  it('caps concurrent preparation at two and records a distinct capacity skip', async () => {
    const { store, scheduleIds } = fixture(['schedule-a', 'schedule-b', 'schedule-c']);
    const notifications = new NotificationService(store.notifications, () => null);
    const outcomes = new ScheduleOutcomeService(store, {
      registerOccurrenceOutputs: () => [],
      saveReceipt: async () => {
        throw new Error('Capacity fixture must not save Run outputs');
      },
    });
    const scheduleNotifications = new ScheduleNotificationService(store, notifications, outcomes);
    const release: (() => void)[] = [];
    const scheduler = new ScheduleScheduler(store, {
      wallClock: () => DAILY_AT + 60_000,
      monotonicClock: () => 0,
      dispatch: () =>
        new Promise<void>((resolve) => {
          release.push(resolve);
        }),
      onOccurrenceClosed: (occurrenceId) =>
        scheduleNotifications.persistOccurrenceWithinTransaction(occurrenceId).afterCommit,
      onError: noError,
    });

    await scheduler.tick();

    expect(scheduler.activePreparationCount).toBe(2);
    for (const scheduleId of scheduleIds.slice(0, 2)) {
      expect(allOccurrences(store, scheduleId)).toMatchObject([{ phase: 'preparing' }]);
    }
    const [capacitySkipped] = allOccurrences(store, 'schedule-c');
    expect([capacitySkipped]).toMatchObject([
      {
        phase: 'closed',
        preparationOutcome: 'skipped-overlap',
        reasonCode: 'schedule_capacity',
      },
    ]);
    expect(
      store.scheduleNotifications.get(capacitySkipped?.id ?? '', 'initial-outcome')?.notificationId,
    ).toBeDefined();
    expect(notifications.list()).toMatchObject([
      {
        kind: 'schedule',
        target: { kind: 'schedule', occurrenceId: capacitySkipped?.id },
      },
    ]);
    for (const resolve of release) resolve();
    await Promise.resolve();
  });

  it('uses a 30-second timer and invalidates a queued callback after stop', async () => {
    const { store } = fixture();
    let callback: (() => void) | undefined;
    let delay: number | undefined;
    let dispatches = 0;
    let timerHandle: number | undefined;
    const scheduler = new ScheduleScheduler(store, {
      wallClock: () => DAILY_AT,
      monotonicClock: () => 0,
      timer: {
        setInterval: (next, interval) => {
          callback = next;
          delay = interval;
          timerHandle = 7;
          return timerHandle as unknown as ReturnType<typeof globalThis.setInterval>;
        },
        clearInterval: () => {
          timerHandle = undefined;
        },
      },
      dispatch: () => {
        dispatches += 1;
      },
      onError: noError,
    });

    scheduler.start();
    expect(delay).toBe(SCHEDULE_TICK_INTERVAL_MS);
    callback?.();
    scheduler.stop();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(timerHandle).toBeUndefined();
    expect(dispatches).toBe(0);
    expect(allOccurrences(store, 'schedule-a')).toHaveLength(0);
  });

  it('aborts live preparation when dispatch is stopped and can await its cleanup', async () => {
    const { store } = fixture();
    let preparationSignal: AbortSignal | undefined;
    const scheduler = new ScheduleScheduler(store, {
      wallClock: () => DAILY_AT,
      monotonicClock: () => 0,
      dispatch: (_occurrence, context) => {
        preparationSignal = context.signal;
        return new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      },
      onError: noError,
    });

    await scheduler.tick();
    expect(scheduler.activePreparationCount).toBe(1);
    scheduler.stop();
    expect(preparationSignal?.aborted).toBe(true);
    await scheduler.waitForPreparations();

    expect(scheduler.activePreparationCount).toBe(0);
  });

  it('reconciles preparing occurrences before processing missed scheduled times', async () => {
    const { store } = fixture();
    const claim = store.scheduleOccurrences.claimManual({
      scheduleId: 'schedule-a',
      trigger: 'manual-now',
      requestKey: 'recovery-before-missed',
      requestedAt: DAILY_AT - DAY_MS,
      period: { rule: 'none', timeZone: 'UTC', anchorAt: DAILY_AT - DAY_MS, label: '无期间' },
    });
    expect(claim.kind).toBe('created');
    if (claim.kind !== 'created') return;
    const recoveryOrder: string[] = [];
    const scheduler = new ScheduleScheduler(store, {
      wallClock: () => DAILY_AT + 10,
      monotonicClock: () => 0,
      recoverPreparations: () => {
        recoveryOrder.push('preparations');
        store.scheduleOccurrences.closePreparation({
          occurrenceId: claim.occurrence.id,
          outcome: 'interrupted-before-run',
          finishedAt: DAILY_AT + 10,
          reasonDetail: '恢复时关闭未派发实例。',
        });
      },
      dispatch: () => {
        recoveryOrder.push('dispatch');
      },
      onError: noError,
    });

    await scheduler.recover();

    expect(recoveryOrder).toEqual(['preparations']);
    expect(store.scheduleOccurrences.get(claim.occurrence.id)).toMatchObject({
      phase: 'closed',
      preparationOutcome: 'interrupted-before-run',
    });
  });
});
