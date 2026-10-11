import { materialListIdentity, type MaterialReference } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import {
  legacyMaterialAvailability,
  seedHistoryMaterials,
} from './fixtures/history-material-fixtures';
import { seedReplayRun } from './fixtures/history-memory-fixtures';
import { historyMaterialAvailability } from './history-material-availability';
import { planRunHistoryReplay } from './memory-recall-service';

const stores: AppStore[] = [];
const setup = () => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const workspaceId = store.workspaces.getOrCreate('/tmp/history-material-tests', 'history').id;
  const task = store.tasks.create(workspaceId, 'history', 'history');
  const input = { taskId: task.task.id, sessionId: task.sessionId, workspaceId, index: 0 };
  const references = seedHistoryMaterials(store, input);
  const db = (store as unknown as { db: Database.Database }).db;
  return { store, references, db, input };
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

describe('History material availability', () => {
  it('checks all references with exact IDs, preserving duplicates and blank knowledge paths', () => {
    const { store, references } = setup();
    const knowledge = references[3]!;
    const refs: MaterialReference[] = [
      ...references,
      references[0]!,
      { ...knowledge, sourcePath: '  ' } as MaterialReference,
      { ...references[0]!, artifactVersionId: 'missing-version' } as MaterialReference,
      { ...references[2]!, snapshotId: 'missing-snapshot' } as MaterialReference,
    ];
    const expected = legacyMaterialAvailability(store, refs);
    expect(expected).toEqual([true, true, true, true, true, false, false, false]);
    const version = vi.spyOn(store.artifacts, 'getVersionDetail');
    const snapshot = vi.spyOn(store.inputSnapshots, 'get');
    expect(historyMaterialAvailability(store, refs)).toEqual(expected);
    expect(version).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('performs no entity queries for an empty or knowledge-only collection', () => {
    const { store, references, db } = setup();
    const prepare = vi.spyOn(db, 'prepare');
    expect(historyMaterialAvailability(store, [])).toEqual([]);
    expect(historyMaterialAvailability(store, [references[3]!])).toEqual([true]);
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each(['artifact', 'snapshot'] as const)('rereads %s deletion on the next call', (kind) => {
    const { store, references, db } = setup();
    const reference = references[kind === 'artifact' ? 0 : 2]!;
    expect(historyMaterialAvailability(store, [reference])).toEqual([true]);
    if (reference.kind === 'artifact-version')
      db.prepare('DELETE FROM artifacts WHERE id = ?').run(reference.artifactId);
    if (reference.kind === 'workspace-input-snapshot')
      db.prepare('DELETE FROM input_snapshots WHERE id = ?').run(reference.snapshotId);
    expect(historyMaterialAvailability(store, [reference])).toEqual([false]);
    expect(historyMaterialAvailability(store, [reference])).toEqual(
      legacyMaterialAvailability(store, [reference]),
    );
  });

  it('matches complete replay and checks old candidate entities before the eight-pair budget', () => {
    const { store, references, db, input } = setup();
    const ids = Array.from({ length: 14 }, (_, index) =>
      seedReplayRun(store, {
        ...input,
        index,
        materials: references,
        inheritedMaterials: references,
      }),
    );
    const replayInput = {
      taskId: input.taskId,
      currentRunId: 'missing-current',
      evaluatedAt: 100,
      excludedMemoryIds: [],
      allowedMaterialKeys: references.map(materialListIdentity),
    };
    const legacy = vi
      .spyOn(store.artifacts, 'listVersionDetails')
      .mockImplementation((versionIds) =>
        versionIds.flatMap((id) => {
          const detail = store.artifacts.getVersionDetail(id);
          return detail === undefined ? [] : [detail];
        }),
      );
    const expected = planRunHistoryReplay(store, replayInput);
    legacy.mockRestore();
    const legacySnapshots = vi
      .spyOn(store.inputSnapshots, 'listByIds')
      .mockImplementation((snapshotIds) =>
        snapshotIds.flatMap((id) => {
          const snapshot = store.inputSnapshots.get(id);
          return snapshot === undefined ? [] : [snapshot];
        }),
      );
    expect(planRunHistoryReplay(store, replayInput)).toEqual(expected);
    legacySnapshots.mockRestore();
    const version = vi.spyOn(store.artifacts, 'getVersionDetail');
    const snapshot = vi.spyOn(store.inputSnapshots, 'get');
    const batchVersions = vi.spyOn(store.artifacts, 'listVersionDetails');
    const batchSnapshots = vi.spyOn(store.inputSnapshots, 'listByIds');
    expect(planRunHistoryReplay(store, replayInput)).toEqual(expected);
    expect(expected.messages).toHaveLength(16);
    expect(expected.inheritedMaterialReferences).toEqual(references);
    expect(expected.replay.at(-1)).toMatchObject({ runId: ids[5], reason: 'history-budget' });
    expect(version).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(batchVersions).toHaveBeenCalledOnce();
    expect(batchVersions).toHaveBeenCalledWith(
      references.flatMap((ref) => (ref.kind === 'artifact-version' ? [ref.artifactVersionId] : [])),
    );
    expect(batchSnapshots).toHaveBeenCalledOnce();
    // An old candidate's invalid source must still fail before the output budget is applied.
    const old = seedHistoryMaterials(store, { ...input, index: 99 });
    db.prepare('UPDATE run_context_snapshots SET materials_json = ? WHERE run_id = ?').run(
      JSON.stringify([{ reference: old[0], purpose: 'background', addedFrom: 'user-input' }]),
      ids[0],
    );
    const artifact = old[0]!;
    if (artifact.kind !== 'artifact-version') throw new Error('fixture');
    db.prepare(
      'UPDATE evidence SET knowledge_source_json = ? WHERE id IN (SELECT evidence_id FROM artifact_version_evidence WHERE version_id = ?)',
    ).run('{}', artifact.artifactVersionId);
    expect(() => planRunHistoryReplay(store, replayInput)).toThrow();
  });

  it('does not decode corrupt entities attached only to foreign or future runs', () => {
    const { store, references, db, input } = setup();
    seedReplayRun(store, { ...input, materials: references });
    const outsideMaterials = seedHistoryMaterials(store, { ...input, index: 20 });
    const foreign = store.tasks.create(input.workspaceId, 'foreign', 'foreign');
    seedReplayRun(store, {
      ...input,
      taskId: foreign.task.id,
      sessionId: foreign.sessionId,
      index: 10,
      materials: outsideMaterials,
    });
    seedReplayRun(store, { ...input, index: 101, materials: outsideMaterials });
    db.prepare('UPDATE evidence SET knowledge_source_json = ? WHERE run_id = ?').run(
      '{}',
      'material-source-20',
    );
    const result = planRunHistoryReplay(store, {
      taskId: input.taskId,
      currentRunId: 'missing-current',
      evaluatedAt: 100,
      excludedMemoryIds: [],
      allowedMaterialKeys: references.map(materialListIdentity),
    });
    expect(result.messages).toEqual([
      { role: 'user', content: 'prompt 0' },
      { role: 'assistant', content: 'answer 0' },
    ]);
    expect(result.inheritedMaterialReferences).toEqual(references);
  });

  it('keeps an inherited blank path unsafe even when its list identity matches a valid selection', () => {
    const { store, references, input } = setup();
    const reference = references[3]!;
    const runId = seedReplayRun(store, {
      ...input,
      materials: [reference],
      inheritedMaterials: [{ ...reference, sourcePath: ' ' } as MaterialReference],
    });
    const result = planRunHistoryReplay(store, {
      taskId: input.taskId,
      currentRunId: 'missing-current',
      evaluatedAt: 100,
      excludedMemoryIds: [],
      allowedMaterialKeys: [materialListIdentity(reference)],
    });
    expect(result.messages).toEqual([]);
    expect(result.replay).toEqual([{ replayed: false, runId, reason: 'source-unavailable' }]);
  });
});
