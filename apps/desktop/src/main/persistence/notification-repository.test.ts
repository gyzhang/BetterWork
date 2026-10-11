import type { CreateNotificationInput } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

const baseInput = (overrides: Partial<CreateNotificationInput> = {}): CreateNotificationInput => ({
  level: 'info',
  kind: 'run',
  title: 'Run completed',
  ...overrides,
});

describe('NotificationRepository persists and retrieves notification summaries', () => {
  it('round-trips a saved notification with a task target', () => {
    const store = openStore();
    const saved = store.notifications.save(
      baseInput({ target: { kind: 'task', taskId: 'task-1' } }),
    );
    const loaded = store.notifications.get(saved.id);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(saved.id);
    expect(loaded!.level).toBe('info');
    expect(loaded!.kind).toBe('run');
    expect(loaded!.title).toBe('Run completed');
    expect(loaded!.target).toEqual({ kind: 'task', taskId: 'task-1' });
    expect(loaded!.read).toBe(false);
    expect(typeof loaded!.createdAt).toBe('number');
  });

  it('round-trips a notification with an artifact target', () => {
    const store = openStore();
    const saved = store.notifications.save(
      baseInput({ target: { kind: 'artifact', artifactId: 'art-1' } }),
    );
    const loaded = store.notifications.get(saved.id);
    expect(loaded!.target).toEqual({ kind: 'artifact', artifactId: 'art-1' });
  });

  it('round-trips a notification with a knowledge target that has no target_id', () => {
    const store = openStore();
    const saved = store.notifications.save(baseInput({ target: { kind: 'knowledge' } }));
    const loaded = store.notifications.get(saved.id);
    expect(loaded!.target).toEqual({ kind: 'knowledge' });
  });

  it('round-trips a schedule-rule target without occurrenceId', () => {
    const store = openStore();
    const saved = store.notifications.save(
      baseInput({ target: { kind: 'schedule', scheduleId: 'sched-1' } }),
    );
    const loaded = store.notifications.get(saved.id);
    expect(loaded!.target).toEqual({ kind: 'schedule', scheduleId: 'sched-1' });
  });

  it('round-trips a schedule-occurrence target with both scheduleId and occurrenceId', () => {
    const store = openStore();
    // The schedule_id is resolved via LEFT JOIN with schedule_occurrences,
    // so we need a real occurrence row for the target to resolve.
    const db = (store as unknown as { db: Database.Database }).db;
    db.pragma('foreign_keys = OFF');
    db.prepare(
      `INSERT INTO schedule_occurrences
         (id, schedule_id, config_version, trigger, scheduled_at, requested_at, period_json, phase, created_at)
       VALUES (?, ?, 1, 'scheduled', 0, 0, '{}', 'preparing', 0)`,
    ).run('occ-1', 'sched-1');
    db.pragma('foreign_keys = ON');
    const saved = store.notifications.save(
      baseInput({
        target: { kind: 'schedule', scheduleId: 'sched-1', occurrenceId: 'occ-1' },
      }),
    );
    const loaded = store.notifications.get(saved.id);
    expect(loaded!.target).toEqual({
      kind: 'schedule',
      scheduleId: 'sched-1',
      occurrenceId: 'occ-1',
    });
  });

  it('returns undefined for a missing notification id', () => {
    const store = openStore();
    expect(store.notifications.get('nonexistent')).toBeUndefined();
  });

  it('preserves optional detail when provided', () => {
    const store = openStore();
    const saved = store.notifications.save(baseInput({ detail: 'Some detail text' }));
    const loaded = store.notifications.get(saved.id);
    expect(loaded!.detail).toBe('Some detail text');
  });

  it('omits detail from summary when not provided', () => {
    const store = openStore();
    const saved = store.notifications.save(baseInput());
    const loaded = store.notifications.get(saved.id);
    expect(loaded!.detail).toBeUndefined();
  });
});

describe('NotificationRepository enforces a 200-notification retention limit', () => {
  it('evicts the oldest notification when saving the 201st', () => {
    const store = openStore();
    const saved: ReturnType<typeof store.notifications.save>[] = [];
    for (let i = 0; i < 201; i++) {
      saved.push(store.notifications.save(baseInput({ title: `Notification ${i}` })));
    }
    const all = store.notifications.list();
    expect(all).toHaveLength(200);
    // The very first saved notification should have been evicted
    expect(store.notifications.get(saved[0]!.id)).toBeUndefined();
    // The second and latest should still exist
    expect(store.notifications.get(saved[1]!.id)).toBeDefined();
    expect(store.notifications.get(saved[200]!.id)).toBeDefined();
  });

  it('keeps exactly 200 notifications after saving 200', () => {
    const store = openStore();
    for (let i = 0; i < 200; i++) {
      store.notifications.save(baseInput({ title: `Notification ${i}` }));
    }
    expect(store.notifications.list()).toHaveLength(200);
  });

  it('returns list in descending created_at order', () => {
    const store = openStore();
    for (let i = 0; i < 5; i++) {
      store.notifications.save(baseInput({ title: `Notification ${i}` }));
    }
    const all = store.notifications.list();
    expect(all).toHaveLength(5);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1]!.createdAt).toBeGreaterThanOrEqual(all[i]!.createdAt);
    }
  });
});

describe('NotificationRepository tracks read state and unread counts', () => {
  it('saves a notification as unread by default and counts it', () => {
    const store = openStore();
    store.notifications.save(baseInput());
    store.notifications.save(baseInput());
    expect(store.notifications.unreadCount()).toBe(2);
  });

  it('saves a notification as read when options.read is true', () => {
    const store = openStore();
    const saved = store.notifications.save(baseInput(), { read: true });
    expect(saved.read).toBe(true);
    expect(store.notifications.unreadCount()).toBe(0);
  });

  it('marks a single notification as read and returns updated unread count', () => {
    const store = openStore();
    const first = store.notifications.save(baseInput());
    store.notifications.save(baseInput());
    const remaining = store.notifications.markRead(first.id);
    expect(remaining).toBe(1);
    const loaded = store.notifications.get(first.id);
    expect(loaded!.read).toBe(true);
  });

  it('marks all notifications as read and returns zero unread', () => {
    const store = openStore();
    store.notifications.save(baseInput());
    store.notifications.save(baseInput());
    store.notifications.save(baseInput());
    const remaining = store.notifications.markAllRead();
    expect(remaining).toBe(0);
    expect(store.notifications.unreadCount()).toBe(0);
  });

  it('delete removes a notification and returns true for existing, false for missing', () => {
    const store = openStore();
    const saved = store.notifications.save(baseInput());
    expect(store.notifications.delete(saved.id)).toBe(true);
    expect(store.notifications.get(saved.id)).toBeUndefined();
    expect(store.notifications.delete('nonexistent')).toBe(false);
  });

  it('clear removes all notifications', () => {
    const store = openStore();
    store.notifications.save(baseInput());
    store.notifications.save(baseInput());
    store.notifications.clear();
    expect(store.notifications.list()).toHaveLength(0);
    expect(store.notifications.unreadCount()).toBe(0);
  });
});
