import type {
  BusinessMetricFactsValidator,
  BusinessMetricsToolOutput,
  SourcedBusinessMetricsInput,
  SourcedMetricFact,
} from '@betterwork/tool-runtime';

export interface BusinessMetricFactRecord {
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly periods: readonly string[];
  readonly sourceIds: readonly string[];
}

export interface MaterialFactLedger {
  readonly enabled: boolean;
  readonly qualitativeEnabled: boolean;
  readonly selectedMaterialCount: number;
  materialReadCount: number;
  readonly sources: Map<string, string>;
  readonly facts: BusinessMetricFactRecord[];
  readonly supportedQualitativeClaims: Set<string>;
}

export interface MaterialFactScope {
  readonly explicitBusinessAnalysis: boolean;
  readonly materialScope: boolean;
  readonly selectedMaterialCount: number;
  readonly prompt: string;
}

export const USER_PROMPT_FACT_SOURCE_ID = 'user-prompt';

export const createMaterialFactLedger = ({
  explicitBusinessAnalysis,
  materialScope,
  selectedMaterialCount,
  prompt,
}: MaterialFactScope): MaterialFactLedger => {
  const ledger: MaterialFactLedger = {
    enabled: explicitBusinessAnalysis,
    qualitativeEnabled: materialScope && selectedMaterialCount > 0,
    selectedMaterialCount,
    materialReadCount: 0,
    sources: new Map(),
    facts: [],
    supportedQualitativeClaims: new Set(),
  };
  if (ledger.enabled && prompt.trim()) ledger.sources.set(USER_PROMPT_FACT_SOURCE_ID, prompt);
  if (ledger.qualitativeEnabled) recordQualitativeClaims(ledger.supportedQualitativeClaims, prompt);
  return ledger;
};

export interface MaterialFactInput {
  readonly kind: 'material-read';
  readonly sourceId: string;
  readonly content: string;
}

const sameFact = (left: BusinessMetricFactRecord, right: BusinessMetricFactRecord): boolean =>
  left.metric === right.metric &&
  left.value === right.value &&
  normalizeUnit(left.unit) === normalizeUnit(right.unit) &&
  sameStrings(left.periods, right.periods) &&
  sameStrings(left.sourceIds, right.sourceIds);

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const normalizeUnit = (unit: string): string => unit.normalize('NFC').trim().replaceAll('％', '%');

const qualitativeClaimPatterns = [
  { phrase: '已续约', label: '已续约状态' },
  { phrase: '已流失', label: '已流失状态' },
  { phrase: '平均客单价', label: '平均客单价' },
  { phrase: '续约率', label: '续约率' },
  { phrase: '流失率', label: '流失率' },
  { phrase: '客户总数', label: '客户总数' },
  { phrase: '总客户数', label: '总客户数' },
] as const;
const qualitativeNegationPattern =
  /材料(?:未|没有)|未(?:提供|提及|确认)|不可推断|无法(?:判断|确认|推断)|待确认|不确定|未知|没有给出|不能/iu;
const qualitativeNonAssertionPattern =
  /是否|核实|确认|跟进|追踪|了解|检查|判断|若|如果|可能|意向|计划|建议/iu;

const hasNonAssertiveQualitativeClaim = (
  content: string,
  phrase: string,
  index: number,
): boolean => {
  const context = content.slice(Math.max(0, index - 50), index + phrase.length + 50);
  return qualitativeNegationPattern.test(context) || qualitativeNonAssertionPattern.test(context);
};

const recordQualitativeClaims = (target: Set<string>, text: string): void => {
  for (const claim of qualitativeClaimPatterns) {
    let index = text.indexOf(claim.phrase);
    while (index >= 0) {
      if (!hasNonAssertiveQualitativeClaim(text, claim.phrase, index)) {
        target.add(claim.phrase);
        break;
      }
      index = text.indexOf(claim.phrase, index + claim.phrase.length);
    }
  }
};

export const recordMaterialFacts = (ledger: MaterialFactLedger, input: MaterialFactInput): void => {
  if (input.kind !== 'material-read') return;
  ledger.materialReadCount += 1;
  if (ledger.qualitativeEnabled) {
    recordQualitativeClaims(ledger.supportedQualitativeClaims, input.content);
  }
  if (ledger.enabled) {
    const existing = ledger.sources.get(input.sourceId);
    if (existing !== undefined && existing !== input.content) {
      throw new Error('材料事实来源 ID 冲突，无法建立稳定来源关联。');
    }
    ledger.sources.set(input.sourceId, input.content);
  }
};

const sourceContainsFact = (content: string, metric: string, fact: SourcedMetricFact): boolean => {
  if (sourceContainsStructuredFact(content, metric, fact)) return true;
  if (!content.includes(metric) || !content.includes(fact.period)) return false;
  const unit = normalizeUnit(fact.unit);
  const normalizedContent = content.replaceAll('％', '%');
  const valuePattern = /[-+]?(?:\d+(?:\.\d+)?|\.\d+)/gu;
  for (const match of normalizedContent.matchAll(valuePattern)) {
    const rawValue = match[0];
    const value = Number(rawValue);
    if (value !== fact.value) continue;
    const start = match.index + rawValue.length;
    const suffix = normalizedContent.slice(start, start + unit.length + 8);
    const unitMatch = new RegExp(`^\\s*${escapeRegExp(unit)}(?![\\p{L}\\p{N}_])`, 'u');
    if (unitMatch.test(suffix)) return true;
  }
  return false;
};

const sourceContainsStructuredFact = (
  content: string,
  metric: string,
  fact: SourcedMetricFact,
): boolean => {
  const jsonStart = content.indexOf('{');
  const jsonEnd = content.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) return false;
  let source: unknown;
  try {
    source = JSON.parse(content.slice(jsonStart, jsonEnd + 1));
  } catch {
    return false;
  }
  if (!isRecord(source)) return false;
  return ['current', 'previous', 'budget'].some((periodKey) => {
    const periodFacts = source[periodKey];
    if (!isRecord(periodFacts)) return false;
    const candidate = periodFacts[metric];
    return (
      isRecord(candidate) &&
      candidate.value === fact.value &&
      typeof candidate.unit === 'string' &&
      normalizeUnit(candidate.unit) === normalizeUnit(fact.unit) &&
      candidate.period === fact.period &&
      candidate.sourceId === fact.sourceId
    );
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const registerFact = (ledger: MaterialFactLedger, fact: BusinessMetricFactRecord): void => {
  if (!ledger.facts.some((existing) => sameFact(existing, fact))) ledger.facts.push(fact);
};

const entriesOf = (
  values: Record<string, SourcedMetricFact> | undefined,
): Array<[string, SourcedMetricFact]> => (values ? Object.entries(values) : []);

export const validateAndRecordBusinessMetricFacts = (
  ledger: MaterialFactLedger,
  input: SourcedBusinessMetricsInput,
): void => {
  if (!ledger.enabled) throw new Error('材料事实校验失败：当前 Run 未启用显式经营分析。');
  const entries = [
    ...entriesOf(input.current),
    ...entriesOf(input.previous),
    ...entriesOf(input.budget),
  ];
  for (const [metric, fact] of entries) {
    const source = ledger.sources.get(fact.sourceId);
    if (!source) {
      throw new Error(`材料事实校验失败：指标“${metric}”引用了本次 Run 未读取的来源。`);
    }
    if (!sourceContainsFact(source, metric, fact)) {
      throw new Error(
        `材料事实校验失败：来源未同时提供指标“${metric}”的数值、单位和期间（${fact.period}）。`,
      );
    }
  }
  for (const [metric, fact] of entries) {
    registerFact(ledger, {
      metric,
      value: fact.value,
      unit: normalizeUnit(fact.unit),
      periods: [fact.period],
      sourceIds: [fact.sourceId],
    });
  }
};

// The validator is bound to one Run so each accepted fact records against its own source ledger.
export const createBusinessMetricFactsValidator =
  (ledger: MaterialFactLedger): BusinessMetricFactsValidator =>
  (facts) =>
    validateAndRecordBusinessMetricFacts(ledger, facts);

export const recordDeterministicBusinessMetrics = (
  ledger: MaterialFactLedger,
  result: BusinessMetricsToolOutput,
): void => {
  if (!ledger.enabled) return;
  for (const metric of result.metrics) {
    if (
      metric.unit === undefined ||
      metric.currentPeriod === undefined ||
      metric.currentSourceId === undefined
    ) {
      throw new Error('确定性经营分析结果缺少指标、单位、期间或来源关联。');
    }
    const current: BusinessMetricFactRecord = {
      metric: metric.metric,
      value: metric.current,
      unit: normalizeUnit(metric.unit),
      periods: [metric.currentPeriod],
      sourceIds: [metric.currentSourceId],
    };
    if (!ledger.facts.some((fact) => sameFact(fact, current))) {
      throw new Error(`确定性经营分析结果未匹配已核验输入：${metric.metric}。`);
    }
    if (metric.previous !== undefined) {
      if (metric.previousPeriod === undefined || metric.previousSourceId === undefined) {
        throw new Error('确定性经营分析结果缺少对比期间或来源关联。');
      }
      assertKnownInputFact(ledger, {
        metric: metric.metric,
        value: metric.previous,
        unit: normalizeUnit(metric.unit),
        periods: [metric.previousPeriod],
        sourceIds: [metric.previousSourceId],
      });
      if (metric.change !== undefined) {
        registerFact(ledger, {
          metric: metric.metric,
          value: metric.change,
          unit: normalizeUnit(metric.unit),
          periods: [metric.currentPeriod, metric.previousPeriod],
          sourceIds: [metric.currentSourceId, metric.previousSourceId],
        });
      }
      if (metric.changeRate !== undefined) {
        registerFact(ledger, {
          metric: metric.metric,
          value: metric.changeRate * 100,
          unit: '%',
          periods: [metric.currentPeriod, metric.previousPeriod],
          sourceIds: [metric.currentSourceId, metric.previousSourceId],
        });
      }
    }
    if (metric.budget !== undefined) {
      if (metric.budgetPeriod === undefined || metric.budgetSourceId === undefined) {
        throw new Error('确定性经营分析结果缺少预算期间或来源关联。');
      }
      assertKnownInputFact(ledger, {
        metric: metric.metric,
        value: metric.budget,
        unit: normalizeUnit(metric.unit),
        periods: [metric.budgetPeriod],
        sourceIds: [metric.budgetSourceId],
      });
      if (metric.budgetVariance !== undefined) {
        registerFact(ledger, {
          metric: metric.metric,
          value: metric.budgetVariance,
          unit: normalizeUnit(metric.unit),
          periods: [metric.currentPeriod, metric.budgetPeriod],
          sourceIds: [metric.currentSourceId, metric.budgetSourceId],
        });
      }
      if (metric.budgetVarianceRate !== undefined) {
        registerFact(ledger, {
          metric: metric.metric,
          value: metric.budgetVarianceRate * 100,
          unit: '%',
          periods: [metric.currentPeriod, metric.budgetPeriod],
          sourceIds: [metric.currentSourceId, metric.budgetSourceId],
        });
      }
    }
  }
};

const assertKnownInputFact = (ledger: MaterialFactLedger, fact: BusinessMetricFactRecord): void => {
  if (!ledger.facts.some((known) => sameFact(known, fact))) {
    throw new Error(`确定性经营分析结果未匹配已核验输入：${fact.metric}。`);
  }
};

const claimNumberPattern =
  /([-+]?\d+(?:\.\d+)?)(\s*(?:[%％]|(?!年|月|日|号|季度)[\p{L}][\p{L}\p{N}²³/_·.-]*))/gu;
const labeledCountPattern =
  /客户(?:数|数量)(?:\s*[（(]\s*(?:家|户|客户)\s*[）)])?\s*(?:为|是|[:：|｜\t])\s*([-+]?\d+(?:\.\d+)?)/gu;

interface NumberClaim {
  readonly value: number;
  readonly unit: string;
}

const numberClaimsIn = (content: string, periods: readonly string[]): NumberClaim[] => {
  const claims: NumberClaim[] = [];
  let claimText = content.replace(
    /(?:19|20)\d{2}\s*(?:[-/.年]\s*\d{1,2})(?:(?:[-/.月]\s*\d{1,2})日?)?/gu,
    ' ',
  );
  for (const period of [...new Set(periods)].sort((left, right) => right.length - left.length)) {
    claimText = claimText.replace(new RegExp(escapeRegExp(period), 'gu'), ' ');
  }
  for (const match of claimText.matchAll(claimNumberPattern)) {
    const value = Number(match[1]);
    const unit = match[2]?.trim();
    if (Number.isFinite(value) && unit) claims.push({ value, unit: normalizeUnit(unit) });
  }
  for (const match of content.matchAll(labeledCountPattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) claims.push({ value, unit: '客户' });
  }
  return claims;
};

const roundedValues = (value: number): number[] => [
  ...new Set([value, ...[0, 1, 2, 3, 4].map((precision) => Number(value.toFixed(precision)))]),
];

const factSupportsClaim = (
  fact: BusinessMetricFactRecord,
  claim: NumberClaim,
  line: string,
): boolean =>
  normalizeUnit(fact.unit) === claim.unit &&
  roundedValues(fact.value).includes(claim.value) &&
  line.includes(fact.metric) &&
  fact.periods.every((period) => line.includes(period));

export const auditMaterialFacts = (
  ledger: MaterialFactLedger,
  content: string,
): string | undefined => {
  if (!ledger.enabled && !ledger.qualitativeEnabled) return undefined;
  if (ledger.enabled && ledger.selectedMaterialCount > 0 && ledger.materialReadCount === 0) {
    return '材料事实校验失败：本次 Run 选择了材料，但没有成功读取任何材料。请先读取清单中的材料后再完成输出。';
  }
  if (ledger.enabled) {
    const claims = numberClaimsIn(
      content,
      ledger.facts.flatMap((fact) => fact.periods),
    );
    const unsupported = new Set<number>();
    for (const claim of claims) {
      const supported = content
        .split(/\r?\n/u)
        .some((line) => ledger.facts.some((fact) => factSupportsClaim(fact, claim, line)));
      if (!supported) unsupported.add(claim.value);
    }
    if (unsupported.size > 0) {
      return `材料事实校验失败：最终输出包含缺少同一指标、单位、期间和来源关联的数字（${[...unsupported].join('、')}）。请在每个数值结论中保留指标、单位与期间，并仅使用已核验材料或确定性工具结果。`;
    }
  }
  const unsupportedQualitative = qualitativeClaimPatterns
    .filter((claim) => !ledger.supportedQualitativeClaims.has(claim.phrase))
    .filter((claim) => {
      let index = content.indexOf(claim.phrase);
      while (index >= 0) {
        if (!hasNonAssertiveQualitativeClaim(content, claim.phrase, index)) return true;
        index = content.indexOf(claim.phrase, index + claim.phrase.length);
      }
      return false;
    })
    .map((claim) => claim.label);
  if (unsupportedQualitative.length > 0) {
    return `材料事实校验失败：最终输出包含材料未提供的定性事实（${unsupportedQualitative.join('、')}）。请将缺失状态明确写为“材料未提供”或“不可推断”。`;
  }
  return undefined;
};
