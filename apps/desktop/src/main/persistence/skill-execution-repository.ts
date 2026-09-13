import { randomUUID } from 'node:crypto';

import type {
  RunSkillBinding,
  ScriptExecution,
  ScriptExecutionReason,
  ScriptExecutionStatus,
  VerifiedExecutionOutput,
} from '@betterwork/agent-protocol';
import { verifiedExecutionOutputSchema } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

export interface CreateBindingInput {
  id?: string;
  runId: string;
  skillRevisionId: string;
  profileRevisionId: string;
  environmentId?: string;
  dependencySnapshotIds: string[];
  grantId: string;
}

export interface CreateExecutionInput {
  id?: string;
  runId: string;
  bindingId: string;
  toolCallId: string;
  commandId: string;
  argumentDigest: string;
  inputHashes: string[];
  workDirKey: string;
  attemptKey: string;
}

export interface ExecutionTerminalPatch {
  reason?: ScriptExecutionReason;
  reportHash?: string;
  outputIds?: string[];
  finishedAt: number;
}

interface BindingRow {
  id: string;
  run_id: string;
  skill_revision_id: string;
  profile_revision_id: string;
  environment_id: string | null;
  dependency_snapshot_ids_json: string;
  grant_id: string;
  created_at: number;
}

interface ExecutionRow {
  id: string;
  run_id: string;
  binding_id: string;
  tool_call_id: string;
  command_id: string;
  argument_digest: string;
  input_hashes_json: string;
  work_dir_key: string;
  attempt_key: string;
  status: ScriptExecutionStatus;
  reason: ScriptExecutionReason | null;
  report_hash: string | null;
  output_ids_json: string;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

const TERMINAL_STATUSES: readonly ScriptExecutionStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
  'timed-out',
];

export const isTerminalExecutionStatus = (status: ScriptExecutionStatus): boolean =>
  TERMINAL_STATUSES.includes(status);

const parseStringArray = (value: string): string[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Stored execution identifier list must be an array of strings');
  }
  return parsed as string[];
};

const toBinding = (row: BindingRow): RunSkillBinding => ({
  id: row.id,
  runId: row.run_id,
  skillRevisionId: row.skill_revision_id,
  profileRevisionId: row.profile_revision_id,
  ...(row.environment_id === null ? {} : { environmentId: row.environment_id }),
  dependencySnapshotIds: parseStringArray(row.dependency_snapshot_ids_json),
  grantId: row.grant_id,
  createdAt: row.created_at,
});

const toExecution = (row: ExecutionRow): ScriptExecution => ({
  id: row.id,
  runId: row.run_id,
  toolCallId: row.tool_call_id,
  bindingId: row.binding_id,
  commandId: row.command_id,
  argumentDigest: row.argument_digest,
  inputHashes: parseStringArray(row.input_hashes_json),
  workDirKey: row.work_dir_key,
  attemptKey: row.attempt_key,
  status: row.status,
  ...(row.reason === null ? {} : { reason: row.reason }),
  ...(row.report_hash === null ? {} : { reportHash: row.report_hash }),
  outputIds: parseStringArray(row.output_ids_json),
  createdAt: row.created_at,
  ...(row.started_at === null ? {} : { startedAt: row.started_at }),
  ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
});

/**
 * 执行聚合仓储：只写 `run_skill_bindings` 与 `script_executions`。
 *
 * 状态迁移一律走条件更新（`WHERE status IN (...)`），因此重复结束、迟到的
 * supervisor 结果和并发的取消都不会把已终态的执行改写第二次。
 */
export class SkillExecutionRepository {
  constructor(private readonly db: Database.Database) {}

  createBinding(input: CreateBindingInput): RunSkillBinding {
    const id = input.id ?? randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO run_skill_bindings (
           id, run_id, skill_revision_id, profile_revision_id,
           environment_id, dependency_snapshot_ids_json, grant_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.skillRevisionId,
        input.profileRevisionId,
        input.environmentId ?? null,
        JSON.stringify(input.dependencySnapshotIds),
        input.grantId,
        createdAt,
      );
    const binding = this.getBinding(id);
    if (!binding) throw new Error(`Binding ${id} was not readable after insert`);
    return binding;
  }

  getBinding(id: string): RunSkillBinding | undefined {
    const row = this.db.prepare('SELECT * FROM run_skill_bindings WHERE id = ?').get(id) as
      BindingRow | undefined;
    return row ? toBinding(row) : undefined;
  }

  listBindingsByRun(runId: string): RunSkillBinding[] {
    const rows = this.db
      .prepare('SELECT * FROM run_skill_bindings WHERE run_id = ? ORDER BY created_at')
      .all(runId) as BindingRow[];
    return rows.map(toBinding);
  }

  /**
   * 返回某次 Run 的绑定集合，附带技能名，用于界面恢复 chip 条。
   * 顺序即绑定创建顺序（= 用户选择顺序）。
   */
  listBindingSummariesForRun(runId: string): Array<{ skillId: string; skillName: string }> {
    const rows = this.db
      .prepare(
        `SELECT s.id AS skill_id, s.name AS skill_name
         FROM run_skill_bindings b
         JOIN skill_revisions r ON r.id = b.skill_revision_id
         JOIN skills s ON s.id = r.skill_id
         WHERE b.run_id = ?
         ORDER BY b.created_at`,
      )
      .all(runId) as Array<{ skill_id: string; skill_name: string }>;
    return rows.map((row) => ({ skillId: row.skill_id, skillName: row.skill_name }));
  }

  /** 执行实例在 supervisor 启动之前登记，先有 queued 行再可能有进程。 */
  createExecution(input: CreateExecutionInput): ScriptExecution {
    const id = input.id ?? randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO script_executions (
           id, run_id, binding_id, tool_call_id, command_id, argument_digest,
           input_hashes_json, work_dir_key, attempt_key, status,
           report_hash, output_ids_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, '[]', ?)`,
      )
      .run(
        id,
        input.runId,
        input.bindingId,
        input.toolCallId,
        input.commandId,
        input.argumentDigest,
        JSON.stringify(input.inputHashes),
        input.workDirKey,
        input.attemptKey,
        createdAt,
      );
    const execution = this.getExecution(id);
    if (!execution) throw new Error(`Execution ${id} was not readable after insert`);
    return execution;
  }

  getExecution(id: string): ScriptExecution | undefined {
    const row = this.db.prepare('SELECT * FROM script_executions WHERE id = ?').get(id) as
      ExecutionRow | undefined;
    return row ? toExecution(row) : undefined;
  }

  listExecutionsByRun(runId: string): ScriptExecution[] {
    const rows = this.db
      .prepare('SELECT * FROM script_executions WHERE run_id = ? ORDER BY created_at')
      .all(runId) as ExecutionRow[];
    return rows.map(toExecution);
  }

  listOpenExecutions(): ScriptExecution[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM script_executions
         WHERE status IN ('queued', 'running') ORDER BY created_at`,
      )
      .all() as ExecutionRow[];
    return rows.map(toExecution);
  }

  /**
   * 跨表只读：创建 binding 前确认存在未被撤销的授权，授权内容不在此复制。
   *
   * `dependencyFingerprint` 传入时还要求授权覆盖同一组依赖：包锁或工具链快照变化后，
   * 旧授权不再放行（设计 §7.1「更新内容、脚本、依赖或范围 → 授权不自动继承」）。
   */
  findActiveGrant(
    skillId: string,
    revisionId: string,
    profileHash: string,
    dependencyFingerprint?: string,
  ): { id: string } | undefined {
    const row = this.db
      .prepare(
        `SELECT id FROM skill_trust_grants
         WHERE skill_id = ? AND revision_id = ? AND profile_hash = ? AND revoked_at IS NULL
           AND (? IS NULL OR dependency_fingerprint = ?)
         ORDER BY granted_at DESC, rowid DESC LIMIT 1`,
      )
      .get(
        skillId,
        revisionId,
        profileHash,
        dependencyFingerprint ?? null,
        dependencyFingerprint ?? null,
      ) as { id: string } | undefined;
    return row;
  }

  saveVerifiedOutputs(executionId: string, outputs: VerifiedExecutionOutput[]): void {
    this.db
      .prepare(
        "UPDATE script_executions SET verified_outputs_json = ? WHERE id = ? AND status IN ('queued', 'running')",
      )
      .run(JSON.stringify(outputs), executionId);
  }

  getVerifiedOutputs(executionId: string): VerifiedExecutionOutput[] {
    const row = this.db
      .prepare('SELECT verified_outputs_json FROM script_executions WHERE id = ?')
      .get(executionId) as { verified_outputs_json: string } | undefined;
    return row
      ? verifiedExecutionOutputSchema
          .array()
          .parse(JSON.parse(row.verified_outputs_json) as unknown)
      : [];
  }

  isBindingAuthorized(bindingId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT b.id FROM run_skill_bindings b
      JOIN skill_revisions r ON r.id = b.skill_revision_id
      JOIN skills s ON s.id = r.skill_id
      JOIN skill_preferences p ON p.skill_id = s.id
      JOIN skill_trust_grants g ON g.id = b.grant_id
      JOIN skill_runtime_profiles profile ON profile.id = b.profile_revision_id
      WHERE b.id = ? AND s.enabled = 1 AND p.trust_preference = 'trusted'
        AND g.revoked_at IS NULL AND g.revision_id = b.skill_revision_id AND g.profile_hash = profile.profile_hash`,
        )
        .get(bindingId),
    );
  }

  markRunning(id: string, startedAt: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE script_executions SET status = 'running', started_at = ?
                WHERE id = ? AND status = 'queued'`,
      )
      .run(startedAt, id);
    return result.changes === 1;
  }

  /** 终态写入是条件更新：已终态的执行返回 false，调用方据此丢弃迟到结果。 */
  finishExecution(
    id: string,
    status: ScriptExecutionStatus,
    patch: ExecutionTerminalPatch,
  ): boolean {
    if (!isTerminalExecutionStatus(status)) {
      throw new Error(`finishExecution requires a terminal status, got ${status}`);
    }
    const result = this.db
      .prepare(
        `UPDATE script_executions
         SET status = ?, reason = ?, report_hash = ?, output_ids_json = ?, finished_at = ?
         WHERE id = ? AND status IN ('queued', 'running')`,
      )
      .run(
        status,
        patch.reason ?? null,
        patch.reportHash ?? null,
        JSON.stringify(patch.outputIds ?? []),
        patch.finishedAt,
        id,
      );
    return result.changes === 1;
  }

  /** 启动恢复：上次进程被强杀留下的非终态执行收口为 interrupted 失败，不自动重放。 */
  failInterruptedExecutions(finishedAt: number): number {
    const result = this.db
      .prepare(
        `UPDATE script_executions
         SET status = 'failed', reason = 'interrupted', finished_at = ?
         WHERE status IN ('queued', 'running')`,
      )
      .run(finishedAt);
    return result.changes;
  }
}
