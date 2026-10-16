import type { AgentRuntimeEvent, RunDiagnosticNode } from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import {
  hasRunEventSequenceGap,
  isRunDiagnosticsRelevantEvent,
  mergeRunDiagnosticNodes,
} from './run-diagnostics';

const node = (
  id: string,
  kind: RunDiagnosticNode['kind'],
  sequence: number | undefined,
  status: RunDiagnosticNode['status'] = 'running',
): RunDiagnosticNode => ({
  id,
  kind,
  status,
  sourceKind: 'core-journal',
  sourceId: id,
  evidenceState: 'recorded',
  ...(sequence === undefined ? {} : { sourceSequenceStart: sequence }),
});

const event = (sequence: number, type: AgentRuntimeEvent['type']): AgentRuntimeEvent => {
  if (type === 'run.started') {
    return {
      id: `event-${sequence}`,
      runId: 'run-a',
      sequence,
      createdAt: sequence,
      type,
      taskId: 'task-a',
      sessionId: 'session-a',
    };
  }
  if (type === 'message.delta') {
    return {
      id: `event-${sequence}`,
      runId: 'run-a',
      sequence,
      createdAt: sequence,
      type,
      messageId: 'message-a',
      delta: '正文',
    };
  }
  return {
    id: `event-${sequence}`,
    runId: 'run-a',
    sequence,
    createdAt: sequence,
    type: 'model.failed',
    modelCallId: 'model-a',
    round: 0,
    durationMs: 1,
    errorCode: 'provider-error',
    errorSummary: 'synthetic failure',
  };
};

describe('run diagnostics merge helpers', () => {
  it('deduplicates by node ID, keeps the newest projection, and sorts deterministically', () => {
    const merged = mergeRunDiagnosticNodes(
      [
        node('model-b', 'model', 2),
        node('model-a', 'model', 2),
        node('tool-a', 'tool', 3),
        node('legacy', 'model', undefined),
      ],
      [node('model-b', 'model', 2, 'completed'), node('round-a', 'round', 2)],
    );

    expect(merged.map(({ id, status }) => [id, status])).toEqual([
      ['round-a', 'running'],
      ['model-a', 'running'],
      ['model-b', 'completed'],
      ['tool-a', 'running'],
      ['legacy', 'running'],
    ]);
  });

  it('detects a missing sequence after unordered or duplicate event acknowledgements', () => {
    expect(hasRunEventSequenceGap([event(0, 'run.started'), event(2, 'message.delta')])).toBe(true);
    expect(hasRunEventSequenceGap([event(1, 'model.failed')])).toBe(true);
    expect(
      hasRunEventSequenceGap([
        event(2, 'model.failed'),
        event(0, 'run.started'),
        event(1, 'message.delta'),
        event(1, 'message.delta'),
      ]),
    ).toBe(false);
    expect(hasRunEventSequenceGap([])).toBe(false);
  });

  it('marks model and tool lifecycle events for refresh, but not message content', () => {
    expect(isRunDiagnosticsRelevantEvent(event(1, 'model.failed'))).toBe(true);
    expect(
      isRunDiagnosticsRelevantEvent({
        id: 'tool-failed',
        runId: 'run-a',
        sequence: 2,
        createdAt: 2,
        type: 'tool.failed',
        toolCallId: 'tool-a',
        error: 'synthetic failure',
      }),
    ).toBe(true);
    expect(
      isRunDiagnosticsRelevantEvent({
        id: 'run-completed',
        runId: 'run-a',
        sequence: 3,
        createdAt: 3,
        type: 'run.completed',
        finalContent: '完成',
      }),
    ).toBe(true);
    expect(isRunDiagnosticsRelevantEvent(event(2, 'message.delta'))).toBe(false);
  });
});
