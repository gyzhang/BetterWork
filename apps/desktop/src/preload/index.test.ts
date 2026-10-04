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
    ]);
    expect(mocks.invoke).toHaveBeenCalledTimes(13);
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
