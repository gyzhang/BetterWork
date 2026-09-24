// @vitest-environment jsdom

import type {
  KnowledgeJobDetail,
  KnowledgeJobPage,
  KnowledgeJobSummary,
  KnowledgeSearchSettings,
} from '@betterwork/agent-protocol';
import { act, renderHook } from '@testing-library/react';
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
  };
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
  };
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { knowledge },
  });
  return { events, unsubscribe, knowledge };
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
