import { randomUUID } from 'node:crypto';

import type { ModelProvider, ModelRequest, ModelStreamChunk } from '@betterwork/agent-core';
import { abortError } from '@betterwork/agent-core';
import type {
  MaterialReference,
  MemoryDependency,
  MemoryProvenance,
  MemoryRecord,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openAppDatabase } from '../db';
import { CredentialError } from '../persistence/credential-repository';
import { MemoryExtractionRepository } from '../persistence/memory-extraction-repository';
import { MemoryOperationRepository } from '../persistence/memory-operation-repository';
import { MemoryRepository } from '../persistence/memory-repository';
import { RunRepository } from '../persistence/run-repository';
import { TaskRepository } from '../persistence/task-repository';
import { WorkspaceRepository } from '../persistence/workspace-repository';
import { memoryContentHash, normalizedMemoryHash } from './memory-content-policy';
import {
  type ExtractionModelResolver,
  type ExtractionRunSourceRecord,
  type ExtractionSourceRecord,
  MEMORY_SUGGESTION_CONSENT_VERSION,
  MemoryExtractionService,
} from './memory-extraction-service';
import { buildUserInstructionProvenance, memoryDependencyOf } from './memory-provenance';
import { ModelFactoryError } from './model-provider-factory';

const RUN_ID = 'run-source-1';

/** 假 Provider 的行为脚本，仅测试内部使用。 */
type ProviderBehaviour =
  | { readonly kind: 'chunks'; readonly chunks: readonly ModelStreamChunk[] }
  | { readonly kind: 'hang'; readonly prefixChunks?: readonly ModelStreamChunk[] }
  | {
      readonly kind: 'throw';
      readonly error: unknown;
      readonly beforeChunks?: readonly ModelStreamChunk[];
    };

const PROMPT = '从本季度起，所有收入口径统一使用万元，不再使用百万';
const EVIDENCE_SLICE = [...PROMPT].slice(0, 8).join('');
const EVIDENCE_END = [...EVIDENCE_SLICE].length;
const CANDIDATE_CONTENT = '收入口径统一使用万元';
const FEEDBACK = '以后大纲先给结论再展开论述';
const SUMMARY = '上一轮结论已经按金字塔结构展开。';

const validOutput = (content = CANDIDATE_CONTENT): string =>
  JSON.stringify({
    candidates: [
      {
        content,
        facet: 'constraint',
        topicKey: '统计口径',
        confidence: 0.8,
        evidence: [{ fragmentId: 'f1', start: 0, end: EVIDENCE_END }],
      },
    ],
  });

const stopChunks = (raw: string): ModelStreamChunk[] => [
  { type: 'text-delta', delta: raw },
  {
    type: 'done',
    finishReason: 'stop',
    usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
  },
];

interface Harness {
  readonly db: Database.Database;
  readonly service: MemoryExtractionService;
  readonly jobs: MemoryExtractionRepository;
  readonly memories: MemoryRepository;
  readonly records: Map<string, ExtractionSourceRecord>;
  readonly workspaceId: string;
  readonly taskId: string;
  readonly streamCalls: { count: number };
  readonly resolveCalls: { count: number };
  readonly setBehaviour: (behaviour: ProviderBehaviour) => void;
  readonly runRecord: (
    overrides?: Partial<Omit<ExtractionRunSourceRecord, 'kind'>>,
  ) => ExtractionRunSourceRecord;
  readonly putRunRecord: (
    overrides?: Partial<Omit<ExtractionRunSourceRecord, 'kind'>>,
  ) => ExtractionRunSourceRecord;
}

const openedDatabases: Database.Database[] = [];

const makeFixture = (
  options: {
    behaviour?: ProviderBehaviour;
    fingerprint?: string;
    resolverFailure?: 'unavailable' | 'credential';
    timeoutMs?: number;
    knownSecrets?: readonly string[];
  } = {},
): Harness => {
  const db = openAppDatabase(':memory:');
  openedDatabases.push(db);
  const workspace = new WorkspaceRepository(db).getOrCreate(
    `/tmp/bw-extract-test-${randomUUID()}`,
    '提炼测试空间',
  );
  const task = new TaskRepository(db).create(workspace.id, '季度收入分析', '产出报告');
  const runs = new RunRepository(db);
  runs.create({
    id: RUN_ID,
    taskId: task.task.id,
    sessionId: task.sessionId,
    prompt: '占位提示词',
    status: 'completed',
    createdAt: 1,
    completedAt: 2,
  });
  const jobs = new MemoryExtractionRepository(db);
  const memories = new MemoryRepository(db);
  const records = new Map<string, ExtractionSourceRecord>();
  const streamCalls = { count: 0 };
  const resolveCalls = { count: 0 };
  let behaviour: ProviderBehaviour = options.behaviour ?? { kind: 'chunks', chunks: [] };

  const provider: ModelProvider = {
    id: 'test-extraction-provider',
    async *stream(request: ModelRequest): AsyncGenerator<ModelStreamChunk, void, void> {
      streamCalls.count += 1;
      if (behaviour.kind === 'chunks') {
        for (const chunk of behaviour.chunks) {
          if (request.signal.aborted) return;
          yield chunk;
        }
        return;
      }
      if (behaviour.kind === 'throw') {
        for (const chunk of behaviour.beforeChunks ?? []) yield chunk;
        throw behaviour.error;
      }
      for (const chunk of behaviour.prefixChunks ?? []) {
        if (request.signal.aborted) return;
        yield chunk;
      }
      await untilAbort(request.signal);
    },
  };

  const modelFactory: ExtractionModelResolver = {
    async requireConfiguredLanguageModel() {
      resolveCalls.count += 1;
      if (options.resolverFailure === 'unavailable') {
        throw new ModelFactoryError('MODEL_UNAVAILABLE', '未配置可用的语言模型。');
      }
      if (options.resolverFailure === 'credential') {
        throw new CredentialError('credential_migration_required', '凭据尚未迁移。');
      }
      return {
        provider,
        profileId: 'mp-1',
        displayName: '测试模型',
        fingerprint: options.fingerprint ?? 'fp-1',
        endpointDisplay: 'https://api.test.example/v1',
      };
    },
  };

  const service = new MemoryExtractionService({
    jobs,
    memories,
    operations: new MemoryOperationRepository(db),
    transaction: <TBody>(body: () => TBody): TBody => db.transaction(body)(),
    sources: {
      readSource: (source) =>
        records.get(source.kind === 'run' ? source.runId : source.checkpointId),
    },
    modelFactory,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.knownSecrets === undefined
      ? {}
      : { knownSecrets: (): readonly string[] => options.knownSecrets ?? [] }),
  });

  const runRecord = (
    overrides: Partial<Omit<ExtractionRunSourceRecord, 'kind'>> = {},
  ): ExtractionRunSourceRecord => ({
    kind: 'run',
    runId: RUN_ID,
    taskId: task.task.id,
    workspaceId: workspace.id,
    completed: true,
    prompt: PROMPT,
    modelProfileId: 'mp-1',
    materialDependencies: [materialRef('doc-a'), materialRef('doc-b')],
    memoryDependencies: [],
    ...overrides,
  });
  const putRunRecord = (
    overrides: Partial<Omit<ExtractionRunSourceRecord, 'kind'>> = {},
  ): ExtractionRunSourceRecord => {
    const record = runRecord(overrides);
    records.set(RUN_ID, record);
    return record;
  };

  return {
    db,
    service,
    jobs,
    memories,
    records,
    workspaceId: workspace.id,
    taskId: task.task.id,
    streamCalls,
    resolveCalls,
    setBehaviour: (next) => {
      behaviour = next;
    },
    runRecord,
    putRunRecord,
  };
};

const materialRef = (id: string): MaterialReference => ({
  kind: 'knowledge-revision',
  knowledgeDocumentId: id,
  knowledgeRevisionId: `${id}-rev`,
  contentHash: memoryContentHash(id),
  sourcePath: `/docs/${id}.md`,
});

const untilAbort = (signal: AbortSignal): Promise<never> =>
  new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });

const waitFor = async (predicate: () => boolean, message: string): Promise<void> => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 2_000) throw new Error(`等待条件超时：${message}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const enableAutoSuggest = async (harness: Harness): Promise<void> => {
  const result = await harness.service.setSettings({
    operationId: randomUUID(),
    workspaceId: harness.workspaceId,
    expectedRevision: 0,
    autoSuggestEnabled: true,
    consentVersion: MEMORY_SUGGESTION_CONSENT_VERSION,
  });
  expect(result.ok).toBe(true);
};

/** 直接以仓储登记一条 queued 作业，用于绕开自动触发路径的状态机用例。 */
const seedQueuedJob = (
  harness: Harness,
  overrides: {
    runId?: string;
    sourceVersionHash?: string;
    memoryDependencies?: readonly MemoryDependency[];
    consentRevision?: number;
    modelProfileId?: string;
    modelSnapshot?: Record<string, unknown>;
    fragmentText?: string;
  } = {},
): string => {
  const runId = overrides.runId ?? RUN_ID;
  if (runId !== RUN_ID) {
    harness.db
      .prepare(
        `INSERT INTO runs (id, task_id, session_id, prompt, status, created_at, completed_at)
         VALUES (?, ?, (SELECT id FROM sessions WHERE task_id = ?), ?, 'completed', 1, 2)`,
      )
      .run(runId, harness.taskId, harness.taskId, '占位');
  }
  const outcome = harness.jobs.enqueue({
    source: { kind: 'run', runId },
    workspaceId: harness.workspaceId,
    taskId: harness.taskId,
    fragments: [
      {
        fragmentId: 'f1',
        role: 'run-prompt',
        text: overrides.fragmentText ?? PROMPT,
        partial: false,
      },
    ],
    sourceVersionHash: overrides.sourceVersionHash ?? 'a'.repeat(64),
    trigger: 'automatic',
    inputCodePoints: 40,
    ...(overrides.consentRevision === undefined
      ? {}
      : { consentRevision: overrides.consentRevision }),
    ...(overrides.modelProfileId === undefined ? {} : { modelProfileId: overrides.modelProfileId }),
    ...(overrides.modelSnapshot === undefined ? {} : { modelSnapshot: overrides.modelSnapshot }),
    ...(overrides.memoryDependencies === undefined
      ? {}
      : { memoryDependencies: overrides.memoryDependencies }),
  });
  return outcome.job.id;
};

/** 与服务的 sourceVersionHashOf 同构，用于构造「来源正文已变化」场景。 */
const versionHashForPrompt = (prompt: string, runId = RUN_ID): string =>
  memoryContentHash(['run', runId, memoryContentHash(prompt), '-'].join('|'));

const seedMemory = (harness: Harness, content: string): MemoryRecord =>
  harness.memories.create({
    facet: 'preference',
    scope: { kind: 'workspace', workspaceId: harness.workspaceId },
    content,
    normalizedHash: normalizedMemoryHash(content),
    provenance: buildUserInstructionProvenance({
      capturedAt: 1,
      operationId: randomUUID(),
      content,
    }),
    confidence: 1,
    status: 'confirmed',
  }).record;

const seedCandidate = (
  harness: Harness,
  content: string,
  disposition: 'pending' | 'rejected',
): MemoryRecord =>
  harness.memories.create({
    facet: 'constraint',
    scope: { kind: 'workspace', workspaceId: harness.workspaceId },
    content,
    normalizedHash: normalizedMemoryHash(content),
    provenance: buildUserInstructionProvenance({
      capturedAt: 1,
      operationId: randomUUID(),
      content,
    }),
    confidence: 0.9,
    status: 'candidate',
    candidateDisposition: disposition,
  }).record;

/**
 * 生产写入路径产不出相互引用的环（新修订只能引用已存在的修订），
 * 因此这里直接改写 memory_records.provenance_json 造出对抗状态，不在生产代码里开测试后门。
 */
const forgeDependencyCycle = (harness: Harness, left: MemoryRecord, right: MemoryRecord): void => {
  const pointTo = (revisionId: string, target: MemoryRecord): void => {
    const row = harness.db
      .prepare('SELECT provenance_json FROM memory_records WHERE revision_id = ?')
      .get(revisionId) as { provenance_json: string } | undefined;
    if (!row) throw new Error(`缺少修订 ${revisionId}`);
    const provenance = JSON.parse(row.provenance_json) as MemoryProvenance;
    harness.db
      .prepare('UPDATE memory_records SET provenance_json = ? WHERE revision_id = ?')
      .run(
        JSON.stringify({ ...provenance, memoryDependencies: [memoryDependencyOf(target)] }),
        revisionId,
      );
  };
  pointTo(left.revisionId, right);
  pointTo(right.revisionId, left);
};

afterEach(() => {
  for (const db of openedDatabases.splice(0)) {
    db.close();
  }
});

describe('MemoryExtractionService 设置（WM09 §7.3）', () => {
  it('默认关闭且 revision 为 0，缺省绝不触发自动入队', async () => {
    const harness = makeFixture();
    const result = await harness.service.getSettings({ workspaceId: harness.workspaceId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.revision).toBe(0);
    expect(result.data.autoSuggestEnabled).toBe(false);

    harness.putRunRecord();
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    expect(requested.ok).toBe(true);
    if (requested.ok) expect(requested.data.status).toBe('not-enqueued');
    expect(harness.jobs.queuedCount()).toBe(0);
    expect(harness.streamCalls.count).toBe(0);
  });

  it('开启自动建议必须携带当前同意版本；关闭时取消本空间自动作业', async () => {
    const harness = makeFixture();
    const wrongConsent = await harness.service.setSettings({
      operationId: randomUUID(),
      workspaceId: harness.workspaceId,
      expectedRevision: 0,
      autoSuggestEnabled: true,
      consentVersion: MEMORY_SUGGESTION_CONSENT_VERSION + 99,
    });
    expect(wrongConsent.ok).toBe(false);
    if (wrongConsent.ok) return;
    expect(wrongConsent.error.code).toBe('CONSENT_REQUIRED');

    await enableAutoSuggest(harness);
    const jobId = seedQueuedJob(harness, { consentRevision: MEMORY_SUGGESTION_CONSENT_VERSION });
    const off = await harness.service.setSettings({
      operationId: randomUUID(),
      workspaceId: harness.workspaceId,
      expectedRevision: 1,
      autoSuggestEnabled: false,
    });
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.data.cancelledJobCount).toBe(1);
    expect(harness.jobs.get(jobId)?.status).toBe('cancelled');
  });

  it('开关设置重复提交同一 operationId 时重放原回执，不再取消第二轮作业', async () => {
    const harness = makeFixture();
    await enableAutoSuggest(harness);
    const jobId = seedQueuedJob(harness, { consentRevision: MEMORY_SUGGESTION_CONSENT_VERSION });
    const request = {
      operationId: randomUUID(),
      workspaceId: harness.workspaceId,
      expectedRevision: 1,
      autoSuggestEnabled: false,
    } as const;

    const first = await harness.service.setSettings(request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.cancelledJobCount).toBe(1);

    // §5.6：响应超时后原样重发要拿回原提交效果，而不是把陈旧 expectedRevision 读成冲突。
    const second = await harness.service.setSettings(request);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.receipt.effect).toBe(first.data.receipt.effect);
    expect(second.data.receipt.currentSettings.revision).toBe(2);
    expect(second.data.cancelledJobCount).toBe(0);
    expect(harness.jobs.get(jobId)?.status).toBe('cancelled');

    // 同一个幂等身份换内容＝两次不同写入，必须拒掉而不是覆盖第一次的同意记录。
    const reused = await harness.service.setSettings({
      ...request,
      autoSuggestEnabled: true,
      consentVersion: MEMORY_SUGGESTION_CONSENT_VERSION,
    });
    expect(reused.ok).toBe(false);
    if (reused.ok) return;
    expect(reused.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(harness.jobs.getSettings(harness.workspaceId).revision).toBe(2);
  });
});

describe('MemoryExtractionService 入队与去重（WM09 §7.3）', () => {
  it('同意后成功入队并执行：快照片段、依赖与非敏感模型指纹全部持久化', async () => {
    const harness = makeFixture({
      behaviour: { kind: 'chunks', chunks: stopChunks(validOutput()) },
    });
    await enableAutoSuggest(harness);
    harness.putRunRecord();
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    expect(requested.data.status).toBe('queued');
    const jobId = requested.data.jobId ?? '';
    await harness.service.runPendingJobs();

    const job = harness.jobs.get(jobId);
    expect(job?.status).toBe('succeeded');
    expect(job?.fragments[0]?.role).toBe('run-prompt');
    expect(job?.fragments[0]?.text).toBe(PROMPT);
    expect(job?.materialDependencies).toHaveLength(2);
    expect(job?.modelSnapshot?.fingerprint).toBe('fp-1');
    expect(job?.modelSnapshot?.endpointDisplay).toBe('https://api.test.example/v1');
    expect(Object.keys(job?.modelSnapshot ?? {})).toEqual(['fingerprint', 'endpointDisplay']);
    expect(job?.outcome?.candidateRevisionIds).toHaveLength(1);
    expect(job?.usage?.totalTokens).toBe(150);
  });

  it('同一来源版本只登记一条逻辑作业；succeeded 后不再重复提炼', async () => {
    const harness = makeFixture({
      behaviour: { kind: 'chunks', chunks: stopChunks(validOutput()) },
    });
    await enableAutoSuggest(harness);
    harness.putRunRecord();
    await harness.service.requestExtractionForRun(RUN_ID);
    await harness.service.runPendingJobs();
    const second = await harness.service.requestExtractionForRun(RUN_ID);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.data.status).toBe('existing');
    expect(harness.streamCalls.count).toBe(1);
    expect(harness.jobs.countByStatus(['queued', 'running', 'succeeded'])).toBe(1);
  });

  it('队列满 20 时返回 QUEUE_FULL 结论而不是静默丢弃或阻塞', async () => {
    const harness = makeFixture();
    await enableAutoSuggest(harness);
    harness.putRunRecord();
    // 用仓储直接灌满全局 queued 额度，避免被本服务的排空消化。
    for (let index = 0; index < 20; index += 1) {
      seedQueuedJob(harness, {
        runId: `run-fill-${index}`,
        sourceVersionHash: memoryContentHash(`fill-${index}`),
      });
    }
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    expect(requested.ok).toBe(true);
    if (requested.ok) {
      expect(requested.data.status).toBe('not-enqueued');
      expect(requested.data.reason).toBe('QUEUE_FULL');
    }
  });

  it('来源片段命中敏感内容时拒绝提炼：零入队零模型调用', async () => {
    const harness = makeFixture();
    await enableAutoSuggest(harness);
    harness.putRunRecord({ prompt: '请在报告里加上 api_key = sk-abcdef123456 这一节' });
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    expect(requested.ok).toBe(true);
    if (requested.ok) {
      expect(requested.data.status).toBe('not-enqueued');
      expect(requested.data.reason).toBe('SENSITIVE_CONTENT');
    }
    expect(harness.jobs.queuedCount()).toBe(0);
    expect(harness.streamCalls.count).toBe(0);
  });

  it('依赖记忆修订无法证明时跳过自动建议（不截断）', async () => {
    const harness = makeFixture();
    await enableAutoSuggest(harness);
    harness.putRunRecord({
      memoryDependencies: [
        { memoryId: 'mem-x', revisionId: 'rev-missing', contentHash: 'b'.repeat(64) },
      ],
    });
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    expect(requested.ok).toBe(true);
    if (requested.ok) {
      expect(requested.data.status).toBe('not-enqueued');
      expect(requested.data.reason).toBe('SOURCE_UNAVAILABLE');
    }
    expect(harness.jobs.queuedCount()).toBe(0);
  });

  it('来源依赖成环时跳过自动建议并返回 SOURCE_DEPENDENCY_CYCLE', async () => {
    const harness = makeFixture();
    await enableAutoSuggest(harness);
    const left = seedMemory(harness, '收入按回款金额统计。');
    const right = seedMemory(harness, '毛利按收入减直接成本计算。');
    forgeDependencyCycle(harness, left, right);
    harness.putRunRecord({ memoryDependencies: [memoryDependencyOf(left)] });

    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    expect(requested.data.status).toBe('not-enqueued');
    expect(requested.data.reason).toBe('SOURCE_DEPENDENCY_CYCLE');
    expect(harness.jobs.queuedCount()).toBe(0);
    expect(harness.streamCalls.count).toBe(0);
  });

  it('入队之后才被改出环的作业跳过执行，不建候选也不调用模型', async () => {
    const harness = makeFixture();
    await enableAutoSuggest(harness);
    const left = seedMemory(harness, '收入按回款金额统计。');
    const right = seedMemory(harness, '毛利按收入减直接成本计算。');
    harness.putRunRecord();
    // 走仓储直连登记：入队路径自身的非阻塞排空会在同一次 claim 里跑完依赖复证。
    const jobId = seedQueuedJob(harness, {
      consentRevision: MEMORY_SUGGESTION_CONSENT_VERSION,
      modelProfileId: 'mp-1',
      sourceVersionHash: versionHashForPrompt(PROMPT),
      memoryDependencies: [memoryDependencyOf(left)],
    });
    forgeDependencyCycle(harness, left, right);

    await harness.service.runPendingJobs();
    const job = harness.jobs.get(jobId);
    expect(job?.status).toBe('skipped');
    expect(job?.errorCode).toBe('INPUT_LIMIT');
    expect(harness.streamCalls.count).toBe(0);
    expect(job?.outcome?.candidateRevisionIds ?? []).toHaveLength(0);
  });

  it('材料依赖超额时返回 SOURCE_DEPENDENCY_LIMIT 结论', async () => {
    const harness = makeFixture();
    await enableAutoSuggest(harness);
    const manyMaterials: MaterialReference[] = [];
    for (let index = 0; index < 201; index += 1) manyMaterials.push(materialRef(`doc-${index}`));
    harness.putRunRecord({ materialDependencies: manyMaterials });
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    expect(requested.ok).toBe(true);
    if (requested.ok) {
      expect(requested.data.reason).toBe('SOURCE_DEPENDENCY_LIMIT');
    }
  });
});

describe('MemoryExtractionService 执行与候选闭环（WM10 §7.2）', () => {
  it('合法用户纠正 → 候选以待审状态落库并整份继承依赖', async () => {
    const harness = makeFixture({
      behaviour: { kind: 'chunks', chunks: stopChunks(validOutput()) },
    });
    await enableAutoSuggest(harness);
    const dependency = seedMemory(harness, '报告货币单位偏好');
    harness.putRunRecord({ memoryDependencies: [memoryDependencyOf(dependency)] });
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    if (!requested.ok) throw new Error('入队应成功');
    await harness.service.runPendingJobs();
    const jobId = requested.data.jobId ?? '';
    const job = harness.jobs.get(jobId);
    expect(job?.status).toBe('succeeded');
    const revisionId = job?.outcome?.candidateRevisionIds[0];
    expect(revisionId).toBeDefined();
    const candidate = harness.memories.getRevision(revisionId ?? '');
    expect(candidate?.status).toBe('candidate');
    expect(candidate?.candidateDisposition).toBe('pending');
    expect(candidate?.scope).toEqual({ kind: 'workspace', workspaceId: harness.workspaceId });
    expect(candidate?.topicKey).toBe('统计口径');
    if (candidate?.provenance.verification !== 'verified') {
      throw new Error('候选来源必须 verified');
    }
    expect(candidate.provenance.authority).toBe('derived');
    // 模型无权删依赖：整份继承作业登记的材料与记忆依赖。
    expect(candidate.provenance.materialDependencies).toHaveLength(2);
    expect(candidate.provenance.memoryDependencies).toHaveLength(1);
    expect(candidate.provenance.originWorkspaceId).toBe(harness.workspaceId);
    const firstSource = candidate.provenance.sources[0];
    if (firstSource?.kind !== 'run-user') throw new Error('首条来源应为 run-user');
    expect(firstSource.promptHash).toBe(memoryContentHash(PROMPT));
    expect(firstSource.excerpt).toBe(EVIDENCE_SLICE);
  });

  it('模型返回 0 条也算成功，并且不再提炼同一来源版本', async () => {
    const harness = makeFixture({
      behaviour: { kind: 'chunks', chunks: stopChunks('{"candidates":[]}') },
    });
    await enableAutoSuggest(harness);
    harness.putRunRecord();
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    if (!requested.ok) throw new Error('入队应成功');
    await harness.service.runPendingJobs();
    const job = harness.jobs.get(requested.data.jobId ?? '');
    expect(job?.status).toBe('succeeded');
    expect(job?.outcome?.candidateRevisionIds).toEqual([]);
    expect(
      harness.memories.list({ workspaceId: harness.workspaceId, statuses: ['candidate'] }),
    ).toHaveLength(0);
  });

  it('与既有 pending 候选重复计 deduplicated，与已拒绝候选计 suppressed', async () => {
    const harness = makeFixture({
      behaviour: { kind: 'chunks', chunks: stopChunks(validOutput()) },
    });
    await enableAutoSuggest(harness);
    seedCandidate(harness, CANDIDATE_CONTENT, 'pending');
    harness.putRunRecord();
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    if (!requested.ok) throw new Error('入队应成功');
    await harness.service.runPendingJobs();
    const job = harness.jobs.get(requested.data.jobId ?? '');
    expect(job?.status).toBe('succeeded');
    expect(job?.outcome?.deduplicatedCount).toBe(1);
    expect(job?.outcome?.candidateRevisionIds).toEqual([]);

    const harness2 = makeFixture({
      behaviour: { kind: 'chunks', chunks: stopChunks(validOutput()) },
    });
    await enableAutoSuggest(harness2);
    seedCandidate(harness2, CANDIDATE_CONTENT, 'rejected');
    harness2.putRunRecord();
    const requested2 = await harness2.service.requestExtractionForRun(RUN_ID);
    if (!requested2.ok) throw new Error('入队应成功');
    await harness2.service.runPendingJobs();
    expect(harness2.jobs.get(requested2.data.jobId ?? '')?.outcome?.suppressedCount).toBe(1);
  });

  it('错误 JSON、越权字段、length 截断与缺失结束原因分别落安全错误码', async () => {
    const failureCases: readonly [string, ModelStreamChunk[]][] = [
      ['INVALID_MODEL_OUTPUT', stopChunks('这不是 JSON')],
      [
        'MODEL_OUTPUT_TRUNCATED',
        [
          { type: 'text-delta', delta: '{"candidates":[' },
          { type: 'done', finishReason: 'length' },
        ],
      ],
      [
        'MODEL_FINISH_UNKNOWN',
        [{ type: 'text-delta', delta: '{"candidates":[]}' }, { type: 'done' }],
      ],
      ['INVALID_MODEL_OUTPUT', stopChunks('{"candidates":[],"status":"confirmed"}')],
    ];
    for (const [expectedCode, chunks] of failureCases) {
      const harness = makeFixture({ behaviour: { kind: 'chunks', chunks } });
      await enableAutoSuggest(harness);
      harness.putRunRecord();
      const requested = await harness.service.requestExtractionForRun(RUN_ID);
      if (!requested.ok) throw new Error('入队应成功');
      await harness.service.runPendingJobs();
      const job = harness.jobs.get(requested.data.jobId ?? '');
      expect(job?.status).toBe('failed');
      expect(job?.errorCode).toBe(expectedCode);
      expect(
        harness.memories.list({ workspaceId: harness.workspaceId, statuses: ['candidate'] }),
      ).toHaveLength(0);
    }
  });

  it('模型尝试工具调用被拒绝', async () => {
    const harness = makeFixture({
      behaviour: {
        kind: 'chunks',
        chunks: [
          { type: 'tool-call', toolCall: { id: 't1', name: 'shell', input: {} } },
          ...stopChunks(validOutput()),
        ],
      },
    });
    await enableAutoSuggest(harness);
    harness.putRunRecord();
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    if (!requested.ok) throw new Error('入队应成功');
    await harness.service.runPendingJobs();
    const job = harness.jobs.get(requested.data.jobId ?? '');
    expect(job?.errorCode).toBe('MODEL_TOOL_CALL_REJECTED');
  });

  it('输出命中凭据模式时整批拒绝保存且不落原文', async () => {
    const harness = makeFixture({
      behaviour: { kind: 'chunks', chunks: stopChunks(validOutput('password=SuperSecret123')) },
    });
    await enableAutoSuggest(harness);
    harness.putRunRecord();
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    if (!requested.ok) throw new Error('入队应成功');
    await harness.service.runPendingJobs();
    const job = harness.jobs.get(requested.data.jobId ?? '');
    expect(job?.status).toBe('failed');
    expect(job?.errorCode).toBe('SENSITIVE_CONTENT');
    expect(job?.outcome).toBeUndefined();
    expect(
      harness.memories.list({ workspaceId: harness.workspaceId, statuses: ['candidate'] }),
    ).toHaveLength(0);
  });

  it('单次 30 秒预算：超时中止并落 TIMEOUT（本用例缩短为 50 毫秒）', async () => {
    const harness = makeFixture({ behaviour: { kind: 'hang' }, timeoutMs: 50 });
    await enableAutoSuggest(harness);
    harness.putRunRecord();
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    if (!requested.ok) throw new Error('入队应成功');
    await harness.service.runPendingJobs();
    const job = harness.jobs.get(requested.data.jobId ?? '');
    expect(job?.status).toBe('failed');
    expect(job?.errorCode).toBe('TIMEOUT');
  });

  it('回答与 reasoning 增量合计超过 6000 code points 即中止并落 OUTPUT_LIMIT', async () => {
    const big = 'あ'.repeat(3_000);
    const harness = makeFixture({
      behaviour: {
        kind: 'chunks',
        chunks: [
          { type: 'text-delta', delta: big },
          { type: 'reasoning-delta', delta: big },
          { type: 'reasoning-delta', delta: big },
        ],
      },
    });
    await enableAutoSuggest(harness);
    harness.putRunRecord();
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    if (!requested.ok) throw new Error('入队应成功');
    await harness.service.runPendingJobs();
    const job = harness.jobs.get(requested.data.jobId ?? '');
    expect(job?.errorCode).toBe('OUTPUT_LIMIT');
  });

  it('Provider 抛错只落 MODEL_REQUEST_FAILED，凭据既不进数据库也不进日志', async () => {
    const secret = 'sk-provider-live-key-1234567890';
    const harness = makeFixture({
      behaviour: {
        kind: 'throw',
        // 厂商错误体常见形态：把请求头原样回显，日志因此会成为第二条泄漏路径。
        error: new Error(`fetch failed: Authorization: Bearer ${secret}`),
        beforeChunks: [],
      },
      knownSecrets: [secret],
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await enableAutoSuggest(harness);
      harness.putRunRecord();
      const requested = await harness.service.requestExtractionForRun(RUN_ID);
      if (!requested.ok) throw new Error('入队应成功');
      await harness.service.runPendingJobs();
      const job = harness.jobs.get(requested.data.jobId ?? '');
      expect(job?.status).toBe('failed');
      expect(job?.errorCode).toBe('MODEL_REQUEST_FAILED');
      expect(JSON.stringify(job)).not.toContain(secret);
      const output = logged.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('诊断已省略');
      expect(output).not.toContain(secret);
    } finally {
      logged.mockRestore();
    }
  });
});

describe('MemoryExtractionService 状态机与调度（WM09 §7.3）', () => {
  it('同意缺失、模型不可用、指纹变化、来源变化都在调用模型前收口', async () => {
    const cases: readonly {
      name: string;
      fixture: () => Harness;
      enable: boolean;
      jobId: (harness: Harness) => string;
      code: string;
    }[] = [
      {
        name: 'consent',
        fixture: makeFixture,
        enable: false,
        jobId: (harness) => seedQueuedJob(harness),
        code: 'CONSENT_REQUIRED',
      },
      {
        name: 'model-unavailable',
        fixture: () => makeFixture({ resolverFailure: 'unavailable' }),
        enable: true,
        jobId: (harness) => {
          harness.putRunRecord();
          return seedQueuedJob(harness, {
            consentRevision: MEMORY_SUGGESTION_CONSENT_VERSION,
            modelProfileId: 'mp-1',
            sourceVersionHash: versionHashForPrompt(PROMPT),
          });
        },
        code: 'MODEL_UNAVAILABLE',
      },
      {
        name: 'fingerprint',
        fixture: () => makeFixture({ fingerprint: 'fp-changed' }),
        enable: true,
        jobId: (harness) => {
          harness.putRunRecord();
          return seedQueuedJob(harness, {
            consentRevision: MEMORY_SUGGESTION_CONSENT_VERSION,
            modelProfileId: 'mp-1',
            modelSnapshot: { fingerprint: 'fp-old' },
            sourceVersionHash: versionHashForPrompt(PROMPT),
          });
        },
        code: 'MODEL_PROFILE_CHANGED',
      },
      {
        name: 'source-changed',
        fixture: makeFixture,
        enable: true,
        jobId: (harness) => {
          const id = seedQueuedJob(harness, {
            consentRevision: MEMORY_SUGGESTION_CONSENT_VERSION,
            modelProfileId: 'mp-1',
            sourceVersionHash: versionHashForPrompt(PROMPT),
          });
          harness.records.set(RUN_ID, harness.runRecord({ prompt: `${PROMPT}（事后被改写过）` }));
          return id;
        },
        code: 'INPUT_LIMIT',
      },
    ];
    for (const testCase of cases) {
      const harness = testCase.fixture();
      if (testCase.enable) await enableAutoSuggest(harness);
      const jobId = testCase.jobId(harness);
      await harness.service.runPendingJobs();
      const job = harness.jobs.get(jobId);
      expect(job?.status, testCase.name).toBe('skipped');
      expect(job?.errorCode, testCase.name).toBe(testCase.code);
      expect(harness.streamCalls.count, testCase.name).toBe(0);
    }
  });

  it('全局并发 1：claim 是 CAS，第二个执行者拿不到同一作业', async () => {
    const harness = makeFixture({
      behaviour: { kind: 'chunks', chunks: stopChunks(validOutput()) },
    });
    await enableAutoSuggest(harness);
    harness.putRunRecord();
    // 走仓储直连登记，避免入队路径自身的非阻塞排空抢先 claim。
    const jobId = seedQueuedJob(harness, {
      consentRevision: MEMORY_SUGGESTION_CONSENT_VERSION,
      modelProfileId: 'mp-1',
      sourceVersionHash: versionHashForPrompt(PROMPT),
    });
    // 先把 queued 抢走，再让服务尝试排空。
    const claimed = harness.jobs.claimNext(1);
    expect(claimed?.id).toBe(jobId);
    expect(harness.jobs.claimNext(2)).toBeUndefined();
    const executed = await harness.service.runPendingJobs();
    expect(executed).toBe(0);
    // 由本次 claim 造成的 running 遗留在启动收口里落 interrupted，不触网。
    expect(harness.service.recoverInterruptedJobs()).toBe(1);
    expect(harness.jobs.get(jobId)?.status).toBe('interrupted');
    expect(harness.streamCalls.count).toBe(0);
  });

  it('取消执行中的作业：先落终态再中止请求，迟到结果不落库', async () => {
    const harness = makeFixture({
      behaviour: {
        kind: 'hang',
        prefixChunks: [{ type: 'text-delta', delta: '{"candidates":[]}' }],
      },
    });
    await enableAutoSuggest(harness);
    harness.putRunRecord();
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    if (!requested.ok) throw new Error('入队应成功');
    const jobId = requested.data.jobId ?? '';
    await waitFor(() => harness.jobs.runningCount() === 1, '作业进入 running');
    const running = harness.jobs.get(jobId);
    const cancelled = await harness.service.cancelJob({
      operationId: randomUUID(),
      jobId,
      expectedRevision: running?.revision ?? 0,
    });
    expect(cancelled.ok).toBe(true);
    await harness.service.runPendingJobs();
    const final = harness.jobs.get(jobId);
    expect(final?.status).toBe('cancelled');
    expect(final?.outcome).toBeUndefined();
    expect(
      harness.memories.list({ workspaceId: harness.workspaceId, statuses: ['candidate'] }),
    ).toHaveLength(0);
  });

  it('重启收口：遗留 queued/running 全部 interrupted 且零网络调用', async () => {
    const harness = makeFixture();
    const queuedId = seedQueuedJob(harness);
    const claimedId = (() => {
      seedQueuedJob(harness, {
        runId: 'run-claimed',
        sourceVersionHash: memoryContentHash('claimed'),
      });
      const claimed = harness.jobs.claimNext(1);
      return claimed?.id ?? '';
    })();
    expect(harness.service.recoverInterruptedJobs()).toBe(2);
    expect(harness.jobs.get(queuedId)?.status).toBe('interrupted');
    expect(harness.jobs.get(claimedId)?.status).toBe('interrupted');
    expect(harness.jobs.get(queuedId)?.errorCode).toBe('INTERRUPTED');
    expect(harness.streamCalls.count).toBe(0);
  });

  it('手动重试带独立同意：attempt 递增、trigger 变 manual-retry、不改自动开关', async () => {
    const harness = makeFixture({
      behaviour: { kind: 'chunks', chunks: stopChunks(validOutput()) },
    });
    await enableAutoSuggest(harness);
    harness.putRunRecord();
    const jobId = seedQueuedJob(harness, {
      consentRevision: MEMORY_SUGGESTION_CONSENT_VERSION,
      modelProfileId: 'mp-1',
      sourceVersionHash: versionHashForPrompt(PROMPT),
    });
    harness.jobs.fail({ jobId, expectedRevision: 1, expectedAttempt: 1, errorCode: 'TIMEOUT' });
    const wrongConsent = await harness.service.retryJob({
      operationId: randomUUID(),
      jobId,
      expectedRevision: 2,
      consentVersion: MEMORY_SUGGESTION_CONSENT_VERSION + 7,
    });
    expect(wrongConsent.ok).toBe(false);
    if (!wrongConsent.ok) expect(wrongConsent.error.code).toBe('CONSENT_REQUIRED');

    const retried = await harness.service.retryJob({
      operationId: randomUUID(),
      jobId,
      expectedRevision: 2,
      consentVersion: MEMORY_SUGGESTION_CONSENT_VERSION,
    });
    expect(retried.ok).toBe(true);
    if (retried.ok) {
      expect(retried.data.status).toBe('queued');
      expect(retried.data.attempt).toBe(2);
      expect(retried.data.trigger).toBe('manual-retry');
    }
    const settings = await harness.service.getSettings({ workspaceId: harness.workspaceId });
    if (settings.ok) expect(settings.data.autoSuggestEnabled).toBe(true);
    await harness.service.runPendingJobs();
    expect(harness.jobs.get(jobId)?.status).toBe('succeeded');
  });

  it('终态作业不可取消；列表只回脱敏摘要', async () => {
    const harness = makeFixture({
      behaviour: { kind: 'chunks', chunks: stopChunks(validOutput()) },
    });
    await enableAutoSuggest(harness);
    harness.putRunRecord();
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    if (!requested.ok) throw new Error('入队应成功');
    await harness.service.runPendingJobs();
    const jobId = requested.data.jobId ?? '';
    const job = harness.jobs.get(jobId);
    const tooLate = await harness.service.cancelJob({
      operationId: randomUUID(),
      jobId,
      expectedRevision: job?.revision ?? 0,
    });
    expect(tooLate.ok).toBe(false);
    if (!tooLate.ok) expect(tooLate.error.code).toBe('JOB_STATE_CONFLICT');

    const page = await harness.service.listJobs({ workspaceId: harness.workspaceId });
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.data.items[0]?.status).toBe('succeeded');
      expect(page.data.items[0]?.candidateCount).toBe(1);
      expect(JSON.stringify(page.data.items)).not.toContain(PROMPT);
    }
  });
});

describe('MemoryExtractionService 讨论节点与截断来源（WM10 §7.2）', () => {
  it('讨论节点触发：人工 feedback 为主证据，来源锚定节点字段内容哈希', async () => {
    const harness = makeFixture({
      behaviour: { kind: 'chunks', chunks: stopChunks(validOutput('大纲先给结论再展开')) },
    });
    await enableAutoSuggest(harness);
    harness.db
      .prepare(
        `INSERT INTO discussion_checkpoints (
           id, task_id, run_id, stage, status, title, summary,
           artifact_version_ids_json, feedback, next_action, supersedes_id, created_at, updated_at
         ) VALUES ('cp-1', ?, NULL, 'understanding', 'open', '大纲口径', ?, '[]', ?, NULL, NULL, 1, 1)`,
      )
      .run(harness.taskId, SUMMARY, FEEDBACK);
    harness.records.set('cp-1', {
      kind: 'checkpoint',
      checkpointId: 'cp-1',
      taskId: harness.taskId,
      workspaceId: harness.workspaceId,
      feedback: FEEDBACK,
      summary: SUMMARY,
      materialDependencies: [],
      memoryDependencies: [],
    });
    const requested = await harness.service.requestExtractionForCheckpoint('cp-1');
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    await harness.service.runPendingJobs();
    const job = harness.jobs.get(requested.data.jobId ?? '');
    expect(job?.status).toBe('succeeded');
    const candidate = harness.memories.getRevision(job?.outcome?.candidateRevisionIds[0] ?? '');
    if (candidate?.provenance.verification !== 'verified') throw new Error('候选来源必须 verified');
    const source = candidate.provenance.sources[0];
    if (source?.kind !== 'checkpoint') throw new Error('首条来源应为 checkpoint');
    expect(source.field).toBe('feedback');
    expect(source.contentHash).toBe(memoryContentHash(FEEDBACK));
    expect(source.excerpt).toBe([...FEEDBACK].slice(0, EVIDENCE_END).join(''));
  });

  it('超长来源：截断片段仍按全文坐标证明头段证据；命中截断标记的证据被放弃而非伪造', async () => {
    const longPrompt = '甲'.repeat(4_000);
    const harness = makeFixture({
      behaviour: { kind: 'chunks', chunks: stopChunks(validOutput('统一使用万元作为货币单位')) },
    });
    await enableAutoSuggest(harness);
    harness.putRunRecord({ prompt: longPrompt });
    const requested = await harness.service.requestExtractionForRun(RUN_ID);
    if (!requested.ok) throw new Error('入队应成功');
    await harness.service.runPendingJobs();
    const job = harness.jobs.get(requested.data.jobId ?? '');
    expect(job?.status).toBe('succeeded');
    expect(job?.fragments[0]?.partial).toBe(true);
    const candidate = harness.memories.getRevision(job?.outcome?.candidateRevisionIds[0] ?? '');
    if (candidate?.provenance.verification !== 'verified') throw new Error('候选来源必须 verified');
    const source = candidate.provenance.sources[0];
    expect(source?.excerpt).toBe('甲'.repeat(EVIDENCE_END));
    expect(source?.start).toBe(0);
    expect(source?.end).toBe(EVIDENCE_END);

    // 证据完全落在截断标记内部：无法映射，该候选被计为 suppressed。
    const markerStart = Math.floor(2_000 / 2) + 1;
    const harness2 = makeFixture({
      behaviour: {
        kind: 'chunks',
        chunks: stopChunks(
          JSON.stringify({
            candidates: [
              {
                content: '统一使用万元作为货币单位',
                facet: 'constraint',
                evidence: [{ fragmentId: 'f1', start: markerStart, end: markerStart + 2 }],
              },
            ],
          }),
        ),
      },
    });
    await enableAutoSuggest(harness2);
    harness2.putRunRecord({ prompt: longPrompt });
    const requested2 = await harness2.service.requestExtractionForRun(RUN_ID);
    if (!requested2.ok) throw new Error('入队应成功');
    await harness2.service.runPendingJobs();
    const job2 = harness2.jobs.get(requested2.data.jobId ?? '');
    expect(job2?.status).toBe('succeeded');
    expect(job2?.outcome?.suppressedCount).toBe(1);
    expect(job2?.outcome?.candidateRevisionIds).toEqual([]);
  });
});
