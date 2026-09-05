import { createHash, randomUUID } from 'node:crypto';

import type {
  ArtifactDetail,
  ArtifactSummary,
  ArtifactVersionDetail,
  ArtifactVersionSummary,
  EvidenceSummary,
  SaveMarkdownArtifactRequest,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

/** artifacts 与当前版本的 JOIN 结果；version_number 等字段来自 artifact_versions。 */
interface ArtifactRow {
  id: string;
  workspace_id: string;
  task_id: string;
  type: 'markdown';
  title: string;
  current_version_id: string;
  version_number: number;
  source_run_id: string;
  origin: ArtifactSummary['origin'];
  created_at: number;
  updated_at: number;
}

interface ArtifactVersionRow {
  id: string;
  artifact_id: string;
  version_number: number;
  source_run_id: string;
  origin: ArtifactSummary['origin'];
  created_at: number;
  content?: string;
  content_hash?: string;
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
}

const SUMMARY_COLUMNS = `a.id, a.workspace_id, a.task_id, a.type, a.title, a.current_version_id,
       v.version_number, v.source_run_id, v.origin, a.created_at, a.updated_at`;

const toSummary = (row: ArtifactRow): ArtifactSummary => ({
  id: row.id,
  workspaceId: row.workspace_id,
  taskId: row.task_id,
  type: 'markdown',
  title: row.title,
  currentVersionId: row.current_version_id,
  versionNumber: row.version_number,
  origin: row.origin,
  ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toVersionSummary = (row: ArtifactVersionRow): ArtifactVersionSummary => ({
  id: row.id,
  artifactId: row.artifact_id,
  versionNumber: row.version_number,
  origin: row.origin,
  ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}),
  createdAt: row.created_at,
});

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
});

/**
 * Artifact 与其版本。任何修改都产生新 ArtifactVersion，从不覆盖旧内容：
 * `assistant-run` 版本关联该 Run 实际使用的 Evidence，
 * `user-edit` 版本继承前一版本的来源关系，且不伪装为 AI 产物。
 */
export class ArtifactRepository {
  constructor(private readonly db: Database.Database) {}

  saveMarkdown(input: SaveMarkdownArtifactRequest): ArtifactSummary {
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
             (id, artifact_id, version_number, content, content_hash, source_run_id, origin, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

  list(taskId?: string): ArtifactSummary[] {
    const where = taskId ? 'WHERE a.task_id = ?' : '';
    const rows = (
      taskId
        ? this.db
            .prepare(
              `SELECT ${SUMMARY_COLUMNS} FROM artifacts a
                 JOIN artifact_versions v ON v.id = a.current_version_id
                 ${where}
                ORDER BY a.updated_at DESC, a.rowid DESC`,
            )
            .all(taskId)
        : this.db
            .prepare(
              `SELECT ${SUMMARY_COLUMNS} FROM artifacts a
                 JOIN artifact_versions v ON v.id = a.current_version_id
                ORDER BY a.updated_at DESC, a.rowid DESC`,
            )
            .all()
    ) as ArtifactRow[];
    return rows.map(toSummary);
  }

  getDetail(id: string): ArtifactDetail | undefined {
    const row = this.db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS}, v.content, v.content_hash FROM artifacts a
           JOIN artifact_versions v ON v.id = a.current_version_id
          WHERE a.id = ?`,
      )
      .get(id) as (ArtifactRow & { content: string; content_hash: string }) | undefined;
    if (!row) return undefined;
    return {
      ...toSummary(row),
      content: row.content,
      contentHash: row.content_hash,
      evidence: this.listVersionEvidence(row.current_version_id),
    };
  }

  listVersions(artifactId: string): ArtifactVersionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, artifact_id, version_number, source_run_id, origin, created_at
           FROM artifact_versions WHERE artifact_id = ? ORDER BY version_number DESC`,
      )
      .all(artifactId) as ArtifactVersionRow[];
    return rows.map(toVersionSummary);
  }

  getVersionDetail(id: string): ArtifactVersionDetail | undefined {
    const row = this.db
      .prepare(
        `SELECT id, artifact_id, version_number, source_run_id, origin, content, content_hash, created_at
           FROM artifact_versions WHERE id = ?`,
      )
      .get(id) as ArtifactVersionRow | undefined;
    if (!row || row.content === undefined || row.content_hash === undefined) return undefined;
    return {
      ...toVersionSummary(row),
      content: row.content,
      contentHash: row.content_hash,
      evidence: this.listVersionEvidence(row.id),
    };
  }

  /** 版本是否属于该成果，导出历史版本前必须校验，避免跨成果取内容。 */
  versionBelongsToArtifact(versionId: string, artifactId: string): boolean {
    const row = this.db
      .prepare('SELECT artifact_id FROM artifact_versions WHERE id = ?')
      .get(versionId) as { artifact_id: string } | undefined;
    return row?.artifact_id === artifactId;
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
        `SELECT ${SUMMARY_COLUMNS} FROM artifacts a
           JOIN artifact_versions v ON v.id = a.current_version_id
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
