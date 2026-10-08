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
