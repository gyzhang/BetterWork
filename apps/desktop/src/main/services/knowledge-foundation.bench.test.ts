import { afterAll, describe, expect, it } from 'vitest';

import {
  CHUNKS_PER_DOCUMENT,
  DIMENSION,
  disposeHarness,
  DOCUMENTS,
  expectAtLeastChunks,
  getHarness,
  P95_BUDGET_MS,
  RSS_BUDGET_BYTES,
  SAMPLE_RUNS,
  WARM_UP_RUNS,
  workerRssBytes,
} from './fixtures/knowledge-benchmark-harness';

/**
 * 计时基准档（`npm run bench`，串行）：这里**只放墙钟与内存预算断言**。
 * 同一份代码在 137 个文件并发跑时 p95 会漂到 1.5–5 倍，把它留在 `verify` 里
 * 等于给提交加随机红；改为独立串行档后，样本仍每次打印（docs/12 §9）。
 */

afterAll(async () => {
  await disposeHarness();
});

describe('KM14 契约规模基准（真实 Worker 扫描＋融合）', () => {
  it('10,000×1,536 warm p95 ≤ 1s 且 Worker 增量 RSS ≤ 256MiB', async () => {
    const harness = await getHarness();
    expectAtLeastChunks(harness.chunkTotal, DOCUMENTS * CHUNKS_PER_DOCUMENT);
    const started = Date.now();
    const warm = await harness.service.search({
      scope: { kind: 'library' },
      query: '渠道转化',
      mode: 'hybrid',
    });
    expect(warm.effectiveMode).toBe('hybrid');
    expect(warm.coverage.indexedChunks).toBe(harness.chunkTotal);
    const pid = harness.runner.activePid('scan');
    expect(pid).toBeTypeOf('number');
    const rssBefore = pid === undefined ? 0 : await workerRssBytes(pid);

    for (let run = 0; run < WARM_UP_RUNS; run += 1) {
      await harness.service.search({
        scope: { kind: 'library' },
        query: '渠道转化',
        mode: 'hybrid',
      });
    }
    const samples: number[] = [];
    for (let run = 0; run < SAMPLE_RUNS; run += 1) {
      const began = performance.now();
      const result = await harness.service.search({
        scope: { kind: 'library' },
        query: '渠道转化',
        mode: 'hybrid',
      });
      const elapsed = performance.now() - began;
      samples.push(elapsed);
      console.warn(`[KM14 sample ${run}] ${elapsed.toFixed(0)}ms`);
      expect(result.results.length).toBeGreaterThan(0);
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const p95 = sorted[Math.ceil(SAMPLE_RUNS * 0.95) - 1];
    if (p95 === undefined) throw new Error('样本缺失');
    const pidAfter = harness.runner.activePid('scan');
    const rssAfter = pidAfter === undefined ? rssBefore : await workerRssBytes(pidAfter);
    const rssDelta = rssAfter - rssBefore;
    const machine = `${process.platform} ${process.arch} node ${process.version}`;
    console.warn(
      `[KM14 benchmark] ${machine}; chunks=${harness.chunkTotal}; dim=${DIMENSION}; ` +
        `samples=${SAMPLE_RUNS}+${WARM_UP_RUNS} warm; p50=${(sorted[Math.floor(SAMPLE_RUNS / 2)] ?? 0).toFixed(1)}ms; ` +
        `p95=${p95.toFixed(1)}ms; max=${(sorted[SAMPLE_RUNS - 1] ?? 0).toFixed(1)}ms; ` +
        `workerPid=${pidAfter ?? 'unknown'}; rssDelta=${(rssDelta / 1024 / 1024).toFixed(1)}MiB; ` +
        `setup=${Date.now() - started}ms; httpExcluded=true`,
    );
    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
    expect(rssDelta).toBeLessThanOrEqual(RSS_BUDGET_BYTES);
  }, 240_000);
});
