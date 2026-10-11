import { describe, expect, it } from 'vitest';

import {
  analyzeBusinessMetrics,
  analyzeSourcedBusinessMetrics,
  businessMetricsTool,
  createBusinessMetricsTool,
} from './business-metrics';

describe('analyzeBusinessMetrics', () => {
  it('calculates changes and budget variances without rounding away evidence', () => {
    const result = analyzeBusinessMetrics({
      period: '2026-09',
      current: { revenue: 120, margin: 30 },
      previous: { revenue: 100, margin: 0 },
      budget: { revenue: 110 },
    });
    expect(result.metrics).toEqual([
      {
        metric: 'margin',
        current: 30,
        previous: 0,
        change: 30,
        warnings: ['comparison-zero-baseline'],
      },
      {
        metric: 'revenue',
        current: 120,
        previous: 100,
        budget: 110,
        change: 20,
        changeRate: 0.2,
        budgetVariance: 10,
        budgetVarianceRate: 10 / 110,
        warnings: [],
      },
    ]);
  });

  it('rejects missing current metrics and supports cancellation at the tool boundary', async () => {
    expect(() =>
      analyzeBusinessMetrics({ period: '2026-09', current: {}, previous: { revenue: 1 } }),
    ).toThrow('当前期间缺少指标');
    const controller = new AbortController();
    controller.abort();
    await expect(
      businessMetricsTool.execute(
        { period: '2026-09', current: { revenue: 1 } },
        {
          runId: 'run-1',
          toolCallId: 'tool-1',
          workspacePath: '/tmp',
          signal: controller.signal,
          reportProgress: () => undefined,
        },
      ),
    ).rejects.toThrow();
  });

  it('keeps source, unit and period associations through deterministic results', () => {
    const result = analyzeSourcedBusinessMetrics({
      period: '2026-09',
      current: {
        revenue: {
          value: 120,
          unit: '万元',
          period: '2026-09',
          sourceId: 'read-current:0',
        },
      },
      previous: {
        revenue: {
          value: 100,
          unit: '万元',
          period: '2026-08',
          sourceId: 'read-previous:0',
        },
      },
    });
    expect(result.metrics[0]).toMatchObject({
      metric: 'revenue',
      unit: '万元',
      current: 120,
      currentPeriod: '2026-09',
      currentSourceId: 'read-current:0',
      previous: 100,
      previousPeriod: '2026-08',
      previousSourceId: 'read-previous:0',
      change: 20,
      changeRate: 0.2,
    });
  });

  it('rejects incompatible units and validates explicit facts before calculating', async () => {
    const input = {
      period: '2026-09',
      current: {
        revenue: { value: 120, unit: '万元', period: '2026-09', sourceId: 'read-1:0' },
      },
      previous: {
        revenue: { value: 100, unit: '元', period: '2026-08', sourceId: 'read-1:0' },
      },
    };
    expect(() => analyzeSourcedBusinessMetrics(input)).toThrow('单位与当前期间不一致');

    const controller = new AbortController();
    const tool = createBusinessMetricsTool(() => {
      throw new Error('source validation failed');
    });
    await expect(
      tool.execute(
        { ...input, previous: { revenue: { ...input.previous.revenue, unit: '万元' } } },
        {
          runId: 'run-1',
          toolCallId: 'tool-1',
          workspacePath: '/tmp',
          signal: controller.signal,
          reportProgress: () => undefined,
        },
      ),
    ).rejects.toThrow('source validation failed');
  });
});
