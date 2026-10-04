import { randomUUID } from 'node:crypto';

import {
  type ListSchedulesRequest,
  listSchedulesRequestSchema,
  type Schedule,
  type ScheduleConfig,
  type ScheduleConfigDraft,
  scheduleConfigDraftSchema,
  scheduleConfigSchema,
  scheduleDispatchBlockSchema,
  type SchedulePageCursor,
  schedulePageCursorSchema,
  scheduleSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

type ScheduleDispatchBlock = NonNullable<Schedule['dispatchBlock']>;

interface ScheduleRow {
  id: string;
  workspace_id: string;
  revision: number;
  current_config_version: number;
  lifecycle: Schedule['lifecycle'];
  next_scheduled_at: number | null;
  last_processed_scheduled_at: number | null;
  enabled_at: number | null;
  enabled_config_version: number | null;
  capability_fingerprint: string | null;
  dispatch_block_json: string | null;
  created_at: number;
  updated_at: number;
}

interface ScheduleConfigRow {
  schedule_id: string;
  version: number;
  name: string;
  expert_id: string;
  expert_revision_id: string;
  requirements: string;
  expected_artifact_types_json: string;
  timing_json: string;
  period_rule: ScheduleConfigDraft['periodRule'];
  knowledge_sources_json: string;
  output_subdirectory: '定时成果';
  created_at: number;
}

export interface ScheduleAggregate {
  schedule: Schedule;
  config: ScheduleConfig;
}

export interface SchedulePage {
  items: ScheduleAggregate[];
  nextCursor?: SchedulePageCursor;
}

export type ScheduleConfigState =
  | { kind: 'preserve' }
  | { kind: 'paused' }
  | {
      kind: 'enabled';
      enabledAt: number;
      capabilityFingerprint: string;
      nextScheduledAt: number;
    };

export type ScheduleLifecycleState =
  | { lifecycle: 'paused' | 'archived' }
  | {
      lifecycle: 'enabled';
      enabledAt: number;
      capabilityFingerprint: string;
      nextScheduledAt: number;
    };

const parseJson = <T>(value: string, parser: { parse(input: unknown): T }): T => {
  const decoded: unknown = JSON.parse(value);
  return parser.parse(decoded);
};

const toSchedule = (row: ScheduleRow): Schedule =>
  scheduleSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    revision: row.revision,
    currentConfigVersion: row.current_config_version,
    lifecycle: row.lifecycle,
    ...(row.next_scheduled_at === null ? {} : { nextScheduledAt: row.next_scheduled_at }),
    ...(row.last_processed_scheduled_at === null
      ? {}
      : { lastProcessedScheduledAt: row.last_processed_scheduled_at }),
    ...(row.enabled_at === null ? {} : { enabledAt: row.enabled_at }),
    ...(row.enabled_config_version === null
      ? {}
      : { enabledConfigVersion: row.enabled_config_version }),
    ...(row.capability_fingerprint === null
      ? {}
      : { capabilityFingerprint: row.capability_fingerprint }),
    ...(row.dispatch_block_json === null
      ? {}
      : { dispatchBlock: parseJson(row.dispatch_block_json, scheduleDispatchBlockSchema) }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

const toConfig = (row: ScheduleConfigRow): ScheduleConfig =>
  scheduleConfigSchema.parse({
    scheduleId: row.schedule_id,
    version: row.version,
    name: row.name,
    expertId: row.expert_id,
    expertRevisionId: row.expert_revision_id,
    requirements: row.requirements,
    expectedArtifactTypes: parseJson(
      row.expected_artifact_types_json,
      scheduleConfigDraftSchema.shape.expectedArtifactTypes,
    ),
    timing: parseJson(row.timing_json, scheduleConfigDraftSchema.shape.timing),
    periodRule: row.period_rule,
    knowledgeSources: parseJson(
      row.knowledge_sources_json,
      scheduleConfigDraftSchema.shape.knowledgeSources,
    ),
    outputSubdirectory: row.output_subdirectory,
    createdAt: row.created_at,
  });

const configValues = (
  config: ScheduleConfigDraft,
  createdAt: number,
): [
  string,
  string,
  string,
  string,
  string,
  string,
  ScheduleConfigDraft['periodRule'],
  string,
  '定时成果',
  number,
] => [
  config.name,
  config.expertId,
  config.expertRevisionId,
  config.requirements,
  JSON.stringify(config.expectedArtifactTypes),
  JSON.stringify(config.timing),
  config.periodRule,
  JSON.stringify(config.knowledgeSources),
  config.outputSubdirectory,
  createdAt,
];

const validTimestamp = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
};

export class ScheduleNotFoundError extends Error {
  constructor(scheduleId: string) {
    super(`Schedule does not exist: ${scheduleId}`);
    this.name = 'ScheduleNotFoundError';
  }
}

export class ScheduleRevisionConflictError extends Error {
  constructor(
    readonly currentRevision: number,
    expectedRevision: number,
  ) {
    super(`Schedule revision conflict: expected ${expectedRevision}, current ${currentRevision}`);
    this.name = 'ScheduleRevisionConflictError';
  }
}

export class ScheduleExpertRevisionMismatchError extends Error {
  constructor(expertId: string, expertRevisionId: string) {
    super(`Expert revision does not belong to Expert: ${expertRevisionId} / ${expertId}`);
    this.name = 'ScheduleExpertRevisionMismatchError';
  }
}

/** Schedule 聚合只写 schedules / schedule_configs；Occurrence 有独立 Repository。 */
export class ScheduleRepository {
  constructor(private readonly db: Database.Database) {}

  private assertExpertRevision(config: ScheduleConfigDraft): void {
    const revision = this.db
      .prepare('SELECT expert_id FROM expert_revisions WHERE id = ?')
      .get(config.expertRevisionId) as { expert_id: string } | undefined;
    if (!revision || revision.expert_id !== config.expertId) {
      throw new ScheduleExpertRevisionMismatchError(config.expertId, config.expertRevisionId);
    }
  }

  private getScheduleRow(scheduleId: string): ScheduleRow | undefined {
    return this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as
      ScheduleRow | undefined;
  }

  private getConfigRow(scheduleId: string, version: number): ScheduleConfigRow | undefined {
    return this.db
      .prepare('SELECT * FROM schedule_configs WHERE schedule_id = ? AND version = ?')
      .get(scheduleId, version) as ScheduleConfigRow | undefined;
  }

  private aggregate(row: ScheduleRow): ScheduleAggregate {
    const schedule = toSchedule(row);
    const configRow = this.getConfigRow(schedule.id, schedule.currentConfigVersion);
    if (!configRow) throw new Error('Schedule current configuration was not available');
    return { schedule, config: toConfig(configRow) };
  }

  get(scheduleId: string): ScheduleAggregate | undefined {
    const row = this.getScheduleRow(scheduleId);
    return row ? this.aggregate(row) : undefined;
  }

  getConfig(scheduleId: string, version: number): ScheduleConfig | undefined {
    const row = this.getConfigRow(scheduleId, version);
    return row ? toConfig(row) : undefined;
  }

  /** Scheduler 只取带下一计划时刻的 enabled 规则；具体绑定版本仍由调用方按 enabledConfigVersion 读。 */
  listEnabledForDispatch(): ScheduleAggregate[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM schedules
         WHERE lifecycle = 'enabled' AND next_scheduled_at IS NOT NULL
         ORDER BY id ASC`,
      )
      .all() as ScheduleRow[];
    return rows.map((row) => this.aggregate(row));
  }

  setDispatchBlock(scheduleId: string, blockInput: ScheduleDispatchBlock): ScheduleAggregate {
    const block = scheduleDispatchBlockSchema.parse(blockInput);
    const current = this.getScheduleRow(scheduleId);
    if (!current) throw new ScheduleNotFoundError(scheduleId);
    if (current.lifecycle !== 'enabled') return this.aggregate(current);
    const currentSchedule = toSchedule(current);
    if (
      currentSchedule.dispatchBlock?.code === block.code &&
      currentSchedule.dispatchBlock.message === block.message &&
      currentSchedule.dispatchBlock.detectedAt === block.detectedAt
    ) {
      return this.aggregate(current);
    }
    const update = this.db
      .prepare(
        `UPDATE schedules
         SET dispatch_block_json = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ? AND lifecycle = 'enabled'`,
      )
      .run(JSON.stringify(block), block.detectedAt, scheduleId, current.revision);
    if (update.changes !== 1) {
      const latest = this.getScheduleRow(scheduleId);
      if (!latest) throw new ScheduleNotFoundError(scheduleId);
      if (latest.lifecycle !== 'enabled') return this.aggregate(latest);
      throw new ScheduleRevisionConflictError(latest.revision, current.revision);
    }
    const saved = this.getScheduleRow(scheduleId);
    if (!saved) throw new Error('Schedule was not available after dispatch block update');
    return this.aggregate(saved);
  }

  create(input: {
    id?: string;
    workspaceId: string;
    config: ScheduleConfigDraft;
    createdAt: number;
    activation?: { enabledAt: number; capabilityFingerprint: string; nextScheduledAt: number };
  }): ScheduleAggregate {
    validTimestamp(input.createdAt, 'createdAt');
    if (input.activation) {
      validTimestamp(input.activation.enabledAt, 'enabledAt');
      validTimestamp(input.activation.nextScheduledAt, 'nextScheduledAt');
      if (input.activation.capabilityFingerprint.trim().length === 0) {
        throw new Error('capabilityFingerprint must not be empty');
      }
    }
    const config = scheduleConfigDraftSchema.parse(input.config);
    const scheduleId = input.id ?? randomUUID();
    const insert = this.db.transaction(() => {
      this.assertExpertRevision(config);
      this.db
        .prepare(
          `INSERT INTO schedules (
             id, workspace_id, revision, current_config_version, lifecycle, next_scheduled_at,
             enabled_at, enabled_config_version, capability_fingerprint, created_at, updated_at
           ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          scheduleId,
          input.workspaceId,
          input.activation ? 'enabled' : 'paused',
          input.activation?.nextScheduledAt ?? null,
          input.activation?.enabledAt ?? null,
          input.activation ? 1 : null,
          input.activation?.capabilityFingerprint ?? null,
          input.createdAt,
          input.createdAt,
        );
      this.db
        .prepare(
          `INSERT INTO schedule_configs (
             schedule_id, version, name, expert_id, expert_revision_id, requirements,
             expected_artifact_types_json, timing_json, period_rule,
             knowledge_sources_json, output_subdirectory, created_at
           ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(scheduleId, ...configValues(config, input.createdAt));
      const row = this.getScheduleRow(scheduleId);
      if (!row) throw new Error('Schedule was not available after creation');
      return this.aggregate(row);
    });
    return insert();
  }

  /** 追加新配置并推进 currentConfigVersion；旧配置行永不更新或删除。 */
  appendConfig(
    scheduleId: string,
    input: { config: ScheduleConfigDraft; expectedRevision: number; updatedAt: number },
    state: ScheduleConfigState = { kind: 'preserve' },
  ): ScheduleAggregate {
    validTimestamp(input.updatedAt, 'updatedAt');
    if (state.kind === 'enabled') {
      validTimestamp(state.enabledAt, 'enabledAt');
      validTimestamp(state.nextScheduledAt, 'nextScheduledAt');
      if (state.capabilityFingerprint.trim().length === 0) {
        throw new Error('capabilityFingerprint must not be empty');
      }
    }
    const config = scheduleConfigDraftSchema.parse(input.config);
    const append = this.db.transaction(() => {
      const current = this.getScheduleRow(scheduleId);
      if (!current) throw new ScheduleNotFoundError(scheduleId);
      if (current.revision !== input.expectedRevision) {
        throw new ScheduleRevisionConflictError(current.revision, input.expectedRevision);
      }
      this.assertExpertRevision(config);
      const nextVersion = current.current_config_version + 1;
      const lifecycle = state.kind === 'preserve' ? current.lifecycle : state.kind;
      const nextScheduledAt =
        state.kind === 'enabled'
          ? state.nextScheduledAt
          : state.kind === 'paused'
            ? null
            : current.next_scheduled_at;
      const enabledAt =
        state.kind === 'enabled'
          ? state.enabledAt
          : state.kind === 'paused'
            ? null
            : current.enabled_at;
      const enabledConfigVersion =
        state.kind === 'enabled'
          ? nextVersion
          : state.kind === 'paused'
            ? null
            : current.enabled_config_version;
      const capabilityFingerprint =
        state.kind === 'enabled'
          ? state.capabilityFingerprint
          : state.kind === 'paused'
            ? null
            : current.capability_fingerprint;
      const dispatchBlock = state.kind === 'enabled' ? null : current.dispatch_block_json;
      this.db
        .prepare(
          `INSERT INTO schedule_configs (
             schedule_id, version, name, expert_id, expert_revision_id, requirements,
             expected_artifact_types_json, timing_json, period_rule,
             knowledge_sources_json, output_subdirectory, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(scheduleId, nextVersion, ...configValues(config, input.updatedAt));
      const updated = this.db
        .prepare(
          `UPDATE schedules
           SET current_config_version = ?, lifecycle = ?, next_scheduled_at = ?, enabled_at = ?,
               enabled_config_version = ?, capability_fingerprint = ?, dispatch_block_json = ?,
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(
          nextVersion,
          lifecycle,
          nextScheduledAt,
          enabledAt,
          enabledConfigVersion,
          capabilityFingerprint,
          dispatchBlock,
          input.updatedAt,
          scheduleId,
          input.expectedRevision,
        );
      if (updated.changes !== 1) {
        const latest = this.getScheduleRow(scheduleId);
        if (!latest) throw new ScheduleNotFoundError(scheduleId);
        throw new ScheduleRevisionConflictError(latest.revision, input.expectedRevision);
      }
      const row = this.getScheduleRow(scheduleId);
      if (!row) throw new Error('Schedule was not available after configuration append');
      return this.aggregate(row);
    });
    return append();
  }

  setLifecycle(
    scheduleId: string,
    input: { expectedRevision: number; updatedAt: number },
    state: ScheduleLifecycleState,
  ): ScheduleAggregate {
    validTimestamp(input.updatedAt, 'updatedAt');
    if (state.lifecycle === 'enabled') {
      validTimestamp(state.enabledAt, 'enabledAt');
      validTimestamp(state.nextScheduledAt, 'nextScheduledAt');
      if (state.capabilityFingerprint.trim().length === 0) {
        throw new Error('capabilityFingerprint must not be empty');
      }
    }
    const update = this.db.transaction(() => {
      const current = this.getScheduleRow(scheduleId);
      if (!current) throw new ScheduleNotFoundError(scheduleId);
      if (current.revision !== input.expectedRevision) {
        throw new ScheduleRevisionConflictError(current.revision, input.expectedRevision);
      }
      const changed = this.db
        .prepare(
          `UPDATE schedules
           SET lifecycle = ?, next_scheduled_at = ?, enabled_at = ?, enabled_config_version = ?,
               capability_fingerprint = ?,
               dispatch_block_json = CASE WHEN ? = 'enabled' THEN NULL ELSE dispatch_block_json END,
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(
          state.lifecycle,
          state.lifecycle === 'enabled' ? state.nextScheduledAt : null,
          state.lifecycle === 'enabled' ? state.enabledAt : null,
          state.lifecycle === 'enabled' ? current.current_config_version : null,
          state.lifecycle === 'enabled' ? state.capabilityFingerprint : null,
          state.lifecycle,
          input.updatedAt,
          scheduleId,
          input.expectedRevision,
        );
      if (changed.changes !== 1) {
        const latest = this.getScheduleRow(scheduleId);
        if (!latest) throw new ScheduleNotFoundError(scheduleId);
        throw new ScheduleRevisionConflictError(latest.revision, input.expectedRevision);
      }
      const row = this.getScheduleRow(scheduleId);
      if (!row) throw new Error('Schedule was not available after lifecycle update');
      return this.aggregate(row);
    });
    return update();
  }

  list(request: ListSchedulesRequest): SchedulePage {
    const query = listSchedulesRequestSchema.parse(request);
    const filters: string[] = [];
    const parameters: (string | number)[] = [];
    if (query.lifecycle) {
      filters.push('lifecycle = ?');
      parameters.push(query.lifecycle);
    }
    if (query.cursor) {
      const cursor = schedulePageCursorSchema.parse(query.cursor);
      filters.push('(created_at < ? OR (created_at = ? AND id < ?))');
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM schedules
         ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(...parameters, query.limit + 1) as ScheduleRow[];
    const hasMore = rows.length > query.limit;
    const selected = rows.slice(0, query.limit);
    const items = selected.map((row) => this.aggregate(row));
    const last = selected.at(-1);
    return {
      items,
      ...(hasMore && last
        ? { nextCursor: { version: 1, createdAt: last.created_at, id: last.id } }
        : {}),
    };
  }
}
