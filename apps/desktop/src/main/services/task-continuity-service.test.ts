import { createHash } from 'node:crypto';
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

  it('records an idempotent deterministic completed Run update and exact ArtifactVersions', () => {
    const harness = openHarness();
    const workspace = harness.store.workspaces.getOrCreate('/tmp/tc-progress', 'TC progress');
    const service = new TaskContinuityService(harness.store);
    const created = service.createTask(workspace.id, '持续分析', '请分析经营结果。');
    harness.store.runs.create({
      id: 'tc-progress-run',
      taskId: created.task.id,
      sessionId: created.sessionId,
      prompt: '整理本期经营结果',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });
    const artifact = harness.store.artifacts.saveMarkdown(
      {
        taskId: created.task.id,
        origin: 'assistant-run',
        runId: 'tc-progress-run',
        title: '本轮成果',
        content: '合成内容',
      },
      'model',
    );

    const first = service.recordCompletedRunProgress({
      taskId: created.task.id,
      runId: 'tc-progress-run',
      expectedRevision: 1,
    });
    const retry = service.recordCompletedRunProgress({
      taskId: created.task.id,
      runId: 'tc-progress-run',
      expectedRevision: 1,
    });

    expect(first).toEqual(retry);
    expect(first).toMatchObject({
      revision: 2,
      sourceKind: 'assistant-summary',
      sourceRunId: 'tc-progress-run',
      brief: {
        objective: { text: '请分析经营结果。', source: 'task-goal' },
        activeRequirements: [],
        progress: {
          authoredBy: 'assistant-summary',
          status: 'in-progress',
          completedActions: ['Run tc-progress-run 已进入 completed 终态。'],
          blockers: [],
          artifactVersionIds: [artifact.currentVersionId],
          sourceRunId: 'tc-progress-run',
          sourcePromptHash: createHash('sha256').update('整理本期经营结果').digest('hex'),
        },
      },
    });
  });

  it('preserves user-edited progress when a completed Run is recorded', () => {
    const harness = openHarness();
    const workspace = harness.store.workspaces.getOrCreate(
      '/tmp/tc-user-progress',
      'TC user progress',
    );
    const service = new TaskContinuityService(harness.store);
    const created = service.createTask(workspace.id, '持续分析', '请分析经营结果。');
    const initial = harness.store.taskContinuity.getLatest(created.task.id);
    if (!initial) throw new Error('New Task is missing its initial continuity revision');
    const edited = harness.store.taskContinuity.append({
      taskId: created.task.id,
      expectedRevision: initial.revision,
      sourceKind: 'user-edit',
      brief: {
        ...initial.brief,
        progress: {
          authoredBy: 'user-edit',
          status: 'awaiting-user',
          completedActions: [],
          blockers: ['等待用户确认下一步'],
          artifactVersionIds: [],
        },
      },
    });
    harness.store.runs.create({
      id: 'tc-user-progress-run',
      taskId: created.task.id,
      sessionId: created.sessionId,
      prompt: '继续分析',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });

    expect(
      service.recordCompletedRunProgress({
        taskId: created.task.id,
        runId: 'tc-user-progress-run',
        expectedRevision: edited.revision,
      }),
    ).toEqual(edited);
    expect(harness.store.taskContinuity.getLatest(created.task.id)).toEqual(edited);
  });

  it('saves user edits with CAS while preserving assistant source chains and supports clearing progress', () => {
    const harness = openHarness();
    const workspace = harness.store.workspaces.getOrCreate('/tmp/tc-user-edit', 'TC user edit');
    const service = new TaskContinuityService(harness.store);
    const created = service.createTask(workspace.id, '持续分析', '请分析经营结果。');
    harness.store.runs.create({
      id: 'tc-user-edit-run',
      taskId: created.task.id,
      sessionId: created.sessionId,
      prompt: '对照区域收入与费用',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });
    const artifact = harness.store.artifacts.saveMarkdown(
      {
        taskId: created.task.id,
        origin: 'assistant-run',
        runId: 'tc-user-edit-run',
        title: '区域分析',
        content: '合成内容',
      },
      'model',
    );
    const progressRevision = service.recordCompletedRunProgress({
      taskId: created.task.id,
      runId: 'tc-user-edit-run',
      expectedRevision: 1,
    });
    const promptHash = createHash('sha256').update('对照区域收入与费用').digest('hex');
    const withRequirement = harness.store.taskContinuity.append({
      taskId: created.task.id,
      expectedRevision: progressRevision.revision,
      sourceKind: 'user-edit',
      brief: {
        ...progressRevision.brief,
        activeRequirements: [
          {
            id: 'requirement-source',
            text: '比较区域收入',
            authoredBy: 'assistant-summary',
            sources: [{ runId: 'tc-user-edit-run', promptHash }],
          },
        ],
      },
    });

    const input = {
      taskId: created.task.id,
      expectedRevision: withRequirement.revision,
      objective: '完成区域经营复盘',
      activeRequirements: [{ id: 'requirement-source', text: '比较区域收入与费用' }],
      progress: {
        status: 'blocked' as const,
        completedActions: ['已核对登记成果'],
        nextAction: '补齐费用口径',
        blockers: ['等待财务确认'],
        artifactVersionIds: [artifact.currentVersionId],
      },
    };
    const saved = service.saveUserBrief(input);
    expect(saved.kind).toBe('saved');
    if (saved.kind !== 'saved') throw new Error('Expected user edit to save');
    expect(saved.revision).toMatchObject({
      revision: withRequirement.revision + 1,
      sourceKind: 'user-edit',
      brief: {
        objective: { text: '完成区域经营复盘', source: 'user-edit' },
        activeRequirements: [
          {
            id: 'requirement-source',
            text: '比较区域收入与费用',
            authoredBy: 'user-edit',
            sources: [{ runId: 'tc-user-edit-run', promptHash }],
          },
        ],
        progress: {
          authoredBy: 'user-edit',
          status: 'blocked',
          completedActions: ['已核对登记成果'],
          nextAction: '补齐费用口径',
          blockers: ['等待财务确认'],
          artifactVersionIds: [artifact.currentVersionId],
          sourceRunId: 'tc-user-edit-run',
          sourcePromptHash: promptHash,
        },
      },
    });

    expect(service.saveUserBrief({ ...input, expectedRevision: saved.revision.revision })).toEqual(
      saved,
    );
    expect(service.saveUserBrief({ ...input, objective: '过期草稿' })).toEqual({
      kind: 'conflict',
      currentRevision: saved.revision.revision,
    });

    const cleared = service.saveUserBrief({
      ...input,
      expectedRevision: saved.revision.revision,
      objective: saved.revision.brief.objective.text,
      activeRequirements: saved.revision.brief.activeRequirements.map(({ id, text }) => ({
        id,
        text,
      })),
      progress: null,
    });
    expect(cleared.kind).toBe('saved');
    if (cleared.kind !== 'saved') throw new Error('Expected progress to clear');
    expect(cleared.revision.brief.progress).toBeUndefined();
  });
});
