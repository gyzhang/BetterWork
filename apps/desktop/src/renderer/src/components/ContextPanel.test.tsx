// @vitest-environment jsdom

import type {
  EvidenceSummary,
  KnowledgeEvidenceSource,
  MaterialCandidate,
  MemoryJobSummary,
  MemoryPreviewData,
  MemoryRunContextData,
  MemoryViewItem,
  RunMemoryContext,
  RunSourcePreview,
  RunSummary,
  TaskContinuityRevision,
  TaskMaterialSelection,
  WorkspaceBrief,
} from '@betterwork/agent-protocol';
import { memoryRecallPolicyV1 } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MemorySuggestionsState } from '../hooks/use-memory-suggestions';
import type { RunMemoriesState, TaskMemoryExclusionState } from '../hooks/use-run-memories';
import type { TaskContinuityState } from '../hooks/use-task-continuity';
import type { TaskMemoryExclusionsState } from '../hooks/use-task-memory-exclusions';
import type { WorkspaceBriefState } from '../hooks/use-workspace-brief';
import type { ContextTab } from '../lib/view-types';
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
  recallPolicy: overrides?.recallPolicy ?? 'relevant',
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
  invalidatePreview: vi.fn(),
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

const exclusions = (overrides?: Partial<TaskMemoryExclusionsState>): TaskMemoryExclusionsState => ({
  items: [],
  loading: false,
  error: '',
  reload: vi.fn(),
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
      taskId="task-1"
      taskContinuity={taskContinuityState()}
      tab="memory"
      setTab={vi.fn()}
      events={[]}
      evidence={[]}
      artifacts={[]}
      taskRuns={[]}
      activityGroups={[]}
      onSelectRun={vi.fn()}
      onOpenSource={vi.fn(async () => undefined)}
      onOpenArtifactVersion={vi.fn(async () => undefined)}
      materials={[]}
      onCommitMaterials={vi.fn()}
      materialsDisabled={false}
      memories={[memory()]}
      excludedMemoryIds={[]}
      onToggleMemory={vi.fn()}
      exclusion={exclusion()}
      exclusions={exclusions()}
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

const taskContinuityRevision = (
  revision = 1,
  objective = '完成季度经营分析',
): TaskContinuityRevision => ({
  id: `continuity-${revision}`,
  taskId: 'task-1',
  revision,
  schemaVersion: 1,
  briefHash: HASH,
  sourceKind: revision === 1 ? 'task-goal' : 'user-edit',
  createdAt: revision,
  brief: {
    schemaVersion: 1,
    objective: { text: objective, source: revision === 1 ? 'task-goal' : 'user-edit' },
    activeRequirements: [
      {
        id: 'requirement-1',
        text: '重点分析现金流',
        authoredBy: 'assistant-summary',
        sources: [{ runId: 'run-1', promptHash: HASH }],
      },
    ],
    progress: {
      authoredBy: 'assistant-summary',
      status: 'blocked',
      completedActions: ['已核对季度汇总'],
      nextAction: '等待补充回款数据',
      blockers: ['缺少回款明细'],
      artifactVersionIds: ['artifact-version-1'],
      sourceRunId: 'run-1',
      sourcePromptHash: HASH,
    },
  },
});

const taskContinuityState = (
  overrides: Partial<TaskContinuityState> = {},
): TaskContinuityState => ({
  revision: null,
  loading: false,
  saving: false,
  error: '',
  errorKind: undefined,
  conflict: false,
  refresh: vi.fn(async () => undefined),
  save: vi.fn(async () => null),
  clearError: vi.fn(),
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe('ContextPanel 本任务连续简报', () => {
  const sourceRun: RunSummary = {
    id: 'run-1',
    taskId: 'task-1',
    sessionId: 'session-1',
    prompt: '核对季度汇总',
    status: 'completed',
    createdAt: 1,
    completedAt: 2,
  };
  const artifact = {
    id: 'artifact-1',
    workspaceId: 'workspace-1',
    taskId: 'task-1',
    type: 'markdown' as const,
    title: '季度分析草稿',
    currentVersionId: 'artifact-version-1',
    versionNumber: 1,
    origin: 'assistant-run' as const,
    sourceRunId: 'run-1',
    createdAt: 1,
    updatedAt: 2,
  };

  it('区分目标、用户要求与助手进度，并可回到来源 Run 和精确 ArtifactVersion', () => {
    const onSelectRun = vi.fn();
    const onOpenArtifactVersion = vi.fn(async () => undefined);
    renderPanel({
      tab: 'process',
      taskRuns: [sourceRun],
      artifacts: [artifact],
      taskContinuity: taskContinuityState({ revision: taskContinuityRevision() }),
      onSelectRun,
      onOpenArtifactVersion,
    });

    expect(screen.getByText('完成季度经营分析')).toBeTruthy();
    expect(screen.getByText('助手整理')).toBeTruthy();
    expect(screen.getByText(/来源请求 · prompt 指纹 a{12}/u)).toBeTruthy();
    expect(screen.getByText(/下一步：等待补充回款数据/u)).toBeTruthy();
    const sourceButtons = screen.getAllByRole('button', { name: '查看来源执行记录' });
    const firstSourceButton = sourceButtons.at(0);
    if (!firstSourceButton) throw new Error('Brief source run action is missing');
    fireEvent.click(firstSourceButton);
    fireEvent.click(screen.getByRole('button', { name: '查看该版本' }));

    expect(onSelectRun).toHaveBeenCalledWith(sourceRun);
    expect(onOpenArtifactVersion).toHaveBeenCalledWith('artifact-version-1');
  });

  it('以当前 revision 提交目标、要求和进度修订', async () => {
    const save = vi.fn(async () => ({
      kind: 'saved' as const,
      revision: taskContinuityRevision(2),
    }));
    renderPanel({
      tab: 'process',
      taskRuns: [sourceRun],
      taskContinuity: taskContinuityState({ revision: taskContinuityRevision(), save }),
    });

    fireEvent.click(screen.getByRole('button', { name: '编辑简报' }));
    fireEvent.change(screen.getByLabelText('任务目标'), {
      target: { value: '完成季度经营分析并说明回款风险' },
    });
    fireEvent.change(screen.getByLabelText('要求 1'), {
      target: { value: '重点分析现金流和逾期账款' },
    });
    fireEvent.change(screen.getByLabelText('下一步'), {
      target: { value: '取得回款明细后完成核对' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存简报' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({
      taskId: 'task-1',
      expectedRevision: 1,
      objective: '完成季度经营分析并说明回款风险',
      activeRequirements: [{ id: 'requirement-1', text: '重点分析现金流和逾期账款' }],
      progress: {
        status: 'blocked',
        completedActions: ['已核对季度汇总'],
        nextAction: '取得回款明细后完成核对',
        blockers: ['缺少回款明细'],
        artifactVersionIds: ['artifact-version-1'],
      },
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: '保存简报' })).toBeNull());
  });

  it('冲突时保留当前内容并提供载入最新版本动作', () => {
    const refresh = vi.fn(async () => undefined);
    renderPanel({
      tab: 'process',
      taskContinuity: taskContinuityState({
        revision: taskContinuityRevision(),
        error: '本任务简报已被其他更新修改。',
        errorKind: 'conflict',
        conflict: true,
        refresh,
      }),
    });

    expect(screen.getByText('完成季度经营分析')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '载入最新版本' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('旧 Task 明确显示无连续简报，不伪造历史内容', () => {
    renderPanel({ tab: 'process', taskContinuity: taskContinuityState({ revision: null }) });

    expect(screen.getByText('此 Task 尚无连续简报')).toBeTruthy();
    expect(screen.getByText(/旧 Task 不会从历史对话回填/u)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '编辑简报' })).toBeNull();
  });
});

describe('ContextPanel 本次任务材料', () => {
  it('allows a selected material to use the other purpose', () => {
    const onCommitMaterials = vi.fn();
    const candidate: MaterialCandidate = {
      reference: {
        kind: 'knowledge-revision',
        knowledgeDocumentId: 'doc-rules',
        knowledgeRevisionId: 'revision-rules-2',
        contentHash: 'hash-rules-2',
        sourcePath: '/workspace/财务规则.md',
      },
      title: '财务规则',
      sourceLabel: '知识 · 财务规则.md',
      status: 'ready',
      detail: '修订 v2',
    };
    const selected: TaskMaterialSelection = {
      reference: candidate.reference,
      purpose: 'rule',
      addedFrom: 'workspace-candidate',
    };
    renderPanel({
      tab: 'sources',
      materials: [selected],
      materialCandidates: [candidate],
      onCommitMaterials,
    });

    fireEvent.click(screen.getByRole('button', { name: '财务规则用途' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '其他' }));

    expect(onCommitMaterials).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ purpose: 'other' }),
    ] satisfies [TaskMaterialSelection]);
  });
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
    const row = container.querySelector('.memory-scope-section .list-row');
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
    const row = container.querySelector('.memory-scope-section .list-row');
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
    const row = container.querySelector('.memory-scope-section .list-row');
    expect(row?.textContent).toContain('正在调整…');
    const button = screen.getByRole('button', { name: '正在调整…' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('排除保存失败就地报错，不当作成功结果', () => {
    const container = renderPanel({ exclusion: exclusion({ error: '上下文刚被更新，请重试。' }) });
    const error = container.querySelector('.memory-scope-section .inline-error');
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
    expect(container.querySelector('.memory-scope-section .inline-error')).not.toBeNull();
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

const knowledgeSource = (
  overrides?: Partial<KnowledgeEvidenceSource>,
): KnowledgeEvidenceSource => ({
  reference: {
    kind: 'knowledge-revision',
    knowledgeDocumentId: 'doc-1',
    knowledgeRevisionId: 'revision-1',
    contentHash: HASH,
    sourcePath: '/vault/合同模板.md',
  },
  textHash: HASH,
  span: { sectionOrdinal: 0, start: 10, end: 18 },
  operation: 'search',
  ...overrides,
});

const evidenceOf = (overrides: Partial<EvidenceSummary>): EvidenceSummary => ({
  id: 'evidence-1',
  taskId: 'task-1',
  runId: 'run-1',
  sourceType: 'local-file',
  sourceUri: '/vault/合同模板.md',
  title: '合同模板',
  locator: '第 1 段',
  excerpt: '违约金上限为合同金额的百分之二十。',
  contentHash: HASH,
  capturedAt: 1,
  ...overrides,
});

const runOf = (id: string): RunSummary => ({
  id,
  taskId: 'task-1',
  sessionId: 'session-1',
  prompt: '审阅合同',
  status: 'completed',
  createdAt: 1,
});

const exactPreview: RunSourcePreview = {
  kind: 'exact',
  page: {
    reference: knowledgeSource().reference,
    textHash: HASH,
    title: '合同模板',
    parserVersion: 'text-extract-v1',
    chunkingVersion: 'format-locator-v1',
    warnings: [],
    parts: [
      {
        span: { sectionOrdinal: 0, start: 10, end: 18 },
        locator: '第 1 段',
        text: '违约金上限为合同金额的百分之二十。',
        excerptHash: HASH,
      },
    ],
    returnedCodePoints: 17,
    complete: true,
  },
};

const previewRunSource = vi.fn(async (): Promise<RunSourcePreview> => exactPreview);

beforeAll(() => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: { knowledge: { previewRunSource } },
  });
});

afterAll(() => {
  delete (window as { betterwork?: unknown }).betterwork;
});

describe('ContextPanel 按运行回看来源', () => {
  const current = evidenceOf({
    knowledgeSource: knowledgeSource({ operation: 'search' }),
  });
  const historical = evidenceOf({
    id: 'evidence-0',
    runId: 'run-0',
    knowledgeSource: knowledgeSource({ operation: 'read' }),
  });
  const legacy = evidenceOf({ id: 'evidence-legacy', runId: 'run-0', title: '旧访问记录' });

  it('默认只呈现当前运行，摘要来源与正文来源分开标注，历史折叠需显式展开', () => {
    const container = renderPanel({
      tab: 'sources',
      activeRun: runOf('run-1'),
      evidence: [current, historical, legacy],
    });
    const currentGroup = screen
      .getByRole('heading', { name: '本次运行' })
      .closest('.context-section');
    expect(currentGroup?.textContent).toContain('摘要来源');
    expect(currentGroup?.textContent).not.toContain('正文来源');
    expect(currentGroup?.textContent).toContain('修订 revision');
    const history = container.querySelector('details.disclosure');
    expect(history?.parentElement?.className, '历史来源段要套上下文面板的小节壳').toBe(
      'context-section',
    );
    expect(history?.textContent).toContain('历史运行来源 · 2 条');
    expect(history?.textContent).toContain('旧访问记录');
    expect(container.querySelector('[role="note"]')).toBeNull();
  });

  it('查看区间只回看当时返回的正文，止于该区间且不提供续读', async () => {
    previewRunSource.mockClear();
    renderPanel({
      tab: 'sources',
      activeRun: runOf('run-1'),
      evidence: [current],
    });
    fireEvent.click(screen.getByRole('button', { name: '查看区间' }));
    await waitFor(() =>
      expect(previewRunSource).toHaveBeenCalledWith({
        runId: 'run-1',
        evidenceId: 'evidence-1',
      }),
    );
    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('违约金上限为合同金额的百分之二十。');
    expect(note.textContent).toContain('止于该区间；不提供续读');
    expect(note.textContent).not.toContain('下一页');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('旧数据没有精确区间时只标历史范围未记录，不给区间回看入口', () => {
    renderPanel({
      tab: 'sources',
      activeRun: runOf('run-1'),
      evidence: [legacy],
    });
    expect(screen.getByText('旧访问记录')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '查看区间' })).toBeNull();
    const row = screen.getByText('旧访问记录').closest('.list-row');
    expect(row?.textContent).toContain('历史范围未记录');
    expect(screen.getByRole('button', { name: '原文' })).toBeTruthy();
  });

  it('回看失败在内联呈现并允许关闭，不当作成功结果', async () => {
    previewRunSource.mockRejectedValueOnce(new Error('证据的修订身份与保存文本不一致。'));
    renderPanel({
      tab: 'sources',
      activeRun: runOf('run-1'),
      evidence: [current],
    });
    fireEvent.click(screen.getByRole('button', { name: '查看区间' }));
    const note = await screen.findByRole('note');
    expect(note.querySelector('.inline-error')?.textContent).toContain(
      '证据的修订身份与保存文本不一致',
    );
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('ContextPanel 本任务已排除（MI03）', () => {
  const items = [
    {
      visibility: 'visible' as const,
      memoryId: 'memory-1',
      revisionId: 'memory-1-r1',
      content: '金额按万元保留两位。',
      scope: { kind: 'workspace' as const, workspaceId: 'workspace-1' },
      effectiveStatus: 'confirmed' as const,
    },
    { visibility: 'unavailable' as const, memoryId: 'memory-9' },
  ];

  it('预览失败或没有输入时，排除清单仍然可读并可恢复', () => {
    const container = renderPanel({
      runMemories: runMemories({
        preview: undefined,
        previewAvailable: false,
        previewError: '范围预览暂时失败。',
      }),
      excludedMemoryIds: ['memory-1', 'memory-9'],
      exclusions: exclusions({ items }),
    });
    expect(container.textContent).toContain('本任务已排除');
    expect(container.textContent).toContain('金额按万元保留两位。');
    expect(container.textContent).toContain('此项当前不可查看');
    const labels = [...container.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).toContain('恢复参与选择');
    expect(labels).toContain('移除此排除');
  });

  /** 读取失败也要留在原位并可重试：内联错误槽（docs/10 §11.5.1），不弹全局横幅也不清空清单。 */
  it('排除清单读取失败时给内联错误与重试，不影响已读到的条目', () => {
    const reload = vi.fn();
    const container = renderPanel({
      excludedMemoryIds: ['memory-1'],
      exclusions: exclusions({ items, error: '读取本任务已排除记忆失败，请重试。', reload }),
    });
    const section = container.querySelector('.memory-excluded-section');
    expect(section?.querySelector('.inline-error')?.textContent).toContain(
      '读取本任务已排除记忆失败',
    );
    // 内联错误已统一走 InlineError；`.inline-message` 这一层在面板里不该再留下任何痕迹，
    // 更不该长出非错误态的配色变体（docs/10 §11.5.1）。
    expect(section?.querySelector('.inline-message')).toBeNull();
    const retry = [...(section?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === '重试',
    );
    retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(section?.textContent).toContain('金额按万元保留两位。');
  });

  it('恢复动作只针对该条排除，越范围项也能移除', () => {
    const onToggleMemory = vi.fn();
    const container = renderPanel({
      excludedMemoryIds: ['memory-1', 'memory-9'],
      exclusions: exclusions({ items }),
      onToggleMemory,
    });
    const restore = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '恢复参与选择',
    );
    restore?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onToggleMemory).toHaveBeenCalledWith('memory-1');
  });
});

describe('ContextPanel 换期恢复引导（MI08）', () => {
  afterEach(cleanup);

  it('解释历史截断后给出可返回的恢复入口，不提供一键恢复全部历史', () => {
    const setTab = vi.fn();
    const onRequestMaterials = vi.fn();
    const onOpenMemoryPage = vi.fn();
    const container = renderPanel({
      setTab,
      onRequestMaterials,
      onOpenMemoryPage,
    });

    expect(container.textContent).toContain('未带入');
    expect(container.textContent).toContain('旧轮次只是这次不发送，对话没有被删除');
    const labels = [...container.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).toContain('选择本期材料');
    expect(labels).toContain('查看上期成果版本');
    expect(labels).toContain('到记忆详情保留方法');
    expect(container.textContent).toContain('标记参考不等于已读取');
    expect(labels.some((label) => label === '恢复全部历史')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '选择本期材料' }));
    expect(setTab).toHaveBeenCalledWith('sources');
    expect(onRequestMaterials).toHaveBeenCalledWith('file');
  });
});

/**
 * 上下文面板是 380px 定宽列，每一段的左内缩只由它自己的外壳给（docs/10 §9.8）。
 *
 * 2026-09-28「本次运行」与「历史运行来源」两段漏了 `.context-section`，直接贴到列的
 * 左边缘，而同列其余段落都有 14px；成果列表与记忆提示行是同一件事的另外两处。
 * 分段外壳因此要有台账：新增一段必须先选一个自带水平内缩的壳，
 * 或者把新壳登记到这里并写明它凭什么自己定内缩。
 * 2026-10-01 这条轴补上了档位——三件壳的水平内缩并到 16px（docs/10 §9.8），值由
 * `standards/coding-standard.test.ts`「定宽列段落内缩档位」钉住，本清单只管「有没有壳」。
 */
describe('上下文面板的分段内缩', () => {
  const INSET_OWNERS: ReadonlyArray<readonly [string, string]> = [
    ['context-section', '小节壳：顶部入口缝归面板、水平 16px ＋ 分隔线'],
    ['activity-list', '过程页的列表壳：顶部入口缝归面板、水平 16px'],
    ['brief-panel', '简报壳：顶部入口缝归面板、水平 16px'],
    ['empty-context', '区域级空态基座：页签顶部对齐，消息中心保持居中'],
    [
      'inline-error',
      '内联错误基座（docs/10 §11.5.1 第二落点）：它是表面不是文本，列内缩由 `.context-content > .inline-error` 给',
    ],
    ['inline-loading', '读取状态行，随上面的壳一起出现'],
  ];

  const cases: ReadonlyArray<readonly [ContextTab, string, Record<string, unknown>]> = [
    ['process', '空过程页', {}],
    ['sources', '只有本次运行', { activeRun: runOf('run-1'), evidence: [evidenceOf({})] }],
    [
      'sources',
      '本次运行与历史来源并存',
      {
        activeRun: runOf('run-1'),
        evidence: [evidenceOf({}), evidenceOf({ id: 'evidence-0', runId: 'run-0' })],
      },
    ],
    [
      'memory',
      '带错误与警告行',
      { memoriesError: '读取记忆失败。', memoriesWarning: '有一条记忆待复核。' },
    ],
    ['brief', '简报页', {}],
    ['artifacts', '成果页', {}],
  ];

  it.each(cases)('%s：%s 的每一段都自带列内缩', (tab, _label, overrides) => {
    const container = renderPanel({ tab, ...overrides });
    const segments = [...container.querySelectorAll('.context-content > *')];
    // 空容器会把「没有违规」读成「全部合规」：先证这一段真的渲染出了东西。
    expect(segments.length, `${tab} 页没渲染出任何分段，用例夹具失效`).toBeGreaterThan(0);
    const offenders = segments
      .filter((node) => !INSET_OWNERS.some(([owner]) => node.classList.contains(owner)))
      .map((node) => `${node.tagName.toLowerCase()}.${node.className || '(无类名)'}`);
    expect(offenders.length, `${tab} 页有分段没登记内缩外壳：${offenders.join('、')}`).toBe(0);
  });
});
