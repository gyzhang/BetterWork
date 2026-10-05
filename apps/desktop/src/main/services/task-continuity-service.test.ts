import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { TaskContinuityService } from './task-continuity-service';

interface Harness {
  directory: string;
  filePath: string;
  store: AppStore;
}

const harnesses: Harness[] = [];
const openHarness = (): Harness => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-task-continuity-service-'));
  const filePath = path.join(directory, 'app.sqlite');
  const harness = { directory, filePath, store: AppStore.open(filePath) };
  harnesses.push(harness);
  return harness;
};

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.store.close();
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

describe('TaskContinuityService (TC01)', () => {
  it('creates the Task, its first Session and goal-derived revision as one operation', () => {
    const harness = openHarness();
    const workspace = harness.store.workspaces.getOrCreate('/tmp/tc-service', 'TC service');
    const service = new TaskContinuityService(harness.store);
    const created = service.createTask(workspace.id, '季度复盘', '请分析本季度经营结果。');
    const revision = harness.store.taskContinuity.getLatest(created.task.id);

    expect(revision).toMatchObject({
      taskId: created.task.id,
      revision: 1,
      sourceKind: 'task-goal',
      brief: {
        schemaVersion: 1,
        objective: { text: created.task.goal, source: 'task-goal' },
        activeRequirements: [],
      },
    });
  });

  it('rolls back Task and Session if the initial continuity revision cannot be stored', () => {
    const harness = openHarness();
    const workspace = harness.store.workspaces.getOrCreate('/tmp/tc-rollback', 'TC rollback');
    const raw = new Database(harness.filePath);
    raw.exec(`
      CREATE TRIGGER reject_initial_continuity_revision
      BEFORE INSERT ON task_continuity_revisions
      BEGIN
        SELECT RAISE(ABORT, 'forced continuity insert failure');
      END;
    `);

    expect(() =>
      new TaskContinuityService(harness.store).createTask(
        workspace.id,
        '必须回滚的任务',
        '初始简报故障样本',
      ),
    ).toThrow(/forced continuity insert failure/iu);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 0 });
    expect(raw.prepare('SELECT COUNT(*) AS count FROM sessions').get()).toEqual({ count: 0 });
    expect(raw.prepare('SELECT COUNT(*) AS count FROM task_continuity_revisions').get()).toEqual({
      count: 0,
    });
    raw.close();
  });
});
