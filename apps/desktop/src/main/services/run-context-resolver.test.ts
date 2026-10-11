import type { ExpertRevisionDraft } from '@betterwork/agent-protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { resolveRunContext } from './run-context-resolver';

let store: AppStore;
let taskId: string;

const expertRevision = (): ExpertRevisionDraft => ({
  name: '上下文解析测试专家',
  summary: '验证 Expert 上下文固定',
  author: '',
  tags: [],
  identity: '先核对输入再形成结论。',
  principles: ['逐项检查'],
  inputRequirements: ['使用固定材料'],
  deliveryRequirements: ['说明依据'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
});

beforeEach(() => {
  store = AppStore.open(':memory:');
  const workspace = store.workspaces.getOrCreate('/tmp/run-context-resolver-test', '上下文测试');
  taskId = store.tasks.create(workspace.id, '上下文解析', '验证运行上下文解析').task.id;
});

afterEach(() => {
  store.close();
});

describe('resolveRunContext', () => {
  it('keeps the legacy path unscoped and carries direct Skill bindings', () => {
    const skillBindings = [{ skillId: 'missing-skill' }];

    expect(resolveRunContext(store, { taskId, skillBindings })).toEqual({
      skillBindings,
      materials: [],
      materialScope: false,
      excludedMemoryIds: [],
      mcpToolBindings: [],
    });
  });

  it('resolves a general TaskContext with its pinned revision and scope', () => {
    const context = store.taskContexts.save(taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
      modelReference: { mode: 'application-default' },
      builtinToolPolicy: { mode: 'application-defaults' },
      materials: [],
    });

    expect(
      resolveRunContext(store, {
        taskId,
        taskContextRevisionId: context.id,
        expectedTaskContextRevision: context.revision,
      }),
    ).toEqual({
      modelReference: { mode: 'application-default' },
      builtinToolPolicy: { mode: 'application-defaults' },
      materials: [],
      materialScope: true,
      taskContextRevisionId: context.id,
      excludedMemoryIds: [],
      mcpToolBindings: [],
    });
  });

  it('composes the fixed Expert revision into the resolved context', () => {
    const expert = store.experts.create({ sourceKind: 'user', revision: expertRevision() });
    const context = store.taskContexts.save(taskId, {
      executor: {
        kind: 'expert',
        expertId: expert.id,
        expertRevisionId: expert.revision.id,
      },
      skillBindings: [],
    });

    expect(
      resolveRunContext(store, {
        taskId,
        taskContextRevisionId: context.id,
        expectedTaskContextRevision: context.revision,
      }),
    ).toMatchObject({
      expertInstruction:
        '以下是当前 Expert 的工作方式，请在本次任务中遵循：\n\n先核对输入再形成结论。\n\n工作原则：\n- 逐项检查\n\n输入要求：\n- 使用固定材料\n\n交付与检查要求：\n- 说明依据',
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
      modelReference: { mode: 'application-default' },
      builtinToolPolicy: { mode: 'application-defaults' },
      materialScope: true,
    });
  });

  it('rejects a TaskContext when its expected revision does not match', () => {
    const original = store.taskContexts.save(taskId, {
      executor: { kind: 'general' },
      skillBindings: [],
    });

    expect(() =>
      resolveRunContext(store, {
        taskId,
        taskContextRevisionId: original.id,
        expectedTaskContextRevision: original.revision + 1,
      }),
    ).toThrow('TaskContextRevision 已更新');
  });
});
