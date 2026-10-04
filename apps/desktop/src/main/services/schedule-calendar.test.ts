import type { ScheduleTimeZone, ScheduleTiming } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { nextTimes, resolveSchedulePeriod, scheduleCronExpression } from './schedule-calendar';

const interval = (
  period: ReturnType<typeof resolveSchedulePeriod>,
): Exclude<ReturnType<typeof resolveSchedulePeriod>, { rule: 'none' }> => {
  if (period.rule === 'none') throw new Error('Expected an interval period');
  return period;
};

describe('schedule calendar', () => {
  it('uses the shared three-time preview and returns times strictly after the cursor', () => {
    const timing: ScheduleTiming = {
      frequency: 'daily',
      hour: 9,
      minute: 17,
      timeZone: 'Asia/Shanghai',
    };
    const after = Date.UTC(2026, 9, 3, 1, 17);

    expect(scheduleCronExpression(timing)).toBe('0 17 9 * * *');
    expect(nextTimes(timing, after)).toEqual([
      Date.UTC(2026, 9, 4, 1, 17),
      Date.UTC(2026, 9, 5, 1, 17),
      Date.UTC(2026, 9, 6, 1, 17),
    ]);
    expect(nextTimes(timing, after, 0)).toEqual([]);
  });

  it('maps Sunday to cron weekday zero and emits a strict six-field expression', () => {
    const timing: ScheduleTiming = {
      frequency: 'weekly',
      weekday: 7,
      hour: 12,
      minute: 23,
      timeZone: 'Asia/Tokyo',
    };

    expect(scheduleCronExpression(timing)).toBe('0 23 12 * * 0');
    expect(nextTimes(timing, Date.UTC(2026, 8, 4, 0), 1)).toEqual([Date.UTC(2026, 8, 6, 3, 23)]);
  });

  it('skips nonexistent monthly days in leap years, non-leap years, and short months', () => {
    const atDay = (day: number, hour: number): number => Date.UTC(2024, 1, day, hour);
    const leap29: ScheduleTiming = {
      frequency: 'monthly',
      day: 29,
      hour: 9,
      minute: 0,
      timeZone: 'UTC',
    };
    const common29 = { ...leap29, timeZone: 'UTC' as const };
    expect(nextTimes(leap29, atDay(28, 23), 1)).toEqual([Date.UTC(2024, 1, 29, 9)]);
    expect(nextTimes(common29, Date.UTC(2023, 1, 1), 1)).toEqual([Date.UTC(2023, 2, 29, 9)]);

    const day31: ScheduleTiming = { ...leap29, day: 31 };
    expect(nextTimes(day31, Date.UTC(2026, 0, 31, 9), 1)).toEqual([Date.UTC(2026, 2, 31, 9)]);
    const day30: ScheduleTiming = { ...leap29, day: 30 };
    expect(nextTimes(day30, Date.UTC(2026, 0, 30, 9), 1)).toEqual([Date.UTC(2026, 2, 30, 9)]);
  });

  it('handles year boundaries and every supported fixed-offset time zone', () => {
    const newYearRule: ScheduleTiming = {
      frequency: 'monthly',
      day: 1,
      hour: 0,
      minute: 0,
      timeZone: 'UTC',
    };
    expect(nextTimes(newYearRule, Date.UTC(2026, 11, 1), 1)).toEqual([Date.UTC(2027, 0, 1)]);

    const cases: { timeZone: ScheduleTimeZone; expectedAt: number }[] = [
      { timeZone: 'UTC', expectedAt: Date.UTC(2026, 2, 1, 7, 5) },
      { timeZone: 'Asia/Shanghai', expectedAt: Date.UTC(2026, 2, 1, 23, 5) },
      { timeZone: 'Asia/Tokyo', expectedAt: Date.UTC(2026, 2, 1, 22, 5) },
    ];
    for (const { timeZone, expectedAt } of cases) {
      const timing: ScheduleTiming = {
        frequency: 'daily',
        hour: 7,
        minute: 5,
        timeZone,
      };
      expect(nextTimes(timing, Date.UTC(2026, 2, 1), 1)).toEqual([expectedAt]);
    }
  });

  it('resolves half-open monthly, rolling, current-week, previous-week, and no-period ranges', () => {
    const month = resolveSchedulePeriod(
      'previous-month',
      'Asia/Shanghai',
      Date.UTC(2026, 0, 15, 1),
    );
    expect(month).toMatchObject({
      startAt: Date.UTC(2025, 10, 30, 16),
      endAt: Date.UTC(2025, 11, 31, 16),
      label: '2025年12月',
    });

    const anchorAt = Date.UTC(2026, 9, 7, 1);
    const rolling = interval(
      resolveSchedulePeriod('rolling-seven-days', 'Asia/Shanghai', anchorAt),
    );
    expect(rolling.endAt).toBe(anchorAt);
    expect(rolling.startAt).toBe(anchorAt - 7 * 24 * 60 * 60 * 1_000);

    const current = interval(resolveSchedulePeriod('current-week', 'Asia/Shanghai', anchorAt));
    expect(current).toMatchObject({
      startAt: Date.UTC(2026, 9, 4, 16),
      endAt: anchorAt,
    });
    const previous = interval(resolveSchedulePeriod('previous-week', 'Asia/Shanghai', anchorAt));
    expect(previous).toMatchObject({
      startAt: Date.UTC(2026, 8, 27, 16),
      endAt: Date.UTC(2026, 9, 4, 16),
    });

    const none = resolveSchedulePeriod('none', 'UTC', anchorAt);
    expect(none).toMatchObject({ rule: 'none', anchorAt, label: '无期间' });
    expect('startAt' in none).toBe(false);
    expect('endAt' in none).toBe(false);
  });

  it('uses the supplied anchor for manual-now and original-missed period resolution', () => {
    const manualNowAt = Date.UTC(2026, 9, 3, 1);
    const originalMissedAt = Date.UTC(2026, 7, 5, 1);
    const manualNow = interval(
      resolveSchedulePeriod('previous-month', 'Asia/Shanghai', manualNowAt),
    );
    const manualMissed = interval(
      resolveSchedulePeriod('previous-month', 'Asia/Shanghai', originalMissedAt),
    );
    expect(manualNow.anchorAt).toBe(manualNowAt);
    expect(manualNow.startAt).toBe(Date.UTC(2026, 7, 31, 16));
    expect(manualMissed.anchorAt).toBe(originalMissedAt);
    expect(manualMissed.startAt).toBe(Date.UTC(2026, 5, 30, 16));
  });

  it('represents a Monday 00:00 current-week period as an explicit empty half-open range', () => {
    const boundaries: { timeZone: ScheduleTimeZone; anchorAt: number }[] = [
      { timeZone: 'UTC', anchorAt: Date.UTC(2026, 0, 5) },
      { timeZone: 'Asia/Shanghai', anchorAt: Date.UTC(2026, 0, 4, 16) },
      { timeZone: 'Asia/Tokyo', anchorAt: Date.UTC(2026, 0, 4, 15) },
    ];
    for (const { timeZone, anchorAt } of boundaries) {
      expect(resolveSchedulePeriod('current-week', timeZone, anchorAt)).toEqual({
        rule: 'current-week',
        timeZone,
        anchorAt,
        startAt: anchorAt,
        endAt: anchorAt,
        label: '本周（空期间）',
      });
    }
  });
});
