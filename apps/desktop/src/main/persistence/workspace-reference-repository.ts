import { randomUUID } from 'node:crypto';

import {
  type MaterialReference,
  WORKSPACE_BRIEF_REFERENCE_ITEM_LIMIT,
  WORKSPACE_REFERENCE_ACTIVE_LIMIT,
  type WorkspaceArtifactReference,
  workspaceArtifactReferenceSchema,
  type WorkspaceReferenceListItem,
  workspaceReferenceListItemSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

import { MemoryConflictError, MemoryValidationError } from './memory-repository';

/** §10：被参考的精确版本不存在或不可读（REFERENCE_UNAVAILABLE）。 */
export class WorkspaceReferenceUnavailableError extends Error {
  constructor(message = '要参考的成果版本不存在或已不可读取。') {
    super(message);
    this.name = 'WorkspaceReferenceUnavailableError';
  }
}

/** §10：参考只允许同空间（REFERENCE_WORKSPACE_MISMATCH）。 */
export class WorkspaceReferenceMismatchError extends Error {
  constructor(message = '只能参考本工作空间自己的成果版本。') {
    super(message);
    this.name = 'WorkspaceReferenceMismatchError';
  }
}

/** §8.2：同一空间 active 标记上限 20（REFERENCE_LIMIT）。 */
export class WorkspaceReferenceLimitError extends Error {
  constructor(
    message = `本空间参考标记已达 ${WORKSPACE_REFERENCE_ACTIVE_LIMIT} 个上限，请先移除不再需要的。`,
  ) {
    super(message);
    this.name = 'WorkspaceReferenceLimitError';
  }
}

export interface SetReferenceInput {
  workspaceId: string;
  artifactVersionId: string;
  /** §10：新建传 0，更新传当前 revision；不跟随 latest。 */
  expectedRevision: number;
  label?: string;
  at?: number;
}

export interface ReferenceWriteOutcome {
  reference: WorkspaceArtifactReference;
  /** 现有 MaterialReference 由 Main 按已验证的精确版本构造，供 TaskContext 直接使用。 */
  material: MaterialReference;
  effect: 'created' | 'updated' | 'unchanged';
}

/** §8.3：本空间的成果版本被其他空间标记参考时，本空间不得被常规移除。 */
export interface WorkspaceReferenceDeletionImpact {
  workspaceId: string;
  blockingReferenceCount: number;
  foreignWorkspaceIds: string[];
  blocking: boolean;
}

interface ReferenceRow {
  id: string;
  workspace_id: string;
  artifact_version_id: string;
  content_hash: string;
  label: string | null;
  status: WorkspaceArtifactReference['status'];
  revision: number;
  selected_at: number;
  updated_at: number;
}

interface VersionRow {
  artifact_version_id: string;
  artifact_id: string;
  content_hash: string;
  workspace_id: string;
}

interface ListItemRow extends ReferenceRow {
  artifact_id: string;
  /** 精确版本行一定存在（artifact_version_id 是 RESTRICT 外键），哈希不符即不可用。 */
  version_hash: string;
}

const toReference = (row: ReferenceRow): WorkspaceArtifactReference =>
  workspaceArtifactReferenceSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    artifactVersionId: row.artifact_version_id,
    contentHash: row.content_hash,
    ...(row.label === null ? {} : { label: row.label }),
    status: row.status,
    revision: row.revision,
    selectedAt: row.selected_at,
    updatedAt: row.updated_at,
  });

/**
 * 成果精确版本参考标记（契约 §10、§8.2）。
 *
 * 标记只做「用户指定这一版」：contentHash 一律由 Main 从 artifact_versions 读回，
 * 不接受调用方自报；移除是状态变化而不是物理删除，历史简报仍可解释当时参考了哪一版。
 */
export class WorkspaceReferenceRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  set(input: SetReferenceInput): ReferenceWriteOutcome {
    const version = this.requireOwnedVersion(input.workspaceId, input.artifactVersionId);
    const existing = this.findRow(input.workspaceId, input.artifactVersionId);
    const now = input.at ?? this.clock();
    if (!existing) {
      if (input.expectedRevision !== 0) {
        throw new MemoryConflictError('该参考标记已存在或不存在，请重新加载后重试。');
      }
      this.assertActiveRoom(input.workspaceId);
      const created = workspaceArtifactReferenceSchema.parse({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        artifactVersionId: version.artifact_version_id,
        contentHash: version.content_hash,
        ...(input.label === undefined ? {} : { label: input.label }),
        status: 'active',
        revision: 1,
        selectedAt: now,
        updatedAt: now,
      });
      this.insert(created);
      return { reference: created, material: materialOf(version), effect: 'created' };
    }
    const reference = toReference(existing);
    if (reference.revision !== input.expectedRevision) {
      throw new MemoryConflictError(
        `期望参考修订 ${input.expectedRevision}，当前 ${reference.revision}。`,
      );
    }
    if (reference.contentHash !== version.content_hash) {
      // 版本行被改写意味着这条精确引用已不再对应当初的内容。
      throw new WorkspaceReferenceUnavailableError('该成果版本内容哈希已变化，请重新选择。');
    }
    if (reference.status === 'removed') {
      this.assertActiveRoom(input.workspaceId);
      const revived = workspaceArtifactReferenceSchema.parse({
        ...reference,
        label: input.label ?? reference.label,
        status: 'active',
        revision: reference.revision + 1,
        selectedAt: now,
        updatedAt: now,
      });
      this.update(revived);
      return { reference: revived, material: materialOf(version), effect: 'updated' };
    }
    const label = input.label ?? reference.label;
    if (label === reference.label) {
      return { reference, material: materialOf(version), effect: 'unchanged' };
    }
    const updated = workspaceArtifactReferenceSchema.parse({
      ...reference,
      label,
      revision: reference.revision + 1,
      updatedAt: now,
    });
    this.update(updated);
    return { reference: updated, material: materialOf(version), effect: 'updated' };
  }

  remove(input: { id: string; expectedRevision: number; at?: number }): ReferenceWriteOutcome {
    const row = this.db
      .prepare('SELECT * FROM workspace_artifact_references WHERE id = ?')
      .get(input.id) as ReferenceRow | undefined;
    if (!row) throw new WorkspaceReferenceUnavailableError('参考标记不存在。');
    const reference = toReference(row);
    const version = this.requireOwnedVersion(reference.workspaceId, reference.artifactVersionId);
    if (reference.revision !== input.expectedRevision) {
      throw new MemoryConflictError(
        `期望参考修订 ${input.expectedRevision}，当前 ${reference.revision}。`,
      );
    }
    if (reference.status === 'removed') {
      return { reference, material: materialOf(version), effect: 'unchanged' };
    }
    const removed = workspaceArtifactReferenceSchema.parse({
      ...reference,
      status: 'removed',
      revision: reference.revision + 1,
      updatedAt: input.at ?? this.clock(),
    });
    this.update(removed);
    return { reference: removed, material: materialOf(version), effect: 'updated' };
  }

  get(id: string): WorkspaceArtifactReference | undefined {
    const row = this.db
      .prepare('SELECT * FROM workspace_artifact_references WHERE id = ?')
      .get(id) as ReferenceRow | undefined;
    return row ? toReference(row) : undefined;
  }

  find(workspaceId: string, artifactVersionId: string): WorkspaceArtifactReference | undefined {
    const row = this.findRow(workspaceId, artifactVersionId);
    return row ? toReference(row) : undefined;
  }

  /** §10：参考区按 selectedAt DESC / id ASC。 */
  listActive(workspaceId: string): WorkspaceArtifactReference[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM workspace_artifact_references
          WHERE workspace_id = ? AND status = 'active'
          ORDER BY selected_at DESC, id ASC`,
      )
      .all(workspaceId) as ReferenceRow[];
    return rows.map(toReference);
  }

  listBriefReferences(workspaceId: string): WorkspaceArtifactReference[] {
    return this.listActive(workspaceId).slice(0, WORKSPACE_BRIEF_REFERENCE_ITEM_LIMIT);
  }

  /** workspace:list-reference-versions：active 标记＋版本可用性（哈希对不上即 unavailable）。 */
  listActiveWithAvailability(workspaceId: string): WorkspaceReferenceListItem[] {
    const rows = this.db
      .prepare(
        `SELECT r.*, a.id AS artifact_id, av.content_hash AS version_hash
           FROM workspace_artifact_references r
           JOIN artifact_versions av ON av.id = r.artifact_version_id
           JOIN artifacts a ON a.id = av.artifact_id
          WHERE r.workspace_id = ? AND r.status = 'active'
          ORDER BY r.selected_at DESC, r.id ASC`,
      )
      .all(workspaceId) as ListItemRow[];
    return rows.map((row) =>
      workspaceReferenceListItemSchema.parse({
        reference: toReference(row),
        artifactId: row.artifact_id,
        status: row.version_hash === row.content_hash ? 'ready' : 'unavailable',
      }),
    );
  }

  countActive(workspaceId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM workspace_artifact_references
          WHERE workspace_id = ? AND status = 'active'`,
      )
      .get(workspaceId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** §8.3：成果版本被别的空间参考时，删除该版本会撞 RESTRICT；预检给出可操作错误。 */
  assessVersionDeletionBlock(artifactVersionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM workspace_artifact_references WHERE artifact_version_id = ?`,
      )
      .get(artifactVersionId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** §8.3：本空间的成果版本被其他空间标记参考 → 本空间常规移除必须被阻止。 */
  assessWorkspaceDeletionImpact(workspaceId: string): WorkspaceReferenceDeletionImpact {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT r.workspace_id AS foreign_workspace_id
           FROM workspace_artifact_references r
           JOIN artifact_versions av ON av.id = r.artifact_version_id
           JOIN artifacts a ON a.id = av.artifact_id
          WHERE a.workspace_id = ? AND r.workspace_id != ?
          ORDER BY foreign_workspace_id ASC`,
      )
      .all(workspaceId, workspaceId) as { foreign_workspace_id: string }[];
    const count = this.db
      .prepare(
        `SELECT COUNT(*) AS count
           FROM workspace_artifact_references r
           JOIN artifact_versions av ON av.id = r.artifact_version_id
           JOIN artifacts a ON a.id = av.artifact_id
          WHERE a.workspace_id = ? AND r.workspace_id != ?`,
      )
      .get(workspaceId, workspaceId) as { count: number } | undefined;
    const blockingReferenceCount = count?.count ?? 0;
    return {
      workspaceId,
      blockingReferenceCount,
      foreignWorkspaceIds: rows.map((row) => row.foreign_workspace_id),
      blocking: blockingReferenceCount > 0,
    };
  }

  private requireOwnedVersion(workspaceId: string, artifactVersionId: string): VersionRow {
    const row = this.db
      .prepare(
        `SELECT av.id AS artifact_version_id, av.artifact_id, av.content_hash, a.workspace_id
           FROM artifact_versions av
           JOIN artifacts a ON a.id = av.artifact_id
          WHERE av.id = ?`,
      )
      .get(artifactVersionId) as VersionRow | undefined;
    if (!row) throw new WorkspaceReferenceUnavailableError();
    if (row.workspace_id !== workspaceId) throw new WorkspaceReferenceMismatchError();
    return row;
  }

  private findRow(workspaceId: string, artifactVersionId: string): ReferenceRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM workspace_artifact_references
          WHERE workspace_id = ? AND artifact_version_id = ?`,
      )
      .get(workspaceId, artifactVersionId) as ReferenceRow | undefined;
  }

  private assertActiveRoom(workspaceId: string): void {
    if (this.countActive(workspaceId) >= WORKSPACE_REFERENCE_ACTIVE_LIMIT) {
      throw new WorkspaceReferenceLimitError();
    }
  }

  private insert(reference: WorkspaceArtifactReference): void {
    this.db
      .prepare(
        `INSERT INTO workspace_artifact_references (
           id, workspace_id, artifact_version_id, content_hash, label, status, revision,
           selected_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reference.id,
        reference.workspaceId,
        reference.artifactVersionId,
        reference.contentHash,
        reference.label ?? null,
        reference.status,
        reference.revision,
        reference.selectedAt,
        reference.updatedAt,
      );
  }

  private update(reference: WorkspaceArtifactReference): void {
    const result = this.db
      .prepare(
        `UPDATE workspace_artifact_references
            SET content_hash = ?, label = ?, status = ?, revision = ?, selected_at = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ? AND artifact_version_id = ?`,
      )
      .run(
        reference.contentHash,
        reference.label ?? null,
        reference.status,
        reference.revision,
        reference.selectedAt,
        reference.updatedAt,
        reference.id,
        reference.workspaceId,
        reference.artifactVersionId,
      );
    if (result.changes !== 1) {
      throw new MemoryValidationError('参考标记更新未命中唯一行。');
    }
  }
}

const materialOf = (version: VersionRow): MaterialReference => ({
  kind: 'artifact-version',
  artifactId: version.artifact_id,
  artifactVersionId: version.artifact_version_id,
  contentHash: version.content_hash,
  originWorkspaceId: version.workspace_id,
});
