// @vitest-environment jsdom

import type {
  EvidenceSummary,
  ScheduleCallResult,
  ScheduleDetail,
  ScheduleOccurrenceDetail,
  ScheduleOccurrenceHistoryItem,
  ScheduleSourceItemsPage,
} from '@betterwork/agent-protocol';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useScheduleDetail } from './use-schedule-detail';

const missedHistoryItem = (index: number): ScheduleOccurrenceHistoryItem => {
  const occurrence: ScheduleOccurrenceHistoryItem['occurrence'] = {
    id: `occ-${index}`,
    scheduleId: 'schedule-1',
    configVersion: index === 1 ? 2 : 1,
    trigger: 'scheduled',
    scheduledAt: index,
    period: {
      rule: 'previous-month',
      timeZone: 'Asia/Shanghai',
      anchorAt: index,
      startAt: index - 20,
      endAt: index - 10,
      label: `2026 年第 ${index} 期`,
    },
    phase: 'closed',
    preparationOutcome: 'missed',
    createdAt: index,
    requestedAt: index,
    finishedAt: index,
  };
  return {
    occurrence,
    result: { occurrence, status: 'missed', outputReceipts: [] },
  };
};

const runHistoryItem = (): ScheduleOccurrenceHistoryItem => {
  const occurrence: ScheduleOccurrenceHistoryItem['occurrence'] = {
    id: 'occ-run',
    scheduleId: 'schedule-1',
    configVersion: 2,
    trigger: 'scheduled',
    scheduledAt: 60,
    period: {
      rule: 'previous-month',
      timeZone: 'Asia/Shanghai',
      anchorAt: 60,
      startAt: 40,
      endAt: 50,
      label: '2026 年 9 月',
    },
    phase: 'closed',
    taskId: 'task-1',
    sessionId: 'session-1',
    firstRunId: 'run-1',
    sourceSnapshotId: 'snapshot-1',
    createdAt: 60,
    requestedAt: 60,
    preparedAt: 61,
    finishedAt: 70,
  };
  const run = {
    id: 'run-1',
    taskId: 'task-1',
    sessionId: 'session-1',
    prompt: '完成本期复盘',
    status: 'completed' as const,
    createdAt: 62,
    completedAt: 70,
  };
  return { occurrence, run, result: { occurrence, run, status: 'generated', outputReceipts: [] } };
};

const scheduleDetail = (): ScheduleDetail => {
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
  return {
    aggregate: {
      schedule: {
        id: 'schedule-1',
        workspaceId: 'workspace-1',
        revision: 4,
        currentConfigVersion: 4,
        lifecycle: 'paused',
        createdAt: 1,
        updatedAt: 4,
      },
      config: {
        scheduleId: 'schedule-1',
        version: 4,
        name: '当前规则',
        expertId: 'expert-1',
        expertRevisionId: 'revision-1',
        requirements: '当前要求',
        expectedArtifactTypes: ['markdown'],
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
        createdAt: 4,
      },
    },
    expertUpdate: { boundRevision: revision, currentRevision: revision, available: false },
    history: {
      items: [runHistoryItem(), ...[5, 4, 3, 2, 1].map(missedHistoryItem)],
      nextCursor: { version: 1, createdAt: 1, id: 'occ-1' },
    },
  };
};

const historicalOccurrenceDetail = (): ScheduleOccurrenceDetail => {
  const history = runHistoryItem();
  const occurrence = history.occurrence;
  const result = history.result;
  const run = history.run;
  if (!run) throw new Error('fixture requires a Run');
  return {
    occurrence,
    result,
    config: {
      scheduleId: 'schedule-1',
      version: 2,
      name: '本期固定规则',
      expertId: 'expert-1',
      expertRevisionId: 'revision-1',
      requirements: '2026 年 9 月期间的固定要求',
      expectedArtifactTypes: ['markdown'],
      timing: {
        frequency: 'monthly',
        day: 3,
        hour: 9,
        minute: 0,
        timeZone: 'Asia/Shanghai',
      },
      periodRule: 'previous-month',
      knowledgeSources: [],
      outputSubdirectory: '定时成果',
      createdAt: 2,
    },
    task: {
      id: 'task-1',
      workspaceId: 'workspace-1',
      title: '2026 年 9 月复盘',
      goal: '完成本期复盘',
      createdAt: 61,
      updatedAt: 70,
    },
    run,
    sourceSnapshot: {
      id: 'snapshot-1',
      occurrenceId: occurrence.id,
      workspaceId: 'workspace-1',
      status: 'ready',
      configVersion: 2,
      evaluatedAt: 60,
      manifestHash: 'a'.repeat(64),
      itemCount: 2,
      totalFileBytes: 300,
      createdAt: 60,
      completedAt: 61,
    },
    outputReceipts: [],
    readMaterialCount: 3,
    adoptedMaterialCount: 1,
  };
};

const evidence: EvidenceSummary[] = [
  {
    id: 'evidence-run-1',
    taskId: 'task-1',
    runId: 'run-1',
    sourceType: 'local-file',
    sourceUri: '/tmp/合成资料/九月经营摘要.md',
    title: '九月经营摘要',
    locator: '第 1 节',
    excerpt: '合成测试资料',
    contentHash: 'e'.repeat(64),
    capturedAt: 65,
  },
  {
    id: 'evidence-other-run',
    taskId: 'task-1',
    runId: 'run-old',
    sourceType: 'local-file',
    sourceUri: '/tmp/合成资料/旧期.md',
    title: '旧期资料',
    locator: '第 2 节',
    excerpt: '不属于本期 Run',
    contentHash: 'f'.repeat(64),
    capturedAt: 35,
  },
];

const success = <Value,>(data: Value): ScheduleCallResult<Value> => ({ status: 'success', data });

const installApi = () => {
  const occurrenceDetail = historicalOccurrenceDetail();
  const sourcePageOne: ScheduleSourceItemsPage = {
    items: [
      {
        snapshotId: 'snapshot-1',
        ordinal: 0,
        reference: {
          kind: 'workspace-input-snapshot',
          snapshotId: 'input-1',
          workspaceId: 'workspace-1',
          contentHash: '1'.repeat(64),
          format: 'markdown',
          fileKey: 'file-1',
        },
        purpose: 'current-input',
        origin: 'workspace-directory',
        displayName: '经营摘要.md',
      },
    ],
    nextCursor: { version: 1, snapshotId: 'snapshot-1', ordinal: 0 },
  };
  const sourcePageTwo: ScheduleSourceItemsPage = {
    items: [
      {
        snapshotId: 'snapshot-1',
        ordinal: 1,
        reference: {
          kind: 'workspace-input-snapshot',
          snapshotId: 'input-2',
          workspaceId: 'workspace-1',
          contentHash: '2'.repeat(64),
          format: 'markdown',
          fileKey: 'file-2',
        },
        purpose: 'background',
        origin: 'workspace-directory',
        displayName: '组织背景.md',
      },
    ],
  };
  const listSourceItems = vi.fn(
    async ({
      cursor,
    }: {
      cursor?: { ordinal: number };
    }): Promise<ScheduleCallResult<ScheduleSourceItemsPage>> =>
      success(cursor ? sourcePageTwo : sourcePageOne),
  );
  const getOccurrence = vi.fn(async (): Promise<ScheduleCallResult<ScheduleOccurrenceDetail>> =>
    success(occurrenceDetail),
  );
  const listOccurrences = vi.fn(async () => success({ items: [missedHistoryItem(0)] }));
  const evidenceList = vi.fn(async () => evidence);
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      schedules: {
        onChange: vi.fn(() => () => undefined),
        getOccurrence,
        listSourceItems,
        listOccurrences,
      },
      evidence: { list: evidenceList },
    },
  });
  return { getOccurrence, listSourceItems, listOccurrences, evidenceList };
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'betterwork');
});

describe('useScheduleDetail', () => {
  it('loads all source pages and only the selected occurrence Run evidence', async () => {
    const api = installApi();
    const detail = scheduleDetail();
    const { result } = renderHook(({ value }) => useScheduleDetail(value), {
      initialProps: { value: detail },
    });

    await waitFor(() => expect(result.current.sourceItems).toHaveLength(2));
    await waitFor(() => expect(result.current.evidence).toHaveLength(1));
    expect(result.current.evidence[0]?.id).toBe('evidence-run-1');
    expect(api.listSourceItems).toHaveBeenCalledTimes(2);
    expect(api.evidenceList).toHaveBeenCalledWith({ taskId: 'task-1' });
    expect(result.current.occurrence?.config.version).toBe(2);
    expect(result.current.occurrence?.occurrence.period.label).toBe('2026 年 9 月');
  });

  it('paginates beyond the first six history items without dropping old pages', async () => {
    const api = installApi();
    const detail = scheduleDetail();
    const { result } = renderHook(({ value }) => useScheduleDetail(value), {
      initialProps: { value: detail },
    });
    expect(result.current.historyItems).toHaveLength(6);

    act(() => result.current.loadMoreHistory());
    await waitFor(() => expect(result.current.historyItems).toHaveLength(7));
    expect(api.listOccurrences).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      cursor: { version: 1, createdAt: 1, id: 'occ-1' },
      limit: 50,
    });
  });

  it('retains the displayed occurrence and source list when refreshes fail', async () => {
    const api = installApi();
    const detail = scheduleDetail();
    const { result } = renderHook(({ value }) => useScheduleDetail(value), {
      initialProps: { value: detail },
    });
    await waitFor(() => expect(result.current.sourceItems).toHaveLength(2));
    const displayed = result.current.occurrence;
    expect(displayed).toBeDefined();

    api.getOccurrence.mockRejectedValueOnce(new Error('详情刷新失败'));
    act(() => result.current.refreshOccurrence());
    await waitFor(() => expect(result.current.occurrenceError).toBe('详情刷新失败'));
    expect(result.current.occurrence).toBe(displayed);

    api.listSourceItems.mockRejectedValueOnce(new Error('来源刷新失败'));
    act(() => result.current.refreshSources());
    await waitFor(() => expect(result.current.sourceError).toBe('来源刷新失败'));
    expect(result.current.sourceItems).toHaveLength(2);
  });
});
