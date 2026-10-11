import { createHash } from 'node:crypto';

import {
  materialListIdentity,
  type MaterialReference,
  type MemoryDependency,
  type MemoryRecord,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { seedReplayRun } from './fixtures/history-memory-fixtures';
import { loadHistoryReplayFacts } from './history-replay-facts';
import { promptHashOf } from './memory-provenance';
import { planRunHistoryReplay } from './memory-recall-service';

const stores: AppStore[] = [];
const setup = () => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const workspaceId = store.workspaces.getOrCreate('/tmp/history-replay-facts', 'history').id;
  const task = store.tasks.create(workspaceId, 'history', 'history');
  const input = { taskId: task.task.id, sessionId: task.sessionId, workspaceId, index: 0 };
  const query = { taskId: input.taskId, currentRunId: 'missing-current', evaluatedAt: 100 };
  const db = (store as unknown as { db: Database.Database }).db;
  return { store, input, query, db };
};

const knowledge = (index: number): Extract<MaterialReference, { kind: 'knowledge-revision' }> => ({
  kind: 'knowledge-revision',
  knowledgeDocumentId: `document-${index}`,
  knowledgeRevisionId: `revision-${index}`,
  contentHash: 'a'.repeat(64),
  sourcePath: `/tmp/knowledge-${index}.md`,
});
const dependency = (record: MemoryRecord): MemoryDependency => ({
  memoryId: record.id,
  revisionId: record.revisionId,
  contentHash: record.contentHash,
});
const seedMemory = (store: AppStore, content: string): MemoryRecord =>
  store.memories.create({
    scope: { kind: 'user' },
    status: 'confirmed',
    content,
    facet: 'fact',
    normalizedHash: createHash('sha256').update(content).digest('hex'),
    confidence: 0.9,
    validFrom: 0,
    validUntil: 200,
    createdAt: 0,
    provenance: {
      schemaVersion: 1,
      verification: 'legacy-unverified',
      sourceType: 'user-explicit',
    },
  }).record;

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('History replay facts', () => {
  it('keeps direct and inherited revisions, material metadata and first-seen order', () => {
    const { store, input, query } = setup();
    const first = seedMemory(store, 'first');
    const second = store.memories.update({
      id: first.id,
      expectedRevision: first.revision,
      patch: { content: 'second' },
      normalizedHash: createHash('sha256').update('second').digest('hex'),
      updatedAt: 1,
    }).record;
    const selected = knowledge(1);
    const readOnly = knowledge(2);
    const inherited = knowledge(3);
    const blankSelected = { ...selected, sourcePath: ' ' };
    const inheritedSecond = { ...inherited, contentHash: 'b'.repeat(64) };
    const runId = seedReplayRun(store, {
      ...input,
      selected: [first],
      dependencies: [dependency(second), dependency(first), dependency(second)],
      inheritedMaterials: [blankSelected, inherited, inheritedSecond],
      omitSnapshot: true,
    });
    for (const [index, material] of [readOnly, selected].entries())
      store.materialReads.save({
        id: `read-${index}`,
        runId,
        material,
        operation: 'read',
        contentHash: material.contentHash,
        capturedAt: index,
      });
    store.runContextSnapshots.create({
      runId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      contextSegmentId: runId,
      materials: [{ reference: selected, purpose: 'background', addedFrom: 'user-input' }],
      createdAt: 2,
    });
    const model = loadHistoryReplayFacts(store, query);
    const fact = model.byRunId.get(runId);
    expect(model.runs.map((entry) => entry.record.runId)).toEqual([runId]);
    expect(fact).toBe(model.runs[0]);
    expect(fact?.record).toEqual({
      runId,
      finalEventId: `${runId}-answer`,
      prompt: 'prompt 0',
      answer: 'answer 0',
      promptHash: promptHashOf('prompt 0'),
      directMemoryRevisions: [dependency(first)],
      inheritedMemoryRevisions: [dependency(second), dependency(second)],
      materialKeys: [materialListIdentity(selected), materialListIdentity(readOnly)],
      inheritedMaterialKeys: [materialListIdentity(inherited)],
      dependencyFactsComplete: true,
      memoryScopes: { [first.id]: 'user' },
    });
    expect(fact?.memoryDependencies).toEqual([
      dependency(first),
      dependency(second),
      dependency(second),
    ]);
    expect(fact?.materialReferences).toEqual([
      selected,
      readOnly,
      blankSelected,
      inherited,
      inheritedSecond,
    ]);
    expect([...model.unavailableSourceKeys]).toEqual([materialListIdentity(selected)]);
    expect(model.liveMemoryRevisions.get(first.revisionId)).toMatchObject({
      memoryId: first.id,
      contentHash: first.contentHash,
      status: 'confirmed',
      validFrom: 0,
      validUntil: 200,
      revision: 1,
      latestRevisionOfIdentity: 2,
      scopeKind: 'user',
      recordedScopeKind: 'user',
    });
  });

  it.each(['inherited-first', 'direct-first'] as const)(
    'binds a revision scope only on its first encounter: %s',
    (order) => {
      const { store, input, query } = setup();
      const memory = seedMemory(store, 'scope');
      const missing = {
        memoryId: 'missing',
        revisionId: 'missing-revision',
        contentHash: 'c'.repeat(64),
      };
      const inheritedFirst = order === 'inherited-first';
      seedReplayRun(store, {
        ...input,
        selected: inheritedFirst ? [] : [memory],
        dependencies: inheritedFirst ? [dependency(memory), missing] : [],
      });
      seedReplayRun(store, {
        ...input,
        index: 1,
        selected: inheritedFirst ? [memory] : [],
        dependencies: inheritedFirst ? [] : [dependency(memory), missing],
      });
      const model = loadHistoryReplayFacts(store, query);
      expect(model.liveMemoryRevisions.get(memory.revisionId)).toEqual({
        memoryId: memory.id,
        contentHash: memory.contentHash,
        status: 'confirmed',
        validFrom: 0,
        validUntil: 200,
        latestRevisionOfIdentity: 1,
        revision: 1,
        scopeKind: 'user',
        ...(inheritedFirst ? {} : { recordedScopeKind: 'user' }),
      });
      expect(model.liveMemoryRevisions.has(missing.revisionId)).toBe(false);
    },
  );

  it.each(['context', 'snapshot', 'answer'] as const)(
    'keeps missing %s facts unsafe and preserves the complete replay audit',
    (missing) => {
      const { store, input, query, db } = setup();
      const unsafe = seedReplayRun(store, {
        ...input,
        omitContext: missing === 'context',
        omitSnapshot: missing === 'snapshot',
      });
      if (missing === 'answer') db.prepare('DELETE FROM run_events WHERE run_id = ?').run(unsafe);
      const memory = seedMemory(store, 'safe');
      const material = knowledge(1);
      const safe = seedReplayRun(store, {
        ...input,
        index: 1,
        selected: [memory],
        materials: [material],
        inheritedMaterials: [material],
      });
      const model = loadHistoryReplayFacts(store, query);
      expect(model.runs.map((fact) => fact.record.runId)).toEqual([unsafe, safe]);
      expect([...model.byRunId.keys()]).toEqual([unsafe, safe]);
      expect(model.byRunId.get(unsafe)?.record.dependencyFactsComplete).toBe(missing === 'answer');
      if (missing === 'answer') expect(model.byRunId.get(unsafe)?.answer).toBeUndefined();
      expect(
        planRunHistoryReplay(store, {
          ...query,
          excludedMemoryIds: [],
          allowedMaterialKeys: [materialListIdentity(material)],
        }),
      ).toEqual({
        replay: [
          {
            replayed: true,
            runId: safe,
            finalEventId: `${safe}-answer`,
            promptHash: promptHashOf('prompt 1'),
            contentCodePoints: 16,
          },
          { replayed: false, runId: unsafe, reason: 'legacy-provenance-unknown' },
        ],
        messages: [
          { role: 'user', content: 'prompt 1' },
          { role: 'assistant', content: 'answer 1' },
        ],
        skippedReason: 'legacy-provenance-unknown',
        stoppedEarly: true,
        usedCodePoints: 16,
        inheritedMaterialReferences: [material],
        inheritedMemoryDependencies: [dependency(memory)],
      });
    },
  );

  it('reads every candidate before budget selection and retains unsafe-boundary priority', () => {
    const { store, input, query, db } = setup();
    const ids = Array.from({ length: 12 }, (_, index) =>
      seedReplayRun(store, { ...input, index, omitContext: index === 0 }),
    );
    const model = loadHistoryReplayFacts(store, query);
    expect(model.runs).toHaveLength(12);
    expect([...model.byRunId.keys()]).toEqual(ids);
    const replayInput = { ...query, excludedMemoryIds: [], allowedMaterialKeys: [] };
    const result = planRunHistoryReplay(store, replayInput);
    expect(result.skippedReason).toBe('history-budget');
    expect(result.messages).toHaveLength(16);
    expect(result.replay.at(-1)).toEqual({
      replayed: false,
      runId: ids[0],
      reason: 'legacy-provenance-unknown',
    });
    db.prepare('UPDATE run_context_snapshots SET materials_json = ? WHERE run_id = ?').run(
      '{}',
      ids[0],
    );
    expect(() => loadHistoryReplayFacts(store, query)).toThrow();
    expect(() => planRunHistoryReplay(store, replayInput)).toThrow();
  });

  it('rebuilds its lookup and live dependency state on every invocation', () => {
    const { store, input, query } = setup();
    const memory = seedMemory(store, 'before');
    const first = seedReplayRun(store, { ...input, selected: [memory] });
    const before = loadHistoryReplayFacts(store, query);
    store.memories.update({
      id: memory.id,
      expectedRevision: 1,
      patch: { content: 'after' },
      normalizedHash: createHash('sha256').update('after').digest('hex'),
      updatedAt: 2,
    });
    const second = seedReplayRun(store, { ...input, index: 2 });
    const after = loadHistoryReplayFacts(store, query);
    expect([...before.byRunId.keys()]).toEqual([first]);
    expect([...after.byRunId.keys()]).toEqual([first, second]);
    expect(after.byRunId).not.toBe(before.byRunId);
    expect(before.liveMemoryRevisions.get(memory.revisionId)?.latestRevisionOfIdentity).toBe(1);
    expect(after.liveMemoryRevisions.get(memory.revisionId)?.latestRevisionOfIdentity).toBe(2);
    expect(before.byRunId.get(first)).not.toBe(after.byRunId.get(first));
  });
});
