import type {
  AgentRuntimeEventInput,
  HostDiagnosticEventInput,
  RunDiagnosticsPage,
} from '@betterwork/agent-protocol';
import { agentRuntimeEventSchema } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

type RunStatus = RunDiagnosticsPage['summary']['status'];
type Integrity = RunDiagnosticsPage['integrity'];

interface DiagnosticProjection {
  status: RunStatus;
  integrity: Integrity;
  recordingVersion: number | null;
  modelCallCount: number;
  toolCallCount: number;
  toolExecutionCount: number;
  failedToolExecutionCount: number;
  rejectedToolCallCount: number;
  nodeStates: string[];
  finishReasons: string[];
  modelFirstTextByRound: string[];
  handoff: { liveModelStatus: string; historicalModelStatus: string } | null;
}

interface ScenarioExpectation {
  scenarioId: string;
  runId: string;
  inputRevision: string;
  configRevision: string;
  expected: DiagnosticProjection;
}

interface ProjectionComparison {
  matches: boolean;
  differences: string[];
}

interface ScenarioReport extends ScenarioExpectation {
  observed: DiagnosticProjection;
  comparison: ProjectionComparison;
  businessQuality: 'not-evaluated';
}

interface ScenarioContext {
  store: AppStore;
  runId: string;
  taskId: string;
  sessionId: string;
  append: (event: AgentRuntimeEventInput) => void;
  appendHost: (event: HostFixtureInput) => void;
  page: () => RunDiagnosticsPage;
}

type HostFixtureInput =
  | Omit<Extract<HostDiagnosticEventInput, { kind: 'run-host' }>, 'createdAt' | 'id' | 'runId'>
  | Omit<Extract<HostDiagnosticEventInput, { kind: 'skill-host' }>, 'createdAt' | 'id' | 'runId'>;

interface Scenario extends ScenarioExpectation {
  setup: (context: ScenarioContext) => DiagnosticProjection['handoff'];
}

const stores: AppStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const compareProjection = (
  expected: DiagnosticProjection,
  observed: DiagnosticProjection,
): ProjectionComparison => {
  const fields = Object.keys(expected) as Array<keyof DiagnosticProjection>;
  const differences = fields.filter(
    (field) => JSON.stringify(expected[field]) !== JSON.stringify(observed[field]),
  );
  return { matches: differences.length === 0, differences };
};

const createScenarioContext = (scenario: Scenario): ScenarioContext => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const workspace = store.workspaces.getOrCreate(
    `/tmp/at21-quality/${scenario.scenarioId}`,
    `AT21 ${scenario.scenarioId}`,
  );
  const task = store.tasks.create(
    workspace.id,
    `AT21 ${scenario.scenarioId}`,
    'fixed diagnostics sample',
  );
  const sessionId = task.sessionId;
  const usesHost = scenario.expected.integrity === 'partial';
  const run = {
    id: scenario.runId,
    taskId: task.task.id,
    sessionId,
    prompt: 'synthetic input; excluded from the report',
    status: 'running' as const,
    createdAt: 1_000,
  };
  if (scenario.expected.recordingVersion === null) {
    store.runs.create(run);
  } else {
    store.runs.create(
      run,
      usesHost ? { version: 1, sections: ['core', 'host'] } : { version: 1, sections: ['core'] },
    );
  }

  let eventSequence = 0;
  let hostSequence = 0;
  const append = (input: AgentRuntimeEventInput): void => {
    const event = agentRuntimeEventSchema.parse({
      id: `${scenario.runId}-event-${eventSequence}`,
      runId: scenario.runId,
      sequence: eventSequence,
      createdAt: 1_000 + eventSequence,
      ...input,
    });
    store.runs.appendEvent(event);
    eventSequence += 1;
  };
  const appendHost = (input: HostFixtureInput): void => {
    store.runHostDiagnostics.append({
      id: `${scenario.runId}-host-${hostSequence}`,
      runId: scenario.runId,
      createdAt: 2_000 + hostSequence,
      ...input,
    });
    hostSequence += 1;
  };
  const page = (): RunDiagnosticsPage => {
    const value = store.runDiagnostics.getPage({ runId: scenario.runId, pageSize: 50 });
    if (!value) throw new Error(`diagnostic page missing for ${scenario.runId}`);
    return value;
  };
  const context = {
    store,
    runId: scenario.runId,
    taskId: task.task.id,
    sessionId,
    append,
    appendHost,
    page,
  };
  append({ type: 'run.started', taskId: task.task.id, sessionId });
  return context;
};

const appendModelStart = (context: ScenarioContext, round = 0): void => {
  context.append({
    type: 'model.started',
    modelCallId: `${context.runId}-model-${round}`,
    round,
    providerId: 'at21-fixture',
    messageCount: 1,
    toolDefinitionCount: 1,
  });
};

const appendModelEnd = (
  context: ScenarioContext,
  type: 'model.completed' | 'model.cancelled',
  finishReason?: 'stop' | 'tool-calls' | 'length',
  round = 0,
  timeToFirstTextMs?: number,
): void => {
  context.append({
    type,
    modelCallId: `${context.runId}-model-${round}`,
    round,
    durationMs: 10,
    ...(finishReason ? { finishReason } : {}),
    ...(timeToFirstTextMs === undefined ? {} : { timeToFirstTextMs }),
  });
};

const appendModelOutput = (context: ScenarioContext, round: number, content: string): void => {
  const messageId = `${context.runId}-message-${round}`;
  context.append({ type: 'message.started', messageId });
  context.append({ type: 'message.delta', messageId, delta: content });
};

const appendModelOutputCompleted = (
  context: ScenarioContext,
  round: number,
  content: string,
): void => {
  context.append({
    type: 'message.completed',
    messageId: `${context.runId}-message-${round}`,
    content,
  });
};

const appendTruncatedModelFailure = (context: ScenarioContext): void => {
  context.append({
    type: 'model.failed',
    modelCallId: `${context.runId}-model-0`,
    round: 0,
    durationMs: 10,
    timeToFirstTextMs: 2,
    finishReason: 'length',
    errorCode: 'output-limit',
    errorSummary: 'Synthetic output limit',
  });
};

const appendTerminal = (context: ScenarioContext, type: 'run.completed'): void => {
  context.append({ type, finalContent: 'synthetic terminal' });
};

const appendFailure = (context: ScenarioContext): void => {
  context.append({ type: 'run.failed', error: 'synthetic failure' });
};

const appendToolRequested = (
  context: ScenarioContext,
  id: string,
  name: string,
  round = 0,
): void => {
  const correlation = { modelCallId: `${context.runId}-model-${round}`, round };
  context.append({ type: 'tool.requested', toolCall: { id, name, input: {} }, ...correlation });
};

const appendToolStarted = (context: ScenarioContext, id: string, name: string, round = 0): void => {
  const correlation = { modelCallId: `${context.runId}-model-${round}`, round };
  context.append({ type: 'tool.started', toolCall: { id, name, input: {} }, ...correlation });
};

const appendToolOutcome = (
  context: ScenarioContext,
  id: string,
  round: number,
  output?: unknown,
): void => {
  const correlation = { modelCallId: `${context.runId}-model-${round}`, round };
  if (output === undefined) {
    context.append({
      type: 'tool.failed',
      toolCallId: id,
      error: 'synthetic tool error',
      ...correlation,
    });
  } else {
    context.append({ type: 'tool.completed', toolCallId: id, output, ...correlation });
  }
};

const observeProjection = (
  page: RunDiagnosticsPage,
  handoff: DiagnosticProjection['handoff'],
): DiagnosticProjection => ({
  status: page.summary.status,
  integrity: page.integrity,
  recordingVersion: page.summary.recordingVersion ?? null,
  modelCallCount: page.summary.modelCallCount,
  toolCallCount: page.summary.toolCallCount,
  toolExecutionCount: page.summary.toolExecutionCount,
  failedToolExecutionCount: page.summary.failedToolExecutionCount,
  rejectedToolCallCount: page.summary.rejectedToolCallCount,
  nodeStates: page.nodes
    .map((node) =>
      [node.kind, node.status, node.hostPhase ?? null, node.errorCode ?? null]
        .filter((part) => part !== null)
        .join(':'),
    )
    .sort(),
  finishReasons: page.nodes
    .filter((node) => node.kind === 'model')
    .map((node) => node.finishReason ?? 'not-recorded')
    .sort(),
  modelFirstTextByRound: page.nodes
    .filter((node) => node.kind === 'model')
    .map(
      (node) =>
        `round-${node.round ?? 'unknown'}:${node.timeToFirstTextMs === undefined ? 'not-recorded' : 'recorded'}`,
    )
    .sort(),
  handoff,
});

const expectedProjection = (
  overrides: Partial<DiagnosticProjection> = {},
): DiagnosticProjection => ({
  status: 'completed',
  integrity: 'complete',
  recordingVersion: 1,
  modelCallCount: 0,
  toolCallCount: 0,
  toolExecutionCount: 0,
  failedToolExecutionCount: 0,
  rejectedToolCallCount: 0,
  nodeStates: [],
  finishReasons: [],
  modelFirstTextByRound: Array.from(
    { length: overrides.modelCallCount ?? 0 },
    (_, round) => `round-${round}:not-recorded`,
  ),
  handoff: null,
  ...overrides,
});

const scenarios: Scenario[] = [
  {
    scenarioId: 'success',
    runId: 'at21-success-v1',
    inputRevision: 'synthetic-input-v1',
    configRevision: 'synthetic-config-v1',
    expected: expectedProjection({
      modelCallCount: 1,
      nodeStates: ['model:completed', 'round:completed'],
      finishReasons: ['stop'],
      modelFirstTextByRound: ['round-0:recorded'],
    }),
    setup(context) {
      appendModelStart(context);
      appendModelOutput(context, 0, 'fixture answer');
      appendModelEnd(context, 'model.completed', 'stop', 0, 2);
      appendModelOutputCompleted(context, 0, 'fixture answer');
      appendTerminal(context, 'run.completed');
      return null;
    },
  },
  {
    scenarioId: 'model-truncation',
    runId: 'at21-truncation-v1',
    inputRevision: 'synthetic-input-v1',
    configRevision: 'synthetic-config-v1',
    expected: expectedProjection({
      status: 'failed',
      modelCallCount: 1,
      nodeStates: ['model:failed:output-limit', 'round:failed'],
      finishReasons: ['length'],
      modelFirstTextByRound: ['round-0:recorded'],
    }),
    setup(context) {
      appendModelStart(context);
      appendModelOutput(context, 0, 'partial fixture');
      appendTruncatedModelFailure(context);
      appendFailure(context);
      return null;
    },
  },
  {
    scenarioId: 'tool-only',
    runId: 'at21-tool-only-v1',
    inputRevision: 'synthetic-input-v1',
    configRevision: 'synthetic-config-v1',
    expected: expectedProjection({
      modelCallCount: 2,
      toolCallCount: 1,
      toolExecutionCount: 1,
      nodeStates: [
        'model:completed',
        'model:completed',
        'round:completed',
        'round:completed',
        'tool:completed',
      ],
      finishReasons: ['stop', 'tool-calls'],
      modelFirstTextByRound: ['round-0:not-recorded', 'round-1:recorded'],
    }),
    setup(context) {
      appendModelStart(context);
      appendToolRequested(context, `${context.runId}-tool`, 'calculator');
      appendModelEnd(context, 'model.completed', 'tool-calls');
      appendToolStarted(context, `${context.runId}-tool`, 'calculator');
      appendToolOutcome(context, `${context.runId}-tool`, 0, { result: 2 });
      appendModelStart(context, 1);
      appendModelOutput(context, 1, 'tool result fixture answer');
      appendModelEnd(context, 'model.completed', 'stop', 1, 3);
      appendModelOutputCompleted(context, 1, 'tool result fixture answer');
      appendTerminal(context, 'run.completed');
      return null;
    },
  },
  {
    scenarioId: 'recoverable-tool-failure',
    runId: 'at21-recoverable-tool-v1',
    inputRevision: 'synthetic-input-v1',
    configRevision: 'synthetic-config-v1',
    expected: expectedProjection({
      modelCallCount: 2,
      toolCallCount: 1,
      toolExecutionCount: 1,
      failedToolExecutionCount: 1,
      nodeStates: [
        'model:completed',
        'model:completed',
        'round:completed',
        'round:failed',
        'tool:failed:tool-error',
      ],
      finishReasons: ['stop', 'tool-calls'],
      modelFirstTextByRound: ['round-0:not-recorded', 'round-1:recorded'],
    }),
    setup(context) {
      appendModelStart(context);
      appendToolRequested(context, `${context.runId}-tool`, 'calculator');
      appendModelEnd(context, 'model.completed', 'tool-calls');
      appendToolStarted(context, `${context.runId}-tool`, 'calculator');
      appendToolOutcome(context, `${context.runId}-tool`, 0);
      appendModelStart(context, 1);
      appendModelOutput(context, 1, 'recovered fixture answer');
      appendModelEnd(context, 'model.completed', 'stop', 1, 3);
      appendModelOutputCompleted(context, 1, 'recovered fixture answer');
      appendTerminal(context, 'run.completed');
      return null;
    },
  },
  {
    scenarioId: 'skill-structured-rejection',
    runId: 'at21-skill-rejection-v1',
    inputRevision: 'synthetic-input-v1',
    configRevision: 'synthetic-config-v1',
    expected: expectedProjection({
      status: 'completed',
      integrity: 'partial',
      modelCallCount: 2,
      toolCallCount: 1,
      toolExecutionCount: 1,
      failedToolExecutionCount: 1,
      nodeStates: [
        'host:failed:validate:validate-failed',
        'model:completed',
        'model:completed',
        'round:completed',
        'round:failed',
        'tool:failed:skill-command-failed',
      ],
      finishReasons: ['stop', 'tool-calls'],
      modelFirstTextByRound: ['round-0:not-recorded', 'round-1:recorded'],
    }),
    setup(context) {
      appendModelStart(context);
      appendToolRequested(context, `${context.runId}-tool`, 'skill_execute');
      appendModelEnd(context, 'model.completed', 'tool-calls');
      appendToolStarted(context, `${context.runId}-tool`, 'skill_execute');
      context.appendHost({
        kind: 'skill-host',
        phase: 'validate',
        operationId: `${context.runId}-validate`,
        state: 'started',
      });
      context.appendHost({
        kind: 'skill-host',
        phase: 'validate',
        operationId: `${context.runId}-validate`,
        state: 'failed',
        errorCode: 'validate-failed',
        metadata: { result: 'rejected' },
      });
      appendToolOutcome(context, `${context.runId}-tool`, 0, {
        status: 'failed',
        code: 'output-rejected',
      });
      appendModelStart(context, 1);
      appendModelOutput(context, 1, 'rejected fixture answer');
      appendModelEnd(context, 'model.completed', 'stop', 1, 3);
      appendModelOutputCompleted(context, 1, 'rejected fixture answer');
      appendTerminal(context, 'run.completed');
      return null;
    },
  },
  {
    scenarioId: 'cancellation',
    runId: 'at21-cancelled-v1',
    inputRevision: 'synthetic-input-v1',
    configRevision: 'synthetic-config-v1',
    expected: expectedProjection({
      status: 'cancelled',
      modelCallCount: 1,
      nodeStates: ['model:cancelled', 'round:cancelled'],
      finishReasons: ['not-recorded'],
    }),
    setup(context) {
      appendModelStart(context);
      appendModelEnd(context, 'model.cancelled');
      context.append({ type: 'run.cancelled', reason: 'synthetic cancellation' });
      return null;
    },
  },
  {
    scenarioId: 'cleanup-failure',
    runId: 'at21-cleanup-failed-v1',
    inputRevision: 'synthetic-input-v1',
    configRevision: 'synthetic-config-v1',
    expected: expectedProjection({
      status: 'failed',
      integrity: 'partial',
      nodeStates: ['host:failed:skill-cleanup:cleanup-failed'],
    }),
    setup(context) {
      context.appendHost({
        kind: 'run-host',
        phase: 'skill-cleanup',
        operationId: `${context.runId}-cleanup`,
        state: 'started',
      });
      context.appendHost({
        kind: 'run-host',
        phase: 'skill-cleanup',
        operationId: `${context.runId}-cleanup`,
        state: 'failed',
        errorCode: 'cleanup-failed',
        metadata: { result: 'failure' },
      });
      appendFailure(context);
      return null;
    },
  },
  {
    scenarioId: 'live-to-historical-handoff',
    runId: 'at21-handoff-v1',
    inputRevision: 'synthetic-input-v1',
    configRevision: 'synthetic-config-v1',
    expected: expectedProjection({
      modelCallCount: 1,
      nodeStates: ['model:completed', 'round:completed'],
      finishReasons: ['stop'],
      modelFirstTextByRound: ['round-0:recorded'],
      handoff: { liveModelStatus: 'running', historicalModelStatus: 'completed' },
    }),
    setup(context) {
      appendModelStart(context);
      const livePage = context.page();
      const liveModel = livePage.nodes.find((node) => node.kind === 'model');
      if (!liveModel) throw new Error('live model projection missing');
      appendModelOutput(context, 0, 'handoff fixture answer');
      appendModelEnd(context, 'model.completed', 'stop', 0, 3);
      appendModelOutputCompleted(context, 0, 'handoff fixture answer');
      appendTerminal(context, 'run.completed');
      const historicalModel = context.page().nodes.find((node) => node.kind === 'model');
      if (!historicalModel) throw new Error('historical model projection missing');
      return {
        liveModelStatus: liveModel.status,
        historicalModelStatus: historicalModel.status,
      };
    },
  },
  {
    scenarioId: 'missing-recording-version',
    runId: 'at21-missing-version-v1',
    inputRevision: 'synthetic-input-v1',
    configRevision: 'synthetic-config-v1',
    expected: expectedProjection({
      integrity: 'unavailable',
      recordingVersion: null,
    }),
    setup(context) {
      context.append({ type: 'run.completed', finalContent: 'synthetic terminal' });
      return null;
    },
  },
];

describe('AT21 fixed diagnostic sample comparison', () => {
  it('reports the exact structural fields that differ', () => {
    expect(
      compareProjection(
        expectedProjection({ nodeStates: ['model:completed'] }),
        expectedProjection({ nodeStates: ['model:failed'] }),
      ),
    ).toEqual({ matches: false, differences: ['nodeStates'] });
  });

  it('creates one isolated Run per fixed scenario and captures a deterministic comparison report', () => {
    const report: ScenarioReport[] = scenarios.map((scenario) => {
      const context = createScenarioContext(scenario);
      const handoff = scenario.setup(context);
      const observed = observeProjection(context.page(), handoff);
      return {
        scenarioId: scenario.scenarioId,
        runId: scenario.runId,
        inputRevision: scenario.inputRevision,
        configRevision: scenario.configRevision,
        expected: scenario.expected,
        observed,
        comparison: compareProjection(scenario.expected, observed),
        businessQuality: 'not-evaluated',
      };
    });

    expect(report).toHaveLength(9);
    expect(report.filter((entry) => !entry.comparison.matches)).toEqual([]);
    expect(report.every((entry) => entry.businessQuality === 'not-evaluated')).toBe(true);
    expect(
      report.map(({ scenarioId, runId, inputRevision, configRevision }) => ({
        scenarioId,
        runId,
        inputRevision,
        configRevision,
      })),
    ).toEqual(
      scenarios.map(({ scenarioId, runId, inputRevision, configRevision }) => ({
        scenarioId,
        runId,
        inputRevision,
        configRevision,
      })),
    );
  });
});
