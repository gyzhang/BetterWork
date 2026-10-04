// @vitest-environment jsdom

import type {
  ScheduleChangedEvent,
  ScheduleDetail,
  SchedulePage,
  SchedulePageCursor,
} from '@betterwork/agent-protocol';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSchedules } from './use-schedules';

const detailOf = (id: string, name = '月度经营复盘'): ScheduleDetail => {
  const revision = {
    id: 'revision-1',
    expertId: 'expert-1',
    revision: 1,
    name: '经营分析专家',
    summary: '',
    author: '',
    tags: [],
    identity: '完成经营分析',
    principles: [],
    inputRequirements: [],
    deliveryRequirements: [],
    skillPreset: [],
    builtinToolPolicy: { mode: 'application-defaults' as const },
    modelReference: { mode: 'application-default' as const },
    createdAt: 1,
  };
  return {
    aggregate: {
      schedule: {
        id,
        workspaceId: 'workspace-1',
        revision: 1,
        currentConfigVersion: 1,
        lifecycle: 'paused',
        createdAt: 1,
        updatedAt: 1,
      },
      config: {
        scheduleId: id,
        version: 1,
        name,
        expertId: 'expert-1',
        expertRevisionId: 'revision-1',
        requirements: '分析上月经营数据。',
        expectedArtifactTypes: ['markdown'],
        timing: {
          frequency: 'monthly',
          day: 5,
          hour: 9,
          minute: 0,
          timeZone: 'Asia/Shanghai',
        },
        periodRule: 'previous-month',
        knowledgeSources: [],
        outputSubdirectory: '定时成果',
        createdAt: 1,
      },
    },
    expertUpdate: { boundRevision: revision, currentRevision: revision, available: false },
    history: { items: [] },
  };
};

const pageOf = (...details: ScheduleDetail[]): SchedulePage => ({
  items: details.map((detail) => detail.aggregate),
});

const changeEvent: ScheduleChangedEvent = { scheduleId: 'schedule-1', reason: 'occurrence' };

function installApi(options?: { pages?: SchedulePage[]; details?: ScheduleDetail[] }) {
  let emitChange: ((event: ScheduleChangedEvent) => void) | undefined;
  const pages = options?.pages ?? [pageOf(detailOf('schedule-1'))];
  const details = options?.details ?? [detailOf('schedule-1')];
  const list = vi.fn(async () => {
    const nextPage = pages.shift();
    return { status: 'success' as const, data: nextPage ?? { items: [] } };
  });
  const get = vi.fn(async ({ scheduleId }: { scheduleId: string }) => {
    const found = details.find((detail) => detail.aggregate.schedule.id === scheduleId);
    if (!found) {
      return {
        status: 'rejected' as const,
        error: { code: 'schedule_not_found' as const, message: '规则已不存在。' },
      };
    }
    return { status: 'success' as const, data: found };
  });
  const onChange = vi.fn((listener: (event: ScheduleChangedEvent) => void) => {
    emitChange = listener;
    return () => {
      emitChange = undefined;
    };
  });
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { schedules: { list, get, onChange } },
  });
  return { list, get, onChange, emit: (event = changeEvent): void => emitChange?.(event) };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'betterwork');
});

describe('useSchedules', () => {
  it('reads all schedule pages and their current detail facts only while the page is active', async () => {
    const cursor: SchedulePageCursor = { version: 1, createdAt: 1, id: 'schedule-1' };
    const first = detailOf('schedule-1');
    const second = detailOf('schedule-2', '周报');
    const api = installApi({
      pages: [{ ...pageOf(first), nextCursor: cursor }, pageOf(second)],
      details: [first, second],
    });
    const { result, rerender } = renderHook(({ active }) => useSchedules(active), {
      initialProps: { active: false },
    });

    expect(api.list).not.toHaveBeenCalled();
    rerender({ active: true });
    await waitFor(() => expect(result.current.details).toHaveLength(2));
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(result.current.details.map((detail) => detail.aggregate.config.name)).toEqual([
      '月度经营复盘',
      '周报',
    ]);
  });

  it('refreshes facts on a change event and ignores an older late response', async () => {
    const oldDetail = detailOf('schedule-1', '旧规则名称');
    const currentDetail = detailOf('schedule-1', '新规则名称');
    let resolveFirst: ((page: { status: 'success'; data: SchedulePage }) => void) | undefined;
    let calls = 0;
    const api = installApi({ details: [oldDetail, currentDetail] });
    api.list.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return await new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return { status: 'success' as const, data: pageOf(currentDetail) };
    });
    api.get.mockImplementationOnce(async () => ({
      status: 'success' as const,
      data: currentDetail,
    }));
    const { result } = renderHook(() => useSchedules(true));

    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    act(() => api.emit());
    await waitFor(() =>
      expect(result.current.details[0]?.aggregate.config.name).toBe('新规则名称'),
    );
    await act(async () => {
      resolveFirst?.({ status: 'success', data: pageOf(oldDetail) });
      await Promise.resolve();
    });
    expect(result.current.details[0]?.aggregate.config.name).toBe('新规则名称');
  });

  it('keeps the last successful list visible when a background refresh fails', async () => {
    const detail = detailOf('schedule-1');
    const api = installApi({ details: [detail] });
    const { result } = renderHook(() => useSchedules(true));
    await waitFor(() =>
      expect(result.current.details).toEqual([
        expect.objectContaining({ aggregate: detail.aggregate }),
      ]),
    );

    api.list.mockRejectedValueOnce(new Error('SQLite 暂时不可用'));
    act(() => api.emit());
    await waitFor(() => expect(result.current.refreshError).toBe('SQLite 暂时不可用'));
    expect(result.current.details[0]?.aggregate.config.name).toBe('月度经营复盘');
    expect(result.current.error).toBe('');
  });

  it('shows an initial read error and releases its event subscription on deactivation', async () => {
    const api = installApi();
    api.list.mockRejectedValueOnce(new Error('临时读取失败'));
    const { result, rerender } = renderHook(({ active }) => useSchedules(active), {
      initialProps: { active: true },
    });
    await waitFor(() => expect(result.current.error).toBe('临时读取失败'));
    rerender({ active: false });
    expect(api.onChange).toHaveBeenCalledTimes(1);
  });
});
