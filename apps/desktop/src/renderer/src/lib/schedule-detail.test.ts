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

describe('schedule result action matrix', () => {
  it.each([
    ['needs-material', false, '请回到规则详情'],
    ['needs-material', true, '打开 Task 补充材料'],
    ['blocked', false, '启动前检查未通过'],
    ['skipped-overlap', false, '上一期仍占用执行窗口'],
    ['cancelled', false, '准备阶段已取消'],
    ['interrupted', false, '本期不会自动重放'],
    ['failed', false, '本期没有首个 Run'],
  ] as const)('explains %s without inventing a Run (task=%s)', (status, hasTask, expected) => {
    const item = historyItem('one', status, 1, hasTask ? { taskId: 'task-1' } : {});
    expect(scheduleOccurrenceNoRunMessage(item)).toContain(expected);
  });

  it('puts the original period after the manual missed trigger', () => {
    const item = historyItem('one', 'generated', 1, {
      trigger: 'manual-missed',
      originalOccurrenceId: 'missed-1',
    });
    expect(scheduleOccurrenceHistoryLabel(item)).toBe('人工补做错过期 · 期间 1');
  });

  it.each([
    ['missed', false, false, '可人工补做'],
    ['needs-material', true, false, '打开原 Task'],
    ['needs-material', false, false, '调整知识范围'],
    ['save-failed', true, false, '查看已登记成果'],
    ['no-target-artifact', false, false, '缺项原因'],
    ['failed', false, false, '启动失败原因'],
    ['interrupted', false, false, '不会自动重放'],
    ['cancelled', true, false, '部分成果'],
    ['cancelled', false, false, '后续计划'],
    ['generated', true, true, '不代表业务结果已验证'],
    ['running', true, false, '后台处理'],
    ['preparing', false, false, '后台处理'],
    ['skipped-overlap', false, false, '历史事实'],
  ] as const)('offers a valid next action for %s', (status, hasTask, hasReceipt, expected) => {
    expect(scheduleOccurrenceNextStep(status, hasTask, hasReceipt)).toContain(expected);
  });

  it('merges equal-time pages deterministically without mutating either page', () => {
    const a = historyItem('a', 'missed', 10);
    const b = historyItem('b', 'blocked', 10);
    const updatedA = historyItem('a', 'generated', 10);
    const current = Object.freeze([a]);
    const incoming = Object.freeze([updatedA, b]);
    expect(mergeScheduleOccurrenceHistory(current, incoming)).toEqual([b, updatedA]);
    expect(current).toEqual([a]);
    expect(incoming).toEqual([updatedA, b]);
    expect(mergeScheduleOccurrenceHistory([], [])).toEqual([]);
  });
});
