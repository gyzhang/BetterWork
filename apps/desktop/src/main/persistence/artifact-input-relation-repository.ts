import {
  type ArtifactInputRelation,
  type ArtifactInputRelationInput,
  artifactInputRelationSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface RelationRow {
  id: string;
  output_version_id: string;
  input_json: string;
  input_key: string;
  relation: ArtifactInputRelation['relation'];
  created_at: number;
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
    hasRead: (input: ArtifactInputRelationInput['input']) => boolean,
  ): ArtifactInputRelation[] {
    const version = this.db
      .prepare('SELECT source_run_id FROM artifact_versions WHERE id = ?')
      .get(outputVersionId) as { source_run_id: string } | undefined;
    if (!version) throw new Error('Artifact version does not exist');
    if (version.source_run_id !== runId) {
      throw new Error('Artifact version does not belong to source Run');
    }
    const saved: ArtifactInputRelation[] = [];
    const write = this.db.transaction(() => {
      const now = Date.now();
      for (const input of inputs) {
        if (!hasRead(input.input)) {
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
    });
    write();
    return saved;
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
