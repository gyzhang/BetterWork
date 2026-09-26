import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type {
  KnowledgeJobDetail,
  KnowledgeSearchResponse,
  ModelProfileSummary,
} from '@betterwork/agent-protocol';
import { z } from 'zod';

import {
  EmbeddingClient,
  type EmbeddingProfileSource,
} from '../apps/desktop/src/main/services/embedding-client';
import { KnowledgeIndexService } from '../apps/desktop/src/main/services/knowledge-index-service';
import { KnowledgeSearchService } from '../apps/desktop/src/main/services/knowledge-search';
import { KnowledgeVault } from '../apps/desktop/src/main/services/knowledge-vault';
import {
  KnowledgeWorkerRunner,
  type KnowledgeWorkerRuntime,
} from '../apps/desktop/src/main/services/knowledge-worker-runner';

/**
 * KM15 §12 语义验收探针（执行载体 B）。
 *
 * 它不另算一套：起的是生产侧同一条管线——受管提取 Worker、FTS5 关键词路、真实
 * `/embeddings` 调用、RRF 融合、向量扫描 Worker。题集来自已冻结的
 * `docs/development/fixtures/km15-semantics/questions.json`，逐题跑「混合列」与
 * 「关键词基线列」，输出可直接回填验收表的 markdown。
 *
 * 凭据边界：本机模型 Key 存在 Electron `safeStorage`（macOS 钥匙串）里，非 Electron
 * 进程解不出来，因此脚本不读、也不问存储的凭据；endpoint／模型名／Key 由启动者用
 * `KM15_EMBED_BASE_URL`／`KM15_EMBED_MODEL`／`KM15_EMBED_API_KEY` 传入，Key 只进请求头，
 * 不打印也不落盘。三者缺任一即只跑关键词基线列。
 *
 * 隔离：默认在 /tmp 新建一次性 Vault 并导入本目录的合成资料，不碰正式资料库。
 */

const questionFileSchema = z.object({
  questions: z
    .array(
      z
        .object({ id: z.string().min(1), query: z.string().min(1), expect: z.string().min(1) })
        .strict(),
    )
    .min(1),
});

type Question = z.infer<typeof questionFileSchema>['questions'][number];

interface ColumnEntry {
  id: string;
  expect: string;
  response: KnowledgeSearchResponse;
}

/** `no-console` 只留 warn/error：探针的正常输出走 stdout，便于重定向成结果表。 */
const emit = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

// 打包后为 CJS（exceljs 等依赖里有动态 require），因此 `import.meta.url` 不可用：
// 探针按「在仓库根目录启动」取路径，与 `node scripts/office-input-probe.mjs` 同一口径。
const repositoryRoot = process.cwd();
const corpusDirectory = path.join(repositoryRoot, 'docs/development/fixtures/km15-semantics');
const vaultPath = process.env.KM15_VAULT_PATH ?? '/tmp/km15-semantics-vault.sqlite';
const workerScript =
  process.env.KM15_WORKER_SCRIPT ??
  path.join(repositoryRoot, 'apps/desktop/out/main/knowledge-worker.js');
const resultFile = process.env.KM15_RESULT_FILE ?? '/tmp/km15-semantic-results.md';
const baseUrl = process.env.KM15_EMBED_BASE_URL ?? '';
const model = process.env.KM15_EMBED_MODEL ?? '';
const apiKey = process.env.KM15_EMBED_API_KEY ?? '';
const profileId = 'km15-probe-profile';

/** 资料编码＝合成文件名前缀（K01…K10），用来把命中对回标注。 */
const codeOf = (value: string): string => {
  const name = path.basename(value);
  const separator = name.indexOf('-');
  return separator > 0 ? name.slice(0, separator) : name;
};

const corpusSources = (codes: readonly string[]): string[] => {
  const files = readdirSync(corpusDirectory).filter((name) => name.endsWith('.md'));
  return codes
    .map((code) => files.find((name) => codeOf(name) === code))
    .filter((name): name is string => name !== undefined)
    .map((name) => path.join(corpusDirectory, name));
};

const profileSource = (): EmbeddingProfileSource => {
  const profile: ModelProfileSummary & { apiKey: string } = {
    id: profileId,
    name: 'KM15 探针（真实向量模型）',
    provider: 'openai-compatible',
    baseUrl,
    model,
    role: 'embedding',
    apiKeyConfigured: true,
    enabled: true,
    priority: 0,
    connectionStatus: 'connected',
    maxContextTokens: 8192,
    maxOutputTokens: 1024,
    temperature: 0,
    createdAt: 0,
    updatedAt: 0,
    apiKey,
  };
  return {
    getWithSecret: (id: string) => (id === profile.id ? profile : undefined),
    getDefaultProfileId: (role: 'embedding') => (role === 'embedding' ? profile.id : undefined),
  };
};

const describeJob = (detail: KnowledgeJobDetail | undefined): string => {
  if (!detail) return '作业不可回看';
  const unfinished = detail.items
    .filter((item) => item.status !== 'succeeded')
    .map(
      (item) =>
        `${codeOf(item.fileName ?? item.documentId ?? '?')}:${item.status}${
          item.failure ? `（${item.failure.message}）` : ''
        }`,
    );
  return `${detail.job.kind} ${detail.job.status} ${detail.job.completedCount}/${detail.job.totalCount}${
    unfinished.length > 0 ? `｜未完成 ${unfinished.join('、')}` : ''
  }${detail.job.failure ? `｜${detail.job.failure.message}` : ''}`;
};

const runColumn = async (
  search: KnowledgeSearchService,
  questions: readonly Question[],
  mode: 'hybrid' | 'keyword',
): Promise<ColumnEntry[]> => {
  const entries: ColumnEntry[] = [];
  for (const question of questions) {
    const response = await search.search({
      scope: { kind: 'library' },
      query: question.query,
      mode,
      limit: 50,
    });
    entries.push({ id: question.id, expect: question.expect, response });
  }
  return entries;
};

const topCodes = (response: KnowledgeSearchResponse): string[] =>
  response.results.slice(0, 5).map((hit) => codeOf(hit.reference.sourcePath));

const renderTable = (
  questions: readonly Question[],
  hybrid: readonly ColumnEntry[],
  keyword: readonly ColumnEntry[],
  hasHybrid: boolean,
): string => {
  let hybridHits = 0;
  let keywordHits = 0;
  const rows = questions.map((question) => {
    const hybridEntry = hybrid.find((entry) => entry.id === question.id);
    const keywordEntry = keyword.find((entry) => entry.id === question.id);
    const hybridTop = hybridEntry ? topCodes(hybridEntry.response) : [];
    const keywordTop = keywordEntry ? topCodes(keywordEntry.response) : [];
    const hybridHit = hybridTop.includes(question.expect);
    const keywordHit = keywordTop.includes(question.expect);
    if (hybridHit) hybridHits += 1;
    if (keywordHit) keywordHits += 1;
    return `| ${question.id} | ${question.expect} | ${hybridTop.join('、') || '—'} | ${
      hasHybrid ? (hybridHit ? '命中' : '未命中') : '—'
    } | ${hybridEntry?.response.durationMs ?? 0} | ${
      hybridEntry?.response.degradedReason ?? '—'
    } | ${keywordTop.join('、') || '—'} | ${keywordHit ? '命中' : '未命中'} | ${
      keywordEntry?.response.durationMs ?? 0
    } |`;
  });
  const coverage = hybrid[0]?.response.coverage;
  const summary = hasHybrid
    ? `混合列命中 **${hybridHits}/${questions.length}**（过栏线 16/20）；关键词基线命中 ${keywordHits}/${questions.length}。${
        coverage ? `向量覆盖 ${coverage.indexedChunks}/${coverage.eligibleChunks} 块。` : ''
      }`
    : `未提供向量模型参数，只跑关键词基线列：命中 ${keywordHits}/${questions.length}。`;
  return [
    '# KM15 §12 语义验收结果（探针载体 B）',
    '',
    summary,
    '',
    '| # | 标注 | 混合前 5 | 混合判定 | 混合 ms | 混合降级 | 关键词前 5 | 关键词判定 | 关键词 ms |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
};

const main = async (): Promise<void> => {
  if (!existsSync(path.join(corpusDirectory, 'questions.json'))) {
    throw new Error(
      `请在仓库根目录启动探针：找不到 ${path.join(corpusDirectory, 'questions.json')}`,
    );
  }
  const questions = questionFileSchema.parse(
    JSON.parse(readFileSync(path.join(corpusDirectory, 'questions.json'), 'utf8')) as unknown,
  ).questions;
  const codes = [...new Set(questions.map((question) => question.expect))].sort();
  const sourcePaths = corpusSources(codes);
  if (sourcePaths.length !== codes.length) {
    throw new Error(`语料不齐：标注需要 ${codes.join('、')}，实际找到 ${sourcePaths.length} 份`);
  }
  if (!existsSync(workerScript)) {
    throw new Error(`提取 Worker 入口不存在：${workerScript}（先跑 npm run build）`);
  }

  rmSync(vaultPath, { force: true });
  mkdirSync(path.dirname(vaultPath), { recursive: true });

  const runtime: KnowledgeWorkerRuntime = {
    executable: process.execPath,
    scriptPath: workerScript,
    env: process.env,
  };
  const worker = new KnowledgeWorkerRunner({ runtime });
  const vault = new KnowledgeVault(vaultPath, { extractor: worker.extractor });
  const embedding = new EmbeddingClient({ models: profileSource() });
  const indexService = new KnowledgeIndexService({
    vault,
    embedding,
    onJobCancel: (jobId: string) => worker.cancelJob(jobId),
  });

  emit(`导入 ${sourcePaths.length} 份合成资料 → ${vaultPath}`);
  const importAck = indexService.startImport(sourcePaths);
  await indexService.settled();
  emit(`导入作业：${describeJob(indexService.jobDetail(importAck.jobId))}`);

  const hasModel = baseUrl !== '' && model !== '' && apiKey !== '';
  const search = new KnowledgeSearchService({
    vault,
    index: vault.index,
    runMaterials: () => [],
    embedding,
    scan: (request) => worker.scan(request),
  });

  let hybrid: ColumnEntry[] = [];
  if (hasModel) {
    const settings = indexService.getSettings();
    indexService.saveSettings({
      expectedRevision: settings.revision,
      semanticEnabled: true,
      embeddingProfileId: profileId,
    });
    const rebuildAck = indexService.startRebuildSemantic({ kind: 'semantic' });
    await indexService.settled();
    emit(`向量重建作业：${describeJob(indexService.jobDetail(rebuildAck.jobId))}`);
    hybrid = await runColumn(search, questions, 'hybrid');
  } else {
    emit('未提供 KM15_EMBED_BASE_URL／KM15_EMBED_MODEL／KM15_EMBED_API_KEY：只跑关键词基线列。');
  }
  const keyword = await runColumn(search, questions, 'keyword');

  const table = renderTable(questions, hybrid, keyword, hasModel);
  writeFileSync(resultFile, table, 'utf8');
  emit(`结果表：${resultFile}`);
  emit(table);
  await worker.shutdown();
};

main().catch((error: unknown) => {
  console.error('探针失败', error);
  process.exitCode = 1;
});
