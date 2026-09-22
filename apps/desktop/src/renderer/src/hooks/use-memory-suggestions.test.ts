// @vitest-environment jsdom

import type {
  CancelMemoryJobRequest,
  GetMemorySettingsRequest,
  ListMemoriesRequest,
  ListMemoryJobsRequest,
  MemoryJobSummary,
  MemorySettingsData,
  RetryMemoryJobRequest,
  SetMemorySettingsRequest,
  WorkspaceMemorySettings,
} from '@betterwork/agent-protocol';
import { act, renderHook } from '@testing-library/react';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isActiveMemoryJob } from '../lib/memory-labels';
import { MEMORY_CONSENT_VERSION } from '../lib/memory-suggestions';
import { useMemorySuggestions } from './use-memory-suggestions';

/**
 * 自动建议开关与作业轮询（WM11，产品设计 §3.3）。
 *
 * 界面必须守住的四条：不可见时既不发请求也不轮询；开启必须带当前同意版本；
 * 关闭只收回活动作业、不动已确认记忆；手动重试只授权这一次调用。
 * 「0 条」与失败分别是成功与失败，措辞在 `lib/memory-suggestions.ts`，这里只看请求形状与结果。
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const job = (overrides: Partial<MemoryJobSummary>): MemoryJobSummary => ({
  id: 'job-1',
  workspaceId: 'workspace-1',
  taskId: 'task-1',
  source: { kind: 'run', runId: 'run-1' },
  status: 'running',
  revision: 1,
  attempt: 1,
  trigger: 'automatic',
  candidateCount: 0,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const settingsOf = (overrides?: Partial<WorkspaceMemorySettings>): WorkspaceMemorySettings => ({
  workspaceId: 'workspace-1',
  revision: 2,
  autoSuggestEnabled: false,
  updatedAt: 1,
  ...overrides,
});

interface MemoryApi {
  getSettings: Mock<(input: GetMemorySettingsRequest) => Promise<unknown>>;
  setSettings: Mock<(input: SetMemorySettingsRequest) => Promise<unknown>>;
  listJobs: Mock<(input: ListMemoryJobsRequest) => Promise<unknown>>;
  list: Mock<(input: ListMemoriesRequest) => Promise<unknown>>;
  cancelJob: Mock<(input: CancelMemoryJobRequest) => Promise<unknown>>;
  retryJob: Mock<(input: RetryMemoryJobRequest) => Promise<unknown>>;
}

const ok = <TData>(data: TData) => ({ ok: true as const, data, warnings: [] });

/**
 * 一个最小的「Main 侧」替身：设置与作业都存在闭包里，关闭开关时活动作业被取消、
 * 打开时记录同意版本。用有语义的替身而不是固定返回值，才能区分界面的错与测试自己的错。
 */
const install = (
  overrides: Partial<MemoryApi> = {},
  initial: { settings?: WorkspaceMemorySettings; jobs?: MemoryJobSummary[] } = {},
): MemoryApi => {
  const stored = initial.settings ?? settingsOf({ revision: 4 });
  let enabled = stored.autoSuggestEnabled;
  let jobs = initial.jobs ?? [];

  const currentSettings = (): WorkspaceMemorySettings => ({
    ...stored,
    autoSuggestEnabled: enabled,
    ...(enabled ? { consentVersion: MEMORY_CONSENT_VERSION } : {}),
  });

  const api: MemoryApi = {
    getSettings: vi.fn(async () => ok(currentSettings())),
    setSettings: vi.fn(async (input: SetMemorySettingsRequest) => {
      const cancelled = input.autoSuggestEnabled
        ? 0
        : jobs.filter((item) => isActiveMemoryJob(item.status)).length;
      enabled = input.autoSuggestEnabled;
      if (!enabled) jobs = jobs.filter((item) => !isActiveMemoryJob(item.status));
      const data: MemorySettingsData = {
        receipt: {
          operationId: input.operationId,
          commit: 'committed',
          effect: 'updated',
          committedRevisionIds: [],
          projectionState: 'synced',
          currentSettings: { ...currentSettings(), revision: input.expectedRevision + 1 },
        },
        cancelledJobCount: cancelled,
      };
      return ok(data);
    }),
    listJobs: vi.fn(async () => ok({ items: jobs })),
    list: vi.fn(async () => ok({ items: [] })),
    cancelJob: vi.fn(async (input: CancelMemoryJobRequest) => {
      jobs = jobs.map((item) =>
        item.id === input.jobId ? { ...item, status: 'cancelled' as const } : item,
      );
      return ok(job({ id: input.jobId, status: 'cancelled' }));
    }),
    retryJob: vi.fn(async (input: RetryMemoryJobRequest) => {
      jobs = [
        ...jobs,
        job({ id: `${input.jobId}-retry`, status: 'queued', trigger: 'manual-retry' }),
      ];
      return ok(job({ id: input.jobId, status: 'queued', trigger: 'manual-retry' }));
    }),
    ...overrides,
  };
  Object.defineProperty(window, 'betterwork', { configurable: true, value: { memories: api } });
  return api;
};

/** 把一次作用域装载要走的三条读取全部跑完。 */
const settle = async (): Promise<void> => {
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
};

const query = { workspaceId: 'workspace-1', visible: true, taskId: undefined };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'betterwork');
});

describe('useMemorySuggestions', () => {
  it('面板不可见时既不发请求也不启动轮询', async () => {
    const api = install();
    act(() => {
      renderHook(() => useMemorySuggestions({ ...query, visible: false }));
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(api.getSettings).not.toHaveBeenCalled();
    expect(api.listJobs).not.toHaveBeenCalled();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('可见时一次装载设置、作业与本空间候选', async () => {
    const api = install();
    const { result } = renderHook(() => useMemorySuggestions(query));
    await settle();
    expect(api.getSettings).toHaveBeenCalledTimes(1);
    expect(api.listJobs).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
    expect(api.list).toHaveBeenCalledWith({ workspaceId: 'workspace-1', statuses: ['candidate'] });
    expect(result.current.settings?.autoSuggestEnabled).toBe(false);
    expect(result.current.settingsError).toBe('');
    expect(result.current.polling).toBe(false);
  });

  it('开启自动建议必须带当前同意版本与设置修订', async () => {
    const api = install();
    const { result } = renderHook(() => useMemorySuggestions(query));
    await settle();

    await act(async () => {
      await result.current.setAutoSuggest(true);
      vi.advanceTimersByTime(1);
    });

    expect(api.setSettings.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: 'workspace-1',
      expectedRevision: 4,
      autoSuggestEnabled: true,
      consentVersion: MEMORY_CONSENT_VERSION,
    });
    expect(result.current.settings?.autoSuggestEnabled).toBe(true);
    expect(result.current.settings?.consentVersion).toBe(MEMORY_CONSENT_VERSION);
    expect(result.current.savingSettings).toBe(false);
    expect(result.current.toast?.tone).toBe('success');
    expect(result.current.toast?.message).toContain('不回填旧任务');
  });

  it('关闭不带同意版本，只收回活动作业，已确认记忆与历史候选不动', async () => {
    const api = install(
      {},
      {
        settings: settingsOf({ autoSuggestEnabled: true, consentVersion: MEMORY_CONSENT_VERSION }),
        jobs: [
          job({ id: 'job-active', status: 'running' }),
          job({ id: 'job-done', status: 'succeeded', candidateCount: 1 }),
        ],
      },
    );
    const { result } = renderHook(() => useMemorySuggestions(query));
    await settle();
    expect(result.current.jobs.map((item) => item.id)).toEqual(['job-active', 'job-done']);

    await act(async () => {
      await result.current.setAutoSuggest(false);
      vi.advanceTimersByTime(1);
    });

    const input = api.setSettings.mock.calls[0]?.[0];
    expect(input?.autoSuggestEnabled).toBe(false);
    expect(input).not.toHaveProperty('consentVersion');
    expect(result.current.settings?.autoSuggestEnabled).toBe(false);
    expect(result.current.jobs.map((item) => item.id)).toEqual(['job-done']);
    expect(result.current.toast?.message).toContain('取消 1 项未完成的提炼');
    expect(result.current.toast?.message).toContain('已确认记忆保留');
  });

  it('有活动作业时按秒轮询，作业结束后停止轮询', async () => {
    const api = install({}, { jobs: [job({ id: 'job-active', status: 'running' })] });
    const { result } = renderHook(() => useMemorySuggestions(query));
    await settle();
    expect(result.current.polling).toBe(true);
    const loaded = api.listJobs.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(api.listJobs.mock.calls.length).toBe(loaded + 1);

    await act(async () => {
      await result.current.cancelJob(job({ id: 'job-active', status: 'running' }));
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.polling).toBe(false);
    const settled = api.listJobs.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(api.listJobs.mock.calls.length).toBe(settled);
  });

  it('手动重试只授权这一次作业，不改动自动开关', async () => {
    const api = install();
    const { result } = renderHook(() => useMemorySuggestions(query));
    await settle();

    await act(async () => {
      await result.current.retryJob(job({ id: 'job-failed', status: 'failed', revision: 3 }));
      vi.advanceTimersByTime(1);
    });

    expect(api.retryJob).toHaveBeenCalledWith({
      operationId: expect.stringMatching(UUID_PATTERN),
      jobId: 'job-failed',
      expectedRevision: 3,
      consentVersion: MEMORY_CONSENT_VERSION,
    });
    expect(api.setSettings).not.toHaveBeenCalled();
    expect(result.current.settings?.autoSuggestEnabled).toBe(false);
    expect(result.current.toast?.message).toBe('重新提炼已提交。');
  });

  it('取消作业的领域失败也要让用户当场看见，不静默吞掉', async () => {
    const api = install({
      cancelJob: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'INVALID_TRANSITION' as const, message: '作业已经结束。', retryable: false },
      })),
    });
    const { result } = renderHook(() => useMemorySuggestions(query));
    await settle();

    await act(async () => {
      await result.current.cancelJob(job({ id: 'job-1' }));
      vi.advanceTimersByTime(1);
    });

    expect(api.cancelJob.mock.calls[0]?.[0]).toMatchObject({ jobId: 'job-1', expectedRevision: 1 });
    expect(result.current.toast).toMatchObject({ tone: 'error', message: '作业已经结束。' });
  });

  it('切换空间先清空旧状态再按新空间取数', async () => {
    const seen: string[] = [];
    const api = install({
      getSettings: vi.fn(async (input: GetMemorySettingsRequest) => {
        seen.push(input.workspaceId);
        return ok(settingsOf({ workspaceId: input.workspaceId }));
      }),
    });
    const { rerender, result } = renderHook(
      ({ workspaceId }: { workspaceId: string }) => useMemorySuggestions({ ...query, workspaceId }),
      { initialProps: { workspaceId: 'workspace-1' } },
    );
    await settle();
    expect(result.current.settings?.workspaceId).toBe('workspace-1');
    rerender({ workspaceId: 'workspace-2' });
    await settle();

    expect(seen).toEqual(['workspace-1', 'workspace-2']);
    expect(result.current.settings?.workspaceId).toBe('workspace-2');
    expect(api.listJobs).toHaveBeenCalledTimes(2);
  });
});
