import { createHash, randomUUID } from 'node:crypto';

import {
  MEMORY_EXTRACTION_QUEUE_LIMIT,
  type MemoryExtractionFragment,
  type MemoryExtractionJob,
  type MemoryExtractionSource,
  stableStringifyJson,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AppStore,
  type EnqueueExtractionJobInput,
  extractionSourceKey,
  MemoryConflictError,
  type MemoryExtractionRepository,
  MemoryJobStateConflictError,
  MemoryQueueFullError,
} from './index';

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const T_BASE = 1_700_000_000_000;
/** 片段正文只属于作业快照，列表摘要里绝不能出现。 */
const SECRET_FRAGMENT_TEXT = '模型原文：本季毛利全部来自老客户续约。';

const fragments = (seed: string): MemoryExtractionFragment[] => [
  {
    fragmentId: `frag-${seed}`,
    role: 'run-assistant',
    text: SECRET_FRAGMENT_TEXT,
    partial: false,
  },
];

const outcomeOf = (
  count: number,
): {
  candidateRevisionIds: string[];
  deduplicatedCount: number;
  suppressedCount: number;
} => ({
  candidateRevisionIds: Array.from({ length: count }, (_unused, index) => `cand-${index}`),
  deduplicatedCount: 1,
  suppressedCount: 0,
});

type RunSource = Extract<MemoryExtractionSource, { kind: 'run' }>;

interface SourceFixture {
  workspaceId: string;
  taskId: string;
  source: RunSource;
}

describe('MemoryExtractionRepository', () => {
  const stores: AppStore[] = [];

  const openStore = (): AppStore => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    return store;
  };

  /** 作业必须挂在真实链条上：工作空间 → 任务 → 运行，一段都不许编。 */
  const newSource = (store: AppStore, label: string): SourceFixture => {
    const workspaceId = store.workspaces.getOrCreate(`/tmp/memory-extraction/${label}`, label).id;
    const task = store.tasks.create(workspaceId, label, '用于自动提炼的来源任务');
    const runId = randomUUID();
    store.runs.create({
      id: runId,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'test',
      status: 'completed',
      createdAt: T_BASE,
    });
    return { workspaceId, taskId: task.task.id, source: { kind: 'run', runId } };
  };

  const jobInput = (
    fixture: SourceFixture,
    versionSeed: string,
    overrides: Partial<EnqueueExtractionJobInput> = {},
  ): EnqueueExtractionJobInput => ({
    source: fixture.source,
    workspaceId: fixture.workspaceId,
    taskId: fixture.taskId,
    fragments: fragments(versionSeed),
    sourceVersionHash: sha256Hex(versionSeed),
    trigger: 'automatic',
    inputCodePoints: [...SECRET_FRAGMENT_TEXT].length,
    at: T_BASE + 1_000,
    ...overrides,
  });

  const enqueue = (
    store: AppStore,
    fixture: SourceFixture,
    versionSeed: string,
    overrides: Partial<EnqueueExtractionJobInput> = {},
  ): MemoryExtractionJob =>
    store.memoryExtractions.enqueue(jobInput(fixture, versionSeed, overrides)).job;

  /** 领取即进入 running；断言领到的正是预期的那条作业。 */
  const claimRunning = (
    store: AppStore,
    jobId: string,
    at = T_BASE + 2_000,
  ): MemoryExtractionJob => {
    const claimed = store.memoryExtractions.claimNext(at);
    if (!claimed) throw new Error('队列里应当有可领取的作业');
    expect(claimed.id).toBe(jobId);
    return claimed;
  };

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  it('treats a missing settings row as revision 0 and switched off', () => {
    const store = openStore();
    const repository: MemoryExtractionRepository = store.memoryExtractions;
    const workspaceId = store.workspaces.getOrCreate('/tmp/memory-extraction/设置', '设置').id;

    expect(repository.getSettings(workspaceId)).toEqual({
      workspaceId,
      revision: 0,
      autoSuggestEnabled: false,
      updatedAt: 0,
    });
    // 缺省必须落在「不调模型」的一侧，且不开关就不写行。
    expect(
      repository.applySettings({
        workspaceId,
        expectedRevision: 0,
        autoSuggestEnabled: false,
        at: T_BASE,
      }),
    ).toEqual({
      settings: { workspaceId, revision: 0, autoSuggestEnabled: false, updatedAt: 0 },
      effect: 'unchanged',
      cancelledJobCount: 0,
    });
    expect(repository.getSettings(workspaceId).revision).toBe(0);

    expect(() =>
      repository.applySettings({
        workspaceId,
        expectedRevision: 0,
        autoSuggestEnabled: true,
        at: T_BASE,
      }),
    ).toThrow(/必须提交当前同意版本/u);
    expect(() =>
      repository.applySettings({
        workspaceId: 'ws-ghost',
        expectedRevision: 0,
        autoSuggestEnabled: true,
        consentVersion: 1,
        at: T_BASE,
      }),
    ).toThrow(/工作空间不存在/u);
    expect(() =>
      repository.applySettings({
        workspaceId,
        expectedRevision: 7,
        autoSuggestEnabled: true,
        consentVersion: 1,
        at: T_BASE,
      }),
    ).toThrow(MemoryConflictError);

    const enabled = repository.applySettings({
      workspaceId,
      expectedRevision: 0,
      autoSuggestEnabled: true,
      consentVersion: 1,
      at: T_BASE,
    });
    expect(enabled.effect).toBe('created');
    expect(enabled.settings).toEqual({
      workspaceId,
      revision: 1,
      autoSuggestEnabled: true,
      consentVersion: 1,
      consentedAt: T_BASE,
      updatedAt: T_BASE,
    });
    // 同口径重复提交：unchanged，不涨修订。
    expect(
      repository.applySettings({
        workspaceId,
        expectedRevision: 1,
        autoSuggestEnabled: true,
        consentVersion: 1,
        at: T_BASE + 500,
      }),
    ).toEqual({ settings: enabled.settings, effect: 'unchanged', cancelledJobCount: 0 });
    // 开启之后再拿旧修订提交，CAS 照样挡下。
    expect(() =>
      repository.applySettings({
        workspaceId,
        expectedRevision: 0,
        autoSuggestEnabled: false,
        at: T_BASE + 600,
      }),
    ).toThrow(/期望设置修订/u);
  });

  it('cancels the automatic jobs of this workspace when the switch goes off', () => {
    const store = openStore();
    const here = newSource(store, '关停空间');
    const there = newSource(store, '另一空间');
    store.memoryExtractions.applySettings({
      workspaceId: here.workspaceId,
      expectedRevision: 0,
      autoSuggestEnabled: true,
      consentVersion: 1,
      at: T_BASE,
    });
    const automatic = enqueue(store, here, '自动作业');
    const manualHere = enqueue(store, here, '手动作业', { trigger: 'manual-retry' });
    const manualThere = enqueue(store, there, '别处作业', { trigger: 'manual-retry' });

    const disabled = store.memoryExtractions.applySettings({
      workspaceId: here.workspaceId,
      expectedRevision: 1,
      autoSuggestEnabled: false,
      at: T_BASE + 9_000,
    });
    expect(disabled.effect).toBe('updated');
    expect(disabled.cancelledJobCount).toBe(1);
    expect(disabled.settings).toEqual({
      workspaceId: here.workspaceId,
      revision: 2,
      autoSuggestEnabled: false,
      consentVersion: 1,
      consentedAt: T_BASE,
      updatedAt: T_BASE + 9_000,
    });
    const cancelled = store.memoryExtractions.get(automatic.id);
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.errorCode).toBe('CANCELLED');
    expect(cancelled?.revision).toBe(2);
    // 手动重试是用户的明确意图，关总开关不该顺手取消；别的空间更不受影响。
    expect(store.memoryExtractions.get(manualHere.id)?.status).toBe('queued');
    expect(store.memoryExtractions.get(manualThere.id)?.status).toBe('queued');
  });

  it('keeps one logical job per source version no matter which model is chosen', () => {
    const store = openStore();
    const fixture = newSource(store, '同源版本');
    const hash = sha256Hex('同一轮回答');

    const first = store.memoryExtractions.enqueue(
      jobInput(fixture, '同一轮回答', { modelProfileId: 'mp-a' }),
    );
    expect(first.effect).toBe('created');
    expect(first.job.status).toBe('queued');
    expect(first.job.revision).toBe(1);
    expect(first.job.attempt).toBe(1);
    expect(first.job.sourceKey).toBe(extractionSourceKey(fixture.source, hash));
    // §7.3：来源键＝触发类型＋真实来源 id＋内容快照哈希，换模型不得绕过去重。
    const second = store.memoryExtractions.enqueue(
      jobInput(fixture, '同一轮回答', { modelProfileId: 'mp-b' }),
    );
    expect(second.effect).toBe('existing');
    expect(second.job.id).toBe(first.job.id);
    expect(store.memoryExtractions.queuedCount()).toBe(1);

    const third = store.memoryExtractions.enqueue(jobInput(fixture, '内容变了的一轮'));
    expect(third.effect).toBe('created');
    expect(third.job.id).not.toBe(first.job.id);
    expect(store.memoryExtractions.queuedCount()).toBe(2);
    expect(
      store.memoryExtractions.findBySource({ kind: 'run', runId: 'ghost-run' }, hash),
    ).toBeUndefined();
    expect(store.memoryExtractions.get('ghost-job')).toBeUndefined();
    // 快照原样读回，判定不靠二次加工。
    expect(first.job.fragments).toEqual(fragments('同一轮回答'));
  });

  it('refuses jobs whose source is not owned by the stated task and workspace', () => {
    const store = openStore();
    const mine = newSource(store, '本空间任务');
    const yours = newSource(store, '他空间任务');

    expect(() =>
      store.memoryExtractions.enqueue(jobInput(mine, '串空间', { taskId: yours.taskId })),
    ).toThrow(/来源任务不属于该工作空间/u);
    expect(() =>
      store.memoryExtractions.enqueue(jobInput(mine, '串任务', { taskId: 'task-ghost' })),
    ).toThrow(/任务不存在/u);
    expect(() =>
      store.memoryExtractions.enqueue(
        jobInput(mine, '串运行', { source: { kind: 'run', runId: yours.source.runId } }),
      ),
    ).toThrow(/来源运行不属于该任务/u);
    expect(() =>
      store.memoryExtractions.enqueue(
        jobInput(mine, '幽灵运行', { source: { kind: 'run', runId: 'run-ghost' } }),
      ),
    ).toThrow(/来源运行不存在/u);
    expect(() =>
      store.memoryExtractions.enqueue(
        jobInput(mine, '幽灵节点', { source: { kind: 'checkpoint', checkpointId: 'cp-ghost' } }),
      ),
    ).toThrow(/来源讨论节点不存在/u);
    expect(store.memoryExtractions.countByStatus([])).toBe(0);
    expect(store.memoryExtractions.countByStatus(['queued'])).toBe(0);
  });

  it('caps the global queue and runs only one job at a time', () => {
    const store = openStore();
    const fixture = newSource(store, '满载空间');
    for (let index = 0; index < MEMORY_EXTRACTION_QUEUE_LIMIT; index += 1) {
      expect(
        store.memoryExtractions.enqueue(
          jobInput(fixture, `第 ${index} 轮`, { at: T_BASE + 1_000 + index }),
        ).effect,
      ).toBe('created');
    }
    expect(store.memoryExtractions.queuedCount()).toBe(MEMORY_EXTRACTION_QUEUE_LIMIT);
    expect(() => store.memoryExtractions.enqueue(jobInput(fixture, '溢出的一轮'))).toThrow(
      MemoryQueueFullError,
    );
    expect(store.memoryExtractions.queuedCount()).toBe(MEMORY_EXTRACTION_QUEUE_LIMIT);

    const oldest = store.memoryExtractions.findBySource(fixture.source, sha256Hex('第 0 轮'));
    expect(oldest).toBeDefined();
    const claimed = claimRunning(store, oldest?.id ?? '');
    expect(claimed.status).toBe('running');
    expect(claimed.startedAt).toBe(T_BASE + 2_000);
    // 全局并发 1：还有 19 条排队，也不允许第二条同时进入 running。
    expect(store.memoryExtractions.claimNext(T_BASE + 3_000)).toBeUndefined();
    expect(store.memoryExtractions.runningCount()).toBe(1);
    expect(store.memoryExtractions.queuedCount()).toBe(MEMORY_EXTRACTION_QUEUE_LIMIT - 1);

    store.memoryExtractions.fail({
      jobId: claimed.id,
      expectedRevision: 1,
      expectedAttempt: 1,
      errorCode: 'MODEL_REQUEST_FAILED',
      at: T_BASE + 4_000,
    });
    expect(store.memoryExtractions.runningCount()).toBe(0);
    const next = store.memoryExtractions.claimNext(T_BASE + 5_000);
    expect(next?.sourceKey).toBe(extractionSourceKey(fixture.source, sha256Hex('第 1 轮')));
    expect(next?.status).toBe('running');
  });

  it('rejects a late result that does not match revision, attempt and status', () => {
    const store = openStore();
    const fixture = newSource(store, '迟到结果');
    const job = enqueue(store, fixture, '一次成功');
    claimRunning(store, job.id);

    expect(() =>
      store.memoryExtractions.succeed({
        jobId: job.id,
        expectedRevision: 1,
        expectedAttempt: 2,
        outcome: outcomeOf(2),
        outputCodePoints: 120,
        at: T_BASE + 6_000,
      }),
    ).toThrow(MemoryJobStateConflictError);
    expect(() =>
      store.memoryExtractions.succeed({
        jobId: job.id,
        expectedRevision: 9,
        expectedAttempt: 1,
        outcome: outcomeOf(2),
        outputCodePoints: 120,
        at: T_BASE + 6_000,
      }),
    ).toThrow(/作业状态已变化/u);
    expect(store.memoryExtractions.get(job.id)?.status).toBe('running');

    const succeeded = store.memoryExtractions.succeed({
      jobId: job.id,
      expectedRevision: 1,
      expectedAttempt: 1,
      outcome: outcomeOf(2),
      outputCodePoints: 120,
      usage: { promptTokens: 800, completionTokens: 120, totalTokens: 920 },
      at: T_BASE + 6_000,
    });
    expect(succeeded.status).toBe('succeeded');
    expect(succeeded.revision).toBe(2);
    expect(succeeded.outcome).toEqual(outcomeOf(2));
    expect(succeeded.usage).toEqual({ promptTokens: 800, completionTokens: 120, totalTokens: 920 });
    expect(succeeded.finishedAt).toBe(T_BASE + 6_000);

    // 成功之后既不能再补终态，也不允许被错误码污染。
    expect(() =>
      store.memoryExtractions.cancel({
        jobId: job.id,
        expectedRevision: 2,
        expectedAttempt: 1,
        errorCode: 'CANCELLED',
        at: T_BASE + 7_000,
      }),
    ).toThrow(MemoryJobStateConflictError);
    expect(store.memoryExtractions.get(job.id)?.errorCode).toBeUndefined();
  });

  it('retries only from a non-success terminal state and bumps the attempt', () => {
    const store = openStore();
    const fixture = newSource(store, '重试空间');
    const job = enqueue(store, fixture, '一次失败');

    expect(() =>
      store.memoryExtractions.retry({
        jobId: 'job-ghost',
        expectedRevision: 1,
        consentVersion: 2,
      }),
    ).toThrow(/作业不存在/u);
    // queued 还没跑过，重试没有意义。
    expect(() =>
      store.memoryExtractions.retry({ jobId: job.id, expectedRevision: 1, consentVersion: 2 }),
    ).toThrow(/状态的作业不能重试/u);

    claimRunning(store, job.id);
    store.memoryExtractions.fail({
      jobId: job.id,
      expectedRevision: 1,
      expectedAttempt: 1,
      errorCode: 'TIMEOUT',
      at: T_BASE + 8_000,
    });
    expect(() =>
      store.memoryExtractions.retry({ jobId: job.id, expectedRevision: 1, consentVersion: 2 }),
    ).toThrow(MemoryConflictError);

    const retried = store.memoryExtractions.retry({
      jobId: job.id,
      expectedRevision: 2,
      consentVersion: 2,
      at: T_BASE + 9_000,
    });
    expect(retried.status).toBe('queued');
    expect(retried.attempt).toBe(2);
    expect(retried.revision).toBe(3);
    expect(retried.trigger).toBe('manual-retry');
    expect(retried.consentRevision).toBe(2);
    expect(retried.errorCode).toBeUndefined();
    expect(retried.startedAt).toBeUndefined();
    expect(retried.finishedAt).toBeUndefined();
    expect(store.memoryExtractions.queuedCount()).toBe(1);
  });

  it('interrupts leftover active jobs at startup and leaves terminal ones alone', () => {
    const store = openStore();
    const fixture = newSource(store, '重启空间');
    const running = enqueue(store, fixture, '跑到一半', { at: T_BASE + 1 });
    const queued = enqueue(store, fixture, '还在排队', { at: T_BASE + 2 });
    const skipped = enqueue(store, fixture, '条件不满足', { at: T_BASE + 3 });
    claimRunning(store, running.id);
    store.memoryExtractions.markSkipped({
      jobId: skipped.id,
      expectedRevision: 1,
      expectedAttempt: 1,
      at: T_BASE + 2_500,
    });

    expect(store.memoryExtractions.interruptLeftoverJobs(T_BASE + 10_000)).toBe(2);
    const interrupted = store.memoryExtractions.get(running.id);
    expect(interrupted?.status).toBe('interrupted');
    expect(interrupted?.errorCode).toBe('INTERRUPTED');
    expect(interrupted?.revision).toBe(2);
    expect(store.memoryExtractions.get(queued.id)?.status).toBe('interrupted');
    expect(store.memoryExtractions.get(skipped.id)?.status).toBe('skipped');
    expect(store.memoryExtractions.get(skipped.id)?.errorCode).toBeUndefined();
    // 收口是幂等的：第二次没有可收的作业。
    expect(store.memoryExtractions.interruptLeftoverJobs(T_BASE + 11_000)).toBe(0);
    expect(store.memoryExtractions.runningCount()).toBe(0);
    expect(store.memoryExtractions.queuedCount()).toBe(0);
  });

  it('pages desensitized job summaries for one workspace', () => {
    const store = openStore();
    const here = newSource(store, '列表空间');
    const elsewhere = newSource(store, '对照空间');
    const first = enqueue(store, here, '第一条', { at: T_BASE + 1 });
    enqueue(store, here, '第二条', { at: T_BASE + 2 });
    enqueue(store, here, '第三条', { at: T_BASE + 3 });
    enqueue(store, elsewhere, '别处的一条');
    const claimed = store.memoryExtractions.claimNext(T_BASE + 4);
    expect(claimed?.id).toBe(first.id);
    store.memoryExtractions.succeed({
      jobId: first.id,
      expectedRevision: 1,
      expectedAttempt: 1,
      outcome: outcomeOf(2),
      outputCodePoints: 90,
      at: T_BASE + 5,
    });

    const page = store.memoryExtractions.listPage({ workspaceId: here.workspaceId, limit: 2 });
    expect(page.items).toHaveLength(2);
    // updated_at 倒序：刚成功的那条排在最前。
    expect(page.items.map((item) => item.updatedAt)).toEqual([T_BASE + 5, T_BASE + 3]);
    expect(page.items[0]?.candidateCount).toBe(2);
    expect(page.items[1]?.candidateCount).toBe(0);
    const lastOnPage = page.items[1];
    expect(lastOnPage).toBeDefined();

    const secondPage = store.memoryExtractions.listPage({
      workspaceId: here.workspaceId,
      limit: 2,
      ...(lastOnPage
        ? { cursor: { version: 1, updatedAt: lastOnPage.updatedAt, id: lastOnPage.id } }
        : {}),
    });
    expect(secondPage.items.map((item) => item.updatedAt)).toEqual([T_BASE + 2]);
    expect(secondPage.nextCursor).toBeUndefined();
    expect(page.nextCursor).toEqual({ version: 1, updatedAt: T_BASE + 3, id: lastOnPage?.id });

    const byTask = store.memoryExtractions.listPage({
      workspaceId: here.workspaceId,
      taskId: here.taskId,
      limit: 10,
    });
    expect(byTask.items).toHaveLength(3);
    expect(JSON.stringify(byTask.items)).not.toContain(SECRET_FRAGMENT_TEXT);
    expect(JSON.stringify(byTask.items)).not.toContain(stableStringifyJson(fragments('第一条')));
    for (const item of byTask.items) {
      expect(item).not.toHaveProperty('fragments');
      expect(item).not.toHaveProperty('sourceVersionHash');
      expect(item).not.toHaveProperty('modelSnapshot');
      expect(item.source).toEqual(here.source);
    }
    expect(
      store.memoryExtractions.listPage({
        workspaceId: elsewhere.workspaceId,
        taskId: here.taskId,
      }).items,
    ).toEqual([]);
  });
});
