// @vitest-environment jsdom

import type {
  MemoryJobSummary,
  MemoryPreviewData,
  MemoryRunContextData,
  MemoryViewItem,
  RunMemoryContext,
  WorkspaceBrief,
} from '@betterwork/agent-protocol';
import { memoryRecallPolicyV1 } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MemorySuggestionsState } from '../hooks/use-memory-suggestions';
import type { RunMemoriesState, TaskMemoryExclusionState } from '../hooks/use-run-memories';
import type { WorkspaceBriefState } from '../hooks/use-workspace-brief';
import { ContextPanel } from './ContextPanel';

/**
 * 上下文面板的记忆可见性（WM07，产品设计 §3.5）。
 *
 * 三段各回答一个不同问题，界面不许把它们混起来：
 * 「下次运行可用」是范围预览，「本次运行记忆」是宿主登记到哪一步，
 * 「历史上下文调整」是哪些旧轮次没带、为什么没带。
 * 断言因此盯措辞与落选原因，而不是排版。
 */

const HASH = 'a'.repeat(64);

const memory = (overrides?: Partial<MemoryViewItem>): MemoryViewItem => ({
  id: 'memory-1',
  revisionId: 'memory-1-r1',
  revision: 3,
  scope: { kind: 'workspace', workspaceId: 'workspace-1' },
  kind: 'procedural',
  content: '季度分析先对齐签约金额口径。',
  sourceType: 'conversation',
  confidence: 0.9,
  status: 'confirmed',
  contentHash: HASH,
  createdAt: 1,
  updatedAt: 1,
  facet: 'method',
  normalizedHash: HASH,
  provenance: {
    schemaVersion: 1,
    verification: 'verified',
    authority: 'user-instruction',
    capturedAt: 1,
    sources: [
      {
        kind: 'manual',
        operationId: 'c'.repeat(36),
        contentHash: HASH,
        start: 0,
        end: 9,
        excerpt: '季度分析先对齐签约金额口径。',
        excerptHash: HASH,
      },
    ],
    materialDependencies: [],
    memoryDependencies: [],
  },
  effectiveStatus: 'confirmed',
  sourceAvailability: 'available',
  requiresMaterialSelection: false,
  conflicts: [],
  ...overrides,
});

const previewOf = (
  overrides?: Partial<Pick<MemoryPreviewData, 'selectedItems' | 'decisionSummary'>>,
): MemoryPreviewData => ({
  evaluatedAt: 1,
  policySnapshot: memoryRecallPolicyV1,
  selectedItems: overrides?.selectedItems ?? [
    {
      memoryId: 'memory-1',
      revisionId: 'memory-1-r1',
      contentHash: HASH,
      order: 1,
      score: 14,
      reason: 'task-relevant',
    },
  ],
  decisionSummary: overrides?.decisionSummary ?? {
    budget: {
      totalItems: 1,
      preferenceItems: 0,
      contentCodePoints: 16,
      wrapperCodePoints: 42,
      blockCodePoints: 58,
    },
    exclusions: [],
    queryTruncated: false,
    conflictReviewRequired: false,
  },
});

const audit = (overrides?: Partial<RunMemoryContext>): RunMemoryContext => ({
  runId: 'run-1',
  schemaVersion: 1,
  phase: 'dispatch-attempted',
  recallVersion: 'memory-recall-v1',
  evaluatedAt: 1,
  queryHash: HASH,
  policySnapshot: memoryRecallPolicyV1,
  selectedItems: previewOf().selectedItems,
  replay: [
    {
      replayed: true,
      runId: 'run-0',
      finalEventId: 'event-1',
      promptHash: HASH,
      contentCodePoints: 120,
    },
    { replayed: false, runId: 'run-old', reason: 'memory-revised' },
  ],
  materialDependencyUnion: [],
  memoryDependencyUnion: [],
  decisionSummary: previewOf().decisionSummary,
  authorizationHash: HASH,
  selectedAt: 1,
  requestPreparedAt: 2,
  dispatchAttemptedAt: 3,
  updatedAt: 3,
  ...overrides,
});

const runContextOf = (overrides?: Partial<MemoryRunContextData>): MemoryRunContextData => ({
  runId: 'run-1',
  phase: 'dispatch-attempted',
  context: audit(),
  memories: [],
  reads: [
    {
      id: 'read-1',
      runId: 'run-1',
      memoryId: 'memory-1',
      memoryRevisionId: 'memory-1-r1',
      contentHash: HASH,
      capturedAt: 1,
      selectedForInjection: true,
      replayedViaRunIds: ['run-0'],
      provenanceState: 'known',
    },
  ],
  ...overrides,
});

const runMemories = (overrides?: Partial<RunMemoriesState>): RunMemoriesState => ({
  preview: previewOf(),
  previewLoading: false,
  previewError: '',
  previewAvailable: true,
  requestPreview: vi.fn(),
  runContext: runContextOf(),
  contextLoading: false,
  contextError: '',
  refreshRunContext: vi.fn(),
  ...overrides,
});

const exclusion = (overrides?: Partial<TaskMemoryExclusionState>): TaskMemoryExclusionState => ({
  savingMemoryId: undefined,
  error: '',
  toggle: vi.fn(async () => undefined),
  clearError: vi.fn(),
  ...overrides,
});

const briefState = (overrides?: Partial<WorkspaceBriefState>): WorkspaceBriefState => {
  const brief: WorkspaceBrief = {
    workspaceId: 'workspace-1',
    generatedAt: 1,
    goals: { items: [], total: 0, truncated: false },
    constraints: { items: [], total: 0, truncated: false },
    decisions: { items: [], total: 0, truncated: false },
    methods: { items: [], total: 0, truncated: false },
    openIssues: { items: [], total: 0, truncated: false },
    referenceVersions: { items: [], total: 0, truncated: false },
  };
  return {
    brief,
    loading: false,
    error: '',
    loadedFor: 'workspace-1|-',
    refresh: vi.fn(),
    ...overrides,
  };
};

const suggestions = (overrides?: Partial<MemorySuggestionsState>): MemorySuggestionsState => {
  const job: MemoryJobSummary = {
    id: 'job-1',
    workspaceId: 'workspace-1',
    taskId: 'task-1',
    source: { kind: 'run', runId: 'run-1' },
    status: 'succeeded',
    revision: 1,
    attempt: 1,
    trigger: 'automatic',
    candidateCount: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    settings: undefined,
    settingsLoading: false,
    settingsError: '',
    savingSettings: false,
    jobs: [job],
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
  };
};

const renderPanel = (overrides: Record<string, unknown> = {}): HTMLElement => {
  const { container } = render(
    <ContextPanel
      open
      setOpen={vi.fn()}
      tab="memory"
      setTab={vi.fn()}
      events={[]}
      evidence={[]}
      artifacts={[]}
      taskRuns={[]}
      activityGroups={[]}
      onSelectRun={vi.fn()}
      onOpenSource={vi.fn(async () => undefined)}
      materials={[]}
      memories={[memory()]}
      excludedMemoryIds={[]}
      onToggleMemory={vi.fn()}
      exclusion={exclusion()}
      materialCandidates={[]}
      onRequestMaterials={vi.fn()}
      mcpConnections={[]}
      mcpToolBindings={[]}
      onMcpToolBindingsChange={vi.fn()}
      runMemories={runMemories()}
      brief={briefState()}
      workspaceName="我的空间"
      expertName="经营分析师"
      onOpenBriefMemory={vi.fn()}
      onOpenBriefIssue={vi.fn()}
      onOpenBriefReference={vi.fn()}
      suggestions={suggestions()}
      taskCandidates={[]}
      onEditCandidate={vi.fn()}
      onRejectCandidate={vi.fn()}
      onDeleteCandidate={vi.fn()}
      onOpenMemoryPage={vi.fn()}
      memoriesError=""
      memoriesWarning=""
      {...overrides}
    />,
  );
  return container;
};

afterEach(() => {
  cleanup();
});

describe('ContextPanel 记忆可见性', () => {
  it('把范围预览与本次登记分成两段，措辞不夸大', () => {
    const container = renderPanel({});
    expect(container.textContent).toContain('范围预览：按当前任务输入试算，不是本次实际使用记录');
    expect(container.textContent).toContain('本次运行真正带了哪些，以下方「本次运行记忆」为准');
    expect(container.textContent).toContain('登记的是宿主的准备阶段，不表示模型已读到');
    expect(container.textContent).not.toContain('模型已收到');
  });

  it('预览行给出顺序、理由与作用域，排除按钮按记忆身份回传', () => {
    const onToggleMemory = vi.fn();
    const container = renderPanel({ onToggleMemory });

    // 同一条正文同时出现在「范围预览」与「本次运行记忆」两段，查询必须落在预览段内。
    const row = container.querySelector('.memory-scope-section .context-row');
    expect(row?.textContent).toContain('第 1 位');
    expect(row?.textContent).toContain('与本任务内容相关');
    expect(row?.textContent).toContain('工作空间 · 我的空间');
    expect(row?.textContent).toContain('v3');

    fireEvent.click(screen.getByRole('button', { name: '本任务不用' }));
    expect(onToggleMemory).toHaveBeenCalledWith('memory-1');
  });

  it('已排除的行给出恢复入口，而不是把行藏起来', () => {
    const onToggleMemory = vi.fn();
    const container = renderPanel({
      excludedMemoryIds: ['memory-1'],
      onToggleMemory,
    });
    const row = container.querySelector('.memory-scope-section .context-row');
    expect(row?.className).toContain('excluded');
    expect(row?.textContent).toContain('恢复使用');
    fireEvent.click(screen.getByRole('button', { name: '恢复使用' }));
    expect(onToggleMemory).toHaveBeenCalledWith('memory-1');
  });

  it('保存中的行显示进行状态并禁用按钮，不接受第二次点击', () => {
    const container = renderPanel({
      excludedMemoryIds: ['memory-1'],
      exclusion: exclusion({ savingMemoryId: 'memory-1' }),
    });
    const row = container.querySelector('.memory-scope-section .context-row');
    expect(row?.textContent).toContain('正在调整…');
    const button = screen.getByRole('button', { name: '正在调整…' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('排除保存失败就地报错，不当作成功结果', () => {
    const container = renderPanel({ exclusion: exclusion({ error: '上下文刚被更新，请重试。' }) });
    const error = container.querySelector('.memory-scope-section .inline-message.error');
    expect(error?.textContent).toBe('上下文刚被更新，请重试。');
  });

  it('任务上下文未建立时不假装能试算，并说明缺什么', () => {
    const container = renderPanel({
      runMemories: runMemories({
        preview: undefined,
        previewAvailable: false,
      }),
    });
    expect(container.textContent).toContain('还没有可试算的输入');
    expect(screen.getByRole('button', { name: '重新试算' }).hasAttribute('disabled')).toBe(true);
  });

  it('预览失败给内联错误与重试入口', () => {
    const requestPreview = vi.fn();
    const container = renderPanel({
      runMemories: runMemories({
        preview: undefined,
        previewError: '记忆范围预览失败，请重试。',
        requestPreview,
      }),
    });
    expect(container.querySelector('.memory-scope-section .inline-message.error')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(requestPreview).toHaveBeenCalledTimes(1);
  });

  it('落选原因逐条可解释，预算落选不等于撤销授权', () => {
    const container = renderPanel({
      runMemories: runMemories({
        preview: previewOf({
          decisionSummary: {
            budget: {
              totalItems: 1,
              preferenceItems: 0,
              contentCodePoints: 16,
              wrapperCodePoints: 42,
              blockCodePoints: 58,
            },
            exclusions: [
              {
                reason: 'task-excluded',
                count: 1,
                identities: [{ memoryId: 'memory-1', revisionId: 'memory-1-r1' }],
              },
              {
                reason: 'budget',
                count: 2,
                identities: [{ memoryId: 'memory-1', revisionId: 'memory-1-r1' }],
              },
            ],
            queryTruncated: true,
            conflictReviewRequired: false,
          },
        }),
      }),
    });
    expect(container.textContent).toContain('为什么这些没有进入范围');
    expect(container.textContent).toContain('本任务已排除 · 1 条');
    expect(container.textContent).toContain('超出本次预算 · 2 条');
    expect(container.textContent).toContain('输入过长，已按首尾片段试算');
  });

  it('待澄清口径与待复核来源只报身份，不展示正文', () => {
    const container = renderPanel({
      runMemories: runMemories({
        preview: previewOf({
          decisionSummary: {
            budget: {
              totalItems: 0,
              preferenceItems: 0,
              contentCodePoints: 0,
              wrapperCodePoints: 0,
              blockCodePoints: 0,
            },
            exclusions: [
              {
                reason: 'conflict-unresolved',
                count: 1,
                identities: [{ memoryId: 'memory-1', revisionId: 'memory-1-r1' }],
              },
            ],
            queryTruncated: false,
            conflictReviewRequired: true,
          },
        }),
      }),
    });
    const details = container.querySelector('.context-exclusion-list');
    expect(details?.textContent).toContain('存在待澄清口径 · 1 条');
    expect(details?.textContent).not.toContain('季度分析先对齐签约金额口径');
    expect(container.textContent).toContain('本次一组都不带入');
  });

  it('本次运行段按登记阶段陈述，旧版运行不回填时间与请求哈希', () => {
    const container = renderPanel({});
    expect(container.textContent).toContain('请求阶段：已尝试调用模型');
    expect(container.textContent).toContain('阶段只描述宿主做到哪一步');
    expect(container.textContent).toContain('经 1 次历史轮次带入');

    cleanup();
    const legacy = renderPanel({
      runMemories: runMemories({
        runContext: runContextOf({
          phase: 'legacy_unknown',
          context: undefined,
          reads: [],
        }),
      }),
    });
    expect(legacy.textContent).toContain('旧版记录，无法确认请求阶段');
    expect(legacy.textContent).toContain('不回填发送时间与请求哈希');
    expect(legacy.textContent).toContain('旧版运行没有历史重放审计');
  });

  it('历史段说清哪些旧轮次没带以及原因', () => {
    const container = renderPanel({});
    expect(container.textContent).toContain('已带入旧轮次');
    expect(container.textContent).toContain('未带入 run-old');
    expect(container.textContent).toContain('相关记忆已修订');
    expect(container.textContent).toContain(
      '记忆被修订、排除、失效或材料换版本时，相关旧回答不会继续当作事实使用',
    );
  });
});
