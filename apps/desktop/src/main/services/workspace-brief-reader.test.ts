import { createHash, randomUUID } from 'node:crypto';

import type { MemoryFacet, MemoryProvenance, MemoryScope } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import { createStoreBriefReader } from './workspace-brief-reader';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const normalizeMemory = (content: string): string =>
  content.normalize('NFC').replace(/\r\n?/gu, '\n').trim();

const digestOf = (content: string): string => sha256Hex(normalizeMemory(content));

const codePoints = (value: string): number => [...value].length;

const legacyProvenance = (): MemoryProvenance => ({
  schemaVersion: 1,
  verification: 'legacy-unverified',
  sourceType: 'user-explicit',
});

const manualProvenance = (excerpt: string, operationId: string): MemoryProvenance => ({
  schemaVersion: 1,
  verification: 'verified',
  authority: 'user-instruction',
  capturedAt: 1_700_000_000_000,
  sources: [
    {
      kind: 'manual',
      operationId,
      contentHash: sha256Hex(excerpt),
      start: 0,
      end: codePoints(excerpt),
      excerpt,
      excerptHash: sha256Hex(excerpt),
    },
  ],
  materialDependencies: [],
  memoryDependencies: [],
  genericDeclaration: true,
});

const runUserProvenance = (runId: string, excerpt: string): MemoryProvenance => ({
  schemaVersion: 1,
  verification: 'verified',
  authority: 'user-instruction',
  capturedAt: 1_700_000_000_000,
  sources: [
    {
      kind: 'run-user',
      runId,
      promptHash: sha256Hex('test prompt'),
      start: 0,
      end: codePoints(excerpt),
      excerpt,
      excerptHash: sha256Hex(excerpt),
    },
  ],
  materialDependencies: [],
  memoryDependencies: [],
  genericDeclaration: true,
});

const checkpointProvenance = (
  checkpointId: string,
  excerpt: string,
  field: 'feedback' | 'summary' = 'summary',
): MemoryProvenance => ({
  schemaVersion: 1,
  verification: 'verified',
  authority: 'user-instruction',
  capturedAt: 1_700_000_000_000,
  sources: [
    {
      kind: 'checkpoint',
      checkpointId,
      field,
      contentHash: sha256Hex(excerpt),
      start: 0,
      end: codePoints(excerpt),
      excerpt,
      excerptHash: sha256Hex(excerpt),
    },
  ],
  materialDependencies: [],
  memoryDependencies: [],
  genericDeclaration: true,
});

const artifactVersionProvenance = (
  artifactId: string,
  artifactVersionId: string,
  excerpt: string,
): MemoryProvenance => ({
  schemaVersion: 1,
  verification: 'verified',
  authority: 'user-instruction',
  capturedAt: 1_700_000_000_000,
  sources: [
    {
      kind: 'artifact-version',
      artifactId,
      artifactVersionId,
      contentHash: sha256Hex(excerpt),
      start: 0,
      end: codePoints(excerpt),
      excerpt,
      excerptHash: sha256Hex(excerpt),
    },
  ],
  materialDependencies: [
    {
      kind: 'artifact-version',
      artifactId,
      artifactVersionId,
      contentHash: sha256Hex(excerpt),
      originWorkspaceId: 'ws-1',
    },
  ],
  memoryDependencies: [],
  genericDeclaration: true,
});

const workspaceScope = (workspaceId: string): MemoryScope => ({
  kind: 'workspace',
  workspaceId,
});

const expertWorkspaceScope = (workspaceId: string, expertId: string): MemoryScope => ({
  kind: 'expert-workspace',
  workspaceId,
  expertId,
});

const userScope: MemoryScope = { kind: 'user' };

const createMemory = (
  store: AppStore,
  input: {
    scope: MemoryScope;
    content: string;
    facet: MemoryFacet;
    provenance?: MemoryProvenance;
    status?: 'confirmed' | 'candidate';
    topicKey?: string;
  },
) => {
  const provenance = input.provenance ?? legacyProvenance();
  return store.memories.create({
    scope: input.scope,
    content: input.content,
    facet: input.facet,
    normalizedHash: digestOf(input.content),
    provenance,
    confidence: 0.9,
    status: input.status ?? 'confirmed',
    ...(input.topicKey ? { topicKey: input.topicKey } : {}),
  }).record;
};

describe('createStoreBriefReader.confirmedMemories', () => {
  it('returns confirmed workspace-scoped memories', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-test', 'Test');
    createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Test goal',
      facet: 'goal',
    });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe('Test goal');
    expect(rows[0]?.facet).toBe('goal');
  });

  it('filters out user-scoped memories from workspace query', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-user-scope', 'Test');
    createMemory(store, { scope: userScope, content: 'User preference', facet: 'preference' });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id);
    expect(rows).toHaveLength(0);
  });

  it('includes expert-workspace memories when expertId is provided', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-expert', 'Test');
    const expert = store.experts.create({
      sourceKind: 'user',
      revision: {
        name: 'Test Expert',
        summary: '',
        author: '',
        tags: [],
        identity: 'Test',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    });
    createMemory(store, {
      scope: expertWorkspaceScope(workspace.id, expert.id),
      content: 'Expert method',
      facet: 'method',
    });
    const reader = createStoreBriefReader(store);
    const withoutExpert = reader.confirmedMemories(workspace.id);
    expect(withoutExpert).toHaveLength(0);
    const withExpert = reader.confirmedMemories(workspace.id, expert.id);
    expect(withExpert).toHaveLength(1);
    expect(withExpert[0]?.content).toBe('Expert method');
  });

  it('excludes expert-workspace memories for a different expert', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-expert-diff', 'Test');
    const expertA = store.experts.create({
      sourceKind: 'user',
      revision: {
        name: 'Expert A',
        summary: '',
        author: '',
        tags: [],
        identity: 'A',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    });
    const expertB = store.experts.create({
      sourceKind: 'user',
      revision: {
        name: 'Expert B',
        summary: '',
        author: '',
        tags: [],
        identity: 'B',
        principles: [],
        inputRequirements: [],
        deliveryRequirements: [],
        skillPreset: [],
        builtinToolPolicy: { mode: 'application-defaults' },
        modelReference: { mode: 'application-default' },
      },
    });
    createMemory(store, {
      scope: expertWorkspaceScope(workspace.id, expertA.id),
      content: 'Expert-A fact',
      facet: 'fact',
    });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id, expertB.id);
    expect(rows).toHaveLength(0);
  });

  it('excludes candidate memories', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-candidate', 'Test');
    createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Candidate fact',
      facet: 'fact',
      status: 'candidate',
    });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id);
    expect(rows).toHaveLength(0);
  });
});

describe('createStoreBriefReader source availability', () => {
  it('marks legacy-unverified as review-required', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-legacy', 'Test');
    createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Legacy content',
      facet: 'fact',
      provenance: legacyProvenance(),
    });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceAvailability).toBe('review-required');
  });

  it('marks verified manual source as available when operation exists', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-manual', 'Test');
    const operationId = randomUUID();
    store.memoryOperations.claim({
      operationId,
      operationKind: 'create',
      requestHash: sha256Hex('test'),
    });
    store.memoryOperations.append({
      operationId,
      operationKind: 'create',
      requestHash: sha256Hex('test'),
      effect: 'created',
      committedRevisionIds: [],
    });
    createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Manual content',
      facet: 'fact',
      provenance: manualProvenance('Manual content', operationId),
    });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceAvailability).toBe('available');
  });

  it('marks verified manual source as unavailable when operation is missing', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-manual-missing', 'Test');
    const missingOperationId = randomUUID();
    createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Orphan manual',
      facet: 'fact',
      provenance: manualProvenance('Orphan manual', missingOperationId),
    });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceAvailability).toBe('unavailable');
  });

  it('marks verified run-user source as available when run exists', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-run-user', 'Test');
    const task = store.tasks.create(workspace.id, 'Task', 'Test task');
    store.runs.create({
      id: 'run-1',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'test',
      status: 'running',
      createdAt: 1000,
    });
    createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Run user content',
      facet: 'fact',
      provenance: runUserProvenance('run-1', 'Run user content'),
    });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceAvailability).toBe('available');
  });

  it('marks verified run-user source as unavailable when run is missing', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-run-user-missing', 'Test');
    createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Missing run',
      facet: 'fact',
      provenance: runUserProvenance('nonexistent-run', 'Missing run'),
    });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceAvailability).toBe('unavailable');
  });

  it('marks verified checkpoint source as available when checkpoint exists', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-checkpoint', 'Test');
    const task = store.tasks.create(workspace.id, 'Task', 'Test task');
    store.discussionCheckpoints.create(task.task.id, {
      id: 'checkpoint-1',
      taskId: task.task.id,
      stage: 'report-outline',
      title: 'Test checkpoint',
      summary: 'Summary',
      artifactVersionIds: [],
    });
    createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Checkpoint content',
      facet: 'fact',
      provenance: checkpointProvenance('checkpoint-1', 'Checkpoint content'),
    });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceAvailability).toBe('available');
  });

  it('marks verified checkpoint source as unavailable when checkpoint is missing', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-checkpoint-missing', 'Test');
    createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Missing checkpoint',
      facet: 'fact',
      provenance: checkpointProvenance('nonexistent-checkpoint', 'Missing checkpoint'),
    });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceAvailability).toBe('unavailable');
  });

  it('sets requiresMaterialSelection when verified provenance has material dependencies', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-material', 'Test');
    const task = store.tasks.create(workspace.id, 'Task', 'Test task');
    const artifact = store.artifacts.saveMarkdown({
      taskId: task.task.id,
      origin: 'user-edit',
      title: 'Test Artifact',
      content: 'Artifact content',
    });
    createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Material dependent',
      facet: 'fact',
      provenance: artifactVersionProvenance(
        artifact.id,
        artifact.currentVersionId,
        'Material dependent',
      ),
    });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.requiresMaterialSelection).toBe(true);
  });
});

describe('createStoreBriefReader.confirmedMemories conflict blocking', () => {
  it('blocks both records of an unresolved conflict pair', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-conflict', 'Test');
    createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Revenue is 100M',
      facet: 'fact',
      topicKey: 'revenue',
    });
    createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Revenue is 200M',
      facet: 'fact',
      topicKey: 'revenue',
    });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id);
    expect(rows).toHaveLength(0);
  });

  it('unblocks records after a conflict decision is recorded', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-decided', 'Test');
    const left = createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Revenue is 100M',
      facet: 'fact',
      topicKey: 'revenue-decided',
    });
    const right = createMemory(store, {
      scope: workspaceScope(workspace.id),
      content: 'Revenue is 200M',
      facet: 'fact',
      topicKey: 'revenue-decided',
    });
    store.memoryOperations.recordConflictResolution({
      operationId: randomUUID(),
      requestHash: sha256Hex('decision'),
      leftRevisionId: left.revisionId,
      rightRevisionId: right.revisionId,
      decision: 'keep-both',
      applicabilityNote: 'Both valid in different contexts',
    });
    const reader = createStoreBriefReader(store);
    const rows = reader.confirmedMemories(workspace.id);
    expect(rows).toHaveLength(2);
  });
});

describe('createStoreBriefReader.openCheckpoints', () => {
  it('returns only open checkpoints for the workspace', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-open-checkpoints', 'Test');
    const task = store.tasks.create(workspace.id, 'Task', 'Test task');
    store.discussionCheckpoints.create(task.task.id, {
      id: 'open-checkpoint',
      taskId: task.task.id,
      stage: 'report-outline',
      title: 'Open issue',
      summary: 'Needs review',
      artifactVersionIds: [],
    });
    const first = store.discussionCheckpoints.create(task.task.id, {
      id: 'will-be-superseded',
      taskId: task.task.id,
      stage: 'report-outline',
      title: 'Will be superseded',
      summary: 'Old',
      artifactVersionIds: [],
    });
    store.discussionCheckpoints.create(task.task.id, {
      id: 'replacement-checkpoint',
      taskId: task.task.id,
      stage: 'report-outline',
      title: 'Replacement',
      summary: 'New',
      artifactVersionIds: [],
      supersedesId: first.id,
    });
    const reader = createStoreBriefReader(store);
    const checkpoints = reader.openCheckpoints(workspace.id);
    // 'open-checkpoint' and 'replacement-checkpoint' are open; 'will-be-superseded' is superseded
    expect(checkpoints).toHaveLength(2);
    const ids = checkpoints.map((checkpoint) => checkpoint.checkpointId);
    expect(ids).toContain('open-checkpoint');
    expect(ids).toContain('replacement-checkpoint');
  });

  it('returns empty for a workspace with no tasks', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-no-tasks', 'Test');
    const reader = createStoreBriefReader(store);
    expect(reader.openCheckpoints(workspace.id)).toHaveLength(0);
  });
});

describe('createStoreBriefReader.activeReferences', () => {
  it('returns empty for a workspace with no references', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/tmp/brief-no-refs', 'Test');
    const reader = createStoreBriefReader(store);
    expect(reader.activeReferences(workspace.id)).toHaveLength(0);
  });
});
