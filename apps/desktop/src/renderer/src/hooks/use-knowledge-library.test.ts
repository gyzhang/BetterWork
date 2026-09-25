// @vitest-environment jsdom

import type {
  KnowledgeCursor,
  KnowledgeDocumentSummary,
  KnowledgeJobDetail,
  KnowledgeJobPage,
  KnowledgeJobSummary,
  KnowledgeRevisionSummary,
  KnowledgeSearchHit,
  KnowledgeSearchResponse,
  KnowledgeSearchSettings,
  KnowledgeTextPage,
  ModelProfileSummary,
} from '@betterwork/agent-protocol';
import { act, renderHook } from '@testing-library/react';
import type { FormEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useKnowledgeLibrary } from './use-knowledge-library';

/**
 * 资料库 Hook 的作业接线（KM07a，契约 §8）。
 *
 * 只验界面侧纪律：回执先给「已提交」的即时反馈，终态事件才回填结果与逐条目失败；
 * 未跟踪的作业事件不得污染界面；卸载必须退订。
 */

const jobOf = (overrides: Partial<KnowledgeJobSummary>): KnowledgeJobSummary => ({
  id: 'job-1',
  kind: 'import',
  status: 'running',
  attempt: 1,
  sequence: 2,
  totalCount: 1,
  completedCount: 0,
  failedCount: 0,
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

const detailOf = (job: KnowledgeJobSummary): KnowledgeJobDetail => ({
  job,
  items: [
    {
      id: 'item-1',
      jobId: job.id,
      fileName: '合同条款.md',
      status: 'succeeded',
      phase: 'publish',
      attempt: 1,
      completedUnits: 1,
    },
  ],
});

const failedItemDetail = (): KnowledgeJobDetail => ({
  job: jobOf({
    kind: 'refresh',
    status: 'partial',
    completedCount: 1,
    failedCount: 1,
    totalCount: 2,
  }),
  items: [
    {
      id: 'item-1',
      jobId: 'job-1',
      fileName: '合同条款.md',
      status: 'succeeded',
      phase: 'publish',
      attempt: 1,
      completedUnits: 1,
    },
    {
      id: 'item-2',
      jobId: 'job-1',
      fileName: '损坏材料.docx',
      status: 'failed',
      phase: 'extract',
      attempt: 1,
      completedUnits: 0,
      failure: { code: 'INDEX_ITEM_FAILED', message: '解析失败' },
    },
  ],
});

const searchHit = (overrides: Partial<KnowledgeSearchHit> = {}): KnowledgeSearchHit => ({
  chunkId: 'chunk-1',
  reference: {
    kind: 'knowledge-revision',
    knowledgeDocumentId: 'doc-1',
    knowledgeRevisionId: 'rev-1',
    contentHash: 'b'.repeat(64),
    sourcePath: '/tmp/合同条款.md',
  },
  textHash: 'c'.repeat(64),
  title: '合同条款',
  format: 'markdown',
  locator: '全文',
  span: { sectionOrdinal: 0, start: 0, end: 12 },
  excerpt: '违约金上限为合同金额的',
  excerptHash: 'd'.repeat(64),
  matchedBy: 'keyword',
  ...overrides,
});

const searchResponse = (
  overrides: Partial<KnowledgeSearchResponse> = {},
): KnowledgeSearchResponse => ({
  results: [searchHit()],
  requestedMode: 'hybrid',
  effectiveMode: 'keyword',
  coverage: { eligibleChunks: 1, indexedChunks: 0 },
  durationMs: 3,
  ...overrides,
});

const documentOf = (
  overrides: Partial<KnowledgeDocumentSummary> = {},
): KnowledgeDocumentSummary => ({
  id: 'doc-1',
  title: '合同条款',
  sourcePath: '/tmp/合同条款.md',
  format: 'markdown',
  byteSize: 24,
  contentHash: 'a'.repeat(64),
  sourceStatus: 'unchanged',
  sourceCheckedAt: 5,
  lexicalState: 'ready',
  semanticState: 'disabled',
  importedAt: 1,
  updatedAt: 2,
  ...overrides,
});

const revisionOf = (
  overrides: Partial<KnowledgeRevisionSummary> = {},
): KnowledgeRevisionSummary => ({
  id: 'rev-2',
  documentId: 'doc-1',
  revision: 2,
  title: '合同条款',
  sourcePath: '/tmp/合同条款.md',
  format: 'markdown',
  byteSize: 24,
  contentHash: 'b'.repeat(64),
  parserVersion: 'text-extract-v1',
  chunkingVersion: 'format-locator-v1',
  textHash: 'c'.repeat(64),
  sectionCount: 1,
  warnings: [],
  importedAt: 1,
  createdAt: 2,
  ...overrides,
});

const nextPageCursor: KnowledgeCursor = {
  revisionId: 'rev-2',
  textHash: 'c'.repeat(64),
  sectionOrdinal: 0,
  offset: 5,
};

const textPage = (overrides: Partial<KnowledgeTextPage> = {}): KnowledgeTextPage => ({
  reference: {
    kind: 'knowledge-revision',
    knowledgeDocumentId: 'doc-1',
    knowledgeRevisionId: 'rev-2',
    contentHash: 'b'.repeat(64),
    sourcePath: '/tmp/合同条款.md',
  },
  textHash: 'c'.repeat(64),
  title: '合同条款',
  parserVersion: 'text-extract-v1',
  chunkingVersion: 'format-locator-v1',
  warnings: [],
  parts: [
    {
      span: { sectionOrdinal: 0, start: 0, end: 5 },
      locator: '全文',
      text: '第一段保存文本',
      excerptHash: 'd'.repeat(64),
    },
  ],
  returnedCodePoints: 7,
  complete: true,
  ...overrides,
});

interface Harness {
  events: ((job: KnowledgeJobSummary) => void)[];
  unsubscribe: ReturnType<typeof vi.fn>;
  knowledge: {
    list: ReturnType<typeof vi.fn>;
    importFromDialog: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    job: ReturnType<typeof vi.fn>;
    jobs: ReturnType<typeof vi.fn>;
    onJobEvent: ReturnType<typeof vi.fn>;
    settings: ReturnType<typeof vi.fn>;
    saveSettings: ReturnType<typeof vi.fn>;
    rebuildIndex: ReturnType<typeof vi.fn>;
    checkSources: ReturnType<typeof vi.fn>;
    retryJob: ReturnType<typeof vi.fn>;
    cancelJob: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    listRevisions: ReturnType<typeof vi.fn>;
    preview: ReturnType<typeof vi.fn>;
  };
  models: { list: ReturnType<typeof vi.fn> };
}

const install = (): Harness => {
  const events: ((job: KnowledgeJobSummary) => void)[] = [];
  const unsubscribe = vi.fn();
  const knowledge = {
    list: vi.fn(async () => []),
    importFromDialog: vi.fn(async () => ({ cancelled: false, jobId: 'job-1' })),
    refresh: vi.fn(async () => ({ jobId: 'job-1' })),
    job: vi.fn(async ({ jobId }: { jobId: string }) =>
      detailOf(jobOf({ id: jobId, status: 'succeeded', completedCount: 1 })),
    ),
    jobs: vi.fn(async (): Promise<KnowledgeJobPage> => ({ jobs: [] })),
    onJobEvent: vi.fn((listener: (job: KnowledgeJobSummary) => void) => {
      events.push(listener);
      return unsubscribe;
    }),
    settings: vi.fn(async (): Promise<KnowledgeSearchSettings> => ({
      semanticEnabled: false,
      revision: 1,
      embeddingAvailable: false,
    })),
    saveSettings: vi.fn(async () => ({
      semanticEnabled: false,
      revision: 2,
      embeddingAvailable: false,
    })),
    rebuildIndex: vi.fn(async () => ({ jobId: 'job-2' })),
    checkSources: vi.fn(async () => ({ jobId: 'job-3' })),
    retryJob: vi.fn(async () => ({ jobId: 'job-4' })),
    cancelJob: vi.fn(async () => ({ cancelled: true })),
    search: vi.fn(async () => searchResponse()),
    listRevisions: vi.fn(async () => [revisionOf()]),
    preview: vi.fn(async () => textPage()),
  };
  const models = { list: vi.fn(async () => []) };
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { knowledge, models },
  });
  return { events, unsubscribe, knowledge, models };
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
});

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('useKnowledgeLibrary 作业接线', () => {
  it('取消导入对话框只给即时确认，不跟踪作业', async () => {
    const harness = install();
    harness.knowledge.importFromDialog.mockResolvedValueOnce({ cancelled: true });
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    await act(async () => {
      await result.current.onImport();
    });
    expect(result.current.message).toBe('已取消导入，未选择文件。');
    expect(result.current.issues).toEqual([]);
    // 后续任何终态事件都不应触发回读。
    await act(async () => {
      harness.events[0]?.(jobOf({ status: 'succeeded' }));
      await Promise.resolve();
    });
    expect(harness.knowledge.job).not.toHaveBeenCalled();
  });

  it('导入回执先报已提交，终态事件后回填完成文案', async () => {
    const harness = install();
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    await act(async () => {
      await result.current.onImport();
    });
    expect(result.current.message).toBe('已提交导入作业，索引正在后台建立。');
    // 排队/运行中的事件不回填结果。
    await act(async () => {
      harness.events[0]?.(jobOf({ status: 'queued' }));
      harness.events[0]?.(jobOf({ status: 'running' }));
      await Promise.resolve();
    });
    expect(harness.knowledge.job).not.toHaveBeenCalled();
    await act(async () => {
      harness.events[0]?.(jobOf({ status: 'succeeded', completedCount: 1 }));
      await Promise.resolve();
    });
    expect(harness.knowledge.job).toHaveBeenCalledWith({ jobId: 'job-1' });
    await flush();
    expect(result.current.message).toBe('资料导入完成（1/1）。');
  });

  it('刷新作业部分完成时把逐条目失败回填到 issues', async () => {
    const harness = install();
    harness.knowledge.job.mockResolvedValueOnce(failedItemDetail());
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    await act(async () => {
      await result.current.onRefresh({
        id: 'doc-1',
        title: '合同条款',
        format: 'markdown',
        byteSize: 10,
        contentHash: 'a'.repeat(64),
        sourceStatus: 'unchanged',
        lexicalState: 'ready',
        semanticState: 'disabled',
        sourcePath: '/tmp/合同条款.md',
        importedAt: 1,
        updatedAt: 2,
      });
    });
    expect(result.current.message).toContain('刷新作业');
    await act(async () => {
      harness.events[0]?.(
        jobOf({
          kind: 'refresh',
          status: 'partial',
          completedCount: 1,
          failedCount: 1,
          totalCount: 2,
        }),
      );
      await Promise.resolve();
    });
    await flush();
    expect(result.current.message).toBe('资料刷新部分完成（1/2）。');
    expect(result.current.issues).toEqual(['损坏材料.docx：解析失败']);
  });

  it('非跟踪作业的事件被忽略，卸载会退订事件流', async () => {
    const harness = install();
    const { unmount } = renderHook(() => useKnowledgeLibrary());
    await flush();
    await act(async () => {
      harness.events[0]?.(jobOf({ id: 'other-job', status: 'succeeded' }));
      await Promise.resolve();
    });
    expect(harness.knowledge.job).not.toHaveBeenCalled();
    unmount();
    expect(harness.unsubscribe).toHaveBeenCalled();
  });
});

describe('useKnowledgeLibrary 统一检索（KM08）', () => {
  const submit = { preventDefault: (): void => undefined } as unknown as FormEvent<HTMLFormElement>;

  it('检索响应按命中条目落地，携带精确修订身份', async () => {
    const harness = install();
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    await act(async () => {
      result.current.setQuery('违约金');
    });
    await act(async () => {
      await result.current.onSearch(submit);
    });
    expect(harness.knowledge.search).toHaveBeenCalledWith({ query: '违约金' });
    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0]).toMatchObject({
      chunkId: 'chunk-1',
      matchedBy: 'keyword',
      reference: { knowledgeRevisionId: 'rev-1' },
    });
  });

  it('语义降级时给出内联解释而不是静默返回', async () => {
    const harness = install();
    harness.knowledge.search.mockResolvedValueOnce(
      searchResponse({ degradedReason: 'index-partial' }),
    );
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    await act(async () => {
      result.current.setQuery('违约金');
    });
    await act(async () => {
      await result.current.onSearch(submit);
    });
    expect(result.current.message).toContain('本次检索以关键词为主（index-partial）');
    expect(result.current.results).toHaveLength(1);
  });

  it('检索失败把主进程错误落到内联消息', async () => {
    const harness = install();
    harness.knowledge.search.mockRejectedValueOnce(new Error('检索服务暂不可用。'));
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    await act(async () => {
      result.current.setQuery('违约金');
    });
    await act(async () => {
      await result.current.onSearch(submit);
    });
    expect(result.current.message).toBe('检索服务暂不可用。');
  });
});

const embeddingModel = (): ModelProfileSummary => ({
  id: 'm-embed',
  name: '向量服务',
  provider: 'openai-compatible',
  baseUrl: 'https://embed.test/v1',
  model: 'embed-v1',
  role: 'embedding',
  apiKeyConfigured: true,
  enabled: true,
  priority: 0,
  connectionStatus: 'connected',
  maxContextTokens: 8192,
  maxOutputTokens: 8192,
  temperature: 0,
  createdAt: 1,
  updatedAt: 1,
});

const availableSettings = (): KnowledgeSearchSettings => ({
  semanticEnabled: false,
  revision: 1,
  embeddingAvailable: true,
});

describe('useKnowledgeLibrary 索引管理界面接线（KM09）', () => {
  it('作业事件按 sequence 单调合并，终态后从进行中面板移除', async () => {
    const harness = install();
    harness.knowledge.jobs.mockResolvedValueOnce({
      jobs: [jobOf({ id: 'job-run', status: 'running', sequence: 3, completedCount: 1 })],
    });
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    expect(result.current.activeJobs.map((job) => job.sequence)).toEqual([3]);
    // 乱序迟到（sequence 更小）不回退面板。
    await act(async () => {
      harness.events[0]?.(jobOf({ id: 'job-run', status: 'running', sequence: 2 }));
      await Promise.resolve();
    });
    expect(result.current.activeJobs.map((job) => job.sequence)).toEqual([3]);
    await act(async () => {
      harness.events[0]?.(jobOf({ id: 'job-run', status: 'running', sequence: 4 }));
      await Promise.resolve();
    });
    expect(result.current.activeJobs.map((job) => job.sequence)).toEqual([4]);
    await act(async () => {
      harness.events[0]?.(
        jobOf({ id: 'job-run', status: 'succeeded', sequence: 5, completedCount: 1 }),
      );
      await Promise.resolve();
    });
    expect(result.current.activeJobs).toEqual([]);
    // 面板挂载的作业同样在终态后回读结果。
    expect(harness.knowledge.job).toHaveBeenCalledWith({ jobId: 'job-run' });
  });

  it('迟到的检索响应不覆盖当前查询的结果与覆盖状态', async () => {
    const harness = install();
    let resolveLate: ((value: KnowledgeSearchResponse) => void) | undefined;
    const lateGate = new Promise<KnowledgeSearchResponse>((resolve) => {
      resolveLate = resolve;
    });
    harness.knowledge.search.mockReturnValueOnce(lateGate).mockResolvedValueOnce(
      searchResponse({
        results: [searchHit({ chunkId: 'chunk-now' })],
        effectiveMode: 'hybrid',
        coverage: { eligibleChunks: 9, indexedChunks: 4 },
      }),
    );
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    const submit = {
      preventDefault: (): void => undefined,
    } as unknown as FormEvent<HTMLFormElement>;
    let first: Promise<void> | undefined;
    await act(async () => {
      result.current.setQuery('旧查询');
    });
    await act(async () => {
      first = result.current.onSearch(submit);
    });
    await act(async () => {
      result.current.setQuery('新查询');
    });
    await act(async () => {
      await result.current.onSearch(submit);
    });
    expect(result.current.results.map((hit) => hit.chunkId)).toEqual(['chunk-now']);
    expect(result.current.searchStatus?.coverage).toEqual({ eligibleChunks: 9, indexedChunks: 4 });
    await act(async () => {
      resolveLate?.(searchResponse({ results: [searchHit({ chunkId: 'chunk-late' })] }));
      await first;
    });
    expect(result.current.results.map((hit) => hit.chunkId)).toEqual(['chunk-now']);
    expect(result.current.searchStatus?.coverage).toEqual({ eligibleChunks: 9, indexedChunks: 4 });
  });

  it('启用语义检索显式携带 profile 与 CAS 版本，且不自动补建历史索引', async () => {
    const harness = install();
    harness.knowledge.settings.mockResolvedValueOnce(availableSettings());
    harness.models.list.mockResolvedValueOnce([embeddingModel()]);
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    expect(result.current.embeddingModels.map((model) => model.id)).toEqual(['m-embed']);
    await act(async () => {
      await result.current.saveSettings({ semanticEnabled: true, embeddingProfileId: 'm-embed' });
    });
    expect(harness.knowledge.saveSettings).toHaveBeenCalledWith({
      expectedRevision: 1,
      semanticEnabled: true,
      embeddingProfileId: 'm-embed',
    });
    expect(result.current.message).toContain('历史资料需手动重建向量索引');
    expect(harness.knowledge.rebuildIndex).not.toHaveBeenCalled();
  });

  it('普通与强制重建走同一通道但载荷不同，并跟踪新作业', async () => {
    const harness = install();
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    await act(async () => {
      await result.current.rebuildSemantic(false);
    });
    expect(harness.knowledge.rebuildIndex).toHaveBeenCalledWith({ kind: 'semantic' });
    await act(async () => {
      await result.current.rebuildSemantic(true);
    });
    expect(harness.knowledge.rebuildIndex).toHaveBeenLastCalledWith({
      kind: 'semantic',
      resetSemanticSpace: true,
    });
    expect(result.current.message).toContain('旧语义索引立即停用');
    await act(async () => {
      harness.events[0]?.(jobOf({ id: 'job-2', status: 'succeeded', completedCount: 1 }));
      await Promise.resolve();
    });
    expect(harness.knowledge.job).toHaveBeenCalledWith({ jobId: 'job-2' });
  });

  it('终态作业只把失败、中断或取消的条目列为可重试', async () => {
    const harness = install();
    const detail: KnowledgeJobDetail = {
      job: jobOf({
        id: 'job-2',
        kind: 'rebuild-semantic',
        status: 'partial',
        sequence: 9,
        completedCount: 1,
        failedCount: 1,
        totalCount: 4,
      }),
      items: [
        {
          id: 'item-ok',
          jobId: 'job-2',
          fileName: '甲.md',
          status: 'succeeded',
          phase: 'publish',
          attempt: 1,
          completedUnits: 1,
        },
        {
          id: 'item-failed',
          jobId: 'job-2',
          fileName: '乙.md',
          status: 'failed',
          phase: 'embed',
          attempt: 1,
          completedUnits: 0,
          failure: { code: 'EMBEDDING_FAILED', message: '服务超时' },
        },
        {
          id: 'item-cancelled',
          jobId: 'job-2',
          fileName: '丙.md',
          status: 'cancelled',
          phase: 'embed',
          attempt: 1,
          completedUnits: 0,
        },
        {
          id: 'item-interrupted',
          jobId: 'job-2',
          fileName: '丁.md',
          status: 'interrupted',
          phase: 'embed',
          attempt: 1,
          completedUnits: 0,
        },
      ],
    };
    harness.knowledge.job.mockResolvedValueOnce(detail);
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    await act(async () => {
      await result.current.rebuildSemantic(false);
    });
    await act(async () => {
      harness.events[0]?.(detail.job);
      await Promise.resolve();
    });
    expect(result.current.retryTarget?.itemIds).toEqual([
      'item-failed',
      'item-cancelled',
      'item-interrupted',
    ]);
    await act(async () => {
      await result.current.retryFailedItems();
    });
    expect(harness.knowledge.retryJob).toHaveBeenCalledWith({
      jobId: 'job-2',
      itemIds: ['item-failed', 'item-cancelled', 'item-interrupted'],
    });
    expect(result.current.retryTarget).toBeUndefined();
  });

  it('取消已结束的作业时如实反馈而不是假装成功', async () => {
    const harness = install();
    harness.knowledge.cancelJob.mockResolvedValueOnce({ cancelled: false });
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    await act(async () => {
      await result.current.cancelJob('job-done');
    });
    expect(harness.knowledge.cancelJob).toHaveBeenCalledWith({ jobId: 'job-done' });
    expect(result.current.message).toBe('该作业已结束，无法取消。');
  });
});

describe('useKnowledgeLibrary 资料详情接线（KM10）', () => {
  const submit = {
    preventDefault: (): void => undefined,
  } as unknown as FormEvent<HTMLFormElement>;

  it('详情加载版本列表与保存文本；返回列表保留搜索条件', async () => {
    const harness = install();
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    await act(async () => {
      result.current.setQuery('续约');
    });
    await act(async () => {
      await result.current.onSearch(submit);
    });
    await act(async () => {
      await result.current.openDocument(documentOf());
    });
    expect(harness.knowledge.listRevisions).toHaveBeenCalledWith({ documentId: 'doc-1' });
    expect(harness.knowledge.preview).toHaveBeenCalledWith({
      documentId: 'doc-1',
      revisionId: 'rev-2',
    });
    expect(result.current.detailPage?.parts[0]?.text).toBe('第一段保存文本');
    await act(async () => {
      result.current.closeDocument();
    });
    expect(result.current.detailDocument).toBeUndefined();
    expect(result.current.query).toBe('续约');
    // 详情预览是纯读取通道：不回读作业，也不触发任何模型调用。
    expect(harness.knowledge.job).not.toHaveBeenCalled();
  });

  it('版本切换后旧页响应迟到不污染选中版本', async () => {
    const harness = install();
    harness.knowledge.listRevisions.mockResolvedValueOnce([
      revisionOf(),
      revisionOf({ id: 'rev-1', revision: 1 }),
    ]);
    let resolveStale: ((value: KnowledgeTextPage) => void) | undefined;
    const staleGate = new Promise<KnowledgeTextPage>((resolve) => {
      resolveStale = resolve;
    });
    harness.knowledge.preview.mockReturnValueOnce(staleGate).mockResolvedValueOnce(
      textPage({
        parts: [
          {
            span: { sectionOrdinal: 0, start: 0, end: 3 },
            locator: '全文',
            text: '旧版文本',
            excerptHash: 'e'.repeat(64),
          },
        ],
      }),
    );
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    let opening: Promise<void> | undefined;
    await act(async () => {
      opening = result.current.openDocument(documentOf());
    });
    await act(async () => {
      await result.current.selectDetailRevision('rev-1');
    });
    expect(result.current.detailRevisionId).toBe('rev-1');
    await act(async () => {
      resolveStale?.(textPage());
      await opening;
    });
    expect(result.current.detailRevisionId).toBe('rev-1');
    expect(result.current.detailPage?.parts[0]?.text).toBe('旧版文本');
  });

  it('下一页积累返回栈，上一页恢复游标', async () => {
    const harness = install();
    harness.knowledge.preview
      .mockResolvedValueOnce(textPage({ complete: false, nextCursor: nextPageCursor }))
      .mockResolvedValueOnce(
        textPage({
          parts: [
            {
              span: { sectionOrdinal: 0, start: 5, end: 8 },
              locator: '全文',
              text: '第二段保存文本',
              excerptHash: 'f'.repeat(64),
            },
          ],
        }),
      );
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    await act(async () => {
      await result.current.openDocument(documentOf());
    });
    expect(result.current.detailCanGoBack).toBe(false);
    await act(async () => {
      await result.current.loadNextDetailPage();
    });
    expect(result.current.detailPage?.parts[0]?.text).toBe('第二段保存文本');
    expect(result.current.detailCanGoBack).toBe(true);
    await act(async () => {
      await result.current.loadPreviousDetailPage();
    });
    expect(harness.knowledge.preview).toHaveBeenLastCalledWith({
      documentId: 'doc-1',
      revisionId: 'rev-2',
    });
  });

  it('来源检查提交为作业并跟踪，终态后列表与详情摘要拉回新状态', async () => {
    const harness = install();
    harness.knowledge.checkSources.mockResolvedValueOnce({ jobId: 'job-check-1' });
    const { result } = renderHook(() => useKnowledgeLibrary());
    await flush();
    await act(async () => {
      await result.current.checkDocumentSource('doc-1');
    });
    expect(harness.knowledge.checkSources).toHaveBeenCalledWith({ documentIds: ['doc-1'] });
    expect(result.current.message).toContain('已提交来源检查');
    const listCallsBefore = harness.knowledge.list.mock.calls.length;
    await act(async () => {
      harness.events[0]?.(
        jobOf({ id: 'job-check-1', kind: 'check-source', status: 'succeeded', completedCount: 1 }),
      );
      await Promise.resolve();
    });
    expect(harness.knowledge.job).toHaveBeenCalledWith({ jobId: 'job-check-1' });
    await flush();
    expect(harness.knowledge.list.mock.calls.length).toBeGreaterThan(listCallsBefore);
  });
});
