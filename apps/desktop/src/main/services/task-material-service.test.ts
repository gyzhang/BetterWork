import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
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
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('TaskMaterialService', () => {
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
    vault.close();
  });
});
