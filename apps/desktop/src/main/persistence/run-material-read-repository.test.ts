import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type MaterialReference, materialReferenceFingerprint } from '@betterwork/agent-protocol';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('RunMaterialReadRepository', () => {
  it('requires scoped reads to match the exact selected material and hash', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/material-read-scope', '材料范围');
    const task = store.tasks.create(workspace.id, '材料任务', '验证读取范围');
    const context = store.taskContexts.save(task.task.id, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [
        {
          reference: {
            kind: 'knowledge-revision',
            knowledgeDocumentId: 'rules',
            knowledgeRevisionId: 'rules-v1',
            contentHash: 'rules-hash',
            sourcePath: '/tmp/rules.md',
          },
          purpose: 'rule',
          addedFrom: 'workspace-candidate',
        },
      ],
    });
    const runId = 'run-material-read-scope';
    store.runs.create({
      id: runId,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '读取规则',
      status: 'running',
      createdAt: 1,
    });
    store.runContextSnapshots.create({
      runId,
      taskId: task.task.id,
      workspaceId: workspace.id,
      taskContextRevisionId: context.id,
      contextSegmentId: 'segment-1',
      materials: context.materials ?? [],
      createdAt: 2,
    });

    expect(() =>
      store.materialReads.save({
        id: 'read-outside-scope',
        runId,
        material: {
          kind: 'knowledge-revision',
          knowledgeDocumentId: 'other',
          knowledgeRevisionId: 'other-v1',
          contentHash: 'other-hash',
          sourcePath: '/tmp/other.md',
        },
        operation: 'read',
        locator: '全文',
        contentHash: 'other-hash',
        capturedAt: 3,
      }),
    ).toThrow('Run material read is outside the snapshot scope');
  });

  it('keeps unscoped legacy runs compatible', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/material-read-legacy', '旧任务');
    const task = store.tasks.create(workspace.id, '旧任务', '兼容通用助手');
    store.runs.create({
      id: 'run-material-read-legacy',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '搜索',
      status: 'running',
      createdAt: 1,
    });
    store.materialReads.save({
      id: 'read-legacy',
      runId: 'run-material-read-legacy',
      material: {
        kind: 'knowledge-revision',
        knowledgeDocumentId: 'rules',
        knowledgeRevisionId: 'rules-v1',
        contentHash: 'rules-hash',
        sourcePath: '/tmp/rules.md',
      },
      operation: 'search',
      locator: '全文',
      contentHash: 'rules-hash',
      capturedAt: 2,
    });
    expect(store.materialReads.listByRun('run-material-read-legacy')).toHaveLength(1);
  });

  it('rejects a scoped read with forged material metadata', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/material-read-metadata', '材料元数据');
    const task = store.tasks.create(workspace.id, '材料任务', '验证材料身份');
    const material = {
      kind: 'knowledge-revision' as const,
      knowledgeDocumentId: 'rules',
      knowledgeRevisionId: 'rules-v1',
      contentHash: 'rules-hash',
      sourcePath: '/tmp/rules.md',
    };
    const context = store.taskContexts.save(task.task.id, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [{ reference: material, purpose: 'rule', addedFrom: 'workspace-candidate' }],
    });
    const runId = 'run-material-read-metadata';
    store.runs.create({
      id: runId,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '读取规则',
      status: 'running',
      createdAt: 1,
    });
    store.runContextSnapshots.create({
      runId,
      taskId: task.task.id,
      workspaceId: workspace.id,
      taskContextRevisionId: context.id,
      contextSegmentId: 'segment-1',
      materials: context.materials ?? [],
      createdAt: 2,
    });

    expect(() =>
      store.materialReads.save({
        id: 'read-forged-metadata',
        runId,
        material: { ...material, sourcePath: '/tmp/forged.md' },
        operation: 'read',
        locator: '全文',
        contentHash: material.contentHash,
        capturedAt: 3,
      }),
    ).toThrow('Run material read is outside the snapshot scope');
  });
});

const scopedRun = (reference: MaterialReference, databasePath = ':memory:') => {
  const store = AppStore.open(databasePath);
  stores.push(store);
  const workspace = store.workspaces.getOrCreate('/tmp/identity-fixture', 'Identity');
  const task = store.tasks.create(workspace.id, 'Identity', 'Read scope');
  const runId = 'identity-run';
  store.runs.create({
    id: runId,
    taskId: task.task.id,
    sessionId: task.sessionId,
    prompt: 'Read',
    status: 'running',
    createdAt: 1,
  });
  store.runContextSnapshots.create({
    runId,
    taskId: task.task.id,
    workspaceId: workspace.id,
    contextSegmentId: 'identity-segment',
    materials: [{ reference, purpose: 'background', addedFrom: 'user-input' }],
    createdAt: 2,
  });
  return { store, runId };
};
const exactReferences: MaterialReference[] = [
  {
    kind: 'knowledge-revision',
    knowledgeDocumentId: 'doc',
    knowledgeRevisionId: 'revision',
    contentHash: 'hash',
    sourcePath: '/source.md',
    originWorkspaceId: 'origin',
  },
  {
    kind: 'artifact-version',
    artifactId: 'artifact',
    artifactVersionId: 'version',
    contentHash: 'hash',
    originWorkspaceId: 'origin',
  },
  {
    kind: 'workspace-input-snapshot',
    snapshotId: 'snapshot',
    workspaceId: 'origin',
    contentHash: 'hash',
    format: 'markdown',
    fileKey: 'input.md',
    sourcePath: '/original.md',
  },
];

describe('material identity persistence', () => {
  it.each(exactReferences)('keeps fingerprints and rejects forged scope for $kind', (reference) => {
    const { store, runId } = scopedRun(reference);
    const read = {
      id: 'exact-read',
      runId,
      material: reference,
      operation: 'read' as const,
      locator: 'document',
      contentHash: reference.contentHash,
      capturedAt: 3,
    };
    store.materialReads.save(read);
    store.materialReads.save({ ...read, id: 'duplicate' });
    expect(store.materialReads.listByRun(runId)).toHaveLength(1);
    expect(
      store.materialReads.hasMaterialRead(
        runId,
        materialReferenceFingerprint(reference),
        reference.contentHash,
      ),
    ).toBe(true);
    expect(store.materialReads.hasBodyRead(runId, reference)).toBe(true);
    expect(store.materialReads.hasBodyRead('other-run', reference)).toBe(false);
    const forged = { ...reference, contentHash: 'forged' };
    expect(store.materialReads.hasBodyRead(runId, forged)).toBe(false);
    expect(() =>
      store.materialReads.save({ ...read, id: 'forged', material: forged, contentHash: 'forged' }),
    ).toThrow('outside the snapshot scope');
    const foreign =
      reference.kind === 'workspace-input-snapshot'
        ? { ...reference, workspaceId: 'foreign' }
        : { ...reference, originWorkspaceId: 'foreign' };
    expect(store.materialReads.hasBodyRead(runId, foreign)).toBe(false);
    expect(() => store.materialReads.save({ ...read, id: 'foreign', material: foreign })).toThrow(
      'outside the snapshot scope',
    );
  });

  it('recognizes historical field order and input display paths without rewriting rows', () => {
    const reference = exactReferences[2]!;
    const directory = mkdtempSync(path.join(tmpdir(), 'betterwork-identity-'));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const databasePath = path.join(directory, 'app.db');
    const { store, runId } = scopedRun(reference, databasePath);
    store.materialReads.save({
      id: 'historical-read',
      runId,
      material: reference,
      operation: 'parse',
      locator: 'document',
      contentHash: reference.contentHash,
      capturedAt: 3,
    });
    const database = new Database(databasePath);
    try {
      const historicalJson = JSON.stringify(
        Object.fromEntries(Object.entries(reference).reverse()),
      );
      database
        .prepare('UPDATE run_material_reads SET material_json = ? WHERE id = ?')
        .run(historicalJson, 'historical-read');
      const withoutPath = { ...reference };
      if (withoutPath.kind === 'workspace-input-snapshot') delete withoutPath.sourcePath;
      expect(store.materialReads.hasBodyRead(runId, withoutPath)).toBe(true);
      expect(store.materialReads.hasBodyRead(runId, { ...withoutPath, contentHash: 'wrong' })).toBe(
        false,
      );
      expect(
        database
          .prepare('SELECT material_json FROM run_material_reads WHERE id = ?')
          .get('historical-read'),
      ).toEqual({ material_json: historicalJson });
      database
        .prepare('UPDATE run_material_reads SET material_json = ? WHERE id = ?')
        .run('{broken', 'historical-read');
      expect(store.materialReads.hasBodyRead(runId, withoutPath)).toBe(false);
    } finally {
      database.close();
    }
  });

  it('excludes search-only footprints', () => {
    const reference = exactReferences[1]!;
    const { store, runId } = scopedRun(reference);
    store.materialReads.save({
      id: 'search-only',
      runId,
      material: reference,
      operation: 'search',
      locator: 'document',
      contentHash: reference.contentHash,
      capturedAt: 3,
    });
    expect(store.materialReads.hasBodyRead(runId, reference)).toBe(false);
  });
});
