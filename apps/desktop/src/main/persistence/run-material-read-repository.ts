import {
  knowledgeSpanSchema,
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
  tool_call_id: string | null;
  knowledge_part_index: number | null;
  knowledge_span_json: string | null;
  text_hash: string | null;
  evidence_id: string | null;
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

const sameMaterialReference = (left: MaterialReference, right: MaterialReference): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'knowledge-revision' && right.kind === 'knowledge-revision') {
    return (
      left.knowledgeDocumentId === right.knowledgeDocumentId &&
      left.knowledgeRevisionId === right.knowledgeRevisionId &&
      left.contentHash === right.contentHash &&
      left.sourcePath === right.sourcePath &&
      left.originWorkspaceId === right.originWorkspaceId
    );
  }
  if (left.kind === 'artifact-version' && right.kind === 'artifact-version') {
    return (
      left.artifactId === right.artifactId &&
      left.artifactVersionId === right.artifactVersionId &&
      left.contentHash === right.contentHash &&
      left.originWorkspaceId === right.originWorkspaceId
    );
  }
  if (left.kind === 'workspace-input-snapshot' && right.kind === 'workspace-input-snapshot') {
    return (
      left.snapshotId === right.snapshotId &&
      left.workspaceId === right.workspaceId &&
      left.contentHash === right.contentHash &&
      left.format === right.format &&
      left.fileKey === right.fileKey
    );
  }
  return false;
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
    ...(row.tool_call_id ? { toolCallId: row.tool_call_id } : {}),
    ...(row.knowledge_part_index === null ? {} : { knowledgePartIndex: row.knowledge_part_index }),
    ...(row.knowledge_span_json
      ? { knowledgeSpan: JSON.parse(row.knowledge_span_json) as unknown }
      : {}),
    ...(row.text_hash ? { textHash: row.text_hash } : {}),
    ...(row.evidence_id ? { evidenceId: row.evidence_id } : {}),
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
        if (
          !selected ||
          !sameMaterialReference(selected, parsed.material) ||
          selected.contentHash !== parsed.contentHash
        ) {
          throw new Error('Run material read is outside the snapshot scope');
        }
      }
    }
    const materialJsonKey = JSON.stringify(parsed.material);
    if (parsed.evidenceId) {
      // 新知识足迹：同 toolCall 同序号重复消费时整组核验一致才复用；内容不同必须失败，
      // 不用 INSERT OR IGNORE 掩盖不同内容（契约 §5.2）。
      const existing = this.db
        .prepare(
          `SELECT id, content_hash, excerpt_hash, text_hash, knowledge_span_json, operation, material_json
             FROM run_material_reads
            WHERE run_id = ? AND tool_call_id = ? AND knowledge_part_index = ?`,
        )
        .get(parsed.runId, parsed.toolCallId, parsed.knowledgePartIndex) as
        | {
            id: string;
            content_hash: string;
            excerpt_hash: string | null;
            text_hash: string | null;
            knowledge_span_json: string | null;
            operation: string;
            material_json: string;
          }
        | undefined;
      if (existing) {
        const sameGroup =
          existing.content_hash === parsed.contentHash &&
          (existing.excerpt_hash ?? '') === (parsed.excerptHash ?? '') &&
          (existing.text_hash ?? '') === (parsed.textHash ?? '') &&
          existing.knowledge_span_json === JSON.stringify(parsed.knowledgeSpan) &&
          existing.operation === parsed.operation &&
          existing.material_json === materialJsonKey;
        if (!sameGroup) {
          throw new Error(
            'Knowledge footprint conflict: same tool call slot holds different content',
          );
        }
        return;
      }
      this.db
        .prepare(
          `INSERT INTO run_material_reads (
             id, run_id, material_json, material_key, operation, locator,
             content_hash, excerpt_hash, captured_at,
             tool_call_id, knowledge_part_index, knowledge_span_json, text_hash, evidence_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.runId,
          materialJsonKey,
          materialKey(parsed.material),
          parsed.operation,
          parsed.locator ?? null,
          parsed.contentHash,
          parsed.excerptHash ?? null,
          parsed.capturedAt,
          parsed.toolCallId ?? null,
          parsed.knowledgePartIndex ?? null,
          parsed.knowledgeSpan ? JSON.stringify(parsed.knowledgeSpan) : null,
          parsed.textHash ?? null,
          parsed.evidenceId,
        );
      return;
    }
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

  /** Run 累计正文用量：新精确足迹中 operation=read 的 span 长度之和（契约 §5.2）。 */
  readCodePointsUsed(runId: string): number {
    const rows = this.db
      .prepare(
        `SELECT knowledge_span_json FROM run_material_reads
          WHERE run_id = ? AND operation = 'read' AND evidence_id IS NOT NULL`,
      )
      .all(runId) as Array<{ knowledge_span_json: string | null }>;
    let total = 0;
    for (const row of rows) {
      if (!row.knowledge_span_json) continue;
      const span = knowledgeSpanSchema.parse(JSON.parse(row.knowledge_span_json));
      total += span.end - span.start;
    }
    return total;
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
