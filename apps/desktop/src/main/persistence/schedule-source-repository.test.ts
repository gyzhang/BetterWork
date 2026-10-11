import type {
  ExpertRevisionDraft,
  MaterialReference,
  ScheduleConfigDraft,
  ScheduleResolvedPeriod,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { ExpertRepository } from './expert-repository';
import {
  AppStore,
  assertScheduleSourceReadyForTask,
  ScheduleOccurrenceRepository,
  ScheduleRepository,
  scheduleSourceManifestHash,
  ScheduleSourceRepository,
  ScheduleSourceRepositoryError,
} from './index';
import { WorkspaceRepository } from './workspace-repository';

const stores: AppStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const expertDraft = (name: string): ExpertRevisionDraft => ({
  name,
  summary: '按公司规则完成月度分析',
  author: '',
  tags: [],
  identity: '你负责分析和报告交付。',
  principles: ['使用固定期间与引用来源'],
  inputRequirements: ['本期经营数据'],
  deliveryRequirements: ['交付带来源的报告'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
});

const configDraft = (
  expertId: string,
  expertRevisionId: string,
  overrides: Partial<ScheduleConfigDraft> = {},
): ScheduleConfigDraft => ({
  name: '月度经营复盘',
  expertId,
  expertRevisionId,
  requirements: '分析上月经营数据，指出变化并给出建议。',
  expectedArtifactTypes: ['markdown'],
  timing: { frequency: 'monthly', day: 5, hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
  periodRule: 'previous-month',
  knowledgeSources: [],
  outputSubdirectory: '定时成果',
  ...overrides,
});

const previousMonth = (anchorAt: number, monthIndex: number): ScheduleResolvedPeriod => ({
  rule: 'previous-month',
  timeZone: 'Asia/Shanghai',
  anchorAt,
  startAt: Date.UTC(2025, monthIndex, 1),
  endAt: Date.UTC(2025, monthIndex + 1, 1),
  label: `合成期间 ${monthIndex + 1}`,
});

function dbOf(store: AppStore): Database.Database {
  return (store as unknown as { db: Database.Database }).db;
}

interface FixtureContext {
  store: AppStore;
  db: Database.Database;
  workspaceId: string;
  scheduleId: string;
  occurrenceId: string;
  sources: ScheduleSourceRepository;
  occurrences: ScheduleOccurrenceRepository;
}

function openFixture(scheduleId = 'schedule-source-test'): FixtureContext {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const db = dbOf(store);

  const workspaces = new WorkspaceRepository(db);
  const workspace = workspaces.create('/tmp/schedule-source-test', '来源测试工作区');

  const experts = new ExpertRepository(db);
  const expert = experts.create({ sourceKind: 'user', revision: expertDraft('来源测试专家') });

  const schedules = new ScheduleRepository(db);
  const config = configDraft(expert.id, expert.revision.id);
  schedules.create({ id: scheduleId, workspaceId: workspace.id, config, createdAt: 1 });

  const occurrences = new ScheduleOccurrenceRepository(db);
  const claim = occurrences.claimManual({
    scheduleId,
    trigger: 'manual-now',
    requestKey: `request-${scheduleId}`,
    requestedAt: 2,
    period: previousMonth(2, 0),
  });
  if (claim.kind !== 'created') throw new Error('Fixture occurrence was not created');

  const sources = new ScheduleSourceRepository(db);
  return {
    store,
    db,
    workspaceId: workspace.id,
    scheduleId,
    occurrenceId: claim.occurrence.id,
    sources,
    occurrences,
  };
}

const knowledgeRef = (id = 'knowledge-rev-1'): MaterialReference => ({
  kind: 'knowledge-revision',
  knowledgeDocumentId: 'knowledge-doc-1',
  knowledgeRevisionId: id,
  contentHash: 'abc123contenthash',
  sourcePath: '/tmp/source.md',
});

const inputSnapshotRef = (
  snapshotId = 'snap-1',
  fileKey = 'input-snapshots/2025/01/data.json',
): MaterialReference => ({
  kind: 'workspace-input-snapshot',
  snapshotId,
  workspaceId: 'ws-1',
  contentHash: 'snap-content-hash',
  format: 'json',
  fileKey,
});

describe('ScheduleSourceRepository', () => {
  describe('get', () => {
    it('returns undefined for a missing snapshot id', () => {
      const { sources } = openFixture();
      expect(sources.get('nonexistent')).toBeUndefined();
    });

    it('returns the snapshot after createPreparing', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const found = sources.get(snapshot.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(snapshot.id);
      expect(found?.status).toBe('preparing');
      expect(found?.occurrenceId).toBe(occurrenceId);
      expect(found?.itemCount).toBe(0);
      expect(found?.totalFileBytes).toBe(0);
    });
  });

  describe('getByOccurrence', () => {
    it('returns undefined when no snapshot exists for the occurrence', () => {
      const { sources, occurrenceId } = openFixture();
      expect(sources.getByOccurrence(occurrenceId)).toBeUndefined();
    });

    it('returns the snapshot linked to the occurrence', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const found = sources.getByOccurrence(occurrenceId);
      expect(found?.id).toBe(snapshot.id);
      expect(found?.status).toBe('preparing');
    });
  });

  describe('createPreparing', () => {
    it('creates a preparing snapshot with empty manifest hash and zero counts', () => {
      const { sources, occurrenceId, workspaceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 100,
        createdAt: 100,
      });
      expect(snapshot.status).toBe('preparing');
      expect(snapshot.occurrenceId).toBe(occurrenceId);
      expect(snapshot.workspaceId).toBe(workspaceId);
      expect(snapshot.configVersion).toBe(1);
      expect(snapshot.evaluatedAt).toBe(100);
      expect(snapshot.itemCount).toBe(0);
      expect(snapshot.totalFileBytes).toBe(0);
      expect(snapshot.manifestHash).toMatch(/^[0-9a-f]{64}$/);
      expect(snapshot.completedAt).toBeUndefined();
      expect(snapshot.failureCode).toBeUndefined();
    });

    it('accepts an explicit id when provided', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        id: 'explicit-snapshot-id',
        occurrenceId,
        evaluatedAt: 5,
        createdAt: 5,
      });
      expect(snapshot.id).toBe('explicit-snapshot-id');
    });

    it('returns the existing snapshot idempotently when called again for the same occurrence', () => {
      const { sources, occurrenceId } = openFixture();
      const first = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const second = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 20,
        createdAt: 20,
      });
      expect(second.id).toBe(first.id);
      expect(second.status).toBe('preparing');
    });

    it('throws when the occurrence does not exist', () => {
      const { sources } = openFixture();
      expect(() =>
        sources.createPreparing({
          occurrenceId: 'nonexistent-occurrence',
          evaluatedAt: 10,
          createdAt: 10,
        }),
      ).toThrow(ScheduleSourceRepositoryError);
      expect(() =>
        sources.createPreparing({
          occurrenceId: 'nonexistent-occurrence',
          evaluatedAt: 10,
          createdAt: 10,
        }),
      ).toThrow('定时实例不存在');
    });

    it('throws when the occurrence is no longer in preparing phase', () => {
      const { db, sources, occurrenceId } = openFixture();
      sources.createPreparing({ occurrenceId, evaluatedAt: 10, createdAt: 10 });
      // Move occurrence to closed phase directly
      db.prepare(
        `UPDATE schedule_occurrences
            SET phase = 'closed', preparation_outcome = 'cancelled', finished_at = 20
          WHERE id = ?`,
      ).run(occurrenceId);
      // Delete the snapshot so the idempotent path doesn't return early
      db.prepare('DELETE FROM schedule_source_snapshots WHERE occurrence_id = ?').run(occurrenceId);

      expect(() =>
        sources.createPreparing({ occurrenceId, evaluatedAt: 30, createdAt: 30 }),
      ).toThrow('只有尚未完成的实例可以准备来源');
    });

    it('rejects negative evaluatedAt', () => {
      const { sources, occurrenceId } = openFixture();
      expect(() =>
        sources.createPreparing({ occurrenceId, evaluatedAt: -1, createdAt: 10 }),
      ).toThrow('evaluatedAt must be a non-negative safe integer');
    });

    it('rejects negative createdAt', () => {
      const { sources, occurrenceId } = openFixture();
      expect(() =>
        sources.createPreparing({ occurrenceId, evaluatedAt: 10, createdAt: -1 }),
      ).toThrow('createdAt must be a non-negative safe integer');
    });
  });

  describe('publishReady', () => {
    it('publishes a preparing snapshot to ready with items', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const items = [
        {
          reference: knowledgeRef('rev-1'),
          purpose: 'current-input' as const,
          origin: 'selected-document' as const,
          displayName: '月度报告',
        },
        {
          reference: knowledgeRef('rev-2'),
          purpose: 'background' as const,
          origin: 'workspace-directory' as const,
          displayName: '背景资料',
          sourcePath: '/tmp/background.md',
        },
      ];
      const manifestHash = scheduleSourceManifestHash(
        items.map((item, ordinal) => ({ ...item, snapshotId: snapshot.id, ordinal })),
      );
      const ready = sources.publishReady({
        snapshotId: snapshot.id,
        items,
        totalFileBytes: 1024,
        manifestHash,
        completedAt: 20,
      });
      expect(ready.status).toBe('ready');
      expect(ready.itemCount).toBe(2);
      expect(ready.totalFileBytes).toBe(1024);
      expect(ready.manifestHash).toBe(manifestHash);
      expect(ready.completedAt).toBe(20);
    });

    it('publishes with zero items', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const manifestHash = scheduleSourceManifestHash([]);
      const ready = sources.publishReady({
        snapshotId: snapshot.id,
        items: [],
        totalFileBytes: 0,
        manifestHash,
        completedAt: 20,
      });
      expect(ready.status).toBe('ready');
      expect(ready.itemCount).toBe(0);
      expect(ready.totalFileBytes).toBe(0);
    });

    it('is idempotent when publishing the same manifest again', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const items = [
        {
          reference: knowledgeRef('rev-1'),
          purpose: 'current-input' as const,
          origin: 'selected-document' as const,
          displayName: '月度报告',
        },
      ];
      const manifestHash = scheduleSourceManifestHash(
        items.map((item, ordinal) => ({ ...item, snapshotId: snapshot.id, ordinal })),
      );
      const first = sources.publishReady({
        snapshotId: snapshot.id,
        items,
        totalFileBytes: 512,
        manifestHash,
        completedAt: 20,
      });
      const second = sources.publishReady({
        snapshotId: snapshot.id,
        items,
        totalFileBytes: 512,
        manifestHash,
        completedAt: 20,
      });
      expect(second.id).toBe(first.id);
      expect(second.status).toBe('ready');
    });

    it('throws when manifest hash does not match items', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      expect(() =>
        sources.publishReady({
          snapshotId: snapshot.id,
          items: [],
          totalFileBytes: 0,
          manifestHash: '0'.repeat(64),
          completedAt: 20,
        }),
      ).toThrow('来源清单摘要与实际条目不一致');
    });

    it('throws when items contain duplicate material references', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const items = [
        {
          reference: knowledgeRef('rev-1'),
          purpose: 'current-input' as const,
          origin: 'selected-document' as const,
          displayName: '月度报告 A',
        },
        {
          reference: knowledgeRef('rev-1'),
          purpose: 'background' as const,
          origin: 'workspace-directory' as const,
          displayName: '月度报告 B',
        },
      ];
      const manifestHash = scheduleSourceManifestHash(
        items.map((item, ordinal) => ({ ...item, snapshotId: snapshot.id, ordinal })),
      );
      expect(() =>
        sources.publishReady({
          snapshotId: snapshot.id,
          items,
          totalFileBytes: 0,
          manifestHash,
          completedAt: 20,
        }),
      ).toThrow('本期来源清单包含重复材料引用');
    });

    it('throws when snapshot does not exist', () => {
      const { sources } = openFixture();
      const manifestHash = scheduleSourceManifestHash([]);
      expect(() =>
        sources.publishReady({
          snapshotId: 'nonexistent-snapshot',
          items: [],
          totalFileBytes: 0,
          manifestHash,
          completedAt: 20,
        }),
      ).toThrow('来源快照不存在');
    });

    it('throws when trying to publish a different manifest on an already ready snapshot', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const items = [
        {
          reference: knowledgeRef('rev-1'),
          purpose: 'current-input' as const,
          origin: 'selected-document' as const,
          displayName: '月度报告',
        },
      ];
      const manifestHash = scheduleSourceManifestHash(
        items.map((item, ordinal) => ({ ...item, snapshotId: snapshot.id, ordinal })),
      );
      sources.publishReady({
        snapshotId: snapshot.id,
        items,
        totalFileBytes: 512,
        manifestHash,
        completedAt: 20,
      });
      // Try to publish a different manifest
      const differentItems = [
        {
          reference: knowledgeRef('rev-2'),
          purpose: 'background' as const,
          origin: 'workspace-directory' as const,
          displayName: '另一份资料',
        },
      ];
      const differentHash = scheduleSourceManifestHash(
        differentItems.map((item, ordinal) => ({ ...item, snapshotId: snapshot.id, ordinal })),
      );
      expect(() =>
        sources.publishReady({
          snapshotId: snapshot.id,
          items: differentItems,
          totalFileBytes: 256,
          manifestHash: differentHash,
          completedAt: 30,
        }),
      ).toThrow('已发布的来源快照不能被另一个清单替换');
    });

    it('throws when the occurrence is no longer in preparing phase', () => {
      const { db, sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      // Close the occurrence
      db.prepare(
        `UPDATE schedule_occurrences
            SET phase = 'closed', preparation_outcome = 'cancelled', finished_at = 20
          WHERE id = ?`,
      ).run(occurrenceId);

      const manifestHash = scheduleSourceManifestHash([]);
      expect(() =>
        sources.publishReady({
          snapshotId: snapshot.id,
          items: [],
          totalFileBytes: 0,
          manifestHash,
          completedAt: 30,
        }),
      ).toThrow('来源准备期间对应实例已结束');
    });

    it('rejects negative totalFileBytes', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      expect(() =>
        sources.publishReady({
          snapshotId: snapshot.id,
          items: [],
          totalFileBytes: -1,
          manifestHash: scheduleSourceManifestHash([]),
          completedAt: 20,
        }),
      ).toThrow('totalFileBytes must be a non-negative safe integer');
    });

    it('rejects negative completedAt', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      expect(() =>
        sources.publishReady({
          snapshotId: snapshot.id,
          items: [],
          totalFileBytes: 0,
          manifestHash: scheduleSourceManifestHash([]),
          completedAt: -1,
        }),
      ).toThrow('completedAt must be a non-negative safe integer');
    });
  });

  describe('finish', () => {
    it('marks a preparing snapshot as failed', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const finished = sources.finish({
        snapshotId: snapshot.id,
        status: 'failed',
        failureCode: 'schedule_source_missing',
        completedAt: 20,
      });
      expect(finished.status).toBe('failed');
      expect(finished.failureCode).toBe('schedule_source_missing');
      expect(finished.completedAt).toBe(20);
    });

    it('marks a preparing snapshot as cancelled', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const finished = sources.finish({
        snapshotId: snapshot.id,
        status: 'cancelled',
        failureCode: 'schedule_cancelled',
        completedAt: 20,
      });
      expect(finished.status).toBe('cancelled');
      expect(finished.failureCode).toBe('schedule_cancelled');
    });

    it('is idempotent when finishing with the same status and failure code', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const first = sources.finish({
        snapshotId: snapshot.id,
        status: 'failed',
        failureCode: 'schedule_source_missing',
        completedAt: 20,
      });
      const second = sources.finish({
        snapshotId: snapshot.id,
        status: 'failed',
        failureCode: 'schedule_source_missing',
        completedAt: 30,
      });
      expect(second.id).toBe(first.id);
      expect(second.status).toBe('failed');
      expect(second.failureCode).toBe('schedule_source_missing');
    });

    it('returns the existing snapshot when trying to finish an already ready snapshot', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const manifestHash = scheduleSourceManifestHash([]);
      const ready = sources.publishReady({
        snapshotId: snapshot.id,
        items: [],
        totalFileBytes: 0,
        manifestHash,
        completedAt: 20,
      });
      // Trying to finish a ready snapshot returns it as-is
      const result = sources.finish({
        snapshotId: snapshot.id,
        status: 'failed',
        failureCode: 'schedule_source_missing',
        completedAt: 30,
      });
      expect(result.id).toBe(ready.id);
      expect(result.status).toBe('ready');
    });

    it('throws when snapshot does not exist', () => {
      const { sources } = openFixture();
      expect(() =>
        sources.finish({
          snapshotId: 'nonexistent',
          status: 'failed',
          failureCode: 'schedule_source_missing',
          completedAt: 20,
        }),
      ).toThrow('来源快照不存在');
    });

    it('throws when trying to transition from one terminal state to a different one', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      sources.finish({
        snapshotId: snapshot.id,
        status: 'failed',
        failureCode: 'schedule_source_missing',
        completedAt: 20,
      });
      expect(() =>
        sources.finish({
          snapshotId: snapshot.id,
          status: 'cancelled',
          failureCode: 'schedule_cancelled',
          completedAt: 30,
        }),
      ).toThrow('来源快照已经以另一终态收口');
    });

    it('rejects negative completedAt', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      expect(() =>
        sources.finish({
          snapshotId: snapshot.id,
          status: 'failed',
          failureCode: 'schedule_source_missing',
          completedAt: -1,
        }),
      ).toThrow('completedAt must be a non-negative safe integer');
    });
  });

  describe('listItems', () => {
    it('throws when no snapshot exists for the occurrence', () => {
      const { sources, occurrenceId } = openFixture();
      expect(() => sources.listItems({ occurrenceId, limit: 10 })).toThrow(
        '本期尚无可读取的完整来源清单',
      );
    });

    it('throws when the snapshot is still preparing', () => {
      const { sources, occurrenceId } = openFixture();
      sources.createPreparing({ occurrenceId, evaluatedAt: 10, createdAt: 10 });
      expect(() => sources.listItems({ occurrenceId, limit: 10 })).toThrow(
        '本期尚无可读取的完整来源清单',
      );
    });

    it('returns all items for a ready snapshot without pagination', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const items = [
        {
          reference: knowledgeRef('rev-1'),
          purpose: 'current-input' as const,
          origin: 'selected-document' as const,
          displayName: '月度报告',
        },
        {
          reference: knowledgeRef('rev-2'),
          purpose: 'background' as const,
          origin: 'workspace-directory' as const,
          displayName: '背景资料',
          sourcePath: '/tmp/background.md',
        },
      ];
      const manifestHash = scheduleSourceManifestHash(
        items.map((item, ordinal) => ({ ...item, snapshotId: snapshot.id, ordinal })),
      );
      sources.publishReady({
        snapshotId: snapshot.id,
        items,
        totalFileBytes: 1024,
        manifestHash,
        completedAt: 20,
      });
      const page = sources.listItems({ occurrenceId, limit: 10 });
      expect(page.items).toHaveLength(2);
      expect(page.items[0]?.displayName).toBe('月度报告');
      expect(page.items[0]?.ordinal).toBe(0);
      expect(page.items[1]?.displayName).toBe('背景资料');
      expect(page.items[1]?.ordinal).toBe(1);
      expect(page.items[1]?.sourcePath).toBe('/tmp/background.md');
      expect(page.nextCursor).toBeUndefined();
    });

    it('paginates items with a cursor', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const items = [
        {
          reference: knowledgeRef('rev-1'),
          purpose: 'current-input' as const,
          origin: 'selected-document' as const,
          displayName: '报告 A',
        },
        {
          reference: knowledgeRef('rev-2'),
          purpose: 'background' as const,
          origin: 'workspace-directory' as const,
          displayName: '报告 B',
        },
        {
          reference: knowledgeRef('rev-3'),
          purpose: 'template' as const,
          origin: 'selected-collection' as const,
          displayName: '报告 C',
        },
      ];
      const manifestHash = scheduleSourceManifestHash(
        items.map((item, ordinal) => ({ ...item, snapshotId: snapshot.id, ordinal })),
      );
      sources.publishReady({
        snapshotId: snapshot.id,
        items,
        totalFileBytes: 0,
        manifestHash,
        completedAt: 20,
      });

      const firstPage = sources.listItems({ occurrenceId, limit: 2 });
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.items[0]?.displayName).toBe('报告 A');
      expect(firstPage.items[1]?.displayName).toBe('报告 B');
      expect(firstPage.nextCursor).toEqual({
        version: 1,
        snapshotId: snapshot.id,
        ordinal: 1,
      });

      const secondPage = sources.listItems({
        occurrenceId,
        limit: 2,
        cursor: firstPage.nextCursor,
      });
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.items[0]?.displayName).toBe('报告 C');
      expect(secondPage.nextCursor).toBeUndefined();
    });

    it('throws when cursor snapshotId does not match the current snapshot', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const manifestHash = scheduleSourceManifestHash([]);
      sources.publishReady({
        snapshotId: snapshot.id,
        items: [],
        totalFileBytes: 0,
        manifestHash,
        completedAt: 20,
      });
      expect(() =>
        sources.listItems({
          occurrenceId,
          limit: 10,
          cursor: { version: 1, snapshotId: 'wrong-snapshot', ordinal: 0 },
        }),
      ).toThrow('来源分页游标不属于本期清单');
    });
  });

  describe('listRetainedInputSnapshotFileKeys', () => {
    it('returns empty array when no ready snapshots have items', () => {
      const { sources } = openFixture();
      expect(sources.listRetainedInputSnapshotFileKeys()).toEqual([]);
    });

    it('returns file keys from workspace-input-snapshot references in ready snapshots', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const items = [
        {
          reference: inputSnapshotRef('snap-1', 'input-snapshots/2025/01/data.json'),
          purpose: 'current-input' as const,
          origin: 'selected-document' as const,
          displayName: '输入快照',
        },
        {
          reference: knowledgeRef('rev-1'),
          purpose: 'background' as const,
          origin: 'workspace-directory' as const,
          displayName: '知识文档',
        },
      ];
      const manifestHash = scheduleSourceManifestHash(
        items.map((item, ordinal) => ({ ...item, snapshotId: snapshot.id, ordinal })),
      );
      sources.publishReady({
        snapshotId: snapshot.id,
        items,
        totalFileBytes: 0,
        manifestHash,
        completedAt: 20,
      });
      const keys = sources.listRetainedInputSnapshotFileKeys();
      expect(keys).toEqual(['input-snapshots/2025/01/data.json']);
    });

    it('excludes file keys that do not start with input-snapshots/', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const items = [
        {
          reference: inputSnapshotRef('snap-1', 'other-path/data.json'),
          purpose: 'current-input' as const,
          origin: 'selected-document' as const,
          displayName: '异常路径',
        },
      ];
      const manifestHash = scheduleSourceManifestHash(
        items.map((item, ordinal) => ({ ...item, snapshotId: snapshot.id, ordinal })),
      );
      sources.publishReady({
        snapshotId: snapshot.id,
        items,
        totalFileBytes: 0,
        manifestHash,
        completedAt: 20,
      });
      const keys = sources.listRetainedInputSnapshotFileKeys();
      expect(keys).toEqual([]);
    });

    it('excludes file keys containing path traversal', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const items = [
        {
          reference: inputSnapshotRef('snap-1', 'input-snapshots/../../../etc/passwd'),
          purpose: 'current-input' as const,
          origin: 'selected-document' as const,
          displayName: '路径穿越',
        },
      ];
      const manifestHash = scheduleSourceManifestHash(
        items.map((item, ordinal) => ({ ...item, snapshotId: snapshot.id, ordinal })),
      );
      sources.publishReady({
        snapshotId: snapshot.id,
        items,
        totalFileBytes: 0,
        manifestHash,
        completedAt: 20,
      });
      const keys = sources.listRetainedInputSnapshotFileKeys();
      expect(keys).toEqual([]);
    });
  });

  describe('listForRecovery', () => {
    it('returns occurrences in preparing phase with their snapshot status', () => {
      const { sources, occurrenceId } = openFixture();
      const snapshot = sources.createPreparing({
        occurrenceId,
        evaluatedAt: 10,
        createdAt: 10,
      });
      const rows = sources.listForRecovery();
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = rows.find((r) => r.occurrenceId === occurrenceId);
      expect(row).toBeDefined();
      expect(row?.occurrencePhase).toBe('preparing');
      expect(row?.snapshotId).toBe(snapshot.id);
      expect(row?.snapshotStatus).toBe('preparing');
    });

    it('returns occurrences without snapshots when in preparing phase', () => {
      const { sources, occurrenceId } = openFixture();
      // Don't create any snapshot
      const rows = sources.listForRecovery();
      const row = rows.find((r) => r.occurrenceId === occurrenceId);
      expect(row).toBeDefined();
      expect(row?.occurrencePhase).toBe('preparing');
      expect(row?.snapshotId).toBeUndefined();
      expect(row?.snapshotStatus).toBeUndefined();
    });

    it('includes occurrences with preparing snapshots even if occurrence is closed', () => {
      const { db, sources, occurrenceId } = openFixture();
      sources.createPreparing({ occurrenceId, evaluatedAt: 10, createdAt: 10 });
      // Close the occurrence but leave the snapshot in preparing
      db.prepare(
        `UPDATE schedule_occurrences
            SET phase = 'closed', preparation_outcome = 'cancelled', finished_at = 20
          WHERE id = ?`,
      ).run(occurrenceId);
      const rows = sources.listForRecovery();
      const row = rows.find((r) => r.occurrenceId === occurrenceId);
      expect(row).toBeDefined();
      expect(row?.occurrencePhase).toBe('closed');
      expect(row?.snapshotStatus).toBe('preparing');
    });
  });
});

describe('assertScheduleSourceReadyForTask', () => {
  it('returns the snapshot when all bindings match', () => {
    const { db, sources, occurrenceId, workspaceId } = openFixture();
    const snapshot = sources.createPreparing({
      occurrenceId,
      evaluatedAt: 10,
      createdAt: 10,
    });
    const manifestHash = scheduleSourceManifestHash([]);
    sources.publishReady({
      snapshotId: snapshot.id,
      items: [],
      totalFileBytes: 0,
      manifestHash,
      completedAt: 20,
    });

    // Create a task and session in the same workspace
    db.prepare(
      `INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at)
       VALUES (?, ?, '测试 Task', '测试要求', 1, 1)`,
    ).run('task-1', workspaceId);
    db.prepare('INSERT INTO sessions (id, task_id, created_at) VALUES (?, ?, ?)').run(
      'session-1',
      'task-1',
      1,
    );

    // Attach snapshot and task to occurrence (phase stays 'preparing' with T3 draft)
    db.prepare(
      `UPDATE schedule_occurrences
          SET source_snapshot_id = ?, task_id = ?, session_id = ?, prepared_at = ?
        WHERE id = ?`,
    ).run(snapshot.id, 'task-1', 'session-1', 25, occurrenceId);

    const result = assertScheduleSourceReadyForTask(db, snapshot.id, 'task-1');
    expect(result.id).toBe(snapshot.id);
    expect(result.status).toBe('ready');
  });

  it('throws when the snapshot does not exist', () => {
    const { db } = openFixture();
    expect(() => assertScheduleSourceReadyForTask(db, 'nonexistent', 'task-1')).toThrow(
      ScheduleSourceRepositoryError,
    );
    expect(() => assertScheduleSourceReadyForTask(db, 'nonexistent', 'task-1')).toThrow(
      '定时来源快照不存在',
    );
  });

  it('throws when the snapshot is not ready', () => {
    const { db, sources, occurrenceId, workspaceId } = openFixture();
    const snapshot = sources.createPreparing({
      occurrenceId,
      evaluatedAt: 10,
      createdAt: 10,
    });
    db.prepare(
      `INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at)
       VALUES (?, ?, '测试 Task', '测试要求', 1, 1)`,
    ).run('task-1', workspaceId);
    db.prepare(`UPDATE schedule_occurrences SET source_snapshot_id = ? WHERE id = ?`).run(
      snapshot.id,
      occurrenceId,
    );

    expect(() => assertScheduleSourceReadyForTask(db, snapshot.id, 'task-1')).toThrow(
      '定时来源快照尚未就绪',
    );
  });

  it('throws when the snapshot belongs to a different workspace', () => {
    const { db, sources, occurrenceId } = openFixture();
    const snapshot = sources.createPreparing({
      occurrenceId,
      evaluatedAt: 10,
      createdAt: 10,
    });
    const manifestHash = scheduleSourceManifestHash([]);
    sources.publishReady({
      snapshotId: snapshot.id,
      items: [],
      totalFileBytes: 0,
      manifestHash,
      completedAt: 20,
    });
    db.prepare(`UPDATE schedule_occurrences SET source_snapshot_id = ? WHERE id = ?`).run(
      snapshot.id,
      occurrenceId,
    );

    // Create a task in a different workspace
    const workspaces = new WorkspaceRepository(db);
    const otherWorkspace = workspaces.create('/tmp/other-workspace', '其他工作区');
    db.prepare(
      `INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at)
       VALUES (?, ?, '其他 Task', '其他要求', 1, 1)`,
    ).run('task-other', otherWorkspace.id);

    expect(() => assertScheduleSourceReadyForTask(db, snapshot.id, 'task-other')).toThrow(
      '定时来源快照不属于该 Task 或 Workspace',
    );
  });

  it('throws when an explicit workspaceId does not match', () => {
    const { db, sources, occurrenceId, workspaceId } = openFixture();
    const snapshot = sources.createPreparing({
      occurrenceId,
      evaluatedAt: 10,
      createdAt: 10,
    });
    const manifestHash = scheduleSourceManifestHash([]);
    sources.publishReady({
      snapshotId: snapshot.id,
      items: [],
      totalFileBytes: 0,
      manifestHash,
      completedAt: 20,
    });
    db.prepare(`UPDATE schedule_occurrences SET source_snapshot_id = ? WHERE id = ?`).run(
      snapshot.id,
      occurrenceId,
    );

    db.prepare(
      `INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at)
       VALUES (?, ?, '测试 Task', '测试要求', 1, 1)`,
    ).run('task-1', workspaceId);

    expect(() =>
      assertScheduleSourceReadyForTask(db, snapshot.id, 'task-1', 'wrong-workspace'),
    ).toThrow('定时来源快照不属于该 Task 或 Workspace');
  });
});

describe('scheduleSourceManifestHash', () => {
  it('returns a stable hash for an empty item list', () => {
    const hash = scheduleSourceManifestHash([]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns different hashes for different item lists', () => {
    const items1 = [
      {
        snapshotId: 'snap-1',
        ordinal: 0,
        reference: knowledgeRef('rev-1'),
        purpose: 'current-input' as const,
        origin: 'selected-document' as const,
        displayName: '报告 A',
      },
    ];
    const items2 = [
      {
        snapshotId: 'snap-1',
        ordinal: 0,
        reference: knowledgeRef('rev-2'),
        purpose: 'current-input' as const,
        origin: 'selected-document' as const,
        displayName: '报告 B',
      },
    ];
    expect(scheduleSourceManifestHash(items1)).not.toBe(scheduleSourceManifestHash(items2));
  });

  it('returns the same hash regardless of snapshotId', () => {
    const baseItem = {
      ordinal: 0,
      reference: knowledgeRef('rev-1'),
      purpose: 'current-input' as const,
      origin: 'selected-document' as const,
      displayName: '报告',
    };
    const hash1 = scheduleSourceManifestHash([{ ...baseItem, snapshotId: 'snap-1' }]);
    const hash2 = scheduleSourceManifestHash([{ ...baseItem, snapshotId: 'snap-2' }]);
    expect(hash1).toBe(hash2);
  });
});
