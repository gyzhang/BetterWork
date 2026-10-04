// @vitest-environment jsdom

import type {
  ExpertDetail,
  PreviewScheduleRequest,
  ScheduleAggregate,
  ScheduleCallResult,
  ScheduleDetail,
  SchedulePreflightView,
  SchedulePreviewResult,
} from '@betterwork/agent-protocol';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useScheduleEditor } from './use-schedule-editor';

const revision = {
  id: 'revision-1',
  expertId: 'expert-1',
  revision: 1,
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

const aggregate: ScheduleAggregate = {
  schedule: {
    id: 'schedule-1',
    workspaceId: 'workspace-1',
    revision: 4,
    currentConfigVersion: 2,
    lifecycle: 'enabled',
    capabilityFingerprint: 'existing-capability-fingerprint',
    createdAt: 1,
    updatedAt: 2,
  },
  config: {
    scheduleId: 'schedule-1',
    version: 2,
    name: '月报',
    expertId: 'expert-1',
    expertRevisionId: 'revision-1',
    requirements: '分析上月经营数据。',
    expectedArtifactTypes: ['presentation'],
    timing: {
      frequency: 'monthly',
      day: 5,
      hour: 9,
      minute: 0,
      timeZone: 'Asia/Shanghai',
    },
    periodRule: 'previous-month',
    knowledgeSources: [],
    outputSubdirectory: '定时成果',
    createdAt: 1,
  },
};

const detail: ScheduleDetail = {
  aggregate,
  expertUpdate: { boundRevision: revision, currentRevision: revision, available: false },
  history: { items: [] },
};

const previewResult = (scheduledAt: number): SchedulePreviewResult => ({
  previewedAt: 1,
  items: [scheduledAt, scheduledAt + 1, scheduledAt + 2].map((at) => ({
    scheduledAt: at,
    period: {
      rule: 'previous-month',
      timeZone: 'Asia/Shanghai',
      anchorAt: at,
      startAt: at - 2,
      endAt: at - 1,
      label: '上一自然月',
    },
  })),
});

const readyPreflight: SchedulePreflightView = {
  status: 'ready',
  fingerprint: 'preflight-v1',
  problems: [],
};

const activeExpert: ExpertDetail = {
  id: 'expert-1',
  sourceKind: 'user',
  lifecycle: 'active',
  name: '经营分析专家',
  summary: '',
  author: '',
  tags: [],
  currentRevision: 1,
  blockedReasons: [],
  createdAt: 1,
  updatedAt: 1,
  revision,
};

const installApi = (
  overrides: {
    preview?: Window['betterwork']['schedules']['preview'];
    preflight?: Window['betterwork']['schedules']['preflight'];
    save?: Window['betterwork']['schedules']['save'];
  } = {},
): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      schedules: {
        preview:
          overrides.preview ??
          vi.fn(async (): Promise<ScheduleCallResult<SchedulePreviewResult>> => ({
            status: 'success',
            data: previewResult(10),
          })),
        preflight:
          overrides.preflight ??
          vi.fn(async (): Promise<ScheduleCallResult<SchedulePreflightView>> => ({
            status: 'success',
            data: readyPreflight,
          })),
        save:
          overrides.save ??
          vi.fn(async (): Promise<ScheduleCallResult<ScheduleAggregate>> => ({
            status: 'success',
            data: aggregate,
          })),
      },
    },
  });
};

const renderEditor = (
  options: {
    detail?: ScheduleDetail;
    onSaved?: (lifecycle: 'enabled' | 'paused') => void;
  } = {},
) =>
  renderHook(() =>
    useScheduleEditor({
      ...(options.detail ? { detail: options.detail } : {}),
      experts: [],
      getExpert: async () => activeExpert,
      onSaved: options.onSaved ?? vi.fn(),
    }),
  );

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useScheduleEditor', () => {
  it('does not preview an invalid time and discards a late preview after fast edits', async () => {
    vi.useFakeTimers();
    const responses: Array<(result: ScheduleCallResult<SchedulePreviewResult>) => void> = [];
    const previewInputs: PreviewScheduleRequest[] = [];
    const preview = vi.fn(
      (input: PreviewScheduleRequest): Promise<ScheduleCallResult<SchedulePreviewResult>> => {
        previewInputs.push(input);
        return new Promise((resolve) => responses.push(resolve));
      },
    );
    installApi({ preview });
    const { result } = renderEditor();

    act(() => result.current.setTimeInput('25:00'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(preview).not.toHaveBeenCalled();

    act(() => result.current.setTimeInput('09:00'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(preview).toHaveBeenCalledTimes(1);
    act(() => result.current.setTimeInput('10:00'));
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(preview).toHaveBeenCalledTimes(2);
    expect(previewInputs[0]?.timing.hour).toBe(9);
    expect(previewInputs[1]?.timing.hour).toBe(10);

    await act(async () => {
      responses[0]?.({ status: 'success', data: previewResult(20) });
      await Promise.resolve();
    });
    expect(result.current.preview).toBeUndefined();
    await act(async () => {
      responses[1]?.({ status: 'success', data: previewResult(30) });
      await Promise.resolve();
    });
    expect(result.current.preview?.items[0]?.scheduledAt).toBe(30);
  });

  it('blocks activation when preflight reports a problem and leaves the editable draft intact', async () => {
    const blocked: SchedulePreflightView = {
      status: 'blocked',
      fingerprint: 'blocked-v1',
      problems: [{ code: 'model-unavailable', message: '专家模型尚未配置。' }],
    };
    const preflight = vi.fn(async (): Promise<ScheduleCallResult<SchedulePreflightView>> => ({
      status: 'success',
      data: blocked,
    }));
    const save = vi.fn(async (): Promise<ScheduleCallResult<ScheduleAggregate>> => ({
      status: 'success',
      data: aggregate,
    }));
    installApi({ preflight, save });
    const { result } = renderEditor();
    act(() => {
      result.current.setWorkspaceId('workspace-1');
      result.current.updateConfig((config) => ({
        ...config,
        name: '每月经营分析',
        expertId: 'expert-1',
        expertRevisionId: 'revision-1',
        requirements: '分析并比较本期数据。',
      }));
    });

    act(() => result.current.save('enabled'));
    await waitFor(() => expect(result.current.saveError).toContain('启用前检查未通过'));
    expect(result.current.preflight?.problems[0]?.message).toBe('专家模型尚未配置。');
    expect(result.current.value.config.name).toBe('每月经营分析');
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps an update draft after a compare-and-swap conflict', async () => {
    const save = vi.fn(async (): Promise<ScheduleCallResult<ScheduleAggregate>> => ({
      status: 'rejected',
      error: { code: 'schedule_conflict', message: '规则已被其他窗口更新。', currentRevision: 5 },
    }));
    const preflight = vi.fn(async (): Promise<ScheduleCallResult<SchedulePreflightView>> => ({
      status: 'success',
      data: readyPreflight,
    }));
    const onSaved = vi.fn();
    installApi({ save, preflight });
    const { result } = renderEditor({ detail, onSaved });
    act(() => {
      result.current.updateConfig((config) => ({
        ...config,
        name: '保留我的修改',
        requirements: '保留新要求。',
      }));
    });

    act(() => result.current.save('enabled'));
    await waitFor(() => expect(result.current.saveError).toContain('当前输入已保留'));
    expect(result.current.value.config.name).toBe('保留我的修改');
    expect(result.current.dirty).toBe(true);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'update',
        scheduleId: 'schedule-1',
        expectedRevision: 4,
        config: expect.objectContaining({
          name: '保留我的修改',
          requirements: '保留新要求。',
        }),
      }),
    );
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('does not preflight an enabled schedule when only its name changes', async () => {
    const save = vi.fn(async (): Promise<ScheduleCallResult<ScheduleAggregate>> => ({
      status: 'success',
      data: aggregate,
    }));
    const preflight = vi.fn(async (): Promise<ScheduleCallResult<SchedulePreflightView>> => ({
      status: 'success',
      data: readyPreflight,
    }));
    const onSaved = vi.fn();
    installApi({ preflight, save });
    const { result } = renderEditor({ detail, onSaved });
    act(() => {
      result.current.updateConfig((config) => ({ ...config, name: '仅修改名称' }));
    });

    act(() => result.current.save('enabled'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('enabled'));
    expect(preflight).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ preflightFingerprint: 'existing-capability-fingerprint' }),
    );
  });

  it('saves paused rules without running an activation preflight', async () => {
    const preflight = vi.fn();
    const save = vi.fn(async (): Promise<ScheduleCallResult<ScheduleAggregate>> => ({
      status: 'success',
      data: aggregate,
    }));
    const onSaved = vi.fn();
    installApi({ preflight, save });
    const { result } = renderEditor({ onSaved });
    act(() => {
      result.current.setWorkspaceId('workspace-1');
      result.current.updateConfig((config) => ({
        ...config,
        name: '每月经营分析',
        expertId: 'expert-1',
        expertRevisionId: 'revision-1',
        requirements: '分析本期经营数据。',
      }));
    });

    act(() => result.current.save('paused'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('paused'));
    expect(preflight).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'create', targetLifecycle: 'paused' }),
    );
  });
});
