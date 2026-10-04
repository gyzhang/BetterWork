import {
  type ArtifactType,
  type RunSummary,
  type ScheduleOccurrence,
  type ScheduleOccurrenceResult,
  scheduleOccurrenceResultSchema,
  type ScheduleOutputReceipt,
} from '@betterwork/agent-protocol';

export interface ScheduleOutcomeProjectionInput {
  readonly occurrence: ScheduleOccurrence;
  readonly expectedArtifactTypes: readonly ArtifactType[];
  readonly outputReceipts: readonly ScheduleOutputReceipt[];
  readonly artifactTypes: readonly ArtifactType[];
  readonly run?: RunSummary;
  readonly failureDetail?: string;
}

import { RUN_INTERRUPTED_ON_STARTUP_REASON } from '../persistence';

/**
 * Derives the user-facing Schedule result from Run, registered ArtifactVersion,
 * and save-receipt facts. A completed Run is not treated as business validation.
 */
export const projectScheduleOutcome = (
  input: ScheduleOutcomeProjectionInput,
): ScheduleOccurrenceResult => {
  const { occurrence, run, outputReceipts } = input;
  let status: ScheduleOccurrenceResult['status'];
  let reasonCode = occurrence.reasonCode;
  let reasonDetail = occurrence.reasonDetail;
  let missingArtifactTypes: ArtifactType[] = [];

  if (occurrence.phase === 'preparing') {
    status = 'preparing';
  } else if (occurrence.phase === 'dispatched') {
    status = 'running';
  } else if (occurrence.firstRunId === undefined) {
    const statusByPreparationOutcome = {
      missed: 'missed',
      'skipped-overlap': 'skipped-overlap',
      blocked: 'blocked',
      'needs-material': 'needs-material',
      cancelled: 'cancelled',
      'interrupted-before-run': 'interrupted',
    } as const;
    const preparationOutcome = occurrence.preparationOutcome;
    if (!preparationOutcome)
      throw new Error('Closed occurrence is missing its preparation outcome');
    status = statusByPreparationOutcome[preparationOutcome];
  } else if (!run) {
    throw new Error('Scheduled occurrence has no readable first Run');
  } else if (run.status === 'running') {
    status = 'running';
  } else if (run.status === 'cancelled') {
    status = 'cancelled';
  } else if (run.status === 'failed') {
    const detail = input.failureDetail?.trim();
    status = detail?.startsWith(RUN_INTERRUPTED_ON_STARTUP_REASON) ? 'interrupted' : 'failed';
    reasonDetail = detail || reasonDetail;
  } else {
    missingArtifactTypes = input.expectedArtifactTypes.filter(
      (type) => !input.artifactTypes.includes(type),
    );
    const unsavedReceipt = outputReceipts.find((receipt) => receipt.status !== 'saved');
    if (unsavedReceipt || outputReceipts.some((receipt) => receipt.status === 'failed')) {
      status = 'save-failed';
      reasonCode = unsavedReceipt?.failureCode ?? 'schedule_output_save_failed';
      reasonDetail = unsavedReceipt?.failureDetail ?? '本期成果尚未全部安全保存到工作空间目录。';
    } else if (missingArtifactTypes.length > 0) {
      status = 'no-target-artifact';
      reasonDetail = `本期未生成约定成果类型：${missingArtifactTypes.join('、')}。`;
    } else {
      status = 'generated';
    }
  }

  return scheduleOccurrenceResultSchema.parse({
    occurrence,
    status,
    ...(reasonCode ? { reasonCode } : {}),
    ...(reasonDetail ? { reasonDetail } : {}),
    ...(run ? { run } : {}),
    outputReceipts: [...outputReceipts],
    ...(missingArtifactTypes.length > 0 ? { missingArtifactTypes } : {}),
  });
};
