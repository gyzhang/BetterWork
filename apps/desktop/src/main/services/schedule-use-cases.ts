import { materialReferenceFingerprint } from '@betterwork/agent-protocol';
import {
  type ExecuteMissedScheduleRequest,
  type ExecuteScheduleNowRequest,
  type ListScheduleOccurrencesRequest,
  type ListScheduleSourceItemsRequest,
  type ScheduleChangedEvent,
  scheduleConfigDraftSchema,
  type ScheduleDetail,
  type ScheduleDomainError,
  type ScheduleManualExecutionResult,
  type ScheduleOccurrence,
  type ScheduleOccurrenceDetail,
  type ScheduleOccurrenceHistoryPage,
  type ScheduleSourceItemsPage,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { resolveSchedulePeriod } from './schedule-calendar';
import type { ScheduleDispatchService } from './schedule-dispatch-service';
import type { ScheduleOutcomeService } from './schedule-outcome-service';
import type { SchedulePreflightService } from './schedule-preflight';
import type { ScheduleService } from './schedule-service';

export class ScheduleUseCaseError extends Error {
  constructor(readonly domainError: ScheduleDomainError) {
    super(domainError.message);
    this.name = 'ScheduleUseCaseError';
  }
}

const useCaseError = (
  code: ScheduleDomainError['code'],
  message: string,
  details: Omit<ScheduleDomainError, 'code' | 'message'> = {},
): ScheduleUseCaseError => new ScheduleUseCaseError({ code, message, ...details });

export class ScheduleQueries {
  constructor(
    private readonly store: AppStore,
    private readonly schedules: Pick<ScheduleService, 'get'>,
    private readonly outcomes: Pick<ScheduleOutcomeService, 'projectOccurrence'>,
  ) {}

  getSchedule(scheduleId: string): ScheduleDetail {
    const aggregate = this.schedules.get(scheduleId);
    if (!aggregate) throw useCaseError('schedule_not_found', '定时规则不存在。');
    const expert = this.store.experts.get(aggregate.config.expertId);
    const boundRevision = this.store.experts.getRevision(
      aggregate.config.expertId,
      aggregate.config.expertRevisionId,
    );
    if (!expert || !boundRevision) {
      throw useCaseError('schedule_capability_blocked', '固定专家修订已不可用。');
    }
    return {
      aggregate,
      expertUpdate: {
        boundRevision,
        currentRevision: expert.revision,
        available: expert.revision.id !== boundRevision.id,
      },
      history: this.projectHistory(
        this.store.scheduleOccurrences.listBySchedule({ scheduleId, limit: 6 }),
      ),
    };
  }

  listOccurrences(input: ListScheduleOccurrencesRequest): ScheduleOccurrenceHistoryPage {
    if (!this.schedules.get(input.scheduleId)) {
      throw useCaseError('schedule_not_found', '定时规则不存在。');
    }
    return this.projectHistory(this.store.scheduleOccurrences.listBySchedule(input));
  }

  getOccurrence(occurrenceId: string): ScheduleOccurrenceDetail {
    const occurrence = this.store.scheduleOccurrences.get(occurrenceId);
    if (!occurrence) throw useCaseError('schedule_not_found', '定时实例不存在。');
    const config = this.store.schedules.getConfig(occurrence.scheduleId, occurrence.configVersion);
    if (!config) throw useCaseError('schedule_conflict', '本期固定配置不可用。');
    const run = occurrence.firstRunId ? this.store.runs.get(occurrence.firstRunId) : undefined;
    if (occurrence.firstRunId && !run) {
      throw useCaseError('schedule_conflict', '本期关联的 Run 不可用。');
    }
    const task = occurrence.taskId ? this.store.tasks.getSummary(occurrence.taskId) : undefined;
    const sourceSnapshot = occurrence.sourceSnapshotId
      ? this.store.scheduleSources.get(occurrence.sourceSnapshotId)
      : undefined;
    const reads = run
      ? this.store.materialReads
          .listByRun(run.id)
          .filter((item) => item.operation === 'read' || item.operation === 'parse')
      : [];
    const readMaterials = new Set(reads.map((item) => materialReferenceFingerprint(item.material)));
    const adoptedMaterials = new Set(
      run
        ? this.store.artifactInputRelations
            .listBySourceRun(run.taskId, run.id)
            .map((item) =>
              item.input.kind === 'evidence'
                ? JSON.stringify(item.input)
                : materialReferenceFingerprint(item.input),
            )
        : [],
    );
    const result = this.outcomes.projectOccurrence(occurrence.id);
    if (!result) throw useCaseError('schedule_conflict', '定时实例结果不可用。');
    return {
      occurrence,
      result,
      config,
      ...(task ? { task } : {}),
      ...(run ? { run } : {}),
      ...(sourceSnapshot ? { sourceSnapshot } : {}),
      outputReceipts: this.store.scheduleOutputs.listByOccurrence(occurrence.id),
      readMaterialCount: readMaterials.size,
      adoptedMaterialCount: adoptedMaterials.size,
    };
  }

  listSourceItems(input: ListScheduleSourceItemsRequest): ScheduleSourceItemsPage {
    if (!this.store.scheduleOccurrences.get(input.occurrenceId)) {
      throw useCaseError('schedule_not_found', '定时实例不存在。');
    }
    return this.store.scheduleSources.listItems(input);
  }

  private projectHistory(page: {
    items: ScheduleOccurrence[];
    nextCursor?: ScheduleOccurrenceHistoryPage['nextCursor'];
  }): ScheduleOccurrenceHistoryPage {
    return {
      items: page.items.map((occurrence) => {
        const run = occurrence.firstRunId ? this.store.runs.get(occurrence.firstRunId) : undefined;
        const result = this.outcomes.projectOccurrence(occurrence.id);
        if (!result) throw useCaseError('schedule_conflict', '定时实例结果不可用。');
        return { occurrence, ...(run ? { run } : {}), result };
      }),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  }
}

export type ScheduleManualInput =
  | (ExecuteScheduleNowRequest & { trigger: 'manual-now' })
  | (ExecuteMissedScheduleRequest & { trigger: 'manual-missed' });

interface ScheduleManualExecutionDependencies {
  store: AppStore;
  schedules: Pick<ScheduleService, 'get'>;
  preflight: Pick<SchedulePreflightService, 'check'>;
  dispatch: Pick<ScheduleDispatchService, 'prepareAndStart'>;
  onChanged: (event: ScheduleChangedEvent) => void;
  now?: () => number;
}

export class ScheduleManualExecution {
  private readonly store: AppStore;
  private readonly schedules: Pick<ScheduleService, 'get'>;
  private readonly preflight: Pick<SchedulePreflightService, 'check'>;
  private readonly dispatch: Pick<ScheduleDispatchService, 'prepareAndStart'>;
  private readonly onChanged: (event: ScheduleChangedEvent) => void;
  private readonly now: () => number;

  constructor(deps: ScheduleManualExecutionDependencies) {
    this.store = deps.store;
    this.schedules = deps.schedules;
    this.preflight = deps.preflight;
    this.dispatch = deps.dispatch;
    this.onChanged = deps.onChanged;
    this.now = deps.now ?? Date.now;
  }

  async execute(input: ScheduleManualInput): Promise<ScheduleManualExecutionResult> {
    const requestedAt = this.now();
    const duplicate = this.store.scheduleOccurrences.findManualRequest({
      scheduleId: input.scheduleId,
      requestKey: input.requestKey,
      trigger: input.trigger,
      ...(input.trigger === 'manual-missed'
        ? { originalOccurrenceId: input.originalOccurrenceId }
        : {}),
    });
    if (duplicate) return { accepted: true as const, duplicate: true, occurrence: duplicate };

    const aggregate = this.schedules.get(input.scheduleId);
    if (!aggregate) throw useCaseError('schedule_not_found', '定时规则不存在。');
    if (aggregate.schedule.revision !== input.expectedRevision) {
      throw useCaseError('schedule_conflict', '定时规则已在其他位置更新，请载入最新配置后重试。', {
        currentRevision: aggregate.schedule.revision,
      });
    }
    if (aggregate.schedule.lifecycle === 'archived') {
      throw useCaseError('schedule_archived', '已归档规则不能执行。');
    }
    if (input.trigger === 'manual-missed') {
      const original = this.store.scheduleOccurrences.get(input.originalOccurrenceId);
      if (
        !original ||
        original.scheduleId !== input.scheduleId ||
        original.trigger !== 'scheduled' ||
        original.phase !== 'closed' ||
        original.preparationOutcome !== 'missed'
      ) {
        throw useCaseError('schedule_conflict', '只能补做同一规则的已错过计划实例。');
      }
    }
    const config = scheduleConfigDraftSchema.parse({
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
    const preflight = await this.preflight.check({
      workspaceId: aggregate.schedule.workspaceId,
      config,
    });
    if (preflight.status === 'blocked') {
      throw useCaseError('schedule_capability_blocked', '当前专家能力未通过执行前检查。', {
        problems: preflight.problems.map(({ code, message }) => ({ code, message })),
      });
    }
    if (preflight.fingerprint !== input.preflightFingerprint) {
      throw useCaseError('schedule_conflict', '能力预检结果已变化，请重新检查后再执行。');
    }

    const claim =
      input.trigger === 'manual-now'
        ? this.store.scheduleOccurrences.claimManual({
            scheduleId: input.scheduleId,
            expectedRevision: input.expectedRevision,
            trigger: input.trigger,
            requestKey: input.requestKey,
            requestedAt,
            period: resolveSchedulePeriod(config.periodRule, config.timing.timeZone, requestedAt),
          })
        : this.store.scheduleOccurrences.claimManual({
            scheduleId: input.scheduleId,
            expectedRevision: input.expectedRevision,
            trigger: input.trigger,
            requestKey: input.requestKey,
            requestedAt,
            originalOccurrenceId: input.originalOccurrenceId,
          });
    if (claim.kind === 'busy') {
      throw useCaseError('schedule_busy', '这条规则已有一期正在准备或执行。', {
        existingOccurrenceId: claim.existingOccurrenceId,
      });
    }
    if (claim.kind === 'existing') {
      return { accepted: true as const, duplicate: true, occurrence: claim.occurrence };
    }

    this.onChanged({
      scheduleId: claim.occurrence.scheduleId,
      occurrenceId: claim.occurrence.id,
      reason: 'occurrence',
    });
    void this.dispatch
      .prepareAndStart(claim.occurrence.id, undefined, preflight.fingerprint)
      .catch((error: unknown) => console.error('Manual Schedule preparation failed', error));
    return { accepted: true as const, duplicate: false, occurrence: claim.occurrence };
  }
}
