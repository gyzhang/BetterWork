import { randomUUID } from 'node:crypto';

import type { KnowledgeJobStatus } from '@betterwork/agent-protocol';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeServiceError } from './knowledge-errors';
import { type JobTarget, KnowledgeJobStore } from './knowledge-job-store';

const stores: Database.Database[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of stores.splice(0)) db.close();
});

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE knowledge_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('import', 'refresh', 'rebuild-keyword', 'rebuild-semantic', 'check-source')),
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled', 'interrupted')),
      attempt INTEGER NOT NULL CHECK (attempt > 0),
      sequence INTEGER NOT NULL DEFAULT 1 CHECK (sequence > 0),
      retry_of_job_id TEXT REFERENCES knowledge_jobs(id) ON DELETE SET NULL,
      request_json TEXT NOT NULL,
      space_id TEXT,
      total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
      completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
      failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      failure_code TEXT,
      failure_message TEXT
    );
    CREATE TABLE knowledge_job_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES knowledge_jobs(id) ON DELETE CASCADE,
      target_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted')),
      phase TEXT NOT NULL CHECK (phase IN ('read', 'extract', 'chunk', 'embed', 'publish', 'check')),
      attempt INTEGER NOT NULL CHECK (attempt > 0),
      completed_units INTEGER NOT NULL DEFAULT 0 CHECK (completed_units >= 0),
      total_units INTEGER CHECK (total_units IS NULL OR total_units >= 0),
      result_revision_id TEXT,
      failure_code TEXT,
      failure_message TEXT,
      UNIQUE(job_id, target_json)
    );
  `);
  stores.push(db);
  return db;
}

const importFileTarget = (name = 'test.md'): JobTarget => ({
  kind: 'import-file',
  sourcePath: `/tmp/${name}`,
  fileName: name,
});

const documentTarget = (documentId?: string): JobTarget => ({
  kind: 'document',
  documentId: documentId ?? randomUUID(),
});

describe('KnowledgeJobStore.createJob', () => {
  it('creates a queued job with items and returns a summary', () => {
    const store = new KnowledgeJobStore(createDb());
    const targets = [importFileTarget('a.md'), importFileTarget('b.md')];
    const summary = store.createJob({
      kind: 'import',
      request: { workspaceId: 'ws-1' },
      targets,
      firstPhase: 'read',
    });

    expect(summary.id).toBeTruthy();
    expect(summary.kind).toBe('import');
    expect(summary.status).toBe('queued');
    expect(summary.attempt).toBe(1);
    expect(summary.sequence).toBe(1);
    expect(summary.totalCount).toBe(2);
    expect(summary.completedCount).toBe(0);
    expect(summary.failedCount).toBe(0);
    expect(summary.retryOfJobId).toBeUndefined();
    expect(summary.spaceId).toBeUndefined();
    expect(summary.failure).toBeUndefined();
  });

  it('preserves optional retryOfJobId and spaceId', () => {
    const db = createDb();
    const store = new KnowledgeJobStore(db);
    const original = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    const retry = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'extract',
      attempt: 2,
      retryOfJobId: original.id,
      spaceId: 'space-1',
    });

    expect(retry.retryOfJobId).toBe(original.id);
    expect(retry.spaceId).toBe('space-1');
    expect(retry.attempt).toBe(2);
  });

  it('creates items matching each target', () => {
    const store = new KnowledgeJobStore(createDb());
    const targets = [importFileTarget('x.md'), documentTarget('doc-1')];
    const summary = store.createJob({
      kind: 'import',
      request: {},
      targets,
      firstPhase: 'read',
    });
    const items = store.itemsOf(summary.id);
    expect(items).toHaveLength(2);
    expect(items[0]?.status).toBe('queued');
    expect(items[0]?.phase).toBe('read');
    expect(items[0]?.attempt).toBe(1);
    expect(items[0]?.completedUnits).toBe(0);
    expect(items[0]?.totalUnits).toBeUndefined();
    expect(items[1]?.status).toBe('queued');
  });
});

describe('KnowledgeJobStore.job and detail', () => {
  it('returns undefined for a non-existent job', () => {
    const store = new KnowledgeJobStore(createDb());
    expect(store.job('non-existent')).toBeUndefined();
  });

  it('returns the job summary for an existing job', () => {
    const store = new KnowledgeJobStore(createDb());
    const created = store.createJob({
      kind: 'refresh',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    const fetched = store.job(created.id);
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.kind).toBe('refresh');
  });

  it('returns detail with items', () => {
    const store = new KnowledgeJobStore(createDb());
    const created = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('a.md'), importFileTarget('b.md')],
      firstPhase: 'read',
    });
    const detail = store.detail(created.id);
    expect(detail).toBeDefined();
    expect(detail?.job.id).toBe(created.id);
    expect(detail?.items).toHaveLength(2);
  });

  it('returns undefined detail for a non-existent job', () => {
    const store = new KnowledgeJobStore(createDb());
    expect(store.detail('no-such-id')).toBeUndefined();
  });
});

describe('KnowledgeJobStore.nextQueued and runningJob', () => {
  it('returns the earliest queued job when no job is running', () => {
    const db = createDb();
    const store = new KnowledgeJobStore(db);
    const first = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('first.md')],
      firstPhase: 'read',
    });
    // Ensure different created_at for ordering
    db.prepare('UPDATE knowledge_jobs SET created_at = 0 WHERE id = ?').run(first.id);

    store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('second.md')],
      firstPhase: 'read',
    });

    const next = store.nextQueued();
    expect(next).toBeDefined();
    expect(next?.id).toBe(first.id);
  });

  it('returns undefined when a job is already running', () => {
    const store = new KnowledgeJobStore(createDb());
    const running = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    store.markRunning(running.id);

    store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('other.md')],
      firstPhase: 'read',
    });

    expect(store.nextQueued()).toBeUndefined();
  });

  it('returns undefined when no queued jobs exist', () => {
    const store = new KnowledgeJobStore(createDb());
    expect(store.nextQueued()).toBeUndefined();
  });

  it('returns undefined for runningJob when none is running', () => {
    const store = new KnowledgeJobStore(createDb());
    expect(store.runningJob()).toBeUndefined();
  });

  it('returns the running job', () => {
    const store = new KnowledgeJobStore(createDb());
    const created = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    store.markRunning(created.id);
    const running = store.runningJob();
    expect(running).toBeDefined();
    expect(running?.id).toBe(created.id);
    expect(running?.status).toBe('running');
  });
});

describe('KnowledgeJobStore.markRunning', () => {
  it('transitions a queued job to running and increments sequence', () => {
    const store = new KnowledgeJobStore(createDb());
    const created = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    expect(created.sequence).toBe(1);

    const running = store.markRunning(created.id);
    expect(running.status).toBe('running');
    expect(running.sequence).toBe(2);
  });
});

describe('KnowledgeJobStore.claimItem', () => {
  it('claims the first queued item and marks it running', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('a.md'), importFileTarget('b.md')],
      firstPhase: 'read',
    });
    const claimed = store.claimItem(job.id);
    expect(claimed).toBeDefined();
    expect(claimed?.status).toBe('running');
    expect(claimed?.jobId).toBe(job.id);
  });

  it('returns undefined when no queued items remain', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    store.claimItem(job.id);
    expect(store.claimItem(job.id)).toBeUndefined();
  });

  it('refreshes job counts after claiming', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    store.claimItem(job.id);
    const updated = store.job(job.id);
    // refreshCounts increments sequence
    expect(updated?.sequence).toBeGreaterThan(1);
  });
});

describe('KnowledgeJobStore.item', () => {
  it('returns undefined for a non-existent item', () => {
    const store = new KnowledgeJobStore(createDb());
    expect(store.item('no-such-item')).toBeUndefined();
  });

  it('returns the item summary', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('test.md')],
      firstPhase: 'read',
    });
    const items = store.itemsOf(job.id);
    const item = store.item(items[0]?.id ?? '');
    expect(item).toBeDefined();
    expect(item?.fileName).toBe('test.md');
    expect(item?.status).toBe('queued');
    expect(item?.phase).toBe('read');
  });
});

describe('KnowledgeJobStore.updateItem', () => {
  it('updates item status and phase', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    const item = store.itemsOf(job.id)[0];
    const updated = store.updateItem(item?.id ?? '', {
      status: 'succeeded',
      phase: 'publish',
      completedUnits: 10,
      totalUnits: 10,
    });
    expect(updated?.status).toBe('succeeded');
    expect(updated?.phase).toBe('publish');
    expect(updated?.completedUnits).toBe(10);
    expect(updated?.totalUnits).toBe(10);
  });

  it('sets failure information on the item', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    const item = store.itemsOf(job.id)[0];
    const updated = store.updateItem(item?.id ?? '', {
      status: 'failed',
      failure: { code: 'WORKER_EXTRACT_FAILED', message: 'extraction error' },
    });
    expect(updated?.status).toBe('failed');
    expect(updated?.failure).toEqual({
      code: 'WORKER_EXTRACT_FAILED',
      message: 'extraction error',
    });
  });

  it('truncates long failure messages to 500 characters', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    const item = store.itemsOf(job.id)[0];
    const longMessage = 'x'.repeat(600);
    store.updateItem(item?.id ?? '', {
      status: 'failed',
      failure: { code: 'ERROR', message: longMessage },
    });
    const updated = store.item(item?.id ?? '');
    expect(updated?.failure?.message?.length).toBe(500);
  });

  it('redacts credentials from failure messages', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    const item = store.itemsOf(job.id)[0];
    store.updateItem(item?.id ?? '', {
      status: 'failed',
      failure: {
        code: 'AUTH_ERROR',
        message: 'Failed with //user:pass@example.com in url',
      },
    });
    const updated = store.item(item?.id ?? '');
    expect(updated?.failure?.message).toContain('//[redacted]@');
    expect(updated?.failure?.message).not.toContain('user:pass');
  });

  it('returns undefined when item does not exist', () => {
    const store = new KnowledgeJobStore(createDb());
    expect(store.updateItem('no-such-item', { status: 'failed' })).toBeUndefined();
  });

  it('sets resultRevisionId', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    const item = store.itemsOf(job.id)[0];
    const revisionId = randomUUID();
    const updated = store.updateItem(item?.id ?? '', {
      resultRevisionId: revisionId,
    });
    expect(updated?.resultRevisionId).toBe(revisionId);
  });

  it('refreshes job completed/failed counts', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('a.md'), importFileTarget('b.md')],
      firstPhase: 'read',
    });
    const items = store.itemsOf(job.id);
    store.updateItem(items[0]?.id ?? '', { status: 'succeeded' });
    store.updateItem(items[1]?.id ?? '', { status: 'failed' });

    const updated = store.job(job.id);
    expect(updated?.completedCount).toBe(1);
    expect(updated?.failedCount).toBe(1);
  });
});

describe('KnowledgeJobStore.cancelUnfinishedItems', () => {
  it('cancels queued and running items but preserves completed/failed ones', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [
        importFileTarget('a.md'),
        importFileTarget('b.md'),
        importFileTarget('c.md'),
        importFileTarget('d.md'),
      ],
      firstPhase: 'read',
    });
    const items = store.itemsOf(job.id);
    const [itemA, itemB] = items;
    store.updateItem(itemA?.id ?? '', { status: 'succeeded' });
    store.updateItem(itemB?.id ?? '', { status: 'failed' });
    // itemC stays queued, itemD stays queued
    // Claim itemD to make it running
    store.claimItem(job.id); // This claims the first queued = itemC (since A/B are terminal)

    store.cancelUnfinishedItems(job.id);

    const after = store.itemsOf(job.id);
    const byStatus = (status: string) => after.filter((i) => i.status === status);
    expect(byStatus('succeeded')).toHaveLength(1);
    expect(byStatus('failed')).toHaveLength(1);
    expect(byStatus('cancelled')).toHaveLength(2);
  });
});

describe('KnowledgeJobStore.finish', () => {
  it('aggregates to succeeded when all items succeed', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('a.md'), importFileTarget('b.md')],
      firstPhase: 'read',
    });
    const items = store.itemsOf(job.id);
    for (const item of items) {
      store.updateItem(item.id, { status: 'succeeded' });
    }
    const finished = store.finish(job.id);
    expect(finished.status).toBe('succeeded');
    expect(finished.sequence).toBeGreaterThan(1);
  });

  it('aggregates to failed when all items fail', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('a.md'), importFileTarget('b.md')],
      firstPhase: 'read',
    });
    const items = store.itemsOf(job.id);
    for (const item of items) {
      store.updateItem(item.id, { status: 'failed' });
    }
    const finished = store.finish(job.id);
    expect(finished.status).toBe('failed');
  });

  it('aggregates to partial when some items succeed and some fail', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('a.md'), importFileTarget('b.md')],
      firstPhase: 'read',
    });
    const items = store.itemsOf(job.id);
    store.updateItem(items[0]?.id ?? '', { status: 'succeeded' });
    store.updateItem(items[1]?.id ?? '', { status: 'failed' });
    const finished = store.finish(job.id);
    expect(finished.status).toBe('partial');
  });

  it('aggregates to cancelled when any item is cancelled', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('a.md'), importFileTarget('b.md')],
      firstPhase: 'read',
    });
    const items = store.itemsOf(job.id);
    store.updateItem(items[0]?.id ?? '', { status: 'succeeded' });
    store.updateItem(items[1]?.id ?? '', { status: 'cancelled' });
    const finished = store.finish(job.id);
    expect(finished.status).toBe('cancelled');
  });

  it('aggregates to interrupted when any item is interrupted', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('a.md'), importFileTarget('b.md')],
      firstPhase: 'read',
    });
    const items = store.itemsOf(job.id);
    store.updateItem(items[0]?.id ?? '', { status: 'succeeded' });
    store.updateItem(items[1]?.id ?? '', { status: 'interrupted' });
    const finished = store.finish(job.id);
    expect(finished.status).toBe('interrupted');
  });

  it('uses explicit status override when provided', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    const finished = store.finish(job.id, { status: 'cancelled' });
    expect(finished.status).toBe('cancelled');
  });

  it('stores failure information on the job', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    const finished = store.finish(job.id, {
      status: 'failed',
      failure: { code: 'TIMEOUT', message: 'Job timed out' },
    });
    expect(finished.failure).toEqual({ code: 'TIMEOUT', message: 'Job timed out' });
  });

  it('throws when the job does not exist', () => {
    const store = new KnowledgeJobStore(createDb());
    expect(() => store.finish('non-existent')).toThrowError(KnowledgeServiceError);
  });

  it('succeeds with no items (empty job defaults to succeeded)', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [],
      firstPhase: 'read',
    });
    const finished = store.finish(job.id);
    expect(finished.status).toBe('succeeded');
  });
});

describe('KnowledgeJobStore.touch', () => {
  it('increments sequence and updated_at without changing status', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget()],
      firstPhase: 'read',
    });
    expect(job.sequence).toBe(1);
    const touched = store.touch(job.id);
    expect(touched.status).toBe('queued');
    expect(touched.sequence).toBe(2);
    expect(touched.updatedAt).toBeGreaterThanOrEqual(job.updatedAt);
  });

  it('throws when the job does not exist', () => {
    const store = new KnowledgeJobStore(createDb());
    expect(() => store.touch('non-existent')).toThrowError(KnowledgeServiceError);
  });
});

describe('KnowledgeJobStore.targetsOf', () => {
  it('returns targets with item ids and statuses', () => {
    const store = new KnowledgeJobStore(createDb());
    const targets: JobTarget[] = [
      importFileTarget('a.md'),
      { kind: 'document', documentId: 'doc-42' },
    ];
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets,
      firstPhase: 'read',
    });
    const result = store.targetsOf(job.id);
    expect(result).toHaveLength(2);
    expect(result[0]?.target).toEqual(targets[0]);
    expect(result[0]?.status).toBe('queued');
    expect(result[1]?.target).toEqual(targets[1]);
  });

  it('returns empty array for a job with no items', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [],
      firstPhase: 'read',
    });
    expect(store.targetsOf(job.id)).toEqual([]);
  });
});

describe('KnowledgeJobStore.listPage', () => {
  it('returns jobs in reverse chronological order', () => {
    const db = createDb();
    const store = new KnowledgeJobStore(db);

    const job1 = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('first.md')],
      firstPhase: 'read',
    });
    // Force distinct created_at
    db.prepare('UPDATE knowledge_jobs SET created_at = 1000 WHERE id = ?').run(job1.id);

    const job2 = store.createJob({
      kind: 'refresh',
      request: {},
      targets: [importFileTarget('second.md')],
      firstPhase: 'read',
    });
    db.prepare('UPDATE knowledge_jobs SET created_at = 2000 WHERE id = ?').run(job2.id);

    const page = store.listPage({ limit: 10 });
    expect(page.jobs).toHaveLength(2);
    expect(page.jobs[0]?.id).toBe(job2.id);
    expect(page.jobs[1]?.id).toBe(job1.id);
    expect(page.nextCursor).toBeUndefined();
  });

  it('paginates with cursor', () => {
    const db = createDb();
    const store = new KnowledgeJobStore(db);

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const job = store.createJob({
        kind: 'import',
        request: {},
        targets: [importFileTarget(`file-${i}.md`)],
        firstPhase: 'read',
      });
      db.prepare('UPDATE knowledge_jobs SET created_at = ? WHERE id = ?').run(
        (i + 1) * 1000,
        job.id,
      );
      ids.push(job.id);
    }

    const firstPage = store.listPage({ limit: 2 });
    expect(firstPage.jobs).toHaveLength(2);
    expect(firstPage.nextCursor).toBeDefined();
    expect(firstPage.jobs[0]?.id).toBe(ids[4]);
    expect(firstPage.jobs[1]?.id).toBe(ids[3]);

    const secondPage = store.listPage({ limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.jobs).toHaveLength(2);
    expect(secondPage.jobs[0]?.id).toBe(ids[2]);
    expect(secondPage.jobs[1]?.id).toBe(ids[1]);

    const thirdPage = store.listPage({ limit: 2, cursor: secondPage.nextCursor });
    expect(thirdPage.jobs).toHaveLength(1);
    expect(thirdPage.jobs[0]?.id).toBe(ids[0]);
    expect(thirdPage.nextCursor).toBeUndefined();
  });

  it('returns empty page when no jobs exist', () => {
    const store = new KnowledgeJobStore(createDb());
    const page = store.listPage({ limit: 10 });
    expect(page.jobs).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });
});

describe('KnowledgeJobStore.clearTerminal', () => {
  it('deletes succeeded, failed, partial, cancelled and interrupted jobs', () => {
    const store = new KnowledgeJobStore(createDb());
    const statuses: KnowledgeJobStatus[] = [
      'succeeded',
      'failed',
      'partial',
      'cancelled',
      'interrupted',
    ];
    const terminalIds: string[] = [];
    for (const status of statuses) {
      const job = store.createJob({
        kind: 'import',
        request: {},
        targets: [importFileTarget()],
        firstPhase: 'read',
      });
      store.finish(job.id, { status });
      terminalIds.push(job.id);
    }

    // Also create a queued job that should NOT be cleared
    const queued = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('keep.md')],
      firstPhase: 'read',
    });

    const cleared = store.clearTerminal();
    expect(cleared).toBe(5);

    for (const id of terminalIds) {
      expect(store.job(id)).toBeUndefined();
    }
    expect(store.job(queued.id)).toBeDefined();
  });

  it('does not delete queued or running jobs', () => {
    const store = new KnowledgeJobStore(createDb());
    const queued = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('q.md')],
      firstPhase: 'read',
    });
    const running = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('r.md')],
      firstPhase: 'read',
    });
    store.markRunning(running.id);

    const cleared = store.clearTerminal();
    expect(cleared).toBe(0);
    expect(store.job(queued.id)).toBeDefined();
    expect(store.job(running.id)).toBeDefined();
  });

  it('cascades item deletion when terminal jobs are cleared', () => {
    const db = createDb();
    const store = new KnowledgeJobStore(db);
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('a.md'), importFileTarget('b.md')],
      firstPhase: 'read',
    });
    store.finish(job.id, { status: 'succeeded' });
    store.clearTerminal();

    const itemCount = db
      .prepare('SELECT COUNT(*) AS cnt FROM knowledge_job_items WHERE job_id = ?')
      .get(job.id) as { cnt: number };
    expect(itemCount.cnt).toBe(0);
  });

  it('returns 0 when no terminal jobs exist', () => {
    const store = new KnowledgeJobStore(createDb());
    expect(store.clearTerminal()).toBe(0);
  });
});

describe('KnowledgeJobStore.recoverInterrupted', () => {
  it('marks queued and running jobs as interrupted with failure info', () => {
    const store = new KnowledgeJobStore(createDb());
    const queued = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('q.md')],
      firstPhase: 'read',
    });
    const running = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('r.md')],
      firstPhase: 'read',
    });
    store.markRunning(running.id);

    const recovered = store.recoverInterrupted();
    expect(recovered).toHaveLength(2);

    const recoveredIds = new Set(recovered.map((j) => j.id));
    expect(recoveredIds.has(queued.id)).toBe(true);
    expect(recoveredIds.has(running.id)).toBe(true);

    for (const job of recovered) {
      expect(job.status).toBe('interrupted');
      expect(job.failure?.code).toBe('INTERRUPTED');
    }
  });

  it('marks queued and running items as interrupted', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('a.md'), importFileTarget('b.md')],
      firstPhase: 'read',
    });
    // Claim one item to make it running, the other stays queued
    store.claimItem(job.id);

    store.recoverInterrupted();

    const items = store.itemsOf(job.id);
    for (const item of items) {
      expect(item.status).toBe('interrupted');
    }
  });

  it('does not affect already terminal jobs', () => {
    const store = new KnowledgeJobStore(createDb());
    const succeeded = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('done.md')],
      firstPhase: 'read',
    });
    const items = store.itemsOf(succeeded.id);
    store.updateItem(items[0]?.id ?? '', { status: 'succeeded' });
    store.finish(succeeded.id, { status: 'succeeded' });

    const recovered = store.recoverInterrupted();
    expect(recovered).toHaveLength(0);

    const after = store.job(succeeded.id);
    expect(after?.status).toBe('succeeded');
  });

  it('returns empty array when no jobs need recovery', () => {
    const store = new KnowledgeJobStore(createDb());
    expect(store.recoverInterrupted()).toEqual([]);
  });
});

describe('KnowledgeJobStore.itemsOf', () => {
  it('returns items ordered by rowid', () => {
    const store = new KnowledgeJobStore(createDb());
    const targets = [
      importFileTarget('first.md'),
      importFileTarget('second.md'),
      importFileTarget('third.md'),
    ];
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets,
      firstPhase: 'read',
    });
    const items = store.itemsOf(job.id);
    expect(items).toHaveLength(3);
    expect(items[0]?.fileName).toBe('first.md');
    expect(items[1]?.fileName).toBe('second.md');
    expect(items[2]?.fileName).toBe('third.md');
  });

  it('returns empty array for a job with no items', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [],
      firstPhase: 'read',
    });
    expect(store.itemsOf(job.id)).toEqual([]);
  });

  it('includes documentId for document targets', () => {
    const store = new KnowledgeJobStore(createDb());
    const docId = randomUUID();
    const job = store.createJob({
      kind: 'refresh',
      request: {},
      targets: [{ kind: 'document', documentId: docId }],
      firstPhase: 'extract',
    });
    const items = store.itemsOf(job.id);
    expect(items[0]?.documentId).toBe(docId);
  });
});

describe('KnowledgeJobStore end-to-end lifecycle', () => {
  it('runs a full job lifecycle: create -> running -> claim -> update -> finish', () => {
    const store = new KnowledgeJobStore(createDb());

    // 1. Create
    const job = store.createJob({
      kind: 'import',
      request: { workspaceId: 'ws-1' },
      targets: [importFileTarget('doc.md')],
      firstPhase: 'read',
    });
    expect(job.status).toBe('queued');
    expect(job.sequence).toBe(1);

    // 2. Mark running
    const running = store.markRunning(job.id);
    expect(running.status).toBe('running');

    // 3. Claim item
    const claimed = store.claimItem(job.id);
    expect(claimed?.status).toBe('running');

    // 4. Update item to succeeded
    const completed = store.updateItem(claimed?.id ?? '', {
      status: 'succeeded',
      phase: 'publish',
      completedUnits: 1,
      totalUnits: 1,
    });
    expect(completed?.status).toBe('succeeded');

    // 5. Finish
    const finished = store.finish(job.id);
    expect(finished.status).toBe('succeeded');

    // 6. Verify detail
    const detail = store.detail(job.id);
    expect(detail?.job.status).toBe('succeeded');
    expect(detail?.items).toHaveLength(1);
    expect(detail?.items[0]?.status).toBe('succeeded');
  });

  it('handles a mixed-outcome job with cancel and finish', () => {
    const store = new KnowledgeJobStore(createDb());
    const job = store.createJob({
      kind: 'import',
      request: {},
      targets: [importFileTarget('a.md'), importFileTarget('b.md'), importFileTarget('c.md')],
      firstPhase: 'read',
    });
    store.markRunning(job.id);

    const items = store.itemsOf(job.id);
    // First item succeeds
    store.updateItem(items[0]?.id ?? '', { status: 'succeeded' });
    // Second item fails
    store.updateItem(items[1]?.id ?? '', {
      status: 'failed',
      failure: { code: 'PARSE_ERROR', message: 'bad format' },
    });
    // Third item is still queued -> cancel it
    store.cancelUnfinishedItems(job.id);

    const finished = store.finish(job.id);
    // cancelled takes precedence over partial
    expect(finished.status).toBe('cancelled');
  });
});
