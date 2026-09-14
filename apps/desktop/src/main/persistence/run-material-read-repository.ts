import { type RunMaterialRead, runMaterialReadSchema } from '@betterwork/agent-protocol';
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
    const materialKey = JSON.stringify(parsed.material);
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
        materialKey,
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
