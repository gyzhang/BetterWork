import { describe, expect, it } from 'vitest';

import { relativeTime } from './format';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('relativeTime', () => {
  it('describes anything inside the last minute as just happened', () => {
    expect(relativeTime(1_000, 45_000)).toBe('刚刚');
  });

  it('counts whole minutes and hours', () => {
    const now = 10 * HOUR;
    expect(relativeTime(now - 2 * MINUTE, now)).toBe('2 分钟前');
    expect(relativeTime(now - 59 * MINUTE, now)).toBe('59 分钟前');
    expect(relativeTime(now - 2 * HOUR, now)).toBe('2 小时前');
    expect(relativeTime(now - 23 * HOUR, now)).toBe('23 小时前');
  });

  it('falls back to a calendar date once relative units stop being useful', () => {
    const now = new Date('2026-09-27T12:00:00').getTime();
    expect(relativeTime(now - 2 * DAY, now)).toBe('9 月 25 日');
  });

  it('reads the local calendar, not UTC, for the date form', () => {
    // 跨月边界用本地时刻构造，避免依赖运行机的时区偏移。
    const octFirstMorning = new Date(2026, 9, 1, 9, 0, 0).getTime();
    const previousMonth = new Date(2026, 8, 30, 23, 0, 0).getTime();
    expect(relativeTime(previousMonth, octFirstMorning + 2 * DAY)).toBe('9 月 30 日');
  });
});
