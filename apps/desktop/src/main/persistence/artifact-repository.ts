import { createHash, randomUUID } from 'node:crypto';

import {
  type ArtifactDetail,
  type ArtifactSourceDeclarationKind,
  type ArtifactSummary,
  type ArtifactType,
  type ArtifactVersionDetail,
  type ArtifactVersionSummary,
  type EvidenceSummary,
  type FileArtifactMeta,
  knowledgeEvidenceSourceSchema,
  type RegisterFileArtifactResult,
  type SaveMarkdownArtifactRequest,
  type ValidationState,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

/** artifacts 与当前版本的 JOIN 结果；version_number 等字段来自 artifact_versions。 */
interface ArtifactRow {
  id: string;
  workspace_id: string;
  task_id: string;
  type: ArtifactType;
  title: string;
  current_version_id: string;
  version_number: number;
  source_run_id: string;
  origin: ArtifactSummary['origin'];
  created_at: number;
  updated_at: number;
  source_declaration?: string;
  mime_type?: string;
  file_size?: number;
}

interface ArtifactVersionRow {
  id: string;
  artifact_id: string;
  version_number: number;
  source_run_id: string;
  origin: ArtifactSummary['origin'];
  created_at: number;
  source_declaration?: string;
  content?: string;
  content_hash?: string;
  mime_type?: string;
  file_size?: number;
  file_hash?: string;
  file_key?: string;
  validation_structure?: ValidationState['structure'];
  validation_visual?: ValidationState['visual'];
  validation_manual_edit?: ValidationState['manualEdit'];
}

interface ArtifactFileRow {
  version_id: string;
  mime_type: string;
  file_size: number;
  file_hash: string;
  file_key: string;
  execution_id: string;
  description: string | null;
  validation_structure: ValidationState['structure'];
  validation_visual: ValidationState['visual'];
  validation_manual_edit: ValidationState['manualEdit'];
}

interface EvidenceRow {
  id: string;
  task_id: string;
  run_id: string;
  source_type: EvidenceSummary['sourceType'];
  source_uri: string;
  title: string;
  locator: string;
  excerpt: string;
  content_hash: string;
  captured_at: number;
  knowledge_source_json?: string | null;
}

const SUMMARY_COLUMNS = `a.id, a.workspace_id, a.task_id, a.type, a.title, a.current_version_id,
       v.version_number, v.source_run_id, v.origin, v.source_declaration, a.created_at, a.updated_at,
       af.mime_type, af.file_size`;

const SUMMARY_JOIN = `artifacts a
  JOIN artifact_versions v ON v.id = a.current_version_id
  LEFT JOIN artifact_files af ON af.version_id = v.id`;

const toSummary = (row: ArtifactRow): ArtifactSummary => {
  const common = {
    id: row.id,
    workspaceId: row.workspace_id,
    taskId: row.task_id,
    title: row.title,
    currentVersionId: row.current_version_id,
    versionNumber: row.version_number,
    origin: row.origin,
    ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceDeclarationKind: parseDeclarationKind(row.source_declaration),
  };
  if (row.type === 'presentation' && row.mime_type && row.file_size !== undefined) {
    return { ...common, type: 'presentation', mimeType: row.mime_type, fileSize: row.file_size };
  }
  return { ...common, type: 'markdown' };
};

const toVersionSummary = (row: ArtifactVersionRow): ArtifactVersionSummary => {
  const common = {
    id: row.id,
    artifactId: row.artifact_id,
    versionNumber: row.version_number,
    origin: row.origin,
    ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
    createdAt: row.created_at,
    sourceDeclarationKind: parseDeclarationKind(row.source_declaration),
  };
  if (
    row.mime_type &&
    row.file_size !== undefined &&
    row.validation_structure &&
    row.validation_visual &&
    row.validation_manual_edit
  ) {
    return {
      ...common,
      type: 'presentation',
      mimeType: row.mime_type,
      fileSize: row.file_size,
      validation: {
        structure: row.validation_structure,
        visual: row.validation_visual,
        manualEdit: row.validation_manual_edit,
      },
    };
  }
  return { ...common, type: 'markdown' };
};

const toEvidence = (row: EvidenceRow): EvidenceSummary => ({
  id: row.id,
  taskId: row.task_id,
  runId: row.run_id,
  sourceType: row.source_type,
  sourceUri: row.source_uri,
  title: row.title,
  locator: row.locator,
  excerpt: row.excerpt,
  contentHash: row.content_hash,
  capturedAt: row.captured_at,
  ...(row.knowledge_source_json
    ? {
        knowledgeSource: knowledgeEvidenceSourceSchema.parse(JSON.parse(row.knowledge_source_json)),
      }
    : {}),
});

/** 声明种类的可写字集合；legacy 只由迁移产生，运行期不写。 */
export type WritableDeclarationKind = 'model' | 'user' | 'inherited' | 'legacy' | 'none';

const parseDeclarationKind = (value: string | undefined | null): ArtifactSourceDeclarationKind => {
  switch (value) {
    case 'model':
    case 'user':
    case 'inherited':
    case 'legacy':
    case 'none':
      return value;
    default:
      return 'none';
  }
};

export interface RegisterFileInput {
  taskId: string;
  artifactId?: string;
  versionId?: string;
  title: string;
  runId: string;
  mimeType: string;
  fileSize: number;
  fileHash: string;
  fileKey: string;
  executionId: string;
  description?: string;
  validation: ValidationState;
  sourceDeclarationKind?: WritableDeclarationKind;
}

/**
 * Artifact 与其版本。任何修改都产生新 ArtifactVersion，从不覆盖旧内容：
 * `assistant-run` 版本关联该 Run 实际使用的 Evidence，
 * `user-edit` 版本继承前一版本的来源关系，且不伪装为 AI 产物。
 *
 * 文件型成果的版本不在 DB 存内容，content 为 NULL；
 * 文件元数据存 artifact_files，与版本一一对应。
 */
export class ArtifactRepository {
  constructor(private readonly db: Database.Database) {}

  saveMarkdown(
    input: SaveMarkdownArtifactRequest,
    declarationKind: WritableDeclarationKind = 'none',
  ): ArtifactSummary {
    const workspaceId = this.readTaskWorkspaceId(input.taskId);
    if (input.origin === 'assistant-run') this.assertRunBelongsToTask(input.runId, input.taskId);

    const existing = this.readExistingArtifact(input.artifactId);
    if (
      input.artifactId &&
      (!existing || existing.task_id !== input.taskId || existing.workspace_id !== workspaceId)
    ) {
      throw new Error('Artifact does not belong to task');
    }

    const artifactId = existing?.id ?? randomUUID();
    const versionId = randomUUID();
    const now = Date.now();
    const versionNumber = this.nextVersionNumber(artifactId);
    const contentHash = createHash('sha256').update(input.content).digest('hex');

    const write = this.db.transaction(() => {
      if (existing) {
        this.db
          .prepare(
            'UPDATE artifacts SET title = ?, current_version_id = ?, updated_at = ? WHERE id = ?',
          )
          .run(input.title, versionId, now, artifactId);
      } else {
        this.db
          .prepare(
            `INSERT INTO artifacts
               (id, workspace_id, task_id, type, title, current_version_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(artifactId, workspaceId, input.taskId, 'markdown', input.title, versionId, now, now);
      }

      this.db
        .prepare(
          `INSERT INTO artifact_versions
             (id, artifact_id, version_number, content, content_hash, source_run_id, origin,
              created_at, source_declaration)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          artifactId,
          versionNumber,
          input.content,
          contentHash,
          input.runId ?? '',
          input.origin,
          now,
          declarationKind,
        );

      if (input.origin === 'assistant-run') {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO artifact_version_evidence (version_id, evidence_id)
             SELECT ?, id FROM evidence WHERE task_id = ? AND run_id = ?`,
          )
          .run(versionId, input.taskId, input.runId);
      } else if (existing) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO artifact_version_evidence (version_id, evidence_id)
             SELECT ?, evidence_id FROM artifact_version_evidence WHERE version_id = ?`,
          )
          .run(versionId, existing.current_version_id);
      }
    });
    write();

    const saved = this.readSummary(artifactId);
    if (!saved) throw new Error('Artifact disappeared right after being written');
    return saved;
  }

  findRegisteredFile(fileKey: string): RegisterFileArtifactResult | undefined {
    const row = this.db
      .prepare(
        `SELECT af.*, v.artifact_id, v.version_number FROM artifact_files af
      JOIN artifact_versions v ON v.id = af.version_id WHERE af.file_key = ? ORDER BY v.created_at LIMIT 1`,
      )
      .get(fileKey) as
      (ArtifactFileRow & { artifact_id: string; version_number: number }) | undefined;
    if (!row) return undefined;
    return {
      artifactId: row.artifact_id,
      versionId: row.version_id,
      versionNumber: row.version_number,
      fileKey: row.file_key,
      fileHash: row.file_hash,
      fileSize: row.file_size,
      validation: {
        structure: row.validation_structure,
        visual: row.validation_visual,
        manualEdit: row.validation_manual_edit,
      },
    };
  }

  registerFile(input: RegisterFileInput): RegisterFileArtifactResult {
    const workspaceId = this.readTaskWorkspaceId(input.taskId);
    this.assertRunBelongsToTask(input.runId, input.taskId);

    const existing = this.readExistingArtifact(input.artifactId);
    if (existing && this.getDetail(existing.id)?.type !== 'presentation')
      throw new Error('Artifact is not a presentation');
    if (
      input.artifactId &&
      (!existing || existing.task_id !== input.taskId || existing.workspace_id !== workspaceId)
    ) {
      throw new Error('Artifact does not belong to task');
    }

    const artifactId = existing?.id ?? randomUUID();
    const versionId = input.versionId ?? randomUUID();
    const now = Date.now();
    const versionNumber = this.nextVersionNumber(artifactId);

    const write = this.db.transaction(() => {
      if (existing) {
        this.db
          .prepare(
            'UPDATE artifacts SET title = ?, current_version_id = ?, updated_at = ? WHERE id = ?',
          )
          .run(input.title, versionId, now, artifactId);
      } else {
        this.db
          .prepare(
            `INSERT INTO artifacts
               (id, workspace_id, task_id, type, title, current_version_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            artifactId,
            workspaceId,
            input.taskId,
            'presentation',
            input.title,
            versionId,
            now,
            now,
          );
      }

      this.db
        .prepare(
          `INSERT INTO artifact_versions
             (id, artifact_id, version_number, content, content_hash, source_run_id, origin,
              created_at, source_declaration)
           VALUES (?, ?, ?, NULL, ?, ?, 'assistant-run', ?, ?)`,
        )
        .run(
          versionId,
          artifactId,
          versionNumber,
          input.fileHash,
          input.runId,
          now,
          input.sourceDeclarationKind ?? 'none',
        );

      this.db
        .prepare(
          `INSERT INTO artifact_files
             (version_id, mime_type, file_size, file_hash, file_key, execution_id, description,
              validation_structure, validation_visual, validation_manual_edit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          versionId,
          input.mimeType,
          input.fileSize,
          input.fileHash,
          input.fileKey,
          input.executionId,
          input.description ?? null,
          input.validation.structure,
          input.validation.visual,
          input.validation.manualEdit,
        );

      this.db
        .prepare(
          `INSERT OR IGNORE INTO artifact_version_evidence (version_id, evidence_id)
           SELECT ?, id FROM evidence WHERE task_id = ? AND run_id = ?`,
        )
        .run(versionId, input.taskId, input.runId);
    });
    write();

    return {
      artifactId,
      versionId,
      versionNumber,
      fileKey: input.fileKey,
      fileHash: input.fileHash,
      fileSize: input.fileSize,
      validation: input.validation,
    };
  }

  list(taskId?: string): ArtifactSummary[] {
    const where = taskId ? 'WHERE a.task_id = ?' : '';
    const rows = (
      taskId
        ? this.db
            .prepare(
              `SELECT ${SUMMARY_COLUMNS} FROM ${SUMMARY_JOIN}
                 ${where}
                ORDER BY a.updated_at DESC, a.rowid DESC`,
            )
            .all(taskId)
        : this.db
            .prepare(
              `SELECT ${SUMMARY_COLUMNS} FROM ${SUMMARY_JOIN}
                ORDER BY a.updated_at DESC, a.rowid DESC`,
            )
            .all()
    ) as ArtifactRow[];
    return rows.map(toSummary);
  }

  listByWorkspace(workspaceId: string): ArtifactSummary[] {
    const rows = this.db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM ${SUMMARY_JOIN}
          WHERE a.workspace_id = ?
          ORDER BY a.updated_at DESC, a.rowid DESC`,
      )
      .all(workspaceId) as ArtifactRow[];
    return rows.map(toSummary);
  }

  getDetail(id: string): ArtifactDetail | undefined {
    const row = this.db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS}, v.content, v.content_hash FROM ${SUMMARY_JOIN}
          WHERE a.id = ?`,
      )
      .get(id) as
      (ArtifactRow & { content: string | null; content_hash: string | null }) | undefined;
    if (!row) return undefined;
    const summary = toSummary(row);
    if (summary.type === 'markdown') {
      if (row.content === undefined || row.content === null) return undefined;
      return {
        ...summary,
        content: row.content,
        contentHash: row.content_hash ?? '',
        evidence: this.listVersionEvidence(row.current_version_id),
      };
    }
    const file = this.readFileMeta(row.current_version_id);
    if (!file) return undefined;
    return {
      ...summary,
      fileHash: file.file_hash,
      fileKey: file.file_key,
      validation: {
        structure: file.validation_structure,
        visual: file.validation_visual,
        manualEdit: file.validation_manual_edit,
      },
      ...(file.description ? { description: file.description } : {}),
      evidence: this.listVersionEvidence(row.current_version_id),
    };
  }

  getFileDetail(artifactId: string, versionId?: string): FileArtifactMeta | undefined {
    const resolvedVersionId = versionId ?? this.readCurrentVersionId(artifactId);
    if (!resolvedVersionId) return undefined;
    if (!this.versionBelongsToArtifact(resolvedVersionId, artifactId)) return undefined;
    const file = this.readFileMeta(resolvedVersionId);
    return file
      ? {
          mimeType: file.mime_type,
          fileSize: file.file_size,
          fileHash: file.file_hash,
          fileKey: file.file_key,
          validation: {
            structure: file.validation_structure,
            visual: file.validation_visual,
            manualEdit: file.validation_manual_edit,
          },
        }
      : undefined;
  }

  listVersions(artifactId: string): ArtifactVersionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT v.id, v.artifact_id, v.version_number, v.source_run_id, v.origin,
                v.source_declaration, v.created_at,
                af.mime_type, af.file_size,
                af.validation_structure, af.validation_visual, af.validation_manual_edit
           FROM artifact_versions v
           LEFT JOIN artifact_files af ON af.version_id = v.id
          WHERE v.artifact_id = ? ORDER BY v.version_number DESC`,
      )
      .all(artifactId) as ArtifactVersionRow[];
    return rows.map(toVersionSummary);
  }

  getVersionDetail(id: string): ArtifactVersionDetail | undefined {
    const row = this.db
      .prepare(
        `SELECT v.id, v.artifact_id, v.version_number, v.source_run_id, v.origin,
                v.source_declaration, v.content, v.content_hash, v.created_at,
                af.mime_type, af.file_size,
                af.validation_structure, af.validation_visual, af.validation_manual_edit
           FROM artifact_versions v
           LEFT JOIN artifact_files af ON af.version_id = v.id
          WHERE v.id = ?`,
      )
      .get(id) as ArtifactVersionRow | undefined;
    if (!row) return undefined;

    if (row.content !== undefined && row.content !== null && row.content_hash !== undefined) {
      return {
        ...toVersionSummary(row),
        type: 'markdown' as const,
        content: row.content,
        contentHash: row.content_hash,
        evidence: this.listVersionEvidence(row.id),
      };
    }

    const file = this.readFileMeta(row.id);
    if (!file) return undefined;
    return {
      id: row.id,
      artifactId: row.artifact_id,
      versionNumber: row.version_number,
      origin: row.origin,
      ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
      createdAt: row.created_at,
      type: 'presentation' as const,
      mimeType: file.mime_type,
      fileSize: file.file_size,
      validation: {
        structure: file.validation_structure,
        visual: file.validation_visual,
        manualEdit: file.validation_manual_edit,
      },
      fileHash: file.file_hash,
      fileKey: file.file_key,
      ...(file.description ? { description: file.description } : {}),
      evidence: this.listVersionEvidence(row.id),
    };
  }

  getVersionDeclarationKind(versionId: string): ArtifactSourceDeclarationKind {
    const row = this.db
      .prepare('SELECT source_declaration FROM artifact_versions WHERE id = ?')
      .get(versionId) as { source_declaration: string } | undefined;
    if (!row) throw new Error('Artifact version does not exist');
    return parseDeclarationKind(row.source_declaration);
  }

  /** 同一成果的上一个版本；用户编辑链要靠它回溯到最近的来源运行。 */
  getPreviousVersionId(versionId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT v2.id FROM artifact_versions v1
           JOIN artifact_versions v2
             ON v2.artifact_id = v1.artifact_id AND v2.version_number = v1.version_number - 1
          WHERE v1.id = ?`,
      )
      .get(versionId) as { id: string } | undefined;
    return row?.id;
  }

  getVersionSourceRunId(versionId: string): string | undefined {
    const row = this.db
      .prepare('SELECT source_run_id FROM artifact_versions WHERE id = ?')
      .get(versionId) as { source_run_id: string } | undefined;
    if (!row) throw new Error('Artifact version does not exist');
    return row.source_run_id || undefined;
  }

  /** 版本是否属于该成果，导出历史版本前必须校验，避免跨成果取内容。 */
  versionBelongsToArtifact(versionId: string, artifactId: string): boolean {
    const row = this.db
      .prepare('SELECT artifact_id FROM artifact_versions WHERE id = ?')
      .get(versionId) as { artifact_id: string } | undefined;
    return row?.artifact_id === artifactId;
  }

  private readFileMeta(versionId: string): ArtifactFileRow | undefined {
    return this.db.prepare('SELECT * FROM artifact_files WHERE version_id = ?').get(versionId) as
      ArtifactFileRow | undefined;
  }

  private readCurrentVersionId(artifactId: string): string | undefined {
    const row = this.db
      .prepare('SELECT current_version_id FROM artifacts WHERE id = ?')
      .get(artifactId) as { current_version_id: string } | undefined;
    return row?.current_version_id;
  }

  private listVersionEvidence(versionId: string): EvidenceSummary[] {
    const rows = this.db
      .prepare(
        `SELECT e.* FROM artifact_version_evidence ave
           JOIN evidence e ON e.id = ave.evidence_id
          WHERE ave.version_id = ?
          ORDER BY e.captured_at DESC, e.rowid DESC`,
      )
      .all(versionId) as EvidenceRow[];
    return rows.map(toEvidence);
  }

  private readSummary(id: string): ArtifactSummary | undefined {
    const row = this.db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM ${SUMMARY_JOIN}
          WHERE a.id = ?`,
      )
      .get(id) as ArtifactRow | undefined;
    return row ? toSummary(row) : undefined;
  }

  private readTaskWorkspaceId(taskId: string): string {
    const row = this.db.prepare('SELECT workspace_id FROM tasks WHERE id = ?').get(taskId) as
      { workspace_id: string } | undefined;
    if (!row) throw new Error('Task does not exist');
    return row.workspace_id;
  }

  private assertRunBelongsToTask(runId: string | undefined, taskId: string): void {
    if (!runId) throw new Error('AI 运行生成的成果必须关联 Run');
    const row = this.db.prepare('SELECT task_id FROM runs WHERE id = ?').get(runId) as
      { task_id: string } | undefined;
    if (!row || row.task_id !== taskId) throw new Error('Run does not belong to task');
  }

  private readExistingArtifact(
    artifactId: string | undefined,
  ): { id: string; workspace_id: string; task_id: string; current_version_id: string } | undefined {
    if (!artifactId) return undefined;
    return this.db
      .prepare('SELECT id, workspace_id, task_id, current_version_id FROM artifacts WHERE id = ?')
      .get(artifactId) as
      { id: string; workspace_id: string; task_id: string; current_version_id: string } | undefined;
  }

  private nextVersionNumber(artifactId: string): number {
    const row = this.db
      .prepare(
        'SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM artifact_versions WHERE artifact_id = ?',
      )
      .get(artifactId) as { next: number };
    return row.next;
  }
}
