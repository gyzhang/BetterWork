import type { MemoryKind, MemoryScope } from '@betterwork/agent-protocol';
import {
  countCodePoints,
  MEMORY_RECALL_BLOCK_CODE_POINT_BUDGET,
  MEMORY_RECALL_CONTENT_CODE_POINT_BUDGET,
  MEMORY_RECALL_HAN_STOP_BIGRAMS,
  MEMORY_RECALL_LATIN_STOP_WORDS,
  MEMORY_RECALL_MATERIAL_TITLE_CODE_POINT_LIMIT,
  MEMORY_RECALL_MATERIAL_TITLE_ITEM_LIMIT,
  MEMORY_RECALL_MIN_MATCHED_TOKENS,
  MEMORY_RECALL_PREFERENCE_CODE_POINT_BUDGET,
  MEMORY_RECALL_PREFERENCE_ITEM_LIMIT,
  MEMORY_RECALL_QUERY_CODE_POINT_LIMIT,
  MEMORY_RECALL_QUERY_EDGE_CODE_POINT_LIMIT,
  MEMORY_RECALL_SCORE_SCALE,
  MEMORY_RECALL_SINGLE_HAN_WEIGHT,
  MEMORY_RECALL_SINGLE_TOKEN_MIN_MATCHED,
  MEMORY_RECALL_STRONG_TOKEN_WEIGHT,
  MEMORY_RECALL_TASK_TITLE_CODE_POINT_LIMIT,
  MEMORY_RECALL_TOTAL_ITEM_LIMIT,
  MEMORY_RECALL_WRAPPER_CODE_POINT_BUDGET,
} from '@betterwork/agent-protocol';

/**
 * memory-recall-v1：非向量的确定性任务相关召回。
 *
 * 分词、权重、排序和预算全是纯函数，固定合成用例即可复现；任何改动都必须同时升
 * MEMORY_RECALL_VERSION 并更新 fixtures（总稿 §6.1 第 3 条）。
 */

/**
 * 阈值与两份停用词表都取自协议常量：`memory-recall-v1` 的算法版本、请求 Schema 的
 * `recallAlgorithm` 回执和本文件的分词必须是同一份数字，否则审计里的算法解释不了实际排序。
 */
export const RECALL_BUDGET = {
  maxItems: MEMORY_RECALL_TOTAL_ITEM_LIMIT,
  maxContentCodePoints: MEMORY_RECALL_CONTENT_CODE_POINT_BUDGET,
  maxWrapperCodePoints: MEMORY_RECALL_WRAPPER_CODE_POINT_BUDGET,
  maxMemoryBlockCodePoints: MEMORY_RECALL_BLOCK_CODE_POINT_BUDGET,
  preferencePoolMaxItems: MEMORY_RECALL_PREFERENCE_ITEM_LIMIT,
  preferencePoolMaxContentCodePoints: MEMORY_RECALL_PREFERENCE_CODE_POINT_BUDGET,
  queryMaxCodePoints: MEMORY_RECALL_QUERY_CODE_POINT_LIMIT,
  queryHeadCodePoints: MEMORY_RECALL_QUERY_EDGE_CODE_POINT_LIMIT,
  queryTailCodePoints: MEMORY_RECALL_QUERY_EDGE_CODE_POINT_LIMIT,
  taskTitleMaxCodePoints: MEMORY_RECALL_TASK_TITLE_CODE_POINT_LIMIT,
  materialTitleMaxCodePoints: MEMORY_RECALL_MATERIAL_TITLE_CODE_POINT_LIMIT,
  materialTitleCount: MEMORY_RECALL_MATERIAL_TITLE_ITEM_LIMIT,
} as const;

const HAN_RUN = /\p{Script=Han}+/gu;
const LATIN_TOKEN = /[a-z0-9]+(?:[._-][a-z0-9]+)*/gu;

const chineseStops = new Set<string>(MEMORY_RECALL_HAN_STOP_BIGRAMS);
const latinStops = new Set<string>(MEMORY_RECALL_LATIN_STOP_WORDS);

/** NFKC + 英文小写 + 空白归一；只影响检索文本，不改原始正文与哈希。 */
export const normalizeRecallText = (value: string): string =>
  value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();

export interface RecallToken {
  readonly text: string;
  readonly weight: number;
}

/**
 * 汉字连续段取重叠 bigram；单汉字段退化为低权字符匹配。
 * 英文数字 token 为连续字母/数字，允许内部小数点、下划线、连字符。
 */
export const tokenizeRecallText = (value: string): RecallToken[] => {
  const normalized = normalizeRecallText(value);
  const tokens: RecallToken[] = [];
  const seen = new Set<string>();
  const push = (text: string, weight: number): void => {
    if (seen.has(text)) return;
    seen.add(text);
    tokens.push({ text, weight });
  };

  const boundaries: [number, number][] = [];
  for (const match of normalized.matchAll(HAN_RUN)) {
    const run = match[0] ?? '';
    const start = match.index ?? 0;
    boundaries.push([start, start + countCodePoints(run)]);
  }

  const hanSpans = new Set<number>();
  for (const [start, end] of boundaries) {
    for (let offset = start; offset < end; offset += 1) hanSpans.add(offset);
    const run = [...normalized.slice(start, end)];
    if (run.length === 1) {
      const single = run[0];
      if (single !== undefined) push(single, MEMORY_RECALL_SINGLE_HAN_WEIGHT);
      continue;
    }
    for (let index = 0; index + 1 < run.length; index += 1) {
      const left = run[index];
      const right = run[index + 1];
      if (left === undefined || right === undefined) continue;
      const bigram = `${left}${right}`;
      if (chineseStops.has(bigram)) continue;
      push(bigram, MEMORY_RECALL_STRONG_TOKEN_WEIGHT);
    }
  }

  const nonHan = [...normalized]
    .map((character, offset) => (hanSpans.has(offset) ? ' ' : character))
    .join('');
  for (const match of nonHan.matchAll(LATIN_TOKEN)) {
    const token = match[0] ?? '';
    if (latinStops.has(token)) continue;
    push(token, MEMORY_RECALL_STRONG_TOKEN_WEIGHT);
  }
  return tokens;
};

export interface RecallQueryParts {
  readonly prompt: string;
  readonly taskTitle?: string;
  /** 必须已按精确引用键排序，最多取前 10 个。 */
  readonly materialTitles?: readonly string[];
}

export interface AssembledRecallQuery {
  readonly tokens: readonly RecallToken[];
  readonly truncated: boolean;
}

const clampHead = (value: string, limit: number): string =>
  countCodePoints(value) <= limit ? value : [...value].slice(0, limit).join('');

const clampHeadTail = (value: string, limit: number): string => {
  if (countCodePoints(value) <= limit) return value;
  const characters = [...value];
  return [
    ...characters.slice(0, RECALL_BUDGET.queryHeadCodePoints),
    ...characters.slice(-RECALL_BUDGET.queryTailCodePoints),
  ].join('');
};

/** 查询只由 prompt、任务标题和已选材料标题构成，不读取材料正文。 */
export const assembleRecallQuery = (parts: RecallQueryParts): AssembledRecallQuery => {
  const truncatedPrompt = countCodePoints(parts.prompt) > RECALL_BUDGET.queryMaxCodePoints;
  const pieces = [clampHeadTail(parts.prompt, RECALL_BUDGET.queryMaxCodePoints)];
  let truncated = truncatedPrompt;

  if (parts.taskTitle) {
    truncated =
      truncated || countCodePoints(parts.taskTitle) > RECALL_BUDGET.taskTitleMaxCodePoints;
    pieces.push(clampHead(parts.taskTitle, RECALL_BUDGET.taskTitleMaxCodePoints));
  }
  for (const title of (parts.materialTitles ?? []).slice(0, RECALL_BUDGET.materialTitleCount)) {
    truncated = truncated || countCodePoints(title) > RECALL_BUDGET.materialTitleMaxCodePoints;
    pieces.push(clampHead(title, RECALL_BUDGET.materialTitleMaxCodePoints));
  }

  const tokens = tokenizeRecallText(pieces.join(' '));
  return { tokens, truncated };
};

export interface ScoredRecall {
  readonly score: number;
  readonly matchedTokens: number;
}

/**
 * score = floor(1000 × 命中 token 权重和 / 查询与记录 token 并集权重和)。
 * 至少命中 2 个 token；查询本身只有 1 个 token 时允许命中 1 个。
 */
export const scoreRecallRecord = (
  query: readonly RecallToken[],
  recordText: string,
): ScoredRecall | undefined => {
  const recordTokens = tokenizeRecallText(recordText);
  const queryWeights = new Map(query.map((token) => [token.text, token.weight]));
  const recordWeights = new Map(recordTokens.map((token) => [token.text, token.weight]));
  const normalizedRecord = normalizeRecallText(recordText);

  let matchedWeight = 0;
  let matchedTokens = 0;
  for (const [text, weight] of queryWeights) {
    const recordWeight = recordWeights.get(text);
    if (recordWeight !== undefined) {
      matchedTokens += 1;
      matchedWeight += Math.min(weight, recordWeight);
      continue;
    }
    // 单汉字查询退化为字符匹配，因为记录侧只产出 bigram。
    if (weight === MEMORY_RECALL_SINGLE_HAN_WEIGHT && normalizedRecord.includes(text)) {
      matchedTokens += 1;
      matchedWeight += MEMORY_RECALL_SINGLE_HAN_WEIGHT;
      recordWeights.set(text, MEMORY_RECALL_SINGLE_HAN_WEIGHT);
    }
  }
  const minMatchedTokens =
    query.length === 1 ? MEMORY_RECALL_SINGLE_TOKEN_MIN_MATCHED : MEMORY_RECALL_MIN_MATCHED_TOKENS;
  if (matchedTokens < minMatchedTokens) return undefined;

  let unionWeight = 0;
  const union = new Set([...queryWeights.keys(), ...recordWeights.keys()]);
  for (const text of union) {
    unionWeight += Math.max(queryWeights.get(text) ?? 0, recordWeights.get(text) ?? 0);
  }
  if (unionWeight === 0) return undefined;
  return {
    score: Math.floor((MEMORY_RECALL_SCORE_SCALE * matchedWeight) / unionWeight),
    matchedTokens,
  };
};

/** scope 特异性排序：expert-workspace > workspace > expert > user。 */
export const scopeSpecificity = (scope: MemoryScope): number => {
  switch (scope.kind) {
    case 'user':
      return 0;
    case 'expert':
      return 1;
    case 'workspace':
      return 2;
    case 'expert-workspace':
      return 3;
  }
};

/** id 字节序升序；身份一律是 UUID，故码元序即字节序。 */
export const compareIdsByteOrder = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export interface RecallItem {
  readonly id: string;
  readonly revisionId: string;
  readonly contentHash: string;
  readonly content: string;
  readonly kind: MemoryKind;
  readonly scope: MemoryScope;
  readonly updatedAt: number;
  readonly topicKey?: string;
}

export interface RankedRecall extends RecallItem {
  readonly score: number;
}

export type RecallReason = 'relevance' | 'preference-pool' | 'conflict-group';

export interface SelectedMemory {
  readonly id: string;
  readonly revisionId: string;
  readonly contentHash: string;
  readonly content: string;
  readonly order: number;
  readonly reason: RecallReason;
}

export interface BudgetSelection {
  readonly items: readonly SelectedMemory[];
  readonly contentCodePoints: number;
  readonly skippedForBudget: number;
}

/** keep-both 裁决组按整组选择或整组跳过，组内两条不得因预算只带一条。 */
export interface RecallGroup {
  readonly items: readonly RecallItem[];
  readonly reason: RecallReason;
}

export interface PreferencePoolItem {
  readonly id: string;
  readonly revisionId: string;
  readonly contentHash: string;
  readonly content: string;
}

const fits = (used: number, item: string, limit: number): boolean =>
  used + countCodePoints(item) <= limit;

const selected = (
  item: RecallItem | PreferencePoolItem,
  order: number,
  reason: RecallReason,
): SelectedMemory => ({
  id: item.id,
  revisionId: item.revisionId,
  contentHash: item.contentHash,
  content: item.content,
  order,
  reason,
});

/**
 * 先装通用偏好小池（最多 2 条 / 600 code point），再按排序装相关记忆；
 * 跳过装不下的记录后继续尝试更短的记录，不先截 16 条再排除。
 * 偏好计入 16 条与 6,000 code point 总额，未用配额交还相关记忆。
 */
export const applyRecallBudget = (
  groups: readonly RecallGroup[],
  preferencePool: readonly PreferencePoolItem[] = [],
): BudgetSelection => {
  const items: SelectedMemory[] = [];
  let contentCodePoints = 0;
  let skippedForBudget = 0;

  let poolCount = 0;
  let poolCodePoints = 0;
  for (const candidate of preferencePool) {
    if (poolCount >= RECALL_BUDGET.preferencePoolMaxItems) break;
    if (items.length >= RECALL_BUDGET.maxItems) break;
    const length = countCodePoints(candidate.content);
    if (poolCodePoints + length > RECALL_BUDGET.preferencePoolMaxContentCodePoints) continue;
    if (!fits(contentCodePoints, candidate.content, RECALL_BUDGET.maxContentCodePoints)) continue;
    poolCount += 1;
    poolCodePoints += length;
    contentCodePoints += length;
    items.push(selected(candidate, items.length, 'preference-pool'));
  }

  for (const group of groups) {
    if (items.length + group.items.length > RECALL_BUDGET.maxItems) {
      skippedForBudget += group.items.length;
      continue;
    }
    const groupCodePoints = group.items.reduce(
      (total, item) => total + countCodePoints(item.content),
      0,
    );
    if (contentCodePoints + groupCodePoints > RECALL_BUDGET.maxContentCodePoints) {
      skippedForBudget += group.items.length;
      continue;
    }
    contentCodePoints += groupCodePoints;
    for (const item of group.items) {
      items.push(selected(item, items.length, group.reason));
    }
  }

  return { items, contentCodePoints, skippedForBudget };
};

/** 记录检索文本＝topicKey＋content（§6.1 第 5 条）。 */
export const recallRecordText = (item: {
  readonly content: string;
  readonly topicKey?: string | undefined;
}): string => (item.topicKey ? `${item.topicKey} ${item.content}` : item.content);

export const rankRecallItems = (
  query: readonly RecallToken[],
  items: readonly RecallItem[],
): RankedRecall[] => {
  const ranked: RankedRecall[] = [];
  for (const candidate of items) {
    const scored = scoreRecallRecord(query, recallRecordText(candidate));
    if (scored !== undefined) ranked.push({ ...candidate, score: scored.score });
  }
  return ranked.sort(
    (left, right) =>
      right.score - left.score ||
      scopeSpecificity(right.scope) - scopeSpecificity(left.scope) ||
      right.updatedAt - left.updatedAt ||
      compareIdsByteOrder(left.id, right.id),
  );
};
