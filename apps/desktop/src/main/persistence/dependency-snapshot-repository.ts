import { randomUUID } from 'node:crypto';

import {
  type DependencySnapshot,
  type DependencySnapshotExclusion,
  dependencySnapshotExclusionSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

export interface CreateSnapshotInput {
  id?: string;
  origin: string;
  originCommit?: string;
  originState: DependencySnapshot['originState'];
  manifestHash: string;
  pathKey: string;
  fileCount: number;
  totalBytes: number;
  exclusions: DependencySnapshotExclusion[];
}

interface SnapshotRow {
  id: string;
  origin: string;
  origin_commit: string | null;
  origin_state: DependencySnapshot['originState'];
  manifest_hash: string;
  path_key: string;
  file_count: number;
  total_bytes: number;
  exclusions_json: string;
  created_at: number;
  verified_at: number | null;
}

const toSnapshot = (row: SnapshotRow): DependencySnapshot => {
  const parsed: unknown = JSON.parse(row.exclusions_json);
  const exclusions = Array.isArray(parsed)
    ? parsed.map((entry) => dependencySnapshotExclusionSchema.parse(entry))
    : [];
  return {
    id: row.id,
    origin: row.origin,
    ...(row.origin_commit === null ? {} : { originCommit: row.origin_commit }),
    originState: row.origin_state,
    manifestHash: row.manifest_hash,
    pathKey: row.path_key,
    fileCount: row.file_count,
    totalBytes: row.total_bytes,
    exclusions,
    createdAt: row.created_at,
    ...(row.verified_at === null ? {} : { verifiedAt: row.verified_at }),
  };
};

/**
 * 工具链快照仓储：只写 `dependency_snapshots`。
 *
 * 快照按内容清单 hash 寻址，因此同一份内容（含本地修改）只会有一行；
 * 源目录后续被修改也不会改变已登记的快照，运行时一律使用受管副本。
 */
export class DependencySnapshotRepository {
  constructor(private readonly db: Database.Database) {}

  createSnapshot(input: CreateSnapshotInput): DependencySnapshot {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO dependency_snapshots (
           id, origin, origin_commit, origin_state, manifest_hash, path_key,
           file_count, total_bytes, exclusions_json, created_at, verified_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        input.origin,
        input.originCommit ?? null,
        input.originState,
        input.manifestHash,
        input.pathKey,
        input.fileCount,
        input.totalBytes,
        JSON.stringify(input.exclusions),
        Date.now(),
      );
    const snapshot = this.getSnapshot(id);
    if (!snapshot) throw new Error(`Snapshot ${id} was not readable after insert`);
    return snapshot;
  }

  getSnapshot(id: string): DependencySnapshot | undefined {
    const row = this.db.prepare('SELECT * FROM dependency_snapshots WHERE id = ?').get(id) as
      SnapshotRow | undefined;
    return row ? toSnapshot(row) : undefined;
  }

  findByManifestHash(manifestHash: string): DependencySnapshot | undefined {
    const row = this.db
      .prepare('SELECT * FROM dependency_snapshots WHERE manifest_hash = ?')
      .get(manifestHash) as SnapshotRow | undefined;
    return row ? toSnapshot(row) : undefined;
  }

  listSnapshots(): DependencySnapshot[] {
    const rows = this.db
      .prepare('SELECT * FROM dependency_snapshots ORDER BY created_at DESC')
      .all() as SnapshotRow[];
    return rows.map(toSnapshot);
  }

  /** 核验通过后记下时间：运行前可以据此判断快照是否从未核验或核验已过期。 */
  markVerified(id: string, verifiedAt: number): boolean {
    const result = this.db
      .prepare('UPDATE dependency_snapshots SET verified_at = ? WHERE id = ?')
      .run(verifiedAt, id);
    return result.changes === 1;
  }
}
