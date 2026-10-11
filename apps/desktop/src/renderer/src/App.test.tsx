// @vitest-environment jsdom

import type {
  AgentRuntimeEvent,
  ArtifactDetail,
  ArtifactSummary,
  ArtifactVersionExecutorSummary,
  DiscussionCheckpoint,
  InputSnapshot,
  MaterialCandidate,
  NotificationSummary,
  RunSummary,
  TaskContextRevision,
} from '@betterwork/agent-protocol';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import {
  activateSystemNotification,
  artifactVersionReference,
  briefFixture,
  emitNotificationChange,
  emitScheduleChange,
  expertDetail,
  expertSummary,
  goal,
  installApi,
  languageModel,
  memoryViewItem,
  okResult,
  previousRun,
  previousTask,
  scheduleContinuationFixture,
  skill,
  workspaceFixture,
} from './app-test-fixtures';

async function openTestRun(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '技能' }));
  fireEvent.click(await screen.findByRole('button', { name: /演示生成专家/ }));
  fireEvent.click(await screen.findByRole('button', { name: '试运行' }));
  await screen.findByRole('button', { name: '技能 1 项' });
}

async function expectSelectedSkill(selectedName = skill.name): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: '技能 1 项' }));
  const selectedSkill = await screen.findByRole('menuitem', {
    name: new RegExp(selectedName),
  });
  expect(selectedSkill.textContent).toMatch(/已添加，点击移除|已绑定技能不可用，点击移除/u);
  fireEvent.keyDown(selectedSkill, { key: 'Escape' });
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
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'betterwork');
});

describe('Work message Artifact save in App', () => {
  const followup: RunSummary = {
    ...previousRun,
    id: 'followup-run',
    prompt: '第二轮要求',
    createdAt: 2,
  };
  const completion = (run: RunSummary): AgentRuntimeEvent[] => [
    {
      id: `done-${run.id}`,
      runId: run.id,
      sequence: 1,
      createdAt: 3,
      type: 'run.completed',
      finalContent: `最终正文 ${run.id}`,
    },
  ];
  const saved: ArtifactSummary = {
    id: 'saved-markdown',
    workspaceId: workspaceFixture.id,
    taskId: previousTask.id,
    title: previousTask.title,
    type: 'markdown',
    origin: 'assistant-run',
    sourceRunId: previousRun.id,
    currentVersionId: 'saved-version',
    versionNumber: 1,
    createdAt: 3,
    updatedAt: 3,
  };

  it('历史回答保存失败只有一处出口，重试仍保存该 Run，成功只有一枚局部确认', async () => {
    const api = installApi();
    api.runs.list.mockResolvedValue([followup, previousRun]);
    api.runs.listEvents.mockImplementation(async ({ runId }) =>
      completion(runId === previousRun.id ? previousRun : followup),
    );
    api.artifacts.saveMarkdown
      .mockRejectedValueOnce(new Error('首轮成果写入失败'))
      .mockResolvedValueOnce(saved);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    await screen.findByText(`最终正文 ${followup.id}`);
    const buttons = await screen.findAllByRole('button', { name: '保存为成果' });
    fireEvent.click(buttons[0]!);
    await screen.findByText('首轮成果写入失败');
    expect(screen.getAllByText('首轮成果写入失败')).toHaveLength(1);
    expect(screen.queryByText('已保存为 Markdown 成果（v1）。')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '保存为成果' })[0]!);
    await screen.findByText('已保存为 Markdown 成果（v1）。');
    expect(screen.getAllByText('已保存为 Markdown 成果（v1）。')).toHaveLength(1);
    expect(screen.queryByText('首轮成果写入失败')).toBeNull();
    expect(api.artifacts.saveMarkdown.mock.calls).toEqual([
      [
        {
          taskId: previousTask.id,
          origin: 'assistant-run',
          runId: previousRun.id,
          title: previousTask.title,
          content: `最终正文 ${previousRun.id}`,
        },
      ],
      [
        {
          taskId: previousTask.id,
          origin: 'assistant-run',
          runId: previousRun.id,
          title: previousTask.title,
          content: `最终正文 ${previousRun.id}`,
        },
      ],
    ]);
    fireEvent.click(screen.getByRole('button', { name: '记住这段经验' }));
    await screen.findByText('这条回答还没有可定位的最终事件，请等运行完成后再记住经验。');
    expect(
      screen.getAllByText('这条回答还没有可定位的最终事件，请等运行完成后再记住经验。'),
    ).toHaveLength(1);
    expect(document.querySelector('.memory-capture')).toBeNull();
  });

  it('保存原 Task 期间新建草稿，晚到成功不展开上下文或污染新草稿', async () => {
    const api = installApi();
    api.runs.listEvents.mockResolvedValue(completion(previousRun));
    let finish!: (artifact: ArtifactSummary) => void;
    api.artifacts.saveMarkdown.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    fireEvent.click(await screen.findByRole('button', { name: '保存为成果' }));
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }));
    fireEvent.change(composer(), { target: { value: '尚未发送的新任务要求' } });
    await act(async () => finish(saved));
    expect((composer() as HTMLTextAreaElement).value).toBe('尚未发送的新任务要求');
    expect(screen.getByRole('button', { name: '查看上下文' })).toBeTruthy();
    expect(screen.queryByText('已保存为 Markdown 成果（v1）。')).toBeNull();
  });
});

describe('Skill test run in the task composer', () => {
  it('任务历史快照迟到时保留已经广播的终态与最终回答', async () => {
    const api = installApi({ skills: [skill] });
    api.runs.list.mockResolvedValue([{ ...previousRun, status: 'running' }]);
    let emitEvent: ((event: AgentRuntimeEvent) => void) | undefined;
    api.runs.onEvent.mockImplementation((listener) => {
      emitEvent = listener;
      return () => undefined;
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    await screen.findByText(previousRun.prompt);
    await waitFor(() => expect(api.runs.listEvents).toHaveBeenCalledTimes(2));
    let resolveSnapshot: ((events: AgentRuntimeEvent[]) => void) | undefined;
    api.runs.listEvents.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSnapshot = resolve;
        }),
    );
    const completed: AgentRuntimeEvent = {
      id: 'live-completed',
      runId: previousRun.id,
      sequence: 2,
      createdAt: 3,
      type: 'run.completed',
      finalContent: '加载期间收到的最终回答',
    };
    act(() => emitEvent?.(completed));
    await waitFor(() => expect(resolveSnapshot).toBeTypeOf('function'));
    expect(screen.getByText(completed.finalContent)).toBeTruthy();
    await act(async () => resolveSnapshot?.([]));
    expect(screen.getByText(completed.finalContent)).toBeTruthy();
    expect(screen.getByRole('button', { name: '记住这段经验' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull();
  });

  it('离开再返回同一 Task 时丢弃上一轮历史读取，保留新增 Run', async () => {
    const api = installApi({ skills: [skill] });
    let resolveOldSnapshot: ((events: AgentRuntimeEvent[]) => void) | undefined;
    api.runs.listEvents.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOldSnapshot = resolve;
        }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    await waitFor(() => expect(resolveOldSnapshot).toBeTypeOf('function'));
    await openTestRun();
    const followup = { ...previousRun, id: 'followup-run', prompt: '后来的续作要求', createdAt: 2 };
    api.runs.list.mockResolvedValue([followup, previousRun]);
    fireEvent.click(screen.getByRole('button', { name: /旧任务/ }));
    await screen.findByText(followup.prompt);
    await act(async () => resolveOldSnapshot?.([]));
    expect(screen.getByText(followup.prompt)).toBeTruthy();
  });

  it('同一 Task 开始续作后，未完成的历史读取仍能补齐旧 Run', async () => {
    const api = installApi({ skills: [skill] });
    const previousCompleted: AgentRuntimeEvent = {
      id: 'previous-completed',
      runId: previousRun.id,
      sequence: 1,
      createdAt: 2,
      type: 'run.completed',
      finalContent: '已完成的旧回答',
    };
    let resolveHistory: ((events: AgentRuntimeEvent[]) => void) | undefined;
    api.runs.listEvents
      .mockImplementation(async ({ runId }) =>
        runId === previousRun.id ? [previousCompleted] : [],
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveHistory = resolve;
          }),
      );
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    await waitFor(() => expect(api.runs.listEvents).toHaveBeenCalledTimes(2));
    expect(resolveHistory).toBeTypeOf('function');
    fireEvent.change(composer(), { target: { value: '继续完成下一期分析' } });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await screen.findByText('继续完成下一期分析');
    await act(async () => resolveHistory?.([previousCompleted]));
    expect(screen.getByText(previousRun.prompt)).toBeTruthy();
    expect(screen.getByText('已完成的旧回答')).toBeTruthy();
    expect(screen.getByText('继续完成下一期分析')).toBeTruthy();
    expect(api.runs.start).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: previousTask.id }),
    );
  });

  it('离开再返回同一 Task 时不让旧讨论节点替换新节点', async () => {
    const api = installApi({ skills: [skill] });
    let resolveOldCheckpoints: ((items: DiscussionCheckpoint[]) => void) | undefined;
    api.discussionCheckpoints.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOldCheckpoints = resolve;
        }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    await waitFor(() => expect(resolveOldCheckpoints).toBeTypeOf('function'));
    await openTestRun();
    const checkpoint: DiscussionCheckpoint = {
      id: 'new-checkpoint',
      taskId: previousTask.id,
      stage: 'report-outline',
      status: 'open',
      title: '新的讨论节点',
      summary: '重新整理大纲',
      artifactVersionIds: [],
      createdAt: 2,
      updatedAt: 2,
    };
    api.discussionCheckpoints.list.mockResolvedValue([checkpoint]);
    fireEvent.click(screen.getByRole('button', { name: /旧任务/ }));
    await screen.findByText(/新的讨论节点/);
    await act(async () => resolveOldCheckpoints?.([]));
    expect(screen.getByText(/新的讨论节点/)).toBeTruthy();
  });

  it.each([false, true])(
    '启动回执之前已结束的 Run 保留事件，补读失败=%s',
    async (recoveryFails) => {
      const api = installApi({ skills: [skill] });
      const backgroundErrors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let emitEvent: ((event: AgentRuntimeEvent) => void) | undefined;
      api.runs.onEvent.mockImplementation((listener) => {
        emitEvent = listener;
        return () => undefined;
      });
      let acknowledge: ((receipt: { runId: string }) => void) | undefined;
      api.runs.start.mockImplementation(
        () =>
          new Promise((resolve) => {
            acknowledge = resolve;
          }),
      );
      render(<App />);
      await openTestRun();
      fireEvent.change(composer(), { target: { value: goal } });
      fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
      await waitFor(() => expect(acknowledge).toBeTypeOf('function'));
      const earlyEvents: AgentRuntimeEvent[] = [
        {
          id: 'early-start',
          runId: 'new-run',
          sequence: 0,
          createdAt: 2,
          type: 'run.started',
          taskId: 'new-task',
          sessionId: 'new-session',
        },
        {
          id: 'early-completed',
          runId: 'new-run',
          sequence: 1,
          createdAt: 3,
          type: 'run.completed',
          finalContent: '回执之前已完成的报告',
        },
      ];
      if (recoveryFails) api.runs.listEvents.mockRejectedValue(new Error('补读暂不可用'));
      else api.runs.listEvents.mockResolvedValue(earlyEvents);
      act(() => earlyEvents.forEach((event) => emitEvent?.(event)));
      await act(async () => acknowledge?.({ runId: 'new-run' }));
      expect(await screen.findByText('回执之前已完成的报告')).toBeTruthy();
      expect(screen.queryByRole('button', { name: '停止' })).toBeNull();
      expect(screen.getByRole('button', { name: '记住这段经验' })).toBeTruthy();
      if (recoveryFails)
        expect(backgroundErrors).toHaveBeenCalledWith('恢复新执行的事件 failed', expect.any(Error));
      else expect(backgroundErrors).not.toHaveBeenCalled();
    },
  );

  it('启动回执迟到时保留用户新开的任务草稿', async () => {
    const api = installApi({ skills: [skill] });
    let acknowledge: ((receipt: { runId: string }) => void) | undefined;
    api.runs.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          acknowledge = resolve;
        }),
    );
    render(<App />);
    await openTestRun();
    fireEvent.change(composer(), { target: { value: goal } });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await waitFor(() => expect(acknowledge).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }));
    fireEvent.change(composer(), { target: { value: '新开任务的草稿' } });
    await act(async () => acknowledge?.({ runId: 'new-run' }));
    expect(composer()).toHaveProperty('value', '新开任务的草稿');
    expect(screen.queryByText(goal)).toBeNull();
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull();
    expect(api.runs.start).toHaveBeenCalledTimes(1);
  });

  it('opens an empty focused draft and starts only after explicit submission with the Skill binding', async () => {
    const api = installApi({ skills: [skill] });
    render(<App />);
    await openTestRun();

    expect(await screen.findByRole('textbox', { name: /任务输入/ })).toHaveProperty('value', '');
    expect(document.activeElement).toBe(composer());
    expect(screen.getByRole('button', { name: '技能 1 项' })).toBeTruthy();
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
    expect(api.taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        skillBindings: [
          {
            skillId: skill.id,
            revisionId: skill.currentRevisionId,
            source: 'task-selection',
          },
        ],
      }),
    );
    expect(await screen.findByText(goal)).toBeTruthy();
    expect(api.skills.testRun).not.toHaveBeenCalled();
    // 首次挂载完整 App 含 Markdown 与所有页面；全量并行测试的冷启动需更长预算。
  }, 15_000);

  it('clears previous messages and ignores late history responses when opening the draft', async () => {
    const api = installApi({ skills: [skill] });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    await screen.findByRole('textbox', { name: /任务输入/ });
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
    const api = installApi({ skills: [skill] });
    api.runs.start.mockRejectedValueOnce(new Error('启动失败，请重试'));
    render(<App />);
    await openTestRun();
    fireEvent.change(composer(), { target: { value: goal } });
    fireEvent.keyDown(composer(), { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(composer(), { key: 'Enter', ctrlKey: true });
    // 启动失败没有可承载它的对象，按 §11.5.1 走全局短时提醒（自消、不落库）。
    await screen.findByText('启动失败，请重试');
    expect(api.tasks.create).toHaveBeenCalledTimes(1);
    expect(api.runs.start).toHaveBeenCalledTimes(1);
    expect(composer()).toHaveProperty('value', goal);
    // 技能选择摘要仍保留；具体选择状态可从技能菜单查看。
    await expectSelectedSkill();

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
    const api = installApi({ skills: [skill] });
    render(<App />);
    await openTestRun();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(destination) }));
    // 切换任务后技能摘要应消失。
    expect(screen.queryByRole('button', { name: '技能 1 项' })).toBeNull();
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

describe('App test API defaults', () => {
  it('does not provide a trusted and ready Skill unless the fixture opts in', async () => {
    const api = installApi();
    expect(await api.skills.list()).toEqual([]);
    await expect(api.skills.get({ id: skill.id })).resolves.toBeNull();
    await expect(
      api.skills.refreshDependencyGrant({ skillId: skill.id, lockId: 'lock-unconfigured' }),
    ).rejects.toThrow('App 测试没有配置 Skill 依赖授权结果');
    await expect(api.skills.testRun({ skillId: skill.id })).rejects.toThrow(
      'App 测试没有配置 Skill 试运行结果',
    );

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '技能' }));

    expect(await screen.findByText('还没有 Skill')).toBeTruthy();
    expect(api.skills.list).toHaveBeenCalled();
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

  it('shows the summoned Expert model in the task composer', async () => {
    const api = installApi({ expert: true, models: [languageModel] });
    api.experts.get.mockResolvedValue({
      ...expertDetail,
      revision: {
        ...expertDetail.revision,
        modelReference: { mode: 'profile', modelProfileId: languageModel.id },
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '召唤' }));

    expect(await screen.findByText('openai-compatible · local-model')).toBeTruthy();
    expect(api.experts.get).toHaveBeenCalledWith({ id: expertSummary.id });
  });

  it('专家参考读取失败可在原表单重试，失败与加载不伪装空态、不丢草稿', async () => {
    const api = installApi({ expert: true });
    api.materials.listCandidates.mockRejectedValue(new Error('参考暂不可读取'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '新建专家' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '保留名称草稿' } });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('参考暂不可读取'),
    );
    expect(screen.queryByText('没有匹配的知识修订。')).toBeNull();
    expect(screen.queryByText('没有匹配的成果版本。')).toBeNull();
    api.materials.listCandidates.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByLabelText('名称')).toHaveProperty('value', '保留名称草稿');
    expect(await screen.findByText('没有匹配的知识修订。')).toBeDefined();
  });

  it('carries the Expert common references into the next TaskContext', async () => {
    const api = installApi({ expert: true });
    const reference = {
      reference: {
        kind: 'knowledge-revision' as const,
        knowledgeDocumentId: 'finance-rules',
        knowledgeRevisionId: 'finance-rules-v2',
        contentHash: 'rules-hash',
        sourcePath: '/rules/finance.md',
      },
      purpose: 'rule' as const,
    };
    api.experts.get.mockResolvedValue({
      ...expertDetail,
      revision: { ...expertDetail.revision, referenceMaterials: [reference] },
    });
    api.materials.listCandidates.mockResolvedValue([
      {
        reference: reference.reference,
        title: '公司财务规则',
        sourceLabel: '知识 · finance.md',
        status: 'ready',
      },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '召唤' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /任务输入/ }), {
      target: { value: '分析本月经营数字' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));

    await waitFor(() => expect(api.taskContexts.save).toHaveBeenCalledTimes(1));
    expect(api.taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        materials: [{ ...reference, addedFrom: 'expert-reference' }],
      }),
    );
  });

  it('does not carry an Expert artifact reference from another workspace', async () => {
    const api = installApi({ expert: true });
    const reference = {
      reference: {
        kind: 'artifact-version' as const,
        artifactId: 'previous-report',
        artifactVersionId: 'previous-report-v3',
        contentHash: 'previous-report-hash',
        originWorkspaceId: 'other-workspace',
      },
      purpose: 'historical-comparison' as const,
    };
    api.experts.get.mockResolvedValue({
      ...expertDetail,
      revision: { ...expertDetail.revision, referenceMaterials: [reference] },
    });
    api.materials.listCandidates.mockResolvedValue([
      {
        reference: reference.reference,
        title: '上月经营报告',
        sourceLabel: '成果 · 上月经营报告 · 其他工作空间',
        status: 'ready',
      },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '召唤' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /任务输入/ }), {
      target: { value: '分析本月经营数字' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));

    await waitFor(() => expect(api.taskContexts.save).toHaveBeenCalledTimes(1));
    expect(api.taskContexts.save).toHaveBeenCalledWith(expect.objectContaining({ materials: [] }));
  });
});

describe('应用内帮助', () => {
  it('保留任务草稿与已选技能，阅读手册不启动执行', async () => {
    const api = installApi({ skills: [skill] });
    render(<App />);
    await openTestRun();
    fireEvent.change(composer(), { target: { value: '待继续的任务草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '帮助' }));
    expect(screen.getByRole('heading', { name: '操作手册' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /任务输入/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '工作' }));
    expect(await screen.findByRole('textbox', { name: /任务输入/ })).toHaveProperty(
      'value',
      '待继续的任务草稿',
    );
    expect(screen.getByRole('button', { name: '技能 1 项' })).toBeTruthy();
    expect(api.tasks.create).not.toHaveBeenCalled();
    expect(api.runs.start).not.toHaveBeenCalled();
  });
});

describe('定时任务导航', () => {
  it('在专家下方显示入口，读取后台事实后往返仍保留 Composer 草稿', async () => {
    const api = installApi();
    render(<App />);
    fireEvent.change(composer(), { target: { value: '保留这段工作要求' } });

    const scheduleNavigation = screen.getByRole('button', { name: '定时' });
    const expertNavigation = screen.getByRole('button', { name: '专家' });
    expect(expertNavigation.compareDocumentPosition(scheduleNavigation)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    fireEvent.click(scheduleNavigation);
    expect(await screen.findByRole('heading', { name: '按约定时间开始工作' })).toBeTruthy();
    await waitFor(() => expect(api.schedules.list).toHaveBeenCalledTimes(1));

    emitScheduleChange?.({ scheduleId: 'schedule-1', reason: 'occurrence' });
    await waitFor(() => expect(api.schedules.list).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '工作' }));
    expect(composer()).toHaveProperty('value', '保留这段工作要求');
  });

  it('从固定期间打开原 Task、保留草稿并只把补充材料写入该 Task', async () => {
    const context: TaskContextRevision = {
      id: 'context-5',
      taskId: previousTask.id,
      revision: 5,
      executor: { kind: 'general' },
      skillBindings: [],
      materials: [],
      scheduleSourceSnapshotId: 'snapshot-1',
      excludedMemoryIds: [],
      mcpToolBindings: [],
      createdAt: 1,
      updatedAt: 5,
    };
    const { detail, occurrence } = scheduleContinuationFixture();
    const api = installApi({ context });
    api.schedules.list.mockResolvedValue({
      status: 'success',
      data: { items: [detail.aggregate] },
    });
    api.schedules.get.mockResolvedValue({ status: 'success', data: detail });
    api.schedules.getOccurrence.mockResolvedValue({ status: 'success', data: occurrence });
    api.runs.listEvents.mockResolvedValue([
      {
        id: 'previous-completed-event',
        runId: previousRun.id,
        sequence: 1,
        createdAt: 2,
        type: 'run.completed',
        finalContent: '旧任务的既有成果。',
      },
    ]);
    const candidate: MaterialCandidate = {
      reference: {
        kind: 'knowledge-revision',
        knowledgeDocumentId: 'document-1',
        knowledgeRevisionId: 'document-1-r2',
        contentHash: 'b'.repeat(64),
        sourcePath: '/workspace/财务规则.md',
      },
      title: '财务规则',
      sourceLabel: '知识 · 财务规则.md',
      status: 'ready',
    };
    api.materials.listCandidates.mockResolvedValue([candidate]);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    await screen.findByText('旧任务的要求');
    fireEvent.change(composer(), { target: { value: '保留原 Task 的续作草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '定时' }));
    await screen.findByRole('heading', { name: '按约定时间开始工作' });
    await waitFor(() => expect(api.schedules.list).toHaveBeenCalled());
    const scheduleChangeListener = emitScheduleChange;
    fireEvent.click(screen.getByRole('button', { name: '规则与历史' }));
    fireEvent.click(await screen.findByRole('button', { name: /打开本期原 Task「旧任务」/ }));

    await screen.findByRole('textbox', { name: /任务输入/ });
    expect(composer()).toHaveProperty('value', '保留原 Task 的续作草稿');
    expect(screen.getByText(/来源快照 snapshot-1/)).toBeTruthy();
    expect(screen.getByText(/缩小后续权限范围并触发现有安全历史分段/)).toBeTruthy();
    const contextPanel = document.querySelector('.context-panel');
    if (!(contextPanel instanceof HTMLElement)) throw new Error('未打开 Task 上下文面板');
    const sources = within(contextPanel);
    fireEvent.click(sources.getByRole('button', { name: '知识' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /财务规则/ }));
    fireEvent.click(screen.getByRole('button', { name: '添加已选材料' }));
    expect(screen.getByText('本次材料 1 项 · 知识 1')).toBeTruthy();
    expect(contextPanel.textContent).toContain('财务规则');

    fireEvent.click(sources.getByRole('button', { name: '移除本期范围' }));
    const confirmation = await screen.findByRole('alertdialog', {
      name: '移除本 Task 的定时来源范围？',
    });
    expect(within(confirmation).getByText(/本期来源快照不变/)).toBeTruthy();
    fireEvent.click(within(confirmation).getByRole('button', { name: '移除本期范围' }));
    await waitFor(() => expect(api.taskContexts.save).toHaveBeenCalledTimes(1));
    expect(api.taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: previousTask.id,
        expectedRevision: 5,
        scheduleSourceSnapshotId: null,
        materials: [
          {
            reference: candidate.reference,
            purpose: 'rule',
            addedFrom: 'workspace-candidate',
          },
        ],
      }),
    );
    expect(screen.getByText(/后续 Run 当前不含这期自动来源/)).toBeTruthy();
    expect(api.schedules.setLifecycle).not.toHaveBeenCalled();
    scheduleChangeListener?.({ scheduleId: 'schedule-1', reason: 'occurrence' });
    expect(screen.getByRole('button', { name: '工作' }).getAttribute('aria-current')).toBe('true');
    expect(composer()).toHaveProperty('value', '保留原 Task 的续作草稿');

    fireEvent.click(screen.getByRole('button', { name: /开始工作/ }));
    await waitFor(() => expect(api.runs.start).toHaveBeenCalledTimes(1));
    expect(api.runs.start).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: previousTask.id, prompt: '保留原 Task 的续作草稿' }),
    );
    expect(api.taskContexts.save).toHaveBeenCalledTimes(2);
    expect(api.taskContexts.save.mock.calls[1]?.[0]).toMatchObject({
      taskId: previousTask.id,
      materials: [
        {
          reference: candidate.reference,
          purpose: 'rule',
          addedFrom: 'workspace-candidate',
        },
      ],
    });
    expect(api.taskContexts.save.mock.calls[1]?.[0]).not.toHaveProperty('scheduleSourceSnapshotId');
    expect(api.schedules.setLifecycle).not.toHaveBeenCalled();
  });
});

describe('Workspace input material display', () => {
  it.each(['success', 'failure'])(
    '旧材料候选 %s 不覆盖后一次选择或提前停止加载',
    async (outcome) => {
      const api = installApi();
      let resolveFirst: ((items: MaterialCandidate[]) => void) | undefined;
      let rejectFirst: ((error: Error) => void) | undefined;
      let resolveSecond: ((items: MaterialCandidate[]) => void) | undefined;
      api.materials.listCandidates
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              resolveFirst = resolve;
              rejectFirst = reject;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecond = resolve;
            }),
        );
      render(<App />);
      await waitFor(() => expect(api.tasks.list).toHaveBeenCalled());
      const openKnowledgePicker = async (): Promise<void> => {
        fireEvent.click(screen.getByRole('button', { name: '添加能力' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: /引用知识/ }));
      };
      await openKnowledgePicker();
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
      await openKnowledgePicker();
      expect(resolveSecond).toBeTypeOf('function');
      await act(async () => {
        if (outcome === 'success') resolveFirst?.([]);
        else rejectFirst?.(new Error('旧候选读取失败'));
      });
      expect(screen.getByText('正在加载候选材料…')).toBeTruthy();
      expect(screen.queryByText('旧候选读取失败')).toBeNull();
      const latestCandidate: MaterialCandidate = {
        reference: {
          kind: 'knowledge-revision',
          knowledgeDocumentId: 'latest-document',
          knowledgeRevisionId: 'latest-revision',
          contentHash: 'latest-hash',
          sourcePath: '/workspace/新规则.md',
        },
        title: '新规则',
        sourceLabel: '知识 · 新规则.md',
        status: 'ready',
      };
      await act(async () => resolveSecond?.([latestCandidate]));
      expect(screen.getByRole('menuitem', { name: /新规则/ })).toBeTruthy();
      expect(screen.queryByText('正在加载候选材料…')).toBeNull();
    },
  );

  it.each(['success', 'failure'])('文件选择迟到 %s 时不污染另一份任务草稿', async (outcome) => {
    const api = installApi();
    let resolveSnapshot: ((snapshot: InputSnapshot) => void) | undefined;
    let rejectSnapshot: ((error: Error) => void) | undefined;
    api.materials.prepareInputSnapshot.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          resolveSnapshot = resolve;
          rejectSnapshot = reject;
        }),
    );
    render(<App />);
    await waitFor(() => expect(api.tasks.list).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '添加能力' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /添加文件/ }));
    expect(resolveSnapshot).toBeTypeOf('function');
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }));
    fireEvent.change(composer(), { target: { value: '新的任务草稿' } });
    await act(async () => {
      if (outcome === 'success')
        resolveSnapshot?.({
          id: 'stale-input',
          workspaceId: workspaceFixture.id,
          sourcePath: '/workspace/旧材料.md',
          contentHash: 'old-hash',
          byteSize: 1,
          format: 'markdown',
          fileKey: 'input-snapshots/old-hash/content',
          status: 'ready',
          createdAt: 1,
          updatedAt: 1,
        });
      else rejectSnapshot?.(new Error('旧文件选择失败'));
    });
    expect(screen.queryByText(/本次材料 1 项/)).toBeNull();
    expect(screen.queryByText('旧文件选择失败')).toBeNull();
    expect(composer()).toHaveProperty('value', '新的任务草稿');
  });

  it('shows the filename immediately after adding a workspace file', async () => {
    const api = installApi();
    api.materials.prepareInputSnapshot.mockResolvedValue({
      id: 'snapshot-new',
      workspaceId: 'workspace-1',
      sourcePath: '/workspace/current-data-excel.xlsx',
      contentHash: 'hash-new',
      byteSize: 1,
      format: 'xlsx',
      fileKey: 'input-snapshots/hash-new/content',
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '添加能力' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /添加文件/ }));

    expect(api.materials.prepareInputSnapshot).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
    });
    expect(await screen.findByText('本次材料 1 项 · 文件 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '查看上下文' }));
    fireEvent.click(screen.getByRole('tab', { name: '资料' }));
    const contextPanel = document.querySelector('.context-panel');
    expect(contextPanel?.textContent).toContain('current-data-excel.xlsx');
  });

  it('reloads the filename when reopening a task with a saved input snapshot', async () => {
    const api = installApi({
      context: {
        id: 'context-previous',
        taskId: previousTask.id,
        revision: 1,
        executor: { kind: 'general' },
        skillBindings: [],
        materials: [
          {
            reference: {
              kind: 'workspace-input-snapshot',
              snapshotId: 'snapshot-saved',
              workspaceId: 'workspace-1',
              contentHash: 'hash-saved',
              format: 'xlsx',
              fileKey: 'input-snapshots/hash-saved/content',
            },
            purpose: 'current-input',
            addedFrom: 'user-input',
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    api.materials.listCandidates.mockResolvedValue([
      {
        reference: {
          kind: 'workspace-input-snapshot',
          snapshotId: 'snapshot-saved',
          workspaceId: 'workspace-1',
          contentHash: 'hash-saved',
          format: 'xlsx',
          fileKey: 'input-snapshots/hash-saved/content',
        },
        title: 'current-data-excel.xlsx',
        sourceLabel: '工作空间文件 · /workspace/current-data-excel.xlsx',
        status: 'ready',
      },
    ]);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));

    fireEvent.click(await screen.findByRole('button', { name: '查看 / 管理' }));
    fireEvent.click(await screen.findByRole('tab', { name: '资料' }));
    const contextPanel = document.querySelector('.context-panel');
    expect(contextPanel?.textContent).toContain('current-data-excel.xlsx');
    expect(api.materials.listCandidates).toHaveBeenCalledWith({ taskId: previousTask.id });
  });
});

describe('Task draft ownership in App', () => {
  const savedContext: TaskContextRevision = {
    id: 'saved-context',
    taskId: previousTask.id,
    revision: 4,
    executor: { kind: 'general' },
    skillBindings: [
      { skillId: skill.id, revisionId: skill.currentRevisionId, source: 'task-selection' },
    ],
    materials: [
      {
        reference: artifactVersionReference,
        purpose: 'structure-reference',
        addedFrom: 'user-input',
      },
    ],
    excludedMemoryIds: ['excluded-memory'],
    mcpToolBindings: [{ connectionId: 'connection', toolId: 'tool' }],
    createdAt: 1,
    updatedAt: 2,
  };
  const completed: AgentRuntimeEvent = {
    id: 'previous-completed',
    runId: previousRun.id,
    sequence: 1,
    createdAt: 2,
    type: 'run.completed',
    finalContent: 'Previous completed answer',
  };

  it('A to B to A never restores the old context over the new CAS baseline and working configuration', async () => {
    const api = installApi({ context: savedContext, skills: [skill] });
    let resolveOldContext: ((context: TaskContextRevision) => void) | undefined;
    api.taskContexts.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOldContext = resolve;
        }),
    );
    api.runs.listEvents.mockResolvedValue([completed]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    await waitFor(() => expect(resolveOldContext).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }));
    fireEvent.click(screen.getByRole('button', { name: /旧任务/ }));
    await screen.findByText(completed.finalContent);
    await act(async () =>
      resolveOldContext?.({
        ...savedContext,
        revision: 1,
        skillBindings: [],
        materials: [],
        excludedMemoryIds: [],
        mcpToolBindings: [],
      }),
    );
    fireEvent.change(composer(), { target: { value: 'Continue with restored configuration' } });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await waitFor(() => expect(api.runs.start).toHaveBeenCalledTimes(1));
    expect(api.taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: previousTask.id,
        expectedRevision: 4,
        executor: savedContext.executor,
        skillBindings: savedContext.skillBindings,
        materials: savedContext.materials,
        excludedMemoryIds: savedContext.excludedMemoryIds,
        mcpToolBindings: savedContext.mcpToolBindings,
      }),
    );
  });

  it('a CAS failure retains the full working draft and retries against the same baseline', async () => {
    const api = installApi({ context: savedContext, skills: [skill] });
    api.runs.listEvents.mockResolvedValue([completed]);
    api.taskContexts.save.mockRejectedValueOnce(new Error('Task context conflict'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    await screen.findByText(completed.finalContent);
    fireEvent.change(composer(), { target: { value: 'Unsent after conflict' } });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await screen.findByText('Task context conflict');
    expect(composer()).toHaveProperty('value', 'Unsent after conflict');
    expect(api.runs.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await waitFor(() => expect(api.runs.start).toHaveBeenCalledTimes(1));
    expect(api.taskContexts.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        taskId: previousTask.id,
        expectedRevision: 4,
        executor: savedContext.executor,
        skillBindings: savedContext.skillBindings,
        materials: savedContext.materials,
        excludedMemoryIds: savedContext.excludedMemoryIds,
        mcpToolBindings: savedContext.mcpToolBindings,
      }),
    );
  });

  it('entering another workspace keeps prompt and skills but clears old Task materials and permissions', async () => {
    const api = installApi({ context: savedContext, skills: [skill] });
    const secondWorkspace = {
      ...workspaceFixture,
      id: 'workspace-2',
      name: '第二空间',
      rootPath: '/second',
    };
    api.workspace.listAll.mockResolvedValue([workspaceFixture, secondWorkspace]);
    api.workspace.listTaskGroups.mockResolvedValue([
      { workspace: workspaceFixture, tasks: [previousTask], totalTasks: 1 },
      { workspace: secondWorkspace, tasks: [], totalTasks: 0 },
    ]);
    api.runs.listEvents.mockResolvedValue([completed]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    await screen.findByText(completed.finalContent);
    fireEvent.change(composer(), { target: { value: 'Draft for the new workspace' } });
    fireEvent.click(screen.getByRole('button', { name: '「第二空间」工作空间的操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '在此空间新建任务' }));
    expect(composer()).toHaveProperty('value', 'Draft for the new workspace');
    expect(screen.getByRole('button', { name: '技能 1 项' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await waitFor(() => expect(api.runs.start).toHaveBeenCalledTimes(1));
    expect(api.tasks.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: secondWorkspace.id }),
    );
    expect(api.taskContexts.save).toHaveBeenCalledWith({
      taskId: 'new-task',
      executor: { kind: 'general' },
      skillBindings: savedContext.skillBindings,
      materials: [],
      excludedMemoryIds: [],
      mcpToolBindings: [],
    });
  });
});

describe('Task context restoration', () => {
  it('keeps a draft for background results and opens a historical task by notification ID on click', async () => {
    const api = installApi();
    api.tasks.list.mockResolvedValue([]);
    const targetNotification: NotificationSummary = {
      id: 'notification-old-task',
      level: 'warning',
      kind: 'run',
      title: '旧任务运行失败',
      createdAt: 10,
      read: false,
      target: { kind: 'task', taskId: previousTask.id },
    };
    api.notifications.get.mockResolvedValue(targetNotification);
    render(<App />);
    const input = await screen.findByRole('textbox', { name: /任务输入/ });
    fireEvent.change(input, { target: { value: '正在编辑的草稿' } });

    act(() => {
      emitNotificationChange?.({
        type: 'created',
        notification: targetNotification,
        unreadCount: 1,
      });
    });
    expect(input).toHaveProperty('value', '正在编辑的草稿');

    await act(async () => {
      activateSystemNotification?.({ id: targetNotification.id });
    });

    expect(api.tasks.list).toHaveBeenCalledWith({ workspaceId: workspaceFixture.id });
    expect(api.notifications.get).toHaveBeenCalledWith({ id: targetNotification.id });
    expect(api.tasks.get).toHaveBeenCalledWith({ id: previousTask.id });
    expect(await screen.findByText('旧任务的要求')).toBeTruthy();
  });

  it('explains a missing historical task and does not route to a different recent task', async () => {
    const api = installApi();
    api.tasks.get.mockResolvedValue(null);
    const targetNotification: NotificationSummary = {
      id: 'notification-missing-task',
      level: 'error',
      kind: 'run',
      title: '原任务已删除',
      createdAt: 10,
      read: true,
      target: { kind: 'task', taskId: 'deleted-task' },
    };
    api.notifications.get.mockResolvedValue(targetNotification);
    render(<App />);
    await screen.findByRole('textbox', { name: /任务输入/ });

    await act(async () => {
      activateSystemNotification?.({ id: targetNotification.id });
    });

    expect(api.tasks.get).toHaveBeenCalledWith({ id: 'deleted-task' });
    expect(api.runs.list).not.toHaveBeenCalledWith({ taskId: previousTask.id });
    expect(await screen.findByText('这项通知对应的任务已不存在，无法打开。')).toBeTruthy();
  });

  it('没有工具调用的取消运行也显示可继续工作的终态', async () => {
    const api = installApi();
    api.runs.list.mockResolvedValue([{ ...previousRun, status: 'cancelled' }]);
    api.runs.listEvents.mockResolvedValue([
      {
        id: 'cancelled-event',
        runId: previousRun.id,
        sequence: 1,
        createdAt: 2,
        type: 'run.cancelled',
      },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    const terminal = await screen.findByText('本次运行已停止。可以调整要求后重新开始。');
    expect(terminal.closest('.status-note')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull();
    expect(screen.getByRole('button', { name: '开始工作' })).toBeTruthy();
    expect(api.runs.start).not.toHaveBeenCalled();
  });

  it('restores the saved Skill selection when reopening a task', async () => {
    const api = installApi({
      skills: [skill],
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
    expect(await screen.findByRole('button', { name: '技能 1 项' })).toBeTruthy();
    expect(api.taskContexts.get).toHaveBeenCalledWith({ taskId: previousTask.id });
  });

  it('does not claim the current default model for an historical Expert revision', async () => {
    installApi({
      expert: true,
      context: {
        id: 'context-previous',
        taskId: previousTask.id,
        revision: 1,
        executor: {
          kind: 'expert',
          expertId: expertSummary.id,
          expertRevisionId: 'historical-expert-revision',
        },
        skillBindings: [],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));

    expect(await screen.findByText('专家修订模型（历史版本）')).toBeTruthy();
  });

  it('offers Expert-scoped memory capture for an Expert task', async () => {
    const api = installApi({
      expert: true,
      context: {
        id: 'context-previous',
        taskId: previousTask.id,
        revision: 1,
        executor: {
          kind: 'expert',
          expertId: expertSummary.id,
          expertRevisionId: expertDetail.revision.id,
        },
        skillBindings: [],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    api.runs.listEvents.mockResolvedValue([
      {
        id: 'message-event',
        runId: previousRun.id,
        sequence: 1,
        createdAt: 2,
        type: 'message.completed',
        messageId: 'message-1',
        content: '经营分析应先核对规则。',
      },
      {
        id: 'completed-event',
        runId: previousRun.id,
        sequence: 2,
        createdAt: 3,
        type: 'run.completed',
        finalContent: '经营分析应先核对规则。',
      },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    fireEvent.click(await screen.findByRole('button', { name: '记住这段经验' }));
    const trigger = screen.getByRole('button', { name: '记住这段经验' });
    // 专家任务的捕获表单默认落在「专家 + 工作空间」范围，并给出只读原文选择区（§3.1、MI02）。
    const scopeButton = await screen.findByRole('button', { name: '记忆适用范围' });
    expect(scopeButton.textContent ?? '').toContain('专家与工作空间');
    const source = screen.getByRole('textbox', {
      name: '回答原文（只读，可拖选或用键盘选择）',
    });
    expect(document.activeElement).toBe(source);
    const content = screen.getByRole('textbox', { name: '记忆正文' });
    content.focus();
    fireEvent.change(content, { target: { value: '尚未提交的改写经验' } });
    fireEvent.keyDown(content, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: '记忆正文' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(api.memories.create).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    expect(screen.getByRole('textbox', { name: '记忆正文' })).toHaveProperty('value', '');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(document.activeElement).toBe(trigger);
    expect(api.memories.create).not.toHaveBeenCalled();
  });

  it('回答捕获保留原文选区来源，并且不提供全局范围', async () => {
    const api = installApi({
      expert: true,
      context: {
        id: 'context-previous',
        taskId: previousTask.id,
        revision: 1,
        executor: {
          kind: 'expert',
          expertId: expertSummary.id,
          expertRevisionId: expertDetail.revision.id,
        },
        skillBindings: [],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    api.runs.listEvents.mockResolvedValue([
      {
        id: 'message-event',
        runId: previousRun.id,
        sequence: 1,
        createdAt: 2,
        type: 'message.completed',
        messageId: 'message-1',
        content: '经营分析应先核对规则。',
      },
      {
        id: 'completed-event',
        runId: previousRun.id,
        sequence: 2,
        createdAt: 3,
        type: 'run.completed',
        finalContent: '经营分析应先核对规则。',
      },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    fireEvent.click(await screen.findByRole('button', { name: '记住这段经验' }));
    // 未确认选区前不得提交（契约 §11.1）。
    fireEvent.change(screen.getByRole('textbox', { name: '记忆正文' }), {
      target: { value: '先核对规则再出结论。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保留来源并记住' }));
    await Promise.resolve();
    expect(api.memories.create).not.toHaveBeenCalled();

    const original = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: '回答原文（只读，可拖选或用键盘选择）',
    });
    original.setSelectionRange(0, 9);
    fireEvent.select(original);
    fireEvent.click(screen.getByRole('button', { name: '确认选区' }));
    // 派生来源不进入全局范围：菜单里不再出现「专家通用」「用户全局」。
    fireEvent.click(screen.getByRole('button', { name: '记忆适用范围' }));
    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent ?? '');
    expect(labels.some((label) => label.includes('专家通用') || label.includes('全局'))).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: '记忆适用范围' }));
    fireEvent.click(screen.getByRole('button', { name: '保留来源并记住' }));

    await waitFor(() => expect(api.memories.create).toHaveBeenCalledTimes(1));
    expect(api.memories.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '先核对规则再出结论。',
        facet: 'method',
        asUserInstruction: false,
        sourceSelector: {
          kind: 'run-assistant',
          runId: previousRun.id,
          eventId: 'message-event',
          start: 0,
          end: 9,
        },
      }),
    );
  });
  /** MI02 AC3：保存失败要留下草稿与原因，未提交的取消不得写库。 */
  it('回答捕获保存失败时保留草稿与幂等键，取消不写库', async () => {
    const api = installApi({
      expert: true,
      context: {
        id: 'context-previous',
        taskId: previousTask.id,
        revision: 1,
        executor: {
          kind: 'expert',
          expertId: expertSummary.id,
          expertRevisionId: expertDetail.revision.id,
        },
        skillBindings: [],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    api.runs.listEvents.mockResolvedValue([
      {
        id: 'message-event',
        runId: previousRun.id,
        sequence: 1,
        createdAt: 2,
        type: 'message.completed',
        messageId: 'message-1',
        content: '经营分析应先核对规则。',
      },
      {
        id: 'completed-event',
        runId: previousRun.id,
        sequence: 2,
        createdAt: 3,
        type: 'run.completed',
        finalContent: '经营分析应先核对规则。',
      },
    ]);
    api.memories.create.mockImplementation(async () => ({
      ok: false,
      error: {
        code: 'SOURCE_REVIEW_REQUIRED',
        message: '来源回答缺少可证明的审计记录，请重新确认选区。',
        retryable: false,
      },
    }));

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
    fireEvent.click(await screen.findByRole('button', { name: '记住这段经验' }));
    const original = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: '回答原文（只读，可拖选或用键盘选择）',
    });
    original.setSelectionRange(0, 9);
    fireEvent.select(original);
    fireEvent.click(screen.getByRole('button', { name: '确认选区' }));
    fireEvent.change(screen.getByRole('textbox', { name: '记忆正文' }), {
      target: { value: '先核对规则再出结论。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保留来源并记住' }));

    await waitFor(() => expect(api.memories.create).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('来源回答缺少可证明的审计记录，请重新确认选区。')).toBeTruthy();
    // 失败不关表单、不吞草稿：正文与来源区间都还在，可以原地重试。
    expect(screen.getByRole('textbox', { name: '记忆正文' })).toHaveProperty(
      'value',
      '先核对规则再出结论。',
    );
    expect(screen.getByRole('button', { name: '保留来源并记住' })).toBeTruthy();

    // 失败重试复用同一个幂等键：一次打开表单一个键（契约 §5.6）。
    fireEvent.click(screen.getByRole('button', { name: '保留来源并记住' }));
    await waitFor(() => expect(api.memories.create).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(api.memories.create).mock.calls;
    const firstKey = calls[0]?.[0]?.operationId;
    expect(firstKey).toBeTruthy();
    expect(calls[1]?.[0]?.operationId).toBe(firstKey);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '保留来源并记住' })).toBeNull(),
    );
    expect(api.memories.create).toHaveBeenCalledTimes(2);
  });
});

describe('Expert configuration', () => {
  it('opens memory management from the Expert memory summary', async () => {
    const legacyProvenance = {
      schemaVersion: 1,
      verification: 'legacy-unverified',
      sourceType: 'user-explicit',
    } as const;
    const memory = memoryViewItem({
      id: 'expert-memory-1',
      revisionId: 'expert-memory-1-r1',
      scope: { kind: 'expert', expertId: expertSummary.id },
      content: '经营月报先核对财务规则。',
      sourceType: 'user-explicit',
      contentHash: 'expert-memory-hash',
      provenance: legacyProvenance,
    });
    const workspaceMemory = memoryViewItem({
      id: 'expert-workspace-memory-1',
      revisionId: 'expert-workspace-memory-1-r1',
      scope: { kind: 'expert-workspace', expertId: expertSummary.id, workspaceId: 'workspace-1' },
      content: '当前工作空间的月报需要附上预算偏差。',
      sourceType: 'user-explicit',
      status: 'candidate',
      candidateDisposition: 'pending',
      effectiveStatus: 'candidate',
      provenance: legacyProvenance,
    });
    const otherWorkspaceMemory = memoryViewItem({
      id: 'expert-workspace-memory-2',
      revisionId: 'expert-workspace-memory-2-r1',
      scope: { kind: 'expert-workspace', expertId: expertSummary.id, workspaceId: 'workspace-2' },
      content: '其他工作空间的内容不应出现在这里。',
      sourceType: 'user-explicit',
      provenance: legacyProvenance,
    });
    installApi({ expert: true, memories: [memory, workspaceMemory, otherWorkspaceMemory] });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '详情' }));

    expect(await screen.findByText('1 条已确认 · 1 条待确认')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '管理记忆' }));
    expect(await screen.findByText('当前范围：经营分析专家 · 当前工作空间')).toBeTruthy();
    expect(
      await screen.findByRole('heading', { name: '让长期经验可查看、可确认、可撤回' }),
    ).toBeTruthy();
  });

  it('passes model profiles from the API to the Expert editor', async () => {
    installApi({ expert: true, models: [languageModel] });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '专家' }));
    fireEvent.click(await screen.findByRole('button', { name: '详情' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑配置' }));

    const modelSelect = await screen.findByRole('button', { name: '专家模型偏好' });
    expect(modelSelect.textContent).toContain('应用默认模型');
    fireEvent.click(modelSelect);
    expect(
      await screen.findByRole('menuitem', { name: '本地语言模型 · local-model' }),
    ).toBeTruthy();
  });
});

/**
 * 参考成果版本的端到端纪律（WM14，产品设计 §3.6、实施契约 §10）。
 *
 * 界面把「标记」和「引用到当前任务」分成两件事：引用只把**那一版**（精确版本 id +
 * 内容哈希）加进当前任务材料，既不自动发送也不换专家；来源消失时报错可见、视图不跳走。
 */
describe('参考成果版本接入当前任务', () => {
  const pinnedHash = 'b'.repeat(64);
  const reportSummary: ArtifactSummary = {
    id: 'report-1',
    workspaceId: 'workspace-1',
    taskId: 'previous-task',
    type: 'markdown',
    title: '季度复盘',
    currentVersionId: 'version-9',
    versionNumber: 3,
    origin: 'assistant-run',
    sourceRunId: 'previous-run',
    createdAt: 1,
    updatedAt: 1,
  };
  const reportDetail: ArtifactDetail = {
    ...reportSummary,
    content: '# 季度复盘',
    contentHash: pinnedHash,
    evidence: [],
  };
  const pinnedReference = {
    kind: 'artifact-version' as const,
    artifactId: reportSummary.id,
    artifactVersionId: 'version-9',
    contentHash: pinnedHash,
    originWorkspaceId: 'workspace-1',
  };

  const installReferenceApi = (
    options?: Parameters<typeof installApi>[0],
  ): ReturnType<typeof installApi> => {
    const api = installApi(options);
    api.artifacts.list.mockResolvedValue([reportSummary]);
    api.artifacts.get.mockResolvedValue(reportDetail);
    // MI08：默认身份来自来源 Run 快照，而不是旧 Task 的当前草稿。
    api.artifacts.getVersionExecutor.mockResolvedValue({
      kind: 'expert',
      sourceRunId: 'previous-run',
      expertId: expertSummary.id,
      sourceExpertRevisionId: expertDetail.revision.id,
      currentExpertRevisionId: expertDetail.revision.id,
      name: expertDetail.name,
    });
    api.workspace.listReferenceVersions.mockResolvedValue(
      okResult({
        items: [
          {
            reference: {
              id: 'ref-1',
              workspaceId: 'workspace-1',
              artifactVersionId: 'version-9',
              contentHash: pinnedHash,
              label: '季度复盘 · v3',
              status: 'active' as const,
              revision: 1,
              selectedAt: 1,
              updatedAt: 1,
            },
            artifactId: reportSummary.id,
            status: 'ready' as const,
          },
        ],
      }),
    );
    api.materials.listCandidates.mockResolvedValue([
      {
        reference: pinnedReference,
        title: '季度复盘 · v3',
        sourceLabel: '成果 · 季度复盘',
        status: 'ready',
      },
    ]);
    return api;
  };

  it('引用只固定精确版本与哈希进材料，不自动启动运行', async () => {
    const api = installReferenceApi();
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '成果' }));
    fireEvent.click(await screen.findByRole('button', { name: /季度复盘/ }));
    expect(await screen.findByText('本空间参考版本')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '引用到当前任务' }));

    expect(await screen.findByText('本次材料 1 项 · 成果 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看 / 管理' }));
    fireEvent.click(await screen.findByRole('tab', { name: '资料' }));
    // 材料用途在资料面板管理；引用固定到结构参考用途，不自动发送。
    expect(screen.getByRole('button', { name: '已选材料用途' }).textContent).toContain('结构参考');
    expect(api.runs.start).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: '当前专家' })).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: /任务输入/ }), {
      target: { value: '按这一版的结构重写摘要' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));

    await waitFor(() => expect(api.taskContexts.save).toHaveBeenCalledTimes(1));
    expect(api.taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        materials: [
          {
            reference: pinnedReference,
            purpose: 'structure-reference',
            addedFrom: 'user-input',
          },
        ],
      }),
    );
    // 复用已标记的引用：不再重复写标记，也不跟随成果的最新版本
    expect(api.workspace.setReferenceVersion).not.toHaveBeenCalled();
  });

  it('简报里的参考版本对应成果已消失时，错误可见且不切换视图', async () => {
    const api = installApi();
    api.artifacts.get.mockResolvedValue(null);
    api.workspace.memoryBrief.mockResolvedValue(
      okResult({
        ...briefFixture,
        referenceVersions: {
          items: [
            {
              reference: {
                id: 'ref-1',
                workspaceId: 'workspace-1',
                artifactVersionId: 'version-9',
                contentHash: pinnedHash,
                label: '季度复盘 · v3',
                status: 'active' as const,
                revision: 1,
                selectedAt: 1,
                updatedAt: 1,
              },
              artifactId: reportSummary.id,
              status: 'ready' as const,
            },
          ],
          total: 1,
          truncated: false,
        },
      }),
    );
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: '查看上下文' }));
    fireEvent.click(screen.getByRole('tab', { name: '简报' }));
    fireEvent.click(await screen.findByRole('button', { name: /季度复盘/ }));

    // 这条失败没有可承载它的对象（成果已经不存在，视图也不切），按 §11.5.1 走全局短时提醒。
    const notice = await screen.findByText('该参考版本对应的成果已不存在，请在成果列表中确认。');
    expect(notice.closest('.toast-stack')).not.toBeNull();
    expect(api.artifacts.get).toHaveBeenCalledWith({ id: reportSummary.id });
    // 视图仍在工作页：失败不把用户扔到空白成果页
    expect(screen.getByRole('textbox', { name: /任务输入/ })).toBeTruthy();
  });

  /** 来源任务的专家绑定就记在它的 TaskContext 里，草稿衔接要按它继承。 */
  const expertContext = (): TaskContextRevision => ({
    id: 'context-previous',
    taskId: 'previous-task',
    revision: 2,
    executor: {
      kind: 'expert',
      expertId: expertSummary.id,
      expertRevisionId: expertDetail.revision.id,
    },
    skillBindings: [],
    createdAt: 1,
    updatedAt: 1,
  });

  const openVersionAction = async (): Promise<void> => {
    fireEvent.click(await screen.findByRole('button', { name: '成果' }));
    fireEvent.click(await screen.findByRole('button', { name: /季度复盘/ }));
    fireEvent.click(await screen.findByRole('button', { name: '基于此版本开始新任务' }));
  };

  it.each([
    ['success', false],
    ['success', true],
    ['failure', true],
  ] as const)(
    '来源身份迟到 %s 时保留新的选择与草稿，返回原 Task=%s',
    async (outcome, returnToTask) => {
      const api = installReferenceApi({ expert: true, context: expertContext() });
      let resolveExecutor: ((value: ArtifactVersionExecutorSummary | null) => void) | undefined;
      let rejectExecutor: ((error: Error) => void) | undefined;
      api.artifacts.getVersionExecutor.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            resolveExecutor = resolve;
            rejectExecutor = reject;
          }),
      );
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /旧任务/ }));
      await screen.findByText(previousRun.prompt);
      await openVersionAction();
      expect(resolveExecutor).toBeTypeOf('function');
      fireEvent.click(screen.getByRole('button', { name: '新建任务' }));
      if (returnToTask) {
        fireEvent.click(screen.getByRole('button', { name: /旧任务/ }));
        await screen.findByText(previousRun.prompt);
      }
      fireEvent.change(composer(), { target: { value: '用户切换后写下的草稿' } });
      await act(async () => {
        if (outcome === 'success')
          resolveExecutor?.({ kind: 'unavailable', reason: 'expert-unavailable' });
        else rejectExecutor?.(new Error('旧来源身份读取失败'));
      });
      expect(composer()).toHaveProperty('value', '用户切换后写下的草稿');
      expect(screen.queryByText(/无法确认该版本的来源执行身份/)).toBeNull();
      expect(screen.queryByText(/来源任务的专家已不可用/)).toBeNull();
      expect(api.runs.start).not.toHaveBeenCalled();
    },
  );

  it('沿用来源专家：草稿交给该专家当前可用修订，不自动发送也不提示', async () => {
    const api = installReferenceApi({ expert: true, context: expertContext() });
    render(<App />);
    await openVersionAction();

    const expertChip = await screen.findByRole('list', { name: '当前专家' });
    expect(expertChip.textContent).toContain('经营分析专家');
    expect(screen.queryByText(/通用助手/)).toBeNull();
    expect(api.runs.start).not.toHaveBeenCalled();
  });

  it('来源执行身份读取失败时保留原任务与草稿，只报一次可重试错误', async () => {
    const api = installReferenceApi({ expert: true, context: expertContext() });
    api.artifacts.getVersionExecutor.mockRejectedValueOnce(new Error('数据库暂时不可用'));
    render(<App />);
    await openVersionAction();

    expect(await screen.findByText(/无法确认该版本的来源执行身份，原任务保持不变/)).toBeTruthy();
    // 失败不新建任务、不切走成果视图，也不留下半途的专家切换。
    expect(screen.queryByRole('list', { name: '当前专家' })).toBeNull();
    expect(api.runs.start).not.toHaveBeenCalled();
  });

  it('重复点击时迟到响应不覆盖后一次结果', async () => {
    const api = installReferenceApi({ expert: true, context: expertContext() });
    let resolveFirst: ((value: ArtifactVersionExecutorSummary | null) => void) | undefined;
    api.artifacts.getVersionExecutor
      .mockImplementationOnce(
        () =>
          new Promise<ArtifactVersionExecutorSummary | null>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        kind: 'unavailable',
        reason: 'expert-unavailable',
      });
    render(<App />);
    await openVersionAction();
    // 再点一次：第一次的响应此刻仍未回来，只有后一次的结果可以落到界面上。
    const again = screen.getAllByRole('button', { name: '基于此版本开始新任务' }).at(-1);
    if (again) fireEvent.click(again);

    resolveFirst?.({
      kind: 'expert',
      sourceRunId: 'previous-run',
      expertId: expertSummary.id,
      sourceExpertRevisionId: expertDetail.revision.id,
      currentExpertRevisionId: expertDetail.revision.id,
      name: expertDetail.name,
    });
    await Promise.resolve();
    await Promise.resolve();

    // 只有后一次（专家不可用）的结果生效：不出现幽灵专家，也不重复提示。
    expect(screen.queryByRole('list', { name: '当前专家' })).toBeNull();
    expect(
      await screen.findByText('来源任务的专家已不可用，新任务先用通用助手，可自行选择其他专家。'),
    ).toBeTruthy();
    expect(api.runs.start).not.toHaveBeenCalled();
  });

  /**
   * MI08 AC3：来源专家配置已更新时要说明「按当前配置使用」，并且不继承来源任务的技能选择；
   * 来源身份只用于决定默认专家，旧授权不自动跟随。
   */
  it('来源专家修订已更新时说明按当前配置使用，且不复制技能绑定', async () => {
    const api = installReferenceApi({
      expert: true,
      context: {
        ...expertContext(),
        // 来源任务带着技能选择；新草稿只继承默认专家，不复制这些授权。
        skillBindings: [{ skillId: 'skill-old', revisionId: 'rev-old', source: 'task-selection' }],
      },
    });
    api.artifacts.getVersionExecutor.mockResolvedValue({
      kind: 'expert',
      sourceRunId: 'previous-run',
      expertId: expertSummary.id,
      sourceExpertRevisionId: 'expert-revision-old',
      currentExpertRevisionId: expertDetail.revision.id,
      name: expertDetail.name,
    });
    render(<App />);
    await openVersionAction();

    expect(await screen.findByText(/旧版本配置；新任务使用其当前版本/)).toBeTruthy();
    expect(api.runs.start).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: /任务输入/ }), {
      target: { value: '按这一版的结构重写摘要' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }));
    await waitFor(() => expect(api.taskContexts.save).toHaveBeenCalledTimes(1));
    expect(api.taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        executor: {
          kind: 'expert',
          expertId: expertSummary.id,
          expertRevisionId: expertDetail.revision.id,
        },
        skillBindings: [],
      }),
    );
  });

  it('来源专家已不可用时改用通用助手并当场说明，不猜专家', async () => {
    const api = installReferenceApi({ expert: true, context: expertContext() });
    api.artifacts.getVersionExecutor.mockResolvedValue({
      kind: 'unavailable',
      reason: 'expert-unavailable',
    });
    render(<App />);
    await openVersionAction();

    expect(
      await screen.findByText('来源任务的专家已不可用，新任务先用通用助手，可自行选择其他专家。'),
    ).toBeTruthy();
    expect(screen.queryByRole('list', { name: '当前专家' })).toBeNull();
    expect(api.runs.start).not.toHaveBeenCalled();
  });
});
