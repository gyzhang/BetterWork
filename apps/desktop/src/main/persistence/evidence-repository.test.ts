import { createHash } from 'node:crypto';

import type { KnowledgeEvidenceSource } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { knowledgeEvidenceDedupeKey, type NewEvidence } from './evidence-repository';
import { AppStore } from './index';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

interface TestFixture {
  workspaceId: string;
  taskId: string;
  sessionId: string;
  runId: string;
}

const createFixture = (store: AppStore): TestFixture => {
  const workspace = store.workspaces.create('/tmp/test-ws', 'Test Workspace');
  const { task, sessionId } = store.tasks.create(workspace.id, 'Test Task', 'Test goal');
  const runId = 'run-1';
  store.runs.create({
    id: runId,
    taskId: task.id,
    sessionId,
    prompt: 'test prompt',
    status: 'running',
    createdAt: Date.now(),
  });
  return { workspaceId: workspace.id, taskId: task.id, sessionId, runId };
};

const baseEvidence = (overrides: Partial<NewEvidence> = {}): NewEvidence => ({
  taskId: 'task-1',
  runId: 'run-1',
  sourceUri: 'file:///tmp/doc.txt',
  title: 'Test Document',
  locator: 'line 1',
  excerpt: 'Some excerpt text',
  contentHash: 'abc123hash',
  ...overrides,
});

const baseKnowledgeSource = (): KnowledgeEvidenceSource => ({
  reference: {
    kind: 'knowledge-revision',
    knowledgeDocumentId: 'doc-1',
    knowledgeRevisionId: 'rev-1',
    contentHash: 'content-hash-1',
    sourcePath: '/docs/source.md',
  },
  textHash: 'text-hash-1',
  span: { sectionOrdinal: 0, start: 0, end: 100 },
  operation: 'search',
});

describe('EvidenceRepository saves and retrieves local-file evidence', () => {
  it('saveLocal persists a local-file evidence entry', () => {
    const store = openStore();
    const fixture = createFixture(store);
    store.evidence.saveLocal(baseEvidence({ taskId: fixture.taskId, runId: fixture.runId }));
    const list = store.evidence.listByTask(fixture.taskId);
    expect(list).toHaveLength(1);
    expect(list[0]!.sourceType).toBe('local-file');
    expect(list[0]!.taskId).toBe(fixture.taskId);
    expect(list[0]!.runId).toBe(fixture.runId);
    expect(list[0]!.sourceUri).toBe('file:///tmp/doc.txt');
    expect(list[0]!.title).toBe('Test Document');
    expect(list[0]!.locator).toBe('line 1');
    expect(list[0]!.excerpt).toBe('Some excerpt text');
    expect(list[0]!.contentHash).toBe('abc123hash');
    expect(typeof list[0]!.capturedAt).toBe('number');
  });

  it('saveWeb persists a web-page evidence entry', () => {
    const store = openStore();
    const fixture = createFixture(store);
    store.evidence.saveWeb(
      baseEvidence({
        taskId: fixture.taskId,
        runId: fixture.runId,
        sourceUri: 'https://example.com/page',
      }),
    );
    const list = store.evidence.listByTask(fixture.taskId);
    expect(list).toHaveLength(1);
    expect(list[0]!.sourceType).toBe('web-page');
  });

  it('saveMcp persists an mcp-tool evidence entry', () => {
    const store = openStore();
    const fixture = createFixture(store);
    store.evidence.saveMcp(baseEvidence({ taskId: fixture.taskId, runId: fixture.runId }));
    const list = store.evidence.listByTask(fixture.taskId);
    expect(list).toHaveLength(1);
    expect(list[0]!.sourceType).toBe('mcp-tool');
  });
});

describe('EvidenceRepository deduplicates via INSERT OR IGNORE on (run_id, source_uri, locator)', () => {
  it('ignores a second save with the same run_id, source_uri, and locator', () => {
    const store = openStore();
    const fixture = createFixture(store);
    const input = baseEvidence({ taskId: fixture.taskId, runId: fixture.runId });
    store.evidence.saveLocal(input);
    store.evidence.saveLocal(input);
    const list = store.evidence.listByTask(fixture.taskId);
    expect(list).toHaveLength(1);
  });

  it('allows different source_uri values in the same run', () => {
    const store = openStore();
    const fixture = createFixture(store);
    store.evidence.saveLocal(
      baseEvidence({
        taskId: fixture.taskId,
        runId: fixture.runId,
        sourceUri: 'file:///a.txt',
      }),
    );
    store.evidence.saveLocal(
      baseEvidence({
        taskId: fixture.taskId,
        runId: fixture.runId,
        sourceUri: 'file:///b.txt',
      }),
    );
    expect(store.evidence.listByTask(fixture.taskId)).toHaveLength(2);
  });

  it('allows the same source_uri in different runs', () => {
    const store = openStore();
    const fixture = createFixture(store);
    const runId2 = 'run-2';
    store.runs.create({
      id: runId2,
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: 'second prompt',
      status: 'running',
      createdAt: Date.now(),
    });
    store.evidence.saveLocal(baseEvidence({ taskId: fixture.taskId, runId: fixture.runId }));
    store.evidence.saveLocal(baseEvidence({ taskId: fixture.taskId, runId: runId2 }));
    expect(store.evidence.listByTask(fixture.taskId)).toHaveLength(2);
  });
});

describe('EvidenceRepository validates Run-Task ownership', () => {
  it('throws when the run does not exist', () => {
    const store = openStore();
    const fixture = createFixture(store);
    expect(() =>
      store.evidence.saveLocal(baseEvidence({ taskId: fixture.taskId, runId: 'nonexistent-run' })),
    ).toThrow('Evidence Run does not exist');
  });

  it('throws when the run belongs to a different task', () => {
    const store = openStore();
    const fixture = createFixture(store);
    const workspace2 = store.workspaces.create('/tmp/test-ws-2', 'Workspace 2');
    const { task: task2, sessionId: session2 } = store.tasks.create(
      workspace2.id,
      'Task 2',
      'Goal 2',
    );
    expect(() =>
      store.evidence.saveLocal(baseEvidence({ taskId: task2.id, runId: fixture.runId })),
    ).toThrow('Evidence Run does not belong to task');
    void session2;
  });

  it('saveWeb also validates Run-Task ownership', () => {
    const store = openStore();
    const fixture = createFixture(store);
    expect(() =>
      store.evidence.saveWeb(baseEvidence({ taskId: fixture.taskId, runId: 'nonexistent-run' })),
    ).toThrow('Evidence Run does not exist');
  });

  it('saveMcp also validates Run-Task ownership', () => {
    const store = openStore();
    const fixture = createFixture(store);
    expect(() =>
      store.evidence.saveMcp(baseEvidence({ taskId: fixture.taskId, runId: 'nonexistent-run' })),
    ).toThrow('Evidence Run does not exist');
  });
});

describe('EvidenceRepository get and listByTask', () => {
  it('get returns undefined for a missing id', () => {
    const store = openStore();
    expect(store.evidence.get('nonexistent')).toBeUndefined();
  });

  it('get retrieves a saved evidence by id', () => {
    const store = openStore();
    const fixture = createFixture(store);
    store.evidence.saveLocal(baseEvidence({ taskId: fixture.taskId, runId: fixture.runId }));
    const list = store.evidence.listByTask(fixture.taskId);
    const loaded = store.evidence.get(list[0]!.id);
    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(list[0]!.id);
    expect(loaded!.sourceType).toBe('local-file');
  });

  it('listByTask returns entries in descending captured_at order', () => {
    const store = openStore();
    const fixture = createFixture(store);
    for (let i = 0; i < 3; i++) {
      store.evidence.saveLocal(
        baseEvidence({
          taskId: fixture.taskId,
          runId: fixture.runId,
          sourceUri: `file:///doc-${i}.txt`,
        }),
      );
    }
    const list = store.evidence.listByTask(fixture.taskId);
    expect(list).toHaveLength(3);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1]!.capturedAt).toBeGreaterThanOrEqual(list[i]!.capturedAt);
    }
  });

  it('listByTask returns empty array for a task with no evidence', () => {
    const store = openStore();
    expect(store.evidence.listByTask('no-such-task')).toEqual([]);
  });

  it('listByTask isolates evidence by task', () => {
    const store = openStore();
    const fixture = createFixture(store);
    const { task: task2, sessionId: session2 } = store.tasks.create(
      fixture.workspaceId,
      'Task 2',
      'Goal 2',
    );
    const runId2 = 'run-2';
    store.runs.create({
      id: runId2,
      taskId: task2.id,
      sessionId: session2,
      prompt: 'prompt 2',
      status: 'running',
      createdAt: Date.now(),
    });
    store.evidence.saveLocal(baseEvidence({ taskId: fixture.taskId, runId: fixture.runId }));
    store.evidence.saveLocal(baseEvidence({ taskId: task2.id, runId: runId2 }));
    expect(store.evidence.listByTask(fixture.taskId)).toHaveLength(1);
    expect(store.evidence.listByTask(task2.id)).toHaveLength(1);
  });
});

describe('EvidenceRepository saveKnowledge: SHA-256 dedupe key', () => {
  it('saves knowledge evidence with a dedupe key and returns the summary', () => {
    const store = openStore();
    const fixture = createFixture(store);
    const saved = store.evidence.saveKnowledge({
      ...baseEvidence({ taskId: fixture.taskId, runId: fixture.runId }),
      knowledgeSource: baseKnowledgeSource(),
    });
    expect(saved.id).toBeTruthy();
    expect(saved.taskId).toBe(fixture.taskId);
    expect(saved.runId).toBe(fixture.runId);
    expect(saved.sourceType).toBe('local-file');
    expect(saved.knowledgeSource).toBeDefined();
    expect(saved.knowledgeSource!.reference.kind).toBe('knowledge-revision');
    expect(saved.knowledgeSource!.reference.knowledgeDocumentId).toBe('doc-1');
    expect(saved.knowledgeSource!.reference.knowledgeRevisionId).toBe('rev-1');
    expect(saved.knowledgeSource!.span.sectionOrdinal).toBe(0);
    expect(saved.knowledgeSource!.operation).toBe('search');
  });

  it('returns the existing evidence on duplicate dedupe key (idempotent)', () => {
    const store = openStore();
    const fixture = createFixture(store);
    const input = {
      ...baseEvidence({ taskId: fixture.taskId, runId: fixture.runId }),
      knowledgeSource: baseKnowledgeSource(),
    };
    const first = store.evidence.saveKnowledge(input);
    const second = store.evidence.saveKnowledge(input);
    expect(second.id).toBe(first.id);
    expect(store.evidence.listByTask(fixture.taskId)).toHaveLength(1);
  });

  it('creates separate evidence for different excerpts (different excerptHash)', () => {
    const store = openStore();
    const fixture = createFixture(store);
    const first = store.evidence.saveKnowledge({
      ...baseEvidence({ taskId: fixture.taskId, runId: fixture.runId, excerpt: 'Excerpt A' }),
      knowledgeSource: baseKnowledgeSource(),
    });
    const second = store.evidence.saveKnowledge({
      ...baseEvidence({
        taskId: fixture.taskId,
        runId: fixture.runId,
        sourceUri: 'file:///doc-2.txt',
        locator: 'line 5',
        excerpt: 'Excerpt B',
      }),
      knowledgeSource: baseKnowledgeSource(),
    });
    expect(first.id).not.toBe(second.id);
    expect(store.evidence.listByTask(fixture.taskId)).toHaveLength(2);
  });

  it('creates separate evidence for different revisions', () => {
    const store = openStore();
    const fixture = createFixture(store);
    const source1 = baseKnowledgeSource();
    const source2: KnowledgeEvidenceSource = {
      ...source1,
      reference: { ...source1.reference, knowledgeRevisionId: 'rev-2', contentHash: 'hash-2' },
    };
    const first = store.evidence.saveKnowledge({
      ...baseEvidence({ taskId: fixture.taskId, runId: fixture.runId }),
      knowledgeSource: source1,
    });
    const second = store.evidence.saveKnowledge({
      ...baseEvidence({
        taskId: fixture.taskId,
        runId: fixture.runId,
        sourceUri: 'file:///doc-v2.txt',
        locator: 'line 10',
      }),
      knowledgeSource: source2,
    });
    expect(first.id).not.toBe(second.id);
  });

  it('throws when the run does not exist', () => {
    const store = openStore();
    const fixture = createFixture(store);
    expect(() =>
      store.evidence.saveKnowledge({
        ...baseEvidence({ taskId: fixture.taskId, runId: 'nonexistent-run' }),
        knowledgeSource: baseKnowledgeSource(),
      }),
    ).toThrow('Evidence Run does not exist');
  });

  it('throws when the run belongs to a different task', () => {
    const store = openStore();
    const fixture = createFixture(store);
    const workspace2 = store.workspaces.create('/tmp/test-ws-2', 'Workspace 2');
    const { task: task2, sessionId: session2 } = store.tasks.create(
      workspace2.id,
      'Task 2',
      'Goal 2',
    );
    expect(() =>
      store.evidence.saveKnowledge({
        ...baseEvidence({ taskId: task2.id, runId: fixture.runId }),
        knowledgeSource: baseKnowledgeSource(),
      }),
    ).toThrow('Evidence Run does not belong to task');
    void session2;
  });
});

describe('knowledgeEvidenceDedupeKey', () => {
  it('produces a stable SHA-256 hex digest', () => {
    const source = baseKnowledgeSource();
    const excerptHash = createHash('sha256').update('test excerpt').digest('hex');
    const key1 = knowledgeEvidenceDedupeKey({ runId: 'run-1', source, excerptHash });
    const key2 = knowledgeEvidenceDedupeKey({ runId: 'run-1', source, excerptHash });
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different keys for different runIds', () => {
    const source = baseKnowledgeSource();
    const excerptHash = createHash('sha256').update('test').digest('hex');
    const key1 = knowledgeEvidenceDedupeKey({ runId: 'run-1', source, excerptHash });
    const key2 = knowledgeEvidenceDedupeKey({ runId: 'run-2', source, excerptHash });
    expect(key1).not.toBe(key2);
  });

  it('produces different keys for different revisions', () => {
    const excerptHash = createHash('sha256').update('test').digest('hex');
    const source1 = baseKnowledgeSource();
    const source2: KnowledgeEvidenceSource = {
      ...source1,
      reference: { ...source1.reference, knowledgeRevisionId: 'rev-2' },
    };
    const key1 = knowledgeEvidenceDedupeKey({ runId: 'run-1', source: source1, excerptHash });
    const key2 = knowledgeEvidenceDedupeKey({ runId: 'run-1', source: source2, excerptHash });
    expect(key1).not.toBe(key2);
  });

  it('produces different keys for different excerpt hashes', () => {
    const source = baseKnowledgeSource();
    const hash1 = createHash('sha256').update('excerpt A').digest('hex');
    const hash2 = createHash('sha256').update('excerpt B').digest('hex');
    const key1 = knowledgeEvidenceDedupeKey({ runId: 'run-1', source, excerptHash: hash1 });
    const key2 = knowledgeEvidenceDedupeKey({ runId: 'run-1', source, excerptHash: hash2 });
    expect(key1).not.toBe(key2);
  });

  it('produces different keys for different operations', () => {
    const source1 = baseKnowledgeSource();
    const source2: KnowledgeEvidenceSource = { ...source1, operation: 'read' };
    const excerptHash = createHash('sha256').update('test').digest('hex');
    const key1 = knowledgeEvidenceDedupeKey({ runId: 'run-1', source: source1, excerptHash });
    const key2 = knowledgeEvidenceDedupeKey({ runId: 'run-1', source: source2, excerptHash });
    expect(key1).not.toBe(key2);
  });

  it('produces different keys for different spans', () => {
    const source1 = baseKnowledgeSource();
    const source2: KnowledgeEvidenceSource = {
      ...source1,
      span: { sectionOrdinal: 1, start: 0, end: 50 },
    };
    const excerptHash = createHash('sha256').update('test').digest('hex');
    const key1 = knowledgeEvidenceDedupeKey({ runId: 'run-1', source: source1, excerptHash });
    const key2 = knowledgeEvidenceDedupeKey({ runId: 'run-1', source: source2, excerptHash });
    expect(key1).not.toBe(key2);
  });
});
