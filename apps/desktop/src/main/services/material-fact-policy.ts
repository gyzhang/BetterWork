/** Run 内的兼容性防护：只处理已传入片段，不证明指标/期间/来源关联。 */
export interface MaterialFactLedger {
  hasFactInputs: boolean;
  readonly enabled: boolean;
  materialReadCount: number;
  readonly rawNumbers: Set<number>;
  readonly rawCountNumbers: Set<number>;
  readonly allowedNumbers: Set<number>;
  readonly allowedPercentages: Set<number>;
  readonly supportedQualitativeClaims: Set<string>;
}

const numberPattern = /[-+]?\d+(?:\.\d+)?/gu;
const claimNumberPattern = /([-+]?\d+(?:\.\d+)?)(\s*(?:%|％|万元|万|元|家|户|客户))/gu;
const labeledCountPattern =
  /(?:客户数|客户数量)(?:\s*[（(]\s*(?:家|户|客户)\s*[）)])?(?:\s*(?:为|是|[:：]|[|｜\t])\s*|\s*(?:本期|上期|预算|目标|当前|历史)\s*)*([-+]?\d+(?:\.\d+)?)/gu;
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

const numbersIn = (text: string): number[] =>
  [...text.matchAll(numberPattern)]
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value));

const addNormalizedNumber = (target: Set<number>, value: number): void => {
  if (!Number.isFinite(value)) return;
  for (const precision of [0, 1, 2, 3, 4]) {
    target.add(Number(value.toFixed(precision)));
  }
  if (Math.abs(value) <= 1) {
    const percentage = value * 100;
    for (const precision of [0, 1, 2, 3, 4]) {
      target.add(Number(percentage.toFixed(precision)));
    }
  }
};

export interface MaterialFactScope {
  readonly materialScope: boolean;
  readonly selectedMaterialCount: number;
  readonly prompt: string;
}

export const createMaterialFactLedger = ({
  materialScope,
  selectedMaterialCount,
  prompt,
}: MaterialFactScope): MaterialFactLedger => {
  const ledger: MaterialFactLedger = {
    enabled: materialScope && selectedMaterialCount > 0,
    hasFactInputs: false,
    materialReadCount: 0,
    rawNumbers: new Set<number>(),
    rawCountNumbers: new Set<number>(),
    allowedNumbers: new Set<number>(),
    allowedPercentages: new Set<number>(),
    supportedQualitativeClaims: new Set<string>(),
  };
  // 用户在当前请求中明确给出的带业务单位数字属于本 Run 输入，允许模型继续引用。
  for (const match of prompt.matchAll(claimNumberPattern)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    ledger.rawNumbers.add(value);
    const unit = match[2]?.trim();
    if (isCountUnit(unit)) ledger.rawCountNumbers.add(value);
    addNormalizedNumber(ledger.allowedNumbers, value);
    if (isPercentageUnit(unit)) addNormalizedNumber(ledger.allowedPercentages, value);
  }
  for (const match of prompt.matchAll(labeledCountPattern)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    ledger.rawNumbers.add(value);
    ledger.rawCountNumbers.add(value);
    addNormalizedNumber(ledger.allowedNumbers, value);
  }
  recordQualitativeClaims(ledger.supportedQualitativeClaims, prompt);
  return ledger;
};

export type MaterialFactInput =
  | { readonly kind: 'material-read'; readonly content: string }
  | { readonly kind: 'deterministic-result'; readonly content: string };

export const recordMaterialFacts = (ledger: MaterialFactLedger, input: MaterialFactInput): void => {
  if (input.kind === 'material-read') ledger.materialReadCount += 1;
  if (!ledger.enabled) return;
  ledger.hasFactInputs = true;
  const text = input.content;
  recordQualitativeClaims(ledger.supportedQualitativeClaims, text);
  for (const match of text.matchAll(claimNumberPattern)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    const unit = match[2]?.trim();
    if (isCountUnit(unit)) ledger.rawCountNumbers.add(value);
    if (isPercentageUnit(unit)) addNormalizedNumber(ledger.allowedPercentages, value);
  }
  for (const match of text.matchAll(labeledCountPattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) ledger.rawCountNumbers.add(value);
  }
  const values = numbersIn(text);
  for (const value of values) {
    ledger.rawNumbers.add(value);
    addNormalizedNumber(ledger.allowedNumbers, value);
  }
};

const isCountUnit = (unit: string | undefined): boolean =>
  unit === '家' || unit === '户' || unit === '客户';

const isPercentageUnit = (unit: string | undefined): boolean => unit === '%' || unit === '％';

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

type NumberKind = 'count' | 'percentage' | 'number';

interface NumberClaim {
  readonly value: number;
  readonly kind: NumberKind;
}

interface PendingNumbers {
  readonly kind: 'number' | 'percentage';
  readonly values: readonly number[];
  readonly unmatched: Set<number>;
}

const numberKindOf = (unit: string): NumberKind =>
  isCountUnit(unit) ? 'count' : isPercentageUnit(unit) ? 'percentage' : 'number';

const claimKey = (claim: NumberClaim): string => `${claim.kind}:${claim.value}`;

const numberClaimsIn = (content: string): NumberClaim[] => {
  const claims: NumberClaim[] = [];
  for (const match of content.matchAll(claimNumberPattern)) {
    const value = Number(match[1]);
    const unit = match[2]?.trim();
    if (Number.isFinite(value) && unit) claims.push({ value, kind: numberKindOf(unit) });
  }
  for (const match of content.matchAll(labeledCountPattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) claims.push({ value, kind: 'count' });
  }
  return claims;
};

const createPendingNumbers = (
  kind: PendingNumbers['kind'],
  values: Set<number>,
): PendingNumbers => ({
  kind,
  values: [...values].sort((left, right) => left - right),
  unmatched: values,
});

/** 只匹配本次输出实际要求的值；二分定位后保留旧严格容差比较。 */
const matchPendingNumber = (
  query: PendingNumbers,
  candidate: number,
  decisions: Map<string, boolean>,
): void => {
  if (query.unmatched.size === 0) return;
  let start = 0;
  let end = query.values.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    const value = query.values[middle];
    if (value === undefined) return;
    if (value < candidate && Math.abs(value - candidate) >= 0.01) start = middle + 1;
    else end = middle;
  }
  for (let index = start; index < query.values.length; index += 1) {
    const value = query.values[index];
    if (value === undefined) break;
    if (value > candidate && Math.abs(value - candidate) >= 0.01) break;
    if (Math.abs(value - candidate) < 0.01 && query.unmatched.delete(value)) {
      decisions.set(claimKey({ kind: query.kind, value }), true);
    }
  }
};

/** 保留旧舍入和小数展开；派生候选只用于本次查询，不保存为允许池。 */
const matchNormalizedNumber = (
  query: PendingNumbers,
  candidate: number,
  decisions: Map<string, boolean>,
): void => {
  if (query.unmatched.size === 0 || !Number.isFinite(candidate)) return;
  for (const precision of [0, 1, 2, 3, 4]) {
    matchPendingNumber(query, Number(candidate.toFixed(precision)), decisions);
    if (Math.abs(candidate) <= 1) {
      matchPendingNumber(query, Number((candidate * 100).toFixed(precision)), decisions);
    }
  }
};

const resolveNumberClaims = (
  ledger: MaterialFactLedger,
  claims: readonly NumberClaim[],
): Map<string, boolean> => {
  const decisions = new Map<string, boolean>();
  const numbers = new Set<number>();
  const percentages = new Set<number>();
  // 先收集未被直接值支持的输出；同类同值只判定一次。
  for (const claim of claims) {
    const key = claimKey(claim);
    if (decisions.has(key)) continue;
    const candidates =
      claim.kind === 'count'
        ? ledger.rawCountNumbers
        : claim.kind === 'percentage'
          ? ledger.allowedPercentages
          : ledger.allowedNumbers;
    let allowed = false;
    for (const candidate of candidates) {
      if (Math.abs(candidate - claim.value) < 0.01) {
        allowed = true;
        break;
      }
    }
    decisions.set(key, allowed);
    if (!allowed && claim.kind === 'number') numbers.add(claim.value);
    if (!allowed && claim.kind === 'percentage') percentages.add(claim.value);
  }
  if (!ledger.hasFactInputs) return decisions;
  const numberQuery = createPendingNumbers('number', numbers);
  const percentageQuery = createPendingNumbers('percentage', percentages);
  // 兼容旧任意配对许可；所有输出数字共用一次扫描，读取阶段不枚举。
  for (const current of ledger.rawNumbers) {
    for (const comparison of ledger.rawNumbers) {
      if (numberQuery.unmatched.size === 0 && percentageQuery.unmatched.size === 0)
        return decisions;
      if (comparison === 0) continue;
      const varianceRate = ((current - comparison) / Math.abs(comparison)) * 100;
      matchNormalizedNumber(numberQuery, current - comparison, decisions);
      matchNormalizedNumber(numberQuery, varianceRate, decisions);
      matchNormalizedNumber(percentageQuery, varianceRate, decisions);
      matchNormalizedNumber(percentageQuery, (current / comparison) * 100, decisions);
    }
  }
  return decisions;
};

const hasNonAssertiveQualitativeClaim = (
  content: string,
  phrase: string,
  index: number,
): boolean => {
  const context = content.slice(Math.max(0, index - 50), index + phrase.length + 50);
  return qualitativeNegationPattern.test(context) || qualitativeNonAssertionPattern.test(context);
};

export const auditMaterialFacts = (
  ledger: MaterialFactLedger,
  content: string,
): string | undefined => {
  if (!ledger.enabled) return undefined;
  if (ledger.materialReadCount === 0) {
    return '材料事实校验失败：本次 Run 选择了材料，但没有成功读取任何材料。请先读取清单中的材料后再完成输出。';
  }
  const claims = numberClaimsIn(content);
  const decisions = resolveNumberClaims(ledger, claims);
  const unsupported = new Set<number>();
  for (const claim of claims) {
    if (!decisions.get(claimKey(claim))) unsupported.add(claim.value);
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
  if (unsupported.size > 0) {
    return `材料事实校验失败：最终输出包含本次 Run 材料或确定性工具未提供的数字（${[...unsupported].join('、')}）。请重新读取材料，并将缺失数据明确写为“材料未提供”。`;
  }
  if (unsupportedQualitative.length > 0) {
    return `材料事实校验失败：最终输出包含材料未提供的定性事实（${unsupportedQualitative.join('、')}）。请将缺失状态明确写为“材料未提供”或“不可推断”。`;
  }
  return undefined;
};
