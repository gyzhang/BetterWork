import type {
  ExpertRevisionDraft,
  ScheduleConfigDraft,
  ScheduleResolvedPeriod,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore, scheduleSourceManifestHash } from './index';
import {
  ScheduleOccurrenceError,
  ScheduleOccurrenceStateError,
  ScheduleRequestKeyConflictError,
} from './schedule-occurrence-repository';

const stores: AppStore[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

function dbOf(store: AppStore): Database.Database {
  return (store as unknown as { db: Database.Database }).db;
}

function exec(db: Database.Database, sqlText: string, params: unknown[] = []): void {
  db.prepare(sqlText).run(...params);
}

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
  periodRule: 'none',
  knowledgeSources: [],
  outputSubdirectory: '定时成果',
  ...overrides,
});

const nonePeriod = (anchorAt: number): ScheduleResolvedPeriod => ({
  rule: 'none',
  timeZone: 'UTC',
  anchorAt,
  label: '不指定期间',
});

interface Fixture {
  store: AppStore;
  db: Database.Database;
  workspaceId: string;
  expertId: string;
  expertRevisionId: string;
  scheduleId: string;
}

const openFixture = (scheduleId = 'schedule-1'): Fixture => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const db = dbOf(store);
  const workspace = store.workspaces.create('/tmp/occurrence-test-workspace', '测试工作区');
  const expert = store.experts.create({ sourceKind: 'user', revision: expertDraft('测试专家') });
  const config = configDraft(expert.id, expert.revision.id);
  store.schedules.create({ id: scheduleId, workspaceId: workspace.id, config, createdAt: 1 });
  return {
    store,
    db,
    workspaceId: workspace.id,
    expertId: expert.id,
    expertRevisionId: expert.revision.id,
    scheduleId,
  };
};

const enableSchedule = (db: Database.Database, scheduleId: string, nextAt: number): void => {
  exec(
    db,
    `UPDATE schedules
     SET lifecycle = 'enabled', enabled_at = 10, enabled_config_version = current_config_version,
         capability_fingerprint = 'test-fingerprint', next_scheduled_at = ?
     WHERE id = ?`,
    [nextAt, scheduleId],
  );
};

const createManualPreparingOccurrence = (
  fixture: Fixture,
  occurrenceId: string,
  requestKey = 'test-request',
): void => {
  const { db, scheduleId } = fixture;
  exec(
    db,
    `INSERT INTO schedule_occurrences
       (id, schedule_id, config_version, trigger, scheduled_at, requested_at, request_key,
        original_occurrence_id, period_json, phase, preparation_outcome, reason_code,
        reason_detail, task_id, session_id, first_run_id, source_snapshot_id, created_at,
        prepared_at, finished_at)
     VALUES (?, ?, 1, 'manual-now', NULL, 100, ?, NULL, ?, 'preparing', NULL, NULL,
             NULL, NULL, NULL, NULL, NULL, 100, NULL, NULL)`,
    [occurrenceId, scheduleId, requestKey, JSON.stringify(nonePeriod(100))],
  );
};

const createReadySourceSnapshot = (
  fixture: Fixture,
  snapshotId: string,
  occurrenceId: string,
): void => {
  const { db, workspaceId } = fixture;
  exec(
    db,
    `INSERT INTO schedule_source_snapshots
       (id, occurrence_id, workspace_id, status, config_version, evaluated_at, manifest_hash,
        item_count, total_file_bytes, failure_code, created_at, completed_at)
     VALUES (?, ?, ?, 'ready', 1, 200, ?, 0, 0, NULL, 200, 200)`,
    [snapshotId, occurrenceId, workspaceId, scheduleSourceManifestHash([])],
  );
};

describe('ScheduleOccurrenceRepository', () => {
  describe('get', () => {
    it('returns undefined for a non-existent occurrence', () => {
      const fixture = openFixture();
      expect(fixture.store.scheduleOccurrences.get('does-not-exist')).toBeUndefined();
    });

    it('returns a stored occurrence with parsed JSON fields', () => {
      const fixture = openFixture();
      createManualPreparingOccurrence(fixture, 'occ-1');
      const occurrence = fixture.store.scheduleOccurrences.get('occ-1');
      expect(occurrence).toBeDefined();
      expect(occurrence?.id).toBe('occ-1');
      expect(occurrence?.phase).toBe('preparing');
      expect(occurrence?.trigger).toBe('manual-now');
      expect(occurrence?.requestKey).toBe('test-request');
    });
  });

  describe('findByFirstRunId', () => {
    it('returns undefined when no occurrence has the given run', () => {
      const fixture = openFixture();
      expect(fixture.store.scheduleOccurrences.findByFirstRunId('no-such-run')).toBeUndefined();
    });
  });

  describe('listDispatched', () => {
    it('returns an empty array when no dispatched occurrences exist', () => {
      const fixture = openFixture();
      expect(fixture.store.scheduleOccurrences.listDispatched()).toEqual([]);
    });
  });

  describe('listClosedWithoutInitialNotification', () => {
    it('rejects limits outside the 1-500 range', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.listClosedWithoutInitialNotification(0),
      ).toThrow('between 1 and 500');
      expect(() =>
        fixture.store.scheduleOccurrences.listClosedWithoutInitialNotification(501),
      ).toThrow('between 1 and 500');
    });

    it('returns an empty array when no closed occurrences exist', () => {
      const fixture = openFixture();
      expect(fixture.store.scheduleOccurrences.listClosedWithoutInitialNotification()).toEqual([]);
    });
  });

  describe('attachSourceSnapshot', () => {
    it('attaches a source snapshot to a preparing occurrence', () => {
      const fixture = openFixture();
      createManualPreparingOccurrence(fixture, 'occ-attach');
      createReadySourceSnapshot(fixture, 'snap-1', 'occ-attach');

      const result = fixture.store.scheduleOccurrences.attachSourceSnapshot('occ-attach', 'snap-1');
      expect(result.sourceSnapshotId).toBe('snap-1');
      expect(result.phase).toBe('preparing');
    });

    it('returns the same occurrence when the snapshot is already attached (idempotent)', () => {
      const fixture = openFixture();
      createManualPreparingOccurrence(fixture, 'occ-idem');
      createReadySourceSnapshot(fixture, 'snap-idem', 'occ-idem');

      fixture.store.scheduleOccurrences.attachSourceSnapshot('occ-idem', 'snap-idem');
      const result = fixture.store.scheduleOccurrences.attachSourceSnapshot(
        'occ-idem',
        'snap-idem',
      );
      expect(result.sourceSnapshotId).toBe('snap-idem');
    });

    it('throws when the occurrence is not in preparing phase', () => {
      const fixture = openFixture();
      const { db, scheduleId } = fixture;
      exec(
        db,
        `INSERT INTO schedule_occurrences
           (id, schedule_id, config_version, trigger, scheduled_at, requested_at, request_key,
            original_occurrence_id, period_json, phase, preparation_outcome, reason_code,
            reason_detail, task_id, session_id, first_run_id, source_snapshot_id, created_at,
            prepared_at, finished_at)
         VALUES ('occ-closed', ?, 1, 'manual-now', NULL, 100, 'req-closed', NULL, ?, 'closed',
                 'cancelled', 'schedule_cancelled', '规则已暂停', NULL, NULL, NULL, NULL, 100, NULL, 200)`,
        [scheduleId, JSON.stringify(nonePeriod(100))],
      );
      createReadySourceSnapshot(fixture, 'snap-closed', 'occ-closed');

      expect(() =>
        fixture.store.scheduleOccurrences.attachSourceSnapshot('occ-closed', 'snap-closed'),
      ).toThrow('cannot close from phase closed');
    });

    it('throws when the snapshot does not belong to the occurrence', () => {
      const fixture = openFixture();
      const { db, workspaceId } = fixture;
      // Create a second schedule so we can have two preparing occurrences
      const expert2 = fixture.store.experts.create({
        sourceKind: 'user',
        revision: expertDraft('第二位专家'),
      });
      const config2 = configDraft(expert2.id, expert2.revision.id);
      fixture.store.schedules.create({
        id: 'schedule-2',
        workspaceId,
        config: config2,
        createdAt: 1,
      });

      createManualPreparingOccurrence(fixture, 'occ-target', 'req-target');
      // Create occurrence on the second schedule
      exec(
        db,
        `INSERT INTO schedule_occurrences
           (id, schedule_id, config_version, trigger, scheduled_at, requested_at, request_key,
            original_occurrence_id, period_json, phase, preparation_outcome, reason_code,
            reason_detail, task_id, session_id, first_run_id, source_snapshot_id, created_at,
            prepared_at, finished_at)
         VALUES ('occ-owner', 'schedule-2', 1, 'manual-now', NULL, 100, 'req-owner', NULL, ?,
                 'preparing', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 100, NULL, NULL)`,
        [JSON.stringify(nonePeriod(100))],
      );
      createReadySourceSnapshot(fixture, 'snap-wrong', 'occ-owner');

      expect(() =>
        fixture.store.scheduleOccurrences.attachSourceSnapshot('occ-target', 'snap-wrong'),
      ).toThrow('does not belong to occurrence');
    });

    it('throws when the occurrence does not exist', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.attachSourceSnapshot('no-such-occ', 'snap-x'),
      ).toThrow();
    });
  });

  describe('claimManual', () => {
    it('creates a manual-now occurrence for an existing schedule', () => {
      const fixture = openFixture();
      const result = fixture.store.scheduleOccurrences.claimManual({
        scheduleId: fixture.scheduleId,
        trigger: 'manual-now',
        requestKey: 'manual-req-1',
        requestedAt: 1000,
        period: nonePeriod(1000),
      });
      expect(result.kind).toBe('created');
      if (result.kind !== 'created') return;
      expect(result.occurrence.trigger).toBe('manual-now');
      expect(result.occurrence.requestKey).toBe('manual-req-1');
      expect(result.occurrence.phase).toBe('preparing');
    });

    it('returns existing occurrence for a duplicate request key', () => {
      const fixture = openFixture();
      const input = {
        scheduleId: fixture.scheduleId,
        trigger: 'manual-now' as const,
        requestKey: 'dup-key',
        requestedAt: 1000,
        period: nonePeriod(1000),
      };
      const first = fixture.store.scheduleOccurrences.claimManual(input);
      expect(first.kind).toBe('created');
      if (first.kind !== 'created') return;

      const second = fixture.store.scheduleOccurrences.claimManual({
        ...input,
        requestedAt: 2000,
      });
      expect(second.kind).toBe('existing');
      if (second.kind !== 'existing') return;
      expect(second.occurrence.id).toBe(first.occurrence.id);
    });

    it('returns busy when another occurrence is actively preparing', () => {
      const fixture = openFixture();
      const first = fixture.store.scheduleOccurrences.claimManual({
        scheduleId: fixture.scheduleId,
        trigger: 'manual-now',
        requestKey: 'busy-first',
        requestedAt: 1000,
        period: nonePeriod(1000),
      });
      expect(first.kind).toBe('created');
      if (first.kind !== 'created') return;

      const second = fixture.store.scheduleOccurrences.claimManual({
        scheduleId: fixture.scheduleId,
        trigger: 'manual-now',
        requestKey: 'busy-second',
        requestedAt: 2000,
        period: nonePeriod(2000),
      });
      expect(second).toEqual({ kind: 'busy', existingOccurrenceId: first.occurrence.id });
    });

    it('throws for a non-existent schedule', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.claimManual({
          scheduleId: 'no-such-schedule',
          trigger: 'manual-now',
          requestKey: 'orphan-req',
          requestedAt: 1000,
          period: nonePeriod(1000),
        }),
      ).toThrow('Schedule does not exist');
    });

    it('throws for an archived schedule', () => {
      const fixture = openFixture('schedule-archived');
      exec(fixture.db, "UPDATE schedules SET lifecycle = 'archived' WHERE id = ?", [
        'schedule-archived',
      ]);
      expect(() =>
        fixture.store.scheduleOccurrences.claimManual({
          scheduleId: 'schedule-archived',
          trigger: 'manual-now',
          requestKey: 'archived-req',
          requestedAt: 1000,
          period: nonePeriod(1000),
        }),
      ).toThrow('Archived Schedule cannot run');
    });

    it('throws when request key is empty', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.claimManual({
          scheduleId: fixture.scheduleId,
          trigger: 'manual-now',
          requestKey: '   ',
          requestedAt: 1000,
          period: nonePeriod(1000),
        }),
      ).toThrow('1 to 200 characters');
    });

    it('throws when expected revision does not match', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.claimManual({
          scheduleId: fixture.scheduleId,
          trigger: 'manual-now',
          requestKey: 'rev-check',
          requestedAt: 1000,
          period: nonePeriod(1000),
          expectedRevision: 999,
        }),
      ).toThrow('Schedule revision changed');
    });

    it('creates a manual-missed occurrence referencing a missed scheduled occurrence', () => {
      const fixture = openFixture();
      const { db, scheduleId } = fixture;
      enableSchedule(db, scheduleId, 5000);

      const scheduled = fixture.store.scheduleOccurrences.claimScheduled({
        scheduleId,
        scheduledAt: 5000,
        requestedAt: 5001,
        period: nonePeriod(5000),
        nextScheduledAt: 6000,
      });
      expect(scheduled.kind).toBe('created');
      if (scheduled.kind !== 'created') return;

      fixture.store.scheduleOccurrences.closePreparation({
        occurrenceId: scheduled.occurrence.id,
        outcome: 'missed',
        finishedAt: 5100,
      });

      const missed = fixture.store.scheduleOccurrences.claimManual({
        scheduleId,
        trigger: 'manual-missed',
        requestKey: 'missed-recovery',
        requestedAt: 5200,
        originalOccurrenceId: scheduled.occurrence.id,
      });
      expect(missed.kind).toBe('created');
      if (missed.kind !== 'created') return;
      expect(missed.occurrence.trigger).toBe('manual-missed');
      expect(missed.occurrence.originalOccurrenceId).toBe(scheduled.occurrence.id);
      expect(missed.occurrence.period).toEqual(scheduled.occurrence.period);
    });

    it('throws manual-missed when original occurrence is not a missed closed one', () => {
      const fixture = openFixture();
      createManualPreparingOccurrence(fixture, 'occ-preparing-ref');

      expect(() =>
        fixture.store.scheduleOccurrences.claimManual({
          scheduleId: fixture.scheduleId,
          trigger: 'manual-missed',
          requestKey: 'bad-missed-ref',
          requestedAt: 1000,
          originalOccurrenceId: 'occ-preparing-ref',
        }),
      ).toThrow('Manual missed execution must reference a missed occurrence');
    });
  });

  describe('claimScheduled', () => {
    it('creates a scheduled occurrence and advances the cursor', () => {
      const fixture = openFixture();
      enableSchedule(fixture.db, fixture.scheduleId, 10_000);

      const result = fixture.store.scheduleOccurrences.claimScheduled({
        scheduleId: fixture.scheduleId,
        scheduledAt: 10_000,
        requestedAt: 10_001,
        period: nonePeriod(10_000),
        nextScheduledAt: 20_000,
      });
      expect(result.kind).toBe('created');
      if (result.kind !== 'created') return;
      expect(result.occurrence.trigger).toBe('scheduled');
      expect(result.occurrence.scheduledAt).toBe(10_000);
      expect(result.occurrence.phase).toBe('preparing');
    });

    it('returns existing for a duplicate scheduled_at', () => {
      const fixture = openFixture();
      enableSchedule(fixture.db, fixture.scheduleId, 10_000);

      const input = {
        scheduleId: fixture.scheduleId,
        scheduledAt: 10_000,
        requestedAt: 10_001,
        period: nonePeriod(10_000),
        nextScheduledAt: 20_000,
      };
      const first = fixture.store.scheduleOccurrences.claimScheduled(input);
      expect(first.kind).toBe('created');
      if (first.kind !== 'created') return;

      const second = fixture.store.scheduleOccurrences.claimScheduled(input);
      expect(second.kind).toBe('existing');
      if (second.kind !== 'existing') return;
      expect(second.occurrence.id).toBe(first.occurrence.id);
    });

    it('throws when the schedule does not exist', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.claimScheduled({
          scheduleId: 'no-such-schedule',
          scheduledAt: 10_000,
          requestedAt: 10_001,
          period: nonePeriod(10_000),
        }),
      ).toThrow('Schedule does not exist');
    });

    it('throws when the schedule is paused (not enabled)', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.claimScheduled({
          scheduleId: fixture.scheduleId,
          scheduledAt: 10_000,
          requestedAt: 10_001,
          period: nonePeriod(10_000),
        }),
      ).toThrow('Schedule is not enabled');
    });

    it('throws when nextScheduledAt is not later than scheduledAt', () => {
      const fixture = openFixture();
      enableSchedule(fixture.db, fixture.scheduleId, 10_000);
      expect(() =>
        fixture.store.scheduleOccurrences.claimScheduled({
          scheduleId: fixture.scheduleId,
          scheduledAt: 10_000,
          requestedAt: 10_001,
          period: nonePeriod(10_000),
          nextScheduledAt: 5_000,
        }),
      ).toThrow('must be later');
    });

    it('creates a skipped-overlap occurrence when another is active', () => {
      const fixture = openFixture();
      enableSchedule(fixture.db, fixture.scheduleId, 10_000);

      const first = fixture.store.scheduleOccurrences.claimScheduled({
        scheduleId: fixture.scheduleId,
        scheduledAt: 10_000,
        requestedAt: 10_001,
        period: nonePeriod(10_000),
        nextScheduledAt: 20_000,
      });
      expect(first.kind).toBe('created');

      exec(fixture.db, 'UPDATE schedules SET next_scheduled_at = 20000 WHERE id = ?', [
        fixture.scheduleId,
      ]);

      const second = fixture.store.scheduleOccurrences.claimScheduled({
        scheduleId: fixture.scheduleId,
        scheduledAt: 20_000,
        requestedAt: 20_001,
        period: nonePeriod(20_000),
        nextScheduledAt: 30_000,
      });
      expect(second.kind).toBe('skipped-overlap');
      if (second.kind !== 'skipped-overlap') return;
      expect(second.occurrence.preparationOutcome).toBe('skipped-overlap');
      expect(second.occurrence.phase).toBe('closed');
    });
  });

  describe('claimMissedScheduled', () => {
    it('creates a closed occurrence with missed outcome', () => {
      const fixture = openFixture();
      enableSchedule(fixture.db, fixture.scheduleId, 10_000);

      const result = fixture.store.scheduleOccurrences.claimMissedScheduled({
        scheduleId: fixture.scheduleId,
        scheduledAt: 10_000,
        requestedAt: 10_001,
        period: nonePeriod(10_000),
        reasonDetail: '错过执行窗口',
      });
      expect(result.kind).toBe('created');
      if (result.kind !== 'created') return;
      expect(result.occurrence.phase).toBe('closed');
      expect(result.occurrence.preparationOutcome).toBe('missed');
      expect(result.occurrence.reasonDetail).toBe('错过执行窗口');
    });
  });

  describe('skipScheduledForCapacity', () => {
    it('creates a closed occurrence with skipped-overlap outcome', () => {
      const fixture = openFixture();
      enableSchedule(fixture.db, fixture.scheduleId, 10_000);

      const result = fixture.store.scheduleOccurrences.skipScheduledForCapacity({
        scheduleId: fixture.scheduleId,
        scheduledAt: 10_000,
        requestedAt: 10_001,
        period: nonePeriod(10_000),
        reasonDetail: '容量不足跳过',
      });
      expect(result.kind).toBe('skipped-overlap');
      if (result.kind !== 'skipped-overlap') return;
      expect(result.occurrence.phase).toBe('closed');
      expect(result.occurrence.preparationOutcome).toBe('skipped-overlap');
      expect(result.occurrence.reasonCode).toBe('schedule_capacity');
    });
  });

  describe('findManualRequest', () => {
    it('returns undefined when no matching request exists', () => {
      const fixture = openFixture();
      expect(
        fixture.store.scheduleOccurrences.findManualRequest({
          scheduleId: fixture.scheduleId,
          requestKey: 'nonexistent',
          trigger: 'manual-now',
        }),
      ).toBeUndefined();
    });

    it('returns the existing occurrence for a matching request key', () => {
      const fixture = openFixture();
      fixture.store.scheduleOccurrences.claimManual({
        scheduleId: fixture.scheduleId,
        trigger: 'manual-now',
        requestKey: 'find-me',
        requestedAt: 1000,
        period: nonePeriod(1000),
      });

      const found = fixture.store.scheduleOccurrences.findManualRequest({
        scheduleId: fixture.scheduleId,
        requestKey: 'find-me',
        trigger: 'manual-now',
      });
      expect(found).toBeDefined();
      expect(found?.requestKey).toBe('find-me');
    });

    it('throws when the trigger type does not match', () => {
      const fixture = openFixture();
      fixture.store.scheduleOccurrences.claimManual({
        scheduleId: fixture.scheduleId,
        trigger: 'manual-now',
        requestKey: 'wrong-trigger',
        requestedAt: 1000,
        period: nonePeriod(1000),
      });

      expect(() =>
        fixture.store.scheduleOccurrences.findManualRequest({
          scheduleId: fixture.scheduleId,
          requestKey: 'wrong-trigger',
          trigger: 'manual-missed',
          originalOccurrenceId: 'some-occ',
        }),
      ).toThrow('Schedule request key belongs to a different trigger');
    });
  });

  describe('closePreparation', () => {
    it('closes a preparing occurrence with cancelled outcome', () => {
      const fixture = openFixture();
      createManualPreparingOccurrence(fixture, 'occ-cancel');

      const result = fixture.store.scheduleOccurrences.closePreparation({
        occurrenceId: 'occ-cancel',
        outcome: 'cancelled',
        finishedAt: 500,
      });
      expect(result.phase).toBe('closed');
      expect(result.preparationOutcome).toBe('cancelled');
      expect(result.finishedAt).toBe(500);
    });

    it('closes a preparing occurrence with blocked outcome', () => {
      const fixture = openFixture();
      createManualPreparingOccurrence(fixture, 'occ-blocked');

      const result = fixture.store.scheduleOccurrences.closePreparation({
        occurrenceId: 'occ-blocked',
        outcome: 'blocked',
        finishedAt: 600,
        reasonCode: 'schedule_busy',
        reasonDetail: '有实例正在运行',
      });
      expect(result.phase).toBe('closed');
      expect(result.preparationOutcome).toBe('blocked');
      expect(result.reasonCode).toBe('schedule_busy');
      expect(result.reasonDetail).toBe('有实例正在运行');
    });

    it('throws when closing a non-preparing occurrence', () => {
      const fixture = openFixture();
      const { db, scheduleId } = fixture;
      exec(
        db,
        `INSERT INTO schedule_occurrences
           (id, schedule_id, config_version, trigger, scheduled_at, requested_at, request_key,
            original_occurrence_id, period_json, phase, preparation_outcome, reason_code,
            reason_detail, task_id, session_id, first_run_id, source_snapshot_id, created_at,
            prepared_at, finished_at)
         VALUES ('occ-already-closed', ?, 1, 'manual-now', NULL, 100, 'req-closed2', NULL, ?,
                 'closed', 'cancelled', 'schedule_cancelled', '已取消', NULL, NULL, NULL, NULL,
                 100, NULL, 200)`,
        [scheduleId, JSON.stringify(nonePeriod(100))],
      );

      expect(() =>
        fixture.store.scheduleOccurrences.closePreparation({
          occurrenceId: 'occ-already-closed',
          outcome: 'blocked',
          finishedAt: 300,
        }),
      ).toThrow('cannot close from phase closed');
    });

    it('throws when the occurrence does not exist', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.closePreparation({
          occurrenceId: 'no-such-occ',
          outcome: 'cancelled',
          finishedAt: 100,
        }),
      ).toThrow();
    });

    it('throws for invalid finishedAt timestamp', () => {
      const fixture = openFixture();
      createManualPreparingOccurrence(fixture, 'occ-bad-ts');
      expect(() =>
        fixture.store.scheduleOccurrences.closePreparation({
          occurrenceId: 'occ-bad-ts',
          outcome: 'cancelled',
          finishedAt: -1,
        }),
      ).toThrow('non-negative safe integer');
    });

    it('closes with needs-material outcome and a draft task', () => {
      const fixture = openFixture();
      const { db, workspaceId } = fixture;
      createManualPreparingOccurrence(fixture, 'occ-material');

      exec(
        db,
        `INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at)
         VALUES ('draft-task', ?, '材料草稿', '等待材料', 1, 1)`,
        [workspaceId],
      );

      const result = fixture.store.scheduleOccurrences.closePreparation({
        occurrenceId: 'occ-material',
        outcome: 'needs-material',
        finishedAt: 700,
        taskId: 'draft-task',
      });
      expect(result.phase).toBe('closed');
      expect(result.preparationOutcome).toBe('needs-material');
      expect(result.taskId).toBe('draft-task');
    });

    it('throws needs-material closure without a taskId', () => {
      const fixture = openFixture();
      createManualPreparingOccurrence(fixture, 'occ-no-task');

      expect(() =>
        fixture.store.scheduleOccurrences.closePreparation({
          occurrenceId: 'occ-no-task',
          outcome: 'needs-material',
          finishedAt: 700,
        }),
      ).toThrow('needs-material closure requires its draft Task');
    });
  });

  describe('finishDispatched', () => {
    it('throws when the occurrence does not exist', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.finishDispatched({
          occurrenceId: 'no-such-occ',
          firstRunId: 'run-1',
          finishedAt: 100,
        }),
      ).toThrow();
    });

    it('throws when the occurrence is in preparing phase (not dispatched)', () => {
      const fixture = openFixture();
      createManualPreparingOccurrence(fixture, 'occ-prep');

      expect(() =>
        fixture.store.scheduleOccurrences.finishDispatched({
          occurrenceId: 'occ-prep',
          firstRunId: 'run-1',
          finishedAt: 100,
        }),
      ).toThrow('cannot close from phase preparing');
    });

    it('throws for invalid finishedAt timestamp', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.finishDispatched({
          occurrenceId: 'whatever',
          firstRunId: 'run-1',
          finishedAt: -5,
        }),
      ).toThrow('non-negative safe integer');
    });
  });

  describe('cancelPreparing', () => {
    it('cancels all preparing occurrences for a schedule', () => {
      const fixture = openFixture();
      createManualPreparingOccurrence(fixture, 'occ-cancel-1', 'req-1');

      const cancelled = fixture.store.scheduleOccurrences.cancelPreparing(fixture.scheduleId, 900);
      expect(cancelled).toEqual(['occ-cancel-1']);

      const after = fixture.store.scheduleOccurrences.get('occ-cancel-1');
      expect(after?.phase).toBe('closed');
      expect(after?.preparationOutcome).toBe('cancelled');
      expect(after?.reasonCode).toBe('schedule_cancelled');
      expect(after?.finishedAt).toBe(900);
    });

    it('returns empty array when no preparing occurrences exist', () => {
      const fixture = openFixture();
      expect(fixture.store.scheduleOccurrences.cancelPreparing(fixture.scheduleId, 900)).toEqual(
        [],
      );
    });

    it('throws for invalid finishedAt timestamp', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.cancelPreparing(fixture.scheduleId, -1),
      ).toThrow('non-negative safe integer');
    });
  });

  describe('listBySchedule', () => {
    it('returns an empty page for a schedule with no occurrences', () => {
      const fixture = openFixture();
      const page = fixture.store.scheduleOccurrences.listBySchedule({
        scheduleId: fixture.scheduleId,
        limit: 10,
      });
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeUndefined();
    });

    it('lists occurrences in reverse chronological order with cursor pagination', () => {
      const fixture = openFixture();
      const { db, scheduleId } = fixture;

      for (let i = 0; i < 5; i++) {
        const occId = `occ-list-${i}`;
        const reqKey = `req-list-${i}`;
        const requestedAt = 100 + i * 10;
        exec(
          db,
          `INSERT INTO schedule_occurrences
             (id, schedule_id, config_version, trigger, scheduled_at, requested_at, request_key,
              original_occurrence_id, period_json, phase, preparation_outcome, reason_code,
              reason_detail, task_id, session_id, first_run_id, source_snapshot_id, created_at,
              prepared_at, finished_at)
           VALUES (?, ?, 1, 'manual-now', NULL, ?, ?, NULL, ?, 'closed', 'blocked',
                   'schedule_busy', '忙跳过', NULL, NULL, NULL, NULL, ?, NULL, ?)`,
          [
            occId,
            scheduleId,
            requestedAt,
            reqKey,
            JSON.stringify(nonePeriod(requestedAt)),
            requestedAt,
            requestedAt + 100,
          ],
        );
      }

      const firstPage = fixture.store.scheduleOccurrences.listBySchedule({
        scheduleId,
        limit: 2,
      });
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.nextCursor).toBeDefined();

      const secondPage = fixture.store.scheduleOccurrences.listBySchedule({
        scheduleId,
        limit: 2,
        cursor: firstPage.nextCursor,
      });
      expect(secondPage.items).toHaveLength(2);
      expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);

      const thirdPage = fixture.store.scheduleOccurrences.listBySchedule({
        scheduleId,
        limit: 2,
        cursor: secondPage.nextCursor,
      });
      expect(thirdPage.items).toHaveLength(1);
      expect(thirdPage.nextCursor).toBeUndefined();
    });
  });

  describe('attachPreparedTask', () => {
    it('throws when the occurrence does not exist', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.attachPreparedTask({
          occurrenceId: 'no-such-occ',
          taskId: 'task-1',
          sessionId: 'session-1',
          sourceSnapshotId: 'snap-1',
          preparedAt: 100,
        }),
      ).toThrow();
    });

    it('throws when the occurrence is not in preparing phase', () => {
      const fixture = openFixture();
      const { db, scheduleId } = fixture;
      exec(
        db,
        `INSERT INTO schedule_occurrences
           (id, schedule_id, config_version, trigger, scheduled_at, requested_at, request_key,
            original_occurrence_id, period_json, phase, preparation_outcome, reason_code,
            reason_detail, task_id, session_id, first_run_id, source_snapshot_id, created_at,
            prepared_at, finished_at)
         VALUES ('occ-closed-2', ?, 1, 'manual-now', NULL, 100, 'req-closed-2', NULL, ?, 'closed',
                 'cancelled', 'schedule_cancelled', '已取消', NULL, NULL, NULL, NULL, 100, NULL, 200)`,
        [scheduleId, JSON.stringify(nonePeriod(100))],
      );

      expect(() =>
        fixture.store.scheduleOccurrences.attachPreparedTask({
          occurrenceId: 'occ-closed-2',
          taskId: 'task-1',
          sessionId: 'session-1',
          sourceSnapshotId: 'snap-1',
          preparedAt: 100,
        }),
      ).toThrow('cannot close from phase closed');
    });

    it('throws for invalid preparedAt timestamp', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.attachPreparedTask({
          occurrenceId: 'whatever',
          taskId: 'task-1',
          sessionId: 'session-1',
          sourceSnapshotId: 'snap-1',
          preparedAt: -10,
        }),
      ).toThrow('non-negative safe integer');
    });
  });

  describe('dispatchRun', () => {
    it('throws when the occurrence does not exist', () => {
      const fixture = openFixture();
      expect(() =>
        fixture.store.scheduleOccurrences.dispatchRun({
          occurrenceId: 'no-such-occ',
          runId: 'run-1',
          taskId: 'task-1',
          sessionId: 'session-1',
          taskContextRevisionId: 'tcr-1',
        }),
      ).toThrow();
    });

    it('throws when the occurrence is in preparing phase without task/session attached', () => {
      const fixture = openFixture();
      createManualPreparingOccurrence(fixture, 'occ-no-task');

      expect(() =>
        fixture.store.scheduleOccurrences.dispatchRun({
          occurrenceId: 'occ-no-task',
          runId: 'run-1',
          taskId: 'task-1',
          sessionId: 'session-1',
          taskContextRevisionId: 'tcr-1',
        }),
      ).toThrow();
    });
  });

  describe('full lifecycle: manual claim -> source -> prepare -> dispatch -> finish', () => {
    it('walks through the complete occurrence lifecycle via the AppStore repositories', () => {
      const store = AppStore.open(':memory:');
      stores.push(store);
      const db = dbOf(store);

      const workspace = store.workspaces.create('/tmp/lifecycle-ws', '生命周期工作区');
      const expert = store.experts.create({
        sourceKind: 'user',
        revision: expertDraft('生命周期专家'),
      });
      const config = configDraft(expert.id, expert.revision.id, { periodRule: 'none' });
      const aggregate = store.schedules.create({
        id: 'schedule-lifecycle',
        workspaceId: workspace.id,
        config,
        createdAt: 1,
        activation: {
          enabledAt: 1,
          capabilityFingerprint: 'lifecycle-fingerprint',
          nextScheduledAt: 100_000,
        },
      });
      const scheduleId = aggregate.schedule.id;

      // Step 1: manual claim
      const period: ScheduleResolvedPeriod = {
        rule: 'none',
        timeZone: 'UTC',
        anchorAt: 10_000,
        label: '不指定期间',
      };
      const claim = store.scheduleOccurrences.claimManual({
        scheduleId,
        trigger: 'manual-now',
        requestKey: 'lifecycle-request',
        requestedAt: 10_000,
        period,
      });
      expect(claim.kind).toBe('created');
      if (claim.kind !== 'created') return;
      const occurrenceId = claim.occurrence.id;
      expect(claim.occurrence.phase).toBe('preparing');

      // Step 2: create and publish source snapshot
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

      // Step 3: attach source snapshot
      const withSource = store.scheduleOccurrences.attachSourceSnapshot(occurrenceId, snapshot.id);
      expect(withSource.sourceSnapshotId).toBe(snapshot.id);

      // Step 4: create task, session, task context, and attach prepared task
      const taskId = 'lifecycle-task';
      exec(
        db,
        `INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at)
         VALUES (?, ?, '生命周期任务', '完成端到端验证', 10_003, 10_003)`,
        [taskId, workspace.id],
      );
      exec(db, 'INSERT INTO sessions (id, task_id, created_at) VALUES (?, ?, ?)', [
        'lifecycle-session',
        taskId,
        10_003,
      ]);

      const contextRevisionId = 'lifecycle-tcr';
      exec(
        db,
        `INSERT INTO task_context_revisions
           (id, task_id, revision, executor_json, skill_bindings_json, model_reference_json,
            builtin_tool_policy_json, materials_json, created_at, updated_at,
            schedule_source_snapshot_id)
         VALUES (?, ?, 1, ?, '[]', NULL, NULL, '[]', 10_003, 10_003, ?)`,
        [
          contextRevisionId,
          taskId,
          JSON.stringify({
            kind: 'expert',
            expertId: expert.id,
            expertRevisionId: expert.revision.id,
          }),
          snapshot.id,
        ],
      );

      const prepared = store.scheduleOccurrences.attachPreparedTask({
        occurrenceId,
        taskId,
        sessionId: 'lifecycle-session',
        sourceSnapshotId: snapshot.id,
        preparedAt: 10_004,
      });
      expect(prepared.taskId).toBe(taskId);
      expect(prepared.sessionId).toBe('lifecycle-session');
      expect(prepared.preparedAt).toBe(10_004);

      // Step 5: create a run and run_context_snapshot, then dispatch
      const runId = 'lifecycle-run';
      exec(
        db,
        `INSERT INTO runs (id, task_id, session_id, prompt, status, created_at, completed_at)
         VALUES (?, ?, ?, '生命周期提示', 'running', 10_005, NULL)`,
        [runId, taskId, 'lifecycle-session'],
      );
      exec(
        db,
        `INSERT INTO run_context_snapshots
           (run_id, task_id, workspace_id, task_context_revision_id, context_segment_id,
            materials_json, created_at, expert_id, expert_revision_id,
            schedule_source_snapshot_id)
         VALUES (?, ?, ?, ?, 'seg-1', '[]', 10_005, ?, ?, ?)`,
        [
          runId,
          taskId,
          workspace.id,
          contextRevisionId,
          expert.id,
          expert.revision.id,
          snapshot.id,
        ],
      );

      const dispatched = store.scheduleOccurrences.dispatchRun({
        occurrenceId,
        runId,
        taskId,
        sessionId: 'lifecycle-session',
        taskContextRevisionId: contextRevisionId,
      });
      expect(dispatched.phase).toBe('dispatched');
      expect(dispatched.firstRunId).toBe(runId);

      // Step 6: verify findByFirstRunId works
      const byRun = store.scheduleOccurrences.findByFirstRunId(runId);
      expect(byRun?.id).toBe(occurrenceId);

      // Step 7: verify listDispatched returns it
      const dispatchedList = store.scheduleOccurrences.listDispatched();
      expect(dispatchedList).toHaveLength(1);
      expect(dispatchedList[0]?.id).toBe(occurrenceId);

      // Step 8: finish the dispatched occurrence
      exec(db, "UPDATE runs SET status = 'completed', completed_at = 10_010 WHERE id = ?", [runId]);
      const finished = store.scheduleOccurrences.finishDispatched({
        occurrenceId,
        firstRunId: runId,
        finishedAt: 10_010,
      });
      expect(finished.phase).toBe('closed');
      expect(finished.finishedAt).toBe(10_010);

      // Step 9: finishDispatched is idempotent
      const finishedAgain = store.scheduleOccurrences.finishDispatched({
        occurrenceId,
        firstRunId: runId,
        finishedAt: 10_010,
      });
      expect(finishedAgain.id).toBe(finished.id);
    });
  });

  describe('listClosedWithoutInitialNotification (with data)', () => {
    it('returns closed occurrences with blocked outcome that have no receipt', () => {
      const fixture = openFixture();
      const { db, scheduleId } = fixture;

      exec(
        db,
        `INSERT INTO schedule_occurrences
           (id, schedule_id, config_version, trigger, scheduled_at, requested_at, request_key,
            original_occurrence_id, period_json, phase, preparation_outcome, reason_code,
            reason_detail, task_id, session_id, first_run_id, source_snapshot_id, created_at,
            prepared_at, finished_at)
         VALUES ('occ-notif-1', ?, 1, 'manual-now', NULL, 100, 'req-notif-1', NULL, ?, 'closed',
                 'blocked', 'schedule_busy', '忙跳过', NULL, NULL, NULL, NULL, 100, NULL, 200)`,
        [scheduleId, JSON.stringify(nonePeriod(100))],
      );

      const results = fixture.store.scheduleOccurrences.listClosedWithoutInitialNotification();
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('occ-notif-1');
    });

    it('excludes occurrences that already have an initial-outcome receipt', () => {
      const fixture = openFixture();
      const { db, scheduleId } = fixture;

      exec(
        db,
        `INSERT INTO schedule_occurrences
           (id, schedule_id, config_version, trigger, scheduled_at, requested_at, request_key,
            original_occurrence_id, period_json, phase, preparation_outcome, reason_code,
            reason_detail, task_id, session_id, first_run_id, source_snapshot_id, created_at,
            prepared_at, finished_at)
         VALUES ('occ-notified', ?, 1, 'manual-now', NULL, 100, 'req-notified', NULL, ?, 'closed',
                 'blocked', 'schedule_busy', '忙跳过', NULL, NULL, NULL, NULL, 100, NULL, 200)`,
        [scheduleId, JSON.stringify(nonePeriod(100))],
      );

      exec(
        db,
        `INSERT INTO schedule_notification_receipts
           (occurrence_id, outcome_key, notification_id, created_at)
         VALUES ('occ-notified', 'initial-outcome', 'notif-1', 300)`,
      );

      const results = fixture.store.scheduleOccurrences.listClosedWithoutInitialNotification();
      expect(results).toHaveLength(0);
    });
  });

  describe('cancelPreparing does not affect dispatched occurrences', () => {
    it('only cancels preparing occurrences', () => {
      const store = AppStore.open(':memory:');
      stores.push(store);

      const workspace = store.workspaces.create('/tmp/cancel-mixed-ws', '混合取消工作区');
      const expert = store.experts.create({
        sourceKind: 'user',
        revision: expertDraft('混合取消专家'),
      });
      const config = configDraft(expert.id, expert.revision.id, { periodRule: 'none' });
      const aggregate = store.schedules.create({
        id: 'schedule-mixed',
        workspaceId: workspace.id,
        config,
        createdAt: 1,
        activation: {
          enabledAt: 1,
          capabilityFingerprint: 'mixed-fp',
          nextScheduledAt: 200_000,
        },
      });
      const scheduleId = aggregate.schedule.id;

      const period: ScheduleResolvedPeriod = {
        rule: 'none',
        timeZone: 'UTC',
        anchorAt: 50_000,
        label: '不指定期间',
      };
      const claim = store.scheduleOccurrences.claimManual({
        scheduleId,
        trigger: 'manual-now',
        requestKey: 'mixed-preparing',
        requestedAt: 50_000,
        period,
      });
      expect(claim.kind).toBe('created');
      if (claim.kind !== 'created') return;
      const preparingOccId = claim.occurrence.id;

      const cancelled = store.scheduleOccurrences.cancelPreparing(scheduleId, 60_000);
      expect(cancelled).toEqual([preparingOccId]);

      const after = store.scheduleOccurrences.get(preparingOccId);
      expect(after?.phase).toBe('closed');
      expect(after?.preparationOutcome).toBe('cancelled');
    });
  });

  describe('error classes', () => {
    it('ScheduleOccurrenceError has correct properties', () => {
      const error = new ScheduleOccurrenceError('schedule_not_found', 'not found', 5);
      expect(error.code).toBe('schedule_not_found');
      expect(error.currentRevision).toBe(5);
      expect(error.name).toBe('ScheduleOccurrenceError');
      expect(error.message).toBe('not found');
    });

    it('ScheduleRequestKeyConflictError has correct properties', () => {
      const error = new ScheduleRequestKeyConflictError('sched-1', 'key-1');
      expect(error.name).toBe('ScheduleRequestKeyConflictError');
      expect(error.message).toContain('sched-1');
      expect(error.message).toContain('key-1');
    });

    it('ScheduleOccurrenceStateError has correct properties', () => {
      const error = new ScheduleOccurrenceStateError('occ-1', 'dispatched');
      expect(error.name).toBe('ScheduleOccurrenceStateError');
      expect(error.message).toContain('occ-1');
      expect(error.message).toContain('dispatched');
    });

    it('ScheduleOccurrenceStateError handles undefined phase', () => {
      const error = new ScheduleOccurrenceStateError('occ-2', undefined);
      expect(error.message).toContain('missing');
    });
  });
});
