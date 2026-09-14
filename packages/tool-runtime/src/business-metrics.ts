import { abortError, type AgentTool } from '@betterwork/agent-core';
import { z } from 'zod';

const numbersSchema = z
  .record(z.string().trim().min(1).max(100), z.number().finite())
  .refine((values) => Object.keys(values).length <= 100, '最多同时分析 100 个指标');

const inputSchema = z
  .object({
    period: z.string().trim().min(1).max(100),
    current: numbersSchema,
    previous: numbersSchema.optional(),
    budget: numbersSchema.optional(),
  })
  .strict();

export interface BusinessMetricResult {
  metric: string;
  current: number;
  previous?: number;
  budget?: number;
  change?: number;
  changeRate?: number;
  budgetVariance?: number;
  budgetVarianceRate?: number;
  warnings: string[];
}

export interface BusinessMetricsResult {
  period: string;
  metrics: BusinessMetricResult[];
  message: string;
}

export const analyzeBusinessMetrics = (
  input: z.input<typeof inputSchema>,
): BusinessMetricsResult => {
  const parsed = inputSchema.parse(input);
  const names = new Set([...Object.keys(parsed.current), ...Object.keys(parsed.previous ?? {})]);
  for (const name of Object.keys(parsed.budget ?? {})) names.add(name);
  const metrics: BusinessMetricResult[] = [...names].sort().map((metric) => {
    const current = parsed.current[metric];
    if (current === undefined) throw new Error(`当前期间缺少指标：${metric}`);
    const previous = parsed.previous?.[metric];
    const budget = parsed.budget?.[metric];
    const warnings: string[] = [];
    const result: BusinessMetricResult = { metric, current, warnings };
    if (previous !== undefined) {
      result.previous = previous;
      result.change = current - previous;
      if (previous === 0) warnings.push('comparison-zero-baseline');
      else result.changeRate = (current - previous) / Math.abs(previous);
    }
    if (budget !== undefined) {
      result.budget = budget;
      result.budgetVariance = current - budget;
      if (budget === 0) warnings.push('budget-zero-baseline');
      else result.budgetVarianceRate = (current - budget) / Math.abs(budget);
    }
    return result;
  });
  return {
    period: parsed.period,
    metrics,
    message: `已按确定性规则计算 ${metrics.length} 个指标；零基数比例已明确标记。`,
  };
};

export const businessMetricsTool: AgentTool = {
  name: 'analyze_business_metrics',
  description:
    'Calculate deterministic period-over-period and budget variances for named business metrics. Provide current values and optional previous/budget values; the tool never guesses missing values or calculates formulas.',
  inputSchema: {
    type: 'object',
    properties: {
      period: { type: 'string', description: 'The current reporting period.' },
      current: { type: 'object', description: 'Metric name to current numeric value.' },
      previous: { type: 'object', description: 'Optional comparison-period numeric values.' },
      budget: { type: 'object', description: 'Optional budget numeric values.' },
    },
    required: ['period', 'current'],
    additionalProperties: false,
  },
  async execute(rawInput, context) {
    if (context.signal.aborted) throw abortError();
    const input = inputSchema.parse(rawInput);
    context.reportProgress(`正在计算 ${input.period} 的经营指标`);
    const result = analyzeBusinessMetrics(input);
    if (context.signal.aborted) throw abortError();
    return result;
  },
};
