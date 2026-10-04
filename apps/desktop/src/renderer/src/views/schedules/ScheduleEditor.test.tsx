// @vitest-environment jsdom

import type {
  ExpertSummary,
  ScheduleCallResult,
  ScheduleDetail,
  SchedulePreflightView,
  SchedulePreviewResult,
  WorkspaceSummary,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScheduleEditor } from './ScheduleEditor';

const workspace: WorkspaceSummary = {
  id: 'workspace-1',
  name: '经营分析',
  rootPath: '/tmp/合成工作空间/经营分析',
  iconId: 'folder',
  accentId: 'moss',
  createdAt: 1,
  updatedAt: 1,
};

const experts: ExpertSummary[] = [
  {
    id: 'expert-1',
    sourceKind: 'user',
    lifecycle: 'active',
    name: '经营分析专家',
    summary: '分析财务材料',
    author: '本地',
    tags: [],
    currentRevision: 3,
    blockedReasons: [],
    createdAt: 1,
    updatedAt: 2,
  },
];

const period: SchedulePreviewResult['items'][number]['period'] = {
  rule: 'previous-month',
  timeZone: 'Asia/Shanghai',
  anchorAt: 10,
  startAt: 1,
  endAt: 9,
  label: '上一自然月',
};

const preview: SchedulePreviewResult = {
  previewedAt: 1,
  items: [10, 20, 30].map((scheduledAt) => ({ scheduledAt, period })),
};

const installApi = (save = vi.fn()): void => {
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
          data: preview,
        })),
        preflight: vi.fn(async (): Promise<ScheduleCallResult<SchedulePreflightView>> => ({
          status: 'success',
          data: { status: 'ready', fingerprint: 'preflight-v1', problems: [] },
        })),
        save: save as Window['betterwork']['schedules']['save'],
      },
    },
  });
};

const renderEditor = (onClose = vi.fn(), save = vi.fn()) => {
  installApi(save);
  return {
    onClose,
    save,
    ...render(
      <ScheduleEditor
        experts={experts}
        expertsLoading={false}
        expertsError=""
        workspaces={[workspace]}
        getExpert={async () => null}
        onClose={onClose}
        onSaved={vi.fn()}
      />,
    ),
  };
};

const inputValue = (label: string): string => {
  const element = screen.getByRole('textbox', { name: label });
  if (!(element instanceof HTMLInputElement)) throw new Error(`${label} 不是单行输入框`);
  return element.value;
};

afterEach(() => cleanup());

describe('ScheduleEditor', () => {
  it('renders four full-page groups with named controls, legal size and hints', async () => {
    renderEditor();
    expect(screen.getByRole('heading', { name: '新建定时任务' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '谁来做，在哪里做' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '每期完成什么' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '何时开始，处理哪个期间' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '保存与启用' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '定时任务名称' }).getAttribute('data-size')).toBe(
      'md',
    );
    expect(screen.getByLabelText('执行时刻').getAttribute('data-size')).toBe('md');
    expect(screen.getByText(/固定当前修订/)).toBeTruthy();
    await waitFor(() =>
      expect(
        within(screen.getByRole('group', { name: '接下来三次计划' })).getAllByText('上一自然月'),
      ).toHaveLength(3),
    );
  });

  it('requires explicit confirmation to discard edits and cancellation never saves', async () => {
    const { onClose, save } = renderEditor();
    fireEvent.change(screen.getByRole('textbox', { name: '定时任务名称' }), {
      target: { value: '周一经营分析' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    const dialog = screen.getByRole('alertdialog', { name: '放弃未保存的配置？' });
    expect(within(dialog).getByText(/定时规则不会被创建或更新/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(inputValue('定时任务名称')).toBe('周一经营分析');

    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the expert revision and workspace fixed while editing an existing rule', () => {
    const detail: ScheduleDetail = {
      aggregate: {
        schedule: {
          id: 'schedule-1',
          workspaceId: 'workspace-1',
          revision: 2,
          currentConfigVersion: 1,
          lifecycle: 'paused',
          createdAt: 1,
          updatedAt: 2,
        },
        config: {
          scheduleId: 'schedule-1',
          version: 1,
          name: '月度经营分析',
          expertId: 'expert-1',
          expertRevisionId: 'revision-2',
          requirements: '分析上一自然月。',
          expectedArtifactTypes: ['presentation'],
          timing: {
            frequency: 'monthly',
            day: 31,
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
      expertUpdate: {
        boundRevision: {
          id: 'revision-2',
          expertId: 'expert-1',
          revision: 2,
          name: '经营分析专家',
          summary: '',
          author: '',
          tags: [],
          identity: '分析经营',
          principles: [],
          inputRequirements: [],
          deliveryRequirements: [],
          skillPreset: [],
          builtinToolPolicy: { mode: 'application-defaults' },
          modelReference: { mode: 'application-default' },
          createdAt: 1,
        },
        currentRevision: {
          id: 'revision-3',
          expertId: 'expert-1',
          revision: 3,
          name: '经营分析专家',
          summary: '',
          author: '',
          tags: [],
          identity: '分析经营',
          principles: [],
          inputRequirements: [],
          deliveryRequirements: [],
          skillPreset: [],
          builtinToolPolicy: { mode: 'application-defaults' },
          modelReference: { mode: 'application-default' },
          createdAt: 2,
        },
        available: true,
      },
      history: { items: [] },
    };
    render(
      <ScheduleEditor
        detail={detail}
        experts={experts}
        expertsLoading={false}
        expertsError=""
        workspaces={[workspace]}
        getExpert={async () => null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(inputValue('固定的执行专家')).toBe('经营分析专家 · 修订 2');
    expect(inputValue('持续工作空间')).toBe('经营分析');
    expect(screen.getByText(/没有该日期的月份会跳过本次计划/)).toBeTruthy();
    expect(screen.getByText(/专家已有新修订/)).toBeTruthy();
    expect(screen.getByText(/没有附加知识范围/)).toBeTruthy();
  });
});
