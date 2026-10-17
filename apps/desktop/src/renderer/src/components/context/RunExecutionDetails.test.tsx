// @vitest-environment jsdom

import type {
  AgentRuntimeEvent,
  GetRunDiagnosticNodeDetailRequest,
  ListRunDiagnosticsHistoryRequest,
  ListRunDiagnosticsPageRequest,
  RunDiagnosticIssueMark,
  RunDiagnosticNode,
  RunDiagnosticNodeDetail,
  RunDiagnosticsChangedEvent,
  RunDiagnosticsHistoryEntry,
  RunDiagnosticsHistoryPage,
  RunDiagnosticsPage,
  RunDiagnosticsScopeRequest,
  RunDiagnosticsSources,
  RunDiagnosticsSummary,
  SetRunDiagnosticIssueMarkRequest,
} from '@betterwork/agent-protocol';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunExecutionDetails } from './RunExecutionDetails';

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
}

const deferred = <Value,>(): Deferred<Value> => {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((fulfill) => {
    resolve = fulfill;
  });
  if (!resolve) throw new Error('Deferred promise did not initialize');
  return { promise, resolve };
};

const scope: RunDiagnosticsScopeRequest = {
  workspaceId: 'workspace-a',
  taskId: 'task-a',
  runId: 'run-a',
};

const summaryOf = (
  status: RunDiagnosticsSummary['status'] = 'running',
  integrity: RunDiagnosticsSummary['integrity'] = 'complete',
): RunDiagnosticsSummary => ({
  runId: 'run-a',
  taskId: 'task-a',
  sessionId: 'session-a',
  status,
  modelCallCount: 1,
  toolCallCount: 1,
  toolExecutionCount: 1,
  failedToolExecutionCount: 0,
  rejectedToolCallCount: 0,
  usage: {
    promptTokens: { knownSubtotal: '0', knownCallCount: 1, missingCallCount: 0 },
    completionTokens: { knownSubtotal: '0', knownCallCount: 0, missingCallCount: 1 },
    totalTokens: { knownSubtotal: '12', knownCallCount: 1, missingCallCount: 0 },
  },
  recordingVersion: 1,
  enabledSections: ['core'],
  integrity,
});

const historyStatsOf = (runCount = 1): RunDiagnosticsHistoryPage['stats'] => ({
  runCount,
  statusCounts: { completed: runCount, failed: 0, cancelled: 0, running: 0 },
  runFailure: {
    failedRunCount: 0,
    denominatorRunCount: runCount,
    excludedCancelledRunCount: 0,
    excludedRunningRunCount: 0,
    rate: runCount > 0 ? 0 : null,
  },
  integrityCounts: { complete: runCount, partial: 0, unavailable: 0 },
  modelCallCount: runCount,
  toolCallCount: runCount,
  toolExecutionCount: runCount,
  failedToolExecutionCount: 0,
  rejectedToolCallCount: 0,
  usage: {
    promptTokens: { knownSubtotal: '0', knownCallCount: runCount, missingCallCount: 0 },
    completionTokens: {
      knownSubtotal: '8',
      knownCallCount: 1,
      missingCallCount: runCount > 0 ? 1 : 0,
    },
    totalTokens: { knownSubtotal: '12', knownCallCount: runCount, missingCallCount: 0 },
  },
  modelCallDurationMs: {
    sampleCount: runCount,
    ...(runCount > 0 ? { p50: 83, p95: 120 } : {}),
    excludedCounts: {
      pending: 0,
      running: 0,
      interrupted: 0,
      unknown: 0,
      missingMeasurement: 0,
    },
  },
});

const historyEntryOf = (
  runId: string,
  options: { taskId?: string; createdAt?: number; modelFingerprint?: string } = {},
): RunDiagnosticsHistoryEntry => ({
  summary: {
    ...summaryOf('completed'),
    runId,
    taskId: options.taskId ?? 'task-a',
  },
  createdAt: options.createdAt ?? 1_792_000_000_000,
  skillRevisionIds: [],
  ...(options.modelFingerprint ? { modelFingerprint: options.modelFingerprint } : {}),
});

const historyPageOf = (
  runs: RunDiagnosticsHistoryEntry[],
  stats = historyStatsOf(runs.length),
  nextCursor?: RunDiagnosticsHistoryPage['nextCursor'],
): RunDiagnosticsHistoryPage => ({
  runs,
  stats,
  ...(nextCursor ? { nextCursor } : {}),
});

const nodeOf = (
  id: string,
  kind: RunDiagnosticNode['kind'],
  status: RunDiagnosticNode['status'],
  sequence: number,
): RunDiagnosticNode => ({
  id,
  ...(kind === 'round' ? {} : { parentId: 'round:0' }),
  kind,
  status,
  sourceKind: 'core-journal',
  sourceId: id,
  sourceEventIds: [`${id}-event`],
  sourceSequenceStart: sequence,
  sourceSequenceEnd: sequence + 1,
  evidenceState: kind === 'round' ? 'derived' : 'recorded',
  ...(kind === 'round' ? { round: 0 } : {}),
  ...(kind === 'model'
    ? {
        round: 0,
        modelCallId: 'model-call-a',
        durationMs: 83,
        timeToFirstTextMs: 37,
        usage: { promptTokens: 0 },
      }
    : {}),
  ...(kind === 'tool'
    ? {
        round: 0,
        toolCallId: 'tool-call-a',
        toolName: 'read_text_file',
        executionState: 'started' as const,
      }
    : {}),
});

const summary = summaryOf();
const nodes = [
  nodeOf('round:0', 'round', 'running', 0),
  nodeOf('model:model-call-a', 'model', 'completed', 1),
  nodeOf('tool:tool-call-a', 'tool', 'running', 3),
];
const pageOf = (
  currentSummary: RunDiagnosticsSummary | null = summary,
  currentNodes: RunDiagnosticNode[] = nodes,
): RunDiagnosticsPage | null =>
  currentSummary
    ? { summary: currentSummary, nodes: currentNodes, integrity: currentSummary.integrity }
    : null;

const sourcesOf = (): RunDiagnosticsSources => ({
  runId: 'run-a',
  integrity: 'complete',
  fixedContext: {
    state: 'recorded',
    model: {
      reference: { mode: 'application-default' },
      snapshot: { displayName: 'Fixture model', fingerprint: 'fixture-fingerprint' },
      memoryPhase: 'dispatch-attempted',
      dispatchAttemptedAt: 20,
    },
    skills: [],
  },
  materials: { state: 'recorded', selected: [], reads: [] },
  memory: {
    state: 'recorded',
    phase: 'dispatch-attempted',
    dispatchAttemptedAt: 20,
    selectedItems: [],
    reads: [],
    replay: [],
  },
  continuity: {
    state: 'not-recorded',
    omissions: [],
    sourceRunIds: [],
    artifactVersionIds: [],
  },
  artifacts: { state: 'not-recorded', producedVersions: [], inputRelations: [] },
});

const getSummary =
  vi.fn<(input: RunDiagnosticsScopeRequest) => Promise<RunDiagnosticsSummary | null>>();
const getSources =
  vi.fn<(input: RunDiagnosticsScopeRequest) => Promise<RunDiagnosticsSources | null>>();
const listPage =
  vi.fn<(input: ListRunDiagnosticsPageRequest) => Promise<RunDiagnosticsPage | null>>();
const listHistory =
  vi.fn<(input: ListRunDiagnosticsHistoryRequest) => Promise<RunDiagnosticsHistoryPage>>();
const getDetail =
  vi.fn<(input: GetRunDiagnosticNodeDetailRequest) => Promise<RunDiagnosticNodeDetail | null>>();
const getIssueMark =
  vi.fn<(input: RunDiagnosticsScopeRequest) => Promise<RunDiagnosticIssueMark | null>>();
const setIssueMark =
  vi.fn<(input: SetRunDiagnosticIssueMarkRequest) => Promise<RunDiagnosticIssueMark | null>>();
const onEvent = vi.fn<(listener: (event: AgentRuntimeEvent) => void) => () => void>();
const onDiagnosticsChanged =
  vi.fn<(listener: (event: RunDiagnosticsChangedEvent) => void) => () => void>();

const installApi = (): void => {
  onDiagnosticsChanged.mockReturnValue(vi.fn());
  getIssueMark.mockResolvedValue(null);
  setIssueMark.mockResolvedValue(null);
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      runs: {
        getDiagnosticsSummary: getSummary,
        getDiagnosticsSources: getSources,
        listDiagnosticsPage: listPage,
        listDiagnosticsHistory: listHistory,
        getDiagnosticNodeDetail: getDetail,
        getDiagnosticIssueMark: getIssueMark,
        setDiagnosticIssueMark: setIssueMark,
        listEvents: vi.fn().mockResolvedValue([]),
        onEvent,
        onDiagnosticsChanged,
      },
    },
  });
};

const detailOf = (
  nodeId: string,
  payloadJson = '{"input":{"text":"中文内容 / customer notes"}}',
  truncated = false,
): RunDiagnosticNodeDetail => ({
  runId: 'run-a',
  nodeId,
  sourceKind: 'core-journal',
  sourceSequenceStart: 3,
  sourceSequenceEnd: 4,
  payloadJson,
  truncated,
});

function CloseHarness(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <main>
        <button type="button" onClick={() => setOpen(true)}>
          打开执行详情
        </button>
      </main>
      {open && <RunExecutionDetails scope={scope} onClose={() => setOpen(false)} />}
    </>
  );
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'betterwork');
  getSummary.mockReset();
  getSources.mockReset();
  listPage.mockReset();
  listHistory.mockReset();
  getDetail.mockReset();
  getIssueMark.mockReset();
  setIssueMark.mockReset();
  onEvent.mockReset();
  onDiagnosticsChanged.mockReset();
  onDiagnosticsChanged.mockReturnValue(vi.fn());
});

describe('RunExecutionDetails', () => {
  it('retains the selected issue mark after a save error and confirms a later save once', async () => {
    installApi();
    getSummary.mockResolvedValue(summary);
    listPage.mockResolvedValue(pageOf());
    onEvent.mockReturnValue(vi.fn());
    setIssueMark.mockRejectedValueOnce(new Error('保存冲突')).mockResolvedValueOnce({
      runId: scope.runId,
      category: 'tool',
      diagnosticNodeId: 'tool:tool-call-a',
      revision: 1,
      updatedAt: 30,
    });

    render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '问题类别' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '工具' }));
    fireEvent.click(screen.getByRole('button', { name: '关联过程节点（可选）' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /阅读资料 · tool:tool-call-a/u }));
    fireEvent.click(screen.getByRole('button', { name: '保存标记' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: '问题类别' }).textContent).toContain('工具');
    expect(screen.getByRole('button', { name: '关联过程节点（可选）' }).textContent).toContain(
      'tool:tool-call-a',
    );
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '保存标记' }));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('问题标记已保存');
    expect(setIssueMark).toHaveBeenNthCalledWith(1, {
      ...scope,
      expectedRevision: null,
      category: 'tool',
      diagnosticNodeId: 'tool:tool-call-a',
    });
    expect(setIssueMark).toHaveBeenNthCalledWith(2, {
      ...scope,
      expectedRevision: null,
      category: 'tool',
      diagnosticNodeId: 'tool:tool-call-a',
    });
  });

  it('clears an existing issue mark with its expected revision and one local confirmation', async () => {
    installApi();
    getSummary.mockResolvedValue(summary);
    listPage.mockResolvedValue(pageOf());
    getIssueMark.mockResolvedValue({
      runId: scope.runId,
      category: 'model',
      revision: 3,
      updatedAt: 30,
    });
    onEvent.mockReturnValue(vi.fn());

    render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '清除标记' }));

    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('问题标记已清除');
    expect(setIssueMark).toHaveBeenCalledWith({
      ...scope,
      expectedRevision: 3,
      category: null,
    });
  });

  it('shows a live model/tool chain, accurate text timing and unknown usage; loads tool payload on demand', async () => {
    installApi();
    getSummary.mockResolvedValue(summary);
    listPage.mockResolvedValue(pageOf());
    const longBilingualPayload = JSON.stringify({
      input: { text: '中文段落 / customer notes '.repeat(700) },
    });
    getDetail.mockResolvedValue(detailOf('tool:tool-call-a', longBilingualPayload, true));
    onEvent.mockReturnValue(vi.fn());
    onDiagnosticsChanged.mockReturnValue(vi.fn());

    render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    expect(await screen.findByText('第 1 轮')).toBeTruthy();
    expect(screen.getByText('首个可见文本耗时：37 ms')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '用量与状态' }));
    expect(screen.getByText('输入 token')).toBeTruthy();
    expect(screen.getByText('0 token')).toBeTruthy();
    expect(screen.getByText('未知')).toBeTruthy();
    expect(screen.queryByText('reasoning.delta')).toBeNull();
    expect(getDetail).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: '执行链' }));
    fireEvent.click(screen.getByText('工具载荷与结果'));
    fireEvent.click(screen.getByRole('button', { name: '查看工具载荷' }));
    expect(await screen.findByText(/customer notes/u)).toBeTruthy();
    expect(screen.getByText(/载荷已截断/u)).toBeTruthy();
    expect(getDetail).toHaveBeenCalledWith({ ...scope, nodeId: 'tool:tool-call-a' });
  });

  it('shows exact work sources and labels dispatch-attempted without claiming delivery', async () => {
    installApi();
    getSummary.mockResolvedValue(summary);
    getSources.mockResolvedValue(sourcesOf());
    listPage.mockResolvedValue(pageOf());
    onEvent.mockReturnValue(vi.fn());

    render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('tab', { name: '工作依据' }));

    expect(await screen.findByText('工作依据：记录完整')).toBeTruthy();
    expect(
      screen.getByText('记忆：选择 0 条，读取足迹 0 条；已记录派发尝试（不代表服务端已收到）。'),
    ).toBeTruthy();
    expect(screen.getByText('模型：Fixture model')).toBeTruthy();
    expect(getSources).toHaveBeenCalledWith(scope);
  });

  it('distinguishes old unavailable history and partial integrity from an empty Run', async () => {
    installApi();
    const oldSummary = summaryOf('completed', 'unavailable');
    getSummary.mockResolvedValue(oldSummary);
    listPage.mockResolvedValue(pageOf(oldSummary, []));
    onEvent.mockReturnValue(vi.fn());

    const { rerender } = render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    expect(await screen.findByText(/创建时没有执行诊断记录/u)).toBeTruthy();

    const partialScope = { ...scope, runId: 'run-b' };
    const partial = { ...summaryOf('failed', 'partial'), runId: partialScope.runId };
    getSummary.mockResolvedValue(partial);
    listPage.mockResolvedValue(pageOf(partial, []));
    rerender(<RunExecutionDetails scope={partialScope} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/部分过程记录缺失/u)).toBeTruthy());
    expect(screen.queryByText('暂无模型或工具调用')).toBeNull();
    expect(screen.getByText('失败')).toBeTruthy();
  });

  it('uses the empty state only when a complete Run records no model or tool calls', async () => {
    installApi();
    const emptySummary = {
      ...summaryOf('completed'),
      modelCallCount: 0,
      toolCallCount: 0,
      toolExecutionCount: 0,
      usage: {
        promptTokens: { knownSubtotal: '0', knownCallCount: 0, missingCallCount: 0 },
        completionTokens: { knownSubtotal: '0', knownCallCount: 0, missingCallCount: 0 },
        totalTokens: { knownSubtotal: '0', knownCallCount: 0, missingCallCount: 0 },
      },
    };
    getSummary.mockResolvedValue(emptySummary);
    listPage.mockResolvedValue(pageOf(emptySummary, []));
    onEvent.mockReturnValue(vi.fn());

    render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    expect(await screen.findByText('暂无模型或工具调用')).toBeTruthy();
    expect(getDetail).not.toHaveBeenCalled();
  });

  it('keeps a tool-only Run visible as an execution chain', async () => {
    installApi();
    const toolOnly = { ...summaryOf('completed'), modelCallCount: 0 };
    getSummary.mockResolvedValue(toolOnly);
    listPage.mockResolvedValue(
      pageOf(
        toolOnly,
        nodes.filter((node) => node.kind !== 'model'),
      ),
    );
    onEvent.mockReturnValue(vi.fn());

    render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    expect(await screen.findByText('阅读资料')).toBeTruthy();
    expect(screen.queryByText('暂无模型或工具调用')).toBeNull();
  });

  it('renders the host phase under its explicit tool parent and exposes an accessible timeline', async () => {
    installApi();
    const currentSummary = summaryOf();
    const tool = {
      ...nodeOf('tool:timeline', 'tool', 'running', 40),
      occurredAt: 100,
      startedAt: 100,
    };
    const host: RunDiagnosticNode = {
      id: 'host:execute',
      parentId: tool.id,
      kind: 'host',
      status: 'running',
      sourceKind: 'host-diagnostic',
      sourceId: 'execute',
      sourceEventIds: ['host-start'],
      sourceSequenceStart: 0,
      sourceSequenceEnd: 0,
      evidenceState: 'recorded',
      occurredAt: 100,
      operationId: 'execute',
      hostKind: 'skill-host',
      hostPhase: 'execute',
      toolCallId: 'timeline',
      startedAt: 100,
      durationMs: 35,
    };
    const zeroLength = {
      ...nodeOf('tool:zero', 'tool', 'completed', 41),
      occurredAt: 100,
      startedAt: 100,
      endedAt: 100,
    };
    const abnormal: RunDiagnosticNode = {
      id: 'host:abnormal',
      kind: 'host',
      status: 'failed',
      occurredAt: 200,
      sourceKind: 'host-diagnostic',
      sourceId: 'abnormal',
      sourceEventIds: ['host-abnormal'],
      sourceSequenceStart: 1,
      sourceSequenceEnd: 1,
      evidenceState: 'recorded',
      operationId: 'abnormal',
      hostKind: 'run-host',
      hostPhase: 'audit',
      startedAt: 200,
      endedAt: 150,
    };
    const missing = nodeOf('model:time-missing', 'model', 'unknown', 42);
    getSummary.mockResolvedValue(currentSummary);
    listPage.mockResolvedValue(pageOf(currentSummary, [tool, host, zeroLength, abnormal, missing]));
    onEvent.mockReturnValue(vi.fn());

    render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    await screen.findAllByText('阅读资料');
    fireEvent.click(screen.getByRole('tab', { name: '时间轴' }));

    expect(screen.getByText(/时间轴按已记录的本机时间/u)).toBeTruthy();
    expect(screen.getAllByText(/运行中占位；结束时间未记录/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/单调耗时 35 ms/u).length).toBeGreaterThan(0);
    expect(screen.getByText(/子进程内部阶段未记录/u)).toBeTruthy();
    expect(screen.getByText(/时间区间异常：结束早于开始/u)).toBeTruthy();
    expect(screen.getAllByText(/时间未记录/u).length).toBeGreaterThan(0);
    const hostEntry = screen.getByRole('listitem', { name: /Skill · 执行/u });
    hostEntry.focus();
    expect(document.activeElement).toBe(hostEntry);
  });

  it('shows loading and a retry action when the first query fails', async () => {
    installApi();
    const pendingSummary = deferred<RunDiagnosticsSummary | null>();
    getSummary.mockRejectedValueOnce(new Error('synthetic diagnostics failure'));
    getSummary.mockReturnValueOnce(pendingSummary.promise);
    listPage.mockResolvedValue(pageOf());
    onEvent.mockReturnValue(vi.fn());

    render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('status')).toBeTruthy();
    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
    pendingSummary.resolve(summary);
    await waitFor(() => expect(screen.getByText('第 1 轮')).toBeTruthy());
  });

  it('shows tool-detail query errors and retries the same bounded payload request', async () => {
    installApi();
    getSummary.mockResolvedValue(summary);
    listPage.mockResolvedValue(pageOf());
    getDetail.mockRejectedValueOnce(new Error('synthetic detail failure'));
    getDetail.mockResolvedValueOnce(detailOf('tool:tool-call-a'));
    onEvent.mockReturnValue(vi.fn());

    render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    await screen.findByText('第 1 轮');
    fireEvent.click(screen.getByText('工具载荷与结果'));
    fireEvent.click(screen.getByRole('button', { name: '查看工具载荷' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText(/customer notes/u)).toBeTruthy();
    expect(getDetail).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['completed', '已完成'],
    ['failed', '失败'],
    ['cancelled', '已停止'],
  ] as const)('uses the persisted %s Run status', async (status, label) => {
    installApi();
    const currentSummary = summaryOf(status);
    getSummary.mockResolvedValue(currentSummary);
    listPage.mockResolvedValue(pageOf(currentSummary));
    onEvent.mockReturnValue(vi.fn());

    render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
  });

  it('closes through Escape and returns focus to the opener', async () => {
    installApi();
    getSummary.mockResolvedValue(summary);
    listPage.mockResolvedValue(pageOf());
    onEvent.mockReturnValue(vi.fn());

    render(<CloseHarness />);
    const opener = screen.getByRole('button', { name: '打开执行详情' });
    opener.focus();
    fireEvent.click(opener);
    expect(await screen.findByRole('dialog', { name: '执行详情' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '执行详情' })).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('shows workspace-filtered aggregate samples and opens a selected historical Run', async () => {
    installApi();
    const historicalRun = historyEntryOf('run-history', { modelFingerprint: 'model-version-one' });
    listHistory.mockResolvedValue(historyPageOf([historicalRun]));
    getSummary.mockImplementation(async (input) => ({
      ...summaryOf('completed'),
      runId: input.runId,
      taskId: input.taskId,
    }));
    listPage.mockImplementation(async (input) => {
      const currentSummary = {
        ...summaryOf('completed'),
        runId: input.runId,
        taskId: input.taskId,
      };
      return pageOf(currentSummary, []);
    });
    getSources.mockResolvedValue(sourcesOf());
    onEvent.mockReturnValue(vi.fn());

    render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '记录与统计' }));

    expect(
      await screen.findByRole('button', { name: '查看 Run run-history 的执行详情' }),
    ).toBeTruthy();
    expect(listHistory).toHaveBeenCalledWith({
      workspaceId: scope.workspaceId,
      filter: { taskId: scope.taskId },
    });
    expect(screen.getByText('1 个匹配 Run 的统计')).toBeTruthy();
    expect(screen.getByText(/已知小计 8 token；已知调用 1 次，未知调用 1 次/u)).toBeTruthy();
    expect(screen.getByText(/模型版本 model-version-one/u)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '查看 Run run-history 的执行详情' }));
    expect(await screen.findByRole('button', { name: '返回打开时的 Run' })).toBeTruthy();
    expect(getSummary).toHaveBeenLastCalledWith({
      workspaceId: scope.workspaceId,
      taskId: 'task-a',
      runId: 'run-history',
    });

    fireEvent.click(screen.getByRole('button', { name: '返回打开时的 Run' }));
    await waitFor(() =>
      expect(getSummary).toHaveBeenLastCalledWith({
        workspaceId: scope.workspaceId,
        taskId: scope.taskId,
        runId: scope.runId,
      }),
    );
  });

  it('discards late filter results and clears every condition back to workspace scope', async () => {
    installApi();
    const stalePage = deferred<RunDiagnosticsHistoryPage>();
    const currentPage = deferred<RunDiagnosticsHistoryPage>();
    listHistory
      .mockResolvedValueOnce(historyPageOf([historyEntryOf('initial-run')]))
      .mockReturnValueOnce(stalePage.promise)
      .mockReturnValueOnce(currentPage.promise)
      .mockResolvedValueOnce(historyPageOf([]));
    getSummary.mockResolvedValue(summary);
    listPage.mockResolvedValue(pageOf());
    onEvent.mockReturnValue(vi.fn());

    render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '记录与统计' }));
    expect(
      await screen.findByRole('button', { name: '查看 Run initial-run 的执行详情' }),
    ).toBeTruthy();

    const fingerprint = screen.getByRole('textbox', { name: '模型指纹' });
    fireEvent.change(fingerprint, { target: { value: 'older-model' } });
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    await waitFor(() => expect(listHistory).toHaveBeenCalledTimes(2));
    fireEvent.change(fingerprint, { target: { value: 'newer-model' } });
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    await waitFor(() => expect(listHistory).toHaveBeenCalledTimes(3));
    expect(listHistory).toHaveBeenNthCalledWith(2, {
      workspaceId: scope.workspaceId,
      filter: { taskId: scope.taskId, modelFingerprint: 'older-model' },
    });
    expect(listHistory).toHaveBeenNthCalledWith(3, {
      workspaceId: scope.workspaceId,
      filter: { taskId: scope.taskId, modelFingerprint: 'newer-model' },
    });

    await act(async () => {
      currentPage.resolve(historyPageOf([historyEntryOf('newer-run')]));
      await currentPage.promise;
    });
    expect(
      await screen.findByRole('button', { name: '查看 Run newer-run 的执行详情' }),
    ).toBeTruthy();
    await act(async () => {
      stalePage.resolve(historyPageOf([historyEntryOf('stale-run')]));
      await stalePage.promise;
    });
    expect(screen.queryByRole('button', { name: '查看 Run stale-run 的执行详情' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '清除条件' }));
    expect(await screen.findByText('暂无执行记录')).toBeTruthy();
    await waitFor(() => expect(listHistory).toHaveBeenCalledTimes(4));
    expect(listHistory).toHaveBeenLastCalledWith({ workspaceId: scope.workspaceId, filter: {} });
  });

  it('retries history failures and appends the next page without duplicating rows', async () => {
    installApi();
    const cursor = {
      workspaceId: scope.workspaceId,
      filter: { taskId: scope.taskId },
      afterCreatedAt: 100,
      afterRunId: 'run-first',
    };
    listHistory
      .mockRejectedValueOnce(new Error('synthetic history failure'))
      .mockResolvedValueOnce(
        historyPageOf([historyEntryOf('run-first')], historyStatsOf(2), cursor),
      )
      .mockResolvedValueOnce(historyPageOf([historyEntryOf('run-second')], historyStatsOf(2)));
    getSummary.mockResolvedValue(summary);
    listPage.mockResolvedValue(pageOf());
    onEvent.mockReturnValue(vi.fn());

    render(<RunExecutionDetails scope={scope} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '记录与统计' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(
      await screen.findByRole('button', { name: '查看 Run run-first 的执行详情' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(
      await screen.findByRole('button', { name: '查看 Run run-second 的执行详情' }),
    ).toBeTruthy();
    expect(listHistory).toHaveBeenLastCalledWith({
      workspaceId: scope.workspaceId,
      filter: { taskId: scope.taskId },
      cursor,
    });
    expect(screen.getAllByText('Run run-first')).toHaveLength(1);
  });
});
