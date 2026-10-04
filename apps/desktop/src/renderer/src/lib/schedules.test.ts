import type { ScheduleDetail, WorkspaceSummary } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  filterSchedulesByWorkspace,
  lifecycleLabel,
  lifecycleTone,
  occurrenceResultLabel,
  occurrenceResultTone,
  periodRuleLabel,
  scheduleTimestampLabel,
  scheduleTimingLabel,
  workspaceFilterOptions,
} from './schedules';

const detail = (scheduleId: string, workspaceId: string): ScheduleDetail => {
  const expertRevision = {
    id: 'revision-1',
    expertId: 'expert-1',
    revision: 1,
    name: '经营分析专家',
    summary: '',
    author: '',
    tags: [],
    identity: '完成经营分析',
    principles: [],
    inputRequirements: [],
    deliveryRequirements: [],
    skillPreset: [],
    builtinToolPolicy: { mode: 'application-defaults' as const },
    modelReference: { mode: 'application-default' as const },
    createdAt: 1,
  };
  return {
    aggregate: {
      schedule: {
        id: scheduleId,
        workspaceId,
        revision: 1,
        currentConfigVersion: 1,
        lifecycle: 'paused',
        createdAt: 1,
        updatedAt: 1,
      },
      config: {
        scheduleId,
        version: 1,
        name: '月度经营复盘',
        expertId: 'expert-1',
        expertRevisionId: 'revision-1',
        requirements: '分析上月经营数据。',
        expectedArtifactTypes: ['markdown'],
        timing: {
          frequency: 'monthly',
          day: 5,
          hour: 9,
          minute: 0,
          timeZone: 'Asia/Shanghai',
        },
        periodRule: 'previous-month',
        knowledgeSources: [],
        outputSubdirectory: '定时成果',
        createdAt: 1,
      },
    },
    expertUpdate: {
      boundRevision: expertRevision,
      currentRevision: expertRevision,
      available: false,
    },
    history: { items: [] },
  };
};

const workspace = (id: string, name: string): WorkspaceSummary => ({
  id,
  name,
  rootPath: `/tmp/${id}`,
  iconId: 'folder',
  accentId: 'moss',
  createdAt: 1,
  updatedAt: 1,
});

describe('schedule list presentation helpers', () => {
  it('maps the lifecycle, results, and period to product language', () => {
    expect(lifecycleLabel('enabled')).toBe('已启用');
    expect(lifecycleTone('archived')).toBe('outline');
    expect(occurrenceResultLabel('missed')).toBe('已错过，不会自动补跑');
    expect(occurrenceResultTone('generated')).toBe('success');
    expect(periodRuleLabel('previous-month')).toBe('上一自然月');
  });

  it('formats daily, weekly, and monthly rules with their fixed time zones', () => {
    expect(
      scheduleTimingLabel({ frequency: 'daily', hour: 8, minute: 5, timeZone: 'Asia/Shanghai' }),
    ).toBe('每天 08:05 · 北京时间');
    expect(
      scheduleTimingLabel({
        frequency: 'weekly',
        weekday: 1,
        hour: 8,
        minute: 0,
        timeZone: 'Asia/Tokyo',
      }),
    ).toBe('周一 08:00 · 东京时间');
    expect(
      scheduleTimingLabel({
        frequency: 'monthly',
        day: 31,
        hour: 17,
        minute: 30,
        timeZone: 'UTC',
      }),
    ).toBe('每月 31 日 17:30 · UTC');
    expect(scheduleTimestampLabel(Date.UTC(2026, 9, 5, 0), 'Asia/Shanghai')).toContain('05');
  });

  it('filters facts by workspace without mutating the original list', () => {
    const details = [detail('schedule-a', 'workspace-a'), detail('schedule-b', 'workspace-b')];
    expect(
      filterSchedulesByWorkspace(details, 'workspace-b').map((item) => item.aggregate.schedule.id),
    ).toEqual(['schedule-b']);
    expect(filterSchedulesByWorkspace(details, 'all')).toEqual(details);
    expect(details).toHaveLength(2);
  });

  it('keeps the all-workspaces option and the user-visible names', () => {
    const workspaces: WorkspaceSummary[] = [workspace('workspace-a', '财务分析')];
    expect(workspaceFilterOptions(workspaces)).toEqual([
      { id: 'all', label: '全部工作空间' },
      { id: 'workspace-a', label: '财务分析' },
    ]);
  });
});
