import type {
  AgentRuntimeEvent,
  RunDiagnosticNode,
  RunDiagnosticNodeDetail,
  RunDiagnosticsCursor,
  RunDiagnosticsPage,
  RunDiagnosticsPageQuery,
  RunDiagnosticsRecording,
  RunDiagnosticsSummary,
  RunSummary,
} from '@betterwork/agent-protocol';
import {
  agentRuntimeEventSchema,
  RUN_DIAGNOSTIC_DETAIL_MAX_UTF8_BYTES,
  runDiagnosticNodeDetailSchema,
  runDiagnosticNodeSchema,
  runDiagnosticsPageQuerySchema,
  runDiagnosticsPageSchema,
  runDiagnosticsRecordingSchema,
  runDiagnosticsSummarySchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface RunDiagnosticsRow {
  id: string;
  task_id: string;
  session_id: string;
  status: RunSummary['status'];
  created_at: number;
  completed_at: number | null;
  diagnostics_recording_version: number | null;
  diagnostics_sections_json: string | null;
}

interface StoredCoreEventRow {
  id: string;
  run_id: string;
  sequence: number;
  type: string;
  payload: string;
  created_at: number;
}

interface ModelEvents {
  events: Array<Extract<AgentRuntimeEvent, { type: `model.${string}` }>>;
  started: Array<Extract<AgentRuntimeEvent, { type: 'model.started' }>>;
  ended: Array<
    Extract<AgentRuntimeEvent, { type: 'model.completed' | 'model.failed' | 'model.cancelled' }>
  >;
  rounds: Set<number>;
}

interface ToolEvents {
  events: Array<Extract<AgentRuntimeEvent, { type: `tool.${string}` }>>;
  requested: Array<Extract<AgentRuntimeEvent, { type: 'tool.requested' }>>;
  started: Array<Extract<AgentRuntimeEvent, { type: 'tool.started' }>>;
  completed: Array<Extract<AgentRuntimeEvent, { type: 'tool.completed' }>>;
  failed: Array<Extract<AgentRuntimeEvent, { type: 'tool.failed' }>>;
  rounds: Set<number>;
  modelCallIds: Set<string>;
}

interface DiagnosticsSnapshot {
  summary: RunDiagnosticsSummary;
  nodes: RunDiagnosticNode[];
}

type ModelEvent = Extract<AgentRuntimeEvent, { type: `model.${string}` }>;
type ToolEvent = Extract<AgentRuntimeEvent, { type: `tool.${string}` }>;
type ToolOutcome =
  | Extract<AgentRuntimeEvent, { type: 'tool.completed' }>
  | Extract<AgentRuntimeEvent, { type: 'tool.failed' }>;

const isModelEvent = (event: AgentRuntimeEvent): event is ModelEvent =>
  event.type === 'model.started' ||
  event.type === 'model.completed' ||
  event.type === 'model.failed' ||
  event.type === 'model.cancelled';

const isToolEvent = (event: AgentRuntimeEvent): event is ToolEvent =>
  event.type === 'tool.requested' ||
  event.type === 'tool.started' ||
  event.type === 'tool.progress' ||
  event.type === 'tool.completed' ||
  event.type === 'tool.failed';

const DIAGNOSTIC_EVENT_TYPES = [
  'run.started',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'model.started',
  'model.completed',
  'model.failed',
  'model.cancelled',
  'tool.requested',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
] as const satisfies readonly AgentRuntimeEvent['type'][];

const ALL_EVENT_TYPES = [
  'run.started',
  'message.started',
  'message.delta',
  'message.completed',
  'reasoning.delta',
  'model.started',
  'model.completed',
  'model.failed',
  'model.cancelled',
  'tool.requested',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
  'run.completed',
  'run.failed',
  'run.cancelled',
] as const satisfies readonly AgentRuntimeEvent['type'][];

const eventTypeSql = (types: readonly string[]): string =>
  types.map((type) => `'${type}'`).join(', ');

const parseStoredEvent = (row: StoredCoreEventRow): AgentRuntimeEvent => {
  const parsed = agentRuntimeEventSchema.parse(JSON.parse(row.payload) as unknown);
  if (
    parsed.id !== row.id ||
    parsed.runId !== row.run_id ||
    parsed.sequence !== row.sequence ||
    parsed.type !== row.type ||
    parsed.createdAt !== row.created_at
  ) {
    throw new Error('Run event metadata does not match its payload');
  }
  return parsed;
};

const groupModelEvents = (events: readonly AgentRuntimeEvent[]): Map<string, ModelEvents> => {
  const groups = new Map<string, ModelEvents>();
  for (const event of events) {
    if (!isModelEvent(event)) continue;
    const callId = event.modelCallId;
    const group = groups.get(callId) ?? {
      events: [],
      started: [],
      ended: [],
      rounds: new Set<number>(),
    };
    group.events.push(event);
    group.rounds.add(event.round);
    if (event.type === 'model.started') group.started.push(event);
    else group.ended.push(event);
    groups.set(callId, group);
  }
  return groups;
};

const groupToolEvents = (events: readonly AgentRuntimeEvent[]): Map<string, ToolEvents> => {
  const groups = new Map<string, ToolEvents>();
  for (const event of events) {
    if (!isToolEvent(event)) continue;
    const callId =
      event.type === 'tool.requested' || event.type === 'tool.started'
        ? event.toolCall.id
        : event.toolCallId;
    const group = groups.get(callId) ?? {
      events: [],
      requested: [],
      started: [],
      completed: [],
      failed: [],
      rounds: new Set<number>(),
      modelCallIds: new Set<string>(),
    };
    group.events.push(event);
    if (event.type === 'tool.requested') group.requested.push(event);
    else if (event.type === 'tool.started') group.started.push(event);
    else if (event.type === 'tool.completed') group.completed.push(event);
    else if (event.type === 'tool.failed') group.failed.push(event);
    if (event.round !== undefined) group.rounds.add(event.round);
    if (event.modelCallId !== undefined) group.modelCallIds.add(event.modelCallId);
    groups.set(callId, group);
  }
  return groups;
};

const sequenceStart = (events: readonly AgentRuntimeEvent[]): number | undefined =>
  events.length === 0 ? undefined : Math.min(...events.map((event) => event.sequence));
const sequenceEnd = (events: readonly AgentRuntimeEvent[]): number | undefined =>
  events.length === 0 ? undefined : Math.max(...events.map((event) => event.sequence));
const eventIds = (events: readonly AgentRuntimeEvent[]): string[] =>
  [...new Set(events.map((event) => event.id))].slice(0, 200);

const unclosedStatus = (status: RunSummary['status']): RunDiagnosticNode['status'] => {
  if (status === 'running') return 'running';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'interrupted';
  return 'unknown';
};

const skillOutcomeStatus = (name: string, output: unknown): 'failed' | 'cancelled' | undefined => {
  if (name !== 'skill_execute' || typeof output !== 'object' || output === null) return undefined;
  const status = (output as Record<string, unknown>).status;
  if (status === 'failed' || status === 'timed-out') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return undefined;
};

const boundedName = (name: string): string => Array.from(name).slice(0, 256).join('');

const usageMetric = (
  groups: Iterable<ModelEvents>,
  key: 'promptTokens' | 'completionTokens' | 'totalTokens',
): RunDiagnosticsSummary['usage']['promptTokens'] => {
  let subtotal = 0n;
  let knownCallCount = 0;
  let missingCallCount = 0;
  for (const group of groups) {
    if (group.started.length !== 1) continue;
    const ending = group.ended.length === 1 ? group.ended[0] : undefined;
    const value = ending?.usage?.[key];
    if (value === undefined) {
      missingCallCount += 1;
      continue;
    }
    subtotal += BigInt(value);
    knownCallCount += 1;
  }
  return { knownSubtotal: subtotal.toString(), knownCallCount, missingCallCount };
};

const nodeOrder = (node: Pick<RunDiagnosticNode, 'kind'>): number => {
  if (node.kind === 'round') return 0;
  if (node.kind === 'model') return 1;
  return 2;
};

const compareNodePosition = (
  left: Pick<RunDiagnosticNode, 'kind' | 'id' | 'sourceSequenceStart'>,
  right: Pick<RunDiagnosticNode, 'kind' | 'id' | 'sourceSequenceStart'>,
): number => {
  const sequenceDifference =
    (left.sourceSequenceStart ?? Number.MAX_SAFE_INTEGER) -
    (right.sourceSequenceStart ?? Number.MAX_SAFE_INTEGER);
  if (sequenceDifference !== 0) return sequenceDifference;
  const kindDifference = nodeOrder(left) - nodeOrder(right);
  if (kindDifference !== 0) return kindDifference;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
};

const isTerminalEvent = (
  event: AgentRuntimeEvent,
): event is Extract<
  AgentRuntimeEvent,
  { type: 'run.completed' | 'run.failed' | 'run.cancelled' }
> =>
  event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled';

const terminalStatus = (
  event: Extract<AgentRuntimeEvent, { type: 'run.completed' | 'run.failed' | 'run.cancelled' }>,
): RunSummary['status'] => {
  if (event.type === 'run.completed') return 'completed';
  if (event.type === 'run.failed') return 'failed';
  return 'cancelled';
};

const coreEventQuerySql = `SELECT id, run_id, sequence, type, payload, created_at
  FROM run_events WHERE run_id = ? AND type IN (${eventTypeSql(DIAGNOSTIC_EVENT_TYPES)})
  ORDER BY sequence ASC, id ASC`;

const utf8Prefix = (value: string, maxBytes: number): { value: string; truncated: boolean } => {
  if (new TextEncoder().encode(value).byteLength <= maxBytes) return { value, truncated: false };
  let byteLength = 0;
  let prefix = '';
  for (const character of value) {
    const characterBytes = new TextEncoder().encode(character).byteLength;
    if (byteLength + characterBytes > maxBytes) break;
    prefix += character;
    byteLength += characterBytes;
  }
  return { value: prefix, truncated: true };
};

/** 从 Core Journal 构造只读执行链；不读取消息正文或 reasoning，也不写入第二份事件事实。 */
export class RunDiagnosticsRepository {
  constructor(private readonly db: Database.Database) {}

  getSummary(runId: string): RunDiagnosticsSummary | undefined {
    const snapshot = this.snapshot(runId);
    return snapshot?.summary;
  }

  getPage(input: RunDiagnosticsPageQuery): RunDiagnosticsPage | undefined {
    const query = runDiagnosticsPageQuerySchema.parse(input);
    const snapshot = this.snapshot(query.runId);
    if (!snapshot) return undefined;
    const cursor = query.cursor;
    const remaining = snapshot.nodes.filter((node) => {
      if (!cursor) return true;
      return (
        compareNodePosition(node, {
          id: cursor.afterNodeId,
          kind: cursor.afterKind,
          sourceSequenceStart: cursor.afterSequence,
        }) > 0
      );
    });
    const nodes = remaining.slice(0, query.pageSize);
    const last = nodes.at(-1);
    const nextCursor: RunDiagnosticsCursor | undefined =
      last && remaining.length > nodes.length
        ? {
            runId: query.runId,
            source: 'core-journal',
            afterSequence: last.sourceSequenceStart ?? 0,
            afterKind: last.kind,
            afterNodeId: last.id,
          }
        : undefined;
    return runDiagnosticsPageSchema.parse({
      summary: snapshot.summary,
      nodes,
      ...(nextCursor ? { nextCursor } : {}),
      integrity: snapshot.summary.integrity,
    });
  }

  getNodeDetail(runId: string, nodeId: string): RunDiagnosticNodeDetail | undefined {
    const prefix = 'tool:';
    if (!nodeId.startsWith(prefix)) return undefined;
    const toolCallId = nodeId.slice(prefix.length);
    if (!toolCallId || toolCallId.length > 512) return undefined;
    const rows = this.db
      .prepare(
        `SELECT id, run_id, sequence, type, payload, created_at FROM run_events
         WHERE run_id = ? AND (
           (type IN ('tool.requested', 'tool.started') AND
             CASE WHEN json_valid(payload) THEN json_extract(payload, '$.toolCall.id') END = ?) OR
           (type IN ('tool.progress', 'tool.completed', 'tool.failed') AND
             CASE WHEN json_valid(payload) THEN json_extract(payload, '$.toolCallId') END = ?)
         ) ORDER BY sequence ASC, id ASC`,
      )
      .all(runId, toolCallId, toolCallId) as StoredCoreEventRow[];
    if (rows.length === 0) return undefined;

    const parsedEvents: AgentRuntimeEvent[] = [];
    for (const row of rows) {
      try {
        const event = parseStoredEvent(row);
        if (isToolEvent(event)) parsedEvents.push(event);
      } catch {
        continue;
      }
    }
    if (parsedEvents.length === 0) return undefined;
    const payload: {
      input?: Record<string, unknown>;
      output?: unknown[];
      errors?: string[];
      progress?: string[];
    } = {};
    for (const event of parsedEvents) {
      if (event.type === 'tool.requested' || event.type === 'tool.started') {
        payload.input ??= event.toolCall.input;
      } else if (event.type === 'tool.completed') {
        (payload.output ??= []).push(event.output);
      } else if (event.type === 'tool.failed') {
        (payload.errors ??= []).push(event.error);
      } else if (event.type === 'tool.progress') {
        (payload.progress ??= []).push(event.message);
      }
    }
    const encoded = JSON.stringify(payload);
    if (encoded === undefined) return undefined;
    const bounded = utf8Prefix(encoded, RUN_DIAGNOSTIC_DETAIL_MAX_UTF8_BYTES);
    const payloadJson = bounded.truncated
      ? JSON.stringify({
          preview: utf8Prefix(encoded, Math.floor(RUN_DIAGNOSTIC_DETAIL_MAX_UTF8_BYTES / 2) - 100)
            .value,
          truncated: true,
        })
      : encoded;
    const detail = {
      runId,
      nodeId,
      sourceKind: 'core-journal' as const,
      sourceSequenceStart: sequenceStart(parsedEvents) ?? 0,
      sourceSequenceEnd: sequenceEnd(parsedEvents) ?? 0,
      payloadJson,
      truncated: bounded.truncated,
    };
    return runDiagnosticNodeDetailSchema.parse(detail);
  }

  private snapshot(runId: string): DiagnosticsSnapshot | undefined {
    return this.db.transaction(() => {
      const run = this.db
        .prepare(
          `SELECT id, task_id, session_id, status, created_at, completed_at,
                  diagnostics_recording_version, diagnostics_sections_json
           FROM runs WHERE id = ?`,
        )
        .get(runId) as RunDiagnosticsRow | undefined;
      if (!run) return undefined;

      let hasMalformedEvent = false;
      const knownEventTypes = new Set<string>(ALL_EVENT_TYPES);
      const storedTypes = this.db
        .prepare('SELECT DISTINCT type FROM run_events WHERE run_id = ?')
        .all(runId) as Array<{ type: string }>;
      if (storedTypes.some(({ type }) => !knownEventTypes.has(type))) hasMalformedEvent = true;

      const storedEvents = this.db.prepare(coreEventQuerySql).all(runId) as StoredCoreEventRow[];
      const events: AgentRuntimeEvent[] = [];
      for (const row of storedEvents) {
        try {
          events.push(parseStoredEvent(row));
        } catch {
          hasMalformedEvent = true;
        }
      }

      let recording: RunDiagnosticsRecording | undefined;
      if (run.diagnostics_recording_version !== null && run.diagnostics_sections_json !== null) {
        try {
          recording = runDiagnosticsRecordingSchema.parse({
            version: run.diagnostics_recording_version,
            sections: JSON.parse(run.diagnostics_sections_json) as unknown,
          });
        } catch {
          hasMalformedEvent = true;
        }
      } else if (
        run.diagnostics_recording_version !== null ||
        run.diagnostics_sections_json !== null
      ) {
        hasMalformedEvent = true;
      }

      const expectCore = recording?.sections.includes('core') ?? false;
      const modelGroups = groupModelEvents(events);
      const toolGroups = groupToolEvents(events);
      const modelNodes: RunDiagnosticNode[] = [];
      const toolNodes: RunDiagnosticNode[] = [];

      for (const [callId, group] of modelGroups) {
        const start = group.started[0];
        const ending = group.ended[0];
        const duplicateOrAmbiguous =
          group.started.length !== 1 || group.ended.length > 1 || group.rounds.size !== 1;
        if (duplicateOrAmbiguous || !start || (ending && ending.round !== start.round)) {
          hasMalformedEvent = true;
        }
        if (!ending && run.status !== 'running') hasMalformedEvent = true;
        const status = duplicateOrAmbiguous
          ? 'unknown'
          : ending
            ? ending.type === 'model.completed'
              ? 'completed'
              : ending.type === 'model.failed'
                ? 'failed'
                : 'cancelled'
            : unclosedStatus(run.status);
        const startSequence = sequenceStart(group.events);
        const round = group.rounds.size === 1 ? [...group.rounds][0] : undefined;
        if (callId.length > 512 || startSequence === undefined) {
          hasMalformedEvent = true;
          continue;
        }
        const node = runDiagnosticNodeSchema.parse({
          id: `model:${callId}`,
          ...(round === undefined ? {} : { parentId: `round:${round}` }),
          kind: 'model',
          status,
          sourceKind: 'core-journal',
          sourceId: callId,
          modelCallId: callId,
          sourceEventIds: eventIds(group.events),
          sourceSequenceStart: startSequence,
          sourceSequenceEnd: sequenceEnd(group.events),
          evidenceState:
            start && group.started.length === 1 && ending && group.ended.length === 1
              ? 'recorded'
              : 'missing',
          ...(round === undefined ? {} : { round }),
          ...(start ? { startedAt: start.createdAt } : {}),
          ...(ending ? { endedAt: ending.createdAt, durationMs: ending.durationMs } : {}),
          ...(ending?.timeToFirstTextMs === undefined
            ? {}
            : { timeToFirstTextMs: ending.timeToFirstTextMs }),
          ...(ending?.finishReason === undefined ? {} : { finishReason: ending.finishReason }),
          ...(ending?.usage === undefined ? {} : { usage: ending.usage }),
          ...(ending?.type === 'model.failed' ? { errorCode: ending.errorCode } : {}),
        });
        modelNodes.push(node);
      }

      for (const [callId, group] of toolGroups) {
        const firstEvent = group.events[0];
        if (!firstEvent || callId.length > 512) {
          hasMalformedEvent = true;
          continue;
        }
        const outcomes: ToolOutcome[] = [...group.completed, ...group.failed].sort(
          (left, right) => left.sequence - right.sequence,
        );
        const start = group.started[0];
        const outcome = outcomes[0];
        const duplicateOrAmbiguous =
          group.started.length > 1 ||
          outcomes.length > 1 ||
          group.requested.length > 1 ||
          group.rounds.size > 1 ||
          group.modelCallIds.size > 1;
        if (duplicateOrAmbiguous) hasMalformedEvent = true;
        if (
          expectCore &&
          group.events.some((item) => item.round === undefined || item.modelCallId === undefined)
        ) {
          hasMalformedEvent = true;
        }
        const modelCallId = [...group.modelCallIds][0];
        const round = [...group.rounds][0];
        if (modelCallId && !modelGroups.has(modelCallId)) hasMalformedEvent = true;
        if (
          modelCallId &&
          round !== undefined &&
          modelGroups.get(modelCallId)?.rounds.has(round) === false
        ) {
          hasMalformedEvent = true;
        }
        let status: RunDiagnosticNode['status'];
        let errorCode: string | undefined;
        if (duplicateOrAmbiguous) {
          status = 'unknown';
        } else if (!start && outcome?.type === 'tool.failed' && outcome.diagnostic) {
          status = 'rejected';
          errorCode = outcome.diagnostic.kind;
        } else if (!start && outcome) {
          status = 'unknown';
          hasMalformedEvent = true;
        } else if (start && outcome?.type === 'tool.failed') {
          status = 'failed';
          errorCode = 'tool-error';
        } else if (start && outcome?.type === 'tool.completed') {
          const nestedStatus = skillOutcomeStatus(start.toolCall.name, outcome.output);
          status = nestedStatus ?? 'completed';
          if (nestedStatus) errorCode = `skill-command-${nestedStatus}`;
        } else if (start) {
          status = unclosedStatus(run.status);
          if (run.status !== 'running') hasMalformedEvent = true;
        } else if (outcome?.type === 'tool.failed') {
          status = 'unknown';
        } else {
          status = unclosedStatus(run.status);
          if (run.status !== 'running') hasMalformedEvent = true;
        }
        const sourceEvents = [...group.events].sort(
          (left, right) => left.sequence - right.sequence,
        );
        const startSequence = sequenceStart(sourceEvents);
        if (startSequence === undefined) continue;
        const referenceEvents = [group.requested[0], group.started[0], outcomes.at(-1)].filter(
          (item) => item !== undefined,
        );
        const name = start?.toolCall.name ?? group.requested[0]?.toolCall.name ?? '';
        const node = runDiagnosticNodeSchema.parse({
          id: `tool:${callId}`,
          ...(round === undefined ? {} : { parentId: `round:${round}` }),
          kind: 'tool',
          status,
          sourceKind: 'core-journal',
          sourceId: callId,
          toolCallId: callId,
          sourceEventIds: eventIds(referenceEvents),
          sourceSequenceStart: startSequence,
          sourceSequenceEnd: sequenceEnd(sourceEvents),
          evidenceState: duplicateOrAmbiguous || (!start && !outcome) ? 'missing' : 'recorded',
          ...(round === undefined ? {} : { round }),
          ...(modelCallId === undefined ? {} : { modelCallId }),
          ...(name ? { toolName: boundedName(name) } : {}),
          executionState: start ? 'started' : 'not-started',
          ...(start ? { startedAt: start.createdAt } : {}),
          ...(outcome ? { endedAt: outcome.createdAt } : {}),
          ...(errorCode ? { errorCode } : {}),
        });
        toolNodes.push(node);
      }

      if (expectCore) {
        const callsByRound = new Map<number, number>();
        for (const node of modelNodes) {
          if (node.round === undefined) continue;
          callsByRound.set(node.round, (callsByRound.get(node.round) ?? 0) + 1);
        }
        if ([...callsByRound.values()].some((count) => count > 1)) hasMalformedEvent = true;
      }

      const children = [...modelNodes, ...toolNodes];
      const roundNumbers = [
        ...new Set(children.flatMap((node) => (node.round === undefined ? [] : [node.round]))),
      ];
      const roundNodes: RunDiagnosticNode[] = roundNumbers.map((round) => {
        const roundChildren = children.filter((node) => node.round === round);
        const states = new Set(roundChildren.map((node) => node.status));
        const status: RunDiagnosticNode['status'] =
          states.has('running') || states.has('pending')
            ? 'running'
            : states.has('interrupted')
              ? 'interrupted'
              : states.has('unknown')
                ? 'unknown'
                : states.has('failed')
                  ? 'failed'
                  : states.has('cancelled')
                    ? 'cancelled'
                    : 'completed';
        const first = Math.min(...roundChildren.map((node) => node.sourceSequenceStart ?? 0));
        const last = Math.max(...roundChildren.map((node) => node.sourceSequenceEnd ?? first));
        return runDiagnosticNodeSchema.parse({
          id: `round:${round}`,
          kind: 'round',
          status,
          sourceKind: 'core-journal',
          sourceId: `round:${round}`,
          sourceEventIds: [
            ...new Set(roundChildren.flatMap((node) => node.sourceEventIds ?? [])),
          ].slice(0, 200),
          sourceSequenceStart: first,
          sourceSequenceEnd: last,
          evidenceState: 'derived',
          round,
        });
      });
      const nodes = [...roundNodes, ...modelNodes, ...toolNodes].sort(compareNodePosition);

      const terminalEvents = events.filter(isTerminalEvent);
      if (run.status === 'running') {
        if (terminalEvents.length > 0) hasMalformedEvent = true;
      } else {
        const matchingTerminal = terminalEvents.filter(
          (event) => terminalStatus(event) === run.status,
        );
        if (
          terminalEvents.length !== 1 ||
          matchingTerminal.length !== 1 ||
          run.completed_at !== matchingTerminal[0]?.createdAt
        ) {
          hasMalformedEvent = true;
        }
      }
      const startEvents = events.filter((event) => event.type === 'run.started');
      if (startEvents.length > 1) hasMalformedEvent = true;
      const integrity =
        hasMalformedEvent || (recording?.sections.includes('host') ?? false)
          ? 'partial'
          : recording === undefined
            ? 'unavailable'
            : 'complete';
      const modelCallCount = [...modelGroups.values()].reduce(
        (count, group) => count + Number(group.started.length > 0),
        0,
      );
      const toolExecutionCount = toolNodes.filter(
        (node) => node.executionState === 'started',
      ).length;
      const summary = runDiagnosticsSummarySchema.parse({
        runId: run.id,
        taskId: run.task_id,
        sessionId: run.session_id,
        status: run.status,
        ...(startEvents[0] ? { startedAt: startEvents[0].createdAt } : {}),
        ...(run.completed_at === null ? {} : { completedAt: run.completed_at }),
        modelCallCount,
        toolCallCount: toolGroups.size,
        toolExecutionCount,
        failedToolExecutionCount: toolNodes.filter(
          (node) => node.executionState === 'started' && node.status === 'failed',
        ).length,
        rejectedToolCallCount: toolNodes.filter((node) => node.status === 'rejected').length,
        usage: {
          promptTokens: usageMetric(modelGroups.values(), 'promptTokens'),
          completionTokens: usageMetric(modelGroups.values(), 'completionTokens'),
          totalTokens: usageMetric(modelGroups.values(), 'totalTokens'),
        },
        ...(recording
          ? { recordingVersion: recording.version, enabledSections: recording.sections }
          : {}),
        integrity,
      });
      return { summary, nodes };
    })();
  }
}
