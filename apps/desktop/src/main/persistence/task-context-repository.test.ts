import type { CreatedTask } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};
const taskOf = (store: AppStore): CreatedTask => {
  const workspace = store.workspaces.getOrCreate('/tmp/task-context', '上下文测试');
  return store.tasks.create(workspace.id, '上下文任务', '验证上下文修订');
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('TaskContextRepository', () => {
  it('persists ordered bindings and uses compare-and-swap revisions', () => {
    const store = openStore();
    const task = taskOf(store);
    const first = store.taskContexts.save(task.task.id, {
      executor: { kind: 'general' },
      skillBindings: [
        { skillId: 'skill-a', revisionId: 'revision-a', source: 'task-selection' },
        { skillId: 'skill-b', revisionId: 'revision-b', source: 'task-selection' },
      ],
      builtinToolPolicy: { mode: 'allow-list', toolNames: ['calculator'] },
    });
    expect(first.revision).toBe(1);
    expect(
      store.taskContexts.get(first.id, task.task.id)?.skillBindings.map((item) => item.skillId),
    ).toEqual(['skill-a', 'skill-b']);
    expect(() =>
      store.taskContexts.save(
        task.task.id,
        { executor: { kind: 'general' }, skillBindings: [] },
        0,
      ),
    ).toThrow('Task context revision conflict');
  });

  it('does not resolve a context revision from another task', () => {
    const store = openStore();
    const first = taskOf(store);
    const second = store.tasks.create(
      store.tasks.getWorkspaceId(first.task.id) ?? 'missing',
      '另一个任务',
      '隔离',
    );
    const context = store.taskContexts.save(first.task.id, {
      executor: { kind: 'general' },
      skillBindings: [],
    });
    expect(store.taskContexts.get(context.id, second.task.id)).toBeUndefined();
  });

  it('rejects duplicate Skill bindings before writing a revision', () => {
    const store = openStore();
    const task = taskOf(store);
    expect(() =>
      store.taskContexts.save(task.task.id, {
        executor: { kind: 'general' },
        skillBindings: [
          { skillId: 'skill-a', revisionId: 'revision-a', source: 'task-selection' },
          { skillId: 'skill-a', revisionId: 'revision-b', source: 'expert-preset' },
        ],
      }),
    ).toThrow('Task context skill bindings must not repeat a skill');
    expect(store.taskContexts.getLatest(task.task.id)).toBeUndefined();
  });

  it('rejects duplicate MCP bindings before writing a revision', () => {
    const store = openStore();
    const task = taskOf(store);
    expect(() =>
      store.taskContexts.save(task.task.id, {
        executor: { kind: 'general' },
        skillBindings: [],
        mcpToolBindings: [
          { connectionId: 'finance', toolId: 'finance/monthly_summary' },
          { connectionId: 'finance', toolId: 'finance/monthly_summary' },
        ],
      }),
    ).toThrow('Task context MCP bindings must not repeat a tool');
    expect(store.taskContexts.getLatest(task.task.id)).toBeUndefined();
  });

  it('persists exact material references and their purpose with the draft', () => {
    const store = openStore();
    const task = taskOf(store);
    const saved = store.taskContexts.save(task.task.id, {
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [
        {
          reference: {
            kind: 'knowledge-revision',
            knowledgeDocumentId: 'document-1',
            knowledgeRevisionId: 'revision-1',
            contentHash: 'hash-1',
            sourcePath: '/tmp/rules.md',
          },
          purpose: 'rule',
          note: '财务指标口径',
          addedFrom: 'global-search',
        },
      ],
    });
    expect(saved.materials).toEqual([
      expect.objectContaining({
        purpose: 'rule',
        note: '财务指标口径',
        reference: expect.objectContaining({ knowledgeRevisionId: 'revision-1' }),
      }),
    ]);
    expect(store.taskContexts.get(saved.id, task.task.id)?.materials).toEqual(saved.materials);
  });
});
