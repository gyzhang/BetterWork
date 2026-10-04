import {
  SCHEDULE_PREPARATION_TIMEOUT_MS,
  type ScheduleChangedEvent,
  type ScheduleConfigDraft,
  type ScheduleDomainErrorCode,
  type ScheduleOccurrence,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import type { RunService } from './run-service';
import type { ScheduleExecutionService } from './schedule-execution-service';
import type { SchedulePreflightService } from './schedule-preflight';
import type { ScheduleSourceService } from './schedule-source-service';
import { ScheduleSourceServiceError } from './schedule-source-service';

export interface ScheduleDispatchServiceOptions {
  readonly now?: () => number;
  readonly onChanged?: (event: ScheduleChangedEvent) => void;
  readonly onOccurrenceClosed?: (occurrenceId: string) => (() => void) | undefined;
  readonly preparationTimeoutMs?: number;
}

export type ScheduleOccurrenceStopResult =
  'cancelled-preparation' | 'cancel-requested' | 'already-terminal' | 'not-found';

export class ScheduleDispatchServiceError extends Error {
  constructor(
    readonly code: ScheduleDomainErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScheduleDispatchServiceError';
  }
}

interface ActivePreparation {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

const PREPARATION_TIMEOUT_REASON = new Error('schedule-preparation-timeout');
const PREPARATION_CANCEL_REASON = new Error('schedule-preparation-cancelled');

const asError = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error('Operation was aborted', { cause: reason });

const awaitWithSignal = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) return Promise.reject(asError(signal.reason));
  return new Promise<T>((resolve, reject) => {
    const rejectAbort = (): void => reject(asError(signal.reason));
    signal.addEventListener('abort', rejectAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', rejectAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', rejectAbort);
        reject(asError(error));
      },
    );
  });
};

/** Coordinates the Main-only source, capability, T3, and T4 path for one occurrence. */
export class ScheduleDispatchService {
  private readonly now: () => number;
  private readonly preparationTimeoutMs: number;
  private readonly onChanged: (event: ScheduleChangedEvent) => void;
  private readonly onOccurrenceClosed:
    ((occurrenceId: string) => (() => void) | undefined) | undefined;
  private readonly activePreparations = new Map<string, ActivePreparation>();

  constructor(
    private readonly store: AppStore,
    private readonly sources: Pick<ScheduleSourceService, 'prepare'>,
    private readonly preflight: Pick<SchedulePreflightService, 'check'>,
    private readonly execution: Pick<
      ScheduleExecutionService,
      'prepareTaskDraft' | 'startFirstRun'
    >,
    private readonly runs: Pick<RunService, 'cancel' | 'start'>,
    options: ScheduleDispatchServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.preparationTimeoutMs = options.preparationTimeoutMs ?? SCHEDULE_PREPARATION_TIMEOUT_MS;
    this.onChanged = options.onChanged ?? (() => undefined);
    this.onOccurrenceClosed = options.onOccurrenceClosed;
  }

  get activePreparationCount(): number {
    return this.activePreparations.size;
  }

  dispatch(occurrence: ScheduleOccurrence, signal: AbortSignal): Promise<void> {
    return this.prepareAndStart(occurrence.id, signal);
  }

  prepareAndStart(
    occurrenceId: string,
    outerSignal?: AbortSignal,
    expectedFingerprint?: string,
  ): Promise<void> {
    const existing = this.activePreparations.get(occurrenceId);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const relayAbort = (): void =>
      controller.abort(outerSignal?.reason ?? PREPARATION_CANCEL_REASON);
    if (outerSignal?.aborted) relayAbort();
    else outerSignal?.addEventListener('abort', relayAbort, { once: true });

    const timeout = setTimeout(
      () => controller.abort(PREPARATION_TIMEOUT_REASON),
      this.preparationTimeoutMs,
    );
    const promise = Promise.resolve()
      .then(() => this.runStages(occurrenceId, controller.signal, expectedFingerprint))
      .catch((error: unknown) => this.closeAfterFailure(occurrenceId, controller.signal, error))
      .finally(() => {
        clearTimeout(timeout);
        outerSignal?.removeEventListener('abort', relayAbort);
        const active = this.activePreparations.get(occurrenceId);
        if (active?.controller === controller) this.activePreparations.delete(occurrenceId);
      });
    this.activePreparations.set(occurrenceId, { controller, promise });
    return promise;
  }

  cancelPreparation(occurrenceId: string): boolean {
    const active = this.activePreparations.get(occurrenceId);
    const aborted = Boolean(active && !active.controller.signal.aborted);
    if (aborted) active?.controller.abort(PREPARATION_CANCEL_REASON);
    const occurrence = this.store.scheduleOccurrences.get(occurrenceId);
    if (occurrence?.phase === 'preparing') {
      const afterCommit = this.store.transaction(() => {
        this.store.scheduleOccurrences.closePreparation({
          occurrenceId,
          outcome: 'cancelled',
          finishedAt: this.timestampFor(occurrence.requestedAt),
          reasonCode: 'schedule_cancelled',
          reasonDetail: '本期准备已取消；不会启动 Run。',
        });
        return this.onOccurrenceClosed?.(occurrenceId);
      });
      afterCommit?.();
      this.publishChange(occurrence.scheduleId, occurrenceId);
    }
    return aborted || occurrence?.phase === 'preparing';
  }

  cancelPreparations(): number {
    let cancelled = 0;
    for (const occurrenceId of this.activePreparations.keys()) {
      if (this.cancelPreparation(occurrenceId)) cancelled += 1;
    }
    return cancelled;
  }

  async waitForPreparations(): Promise<void> {
    const pending = [...this.activePreparations.values()].map(({ promise }) => promise);
    if (pending.length > 0) await Promise.allSettled(pending);
  }

  /** Pause/archive only reaches preparing work; an already dispatched Run is cancelled explicitly. */
  stopOccurrence(occurrenceId: string): ScheduleOccurrenceStopResult {
    const occurrence = this.store.scheduleOccurrences.get(occurrenceId);
    if (!occurrence) return 'not-found';
    if (occurrence.phase === 'preparing') {
      this.cancelPreparation(occurrenceId);
      return 'cancelled-preparation';
    }
    if (occurrence.phase === 'dispatched' && occurrence.firstRunId) {
      const cancelled = this.runs.cancel(occurrence.firstRunId);
      if (cancelled) this.publishChange(occurrence.scheduleId, occurrenceId);
      return cancelled ? 'cancel-requested' : 'already-terminal';
    }
    return 'already-terminal';
  }

  private async runStages(
    occurrenceId: string,
    signal: AbortSignal,
    expectedFingerprint?: string,
  ): Promise<void> {
    const occurrence = this.requirePreparing(occurrenceId, signal);
    const aggregate = this.store.schedules.get(occurrence.scheduleId);
    const config = this.store.schedules.getConfig(occurrence.scheduleId, occurrence.configVersion);
    if (!aggregate || !config) {
      throw new ScheduleDispatchServiceError('schedule_conflict', '本期固定规则配置不可用。');
    }
    if (aggregate.schedule.lifecycle === 'archived') {
      throw new ScheduleDispatchServiceError('schedule_archived', '规则已归档，不能启动本期。');
    }
    if (occurrence.trigger === 'scheduled' && aggregate.schedule.lifecycle !== 'enabled') {
      throw new ScheduleDispatchServiceError(
        'schedule_cancelled',
        '规则已暂停，本期自动执行已取消。',
      );
    }
    const fingerprint = expectedFingerprint ?? aggregate.schedule.capabilityFingerprint;

    await this.checkCapability(aggregate.schedule.workspaceId, config, fingerprint, signal);
    this.requirePreparing(occurrenceId, signal);
    const snapshot = await awaitWithSignal(this.sources.prepare(occurrenceId, signal), signal);
    this.requirePreparing(occurrenceId, signal);
    this.publishChange(occurrence.scheduleId, occurrenceId);
    const readyOccurrence = this.store.scheduleOccurrences.get(occurrenceId);
    if (
      !readyOccurrence ||
      readyOccurrence.sourceSnapshotId !== snapshot.id ||
      snapshot.status !== 'ready'
    ) {
      throw new ScheduleDispatchServiceError(
        'schedule_source_missing',
        '本期固定来源尚未完整就绪。',
      );
    }

    await this.checkCapability(aggregate.schedule.workspaceId, config, fingerprint, signal);
    this.requirePreparing(occurrenceId, signal);
    this.execution.prepareTaskDraft(occurrenceId);
    this.publishChange(occurrence.scheduleId, occurrenceId);
    await this.checkCapability(aggregate.schedule.workspaceId, config, fingerprint, signal);
    this.requirePreparing(occurrenceId, signal);
    this.execution.startFirstRun(occurrenceId, this.runs);
    this.publishChange(occurrence.scheduleId, occurrenceId);
  }

  private async checkCapability(
    workspaceId: string,
    config: ScheduleConfigDraft,
    expectedFingerprint: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const result = await awaitWithSignal(this.preflight.check({ workspaceId, config }), signal);
    if (result.status === 'blocked') {
      throw new ScheduleDispatchServiceError(
        'schedule_capability_blocked',
        result.problems[0]?.message ?? '本期能力预检未通过。',
      );
    }
    if (expectedFingerprint !== undefined && result.fingerprint !== expectedFingerprint) {
      throw new ScheduleDispatchServiceError(
        'schedule_capability_blocked',
        '已确认的专家、模型、技能或授权发生变化；请重新检查并启用规则。',
      );
    }
  }

  private requirePreparing(occurrenceId: string, signal: AbortSignal): ScheduleOccurrence {
    if (signal.aborted) {
      throw new ScheduleDispatchServiceError(
        signal.reason === PREPARATION_TIMEOUT_REASON
          ? 'schedule_preparation_timeout'
          : 'schedule_cancelled',
        signal.reason === PREPARATION_TIMEOUT_REASON ? '本期准备超过 120 秒。' : '本期准备已取消。',
      );
    }
    const occurrence = this.store.scheduleOccurrences.get(occurrenceId);
    if (!occurrence || occurrence.phase !== 'preparing') {
      throw new ScheduleDispatchServiceError(
        'schedule_cancelled',
        '本期实例已取消或离开准备阶段。',
      );
    }
    return occurrence;
  }

  private closeAfterFailure(occurrenceId: string, signal: AbortSignal, error: unknown): void {
    const occurrence = this.store.scheduleOccurrences.get(occurrenceId);
    if (!occurrence || occurrence.phase !== 'preparing') return;
    const timedOut =
      signal.reason === PREPARATION_TIMEOUT_REASON ||
      (error instanceof ScheduleDispatchServiceError &&
        error.code === 'schedule_preparation_timeout');
    const cancelled =
      signal.aborted ||
      (error instanceof ScheduleDispatchServiceError && error.code === 'schedule_cancelled');
    const code =
      error instanceof ScheduleDispatchServiceError
        ? error.code
        : error instanceof ScheduleSourceServiceError
          ? error.code
          : timedOut
            ? 'schedule_preparation_timeout'
            : cancelled
              ? 'schedule_cancelled'
              : 'schedule_preparation_failed';
    const afterCommit = this.store.transaction(() => {
      this.store.scheduleOccurrences.closePreparation({
        occurrenceId,
        outcome: cancelled && !timedOut ? 'cancelled' : 'blocked',
        finishedAt: this.timestampFor(occurrence.requestedAt),
        reasonCode: code,
        reasonDetail:
          error instanceof Error
            ? error.message.slice(0, 2_000)
            : '定时准备失败，尚未请求模型；请打开本期记录查看原因。',
      });
      return this.onOccurrenceClosed?.(occurrenceId);
    });
    afterCommit?.();
    this.publishChange(occurrence.scheduleId, occurrenceId);
  }

  private publishChange(scheduleId: string, occurrenceId: string): void {
    this.onChanged({ scheduleId, occurrenceId, reason: 'occurrence' });
  }

  private timestampFor(fallback: number): number {
    const current = this.now();
    return Number.isSafeInteger(current) && current >= 0 ? current : fallback;
  }
}
