import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  type AgentRuntimeEvent,
  agentRuntimeEventSchema,
  type RunSummary,
} from '@betterwork/agent-protocol';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore, RunRepository } from './index';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};
const seedTask = (store: AppStore, label = 'history') => {
  const workspace = store.workspaces.getOrCreate(`/tmp/run-read-model/${label}`, label);
  return store.tasks.create(workspace.id, label, 'read model');
};
const message = (runId: string, sequence: number, content: string): AgentRuntimeEvent => ({
  id: `${runId}-e${sequence}`,
  runId,
  sequence,
  createdAt: sequence,
  type: 'message.completed',
  messageId: `${runId}-m${sequence}`,
  content,
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

describe('RunRepository history and source read models', () => {
  it('batches all requested nonempty answers in first-request order with the original decode window', () => {
    const store = openStore();
    const task = seedTask(store);
    const ids = Array.from({ length: 1_103 }, (_, index) => `batch-${index}`);
    store.transaction(() => {
      for (const [index, id] of ids.entries()) {
        store.runs.create({
          id,
          taskId: task.task.id,
          sessionId: task.sessionId,
          prompt: id,
          status: 'completed',
          createdAt: index,
          completedAt: index,
        });
        if (index === 4) continue;
        store.runs.appendEvent(message(id, 1, index === 3 ? '' : 'older'));
        if (index !== 3)
          store.runs.appendEvent(
            message(id, 3, ['\u0000', ' ', '中文😀'][index] ?? `answer ${index}`),
          );
        store.runs.appendEvent(message(id, 8, ''));
      }
    });
    const requested = [...ids].reverse().concat('missing', ids[0]!);
    const expected = [...new Set(requested)].flatMap((id) => {
      const event = store.runs.getLatestNonEmptyMessageCompletion(id);
      return event === undefined ? [] : [event];
    });
    const db = (store as unknown as { db: Database.Database }).db;
    const prepare = vi.spyOn(db, 'prepare');
    const parse = vi.spyOn(agentRuntimeEventSchema, 'parse');
    const pointRead = vi.spyOn(store.runs, 'getLatestNonEmptyMessageCompletion');
    expect(store.runs.listLatestNonEmptyMessageCompletions([])).toEqual([]);
    expect(prepare).not.toHaveBeenCalled();
    expect(store.runs.listLatestNonEmptyMessageCompletions(requested)).toEqual(expected);
    expect(expected).toHaveLength(1_101);
    expect(parse).toHaveBeenCalledTimes(2_204);
    expect(pointRead).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledOnce();
    const sql = prepare.mock.calls[0]![0];
    expect(sql).toContain('json_each(?)');
    expect(sql.match(/\?/gu)).toHaveLength(1);
    expect(sql).not.toMatch(/ORDER BY ordinal[^]*LIMIT/u);
    store.runs.appendEvent(message(ids[0]!, 10, 'updated'));
    expect(store.runs.listLatestNonEmptyMessageCompletions([ids[0]!])).toEqual([
      message(ids[0]!, 10, 'updated'),
    ]);
  });

  it('keeps duplicate and escaped JSON content keys equal to the original decoder', () => {
    const store = openStore();
    const task = seedTask(store);
    store.runs.create({
      id: 'duplicate',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'duplicate',
      status: 'completed',
      createdAt: 0,
    });
    store.runs.appendEvent(message('duplicate', 3, 'older answer'));
    const latest = message('duplicate', 7, '');
    store.runs.appendEvent(latest);
    const db = (store as unknown as { db: Database.Database }).db;
    for (const [first, last] of [
      ['', 'answer'],
      ['answer', ''],
      [null, ''],
      ['', '\u0000'],
      ['\u0000', ''],
    ] as const) {
      const raw = JSON.stringify({ ...latest, content: first }).slice(0, -1);
      db.prepare('UPDATE run_events SET payload = ? WHERE id = ?').run(
        `${raw},"cont\\u0065nt":${JSON.stringify(last)}}`,
        latest.id,
      );
      const expected = store.runs.getLatestNonEmptyMessageCompletion('duplicate');
      const parse = vi.spyOn(agentRuntimeEventSchema, 'parse');
      expect(store.runs.listLatestNonEmptyMessageCompletions(['duplicate'])).toEqual([expected]);
      expect(parse).toHaveBeenCalledTimes(last === '' ? 2 : 1);
      parse.mockRestore();
    }
  });

  it.each([false, true])('keeps a long empty tail complete (all empty: %s)', (allEmpty) => {
    const store = openStore();
    const task = seedTask(store);
    store.runs.create({
      id: 'deep',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'deep',
      status: 'completed',
      createdAt: 0,
    });
    store.transaction(() => {
      store.runs.appendEvent(message('deep', 1, allEmpty ? '' : 'answer'));
      for (let sequence = 2; sequence <= 1_308; sequence += 1)
        store.runs.appendEvent(message('deep', sequence, ''));
    });
    const expected = store.runs.getLatestNonEmptyMessageCompletion('deep');
    const parse = vi.spyOn(agentRuntimeEventSchema, 'parse');
    expect(store.runs.listLatestNonEmptyMessageCompletions(['deep'])).toEqual(
      expected === undefined ? [] : [expected],
    );
    expect(parse).toHaveBeenCalledTimes(1_308);
  });

  it('never consumes old messages or unrelated event payloads after finding the answer', () => {
    const store = openStore();
    const task = seedTask(store);
    for (const id of ['window', 'outside'])
      store.runs.create({
        id,
        taskId: task.task.id,
        sessionId: task.sessionId,
        prompt: id,
        status: 'completed',
        createdAt: 0,
      });
    const older = message('window', 1, 'older');
    const answer = message('window', 3, 'answer');
    const empty = message('window', 7, '');
    for (const event of [older, answer, empty, message('outside', 1, 'outside')])
      store.runs.appendEvent(event);
    store.runs.appendEvent({
      id: 'irrelevant',
      runId: 'window',
      sequence: 9,
      createdAt: 9,
      type: 'reasoning.delta',
      delta: 'private',
    });
    const db = (store as unknown as { db: Database.Database }).db;
    for (const id of [older.id, 'outside-e1', 'irrelevant'])
      db.prepare('UPDATE run_events SET payload = ? WHERE id = ?').run('{', id);
    expect(store.runs.getLatestNonEmptyMessageCompletion('window')).toEqual(answer);
    const parse = vi.spyOn(agentRuntimeEventSchema, 'parse');
    expect(store.runs.listLatestNonEmptyMessageCompletions(['window'])).toEqual([answer]);
    expect(parse.mock.calls.map(([value]) => value)).toEqual([empty, answer]);
  });

  it.each(['id', 'runId', 'sequence', 'type', 'syntax', 'schema', 'number', 'null', 'messageId'])(
    'rejects consumed answer and empty-tail %s corruption like the original reader',
    (kind) => {
      const store = openStore();
      const task = seedTask(store);
      store.runs.create({
        id: 'corrupt',
        taskId: task.task.id,
        sessionId: task.sessionId,
        prompt: 'corrupt',
        status: 'completed',
        createdAt: 0,
      });
      const answer = message('corrupt', 3, 'answer');
      const empty = message('corrupt', 7, '');
      store.runs.appendEvent(answer);
      store.runs.appendEvent(empty);
      const db = (store as unknown as { db: Database.Database }).db;
      for (const target of [answer, empty]) {
        const patch =
          kind === 'type'
            ? { type: 'message.delta', delta: '' }
            : kind === 'sequence'
              ? { sequence: 99 }
              : kind === 'number' || kind === 'null'
                ? { content: kind === 'number' ? 0 : null }
                : kind === 'messageId'
                  ? { messageId: undefined }
                  : { [kind]: 'forged' };
        const payload =
          kind === 'syntax'
            ? '{'
            : kind === 'schema'
              ? '{}'
              : JSON.stringify({ ...target, ...patch });
        db.prepare('UPDATE run_events SET payload = ? WHERE id = ?').run(payload, target.id);
        expect(() => store.runs.getLatestNonEmptyMessageCompletion('corrupt')).toThrow();
        expect(() => store.runs.listLatestNonEmptyMessageCompletions(['corrupt'])).toThrow();
        db.prepare('UPDATE run_events SET payload = ? WHERE id = ?').run(
          JSON.stringify(target),
          target.id,
        );
      }
      store.runs.appendEvent(message('corrupt', 10, 'recovered'));
      expect(store.runs.listLatestNonEmptyMessageCompletions(['corrupt'])).toEqual([
        message('corrupt', 10, 'recovered'),
      ]);
    },
  );

  it('filters all replay candidates before events with the existing time and tie order', () => {
    const store = openStore();
    const task = seedTask(store);
    const other = seedTask(store, 'other');
    const seed = (
      id: string,
      createdAt: number,
      status: RunSummary['status'],
      completedAt?: number,
    ) => {
      store.runs.create({
        id,
        taskId: task.task.id,
        sessionId: task.sessionId,
        prompt: id,
        createdAt,
        status,
        ...(completedAt === undefined ? {} : { completedAt }),
      });
    };
    for (let index = 0; index < 112; index += 1)
      seed(`eligible-${index}`, index % 4, 'completed', 90);
    seed('null-completion', 50, 'completed');
    seed('current', 100, 'completed', 90);
    seed('future-start', 101, 'completed', 90);
    seed('equal-start', 100, 'completed', 90);
    seed('future-finish', 70, 'completed', 91);
    seed('running', 80, 'running');
    seed('failed', 80, 'failed', 90);
    seed('cancelled', 80, 'cancelled', 90);
    store.runs.create({
      id: 'other-task',
      taskId: other.task.id,
      sessionId: other.sessionId,
      prompt: 'other',
      status: 'completed',
      createdAt: 1,
      completedAt: 90,
    });
    const expected = store.runs
      .listByTask(task.task.id)
      .filter(
        (run) =>
          run.id !== 'current' &&
          run.status === 'completed' &&
          run.createdAt < 100 &&
          (run.completedAt === undefined || run.completedAt <= 90),
      );
    const actual = store.runs.listHistoryReplayCandidates({
      taskId: task.task.id,
      currentRunId: 'current',
      createdBefore: 100,
      completedAtOrBefore: 90,
    });
    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(113);
    expect(
      store.runs.listHistoryReplayCandidates({
        taskId: task.task.id,
        currentRunId: 'missing',
        completedAtOrBefore: 90,
      }),
    ).toHaveLength(116);
  });

  it('keeps latest-message, nonempty-history and first-terminal semantics distinct', () => {
    const store = openStore();
    const task = seedTask(store);
    store.runs.create({
      id: 'run',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'test',
      status: 'running',
      createdAt: 0,
    });
    const events: AgentRuntimeEvent[] = [
      message('run', 1, 'old'),
      message('run', 7, ''),
      message('run', 3, 'latest'),
      {
        id: 'run-e6',
        runId: 'run',
        sequence: 6,
        createdAt: 6,
        type: 'tool.progress',
        toolCallId: 'call',
        message: 'progress',
      },
      {
        id: 'run-e8',
        runId: 'run',
        sequence: 8,
        createdAt: 8,
        type: 'run.completed',
        finalContent: 'latest',
      },
      {
        id: 'run-e9',
        runId: 'run',
        sequence: 9,
        createdAt: 9,
        type: 'run.completed',
        finalContent: 'later terminal',
      },
    ];
    for (const event of events) store.runs.appendEvent(event);
    const full = store.runs.listEvents('run');
    expect(store.runs.getLatestMessageCompletion('run')).toEqual(
      full.filter((event) => event.type === 'message.completed').at(-1),
    );
    expect(store.runs.getLatestNonEmptyMessageCompletion('run')).toEqual(
      message('run', 3, 'latest'),
    );
    expect(store.runs.getFirstRunCompletion('run')).toEqual(events[4]);
    expect(store.runs.getEvent('run', 'run-e3')).toEqual(message('run', 3, 'latest'));
    expect(store.runs.getEvent('other-run', 'run-e3')).toBeUndefined();
    expect(store.runs.getEvent('run', 'missing')).toBeUndefined();
    expect(store.runs.getLatestNonEmptyMessageCompletion('missing')).toBeUndefined();
    expect(store.runs.getFirstRunCompletion('missing')).toBeUndefined();
    expect(store.runs.hasToolEventAfter('run', 3)).toBe(true);
    expect(store.runs.hasToolEventAfter('run', 6)).toBe(false);
    store.runs.appendEvent(message('run', 10, 'cursor released'));
    expect(store.runs.getLatestNonEmptyMessageCompletion('run')?.content).toBe('cursor released');
  });

  it('decodes only consumed message completions and ignores earlier irrelevant events', () => {
    const store = openStore();
    const task = seedTask(store);
    store.runs.create({
      id: 'run',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'test',
      status: 'running',
      createdAt: 0,
    });
    for (const event of [
      message('run', 1, 'older'),
      message('run', 2, 'answer'),
      message('run', 3, ''),
    ])
      store.runs.appendEvent(event);
    const parse = vi.spyOn(agentRuntimeEventSchema, 'parse');
    expect(store.runs.getLatestMessageCompletion('run')?.content).toBe('');
    expect(parse).toHaveBeenCalledTimes(1);
    parse.mockClear();
    expect(store.runs.getLatestNonEmptyMessageCompletion('run')?.content).toBe('answer');
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed target payloads and mismatched journal identities without full reads', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-event-read-model-'));
    const store = AppStore.open(path.join(directory, 'app.db'));
    const statements: string[] = [];
    const db = new Database(path.join(directory, 'app.db'), {
      verbose: (sql) => {
        if (typeof sql === 'string') statements.push(sql);
      },
    });
    try {
      const task = seedTask(store);
      store.runs.create({
        id: 'run',
        taskId: task.task.id,
        sessionId: task.sessionId,
        prompt: 'test',
        status: 'running',
        createdAt: 0,
      });
      store.runs.appendEvent({
        id: 'irrelevant',
        runId: 'run',
        sequence: 0,
        createdAt: 0,
        type: 'reasoning.delta',
        delta: 'private',
      });
      const target = message('run', 1, 'answer');
      store.runs.appendEvent(target);
      db.prepare('UPDATE run_events SET payload = ? WHERE id = ?').run('{}', 'irrelevant');
      const repository = new RunRepository(db);
      expect(repository.getLatestNonEmptyMessageCompletion('run')).toEqual(target);
      expect(() => store.runs.listEvents('run')).toThrow();
      const corrupt = db.prepare('UPDATE run_events SET payload = ? WHERE id = ?');
      for (const patch of [
        { id: 'forged' },
        { runId: 'other' },
        { sequence: 99 },
        { type: 'message.delta', delta: 'forged' },
      ]) {
        corrupt.run(JSON.stringify({ ...target, ...patch }), target.id);
        expect(() => repository.getEvent('run', target.id)).toThrow('metadata');
        expect(() => repository.getLatestMessageCompletion('run')).toThrow('metadata');
      }
      corrupt.run('{}', target.id);
      expect(() => repository.getLatestNonEmptyMessageCompletion('run')).toThrow();
      corrupt.run(JSON.stringify(target), target.id);
      statements.length = 0;
      expect(repository.hasToolEventAfter('run', 0)).toBe(false);
      expect(statements).toHaveLength(1);
      expect(statements[0]).toContain('SELECT EXISTS');
      expect(statements[0]).not.toMatch(/payload|LIMIT/u);
    } finally {
      db.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
