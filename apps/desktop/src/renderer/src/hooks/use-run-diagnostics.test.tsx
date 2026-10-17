// @vitest-environment jsdom

import type {
  AgentRuntimeEvent,
  RunDiagnosticNode,
  RunDiagnosticsPage,
  RunDiagnosticsScopeRequest,
  RunDiagnosticsSources,
  RunDiagnosticsSummary,
} from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRunDiagnostics } from './use-run-diagnostics';

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (reason: unknown) => void;
}

const deferred = <Value,>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<Value>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  if (!resolve || !reject) throw new Error('Deferred promise did not initialize');
  return { promise, resolve, reject };
};

const scopeOf = (runId: string): RunDiagnosticsScopeRequest => ({
  workspaceId: 'workspace-a',
  taskId: 'task-a',
  runId,
});

const summaryOf = (runId: string): RunDiagnosticsSummary => ({
  runId,
  taskId: 'task-a',
  sessionId: 'session-a',
  status: 'running',
  modelCallCount: 0,
  toolCallCount: 0,
  toolExecutionCount: 0,
  failedToolExecutionCount: 0,
  rejectedToolCallCount: 0,
  usage: {
    promptTokens: { knownSubtotal: '0', knownCallCount: 0, missingCallCount: 0 },
    completionTokens: { knownSubtotal: '0', knownCallCount: 0, missingCallCount: 0 },
    totalTokens: { knownSubtotal: '0', knownCallCount: 0, missingCallCount: 0 },
  },
  integrity: 'complete',
});

const nodeOf = (runId: string, id: string, sequence: number): RunDiagnosticNode => ({
  id,
  kind: 'model',
  status: 'running',
  sourceKind: 'core-journal',
  sourceId: `${runId}-${id}`,
  sourceEventIds: [`${runId}-${id}-started`],
  sourceSequenceStart: sequence,
  sourceSequenceEnd: sequence,
  evidenceState: 'recorded',
  modelCallId: `${runId}-${id}`,
});

const pageOf = (runId: string, nodes: RunDiagnosticNode[]): RunDiagnosticsPage => ({
  summary: summaryOf(runId),
  nodes,
  integrity: 'complete',
});

const startedEvent = (runId: string): AgentRuntimeEvent => ({
  id: `${runId}-event-1`,
  runId,
  sequence: 0,
  createdAt: 0,
  type: 'run.started',
  taskId: 'task-a',
  sessionId: 'session-a',
});

const modelStartedEvent = (runId: string, sequence: number): AgentRuntimeEvent => ({
  id: `${runId}-model-started`,
  runId,
  sequence,
  createdAt: sequence,
  type: 'model.started',
  modelCallId: `${runId}-model`,
  round: 0,
  providerId: 'fake-provider',
  messageCount: 1,
  toolDefinitionCount: 0,
});

const toolCompletedEvent = (runId: string, sequence: number): AgentRuntimeEvent => ({
  id: `${runId}-tool-completed`,
  runId,
  sequence,
  createdAt: sequence,
  type: 'tool.completed',
  toolCallId: `${runId}-tool`,
  output: { ok: true },
});

const toolStartedEvent = (runId: string, sequence: number): AgentRuntimeEvent => ({
  id: `${runId}-tool-started`,
  runId,
  sequence,
  createdAt: sequence,
  type: 'tool.started',
  toolCall: { id: `${runId}-tool`, name: 'calculator', input: {} },
});

const messageDeltaEvent = (runId: string, sequence: number): AgentRuntimeEvent => ({
  id: `${runId}-message-delta`,
  runId,
  sequence,
  createdAt: sequence,
  type: 'message.delta',
  messageId: `${runId}-message`,
  delta: 'synthetic',
});

const getSummary =
  vi.fn<(input: RunDiagnosticsScopeRequest) => Promise<RunDiagnosticsSummary | null>>();
const getSources =
  vi.fn<(input: RunDiagnosticsScopeRequest) => Promise<RunDiagnosticsSources | null>>();
const listPage =
  vi.fn<
    (input: RunDiagnosticsScopeRequest & { pageSize: number }) => Promise<RunDiagnosticsPage | null>
  >();
const listEvents = vi.fn<(input: { runId: string }) => Promise<AgentRuntimeEvent[]>>();
const onEvent = vi.fn<(listener: (event: AgentRuntimeEvent) => void) => () => void>();
const unsubscribe = vi.fn<() => void>();
let eventListener: ((event: AgentRuntimeEvent) => void) | undefined;

const installApi = (): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      runs: {
        getDiagnosticsSummary: getSummary,
        getDiagnosticsSources: getSources,
        listDiagnosticsPage: listPage,
        listEvents,
        onEvent,
      },
    },
  });
};

const emit = (event: AgentRuntimeEvent): void => {
  if (!eventListener) throw new Error('Run event listener was not registered');
  eventListener(event);
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  getSummary.mockReset();
  getSources.mockReset();
  listPage.mockReset();
  listEvents.mockReset();
  onEvent.mockReset();
  unsubscribe.mockReset();
  eventListener = undefined;
});

describe('useRunDiagnostics', () => {
  it('subscribes before snapshots, deduplicates live events, and fills a sequence gap', async () => {
    installApi();
    const firstPage = deferred<RunDiagnosticsPage | null>();
    const calls: string[] = [];
    getSummary.mockImplementation(async ({ runId }) => {
      calls.push('summary');
      return summaryOf(runId);
    });
    listPage
      .mockImplementationOnce(async ({ runId }) => {
        calls.push('page');
        return firstPage.promise.then((page) => page ?? pageOf(runId, []));
      })
      .mockImplementation(async ({ runId }) => pageOf(runId, [nodeOf(runId, 'model', 2)]));
    listEvents
      .mockResolvedValueOnce([
        startedEvent('run-a'),
        messageDeltaEvent('run-a', 1),
        toolStartedEvent('run-a', 3),
      ])
      .mockResolvedValue([
        startedEvent('run-a'),
        messageDeltaEvent('run-a', 1),
        modelStartedEvent('run-a', 2),
        toolStartedEvent('run-a', 3),
        toolCompletedEvent('run-a', 4),
      ]);
    onEvent.mockImplementation((listener) => {
      calls.push('subscribe');
      eventListener = listener;
      return unsubscribe;
    });

    const { result, unmount } = renderHook(() => useRunDiagnostics(scopeOf('run-a')));
    expect(calls[0]).toBe('subscribe');

    act(() => {
      emit(modelStartedEvent('run-a', 2));
      emit(modelStartedEvent('run-a', 2));
      emit(toolCompletedEvent('run-a', 4));
    });
    await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(1));
    expect(listEvents.mock.calls.at(-1)?.[0]).toEqual({ runId: 'run-a' });

    await act(async () => firstPage.resolve(pageOf('run-a', [])));
    await waitFor(() => expect(result.current.nodes.map((node) => node.id)).toEqual(['model']));
    expect(result.current.summary?.runId).toBe('run-a');
    expect(getSources).toHaveBeenCalledWith(scopeOf('run-a'));
    expect(listPage.mock.calls.length).toBeGreaterThanOrEqual(2);
    const pageCount = listPage.mock.calls.length;
    act(() => emit(toolCompletedEvent('run-a', 4)));
    expect(listPage).toHaveBeenCalledTimes(pageCount);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('discards a late Run response after switching selection and unsubscribes the old Run', async () => {
    installApi();
    const firstPage = deferred<RunDiagnosticsPage | null>();
    getSummary.mockImplementation(async ({ runId }) => summaryOf(runId));
    listPage.mockImplementation(({ runId }) =>
      runId === 'run-a'
        ? firstPage.promise
        : Promise.resolve(pageOf(runId, [nodeOf(runId, 'run-b-model', 2)])),
    );
    listEvents.mockResolvedValue([]);
    onEvent.mockImplementation((listener) => {
      eventListener = listener;
      return unsubscribe;
    });

    const { result, rerender, unmount } = renderHook(
      ({ runId }: { runId: string }) => useRunDiagnostics(scopeOf(runId)),
      { initialProps: { runId: 'run-a' } },
    );
    rerender({ runId: 'run-b' });
    await waitFor(() => expect(result.current.summary?.runId).toBe('run-b'));
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    await act(async () => firstPage.resolve(pageOf('run-a', [nodeOf('run-a', 'late-model', 2)])));
    expect(result.current.summary?.runId).toBe('run-b');
    expect(result.current.nodes.map((node) => node.id)).toEqual(['run-b-model']);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('loads every diagnostics page with the returned cursor', async () => {
    installApi();
    const cursor = {
      runId: 'run-a',
      source: 'core-journal' as const,
      afterSequence: 2,
      afterKind: 'model' as const,
      afterNodeId: 'model-a',
    };
    getSummary.mockResolvedValue(summaryOf('run-a'));
    listPage
      .mockResolvedValueOnce({
        ...pageOf('run-a', [nodeOf('run-a', 'model-a', 2)]),
        nextCursor: cursor,
      })
      .mockResolvedValueOnce(pageOf('run-a', [nodeOf('run-a', 'tool-b', 3)]));
    listEvents.mockResolvedValue([]);
    onEvent.mockImplementation((listener) => {
      eventListener = listener;
      return unsubscribe;
    });

    const { result } = renderHook(() => useRunDiagnostics(scopeOf('run-a')));
    await waitFor(() =>
      expect(result.current.nodes.map((node) => node.id)).toEqual(['model-a', 'tool-b']),
    );
    expect(listPage).toHaveBeenNthCalledWith(1, {
      ...scopeOf('run-a'),
      pageSize: 200,
    });
    expect(listPage).toHaveBeenNthCalledWith(2, {
      ...scopeOf('run-a'),
      pageSize: 200,
      cursor,
    });
  });

  it('rejects a repeated page cursor with a visible retryable error', async () => {
    installApi();
    const cursor = {
      runId: 'run-a',
      source: 'core-journal' as const,
      afterSequence: 2,
      afterKind: 'model' as const,
      afterNodeId: 'model-a',
    };
    getSummary.mockResolvedValue(summaryOf('run-a'));
    listPage.mockResolvedValue({
      ...pageOf('run-a', [nodeOf('run-a', 'model-a', 2)]),
      nextCursor: cursor,
    });
    listEvents.mockResolvedValue([]);
    onEvent.mockImplementation((listener) => {
      eventListener = listener;
      return unsubscribe;
    });

    const { result } = renderHook(() => useRunDiagnostics(scopeOf('run-a')));
    await waitFor(() => expect(result.current.error).toContain('分页游标重复'));
    expect(listPage).toHaveBeenCalledTimes(2);
  });

  it('surfaces and retries a failed event gap read', async () => {
    installApi();
    const firstPage = deferred<RunDiagnosticsPage | null>();
    getSummary.mockResolvedValue(summaryOf('run-a'));
    listPage
      .mockImplementationOnce(() => firstPage.promise)
      .mockResolvedValue(pageOf('run-a', [nodeOf('run-a', 'model', 2)]));
    listEvents
      .mockRejectedValueOnce(new Error('synthetic event gap failure'))
      .mockResolvedValue([
        startedEvent('run-a'),
        messageDeltaEvent('run-a', 1),
        modelStartedEvent('run-a', 2),
      ]);
    onEvent.mockImplementation((listener) => {
      eventListener = listener;
      return unsubscribe;
    });

    const { result } = renderHook(() => useRunDiagnostics(scopeOf('run-a')));
    act(() => emit(modelStartedEvent('run-a', 2)));
    await waitFor(() => expect(result.current.error).toBe('synthetic event gap failure'));

    act(() => result.current.refresh());
    await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(2));
    await act(async () => firstPage.resolve(pageOf('run-a', [])));
    await waitFor(() => expect(result.current.summary?.runId).toBe('run-a'));
    expect(result.current.error).toBe('');
  });

  it('shows query failures and retries the selected Run', async () => {
    installApi();
    getSummary
      .mockRejectedValueOnce(new Error('synthetic query failure'))
      .mockResolvedValue(summaryOf('run-a'));
    listPage.mockResolvedValue(pageOf('run-a', [nodeOf('run-a', 'model', 2)]));
    listEvents.mockResolvedValue([startedEvent('run-a')]);
    onEvent.mockImplementation((listener) => {
      eventListener = listener;
      return unsubscribe;
    });

    const { result } = renderHook(() => useRunDiagnostics(scopeOf('run-a')));
    await waitFor(() => expect(result.current.error).not.toBe(''));
    expect(result.current.summary).toBeUndefined();

    await act(async () => result.current.refresh());
    await waitFor(() => expect(result.current.summary?.runId).toBe('run-a'));
    expect(result.current.error).toBe('');
    expect(result.current.nodes.map((node) => node.id)).toEqual(['model']);
  });

  it('stays idle when no Run is selected', () => {
    installApi();
    const { result } = renderHook(() => useRunDiagnostics());

    expect(result.current).toMatchObject({
      summary: undefined,
      nodes: [],
      loading: false,
      error: '',
    });
    expect(onEvent).not.toHaveBeenCalled();
    expect(getSummary).not.toHaveBeenCalled();
    expect(listPage).not.toHaveBeenCalled();
  });
});
