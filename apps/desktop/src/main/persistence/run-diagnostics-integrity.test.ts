import type { AgentRuntimeEvent, RunDiagnosticsRecording } from '@betterwork/agent-protocol';
import { agentRuntimeEventSchema } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('run diagnostics integrity', () => {
  it('marks a host-enabled recording partial until host facts are projected', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate(
      '/tmp/run-diagnostics/host-pending',
      'host-pending',
    );
    const task = store.tasks.create(workspace.id, 'host-pending', 'diagnostics fixture');
    const recording: RunDiagnosticsRecording = { version: 2, sections: ['core', 'host'] };
    store.runs.create(
      {
        id: 'host-pending',
        taskId: task.task.id,
        sessionId: task.sessionId,
        prompt: 'fixture',
        status: 'running',
        createdAt: 1,
      },
      recording,
    );
    const event: AgentRuntimeEvent = agentRuntimeEventSchema.parse({
      id: 'host-pending-event-0',
      runId: 'host-pending',
      sequence: 0,
      createdAt: 100,
      type: 'run.started',
      taskId: task.task.id,
      sessionId: task.sessionId,
    });
    store.runs.appendEvent(event);

    expect(store.runDiagnostics.getSummary('host-pending')?.integrity).toBe('partial');
  });
});
