import type { ScheduleNotificationReceipt } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

const now = Date.UTC(2026, 8, 20, 10);

/**
 * Seeds the full FK chain (workspace → expert → schedule → occurrence)
 * using the proper repository APIs, then returns the occurrence ID.
 */
const seedOccurrence = (store: AppStore, id: number): string => {
  const workspace = store.workspaces.create(
    `/tmp/betterwork-schedule-notif-repo-${id}`,
    '通知仓储测试',
  );
  const expert = store.experts.create({
    sourceKind: 'user',
    revision: {
      name: '通知测试专家',
      summary: '用于仓储测试',
      author: '',
      tags: [],
      identity: '离线测试身份。',
      principles: [],
      inputRequirements: [],
      deliveryRequirements: [],
      skillPreset: [],
      builtinToolPolicy: { mode: 'application-defaults' },
      modelReference: { mode: 'application-default' },
    },
  });
  const schedule = store.schedules.create({
    id: `schedule-notif-repo-${id}`,
    workspaceId: workspace.id,
    config: {
      name: '测试定时任务',
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
      requirements: '测试用需求。',
      expectedArtifactTypes: ['markdown'],
      timing: { frequency: 'daily', hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
      periodRule: 'none',
      knowledgeSources: [],
      outputSubdirectory: '定时成果',
    },
    createdAt: now,
  });
  const claimed = store.scheduleOccurrences.claimManual({
    scheduleId: schedule.schedule.id,
    trigger: 'manual-now',
    requestKey: `request-${id}`,
    requestedAt: now,
    period: { rule: 'none', timeZone: 'Asia/Shanghai', anchorAt: now, label: '本次执行' },
  });
  if (claimed.kind !== 'created') throw new Error('test setup: expected a creating occurrence');
  return claimed.occurrence.id;
};

const makeReceipt = (
  occurrenceId: string,
  overrides: Partial<ScheduleNotificationReceipt> = {},
): ScheduleNotificationReceipt => ({
  occurrenceId,
  outcomeKey: 'completed',
  notificationId: 'notif-1',
  createdAt: now,
  ...overrides,
});

describe('ScheduleNotificationRepository', () => {
  it('returns undefined when no receipt exists for the given key pair', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    expect(store.scheduleNotifications.get('missing', 'missing')).toBeUndefined();
  });

  it('creates a receipt and retrieves it by occurrenceId and outcomeKey', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const occurrenceId = seedOccurrence(store, 1);
    const receipt = makeReceipt(occurrenceId);
    const created = store.scheduleNotifications.create(receipt);
    expect(created).toEqual(receipt);

    const fetched = store.scheduleNotifications.get(receipt.occurrenceId, receipt.outcomeKey);
    expect(fetched).toEqual(receipt);
  });

  it('returns the existing receipt on duplicate create with the same notificationId', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const occurrenceId = seedOccurrence(store, 2);
    const receipt = makeReceipt(occurrenceId);
    store.scheduleNotifications.create(receipt);

    const duplicate = store.scheduleNotifications.create(receipt);
    expect(duplicate).toEqual(receipt);
  });

  it('throws on duplicate create with a different notificationId', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const occurrenceId = seedOccurrence(store, 3);
    store.scheduleNotifications.create(makeReceipt(occurrenceId));

    expect(() =>
      store.scheduleNotifications.create(
        makeReceipt(occurrenceId, { notificationId: 'different-notif' }),
      ),
    ).toThrow('already has a different receipt');
  });

  it('distinguishes receipts by outcomeKey for the same occurrenceId', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const occurrenceId = seedOccurrence(store, 4);
    const first = makeReceipt(occurrenceId, {
      outcomeKey: 'completed',
      notificationId: 'notif-a',
    });
    const second = makeReceipt(occurrenceId, {
      outcomeKey: 'failed',
      notificationId: 'notif-b',
    });
    store.scheduleNotifications.create(first);
    store.scheduleNotifications.create(second);

    expect(store.scheduleNotifications.get(occurrenceId, 'completed')!.notificationId).toBe(
      'notif-a',
    );
    expect(store.scheduleNotifications.get(occurrenceId, 'failed')!.notificationId).toBe('notif-b');
  });
});
