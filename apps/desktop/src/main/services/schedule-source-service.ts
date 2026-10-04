import { randomUUID } from 'node:crypto';

import {
  type ExpertReferenceMaterial,
  type MaterialReference,
  sameKnowledgeReference,
  SCHEDULE_PREPARATION_TIMEOUT_MS,
  SCHEDULE_SOURCE_ITEM_MAX,
  type ScheduleDomainErrorCode,
  type ScheduleOccurrence,
  type ScheduleSourceItem,
  type ScheduleSourceOrigin,
  type ScheduleSourceSnapshot,
} from '@betterwork/agent-protocol';

import { type AppStore, scheduleSourceManifestHash } from '../persistence';
import { ScheduleSourceRepositoryError } from '../persistence/schedule-source-repository';
import { InputSnapshotError, type InputSnapshotService } from './input-snapshot-service';
import {
  type ScheduleDirectorySource,
  ScheduleDirectorySourceError,
  type ScheduleDirectorySourcesService,
} from './schedule-directory-sources';
import {
  type ScheduleKnowledgeSourceItem,
  ScheduleKnowledgeSourcesError,
  type ScheduleKnowledgeSourcesService,
} from './schedule-knowledge-sources';

interface ScheduleSourceCandidate {
  reference: MaterialReference;
  purpose: ScheduleSourceItem['purpose'];
  origin: ScheduleSourceOrigin;
  displayName: string;
  sourcePath?: string;
}

interface PreparationState {
  controller: AbortController;
  promise: Promise<ScheduleSourceSnapshot>;
}

export interface ScheduleSourceServiceOptions {
  now?: () => number;
  preparationTimeoutMs?: number;
  onOccurrenceClosed?: (occurrenceId: string) => (() => void) | undefined;
}

export class ScheduleSourceServiceError extends Error {
  constructor(
    readonly code: ScheduleDomainErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ScheduleSourceServiceError';
  }
}

const identityKey = (reference: MaterialReference): string => {
  if (reference.kind === 'knowledge-revision') {
    return `knowledge:${reference.knowledgeDocumentId}`;
  }
  if (reference.kind === 'artifact-version') {
    return `artifact:${reference.artifactVersionId}`;
  }
  return `input:${reference.snapshotId}`;
};

const stableReferenceOrder = (reference: MaterialReference): string => {
  if (reference.kind === 'knowledge-revision') {
    return [
      reference.kind,
      reference.knowledgeDocumentId,
      reference.knowledgeRevisionId,
      reference.contentHash,
      reference.sourcePath,
    ].join('\u0000');
  }
  if (reference.kind === 'artifact-version') {
    return [
      reference.kind,
      reference.artifactId,
      reference.artifactVersionId,
      reference.contentHash,
    ].join('\u0000');
  }
  return [
    reference.kind,
    reference.snapshotId,
    reference.contentHash,
    reference.sourcePath ?? '',
  ].join('\u0000');
};

const sameReference = (left: MaterialReference, right: MaterialReference): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'knowledge-revision' && right.kind === 'knowledge-revision') {
    return sameKnowledgeReference(left, right);
  }
  if (left.kind === 'artifact-version' && right.kind === 'artifact-version') {
    return (
      left.artifactId === right.artifactId &&
      left.artifactVersionId === right.artifactVersionId &&
      left.contentHash === right.contentHash &&
      left.originWorkspaceId === right.originWorkspaceId
    );
  }
  return (
    left.kind === 'workspace-input-snapshot' &&
    right.kind === 'workspace-input-snapshot' &&
    left.snapshotId === right.snapshotId &&
    left.workspaceId === right.workspaceId &&
    left.contentHash === right.contentHash &&
    left.format === right.format &&
    left.fileKey === right.fileKey
  );
};

const errorCode = (error: unknown): ScheduleDomainErrorCode => {
  if (
    error instanceof ScheduleDirectorySourceError ||
    error instanceof ScheduleKnowledgeSourcesError ||
    error instanceof ScheduleSourceRepositoryError ||
    error instanceof InputSnapshotError
  ) {
    if (error instanceof InputSnapshotError) return 'schedule_source_missing';
    return error.code;
  }
  if (error instanceof ScheduleSourceServiceError) return error.code;
  return 'schedule_source_missing';
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const snapshotFromReference = (
  reference: MaterialReference,
): Extract<MaterialReference, { kind: 'workspace-input-snapshot' }> | undefined =>
  reference.kind === 'workspace-input-snapshot' ? reference : undefined;

/** 固定来源快照只在所有异步读取、验证完成后与 occurrence 一起原子发布。 */
export class ScheduleSourceService {
  private readonly inFlight = new Map<string, PreparationState>();
  private readonly now: () => number;
  private readonly preparationTimeoutMs: number;
  private readonly onOccurrenceClosed:
    ((occurrenceId: string) => (() => void) | undefined) | undefined;

  constructor(
    private readonly store: AppStore,
    private readonly directorySources: Pick<ScheduleDirectorySourcesService, 'collect'>,
    private readonly knowledgeSources: Pick<
      ScheduleKnowledgeSourcesService,
      'resolve' | 'assertUnchanged'
    >,
    private readonly inputSnapshots: Pick<InputSnapshotService, 'verify'>,
    options: ScheduleSourceServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.preparationTimeoutMs = options.preparationTimeoutMs ?? SCHEDULE_PREPARATION_TIMEOUT_MS;
    this.onOccurrenceClosed = options.onOccurrenceClosed;
  }

  prepare(occurrenceId: string, signal?: AbortSignal): Promise<ScheduleSourceSnapshot> {
    const existing = this.inFlight.get(occurrenceId);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const state: PreparationState = {
      controller,
      promise: Promise.resolve().then(() => this.prepareOnce(occurrenceId, controller, signal)),
    };
    this.inFlight.set(occurrenceId, state);
    const cleanup = (): void => {
      if (this.inFlight.get(occurrenceId) === state) this.inFlight.delete(occurrenceId);
    };
    void state.promise.then(cleanup, cleanup);
    return state.promise;
  }

  cancelPreparation(occurrenceId: string): void {
    const active = this.inFlight.get(occurrenceId);
    active?.controller.abort();
    this.finishWithoutRun(occurrenceId, 'cancelled', 'schedule_cancelled', '本期来源准备已取消。');
  }

  recoverInterrupted(recoveredAt = this.now()): {
    closedOccurrences: number;
    finishedSnapshots: number;
  } {
    this.assertTimestamp(recoveredAt);
    const rows = this.store.scheduleSources.listForRecovery();
    let closedOccurrences = 0;
    let finishedSnapshots = 0;
    for (const row of rows) {
      this.inFlight.get(row.occurrenceId)?.controller.abort();
      const afterCommit = this.store.transaction(() => {
        const occurrence = this.store.scheduleOccurrences.get(row.occurrenceId);
        const snapshot = row.snapshotId
          ? this.store.scheduleSources.get(row.snapshotId)
          : undefined;
        if (snapshot?.status === 'preparing') {
          const cancelled = occurrence?.preparationOutcome === 'cancelled';
          this.store.scheduleSources.finish({
            snapshotId: snapshot.id,
            status: cancelled ? 'cancelled' : 'failed',
            failureCode: cancelled ? 'schedule_cancelled' : 'schedule_preparation_timeout',
            completedAt: recoveredAt,
          });
          finishedSnapshots += 1;
        }
        if (occurrence?.phase === 'preparing') {
          this.store.scheduleOccurrences.closePreparation({
            occurrenceId: occurrence.id,
            outcome: 'interrupted-before-run',
            finishedAt: recoveredAt,
            reasonCode: 'schedule_preparation_timeout',
            reasonDetail: '应用在本期来源准备期间退出；保留已复制输入快照，不自动重试或启动 Run。',
          });
          closedOccurrences += 1;
          return this.onOccurrenceClosed?.(occurrence.id);
        }
        return undefined;
      });
      afterCommit?.();
    }
    return { closedOccurrences, finishedSnapshots };
  }

  private async prepareOnce(
    occurrenceId: string,
    controller: AbortController,
    callerSignal?: AbortSignal,
  ): Promise<ScheduleSourceSnapshot> {
    let snapshot: ScheduleSourceSnapshot | undefined;
    try {
      const occurrence = this.requirePreparingOccurrence(occurrenceId);
      snapshot = this.store.scheduleSources.getByOccurrence(occurrenceId);
      if (snapshot) {
        if (
          snapshot.workspaceId !==
            this.requireSchedule(occurrence.scheduleId).schedule.workspaceId ||
          snapshot.configVersion !== occurrence.configVersion
        ) {
          throw new ScheduleSourceServiceError(
            'schedule_source_conflict',
            '已存在的来源快照与本期配置不匹配。',
          );
        }
        if (snapshot.status === 'ready') return snapshot;
        if (snapshot.status !== 'preparing') {
          throw new ScheduleSourceServiceError(
            snapshot.failureCode ?? 'schedule_source_conflict',
            '本期来源准备已收口，不能替换或重新准备。',
          );
        }
      } else {
        snapshot = this.store.scheduleSources.createPreparing({
          id: randomUUID(),
          occurrenceId,
          evaluatedAt: this.now(),
          createdAt: this.now(),
        });
      }

      const schedule = this.requireSchedule(occurrence.scheduleId);
      const config = this.store.schedules.getConfig(schedule.schedule.id, occurrence.configVersion);
      if (!config || schedule.schedule.currentConfigVersion !== occurrence.configVersion) {
        throw new ScheduleSourceServiceError(
          'schedule_source_conflict',
          '本期配置版本已经失效，请按当前配置重新发起。',
        );
      }
      const expert = this.store.experts.getRevision(config.expertId, config.expertRevisionId);
      const expertDetail = this.store.experts.get(config.expertId);
      if (!expert || !expertDetail || expertDetail.lifecycle !== 'active') {
        throw new ScheduleSourceServiceError(
          'schedule_capability_blocked',
          '本期固定专家版本不可用。',
        );
      }
      const knowledgeRequest = {
        workspaceId: schedule.schedule.workspaceId,
        sources: config.knowledgeSources,
        expertReferences: expert.referenceMaterials ?? [],
        signal: controller.signal,
      };
      const knowledge = this.knowledgeSources.resolve(knowledgeRequest);

      const result = await this.withTimeout(controller, callerSignal, async (signal) => {
        const directory = await this.directorySources.collect({
          scheduleId: schedule.schedule.id,
          signal,
        });
        if (
          directory.workspaceId !== schedule.schedule.workspaceId ||
          directory.configVersion !== occurrence.configVersion
        ) {
          throw new ScheduleSourceServiceError(
            'schedule_source_conflict',
            '目录来源返回的工作空间或配置版本与本期不一致。',
          );
        }
        const candidates = this.combineCandidates(
          directory.items,
          knowledge.items,
          expert.referenceMaterials ?? [],
          schedule.schedule.workspaceId,
        );
        if (candidates.length > SCHEDULE_SOURCE_ITEM_MAX) {
          throw new ScheduleSourceServiceError(
            'schedule_source_budget_exceeded',
            `本期实际来源超过 ${SCHEDULE_SOURCE_ITEM_MAX} 项，请缩小范围。`,
          );
        }
        this.knowledgeSources.assertUnchanged(knowledgeRequest, knowledge);
        await this.verifyInputSnapshots(candidates, schedule.schedule.workspaceId, signal);
        if (signal.aborted) throw new CancelPreparationError();
        const refreshedCandidates = this.combineCandidates(
          directory.items,
          knowledge.items,
          expert.referenceMaterials ?? [],
          schedule.schedule.workspaceId,
        );
        if (JSON.stringify(refreshedCandidates) !== JSON.stringify(candidates)) {
          throw new ScheduleSourceServiceError(
            'schedule_source_conflict',
            '固定专家参考在来源准备期间发生变化，请重新准备。',
          );
        }
        this.assertStillCurrent(occurrence, schedule.schedule.workspaceId);
        const manifestItems = candidates.map((candidate, ordinal) => ({
          snapshotId: snapshot?.id ?? '',
          ordinal,
          reference: candidate.reference,
          purpose: candidate.purpose,
          origin: candidate.origin,
          displayName: candidate.displayName,
          ...(candidate.sourcePath === undefined ? {} : { sourcePath: candidate.sourcePath }),
        }));
        const manifestHash = scheduleSourceManifestHash(manifestItems);
        const completedAt = this.now();
        this.assertTimestamp(completedAt);
        return this.store.transaction(() => {
          const ready = this.store.scheduleSources.publishReady({
            snapshotId: snapshot?.id ?? '',
            items: candidates.map((candidate) => ({
              reference: candidate.reference,
              purpose: candidate.purpose,
              origin: candidate.origin,
              displayName: candidate.displayName,
              ...(candidate.sourcePath === undefined ? {} : { sourcePath: candidate.sourcePath }),
            })),
            totalFileBytes: directory.totalFileBytes,
            manifestHash,
            completedAt,
          });
          this.store.scheduleOccurrences.attachSourceSnapshot(occurrence.id, ready.id);
          return ready;
        });
      });
      return result;
    } catch (error) {
      const isTimedOut =
        error instanceof TimeoutPreparationError ||
        (callerSignal?.reason instanceof Error &&
          callerSignal.reason.message === 'schedule-preparation-timeout');
      const cancelled =
        !isTimedOut && (error instanceof CancelPreparationError || controller.signal.aborted);
      const code = isTimedOut
        ? 'schedule_preparation_timeout'
        : cancelled
          ? 'schedule_cancelled'
          : errorCode(error);
      const status = cancelled ? 'cancelled' : 'failed';
      this.finishWithoutRun(
        occurrenceId,
        status,
        code,
        isTimedOut ? '本期来源准备超过 120 秒，已停止且不会启动 Run。' : errorMessage(error),
      );
      if (error instanceof ScheduleSourceServiceError) throw error;
      throw new ScheduleSourceServiceError(code, errorMessage(error), { cause: error });
    }
  }

  private async withTimeout<T>(
    controller: AbortController,
    callerSignal: AbortSignal | undefined,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let removeCallerListener = (): void => undefined;
    let removeAbortListener = (): void => undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      const rejectAbort = (): void => reject(new CancelPreparationError());
      if (controller.signal.aborted) {
        rejectAbort();
      } else {
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
        removeAbortListener = () => controller.signal.removeEventListener('abort', rejectAbort);
      }
      if (callerSignal) {
        const relayAbort = (): void => controller.abort(callerSignal.reason);
        if (callerSignal.aborted) relayAbort();
        else {
          callerSignal.addEventListener('abort', relayAbort, { once: true });
          removeCallerListener = () => callerSignal.removeEventListener('abort', relayAbort);
        }
      }
    });
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new TimeoutPreparationError());
      }, this.preparationTimeoutMs);
    });
    const operation = Promise.resolve().then(() => work(controller.signal));
    try {
      return await Promise.race([operation, abortPromise, timeoutPromise]);
    } catch (error) {
      if (timedOut) throw new TimeoutPreparationError();
      throw error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      removeCallerListener();
      removeAbortListener();
    }
  }

  private combineCandidates(
    directoryItems: readonly ScheduleDirectorySource[],
    knowledgeItems: readonly ScheduleKnowledgeSourceItem[],
    expertReferences: readonly ExpertReferenceMaterial[],
    workspaceId: string,
  ): ScheduleSourceCandidate[] {
    const candidates = new Map<string, ScheduleSourceCandidate>();
    const add = (candidate: ScheduleSourceCandidate): void => {
      const key = identityKey(candidate.reference);
      const existing = candidates.get(key);
      if (!existing) {
        candidates.set(key, candidate);
        return;
      }
      if (!sameReference(existing.reference, candidate.reference)) {
        throw new ScheduleSourceServiceError(
          'schedule_source_conflict',
          `同一来源身份对应不同修订或内容哈希：${key}`,
        );
      }
      if (candidate.displayName < existing.displayName) candidates.set(key, candidate);
    };
    for (const item of directoryItems) {
      add({
        reference: item.reference,
        purpose: item.purpose,
        origin: item.origin,
        displayName: item.displayName,
        sourcePath: item.sourcePath,
      });
    }
    for (const item of knowledgeItems) {
      add({
        reference: item.reference,
        purpose: item.purpose,
        origin: item.origin,
        displayName: item.displayName,
        sourcePath: item.sourcePath,
      });
    }
    for (const expertReference of expertReferences) {
      const reference = expertReference.reference;
      if (reference.kind !== 'artifact-version' || reference.originWorkspaceId !== workspaceId)
        continue;
      const artifact = this.store.artifacts.getDetail(reference.artifactId);
      const version = this.store.artifacts.getVersionDetail(reference.artifactVersionId);
      const contentHash = version?.type === 'markdown' ? version.contentHash : version?.fileHash;
      if (
        !artifact ||
        artifact.workspaceId !== workspaceId ||
        !version ||
        version.artifactId !== reference.artifactId ||
        contentHash !== reference.contentHash
      ) {
        throw new ScheduleSourceServiceError(
          'schedule_source_missing',
          `专家固定成果版本不可用或内容已变化：${reference.artifactVersionId}`,
        );
      }
      add({
        reference,
        purpose: expertReference.purpose,
        origin: 'expert-reference',
        displayName: `${artifact.title} v${version.versionNumber}`,
      });
    }
    return [...candidates.values()].sort((left, right) => {
      const leftKey = stableReferenceOrder(left.reference);
      const rightKey = stableReferenceOrder(right.reference);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  }

  private async verifyInputSnapshots(
    candidates: readonly ScheduleSourceCandidate[],
    workspaceId: string,
    signal: AbortSignal,
  ): Promise<void> {
    for (const candidate of candidates) {
      if (signal.aborted) throw new CancelPreparationError();
      const reference = snapshotFromReference(candidate.reference);
      if (!reference) continue;
      const snapshot = this.store.inputSnapshots.get(reference.snapshotId);
      if (
        !snapshot ||
        snapshot.status !== 'ready' ||
        snapshot.workspaceId !== workspaceId ||
        snapshot.contentHash !== reference.contentHash ||
        snapshot.fileKey !== reference.fileKey ||
        snapshot.format !== reference.format ||
        !(await this.inputSnapshots.verify(snapshot))
      ) {
        throw new ScheduleSourceServiceError(
          'schedule_source_missing',
          `受管输入快照不可用或校验失败：${reference.sourcePath ?? reference.snapshotId}`,
        );
      }
    }
  }

  private assertStillCurrent(occurrence: ScheduleOccurrence, workspaceId: string): void {
    const currentOccurrence = this.store.scheduleOccurrences.get(occurrence.id);
    const currentSchedule = this.store.schedules.get(occurrence.scheduleId);
    if (
      !currentOccurrence ||
      currentOccurrence.phase !== 'preparing' ||
      !currentSchedule ||
      currentSchedule.schedule.workspaceId !== workspaceId ||
      currentSchedule.schedule.currentConfigVersion !== occurrence.configVersion ||
      currentSchedule.schedule.lifecycle === 'archived'
    ) {
      throw new ScheduleSourceServiceError(
        'schedule_cancelled',
        '规则或本期实例在来源准备期间已经变化。',
      );
    }
  }

  private finishWithoutRun(
    occurrenceId: string,
    status: 'failed' | 'cancelled',
    failureCode: ScheduleDomainErrorCode,
    reasonDetail: string,
  ): void {
    const completedAt = this.now();
    this.assertTimestamp(completedAt);
    const afterCommit = this.store.transaction(() => {
      const occurrence = this.store.scheduleOccurrences.get(occurrenceId);
      const snapshot = this.store.scheduleSources.getByOccurrence(occurrenceId);
      const externallyCancelled = occurrence?.preparationOutcome === 'cancelled';
      if (snapshot?.status === 'preparing') {
        this.store.scheduleSources.finish({
          snapshotId: snapshot.id,
          status: externallyCancelled ? 'cancelled' : status,
          failureCode: externallyCancelled ? 'schedule_cancelled' : failureCode,
          completedAt,
        });
      }
      if (occurrence?.phase === 'preparing') {
        this.store.scheduleOccurrences.closePreparation({
          occurrenceId,
          outcome: status === 'cancelled' ? 'cancelled' : 'blocked',
          finishedAt: completedAt,
          reasonCode: failureCode,
          reasonDetail: reasonDetail.slice(0, 2_000),
        });
        return this.onOccurrenceClosed?.(occurrence.id);
      }
      return undefined;
    });
    afterCommit?.();
  }

  private requirePreparingOccurrence(occurrenceId: string): ScheduleOccurrence {
    const occurrence = this.store.scheduleOccurrences.get(occurrenceId);
    if (!occurrence) {
      throw new ScheduleSourceServiceError('schedule_not_found', '定时实例不存在。');
    }
    if (occurrence.phase !== 'preparing') {
      throw new ScheduleSourceServiceError('schedule_conflict', '定时实例已离开来源准备阶段。');
    }
    return occurrence;
  }

  private requireSchedule(scheduleId: string) {
    const schedule = this.store.schedules.get(scheduleId);
    if (!schedule) throw new ScheduleSourceServiceError('schedule_not_found', '定时规则不存在。');
    return schedule;
  }

  private assertTimestamp(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Schedule source clock is invalid');
  }
}

class TimeoutPreparationError extends Error {
  constructor() {
    super('Schedule source preparation timed out');
    this.name = 'TimeoutPreparationError';
  }
}

class CancelPreparationError extends Error {
  constructor() {
    super('Schedule source preparation was cancelled');
    this.name = 'CancelPreparationError';
  }
}
