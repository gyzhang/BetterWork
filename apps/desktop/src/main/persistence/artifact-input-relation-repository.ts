import {
  type ArtifactInputRelation,
  type ArtifactInputRelationInput,
  artifactInputRelationSchema,
  type ArtifactSourceDeclarationKind,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface RelationRow {
  id: string;
  output_version_id: string;
  input_json: string;
  input_key: string;
  relation: ArtifactInputRelation['relation'];
  created_at: number;
  run_id: string;
  /** LEFT JOIN input_snapshots 带来的原始文件路径；非快照类输入为 null。 */
  source_path: string | null;
}

const toRelation = (row: RelationRow): ArtifactInputRelation => {
  const input = JSON.parse(row.input_json) as Record<string, unknown>;
  if (
    row.source_path &&
    input.kind === 'workspace-input-snapshot' &&
    typeof input.sourcePath !== 'string'
  ) {
    input.sourcePath = row.source_path;
  }
  return artifactInputRelationSchema.parse({
    outputVersionId: row.output_version_id,
    input,
    relation: row.relation,
    createdAt: row.created_at,
  });
};

export class ArtifactInputRelationRepository {
  constructor(private readonly db: Database.Database) {}

  saveForRun(
    outputVersionId: string,
    runId: string,
    inputs: readonly ArtifactInputRelationInput[],
    hasRead: (input: ArtifactInputRelationInput['input'], runId: string) => boolean,
    declarationKind: 'model' | 'user' = 'model',
  ): ArtifactInputRelation[] {
    // 用户编辑版本的来源运行是祖先 Assistant Run，因此这里只校验同任务归属；
    // 「谁读过什么」由宿主声明服务在同一事务里判定。
    const version = this.db
      .prepare(
        `SELECT t.id AS task_id FROM artifact_versions v
           JOIN artifacts a ON a.id = v.artifact_id
           JOIN tasks t ON t.id = a.task_id
          WHERE v.id = ?`,
      )
      .get(outputVersionId) as { task_id: string } | undefined;
    if (!version) throw new Error('Artifact version does not exist');
    const run = this.db.prepare('SELECT task_id FROM runs WHERE id = ?').get(runId) as
      { task_id: string } | undefined;
    if (!run || run.task_id !== version.task_id) {
      throw new Error('Artifact version does not belong to source Run');
    }
    const saved: ArtifactInputRelation[] = [];
    const write = this.db.transaction(() => {
      const now = Date.now();
      for (const input of inputs) {
        if (!hasRead(input.input, runId)) {
          throw new Error('Artifact input must be read by the same Run before it is related');
        }
        const relation = artifactInputRelationSchema.parse({
          outputVersionId,
          input: input.input,
          relation: input.relation,
          createdAt: now,
        });
        const id = `${outputVersionId}:${JSON.stringify(relation.input)}:${relation.relation}`;
        this.db
          .prepare(
            `INSERT OR IGNORE INTO artifact_input_relations
               (id, output_version_id, run_id, input_json, input_key, relation, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            outputVersionId,
            runId,
            JSON.stringify(relation.input),
            JSON.stringify(relation.input),
            relation.relation,
            relation.createdAt,
          );
        const row = this.db
          .prepare(
            'SELECT * FROM artifact_input_relations WHERE output_version_id = ? AND input_key = ? AND relation = ?',
          )
          .get(outputVersionId, JSON.stringify(relation.input), relation.relation) as
          RelationRow | undefined;
        if (row) saved.push(toRelation(row));
      }
      this.db
        .prepare('UPDATE artifact_versions SET source_declaration = ? WHERE id = ?')
        .run(declarationKind, outputVersionId);
    });
    write();
    return saved;
  }

  /**
   * 合法继承：把前版声明关系原样复制给新版本（§6.1「沿用前版」），不改写旧版。
   * run_id 保留建立该关系的那次运行，继承不伪造新的访问事实。
   */
  inheritFromVersion(
    outputVersionId: string,
    previousVersionId: string,
    declarationKind: ArtifactSourceDeclarationKind,
  ): ArtifactInputRelation[] {
    const copy = this.db.transaction(() => {
      const rows = this.db
        .prepare('SELECT * FROM artifact_input_relations WHERE output_version_id = ?')
        .all(previousVersionId) as RelationRow[];
      const now = Date.now();
      for (const row of rows) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO artifact_input_relations
               (id, output_version_id, run_id, input_json, input_key, relation, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            `${outputVersionId}:${row.input_key}:${row.relation}`,
            outputVersionId,
            row.run_id,
            row.input_json,
            row.input_key,
            row.relation,
            now,
          );
      }
      this.db
        .prepare('UPDATE artifact_versions SET source_declaration = ? WHERE id = ?')
        .run(declarationKind, outputVersionId);
      return rows.length;
    });
    copy();
    return this.listByVersion(outputVersionId);
  }

  listByVersion(outputVersionId: string): ArtifactInputRelation[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.output_version_id, r.input_json, r.input_key, r.relation, r.created_at,
                s.source_path
           FROM artifact_input_relations r
           LEFT JOIN input_snapshots s
             ON s.id = json_extract(r.input_json, '$.snapshotId')
          WHERE r.output_version_id = ?
          ORDER BY r.created_at ASC, r.rowid ASC`,
      )
      .all(outputVersionId) as RelationRow[];
    return rows.map(toRelation);
  }
}
