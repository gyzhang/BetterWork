import { describe, expect, it } from 'vitest';

import {
  auditMaterialFacts,
  createMaterialFactLedger,
  recordMaterialFacts,
  validateAndRecordBusinessMetricFacts,
} from './material-fact-policy';

const ingestionBudgetMs = 200;
const ingestionHeapBudgetBytes = 16 * 1024 * 1024;
const auditBudgetMs = 500;
const factCount = 200;
const factFor = (index: number) => ({
  value: (index + 1) * 1.234567,
  unit: '元',
  period: '2026-09',
  sourceId: 'source-1',
});
const sourceText = Array.from(
  { length: factCount },
  (_unused, index) => `指标${index + 1} 2026-09：${factFor(index).value}元`,
).join('\n');
const inputFor = (start: number, end: number) => ({
  period: '2026-09',
  current: Object.fromEntries(
    Array.from({ length: end - start }, (_unused, offset) => {
      const index = start + offset;
      return [`指标${index + 1}`, factFor(index)];
    }),
  ),
});

describe('material fact policy scale', () => {
  it('stores a 200 fact source without expanding its numeric contents into combinations', () => {
    const ledger = createMaterialFactLedger({
      explicitBusinessAnalysis: true,
      materialScope: true,
      selectedMaterialCount: 1,
      prompt: '',
    });
    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    recordMaterialFacts(ledger, {
      kind: 'material-read',
      sourceId: 'source-1',
      content: sourceText,
    });
    validateAndRecordBusinessMetricFacts(ledger, inputFor(0, factCount));
    const elapsedMs = performance.now() - startedAt;
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;
    console.warn(
      `[material facts] facts=${factCount}; elapsed=${elapsedMs.toFixed(1)}ms; heapDelta=${heapDelta}; budget=${ingestionBudgetMs}ms/${ingestionHeapBudgetBytes}B`,
    );
    expect(ledger.sources.size).toBe(1);
    expect(ledger.facts).toHaveLength(factCount);
    expect(elapsedMs).toBeLessThan(ingestionBudgetMs);
    expect(heapDelta).toBeLessThan(ingestionHeapBudgetBytes);
  });

  it('audits 40 indexed source claims against 200 facts without pairwise derivation', () => {
    const ledger = createMaterialFactLedger({
      explicitBusinessAnalysis: true,
      materialScope: true,
      selectedMaterialCount: 1,
      prompt: '',
    });
    recordMaterialFacts(ledger, {
      kind: 'material-read',
      sourceId: 'source-1',
      content: sourceText,
    });
    validateAndRecordBusinessMetricFacts(ledger, inputFor(0, factCount));
    const output = Array.from(
      { length: 40 },
      (_unused, index) => `指标${index + 1} 2026-09：${factFor(index).value}元`,
    ).join('\n');
    const startedAt = performance.now();
    const error = auditMaterialFacts(ledger, output);
    const elapsedMs = performance.now() - startedAt;
    console.warn(
      `[material facts] facts=${factCount}; outputClaims=40; elapsed=${elapsedMs.toFixed(1)}ms; budget=${auditBudgetMs}ms`,
    );
    expect(error).toBeUndefined();
    expect(elapsedMs).toBeLessThan(auditBudgetMs);
  });
});
