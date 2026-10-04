import type {
  ScheduleOccurrenceHistoryItem,
  ScheduleOccurrenceViewState,
} from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  mergeScheduleOccurrenceHistory,
  scheduleOccurrenceHistoryLabel,
  scheduleOccurrenceNextStep,
  scheduleOccurrenceNoRunMessage,
  scheduleOutputReceiptLabel,
  scheduleSourceOriginLabel,
  scheduleSourceSnapshotStatusLabel,
} from './schedule-detail';

const historyItem = (
  id: string,
  status: ScheduleOccurrenceViewState,
  createdAt: number,
  overrides: Partial<ScheduleOccurrenceHistoryItem['occurrence']> = {},
): ScheduleOccurrenceHistoryItem => {
  const occurrence: ScheduleOccurrenceHistoryItem['occurrence'] = {
    id,
    scheduleId: 'schedule-1',
    configVersion: 1,
    trigger: 'scheduled',
    scheduledAt: createdAt,
    period: {
      rule: 'previous-month',
      timeZone: 'Asia/Shanghai',
      anchorAt: createdAt,
      startAt: createdAt - 20,
      endAt: createdAt - 10,
      label: `期间 ${createdAt}`,
    },
    phase: 'closed',
    ...(status === 'missed' ? { preparationOutcome: 'missed' as const } : {}),
    createdAt,
    requestedAt: createdAt,
    ...overrides,
  };
  return {
    occurrence,
    result: {
      occurrence,
      status,
      outputReceipts: [],
      ...(status === 'missed' ? {} : {}),
    },
  };
};

describe('schedule detail projection', () => {
  it('keeps missed periods explicit and never renders them as an idle Run', () => {
    const missed = historyItem('missed-1', 'missed', 1);
    expect(scheduleOccurrenceNoRunMessage(missed)).toMatch(/没有创建 Task 或 Run/);
    expect(scheduleOccurrenceHistoryLabel(missed)).toBe('期间 1 · 按计划执行');
  });

  it('uses the human-action route for each terminal result without rewriting the result state', () => {
    const cases: Array<[ScheduleOccurrenceViewState, boolean, string]> = [
      ['blocked', false, '检查并调整规则'],
      ['failed', true, '打开原 Task 查看失败原因'],
      ['interrupted', true, '中断前'],
      ['no-target-artifact', true, '检查回复'],
      ['save-failed', true, '单独重试目录保存'],
    ];
    for (const [status, hasTask, expected] of cases) {
      expect(scheduleOccurrenceNextStep(status, hasTask, true)).toContain(expected);
    }
  });

  it('labels evidence origins and output receipt states distinctly', () => {
    expect(scheduleSourceOriginLabel('selected-collection')).toBe('指定集合');
    expect(scheduleOutputReceiptLabel('failed')).toBe('未保存到工作空间');
    expect(scheduleOutputReceiptLabel('saved')).toBe('已保存到工作空间');
    expect(scheduleSourceSnapshotStatusLabel('ready')).toBe('已就绪');
  });

  it('merges new facts into paged history without duplicate occurrences and keeps newest first', () => {
    const older = historyItem('older', 'generated', 10);
    const latest = historyItem('latest', 'missed', 20);
    const refreshedLatest = historyItem('latest', 'blocked', 20);
    expect(mergeScheduleOccurrenceHistory([older, latest], [refreshedLatest])).toEqual([
      refreshedLatest,
      older,
    ]);
  });
});
