import { describe, expect, it } from 'vitest';

import { expertWorkspaceScope, item, workspaceScope } from './fixtures/memory-recall-fixtures';
import { assembleRecallQuery, rankRecallItems, type RecallItem } from './memory-retrieval';

/** 计时基准档（`npm run bench`）：只断言排序墙钟，功能断言留在 `memory-retrieval.test.ts`。 */

const RANK_BUDGET_MS = 200;

// 设计 §16：规模压测只记录排序耗时，不引入向量库或后台扫描。
// 本机（darwin/arm64）实测 1,000 条约 10 ms，这里守住一个宽松上界防回归。
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
    console.warn(
      `[recall scale] items=${ranked.length}; elapsed=${elapsedMs.toFixed(1)}ms; ` +
        `budget=${RANK_BUDGET_MS}ms; machine=${process.platform} ${process.arch} node ${process.version}`,
    );
    expect(elapsedMs).toBeLessThan(RANK_BUDGET_MS);
  });
});
