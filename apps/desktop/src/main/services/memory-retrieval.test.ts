import {
  MEMORY_RECALL_HAN_STOP_BIGRAMS,
  MEMORY_RECALL_LATIN_STOP_WORDS,
  MEMORY_RECALL_VERSION,
} from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  applyRecallBudget,
  assembleRecallQuery,
  type PreferencePoolItem,
  rankRecallItems,
  RECALL_BUDGET,
  type RecallGroup,
  type RecallItem,
  scoreRecallRecord,
  tokenizeRecallText,
} from './memory-retrieval';

const userScope = { kind: 'user' } as const;
const workspaceScope = { kind: 'workspace', workspaceId: 'ws-1' } as const;
const expertScope = { kind: 'expert', expertId: 'ex-1' } as const;
const expertWorkspaceScope = {
  kind: 'expert-workspace',
  expertId: 'ex-1',
  workspaceId: 'ws-1',
} as const;

const item = (over: Partial<RecallItem> & { id: string; content: string }): RecallItem => ({
  revisionId: `rev-${over.id}`,
  contentHash: `hash-${over.id}`,
  kind: 'semantic',
  scope: workspaceScope,
  updatedAt: 1_000,
  ...over,
});

const tokenTexts = (value: string): string[] =>
  tokenizeRecallText(value).map((token) => token.text);

describe('memory-recall-v1 tokenization', () => {
  it('takes overlapping Han bigrams and drops the fixed stop bigrams', () => {
    const tokens = tokenTexts('收入按回款金额统计');
    expect(tokens).toContain('收入');
    expect(tokens).toContain('回款');
    expect(tokens).toContain('金额');
    for (const stop of MEMORY_RECALL_HAN_STOP_BIGRAMS) {
      expect(tokenTexts(`请帮我根据这个任务`)).not.toContain(stop);
    }
  });

  it('keeps letters, digits and internal separators as one latin token', () => {
    expect(tokenTexts('ARR不含一次性实施费，单位为万元')).toContain('arr');
    expect(tokenTexts('v1.2.3_build-x')).toContain('v1.2.3_build-x');
    for (const stop of MEMORY_RECALL_LATIN_STOP_WORDS) {
      expect(tokenTexts(`please ${stop} the report`)).not.toContain(stop);
    }
  });

  it('treats a single Han character query as a low weight character match', () => {
    const tokens = tokenizeRecallText('账');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.weight).toBe(1);
  });

  it('normalizes case and width without mutating counts of meaning characters', () => {
    expect(tokenTexts('ＡＲＲ')).toEqual(tokenTexts('arr'));
  });
});

describe('memory-recall-v1 scoring', () => {
  it('requires two matched tokens unless the query itself has one', () => {
    const query = tokenizeRecallText('收入 回款 金额');
    expect(scoreRecallRecord(query, '收入按回款金额统计')).toBeDefined();
    expect(scoreRecallRecord(query, '完全无关的句子')).toBeUndefined();
    expect(scoreRecallRecord(tokenizeRecallText('账'), '账期口径')).toBeDefined();
  });

  it('scores floor(1000 * matched weight / union weight)', () => {
    const query = tokenizeRecallText('回款 金额');
    const scored = scoreRecallRecord(query, '回款金额统计');
    expect(scored?.score).toBeGreaterThan(0);
    expect(scored?.score).toBeLessThanOrEqual(1000);
  });

  it('does not let a longer record win on volume alone', () => {
    const query = tokenizeRecallText('回款金额口径');
    const tight = scoreRecallRecord(query, '收入按回款金额统计');
    const loose = scoreRecallRecord(
      query,
      '本期续约率为82%，回款金额另行确认，另有若干无关说明文字'.slice(0, 20),
    );
    expect((tight?.score ?? 0) >= (loose?.score ?? 0)).toBe(true);
  });
});

describe('memory-recall-v1 query assembly', () => {
  it('truncates an over-long prompt to head plus tail and reports it', () => {
    const long = 'a'.repeat(2_500) + '中'.repeat(2_000) + 'b'.repeat(2_000);
    const assembled = assembleRecallQuery({ prompt: long });
    expect(assembled.truncated).toBe(true);
    const materialTitles = Array.from({ length: 14 }, (_, index) => `材料${index}`);
    const withMaterials = assembleRecallQuery({
      prompt: '收入口径',
      taskTitle: '经营分析',
      materialTitles,
    });
    expect(withMaterials.tokens.length).toBeGreaterThan(0);
  });

  it('caps each material title and the task title', () => {
    const assembled = assembleRecallQuery({
      prompt: '本期报告',
      taskTitle: '标'.repeat(500),
      materialTitles: ['题'.repeat(500)],
    });
    expect(assembled.truncated).toBe(true);
  });
});

describe('memory-recall-v1 ranking', () => {
  it('orders by score, then scope specificity, then updatedAt, then id byte order', () => {
    const query = tokenizeRecallText('回款金额统计');
    const ranked = rankRecallItems(query, [
      item({ id: 'u', content: '回款金额统计口径', scope: userScope, updatedAt: 9 }),
      item({ id: 'w', content: '回款金额统计口径', scope: workspaceScope, updatedAt: 9 }),
      item({ id: 'e', content: '回款金额统计口径', scope: expertScope, updatedAt: 9 }),
      item({ id: 'ew', content: '回款金额统计口径', scope: expertWorkspaceScope, updatedAt: 9 }),
    ]);
    expect(ranked.map((record) => record.id)).toEqual(['ew', 'w', 'e', 'u']);

    const byTime = rankRecallItems(query, [
      item({ id: 'old', content: '回款金额统计口径', updatedAt: 1 }),
      item({ id: 'new', content: '回款金额统计口径', updatedAt: 2 }),
    ]);
    expect(byTime.map((record) => record.id)).toEqual(['new', 'old']);

    const byId = rankRecallItems(query, [
      item({ id: 'b', content: '回款金额统计口径', updatedAt: 5 }),
      item({ id: 'a', content: '回款金额统计口径', updatedAt: 5 }),
    ]);
    expect(byId.map((record) => record.id)).toEqual(['a', 'b']);
  });

  it('returns nothing rather than backfilling with unrelated recent records', () => {
    const ranked = rankRecallItems(tokenizeRecallText('完全无关的查询词'), [
      item({ id: 'a', content: '收入按回款金额统计', updatedAt: 99 }),
      item({ id: 'b', content: '先列异常事项', updatedAt: 98 }),
    ]);
    expect(ranked).toEqual([]);
  });

  it('ranks on topicKey plus content', () => {
    const ranked = rankRecallItems(tokenizeRecallText('回款金额'), [
      item({ id: 'a', content: '统计方式已调整', topicKey: '回款金额口径' }),
    ]);
    expect(ranked).toHaveLength(1);
  });
});

describe('memory-recall-v1 budget', () => {
  const group = (items: RecallItem[]): RecallGroup => ({ items, reason: 'relevance' });

  it('caps items and content code points', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      item({ id: `m${index}`, content: `回款金额统计口径${index}` }),
    );
    const selection = applyRecallBudget([group(many)]);
    expect(selection.items.length).toBeLessThanOrEqual(RECALL_BUDGET.maxItems);
    expect(selection.contentCodePoints).toBeLessThanOrEqual(RECALL_BUDGET.maxContentCodePoints);
  });

  it('skips an oversized record and keeps trying shorter ones', () => {
    const oversized = item({ id: 'big', content: '回款金额'.repeat(1_600) });
    const short = item({ id: 'small', content: '回款金额统计' });
    const selection = applyRecallBudget([group([oversized]), group([short])]);
    expect(selection.items.map((record) => record.id)).toEqual(['small']);
    expect(selection.skippedForBudget).toBe(1);
  });

  it('takes a keep-both group whole or not at all', () => {
    const left = item({ id: 'l', content: '回款金额统计不含税' });
    const right = item({ id: 'r', content: '回款金额统计含税' });
    const selection = applyRecallBudget([
      group([left, right]),
      group([item({ id: 'tail', content: '回款金额'.repeat(1_500) })]),
    ]);
    const ids = selection.items.map((record) => record.id);
    expect(ids.includes('l') === ids.includes('r')).toBe(true);
    expect(selection.items.filter((record) => record.reason === 'relevance').length % 2).toBe(0);
  });

  it('limits the generic preference pool to two records and 600 code points', () => {
    const pool: PreferencePoolItem[] = [
      { id: 'p1', revisionId: 'r1', contentHash: 'h1', content: '先列异常事项' },
      { id: 'p2', revisionId: 'r2', contentHash: 'h2', content: '再列总体指标' },
      { id: 'p3', revisionId: 'r3', contentHash: 'h3', content: '第三条通用偏好' },
    ];
    const selection = applyRecallBudget([], pool);
    expect(selection.items.map((record) => record.id)).toEqual(['p1', 'p2']);
    expect(selection.items.every((record) => record.reason === 'preference-pool')).toBe(true);

    const oversizedPool: PreferencePoolItem[] = [
      { id: 'p1', revisionId: 'r1', contentHash: 'h1', content: '偏'.repeat(700) },
      { id: 'p2', revisionId: 'r2', contentHash: 'h2', content: '先列异常事项' },
    ];
    expect(applyRecallBudget([], oversizedPool).items.map((record) => record.id)).toEqual(['p2']);
  });

  it('counts emoji and other non-BMP content in code points', () => {
    const emojiText = '回款金额统计🎯🎯🎯';
    const selection = applyRecallBudget([group([item({ id: 'x', content: emojiText })])]);
    expect(selection.contentCodePoints).toBe(9);
    expect(emojiText.length).toBe(12);
  });

  it('keeps the pinned algorithm version and budgets', () => {
    expect(MEMORY_RECALL_VERSION).toBe('memory-recall-v1');
    expect(RECALL_BUDGET.maxItems).toBe(16);
    expect(RECALL_BUDGET.maxContentCodePoints).toBe(6_000);
    expect(RECALL_BUDGET.maxWrapperCodePoints).toBe(2_000);
    expect(RECALL_BUDGET.maxMemoryBlockCodePoints).toBe(8_000);
  });
});

// 设计 §16：规模压测只记录排序耗时，不引入向量库或后台扫描。
// 本机（darwin/arm64，Node 24）实测 1,000 条约 10 ms，这里守住一个宽松上界防回归。
describe('memory-recall-v1 scale', () => {
  it('ranks 1,000 active memories within the main-thread budget', () => {
    const items: RecallItem[] = Array.from({ length: 1_000 }, (_unused, index) =>
      item({
        id: `memory-${index}`,
        content: `第 ${index} 条口径：收入按回款金额统计，ARR 不含一次性实施费，单位为万元。`,
        topicKey: `收入口径-${index % 40}`,
        scope: index % 3 === 0 ? expertWorkspaceScope : workspaceScope,
        updatedAt: 1_000 + index,
      }),
    );
    const query = assembleRecallQuery({
      prompt: '请帮我把本期续约率和收入金额整理成月报，先列异常事项。',
      taskTitle: '经营分析月报',
      materialTitles: ['财务规则.md', '回款明细.csv'],
    }).tokens;

    rankRecallItems(query, items);
    const startedAt = performance.now();
    const ranked = rankRecallItems(query, items);
    const elapsedMs = performance.now() - startedAt;

    expect(ranked).toHaveLength(1_000);
    expect(ranked[0]?.scope.kind).toBe('expert-workspace');
    expect(rankRecallItems(query, items).map((entry) => entry.id)).toEqual(
      ranked.map((entry) => entry.id),
    );
    expect(elapsedMs).toBeLessThan(200);
  });
});
