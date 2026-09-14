// @vitest-environment jsdom

import type {
  ExpertDetail,
  ExpertSummary,
  RecentTaskSummary,
  RunSummary,
  SkillDetail,
  TaskContextRevision,
} from '@betterwork/agent-protocol';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

const skill: SkillDetail = {
  id: 'skill-ppt',
  name: '演示生成专家',
  description: '生成演示文稿',
  sourceKind: 'user',
  enabled: true,
  currentRevisionId: 'revision-ppt',
  trustStatus: 'trusted',
  environmentStatus: 'ready',
  blockedReasons: [],
  revision: {
    id: 'revision-ppt',
    skillId: 'skill-ppt',
    contentHash: 'hash-ppt',
    resourceKey: 'user/skill-ppt/revisions/hash-ppt',
    frontmatter: {},
    createdAt: 1,
  },
};
const goal = '使用「中电金信」模板，生成两页演示文稿——封面 + 一页内容页。';
const previousRun: RunSummary = {
  id: 'previous-run',
  taskId: 'previous-task',
  sessionId: 'previous-session',
  prompt: '旧任务的要求',
  status: 'completed',
  createdAt: 1,
};
const previousTask: RecentTaskSummary = {
  id: 'previous-task',
  workspaceId: 'workspace-1',
  sessionId: 'previous-session',
  title: '旧任务',
  goal: '旧任务的要求',
  createdAt: 1,
  updatedAt: 1,
};

const expertSummary: ExpertSummary = {
  id: 'expert-finance',
  sourceKind: 'user',
  lifecycle: 'active',
  name: '经营分析专家',
  summary: '按月度规则分析经营数字。',
  currentRevision: 1,
  blockedReasons: [],
  createdAt: 1,
  updatedAt: 1,
};
const expertDetail: ExpertDetail = {
  ...expertSummary,
  revision: {
    id: 'expert-revision-1',
    expertId: expertSummary.id,
    revision: 1,
    name: expertSummary.name,
    summary: expertSummary.summary,
    identity: '负责经营分析。',
    principles: [],
    inputRequirements: [],
    deliveryRequirements: [],
    skillPreset: [],
    builtinToolPolicy: { mode: 'application-defaults' },
    modelReference: { mode: 'application-default' },
    createdAt: 1,
  },
};

function installApi(options?: { expert?: boolean; context?: TaskContextRevision }) {
  const api = {
    chrome: { updateTheme: vi.fn(async () => undefined) },
    workspace: {
      getDefault: vi.fn(async () => ({ id: 'workspace-1', rootPath: '/workspace' })),
    },
    models: { list: vi.fn(async () => []) },
    knowledge: { list: vi.fn(async () => []) },
    artifacts: { list: vi.fn(async () => []) },
    evidence: { list: vi.fn(async () => []) },
    notifications: {
      list: vi.fn(async () => []),
      onChange: vi.fn(() => () => undefined),
      onActivate: vi.fn(() => () => undefined),
    },
    tasks: {
      list: vi.fn(async (): Promise<RecentTaskSummary[]> => [previousTask]),
      create: vi.fn(async () => ({
        task: { id: 'new-task', title: goal },
        sessionId: 'new-session',
      })),
    },
    taskContexts: {
      get: vi.fn(async (): Promise<TaskContextRevision | null> => options?.context ?? null),
      save: vi.fn(
        async (input: {
          taskId: string;
          expectedRevision?: number;
          executor: TaskContextRevision['executor'];
          skillBindings: TaskContextRevision['skillBindings'];
        }) => ({
          context: {
            id: 'context-1',
            taskId: input.taskId,
            revision: 1,
            executor: input.executor,
            skillBindings: input.skillBindings,
            createdAt: 1,
            updatedAt: 1,
          },
        }),
      ),
    },
    materials: {
      listCandidates: vi.fn(async () => []),
      prepareInputSnapshot: vi.fn(async () => null),
    },
    memories: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({
        memory: {
          id: 'memory-1',
          revisionId: 'memory-1-r1',
          revision: 1,
          scope: { kind: 'user' as const },
          kind: 'semantic' as const,
          content: 'test',
          sourceType: 'user-explicit' as const,
          confidence: 1,
          status: 'confirmed' as const,
          contentHash: 'hash',
          createdAt: 1,
          updatedAt: 1,
        },
      })),
      update: vi.fn(async () => ({ memory: undefined })),
      setStatus: vi.fn(async () => ({ memory: undefined })),
    },
    experts: {
      list: vi.fn(async () => (options?.expert ? [expertSummary] : [])),
      get: vi.fn(async () => (options?.expert ? expertDetail : null)),
      create: vi.fn(async () => ({ expert: expertDetail })),
      saveRevision: vi.fn(async () => ({ expert: expertDetail })),
      copy: vi.fn(async () => ({ expert: expertDetail })),
      setLifecycle: vi.fn(async () => ({ expert: expertDetail })),
    },
    runs: {
      list: vi.fn(async (input?: { taskId?: string }): Promise<RunSummary[]> =>
        input?.taskId === previousTask.id ? [previousRun] : [],
      ),
      listEvents: vi.fn(async () => []),
      start: vi.fn(async () => ({ runId: 'new-run' })),
      onEvent: vi.fn(() => () => undefined),
    },
    skills: {
      list: vi.fn(async () => [skill]),
      get: vi.fn(async () => skill),
      testRun: vi.fn(async () => ({ runId: 'unexpected-run' })),
      refreshDependencyGrant: vi.fn(async () => ({ skill, grantActive: true })),
    },
    dependencies: {
      listOptions: vi.fn(async () => ({
        distributions: [],
        lockIds: [],
        snapshots: [],
        environments: [],
      })),
    },
  };
  Object.defineProperty(window, 'betterwork', { configurable: true, value: api });
  return api;
}

async function openTestRun(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '能力' }));
  fireEvent.click(await screen.findByRole('button', { name: /演示生成专家/ }));
  fireEvent.click(await screen.findByRole('button', { name: '试运行' }));
  // 现在以 chip 条形式显示已选技能，查找 aria-label 为“已选能力”的列表。
  const chipBar = await screen.findByRole('list', { name: '已选能力' });
  expect(chipBar.textContent).toContain('演示生成专家');
}

function composer(): HTMLElement {
  return screen.getByRole('textbox', { name: /任务输入/ });
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'betterwork');
});

describe('Skill test run in the task composer', () => {
  it('opens an empty focused draft and starts only after explicit submission with the Skill binding', async () => {
    const api = installApi();
    render(<App />);
    await openTestRun();

    expect(await screen.findByRole('textbox', { name: /任务输入/ })).toHaveProperty('value', '');
    expect(document.activeElement).toBe(composer());
    expect(screen.getByRole('button', { name: '开始工作' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(composer(), { key: 'Enter', metaKey: true });
    expect(api.tasks.create).not.toHaveBeenCalled();
    expect(api.runs.start).not.toHaveBeenCalled();
    expect(api.skills.testRun).not.toHaveBeenCalled();

    fireEvent.change(composer(), { target: { value: goal } });
    expect(api.runs.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await waitFor(() =>
      expect(api.runs.start).toHaveBeenCalledExactlyOnceWith({
        taskId: 'new-task',
        sessionId: 'new-session',
        prompt: goal,
        taskContextRevisionId: 'context-1',
        expectedTaskContextRevision: 1,
      }),
    );
    expect(api.tasks.create).toHaveBeenCalledExactlyOnceWith({
      workspaceId: 'workspace-1',
      title: goal,
      goal,
    });
    expect(await screen.findByText(goal)).toBeTruthy();
    expect(api.skills.testRun).not.toHaveBeenCalled();
    // 首次挂载完整 App 含 Markdown 与所有页面；全量并行测试的冷启动需更长预算。
  }, 15_000);

  it('clears previous messages and ignores late history responses when opening the draft', async () => {
    const api = installApi();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    await screen.findByText('旧任务的要求');
    let resolveEvents: ((events: []) => void) | undefined;
    api.runs.listEvents.mockImplementationOnce(
      () =>
        new Promise<[]>((resolve) => {
          resolveEvents = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: /旧任务/ }));
    await waitFor(() => expect(resolveEvents).toBeTypeOf('function'));
    await openTestRun();
    await act(async () => {
      resolveEvents?.([]);
    });
    expect(screen.queryByText('旧任务的要求')).toBeNull();
    expect(await screen.findByRole('textbox', { name: /任务输入/ })).toHaveProperty('value', '');
    expect(api.runs.start).not.toHaveBeenCalled();
  });

  it('retains the prompt and Skill on failure and prevents duplicate starts during submission', async () => {
    const api = installApi();
    api.runs.start.mockRejectedValueOnce(new Error('启动失败，请重试'));
    render(<App />);
    await openTestRun();
    fireEvent.change(composer(), { target: { value: goal } });
    fireEvent.keyDown(composer(), { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(composer(), { key: 'Enter', ctrlKey: true });
    await screen.findByRole('alert');
    expect(api.tasks.create).toHaveBeenCalledTimes(1);
    expect(api.runs.start).toHaveBeenCalledTimes(1);
    expect(composer()).toHaveProperty('value', goal);
    // chip 条应该保留。
    expect(screen.getByRole('list', { name: '已选能力' }).textContent).toContain('演示生成专家');

    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await waitFor(() => expect(api.runs.start).toHaveBeenCalledTimes(2));
    expect(api.tasks.create).toHaveBeenCalledTimes(1);
    expect(api.runs.start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: goal,
        taskContextRevisionId: 'context-1',
        expectedTaskContextRevision: 1,
      }),
    );
  });

  it.each(['新建任务', '旧任务'])('does not carry the draft Skill into %s', async (destination) => {
    const api = installApi();
    render(<App />);
    await openTestRun();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(destination) }));
    // chip 条应该被清空。
    expect(screen.queryByRole('list', { name: '已选能力' })).toBeNull();
    fireEvent.change(composer(), { target: { value: '普通要求' } });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await waitFor(() => expect(api.runs.start).toHaveBeenCalledTimes(1));
    expect(api.runs.start).toHaveBeenCalledWith({
      taskId: destination === '旧任务' ? 'previous-task' : 'new-task',
      sessionId: destination === '旧任务' ? 'previous-session' : 'new-session',
      prompt: '普通要求',
      taskContextRevisionId: 'context-1',
      expectedTaskContextRevision: 1,
    });
  });
});

describe('Expert summon in the task composer', () => {
  it('summons an Expert into a blank task and pins its revision on first send', async () => {
    const api = installApi({ expert: true });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '召唤' }));

    expect(await screen.findByRole('textbox', { name: /任务输入/ })).toHaveProperty('value', '');
    expect(screen.getByRole('list', { name: '当前专家' }).textContent).toContain('经营分析专家');
    fireEvent.change(composer(), { target: { value: '分析本月经营数字' } });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));

    await waitFor(() => expect(api.taskContexts.save).toHaveBeenCalledTimes(1));
    expect(api.taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        executor: {
          kind: 'expert',
          expertId: expertSummary.id,
          expertRevisionId: expertDetail.revision.id,
        },
      }),
    );
    await waitFor(() => expect(api.runs.start).toHaveBeenCalledTimes(1));
    expect(api.runs.start).toHaveBeenCalledWith(
      expect.objectContaining({
        taskContextRevisionId: 'context-1',
        expectedTaskContextRevision: 1,
      }),
    );
  });
});

describe('Task context restoration', () => {
  it('restores the saved Skill selection when reopening a task', async () => {
    const api = installApi({
      context: {
        id: 'context-previous',
        taskId: previousTask.id,
        revision: 1,
        executor: { kind: 'general' },
        skillBindings: [
          { skillId: skill.id, revisionId: skill.currentRevisionId, source: 'task-selection' },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    expect((await screen.findByRole('list', { name: '已选能力' })).textContent).toContain(
      skill.name,
    );
    expect(api.taskContexts.get).toHaveBeenCalledWith({ taskId: previousTask.id });
  });
});

describe('Expert configuration', () => {
  it('opens a separate editor and saves a new immutable revision', async () => {
    const api = installApi({ expert: true });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '查看配置' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑配置' }));
    const identity = await screen.findByRole('textbox', { name: '人格与职责' });
    fireEvent.change(identity, { target: { value: '负责经营分析并检查交付。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修订' }));
    await waitFor(() => expect(api.experts.saveRevision).toHaveBeenCalledTimes(1));
    expect(api.experts.saveRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        expertId: expertSummary.id,
        expectedRevision: 1,
        revision: expect.objectContaining({ identity: '负责经营分析并检查交付。' }),
      }),
    );
  });
});
