import {
  type ArtifactType,
  type RunSummary,
  type ScheduleOccurrence,
  scheduleOccurrenceSchema,
  type ScheduleOutputReceipt,
  scheduleOutputReceiptSchema,
} from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { RUN_INTERRUPTED_ON_STARTUP_REASON } from '../persistence';
import { projectScheduleOutcome } from './schedule-outcome';

const dispatchedOccurrence = (): ScheduleOccurrence =>
  scheduleOccurrenceSchema.parse({
    id: 'occurrence-1',
    scheduleId: 'schedule-1',
    configVersion: 1,
    trigger: 'manual-now',
    requestedAt: 1_790_000_000_000,
    requestKey: 'request-1',
    period: {
      rule: 'none',
      timeZone: 'Asia/Shanghai',
      anchorAt: 1_790_000_000_000,
      label: '无期间',
    },
    phase: 'dispatched',
    taskId: 'task-1',
    sessionId: 'session-1',
    firstRunId: 'run-1',
    sourceSnapshotId: 'snapshot-1',
    createdAt: 1_790_000_000_000,
    preparedAt: 1_790_000_000_010,
  });

const closedOccurrence = (): ScheduleOccurrence =>
  scheduleOccurrenceSchema.parse({
    ...dispatchedOccurrence(),
    phase: 'closed',
    finishedAt: 1_790_000_000_100,
  });

const runSummary = (status: RunSummary['status']): RunSummary => ({
  id: 'run-1',
  taskId: 'task-1',
  sessionId: 'session-1',
  prompt: '本期自动分析',
  status,
  createdAt: 1_790_000_000_020,
  ...(status === 'running' ? {} : { completedAt: 1_790_000_000_100 }),
});

const receipt = (
  status: ScheduleOutputReceipt['status'],
  failureCode?: ScheduleOutputReceipt['failureCode'],
): ScheduleOutputReceipt =>
  scheduleOutputReceiptSchema.parse({
    id: 'receipt-1',
    occurrenceId: 'occurrence-1',
    artifactVersionId: 'version-1',
    workspaceId: 'workspace-1',
    relativePath: '定时成果/本期-v1-version-1.md',
    contentHash: 'a'.repeat(64),
    status,
    attempt: 1,
    ...(failureCode ? { failureCode, failureDetail: '目标文件已存在且内容不同。' } : {}),
    createdAt: 1_790_000_000_050,
    updatedAt: 1_790_000_000_060,
  });

const project = (input: {
  occurrence?: ScheduleOccurrence;
  status?: RunSummary['status'];
  expected?: ArtifactType[];
  actual?: ArtifactType[];
  receipts?: ScheduleOutputReceipt[];
  failureDetail?: string;
}) =>
  projectScheduleOutcome({
    occurrence: input.occurrence ?? closedOccurrence(),
    ...((input.occurrence ?? closedOccurrence()).firstRunId
      ? { run: runSummary(input.status ?? 'completed') }
      : {}),
    expectedArtifactTypes: input.expected ?? ['markdown'],
    artifactTypes: input.actual ?? [],
    outputReceipts: input.receipts ?? [],
    ...(input.failureDetail ? { failureDetail: input.failureDetail } : {}),
  });

describe('projectScheduleOutcome', () => {
  it('shows a dispatched occurrence as running while terminal output finalization is pending', () => {
    const result = project({ occurrence: dispatchedOccurrence(), status: 'completed' });
    expect(result.status).toBe('running');
    expect(result.run?.status).toBe('completed');
  });

  it('requires real expected ArtifactVersions and saved receipts for generated', () => {
    const result = project({ actual: ['markdown'], receipts: [receipt('saved')] });
    expect(result).toMatchObject({ status: 'generated', outputReceipts: [{ status: 'saved' }] });
  });

  it('keeps missing expected types visible when a completed Run generated only part of the target', () => {
    const result = project({
      expected: ['markdown', 'presentation'],
      actual: ['markdown'],
      receipts: [receipt('saved')],
    });
    expect(result).toMatchObject({
      status: 'no-target-artifact',
      missingArtifactTypes: ['presentation'],
    });
  });

  it('gives a save failure precedence while retaining missing artifact facts', () => {
    const result = project({
      expected: ['markdown', 'presentation'],
      actual: ['markdown'],
      receipts: [receipt('failed', 'schedule_output_collision')],
    });
    expect(result).toMatchObject({
      status: 'save-failed',
      reasonCode: 'schedule_output_collision',
      missingArtifactTypes: ['presentation'],
    });
  });

  it('keeps Run failure ahead of partial artifact success', () => {
    const result = project({
      status: 'failed',
      actual: ['markdown'],
      receipts: [receipt('saved')],
      failureDetail: '模型连接失败',
    });
    expect(result).toMatchObject({ status: 'failed', reasonDetail: '模型连接失败' });
  });

  it('distinguishes startup interruption from an ordinary Run failure', () => {
    const result = project({ status: 'failed', failureDetail: RUN_INTERRUPTED_ON_STARTUP_REASON });
    expect(result).toMatchObject({
      status: 'interrupted',
      reasonDetail: RUN_INTERRUPTED_ON_STARTUP_REASON,
    });
  });

  it('does not turn user cancellation into a failure when partial outputs exist', () => {
    const result = project({
      status: 'cancelled',
      receipts: [receipt('failed', 'schedule_output_save_failed')],
    });
    expect(result.status).toBe('cancelled');
  });

  it('projects no-Run preparation outcomes without inventing a Run', () => {
    const missed = scheduleOccurrenceSchema.parse({
      id: 'missed-1',
      scheduleId: 'schedule-1',
      configVersion: 1,
      trigger: 'scheduled',
      scheduledAt: 1_790_000_000_000,
      requestedAt: 1_790_000_000_010,
      period: {
        rule: 'none',
        timeZone: 'Asia/Shanghai',
        anchorAt: 1_790_000_000_000,
        label: '无期间',
      },
      phase: 'closed',
      preparationOutcome: 'missed',
      createdAt: 1_790_000_000_010,
      finishedAt: 1_790_000_000_010,
    });
    const result = projectScheduleOutcome({
      occurrence: missed,
      expectedArtifactTypes: ['markdown'],
      outputReceipts: [],
      artifactTypes: [],
    });
    expect(result).toMatchObject({ status: 'missed', outputReceipts: [] });
    expect('run' in result).toBe(false);
  });
});
