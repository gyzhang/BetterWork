import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isAbortError } from '@betterwork/agent-core';
import {
  KNOWLEDGE_VECTOR_MAX_PUBLISHED,
  KNOWLEDGE_VECTOR_SCAN_BATCH_MAX_BYTES,
} from '@betterwork/agent-protocol';
import { afterAll, describe, expect, it } from 'vitest';

import {
  disposeHarness,
  expectAtLeastChunks,
  getHarness,
  unitVector,
} from './fixtures/knowledge-benchmark-harness';
import { KnowledgeServiceError } from './knowledge-errors';
import { KnowledgeWorkerRunner, resolveKnowledgeWorkerRuntime } from './knowledge-worker-runner';

/**
 * KM14 契约规模行为门禁（契约 §13.1/§13.3）：在 10,000×1,536 的真实向量库上验证
 * 中途取消以 abortError 收口、4,096 维与 1 MiB 批载荷上限可解释拒绝。
 * 这里**不断言耗时**——墙钟预算在 `knowledge-foundation.bench.test.ts`，
 * 由 `npm run bench` 串行跑（理由见 docs/12 §9）。
 */

const here = path.dirname(fileURLToPath(import.meta.url));

afterAll(async () => {
  await disposeHarness();
});

describe('KM14 契约规模行为（真实 Worker 扫描＋融合）', () => {
  it('派生块达到契约规模且不超过已发布上限', async () => {
    const harness = await getHarness();
    expectAtLeastChunks(harness.chunkTotal, 10_000);
    expect(harness.chunkTotal).toBeLessThanOrEqual(KNOWLEDGE_VECTOR_MAX_PUBLISHED);
    const result = await harness.service.search({
      scope: { kind: 'library' },
      query: '渠道转化',
      mode: 'hybrid',
    });
    expect(result.effectiveMode).toBe('hybrid');
    expect(result.coverage.indexedChunks).toBe(harness.chunkTotal);
    expect(result.results.length).toBeGreaterThan(0);
  }, 240_000);

  it('大批量扫描中途取消：abortError 收口，登记的子进程可被完整清理', async () => {
    const harness = await getHarness();
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 30);
    let caught: unknown;
    try {
      await harness.service.search({
        scope: { kind: 'library' },
        query: '渠道转化',
        mode: 'hybrid',
        signal: controller.signal,
      });
    } catch (error) {
      caught = error;
    } finally {
      clearTimeout(abortTimer);
    }
    expect(isAbortError(caught)).toBe(true);
    await harness.runner.shutdown();
    const pid = harness.runner.activePid('scan');
    expect(pid).toBeUndefined();
  }, 240_000);

  it('4,096 维上限：1 MiB 批载荷真实扫描可完成，超上限零启动可解释拒绝', async () => {
    const runner = new KnowledgeWorkerRunner({
      runtime: resolveKnowledgeWorkerRuntime(path.join(here, '../infrastructure')),
    });
    const dimension = 4_096;
    const perBatchMax = Math.floor(
      KNOWLEDGE_VECTOR_SCAN_BATCH_MAX_BYTES / (dimension * Float32Array.BYTES_PER_ELEMENT),
    );
    expect(perBatchMax).toBe(64);
    const prng = (() => {
      let state = 42;
      return () => {
        state = (state + 0x6d2b79f5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      };
    })();
    const makeEntries = (count: number) =>
      Array.from({ length: count }, (unused, index) => ({
        chunkId: `chunk-${index}`,
        vector: unitVector(prng, dimension),
      }));
    try {
      const scores = await runner.scan({
        spaceId: 'space-boundary',
        dimension,
        query: unitVector(prng, dimension),
        entries: makeEntries(perBatchMax),
      });
      // Worker 每批只回 top 50（全局 top 50 必在其并集内），64 条截到 50。
      expect(scores).toHaveLength(50);
      expect(scores.every((score) => Number.isFinite(score.score))).toBe(true);
      const pidBeforeRejection = runner.activePid('scan');
      const rejected = await runner
        .scan({
          spaceId: 'space-boundary',
          dimension,
          query: unitVector(prng, dimension),
          entries: makeEntries(perBatchMax + 1),
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(rejected).toBeInstanceOf(KnowledgeServiceError);
      if (rejected instanceof KnowledgeServiceError) {
        expect(rejected.code).toBe('WORKER_UNAVAILABLE');
      }
      expect(runner.activePid('scan')).toBe(pidBeforeRejection);
    } finally {
      await runner.shutdown();
    }
    expect(runner.activePid('scan')).toBeUndefined();
  }, 120_000);
});
