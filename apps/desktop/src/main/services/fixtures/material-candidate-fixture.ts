import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AppStore, type InputSnapshot } from '../../persistence';
import { InputSnapshotService } from '../input-snapshot-service';
import { KnowledgeVault } from '../knowledge-vault';
import { TaskMaterialService } from '../task-material-service';

interface MaterialCandidateFixture {
  store: AppStore;
  vault: KnowledgeVault;
  inputSnapshots: InputSnapshotService;
  service: TaskMaterialService;
  workspaceId: string;
  foreignWorkspaceId: string;
  taskId: string;
  snapshots: InputSnapshot[];
  close: () => void;
}

export async function createMaterialCandidateFixture(options: {
  documents: number;
  revisions: number;
  artifacts: number;
  versions: number;
  assets: number;
  snapshotsPerAsset: number;
  bodyBytes: number;
  assetBytes: number;
}): Promise<MaterialCandidateFixture> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'betterwork-candidate-fixture-'));
  const store = AppStore.open(':memory:');
  const vault = new KnowledgeVault(path.join(root, 'vault.sqlite'));
  const close = (): void => {
    vault.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  };
  try {
    const workspace = store.workspaces.create(root, 'candidate workspace');
    const foreign = store.workspaces.create(path.join(root, 'foreign'), 'foreign workspace');
    const task = store.tasks.create(workspace.id, 'candidate task', 'synthetic task');
    const foreignTask = store.tasks.create(foreign.id, 'foreign task', 'synthetic task');
    store.runs.create({
      id: 'candidate-run',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'synthetic run',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });
    for (let document = 0; document < options.documents; document++) {
      const sourcePath = path.join(root, `knowledge-${document}.txt`);
      for (let revision = 0; revision < options.revisions; revision++) {
        writeFileSync(sourcePath, `${revision}:` + 'k'.repeat(options.bodyBytes));
        await vault.importPaths([sourcePath]);
      }
    }
    store.transaction(() => {
      for (let index = 0; index < options.artifacts; index++) {
        const owner = index % 2 === 0 ? task : foreignTask;
        let artifactId: string | undefined;
        for (let version = 0; version < options.versions; version++) {
          const artifact = store.artifacts.saveMarkdown({
            ...(artifactId ? { artifactId } : {}),
            taskId: owner.task.id,
            title: `artifact-${index}`,
            content: `${version}:` + 'a'.repeat(options.bodyBytes),
            origin: 'user-edit',
          });
          artifactId = artifact.id;
        }
      }
    });
    const snapshots: InputSnapshot[] = [];
    for (let asset = 0; asset < options.assets; asset++) {
      const bytes = Buffer.alloc(options.assetBytes, asset);
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      const fileKey = `input-snapshots/${contentHash}/content`;
      mkdirSync(path.dirname(path.join(root, fileKey)), { recursive: true });
      writeFileSync(path.join(root, fileKey), bytes);
      for (const owner of [workspace, foreign]) {
        for (let copy = 0; copy < options.snapshotsPerAsset; copy++) {
          const preparing = store.inputSnapshots.createPreparing({
            workspaceId: owner.id,
            sourcePath: `source-${asset}-${copy}.txt`,
            contentHash,
            byteSize: bytes.byteLength,
            format: 'txt',
            fileKey,
            createdAt: asset * options.snapshotsPerAsset + copy,
          });
          const snapshot = store.inputSnapshots.markReady(preparing.id, preparing.createdAt);
          if (!snapshot) throw new Error('Snapshot fixture was not ready');
          if (owner.id === workspace.id) snapshots.push(snapshot);
        }
      }
    }
    const inputSnapshots = new InputSnapshotService(store, root);
    return {
      store,
      vault,
      inputSnapshots,
      service: new TaskMaterialService({ store, knowledgeVault: vault, inputSnapshots }),
      workspaceId: workspace.id,
      foreignWorkspaceId: foreign.id,
      taskId: task.task.id,
      snapshots,
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
