import type { ScheduleChangedEvent, ScheduleOccurrenceResult } from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { projectScheduleOutcome } from './schedule-outcome';
import type { ScheduleOutputService } from './schedule-output-service';

export interface ScheduleOutcomeServiceOptions {
  readonly now?: () => number;
  readonly onChanged?: (event: ScheduleChangedEvent) => void;
  readonly outputSaveTimeoutMs?: number;
  readonly persistOccurrenceNotification?: (occurrenceId: string) => (() => void) | undefined;
}

export interface ScheduleOutcomeRecoveryResult {
  readonly examined: number;
  readonly finalized: number;
  readonly unresolved: number;
}

/** Closes scheduled Run facts only after a bounded attempt to save registered versions. */
export class ScheduleOutcomeService {
  private readonly now: () => number;
  private readonly onChanged: (event: ScheduleChangedEvent) => void;
  private readonly outputSaveTimeoutMs: number;
  private readonly persistOccurrenceNotification:
    ((occurrenceId: string) => (() => void) | undefined) | undefined;
  private readonly finalizers = new Map<string, Promise<ScheduleOccurrenceResult | undefined>>();

  constructor(
    private readonly store: AppStore,
    private readonly outputs: Pick<
      ScheduleOutputService,
      'registerOccurrenceOutputs' | 'saveReceipt'
    >,
    options: ScheduleOutcomeServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.onChanged = options.onChanged ?? (() => undefined);
    this.outputSaveTimeoutMs = options.outputSaveTimeoutMs ?? 30_000;
    this.persistOccurrenceNotification = options.persistOccurrenceNotification;
    if (!Number.isSafeInteger(this.outputSaveTimeoutMs) || this.outputSaveTimeoutMs < 1) {
      throw new Error('outputSaveTimeoutMs must be a positive safe integer');
    }
  }

  finalizeRun(runId: string): Promise<ScheduleOccurrenceResult | undefined> {
    const occurrence = this.store.scheduleOccurrences.findByFirstRunId(runId);
    if (!occurrence) return Promise.resolve(undefined);
    const inFlight = this.finalizers.get(occurrence.id);
    if (inFlight) return inFlight;

    const finalizer = Promise.resolve()
      .then(() => this.finalizeOccurrence(occurrence.id, runId))
      .finally(() => {
        if (this.finalizers.get(occurrence.id) === finalizer) {
          this.finalizers.delete(occurrence.id);
        }
      });
    this.finalizers.set(occurrence.id, finalizer);
    return finalizer;
  }

  projectOccurrence(occurrenceId: string): ScheduleOccurrenceResult | undefined {
    const occurrence = this.store.scheduleOccurrences.get(occurrenceId);
    if (!occurrence) return undefined;
    const config = this.store.schedules.getConfig(occurrence.scheduleId, occurrence.configVersion);
    if (!config) throw new Error('Scheduled occurrence configuration is unavailable');
    const run = occurrence.firstRunId ? this.store.runs.get(occurrence.firstRunId) : undefined;
    if (occurrence.firstRunId && !run) {
      throw new Error('Scheduled first Run is unavailable');
    }
    const artifactTypes = run
      ? this.store.artifacts
          .listVersionsBySourceRun(run.taskId, run.id)
          .filter((version) => version.origin === 'assistant-run')
          .map((version) => version.type)
      : [];
    let failureDetail: string | undefined;
    if (run) {
      for (const event of this.store.runs.listEvents(run.id)) {
        if (event.type === 'run.failed') failureDetail = event.error;
      }
    }
    return projectScheduleOutcome({
      occurrence,
      expectedArtifactTypes: config.expectedArtifactTypes,
      outputReceipts: this.store.scheduleOutputs.listByOccurrence(occurrence.id),
      artifactTypes,
      ...(run ? { run } : {}),
      ...(failureDetail ? { failureDetail } : {}),
    });
  }

  /** Startup settles terminal first Runs left dispatched by a process interruption. */
  async recoverTerminalRuns(): Promise<ScheduleOutcomeRecoveryResult> {
    const dispatched = this.store.scheduleOccurrences.listDispatched();
    let finalized = 0;
    let unresolved = 0;
    for (const occurrence of dispatched) {
      if (!occurrence.firstRunId) continue;
      const run = this.store.runs.get(occurrence.firstRunId);
      if (!run || run.status === 'running') continue;
      try {
        const result = await this.finalizeRun(run.id);
        if (result?.occurrence.phase === 'closed') finalized += 1;
        else unresolved += 1;
      } catch {
        unresolved += 1;
      }
    }
    return { examined: dispatched.length, finalized, unresolved };
  }

  private async finalizeOccurrence(
    occurrenceId: string,
    runId: string,
  ): Promise<ScheduleOccurrenceResult | undefined> {
    const occurrence = this.store.scheduleOccurrences.get(occurrenceId);
    const run = this.store.runs.get(runId);
    if (!occurrence || !run) return undefined;
    if (
      occurrence.firstRunId !== run.id ||
      occurrence.taskId !== run.taskId ||
      occurrence.sessionId !== run.sessionId
    ) {
      throw new Error('Scheduled first Run provenance does not match its occurrence');
    }

    if (run.status !== 'running') {
      this.outputs.registerOccurrenceOutputs(occurrence.id);
      const receipts = this.store.scheduleOutputs.listByOccurrence(occurrence.id);
      const saving = receipts.filter(
        (receipt) => receipt.status === 'pending' || receipt.status === 'saving',
      );
      const attempts = await Promise.allSettled(
        saving.map((receipt) => this.outputs.saveReceipt(receipt.id, this.outputSaveTimeoutMs)),
      );
      const failedDatabaseOperation = attempts.find(
        (attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected',
      );
      if (failedDatabaseOperation) throw failedDatabaseOperation.reason;
    }

    const finalized = this.store.transaction(() => {
      const finalOccurrence =
        occurrence.phase === 'dispatched' && run.status !== 'running'
          ? this.store.scheduleOccurrences.finishDispatched({
              occurrenceId: occurrence.id,
              firstRunId: run.id,
              finishedAt: this.now(),
            })
          : (this.store.scheduleOccurrences.get(occurrence.id) ?? occurrence);
      const result = this.projectOccurrence(occurrence.id);
      if (!result) throw new Error('Schedule occurrence disappeared during outcome finalization');
      const afterCommit =
        occurrence.phase === 'dispatched' && finalOccurrence.phase === 'closed'
          ? this.persistOccurrenceNotification?.(occurrence.id)
          : undefined;
      return { result, finalOccurrence, afterCommit };
    });
    finalized.afterCommit?.();

    if (occurrence.phase === 'dispatched' && finalized.finalOccurrence.phase === 'closed') {
      this.onChanged({
        scheduleId: occurrence.scheduleId,
        occurrenceId: occurrence.id,
        reason: 'occurrence',
      });
    }
    return finalized.result;
  }
}
