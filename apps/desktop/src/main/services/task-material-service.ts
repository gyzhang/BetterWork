import path from 'node:path';

import type {
  MaterialCandidate,
  MaterialReference,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';

import type { AppStore, InputSnapshot } from '../persistence';
import { InputSnapshotError, type InputSnapshotService } from './input-snapshot-service';
import type { KnowledgeVault } from './knowledge-vault';

export type TaskMaterialErrorCode =
  | 'task_not_found'
  | 'material_reference_duplicate'
  | 'material_revision_missing'
  | 'material_revision_conflict'
  | 'material_artifact_missing'
  | 'material_artifact_conflict'
  | 'material_snapshot_missing'
  | 'material_snapshot_not_ready'
  | 'material_snapshot_corrupt'
  | 'material_workspace_mismatch';

export class TaskMaterialError extends Error {
  constructor(
    readonly code: TaskMaterialErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TaskMaterialError';
  }
}

export interface TaskMaterialServiceDependencies {
  store: AppStore;
  knowledgeVault: KnowledgeVault;
  inputSnapshots: InputSnapshotService;
}

const materialKey = (reference: MaterialReference): string => {
  switch (reference.kind) {
    case 'knowledge-revision':
      return `${reference.kind}:${reference.knowledgeRevisionId}`;
    case 'artifact-version':
      return `${reference.kind}:${reference.artifactVersionId}`;
    case 'workspace-input-snapshot':
      return `${reference.kind}:${reference.snapshotId}`;
  }
};

const artifactContentHash = (artifactId: string, versionId: string, store: AppStore): string => {
  const detail = store.artifacts.getVersionDetail(versionId);
  if (!detail || detail.artifactId !== artifactId) {
    throw new TaskMaterialError('material_artifact_missing', '成果版本不存在或不属于该成果。');
  }
  return detail.type === 'markdown' ? detail.contentHash : detail.fileHash;
};

export class TaskMaterialService {
  constructor(private readonly dependencies: TaskMaterialServiceDependencies) {}

  async listCandidates(taskId: string): Promise<MaterialCandidate[]> {
    const workspaceId = this.workspaceId(taskId);
    const candidates: MaterialCandidate[] = [];
    for (const document of this.dependencies.knowledgeVault.listDocuments()) {
      for (const revision of this.dependencies.knowledgeVault.listRevisions(document.id)) {
        const reference: MaterialReference = {
          kind: 'knowledge-revision',
          knowledgeDocumentId: document.id,
          knowledgeRevisionId: revision.id,
          contentHash: revision.contentHash,
          sourcePath: revision.sourcePath,
        };
        candidates.push({
          reference,
          title: revision.title,
          sourceLabel: `知识 · ${path.basename(revision.sourcePath)}`,
          status: 'ready',
          detail: `修订 v${revision.revision}`,
        });
      }
    }
    for (const artifact of this.dependencies.store.artifacts.listByWorkspace(workspaceId)) {
      for (const version of this.dependencies.store.artifacts.listVersions(artifact.id)) {
        const detail = this.dependencies.store.artifacts.getVersionDetail(version.id);
        if (!detail) {
          candidates.push({
            reference: {
              kind: 'artifact-version',
              artifactId: artifact.id,
              artifactVersionId: version.id,
              contentHash: 'unavailable',
              originWorkspaceId: artifact.workspaceId,
            },
            title: artifact.title,
            sourceLabel: `成果 · ${artifact.title}`,
            status: 'unavailable',
            detail: `v${version.versionNumber} 不可读取`,
          });
          continue;
        }
        candidates.push({
          reference: {
            kind: 'artifact-version',
            artifactId: artifact.id,
            artifactVersionId: version.id,
            contentHash: detail.type === 'markdown' ? detail.contentHash : detail.fileHash,
            originWorkspaceId: artifact.workspaceId,
          },
          title: artifact.title,
          sourceLabel: `成果 · ${artifact.title}`,
          status: 'ready',
          detail: `v${version.versionNumber}`,
        });
      }
    }
    for (const snapshot of this.dependencies.store.inputSnapshots.list('ready')) {
      if (snapshot.workspaceId !== workspaceId) continue;
      const available = await this.dependencies.inputSnapshots.verify(snapshot);
      candidates.push({
        reference: {
          kind: 'workspace-input-snapshot',
          snapshotId: snapshot.id,
          workspaceId: snapshot.workspaceId,
          contentHash: snapshot.contentHash,
          format: snapshot.format,
          fileKey: snapshot.fileKey,
        },
        title: path.basename(snapshot.sourcePath),
        sourceLabel: `工作区文件 · ${snapshot.sourcePath}`,
        status: available ? 'ready' : 'unavailable',
        ...(available ? {} : { detail: '输入快照缺失或哈希不匹配' }),
      });
    }
    return candidates;
  }

  async prepareInputSnapshot(taskId: string, sourcePath: string): Promise<InputSnapshot> {
    const workspaceId = this.dependencies.store.tasks.getWorkspaceId(taskId);
    if (!workspaceId) throw new TaskMaterialError('task_not_found', '任务不存在。');
    const workspace = this.dependencies.store.workspaces.get(workspaceId);
    if (!workspace) throw new TaskMaterialError('task_not_found', '任务工作空间不存在。');
    try {
      const receipt = await this.dependencies.inputSnapshots.create({
        workspaceId: workspace.id,
        workspaceRoot: workspace.rootPath,
        sourcePath,
      });
      return receipt.snapshot;
    } catch (error) {
      if (error instanceof InputSnapshotError) throw error;
      throw new TaskMaterialError('material_snapshot_missing', '无法准备输入快照。');
    }
  }

  async validateSelections(
    taskId: string,
    selections: readonly TaskMaterialSelection[],
  ): Promise<void> {
    const workspaceId = this.workspaceId(taskId);
    const seen = new Set<string>();
    for (const selection of selections) {
      const key = materialKey(selection.reference);
      if (seen.has(key)) {
        throw new TaskMaterialError(
          'material_reference_duplicate',
          '同一材料不能重复加入本次任务。',
        );
      }
      seen.add(key);
      await this.validateReference(workspaceId, selection);
    }
  }

  private async validateReference(
    workspaceId: string,
    selection: TaskMaterialSelection,
  ): Promise<void> {
    const { reference } = selection;
    if (reference.kind === 'knowledge-revision') {
      const revision = this.dependencies.knowledgeVault.getRevision(reference.knowledgeRevisionId);
      if (!revision || revision.documentId !== reference.knowledgeDocumentId) {
        throw new TaskMaterialError('material_revision_missing', '知识内容修订不存在。');
      }
      if (revision.contentHash !== reference.contentHash) {
        throw new TaskMaterialError(
          'material_revision_conflict',
          '知识内容已变化，请重新选择修订。',
        );
      }
      return;
    }
    if (reference.kind === 'artifact-version') {
      if (reference.originWorkspaceId !== workspaceId && selection.addedFrom !== 'global-search') {
        throw new TaskMaterialError(
          'material_workspace_mismatch',
          '成果来自其他工作空间，请通过显式来源入口重新选择。',
        );
      }
      const contentHash = artifactContentHash(
        reference.artifactId,
        reference.artifactVersionId,
        this.dependencies.store,
      );
      if (contentHash !== reference.contentHash) {
        throw new TaskMaterialError(
          'material_artifact_conflict',
          '成果版本内容已变化，请重新选择。',
        );
      }
      return;
    }
    if (reference.workspaceId !== workspaceId) {
      throw new TaskMaterialError('material_workspace_mismatch', '输入文件必须属于当前工作空间。');
    }
    const snapshot = this.dependencies.store.inputSnapshots.get(reference.snapshotId);
    if (!snapshot) throw new TaskMaterialError('material_snapshot_missing', '输入快照不存在。');
    if (snapshot.status !== 'ready') {
      throw new TaskMaterialError('material_snapshot_not_ready', '输入快照尚未准备完成。');
    }
    if (
      snapshot.contentHash !== reference.contentHash ||
      snapshot.fileKey !== reference.fileKey ||
      !(await this.dependencies.inputSnapshots.verify(snapshot))
    ) {
      throw new TaskMaterialError(
        'material_snapshot_corrupt',
        '输入快照缺失或哈希不匹配，请重新选择文件。',
      );
    }
  }

  private workspaceId(taskId: string): string {
    const workspaceId = this.dependencies.store.tasks.getWorkspaceId(taskId);
    if (!workspaceId) throw new TaskMaterialError('task_not_found', '任务不存在。');
    return workspaceId;
  }
}

export { materialKey };
