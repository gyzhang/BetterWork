import { randomUUID } from 'node:crypto';

import {
  type BaseInterpreter,
  baseInterpreterSchema,
  type DependencyLock,
  dependencyLockSchema,
  type RuntimeEnvironment,
  type SkillEnvironmentStatus,
  type TargetPlatform,
  targetPlatformSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

export interface CreateEnvironmentInput {
  id?: string;
  environmentKey: string;
  base: BaseInterpreter;
  platform: TargetPlatform;
  lockHash: string;
  lock: DependencyLock;
  pathKey: string;
}

export interface EnvironmentStatusPatch {
  /** 只允许从这些状态迁移；留空表示不做前置状态约束。 */
  expectedStatuses?: readonly SkillEnvironmentStatus[];
  failureCode?: string;
  failureSummary?: string;
  readyAt?: number;
}

interface EnvironmentRow {
  id: string;
  environment_key: string;
  base_json: string;
  platform_json: string;
  lock_hash: string;
  lock_json: string;
  path_key: string;
  status: SkillEnvironmentStatus;
  failure_code: string | null;
  failure_summary: string | null;
  created_at: number;
  updated_at: number;
  ready_at: number | null;
}

/**
 * 环境记录里的基础解释器与平台是信任与复用的判据（环境键由它们派生），
 * 因此读回时过 Zod 而不是直接断言：`kind` 被写错会让受管制品与本机解释器混淆。
 */
const toEnvironment = (row: EnvironmentRow): RuntimeEnvironment => ({
  id: row.id,
  environmentKey: row.environment_key,
  base: baseInterpreterSchema.parse(JSON.parse(row.base_json) as unknown),
  platform: targetPlatformSchema.parse(JSON.parse(row.platform_json) as unknown),
  lockHash: row.lock_hash,
  lock: dependencyLockSchema.parse(JSON.parse(row.lock_json) as unknown),
  pathKey: row.path_key,
  status: row.status,
  ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
  ...(row.failure_summary === null ? {} : { failureSummary: row.failure_summary }),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.ready_at === null ? {} : { readyAt: row.ready_at }),
});

/**
 * 受管运行环境仓储：只写 `runtime_environments`。
 *
 * 环境键唯一，因此同一基础解释器 + 平台 + 包锁只有一行；不同 Skill 复用同一环境
 * 就是复用同一行（设计 §4.2）。状态迁移一律走条件更新，避免并发作业互相覆盖，
 * 也避免已 ready 的环境被迟到的失败结果改写。
 */
export class RuntimeEnvironmentRepository {
  constructor(private readonly db: Database.Database) {}

  createEnvironment(input: CreateEnvironmentInput): RuntimeEnvironment {
    const id = input.id ?? randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO runtime_environments (
           id, environment_key, base_json, platform_json, lock_hash, lock_json, path_key,
           status, failure_code, failure_summary, created_at, updated_at, ready_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'unprepared', NULL, NULL, ?, ?, NULL)`,
      )
      .run(
        id,
        input.environmentKey,
        JSON.stringify(input.base),
        JSON.stringify(input.platform),
        input.lockHash,
        JSON.stringify(input.lock),
        input.pathKey,
        now,
        now,
      );
    const environment = this.getEnvironment(id);
    if (!environment) throw new Error(`Environment ${id} was not readable after insert`);
    return environment;
  }

  getEnvironment(id: string): RuntimeEnvironment | undefined {
    const row = this.db.prepare('SELECT * FROM runtime_environments WHERE id = ?').get(id) as
      EnvironmentRow | undefined;
    return row ? toEnvironment(row) : undefined;
  }

  findByKey(environmentKey: string): RuntimeEnvironment | undefined {
    const row = this.db
      .prepare('SELECT * FROM runtime_environments WHERE environment_key = ?')
      .get(environmentKey) as EnvironmentRow | undefined;
    return row ? toEnvironment(row) : undefined;
  }

  listEnvironments(): RuntimeEnvironment[] {
    const rows = this.db
      .prepare('SELECT * FROM runtime_environments ORDER BY created_at DESC')
      .all() as EnvironmentRow[];
    return rows.map(toEnvironment);
  }

  updateStatus(
    id: string,
    status: SkillEnvironmentStatus,
    patch: EnvironmentStatusPatch = {},
  ): boolean {
    const expected = patch.expectedStatuses;
    const sql = expected
      ? `UPDATE runtime_environments
         SET status = ?, failure_code = ?, failure_summary = ?, updated_at = ?,
             ready_at = COALESCE(?, ready_at)
         WHERE id = ? AND status IN (${expected.map(() => '?').join(', ')})`
      : `UPDATE runtime_environments
         SET status = ?, failure_code = ?, failure_summary = ?, updated_at = ?,
             ready_at = COALESCE(?, ready_at)
         WHERE id = ?`;
    const parameters: Array<string | number | null> = [
      status,
      patch.failureCode ?? null,
      patch.failureSummary ?? null,
      Date.now(),
      patch.readyAt ?? null,
      id,
    ];
    if (expected) parameters.push(...expected);
    const result = this.db.prepare(sql).run(...parameters);
    return result.changes === 1;
  }

  /** 启动恢复：上次进程被强杀时仍在准备的环境不能继续声称 preparing。 */
  failInterruptedEnvironments(failureSummary: string, updatedAt: number): number {
    const result = this.db
      .prepare(
        `UPDATE runtime_environments
         SET status = 'failed', failure_code = 'interrupted', failure_summary = ?, updated_at = ?
         WHERE status IN ('preparing')`,
      )
      .run(failureSummary, updatedAt);
    return result.changes;
  }

  /** 作业换了实例目录（上次留下的目录还在）时写回新目录键，恢复流程才不会清错地方。 */
  updatePathKey(id: string, pathKey: string): boolean {
    const result = this.db
      .prepare('UPDATE runtime_environments SET path_key = ?, updated_at = ? WHERE id = ?')
      .run(pathKey, Date.now(), id);
    return result.changes === 1;
  }

  /** 已准备环境的健康检查失败：不是「未准备」，而是明确失效，需要修复入口。 */
  markInvalid(id: string, failureCode: string, failureSummary: string): boolean {
    return this.updateStatus(id, 'invalid', { failureCode, failureSummary });
  }
}
