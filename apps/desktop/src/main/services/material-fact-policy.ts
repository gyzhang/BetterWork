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
  readonly basis: 'actual' | 'budget' | 'derived';
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
  left.basis === right.basis &&
  sameStrings(left.periods, right.periods) &&
  sameStrings(left.sourceIds, right.sourceIds);

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const normalizeUnit = (unit: string): string => unit.normalize('NFC').trim().replaceAll('％', '%');

const normalizePeriod = (period: string): string => {
  const normalized = period.normalize('NFC').trim();
  const compact = normalized.replace(/\s+/gu, '');
  const fullDate = compact.match(
    /^((?:19|20)\d{2})(?:年|[-/.])(\d{1,2})(?:月|[-/.])(\d{1,2})日?$/u,
  );
  if (fullDate) {
    const yearText = fullDate[1];
    const monthText = fullDate[2];
    const dayText = fullDate[3];
    if (yearText === undefined || monthText === undefined || dayText === undefined)
      return normalized;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      month >= 1 &&
      month <= 12 &&
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return `${yearText}-${monthText.padStart(2, '0')}-${dayText.padStart(2, '0')}`;
    }
    return normalized;
  }
  const month = compact.match(/^((?:19|20)\d{2})(?:年|[-/.])(\d{1,2})月?$/u);
  if (month) {
    const yearText = month[1];
    const monthText = month[2];
    if (yearText === undefined || monthText === undefined) return normalized;
    const monthNumber = Number(monthText);
    if (monthNumber >= 1 && monthNumber <= 12) {
      return `${yearText}-${monthText.padStart(2, '0')}`;
    }
  }
  return normalized;
};

interface PeriodMatch {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

const textPeriodPattern =
  /(?<!\d)((?:19|20)\d{2})(?:\s*[-/.]\s*(\d{1,2})(?:\s*[-/.]\s*(\d{1,2})\s*日?)?|\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日?)?)(?!\d)/gu;

const periodMatchesIn = (content: string): PeriodMatch[] =>
  [...content.matchAll(textPeriodPattern)].map((match) => ({
    value: normalizePeriod(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));

const periodsInClause = (clause: string, knownPeriods: readonly string[]): string[] => {
  const periods = new Set(periodMatchesIn(clause).map(({ value }) => value));
  const normalizedClause = clause.normalize('NFC');
  for (const period of knownPeriods) {
    const normalized = period.normalize('NFC').trim();
    if (!normalized || normalizePeriod(period) !== normalized) continue;
    const periodPattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(normalized)}(?![\\p{L}\\p{N}])`,
      'u',
    );
    if (periodPattern.test(normalizedClause)) periods.add(normalizePeriod(period));
  }
  return [...periods];
};

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

interface TextFactAssertion {
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly period: string;
  readonly basis: 'actual' | 'budget';
}

interface MetricOccurrence {
  readonly metric: string;
  readonly start: number;
  readonly end: number;
}

const nonAssertiveFactPattern =
  /待确认|待核实|未确认|未提供|未提及|可能|假设|如果|若|计划|建议|是否|预计|预测|待定|不确定|未知|不可推断|无法(?:判断|确认|推断)|并非|不是|没有|未(?:发生|达到|实现)|不为/iu;
const numericTokenPattern = '[-+]?(?:\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?|\\.\\d+)';
const numericValuePattern = /[-+]?(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|\.\d+)/gu;
const unitConnectorPattern =
  /(?:的|且|和|与|但|而|其中|预算|实际|同比|环比|变化|增长|下降|分别|各|等|and|but|with).*$/iu;
const unitBoundaryPattern =
  /^(?:的|且|和|与|但|而|其中|预算|实际|同比|环比|变化|增长|下降|分别|各|等|and|but|with)/iu;

interface NumericUnitMatch {
  readonly value: number;
  readonly unit: string;
  readonly index: number;
}

const valueUnitMatchesIn = (content: string, knownUnits: readonly string[]): NumericUnitMatch[] => {
  const units = [...new Set(knownUnits.map(normalizeUnit))].sort(
    (left, right) => right.length - left.length,
  );
  const matches: NumericUnitMatch[] = [];
  for (const numberMatch of content.matchAll(numericValuePattern)) {
    const rawValue = numberMatch[0];
    const numberIndex = numberMatch.index;
    const value = Number(rawValue.replaceAll(',', ''));
    if (!Number.isFinite(value)) continue;
    const suffix = content.slice(numberIndex + rawValue.length).trimStart();
    const exactUnit = units.find((unit) => {
      if (!suffix.startsWith(unit)) return false;
      const remainder = suffix.slice(unit.length);
      const nextCharacter = remainder.slice(0, 1);
      return (
        !nextCharacter ||
        !/[\p{L}\p{N}_]/u.test(nextCharacter) ||
        unitBoundaryPattern.test(remainder)
      );
    });
    const genericUnitMatch = suffix.match(/^(?:[%％]|[\p{L}][\p{L}\p{N}²³/_·.-]*)/u);
    const genericUnit = genericUnitMatch?.[0]?.replace(unitConnectorPattern, '').trim();
    const unit = exactUnit ?? genericUnit;
    if (!unit) continue;
    matches.push({ value, unit: normalizeUnit(unit), index: numberIndex });
  }
  return matches;
};

const joinSplitNumericUnits = (content: string, units: readonly string[]): string => {
  // Keep a newline only when it separates a number from its known unit token.
  let normalized = content.normalize('NFC').replaceAll('％', '%');
  for (const unit of units) {
    const normalizedUnit = normalizeUnit(unit);
    if (!normalizedUnit) continue;
    const unitPattern = new RegExp(
      `(${numericTokenPattern})[ \\t]*\\r?\\n[ \\t]*(${escapeRegExp(normalizedUnit)})(?![\\p{L}\\p{N}_])`,
      'gu',
    );
    normalized = normalized.replace(unitPattern, '$1 $2');
  }
  return normalized;
};

const metricOccurrencesIn = (content: string, metrics: readonly string[]): MetricOccurrence[] => {
  const occurrences: MetricOccurrence[] = [];
  for (const metric of metrics) {
    if (!metric) continue;
    let start = content.indexOf(metric);
    while (start >= 0) {
      occurrences.push({ metric, start, end: start + metric.length });
      start = content.indexOf(metric, start + metric.length);
    }
  }
  return occurrences
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter(
      (occurrence, index, values) =>
        !values.slice(0, index).some((previous) => occurrence.start < previous.end),
    );
};

const textFactAssertionsIn = (
  content: string,
  metrics: readonly string[],
  knownPeriods: readonly string[],
  knownUnits: readonly string[],
): TextFactAssertion[] => {
  const assertions: TextFactAssertion[] = [];
  const sentences = joinSplitNumericUnits(content, knownUnits).split(
    /[\r\n。！？!?；;]+|(?<!\d)\.(?!\d)/u,
  );
  for (const sentence of sentences) {
    const sentencePeriods = periodsInClause(sentence, knownPeriods);
    const clauses = sentence.split(/[，、]|,(?!\d)/u);
    for (const clause of clauses) {
      const occurrences = metricOccurrencesIn(clause, metrics);
      if (occurrences.length === 0) continue;
      const clausePeriods = periodsInClause(clause, knownPeriods);
      const period =
        clausePeriods.length === 1
          ? clausePeriods[0]
          : clausePeriods.length === 0 && sentencePeriods.length === 1
            ? sentencePeriods[0]
            : undefined;
      if (period === undefined) continue;
      const periodRanges = periodMatchesIn(clause);
      const contentWithoutPeriods = [...periodRanges]
        .reverse()
        .reduce(
          (remaining, match) =>
            `${remaining.slice(0, match.start)}${' '.repeat(match.end - match.start)}${remaining.slice(match.end)}`,
          clause,
        );
      for (const [index, occurrence] of occurrences.entries()) {
        const nextOccurrence = occurrences[index + 1];
        const end = nextOccurrence?.start ?? clause.length;
        if (nonAssertiveFactPattern.test(clause)) continue;
        const claimStart = occurrence.start;
        const claimEnd = end;
        const sanitizedClaim = contentWithoutPeriods.slice(claimStart, claimEnd);
        const valuePairs = valueUnitMatchesIn(sanitizedClaim, knownUnits);
        if (valuePairs.length !== 1) continue;
        const valueMatch = valuePairs[0];
        if (valueMatch === undefined) continue;
        const basisContext =
          `${clause.slice(Math.max(0, occurrence.start - 24), occurrence.start)} ${clause.slice(occurrence.end, occurrence.start + valueMatch.index)}`.toLowerCase();
        const budgetIndex = Math.max(
          basisContext.lastIndexOf('预算'),
          basisContext.lastIndexOf('budget'),
        );
        const actualIndex = Math.max(
          basisContext.lastIndexOf('实际'),
          basisContext.lastIndexOf('actual'),
        );
        assertions.push({
          metric: occurrence.metric,
          value: valueMatch.value,
          unit: valueMatch.unit,
          period,
          basis: budgetIndex > actualIndex ? 'budget' : 'actual',
        });
      }
    }
  }
  return assertions;
};

type SourceFactValidation = 'supported' | 'missing' | 'conflict';

type TextFactAssertionIndex = ReadonlyMap<string, readonly TextFactAssertion[]>;

const textFactAssertionKey = (metric: string, period: string, basis: 'actual' | 'budget'): string =>
  `${basis}\u0000${metric}\u0000${normalizePeriod(period)}`;

const indexTextFactAssertions = (
  assertions: readonly TextFactAssertion[],
): TextFactAssertionIndex => {
  const index = new Map<string, TextFactAssertion[]>();
  for (const assertion of assertions) {
    const key = textFactAssertionKey(assertion.metric, assertion.period, assertion.basis);
    const group = index.get(key);
    if (group) group.push(assertion);
    else index.set(key, [assertion]);
  }
  return index;
};

const sourceContainsFact = (
  content: string,
  textAssertions: TextFactAssertionIndex,
  metric: string,
  fact: SourcedMetricFact,
  basis: 'actual' | 'budget',
): SourceFactValidation => {
  if (sourceContainsStructuredFact(content, metric, fact, basis)) return 'supported';
  const assertions = textAssertions.get(textFactAssertionKey(metric, fact.period, basis)) ?? [];
  const distinctFacts = new Set(
    assertions.map((assertion) => `${assertion.value}\u0000${normalizeUnit(assertion.unit)}`),
  );
  if (distinctFacts.size > 1) return 'conflict';
  return assertions.some(
    (assertion) =>
      assertion.value === fact.value && normalizeUnit(assertion.unit) === normalizeUnit(fact.unit),
  )
    ? 'supported'
    : 'missing';
};

const sourceContainsStructuredFact = (
  content: string,
  metric: string,
  fact: SourcedMetricFact,
  basis: 'actual' | 'budget',
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
  const periodKeys = basis === 'budget' ? ['budget'] : ['current', 'previous'];
  return periodKeys.some((periodKey) => {
    const periodFacts = source[periodKey];
    if (!isRecord(periodFacts)) return false;
    const candidate = periodFacts[metric];
    return (
      isRecord(candidate) &&
      candidate.value === fact.value &&
      typeof candidate.unit === 'string' &&
      normalizeUnit(candidate.unit) === normalizeUnit(fact.unit) &&
      typeof candidate.period === 'string' &&
      normalizePeriod(candidate.period) === normalizePeriod(fact.period) &&
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

interface SourcedFactEntry {
  readonly metric: string;
  readonly fact: SourcedMetricFact;
  readonly basis: 'actual' | 'budget';
}

const entriesOf = (
  values: Record<string, SourcedMetricFact> | undefined,
  basis: 'actual' | 'budget',
): SourcedFactEntry[] =>
  values ? Object.entries(values).map(([metric, fact]) => ({ metric, fact, basis })) : [];

const hasConflictingDirectFacts = (facts: readonly BusinessMetricFactRecord[]): boolean =>
  facts.some((fact, index) =>
    facts
      .slice(index + 1)
      .some(
        (other) =>
          fact.basis === other.basis &&
          fact.basis !== 'derived' &&
          fact.metric === other.metric &&
          fact.periods.some((period) =>
            other.periods.some(
              (otherPeriod) => normalizePeriod(period) === normalizePeriod(otherPeriod),
            ),
          ) &&
          (fact.value !== other.value || normalizeUnit(fact.unit) !== normalizeUnit(other.unit)),
      ),
  );

export const validateAndRecordBusinessMetricFacts = (
  ledger: MaterialFactLedger,
  input: SourcedBusinessMetricsInput,
): void => {
  if (!ledger.enabled) throw new Error('材料事实校验失败：当前 Run 未启用显式经营分析。');
  const entries = [
    ...entriesOf(input.current, 'actual'),
    ...entriesOf(input.previous, 'actual'),
    ...entriesOf(input.budget, 'budget'),
  ];
  const knownMetrics = [...new Set(entries.map(({ metric }) => metric))];
  const knownPeriods = [...new Set(entries.map(({ fact }) => fact.period))];
  const knownUnits = [...new Set(entries.map(({ fact }) => fact.unit))];
  const pendingFacts: BusinessMetricFactRecord[] = [];
  const textAssertionsBySource = new Map<string, TextFactAssertionIndex>();
  for (const { metric, fact, basis } of entries) {
    const source = ledger.sources.get(fact.sourceId);
    if (!source) {
      throw new Error(`材料事实校验失败：指标“${metric}”引用了本次 Run 未读取的来源。`);
    }
    let textAssertions = textAssertionsBySource.get(fact.sourceId);
    if (textAssertions === undefined) {
      textAssertions = indexTextFactAssertions(
        textFactAssertionsIn(source, knownMetrics, knownPeriods, knownUnits),
      );
      textAssertionsBySource.set(fact.sourceId, textAssertions);
    }
    const validation = sourceContainsFact(source, textAssertions, metric, fact, basis);
    if (validation === 'conflict') {
      throw new Error(
        `材料事实校验失败：来源存在相互冲突的指标“${metric}”事实（${fact.period}）。`,
      );
    }
    if (validation === 'missing') {
      throw new Error(
        `材料事实校验失败：来源未同时提供指标“${metric}”的数值、单位和期间（${fact.period}）。`,
      );
    }
    pendingFacts.push({
      metric,
      value: fact.value,
      unit: normalizeUnit(fact.unit),
      periods: [fact.period],
      sourceIds: [fact.sourceId],
      basis,
    });
  }
  if (hasConflictingDirectFacts([...ledger.facts, ...pendingFacts])) {
    throw new Error('材料事实校验失败：来源存在相互冲突的指标事实。');
  }
  for (const fact of pendingFacts) registerFact(ledger, fact);
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
      basis: 'actual',
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
        basis: 'actual',
      });
      if (metric.change !== undefined) {
        registerFact(ledger, {
          metric: metric.metric,
          value: metric.change,
          unit: normalizeUnit(metric.unit),
          periods: [metric.currentPeriod, metric.previousPeriod],
          sourceIds: [metric.currentSourceId, metric.previousSourceId],
          basis: 'derived',
        });
      }
      if (metric.changeRate !== undefined) {
        registerFact(ledger, {
          metric: metric.metric,
          value: metric.changeRate * 100,
          unit: '%',
          periods: [metric.currentPeriod, metric.previousPeriod],
          sourceIds: [metric.currentSourceId, metric.previousSourceId],
          basis: 'derived',
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
        basis: 'budget',
      });
      if (metric.budgetVariance !== undefined) {
        registerFact(ledger, {
          metric: metric.metric,
          value: metric.budgetVariance,
          unit: normalizeUnit(metric.unit),
          periods: [metric.currentPeriod, metric.budgetPeriod],
          sourceIds: [metric.currentSourceId, metric.budgetSourceId],
          basis: 'derived',
        });
      }
      if (metric.budgetVarianceRate !== undefined) {
        registerFact(ledger, {
          metric: metric.metric,
          value: metric.budgetVarianceRate * 100,
          unit: '%',
          periods: [metric.currentPeriod, metric.budgetPeriod],
          sourceIds: [metric.currentSourceId, metric.budgetSourceId],
          basis: 'derived',
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
