import type { AgentRuntimeEvent } from '@betterwork/agent-protocol';
import { agentRuntimeEventSchema } from '@betterwork/agent-protocol';
import { describe, expect, it, vi } from 'vitest';

import { AppStore } from './index';

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
const toolTypes = new Set([
  'tool.requested',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
]);

const measure = (read: () => unknown): { medianMs: number; p95Ms: number } => {
  read();
  const samples = Array.from({ length: 9 }, () => {
    const start = performance.now();
    read();
    return performance.now() - start;
  }).sort((left, right) => left - right);
  return { medianMs: samples[4]!, p95Ms: samples[8]! };
};

describe('RunRepository history and source event read model scale', () => {
  it('compares complete journals with validated targets and metadata evidence', () => {
    const store = AppStore.open(':memory:');
    try {
      const workspace = store.workspaces.getOrCreate('/tmp/event-read-model-bench', 'bench');
      const task = store.tasks.create(workspace.id, 'bench', 'bench');
      const runIds = Array.from({ length: 32 }, (_, index) => `run-${index}`);
      store.transaction(() => {
        for (const runId of runIds) {
          store.runs.create({
            id: runId,
            taskId: task.task.id,
            sessionId: task.sessionId,
            prompt: 'prompt',
            status: 'running',
            createdAt: 0,
          });
          for (let sequence = 0; sequence < 250; sequence += 1) {
            const base = { id: `${runId}-${sequence}`, runId, sequence, createdAt: sequence };
            const event: AgentRuntimeEvent =
              sequence % 2 === 0
                ? { ...base, type: 'tool.completed', toolCallId: 'call', output: 'x'.repeat(8_192) }
                : { ...base, type: 'reasoning.delta', delta: 'x'.repeat(256) };
            store.runs.appendEvent(event);
          }
          for (const [sequence, content] of [
            [250, 'older'],
            [251, 'final answer'],
            [252, ''],
          ] as const) {
            store.runs.appendEvent({
              id: `${runId}-${sequence}`,
              runId,
              sequence,
              createdAt: sequence,
              type: 'message.completed',
              messageId: runId,
              content,
            });
          }
          store.runs.appendEvent({
            id: `${runId}-terminal`,
            runId,
            sequence: 253,
            createdAt: 253,
            type: 'run.completed',
            finalContent: 'final answer',
          });
        }
      });
      const readFull = () => runIds.map((runId) => store.runs.listEvents(runId));
      const summarize = (events: AgentRuntimeEvent[]) => {
        const messages = events.filter((event) => event.type === 'message.completed');
        return {
          latest: messages.at(-1),
          nonempty: [...messages].reverse().find((event) => event.content.length > 0),
          terminal: events.find((event) => event.type === 'run.completed'),
          exact: events.find((event) => event.id === `${events[0]!.runId}-251`),
          laterTool: events.some((event) => event.sequence > 251 && toolTypes.has(event.type)),
        };
      };
      const readTargets = () =>
        runIds.map((runId) => ({
          latest: store.runs.getLatestMessageCompletion(runId),
          nonempty: store.runs.getLatestNonEmptyMessageCompletion(runId),
          terminal: store.runs.getFirstRunCompletion(runId),
          exact: store.runs.getEvent(runId, `${runId}-251`),
          laterTool: store.runs.hasToolEventAfter(runId, 251),
        }));
      const parse = vi.spyOn(agentRuntimeEventSchema, 'parse');
      const full = readFull();
      const fullDecodedRows = parse.mock.calls.length;
      parse.mockClear();
      const targets = readTargets();
      const targetDecodedRows = parse.mock.calls.length;
      parse.mockRestore();
      expect(targets).toEqual(full.map(summarize));
      expect(fullDecodedRows).toBe(32 * 254);
      expect(targetDecodedRows).toBe(32 * 5);
      expect(bytes(targets)).toBeLessThan(bytes(full) / 100);
      console.warn(
        JSON.stringify({
          benchmark: 'history-source-event-read-model',
          runs: runIds.length,
          storedRows: fullDecodedRows,
          fullDecodedRows,
          targetDecodedRows,
          fullBytes: bytes(full),
          targetBytes: bytes(targets),
          fullTiming: measure(readFull),
          targetTiming: measure(readTargets),
          machine: `${process.platform} ${process.arch} node ${process.version}`,
        }),
      );
    } finally {
      vi.restoreAllMocks();
      store.close();
    }
  }, 15_000);
});
