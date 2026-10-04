import {
  SCHEDULE_PREVIEW_COUNT,
  type SchedulePeriodRule,
  schedulePeriodRuleSchema,
  type ScheduleResolvedPeriod,
  scheduleResolvedPeriodSchema,
  type ScheduleTimeZone,
  scheduleTimeZoneSchema,
  type ScheduleTiming,
  scheduleTimingSchema,
} from '@betterwork/agent-protocol';
import { CronExpressionParser } from 'cron-parser';

const DAY_MS = 24 * 60 * 60 * 1_000;
const FIXED_TIME_ZONE_OFFSETS = {
  UTC: 0,
  'Asia/Shanghai': 8 * 60 * 60 * 1_000,
  'Asia/Tokyo': 9 * 60 * 60 * 1_000,
} as const satisfies Record<ScheduleTimeZone, number>;

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const validEpoch = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
};

const localParts = (instant: number, timeZone: ScheduleTimeZone): LocalDateParts => {
  const shifted = new Date(instant + FIXED_TIME_ZONE_OFFSETS[timeZone]);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
};

const localMidnight = (
  year: number,
  month: number,
  day: number,
  timeZone: ScheduleTimeZone,
): number => Date.UTC(year, month, day) - FIXED_TIME_ZONE_OFFSETS[timeZone];

const formatLocal = (instant: number, timeZone: ScheduleTimeZone): string => {
  const parts = localParts(instant, timeZone);
  return `${parts.year}-${String(parts.month + 1).padStart(2, '0')}-${String(parts.day).padStart(2, '0')} ${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
};

/** ScheduleTiming 是产品输入；Renderer 不接收 cron 表达式。 */
export const scheduleCronExpression = (input: ScheduleTiming): string => {
  const timing = scheduleTimingSchema.parse(input);
  switch (timing.frequency) {
    case 'daily':
      return `0 ${timing.minute} ${timing.hour} * * *`;
    case 'weekly':
      return `0 ${timing.minute} ${timing.hour} * * ${timing.weekday === 7 ? 0 : timing.weekday}`;
    case 'monthly':
      return `0 ${timing.minute} ${timing.hour} ${timing.day} * *`;
  }
};

/** 预览和实际调度共用：六段 strict cron，返回严格晚于 after 的 epoch 毫秒。 */
export const nextTimes = (
  input: ScheduleTiming,
  after: number,
  count = SCHEDULE_PREVIEW_COUNT,
): number[] => {
  validEpoch(after, 'after');
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('count must be a non-negative safe integer');
  }
  const timing = scheduleTimingSchema.parse(input);
  if (count === 0) return [];
  const expression = CronExpressionParser.parse(scheduleCronExpression(timing), {
    currentDate: new Date(after),
    tz: timing.timeZone,
    strict: true,
  });
  const times: number[] = [];
  let previous = after;
  for (let index = 0; index < count; index += 1) {
    const next = expression.next().getTime();
    if (!Number.isSafeInteger(next) || next <= previous) {
      throw new Error('cron-parser returned a time that is not strictly later than its cursor');
    }
    times.push(next);
    previous = next;
  }
  return times;
};

/** 期间采用半开区间；人工 now 与 missed 都由调用方提供各自固定锚点。 */
export const resolveSchedulePeriod = (
  ruleInput: SchedulePeriodRule,
  timeZoneInput: ScheduleTimeZone,
  anchorAt: number,
): ScheduleResolvedPeriod => {
  validEpoch(anchorAt, 'anchorAt');
  const rule = schedulePeriodRuleSchema.parse(ruleInput);
  const timeZone = scheduleTimeZoneSchema.parse(timeZoneInput);
  if (rule === 'none') {
    return scheduleResolvedPeriodSchema.parse({
      rule,
      timeZone,
      anchorAt,
      label: '无期间',
    });
  }

  const parts = localParts(anchorAt, timeZone);
  let startAt: number;
  let endAt: number;
  let label: string;
  if (rule === 'previous-month') {
    startAt = localMidnight(parts.year, parts.month - 1, 1, timeZone);
    endAt = localMidnight(parts.year, parts.month, 1, timeZone);
    const start = localParts(startAt, timeZone);
    label = `${start.year}年${start.month + 1}月`;
  } else if (rule === 'rolling-seven-days') {
    startAt = anchorAt - 7 * DAY_MS;
    endAt = anchorAt;
    label = `过去7天（截至 ${formatLocal(anchorAt, timeZone)}）`;
  } else {
    const dayOfWeek = new Date(anchorAt + FIXED_TIME_ZONE_OFFSETS[timeZone]).getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(Date.UTC(parts.year, parts.month, parts.day - daysSinceMonday));
    const thisMondayAt = localMidnight(
      monday.getUTCFullYear(),
      monday.getUTCMonth(),
      monday.getUTCDate(),
      timeZone,
    );
    if (rule === 'current-week') {
      startAt = thisMondayAt;
      endAt = anchorAt;
      label =
        startAt === endAt
          ? '本周（空期间）'
          : `本周（${formatLocal(startAt, timeZone)} 至 ${formatLocal(endAt, timeZone)}）`;
    } else {
      startAt = thisMondayAt - 7 * DAY_MS;
      endAt = thisMondayAt;
      label = `上周（${formatLocal(startAt, timeZone)} 至 ${formatLocal(endAt, timeZone)}）`;
    }
  }

  return scheduleResolvedPeriodSchema.parse({
    rule,
    timeZone,
    anchorAt,
    startAt,
    endAt,
    label,
  });
};
