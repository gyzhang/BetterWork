// @vitest-environment jsdom

import type {
  MemoryPreviewData,
  MemoryRunContextData,
  PreviewMemoryRequest,
  Result,
  SaveTaskContextRequest,
  TaskContextRevision,
} from '@betterwork/agent-protocol';
import { memoryRecallPolicyV1 } from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRunMemories, useTaskMemoryExclusion } from './use-run-memories';

/**
 * 运行侧记忆可见性（WM07，产品设计 §3.5）。
 *
 * 这里只验两条界面必须守住的性质：
 * 1. **迟到响应不覆盖新数据**——换输入、换 Run 之后旧结果必须丢弃，
 *    否则面板会把上一次的清单显示成「这次也会用这些」；
 * 2. **排除不冲掉别的上下文**——一次排除必须提交完整 TaskContext。
 * 界面外观与措辞交给光哥人工验收，不在测试里代替。
 */

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((fulfill) => {
    resolve = fulfill;
  });
  if (!resolve) throw new Error('Deferred promise did not initialize');
  return { promise, resolve };
};

const HASH = 'a'.repeat(64);

const previewData = (memoryId: string): MemoryPreviewData => ({
  evaluatedAt: 1,
  policySnapshot: memoryRecallPolicyV1,
  selectedItems: [
    {
      memoryId,
      revisionId: `${memoryId}-r1`,
      contentHash: HASH,
      order: 1,
      score: 12,
      reason: 'task-relevant',
    },
  ],
  decisionSummary: {
    budget: {
      totalItems: 1,
      preferenceItems: 0,
      contentCodePoints: 18,
      wrapperCodePoints: 40,
      blockCodePoints: 58,
    },
    exclusions: [],
    queryTruncated: false,
    conflictReviewRequired: false,
  },
});

const runContextData = (runId: string, memoryId: string): MemoryRunContextData => ({
  runId,
  phase: 'dispatch-attempted',
  memories: [],
  reads: [
    {
      id: `read-${runId}`,
      runId,
      memoryId,
      memoryRevisionId: `${memoryId}-r1`,
      contentHash: HASH,
      capturedAt: 1,
      selectedForInjection: true,
      replayedViaRunIds: [],
      provenanceState: 'known',
    },
  ],
});

const ok = <TData>(data: TData): Result<TData> => ({ ok: true, data, warnings: [] });

const query = {
  taskId: 'task-1',
  taskContextRevisionId: 'context-1',
  expectedTaskContextRevision: 3,
  prompt: '  准备本月经营分析。  ',
};

const installMemoryApi = (
  preview: (input: PreviewMemoryRequest) => Promise<Result<MemoryPreviewData>>,
  runContext: (input: { runId: string }) => Promise<Result<MemoryRunContextData>>,
): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { memories: { preview, runContext } },
  });
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
});

describe('useRunMemories', () => {
  it('带上前置条件发起一次范围预览，prompt 取 trim 后的草稿', async () => {
    const preview = vi.fn(async (input: PreviewMemoryRequest) => ok(previewData(input.taskId)));
    const runContext = vi.fn(async () => ok(runContextData('run-1', 'memory-1')));
    installMemoryApi(preview, runContext);

    const { result } = renderHook(() => useRunMemories(query, 'run-1'));

    await waitFor(() => expect(result.current.preview?.selectedItems[0]?.memoryId).toBe('task-1'));
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledWith({
      taskId: 'task-1',
      taskContextRevisionId: 'context-1',
      expectedTaskContextRevision: 3,
      prompt: '准备本月经营分析。',
    });
    expect(result.current.previewLoading).toBe(false);
    expect(result.current.previewError).toBe('');
  });

  it('任务上下文尚未建立时不预览，并说明前置条件不足', async () => {
    const preview = vi.fn(async () => ok(previewData('memory-1')));
    const runContext = vi.fn(async () => ok(runContextData('run-1', 'memory-1')));
    installMemoryApi(preview, runContext);

    const { result } = renderHook(() =>
      useRunMemories({ ...query, taskContextRevisionId: undefined }, 'run-1'),
    );

    await waitFor(() => expect(result.current.contextLoading).toBe(false));
    expect(preview).not.toHaveBeenCalled();
    expect(result.current.previewAvailable).toBe(false);
    expect(result.current.preview).toBeUndefined();
  });

  it('改草稿后旧预览的迟到响应被丢弃，不会显示成下一次的清单', async () => {
    const first = deferred<Result<MemoryPreviewData>>();
    const second = deferred<Result<MemoryPreviewData>>();
    const calls: string[] = [];
    const queue = [first, second];
    const preview = vi.fn((input: PreviewMemoryRequest) => {
      const next = queue.shift();
      if (!next) throw new Error('预览请求超出预期次数');
      calls.push(input.prompt);
      return next.promise;
    });
    const runContext = vi.fn(async () => ok(runContextData('run-1', 'memory-1')));
    installMemoryApi(preview, runContext);

    const { rerender, result } = renderHook(
      ({ prompt }: { prompt: string }) => useRunMemories({ ...query, prompt }, 'run-1'),
      { initialProps: { prompt: '准备本月经营分析。' } },
    );

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    rerender({ prompt: '准备本季经营分析。' });
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(result.current.preview).toBeUndefined();

    act(() => second.resolve(ok(previewData('memory-new'))));
    await waitFor(() =>
      expect(result.current.preview?.selectedItems[0]?.memoryId).toBe('memory-new'),
    );

    act(() => first.resolve(ok(previewData('memory-stale'))));
    await waitFor(() => expect(result.current.previewLoading).toBe(false));
    expect(result.current.preview?.selectedItems[0]?.memoryId).toBe('memory-new');
    expect(calls).toEqual(['准备本月经营分析。', '准备本季经营分析。']);
  });

  it('切 Run 之后旧运行的审计不再回填，只保留当前 Run 的清单', async () => {
    const stale = deferred<Result<MemoryRunContextData>>();
    const fresh = deferred<Result<MemoryRunContextData>>();
    const queue = [stale, fresh];
    const runContext = vi.fn((input: { runId: string }) => {
      const next = queue.shift();
      if (!next) throw new Error(`未预期的运行审计请求：${input.runId}`);
      return next.promise;
    });
    const preview = vi.fn(async (): Promise<Result<MemoryPreviewData>> =>
      ok({
        ...previewData('memory-1'),
        selectedItems: [],
      }),
    );
    installMemoryApi(preview, runContext);

    const { rerender, result } = renderHook(
      ({ runId }: { runId: string }) => useRunMemories(query, runId),
      { initialProps: { runId: 'run-1' } },
    );

    await waitFor(() => expect(runContext).toHaveBeenCalledTimes(1));
    rerender({ runId: 'run-2' });
    await waitFor(() => expect(runContext).toHaveBeenCalledTimes(2));
    expect(result.current.runContext).toBeUndefined();

    act(() => fresh.resolve(ok(runContextData('run-2', 'memory-2'))));
    act(() => stale.resolve(ok(runContextData('run-1', 'memory-1'))));
    await waitFor(() => expect(result.current.contextLoading).toBe(false));
    expect(result.current.runContext?.reads[0]?.memoryId).toBe('memory-2');
  });

  it('预览与运行审计都失败可见，不向上抛异常', async () => {
    const preview = vi.fn(async (): Promise<Result<MemoryPreviewData>> => ({
      ok: false,
      error: { code: 'CONTEXT_REVISION_REQUIRED', message: '记忆暂不可用。', retryable: true },
    }));
    const runContext = vi.fn(async (): Promise<never> => {
      throw new Error('IPC rejected');
    });
    installMemoryApi(preview, runContext);

    const { result } = renderHook(() => useRunMemories(query, 'run-1'));

    await waitFor(() => expect(result.current.previewError).toBe('记忆暂不可用。'));
    expect(result.current.preview).toBeUndefined();
    expect(result.current.previewLoading).toBe(false);
    await waitFor(() => expect(result.current.contextError).toBe('IPC rejected'));
    expect(result.current.runContext).toBeUndefined();
    expect(result.current.contextLoading).toBe(false);
  });
});

const contextRevision = (excluded: string[]): TaskContextRevision => ({
  id: 'context-1',
  taskId: 'task-1',
  revision: 3,
  executor: { kind: 'expert', expertId: 'expert-1', expertRevisionId: 'expert-rev-1' },
  skillBindings: [{ skillId: 'skill-1', revisionId: 'skill-rev-1', source: 'expert-preset' }],
  materials: [
    {
      reference: {
        kind: 'knowledge-revision',
        knowledgeDocumentId: 'doc-1',
        knowledgeRevisionId: 'doc-rev-1',
        contentHash: HASH,
        sourcePath: '/tmp/doc-1.md',
      },
      purpose: 'background',
      addedFrom: 'workspace-candidate',
    },
  ],
  excludedMemoryIds: excluded,
  mcpToolBindings: [{ connectionId: 'conn-1', toolId: 'tool-1' }],
  modelReference: { mode: 'profile', modelProfileId: 'profile-1' },
  builtinToolPolicy: { mode: 'application-defaults' },
  createdAt: 1,
  updatedAt: 1,
});

describe('useTaskMemoryExclusion', () => {
  it('排除一条记忆时原样提交完整任务上下文，不冲掉其他选择', async () => {
    const save = vi.fn(async (input: SaveTaskContextRequest) => ({
      context: { ...contextRevision(input.excludedMemoryIds ?? []), revision: 4 },
    }));
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: { taskContexts: { save } },
    });

    const { result } = renderHook(() => useTaskMemoryExclusion());
    const context = contextRevision(['memory-excluded']);

    let returned: TaskContextRevision | undefined;
    await act(async () => {
      returned = await result.current.toggle(context, 'memory-1');
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toEqual({
      taskId: 'task-1',
      expectedRevision: 3,
      executor: context.executor,
      skillBindings: context.skillBindings,
      materials: context.materials,
      excludedMemoryIds: ['memory-excluded', 'memory-1'],
      mcpToolBindings: context.mcpToolBindings,
      modelReference: context.modelReference,
      builtinToolPolicy: context.builtinToolPolicy,
    });
    expect(returned?.revision).toBe(4);
    expect(result.current.error).toBe('');
    expect(result.current.savingMemoryId).toBeUndefined();
  });

  it('已排除的记忆再次点击是从列表里移除，而不是重复追加', async () => {
    const save = vi.fn(async (input: SaveTaskContextRequest) => ({
      context: contextRevision(input.excludedMemoryIds ?? []),
    }));
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: { taskContexts: { save } },
    });

    const { result } = renderHook(() => useTaskMemoryExclusion());
    await act(async () => {
      await result.current.toggle(contextRevision(['memory-1']), 'memory-1');
    });

    expect(save.mock.calls[0]?.[0].excludedMemoryIds).toEqual([]);
  });

  it('保存冲突时不 reject，只把失败写进面板错误；迟到的上一次结果不回填上下文', async () => {
    const first = deferred<{ context: TaskContextRevision }>();
    const save = vi
      .fn<(input: SaveTaskContextRequest) => Promise<{ context: TaskContextRevision }>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => {
        throw new Error('REVISION_CONFLICT');
      });
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: { taskContexts: { save } },
    });

    const { result } = renderHook(() => useTaskMemoryExclusion());

    const staleCall = result.current.toggle(contextRevision([]), 'memory-1');
    let failed: TaskContextRevision | undefined;
    await act(async () => {
      failed = await result.current.toggle(contextRevision([]), 'memory-2');
    });
    expect(result.current.error).toBe('REVISION_CONFLICT');
    expect(failed).toBeUndefined();
    expect(result.current.savingMemoryId).toBeUndefined();

    await act(async () => {
      first.resolve({ context: { ...contextRevision(['memory-1']), revision: 9 } });
    });
    expect(await staleCall).toBeUndefined();
    expect(result.current.error).toBe('REVISION_CONFLICT');
  });
});
