import {
  type ScheduleDomainErrorCode,
  type ScheduleOccurrence,
  type ScheduleResolvedPeriod,
  type ScheduleSourceSnapshot,
  type StartRunRequest,
  type TaskContextRevision,
  type TaskSummary,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import type { RunService } from './run-service';

export interface ScheduleTaskDraft {
  readonly occurrence: ScheduleOccurrence;
  readonly task: TaskSummary;
  readonly sessionId: string;
  readonly context: TaskContextRevision;
}

export interface ScheduleExecutionServiceOptions {
  readonly now?: () => number;
}

export class ScheduleExecutionServiceError extends Error {
  constructor(
    readonly code: ScheduleDomainErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScheduleExecutionServiceError';
  }
}

const truncateCodePoints = (value: string, maximum: number): string =>
  Array.from(value).slice(0, maximum).join('');

const titleFor = (name: string, period: ScheduleResolvedPeriod): string => {
  const separator = ' · ';
  const periodLength = Array.from(period.label).length;
  if (periodLength + Array.from(separator).length >= 160) {
    return truncateCodePoints(period.label, 159);
  }
  const nameBudget = 160 - periodLength - Array.from(separator).length;
  const visibleName = truncateCodePoints(name, nameBudget);
  return `${visibleName}${separator}${period.label}`;
};

const goalFor = (
  period: ScheduleResolvedPeriod,
  snapshot: ScheduleSourceSnapshot,
  requirements: string,
): string =>
  [
    `本期期间（${period.timeZone}）：${period.label}`,
    `本期来源：${snapshot.itemCount} 项，已固定为不可变快照；目录文件共 ${snapshot.totalFileBytes} 字节。`,
    '工作要求：',
    requirements,
  ].join('\n');

const timestampIsValid = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/** T3 事务内创建可恢复的独立 Task 草稿；不启动 Run，也不改写 ExpertRevision。 */
export class ScheduleExecutionService {
  private readonly now: () => number;

  constructor(
    private readonly store: AppStore,
    options: ScheduleExecutionServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  prepareTaskDraft(occurrenceId: string): ScheduleTaskDraft {
    return this.store.transaction(() => {
      const occurrence = this.store.scheduleOccurrences.get(occurrenceId);
      if (!occurrence) {
        throw new ScheduleExecutionServiceError('schedule_not_found', '定时实例不存在。');
      }
      const existing = this.findPreparedDraft(occurrence);
      if (existing) return existing;
      if (occurrence.phase !== 'preparing') {
        throw new ScheduleExecutionServiceError(
          'schedule_conflict',
          '定时实例已结束，不能再创建 Task 草稿。',
        );
      }

      const aggregate = this.store.schedules.get(occurrence.scheduleId);
      if (!aggregate || aggregate.schedule.lifecycle === 'archived') {
        throw new ScheduleExecutionServiceError('schedule_not_found', '定时规则不可用。');
      }
      if (occurrence.trigger === 'scheduled' && aggregate.schedule.lifecycle !== 'enabled') {
        throw new ScheduleExecutionServiceError('schedule_cancelled', '定时规则已暂停。');
      }
      const config = this.store.schedules.getConfig(
        occurrence.scheduleId,
        occurrence.configVersion,
      );
      if (!config) {
        throw new ScheduleExecutionServiceError('schedule_conflict', '本期固定配置版本不存在。');
      }
      const workspace = this.store.workspaces.get(aggregate.schedule.workspaceId);
      if (!workspace) {
        throw new ScheduleExecutionServiceError(
          'schedule_workspace_unavailable',
          '本期工作空间不可用。',
        );
      }

      const snapshot = this.requireReadySnapshot(occurrence, aggregate.schedule.workspaceId);
      const expert = this.store.experts.get(config.expertId);
      const revision = this.store.experts.getRevision(config.expertId, config.expertRevisionId);
      if (!expert || expert.lifecycle !== 'active' || !revision) {
        throw new ScheduleExecutionServiceError(
          'schedule_capability_blocked',
          '本期固定专家或修订不可用。',
        );
      }

      const created = this.store.tasks.create(
        workspace.id,
        titleFor(config.name, occurrence.period),
        goalFor(occurrence.period, snapshot, config.requirements),
      );
      const preparedAt = this.now();
      if (!timestampIsValid(preparedAt)) {
        throw new ScheduleExecutionServiceError('schedule_clock_untrusted', '本期准备时间无效。');
      }
      this.store.scheduleOccurrences.attachPreparedTask({
        occurrenceId: occurrence.id,
        taskId: created.task.id,
        sessionId: created.sessionId,
        sourceSnapshotId: snapshot.id,
        preparedAt,
      });
      const context = this.store.taskContexts.save(created.task.id, {
        executor: {
          kind: 'expert',
          expertId: expert.id,
          expertRevisionId: revision.id,
        },
        skillBindings: revision.skillPreset.map((binding) => ({
          skillId: binding.skillId,
          revisionId: binding.revisionId,
          source: 'expert-preset' as const,
        })),
        modelReference: revision.modelReference,
        builtinToolPolicy: revision.builtinToolPolicy,
        materials: [],
        scheduleSourceSnapshotId: snapshot.id,
        excludedMemoryIds: [],
        mcpToolBindings: revision.mcpToolBindings ?? [],
      });

      const linkedOccurrence = this.store.scheduleOccurrences.get(occurrence.id);
      if (!linkedOccurrence) {
        throw new Error('Prepared Schedule occurrence was not available after T3');
      }
      return {
        occurrence: linkedOccurrence,
        task: created.task,
        sessionId: created.sessionId,
        context,
      };
    });
  }

  /** T4 只通过 RunService 的 Main 内入口启动；Occurrence 关联在其 Run 创建事务内提交。 */
  startFirstRun(occurrenceId: string, runs: Pick<RunService, 'start'>): string {
    const occurrence = this.store.scheduleOccurrences.get(occurrenceId);
    if (!occurrence) {
      throw new ScheduleExecutionServiceError('schedule_not_found', '定时实例不存在。');
    }
    if (occurrence.firstRunId) {
      const existing = this.store.runs.get(occurrence.firstRunId);
      if (
        !existing ||
        existing.taskId !== occurrence.taskId ||
        existing.sessionId !== occurrence.sessionId
      ) {
        throw new ScheduleExecutionServiceError(
          'schedule_conflict',
          '本期首个 Run 关联缺失或不属于本期 Task。',
        );
      }
      return existing.id;
    }
    if (occurrence.phase !== 'preparing') {
      throw new ScheduleExecutionServiceError(
        'schedule_conflict',
        '本期已结束，不能再次启动首个 Run。',
      );
    }
    const draft = this.findPreparedDraft(occurrence);
    if (!draft) {
      throw new ScheduleExecutionServiceError(
        'schedule_conflict',
        '本期 Task 草稿尚未完成，不能启动 Run。',
      );
    }
    const request: StartRunRequest = {
      taskId: draft.task.id,
      sessionId: draft.sessionId,
      prompt: draft.task.goal,
      taskContextRevisionId: draft.context.id,
      expectedTaskContextRevision: draft.context.revision,
    };
    return runs.start(request, { occurrenceId: occurrence.id });
  }

  private findPreparedDraft(occurrence: ScheduleOccurrence): ScheduleTaskDraft | undefined {
    if (
      occurrence.taskId === undefined &&
      occurrence.sessionId === undefined &&
      occurrence.preparedAt === undefined
    ) {
      return undefined;
    }
    if (
      occurrence.taskId === undefined ||
      occurrence.sessionId === undefined ||
      occurrence.sourceSnapshotId === undefined ||
      occurrence.preparedAt === undefined
    ) {
      throw new ScheduleExecutionServiceError(
        'schedule_conflict',
        '本期 Task 草稿关联不完整，拒绝重复创建。',
      );
    }
    const aggregate = this.store.schedules.get(occurrence.scheduleId);
    const config = this.store.schedules.getConfig(occurrence.scheduleId, occurrence.configVersion);
    const task = this.store.tasks.getSummary(occurrence.taskId);
    const taskContext = this.store.tasks.getRunContext(occurrence.taskId, occurrence.sessionId);
    const context = this.store.taskContexts.getLatest(occurrence.taskId);
    if (
      !aggregate ||
      !config ||
      !task ||
      !taskContext ||
      task.workspaceId !== aggregate.schedule.workspaceId ||
      !context ||
      context.executor.kind !== 'expert' ||
      context.executor.expertId !== config.expertId ||
      context.executor.expertRevisionId !== config.expertRevisionId ||
      context.scheduleSourceSnapshotId !== occurrence.sourceSnapshotId
    ) {
      throw new ScheduleExecutionServiceError(
        'schedule_conflict',
        '本期已有草稿不完整或与固定配置不一致。',
      );
    }
    return {
      occurrence,
      task,
      sessionId: occurrence.sessionId,
      context,
    };
  }

  private requireReadySnapshot(
    occurrence: ScheduleOccurrence,
    workspaceId: string,
  ): ScheduleSourceSnapshot {
    if (!occurrence.sourceSnapshotId) {
      throw new ScheduleExecutionServiceError(
        'schedule_source_missing',
        '本期还没有完整的固定来源快照。',
      );
    }
    const snapshot = this.store.scheduleSources.get(occurrence.sourceSnapshotId);
    if (
      !snapshot ||
      snapshot.status !== 'ready' ||
      snapshot.occurrenceId !== occurrence.id ||
      snapshot.workspaceId !== workspaceId ||
      snapshot.configVersion !== occurrence.configVersion
    ) {
      throw new ScheduleExecutionServiceError(
        'schedule_source_missing',
        '本期固定来源快照缺失、未就绪或与配置不一致。',
      );
    }
    return snapshot;
  }
}
