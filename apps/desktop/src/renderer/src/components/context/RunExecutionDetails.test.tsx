// @vitest-environment jsdom

import type {
  AgentRuntimeEvent,
  GetRunDiagnosticNodeDetailRequest,
  ListRunDiagnosticsPageRequest,
  RunDiagnosticNode,
  RunDiagnosticNodeDetail,
  RunDiagnosticsPage,
  RunDiagnosticsScopeRequest,
  RunDiagnosticsSummary,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const getSummary =
  vi.fn<(input: RunDiagnosticsScopeRequest) => Promise<RunDiagnosticsSummary | null>>();
const listPage =
  vi.fn<(input: ListRunDiagnosticsPageRequest) => Promise<RunDiagnosticsPage | null>>();
const getDetail =
  vi.fn<(input: GetRunDiagnosticNodeDetailRequest) => Promise<RunDiagnosticNodeDetail | null>>();
const onEvent = vi.fn<(listener: (event: AgentRuntimeEvent) => void) => () => void>();

const installApi = (): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      runs: {
        getDiagnosticsSummary: getSummary,
        listDiagnosticsPage: listPage,
        getDiagnosticNodeDetail: getDetail,
        listEvents: vi.fn().mockResolvedValue([]),
        onEvent,
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
  listPage.mockReset();
  getDetail.mockReset();
  onEvent.mockReset();
});

describe('RunExecutionDetails', () => {
  it('shows a live model/tool chain, accurate text timing and unknown usage; loads tool payload on demand', async () => {
    installApi();
    getSummary.mockResolvedValue(summary);
    listPage.mockResolvedValue(pageOf());
    const longBilingualPayload = JSON.stringify({
      input: { text: '中文段落 / customer notes '.repeat(700) },
    });
    getDetail.mockResolvedValue(detailOf('tool:tool-call-a', longBilingualPayload, true));
    onEvent.mockReturnValue(vi.fn());

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
});
