// @vitest-environment jsdom

import type {
  ScheduleCallResult,
  ScheduleDetail,
  SchedulePreviewResult,
  WorkspaceSummary,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SchedulesState } from '../hooks/use-schedules';
import { SchedulesPage } from './SchedulesView';

const makeDetail = (id = 'schedule-1', workspaceId = 'workspace-1'): ScheduleDetail => {
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
        id,
        workspaceId,
        revision: 1,
        currentConfigVersion: 1,
        lifecycle: 'paused',
        createdAt: 1,
        updatedAt: 1,
      },
      config: {
        scheduleId: id,
        version: 1,
        name: '月度经营复盘',
        expertId: 'expert-1',
        expertRevisionId: 'revision-1',
        requirements: '分析上月经营数据。',
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
        createdAt: 1,
      },
    },
    expertUpdate: { boundRevision: revision, currentRevision: revision, available: false },
    history: { items: [] },
  };
};

const workspace = (id: string, name: string): WorkspaceSummary => ({
  id,
  name,
  rootPath: `/tmp/${id}`,
  iconId: 'folder',
  accentId: 'moss',
  createdAt: 1,
  updatedAt: 1,
});

const stateOf = (overrides: Partial<SchedulesState> = {}): SchedulesState => ({
  details: [],
  loading: false,
  refreshing: false,
  error: '',
  refreshError: '',
  refresh: vi.fn(),
  ...overrides,
});

const pageProps = {
  workspaces: [] as WorkspaceSummary[],
  experts: [],
  expertsLoading: false,
  expertsError: '',
  getExpert: async () => null,
  onOpenTask: async () => undefined,
  onOpenArtifactVersion: async () => undefined,
  onOpenSource: async () => undefined,
};

afterEach(() => cleanup());

describe('SchedulesPage', () => {
  it('keeps the real page skeleton and toolbar during first load', () => {
    render(<SchedulesPage state={stateOf({ loading: true })} {...pageProps} />);
    expect(screen.getByRole('heading', { name: '按约定时间开始工作' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '定时任务列表' })).toBeTruthy();
    expect(screen.getByRole('toolbar', { name: '定时任务筛选' })).toBeTruthy();
    expect(screen.getByText('正在读取定时任务…')).toBeTruthy();
  });

  it('uses a first-read error with an actionable retry while retaining the page skeleton', () => {
    const retry = vi.fn();
    render(
      <SchedulesPage state={stateOf({ error: '临时读取失败', refresh: retry })} {...pageProps} />,
    );
    expect(screen.getByRole('heading', { name: '按约定时间开始工作' })).toBeTruthy();
    expect(screen.getByText('暂时无法读取定时任务')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a genuinely empty list from a workspace filter with no matches', async () => {
    const empty = render(<SchedulesPage state={stateOf()} {...pageProps} />);
    expect(screen.getByText('尚无定时任务')).toBeTruthy();
    empty.unmount();

    render(
      <SchedulesPage
        state={stateOf({ details: [makeDetail('schedule-1', 'workspace-1')] })}
        {...pageProps}
        workspaces={[workspace('workspace-1', '财务'), workspace('workspace-2', '研究')]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '按工作空间筛选' }));
    const menu = screen.getByRole('menu', { name: '按工作空间筛选' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: '研究' }));
    await waitFor(() => expect(screen.getByText('这个工作空间下没有定时任务')).toBeTruthy());
  });

  it('shows workspace, expert revision, recurrence, period and current status without making the row a button', () => {
    render(
      <SchedulesPage
        state={stateOf({ details: [makeDetail()] })}
        {...pageProps}
        workspaces={[workspace('workspace-1', '财务分析')]}
      />,
    );
    expect(screen.getByText('执行专家：经营分析专家 · 工作空间：财务分析')).toBeTruthy();
    expect(screen.getByText(/每月 5 日 09:00 · 北京时间/)).toBeTruthy();
    expect(screen.getByText(/统计范围：上一自然月/)).toBeTruthy();
    expect(screen.getByText('尚未执行')).toBeTruthy();
    expect(screen.getByText('已暂停')).toBeTruthy();
    const row = screen.getByText('月度经营复盘').closest('.list-row');
    expect(row?.tagName.toLowerCase()).toBe('article');
    expect(within(row as HTMLElement).getByRole('button', { name: '编辑' })).toBeTruthy();
  });

  it('keeps old facts visible with an inline retry when a background refresh fails', () => {
    const retry = vi.fn();
    render(
      <SchedulesPage
        state={stateOf({
          details: [makeDetail()],
          refreshError: '暂时无法刷新',
          refresh: retry,
        })}
        {...pageProps}
        workspaces={[workspace('workspace-1', '财务分析')]}
      />,
    );
    expect(screen.getByText('月度经营复盘')).toBeTruthy();
    expect(screen.getByText('暂时无法刷新')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('opens the full-page editor from create and row edit actions, then returns to the list', () => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        knowledge: {
          list: vi.fn(async () => []),
          listCollections: vi.fn(async () => []),
        },
        schedules: {
          preview: vi.fn(async (): Promise<ScheduleCallResult<SchedulePreviewResult>> => ({
            status: 'success',
            data: {
              previewedAt: 1,
              items: [],
            },
          })),
        },
      },
    });
    const state = stateOf({ details: [makeDetail()] });
    const props = {
      ...pageProps,
      workspaces: [workspace('workspace-1', '财务分析')],
    };
    render(<SchedulesPage state={state} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '新建定时任务' }));
    expect(screen.getByRole('heading', { name: '新建定时任务' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
    expect(screen.getByRole('heading', { name: '按约定时间开始工作' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.getByRole('heading', { name: '编辑定时任务' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '固定的执行专家' })).toBeTruthy();
  });

  it('opens the rule detail as a full page and returns without making the list row a button', () => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: { schedules: { onChange: vi.fn(() => () => undefined) } },
    });
    render(<SchedulesPage state={stateOf({ details: [makeDetail()] })} {...pageProps} />);
    fireEvent.click(screen.getByRole('button', { name: '详情' }));

    expect(screen.getByRole('heading', { name: '月度经营复盘' })).toBeTruthy();
    expect(screen.getByRole('region', { name: '定时任务详情' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
    expect(screen.getByRole('heading', { name: '按约定时间开始工作' })).toBeTruthy();
  });
});
