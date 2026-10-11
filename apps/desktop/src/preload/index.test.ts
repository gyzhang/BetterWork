import type { BetterWorkDesktopApi } from '@betterwork/agent-protocol';
import { IpcChannel } from '@betterwork/agent-protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn<(channel: string, input: unknown) => Promise<unknown>>(),
  listeners: new Map<string, (event: unknown, raw: unknown) => void>(),
  off: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: unknown) => {
      mocks.exposed.set('api', api);
    },
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: (channel: string, listener: (event: unknown, raw: unknown) => void) => {
      mocks.listeners.set(channel, listener);
    },
    off: mocks.off,
  },
}));

import './index';

const api = (): BetterWorkDesktopApi => {
  const exposed = mocks.exposed.get('api');
  if (typeof exposed !== 'object' || exposed === null) {
    throw new Error('Preload API was not exposed');
  }
  return exposed as BetterWorkDesktopApi;
};

const rejected = {
  status: 'rejected',
  error: { code: 'schedule_conflict', message: '合成拒绝结果' },
};

const config = {
  name: '月度复盘',
  expertId: 'expert-1',
  expertRevisionId: 'expert-revision-1',
  requirements: '分析上月变化并列出依据。',
  expectedArtifactTypes: ['markdown' as const],
  timing: {
    frequency: 'monthly' as const,
    day: 5,
    hour: 9,
    minute: 0,
    timeZone: 'Asia/Shanghai' as const,
  },
  periodRule: 'previous-month' as const,
  knowledgeSources: [],
  outputSubdirectory: '定时成果' as const,
};

describe('schedule preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.invoke.mockResolvedValue(rejected);
  });

  it('validates and forwards every schedule request through its typed channel', async () => {
    const schedules = api().schedules;
    await Promise.all([
      schedules.list(),
      schedules.get({ scheduleId: 'schedule-1' }),
      schedules.save({
        operation: 'create',
        workspaceId: 'workspace-1',
        config,
        targetLifecycle: 'paused',
      }),
      schedules.setLifecycle({
        scheduleId: 'schedule-1',
        expectedRevision: 1,
        lifecycle: 'paused',
      }),
      schedules.preview({ timing: config.timing, periodRule: config.periodRule }),
      schedules.preflight({ target: 'draft', workspaceId: 'workspace-1', config }),
      schedules.applyExpertRevision({
        scheduleId: 'schedule-1',
        expectedRevision: 1,
        expertRevisionId: 'expert-revision-2',
      }),
      schedules.listOccurrences({ scheduleId: 'schedule-1', limit: 10 }),
      schedules.getOccurrence({ occurrenceId: 'occurrence-1' }),
      schedules.listSourceItems({ occurrenceId: 'occurrence-1', limit: 10 }),
      schedules.executeNow({
        scheduleId: 'schedule-1',
        expectedRevision: 1,
        requestKey: 'manual-once',
        preflightFingerprint: 'fingerprint-1',
      }),
      schedules.executeMissed({
        scheduleId: 'schedule-1',
        originalOccurrenceId: 'occurrence-1',
        expectedRevision: 1,
        requestKey: 'missed-once',
        preflightFingerprint: 'fingerprint-1',
      }),
      schedules.cancelOccurrence({ occurrenceId: 'occurrence-1' }),
      schedules.retryOutput({ receiptId: 'receipt-1', expectedAttempt: 1 }),
    ]);

    expect(mocks.invoke.mock.calls.map(([channel]) => channel)).toEqual([
      IpcChannel.ListSchedules,
      IpcChannel.GetSchedule,
      IpcChannel.SaveSchedule,
      IpcChannel.SetScheduleLifecycle,
      IpcChannel.PreviewSchedule,
      IpcChannel.PreflightSchedule,
      IpcChannel.ApplyScheduleExpertRevision,
      IpcChannel.ListScheduleOccurrences,
      IpcChannel.GetScheduleOccurrence,
      IpcChannel.ListScheduleSourceItems,
      IpcChannel.ExecuteScheduleNow,
      IpcChannel.ExecuteMissedSchedule,
      IpcChannel.CancelScheduleOccurrence,
      IpcChannel.RetryScheduleOutput,
    ]);
    expect(mocks.invoke).toHaveBeenCalledTimes(14);
  });

  it('rejects malformed preload inputs before IPC and malformed responses after IPC', async () => {
    expect(() => api().schedules.get({ scheduleId: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValueOnce({ status: 'success', data: {} });
    await expect(api().schedules.list()).rejects.toThrow();
  });

  it('validates schedule change events and removes the subscribed listener', () => {
    const listener = vi.fn();
    const unsubscribe = api().schedules.onChange(listener);
    const handler = mocks.listeners.get(IpcChannel.ScheduleChanged);
    expect(handler).toBeDefined();
    handler?.({}, { scheduleId: 'schedule-1', reason: 'occurrence' });
    expect(listener).toHaveBeenCalledWith({ scheduleId: 'schedule-1', reason: 'occurrence' });
    expect(() => handler?.({}, { scheduleId: '', reason: 'unknown' })).toThrow();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(mocks.off).toHaveBeenCalledWith(IpcChannel.ScheduleChanged, handler);
  });
});

describe('run preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue([]);
  });

  it('validates and forwards Run requests and responses through their channels', async () => {
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.StartRun) return { runId: 'run-1' };
      if (channel === IpcChannel.CancelRun) return { cancelled: true };
      return [];
    });

    await Promise.all([
      api().runs.start({
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '归纳本次资料。',
      }),
      api().runs.cancel({ runId: 'run-1' }),
      api().runs.list(),
      api().runs.listEvents({ runId: 'run-1' }),
    ]);

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.StartRun, { taskId: 'task-1', sessionId: 'session-1', prompt: '归纳本次资料。' }],
      [IpcChannel.CancelRun, { runId: 'run-1' }],
      [IpcChannel.ListRuns, undefined],
      [IpcChannel.ListRunEvents, { runId: 'run-1' }],
    ]);
  });

  it('rejects invalid Run requests before IPC and malformed responses after IPC', async () => {
    expect(() =>
      api().runs.start({ taskId: '', sessionId: 'session-1', prompt: '归纳本次资料。' }),
    ).toThrow();
    expect(() => api().runs.cancel({ runId: '' })).toThrow();
    expect(() => api().runs.list({ taskId: '' })).toThrow();
    expect(() => api().runs.listEvents({ runId: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue(null);
    await expect(
      api().runs.start({ taskId: 'task-1', sessionId: 'session-1', prompt: '归纳本次资料。' }),
    ).rejects.toThrow();
    await expect(api().runs.cancel({ runId: 'run-1' })).rejects.toThrow();
    await expect(api().runs.list()).rejects.toThrow();
    await expect(api().runs.listEvents({ runId: 'run-1' })).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(4);
  });
});

describe('workspace preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(null);
  });

  it('validates and forwards workspace requests and responses through their channels', async () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Research',
      rootPath: '/tmp/research',
      iconId: 'folder',
      accentId: 'moss',
      createdAt: 1,
      updatedAt: 1,
    };
    let directorySelectionCount = 0;
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.GetDefaultWorkspace) return workspace;
      if (channel === IpcChannel.PickWorkspaceDirectory) {
        directorySelectionCount += 1;
        return directorySelectionCount === 1 ? null : '/tmp/research';
      }
      if (channel === IpcChannel.ListWorkspaces) return [workspace];
      if (channel === IpcChannel.ListWorkspaceTaskGroups) return [];
      return workspace;
    });

    await Promise.all([
      api().workspace.getDefault(),
      api().workspace.pickDirectory(),
      api().workspace.listAll(),
      api().workspace.create({ rootPath: '/tmp/research', name: 'Research' }),
      api().workspace.updateIdentity({ workspaceId: 'workspace-1', name: 'Research Notes' }),
      api().workspace.setHidden({ workspaceId: 'workspace-1', hidden: true }),
      api().workspace.listTaskGroups(),
    ]);
    await expect(api().workspace.pickDirectory()).resolves.toBe('/tmp/research');

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.GetDefaultWorkspace, {}],
      [IpcChannel.PickWorkspaceDirectory, {}],
      [IpcChannel.ListWorkspaces, {}],
      [IpcChannel.CreateWorkspace, { rootPath: '/tmp/research', name: 'Research' }],
      [IpcChannel.UpdateWorkspaceIdentity, { workspaceId: 'workspace-1', name: 'Research Notes' }],
      [IpcChannel.SetWorkspaceHidden, { workspaceId: 'workspace-1', hidden: true }],
      [IpcChannel.ListWorkspaceTaskGroups, {}],
      [IpcChannel.PickWorkspaceDirectory, {}],
    ]);
  });

  it('rejects invalid workspace requests before IPC and malformed responses after IPC', async () => {
    expect(() => api().workspace.create({ rootPath: '' })).toThrow();
    expect(() => api().workspace.updateIdentity({ workspaceId: '', name: 'Research' })).toThrow();
    expect(() => api().workspace.setHidden({ workspaceId: '', hidden: true })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue({});
    await expect(api().workspace.getDefault()).rejects.toThrow();
    await expect(api().workspace.pickDirectory()).rejects.toThrow();
    await expect(api().workspace.listAll()).rejects.toThrow();
    await expect(api().workspace.create({ rootPath: '/tmp/research' })).rejects.toThrow();
    await expect(
      api().workspace.updateIdentity({ workspaceId: 'workspace-1', name: 'Research' }),
    ).rejects.toThrow();
    await expect(
      api().workspace.setHidden({ workspaceId: 'workspace-1', hidden: true }),
    ).rejects.toThrow();
    await expect(api().workspace.listTaskGroups()).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(7);
  });
});

describe('task preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue([]);
  });

  it('validates and forwards Task requests and responses through their channels', async () => {
    const task = {
      id: 'task-1',
      workspaceId: 'workspace-1',
      title: 'Research',
      goal: 'Summarize the source material.',
      createdAt: 1,
      updatedAt: 1,
    };
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.CreateTask) return { task, sessionId: 'session-1' };
      return [{ ...task, sessionId: 'session-1' }];
    });

    await Promise.all([
      api().tasks.create({
        workspaceId: 'workspace-1',
        title: 'Research',
        goal: 'Summarize the source material.',
      }),
      api().tasks.list(),
      api().tasks.list({ workspaceId: 'workspace-1' }),
    ]);

    expect(mocks.invoke.mock.calls).toEqual([
      [
        IpcChannel.CreateTask,
        {
          workspaceId: 'workspace-1',
          title: 'Research',
          goal: 'Summarize the source material.',
        },
      ],
      [IpcChannel.ListTasks, undefined],
      [IpcChannel.ListTasks, { workspaceId: 'workspace-1' }],
    ]);
  });

  it('rejects invalid Task requests before IPC and malformed responses after IPC', async () => {
    expect(() =>
      api().tasks.create({
        workspaceId: '',
        title: 'Research',
        goal: 'Summarize the source material.',
      }),
    ).toThrow();
    expect(() => api().tasks.list({ workspaceId: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue(null);
    await expect(
      api().tasks.create({
        workspaceId: 'workspace-1',
        title: 'Research',
        goal: 'Summarize the source material.',
      }),
    ).rejects.toThrow();
    await expect(api().tasks.list()).rejects.toThrow();
    await expect(api().tasks.list({ workspaceId: 'workspace-1' })).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
  });
});

describe('evidence preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue([]);
  });

  it('validates and forwards Evidence requests and responses through its channel', async () => {
    const evidence = {
      id: 'evidence-1',
      taskId: 'task-1',
      runId: 'run-1',
      sourceType: 'local-file' as const,
      sourceUri: 'file:///tmp/source.md',
      title: 'Source',
      locator: '',
      excerpt: '',
      contentHash: 'hash-1',
      capturedAt: 1,
    };
    const knowledgeEvidence = {
      ...evidence,
      id: 'evidence-2',
      knowledgeSource: {
        reference: {
          kind: 'knowledge-revision' as const,
          knowledgeDocumentId: 'document-1',
          knowledgeRevisionId: 'revision-1',
          contentHash: 'content-hash',
          sourcePath: '/tmp/knowledge.md',
        },
        textHash: 'text-hash',
        span: { sectionOrdinal: 0, start: 0, end: 12 },
        operation: 'search' as const,
      },
    };
    mocks.invoke.mockResolvedValue([
      { ...evidence, knowledgeSource: undefined },
      knowledgeEvidence,
    ]);

    const result = await api().evidence.list({ taskId: 'task-1' });
    expect(result).toHaveLength(2);
    expect(Object.hasOwn(result[0] ?? {}, 'knowledgeSource')).toBe(false);
    expect(result[1]?.knowledgeSource?.reference.knowledgeRevisionId).toBe('revision-1');
    expect(mocks.invoke).toHaveBeenCalledWith(IpcChannel.ListEvidence, { taskId: 'task-1' });
  });

  it('rejects invalid Evidence requests before IPC and malformed responses after IPC', async () => {
    expect(() => api().evidence.list({ taskId: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue([{}]);
    await expect(api().evidence.list({ taskId: 'task-1' })).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledWith(IpcChannel.ListEvidence, { taskId: 'task-1' });
  });
});

describe('model preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue(null);
  });

  it('validates and forwards Model requests and responses through their channels', async () => {
    const profile = {
      id: 'model-1',
      name: 'Primary',
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'model-a',
      role: 'language' as const,
      apiKeyConfigured: true,
      enabled: true,
      priority: 0,
      connectionStatus: 'connected' as const,
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      temperature: 0.7,
      createdAt: 1,
      updatedAt: 1,
    };
    const saveInput = {
      name: 'Primary',
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'model-a',
      role: 'language' as const,
      apiKey: '',
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      temperature: 0.7,
      enabled: true,
      priority: 0,
    };
    const testInput = {
      baseUrl: 'https://api.example.com/v1',
      model: 'model-a',
      role: 'language' as const,
      apiKey: '',
    };
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.ListModels) {
        return [
          { ...profile, lastTestedAt: undefined },
          { ...profile, id: 'model-2', lastTestedAt: 2 },
        ];
      }
      if (channel === IpcChannel.SaveModel) return { id: 'model-1' };
      if (channel === IpcChannel.DeleteModel) return { deleted: true };
      if (channel === IpcChannel.SetDefaultModel || channel === IpcChannel.SetModelEnabled) {
        return { updated: true };
      }
      return { ok: true, message: 'connected' };
    });

    const profiles = await api().models.list();
    await Promise.all([
      api().models.save(saveInput),
      api().models.delete({ id: 'model-1' }),
      api().models.setDefault({ id: 'model-1' }),
      api().models.setEnabled({ id: 'model-1', enabled: false }),
      api().models.test(testInput),
    ]);

    expect(profiles).toHaveLength(2);
    expect(Object.hasOwn(profiles[0] ?? {}, 'lastTestedAt')).toBe(false);
    expect(profiles[1]?.lastTestedAt).toBe(2);
    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.ListModels, {}],
      [IpcChannel.SaveModel, saveInput],
      [IpcChannel.DeleteModel, { id: 'model-1' }],
      [IpcChannel.SetDefaultModel, { id: 'model-1' }],
      [IpcChannel.SetModelEnabled, { id: 'model-1', enabled: false }],
      [IpcChannel.TestModel, testInput],
    ]);
  });

  it('rejects invalid Model requests before IPC and malformed responses after IPC', async () => {
    const saveInput = {
      name: 'Primary',
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      model: 'model-a',
      role: 'language' as const,
      apiKey: '',
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      temperature: 0.7,
      enabled: true,
      priority: 0,
    };
    const testInput = {
      baseUrl: 'https://api.example.com/v1',
      model: 'model-a',
      role: 'language' as const,
      apiKey: '',
    };

    expect(() => api().models.save({ ...saveInput, name: '' })).toThrow();
    expect(() => api().models.delete({ id: '' })).toThrow();
    expect(() => api().models.setDefault({ id: '' })).toThrow();
    expect(() => api().models.setEnabled({ id: '', enabled: false })).toThrow();
    expect(() => api().models.test({ ...testInput, baseUrl: '' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValue(null);
    await expect(api().models.list()).rejects.toThrow();
    await expect(api().models.save(saveInput)).rejects.toThrow();
    await expect(api().models.delete({ id: 'model-1' })).rejects.toThrow();
    await expect(api().models.setDefault({ id: 'model-1' })).rejects.toThrow();
    await expect(api().models.setEnabled({ id: 'model-1', enabled: false })).rejects.toThrow();
    await expect(api().models.test(testInput)).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenCalledTimes(6);
  });
});

describe('historical task and notification preload APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.NotificationRendererReady) return { ready: true };
      return null;
    });
  });

  it('validates stable IDs and the Renderer ready acknowledgment', async () => {
    await Promise.all([
      api().tasks.get({ id: 'historical-task' }),
      api().notifications.get({ id: 'notification-1' }),
      api().notifications.rendererReady(),
    ]);
    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.GetTask, { id: 'historical-task' }],
      [IpcChannel.GetNotification, { id: 'notification-1' }],
      [IpcChannel.NotificationRendererReady, {}],
    ]);
    expect(() => api().tasks.get({ id: '' })).toThrow();
    expect(() => api().notifications.get({ id: '' })).toThrow();
  });
});

describe('task continuity preload API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation(async (channel) => {
      if (channel === IpcChannel.GetTaskContinuityBrief) return null;
      return { kind: 'conflict', currentRevision: 2 };
    });
  });

  it('validates and forwards reads and CAS saves through their typed channels', async () => {
    await expect(api().taskContinuity.getBrief({ taskId: 'task-1' })).resolves.toBeNull();
    await expect(
      api().taskContinuity.saveBrief({
        taskId: 'task-1',
        expectedRevision: 1,
        objective: '分析季度结果',
        activeRequirements: [],
        progress: null,
      }),
    ).resolves.toEqual({ kind: 'conflict', currentRevision: 2 });

    expect(mocks.invoke.mock.calls).toEqual([
      [IpcChannel.GetTaskContinuityBrief, { taskId: 'task-1' }],
      [
        IpcChannel.SaveTaskContinuityBrief,
        {
          taskId: 'task-1',
          expectedRevision: 1,
          objective: '分析季度结果',
          activeRequirements: [],
          progress: null,
        },
      ],
    ]);

    mocks.invoke.mockResolvedValueOnce({
      kind: 'error',
      message: '保存本任务简报失败，草稿仍保留；请重试。',
    });
    await expect(
      api().taskContinuity.saveBrief({
        taskId: 'task-1',
        expectedRevision: 1,
        objective: '分析季度结果',
        activeRequirements: [],
        progress: null,
      }),
    ).resolves.toEqual({
      kind: 'error',
      message: '保存本任务简报失败，草稿仍保留；请重试。',
    });
  });

  it('rejects malformed requests before IPC and malformed mutation results after IPC', async () => {
    expect(() =>
      api().taskContinuity.saveBrief({
        taskId: 'task-1',
        expectedRevision: 0,
        objective: '分析季度结果',
        activeRequirements: [],
        progress: null,
      }),
    ).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.invoke.mockResolvedValueOnce({ kind: 'saved', revision: {} });
    await expect(
      api().taskContinuity.saveBrief({
        taskId: 'task-1',
        expectedRevision: 1,
        objective: '分析季度结果',
        activeRequirements: [],
        progress: null,
      }),
    ).rejects.toThrow();
  });
});

describe('MCP preload operations', () => {
  it('validates operation IDs and consent before IPC and correlates the login/cancel channels', async () => {
    mocks.invoke.mockClear();
    const operation = {
      id: 'connection',
      expectedRevisionId: 'revision',
      operationId: 'ba17e5bd-b537-4a68-9b32-231634967f0c',
    };
    expect(() => api().mcp.cancelOperation({ ...operation, operationId: 'invalid' })).toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValueOnce({ cancelled: true });
    await expect(api().mcp.cancelOperation(operation)).resolves.toEqual({ cancelled: true });
    expect(mocks.invoke).toHaveBeenLastCalledWith(IpcChannel.CancelMcpOperation, operation);
    mocks.invoke.mockResolvedValueOnce({
      operationId: operation.operationId,
      resource: 'https://mcp.example/mcp',
      issuers: ['https://auth.example'],
      scopes: ['read'],
    });
    await expect(api().mcp.prepareLogin(operation)).resolves.toMatchObject({ scopes: ['read'] });
    expect(mocks.invoke).toHaveBeenLastCalledWith(IpcChannel.PrepareMcpLogin, operation);
    mocks.invoke.mockResolvedValueOnce({ secret: 'unexpected response' });
    await expect(api().mcp.logout(operation)).rejects.toThrow();
    expect(mocks.invoke).toHaveBeenLastCalledWith(IpcChannel.LogoutMcpConnection, operation);
  });
});
