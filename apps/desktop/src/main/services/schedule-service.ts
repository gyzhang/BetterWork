import {
  type ApplyScheduleExpertRevisionRequest,
  applyScheduleExpertRevisionRequestSchema,
  type SaveScheduleRequest,
  saveScheduleRequestSchema,
  type Schedule,
  type ScheduleConfigDraft,
  scheduleConfigDraftSchema,
  type ScheduleDomainErrorCode,
  type SetScheduleLifecycleRequest,
  setScheduleLifecycleRequestSchema,
} from '@betterwork/agent-protocol';

import {
  type AppStore,
  type ScheduleAggregate,
  type ScheduleConfigState,
  type ScheduleLifecycleState,
  ScheduleRevisionConflictError,
} from '../persistence';
import { nextTimes } from './schedule-calendar';

export type ScheduleCapabilityCheck =
  { status: 'ready'; fingerprint: string } | { status: 'blocked'; message: string };

export interface ScheduleServiceDependencies {
  now: () => number;
  preflight: (input: {
    target: 'draft';
    workspaceId: string;
    config: ScheduleConfigDraft;
  }) => Promise<ScheduleCapabilityCheck>;
  settleDue: (input: {
    schedule: Schedule;
    throughAt: number;
    reason: 'pause' | 'archive' | 'timing-change' | 'recheck';
  }) => Promise<void>;
  cancelPreparations: (occurrenceIds: readonly string[]) => void;
}

export class ScheduleServiceError extends Error {
  constructor(
    readonly code: ScheduleDomainErrorCode,
    message: string,
    readonly currentRevision?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScheduleServiceError';
  }
}

interface ScheduleMutationResult {
  aggregate: ScheduleAggregate;
  cancelledPreparationIds: string[];
}

const assertTimestamp = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ScheduleServiceError('schedule_clock_untrusted', `${label} 不是有效时间`);
  }
};

const draftFrom = (aggregate: ScheduleAggregate): ScheduleConfigDraft =>
  scheduleConfigDraftSchema.parse({
    name: aggregate.config.name,
    expertId: aggregate.config.expertId,
    expertRevisionId: aggregate.config.expertRevisionId,
    requirements: aggregate.config.requirements,
    expectedArtifactTypes: aggregate.config.expectedArtifactTypes,
    timing: aggregate.config.timing,
    periodRule: aggregate.config.periodRule,
    knowledgeSources: aggregate.config.knowledgeSources,
    outputSubdirectory: aggregate.config.outputSubdirectory,
  });

const equalExceptName = (left: ScheduleConfigDraft, right: ScheduleConfigDraft): boolean => {
  const comparable = (config: ScheduleConfigDraft) => ({
    expertId: config.expertId,
    expertRevisionId: config.expertRevisionId,
    requirements: config.requirements,
    expectedArtifactTypes: config.expectedArtifactTypes,
    timing: config.timing,
    periodRule: config.periodRule,
    knowledgeSources: config.knowledgeSources,
    outputSubdirectory: config.outputSubdirectory,
  });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
};

const enabledLifecycleState = (
  enabledAt: number | undefined,
  capabilityFingerprint: string | undefined,
  nextScheduledAt: number | undefined,
): Extract<ScheduleLifecycleState, { lifecycle: 'enabled' }> => {
  if (enabledAt === undefined || !capabilityFingerprint || nextScheduledAt === undefined) {
    throw new ScheduleServiceError('schedule_capability_blocked', '规则启用检查未能完成');
  }
  return { lifecycle: 'enabled', enabledAt, capabilityFingerprint, nextScheduledAt };
};

const enabledConfigState = (
  enabledAt: number | undefined,
  capabilityFingerprint: string | undefined,
  nextScheduledAt: number | undefined,
): Extract<ScheduleConfigState, { kind: 'enabled' }> => {
  const state = enabledLifecycleState(enabledAt, capabilityFingerprint, nextScheduledAt);
  return {
    kind: 'enabled',
    enabledAt: state.enabledAt,
    capabilityFingerprint: state.capabilityFingerprint,
    nextScheduledAt: state.nextScheduledAt,
  };
};

const equalDraft = (left: ScheduleConfigDraft, right: ScheduleConfigDraft): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const nextOccurrence = (config: ScheduleConfigDraft, after: number): number => {
  const [next] = nextTimes(config.timing, after, 1);
  if (next === undefined) {
    throw new ScheduleServiceError('schedule_invalid_timing', '无法计算这条规则的下一次计划时间');
  }
  return next;
};

export class ScheduleService {
  constructor(
    private readonly store: AppStore,
    private readonly dependencies: ScheduleServiceDependencies,
  ) {}

  get(scheduleId: string): ScheduleAggregate | undefined {
    return this.store.schedules.get(scheduleId);
  }

  async save(request: SaveScheduleRequest): Promise<ScheduleAggregate> {
    const parsed = saveScheduleRequestSchema.parse(request);
    let now = this.dependencies.now();
    assertTimestamp(now, 'now');

    if (parsed.operation === 'create') {
      if (!this.store.workspaces.get(parsed.workspaceId)) {
        throw new ScheduleServiceError('schedule_workspace_unavailable', '工作空间不存在');
      }
      if (parsed.targetLifecycle === 'paused') {
        return this.store.schedules.create({
          workspaceId: parsed.workspaceId,
          config: parsed.config,
          createdAt: now,
        });
      }
      const fingerprint = await this.checkPreflight(
        parsed.workspaceId,
        parsed.config,
        parsed.preflightFingerprint,
      );
      now = this.dependencies.now();
      assertTimestamp(now, 'now');
      return this.store.schedules.create({
        workspaceId: parsed.workspaceId,
        config: parsed.config,
        createdAt: now,
        activation: {
          enabledAt: now,
          capabilityFingerprint: fingerprint,
          nextScheduledAt: nextOccurrence(parsed.config, now),
        },
      });
    }

    const current = this.requireSchedule(parsed.scheduleId);
    this.assertRevision(current, parsed.expectedRevision);
    if (current.schedule.lifecycle === 'archived') {
      throw new ScheduleServiceError('schedule_archived', '已归档规则不能再修改');
    }

    const previousDraft = draftFrom(current);
    const configChanged = !equalDraft(previousDraft, parsed.config);
    const timingChanged =
      JSON.stringify(previousDraft.timing) !== JSON.stringify(parsed.config.timing);
    const onlyNameChanged = equalExceptName(previousDraft, parsed.config);
    const sameLifecycle = current.schedule.lifecycle === parsed.targetLifecycle;

    if (!configChanged && sameLifecycle) return current;

    let fingerprint: string | undefined;
    if (parsed.targetLifecycle === 'enabled') {
      const mayReuseFingerprint =
        current.schedule.lifecycle === 'enabled' &&
        onlyNameChanged &&
        current.schedule.capabilityFingerprint === parsed.preflightFingerprint;
      if (mayReuseFingerprint) {
        fingerprint = current.schedule.capabilityFingerprint;
      } else {
        fingerprint = await this.checkPreflight(
          current.schedule.workspaceId,
          parsed.config,
          parsed.preflightFingerprint,
        );
      }
    }
    if (parsed.targetLifecycle === 'enabled') {
      now = this.dependencies.now();
      assertTimestamp(now, 'now');
    }

    const shouldSettle =
      current.schedule.lifecycle === 'enabled' &&
      (parsed.targetLifecycle === 'paused' ||
        (parsed.targetLifecycle === 'enabled' && timingChanged));
    if (shouldSettle) {
      await this.dependencies.settleDue({
        schedule: current.schedule,
        throughAt: now,
        reason: parsed.targetLifecycle === 'paused' ? 'pause' : 'timing-change',
      });
      now = this.dependencies.now();
      assertTimestamp(now, 'now');
    }
    this.assertRevision(this.requireSchedule(parsed.scheduleId), parsed.expectedRevision);

    const nextScheduledAt =
      parsed.targetLifecycle === 'paused'
        ? undefined
        : current.schedule.lifecycle === 'enabled' && !timingChanged
          ? (current.schedule.nextScheduledAt ?? nextOccurrence(parsed.config, now))
          : nextOccurrence(parsed.config, now);
    const enabledAt =
      parsed.targetLifecycle === 'enabled'
        ? current.schedule.lifecycle === 'enabled'
          ? current.schedule.enabledAt
          : now
        : undefined;
    if (parsed.targetLifecycle === 'enabled' && (!fingerprint || enabledAt === undefined)) {
      throw new ScheduleServiceError('schedule_capability_blocked', '规则启用检查未能完成');
    }

    if (!configChanged) {
      const result = this.store.transaction((): ScheduleMutationResult => {
        const aggregate = this.store.schedules.setLifecycle(
          parsed.scheduleId,
          { expectedRevision: parsed.expectedRevision, updatedAt: now },
          parsed.targetLifecycle === 'enabled'
            ? enabledLifecycleState(enabledAt, fingerprint, nextScheduledAt)
            : { lifecycle: 'paused' },
        );
        const cancelledPreparationIds =
          parsed.targetLifecycle === 'paused'
            ? this.store.scheduleOccurrences.cancelPreparing(parsed.scheduleId, now)
            : [];
        return { aggregate, cancelledPreparationIds };
      });
      this.notifyPreparationsCancelled(result.cancelledPreparationIds);
      return result.aggregate;
    }

    const result = this.store.transaction((): ScheduleMutationResult => {
      const aggregate = this.store.schedules.appendConfig(
        parsed.scheduleId,
        { config: parsed.config, expectedRevision: parsed.expectedRevision, updatedAt: now },
        parsed.targetLifecycle === 'paused'
          ? { kind: 'paused' }
          : enabledConfigState(enabledAt, fingerprint, nextScheduledAt),
      );
      const cancelledPreparationIds =
        current.schedule.lifecycle === 'enabled' && parsed.targetLifecycle === 'paused'
          ? this.store.scheduleOccurrences.cancelPreparing(parsed.scheduleId, now)
          : [];
      return { aggregate, cancelledPreparationIds };
    });
    this.notifyPreparationsCancelled(result.cancelledPreparationIds);
    return result.aggregate;
  }

  async setLifecycle(request: SetScheduleLifecycleRequest): Promise<ScheduleAggregate> {
    const parsed = setScheduleLifecycleRequestSchema.parse(request);
    const current = this.requireSchedule(parsed.scheduleId);
    this.assertRevision(current, parsed.expectedRevision);
    if (current.schedule.lifecycle === 'archived') {
      if (parsed.lifecycle === 'archived') return current;
      throw new ScheduleServiceError('schedule_archived', '已归档规则不能重新启用或修改');
    }
    if (parsed.lifecycle === 'paused' && current.schedule.lifecycle === 'paused') return current;

    let now = this.dependencies.now();
    assertTimestamp(now, 'now');
    let fingerprint: string | undefined;
    if (parsed.lifecycle === 'enabled') {
      fingerprint = await this.checkPreflight(
        current.schedule.workspaceId,
        draftFrom(current),
        parsed.preflightFingerprint,
      );
      now = this.dependencies.now();
      assertTimestamp(now, 'now');
    }

    if (current.schedule.lifecycle === 'enabled') {
      await this.dependencies.settleDue({
        schedule: current.schedule,
        throughAt: now,
        reason:
          parsed.lifecycle === 'paused'
            ? 'pause'
            : parsed.lifecycle === 'archived'
              ? 'archive'
              : 'recheck',
      });
      now = this.dependencies.now();
      assertTimestamp(now, 'now');
    }
    this.assertRevision(this.requireSchedule(parsed.scheduleId), parsed.expectedRevision);

    const result = this.store.transaction((): ScheduleMutationResult => {
      const aggregate = this.store.schedules.setLifecycle(
        parsed.scheduleId,
        { expectedRevision: parsed.expectedRevision, updatedAt: now },
        parsed.lifecycle === 'enabled'
          ? enabledLifecycleState(now, fingerprint, nextOccurrence(draftFrom(current), now))
          : { lifecycle: parsed.lifecycle },
      );
      const cancelledPreparationIds =
        parsed.lifecycle === 'enabled'
          ? []
          : this.store.scheduleOccurrences.cancelPreparing(parsed.scheduleId, now);
      return { aggregate, cancelledPreparationIds };
    });
    this.notifyPreparationsCancelled(result.cancelledPreparationIds);
    return result.aggregate;
  }

  async applyExpertRevision(
    request: ApplyScheduleExpertRevisionRequest,
  ): Promise<ScheduleAggregate> {
    const parsed = applyScheduleExpertRevisionRequestSchema.parse(request);
    const current = this.requireSchedule(parsed.scheduleId);
    this.assertRevision(current, parsed.expectedRevision);
    if (current.schedule.lifecycle === 'archived') {
      throw new ScheduleServiceError('schedule_archived', '已归档规则不能再修改');
    }
    const revision = this.store.experts.getRevision(
      current.config.expertId,
      parsed.expertRevisionId,
    );
    if (!revision) {
      throw new ScheduleServiceError(
        'schedule_conflict',
        '目标专家修订不存在或不属于当前绑定的专家。',
      );
    }
    if (revision.id === current.config.expertRevisionId) return current;

    return this.save({
      operation: 'update',
      scheduleId: parsed.scheduleId,
      expectedRevision: parsed.expectedRevision,
      config: { ...draftFrom(current), expertRevisionId: revision.id },
      targetLifecycle: current.schedule.lifecycle === 'enabled' ? 'enabled' : 'paused',
      ...(parsed.preflightFingerprint === undefined
        ? {}
        : { preflightFingerprint: parsed.preflightFingerprint }),
    });
  }

  private async checkPreflight(
    workspaceId: string,
    config: ScheduleConfigDraft,
    confirmedFingerprint: string | undefined,
  ): Promise<string> {
    const result = await this.dependencies.preflight({ target: 'draft', workspaceId, config });
    if (result.status === 'blocked') {
      throw new ScheduleServiceError('schedule_capability_blocked', result.message);
    }
    if (result.fingerprint.trim().length === 0 || result.fingerprint !== confirmedFingerprint) {
      throw new ScheduleServiceError(
        'schedule_conflict',
        '能力预检结果已变化，请重新检查并确认后再启用',
      );
    }
    return result.fingerprint;
  }

  private requireSchedule(scheduleId: string): ScheduleAggregate {
    const aggregate = this.store.schedules.get(scheduleId);
    if (!aggregate) throw new ScheduleServiceError('schedule_not_found', '定时任务不存在');
    return aggregate;
  }

  private assertRevision(aggregate: ScheduleAggregate, expectedRevision: number): void {
    if (aggregate.schedule.revision !== expectedRevision) {
      throw new ScheduleRevisionConflictError(aggregate.schedule.revision, expectedRevision);
    }
  }

  private notifyPreparationsCancelled(occurrenceIds: readonly string[]): void {
    if (occurrenceIds.length > 0) this.dependencies.cancelPreparations(occurrenceIds);
  }
}
