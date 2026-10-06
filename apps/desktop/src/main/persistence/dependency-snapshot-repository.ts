import { randomUUID } from 'node:crypto';

import {
  type DependencySnapshot,
  type DependencySnapshotExclusion,
  dependencySnapshotExclusionSchema,
  type ManagedDependencySnapshot,
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

interface SnapshotUsageRow {
  snapshot_id: string;
  skill_id: string;
  skill_name: string;
  activeAuthorizationCount: number;
  revokedAuthorizationCount: number;
  runCount: number;
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

  listSnapshotsWithUsage(): ManagedDependencySnapshot[] {
    const usage = this.listUsageRows();
    return this.listSnapshots().map((snapshot) => {
      const snapshotUsage = usage.filter((entry) => entry.snapshot_id === snapshot.id);
      return {
        ...snapshot,
        usage: snapshotUsage.map((entry) => ({
          skillId: entry.skill_id,
          skillName: entry.skill_name,
          activeAuthorizationCount: entry.activeAuthorizationCount,
          revokedAuthorizationCount: entry.revokedAuthorizationCount,
          runCount: entry.runCount,
        })),
        canDelete: snapshotUsage.every(
          (entry) => entry.activeAuthorizationCount === 0 && entry.runCount === 0,
        ),
      };
    });
  }

  getSnapshotWithUsage(id: string): ManagedDependencySnapshot | undefined {
    const snapshot = this.getSnapshot(id);
    if (!snapshot) return undefined;
    const usage = this.listUsageRows()
      .filter((entry) => entry.snapshot_id === id)
      .map((entry) => ({
        skillId: entry.skill_id,
        skillName: entry.skill_name,
        activeAuthorizationCount: entry.activeAuthorizationCount,
        revokedAuthorizationCount: entry.revokedAuthorizationCount,
        runCount: entry.runCount,
      }));
    return {
      ...snapshot,
      usage,
      canDelete: usage.every(
        (entry) => entry.activeAuthorizationCount === 0 && entry.runCount === 0,
      ),
    };
  }

  /** 删除只写快照聚合；调用方需在同一事务中先检查跨表引用。 */
  deleteSnapshot(id: string): boolean {
    return this.db.prepare('DELETE FROM dependency_snapshots WHERE id = ?').run(id).changes === 1;
  }

  /** 核验通过后记下时间：运行前可以据此判断快照是否从未核验或核验已过期。 */
  markVerified(id: string, verifiedAt: number): boolean {
    const result = this.db
      .prepare('UPDATE dependency_snapshots SET verified_at = ? WHERE id = ?')
      .run(verifiedAt, id);
    return result.changes === 1;
  }

  private listUsageRows(): SnapshotUsageRow[] {
    return this.db
      .prepare(
        `SELECT snapshot_id, skill_id, skill_name,
                SUM(active_authorization_count) AS activeAuthorizationCount,
                SUM(revoked_authorization_count) AS revokedAuthorizationCount,
                SUM(run_count) AS runCount
         FROM (
           SELECT CAST(selected.value AS TEXT) AS snapshot_id,
                  skill.id AS skill_id,
                  skill.name AS skill_name,
                  COUNT(DISTINCT CASE WHEN grant_record.revoked_at IS NULL THEN grant_record.id END)
                    AS active_authorization_count,
                  COUNT(DISTINCT CASE WHEN grant_record.revoked_at IS NOT NULL THEN grant_record.id END)
                    AS revoked_authorization_count,
                  0 AS run_count
           FROM skill_dependency_selections AS selection
           JOIN skill_trust_grants AS grant_record ON grant_record.id = selection.grant_id
           JOIN skills AS skill ON skill.id = grant_record.skill_id
           JOIN json_each(selection.snapshot_ids_json) AS selected
           GROUP BY selected.value, skill.id, skill.name

           UNION ALL

           SELECT CAST(bound.value AS TEXT) AS snapshot_id,
                  skill.id AS skill_id,
                  skill.name AS skill_name,
                  0 AS active_authorization_count,
                  0 AS revoked_authorization_count,
                  COUNT(DISTINCT binding.id) AS run_count
           FROM run_skill_bindings AS binding
           JOIN skill_revisions AS revision ON revision.id = binding.skill_revision_id
           JOIN skills AS skill ON skill.id = revision.skill_id
           JOIN json_each(binding.dependency_snapshot_ids_json) AS bound
           GROUP BY bound.value, skill.id, skill.name
         ) AS snapshot_usage
         GROUP BY snapshot_id, skill_id, skill_name
         ORDER BY skill_name COLLATE NOCASE, skill_id`,
      )
      .all() as SnapshotUsageRow[];
  }
}
