// @vitest-environment jsdom

import type {
  MemoryJobSummary,
  MemoryViewItem,
  WorkspaceMemorySettings,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MemorySuggestionsState } from '../hooks/use-memory-suggestions';
import { MemorySuggestionList } from './MemorySuggestionList';

/**
 * 经验建议批次界面（WM11，产品设计 §3.3、§3.4）。
 *
 * 断言盯住四条容易走样的地方：开启开关前必须先看到代价与同意版本；
 * 「本轮 0 条」是成功结果而不是错误；逐条候选的处理不再叠一层全局提示；
 * 取消与重新提炼都只针对被点的那一个作业。
 */

const HASH = 'a'.repeat(64);

const job = (overrides: Partial<MemoryJobSummary>): MemoryJobSummary => ({
  id: 'job-1',
  workspaceId: 'workspace-1',
  taskId: 'task-1',
  source: { kind: 'run', runId: 'run-1' },
  status: 'running',
  revision: 1,
  attempt: 1,
  trigger: 'automatic',
  candidateCount: 0,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const candidateItem = (content: string): MemoryViewItem => ({
  id: 'memory-1',
  revisionId: 'memory-1-r1',
  revision: 1,
  scope: { kind: 'workspace', workspaceId: 'workspace-1' },
  kind: 'procedural',
  content,
  sourceType: 'conversation',
  confidence: 0.8,
  status: 'candidate',
  contentHash: HASH,
  createdAt: 1,
  updatedAt: 1,
  facet: 'method',
  normalizedHash: HASH,
  provenance: {
    schemaVersion: 1,
    verification: 'verified',
    authority: 'derived',
    capturedAt: 1,
    sources: [
      {
        kind: 'run-assistant',
        runId: 'run-1',
        eventId: 'event-1',
        contentHash: HASH,
        start: 0,
        end: 9,
        excerpt: content,
        excerptHash: HASH,
      },
    ],
    materialDependencies: [],
    memoryDependencies: [],
  },
  candidateDisposition: 'pending',
  effectiveStatus: 'candidate',
  sourceAvailability: 'available',
  requiresMaterialSelection: false,
  conflicts: [],
});

const settings = (overrides?: Partial<WorkspaceMemorySettings>): WorkspaceMemorySettings => ({
  workspaceId: 'workspace-1',
  revision: 2,
  autoSuggestEnabled: false,
  updatedAt: 1,
  ...overrides,
});

const state = (overrides?: Partial<MemorySuggestionsState>): MemorySuggestionsState => ({
  settings: settings(),
  settingsLoading: false,
  settingsError: '',
  savingSettings: false,
  jobs: [],
  jobsError: '',
  activeJob: undefined,
  candidates: [],
  candidatesError: '',
  loadingCandidates: false,
  polling: false,
  toast: undefined,
  dismissToast: vi.fn(),
  setAutoSuggest: vi.fn(async () => undefined),
  cancelJob: vi.fn(async () => undefined),
  retryJob: vi.fn(async () => undefined),
  refresh: vi.fn(),
  ...overrides,
});

const renderList = (
  suggestions: MemorySuggestionsState,
  candidates: MemoryViewItem[],
  variant: 'settings' | 'context' = 'settings',
) => {
  const onEdit = vi.fn();
  const onReject = vi.fn();
  const onDelete = vi.fn();
  const { container } = render(
    <MemorySuggestionList
      suggestions={suggestions}
      candidates={candidates}
      variant={variant}
      workspaceName="我的空间"
      expertName="经营分析师"
      onEdit={onEdit}
      onReject={onReject}
      onDelete={onDelete}
    />,
  );
  return { container, onEdit, onReject, onDelete };
};

afterEach(() => {
  cleanup();
});

describe('MemorySuggestionList', () => {
  it('开启自动建议先弹出代价与同意版本确认，未确认前不提交', () => {
    const setAutoSuggest = vi.fn(async () => undefined);
    const suggestions = state({ setAutoSuggest });
    renderList(suggestions, []);

    fireEvent.click(screen.getByRole('button', { name: '开启自动建议' }));
    expect(setAutoSuggest).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog').textContent ?? '';
    expect(dialog).toContain('可能产生费用');
    expect(dialog).toContain('远程模型会接收这些片段');
    expect(dialog).toContain('同意版本 v1');

    fireEvent.click(screen.getByRole('button', { name: '我已了解，开启' }));
    expect(setAutoSuggest).toHaveBeenCalledTimes(1);
    expect(setAutoSuggest).toHaveBeenCalledWith(true);
  });

  it('关闭开关同样先确认，确认后将关闭提交给同一个命令', () => {
    const setAutoSuggest = vi.fn(async () => undefined);
    const suggestions = state({
      settings: settings({ autoSuggestEnabled: true, consentVersion: 1 }),
      setAutoSuggest,
    });
    renderList(suggestions, []);

    fireEvent.click(screen.getByRole('button', { name: '关闭自动建议' }));
    expect(screen.getByRole('alertdialog').textContent).toContain(
      '已确认的记忆与历史候选都不受影响',
    );

    fireEvent.click(screen.getByRole('button', { name: '确认关闭' }));
    expect(setAutoSuggest).toHaveBeenCalledWith(false);
  });

  it('读取失败才用内联错误，本轮没有建议是成功结果', () => {
    const empty = renderList(state(), []);
    expect(empty.container.querySelector('.inline-message')).toBeNull();
    expect(empty.container.textContent).toContain('本轮没有待确认的建议。');

    const failed = renderList(state({ candidatesError: '读取经验建议失败，请重试。' }), []);
    const message = failed.container.querySelector('.inline-message.error');
    expect(message?.textContent).toBe('读取经验建议失败，请重试。');
  });

  it('逐条候选的处理只回调调用方，不再叠一层全局提示', () => {
    const { container, onEdit, onReject, onDelete } = renderList(
      state(),
      [candidateItem('经营分析先核对回款金额口径。')],
      'context',
    );

    fireEvent.click(screen.getByRole('button', { name: '编辑并确认' }));
    fireEvent.click(screen.getByRole('button', { name: '暂不采用' }));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0]?.[0]?.content).toBe('经营分析先核对回款金额口径。');
    expect(container.querySelector('.page-toast-host')).toBeNull();
  });

  it('进行中的作业只给取消，失败与中断才给重新提炼', async () => {
    const cancelJob = vi.fn(async () => undefined);
    const retryJob = vi.fn(async () => undefined);
    const suggestions = state({
      jobs: [
        job({ id: 'job-run', status: 'running' }),
        job({ id: 'job-failed', status: 'failed', errorCode: 'MODEL_UNAVAILABLE', updatedAt: 2 }),
      ],
      cancelJob,
      retryJob,
    });
    renderList(suggestions, []);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '重新提炼' }));

    expect(cancelJob).toHaveBeenCalledTimes(1);
    expect(cancelJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-run' }));
    expect(retryJob).toHaveBeenCalledTimes(1);
    expect(retryJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-failed' }));
  });

  it('轮询提示只在面板可见且在提炼时出现', () => {
    const idle = renderList(state({ jobs: [job({ status: 'succeeded' })] }), []);
    expect(idle.container.textContent).not.toContain('正在提炼，本面板可见期间才会查询进度');

    const busy = renderList(
      state({
        jobs: [job({ status: 'running' })],
        polling: true,
        activeJob: job({ status: 'running' }),
      }),
      [],
    );
    expect(busy.container.textContent).toContain('正在提炼，本面板可见期间才会查询进度');
  });
});
