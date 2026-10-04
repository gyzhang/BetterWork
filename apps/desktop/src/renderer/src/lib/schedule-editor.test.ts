import type { ScheduleDetail } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  defaultScheduleEditorValue,
  monthlyDayNeedsSkipNotice,
  parseScheduleTime,
  reusableEnabledFingerprint,
  scheduleEditorConfig,
  scheduleEditorValueFromDetail,
  scheduleTimingWithFrequency,
} from './schedule-editor';

const detail: ScheduleDetail = {
  aggregate: {
    schedule: {
      id: 'schedule-1',
      workspaceId: 'workspace-1',
      revision: 4,
      currentConfigVersion: 2,
      lifecycle: 'enabled',
      capabilityFingerprint: 'existing-capability-fingerprint',
      createdAt: 1,
      updatedAt: 2,
    },
    config: {
      scheduleId: 'schedule-1',
      version: 2,
      name: '月报',
      expertId: 'expert-1',
      expertRevisionId: 'revision-1',
      requirements: '分析上月。',
      expectedArtifactTypes: ['presentation'],
      timing: {
        frequency: 'monthly',
        day: 31,
        hour: 9,
        minute: 5,
        timeZone: 'Asia/Shanghai',
      },
      periodRule: 'previous-month',
      knowledgeSources: [],
      outputSubdirectory: '定时成果',
      createdAt: 1,
    },
  },
  expertUpdate: {
    boundRevision: {
      id: 'revision-1',
      expertId: 'expert-1',
      revision: 1,
      name: '经营分析专家',
      summary: '',
      author: '',
      tags: [],
      identity: '分析',
      principles: [],
      inputRequirements: [],
      deliveryRequirements: [],
      skillPreset: [],
      builtinToolPolicy: { mode: 'application-defaults' },
      modelReference: { mode: 'application-default' },
      createdAt: 1,
    },
    currentRevision: {
      id: 'revision-1',
      expertId: 'expert-1',
      revision: 1,
      name: '经营分析专家',
      summary: '',
      author: '',
      tags: [],
      identity: '分析',
      principles: [],
      inputRequirements: [],
      deliveryRequirements: [],
      skillPreset: [],
      builtinToolPolicy: { mode: 'application-defaults' },
      modelReference: { mode: 'application-default' },
      createdAt: 1,
    },
    available: false,
  },
  history: { items: [] },
};

describe('schedule editor draft helpers', () => {
  it('starts with the approved monthly default and validates fields before IPC', () => {
    const value = defaultScheduleEditorValue();
    expect(value.config.timing).toEqual({
      frequency: 'monthly',
      day: 5,
      hour: 9,
      minute: 0,
      timeZone: 'Asia/Shanghai',
    });
    expect(scheduleEditorConfig(value).errors.length).toBeGreaterThan(0);
    value.config.expertId = 'expert-1';
    value.config.expertRevisionId = 'revision-1';
    value.config.name = '月度分析';
    value.config.requirements = '比较上一自然月。';
    expect(scheduleEditorConfig(value).config?.timing).toEqual(value.config.timing);
  });

  it('rejects malformed and out-of-range times', () => {
    expect(parseScheduleTime('09:30')).toEqual({ hour: 9, minute: 30 });
    expect(parseScheduleTime('24:00')).toBeUndefined();
    expect(parseScheduleTime('09:60')).toBeUndefined();
    expect(parseScheduleTime('9:30')).toBeUndefined();
    const value = defaultScheduleEditorValue();
    value.timeInput = '25:00';
    expect(scheduleEditorConfig(value).errors).toEqual([
      '执行时刻须为有效的 24 小时时间，例如 09:30。',
    ]);
  });

  it('uses the same typed timing shape when changing frequency and warns for missing monthly days', () => {
    const initial = defaultScheduleEditorValue().config.timing;
    const weekly = scheduleTimingWithFrequency(initial, 'weekly');
    expect(weekly).toEqual({
      frequency: 'weekly',
      weekday: 1,
      hour: 9,
      minute: 0,
      timeZone: 'Asia/Shanghai',
    });
    expect(scheduleTimingWithFrequency(weekly, 'daily')).toEqual({
      frequency: 'daily',
      hour: 9,
      minute: 0,
      timeZone: 'Asia/Shanghai',
    });
    expect(monthlyDayNeedsSkipNotice(detail.aggregate.config.timing)).toBe(true);
    expect(monthlyDayNeedsSkipNotice(initial)).toBe(false);
  });

  it('copies fixed Workspace, ExpertRevision and knowledge references when editing', () => {
    const value = scheduleEditorValueFromDetail(detail);
    expect(value.workspaceId).toBe('workspace-1');
    expect(value.config.expertRevisionId).toBe('revision-1');
    expect(value.config.knowledgeSources).toEqual([]);
    expect(value.timeInput).toBe('09:05');
  });

  it('reuses an enabled fingerprint for name-only edits but requires a fresh check for other changes', () => {
    const value = scheduleEditorValueFromDetail(detail);
    value.config.name = '新名称';
    const config = scheduleEditorConfig(value).config;
    if (!config) throw new Error('合成配置未通过 Schema 校验。');
    expect(reusableEnabledFingerprint(detail, config)).toBe('existing-capability-fingerprint');
    expect(
      reusableEnabledFingerprint(detail, { ...config, requirements: '修改了工作要求。' }),
    ).toBeUndefined();
  });
});
