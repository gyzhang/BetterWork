import type {
  ExpertRevisionDraft,
  ScheduleConfigDraft,
  ScheduleResolvedPeriod,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { openAppDatabase } from '../db';
import { ExpertRepository } from './expert-repository';
import {
  AppStore,
  ScheduleOccurrenceRepository,
  ScheduleRepository,
  scheduleSourceManifestHash,
  ScheduleSourceRepository,
} from './index';
import { WorkspaceRepository } from './workspace-repository';

const databases: Database.Database[] = [];
const stores: AppStore[] = [];

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

const openFixtures = () => {
  const db = openAppDatabase(':memory:');
  databases.push(db);
  const workspaces = new WorkspaceRepository(db);
  const workspace = workspaces.create('/tmp/schedule-test-workspace', '定时任务合成工作区');
  const experts = new ExpertRepository(db);
  const expert = experts.create({ sourceKind: 'user', revision: expertDraft('月度分析专家') });
  const schedules = new ScheduleRepository(db);
  const occurrences = new ScheduleOccurrenceRepository(db);
  const config = configDraft(expert.id, expert.revision.id);
  const createSchedule = (id: string, createdAt = 1) =>
    schedules.create({ id, workspaceId: workspace.id, config, createdAt });
  return { db, workspace, schedules, occurrences, config, expert, experts, createSchedule };
};

const previousMonth = (anchorAt: number, monthIndex: number): ScheduleResolvedPeriod => ({
  rule: 'previous-month',
  timeZone: 'Asia/Shanghai',
  anchorAt,
  startAt: Date.UTC(2025, monthIndex, 1),
  endAt: Date.UTC(2025, monthIndex + 1, 1),
  label: `合成期间 ${monthIndex + 1}`,
});

const enableAt = (db: Database.Database, scheduleId: string, nextAt: number): void => {
  db.prepare(
    `UPDATE schedules
     SET lifecycle = 'enabled', enabled_at = 10, enabled_config_version = current_config_version,
         capability_fingerprint = 'synthetic-fingerprint', next_scheduled_at = ?
     WHERE id = ?`,
  ).run(nextAt, scheduleId);
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const db of databases.splice(0)) db.close();
});

describe('ScheduleRepository', () => {
  it('appends immutable configuration versions and paginates by a stable createdAt/id cursor', () => {
    const { schedules, config, expert, createSchedule } = openFixtures();
    createSchedule('schedule-a', 100);
    createSchedule('schedule-b', 100);
    createSchedule('schedule-c', 100);
    expect(schedules.get('schedule-a')?.config).toMatchObject(config);

    const firstPage = schedules.list({ limit: 2 });
    expect(firstPage.items.map((item) => item.schedule.id)).toEqual(['schedule-c', 'schedule-b']);
    expect(firstPage.nextCursor).toEqual({ version: 1, createdAt: 100, id: 'schedule-b' });

    const changed = schedules.appendConfig('schedule-a', {
      config: configDraft(expert.id, expert.revision.id, { name: '新版月度复盘' }),
      expectedRevision: 1,
      updatedAt: 200,
    });
    expect(changed.schedule.currentConfigVersion).toBe(2);
    expect(changed.schedule.revision).toBe(2);
    expect(schedules.getConfig('schedule-a', 1)?.name).toBe(config.name);
    expect(schedules.getConfig('schedule-a', 2)?.name).toBe('新版月度复盘');
    expect(() =>
      schedules.appendConfig('schedule-a', {
        config,
        expectedRevision: 1,
        updatedAt: 300,
      }),
    ).toThrow('Schedule revision conflict');

    const secondPage = schedules.list({ limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.items.map((item) => item.schedule.id)).toEqual(['schedule-a']);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it('rejects an ExpertRevision that belongs to another Expert', () => {
    const { schedules, workspace, experts, config } = openFixtures();
    const otherExpert = experts.create({
      sourceKind: 'user',
      revision: expertDraft('另一位专家'),
    });
    expect(() =>
      schedules.create({
        id: 'schedule-cross-expert',
        workspaceId: workspace.id,
        config: { ...config, expertRevisionId: otherExpert.revision.id },
        createdAt: 1,
      }),
    ).toThrow('Expert revision does not belong to Expert');
    expect(schedules.get('schedule-cross-expert')).toBeUndefined();
  });

  it('is assembled on AppStore for the migrated application database', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    expect(store.schedules).toBeInstanceOf(ScheduleRepository);
    expect(store.scheduleOccurrences).toBeInstanceOf(ScheduleOccurrenceRepository);
  });
});

describe('ScheduleOccurrenceRepository', () => {
  it('releases a Schedule for another period as soon as its first Run reaches a terminal state', () => {
    const { db, workspace, occurrences, createSchedule } = openFixtures();
    createSchedule('schedule-terminal-release');
    db.prepare(
      `INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at)
       VALUES ('terminal-task', ?, '合成 Task', '合成要求', 1, 1)`,
    ).run(workspace.id);
    db.prepare('INSERT INTO sessions (id, task_id, created_at) VALUES (?, ?, ?)').run(
      'terminal-session',
      'terminal-task',
      1,
    );
    const first = occurrences.claimManual({
      scheduleId: 'schedule-terminal-release',
      trigger: 'manual-now',
      requestKey: 'terminal-first',
      requestedAt: 2,
      period: previousMonth(2, 0),
    });
    expect(first.kind).toBe('created');
    if (first.kind !== 'created') return;
    const sources = new ScheduleSourceRepository(db);
    const source = sources.createPreparing({
      occurrenceId: first.occurrence.id,
      evaluatedAt: 3,
      createdAt: 3,
    });
    sources.publishReady({
      snapshotId: source.id,
      items: [],
      totalFileBytes: 0,
      manifestHash: scheduleSourceManifestHash([]),
      completedAt: 4,
    });
    occurrences.attachSourceSnapshot(first.occurrence.id, source.id);
    db.prepare(
      `INSERT INTO runs (id, task_id, session_id, prompt, status, created_at, completed_at)
       VALUES ('terminal-run', 'terminal-task', 'terminal-session', '合成要求', 'running', 5, NULL)`,
    ).run();
    db.prepare(
      `UPDATE schedule_occurrences
          SET task_id = 'terminal-task', session_id = 'terminal-session', prepared_at = 5,
              phase = 'dispatched', first_run_id = 'terminal-run'
        WHERE id = ?`,
    ).run(first.occurrence.id);

    const whileRunning = occurrences.claimManual({
      scheduleId: 'schedule-terminal-release',
      trigger: 'manual-now',
      requestKey: 'terminal-second',
      requestedAt: 6,
      period: previousMonth(6, 0),
    });
    expect(whileRunning).toEqual({ kind: 'busy', existingOccurrenceId: first.occurrence.id });

    db.prepare(
      "UPDATE runs SET status = 'failed', completed_at = 7 WHERE id = 'terminal-run'",
    ).run();
    const afterTerminal = occurrences.claimManual({
      scheduleId: 'schedule-terminal-release',
      trigger: 'manual-now',
      requestKey: 'terminal-second',
      requestedAt: 8,
      period: previousMonth(8, 0),
    });

    expect(afterTerminal.kind).toBe('created');
  });

  it('retains the T3 draft when recovery closes an occurrence before T4', () => {
    const { db, workspace, occurrences, createSchedule } = openFixtures();
    createSchedule('schedule-t3-recovery');
    db.prepare(
      `INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at)
       VALUES ('task-t3', ?, '合成草稿', '中断后保留', 1, 1)`,
    ).run(workspace.id);
    db.prepare('INSERT INTO sessions (id, task_id, created_at) VALUES (?, ?, ?)').run(
      'session-t3',
      'task-t3',
      1,
    );
    const claim = occurrences.claimManual({
      scheduleId: 'schedule-t3-recovery',
      trigger: 'manual-now',
      requestKey: 't3-recovery-request',
      requestedAt: 2,
      period: previousMonth(2, 0),
    });
    expect(claim.kind).toBe('created');
    if (claim.kind !== 'created') return;
    const sources = new ScheduleSourceRepository(db);
    const source = sources.createPreparing({
      occurrenceId: claim.occurrence.id,
      evaluatedAt: 3,
      createdAt: 3,
    });
    sources.publishReady({
      snapshotId: source.id,
      items: [],
      totalFileBytes: 0,
      manifestHash: scheduleSourceManifestHash([]),
      completedAt: 4,
    });
    occurrences.attachSourceSnapshot(claim.occurrence.id, source.id);
    db.prepare(
      `UPDATE schedule_occurrences
       SET task_id = ?, session_id = ?, prepared_at = ? WHERE id = ?`,
    ).run('task-t3', 'session-t3', 5, claim.occurrence.id);

    const recovered = occurrences.closePreparation({
      occurrenceId: claim.occurrence.id,
      outcome: 'interrupted-before-run',
      finishedAt: 6,
    });
    expect(recovered).toMatchObject({
      phase: 'closed',
      preparationOutcome: 'interrupted-before-run',
      taskId: 'task-t3',
      sessionId: 'session-t3',
      sourceSnapshotId: source.id,
      preparedAt: 5,
      finishedAt: 6,
    });
  });

  it('claims the automatic key once, independent of configVersion, and advances the cursor atomically', () => {
    const { db, schedules, occurrences, config, expert, createSchedule } = openFixtures();
    createSchedule('schedule-auto');
    enableAt(db, 'schedule-auto', 1_000);

    const input = {
      scheduleId: 'schedule-auto',
      scheduledAt: 1_000,
      requestedAt: 1_001,
      period: previousMonth(1_000, 0),
      nextScheduledAt: 2_000,
    };
    const first = occurrences.claimScheduled(input);
    expect(first.kind).toBe('created');
    if (first.kind !== 'created') return;
    expect(first.occurrence.configVersion).toBe(1);
    expect(schedules.get('schedule-auto')?.schedule.nextScheduledAt).toBe(2_000);

    const duplicate = occurrences.claimScheduled(input);
    expect(duplicate.kind).toBe('existing');
    if (duplicate.kind !== 'existing') return;
    expect(duplicate.occurrence.id).toBe(first.occurrence.id);

    schedules.appendConfig('schedule-auto', {
      config: configDraft(expert.id, expert.revision.id, { name: `${config.name} 新版` }),
      expectedRevision: 1,
      updatedAt: 1_500,
    });
    db.prepare(
      `UPDATE schedules
       SET enabled_config_version = 2, next_scheduled_at = 1000
       WHERE id = 'schedule-auto'`,
    ).run();
    const changedVersionDuplicate = occurrences.claimScheduled(input);
    expect(changedVersionDuplicate.kind).toBe('existing');
    if (changedVersionDuplicate.kind !== 'existing') return;
    expect(changedVersionDuplicate.occurrence.id).toBe(first.occurrence.id);
    expect(changedVersionDuplicate.occurrence.configVersion).toBe(1);
    expect(
      db
        .prepare(
          `SELECT count(*) AS count FROM schedule_occurrences
         WHERE schedule_id = 'schedule-auto' AND scheduled_at = 1000`,
        )
        .get(),
    ).toMatchObject({ count: 1 });
  });

  it('rolls back the inserted occurrence when cursor advancement fails', () => {
    const { db, occurrences, createSchedule } = openFixtures();
    createSchedule('schedule-rollback');
    enableAt(db, 'schedule-rollback', 1_000);
    db.exec(`
      CREATE TRIGGER fail_schedule_cursor BEFORE UPDATE OF next_scheduled_at ON schedules
      BEGIN SELECT RAISE(ABORT, 'synthetic cursor failure'); END;
    `);

    expect(() =>
      occurrences.claimScheduled({
        scheduleId: 'schedule-rollback',
        scheduledAt: 1_000,
        requestedAt: 1_001,
        period: previousMonth(1_000, 0),
        nextScheduledAt: 2_000,
      }),
    ).toThrow('synthetic cursor failure');
    expect(db.prepare('SELECT count(*) AS count FROM schedule_occurrences').get()).toMatchObject({
      count: 0,
    });
    expect(
      db.prepare('SELECT next_scheduled_at FROM schedules WHERE id = ?').get('schedule-rollback'),
    ).toMatchObject({ next_scheduled_at: 1_000 });
  });

  it('returns a repeated manual request, reports a busy rule, and links manual recovery to the missed period', () => {
    const { db, occurrences, createSchedule } = openFixtures();
    createSchedule('schedule-manual');
    const manualInput = {
      scheduleId: 'schedule-manual',
      trigger: 'manual-now' as const,
      requestKey: 'manual-request-1',
      requestedAt: 2_000,
      period: previousMonth(2_000, 0),
    };
    const first = occurrences.claimManual(manualInput);
    expect(first.kind).toBe('created');
    if (first.kind !== 'created') return;
    const duplicate = occurrences.claimManual({
      ...manualInput,
      requestedAt: 2_500,
      period: previousMonth(2_500, 1),
    });
    expect(duplicate.kind).toBe('existing');
    if (duplicate.kind !== 'existing') return;
    expect(duplicate.occurrence.id).toBe(first.occurrence.id);
    expect(() =>
      occurrences.claimManual({
        scheduleId: 'schedule-manual',
        trigger: 'manual-missed',
        requestKey: manualInput.requestKey,
        requestedAt: 2_550,
        originalOccurrenceId: 'different-trigger',
      }),
    ).toThrow('Schedule request key belongs to a different trigger');

    const secondRequest = occurrences.claimManual({
      ...manualInput,
      requestKey: 'manual-request-2',
      requestedAt: 2_600,
    });
    expect(secondRequest).toEqual({ kind: 'busy', existingOccurrenceId: first.occurrence.id });
    occurrences.closePreparation({
      occurrenceId: first.occurrence.id,
      outcome: 'cancelled',
      finishedAt: 2_700,
    });
    const closedDuplicate = occurrences.claimManual({ ...manualInput, requestedAt: 2_750 });
    expect(closedDuplicate.kind).toBe('existing');
    if (closedDuplicate.kind !== 'existing') return;
    expect(closedDuplicate.occurrence.id).toBe(first.occurrence.id);
    expect(() =>
      occurrences.closePreparation({
        occurrenceId: first.occurrence.id,
        outcome: 'blocked',
        finishedAt: 2_800,
      }),
    ).toThrow('cannot close from phase closed');
    const retrySecondRequest = occurrences.claimManual({
      ...manualInput,
      requestKey: 'manual-request-2',
      requestedAt: 2_900,
    });
    expect(retrySecondRequest.kind).toBe('created');
    if (retrySecondRequest.kind !== 'created') return;

    enableAt(db, 'schedule-manual', 3_000);
    const missed = occurrences.claimScheduled({
      scheduleId: 'schedule-manual',
      scheduledAt: 3_000,
      requestedAt: 3_001,
      period: previousMonth(3_000, 2),
      nextScheduledAt: 4_000,
    });
    expect(missed.kind).toBe('skipped-overlap');
    if (missed.kind !== 'skipped-overlap') return;
    expect(missed.occurrence.preparationOutcome).toBe('skipped-overlap');
    occurrences.closePreparation({
      occurrenceId: retrySecondRequest.occurrence.id,
      outcome: 'cancelled',
      finishedAt: 3_500,
    });
    const originalMissed = occurrences.claimScheduled({
      scheduleId: 'schedule-manual',
      scheduledAt: 4_000,
      requestedAt: 4_001,
      period: previousMonth(4_000, 3),
      nextScheduledAt: 5_000,
    });
    expect(originalMissed.kind).toBe('created');
    if (originalMissed.kind !== 'created') return;
    const recordedMissed = occurrences.closePreparation({
      occurrenceId: originalMissed.occurrence.id,
      outcome: 'missed',
      finishedAt: 4_100,
    });
    const manualMissed = occurrences.claimManual({
      scheduleId: 'schedule-manual',
      trigger: 'manual-missed',
      requestKey: 'manual-missed-1',
      requestedAt: 4_200,
      originalOccurrenceId: recordedMissed.id,
    });
    expect(manualMissed.kind).toBe('created');
    if (manualMissed.kind !== 'created') return;
    expect(manualMissed.occurrence.originalOccurrenceId).toBe(recordedMissed.id);
    expect(manualMissed.occurrence.period).toEqual(recordedMissed.period);
  });

  it('keeps six monthly occurrences in one Workspace and pages the full history stably', () => {
    const { db, workspace, occurrences, createSchedule } = openFixtures();
    createSchedule('schedule-six-months');
    const firstScheduledAt = Date.UTC(2026, 0, 5, 1);
    enableAt(db, 'schedule-six-months', firstScheduledAt);

    for (let month = 0; month < 6; month += 1) {
      const scheduledAt = Date.UTC(2026, month, 5, 1);
      const nextScheduledAt = Date.UTC(2026, month + 1, 5, 1);
      const claimed = occurrences.claimScheduled({
        scheduleId: 'schedule-six-months',
        scheduledAt,
        requestedAt: scheduledAt + 1,
        period: previousMonth(scheduledAt, month),
        nextScheduledAt,
      });
      expect(claimed.kind).toBe('created');
      if (claimed.kind !== 'created') continue;
      occurrences.closePreparation({
        occurrenceId: claimed.occurrence.id,
        outcome: 'missed',
        finishedAt: scheduledAt + 2,
      });
    }

    const linked = db
      .prepare(
        `SELECT o.id, s.workspace_id
         FROM schedule_occurrences o JOIN schedules s ON s.id = o.schedule_id
         WHERE o.schedule_id = ? ORDER BY o.created_at ASC, o.id ASC`,
      )
      .all('schedule-six-months') as { id: string; workspace_id: string }[];
    expect(linked).toHaveLength(6);
    expect(new Set(linked.map((row) => row.workspace_id))).toEqual(new Set([workspace.id]));

    const ids: string[] = [];
    let page = occurrences.listBySchedule({ scheduleId: 'schedule-six-months', limit: 2 });
    while (true) {
      ids.push(...page.items.map((item) => item.id));
      if (!page.nextCursor) break;
      page = occurrences.listBySchedule({
        scheduleId: 'schedule-six-months',
        limit: 2,
        cursor: page.nextCursor,
      });
    }
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toEqual(linked.map((row) => row.id).reverse());
  });
});
