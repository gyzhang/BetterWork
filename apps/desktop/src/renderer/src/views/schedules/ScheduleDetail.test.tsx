// @vitest-environment jsdom

import type {
  EvidenceSummary,
  ScheduleCallResult,
  ScheduleDetail,
  ScheduleOccurrenceDetail,
  ScheduleOccurrenceHistoryItem,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScheduleDetailPage } from './ScheduleDetail';

const makePageData = (
  missed = false,
  expertUpdateAvailable = false,
): {
  detail: ScheduleDetail;
  occurrence: ScheduleOccurrenceDetail;
} => {
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
  const baseConfig = {
    scheduleId: 'schedule-1',
    version: 4,
    name: '最新规则名称',
    expertId: 'expert-1',
    expertRevisionId: 'revision-1',
    requirements: '当前周期工作要求',
    expectedArtifactTypes: ['markdown' as const],
    timing: {
      frequency: 'monthly' as const,
      day: 5,
      hour: 9,
      minute: 0,
      timeZone: 'Asia/Shanghai' as const,
    },
    periodRule: 'previous-month' as const,
    knowledgeSources: [
      { kind: 'document' as const, documentId: 'policy-doc', purpose: 'rule' as const },
      {
        kind: 'collection' as const,
        collectionId: 'finance-history',
        purpose: 'historical-comparison' as const,
      },
    ],
    outputSubdirectory: '定时成果' as const,
    createdAt: 4,
  };
  const occurrence: ScheduleOccurrenceHistoryItem['occurrence'] = missed
    ? {
        id: 'occurrence-missed',
        scheduleId: 'schedule-1',
        configVersion: 2,
        trigger: 'scheduled',
        scheduledAt: 10,
        period: {
          rule: 'previous-month',
          timeZone: 'Asia/Shanghai',
          anchorAt: 10,
          startAt: 1,
          endAt: 9,
          label: '2026 年 8 月',
        },
        phase: 'closed',
        preparationOutcome: 'missed',
        createdAt: 10,
        requestedAt: 10,
        finishedAt: 10,
      }
    : {
        id: 'occurrence-generated',
        scheduleId: 'schedule-1',
        configVersion: 2,
        trigger: 'scheduled',
        scheduledAt: 10,
        period: {
          rule: 'previous-month',
          timeZone: 'Asia/Shanghai',
          anchorAt: 10,
          startAt: 1,
          endAt: 9,
          label: '2026 年 8 月',
        },
        phase: 'closed',
        taskId: 'task-1',
        sessionId: 'session-1',
        firstRunId: 'run-1',
        sourceSnapshotId: 'snapshot-1',
        createdAt: 10,
        requestedAt: 10,
        preparedAt: 11,
        finishedAt: 20,
      };
  const run = missed
    ? undefined
    : {
        id: 'run-1',
        taskId: 'task-1',
        sessionId: 'session-1',
        prompt: '完成 2026 年 8 月复盘',
        status: 'completed' as const,
        createdAt: 12,
        completedAt: 20,
      };
  const receipt = missed
    ? undefined
    : {
        id: 'receipt-1',
        occurrenceId: occurrence.id,
        artifactVersionId: 'artifact-version-exact',
        workspaceId: 'workspace-1',
        relativePath: '定时成果/2026-08-经营复盘.md',
        contentHash: 'a'.repeat(64),
        status: 'failed' as const,
        attempt: 1,
        failureCode: 'schedule_output_save_failed' as const,
        failureDetail: '目录当前不可写',
        createdAt: 20,
        updatedAt: 21,
      };
  const result = {
    occurrence,
    status: missed
      ? ('missed' as const)
      : receipt
        ? ('save-failed' as const)
        : ('generated' as const),
    outputReceipts: receipt ? [receipt] : [],
    ...(run ? { run } : {}),
  };
  const historyItem: ScheduleOccurrenceHistoryItem = {
    occurrence,
    result,
    ...(run ? { run } : {}),
  };
  const config = {
    ...baseConfig,
    version: 2,
    name: '历史固定规则',
    requirements: '本期不可热换的历史固定要求',
    createdAt: 2,
  };
  const detail: ScheduleDetail = {
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
      config: baseConfig,
    },
    expertUpdate: {
      boundRevision: revision,
      currentRevision: expertUpdateAvailable
        ? { ...revision, id: 'revision-2', revision: 2, identity: '比较季度趋势并解释差异' }
        : revision,
      available: expertUpdateAvailable,
    },
    history: { items: [historyItem] },
  };
  const occurrenceDetail: ScheduleOccurrenceDetail = {
    occurrence,
    result,
    config,
    ...(run
      ? {
          task: {
            id: 'task-1',
            workspaceId: 'workspace-1',
            title: '2026 年 8 月经营复盘',
            goal: '完成本期复盘',
            createdAt: 11,
            updatedAt: 20,
          },
          run,
          sourceSnapshot: {
            id: 'snapshot-1',
            occurrenceId: occurrence.id,
            workspaceId: 'workspace-1',
            status: 'ready' as const,
            configVersion: 2,
            evaluatedAt: 10,
            manifestHash: 'b'.repeat(64),
            itemCount: 1,
            totalFileBytes: 128,
            createdAt: 10,
            completedAt: 11,
          },
        }
      : {}),
    outputReceipts: receipt ? [receipt] : [],
    readMaterialCount: 3,
    adoptedMaterialCount: 1,
  };
  return { detail, occurrence: occurrenceDetail };
};

const evidence: EvidenceSummary = {
  id: 'evidence-1',
  taskId: 'task-1',
  runId: 'run-1',
  sourceType: 'local-file',
  sourceUri: '/tmp/合成资料/经营摘要.md',
  title: '本期经营摘要',
  locator: '第 1 节',
  excerpt: '合成内容',
  contentHash: 'c'.repeat(64),
  capturedAt: 15,
};

const success = <Value,>(data: Value): ScheduleCallResult<Value> => ({ status: 'success', data });

const installApi = (
  occurrence: ScheduleOccurrenceDetail,
  overrides: Partial<Window['betterwork']['schedules']> = {},
) => {
  const getOccurrence = vi.fn(async () => success(occurrence));
  const aggregate = {
    schedule: {
      id: 'schedule-1',
      workspaceId: 'workspace-1',
      revision: 4,
      currentConfigVersion: 4,
      lifecycle: 'paused' as const,
      createdAt: 1,
      updatedAt: 4,
    },
    config: occurrence.config,
  };
  const manualOccurrence = {
    id: 'occurrence-manual-new',
    scheduleId: 'schedule-1',
    configVersion: 4,
    trigger: 'manual-now' as const,
    requestKey: 'manual-request-key',
    period: {
      rule: 'previous-month' as const,
      timeZone: 'Asia/Shanghai' as const,
      anchorAt: 20,
      startAt: 1,
      endAt: 19,
      label: '2026 年 9 月',
    },
    phase: 'preparing' as const,
    createdAt: 20,
    requestedAt: 20,
  };
  const missedManualOccurrence = {
    ...manualOccurrence,
    trigger: 'manual-missed' as const,
    originalOccurrenceId: occurrence.occurrence.id,
    period: occurrence.occurrence.period,
  };
  const schedules = {
    onChange: vi.fn(() => () => undefined),
    getOccurrence,
    listSourceItems: vi.fn(async () =>
      success({
        items: [
          {
            snapshotId: 'snapshot-1',
            ordinal: 0,
            reference: {
              kind: 'workspace-input-snapshot' as const,
              snapshotId: 'input-1',
              workspaceId: 'workspace-1',
              contentHash: 'd'.repeat(64),
              format: 'markdown' as const,
              fileKey: 'file-1',
            },
            purpose: 'current-input' as const,
            origin: 'selected-document' as const,
            displayName: '本期候选.md',
          },
        ],
      }),
    ),
    listOccurrences: vi.fn(async () => success({ items: [] })),
    preflight: vi.fn(async () =>
      success({ status: 'ready' as const, fingerprint: 'preflight-ui-current', problems: [] }),
    ),
    executeNow: vi.fn(async () =>
      success({ accepted: true as const, duplicate: false, occurrence: manualOccurrence }),
    ),
    executeMissed: vi.fn(async () =>
      success({ accepted: true as const, duplicate: false, occurrence: missedManualOccurrence }),
    ),
    setLifecycle: vi.fn(async () => success(aggregate)),
    cancelOccurrence: vi.fn(async () => success({ result: 'cancelled-preparation' as const })),
    retryOutput: vi.fn(async () =>
      success(
        occurrence.outputReceipts[0] ?? {
          id: 'receipt-1',
          occurrenceId: occurrence.occurrence.id,
          artifactVersionId: 'artifact-version-exact',
          workspaceId: 'workspace-1',
          relativePath: '定时成果/2026-08-经营复盘.md',
          contentHash: 'a'.repeat(64),
          status: 'saved' as const,
          attempt: 2,
          createdAt: 20,
          updatedAt: 22,
        },
      ),
    ),
    applyExpertRevision: vi.fn(async () => success(aggregate)),
    ...overrides,
  };
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      schedules,
      evidence: { list: vi.fn(async () => [evidence]) },
    },
  });
  return { getOccurrence, schedules };
};

const commonProps = {
  workspaceName: '经营工作空间',
  onBack: vi.fn(),
  onEdit: vi.fn(),
  onScheduleChanged: vi.fn(),
  onOpenTask: vi.fn(async () => undefined),
  onOpenArtifactVersion: vi.fn(async () => undefined),
  onOpenSource: vi.fn(async () => undefined),
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'betterwork');
});

describe('ScheduleDetailPage', () => {
  it('keeps missed periods explicit and shows historical period/config without creating a Run row', async () => {
    const { detail, occurrence } = makePageData(true);
    installApi(occurrence);
    render(<ScheduleDetailPage detail={detail} {...commonProps} />);

    expect(await screen.findByText(/2026 年 8 月 · 配置版本 v2/)).toBeTruthy();
    expect(screen.getByText('本期不可热换的历史固定要求')).toBeTruthy();
    expect(screen.getByText(/错过时没有创建 Task 或 Run；不会自动补跑/)).toBeTruthy();
    expect(screen.queryByText('等待开始')).toBeNull();
    expect(screen.queryByRole('button', { name: /打开本期原 Task/ })).toBeNull();
  });

  it('separates candidate scope, Run Evidence, and exact artifact version actions', async () => {
    const { detail, occurrence } = makePageData();
    const api = installApi(occurrence);
    const props = {
      ...commonProps,
      onOpenArtifactVersion: vi.fn(async () => undefined),
      onOpenTask: vi.fn(async () => undefined),
    };
    render(<ScheduleDetailPage detail={detail} {...props} />);

    expect(await screen.findByText('2026 年 8 月经营复盘')).toBeTruthy();
    expect(screen.getByText('本期候选.md')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /打开原 Task/ }));
    await waitFor(() => expect(props.onOpenTask).toHaveBeenCalledWith('task-1', occurrence));
    fireEvent.click(screen.getByText(/Run 实际读取证据/));
    expect(screen.getByText(/读取材料计数 3 · 采用材料计数 1/)).toBeTruthy();
    expect(screen.getByText('本期经营摘要')).toBeTruthy();
    const receiptRow = screen.getByText(/定时成果\/2026-08-经营复盘\.md/).closest('.list-row');
    if (!(receiptRow instanceof HTMLElement)) throw new Error('没有找到成果回执行');
    fireEvent.click(within(receiptRow).getByRole('button', { name: '打开此成果版本' }));
    await waitFor(() =>
      expect(props.onOpenArtifactVersion).toHaveBeenCalledWith('artifact-version-exact'),
    );
    fireEvent.click(within(receiptRow).getByRole('button', { name: '重试保存' }));
    await waitFor(() => expect(api.schedules.retryOutput).toHaveBeenCalledTimes(1));
    expect(api.schedules.retryOutput).toHaveBeenCalledWith({
      receiptId: 'receipt-1',
      expectedAttempt: 1,
    });
    expect(api.schedules.preflight).not.toHaveBeenCalled();
    expect(api.schedules.executeNow).not.toHaveBeenCalled();
    expect(await screen.findByText(/没有重新调用模型/)).toBeTruthy();
  });

  it('retains old occurrence content when refreshing the detail fails', async () => {
    const { detail, occurrence } = makePageData();
    const api = installApi(occurrence);
    render(<ScheduleDetailPage detail={detail} {...commonProps} />);
    expect(await screen.findByText('本期不可热换的历史固定要求')).toBeTruthy();

    api.getOccurrence.mockRejectedValueOnce(new Error('历史详情暂不可用'));
    fireEvent.click(screen.getByRole('button', { name: '刷新本期' }));
    expect(await screen.findByText('历史详情暂不可用')).toBeTruthy();
    expect(screen.getByText('本期不可热换的历史固定要求')).toBeTruthy();
  });

  it('requires explicit enable confirmation and explains local-only dispatch and review', async () => {
    const { detail, occurrence } = makePageData();
    const api = installApi(occurrence);
    render(<ScheduleDetailPage detail={detail} {...commonProps} />);

    fireEvent.click(screen.getByRole('button', { name: '启用规则' }));
    const dialog = await screen.findByRole('dialog', { name: '启用定时任务' });
    expect(within(dialog).getByText(/只在 BetterWork 本地进程运行时派发/)).toBeTruthy();
    expect(within(dialog).getByText(/可能产生费用/)).toBeTruthy();
    expect(within(dialog).getByText(/错过不会补跑/)).toBeTruthy();
    expect(api.schedules.setLifecycle).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: '确认启用' }));
    await waitFor(() => expect(api.schedules.setLifecycle).toHaveBeenCalledTimes(1));
    expect(api.schedules.preflight).toHaveBeenCalledWith({
      target: 'schedule',
      scheduleId: 'schedule-1',
    });
    expect(api.schedules.setLifecycle).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      expectedRevision: 4,
      lifecycle: 'enabled',
      preflightFingerprint: 'preflight-ui-current',
    });
  });

  it('confirms the original missed period and submits a separate manual occurrence', async () => {
    const { detail, occurrence } = makePageData(true);
    const api = installApi(occurrence);
    render(<ScheduleDetailPage detail={detail} {...commonProps} />);

    await screen.findByText(/2026 年 8 月 · 配置版本 v2/);
    fireEvent.click(screen.getByRole('button', { name: '人工补做此期间' }));
    const dialog = await screen.findByRole('dialog', { name: '人工补做错过期间' });
    expect(within(dialog).getByText(/原期间：2026 年 8 月/)).toBeTruthy();
    expect(within(dialog).getByText(/当前规则与专家绑定/)).toBeTruthy();
    expect(within(dialog).getByText(/原错过记录与当时来源事实保留/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '创建补做期次' }));

    await waitFor(() => expect(api.schedules.executeMissed).toHaveBeenCalledTimes(1));
    expect(api.schedules.executeMissed).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 'schedule-1',
        originalOccurrenceId: 'occurrence-missed',
        expectedRevision: 4,
        preflightFingerprint: 'preflight-ui-current',
        requestKey: expect.any(String),
      }),
    );
    expect(api.schedules.executeNow).not.toHaveBeenCalled();
  });

  it('shows a read-only expert diff, keeps knowledge sources, and targets the displayed revision', async () => {
    const { detail, occurrence } = makePageData(false, true);
    const api = installApi(occurrence);
    render(<ScheduleDetailPage detail={detail} {...commonProps} />);

    fireEvent.click(screen.getByRole('button', { name: '查看专家修订 v2' }));
    const dialog = await screen.findByRole('dialog', { name: /专家修订差异 v1 至 v2/ });
    expect(within(dialog).getByText('人格与职责')).toBeTruthy();
    expect(within(dialog).getByText(/旧版：完成经营分析/)).toBeTruthy();
    expect(within(dialog).getByText(/新版：比较季度趋势并解释差异/)).toBeTruthy();
    await waitFor(() => expect(api.schedules.preflight).toHaveBeenCalledTimes(1));
    expect(api.schedules.preflight).toHaveBeenCalledWith({
      target: 'draft',
      workspaceId: 'workspace-1',
      config: expect.objectContaining({
        expertRevisionId: 'revision-2',
        knowledgeSources: detail.aggregate.config.knowledgeSources,
        outputSubdirectory: '定时成果',
      }),
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '应用并保持暂停' }));

    await waitFor(() => expect(api.schedules.applyExpertRevision).toHaveBeenCalledTimes(1));
    expect(api.schedules.applyExpertRevision).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      expectedRevision: 4,
      expertRevisionId: 'revision-2',
    });
    expect(api.schedules.setLifecycle).not.toHaveBeenCalled();
    expect(await screen.findByText(/专家定义和历史期次未更改/)).toBeTruthy();
  });

  it('keeps the expert target and old schedule details visible after a revision conflict', async () => {
    const { detail, occurrence } = makePageData(false, true);
    const api = installApi(occurrence, {
      applyExpertRevision: vi.fn(async () => ({
        status: 'rejected' as const,
        error: {
          code: 'schedule_conflict' as const,
          message: '规则已被另一窗口修改，请刷新后重试。',
          currentRevision: 5,
        },
      })),
    });
    render(<ScheduleDetailPage detail={detail} {...commonProps} />);

    fireEvent.click(screen.getByRole('button', { name: '查看专家修订 v2' }));
    const dialog = await screen.findByRole('dialog', { name: /专家修订差异 v1 至 v2/ });
    await waitFor(() => expect(api.schedules.preflight).toHaveBeenCalledTimes(1));
    fireEvent.click(within(dialog).getByRole('button', { name: '应用并保持暂停' }));

    expect(await within(dialog).findByText('规则已被另一窗口修改，请刷新后重试。')).toBeTruthy();
    expect(screen.getAllByText('规则已被另一窗口修改，请刷新后重试。')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: /专家修订差异 v1 至 v2/ })).toBeTruthy();
    expect(screen.getByText('本期不可热换的历史固定要求')).toBeTruthy();
    expect(api.schedules.applyExpertRevision).toHaveBeenCalledWith({
      scheduleId: 'schedule-1',
      expectedRevision: 4,
      expertRevisionId: 'revision-2',
    });
  });

  it('blocks an unusable expert revision and lists its preflight problem', async () => {
    const { detail, occurrence } = makePageData(false, true);
    const api = installApi(occurrence, {
      preflight: vi.fn(async () =>
        success({
          status: 'blocked' as const,
          fingerprint: 'blocked-fingerprint',
          problems: [{ code: 'missing-model', message: '当前专家修订没有可用模型。' }],
        }),
      ),
    });
    render(<ScheduleDetailPage detail={detail} {...commonProps} />);

    fireEvent.click(screen.getByRole('button', { name: '查看专家修订 v2' }));
    const dialog = await screen.findByRole('dialog', { name: /专家修订差异 v1 至 v2/ });
    expect(await within(dialog).findByText('当前专家修订没有可用模型。')).toBeTruthy();
    expect(
      within(dialog).getByRole('button', { name: '应用并保持暂停' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(api.schedules.applyExpertRevision).not.toHaveBeenCalled();
  });

  it('archives the rule through its own confirmation while leaving history visible', async () => {
    const { detail, occurrence } = makePageData();
    const api = installApi(occurrence);
    render(<ScheduleDetailPage detail={detail} {...commonProps} />);

    fireEvent.click(screen.getByRole('button', { name: '归档规则' }));
    const dialog = await screen.findByRole('alertdialog', { name: '归档这条定时规则？' });
    expect(within(dialog).getByText(/历史、Task、ArtifactVersion 和保存副本继续保留/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '归档规则' }));
    await waitFor(() =>
      expect(api.schedules.setLifecycle).toHaveBeenCalledWith({
        scheduleId: 'schedule-1',
        expectedRevision: 4,
        lifecycle: 'archived',
      }),
    );
    expect(screen.getByText('本期不可热换的历史固定要求')).toBeTruthy();
  });
});
