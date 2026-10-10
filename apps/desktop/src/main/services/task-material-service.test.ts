import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { MaterialCandidate } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import { createMaterialCandidateFixture } from './fixtures/material-candidate-fixture';
import { InputSnapshotService } from './input-snapshot-service';
import { KnowledgeVault } from './knowledge-vault';
import { TaskMaterialService } from './task-material-service';

const stores: AppStore[] = [];
const directories: string[] = [];

const temporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('TaskMaterialService', () => {
  it('preserves every exact revision and version in legacy order using metadata projections', async () => {
    const f = await createMaterialCandidateFixture({
      documents: 2,
      revisions: 2,
      artifacts: 4,
      versions: 3,
      assets: 2,
      snapshotsPerAsset: 2,
      bodyBytes: 1024,
      assetBytes: 1024,
    });
    try {
      const expected: MaterialCandidate[] = [];
      for (const document of f.vault.listDocuments()) {
        for (const revision of f.vault.listRevisions(document.id)) {
          expected.push({
            reference: {
              kind: 'knowledge-revision',
              knowledgeDocumentId: document.id,
              knowledgeRevisionId: revision.id,
              contentHash: revision.contentHash,
              sourcePath: revision.sourcePath,
            },
            title: revision.title,
            sourceLabel: `知识 · ${path.basename(revision.sourcePath)}`,
            status: 'ready',
            detail: `修订 v${revision.revision}`,
          });
        }
      }
      for (const artifact of f.store.artifacts.list()) {
        for (const version of f.store.artifacts.listVersions(artifact.id)) {
          const detail = f.store.artifacts.getVersionDetail(version.id)!;
          expected.push({
            reference: {
              kind: 'artifact-version',
              artifactId: artifact.id,
              artifactVersionId: version.id,
              contentHash: detail.type === 'markdown' ? detail.contentHash : detail.fileHash,
              originWorkspaceId: artifact.workspaceId,
            },
            title: artifact.title,
            sourceLabel:
              artifact.workspaceId === f.workspaceId
                ? `成果 · ${artifact.title}`
                : `成果 · ${artifact.title} · 其他工作空间`,
            status: 'ready',
            detail: `v${version.versionNumber}`,
          });
        }
      }
      const listDocuments = vi.spyOn(f.vault, 'listDocuments');
      const listRevisions = vi.spyOn(f.vault, 'listRevisions');
      const listArtifacts = vi.spyOn(f.store.artifacts, 'list');
      const listVersions = vi.spyOn(f.store.artifacts, 'listVersions');
      const detail = vi.spyOn(f.store.artifacts, 'getVersionDetail');
      const snapshots = vi.spyOn(f.store.inputSnapshots, 'list');
      const candidates = await f.service.listCandidates(f.taskId);
      expect(
        candidates.filter((candidate) => candidate.reference.kind !== 'workspace-input-snapshot'),
      ).toEqual(expected);
      for (const spy of [
        listDocuments,
        listRevisions,
        listArtifacts,
        listVersions,
        detail,
        snapshots,
      ]) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(f.vault.listMaterialRevisions()).toHaveLength(4);
      expect(f.store.artifacts.listMaterialVersions()).toHaveLength(12);
      expect(f.vault.listMaterialRevisions().every((revision) => !('content' in revision))).toBe(
        true,
      );
      expect(
        f.store.artifacts
          .listMaterialVersions()
          .every((version) => !('content' in version) && !('evidence' in version)),
      ).toBe(true);
      const selected = expected.find(
        (candidate) =>
          candidate.reference.kind === 'artifact-version' &&
          candidate.reference.originWorkspaceId === f.foreignWorkspaceId,
      )!;
      await expect(
        f.service.validateSelections(f.taskId, [
          {
            reference: selected.reference,
            purpose: 'background',
            addedFrom: 'workspace-candidate',
          },
        ]),
      ).rejects.toMatchObject({ code: 'material_workspace_mismatch' });
      await expect(
        f.service.validateSelections(f.taskId, [
          { reference: selected.reference, purpose: 'background', addedFrom: 'global-search' },
        ]),
      ).resolves.toBeUndefined();
    } finally {
      f.close();
    }
  });

  it('shares only identical asset checks within a request and rechecks corruption before saving', async () => {
    const f = await createMaterialCandidateFixture({
      documents: 0,
      revisions: 0,
      artifacts: 0,
      versions: 0,
      assets: 1,
      snapshotsPerAsset: 3,
      bodyBytes: 0,
      assetBytes: 1024,
    });
    try {
      const original = f.snapshots[0]!;
      for (const override of [
        { byteSize: original.byteSize + 1 },
        { contentHash: 'wrong-hash' },
        { fileKey: 'input-snapshots/missing/content' },
      ]) {
        const snapshot = f.store.inputSnapshots.createPreparing({
          ...original,
          ...override,
          id: randomUUID(),
        });
        f.store.inputSnapshots.markReady(snapshot.id, original.createdAt);
      }
      const verify = vi.spyOn(f.inputSnapshots, 'verify');
      const first = await f.service.listCandidatesForWorkspace(f.workspaceId);
      expect(first).toHaveLength(6);
      expect(first.filter((candidate) => candidate.status === 'ready')).toHaveLength(3);
      expect(verify).toHaveBeenCalledTimes(4);
      expect(verify.mock.calls.every(([snapshot]) => snapshot.workspaceId === f.workspaceId)).toBe(
        true,
      );
      expect(f.store.inputSnapshots.listReadyForWorkspace(f.workspaceId)).toHaveLength(6);
      writeFileSync(f.inputSnapshots.resolvePath(original), Buffer.alloc(original.byteSize, 255));
      verify.mockClear();
      const corrupt = await f.service.listCandidatesForWorkspace(f.workspaceId);
      expect(corrupt.every((candidate) => candidate.status === 'unavailable')).toBe(true);
      expect(corrupt.every((candidate) => candidate.detail === '输入快照缺失或哈希不匹配')).toBe(
        true,
      );
      expect(verify).toHaveBeenCalledTimes(4);
      const selected = first.find((candidate) => candidate.status === 'ready')!;
      await expect(
        f.service.validateSelections(f.taskId, [
          { reference: selected.reference, purpose: 'current-input', addedFrom: 'user-input' },
        ]),
      ).rejects.toMatchObject({ code: 'material_snapshot_corrupt' });
      expect(verify).toHaveBeenCalledTimes(5);
      rmSync(f.inputSnapshots.resolvePath(original));
      expect(
        (await f.service.listCandidatesForWorkspace(f.workspaceId)).every(
          (candidate) => candidate.status === 'unavailable',
        ),
      ).toBe(true);
      f.store.inputSnapshots.markFailed(original.id, 'snapshot_missing', 'synthetic failure', 3);
      expect(f.store.inputSnapshots.listReadyForWorkspace(f.workspaceId)).toHaveLength(5);
    } finally {
      f.close();
    }
  });

  it('preserves PPTX and missing-metadata availability without reading version details', async () => {
    const f = await createMaterialCandidateFixture({
      documents: 1,
      revisions: 2,
      artifacts: 0,
      versions: 0,
      assets: 0,
      snapshotsPerAsset: 0,
      bodyBytes: 32,
      assetBytes: 0,
    });
    try {
      const file = f.store.artifacts.registerFile({
        taskId: f.taskId,
        runId: 'candidate-run',
        title: 'presentation',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        fileSize: 128,
        fileHash: 'file-hash',
        fileKey: 'artifacts/synthetic.pptx',
        executionId: 'synthetic-execution',
        validation: { structure: 'passed', visual: 'not-checked', manualEdit: 'not-checked' },
      });
      const blank = f.store.artifacts.saveMarkdown({
        taskId: f.taskId,
        title: 'empty body',
        content: '',
        origin: 'user-edit',
      });
      const first = await f.service.listCandidatesForWorkspace(f.workspaceId);
      expect(first).toContainEqual(
        expect.objectContaining({
          reference: expect.objectContaining({
            artifactVersionId: file.versionId,
            contentHash: 'file-hash',
          }),
          status: 'ready',
          detail: 'v1 · PPTX',
        }),
      );
      expect(first).toContainEqual(
        expect.objectContaining({
          reference: expect.objectContaining({ artifactVersionId: blank.currentVersionId }),
          status: 'ready',
          detail: 'v1',
        }),
      );
      const db = (f.store as unknown as { db: Database.Database }).db;
      db.prepare('DELETE FROM artifact_files WHERE version_id = ?').run(file.versionId);
      const missing = await f.service.listCandidatesForWorkspace(f.workspaceId);
      expect(missing).toContainEqual(
        expect.objectContaining({
          reference: expect.objectContaining({
            artifactVersionId: file.versionId,
            contentHash: 'unavailable',
          }),
          status: 'unavailable',
          detail: 'v1 不可读取',
        }),
      );
      const document = f.vault.listDocuments()[0]!;
      const revision = f.vault.listRevisions(document.id)[0]!;
      f.vault.removeDocument(document.id);
      expect(f.vault.getRevision(revision.id)).toBeDefined();
      expect(f.vault.listMaterialRevisions()).toEqual([]);
      expect(
        (await f.service.listCandidatesForWorkspace(f.workspaceId)).filter(
          (candidate) => candidate.reference.kind === 'knowledge-revision',
        ),
      ).toEqual([]);
    } finally {
      f.close();
    }
  });

  it('returns an empty projection and rejects unknown Task or Workspace before reading candidates', async () => {
    const f = await createMaterialCandidateFixture({
      documents: 0,
      revisions: 0,
      artifacts: 0,
      versions: 0,
      assets: 0,
      snapshotsPerAsset: 0,
      bodyBytes: 0,
      assetBytes: 0,
    });
    try {
      expect(await f.service.listCandidates(f.taskId)).toEqual([]);
      const projection = vi.spyOn(f.vault, 'listMaterialRevisions');
      await expect(f.service.listCandidates('missing-task')).rejects.toMatchObject({
        code: 'task_not_found',
      });
      await expect(f.service.listCandidatesForWorkspace('missing-workspace')).rejects.toMatchObject(
        { code: 'task_not_found' },
      );
      expect(projection).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  });

  it('lists knowledge revisions and ready workspace snapshots as candidates', async () => {
    const root = temporaryDirectory('betterwork-material-workspace-');
    const userData = temporaryDirectory('betterwork-material-user-data-');
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate(root, '材料工作区');
    const task = store.tasks.create(workspace.id, '月报', '完成本月经营分析');
    const vault = new KnowledgeVault(path.join(userData, 'vault.sqlite'));
    const rules = path.join(root, '财务规则.md');
    writeFileSync(rules, '现金流口径必须统一。');
    const imported = (await vault.importPaths([rules])).imported[0];
    if (!imported) throw new Error('knowledge fixture was not imported');
    const input = path.join(root, '本月数据.csv');
    writeFileSync(input, 'month,revenue\n2026-09,100\n');
    const inputSnapshots = new InputSnapshotService(store, userData);
    const snapshot = await inputSnapshots.create({
      workspaceId: workspace.id,
      workspaceRoot: root,
      sourcePath: input,
    });
    const service = new TaskMaterialService({ store, knowledgeVault: vault, inputSnapshots });

    const candidates = await service.listCandidates(task.task.id);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: '财务规则',
          reference: expect.objectContaining({ kind: 'knowledge-revision' }),
          status: 'ready',
        }),
        expect.objectContaining({
          title: '本月数据.csv',
          reference: expect.objectContaining({ snapshotId: snapshot.snapshot.id }),
          status: 'ready',
        }),
      ]),
    );
    vault.close();
  });

  it('rejects duplicate, stale, and cross-workspace material selections', async () => {
    const root = temporaryDirectory('betterwork-material-workspace-');
    const userData = temporaryDirectory('betterwork-material-user-data-');
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate(root, '材料工作区');
    const task = store.tasks.create(workspace.id, '月报', '完成本月经营分析');
    const vault = new KnowledgeVault(path.join(userData, 'vault.sqlite'));
    const rules = path.join(root, '财务规则.md');
    writeFileSync(rules, '现金流口径必须统一。');
    const imported = (await vault.importPaths([rules])).imported[0];
    if (!imported) throw new Error('knowledge fixture was not imported');
    const revision = vault.listRevisions(imported.id)[0];
    if (!revision) throw new Error('knowledge revision fixture was not created');
    const inputSnapshots = new InputSnapshotService(store, userData);
    const service = new TaskMaterialService({ store, knowledgeVault: vault, inputSnapshots });
    const selection = {
      reference: {
        kind: 'knowledge-revision' as const,
        knowledgeDocumentId: imported.id,
        knowledgeRevisionId: revision.id,
        contentHash: revision.contentHash,
        sourcePath: revision.sourcePath,
      },
      purpose: 'rule' as const,
      addedFrom: 'global-search' as const,
    };
    await expect(
      service.validateSelections(task.task.id, [selection, selection]),
    ).rejects.toMatchObject({
      code: 'material_reference_duplicate',
    });
    await expect(
      service.validateSelections(task.task.id, [
        {
          ...selection,
          reference: { ...selection.reference, contentHash: 'stale-hash' },
        },
      ]),
    ).rejects.toMatchObject({ code: 'material_revision_conflict' });
    await expect(
      service.validateSelections(task.task.id, [
        {
          ...selection,
          reference: { ...selection.reference, sourcePath: '/other/workspace/rules.md' },
        },
      ]),
    ).rejects.toMatchObject({ code: 'material_revision_conflict' });
    await expect(
      service.validateSelections(task.task.id, [
        {
          reference: {
            kind: 'workspace-input-snapshot',
            snapshotId: 'foreign-snapshot',
            workspaceId: 'other-workspace',
            contentHash: 'hash',
            format: 'txt',
            fileKey: 'input-snapshots/hash/content',
          },
          purpose: 'current-input',
          addedFrom: 'user-input',
        },
      ]),
    ).rejects.toMatchObject({ code: 'material_workspace_mismatch' });

    const currentRunId = randomUUID();
    store.runs.create({
      id: currentRunId,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '生成当前工作区报告',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });
    const currentArtifact = store.artifacts.saveMarkdown({
      taskId: task.task.id,
      runId: currentRunId,
      title: '当前工作区报告',
      content: '# 当前工作区报告\n\n收入 120',
      origin: 'assistant-run',
    });
    const currentVersion = store.artifacts.getVersionDetail(currentArtifact.currentVersionId);
    if (!currentVersion || currentVersion.type !== 'markdown')
      throw new Error('current artifact fixture was not created');
    await expect(
      service.validateSelections(task.task.id, [
        {
          reference: {
            kind: 'artifact-version',
            artifactId: currentArtifact.id,
            artifactVersionId: currentVersion.id,
            contentHash: currentVersion.contentHash,
            originWorkspaceId: workspace.id,
          },
          purpose: 'historical-comparison',
          addedFrom: 'expert-reference',
        },
      ]),
    ).resolves.toBeUndefined();

    const otherRoot = temporaryDirectory('betterwork-material-other-workspace-');
    const otherWorkspace = store.workspaces.getOrCreate(otherRoot, '另一个工作区');
    const otherInput = path.join(otherRoot, '本月数据.csv');
    writeFileSync(otherInput, 'month,revenue\n2026-09,100\n');
    const foreignSnapshot = await inputSnapshots.create({
      workspaceId: otherWorkspace.id,
      workspaceRoot: otherRoot,
      sourcePath: otherInput,
    });
    await expect(
      service.validateSelections(task.task.id, [
        {
          reference: {
            kind: 'workspace-input-snapshot',
            snapshotId: foreignSnapshot.snapshot.id,
            workspaceId: workspace.id,
            contentHash: foreignSnapshot.snapshot.contentHash,
            format: foreignSnapshot.snapshot.format,
            fileKey: foreignSnapshot.snapshot.fileKey,
          },
          purpose: 'current-input',
          addedFrom: 'user-input',
        },
      ]),
    ).rejects.toMatchObject({ code: 'material_workspace_mismatch' });

    const otherTask = store.tasks.create(otherWorkspace.id, '上月报告', '准备上月报告');
    const otherRunId = randomUUID();
    store.runs.create({
      id: otherRunId,
      taskId: otherTask.task.id,
      sessionId: otherTask.sessionId,
      prompt: '生成上月报告',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });
    const artifact = store.artifacts.saveMarkdown({
      taskId: otherTask.task.id,
      runId: otherRunId,
      title: '上月经营报告',
      content: '# 上月经营报告\n\n收入 100',
      origin: 'assistant-run',
    });
    const version = store.artifacts.getVersionDetail(artifact.currentVersionId);
    if (!version || version.type !== 'markdown')
      throw new Error('artifact fixture was not created');
    await expect(
      service.validateSelections(task.task.id, [
        {
          reference: {
            kind: 'artifact-version',
            artifactId: artifact.id,
            artifactVersionId: version.id,
            contentHash: version.contentHash,
            originWorkspaceId: otherWorkspace.id,
          },
          purpose: 'historical-comparison',
          addedFrom: 'expert-reference',
        },
      ]),
    ).rejects.toMatchObject({ code: 'material_workspace_mismatch' });
    await expect(
      service.validateSelections(task.task.id, [
        {
          reference: {
            kind: 'artifact-version',
            artifactId: artifact.id,
            artifactVersionId: version.id,
            contentHash: version.contentHash,
            originWorkspaceId: workspace.id,
          },
          purpose: 'historical-comparison',
          addedFrom: 'expert-reference',
        },
      ]),
    ).rejects.toMatchObject({ code: 'material_workspace_mismatch' });
    vault.close();
  });
});
