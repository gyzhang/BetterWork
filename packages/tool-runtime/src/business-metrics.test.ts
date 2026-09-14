import { describe, expect, it } from 'vitest';

import { analyzeBusinessMetrics, businessMetricsTool } from './business-metrics';

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
});
