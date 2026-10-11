import { abortError, type AgentTool } from '@betterwork/agent-core';
import { z } from 'zod';

const metricNameSchema = z.string().trim().min(1).max(100);
const numbersSchema = z
  .record(metricNameSchema, z.number().finite())
  .refine((values) => Object.keys(values).length <= 100, '最多同时分析 100 个指标');
const factSchema = z
  .object({
    value: z.number().finite(),
    unit: z.string().trim().min(1).max(40),
    period: z.string().trim().min(1).max(100),
    sourceId: z.string().trim().min(1).max(200),
  })
  .strict();
const metricFactsSchema = z
  .record(metricNameSchema, factSchema)
  .refine((values) => Object.keys(values).length <= 100, '最多同时分析 100 个指标');
const resultNumberSchema = z.custom<number>((value) => typeof value === 'number');
export const businessMetricsToolOutputSchema = z.object({
  period: z.string(),
  metrics: z.array(
    z.object({
      metric: z.string(),
      current: resultNumberSchema,
      previous: resultNumberSchema.optional(),
      budget: resultNumberSchema.optional(),
      change: resultNumberSchema.optional(),
      changeRate: resultNumberSchema.optional(),
      budgetVariance: resultNumberSchema.optional(),
      budgetVarianceRate: resultNumberSchema.optional(),
      unit: z.string().optional(),
      currentPeriod: z.string().optional(),
      currentSourceId: z.string().optional(),
      previousPeriod: z.string().optional(),
      previousSourceId: z.string().optional(),
      budgetPeriod: z.string().optional(),
      budgetSourceId: z.string().optional(),
      warnings: z.array(z.string()),
    }),
  ),
  message: z.string(),
});

export type BusinessMetricsToolOutput = z.infer<typeof businessMetricsToolOutputSchema>;

const legacyInputSchema = z
  .object({
    period: z.string().trim().min(1).max(100),
    current: numbersSchema,
    previous: numbersSchema.optional(),
    budget: numbersSchema.optional(),
  })
  .strict();

const sourcedInputSchema = z
  .object({
    period: z.string().trim().min(1).max(100),
    current: metricFactsSchema,
    previous: metricFactsSchema.optional(),
    budget: metricFactsSchema.optional(),
  })
  .strict();

export type SourcedMetricFact = z.infer<typeof factSchema>;
export type SourcedBusinessMetricsInput = z.infer<typeof sourcedInputSchema>;
export type BusinessMetricFactsValidator = (input: SourcedBusinessMetricsInput) => void;

export interface BusinessMetricResult {
  metric: string;
  current: number;
  previous?: number;
  budget?: number;
  change?: number;
  changeRate?: number;
  budgetVariance?: number;
  budgetVarianceRate?: number;
  unit?: string;
  currentPeriod?: string;
  currentSourceId?: string;
  previousPeriod?: string;
  previousSourceId?: string;
  budgetPeriod?: string;
  budgetSourceId?: string;
  warnings: string[];
}

export interface BusinessMetricsResult {
  period: string;
  metrics: BusinessMetricResult[];
  message: string;
}

const metricNames = (
  current: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  budget: Record<string, unknown> | undefined,
): string[] => {
  const names = new Set([...Object.keys(current), ...Object.keys(previous ?? {})]);
  for (const name of Object.keys(budget ?? {})) names.add(name);
  return [...names].sort();
};

export const analyzeBusinessMetrics = (
  input: z.input<typeof legacyInputSchema>,
): BusinessMetricsResult => {
  const parsed = legacyInputSchema.parse(input);
  const metrics = metricNames(parsed.current, parsed.previous, parsed.budget).map((metric) => {
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
    message: '已按确定性规则完成指标计算；零基数比例已明确标记。',
  };
};

export const analyzeSourcedBusinessMetrics = (
  input: SourcedBusinessMetricsInput,
): BusinessMetricsResult => {
  const parsed = sourcedInputSchema.parse(input);
  const metrics = metricNames(parsed.current, parsed.previous, parsed.budget).map((metric) => {
    const current = parsed.current[metric];
    if (!current) throw new Error(`当前期间缺少指标：${metric}`);
    if (current.period !== parsed.period) {
      throw new Error(`当前指标期间与分析期间不一致：${metric}`);
    }
    const previous = parsed.previous?.[metric];
    const budget = parsed.budget?.[metric];
    if (previous && previous.unit !== current.unit) {
      throw new Error(`对比期间单位与当前期间不一致：${metric}`);
    }
    if (budget && budget.unit !== current.unit) {
      throw new Error(`预算单位与当前期间不一致：${metric}`);
    }
    const warnings: string[] = [];
    const result: BusinessMetricResult = {
      metric,
      current: current.value,
      unit: current.unit,
      currentPeriod: current.period,
      currentSourceId: current.sourceId,
      warnings,
    };
    if (previous) {
      result.previous = previous.value;
      result.previousPeriod = previous.period;
      result.previousSourceId = previous.sourceId;
      result.change = current.value - previous.value;
      if (previous.value === 0) warnings.push('comparison-zero-baseline');
      else result.changeRate = (current.value - previous.value) / Math.abs(previous.value);
    }
    if (budget) {
      result.budget = budget.value;
      result.budgetPeriod = budget.period;
      result.budgetSourceId = budget.sourceId;
      result.budgetVariance = current.value - budget.value;
      if (budget.value === 0) warnings.push('budget-zero-baseline');
      else result.budgetVarianceRate = (current.value - budget.value) / Math.abs(budget.value);
    }
    return result;
  });
  return {
    period: parsed.period,
    metrics,
    message: '已按确定性规则完成指标计算；零基数比例已明确标记。',
  };
};

const legacyInputJsonSchema = {
  type: 'object',
  properties: {
    period: { type: 'string', description: 'The current reporting period.' },
    current: { type: 'object', description: 'Metric name to current numeric value.' },
    previous: { type: 'object', description: 'Optional comparison-period numeric values.' },
    budget: { type: 'object', description: 'Optional budget numeric values.' },
  },
  required: ['period', 'current'],
  additionalProperties: false,
};

const sourcedInputJsonSchema = {
  type: 'object',
  properties: {
    period: { type: 'string', description: 'The exact period label for current facts.' },
    current: {
      type: 'object',
      description: 'Current metric facts; each value needs metric, unit, period and sourceId.',
      additionalProperties: {
        $ref: '#/$defs/metricFact',
      },
    },
    previous: {
      type: 'object',
      description: 'Optional comparison facts with their own periods and source IDs.',
      additionalProperties: { $ref: '#/$defs/metricFact' },
    },
    budget: {
      type: 'object',
      description: 'Optional budget facts with their own periods and source IDs.',
      additionalProperties: { $ref: '#/$defs/metricFact' },
    },
  },
  required: ['period', 'current'],
  additionalProperties: false,
  $defs: {
    metricFact: {
      type: 'object',
      properties: {
        value: { type: 'number', description: 'Exact numeric value read from the source.' },
        unit: { type: 'string', description: 'Exact unit written in the source.' },
        period: { type: 'string', description: 'Exact period label written in the source.' },
        sourceId: {
          type: 'string',
          description: 'sourceId returned by a read tool, or user-prompt for prompt facts.',
        },
      },
      required: ['value', 'unit', 'period', 'sourceId'],
      additionalProperties: false,
    },
  },
};

const toolDescription =
  'Calculate deterministic period-over-period and budget variances for named business metrics. The tool never guesses missing values or calculates formulas in the model.';

export const createBusinessMetricsTool = (
  validateFacts?: BusinessMetricFactsValidator,
): AgentTool => ({
  name: 'analyze_business_metrics',
  description: validateFacts
    ? `${toolDescription} Every value must include its exact unit, period, and sourceId from a read result or user-prompt.`
    : toolDescription,
  inputSchema: validateFacts ? sourcedInputJsonSchema : legacyInputJsonSchema,
  async execute(rawInput, context) {
    if (context.signal.aborted) throw abortError();
    context.reportProgress('正在计算经营指标');
    if (!validateFacts) {
      const input = legacyInputSchema.parse(rawInput);
      const result = analyzeBusinessMetrics(input);
      if (context.signal.aborted) throw abortError();
      return result;
    }
    const input = sourcedInputSchema.parse(rawInput);
    validateFacts(input);
    context.reportProgress(`正在计算 ${input.period} 的经营指标`);
    const result = analyzeSourcedBusinessMetrics(input);
    if (context.signal.aborted) throw abortError();
    return result;
  },
});

export const businessMetricsTool = createBusinessMetricsTool();
