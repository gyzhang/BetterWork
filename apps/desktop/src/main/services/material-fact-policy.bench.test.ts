import { describe, expect, it } from 'vitest';

import {
  auditMaterialFacts,
  createMaterialFactLedger,
  recordMaterialFacts,
} from './material-fact-policy';

// 首次独立测量：1,000 个数字采集约 1.2ms，200 数字/40 个输出查询约 66ms。
// 预算只住 bench，不将墙钟与堆内存波动放入功能门禁。
const ingestionBudgetMs = 200;
const ingestionHeapBudgetBytes = 16 * 1024 * 1024;
const auditBudgetMs = 500;

const materialText = (count: number): string =>
  Array.from({ length: count }, (_unused, index) => `指标${(index + 1) * 1.234567}`).join('；');

describe('material fact policy scale', () => {
  it('ingests 1,000 numeric values within the time and allocation budgets', () => {
    const content = materialText(1_000);
    const ledger = createMaterialFactLedger({
      materialScope: true,
      selectedMaterialCount: 1,
      prompt: '',
    });
    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    recordMaterialFacts(ledger, { kind: 'material-read', content });
    const elapsedMs = performance.now() - startedAt;
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;
    console.warn(
      `[material facts] ingest=1000; elapsed=${elapsedMs.toFixed(1)}ms; heapDelta=${heapDelta}; budget=${ingestionBudgetMs}ms/${ingestionHeapBudgetBytes}B`,
    );
    expect(ledger.rawNumbers.size).toBe(1_000);
    expect(elapsedMs).toBeLessThan(ingestionBudgetMs);
    expect(heapDelta).toBeLessThan(ingestionHeapBudgetBytes);
  });

  it('audits 40 unsupported output queries against 200 values in one bounded scan', () => {
    const ledger = createMaterialFactLedger({
      materialScope: true,
      selectedMaterialCount: 1,
      prompt: '',
    });
    recordMaterialFacts(ledger, { kind: 'material-read', content: materialText(200) });
    const output = Array.from(
      { length: 20 },
      (_unused, index) => `${100000 + index * 0.01}元；${100000 + index * 0.01}%`,
    ).join('；');
    const startedAt = performance.now();
    const error = auditMaterialFacts(ledger, output);
    const elapsedMs = performance.now() - startedAt;
    console.warn(
      `[material facts] auditValues=200; queries=40; elapsed=${elapsedMs.toFixed(1)}ms; budget=${auditBudgetMs}ms`,
    );
    expect(error).toContain('材料事实校验失败');
    expect(elapsedMs).toBeLessThan(auditBudgetMs);
  });
});
