import type { ArtifactInputRelationInput } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

const sampleInputs: ArtifactInputRelationInput[] = [
  {
    input: { kind: 'evidence', evidenceId: 'ev-1' },
    relation: 'data',
  },
];

/** Creates a workspace, task and run, returning the run ID. */
const seedRun = (store: AppStore, runId: string): string => {
  const workspace = store.workspaces.getOrCreate('/tmp/declaration-test', 'test');
  const task = store.tasks.create(workspace.id, 'test task', 'verify declarations');
  store.runs.create({
    id: runId,
    taskId: task.task.id,
    sessionId: task.sessionId,
    prompt: 'test',
    status: 'running',
    createdAt: Date.now(),
  });
  return runId;
};

describe('RunArtifactSourceDeclarationRepository', () => {
  it('returns undefined when no declaration exists for the run', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    expect(store.runArtifactDeclarations.get('nonexistent')).toBeUndefined();
  });

  it('creates a declaration via upsert and retrieves it with parsed JSON', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const runId = seedRun(store, 'run-decl-1');

    const result = store.runArtifactDeclarations.upsert(runId, sampleInputs);
    expect(result.runId).toBe(runId);
    expect(result.inputs).toEqual(sampleInputs);
    expect(result.createdAt).toBe(result.updatedAt);

    const fetched = store.runArtifactDeclarations.get(runId);
    expect(fetched).toBeDefined();
    expect(fetched!.runId).toBe(runId);
    expect(fetched!.inputs).toEqual(sampleInputs);
    expect(fetched!.createdAt).toBe(result.createdAt);
    expect(fetched!.updatedAt).toBe(result.updatedAt);
  });

  it('updates the declaration on a second upsert for the same run', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const runId = seedRun(store, 'run-decl-2');

    const first = store.runArtifactDeclarations.upsert(runId, sampleInputs);
    const updatedInputs: ArtifactInputRelationInput[] = [
      {
        input: { kind: 'evidence', evidenceId: 'ev-2' },
        relation: 'rule',
      },
      {
        input: { kind: 'evidence', evidenceId: 'ev-3' },
        relation: 'comparison',
      },
    ];
    const second = store.runArtifactDeclarations.upsert(runId, updatedInputs);

    expect(second.inputs).toEqual(updatedInputs);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);

    const fetched = store.runArtifactDeclarations.get(runId);
    expect(fetched!.inputs).toEqual(updatedInputs);
    expect(fetched!.createdAt).toBe(first.createdAt);
  });

  it('throws when upserting for a non-existent run', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    expect(() => store.runArtifactDeclarations.upsert('nonexistent-run', sampleInputs)).toThrow(
      'Run does not exist',
    );
  });

  it('supports an empty inputs array as an explicit clear', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const runId = seedRun(store, 'run-decl-empty');

    store.runArtifactDeclarations.upsert(runId, sampleInputs);
    const cleared = store.runArtifactDeclarations.upsert(runId, []);
    expect(cleared.inputs).toEqual([]);

    const fetched = store.runArtifactDeclarations.get(runId);
    expect(fetched!.inputs).toEqual([]);
  });
});
