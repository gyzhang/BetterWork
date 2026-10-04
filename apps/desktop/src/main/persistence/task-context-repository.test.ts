import type { CreatedTask } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore, scheduleSourceManifestHash, ScheduleSourceRepositoryError } from './index';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};
const taskOf = (store: AppStore): CreatedTask => {
  const workspace = store.workspaces.getOrCreate('/tmp/task-context', '上下文测试');
  return store.tasks.create(workspace.id, '上下文任务', '验证上下文修订');
};

const scheduleSourceForTask = (
  store: AppStore,
  task: CreatedTask,
  status: 'ready' | 'preparing' = 'ready',
): string => {
  const workspaceId = store.tasks.getWorkspaceId(task.task.id);
  if (!workspaceId) throw new Error('Fixture Task has no Workspace');
  const expert = store.experts.create({
    sourceKind: 'user',
    revision: {
      name: '定时测试专家',
      summary: '',
      author: '',
      tags: [],
      identity: '生成定时材料测试',
      principles: [],
      inputRequirements: [],
      deliveryRequirements: [],
      skillPreset: [],
      builtinToolPolicy: { mode: 'application-defaults' },
      modelReference: { mode: 'application-default' },
    },
  });
  const schedule = store.schedules.create({
    workspaceId,
    createdAt: 1,
    config: {
      name: '定时材料测试',
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
      requirements: '合成测试',
      expectedArtifactTypes: ['markdown'],
      timing: { frequency: 'daily', hour: 9, minute: 0, timeZone: 'UTC' },
      periodRule: 'none',
      knowledgeSources: [],
      outputSubdirectory: '定时成果',
    },
  });
  const claim = store.scheduleOccurrences.claimManual({
    scheduleId: schedule.schedule.id,
    trigger: 'manual-now',
    requestKey: `context-${task.task.id}`,
    requestedAt: 2,
    period: { rule: 'none', timeZone: 'UTC', anchorAt: 2, label: '无指定期间' },
  });
  if (claim.kind !== 'created') throw new Error('Fixture occurrence was not created');
  const source = store.scheduleSources.createPreparing({
    occurrenceId: claim.occurrence.id,
    evaluatedAt: 3,
    createdAt: 3,
  });
  if (status === 'ready') {
    store.scheduleSources.publishReady({
      snapshotId: source.id,
      items: [],
      totalFileBytes: 0,
      manifestHash: scheduleSourceManifestHash([]),
      completedAt: 4,
    });
  }
  store.scheduleOccurrences.attachSourceSnapshot(claim.occurrence.id, source.id);
  if (status === 'ready') {
    const db = (store as unknown as { db: Database.Database }).db;
    db.prepare(
      `UPDATE schedule_occurrences
         SET task_id = ?, session_id = ?, prepared_at = ?
       WHERE id = ?`,
    ).run(task.task.id, task.sessionId, 5, claim.occurrence.id);
  }
  return source.id;
};

const sourceErrorCode = (action: () => void): string | undefined => {
  try {
    action();
  } catch (error) {
    if (error instanceof ScheduleSourceRepositoryError) return error.code;
    throw error;
  }
  return undefined;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('TaskContextRepository', () => {
  it('persists ordered bindings and uses compare-and-swap revisions', () => {
    const store = openStore();
    const task = taskOf(store);
    const first = store.taskContexts.save(task.task.id, {
      executor: { kind: 'general' },
      skillBindings: [
        { skillId: 'skill-a', revisionId: 'revision-a', source: 'task-selection' },
        { skillId: 'skill-b', revisionId: 'revision-b', source: 'task-selection' },
      ],
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['calculator'] },
    });
    expect(first.revision).toBe(1);
    expect(
      store.taskContexts.get(first.id, task.task.id)?.skillBindings.map((item) => item.skillId),
    ).toEqual(['skill-a', 'skill-b']);
    expect(() =>
      store.taskContexts.save(
        task.task.id,
        { executor: { kind: 'general' }, skillBindings: [] },
        0,
      ),
    ).toThrow('Task context revision conflict');
  });

  it('rejects an expected revision when the task has no context yet', () => {
    const store = openStore();
    const task = taskOf(store);

    expect(() =>
      store.taskContexts.save(
        task.task.id,
        { executor: { kind: 'general' }, skillBindings: [] },
        1,
      ),
    ).toThrow('Task context revision conflict: expected 1, current 0');
    expect(store.taskContexts.getLatest(task.task.id)).toBeUndefined();
  });

  it('does not resolve a context revision from another task', () => {
    const store = openStore();
    const first = taskOf(store);
    const second = store.tasks.create(
      store.tasks.getWorkspaceId(first.task.id) ?? 'missing',
      '另一个任务',
      '隔离',
    );
    const context = store.taskContexts.save(first.task.id, {
      executor: { kind: 'general' },
      skillBindings: [],
    });
    expect(store.taskContexts.get(context.id, second.task.id)).toBeUndefined();
  });

  it('rejects duplicate Skill bindings before writing a revision', () => {
    const store = openStore();
    const task = taskOf(store);
    expect(() =>
      store.taskContexts.save(task.task.id, {
        executor: { kind: 'general' },
        skillBindings: [
          { skillId: 'skill-a', revisionId: 'revision-a', source: 'task-selection' },
          { skillId: 'skill-a', revisionId: 'revision-b', source: 'expert-preset' },
        ],
      }),
    ).toThrow('Task context skill bindings must not repeat a skill');
    expect(store.taskContexts.getLatest(task.task.id)).toBeUndefined();
  });

  it('rejects duplicate MCP bindings before writing a revision', () => {
    const store = openStore();
    const task = taskOf(store);
    expect(() =>
      store.taskContexts.save(task.task.id, {
        executor: { kind: 'general' },
        skillBindings: [],
        mcpToolBindings: [
          { connectionId: 'finance', toolId: 'finance/monthly_summary' },
          { connectionId: 'finance', toolId: 'finance/monthly_summary' },
        ],
      }),
    ).toThrow('Task context MCP bindings must not repeat a tool');
    expect(store.taskContexts.getLatest(task.task.id)).toBeUndefined();
  });

  it('persists exact material references and their purpose with the draft', () => {
    const store = openStore();
    const task = taskOf(store);
    const saved = store.taskContexts.save(task.task.id, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [
        {
          reference: {
            kind: 'knowledge-revision',
            knowledgeDocumentId: 'document-1',
            knowledgeRevisionId: 'revision-1',
            contentHash: 'hash-1',
            sourcePath: '/tmp/rules.md',
          },
          purpose: 'rule',
          note: '财务指标口径',
          addedFrom: 'global-search',
        },
      ],
    });
    expect(saved.materials).toEqual([
      expect.objectContaining({
        purpose: 'rule',
        note: '财务指标口径',
        reference: expect.objectContaining({ knowledgeRevisionId: 'revision-1' }),
      }),
    ]);
    expect(store.taskContexts.get(saved.id, task.task.id)?.materials).toEqual(saved.materials);
  });

  it('preserves Schedule scope when absent and removes it only when null is explicit', () => {
    const store = openStore();
    const task = taskOf(store);
    const sourceSnapshotId = scheduleSourceForTask(store, task);
    const save = (scheduleSourceSnapshotId?: string | null) =>
      store.taskContexts.save(task.task.id, {
        executor: { kind: 'general' },
        skillBindings: [],
        ...(scheduleSourceSnapshotId === undefined ? {} : { scheduleSourceSnapshotId }),
      });

    const bound = save(sourceSnapshotId);
    expect(bound.scheduleSourceSnapshotId).toBe(sourceSnapshotId);
    expect(save().scheduleSourceSnapshotId).toBe(sourceSnapshotId);
    expect(save(null).scheduleSourceSnapshotId).toBeUndefined();
    expect(save().scheduleSourceSnapshotId).toBeUndefined();
  });

  it('rejects forged, unready, and another Task Schedule source IDs before saving', () => {
    const store = openStore();
    const first = taskOf(store);
    const workspaceId = store.tasks.getWorkspaceId(first.task.id);
    if (!workspaceId) throw new Error('Fixture Task has no Workspace');
    const second = store.tasks.create(workspaceId, '另一个定时任务', '验证范围绑定');
    const sourceSnapshotId = scheduleSourceForTask(store, first);
    const preparingSourceId = scheduleSourceForTask(store, second, 'preparing');
    const input = (id: string) => ({
      executor: { kind: 'general' as const },
      skillBindings: [],
      scheduleSourceSnapshotId: id,
    });

    expect(
      sourceErrorCode(() => store.taskContexts.save(first.task.id, input('forged-source-id'))),
    ).toBe('schedule_source_missing');
    expect(
      sourceErrorCode(() => store.taskContexts.save(second.task.id, input(sourceSnapshotId))),
    ).toBe('schedule_source_conflict');
    expect(
      sourceErrorCode(() => store.taskContexts.save(second.task.id, input(preparingSourceId))),
    ).toBe('schedule_source_missing');
    expect(store.taskContexts.getLatest(first.task.id)).toBeUndefined();
    expect(store.taskContexts.getLatest(second.task.id)).toBeUndefined();
  });
});
