import {
  type ScheduleConfigDraft,
  scheduleConfigDraftSchema,
  type ScheduleDetail,
  type SchedulePeriodRule,
  type ScheduleTiming,
  type WorkspaceSummary,
} from '@betterwork/agent-protocol';

export interface ScheduleEditorValue {
  workspaceId: string;
  config: ScheduleConfigDraft;
  timeInput: string;
}

export interface ScheduleEditorValidation {
  config?: ScheduleConfigDraft;
  errors: string[];
}

export const defaultScheduleEditorValue = (): ScheduleEditorValue => ({
  workspaceId: '',
  config: {
    name: '',
    expertId: '',
    expertRevisionId: '',
    requirements: '',
    expectedArtifactTypes: ['presentation'],
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
  },
  timeInput: '09:00',
});

export const scheduleEditorValueFromDetail = (detail: ScheduleDetail): ScheduleEditorValue => {
  const { schedule } = detail.aggregate;
  const { config } = detail.aggregate;
  return {
    workspaceId: schedule.workspaceId,
    config: {
      name: config.name,
      expertId: config.expertId,
      expertRevisionId: config.expertRevisionId,
      requirements: config.requirements,
      expectedArtifactTypes: [...config.expectedArtifactTypes],
      timing: { ...config.timing },
      periodRule: config.periodRule,
      knowledgeSources: [...config.knowledgeSources],
      outputSubdirectory: config.outputSubdirectory,
    },
    timeInput: `${String(config.timing.hour).padStart(2, '0')}:${String(config.timing.minute).padStart(2, '0')}`,
  };
};

export const reusableEnabledFingerprint = (
  detail: ScheduleDetail | undefined,
  config: ScheduleConfigDraft,
): string | undefined => {
  if (detail?.aggregate.schedule.lifecycle !== 'enabled') return undefined;
  const fingerprint = detail.aggregate.schedule.capabilityFingerprint;
  if (!fingerprint) return undefined;
  const currentConfig = detail.aggregate.config;
  const sameCapabilityInputs =
    currentConfig.expertId === config.expertId &&
    currentConfig.expertRevisionId === config.expertRevisionId &&
    currentConfig.requirements === config.requirements &&
    JSON.stringify(currentConfig.expectedArtifactTypes) ===
      JSON.stringify(config.expectedArtifactTypes) &&
    JSON.stringify(currentConfig.timing) === JSON.stringify(config.timing) &&
    currentConfig.periodRule === config.periodRule &&
    JSON.stringify(currentConfig.knowledgeSources) === JSON.stringify(config.knowledgeSources) &&
    currentConfig.outputSubdirectory === config.outputSubdirectory;
  return sameCapabilityInputs ? fingerprint : undefined;
};

export const parseScheduleTime = (value: string): { hour: number; minute: number } | undefined => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return { hour, minute };
};

export const scheduleTimingWithFrequency = (
  current: ScheduleTiming,
  frequency: ScheduleTiming['frequency'],
): ScheduleTiming => {
  const common = {
    hour: current.hour,
    minute: current.minute,
    timeZone: current.timeZone,
  };
  if (frequency === 'daily') return { frequency, ...common };
  if (frequency === 'weekly') {
    return {
      frequency,
      weekday: current.frequency === 'weekly' ? current.weekday : 1,
      ...common,
    };
  }
  return { frequency, day: current.frequency === 'monthly' ? current.day : 5, ...common };
};

export const monthlyDayNeedsSkipNotice = (timing: ScheduleTiming): boolean =>
  timing.frequency === 'monthly' && timing.day >= 29;

export const scheduleEditorConfig = (value: ScheduleEditorValue): ScheduleEditorValidation => {
  const parsedTime = parseScheduleTime(value.timeInput);
  if (!parsedTime) {
    return { errors: ['执行时刻须为有效的 24 小时时间，例如 09:30。'] };
  }

  const parsed = scheduleConfigDraftSchema.safeParse({
    ...value.config,
    timing: { ...value.config.timing, ...parsedTime },
  });
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => issue.message) };
  }
  return { config: parsed.data, errors: [] };
};

export const scheduleEditorWorkspaceOptions = (
  workspaces: readonly WorkspaceSummary[],
): { id: string; label: string }[] => [
  { id: '', label: '请选择工作空间' },
  ...workspaces.map((workspace) => ({ id: workspace.id, label: workspace.name })),
];

export const schedulePeriodOptions: readonly { id: SchedulePeriodRule; label: string }[] = [
  { id: 'previous-month', label: '上一自然月' },
  { id: 'rolling-seven-days', label: '截至计划时刻的过去 7 天' },
  { id: 'current-week', label: '本周一至计划时刻' },
  { id: 'previous-week', label: '上一自然周' },
  { id: 'none', label: '不指定统计期间' },
];
