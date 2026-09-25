import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { isAbortError } from '@betterwork/agent-core';
import type { EmbeddingModelSnapshot } from '@betterwork/agent-protocol';
import {
  KNOWLEDGE_VECTOR_MAX_PUBLISHED,
  KNOWLEDGE_VECTOR_SCAN_BATCH_MAX_BYTES,
} from '@betterwork/agent-protocol';
import { afterAll, describe, expect, it } from 'vitest';

import type { EmbeddingRequest, EmbeddingResult } from './embedding-client';
import { KnowledgeServiceError } from './knowledge-errors';
import { type EmbeddingRunner } from './knowledge-index-service';
import { KnowledgeSearchService } from './knowledge-search';
import { KnowledgeVault } from './knowledge-vault';
import { KnowledgeWorkerRunner, resolveKnowledgeWorkerRuntime } from './knowledge-worker-runner';

/**
 * KM14 契约规模基准（契约 §13.1/§13.3）：10,000 个 1,536 维向量、真实
 * `KnowledgeWorkerRunner` 子进程扫描＋RRF 融合，warm p95 ≤ 1 秒（20 个样本、
 * 排除 HTTP——查询嵌入是本地替身）；Worker 增量 RSS ≤ 256 MiB；
 * 大批量扫描中途取消以 abortError 收口且只清理已登记进程。
 */

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

const DIMENSION = 1_536;
const DOCUMENTS = 5;
const CHUNKS_PER_DOCUMENT = 2_000;
const WARM_UP_RUNS = 3;
const SAMPLE_RUNS = 20;
const P95_BUDGET_MS = 1_000;
const RSS_BUDGET_BYTES = 256 * 1024 * 1024;

const fingerprint = (seed: string): string => seed.repeat(2).slice(0, 64);
const modelFingerprint = fingerprint('perf');
const snapshot: EmbeddingModelSnapshot = {
  profileId: 'profile-perf',
  provider: 'openai-compatible',
  endpointFingerprint: fingerprint('e'),
  model: 'embed-perf',
  modelFingerprint,
};

/** 可复现的伪随机单位向量（mulberry32），绝不在基准里掺随机抖动。 */
const unitVector = (prng: () => number, dimension = DIMENSION): Float32Array => {
  const vector = Float32Array.from({ length: dimension }, () => prng() * 2 - 1);
  let norm = 0;
  for (const value of vector) norm += value * value;
  const scale = 1 / Math.sqrt(norm);
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index] ?? 0;
    vector[index] = value * scale;
  }
  return vector;
};

const workerRssBytes = async (pid: number): Promise<number> => {
  const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)]);
  const kib = Number.parseInt(stdout.trim(), 10);
  if (!Number.isFinite(kib)) throw new Error(`无法读取 Worker ${pid} 的 RSS`);
  return kib * 1024;
};

const embedStub: EmbeddingRunner = {
  defaultSnapshot: () => {
    throw new Error('基准固定 profile');
  },
  snapshotOf: () => snapshot,
  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const queryVector = unitVector(
      (() => {
        let state = 0x9e3779b9;
        return () => {
          state = (state + 0x6d2b79f5) | 0;
          let value = Math.imul(state ^ (state >>> 15), 1 | state);
          value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
          return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
      })(),
    );
    return {
      vectors: request.inputs.map(() => queryVector),
      dimension: DIMENSION,
    };
  },
};

interface BenchmarkHarness {
  readonly vault: KnowledgeVault;
  readonly service: KnowledgeSearchService;
  readonly runner: KnowledgeWorkerRunner;
  readonly chunkTotal: number;
  readonly dispose: () => Promise<void>;
}

const buildHarness = async (): Promise<BenchmarkHarness> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'betterwork-km14-perf-'));
  const vault = new KnowledgeVault(':memory:');
  const runner = new KnowledgeWorkerRunner({
    runtime: resolveKnowledgeWorkerRuntime(path.join(here, '../infrastructure')),
  });
  const service = new KnowledgeSearchService({
    vault,
    index: vault.index,
    runMaterials: () => [],
    embedding: embedStub,
    scan: (request) => runner.scan(request),
  });
  vault.index.saveSettings({
    expectedRevision: vault.index.settings().revision,
    semanticEnabled: true,
    embeddingProfileId: 'profile-perf',
  });

  const revisionIds: string[] = [];
  const documentIds: string[] = [];
  for (let document = 0; document < DOCUMENTS; document += 1) {
    // 每段 ~940 码点：2,000 段约 1.88M，低于单节 2M 上限（§2.3），
    // 900 码点步长稳定长出 ≥2,000 个派生块。
    const parts: string[] = [];
    for (let chunk = 0; chunk < CHUNKS_PER_DOCUMENT; chunk += 1) {
      parts.push(`文档${document}块${chunk}：` + '渠道转化与续约风险复盘纪要。'.repeat(66));
    }
    const sourcePath = path.join(directory, `material-${document}.md`);
    await writeFile(sourcePath, parts.join('\n'));
    await vault.importPaths([sourcePath]);
    const listed = vault.listDocuments().find((entry) => entry.sourcePath === sourcePath);
    if (!listed) throw new Error(`基准文档缺失: ${document}`);
    const revision = vault.listRevisions(listed.id)[0];
    if (!revision) throw new Error(`基准修订缺失: ${document}`);
    documentIds.push(listed.id);
    revisionIds.push(revision.id);
  }

  const index = vault.index;
  const space = index.ensureCurrentSpace(modelFingerprint);
  if (index.lockDimension(space.id, DIMENSION) === 'conflict') {
    throw new Error('基准维度与既有空间冲突');
  }
  let seeded = 0;
  for (const [ordinal, revisionId] of revisionIds.entries()) {
    const chunks = index.retrievalChunks(revisionId);
    if (chunks.length === 0) throw new Error('派生块缺失');
    const prngState = { value: 0x1000193 * (ordinal + 1) };
    const prng = (): number => {
      prngState.value = Math.imul(prngState.value ^ (prngState.value >>> 11), 0x811c9dc5) >>> 0;
      return prngState.value / 4294967296;
    };
    const generation = index.createStagingGeneration({
      revisionId,
      textHash: chunks[0]?.textHash ?? '',
      spaceId: space.id,
      modelSnapshot: snapshot,
      chunkingVersion: chunks[0]?.chunkingVersion ?? '',
      chunkCount: chunks.length,
    });
    index.addStagingVectors(
      generation.id,
      chunks.map((chunk) => ({
        chunkId: chunk.id,
        chunkHash: chunk.contentHash,
        vector: unitVector(prng),
      })),
    );
    index.publishGeneration({
      generationId: generation.id,
      expect: {
        revisionId,
        textHash: chunks[0]?.textHash ?? '',
        spaceId: space.id,
        modelFingerprint,
        dimension: DIMENSION,
        chunkingVersion: chunks[0]?.chunkingVersion ?? '',
        registeredRevisionId: vault.registeredRevisionId(documentIds[ordinal] ?? '') ?? revisionId,
      },
    });
    seeded += chunks.length;
  }
  return {
    vault,
    service,
    runner,
    chunkTotal: seeded,
    dispose: async () => {
      await runner.shutdown();
      vault.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
};

const expectAtLeast = (value: number, minimum: number): void => {
  if (value < minimum) throw new Error(`派生块数量异常: ${value}`);
};

let harnessPromise: Promise<BenchmarkHarness> | undefined;
const getHarness = (): Promise<BenchmarkHarness> =>
  (harnessPromise ??= buildHarness().catch((error: unknown) => {
    harnessPromise = undefined;
    throw error;
  }));

afterAll(async () => {
  if (harnessPromise) {
    const harness = await harnessPromise.catch(() => undefined);
    await harness?.dispose();
  }
});

describe('KM14 契约规模基准（真实 Worker 扫描＋融合）', () => {
  it('10,000×1,536 warm p95 ≤ 1s 且 Worker 增量 RSS ≤ 256MiB', async () => {
    const harness = await getHarness();
    // 派生块按 900 码点步长出，允许略多于标称规模，绝不少于契约规模。
    expectAtLeast(harness.chunkTotal, DOCUMENTS * CHUNKS_PER_DOCUMENT);
    expect(harness.chunkTotal).toBeLessThanOrEqual(KNOWLEDGE_VECTOR_MAX_PUBLISHED);
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
