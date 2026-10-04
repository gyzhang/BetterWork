import type { ScheduleChangedEvent, ScheduleOccurrence } from '@betterwork/agent-protocol';

import type {
  ScheduleAggregate,
  ScheduleRecoveryBatch,
  ScheduleRecoveryCursor,
} from '../persistence';
import type { AppStore } from '../persistence';
import { nextTimes, resolveSchedulePeriod } from './schedule-calendar';

export const SCHEDULE_TICK_INTERVAL_MS = 30_000;
export const SCHEDULE_LATE_WINDOW_MS = 60_000;
export const SCHEDULE_MISSED_BATCH_SIZE = 100;
const MAX_CONCURRENT_PREPARATIONS = 2;

export interface ScheduleSchedulerTimer {
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof globalThis.setInterval>;
  clearInterval(handle: ReturnType<typeof globalThis.setInterval>): void;
}

export interface ScheduleDispatchContext {
  readonly generation: number;
  readonly signal: AbortSignal;
}

export interface ScheduleSchedulerOptions {
  readonly wallClock?: () => number;
  readonly monotonicClock?: () => number;
  readonly timer?: ScheduleSchedulerTimer;
  /** Resolves when occurrence preparation ends or the first Run has been handed off. */
  readonly dispatch: (
    occurrence: ScheduleOccurrence,
    context: ScheduleDispatchContext,
  ) => void | Promise<void>;
  readonly recoverPreparations?: () => void | Promise<void>;
  readonly onChanged?: (event: ScheduleChangedEvent) => void;
  readonly onOccurrenceClosed?: (occurrenceId: string) => (() => void) | undefined;
  /** Runs synchronously inside batch completion; its returned publisher runs after commit. */
  readonly onRecoveryBatchCompleted?: (batchKey: string) => (() => void) | void;
  readonly onError: (error: unknown) => void;
  readonly yieldToEventLoop?: () => Promise<void>;
}

interface ClockSample {
  readonly wallAt: number;
  readonly monotonicAt: number;
}

type ClockJump = 'forward' | 'backward' | undefined;

const systemTimer: ScheduleSchedulerTimer = {
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearInterval: (handle) => globalThis.clearInterval(handle),
};

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

const validWallTime = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const validMonotonicTime = (value: number): boolean => Number.isFinite(value) && value >= 0;

const compareCursor = (
  left: ScheduleRecoveryCursor | undefined,
  right: ScheduleRecoveryCursor,
): number => {
  if (!left) return 1;
  if (right.scheduleId !== left.scheduleId) return right.scheduleId > left.scheduleId ? 1 : -1;
  if (right.scheduledAt === left.scheduledAt) return 0;
  return right.scheduledAt > left.scheduledAt ? 1 : -1;
};

/** Main 侧调度事实产生器；执行准备由调用方注入，不依赖 Expert 或 Run。 */
export class ScheduleScheduler {
  private readonly wallClock: () => number;
  private readonly monotonicClock: () => number;
  private readonly timer: ScheduleSchedulerTimer;
  private readonly dispatch: ScheduleSchedulerOptions['dispatch'];
  private readonly recoverPreparations: NonNullable<
    ScheduleSchedulerOptions['recoverPreparations']
  >;
  private readonly onChanged: NonNullable<ScheduleSchedulerOptions['onChanged']>;
  private readonly onOccurrenceClosed: NonNullable<ScheduleSchedulerOptions['onOccurrenceClosed']>;
  private readonly onRecoveryBatchCompleted: NonNullable<
    ScheduleSchedulerOptions['onRecoveryBatchCompleted']
  >;
  private readonly onError: (error: unknown) => void;
  private readonly yieldToEventLoop: () => Promise<void>;
  private timerHandle: ReturnType<typeof globalThis.setInterval> | undefined;
  private generation = 0;
  private lastClockSample: ClockSample | undefined;
  private readonly activeDispatches = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private serialized: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: AppStore,
    options: ScheduleSchedulerOptions,
  ) {
    this.wallClock = options.wallClock ?? (() => Date.now());
    this.monotonicClock = options.monotonicClock ?? (() => performance.now());
    this.timer = options.timer ?? systemTimer;
    this.dispatch = options.dispatch;
    this.recoverPreparations = options.recoverPreparations ?? (() => undefined);
    this.onChanged = options.onChanged ?? (() => undefined);
    this.onOccurrenceClosed = options.onOccurrenceClosed ?? (() => undefined);
    this.onRecoveryBatchCompleted = options.onRecoveryBatchCompleted ?? (() => undefined);
    this.onError = options.onError;
    this.yieldToEventLoop = options.yieldToEventLoop ?? yieldToEventLoop;
  }

  get activePreparationCount(): number {
    return this.activeDispatches.size;
  }

  start(): void {
    if (this.timerHandle !== undefined) return;
    const generation = ++this.generation;
    this.timerHandle = this.timer.setInterval(() => {
      void this.tickForGeneration(generation).catch((error: unknown) => this.reportError(error));
    }, SCHEDULE_TICK_INTERVAL_MS);
  }

  /** 关闭 timer、让排队 tick 失效，并取消尚未移交给 Run 的准备。 */
  stop(): void {
    this.generation += 1;
    if (this.timerHandle !== undefined) {
      this.timer.clearInterval(this.timerHandle);
      this.timerHandle = undefined;
    }
    this.cancelPreparations();
  }

  cancelPreparation(occurrenceId: string): boolean {
    const active = this.activeDispatches.get(occurrenceId);
    if (!active || active.controller.signal.aborted) return false;
    active.controller.abort('schedule-preparation-cancelled');
    return true;
  }

  cancelPreparations(): number {
    let cancelled = 0;
    for (const active of this.activeDispatches.values()) {
      if (active.controller.signal.aborted) continue;
      active.controller.abort('schedule-preparation-cancelled');
      cancelled += 1;
    }
    return cancelled;
  }

  async waitForPreparations(): Promise<void> {
    const pending = [...this.activeDispatches.values()].map(({ promise }) => promise);
    if (pending.length > 0) await Promise.allSettled(pending);
  }

  tick(): Promise<void> {
    return this.enqueue(() => this.performTick(this.generation));
  }

  /** restart/resume 的 cutoff 固定在调用时；所有更早时刻只记 missed，不补跑。 */
  recover(input: { batchKey?: string } = {}): Promise<ScheduleRecoveryBatch | undefined> {
    return this.enqueue(async () => {
      await this.recoverPreparations();
      const sample = this.readClockSample();
      if (!sample) {
        this.blockForUntrustedClock();
        return undefined;
      }
      this.lastClockSample = sample;
      const generation = this.generation;
      return this.processMissedBatch({
        cutoffAt: sample.wallAt,
        generation,
        ...(input.batchKey === undefined ? {} : { batchKey: input.batchKey }),
      });
    });
  }

  /** Settle due rows against the old timing before pause, archive, or schedule edits commit. */
  settleDue(input: {
    schedule: ScheduleAggregate['schedule'];
    throughAt: number;
    reason: 'pause' | 'archive' | 'timing-change' | 'recheck';
  }): Promise<void> {
    return this.enqueue(() => {
      if (!validWallTime(input.throughAt)) throw new Error('Schedule settlement time is invalid');
      let aggregate = this.store.schedules.get(input.schedule.id);
      if (!aggregate) throw new Error(`Schedule no longer exists: ${input.schedule.id}`);
      if (aggregate.schedule.revision !== input.schedule.revision) {
        throw new Error('Schedule changed before due occurrences were settled');
      }

      let scheduledAt = aggregate.schedule.nextScheduledAt;
      while (
        aggregate.schedule.lifecycle === 'enabled' &&
        scheduledAt !== undefined &&
        scheduledAt <= input.throughAt
      ) {
        const configVersion = aggregate.schedule.enabledConfigVersion;
        if (configVersion === undefined) {
          throw new Error(`Enabled Schedule has no config version: ${aggregate.schedule.id}`);
        }
        const config = this.store.schedules.getConfig(aggregate.schedule.id, configVersion);
        if (!config)
          throw new Error(`Enabled Schedule config is missing: ${aggregate.schedule.id}`);
        const nextScheduledAt = nextTimes(config.timing, scheduledAt, 1)[0];
        if (nextScheduledAt === undefined) {
          throw new Error('Schedule calendar did not return a next time');
        }
        const scheduleId = aggregate.schedule.id;
        const settledScheduledAt = scheduledAt;
        const committed = this.store.transaction(() => {
          const claim = this.store.scheduleOccurrences.claimMissedScheduled({
            scheduleId,
            scheduledAt: settledScheduledAt,
            requestedAt: input.throughAt,
            period: resolveSchedulePeriod(
              config.periodRule,
              config.timing.timeZone,
              settledScheduledAt,
            ),
            nextScheduledAt,
            reasonCode:
              input.reason === 'pause' || input.reason === 'archive'
                ? 'schedule_cancelled'
                : input.reason === 'recheck'
                  ? 'schedule_capability_blocked'
                  : 'schedule_conflict',
            reasonDetail:
              input.reason === 'pause'
                ? '规则暂停前已到期但未派发，本期已记为错过。'
                : input.reason === 'archive'
                  ? '规则归档前已到期但未派发，本期已记为错过。'
                  : input.reason === 'timing-change'
                    ? '修改计划前的旧计划时刻已到期，本期已记为错过。'
                    : '重新检查能力前的旧计划时刻已到期，本期已记为错过。',
          });
          if (claim.kind === 'busy') {
            throw new Error('Automatic Schedule claim unexpectedly returned a manual busy result');
          }
          return {
            claim,
            afterCommit: this.onOccurrenceClosed(claim.occurrence.id),
          };
        });
        committed.afterCommit?.();
        const claim = committed.claim;
        this.publishChanged(claim.occurrence.scheduleId, claim.occurrence.id, 'occurrence');
        aggregate = this.store.schedules.get(input.schedule.id);
        if (!aggregate) throw new Error(`Schedule no longer exists: ${input.schedule.id}`);
        scheduledAt = aggregate.schedule.nextScheduledAt;
      }
    });
  }

  private enqueue<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.serialized.then(operation, operation);
    this.serialized = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private tickForGeneration(generation: number): Promise<void> {
    return this.enqueue(() => this.performTick(generation));
  }

  private readClockSample(): ClockSample | undefined {
    const wallAt = this.wallClock();
    const monotonicAt = this.monotonicClock();
    if (!validWallTime(wallAt) || !validMonotonicTime(monotonicAt)) return undefined;
    return { wallAt, monotonicAt };
  }

  private jumpDirection(sample: ClockSample): ClockJump | 'untrusted' {
    const previous = this.lastClockSample;
    this.lastClockSample = sample;
    if (!previous) return undefined;
    if (sample.monotonicAt < previous.monotonicAt) return 'untrusted';
    const wallDelta = sample.wallAt - previous.wallAt;
    const monotonicDelta = sample.monotonicAt - previous.monotonicAt;
    const discrepancy = wallDelta - monotonicDelta;
    if (discrepancy > SCHEDULE_LATE_WINDOW_MS) return 'forward';
    if (discrepancy < -SCHEDULE_LATE_WINDOW_MS) return 'backward';
    return undefined;
  }

  private async performTick(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    const sample = this.readClockSample();
    if (!sample) {
      this.blockForUntrustedClock();
      return;
    }
    const jump = this.jumpDirection(sample);
    if (jump === 'untrusted') {
      this.blockForUntrustedClock(sample.wallAt);
      return;
    }

    const pending = this.store.scheduleRecoveryBatches.getProcessing();
    if (pending) {
      await this.processMissedBatch({ batchKey: pending.batchKey, generation });
      if (generation !== this.generation) return;
    }

    if (jump === 'forward') {
      await this.processMissedBatch({
        cutoffAt: sample.wallAt,
        generation,
        reasonCode: 'schedule_clock_untrusted',
      });
      return;
    }
    if (jump === 'backward') return;

    const overdueCutoff = sample.wallAt - SCHEDULE_LATE_WINDOW_MS;
    await this.processMissedBatch({
      cutoffAt: overdueCutoff,
      generation,
    });
    if (generation !== this.generation) return;
    this.dispatchDue(sample.wallAt, generation);
  }

  private blockForUntrustedClock(detectedAt?: number): void {
    const wallAt = detectedAt ?? this.lastClockSample?.wallAt ?? 0;
    const block = {
      code: 'schedule_clock_untrusted' as const,
      message: '系统时间源不可用，已暂停自动派发；请重新检查并启用规则。',
      detectedAt: validWallTime(wallAt) ? wallAt : 0,
    };
    for (const aggregate of this.store.schedules.listEnabledForDispatch()) {
      if (
        aggregate.schedule.dispatchBlock?.code === block.code &&
        aggregate.schedule.dispatchBlock.detectedAt === block.detectedAt &&
        aggregate.schedule.dispatchBlock.message === block.message
      ) {
        continue;
      }
      this.store.schedules.setDispatchBlock(aggregate.schedule.id, block);
      this.publishChanged(aggregate.schedule.id, undefined, 'recovery');
    }
  }

  private async processMissedBatch(input: {
    cutoffAt?: number;
    generation: number;
    batchKey?: string;
    reasonCode?: 'schedule_clock_untrusted';
  }): Promise<ScheduleRecoveryBatch | undefined> {
    const active = this.store.scheduleRecoveryBatches.getProcessing();
    const cutoffAt = active?.cutoffAt ?? input.cutoffAt;
    if (cutoffAt === undefined) return undefined;
    if (!active && !input.batchKey && !this.hasMissedBefore(cutoffAt)) return undefined;
    const createdAt = active?.createdAt ?? this.validCurrentWallTime() ?? cutoffAt;
    const batch =
      active ??
      this.store.scheduleRecoveryBatches.begin({
        cutoffAt,
        createdAt,
        ...(input.batchKey === undefined ? {} : { batchKey: input.batchKey }),
      });
    if (batch.phase === 'completed') return batch;
    return this.processBatch(batch, input.generation, input.reasonCode);
  }

  private hasMissedBefore(cutoffAt: number): boolean {
    return this.nextPastSchedule(cutoffAt, undefined) !== undefined;
  }

  private async processBatch(
    initial: ScheduleRecoveryBatch,
    generation: number,
    reasonCode?: 'schedule_clock_untrusted',
  ): Promise<ScheduleRecoveryBatch> {
    let batch = initial;
    let processedInTransaction = 0;
    while (batch.phase === 'processing') {
      if (generation !== this.generation) return batch;
      const candidate = this.nextPastSchedule(batch.cutoffAt, batch.cursor);
      if (!candidate) {
        const completedAt = this.validCurrentWallTime() ?? batch.cutoffAt;
        const completion = this.store.transaction(() => {
          const completed = this.store.scheduleRecoveryBatches.complete({
            batchKey: batch.batchKey,
            completedAt,
          });
          return {
            completed,
            afterCommit: this.onRecoveryBatchCompleted(completed.batchKey),
          };
        });
        if (completion.afterCommit) completion.afterCommit();
        return this.store.scheduleRecoveryBatches.get(batch.batchKey) ?? completion.completed;
      }
      const configVersion = candidate.schedule.enabledConfigVersion;
      if (configVersion === undefined) {
        throw new Error(`Enabled Schedule has no config version: ${candidate.schedule.id}`);
      }
      const config = this.store.schedules.getConfig(candidate.schedule.id, configVersion);
      if (!config) throw new Error(`Enabled Schedule config is missing: ${candidate.schedule.id}`);
      const scheduledAt = candidate.scheduledAt;
      const nextScheduledAt = nextTimes(config.timing, scheduledAt, 1)[0];
      if (nextScheduledAt === undefined)
        throw new Error('Schedule calendar did not return a next time');
      const period = resolveSchedulePeriod(config.periodRule, config.timing.timeZone, scheduledAt);
      const occurrenceId = randomOccurrenceId();
      this.store.transaction(() => {
        const claimed = this.store.scheduleOccurrences.claimMissedScheduled({
          id: occurrenceId,
          scheduleId: candidate.schedule.id,
          scheduledAt,
          requestedAt: batch.createdAt,
          period,
          nextScheduledAt,
          ...(reasonCode === undefined ? {} : { reasonCode }),
          reasonDetail:
            reasonCode === 'schedule_clock_untrusted'
              ? '检测到系统时钟前调；该历史时刻已记为错过，不补跑。'
              : '计划时刻早于固定结算边界；错过的期间不自动补跑。',
        });
        if (claimed.kind === 'busy') {
          throw new Error('Automatic Schedule claim unexpectedly returned a manual busy result');
        }
        this.store.scheduleRecoveryBatches.recordOccurrence({
          batchKey: batch.batchKey,
          cursor: { scheduleId: candidate.schedule.id, scheduledAt },
          occurrenceId: claimed.occurrence.id,
          updatedAt: this.validCurrentWallTime() ?? batch.createdAt,
        });
      });
      this.publishChanged(candidate.schedule.id, occurrenceId, 'occurrence');
      const current = this.store.scheduleRecoveryBatches.get(batch.batchKey);
      if (!current) throw new Error(`Schedule recovery batch disappeared: ${batch.batchKey}`);
      batch = current;
      processedInTransaction += 1;
      if (processedInTransaction === SCHEDULE_MISSED_BATCH_SIZE) {
        processedInTransaction = 0;
        await this.yieldToEventLoop();
      }
    }
    return batch;
  }

  private nextPastSchedule(
    cutoffAt: number,
    cursor: ScheduleRecoveryCursor | undefined,
  ): { schedule: ScheduleAggregate['schedule']; scheduledAt: number } | undefined {
    for (const { schedule } of this.store.schedules.listEnabledForDispatch()) {
      if (schedule.dispatchBlock !== undefined) continue;
      const scheduledAt = schedule.nextScheduledAt;
      if (scheduledAt === undefined || scheduledAt >= cutoffAt) continue;
      if (compareCursor(cursor, { scheduleId: schedule.id, scheduledAt }) < 0) continue;
      return { schedule, scheduledAt };
    }
    return undefined;
  }

  private dispatchDue(now: number, generation: number): void {
    for (const { schedule } of this.store.schedules.listEnabledForDispatch()) {
      if (generation !== this.generation) return;
      if (schedule.dispatchBlock !== undefined) continue;
      const scheduledAt = schedule.nextScheduledAt;
      if (scheduledAt === undefined || scheduledAt > now) continue;
      if (now - scheduledAt > SCHEDULE_LATE_WINDOW_MS) continue;
      const configVersion = schedule.enabledConfigVersion;
      if (configVersion === undefined)
        throw new Error(`Enabled Schedule has no config version: ${schedule.id}`);
      const config = this.store.schedules.getConfig(schedule.id, configVersion);
      if (!config) throw new Error(`Enabled Schedule config is missing: ${schedule.id}`);
      const nextScheduledAt = nextTimes(config.timing, scheduledAt, 1)[0];
      if (nextScheduledAt === undefined)
        throw new Error('Schedule calendar did not return a next time');
      const period = resolveSchedulePeriod(config.periodRule, config.timing.timeZone, scheduledAt);
      const input = {
        scheduleId: schedule.id,
        scheduledAt,
        requestedAt: now,
        period,
        nextScheduledAt,
      };
      if (this.activeDispatches.size >= MAX_CONCURRENT_PREPARATIONS) {
        const committed = this.store.transaction(() => {
          const skipped = this.store.scheduleOccurrences.skipScheduledForCapacity({
            ...input,
            reasonDetail: '后台准备容量已占用；本期已跳过，不会排队补跑。',
          });
          if (skipped.kind === 'busy') {
            throw new Error(`Capacity skip did not close occurrence for Schedule ${schedule.id}`);
          }
          return {
            skipped,
            afterCommit: this.onOccurrenceClosed(skipped.occurrence.id),
          };
        });
        committed.afterCommit?.();
        const skipped = committed.skipped;
        this.publishChanged(skipped.occurrence.scheduleId, skipped.occurrence.id, 'occurrence');
        continue;
      }
      const committed = this.store.transaction(() => {
        const claim = this.store.scheduleOccurrences.claimScheduled(input);
        return {
          claim,
          afterCommit:
            claim.kind === 'skipped-overlap'
              ? this.onOccurrenceClosed(claim.occurrence.id)
              : undefined,
        };
      });
      committed.afterCommit?.();
      const claim = committed.claim;
      if (claim.kind === 'skipped-overlap') {
        this.publishChanged(claim.occurrence.scheduleId, claim.occurrence.id, 'occurrence');
        continue;
      }
      if (claim.kind !== 'created') continue;
      this.publishChanged(claim.occurrence.scheduleId, claim.occurrence.id, 'occurrence');
      this.launchDispatch(claim.occurrence, generation);
    }
  }

  private launchDispatch(occurrence: ScheduleOccurrence, generation: number): void {
    const controller = new AbortController();
    let operation: Promise<void>;
    try {
      operation = Promise.resolve(
        this.dispatch(occurrence, { generation, signal: controller.signal }),
      );
    } catch (error) {
      operation = Promise.reject(
        error instanceof Error ? error : new Error('Schedule dispatch failed', { cause: error }),
      );
    }
    const state = { controller, promise: operation };
    this.activeDispatches.set(occurrence.id, state);
    void operation.then(
      () => {
        if (this.activeDispatches.get(occurrence.id) === state) {
          this.activeDispatches.delete(occurrence.id);
        }
      },
      (error: unknown) => {
        if (this.activeDispatches.get(occurrence.id) === state) {
          this.activeDispatches.delete(occurrence.id);
        }
        try {
          const latest = this.store.scheduleOccurrences.get(occurrence.id);
          if (latest?.phase === 'preparing') {
            const afterCommit = this.store.transaction(() => {
              this.store.scheduleOccurrences.closePreparation({
                occurrenceId: occurrence.id,
                outcome: 'blocked',
                finishedAt: this.validCurrentWallTime() ?? occurrence.requestedAt,
                reasonCode: 'schedule_preparation_failed',
                reasonDetail: '自动派发准备失败；请打开本期记录检查后再继续。',
              });
              return this.onOccurrenceClosed(occurrence.id);
            });
            afterCommit?.();
            this.publishChanged(occurrence.scheduleId, occurrence.id, 'occurrence');
          }
        } catch (closeError) {
          this.reportError(closeError);
        }
        this.reportError(error);
      },
    );
  }

  private validCurrentWallTime(): number | undefined {
    const value = this.wallClock();
    return validWallTime(value) ? value : undefined;
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch (reportError) {
      queueMicrotask(() => {
        throw reportError;
      });
    }
  }

  private publishChanged(
    scheduleId: string,
    occurrenceId: string | undefined,
    reason: ScheduleChangedEvent['reason'],
  ): void {
    try {
      this.onChanged({ scheduleId, ...(occurrenceId ? { occurrenceId } : {}), reason });
    } catch (error) {
      this.reportError(error);
    }
  }
}

const randomOccurrenceId = (): string => globalThis.crypto.randomUUID();
