import {
  IpcChannel,
  type ScheduleConfigDraft,
  type ScheduleOccurrenceResult,
  scheduleOccurrenceResultSchema,
} from '@betterwork/agent-protocol';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import { NotificationService } from './notification-service';
import { ScheduleNotificationService } from './schedule-notification-service';
import { ScheduleOutcomeService } from './schedule-outcome-service';

const DAY_MS = 24 * 60 * 60 * 1_000;
const now = Date.UTC(2026, 8, 20, 10);

const configFor = (expertId: string, expertRevisionId: string): ScheduleConfigDraft => ({
  name: '每月回款复盘',
  expertId,
  expertRevisionId,
  requirements: '根据已固定的材料整理本期回款分析。',
  expectedArtifactTypes: ['markdown'],
  timing: { frequency: 'daily', hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
  periodRule: 'none',
  knowledgeSources: [],
  outputSubdirectory: '定时成果',
});

const stores: AppStore[] = [];
let nextId = 0;

const makeFixture = (enabled = false) => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const id = ++nextId;
  const workspace = store.workspaces.create(
    `/tmp/betterwork-schedule-notification-${id}`,
    '通知合成空间',
  );
  const expert = store.experts.create({
    sourceKind: 'user',
    revision: {
      name: '合成通知专家',
      summary: '用于通知测试',
      author: '',
      tags: [],
      identity: '使用离线合成资料。',
      principles: [],
      inputRequirements: [],
      deliveryRequirements: [],
      skillPreset: [],
      builtinToolPolicy: { mode: 'application-defaults' },
      modelReference: { mode: 'application-default' },
    },
  });
  const schedule = store.schedules.create({
    id: `schedule-notification-${id}`,
    workspaceId: workspace.id,
    config: configFor(expert.id, expert.revision.id),
    createdAt: now,
    ...(enabled
      ? {
          activation: {
            enabledAt: now - DAY_MS,
            capabilityFingerprint: 'synthetic-notification-capabilities',
            nextScheduledAt: now,
          },
        }
      : {}),
  });
  const occurrence = store.scheduleOccurrences.claimManual({
    scheduleId: schedule.schedule.id,
    trigger: 'manual-now',
    requestKey: `request-${id}`,
    requestedAt: now,
    period: { rule: 'none', timeZone: 'Asia/Shanghai', anchorAt: now, label: '本次执行' },
  });
  if (occurrence.kind !== 'created') throw new Error('test setup: expected a preparing occurrence');
  const closedOccurrence = store.scheduleOccurrences.closePreparation({
    occurrenceId: occurrence.occurrence.id,
    outcome: 'blocked',
    finishedAt: now + 1,
    reasonCode: 'schedule_capability_blocked',
    reasonDetail: '合成启动阻塞事实。',
  });
  const outcomes = new ScheduleOutcomeService(store, {
    registerOccurrenceOutputs: () => [],
    saveReceipt: async () => {
      throw new Error('No Run output should be saved in this fixture');
    },
  });
  return { store, schedule, occurrence: closedOccurrence, outcomes };
};

const makeNotifications = (
  store: AppStore,
  onSend?: (channel: string, payload: unknown) => void,
): NotificationService =>
  new NotificationService(store.notifications, () => {
    if (!onSend) return null;
    const stub = {
      isDestroyed: () => false,
      isFocused: () => true,
      isMinimized: () => false,
      restore: () => undefined,
      show: () => undefined,
      focus: () => undefined,
      webContents: { send: onSend },
    };
    return stub as unknown as BrowserWindow;
  });

const generatedResult = (fixture: ReturnType<typeof makeFixture>): ScheduleOccurrenceResult =>
  scheduleOccurrenceResultSchema.parse({
    occurrence: {
      ...fixture.occurrence,
      preparationOutcome: undefined,
      phase: 'closed',
      taskId: 'task-generated',
      sessionId: 'session-generated',
      firstRunId: 'run-generated',
      sourceSnapshotId: 'snapshot-generated',
      preparedAt: now + 2,
      finishedAt: now + 3,
    },
    status: 'generated',
    run: {
      id: 'run-generated',
      taskId: 'task-generated',
      sessionId: 'session-generated',
      prompt: '合成本期复盘',
      status: 'completed',
      createdAt: now + 2,
      completedAt: now + 3,
    },
    outputReceipts: [],
  });

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('ScheduleNotificationService', () => {
  it('commits the initial notification and receipt before publishing, then de-duplicates repeats', () => {
    const fixture = makeFixture();
    let publishedAfterCommit = false;
    const notifications = makeNotifications(fixture.store, (channel, payload) => {
      if (channel !== IpcChannel.NotificationChangeEvent) return;
      const event = payload as { type?: string; notification?: { id?: string } };
      if (event.type !== 'created' || !event.notification?.id) return;
      publishedAfterCommit =
        fixture.store.scheduleNotifications.get(fixture.occurrence.id, 'initial-outcome')
          ?.notificationId === event.notification.id;
    });
    const service = new ScheduleNotificationService(
      fixture.store,
      notifications,
      fixture.outcomes,
      {
        now: () => now + 4,
      },
    );

    const first = service.ensureOccurrence(fixture.occurrence.id);
    const repeated = service.ensureOccurrence(fixture.occurrence.id);

    expect(first).toMatchObject({
      kind: 'schedule',
      level: 'error',
      read: false,
      target: {
        kind: 'schedule',
        scheduleId: fixture.schedule.schedule.id,
        occurrenceId: fixture.occurrence.id,
      },
    });
    expect(repeated?.id).toBe(first?.id);
    expect(fixture.store.notifications.list()).toHaveLength(1);
    expect(
      fixture.store.scheduleNotifications.get(fixture.occurrence.id, 'initial-outcome'),
    ).toMatchObject({ notificationId: first?.id });
    expect(fixture.store.notifications.get(first?.id ?? '')?.target).toEqual({
      kind: 'schedule',
      scheduleId: fixture.schedule.schedule.id,
      occurrenceId: fixture.occurrence.id,
    });
    expect(publishedAfterCommit).toBe(true);
  });

  it.each(['clear', 'retention'] as const)(
    'does not recreate an initial notification after %s removes its row',
    (operation) => {
      const fixture = makeFixture();
      const notifications = makeNotifications(fixture.store);
      const service = new ScheduleNotificationService(
        fixture.store,
        notifications,
        fixture.outcomes,
      );
      const initial = service.ensureOccurrence(fixture.occurrence.id);
      if (!initial) throw new Error('test setup: missing initial notification');

      if (operation === 'clear') notifications.clear();
      else {
        for (let index = 0; index < 201; index += 1) {
          notifications.create({
            level: 'info',
            kind: 'system',
            title: `保留策略测试 ${String(index)}`,
          });
        }
      }

      expect(service.ensureOccurrence(fixture.occurrence.id)).toBeUndefined();
      expect(fixture.store.notifications.get(initial.id)).toBeUndefined();
      expect(
        fixture.store.scheduleNotifications.get(fixture.occurrence.id, 'initial-outcome'),
      ).toMatchObject({ notificationId: initial.id });
      if (operation === 'retention') expect(fixture.store.notifications.list()).toHaveLength(200);
    },
  );

  it('rolls the notification back if its outcome receipt cannot be written', () => {
    const fixture = makeFixture();
    const notifications = makeNotifications(fixture.store);
    const service = new ScheduleNotificationService(fixture.store, notifications, fixture.outcomes);
    const createReceipt = vi
      .spyOn(fixture.store.scheduleNotifications, 'create')
      .mockImplementation(() => {
        throw new Error('synthetic receipt failure');
      });

    expect(() => service.ensureOccurrence(fixture.occurrence.id)).toThrow(
      'synthetic receipt failure',
    );

    expect(fixture.store.notifications.list()).toEqual([]);
    expect(
      fixture.store.scheduleNotifications.get(fixture.occurrence.id, 'initial-outcome'),
    ).toBeUndefined();
    createReceipt.mockRestore();
  });

  it('uses NotificationService success-read policy for generated outcomes', () => {
    const fixture = makeFixture();
    const notifications = makeNotifications(fixture.store);
    const generated = generatedResult(fixture);
    const service = new ScheduleNotificationService(fixture.store, notifications, {
      projectOccurrence: () => generated,
    });

    const saved = service.ensureOccurrence(fixture.occurrence.id);

    expect(saved).toMatchObject({ kind: 'schedule', level: 'success', read: true });
  });

  it('recovers a completed missed batch once and keeps the aggregate target on a covered occurrence', async () => {
    const fixture = makeFixture(true);
    const missed = fixture.store.scheduleOccurrences.claimMissedScheduled({
      scheduleId: fixture.schedule.schedule.id,
      scheduledAt: now,
      requestedAt: now + 1,
      period: {
        rule: 'none',
        timeZone: 'Asia/Shanghai',
        anchorAt: now,
        label: '错过的周期',
      },
      nextScheduledAt: now + DAY_MS,
      reasonDetail: '错过后不自动补跑。',
    });
    if (missed.kind !== 'created') throw new Error('test setup: missed occurrence was not created');
    const batch = fixture.store.scheduleRecoveryBatches.begin({
      cutoffAt: now + 1,
      createdAt: now + 1,
      batchKey: 'recovery-batch-test',
    });
    fixture.store.scheduleRecoveryBatches.recordOccurrence({
      batchKey: batch.batchKey,
      cursor: { scheduleId: fixture.schedule.schedule.id, scheduledAt: now },
      occurrenceId: missed.occurrence.id,
      updatedAt: now + 1,
    });
    fixture.store.scheduleRecoveryBatches.complete({
      batchKey: batch.batchKey,
      completedAt: now + 2,
    });
    fixture.store.notifications.clear();
    const notifications = makeNotifications(fixture.store);
    const outcomes = new ScheduleOutcomeService(fixture.store, {
      registerOccurrenceOutputs: () => [],
      saveReceipt: async () => {
        throw new Error('No Run output should be saved for a missed occurrence');
      },
    });
    const publish = vi.spyOn(notifications, 'publish');
    const service = new ScheduleNotificationService(fixture.store, notifications, outcomes, {
      systemNotifyOnPublish: true,
    });

    const recovery = await service.recoverMissing();
    const repeated = service.ensureRecoveryBatch(batch.batchKey);

    expect(recovery).toMatchObject({ examinedBatches: 1, restoredBatches: 1 });
    expect(fixture.store.scheduleRecoveryBatches.get(batch.batchKey)?.notificationId).toBe(
      repeated?.id,
    );
    expect(repeated).toMatchObject({
      kind: 'schedule',
      level: 'warning',
      read: false,
      target: {
        kind: 'schedule',
        scheduleId: fixture.schedule.schedule.id,
        occurrenceId: missed.occurrence.id,
      },
    });
    expect(notifications.list()).toHaveLength(2);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenNthCalledWith(1, expect.anything(), { systemNotify: false });
    expect(publish).toHaveBeenNthCalledWith(2, expect.anything(), { systemNotify: false });
    expect(
      notifications
        .list()
        .filter(
          (notification) =>
            notification.target?.kind === 'schedule' &&
            notification.target.occurrenceId === missed.occurrence.id,
        ),
    ).toHaveLength(1);
  });

  it.each(['clear', 'retention'] as const)(
    'does not recreate a recovery-batch notification after %s removes its row',
    (operation) => {
      const fixture = makeFixture(true);
      const missed = fixture.store.scheduleOccurrences.claimMissedScheduled({
        scheduleId: fixture.schedule.schedule.id,
        scheduledAt: now,
        requestedAt: now + 1,
        period: {
          rule: 'none',
          timeZone: 'Asia/Shanghai',
          anchorAt: now,
          label: '错过的周期',
        },
        nextScheduledAt: now + DAY_MS,
        reasonDetail: '错过后不自动补跑。',
      });
      if (missed.kind !== 'created')
        throw new Error('test setup: missed occurrence was not created');
      const batch = fixture.store.scheduleRecoveryBatches.begin({
        cutoffAt: now + 1,
        createdAt: now + 1,
        batchKey: `recovery-batch-retention-${operation}`,
      });
      fixture.store.scheduleRecoveryBatches.recordOccurrence({
        batchKey: batch.batchKey,
        cursor: { scheduleId: fixture.schedule.schedule.id, scheduledAt: now },
        occurrenceId: missed.occurrence.id,
        updatedAt: now + 1,
      });
      fixture.store.scheduleRecoveryBatches.complete({
        batchKey: batch.batchKey,
        completedAt: now + 2,
      });
      const notifications = makeNotifications(fixture.store);
      const service = new ScheduleNotificationService(
        fixture.store,
        notifications,
        fixture.outcomes,
      );
      const initial = service.ensureRecoveryBatch(batch.batchKey);
      if (!initial) throw new Error('test setup: missing recovery batch notification');

      if (operation === 'clear') notifications.clear();
      else {
        for (let index = 0; index < 201; index += 1) {
          notifications.create({
            level: 'info',
            kind: 'system',
            title: `恢复通知保留测试 ${String(index)}`,
          });
        }
      }

      expect(service.ensureRecoveryBatch(batch.batchKey)).toBeUndefined();
      expect(fixture.store.notifications.get(initial.id)).toBeUndefined();
      expect(fixture.store.scheduleRecoveryBatches.get(batch.batchKey)?.notificationId).toBe(
        initial.id,
      );
      if (operation === 'retention') expect(notifications.list()).toHaveLength(200);
    },
  );
});
