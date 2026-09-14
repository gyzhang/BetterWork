import { createHash, randomUUID } from 'node:crypto';

import {
  type CreateMemoryRequest,
  createMemoryRequestSchema,
  type ListMemoriesRequest,
  type MemoryRecord,
  memoryRecordSchema,
  type MemoryScope,
  memoryScopeSchema,
  type MemoryStatus,
  memoryStatusSchema,
  type SetMemoryStatusRequest,
  type UpdateMemoryRequest,
  updateMemoryRequestSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

export class MemoryConflictError extends Error {
  constructor(message = '记忆已被其他操作更新，请重新加载。') {
    super(message);
    this.name = 'MemoryConflictError';
  }
}

export class MemoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryValidationError';
  }
}

interface MemoryRow {
  revision_id: string;
  id: string;
  revision: number;
  scope_kind: MemoryScope['kind'];
  scope_id: string;
  expert_id: string | null;
  workspace_id: string | null;
  kind: MemoryRecord['kind'];
  content: string;
  source_type: MemoryRecord['sourceType'];
  source_id: string | null;
  source_locator: string | null;
  confidence: number;
  status: MemoryStatus;
  valid_from: number | null;
  valid_until: number | null;
  supersedes_id: string | null;
  content_hash: string;
  created_at: number;
  updated_at: number;
}

interface MemoryReadInput {
  runId: string;
  memory: MemoryRecord;
  capturedAt: number;
}

interface MemoryReadRunRow {
  workspace_id: string;
  expert_id: string | null;
}

const hashContent = (content: string): string => createHash('sha256').update(content).digest('hex');

const scopeToColumns = (
  scope: MemoryScope,
): {
  scopeKind: MemoryScope['kind'];
  scopeId: string;
  expertId?: string;
  workspaceId?: string;
} => {
  switch (scope.kind) {
    case 'user':
      return { scopeKind: scope.kind, scopeId: 'user' };
    case 'workspace':
      return { scopeKind: scope.kind, scopeId: scope.workspaceId, workspaceId: scope.workspaceId };
    case 'expert':
      return { scopeKind: scope.kind, scopeId: scope.expertId, expertId: scope.expertId };
    case 'expert-workspace':
      return {
        scopeKind: scope.kind,
        scopeId: `${scope.expertId}:${scope.workspaceId}`,
        expertId: scope.expertId,
        workspaceId: scope.workspaceId,
      };
  }
};

const rowScope = (row: MemoryRow): MemoryScope => {
  if (row.scope_kind === 'user') return { kind: 'user' };
  if (row.scope_kind === 'workspace')
    return { kind: 'workspace', workspaceId: row.workspace_id ?? row.scope_id };
  if (row.scope_kind === 'expert')
    return { kind: 'expert', expertId: row.expert_id ?? row.scope_id };
  if (!row.expert_id || !row.workspace_id) throw new Error('记忆范围字段不完整。');
  return { kind: 'expert-workspace', expertId: row.expert_id, workspaceId: row.workspace_id };
};

const toRecord = (row: MemoryRow): MemoryRecord =>
  memoryRecordSchema.parse({
    id: row.id,
    revisionId: row.revision_id,
    revision: row.revision,
    scope: rowScope(row),
    kind: row.kind,
    content: row.content,
    sourceType: row.source_type,
    ...(row.source_id ? { sourceId: row.source_id } : {}),
    ...(row.source_locator ? { sourceLocator: row.source_locator } : {}),
    confidence: row.confidence,
    status: row.status,
    ...(row.valid_from === null ? {} : { validFrom: row.valid_from }),
    ...(row.valid_until === null ? {} : { validUntil: row.valid_until }),
    ...(row.supersedes_id ? { supersedesId: row.supersedes_id } : {}),
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

const latestQuery = `
  SELECT r.*
    FROM memory_records r
   WHERE r.revision = (
     SELECT MAX(latest.revision) FROM memory_records latest WHERE latest.id = r.id
   )
`;

const validateTransition = (from: MemoryStatus, to: MemoryStatus): void => {
  if (from === to) return;
  const allowed: Record<MemoryStatus, MemoryStatus[]> = {
    candidate: ['confirmed', 'deleted'],
    confirmed: ['superseded', 'expired', 'deleted'],
    superseded: [],
    expired: ['confirmed', 'deleted'],
    deleted: [],
  };
  if (!allowed[from].includes(to))
    throw new MemoryValidationError(`不允许将记忆从 ${from} 变更为 ${to}。`);
};

export class MemoryRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  create(input: CreateMemoryRequest): MemoryRecord {
    const parsed = createMemoryRequestSchema.parse(input);
    const scope = memoryScopeSchema.parse(parsed.scope);
    this.assertScopeExists(scope);
    if (
      parsed.validUntil !== undefined &&
      parsed.validFrom !== undefined &&
      parsed.validUntil <= parsed.validFrom
    ) {
      throw new MemoryValidationError('有效期结束时间必须晚于开始时间。');
    }
    const now = this.clock();
    const record = memoryRecordSchema.parse({
      id: randomUUID(),
      revisionId: randomUUID(),
      revision: 1,
      scope,
      kind: parsed.kind,
      content: parsed.content,
      sourceType: parsed.sourceType,
      ...(parsed.sourceId ? { sourceId: parsed.sourceId } : {}),
      ...(parsed.sourceLocator ? { sourceLocator: parsed.sourceLocator } : {}),
      confidence: parsed.confidence,
      status: parsed.status,
      ...(parsed.validFrom === undefined ? {} : { validFrom: parsed.validFrom }),
      ...(parsed.validUntil === undefined ? {} : { validUntil: parsed.validUntil }),
      contentHash: hashContent(parsed.content),
      createdAt: now,
      updatedAt: now,
    });
    this.insert(record);
    return record;
  }

  get(id: string): MemoryRecord | undefined {
    const row = this.db.prepare(`${latestQuery} AND r.id = ?`).get(id) as MemoryRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  list(input: ListMemoriesRequest = {}): MemoryRecord[] {
    const parsed = input;
    const conditions = [latestQuery.replace(/\s+$/, '')];
    const values: unknown[] = [];
    if (parsed.workspaceId || parsed.expertId) {
      const scopeConditions = ["r.scope_kind = 'user'"];
      if (parsed.workspaceId) {
        scopeConditions.push("(r.scope_kind = 'workspace' AND r.workspace_id = ?)");
        values.push(parsed.workspaceId);
      }
      if (parsed.expertId) {
        scopeConditions.push("(r.scope_kind = 'expert' AND r.expert_id = ?)");
        values.push(parsed.expertId);
      }
      if (parsed.workspaceId && parsed.expertId) {
        scopeConditions.push(
          "(r.scope_kind = 'expert-workspace' AND r.workspace_id = ? AND r.expert_id = ?)",
        );
        values.push(parsed.workspaceId, parsed.expertId);
      }
      conditions.push(`AND (${scopeConditions.join(' OR ')})`);
    }
    if (parsed.includeCandidates === false) conditions.push("AND r.status = 'confirmed'");
    const rows = this.db
      .prepare(`${conditions.join(' ')} ORDER BY r.updated_at DESC, r.id ASC`)
      .all(...values) as MemoryRow[];
    return rows.map(toRecord);
  }

  listApplicable(
    workspaceId: string,
    expertId: string | undefined,
    now = this.clock(),
  ): MemoryRecord[] {
    const rows = this.list({
      ...(workspaceId ? { workspaceId } : {}),
      ...(expertId ? { expertId } : {}),
      includeCandidates: false,
    });
    const applicable = rows
      .filter(
        (record) =>
          record.status === 'confirmed' &&
          (record.validFrom === undefined || record.validFrom <= now) &&
          (record.validUntil === undefined || record.validUntil > now),
      )
      .sort((left, right) => {
        const rank = (record: MemoryRecord): number =>
          record.scope.kind === 'user'
            ? 0
            : record.scope.kind === 'expert-workspace'
              ? 1
              : record.scope.kind === 'expert'
                ? 2
                : 3;
        return (
          rank(left) - rank(right) ||
          right.updatedAt - left.updatedAt ||
          left.id.localeCompare(right.id)
        );
      })
      .slice(0, 16);
    const selected: MemoryRecord[] = [];
    let characterCount = 0;
    for (const record of applicable) {
      const nextCount = characterCount + record.content.length;
      if (nextCount > 6_000) continue;
      selected.push(record);
      characterCount = nextCount;
    }
    return selected;
  }

  update(input: UpdateMemoryRequest): MemoryRecord {
    const parsed = updateMemoryRequestSchema.parse(input);
    const current = this.requireCurrent(parsed.id, parsed.expectedRevision);
    const now = this.clock();
    const content = parsed.content ?? current.content;
    const record = memoryRecordSchema.parse({
      ...current,
      revisionId: randomUUID(),
      revision: current.revision + 1,
      ...(parsed.kind ? { kind: parsed.kind } : {}),
      content,
      confidence: parsed.confidence ?? current.confidence,
      ...(parsed.validFrom === undefined ? {} : { validFrom: parsed.validFrom }),
      ...(parsed.validUntil === undefined ? {} : { validUntil: parsed.validUntil }),
      supersedesId: current.revisionId,
      contentHash: hashContent(content),
      updatedAt: now,
    });
    this.insert(record);
    return record;
  }

  setStatus(input: SetMemoryStatusRequest): MemoryRecord {
    const current = this.requireCurrent(input.id, input.expectedRevision);
    const status = memoryStatusSchema.parse(input.status);
    validateTransition(current.status, status);
    const now = this.clock();
    const record = memoryRecordSchema.parse({
      ...current,
      revisionId: randomUUID(),
      revision: current.revision + 1,
      status,
      supersedesId: current.revisionId,
      updatedAt: now,
    });
    this.insert(record);
    return record;
  }

  recordReads(reads: readonly MemoryReadInput[]): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO run_memory_reads
        (id, run_id, memory_id, memory_revision_id, content_hash, captured_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const getStored = this.db.prepare(
      'SELECT id, content_hash FROM memory_records WHERE revision_id = ?',
    );
    const getRun = this.db.prepare(
      `SELECT tasks.workspace_id, run_context_snapshots.expert_id
         FROM runs
         JOIN tasks ON tasks.id = runs.task_id
         LEFT JOIN run_context_snapshots ON run_context_snapshots.run_id = runs.id
        WHERE runs.id = ?`,
    );
    const transaction = this.db.transaction(() => {
      for (const read of reads) {
        const memory = memoryRecordSchema.parse(read.memory);
        const run = getRun.get(read.runId) as MemoryReadRunRow | undefined;
        if (!run) throw new MemoryValidationError('运行不存在。');
        if (!this.memoryAppliesToRun(memory, run)) {
          throw new MemoryValidationError('记忆范围不适用于该 Run。');
        }
        if (
          memory.status !== 'confirmed' ||
          (memory.validFrom !== undefined && memory.validFrom > read.capturedAt) ||
          (memory.validUntil !== undefined && memory.validUntil <= read.capturedAt)
        ) {
          throw new MemoryValidationError('只能记录运行实际注入的有效记忆。');
        }
        const stored = getStored.get(memory.revisionId) as
          { id: string; content_hash: string } | undefined;
        if (!stored) throw new MemoryValidationError('记忆修订不存在。');
        if (stored.id !== memory.id) throw new MemoryValidationError('记忆修订身份不一致。');
        if (stored.content_hash !== memory.contentHash) {
          throw new MemoryValidationError('记忆内容哈希不一致。');
        }
        insert.run(
          randomUUID(),
          read.runId,
          memory.id,
          memory.revisionId,
          memory.contentHash,
          read.capturedAt,
        );
      }
    });
    transaction();
  }

  listReads(runId: string): MemoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM run_memory_reads rr
          JOIN memory_records m ON m.revision_id = rr.memory_revision_id
         WHERE rr.run_id = ? ORDER BY rr.captured_at ASC, rr.rowid ASC`,
      )
      .all(runId) as MemoryRow[];
    return rows.map(toRecord);
  }

  private requireCurrent(id: string, expectedRevision: number): MemoryRecord {
    const current = this.get(id);
    if (!current) throw new MemoryValidationError('记忆不存在。');
    if (current.revision !== expectedRevision) throw new MemoryConflictError();
    return current;
  }

  private insert(record: MemoryRecord): void {
    const columns = scopeToColumns(record.scope);
    this.db
      .prepare(
        `INSERT INTO memory_records (
          revision_id, id, revision, scope_kind, scope_id, expert_id, workspace_id,
          kind, content, source_type, source_id, source_locator, confidence, status,
          valid_from, valid_until, supersedes_id, content_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.revisionId,
        record.id,
        record.revision,
        columns.scopeKind,
        columns.scopeId,
        columns.expertId ?? null,
        columns.workspaceId ?? null,
        record.kind,
        record.content,
        record.sourceType,
        record.sourceId ?? null,
        record.sourceLocator ?? null,
        record.confidence,
        record.status,
        record.validFrom ?? null,
        record.validUntil ?? null,
        record.supersedesId ?? null,
        record.contentHash,
        record.createdAt,
        record.updatedAt,
      );
  }

  private assertScopeExists(scope: MemoryScope): void {
    if (scope.kind === 'user') return;
    if (scope.kind === 'workspace' || scope.kind === 'expert-workspace') {
      const workspaceId = scope.workspaceId;
      const workspace = this.db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId);
      if (!workspace) throw new MemoryValidationError('工作空间不存在。');
    }
    if (scope.kind === 'expert' || scope.kind === 'expert-workspace') {
      const expertId = scope.expertId;
      const expert = this.db.prepare('SELECT id FROM experts WHERE id = ?').get(expertId);
      if (!expert) throw new MemoryValidationError('专家不存在。');
    }
  }

  private memoryAppliesToRun(memory: MemoryRecord, run: MemoryReadRunRow): boolean {
    switch (memory.scope.kind) {
      case 'user':
        return true;
      case 'workspace':
        return memory.scope.workspaceId === run.workspace_id;
      case 'expert':
        return memory.scope.expertId === run.expert_id;
      case 'expert-workspace':
        return (
          memory.scope.expertId === run.expert_id && memory.scope.workspaceId === run.workspace_id
        );
    }
  }
}

export type { MemoryReadInput };
