import type {
  ScheduleDetail,
  ScheduleLifecycle,
  ScheduleOccurrenceViewState,
  ScheduleTimeZone,
  ScheduleTiming,
  WorkspaceSummary,
} from '@betterwork/agent-protocol';

const lifecycleLabels: Record<ScheduleLifecycle, string> = {
  enabled: '已启用',
  paused: '已暂停',
  archived: '已归档',
};

const resultLabels: Record<ScheduleOccurrenceViewState, string> = {
  preparing: '本期正在准备来源',
  running: '本期正在执行',
  'needs-material': '需要补充材料',
  generated: '已生成，请审阅',
  'save-failed': '成果保存失败，可重试保存',
  'no-target-artifact': '未生成预期成果',
  failed: '执行失败',
  cancelled: '本期已停止',
  missed: '已错过，不会自动补跑',
  'skipped-overlap': '与上一期重叠，已跳过',
  blocked: '启动前检查未通过',
  interrupted: '运行中断',
};

const periodLabels = {
  'previous-month': '上一自然月',
  'rolling-seven-days': '过去 7 天',
  'current-week': '本周至计划时刻',
  'previous-week': '上一自然周',
  none: '不指定统计期间',
} as const;

const timeZoneLabels: Record<ScheduleTimeZone, string> = {
  'Asia/Shanghai': '北京时间',
  'Asia/Tokyo': '东京时间',
  UTC: 'UTC',
};

const weekdayLabels = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

export const lifecycleLabel = (lifecycle: ScheduleLifecycle): string => lifecycleLabels[lifecycle];

export const lifecycleTone = (lifecycle: ScheduleLifecycle): 'brand' | 'neutral' | 'outline' => {
  if (lifecycle === 'enabled') return 'brand';
  if (lifecycle === 'archived') return 'outline';
  return 'neutral';
};

export const occurrenceResultLabel = (status: ScheduleOccurrenceViewState | undefined): string =>
  status ? resultLabels[status] : '尚未执行';

export const occurrenceResultTone = (
  status: ScheduleOccurrenceViewState | undefined,
): 'neutral' | 'success' | 'warning' | 'danger' => {
  if (status === 'generated') return 'success';
  if (status === 'missed' || status === 'skipped-overlap' || status === 'needs-material')
    return 'warning';
  if (
    status === 'failed' ||
    status === 'interrupted' ||
    status === 'blocked' ||
    status === 'save-failed'
  )
    return 'danger';
  return 'neutral';
};

export const periodRuleLabel = (
  rule: ScheduleDetail['aggregate']['config']['periodRule'],
): string => periodLabels[rule];

export const scheduleTimingLabel = (timing: ScheduleTiming): string => {
  const hour = String(timing.hour).padStart(2, '0');
  const minute = String(timing.minute).padStart(2, '0');
  const cadence =
    timing.frequency === 'daily'
      ? '每天'
      : timing.frequency === 'weekly'
        ? (weekdayLabels[timing.weekday] ?? '每周')
        : `每月 ${timing.day} 日`;
  return `${cadence} ${hour}:${minute} · ${timeZoneLabels[timing.timeZone]}`;
};

export const scheduleTimestampLabel = (timestamp: number, timeZone: ScheduleTimeZone): string => {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(timestamp);
  } catch {
    return '时间暂不可用';
  }
};

export const filterSchedulesByWorkspace = (
  details: readonly ScheduleDetail[],
  workspaceId: string,
): ScheduleDetail[] =>
  workspaceId === 'all'
    ? [...details]
    : details.filter((detail) => detail.aggregate.schedule.workspaceId === workspaceId);

export const workspaceFilterOptions = (
  workspaces: readonly WorkspaceSummary[],
): { id: string; label: string }[] => [
  { id: 'all', label: '全部工作空间' },
  ...workspaces.map((workspace) => ({ id: workspace.id, label: workspace.name })),
];
