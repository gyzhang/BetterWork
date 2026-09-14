import {
  type MaterialReference,
  materialReferenceSchema,
  type RunMaterialRead,
  runMaterialReadSchema,
  taskMaterialSelectionSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface RunMaterialReadRow {
  id: string;
  run_id: string;
  material_json: string;
  operation: RunMaterialRead['operation'];
  locator: string | null;
  content_hash: string;
  excerpt_hash: string | null;
  captured_at: number;
}

interface RunContextMaterialRow {
  task_context_revision_id: string | null;
  materials_json: string;
}

const materialKey = (reference: MaterialReference): string => {
  const parsed = materialReferenceSchema.parse(reference);
  if (parsed.kind === 'knowledge-revision') {
    return `${parsed.kind}:${parsed.knowledgeRevisionId}`;
  }
  if (parsed.kind === 'artifact-version') {
    return `${parsed.kind}:${parsed.artifactVersionId}`;
  }
  return `${parsed.kind}:${parsed.snapshotId}`;
};

const parseMaterials = (value: string): RunMaterialRead['material'][] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Stored run materials must be an array');
  return parsed.map((item) => taskMaterialSelectionSchema.parse(item).reference);
};

const toRead = (row: RunMaterialReadRow): RunMaterialRead =>
  runMaterialReadSchema.parse({
    id: row.id,
    runId: row.run_id,
    material: JSON.parse(row.material_json) as unknown,
    operation: row.operation,
    ...(row.locator ? { locator: row.locator } : {}),
    contentHash: row.content_hash,
    ...(row.excerpt_hash ? { excerptHash: row.excerpt_hash } : {}),
    capturedAt: row.captured_at,
  });

export class RunMaterialReadRepository {
  constructor(private readonly db: Database.Database) {}

  save(read: RunMaterialRead): void {
    const parsed = runMaterialReadSchema.parse(read);
    const context = this.db
      .prepare(
        `SELECT task_context_revision_id, materials_json
         FROM run_context_snapshots WHERE run_id = ?`,
      )
      .get(parsed.runId) as RunContextMaterialRow | undefined;
    if (context) {
      const materials = parseMaterials(context.materials_json);
      const scoped = context.task_context_revision_id !== null || materials.length > 0;
      if (scoped) {
        const selected = materials.find(
          (material) => materialKey(material) === materialKey(parsed.material),
        );
        if (!selected || selected.contentHash !== parsed.contentHash) {
          throw new Error('Run material read is outside the snapshot scope');
        }
      }
    }
    const materialJsonKey = JSON.stringify(parsed.material);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO run_material_reads (
           id, run_id, material_json, material_key, operation, locator,
           content_hash, excerpt_hash, captured_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.id,
        parsed.runId,
        JSON.stringify(parsed.material),
        materialJsonKey,
        parsed.operation,
        parsed.locator ?? null,
        parsed.contentHash,
        parsed.excerptHash ?? null,
        parsed.capturedAt,
      );
  }

  listByRun(runId: string): RunMaterialRead[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM run_material_reads WHERE run_id = ? ORDER BY captured_at ASC, rowid ASC',
      )
      .all(runId) as RunMaterialReadRow[];
    return rows.map(toRead);
  }

  hasMaterialRead(runId: string, materialKey: string, contentHash: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found FROM run_material_reads
          WHERE run_id = ? AND material_key = ? AND content_hash = ? LIMIT 1`,
      )
      .get(runId, materialKey, contentHash) as { found?: number } | undefined;
    return row?.found === 1;
  }
}
