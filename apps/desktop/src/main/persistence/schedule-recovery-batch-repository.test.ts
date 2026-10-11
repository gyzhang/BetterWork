import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

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

/**
 * Insert a minimal schedule row so the FK on cursor_schedule_id is satisfied.
 * The schedule_recovery_batches table references schedules(id).
 */
const seedSchedule = (store: AppStore, scheduleId: string): void => {
  const db = (store as unknown as { db: Database.Database }).db;
  db.pragma('foreign_keys = OFF');
  db.prepare(
    `INSERT INTO schedules (
       id, workspace_id, revision, current_config_version, lifecycle,
       created_at, updated_at
     ) VALUES (?, 'ws-seed', 1, 1, 'paused', 0, 0)`,
  ).run(scheduleId);
  db.pragma('foreign_keys = ON');
};

describe('ScheduleRecoveryBatchRepository begin', () => {
  it('creates a processing batch with empty cursor and empty occurrence IDs', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    expect(batch.phase).toBe('processing');
    expect(batch.cutoffAt).toBe(1000);
    expect(batch.cursor).toBeUndefined();
    expect(batch.coveredOccurrenceIds).toEqual([]);
    expect(batch.notificationId).toBeUndefined();
    expect(batch.completedAt).toBeUndefined();
    expect(batch.createdAt).toBe(1000);
    expect(batch.updatedAt).toBe(1000);
    expect(typeof batch.batchKey).toBe('string');
    expect(batch.batchKey.length).toBeGreaterThan(0);
  });

  it('uses a caller-supplied batchKey when provided', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({
      cutoffAt: 500,
      createdAt: 500,
      batchKey: 'custom-key',
    });
    expect(batch.batchKey).toBe('custom-key');
  });

  it('trims whitespace from a caller-supplied batchKey and falls back to UUID when blank', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({
      cutoffAt: 500,
      createdAt: 500,
      batchKey: '   ',
    });
    expect(batch.batchKey.length).toBeGreaterThan(0);
  });

  it('returns the existing processing batch when called again while one is active', () => {
    const store = openStore();
    const first = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    const second = store.scheduleRecoveryBatches.begin({ cutoffAt: 2000, createdAt: 2000 });
    expect(second.batchKey).toBe(first.batchKey);
    expect(second.cutoffAt).toBe(first.cutoffAt);
  });

  it('returns the existing batch when called with the same batchKey', () => {
    const store = openStore();
    const first = store.scheduleRecoveryBatches.begin({
      cutoffAt: 1000,
      createdAt: 1000,
      batchKey: 'repeat-key',
    });
    store.scheduleRecoveryBatches.complete({ batchKey: 'repeat-key', completedAt: 2000 });
    const again = store.scheduleRecoveryBatches.begin({
      cutoffAt: 3000,
      createdAt: 3000,
      batchKey: 'repeat-key',
    });
    expect(again.batchKey).toBe(first.batchKey);
  });

  it.each([
    { cutoffAt: -1, createdAt: 100, label: 'negative cutoffAt' },
    { cutoffAt: 100, createdAt: -1, label: 'negative createdAt' },
    { cutoffAt: 1.5, createdAt: 100, label: 'non-integer cutoffAt' },
  ])('rejects invalid timestamps ($label)', ({ cutoffAt, createdAt }) => {
    const store = openStore();
    expect(() => store.scheduleRecoveryBatches.begin({ cutoffAt, createdAt })).toThrow(
      'must be a non-negative safe integer',
    );
  });
});

describe('ScheduleRecoveryBatchRepository recordOccurrence advances cursor and accumulates IDs', () => {
  it('sets the cursor and adds the first occurrence ID', () => {
    const store = openStore();
    seedSchedule(store, 'sched-a');
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    const updated = store.scheduleRecoveryBatches.recordOccurrence({
      batchKey: batch.batchKey,
      cursor: { scheduleId: 'sched-a', scheduledAt: 100 },
      occurrenceId: 'occ-1',
      updatedAt: 1001,
    });
    expect(updated.cursor).toEqual({ scheduleId: 'sched-a', scheduledAt: 100 });
    expect(updated.coveredOccurrenceIds).toEqual(['occ-1']);
    expect(updated.updatedAt).toBe(1001);
  });

  it('accumulates multiple occurrence IDs without duplicates', () => {
    const store = openStore();
    seedSchedule(store, 'sched-a');
    seedSchedule(store, 'sched-b');
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    store.scheduleRecoveryBatches.recordOccurrence({
      batchKey: batch.batchKey,
      cursor: { scheduleId: 'sched-a', scheduledAt: 100 },
      occurrenceId: 'occ-1',
      updatedAt: 1001,
    });
    const second = store.scheduleRecoveryBatches.recordOccurrence({
      batchKey: batch.batchKey,
      cursor: { scheduleId: 'sched-a', scheduledAt: 200 },
      occurrenceId: 'occ-2',
      updatedAt: 1002,
    });
    expect(second.coveredOccurrenceIds).toEqual(['occ-1', 'occ-2']);
    expect(second.cursor).toEqual({ scheduleId: 'sched-a', scheduledAt: 200 });

    const withDuplicate = store.scheduleRecoveryBatches.recordOccurrence({
      batchKey: batch.batchKey,
      cursor: { scheduleId: 'sched-b', scheduledAt: 300 },
      occurrenceId: 'occ-1',
      updatedAt: 1003,
    });
    expect(withDuplicate.coveredOccurrenceIds).toEqual(['occ-1', 'occ-2']);
  });

  it('advances cursor when scheduleId is lexicographically greater', () => {
    const store = openStore();
    seedSchedule(store, 'sched-a');
    seedSchedule(store, 'sched-b');
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    store.scheduleRecoveryBatches.recordOccurrence({
      batchKey: batch.batchKey,
      cursor: { scheduleId: 'sched-a', scheduledAt: 100 },
      occurrenceId: 'occ-1',
      updatedAt: 1001,
    });
    const updated = store.scheduleRecoveryBatches.recordOccurrence({
      batchKey: batch.batchKey,
      cursor: { scheduleId: 'sched-b', scheduledAt: 50 },
      occurrenceId: 'occ-2',
      updatedAt: 1002,
    });
    expect(updated.cursor).toEqual({ scheduleId: 'sched-b', scheduledAt: 50 });
  });

  it('advances cursor when same scheduleId but later scheduledAt', () => {
    const store = openStore();
    seedSchedule(store, 'sched-a');
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    store.scheduleRecoveryBatches.recordOccurrence({
      batchKey: batch.batchKey,
      cursor: { scheduleId: 'sched-a', scheduledAt: 100 },
      occurrenceId: 'occ-1',
      updatedAt: 1001,
    });
    const updated = store.scheduleRecoveryBatches.recordOccurrence({
      batchKey: batch.batchKey,
      cursor: { scheduleId: 'sched-a', scheduledAt: 200 },
      occurrenceId: 'occ-2',
      updatedAt: 1002,
    });
    expect(updated.cursor).toEqual({ scheduleId: 'sched-a', scheduledAt: 200 });
  });

  it('rejects a cursor that does not move forward', () => {
    const store = openStore();
    seedSchedule(store, 'sched-a');
    seedSchedule(store, 'sched-b');
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    store.scheduleRecoveryBatches.recordOccurrence({
      batchKey: batch.batchKey,
      cursor: { scheduleId: 'sched-b', scheduledAt: 200 },
      occurrenceId: 'occ-1',
      updatedAt: 1001,
    });
    expect(() =>
      store.scheduleRecoveryBatches.recordOccurrence({
        batchKey: batch.batchKey,
        cursor: { scheduleId: 'sched-a', scheduledAt: 100 },
        occurrenceId: 'occ-2',
        updatedAt: 1002,
      }),
    ).toThrow('cursor must move forward');
  });

  it('rejects a cursor with same scheduleId and same scheduledAt', () => {
    const store = openStore();
    seedSchedule(store, 'sched-a');
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    store.scheduleRecoveryBatches.recordOccurrence({
      batchKey: batch.batchKey,
      cursor: { scheduleId: 'sched-a', scheduledAt: 100 },
      occurrenceId: 'occ-1',
      updatedAt: 1001,
    });
    expect(() =>
      store.scheduleRecoveryBatches.recordOccurrence({
        batchKey: batch.batchKey,
        cursor: { scheduleId: 'sched-a', scheduledAt: 100 },
        occurrenceId: 'occ-2',
        updatedAt: 1002,
      }),
    ).toThrow('cursor must move forward');
  });

  it('rejects an empty occurrenceId', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    expect(() =>
      store.scheduleRecoveryBatches.recordOccurrence({
        batchKey: batch.batchKey,
        cursor: { scheduleId: 'sched-a', scheduledAt: 100 },
        occurrenceId: '  ',
        updatedAt: 1001,
      }),
    ).toThrow('occurrenceId must not be empty');
  });

  it('rejects recording on a non-existent batch', () => {
    const store = openStore();
    expect(() =>
      store.scheduleRecoveryBatches.recordOccurrence({
        batchKey: 'nonexistent',
        cursor: { scheduleId: 'sched-a', scheduledAt: 100 },
        occurrenceId: 'occ-1',
        updatedAt: 1001,
      }),
    ).toThrow('not processing');
  });

  it('rejects recording on a completed batch', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    store.scheduleRecoveryBatches.complete({ batchKey: batch.batchKey, completedAt: 2000 });
    expect(() =>
      store.scheduleRecoveryBatches.recordOccurrence({
        batchKey: batch.batchKey,
        cursor: { scheduleId: 'sched-a', scheduledAt: 100 },
        occurrenceId: 'occ-1',
        updatedAt: 2001,
      }),
    ).toThrow('not processing');
  });
});

describe('ScheduleRecoveryBatchRepository complete', () => {
  it('transitions a processing batch to completed', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    const completed = store.scheduleRecoveryBatches.complete({
      batchKey: batch.batchKey,
      completedAt: 2000,
    });
    expect(completed.phase).toBe('completed');
    expect(completed.completedAt).toBe(2000);
    expect(completed.updatedAt).toBe(2000);
  });

  it('is idempotent when called again on an already completed batch', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    const first = store.scheduleRecoveryBatches.complete({
      batchKey: batch.batchKey,
      completedAt: 2000,
    });
    const second = store.scheduleRecoveryBatches.complete({
      batchKey: batch.batchKey,
      completedAt: 2000,
    });
    expect(second.phase).toBe('completed');
    expect(second.batchKey).toBe(first.batchKey);
  });

  it('throws when completing a non-existent batch', () => {
    const store = openStore();
    expect(() =>
      store.scheduleRecoveryBatches.complete({ batchKey: 'nonexistent', completedAt: 2000 }),
    ).toThrow('cannot complete');
  });

  it('rejects a negative completedAt', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    expect(() =>
      store.scheduleRecoveryBatches.complete({ batchKey: batch.batchKey, completedAt: -1 }),
    ).toThrow('must be a non-negative safe integer');
  });
});

describe('ScheduleRecoveryBatchRepository attachNotification', () => {
  it('attaches a notification ID to a completed batch', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    store.scheduleRecoveryBatches.complete({ batchKey: batch.batchKey, completedAt: 2000 });
    const attached = store.scheduleRecoveryBatches.attachNotification({
      batchKey: batch.batchKey,
      notificationId: 'notif-1',
      updatedAt: 3000,
    });
    expect(attached.notificationId).toBe('notif-1');
    expect(attached.updatedAt).toBe(3000);
  });

  it('is idempotent when called with the same notification ID', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    store.scheduleRecoveryBatches.complete({ batchKey: batch.batchKey, completedAt: 2000 });
    store.scheduleRecoveryBatches.attachNotification({
      batchKey: batch.batchKey,
      notificationId: 'notif-1',
      updatedAt: 3000,
    });
    const again = store.scheduleRecoveryBatches.attachNotification({
      batchKey: batch.batchKey,
      notificationId: 'notif-1',
      updatedAt: 4000,
    });
    expect(again.notificationId).toBe('notif-1');
  });

  it('rejects an empty notificationId', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    store.scheduleRecoveryBatches.complete({ batchKey: batch.batchKey, completedAt: 2000 });
    expect(() =>
      store.scheduleRecoveryBatches.attachNotification({
        batchKey: batch.batchKey,
        notificationId: '  ',
        updatedAt: 3000,
      }),
    ).toThrow('notificationId must not be empty');
  });

  it('rejects attaching to a processing batch', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    expect(() =>
      store.scheduleRecoveryBatches.attachNotification({
        batchKey: batch.batchKey,
        notificationId: 'notif-1',
        updatedAt: 3000,
      }),
    ).toThrow('cannot attach');
  });

  it('rejects attaching to a batch that already has a different notification', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    store.scheduleRecoveryBatches.complete({ batchKey: batch.batchKey, completedAt: 2000 });
    store.scheduleRecoveryBatches.attachNotification({
      batchKey: batch.batchKey,
      notificationId: 'notif-1',
      updatedAt: 3000,
    });
    expect(() =>
      store.scheduleRecoveryBatches.attachNotification({
        batchKey: batch.batchKey,
        notificationId: 'notif-2',
        updatedAt: 4000,
      }),
    ).toThrow('cannot attach');
  });
});

describe('ScheduleRecoveryBatchRepository get and list queries', () => {
  it('get returns undefined for a missing batch', () => {
    const store = openStore();
    expect(store.scheduleRecoveryBatches.get('nonexistent')).toBeUndefined();
  });

  it('getProcessing returns the active processing batch', () => {
    const store = openStore();
    expect(store.scheduleRecoveryBatches.getProcessing()).toBeUndefined();
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    const processing = store.scheduleRecoveryBatches.getProcessing();
    expect(processing).toBeDefined();
    expect(processing?.batchKey).toBe(batch.batchKey);
  });

  it('getProcessing returns undefined after the batch completes', () => {
    const store = openStore();
    const batch = store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    store.scheduleRecoveryBatches.complete({ batchKey: batch.batchKey, completedAt: 2000 });
    expect(store.scheduleRecoveryBatches.getProcessing()).toBeUndefined();
  });

  it('listCompletedWithoutNotification returns completed batches lacking a notification', () => {
    const store = openStore();
    const first = store.scheduleRecoveryBatches.begin({
      cutoffAt: 1000,
      createdAt: 1000,
      batchKey: 'batch-1',
    });
    store.scheduleRecoveryBatches.complete({ batchKey: 'batch-1', completedAt: 2000 });

    const second = store.scheduleRecoveryBatches.begin({
      cutoffAt: 3000,
      createdAt: 3000,
      batchKey: 'batch-2',
    });
    store.scheduleRecoveryBatches.complete({ batchKey: 'batch-2', completedAt: 4000 });
    store.scheduleRecoveryBatches.attachNotification({
      batchKey: 'batch-2',
      notificationId: 'notif-2',
      updatedAt: 5000,
    });

    void first;
    void second;
    const pending = store.scheduleRecoveryBatches.listCompletedWithoutNotification();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.batchKey).toBe('batch-1');
  });

  it('listCompletedWithoutNotification excludes processing batches', () => {
    const store = openStore();
    store.scheduleRecoveryBatches.begin({ cutoffAt: 1000, createdAt: 1000 });
    expect(store.scheduleRecoveryBatches.listCompletedWithoutNotification()).toHaveLength(0);
  });

  it.each([
    { limit: 0, label: 'zero' },
    { limit: 501, label: 'above 500' },
    { limit: 1.5, label: 'non-integer' },
  ])('listCompletedWithoutNotification rejects invalid limit ($label)', ({ limit }) => {
    const store = openStore();
    expect(() => store.scheduleRecoveryBatches.listCompletedWithoutNotification(limit)).toThrow(
      'must be between 1 and 500',
    );
  });

  it('listCompletedWithoutNotification respects the limit parameter', () => {
    const store = openStore();
    for (let i = 0; i < 3; i++) {
      const batch = store.scheduleRecoveryBatches.begin({
        cutoffAt: (i + 1) * 1000,
        createdAt: (i + 1) * 1000,
        batchKey: `batch-${i}`,
      });
      store.scheduleRecoveryBatches.complete({
        batchKey: batch.batchKey,
        completedAt: (i + 1) * 2000,
      });
    }
    expect(store.scheduleRecoveryBatches.listCompletedWithoutNotification(2)).toHaveLength(2);
    expect(store.scheduleRecoveryBatches.listCompletedWithoutNotification(100)).toHaveLength(3);
  });
});
