import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { TaskContinuityBrief } from '@betterwork/agent-protocol';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { TaskContinuityService } from '../services/task-continuity-service';
import { AppStore } from './index';
import {
  TaskContinuityError,
  TaskContinuityRevisionConflictError,
} from './task-continuity-repository';

interface Harness {
  directory: string;
  filePath: string;
  store: AppStore;
}

const harnesses: Harness[] = [];
const stores: AppStore[] = [];

const openHarness = (): Harness => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-task-continuity-'));
  const filePath = path.join(directory, 'app.sqlite');
  const store = AppStore.open(filePath);
  const harness = { directory, filePath, store };
  harnesses.push(harness);
  stores.push(store);
  return harness;
};

const closeStore = (store: AppStore): void => {
  store.close();
  const index = stores.indexOf(store);
  if (index >= 0) stores.splice(index, 1);
};

const createTask = (harness: Harness, title: string, goal: string) => {
  const workspace = harness.store.workspaces.getOrCreate(`/tmp/${title}`, title);
  return new TaskContinuityService(harness.store).createTask(workspace.id, title, goal);
};

const userEditedBrief = (text: string): TaskContinuityBrief => ({
  schemaVersion: 1,
  objective: { text, source: 'user-edit' },
  activeRequirements: [],
});

const assistantBrief = (sourceRunId: string): TaskContinuityBrief => ({
  schemaVersion: 1,
  objective: { text: '完成持续分析', source: 'task-goal' },
  activeRequirements: [],
  progress: {
    authoredBy: 'assistant-summary',
    status: 'blocked',
    completedActions: ['确认本轮数据范围'],
    blockers: ['等待补充期间收入'],
    artifactVersionIds: [],
    sourceRunId,
    sourcePromptHash: 'a'.repeat(64),
  },
});

const continuityErrorOf = (action: () => unknown): TaskContinuityError => {
  try {
    action();
  } catch (error) {
    if (error instanceof TaskContinuityError) return error;
    throw error;
  }
  throw new Error('Expected TaskContinuityError');
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const harness of harnesses.splice(0)) {
    rmSync(harness.directory, { recursive: true, force: true });
  }
});

describe('TaskContinuityRepository (TC01)', () => {
  it('restores the latest revision from SQLite after reopening the application database', () => {
    const harness = openHarness();
    const created = createTask(harness, '季度分析', '请完成季度经营分析');
    const initial = harness.store.taskContinuity.getLatest(created.task.id);
    if (!initial) throw new Error('New Task is missing its initial continuity revision');
    const saved = harness.store.taskContinuity.append({
      taskId: created.task.id,
      expectedRevision: initial.revision,
      brief: userEditedBrief('请完成季度经营分析并重点说明现金流。'),
      sourceKind: 'user-edit',
      at: 10,
    });
    closeStore(harness.store);

    const reopened = AppStore.open(harness.filePath);
    stores.push(reopened);
    expect(reopened.taskContinuity.getLatest(created.task.id)).toEqual(saved);
    expect(reopened.taskContinuity.getRevision(created.task.id, 1)).toEqual(initial);
  });

  it('appends monotonically with expectedRevision CAS and reports stale writers', () => {
    const harness = openHarness();
    const created = createTask(harness, 'CAS 测试', '目标一');
    const first = harness.store.taskContinuity.getLatest(created.task.id);
    if (!first) throw new Error('New Task is missing its initial continuity revision');
    const second = harness.store.taskContinuity.append({
      taskId: created.task.id,
      expectedRevision: first.revision,
      brief: userEditedBrief('目标二'),
      sourceKind: 'user-edit',
      at: 20,
    });

    expect(second.revision).toBe(first.revision + 1);
    expect(() =>
      harness.store.taskContinuity.append({
        taskId: created.task.id,
        expectedRevision: first.revision,
        brief: userEditedBrief('旧写入不应覆盖目标二'),
        sourceKind: 'user-edit',
        at: 30,
      }),
    ).toThrow(TaskContinuityRevisionConflictError);
    expect(harness.store.taskContinuity.getLatest(created.task.id)).toEqual(second);
  });

  it('enforces Task/Run ownership and makes duplicate Task/Run writes idempotent', () => {
    const harness = openHarness();
    const firstTask = createTask(harness, '来源任务', '完成持续分析');
    const secondTask = createTask(harness, '其他任务', '独立目标');
    harness.store.runs.create({
      id: 'tc-source-run',
      taskId: firstTask.task.id,
      sessionId: firstTask.sessionId,
      prompt: '检查本期现金流',
      status: 'failed',
      createdAt: 1,
      completedAt: 2,
    });
    const brief = assistantBrief('tc-source-run');
    const first = harness.store.taskContinuity.append({
      taskId: firstTask.task.id,
      expectedRevision: 1,
      brief,
      sourceKind: 'assistant-summary',
      sourceRunId: 'tc-source-run',
      at: 3,
    });
    const retry = harness.store.taskContinuity.append({
      taskId: firstTask.task.id,
      expectedRevision: 1,
      brief,
      sourceKind: 'assistant-summary',
      sourceRunId: 'tc-source-run',
      at: 4,
    });

    expect(retry).toEqual(first);
    const userEdit = harness.store.taskContinuity.append({
      taskId: firstTask.task.id,
      expectedRevision: 2,
      brief: {
        ...brief,
        objective: { text: '补充现金流分析', source: 'user-edit', sourceRunId: 'tc-source-run' },
        progress: {
          authoredBy: 'user-edit',
          status: 'blocked',
          completedActions: ['确认本轮数据范围'],
          blockers: ['等待补充期间收入'],
          artifactVersionIds: [],
          sourceRunId: 'tc-source-run',
          sourcePromptHash: 'a'.repeat(64),
        },
      },
      sourceKind: 'user-edit',
      sourceRunId: 'tc-source-run',
      at: 5,
    });
    expect(userEdit.revision).toBe(3);
    expect(
      continuityErrorOf(() =>
        harness.store.taskContinuity.append({
          taskId: firstTask.task.id,
          expectedRevision: 1,
          brief: {
            ...brief,
            progress: {
              authoredBy: 'assistant-summary',
              status: 'blocked',
              completedActions: ['确认本轮数据范围'],
              blockers: ['改动后不能复用相同幂等键'],
              artifactVersionIds: [],
              sourceRunId: 'tc-source-run',
              sourcePromptHash: 'a'.repeat(64),
            },
          },
          sourceKind: 'assistant-summary',
          sourceRunId: 'tc-source-run',
        }),
      ).code,
    ).toBe('revision-idempotency-conflict');
    expect(
      continuityErrorOf(() =>
        harness.store.taskContinuity.append({
          taskId: secondTask.task.id,
          expectedRevision: 1,
          brief: {
            schemaVersion: 1,
            objective: { text: '独立目标', source: 'task-goal' },
            activeRequirements: [
              {
                id: 'foreign-run-requirement',
                text: '不可引用另一个 Task 的 Run',
                authoredBy: 'assistant-summary',
                sources: [{ runId: 'tc-source-run', promptHash: 'a'.repeat(64) }],
              },
            ],
          },
          sourceKind: 'user-edit',
        }),
      ).code,
    ).toBe('run-task-mismatch');

    const raw = new Database(harness.filePath);
    raw.pragma('foreign_keys = ON');
    const firstJson = JSON.stringify(first.brief);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO task_continuity_revisions (
             id, task_id, revision, schema_version, brief_json, source_kind,
             source_run_id, brief_hash, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'cross-task-run-row',
          secondTask.task.id,
          2,
          1,
          firstJson,
          'assistant-summary',
          'tc-source-run',
          first.briefHash,
          5,
        ),
    ).toThrow(/FOREIGN KEY constraint failed/iu);
    raw.close();
  });

  it('rejects syntactically valid but malformed or hash-mismatched JSON when reading SQLite', () => {
    const harness = openHarness();
    const malformedTask = createTask(harness, '损坏 JSON', '目标一');
    const invalidSchemaTask = createTask(harness, '损坏枚举', '目标二');
    const hashMismatchTask = createTask(harness, '损坏 hash', '目标三');
    const raw = new Database(harness.filePath);
    raw.pragma('ignore_check_constraints = ON');
    raw.exec('DROP TRIGGER task_continuity_revisions_are_immutable');
    raw
      .prepare('UPDATE task_continuity_revisions SET brief_json = ? WHERE task_id = ?')
      .run('{', malformedTask.task.id);
    raw.prepare('UPDATE task_continuity_revisions SET brief_json = ? WHERE task_id = ?').run(
      JSON.stringify({
        schemaVersion: 1,
        objective: { text: '目标二', source: 'unknown-source' },
        activeRequirements: [],
      }),
      invalidSchemaTask.task.id,
    );
    raw.prepare('UPDATE task_continuity_revisions SET brief_json = ? WHERE task_id = ?').run(
      JSON.stringify({
        schemaVersion: 1,
        objective: { text: '被改写的目标', source: 'task-goal' },
        activeRequirements: [],
      }),
      hashMismatchTask.task.id,
    );
    raw.close();

    expect(
      continuityErrorOf(() => harness.store.taskContinuity.getLatest(malformedTask.task.id)),
    ).toMatchObject({ code: 'corrupt-data' });
    expect(
      continuityErrorOf(() => harness.store.taskContinuity.getLatest(invalidSchemaTask.task.id)),
    ).toMatchObject({ code: 'corrupt-data' });
    expect(
      continuityErrorOf(() => harness.store.taskContinuity.getLatest(hashMismatchTask.task.id)),
    ).toMatchObject({ code: 'corrupt-data' });
  });

  it('relies on SQLite uniqueness, enum, JSON and foreign-key constraints for persisted revisions', () => {
    const harness = openHarness();
    const created = createTask(harness, '结构约束', '持久化约束样本');
    const revision = harness.store.taskContinuity.getLatest(created.task.id);
    if (!revision) throw new Error('New Task is missing its initial continuity revision');
    const raw = new Database(harness.filePath);
    raw.pragma('foreign_keys = ON');
    expect(() =>
      raw
        .prepare('UPDATE task_continuity_revisions SET created_at = ? WHERE id = ?')
        .run(revision.createdAt + 1, revision.id),
    ).toThrow(/append-only/iu);
    const insert = raw.prepare(
      `INSERT INTO task_continuity_revisions (
         id, task_id, revision, schema_version, brief_json, source_kind,
         source_run_id, brief_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    expect(() =>
      insert.run(
        'duplicate-task-revision',
        created.task.id,
        revision.revision,
        1,
        JSON.stringify(revision.brief),
        'user-edit',
        null,
        revision.briefHash,
        4,
      ),
    ).toThrow(/UNIQUE constraint failed/iu);
    expect(() =>
      insert.run(
        'invalid-source-kind',
        created.task.id,
        2,
        1,
        JSON.stringify(revision.brief),
        'unknown-source',
        null,
        revision.briefHash,
        4,
      ),
    ).toThrow(/CHECK constraint failed/iu);
    expect(() =>
      insert.run(
        'invalid-json',
        created.task.id,
        2,
        1,
        '{',
        'user-edit',
        null,
        revision.briefHash,
        4,
      ),
    ).toThrow(/CHECK constraint failed/iu);
    expect(() =>
      insert.run(
        'orphan-task',
        'missing-task',
        1,
        1,
        JSON.stringify(revision.brief),
        'task-goal',
        null,
        revision.briefHash,
        4,
      ),
    ).toThrow(/FOREIGN KEY constraint failed/iu);
    raw.prepare('DELETE FROM tasks WHERE id = ?').run(created.task.id);
    expect(
      raw
        .prepare('SELECT COUNT(*) AS count FROM task_continuity_revisions WHERE task_id = ?')
        .get(created.task.id),
    ).toEqual({ count: 0 });
    raw.close();
  });

  it('constrains run snapshots to one matching Task, Run and continuity revision', () => {
    const harness = openHarness();
    const firstTask = createTask(harness, '快照归属一', '目标一');
    const secondTask = createTask(harness, '快照归属二', '目标二');
    harness.store.runs.create({
      id: 'tc-context-run-1',
      taskId: firstTask.task.id,
      sessionId: firstTask.sessionId,
      prompt: '合成 prompt 一',
      status: 'failed',
      createdAt: 1,
      completedAt: 2,
    });
    harness.store.runs.create({
      id: 'tc-context-run-2',
      taskId: firstTask.task.id,
      sessionId: firstTask.sessionId,
      prompt: '合成 prompt 二',
      status: 'cancelled',
      createdAt: 3,
      completedAt: 4,
    });
    const firstRevision = harness.store.taskContinuity.getLatest(firstTask.task.id);
    const secondRevision = harness.store.taskContinuity.getLatest(secondTask.task.id);
    if (!firstRevision || !secondRevision) {
      throw new Error('New Tasks are missing their initial continuity revisions');
    }
    const raw = new Database(harness.filePath);
    raw.pragma('foreign_keys = ON');
    const insert = raw.prepare(
      `INSERT INTO run_continuity_contexts (
         run_id, task_id, revision_id, schema_version, brief_json,
         brief_hash, prepared_at, first_provider_request_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const firstJson = JSON.stringify(firstRevision.brief);
    expect(() =>
      insert.run(
        'tc-context-run-1',
        secondTask.task.id,
        secondRevision.id,
        1,
        JSON.stringify(secondRevision.brief),
        secondRevision.briefHash,
        5,
        null,
      ),
    ).toThrow(/FOREIGN KEY constraint failed/iu);
    insert.run(
      'tc-context-run-1',
      firstTask.task.id,
      firstRevision.id,
      1,
      firstJson,
      firstRevision.briefHash,
      5,
      6,
    );
    expect(() =>
      insert.run(
        'tc-context-run-1',
        firstTask.task.id,
        firstRevision.id,
        1,
        firstJson,
        firstRevision.briefHash,
        5,
        null,
      ),
    ).toThrow(/UNIQUE constraint failed/iu);
    expect(() =>
      insert.run(
        'tc-context-run-2',
        firstTask.task.id,
        secondRevision.id,
        1,
        JSON.stringify(secondRevision.brief),
        secondRevision.briefHash,
        10,
        null,
      ),
    ).toThrow(/FOREIGN KEY constraint failed/iu);
    expect(() =>
      insert.run(
        'tc-context-run-2',
        firstTask.task.id,
        firstRevision.id,
        1,
        firstJson,
        firstRevision.briefHash,
        10,
        9,
      ),
    ).toThrow(/CHECK constraint failed/iu);
    raw.prepare('DELETE FROM tasks WHERE id = ?').run(firstTask.task.id);
    expect(
      raw
        .prepare('SELECT COUNT(*) AS count FROM run_continuity_contexts WHERE task_id = ?')
        .get(firstTask.task.id),
    ).toEqual({ count: 0 });
    expect(harness.store.taskContinuity.getLatest(secondTask.task.id)).toEqual(secondRevision);
    raw.close();
  });
});
