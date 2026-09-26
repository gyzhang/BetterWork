import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { EmbeddingModelSnapshot } from '@betterwork/agent-protocol';

import type { EmbeddingRequest, EmbeddingResult } from '../embedding-client';
import type { EmbeddingRunner } from '../knowledge-index-service';
import { KnowledgeSearchService } from '../knowledge-search';
import { KnowledgeVault } from '../knowledge-vault';
import { KnowledgeWorkerRunner, resolveKnowledgeWorkerRuntime } from '../knowledge-worker-runner';

/**
 * KM14 规模夹具：契约 §13.1/§13.3 的 10,000×1,536 向量库，供功能用例（取消、
 * 维度上限）与计时基准用例（`*.bench.test.ts`）共用，避免两份实现漂移。
 */

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

export const DIMENSION = 1_536;
export const DOCUMENTS = 5;
export const CHUNKS_PER_DOCUMENT = 2_000;
export const WARM_UP_RUNS = 3;
export const SAMPLE_RUNS = 20;
export const P95_BUDGET_MS = 1_000;
export const RSS_BUDGET_BYTES = 256 * 1024 * 1024;

const fingerprint = (seed: string): string => seed.repeat(2).slice(0, 64);
export const modelFingerprint = fingerprint('perf');
export const snapshot: EmbeddingModelSnapshot = {
  profileId: 'profile-perf',
  provider: 'openai-compatible',
  endpointFingerprint: fingerprint('e'),
  model: 'embed-perf',
  modelFingerprint,
};

/** 可复现的伪随机单位向量（mulberry32），绝不在基准里掺随机抖动。 */
export const unitVector = (prng: () => number, dimension = DIMENSION): Float32Array => {
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

export const workerRssBytes = async (pid: number): Promise<number> => {
  const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)]);
  const kib = Number.parseInt(stdout.trim(), 10);
  if (!Number.isFinite(kib)) throw new Error(`无法读取 Worker ${pid} 的 RSS`);
  return kib * 1024;
};

export const embedStub: EmbeddingRunner = {
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

export interface BenchmarkHarness {
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
    runtime: resolveKnowledgeWorkerRuntime(path.join(here, '../../infrastructure')),
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

/** 派生块按 900 码点步长出，允许略多于标称规模，绝不少于契约规模。 */
export const expectAtLeastChunks = (value: number, minimum: number): void => {
  if (value < minimum) throw new Error(`派生块数量异常: ${value}`);
};

let harnessPromise: Promise<BenchmarkHarness> | undefined;

/** 夹具建一次约 25–40 秒，两个用例文件共用；用完必须显式释放子进程与临时目录。 */
export const getHarness = (): Promise<BenchmarkHarness> =>
  (harnessPromise ??= buildHarness().catch((error: unknown) => {
    harnessPromise = undefined;
    throw error;
  }));

export const disposeHarness = async (): Promise<void> => {
  if (!harnessPromise) return;
  const pending = harnessPromise;
  harnessPromise = undefined;
  const harness = await pending.catch(() => undefined);
  await harness?.dispose();
};
