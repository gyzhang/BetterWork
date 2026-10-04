import type {
  CreateNotificationInput,
  NotificationSummary,
  ScheduleOccurrenceResult,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import type { NotificationService } from './notification-service';
import type { ScheduleOutcomeService } from './schedule-outcome-service';

const INITIAL_OUTCOME_KEY = 'initial-outcome';

export interface ScheduleNotificationRecoveryResult {
  readonly examinedOccurrences: number;
  readonly restoredOccurrences: number;
  readonly examinedBatches: number;
  readonly restoredBatches: number;
}

export interface ScheduleNotificationServiceOptions {
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
  readonly systemNotifyOnPublish?: boolean;
}

const truncate = (value: string, maximum: number): string =>
  Array.from(value).slice(0, maximum).join('');

const labelFor = (result: ScheduleOccurrenceResult): string | undefined => {
  switch (result.status) {
    case 'generated':
      return '已生成，请审阅';
    case 'save-failed':
      return '成果已生成，但未保存到目录';
    case 'no-target-artifact':
      return '未生成全部约定成果';
    case 'missed':
      return '已错过，不会补跑';
    case 'failed':
      return '执行失败';
    case 'interrupted':
      return '执行中断';
    case 'needs-material':
      return '需要补充材料';
    case 'blocked':
      return '启动受阻';
    case 'skipped-overlap':
      return '本期因重叠而跳过';
    case 'cancelled':
    case 'preparing':
    case 'running':
      return undefined;
  }
};

const levelFor = (result: ScheduleOccurrenceResult): CreateNotificationInput['level'] => {
  if (result.status === 'generated') return 'success';
  if (
    result.status === 'failed' ||
    result.status === 'interrupted' ||
    result.status === 'blocked'
  ) {
    return 'error';
  }
  return 'warning';
};

const detailFor = (result: ScheduleOccurrenceResult): string | undefined => {
  const facts = [
    result.reasonDetail,
    result.missingArtifactTypes?.length
      ? `缺少约定成果：${result.missingArtifactTypes.join('、')}`
      : undefined,
  ].filter((fact): fact is string => Boolean(fact));
  return facts.length > 0 ? truncate(facts.join('\n'), 2_000) : undefined;
};

export interface ScheduleNotificationWrite {
  readonly notification?: NotificationSummary;
  readonly afterCommit?: () => void;
}

/** Writes a Schedule notification and its durable de-duplication receipt as one transaction. */
export class ScheduleNotificationService {
  private readonly now: () => number;
  private readonly onError: (error: unknown) => void;
  private readonly systemNotifyOnPublish: boolean;
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly store: AppStore,
    private readonly notifications: NotificationService,
    private readonly outcomes: Pick<ScheduleOutcomeService, 'projectOccurrence'>,
    options: ScheduleNotificationServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.onError =
      options.onError ?? ((error) => console.error('Schedule notification failed', error));
    this.systemNotifyOnPublish = options.systemNotifyOnPublish ?? false;
  }

  ensureOccurrence(
    occurrenceId: string,
    options: { systemNotify?: boolean } = {},
  ): NotificationSummary | undefined {
    const write = this.store.transaction(() =>
      this.persistOccurrenceWithinTransaction(occurrenceId, options),
    );
    write.afterCommit?.();
    return write.notification;
  }

  /** Writes inside the caller's transaction; the returned publisher must run after that commit. */
  persistOccurrenceWithinTransaction(
    occurrenceId: string,
    options: { systemNotify?: boolean } = {},
  ): ScheduleNotificationWrite {
    const result = this.outcomes.projectOccurrence(occurrenceId);
    if (!result || result.occurrence.phase !== 'closed' || result.status === 'cancelled') {
      return {};
    }
    const label = labelFor(result);
    if (!label) return {};
    const config = this.store.schedules.getConfig(
      result.occurrence.scheduleId,
      result.occurrence.configVersion,
    );
    if (!config) throw new Error('Schedule notification configuration is unavailable');
    const detail = detailFor(result);

    const input: CreateNotificationInput = {
      level: levelFor(result),
      kind: 'schedule',
      title: truncate(`定时任务${label}：${config.name} · ${result.occurrence.period.label}`, 200),
      ...(detail ? { detail } : {}),
      target: {
        kind: 'schedule',
        scheduleId: result.occurrence.scheduleId,
        occurrenceId: result.occurrence.id,
      },
    };

    const current = this.store.scheduleNotifications.get(occurrenceId, INITIAL_OUTCOME_KEY);
    if (current) {
      const notification = this.store.notifications.get(current.notificationId);
      return notification ? { notification } : {};
    }
    const notification = this.notifications.persist(input);
    this.store.scheduleNotifications.create({
      occurrenceId,
      outcomeKey: INITIAL_OUTCOME_KEY,
      notificationId: notification.id,
      createdAt: notification.createdAt,
    });
    return {
      notification,
      afterCommit: this.publisherAfterCommit(notification, options.systemNotify),
    };
  }

  ensureRecoveryBatch(
    batchKey: string,
    options: { systemNotify?: boolean } = {},
  ): NotificationSummary | undefined {
    const write = this.store.transaction(() =>
      this.persistRecoveryBatchWithinTransaction(batchKey, options),
    );
    write.afterCommit?.();
    return write.notification;
  }

  /** Completes a recovery batch's notification receipt inside the batch completion transaction. */
  persistRecoveryBatchWithinTransaction(
    batchKey: string,
    options: { systemNotify?: boolean } = {},
  ): ScheduleNotificationWrite {
    const batch = this.store.scheduleRecoveryBatches.get(batchKey);
    if (!batch || batch.phase !== 'completed') return {};
    if (batch.notificationId) {
      const notification = this.store.notifications.get(batch.notificationId);
      return notification ? { notification } : {};
    }

    const missed = batch.coveredOccurrenceIds.flatMap((occurrenceId) => {
      const result = this.outcomes.projectOccurrence(occurrenceId);
      return result?.status === 'missed' ? [result] : [];
    });
    const anchor = missed[0]?.occurrence;
    if (!anchor || missed.length === 0) return {};
    const anchorConfig = this.store.schedules.getConfig(anchor.scheduleId, anchor.configVersion);
    if (!anchorConfig)
      throw new Error('Schedule recovery notification configuration is unavailable');
    const periodLabels = missed
      .map((result) => result.occurrence.period.label)
      .filter((label, index, labels) => labels.indexOf(label) === index)
      .slice(0, 8);
    const input: CreateNotificationInput = {
      level: 'warning',
      kind: 'schedule',
      title: `有 ${String(missed.length)} 个定时计划时刻已错过`,
      detail: truncate(
        `错过的期间：${periodLabels.join('、')}${missed.length > periodLabels.length ? '等' : ''}。这些期间不会自动补跑。点击可查看其中最早一期。`,
        2_000,
      ),
      target: { kind: 'schedule', scheduleId: anchor.scheduleId, occurrenceId: anchor.id },
    };

    const notification = this.notifications.persist(input);
    this.store.scheduleRecoveryBatches.attachNotification({
      batchKey,
      notificationId: notification.id,
      updatedAt: this.now(),
    });
    return {
      notification,
      afterCommit: this.publisherAfterCommit(notification, options.systemNotify),
    };
  }

  queueOccurrence(occurrenceId: string): void {
    this.track(this.ensureOccurrenceAsync(occurrenceId));
  }

  queueRecoveryBatch(batchKey: string): void {
    this.track(this.ensureRecoveryBatchAsync(batchKey));
  }

  async recoverMissing(): Promise<ScheduleNotificationRecoveryResult> {
    let examinedOccurrences = 0;
    let restoredOccurrences = 0;
    for (;;) {
      const pending = this.store.scheduleOccurrences.listClosedWithoutInitialNotification(100);
      examinedOccurrences += pending.length;
      for (const occurrence of pending) {
        const previous = this.store.scheduleNotifications.get(occurrence.id, INITIAL_OUTCOME_KEY);
        const notification = this.ensureOccurrence(occurrence.id, { systemNotify: false });
        if (!previous && notification) restoredOccurrences += 1;
      }
      if (pending.length < 100) break;
    }

    let restoredBatches = 0;
    let examinedBatches = 0;
    for (;;) {
      const batches = this.store.scheduleRecoveryBatches.listCompletedWithoutNotification(100);
      examinedBatches += batches.length;
      for (const batch of batches) {
        if (this.ensureRecoveryBatch(batch.batchKey, { systemNotify: false })) restoredBatches += 1;
      }
      if (batches.length < 100) break;
    }
    return {
      examinedOccurrences,
      restoredOccurrences,
      examinedBatches,
      restoredBatches,
    };
  }

  async waitForPending(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  private async ensureOccurrenceAsync(occurrenceId: string): Promise<void> {
    this.ensureOccurrence(occurrenceId);
  }

  private async ensureRecoveryBatchAsync(batchKey: string): Promise<void> {
    this.ensureRecoveryBatch(batchKey);
  }

  private track(work: Promise<void>): void {
    const pending = work.catch((error: unknown) => {
      try {
        this.onError(error);
      } catch (reportError) {
        queueMicrotask(() => {
          throw reportError;
        });
      }
    });
    this.pending.add(pending);
    const cleanup = (): void => {
      this.pending.delete(pending);
    };
    void pending.then(cleanup, cleanup);
  }

  private publisherAfterCommit(
    notification: NotificationSummary,
    systemNotify = this.systemNotifyOnPublish,
  ): () => void {
    return () => {
      try {
        this.notifications.publish(notification, { systemNotify });
      } catch (error) {
        try {
          this.onError(error);
        } catch (reportError) {
          queueMicrotask(() => {
            throw reportError;
          });
        }
      }
    };
  }
}
