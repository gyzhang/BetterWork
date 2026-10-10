import type {
  MaterialReference,
  ScheduleSourceItem,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { mergeScheduleMaterials, ScheduleMaterialResolver } from './schedule-material-resolver';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const knowledgeReference = (
  knowledgeDocumentId: string,
  knowledgeRevisionId = 'revision-1',
  contentHash = HASH_A,
): MaterialReference => ({
  kind: 'knowledge-revision',
  knowledgeDocumentId,
  knowledgeRevisionId,
  contentHash,
  sourcePath: `/synthetic/${knowledgeDocumentId}.md`,
});

const selection = (
  reference: MaterialReference,
  purpose: TaskMaterialSelection['purpose'] = 'background',
): TaskMaterialSelection => ({
  reference,
  purpose,
  addedFrom: 'user-input',
});

const sourceItem = (
  reference: MaterialReference,
  ordinal: number,
  snapshotId = 'source-1',
): ScheduleSourceItem => ({
  snapshotId,
  ordinal,
  reference,
  purpose: 'rule',
  origin: 'selected-document',
  displayName: '合成来源.md',
});

const stores: AppStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('ScheduleMaterialResolver', () => {
  it('keeps the ordinary Task selection limit at 50 without silent truncation', () => {
    const materials = Array.from({ length: 50 }, (_unused, index) =>
      selection(knowledgeReference(`document-${index}`)),
    );
    expect(mergeScheduleMaterials([], materials)).toHaveLength(50);
    expect(() =>
      mergeScheduleMaterials([], [...materials, selection(knowledgeReference('document-50'))]),
    ).toThrow();
  });

  it('uses the same explicit 50 item limit for an ordinary Task through the resolver', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/schedule-material-resolver', '合成工作区');
    const task = store.tasks.create(workspace.id, '普通 Task', '保留现有限额');
    const resolver = new ScheduleMaterialResolver(store);
    const materials = Array.from({ length: 50 }, (_unused, index) =>
      selection(knowledgeReference(`ordinary-${index}`)),
    );

    expect(
      resolver.resolve({ taskId: task.task.id, workspaceId: workspace.id, materials }),
    ).toHaveLength(50);
    expect(() =>
      resolver.resolve({
        taskId: task.task.id,
        workspaceId: workspace.id,
        materials: [...materials, selection(knowledgeReference('ordinary-50'))],
      }),
    ).toThrow();
  });

  it('requires any provided Schedule snapshot ID to resolve, including an empty string', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate(
      '/tmp/schedule-material-empty-source',
      '合成工作区',
    );
    const task = store.tasks.create(workspace.id, '普通 Task', '拒绝伪造范围');
    const resolver = new ScheduleMaterialResolver(store);

    for (const scheduleSourceSnapshotId of ['forged-source-id', '']) {
      expect(() =>
        resolver.resolve({
          taskId: task.task.id,
          workspaceId: workspace.id,
          scheduleSourceSnapshotId,
          materials: [],
        }),
      ).toThrow('定时来源快照不存在。');
    }
  });

  it('preserves legacy knowledge references with optional origin metadata', () => {
    const reference = knowledgeReference('document-legacy');
    if (reference.kind !== 'knowledge-revision') throw new Error('Expected knowledge reference');
    const resolved = mergeScheduleMaterials(
      [sourceItem(reference, 0)],
      [selection({ ...reference, originWorkspaceId: 'origin' })],
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.source).toBe('schedule-and-supplement');
    expect(() =>
      mergeScheduleMaterials(
        [sourceItem(reference, 0)],
        [selection({ ...reference, sourcePath: '/forged.md' })],
      ),
    ).toThrow('不同修订或哈希');
  });

  it('merges an exact supplement without mutating the fixed Schedule manifest', () => {
    const reference = knowledgeReference('document-1');
    const sourceItems = [sourceItem(reference, 0)];
    const resolved = mergeScheduleMaterials(sourceItems, [selection(reference, 'current-input')]);

    expect(resolved).toEqual([
      expect.objectContaining({
        reference,
        purpose: 'current-input',
        source: 'schedule-and-supplement',
        scheduleOrigin: 'selected-document',
        selection: expect.objectContaining({ purpose: 'current-input' }),
      }),
    ]);
    expect(sourceItems[0]).toEqual(sourceItem(reference, 0));
  });

  it('rejects duplicate sources, duplicate supplements, and revision/hash conflicts', () => {
    const reference = knowledgeReference('document-1');
    expect(() =>
      mergeScheduleMaterials([sourceItem(reference, 0), sourceItem(reference, 1)], []),
    ).toThrow('定时来源快照包含重复材料身份');
    expect(() => mergeScheduleMaterials([], [selection(reference), selection(reference)])).toThrow(
      '显式补充材料重复',
    );
    expect(() =>
      mergeScheduleMaterials(
        [sourceItem(reference, 0)],
        [selection(knowledgeReference('document-1', 'revision-2', HASH_B))],
      ),
    ).toThrow('不同修订或哈希');
  });

  it('bounds effective materials at 2,000 while including explicit additions', () => {
    const sourceItems = Array.from({ length: 2_000 }, (_unused, index) =>
      sourceItem(knowledgeReference(`source-${index}`), index),
    );
    expect(mergeScheduleMaterials(sourceItems, [])).toHaveLength(2_000);
    expect(() =>
      mergeScheduleMaterials(sourceItems, [selection(knowledgeReference('one-more-source'))]),
    ).toThrow('本期有效材料超过 2000 项');
  });
});
