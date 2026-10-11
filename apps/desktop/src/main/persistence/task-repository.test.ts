import type { RecentTaskSummary } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

interface TaskFixture {
  workspaceId: string;
  taskId: string;
  sessionId: string;
}

const createTask = (store: AppStore, title = 'Task', goal = 'Goal'): TaskFixture => {
  const workspace = store.workspaces.create('/tmp/test-ws', 'Test Workspace');
  const { task, sessionId } = store.tasks.create(workspace.id, title, goal);
  return { workspaceId: workspace.id, taskId: task.id, sessionId };
};

const createRun = (
  store: AppStore,
  fixture: TaskFixture,
  runId: string,
  overrides: { status?: 'running' | 'completed' | 'failed' | 'cancelled'; prompt?: string } = {},
): void => {
  store.runs.create({
    id: runId,
    taskId: fixture.taskId,
    sessionId: fixture.sessionId,
    prompt: overrides.prompt ?? 'test prompt',
    status: overrides.status ?? 'running',
    createdAt: Date.now(),
  });
};

describe('TaskRepository.create', () => {
  it('creates a task and returns a summary with a session id', () => {
    const store = openStore();
    const workspace = store.workspaces.create('/tmp/test-ws', 'Test Workspace');
    const result = store.tasks.create(workspace.id, 'My Task', 'My goal');
    expect(result.task.id).toBeTruthy();
    expect(result.task.workspaceId).toBe(workspace.id);
    expect(result.task.title).toBe('My Task');
    expect(result.task.goal).toBe('My goal');
    expect(result.task.createdAt).toBe(result.task.updatedAt);
    expect(result.sessionId).toBeTruthy();
  });

  it('throws when the workspace does not exist', () => {
    const store = openStore();
    expect(() => store.tasks.create('nonexistent-ws', 'Title', 'Goal')).toThrow(
      'Workspace does not exist',
    );
  });
});

describe('TaskRepository.getSummary', () => {
  it('returns the task summary for a valid id', () => {
    const store = openStore();
    const fixture = createTask(store);
    const summary = store.tasks.getSummary(fixture.taskId);
    expect(summary).toBeDefined();
    expect(summary?.id).toBe(fixture.taskId);
    expect(summary?.workspaceId).toBe(fixture.workspaceId);
    expect(summary?.title).toBe('Task');
    expect(summary?.goal).toBe('Goal');
  });

  it('returns undefined for a nonexistent task', () => {
    const store = openStore();
    expect(store.tasks.getSummary('nonexistent-task')).toBeUndefined();
  });
});

describe('TaskRepository.listRecent: Task→Session→Run JOIN', () => {
  it('returns a task with its session but no latestRun when no runs exist', () => {
    const store = openStore();
    const fixture = createTask(store);
    const results = store.tasks.listRecent();
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(fixture.taskId);
    expect(results[0]?.sessionId).toBe(fixture.sessionId);
    expect(results[0]?.latestRun).toBeUndefined();
  });

  it('includes the latest run when a run exists', () => {
    const store = openStore();
    const fixture = createTask(store);
    createRun(store, fixture, 'run-1', { status: 'completed' });
    const results = store.tasks.listRecent();
    expect(results).toHaveLength(1);
    const task = results[0];
    expect(task?.latestRun).toBeDefined();
    expect(task?.latestRun?.id).toBe('run-1');
    expect(task?.latestRun?.status).toBe('completed');
    expect(task?.latestRun?.prompt).toBe('test prompt');
    expect(task?.latestRun?.sessionId).toBe(fixture.sessionId);
  });

  it('returns the most recent run (by created_at DESC) as latestRun', () => {
    const store = openStore();
    const fixture = createTask(store);
    const now = Date.now();
    store.runs.create({
      id: 'run-old',
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: 'old prompt',
      status: 'completed',
      createdAt: now - 1000,
    });
    store.runs.create({
      id: 'run-new',
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: 'new prompt',
      status: 'running',
      createdAt: now,
    });
    const results = store.tasks.listRecent();
    expect(results).toHaveLength(1);
    expect(results[0]?.latestRun?.id).toBe('run-new');
    expect(results[0]?.latestRun?.prompt).toBe('new prompt');
  });

  it('includes completedAt on latestRun when the run is completed', () => {
    const store = openStore();
    const fixture = createTask(store);
    const now = Date.now();
    store.runs.create({
      id: 'run-1',
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: 'prompt',
      status: 'completed',
      createdAt: now,
      completedAt: now + 500,
    });
    const results = store.tasks.listRecent();
    expect(results[0]?.latestRun?.completedAt).toBe(now + 500);
  });

  it('does not include completedAt on latestRun when the run has no completion', () => {
    const store = openStore();
    const fixture = createTask(store);
    createRun(store, fixture, 'run-1', { status: 'running' });
    const results = store.tasks.listRecent();
    expect(results[0]?.latestRun?.completedAt).toBeUndefined();
  });

  it.each(['running', 'completed', 'failed', 'cancelled'] as const)(
    'maps run status %s correctly',
    (status) => {
      const store = openStore();
      const fixture = createTask(store);
      createRun(store, fixture, `run-${status}`, { status });
      const results = store.tasks.listRecent();
      expect(results[0]?.latestRun?.status).toBe(status);
    },
  );
});

describe('TaskRepository.listRecent: ordering and pagination', () => {
  it('orders tasks by updated_at DESC', () => {
    const store = openStore();
    const workspace = store.workspaces.create('/tmp/test-ws', 'Test Workspace');
    const { task: task1 } = store.tasks.create(workspace.id, 'First', 'Goal 1');
    const { task: task2 } = store.tasks.create(workspace.id, 'Second', 'Goal 2');
    const { task: task3 } = store.tasks.create(workspace.id, 'Third', 'Goal 3');
    // Touch task1 to make it the most recently updated
    store.tasks.touch(task1.id, Date.now() + 2000);
    void task2;
    void task3;
    const results = store.tasks.listRecent();
    expect(results).toHaveLength(3);
    expect(results[0]?.id).toBe(task1.id);
  });

  it('limits results to 100 tasks', () => {
    const store = openStore();
    const workspace = store.workspaces.create('/tmp/test-ws', 'Test Workspace');
    for (let i = 0; i < 105; i++) {
      store.tasks.create(workspace.id, `Task ${i}`, `Goal ${i}`);
    }
    const results = store.tasks.listRecent();
    expect(results).toHaveLength(100);
  });

  it('returns an empty array when no tasks exist', () => {
    const store = openStore();
    expect(store.tasks.listRecent()).toEqual([]);
  });
});

describe('TaskRepository.listRecent: workspace filtering', () => {
  it('filters by workspaceId when provided', () => {
    const store = openStore();
    const ws1 = store.workspaces.create('/tmp/ws-1', 'Workspace 1');
    const ws2 = store.workspaces.create('/tmp/ws-2', 'Workspace 2');
    store.tasks.create(ws1.id, 'Task A', 'Goal A');
    store.tasks.create(ws2.id, 'Task B', 'Goal B');
    store.tasks.create(ws1.id, 'Task C', 'Goal C');
    const ws1Results = store.tasks.listRecent(ws1.id);
    expect(ws1Results).toHaveLength(2);
    for (const task of ws1Results) {
      expect(task.workspaceId).toBe(ws1.id);
    }
    const ws2Results = store.tasks.listRecent(ws2.id);
    expect(ws2Results).toHaveLength(1);
    expect(ws2Results[0]?.title).toBe('Task B');
  });

  it('returns empty array for a workspace with no tasks', () => {
    const store = openStore();
    const ws = store.workspaces.create('/tmp/empty-ws', 'Empty Workspace');
    expect(store.tasks.listRecent(ws.id)).toEqual([]);
  });

  it('returns empty array for a nonexistent workspace', () => {
    const store = openStore();
    expect(store.tasks.listRecent('nonexistent-ws')).toEqual([]);
  });
});

describe('TaskRepository.listRecent: multi-workspace isolation', () => {
  it('does not mix runs from different tasks when listing globally', () => {
    const store = openStore();
    const ws1 = store.workspaces.create('/tmp/ws-1', 'Workspace 1');
    const ws2 = store.workspaces.create('/tmp/ws-2', 'Workspace 2');
    const fixture1 = (() => {
      const { task, sessionId } = store.tasks.create(ws1.id, 'Task 1', 'Goal 1');
      return { workspaceId: ws1.id, taskId: task.id, sessionId };
    })();
    const fixture2 = (() => {
      const { task, sessionId } = store.tasks.create(ws2.id, 'Task 2', 'Goal 2');
      return { workspaceId: ws2.id, taskId: task.id, sessionId };
    })();
    createRun(store, fixture1, 'run-1a');
    createRun(store, fixture2, 'run-2a');
    const results = store.tasks.listRecent();
    expect(results).toHaveLength(2);
    const task1Result = results.find((t) => t.id === fixture1.taskId);
    const task2Result = results.find((t) => t.id === fixture2.taskId);
    expect(task1Result?.latestRun?.id).toBe('run-1a');
    expect(task2Result?.latestRun?.id).toBe('run-2a');
  });
});

describe('TaskRepository.getRecentSummary', () => {
  it('returns the full recent summary for a valid task id', () => {
    const store = openStore();
    const fixture = createTask(store, 'Recent Task', 'Recent Goal');
    createRun(store, fixture, 'run-1', { status: 'completed' });
    const result = store.tasks.getRecentSummary(fixture.taskId);
    expect(result).toBeDefined();
    expect(result?.id).toBe(fixture.taskId);
    expect(result?.title).toBe('Recent Task');
    expect(result?.goal).toBe('Recent Goal');
    expect(result?.sessionId).toBe(fixture.sessionId);
    expect(result?.latestRun?.id).toBe('run-1');
    expect(result?.latestRun?.status).toBe('completed');
  });

  it('returns a summary without latestRun when no runs exist', () => {
    const store = openStore();
    const fixture = createTask(store);
    const result = store.tasks.getRecentSummary(fixture.taskId);
    expect(result).toBeDefined();
    expect(result?.latestRun).toBeUndefined();
  });

  it('returns undefined for a nonexistent task', () => {
    const store = openStore();
    expect(store.tasks.getRecentSummary('nonexistent-task')).toBeUndefined();
  });

  it('retrieves a task that is beyond the recent list limit', () => {
    const store = openStore();
    const workspace = store.workspaces.create('/tmp/test-ws', 'Test Workspace');
    // Create 105 tasks so the first ones fall off the recent list
    const firstTaskId = store.tasks.create(workspace.id, 'Oldest', 'Goal').task.id;
    for (let i = 1; i < 105; i++) {
      store.tasks.create(workspace.id, `Task ${i}`, `Goal ${i}`);
    }
    // listRecent would not include the oldest task
    const recentList = store.tasks.listRecent();
    const foundInList = recentList.find((t) => t.id === firstTaskId);
    expect(foundInList).toBeUndefined();
    // But getRecentSummary still retrieves it
    const result = store.tasks.getRecentSummary(firstTaskId);
    expect(result).toBeDefined();
    expect(result?.id).toBe(firstTaskId);
    expect(result?.title).toBe('Oldest');
  });
});

describe('TaskRepository.touch', () => {
  it('updates the updated_at timestamp', () => {
    const store = openStore();
    const fixture = createTask(store);
    const original = store.tasks.getSummary(fixture.taskId);
    const newTime = (original?.updatedAt ?? 0) + 5000;
    store.tasks.touch(fixture.taskId, newTime);
    const updated = store.tasks.getSummary(fixture.taskId);
    expect(updated?.updatedAt).toBe(newTime);
  });

  it('moves the task to the top of the recent list', () => {
    const store = openStore();
    const workspace = store.workspaces.create('/tmp/test-ws', 'Test Workspace');
    const { task: task1 } = store.tasks.create(workspace.id, 'First', 'Goal 1');
    const { task: task2 } = store.tasks.create(workspace.id, 'Second', 'Goal 2');
    // task2 was created after task1, so it should be first by default
    let results = store.tasks.listRecent();
    expect(results[0]?.id).toBe(task2.id);
    // Touch task1 to a later time
    store.tasks.touch(task1.id, Date.now() + 10_000);
    results = store.tasks.listRecent();
    expect(results[0]?.id).toBe(task1.id);
  });

  it('does not fail when touching a nonexistent task', () => {
    const store = openStore();
    expect(() => store.tasks.touch('nonexistent-task', Date.now())).not.toThrow();
  });
});

describe('TaskRepository.getWorkspaceId', () => {
  it('returns the workspace id for a valid task', () => {
    const store = openStore();
    const fixture = createTask(store);
    expect(store.tasks.getWorkspaceId(fixture.taskId)).toBe(fixture.workspaceId);
  });

  it('returns undefined for a nonexistent task', () => {
    const store = openStore();
    expect(store.tasks.getWorkspaceId('nonexistent-task')).toBeUndefined();
  });
});

describe('TaskRepository.getRunContext', () => {
  it('returns the workspace path for a valid task and session', () => {
    const store = openStore();
    const fixture = createTask(store);
    const context = store.tasks.getRunContext(fixture.taskId, fixture.sessionId);
    expect(context).toBeDefined();
    expect(context?.workspacePath).toBe('/tmp/test-ws');
  });

  it('returns undefined when the task does not exist', () => {
    const store = openStore();
    expect(store.tasks.getRunContext('nonexistent-task', 'some-session')).toBeUndefined();
  });

  it('returns undefined when the session does not exist', () => {
    const store = openStore();
    const fixture = createTask(store);
    expect(store.tasks.getRunContext(fixture.taskId, 'nonexistent-session')).toBeUndefined();
  });

  it('returns undefined when the session belongs to a different task', () => {
    const store = openStore();
    const fixture1 = createTask(store);
    const ws2 = store.workspaces.create('/tmp/ws-2', 'Workspace 2');
    const { sessionId: session2 } = store.tasks.create(ws2.id, 'Task 2', 'Goal 2');
    expect(store.tasks.getRunContext(fixture1.taskId, session2)).toBeUndefined();
  });
});

describe('toRecentTaskSummary', () => {
  it('produces a summary without latestRun when run fields are null', () => {
    const store = openStore();
    const fixture = createTask(store);
    // Use getRecentSummary which goes through toRecentTaskSummary
    const result: RecentTaskSummary | undefined = store.tasks.getRecentSummary(fixture.taskId);
    expect(result).toBeDefined();
    expect(result?.sessionId).toBe(fixture.sessionId);
    expect(result?.latestRun).toBeUndefined();
  });

  it('produces a summary with latestRun when run fields are populated', () => {
    const store = openStore();
    const fixture = createTask(store);
    createRun(store, fixture, 'run-1', { status: 'failed', prompt: 'failed prompt' });
    const result = store.tasks.getRecentSummary(fixture.taskId);
    expect(result?.latestRun).toBeDefined();
    expect(result?.latestRun?.id).toBe('run-1');
    expect(result?.latestRun?.taskId).toBe(fixture.taskId);
    expect(result?.latestRun?.sessionId).toBe(fixture.sessionId);
    expect(result?.latestRun?.prompt).toBe('failed prompt');
    expect(result?.latestRun?.status).toBe('failed');
  });
});
