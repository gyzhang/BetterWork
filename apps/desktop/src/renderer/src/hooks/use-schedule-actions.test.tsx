// @vitest-environment jsdom

import type {
  ScheduleCallResult,
  ScheduleDetail,
  ScheduleManualExecutionResult,
  ScheduleOutputReceipt,
} from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useScheduleActions } from './use-schedule-actions';

const revision = {
  id: 'expert-revision-2',
  expertId: 'expert-1',
  revision: 2,
  name: '经营分析专家',
  summary: '',
  author: '',
  tags: [],
  identity: '完成经营分析',
  principles: [],
  inputRequirements: [],
  deliveryRequirements: [],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' as const },
  modelReference: { mode: 'application-default' as const },
  createdAt: 1,
};

const detail: ScheduleDetail = {
  aggregate: {
    schedule: {
      id: 'schedule-1',
      workspaceId: 'workspace-1',
      revision: 7,
      currentConfigVersion: 4,
      lifecycle: 'paused',
      createdAt: 1,
      updatedAt: 7,
    },
    config: {
      scheduleId: 'schedule-1',
      version: 4,
      name: '月度经营分析',
      expertId: 'expert-1',
      expertRevisionId: 'expert-revision-1',
      requirements: '分析本月经营情况',
      expectedArtifactTypes: ['markdown'],
      timing: {
        frequency: 'monthly',
        day: 5,
        hour: 9,
        minute: 0,
        timeZone: 'Asia/Shanghai',
      },
      periodRule: 'previous-month',
      knowledgeSources: [
        { kind: 'document', documentId: 'document-1', purpose: 'background' },
        { kind: 'collection', collectionId: 'collection-1', purpose: 'historical-comparison' },
      ],
      outputSubdirectory: '定时成果',
      createdAt: 4,
    },
  },
  expertUpdate: {
    boundRevision: { ...revision, id: 'expert-revision-1', revision: 1 },
    currentRevision: revision,
    available: true,
  },
  history: { items: [] },
};

const success = <Value,>(data: Value): ScheduleCallResult<Value> => ({ status: 'success', data });

const period = {
  rule: 'previous-month' as const,
  timeZone: 'Asia/Shanghai' as const,
  anchorAt: 10,
  startAt: 1,
  endAt: 9,
  label: '2026 年 8 月',
};

const manualResult = (occurrenceId = 'occurrence-manual'): ScheduleManualExecutionResult => ({
  accepted: true,
  duplicate: false,
  occurrence: {
    id: occurrenceId,
    scheduleId: 'schedule-1',
    configVersion: 4,
    trigger: 'manual-now',
    requestKey: 'request-key-1',
    period,
    phase: 'preparing',
    createdAt: 20,
    requestedAt: 20,
  },
});

const receipt: ScheduleOutputReceipt = {
  id: 'receipt-exact',
  occurrenceId: 'occurrence-1',
  artifactVersionId: 'artifact-version-1',
  workspaceId: 'workspace-1',
  relativePath: '定时成果/2026-08-经营分析.md',
  contentHash: 'a'.repeat(64),
  status: 'failed',
  attempt: 3,
  failureCode: 'schedule_output_save_failed',
  failureDetail: '目标目录暂不可写',
  createdAt: 1,
  updatedAt: 2,
};

const installApi = (overrides: Partial<Window['betterwork']['schedules']> = {}) => {
  const preflight = vi.fn<Window['betterwork']['schedules']['preflight']>(async () =>
    success({ status: 'ready' as const, fingerprint: 'preflight-current', problems: [] }),
  );
  const executeNow = vi.fn<Window['betterwork']['schedules']['executeNow']>(async () =>
    success(manualResult()),
  );
  const executeMissed = vi.fn<Window['betterwork']['schedules']['executeMissed']>(async () =>
    success(manualResult('occurrence-replay')),
  );
  const cancelOccurrence = vi.fn<Window['betterwork']['schedules']['cancelOccurrence']>(async () =>
    success({ result: 'cancel-requested' as const }),
  );
  const setLifecycle = vi.fn<Window['betterwork']['schedules']['setLifecycle']>(async () =>
    success({ schedule: detail.aggregate.schedule, config: detail.aggregate.config }),
  );
  const retryOutput = vi.fn<Window['betterwork']['schedules']['retryOutput']>(async () =>
    success(receipt),
  );
  const applyExpertRevision = vi.fn<Window['betterwork']['schedules']['applyExpertRevision']>(
    async () => success({ schedule: detail.aggregate.schedule, config: detail.aggregate.config }),
  );
  const schedules = {
    preflight,
    executeNow,
    executeMissed,
    cancelOccurrence,
    setLifecycle,
    retryOutput,
    applyExpertRevision,
    ...overrides,
  };
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      schedules,
    },
  });
  return schedules;
};

const deferred = <Value,>() => {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
  vi.restoreAllMocks();
});

describe('useScheduleActions', () => {
  it('preflights and submits one idempotent now request during rapid repeated activation', async () => {
    const preflightResult =
      deferred<ScheduleCallResult<{ status: 'ready'; fingerprint: string; problems: [] }>>();
    const api = installApi({ preflight: vi.fn(() => preflightResult.promise) });
    const onChanged = vi.fn();
    const onOccurrenceSelected = vi.fn();
    const { result } = renderHook(() =>
      useScheduleActions({ detail, onChanged, onOccurrenceSelected }),
    );

    act(() => {
      result.current.executeNow();
      result.current.executeNow();
    });
    expect(api.preflight).toHaveBeenCalledTimes(1);
    expect(api.executeNow).not.toHaveBeenCalled();

    await act(async () => {
      preflightResult.resolve(
        success({ status: 'ready', fingerprint: 'preflight-current', problems: [] }),
      );
    });
    await waitFor(() => expect(api.executeNow).toHaveBeenCalledTimes(1));
    expect(api.executeNow).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 'schedule-1',
        expectedRevision: 7,
        preflightFingerprint: 'preflight-current',
        requestKey: expect.any(String),
      }),
    );
    await waitFor(() => expect(onOccurrenceSelected).toHaveBeenCalledWith('occurrence-manual'));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('opens the existing busy occurrence without creating another period', async () => {
    const api = installApi({
      executeNow: vi.fn(async () => ({
        status: 'rejected' as const,
        error: {
          code: 'schedule_busy' as const,
          message: '已有正在准备的实例。',
          existingOccurrenceId: 'occurrence-in-progress',
        },
      })),
    });
    const onOccurrenceSelected = vi.fn();
    const { result } = renderHook(() =>
      useScheduleActions({ detail, onChanged: vi.fn(), onOccurrenceSelected }),
    );

    act(() => result.current.executeNow());
    await waitFor(() =>
      expect(onOccurrenceSelected).toHaveBeenCalledWith('occurrence-in-progress'),
    );
    expect(api.executeNow).toHaveBeenCalledTimes(1);
    expect(result.current.toast).toContain('没有创建第二期');
    expect(result.current.error).toBe('');
  });

  it('keeps pause and stop as different actions and only retries the exact receipt attempt', async () => {
    const api = installApi();
    const { result } = renderHook(() =>
      useScheduleActions({ detail, onChanged: vi.fn(), onOccurrenceSelected: vi.fn() }),
    );

    act(() => result.current.setLifecycle('paused'));
    await waitFor(() => expect(api.setLifecycle).toHaveBeenCalledTimes(1));
    expect(api.setLifecycle).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      expectedRevision: 7,
      lifecycle: 'paused',
    });
    expect(api.cancelOccurrence).not.toHaveBeenCalled();

    act(() => result.current.stopOccurrence('occurrence-running'));
    await waitFor(() => expect(api.cancelOccurrence).toHaveBeenCalledTimes(1));
    expect(api.cancelOccurrence).toHaveBeenCalledWith({ occurrenceId: 'occurrence-running' });
    expect(api.setLifecycle).toHaveBeenCalledTimes(1);

    act(() => result.current.retryOutput(receipt));
    await waitFor(() => expect(api.retryOutput).toHaveBeenCalledTimes(1));
    expect(api.retryOutput).toHaveBeenCalledWith({
      receiptId: 'receipt-exact',
      expectedAttempt: 3,
    });
    expect(api.preflight).not.toHaveBeenCalled();
    expect(api.executeNow).not.toHaveBeenCalled();
    expect(api.executeMissed).not.toHaveBeenCalled();
  });

  it('uses only the explicit expert revision and current schedule revision', async () => {
    const api = installApi();
    const { result } = renderHook(() =>
      useScheduleActions({ detail, onChanged: vi.fn(), onOccurrenceSelected: vi.fn() }),
    );

    act(() => result.current.applyExpertRevision('expert-revision-2', 'draft-ready-fingerprint'));
    await waitFor(() => expect(api.applyExpertRevision).toHaveBeenCalledTimes(1));
    expect(api.applyExpertRevision).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      expectedRevision: 7,
      expertRevisionId: 'expert-revision-2',
      preflightFingerprint: 'draft-ready-fingerprint',
    });
    expect(api.preflight).not.toHaveBeenCalled();
  });
});
