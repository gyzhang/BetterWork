import {
  type ArtifactInputRelationInput,
  artifactInputRelationInputSchema,
  type RunArtifactSourceDeclaration,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface DeclarationRow {
  run_id: string;
  inputs_json: string;
  created_at: number;
  updated_at: number;
}

const toDeclaration = (row: DeclarationRow): RunArtifactSourceDeclaration => {
  const parsed: unknown = JSON.parse(row.inputs_json);
  if (!Array.isArray(parsed)) throw new Error('Stored artifact declarations must be an array');
  return {
    runId: row.run_id,
    inputs: parsed.map((item) => artifactInputRelationInputSchema.parse(item)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

/**
 * Run 级成果采用声明（知识契约 §6.1）：同一 Run 最后一次成功声明替换前一次，
 * 空数组是「主动清除声明」而不是没有记录。版本落库时从这里读取声明，
 * 同事务写版本与关系；这里只是回执账本，不保存第二套材料身份。
 */
export class RunArtifactSourceDeclarationRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(
    runId: string,
    inputs: readonly ArtifactInputRelationInput[],
  ): RunArtifactSourceDeclaration {
    const run = this.db.prepare('SELECT id FROM runs WHERE id = ?').get(runId) as
      { id: string } | undefined;
    if (!run) throw new Error('Run does not exist for artifact declaration');
    const parsed = inputs.map((input) => artifactInputRelationInputSchema.parse(input));
    const now = Date.now();
    const existing = this.db
      .prepare('SELECT * FROM run_artifact_source_declarations WHERE run_id = ?')
      .get(runId) as DeclarationRow | undefined;
    if (existing) {
      this.db
        .prepare(
          'UPDATE run_artifact_source_declarations SET inputs_json = ?, updated_at = ? WHERE run_id = ?',
        )
        .run(JSON.stringify(parsed), now, runId);
      return { runId, inputs: parsed, createdAt: existing.created_at, updatedAt: now };
    }
    this.db
      .prepare(
        `INSERT INTO run_artifact_source_declarations (run_id, inputs_json, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(runId, JSON.stringify(parsed), now, now);
    return { runId, inputs: parsed, createdAt: now, updatedAt: now };
  }

  get(runId: string): RunArtifactSourceDeclaration | undefined {
    const row = this.db
      .prepare('SELECT * FROM run_artifact_source_declarations WHERE run_id = ?')
      .get(runId) as DeclarationRow | undefined;
    return row ? toDeclaration(row) : undefined;
  }
}
