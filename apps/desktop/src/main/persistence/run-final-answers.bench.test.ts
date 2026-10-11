import { agentRuntimeEventSchema } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import { legacyHistoryAnswers, seedReplayRun } from '../services/fixtures/history-memory-fixtures';
import { AppStore } from './index';

const measure = (read: () => unknown) => {
  read();
  const samples = Array.from({ length: 9 }, () => {
    const start = performance.now();
    read();
    return performance.now() - start;
  }).sort((left, right) => left - right);
  return { medianMs: samples[4]!, p95Ms: samples[8]! };
};

describe('History final answer batches', () => {
  it.each(['none', 'mixed'] as const)(
    'compares native point reads with full validated batches (empty tail: %s)',
    (emptyTail) => {
      const store = AppStore.open(':memory:');
      try {
        const workspaceId = store.workspaces.getOrCreate('/tmp/answer-batches-bench', 'bench').id;
        const task = store.tasks.create(workspaceId, 'bench', 'bench');
        const ids: string[] = [];
        let consumedRows = 0;
        store.transaction(() => {
          for (let index = 0; index < 256; index += 1) {
            const id = seedReplayRun(store, {
              taskId: task.task.id,
              sessionId: task.sessionId,
              workspaceId,
              index,
            });
            ids.push(id);
            for (let sequence = 2; sequence <= 25; sequence += 1)
              store.runs.appendEvent({
                id: `${id}-${sequence}`,
                runId: id,
                sequence,
                createdAt: sequence,
                type: 'message.completed',
                messageId: id,
                content: 'older '.repeat(400),
              });
            const tail = emptyTail === 'mixed' ? index % 3 : 0;
            consumedRows += tail + 1;
            for (let offset = 0; offset <= tail; offset += 1)
              store.runs.appendEvent({
                id: `${id}-final-${offset}`,
                runId: id,
                sequence: 100 + offset,
                createdAt: 100 + offset,
                type: 'message.completed',
                messageId: id,
                content: offset === 0 ? `last answer ${index}` : '',
              });
          }
        });
        ids.reverse();
        const legacy = () => legacyHistoryAnswers(store, ids);
        const batch = () => store.runs.listLatestNonEmptyMessageCompletions(ids);
        expect(batch()).toEqual(legacy());
        const observe = (read: typeof batch) => {
          const db = (store as unknown as { db: Database.Database }).db;
          const prepare = vi.spyOn(db, 'prepare');
          const parse = vi.spyOn(agentRuntimeEventSchema, 'parse');
          try {
            const answers = read();
            return {
              queries: prepare.mock.calls.length,
              consumedRows: parse.mock.calls.length,
              consumedJsonBytes: parse.mock.calls.reduce(
                (total, [value]) => total + Buffer.byteLength(JSON.stringify(value), 'utf8'),
                0,
              ),
              answerJsonBytes: Buffer.byteLength(JSON.stringify(answers), 'utf8'),
            };
          } finally {
            prepare.mockRestore();
            parse.mockRestore();
          }
        };
        const legacyReads = observe(legacy);
        const batchReads = observe(batch);
        expect(legacyReads.queries).toBe(256);
        expect(batchReads.queries).toBe(1);
        expect(batchReads.consumedRows).toBe(consumedRows);
        expect(batchReads.consumedRows).toBe(legacyReads.consumedRows);
        expect(batchReads.consumedJsonBytes).toBe(legacyReads.consumedJsonBytes);
        expect(batchReads.answerJsonBytes).toBe(legacyReads.answerJsonBytes);
        console.warn(
          JSON.stringify({
            benchmark: 'history-final-answer-read-stage',
            actualRuns: ids.length,
            emptyTail,
            olderMessages: 6_400,
            legacyReads,
            batchReads,
            legacyTiming: measure(legacy),
            batchTiming: measure(batch),
            machine: `${process.platform} ${process.arch} node ${process.version}`,
          }),
        );
      } finally {
        vi.restoreAllMocks();
        store.close();
      }
    },
  );
});
