import type {
  AgentRuntimeEvent,
  ExportRunDiagnosticPackageResult,
  GetRunDiagnosticNodeDetailRequest,
  ListRunDiagnosticsHistoryRequest,
  ListRunDiagnosticsPageRequest,
  RunDiagnosticIssueMark,
  RunDiagnosticNode,
  RunDiagnosticNodeDetail,
  RunDiagnosticsChangedEvent,
  RunDiagnosticsHistoryEntry,
  RunDiagnosticsHistoryPage,
  RunDiagnosticsScopeRequest,
  RunDiagnosticsSources,
  RunDiagnosticsSummary,
  SetRunDiagnosticIssueMarkRequest,
} from '@betterwork/agent-protocol';
import type React from 'react';
import { useEffect, useState } from 'react';

import { Button } from '../../apps/desktop/src/renderer/src/components/Button';
import { RunExecutionDetails } from '../../apps/desktop/src/renderer/src/components/context/RunExecutionDetails';
import { PageHeader } from '../../apps/desktop/src/renderer/src/components/layout/PageHeader';

const currentScope: RunDiagnosticsScopeRequest = {
  workspaceId: 'ui-run-diagnostics-workspace',
  taskId: 'ui-run-diagnostics-task',
  runId: 'run-live',
};

const longTitle = `季度经营与合同条款核对 / Quarterly review ${'跨期版本边界 · '.repeat(5)}`;
const knowledgeReference = {
  kind: 'knowledge-revision' as const,
  documentId: 'diagnostics-document',
  revisionId: 'diagnostics-document-revision-7',
  contentHash: 'a'.repeat(64),
  title: longTitle,
  state: 'recorded' as const,
};

const summaries = new Map<string, RunDiagnosticsSummary>();
const nodesByRun = new Map<string, RunDiagnosticNode[]>();
const listeners = new Set<(event: RunDiagnosticsChangedEvent) => void>();
const historyRequests: ListRunDiagnosticsHistoryRequest[] = [];
let issueMark: RunDiagnosticIssueMark | null = null;
let failFirstMarkSave = true;
let exportCallCount = 0;

const runStatus = (status: RunDiagnosticsSummary['status']): RunDiagnosticNode['status'] =>
  status === 'running'
    ? 'running'
    : status === 'failed'
      ? 'failed'
      : status === 'cancelled'
        ? 'cancelled'
        : 'completed';

const summaryOf = (
  runId: string,
  status: RunDiagnosticsSummary['status'],
): RunDiagnosticsSummary => ({
  runId,
  taskId: runId === 'run-cancelled' ? 'ui-run-diagnostics-other-task' : currentScope.taskId,
  sessionId: `session-${runId}`,
  status,
  modelCallCount: 1,
  toolCallCount: 1,
  toolExecutionCount: 1,
  failedToolExecutionCount: status === 'failed' ? 1 : 0,
  rejectedToolCallCount: 0,
  usage: {
    promptTokens: { knownSubtotal: '128', knownCallCount: 1, missingCallCount: 0 },
    completionTokens: { knownSubtotal: '72', knownCallCount: 1, missingCallCount: 0 },
    totalTokens: { knownSubtotal: '200', knownCallCount: 1, missingCallCount: 0 },
  },
  recordingVersion: 1,
  enabledSections: ['core'],
  integrity: 'complete',
});

const nodeOf = (
  runId: string,
  kind: RunDiagnosticNode['kind'],
  status: RunDiagnosticNode['status'],
  sequence: number,
  phase?: 'prepare' | 'audit' | 'artifact-commit',
): RunDiagnosticNode => {
  const id =
    kind === 'round'
      ? `round:${runId}:0`
      : kind === 'model'
        ? `model:${runId}:0`
        : kind === 'tool'
          ? `tool:${runId}:0`
          : `host:${runId}:${phase ?? 'prepare'}`;
  const node: RunDiagnosticNode = {
    id,
    ...(kind === 'round' ? {} : { parentId: `round:${runId}:0` }),
    kind,
    status,
    sourceKind: kind === 'host' ? 'host-diagnostic' : 'core-journal',
    sourceId: id,
    sourceEventIds: [`event:${id}`],
    sourceSequenceStart: sequence,
    sourceSequenceEnd: sequence,
    evidenceState: kind === 'round' ? 'derived' : 'recorded',
    occurredAt: 1_792_000_000_000 + sequence * 100,
    ...(kind === 'round' || kind === 'model' || kind === 'tool' ? { round: 0 } : {}),
    ...(kind === 'model'
      ? {
          modelCallId: `model-call:${runId}`,
          durationMs: 83,
          timeToFirstTextMs: 37,
          usage: { promptTokens: 128, completionTokens: 72, totalTokens: 200 },
        }
      : {}),
    ...(kind === 'tool'
      ? {
          toolCallId: `tool-call:${runId}`,
          toolName: 'read_knowledge',
          executionState: 'started',
        }
      : {}),
    ...(kind === 'host'
      ? {
          operationId: `operation:${id}`,
          hostKind: 'run-host',
          hostPhase: phase ?? 'prepare',
        }
      : {}),
  };
  return node;
};

const nodesOf = (runId: string, status: RunDiagnosticsSummary['status']): RunDiagnosticNode[] => {
  const phaseStatus = runStatus(status);
  const nodes = [
    nodeOf(runId, 'round', phaseStatus, 0),
    nodeOf(runId, 'model', status === 'failed' ? 'failed' : phaseStatus, 1),
    nodeOf(runId, 'tool', status === 'cancelled' ? 'cancelled' : 'completed', 2),
    nodeOf(runId, 'host', phaseStatus, 3, 'prepare'),
    ...(status === 'completed' || status === 'running'
      ? [nodeOf(runId, 'host', phaseStatus, 4, 'audit')]
      : []),
    nodeOf(runId, 'host', phaseStatus, 5, 'artifact-commit'),
  ];
  return nodes;
};

const sourcesOf = (runId: string): RunDiagnosticsSources => ({
  runId,
  integrity: 'complete',
  fixedContext: {
    state: 'recorded',
    expert: {
      state: 'recorded',
      expertId: 'diagnostics-expert',
      revisionId: 'diagnostics-expert-revision-4',
      revision: 4,
      name: '离线诊断专家 / Offline diagnostics expert',
    },
    model: {
      reference: { mode: 'application-default' },
      snapshot: { displayName: '确定性 UI 模型替身', fingerprint: 'ui-model-fingerprint-v1' },
      memoryPhase: 'dispatch-attempted',
      dispatchAttemptedAt: 1_792_000_000_001,
    },
    skills: [
      {
        bindingId: 'diagnostics-skill-binding',
        skillId: 'diagnostics-skill',
        skillRevisionId: 'diagnostics-skill-revision-3',
        profileRevisionId: 'diagnostics-skill-profile-2',
        name: '离线资料核对技能 / Offline source review',
        state: 'recorded',
        dependencySnapshots: [],
      },
    ],
  },
  materials: {
    state: 'recorded',
    selected: [
      {
        reference: knowledgeReference,
        purpose: 'rule',
        addedFrom: 'user-input',
        wasRead: true,
      },
    ],
    reads: [
      {
        id: `diagnostics-read:${runId}`,
        reference: knowledgeReference,
        operation: 'read',
        contentHash: knowledgeReference.contentHash,
        capturedAt: 1_792_000_000_200,
        toolCallId: `tool-call:${runId}`,
      },
    ],
  },
  memory: {
    state: 'recorded',
    phase: 'dispatch-attempted',
    dispatchAttemptedAt: 1_792_000_000_001,
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

const historyStats = (runs: RunDiagnosticsHistoryEntry[]): RunDiagnosticsHistoryPage['stats'] => {
  const statusCounts = { completed: 0, failed: 0, cancelled: 0, running: 0 };
  const integrityCounts = { complete: 0, partial: 0, unavailable: 0 };
  for (const entry of runs) {
    statusCounts[entry.summary.status] += 1;
    integrityCounts[entry.summary.integrity] += 1;
  }
  const denominatorRunCount = statusCounts.completed + statusCounts.failed;
  const metric = (key: keyof RunDiagnosticsSummary['usage']) => {
    const known = runs.reduce(
      (total, entry) => total + BigInt(entry.summary.usage[key].knownSubtotal),
      0n,
    );
    return {
      knownSubtotal: known.toString(),
      knownCallCount: runs.reduce(
        (total, entry) => total + entry.summary.usage[key].knownCallCount,
        0,
      ),
      missingCallCount: runs.reduce(
        (total, entry) => total + entry.summary.usage[key].missingCallCount,
        0,
      ),
    };
  };
  const durationSampleCount = statusCounts.completed;
  return {
    runCount: runs.length,
    statusCounts,
    runFailure: {
      failedRunCount: statusCounts.failed,
      denominatorRunCount,
      excludedCancelledRunCount: statusCounts.cancelled,
      excludedRunningRunCount: statusCounts.running,
      rate: denominatorRunCount > 0 ? statusCounts.failed / denominatorRunCount : null,
    },
    integrityCounts,
    modelCallCount: runs.reduce((total, entry) => total + entry.summary.modelCallCount, 0),
    toolCallCount: runs.reduce((total, entry) => total + entry.summary.toolCallCount, 0),
    toolExecutionCount: runs.reduce((total, entry) => total + entry.summary.toolExecutionCount, 0),
    failedToolExecutionCount: runs.reduce(
      (total, entry) => total + entry.summary.failedToolExecutionCount,
      0,
    ),
    rejectedToolCallCount: runs.reduce(
      (total, entry) => total + entry.summary.rejectedToolCallCount,
      0,
    ),
    usage: {
      promptTokens: metric('promptTokens'),
      completionTokens: metric('completionTokens'),
      totalTokens: metric('totalTokens'),
    },
    modelCallDurationMs: {
      sampleCount: durationSampleCount,
      ...(durationSampleCount > 0 ? { p50: 83, p95: 83 } : {}),
      excludedCounts: {
        pending: 0,
        running: statusCounts.running,
        interrupted: 0,
        unknown: 0,
        missingMeasurement: 0,
      },
    },
  };
};

const entries = (): RunDiagnosticsHistoryEntry[] =>
  ['run-live', 'run-failed', 'run-cancelled'].flatMap((runId, index) => {
    const summary = summaries.get(runId);
    return summary
      ? [
          {
            summary,
            createdAt: 1_792_000_000_000 - index * 60_000,
            expertId: 'diagnostics-expert',
            expertRevisionId: 'diagnostics-expert-revision-4',
            skillRevisionIds: ['diagnostics-skill-revision-3'],
            modelFingerprint: 'ui-model-fingerprint-v1',
          },
        ]
      : [];
  });

const historyPage = (request: ListRunDiagnosticsHistoryRequest): RunDiagnosticsHistoryPage => {
  historyRequests.push(request);
  const matching = entries().filter((entry) => {
    const filter = request.filter ?? {};
    return (
      (!filter.taskId || entry.summary.taskId === filter.taskId) &&
      (!filter.expertRevisionId || entry.expertRevisionId === filter.expertRevisionId) &&
      (!filter.skillRevisionId || entry.skillRevisionIds.includes(filter.skillRevisionId)) &&
      (!filter.modelFingerprint || entry.modelFingerprint === filter.modelFingerprint) &&
      (filter.fromCreatedAt === undefined || entry.createdAt >= filter.fromCreatedAt) &&
      (filter.throughCreatedAt === undefined || entry.createdAt <= filter.throughCreatedAt)
    );
  });
  return { runs: matching, stats: historyStats(matching) };
};

const longPayload = JSON.stringify({
  input: {
    text: `合成长内容，用于窄窗口换行与截断标签 / customer notes ${'条款边界 Quarterly review '.repeat(180)}`,
  },
});

const installDiagnosticsApi = (): void => {
  summaries.clear();
  nodesByRun.clear();
  listeners.clear();
  historyRequests.length = 0;
  issueMark = null;
  failFirstMarkSave = true;
  exportCallCount = 0;
  for (const [runId, status] of [
    ['run-live', 'running'],
    ['run-failed', 'failed'],
    ['run-cancelled', 'cancelled'],
  ] as const) {
    summaries.set(runId, summaryOf(runId, status));
    nodesByRun.set(runId, nodesOf(runId, status));
  }

  const runs: Pick<
    Window['betterwork']['runs'],
    | 'getDiagnosticsSummary'
    | 'getDiagnosticsSources'
    | 'listDiagnosticsPage'
    | 'listDiagnosticsHistory'
    | 'getDiagnosticIssueMark'
    | 'setDiagnosticIssueMark'
    | 'exportDiagnosticPackage'
    | 'getDiagnosticNodeDetail'
    | 'listEvents'
    | 'onEvent'
    | 'onDiagnosticsChanged'
  > = {
    getDiagnosticsSummary: async ({ runId }) => summaries.get(runId) ?? null,
    getDiagnosticsSources: async ({ runId }) => (summaries.has(runId) ? sourcesOf(runId) : null),
    listDiagnosticsPage: async ({ runId }: ListRunDiagnosticsPageRequest) => {
      const summary = summaries.get(runId);
      const nodes = nodesByRun.get(runId);
      return summary && nodes ? { summary, nodes, integrity: summary.integrity } : null;
    },
    listDiagnosticsHistory: async (request) => historyPage(request),
    getDiagnosticIssueMark: async ({ runId }) => (issueMark?.runId === runId ? issueMark : null),
    setDiagnosticIssueMark: async (
      request: SetRunDiagnosticIssueMarkRequest,
    ): Promise<RunDiagnosticIssueMark | null> => {
      if (failFirstMarkSave) {
        failFirstMarkSave = false;
        throw new Error('合成故障：问题标记暂不可保存。');
      }
      if (request.category === null) {
        issueMark = null;
        return null;
      }
      issueMark = {
        runId: request.runId,
        category: request.category,
        ...(request.diagnosticNodeId ? { diagnosticNodeId: request.diagnosticNodeId } : {}),
        revision: (issueMark?.revision ?? 0) + 1,
        updatedAt: 1_792_000_000_500,
      };
      return issueMark;
    },
    exportDiagnosticPackage: async (): Promise<ExportRunDiagnosticPackageResult> => {
      exportCallCount += 1;
      return { cancelled: true };
    },
    getDiagnosticNodeDetail: async (
      request: GetRunDiagnosticNodeDetailRequest,
    ): Promise<RunDiagnosticNodeDetail | null> => ({
      runId: request.runId,
      nodeId: request.nodeId,
      sourceKind: 'core-journal',
      sourceSequenceStart: 2,
      sourceSequenceEnd: 2,
      payloadJson: longPayload,
      truncated: true,
    }),
    listEvents: async (): Promise<AgentRuntimeEvent[]> => [],
    onEvent: () => () => undefined,
    onDiagnosticsChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { runs },
  });
};

export const completeLiveRun = (): void => {
  const summary = summaryOf('run-live', 'completed');
  summaries.set('run-live', summary);
  nodesByRun.set('run-live', nodesOf('run-live', 'completed'));
  const event: RunDiagnosticsChangedEvent = {
    runId: 'run-live',
    cursor: { source: 'host-diagnostic', afterSequence: 6 },
  };
  for (const listener of listeners) listener(event);
};

export const lastHistoryRequest = (): ListRunDiagnosticsHistoryRequest | undefined =>
  historyRequests.at(-1);

export const diagnosticExportCallCount = (): number => exportCallCount;

export function RunDiagnosticsScenario(): React.JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    installDiagnosticsApi();
    window.uiRunDiagnosticsFixture = {
      completeLiveRun,
      lastHistoryRequest,
      diagnosticExportCallCount,
    };
    return () => {
      Reflect.deleteProperty(window, 'uiRunDiagnosticsFixture');
      Reflect.deleteProperty(window, 'betterwork');
    };
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="AT23 · 隔离合成 UI 场景"
        title="执行详情与历史回看"
        actions={
          <Button
            id="run-diagnostics-open"
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => setOpen(true)}
          >
            打开执行详情
          </Button>
        }
      />
      <div className="page-body">
        <p>确定性 Run 记录；不会连接模型、外部服务或用户资料。</p>
      </div>
      {open && <RunExecutionDetails scope={currentScope} onClose={() => setOpen(false)} />}
    </>
  );
}

declare global {
  interface Window {
    uiRunDiagnosticsFixture?: {
      completeLiveRun: typeof completeLiveRun;
      lastHistoryRequest: typeof lastHistoryRequest;
      diagnosticExportCallCount: typeof diagnosticExportCallCount;
    };
  }
}
