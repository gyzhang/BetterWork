import { afterEach, describe, expect, it } from 'vitest';
import { RunJournal } from './run-journal';

let journal: RunJournal | undefined;
afterEach(() => journal?.close());

describe('RunJournal', () => {
  it('persists runs and ordered events', () => {
    journal = new RunJournal(':memory:');
    journal.createRun({ id: 'run-1', taskId: 'task-1', sessionId: 'session-1', prompt: 'hello', status: 'running', createdAt: 1 });
    journal.appendEvent({ id: 'event-1', runId: 'run-1', sequence: 0, createdAt: 2, type: 'run.started', taskId: 'task-1', sessionId: 'session-1' });
    journal.appendEvent({ id: 'event-2', runId: 'run-1', sequence: 1, createdAt: 3, type: 'run.completed', finalContent: 'done' });
    expect(journal.listEvents('run-1').map((event) => event.type)).toEqual(['run.started', 'run.completed']);
    expect(journal.listRuns()[0]?.status).toBe('completed');
  });
});
