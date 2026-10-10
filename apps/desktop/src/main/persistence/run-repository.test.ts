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
