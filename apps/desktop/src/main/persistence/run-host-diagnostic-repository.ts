import type {
  AgentRuntimeEvent,
  HostDiagnosticEvent,
  HostDiagnosticEventInput,
  RunDiagnosticsRecording,
} from '@betterwork/agent-protocol';
import {
  agentRuntimeEventSchema,
  hostDiagnosticEventInputSchema,
  hostDiagnosticEventSchema,
  runDiagnosticsRecordingSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface RunRecordingRow {
  diagnostics_recording_version: number | null;
  diagnostics_sections_json: string | null;
}

interface HostDiagnosticEventRow {
  id: string;
  run_id: string;
  operation_id: string;
  parent_operation_id: string | null;
  diagnostic_sequence: number;
  kind: HostDiagnosticEvent['kind'];
  phase: HostDiagnosticEvent['phase'];
  state: HostDiagnosticEvent['state'];
  tool_call_id: string | null;
  execution_id: string | null;
  duration_ms: number | null;
  error_code: HostDiagnosticEvent['errorCode'] | null;
  metadata_json: string | null;
  created_at: number;
}

const parseRecording = (row: RunRecordingRow): RunDiagnosticsRecording | undefined => {
  if (row.diagnostics_recording_version === null || row.diagnostics_sections_json === null) {
    return undefined;
  }
  try {
    return runDiagnosticsRecordingSchema.parse({
      version: row.diagnostics_recording_version,
      sections: JSON.parse(row.diagnostics_sections_json) as unknown,
    });
  } catch (error) {
    throw new Error('Run diagnostic recording metadata is invalid', { cause: error });
  }
};

const toEvent = (row: HostDiagnosticEventRow): HostDiagnosticEvent => {
  let metadata: unknown;
  if (row.metadata_json !== null) {
    try {
      metadata = JSON.parse(row.metadata_json) as unknown;
    } catch (error) {
      throw new Error('Stored host diagnostic metadata is invalid JSON', { cause: error });
    }
  }
  return hostDiagnosticEventSchema.parse({
    id: row.id,
    runId: row.run_id,
    operationId: row.operation_id,
    ...(row.parent_operation_id === null ? {} : { parentOperationId: row.parent_operation_id }),
    diagnosticSequence: row.diagnostic_sequence,
    kind: row.kind,
    phase: row.phase,
    state: row.state,
    ...(row.tool_call_id === null ? {} : { toolCallId: row.tool_call_id }),
    ...(row.execution_id === null ? {} : { executionId: row.execution_id }),
    ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    ...(metadata === undefined ? {} : { metadata }),
    createdAt: row.created_at,
  });
};

const sameOptional = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const hasToolCall = (db: Database.Database, runId: string, toolCallId: string): boolean => {
  const rows = db.prepare('SELECT payload FROM run_events WHERE run_id = ?').all(runId) as Array<{
    payload: string;
  }>;
  return rows.some(({ payload }) => {
    try {
      const parsed = agentRuntimeEventSchema.safeParse(JSON.parse(payload) as unknown);
      if (!parsed.success) return false;
      const event: AgentRuntimeEvent = parsed.data;
      if (event.type === 'tool.requested' || event.type === 'tool.started') {
        return event.toolCall.id === toolCallId;
      }
      return (
        (event.type === 'tool.progress' ||
          event.type === 'tool.completed' ||
          event.type === 'tool.failed') &&
        event.toolCallId === toolCallId
      );
    } catch {
      return false;
    }
  });
};

const toDatabaseRow = (
  input: HostDiagnosticEventInput,
  diagnosticSequence: number,
): HostDiagnosticEvent => hostDiagnosticEventSchema.parse({ ...input, diagnosticSequence });

/**
 * Run 宿主事实流的唯一写入口。定序、归属检查与插入在同一个 SQLite 事务中完成；
 * Run Event 的 Core sequence 仍由 RunRepository 单独管理。
 */
export class RunHostDiagnosticRepository {
  constructor(private readonly db: Database.Database) {}

  append(rawInput: HostDiagnosticEventInput): HostDiagnosticEvent {
    const input = hostDiagnosticEventInputSchema.parse(rawInput);
    const write = this.db.transaction(() => {
      const run = this.db
        .prepare(
          `SELECT diagnostics_recording_version, diagnostics_sections_json
           FROM runs WHERE id = ?`,
        )
        .get(input.runId) as RunRecordingRow | undefined;
      if (!run) throw new Error('Run does not exist');
      const recording = parseRecording(run);
      if (!recording?.sections.includes('host')) {
        throw new Error('Host diagnostics were not enabled for this Run');
      }

      if (input.parentOperationId) {
        const parentExists = this.db
          .prepare(
            `SELECT 1 AS present FROM run_diagnostic_events
             WHERE run_id = ? AND operation_id = ? LIMIT 1`,
          )
          .get(input.runId, input.parentOperationId);
        if (!parentExists) throw new Error('Parent operation must belong to the same Run');
      }

      if (input.toolCallId && !hasToolCall(this.db, input.runId, input.toolCallId)) {
        throw new Error('ToolCall must belong to the same Run');
      }

      if (input.executionId) {
        const execution = this.db
          .prepare('SELECT run_id, tool_call_id FROM script_executions WHERE id = ?')
          .get(input.executionId) as { run_id: string; tool_call_id: string } | undefined;
        if (!execution || execution.run_id !== input.runId) {
          throw new Error('Skill execution must belong to the same Run');
        }
        if (input.toolCallId && execution.tool_call_id !== input.toolCallId) {
          throw new Error('Skill execution ToolCall does not match');
        }
      }

      const operationRows = this.db
        .prepare(
          `SELECT * FROM run_diagnostic_events
           WHERE run_id = ? AND operation_id = ? ORDER BY diagnostic_sequence`,
        )
        .all(input.runId, input.operationId) as HostDiagnosticEventRow[];
      const started = operationRows.find((row) => row.state === 'started');
      const terminal = operationRows.find((row) => row.state !== 'started');
      if (input.state === 'started') {
        if (started) throw new Error('Diagnostic operation has already started');
      } else {
        if (!started) throw new Error('Diagnostic operation must start before it closes');
        const startEvent = toEvent(started);
        if (
          startEvent.kind !== input.kind ||
          startEvent.phase !== input.phase ||
          !sameOptional(startEvent.parentOperationId, input.parentOperationId) ||
          !sameOptional(startEvent.toolCallId, input.toolCallId) ||
          !sameOptional(startEvent.executionId, input.executionId)
        ) {
          throw new Error('Diagnostic terminal metadata conflicts with its start');
        }
        if (terminal) {
          const existing = toEvent(terminal);
          if (
            existing.state !== input.state ||
            !sameOptional(existing.errorCode, input.errorCode) ||
            !sameOptional(existing.metadata, input.metadata) ||
            (input.durationMs !== undefined && existing.durationMs !== input.durationMs)
          ) {
            throw new Error('Conflicting terminal state for diagnostic operation');
          }
          return existing;
        }
      }

      const sequenceRow = this.db
        .prepare(
          `SELECT COALESCE(MAX(diagnostic_sequence), -1) + 1 AS next_sequence
           FROM run_diagnostic_events WHERE run_id = ?`,
        )
        .get(input.runId) as { next_sequence: number };
      const event = toDatabaseRow(input, sequenceRow.next_sequence);
      this.db
        .prepare(
          `INSERT INTO run_diagnostic_events (
             id, run_id, operation_id, parent_operation_id, diagnostic_sequence,
             kind, phase, state, tool_call_id, execution_id, duration_ms,
             error_code, metadata_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.runId,
          event.operationId,
          event.parentOperationId ?? null,
          event.diagnosticSequence,
          event.kind,
          event.phase,
          event.state,
          event.toolCallId ?? null,
          event.executionId ?? null,
          event.durationMs ?? null,
          event.errorCode ?? null,
          event.metadata === undefined ? null : JSON.stringify(event.metadata),
          event.createdAt,
        );
      return event;
    });
    return write();
  }

  listByRun(runId: string): HostDiagnosticEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM run_diagnostic_events
         WHERE run_id = ? ORDER BY diagnostic_sequence ASC`,
      )
      .all(runId) as HostDiagnosticEventRow[];
    return rows.map(toEvent);
  }
}
