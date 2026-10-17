import { randomUUID } from 'node:crypto';

import { abortError } from '@betterwork/agent-core';
import {
  type AgentRuntimeEvent,
  agentRuntimeEventSchema,
  runDiagnosticsChangedEventSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import { isRunTerminalEvent, RunEventLifecycle } from './run-event-lifecycle';
import { RunHostDiagnosticRecorder } from './run-host-diagnostic-recorder';

const stores: AppStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const gate = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const stream = async function* (events: AgentRuntimeEvent[]): AsyncIterable<AgentRuntimeEvent> {
  yield* events;
};

type LifecyclePorts = ConstructorParameters<typeof RunEventLifecycle>[0];
type CompletionHooks = Parameters<RunEventLifecycle['consume']>[2];
const setup = (
  ports: Partial<Omit<LifecyclePorts, 'journal' | 'dispatch'>> = {},
  onDispatch?: (event: AgentRuntimeEvent) => void,
  diagnosticsEnabled = true,
) => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  const workspace = store.workspaces.getOrCreate('/tmp/c4-fixture', 'C4');
  const { task, sessionId } = store.tasks.create(workspace.id, 'C4', 'lifecycle');
  const runId = randomUUID();
  store.runs.create(
    {
      id: runId,
      taskId: task.id,
      sessionId,
      prompt: 'input',
      status: 'running',
      createdAt: 1,
    },
    { version: 2, sections: ['core', 'host'] },
  );
  let clock = 1;
  const runHostDiagnosticRecorder = new RunHostDiagnosticRecorder(store.runHostDiagnostics, {
    wallNow: () => clock++,
    monotonicNow: () => clock++,
  });
  const dispatched: AgentRuntimeEvent[] = [];
  const lifecycle = new RunEventLifecycle({
    ...ports,
    ...(diagnosticsEnabled && ports.runHostDiagnosticRecorder === undefined
      ? { runHostDiagnosticRecorder }
      : {}),
    journal: store.runs,
    dispatch: (event) => {
      expect(store.runs.listEvents(runId)).toContainEqual(event);
      if (isRunTerminalEvent(event)) expect(store.runs.get(runId)?.status).not.toBe('running');
      dispatched.push(event);
      onDispatch?.(event);
    },
  });
  const event = (sequence: number, payload: Record<string, unknown>): AgentRuntimeEvent =>
    agentRuntimeEventSchema.parse({
      id: randomUUID(),
      runId,
      sequence,
      createdAt: sequence + 1,
      ...payload,
    });
  const started = event(0, { type: 'run.started', taskId: task.id, sessionId });
  const completed = event(1, { type: 'run.completed', finalContent: 'final content' });
  const hooks: CompletionHooks = {
    beginCommit: () => {},
    auditFinalContent: () => {},
    saveMarkdownArtifact: async (content) => {
      store.artifacts.saveMarkdown({
        taskId: task.id,
        origin: 'assistant-run',
        runId,
        title: 'output',
        content,
      });
    },
    afterCompleted: async () => {},
  };
  const controller = new AbortController();
  const execute = async (
    events: AsyncIterable<AgentRuntimeEvent>,
    overrides: Partial<CompletionHooks> = {},
  ) => {
    try {
      await lifecycle.consume(runId, events, { ...hooks, ...overrides }, controller.signal);
    } catch (error) {
      await lifecycle.recover(runId, controller.signal, error);
    }
  };
  return {
    store,
    runId,
    lifecycle,
    dispatched,
    event,
    started,
    completed,
    hooks,
    controller,
    execute,
  };
};

const types = (events: AgentRuntimeEvent[]): string[] => events.map((event) => event.type);

describe('RunEventLifecycle', () => {
  it('publishes only the Run and host diagnostic cursor after a durable append', () => {
    const { store, runId } = setup();
    const changes: unknown[] = [];
    let clock = 1;
    const recorder = new RunHostDiagnosticRecorder(store.runHostDiagnostics, {
      wallNow: () => clock++,
      monotonicNow: () => clock++,
      onRecorded: (event) =>
        changes.push(
          runDiagnosticsChangedEventSchema.parse({
            runId: event.runId,
            cursor: { source: 'host-diagnostic', afterSequence: event.diagnosticSequence },
          }),
        ),
    });
    const started = recorder.start({
      runId,
      operationId: 'push-operation',
      kind: 'run-host',
      phase: 'prepare',
    });
    recorder.finish(started, { state: 'completed' });

    expect(changes).toEqual([
      {
        runId,
        cursor: { source: 'host-diagnostic', afterSequence: 0 },
      },
      {
        runId,
        cursor: { source: 'host-diagnostic', afterSequence: 1 },
      },
    ]);
  });

  it('defers completed persistence and artifacts until Skill and MCP cleanup both finish', async () => {
    const skillEntered = gate();
    const skillDone = gate();
    const mcpEntered = gate();
    const mcpDone = gate();
    const order: string[] = [];
    const fixture = setup({
      finishSkills: async () => {
        order.push('skill');
        skillEntered.resolve();
        await skillDone.promise;
        return { cleanupFailed: 0 };
      },
      releaseMcp: async () => {
        order.push('mcp');
        mcpEntered.resolve();
        await mcpDone.promise;
      },
    });
    const pending = fixture.execute(stream([fixture.started, fixture.completed]), {
      auditFinalContent: () => order.push('audit'),
      saveMarkdownArtifact: async (content: string) => {
        order.push('artifact');
        expect(fixture.store.runs.get(fixture.runId)?.status).toBe('running');
        await fixture.hooks.saveMarkdownArtifact(content);
      },
      afterCompleted: async () => {
        order.push('after');
        expect(fixture.store.runs.get(fixture.runId)?.status).toBe('completed');
        expect(fixture.store.artifacts.list()).toHaveLength(1);
        expect(types(fixture.dispatched)).toEqual(['run.started', 'run.completed']);
      },
    });
    await skillEntered.promise;
    expect(order).toEqual(['audit', 'skill']);
    expect(fixture.store.runs.get(fixture.runId)?.status).toBe('running');
    expect(fixture.store.artifacts.list()).toEqual([]);
    expect(types(fixture.dispatched)).toEqual(['run.started']);
    skillDone.resolve();
    await mcpEntered.promise;
    expect(fixture.store.runs.get(fixture.runId)?.status).toBe('running');
    expect(fixture.store.artifacts.list()).toEqual([]);
    mcpDone.resolve();
    await pending;
    expect(order).toEqual(['audit', 'skill', 'mcp', 'artifact', 'after']);
    expect(types(fixture.store.runs.listEvents(fixture.runId))).toEqual([
      'run.started',
      'run.completed',
    ]);
  });

  it.each(['run.failed', 'run.cancelled'] as const)(
    'cleans resources for %s without invoking completion hooks',
    async (type) => {
      const order: string[] = [];
      const fixture = setup({
        finishSkills: async () => {
          order.push('skill');
          return { cleanupFailed: 0 };
        },
        releaseMcp: async () => {
          order.push('mcp');
        },
      });
      const terminal = fixture.event(1, {
        type,
        ...(type === 'run.failed' ? { error: 'engine failure' } : { reason: 'revoked' }),
      });
      const unexpected = () => {
        throw new Error('completion hook invoked for failed/cancelled Run');
      };
      await fixture.execute(stream([fixture.started, terminal]), {
        auditFinalContent: unexpected,
        saveMarkdownArtifact: unexpected,
        afterCompleted: unexpected,
      });
      expect(order).toEqual(['skill', 'mcp']);
      expect(fixture.store.runs.listEvents(fixture.runId).at(-1)).toEqual(terminal);
      expect(fixture.store.artifacts.list()).toEqual([]);
    },
  );

  it.each(['run.completed', 'run.failed', 'run.cancelled'] as const)(
    'stops consuming after the first candidate terminal %s',
    async (type) => {
      const fixture = setup();
      const terminal = fixture.event(1, {
        type,
        ...(type === 'run.completed' ? { finalContent: 'final' } : {}),
        ...(type === 'run.failed' ? { error: 'failure' } : {}),
      });
      const events = async function* () {
        yield fixture.started;
        yield terminal;
        throw new Error('must not reach events after terminal');
      };
      await fixture.execute(events());
      expect(fixture.store.runs.listEvents(fixture.runId).at(-1)).toEqual(terminal);
      expect(fixture.dispatched).toHaveLength(2);
    },
  );

  it('fails a stream without a terminal and retains its already persisted events', async () => {
    const fixture = setup();
    await fixture.execute(stream([fixture.started]));
    expect(fixture.store.runs.get(fixture.runId)?.status).toBe('failed');
    expect(fixture.store.runs.listEvents(fixture.runId).at(-1)).toMatchObject({
      type: 'run.failed',
      sequence: 1,
      error: 'Agent 事件流结束时没有给出终态事件',
    });
    expect(types(fixture.dispatched)).toEqual(['run.started', 'run.failed']);
  });

  it('rejects failed final-content audit before cleanup and artifact publication', async () => {
    const order: string[] = [];
    const fixture = setup({
      releaseMcp: async () => {
        order.push('mcp');
      },
      finishSkills: async () => {
        order.push('skill');
        return { cleanupFailed: 0 };
      },
    });
    await fixture.execute(stream([fixture.started, fixture.completed]), {
      auditFinalContent: () => {
        order.push('audit');
        throw new Error('fact audit rejected');
      },
    });
    expect(order).toEqual(['audit', 'skill', 'mcp']);
    expect(fixture.store.artifacts.list()).toEqual([]);
    expect(types(fixture.dispatched)).toEqual(['run.started', 'run.failed']);
  });

  it.each(['run.completed', 'run.failed', 'run.cancelled'] as const)(
    'turns a cleanup-failure report before %s into one failed terminal',
    async (type) => {
      let mcpReleased = false;
      const fixture = setup({
        finishSkills: async () => ({ cleanupFailed: 1 }),
        releaseMcp: async () => {
          mcpReleased = true;
        },
      });
      await fixture.execute(
        stream([
          fixture.started,
          fixture.event(1, { type, finalContent: 'candidate', error: 'candidate failure' }),
        ]),
      );
      expect(fixture.store.runs.listEvents(fixture.runId).at(-1)).toMatchObject({
        type: 'run.failed',
        error: '子进程清理失败：未能确认全部子进程已停止',
      });
      expect(types(fixture.dispatched)).toEqual(['run.started', 'run.failed']);
      expect(fixture.store.artifacts.list()).toEqual([]);
      expect(mcpReleased).toBe(true);
      expect(fixture.store.runHostDiagnostics.listByRun(fixture.runId).slice(-4)).toMatchObject([
        { phase: 'skill-cleanup', state: 'started' },
        { phase: 'skill-cleanup', state: 'failed', errorCode: 'cleanup-failed' },
        { phase: 'mcp-cleanup', state: 'started' },
        { phase: 'mcp-cleanup', state: 'completed' },
      ]);
    },
  );

  it('preserves the cleanup exception message on the fast failure path', async () => {
    const fixture = setup({
      finishSkills: async () => {
        throw new Error('cleanup timeout');
      },
    });
    await fixture.execute(stream([fixture.started, fixture.completed]));
    expect(fixture.store.runs.listEvents(fixture.runId).at(-1)).toMatchObject({
      type: 'run.failed',
      error: '子进程清理失败：cleanup timeout',
    });
    expect(fixture.store.artifacts.list()).toEqual([]);
  });

  it('retains an MCP cleanup failure after attempting both resources without publishing an artifact', async () => {
    const order: string[] = [];
    const fixture = setup({
      releaseMcp: async () => {
        order.push('mcp');
        throw new Error('mcp release failed');
      },
      finishSkills: async () => {
        order.push('skill');
        return { cleanupFailed: 0 };
      },
    });
    await fixture.execute(stream([fixture.started, fixture.completed]));
    expect(order).toEqual(['skill', 'mcp']);
    expect(fixture.store.runs.listEvents(fixture.runId).at(-1)).toMatchObject({
      type: 'run.failed',
      error: 'MCP 连接清理失败：mcp release failed',
    });
    expect(fixture.store.artifacts.list()).toEqual([]);
  });

  it('fails artifact persistence before a completed terminal can be committed', async () => {
    const fixture = setup();
    await fixture.execute(stream([fixture.started, fixture.completed]), {
      saveMarkdownArtifact: async () => {
        throw new Error('artifact registration failed');
      },
    });
    expect(fixture.store.runs.get(fixture.runId)?.status).toBe('failed');
    expect(types(fixture.dispatched)).toEqual(['run.started', 'run.failed']);
    expect(fixture.store.artifacts.list()).toEqual([]);
    expect(fixture.store.runHostDiagnostics.listByRun(fixture.runId).slice(-2)).toMatchObject([
      { phase: 'artifact-commit', state: 'started' },
      { phase: 'artifact-commit', state: 'failed', errorCode: 'commit-failed' },
    ]);
  });

  it('keeps completed state and artifact when a post-completion callback fails', async () => {
    const fixture = setup();
    await fixture.execute(stream([fixture.started, fixture.completed]), {
      afterCompleted: async () => {
        throw new Error('continuity update failed');
      },
    });
    expect(fixture.store.runs.get(fixture.runId)?.status).toBe('completed');
    expect(fixture.store.artifacts.list()).toHaveLength(1);
    expect(types(fixture.dispatched)).toEqual(['run.started', 'run.completed']);
    expect(fixture.store.runHostDiagnostics.listByRun(fixture.runId).slice(-2)).toMatchObject([
      { phase: 'artifact-commit', state: 'started' },
      { phase: 'artifact-commit', state: 'completed' },
    ]);
  });

  it('retains a persisted ordinary event when result dispatch throws, then fails the Run', async () => {
    const fixture = setup({}, (event) => {
      if (event.type === 'run.started') throw new Error('result dispatch failed');
    });
    await fixture.execute(stream([fixture.started, fixture.completed]));
    expect(types(fixture.store.runs.listEvents(fixture.runId))).toEqual([
      'run.started',
      'run.failed',
    ]);
    expect(fixture.store.artifacts.list()).toEqual([]);
  });

  it('does not dispatch an event rejected by the Journal and still synthesizes failure', async () => {
    const fixture = setup();
    fixture.store.runs.appendEvent(fixture.started);
    await fixture.execute(stream([fixture.started, fixture.completed]));
    expect(types(fixture.dispatched)).toEqual(['run.failed']);
    expect(types(fixture.store.runs.listEvents(fixture.runId))).toEqual([
      'run.started',
      'run.failed',
    ]);
  });

  it('keeps a committed completed terminal if broadcasting it throws', async () => {
    const fixture = setup({}, (event) => {
      if (event.type === 'run.completed') throw new Error('window send failed');
    });
    await fixture.execute(stream([fixture.started, fixture.completed]));
    expect(fixture.store.runs.get(fixture.runId)?.status).toBe('completed');
    expect(fixture.store.artifacts.list()).toHaveLength(1);
    expect(types(fixture.store.runs.listEvents(fixture.runId))).toEqual([
      'run.started',
      'run.completed',
    ]);
  });

  it.each([
    { aborted: true, abortException: true, expected: 'cancelled' },
    { aborted: false, abortException: true, expected: 'failed' },
    { aborted: true, abortException: false, expected: 'failed' },
    { aborted: false, abortException: false, expected: 'failed' },
  ])('recovers setup exceptions with $expected for $aborted/$abortException', async (scenario) => {
    const fixture = setup();
    if (scenario.aborted) fixture.controller.abort();
    await fixture.lifecycle.recover(
      fixture.runId,
      fixture.controller.signal,
      scenario.abortException ? abortError() : new Error('setup failed'),
    );
    expect(fixture.store.runs.get(fixture.runId)?.status).toBe(scenario.expected);
    expect(fixture.store.runs.listEvents(fixture.runId)).toHaveLength(1);
    expect(fixture.dispatched[0]?.sequence).toBe(0);
  });

  it.each(['mcp', 'skill-report', 'skill-exception'] as const)(
    'fails aborted setup when recovery cannot confirm cleanup: %s',
    async (failure) => {
      const order: string[] = [];
      const fixture = setup({
        releaseMcp: async () => {
          order.push('mcp');
          if (failure === 'mcp') throw new Error('release failed');
        },
        finishSkills: async () => {
          order.push('skill');
          if (failure === 'skill-exception') throw new Error('finish failed');
          return { cleanupFailed: failure === 'skill-report' ? 1 : 0 };
        },
      });
      fixture.controller.abort();
      await fixture.lifecycle.recover(fixture.runId, fixture.controller.signal, abortError());
      expect(order).toEqual(['skill', 'mcp']);
      expect(fixture.store.runs.get(fixture.runId)?.status).toBe('failed');
      expect(fixture.store.runs.listEvents(fixture.runId).at(-1)).toMatchObject({
        type: 'run.failed',
        error: expect.stringContaining(failure === 'mcp' ? 'MCP 连接清理失败' : '子进程清理失败'),
      });
    },
  );

  it('continues cancellation sequence from persisted events and makes recovery idempotent', async () => {
    const fixture = setup();
    fixture.store.runs.appendEvent(fixture.started);
    fixture.controller.abort();
    await fixture.lifecycle.recover(fixture.runId, fixture.controller.signal, abortError());
    await fixture.lifecycle.recover(fixture.runId, fixture.controller.signal, abortError());
    fixture.lifecycle.fail(fixture.runId, 'late failure');
    expect(fixture.store.runs.listEvents(fixture.runId)).toHaveLength(2);
    expect(fixture.store.runs.listEvents(fixture.runId).at(-1)).toMatchObject({
      type: 'run.cancelled',
      sequence: 1,
    });
    expect(types(fixture.dispatched)).toEqual(['run.cancelled']);
  });

  it('keeps the first failure and does not append a forceFailure event twice', () => {
    const fixture = setup();
    fixture.lifecycle.fail(fixture.runId, 'first failure');
    fixture.lifecycle.fail(fixture.runId, 'second failure');
    expect(fixture.store.runs.listEvents(fixture.runId)).toHaveLength(1);
    expect(fixture.store.runs.listEvents(fixture.runId)[0]).toMatchObject({
      type: 'run.failed',
      error: 'first failure',
    });
    expect(fixture.dispatched).toHaveLength(1);
  });
});

describe('Lifecycle robustness regressions', () => {
  it.each(['skill', 'mcp'] as const)(
    'honors cancellation during %s cleanup before artifact commit',
    async (phase) => {
      const entered = gate();
      const released = gate();
      const fixture = setup({
        finishSkills: async () => {
          if (phase === 'skill') {
            entered.resolve();
            await released.promise;
          }
          return { cleanupFailed: 0 };
        },
        releaseMcp: async () => {
          if (phase === 'mcp') {
            entered.resolve();
            await released.promise;
          }
        },
      });
      const pending = fixture.execute(stream([fixture.started, fixture.completed]));
      try {
        await entered.promise;
        fixture.controller.abort('cancel while cleaning');
        released.resolve();
        await pending;
        expect(fixture.store.runs.get(fixture.runId)?.status).toBe('cancelled');
        expect(fixture.store.artifacts.list()).toHaveLength(0);
        expect(fixture.dispatched.at(-1)).toMatchObject({
          type: 'run.cancelled',
          reason: 'cancel while cleaning',
        });
        expect(fixture.store.runHostDiagnostics.listByRun(fixture.runId).slice(-2)).toMatchObject([
          { phase: 'artifact-commit', state: 'started' },
          { phase: 'artifact-commit', state: 'completed' },
        ]);
      } finally {
        released.resolve();
        await pending;
      }
    },
  );

  it('attempts both cleanup ports and preserves both errors before one failed terminal', async () => {
    const order: string[] = [];
    const fixture = setup({
      finishSkills: async () => {
        order.push('skill');
        throw new Error('skill cleanup failure');
      },
      releaseMcp: async () => {
        order.push('mcp');
        throw new Error('mcp cleanup failure');
      },
    });
    await fixture.execute(stream([fixture.started, fixture.completed]));
    expect(order).toEqual(['skill', 'mcp']);
    const failure = fixture.dispatched.at(-1);
    expect(failure).toMatchObject({
      type: 'run.failed',
      error: expect.stringContaining('skill cleanup failure'),
    });
    expect(failure).toMatchObject({ error: expect.stringContaining('mcp cleanup failure') });
    expect(fixture.store.artifacts.list()).toHaveLength(0);
  });

  it('records audit, both cleanup boundaries, and the artifact commit in observed order', async () => {
    const calls: string[] = [];
    const fixture = setup({
      finishSkills: async () => {
        calls.push('skill-cleanup');
        return { cleanupFailed: 0 };
      },
      releaseMcp: async () => {
        calls.push('mcp-cleanup');
      },
    });
    await fixture.execute(stream([fixture.started, fixture.completed]), {
      auditFinalContent: () => calls.push('audit'),
      beginCommit: () => calls.push('begin-commit'),
      saveMarkdownArtifact: async (content) => {
        calls.push('artifact');
        await fixture.hooks.saveMarkdownArtifact(content);
      },
      afterCompleted: async () => {
        calls.push('after-completed');
      },
    });

    expect(calls).toEqual([
      'audit',
      'skill-cleanup',
      'mcp-cleanup',
      'begin-commit',
      'artifact',
      'after-completed',
    ]);
    expect(fixture.store.runHostDiagnostics.listByRun(fixture.runId)).toMatchObject([
      { kind: 'run-host', phase: 'audit', state: 'started', diagnosticSequence: 0 },
      { kind: 'run-host', phase: 'audit', state: 'completed', diagnosticSequence: 1 },
      { kind: 'run-host', phase: 'skill-cleanup', state: 'started', diagnosticSequence: 2 },
      { kind: 'run-host', phase: 'skill-cleanup', state: 'completed', diagnosticSequence: 3 },
      { kind: 'run-host', phase: 'mcp-cleanup', state: 'started', diagnosticSequence: 4 },
      { kind: 'run-host', phase: 'mcp-cleanup', state: 'completed', diagnosticSequence: 5 },
      { kind: 'run-host', phase: 'artifact-commit', state: 'started', diagnosticSequence: 6 },
      { kind: 'run-host', phase: 'artifact-commit', state: 'completed', diagnosticSequence: 7 },
    ]);
    expect(fixture.store.runs.get(fixture.runId)?.status).toBe('completed');
    expect(fixture.store.artifacts.list()).toHaveLength(1);
  });

  it('keeps a successful Run and artifact when host diagnostic writes fail', async () => {
    const fixture = setup({
      finishSkills: async () => ({ cleanupFailed: 0 }),
      releaseMcp: async () => {},
    });
    const db = (fixture.store as unknown as { db: Database.Database }).db;
    db.exec(`CREATE TRIGGER fail_run_diagnostic_insert BEFORE INSERT ON run_diagnostic_events
      BEGIN SELECT RAISE(FAIL, 'diagnostic store unavailable'); END`);
    const observerLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await fixture.execute(stream([fixture.started, fixture.completed]));
      expect(observerLog).toHaveBeenCalled();
      expect(JSON.stringify(observerLog.mock.calls)).not.toContain('diagnostic store unavailable');
    } finally {
      observerLog.mockRestore();
    }

    expect(fixture.store.runs.get(fixture.runId)?.status).toBe('completed');
    expect(fixture.store.artifacts.list()).toHaveLength(1);
    expect(fixture.store.runHostDiagnostics.listByRun(fixture.runId)).toEqual([]);
  });

  it('preserves one cancelled terminal when host diagnostic writes fail during cleanup', async () => {
    const fixture = setup({
      finishSkills: async () => ({ cleanupFailed: 0 }),
      releaseMcp: async () => {},
    });
    const db = (fixture.store as unknown as { db: Database.Database }).db;
    db.exec(`CREATE TRIGGER fail_run_diagnostic_insert BEFORE INSERT ON run_diagnostic_events
      BEGIN SELECT RAISE(FAIL, 'diagnostic store unavailable'); END`);
    const observerLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    fixture.controller.abort('user cancelled');

    try {
      await fixture.execute(stream([fixture.started, fixture.completed]));
      expect(observerLog).toHaveBeenCalled();
      expect(JSON.stringify(observerLog.mock.calls)).not.toContain('diagnostic store unavailable');
    } finally {
      observerLog.mockRestore();
    }

    expect(fixture.store.runs.get(fixture.runId)?.status).toBe('cancelled');
    expect(types(fixture.store.runs.listEvents(fixture.runId))).toEqual([
      'run.started',
      'run.cancelled',
    ]);
    expect(fixture.dispatched).toHaveLength(2);
    expect(fixture.store.artifacts.list()).toEqual([]);
    expect(fixture.store.runHostDiagnostics.listByRun(fixture.runId)).toEqual([]);
  });

  it('keeps the same terminal and artifact when host observation is disabled', async () => {
    const calls: string[] = [];
    const fixture = setup(
      {
        finishSkills: async () => {
          calls.push('skill-cleanup');
          return { cleanupFailed: 0 };
        },
        releaseMcp: async () => {
          calls.push('mcp-cleanup');
        },
      },
      undefined,
      false,
    );

    await fixture.execute(stream([fixture.started, fixture.completed]), {
      auditFinalContent: () => calls.push('audit'),
      beginCommit: () => calls.push('begin-commit'),
      saveMarkdownArtifact: async (content) => {
        calls.push('artifact');
        await fixture.hooks.saveMarkdownArtifact(content);
      },
      afterCompleted: async () => {
        calls.push('after-completed');
      },
    });

    expect(calls).toEqual([
      'audit',
      'skill-cleanup',
      'mcp-cleanup',
      'begin-commit',
      'artifact',
      'after-completed',
    ]);
    expect(fixture.store.runs.get(fixture.runId)?.status).toBe('completed');
    expect(fixture.store.artifacts.list()).toHaveLength(1);
    expect(fixture.store.runHostDiagnostics.listByRun(fixture.runId)).toEqual([]);
    expect(types(fixture.dispatched)).toEqual(['run.started', 'run.completed']);
  });
});
