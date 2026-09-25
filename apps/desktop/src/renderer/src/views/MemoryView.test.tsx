// @vitest-environment jsdom

import type {
  CreateMemoryRequest,
  GetMemoryRequest,
  MemoryConflictPair,
  MemoryConflictResolutionData,
  MemoryViewItem,
  MemoryWriteReceipt,
  ResolveMemoryConflictRequest,
  SetMemoryStatusRequest,
  UpdateMemoryRequest,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  MemoriesState,
  MemoryConflictOutcome,
  MemoryMutationOutcome,
  MemoryProjectionOutcome,
} from '../hooks/use-memories';
import { type MemoryManagementTarget, MemoryPage } from './MemoryView';

/**
 * 记忆治理页（WM07）。
 *
 * 断言只盯两件事：提交给 Main 的请求形状（幂等键、当前修订、治理动作），
 * 以及界面在失败与终态下**不做什么**（不丢草稿、不给终态记录恢复入口）。
 */

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

import type { MemoryOutcome } from '../lib/memory-result';

const receipt: MemoryWriteReceipt = {
  operationId: 'c'.repeat(36),
  commit: 'committed',
  effect: 'unchanged',
  committedRevisionIds: ['memory-1-r1'],
  projectionState: 'synced',
};

const success: MemoryMutationOutcome = { ok: true, data: receipt, warnings: [] };

const memoryViewItem = (overrides?: Partial<MemoryViewItem>): MemoryViewItem => ({
  id: 'memory-1',
  revisionId: 'memory-1-r1',
  revision: 1,
  recallPolicy: overrides?.recallPolicy ?? 'relevant',
  scope: { kind: 'workspace', workspaceId: 'workspace-1' },
  kind: 'procedural',
  content: '先核对财务规则。',
  sourceType: 'conversation',
  confidence: 0.8,
  status: 'candidate',
  contentHash: HASH_A,
  createdAt: 1,
  updatedAt: 1,
  facet: 'method',
  normalizedHash: HASH_B,
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
        contentHash: HASH_A,
        start: 0,
        end: 9,
        excerpt: '先核对财务规则。',
        excerptHash: HASH_B,
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
  ...overrides,
});

const state = (overrides?: Partial<MemoriesState>): MemoriesState => ({
  memories: [memoryViewItem()],
  loading: false,
  error: '',
  revisionConflict: undefined,
  projectionState: undefined,
  warnings: [],
  setFilters: vi.fn(),
  setError: vi.fn(),
  clearRevisionConflict: vi.fn(),
  refresh: vi.fn(),
  create: vi.fn(async (): Promise<MemoryMutationOutcome> => success),
  update: vi.fn(async (): Promise<MemoryMutationOutcome> => success),
  loadRevision: vi.fn(async (): Promise<MemoryOutcome<MemoryViewItem>> => ({
    ok: true,
    data: memoryViewItem(),
    warnings: [],
  })),
  act: vi.fn(async (): Promise<MemoryMutationOutcome> => success),
  resolveConflict: vi.fn(async (): Promise<MemoryConflictOutcome> => ({
    ok: true,
    data: {
      receipt,
      decision: {
        id: 'conflict-decision-1',
        operationId: 'c'.repeat(36),
        leftRevisionId: 'memory-1-r1',
        rightRevisionId: 'memory-2-r1',
        decision: 'keep-both',
        applicabilityNote: '按适用范围分别保留。',
        createdAt: 1,
      },
    } satisfies MemoryConflictResolutionData,
    warnings: [],
  })),
  rebuildProjection: vi.fn(async (): Promise<MemoryProjectionOutcome> => ({
    ok: true,
    data: { projectionState: 'synced' },
    warnings: [],
  })),
  ...overrides,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

describe('MemoryPage', () => {
  afterEach(cleanup);

  it('confirms a candidate through the governance command with idempotency and revision', async () => {
    const current = state();
    render(<MemoryPage state={current} />);

    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => expect(current.act).toHaveBeenCalledTimes(1));
    const input = vi.mocked(current.act).mock.calls[0]?.[0] as SetMemoryStatusRequest;
    expect(input).toMatchObject({
      id: 'memory-1',
      expectedRevision: 1,
      action: 'confirm',
    });
    expect(input.operationId).toMatch(UUID_PATTERN);
    // 确认必须走表单或显式动作之一：一次点击不重载列表，也不静默改本地状态。
    expect(current.refresh).not.toHaveBeenCalled();
  });

  it('creates a memory from the explicit form with a facet and the default scope', async () => {
    const current = state();
    render(<MemoryPage state={current} workspaceId="workspace-1" />);

    fireEvent.click(screen.getByRole('button', { name: /新增经验/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '记忆正文' }), {
      target: { value: '交付前检查引用。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存为经验' }));

    await waitFor(() => expect(current.create).toHaveBeenCalledTimes(1));
    const request = vi.mocked(current.create).mock.calls[0]?.[0] as CreateMemoryRequest;
    expect(request).toEqual({
      operationId: expect.stringMatching(UUID_PATTERN),
      content: '交付前检查引用。',
      facet: 'method',
      scope: { kind: 'workspace', workspaceId: 'workspace-1' },
      // 手工表单＝正文即来源（契约 §5.3）：不带选择器却声明 false 会被服务判 SOURCE_REVIEW_REQUIRED。
      asUserInstruction: true,
    });
  });

  it('keeps the draft and reports a revision conflict instead of reloading over it', async () => {
    const conflict: MemoryMutationOutcome = {
      ok: false,
      code: 'REVISION_CONFLICT',
      message: '这条记忆已被别处更新，请按最新版本重新提交。',
      retryable: false,
      currentRevision: 3,
    };
    const current = state({
      create: vi.fn(async (): Promise<MemoryMutationOutcome> => conflict),
      revisionConflict: { memoryId: 'draft', expectedRevision: 1, currentRevision: 3 },
    });
    render(<MemoryPage state={current} workspaceId="workspace-1" />);

    fireEvent.click(screen.getByRole('button', { name: /新增经验/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '记忆正文' }), {
      target: { value: '被冲突挡下的草稿。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存为经验' }));

    await waitFor(() => expect(current.create).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('textbox', { name: '记忆正文' })).toHaveProperty(
      'value',
      '被冲突挡下的草稿。',
    );
    expect(screen.getByText(/这条记忆在你编辑期间已被更新（你基于 v1，\s*当前 v3）/)).toBeTruthy();
    expect(current.refresh).not.toHaveBeenCalled();
  });

  it('submits a keep-both resolution only with an applicability note', async () => {
    const conflictPair = {
      leftRevisionId: 'memory-1-r1',
      rightRevisionId: 'memory-2-r1',
      state: 'unresolved' as const,
    };
    const withConflict = memoryViewItem({ conflicts: [conflictPair] });
    const right = memoryViewItem({
      id: 'memory-2',
      revisionId: 'memory-2-r1',
      content: '收入按回款金额统计。',
      topicKey: '收入口径',
    });
    const current = state({ memories: [withConflict, right] });
    render(<MemoryPage state={current} />);

    expect(screen.getByText(/可能冲突：两条口径指向同一议题/)).toBeTruthy();
    const keepBoth = screen.getByRole('button', { name: '确认两条并存' });
    expect(keepBoth).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByRole('textbox', { name: '适用条件说明' }), {
      target: { value: '签约口径用于合同，回款口径用于经营月报。' },
    });
    fireEvent.click(keepBoth);
    await waitFor(() => expect(current.resolveConflict).toHaveBeenCalledTimes(1));
    const request = vi.mocked(current.resolveConflict).mock
      .calls[0]?.[0] as ResolveMemoryConflictRequest;
    expect(request).toMatchObject({
      left: { id: 'memory-1', expectedRevision: 1 },
      right: { id: 'memory-2', expectedRevision: 1 },
      decision: 'keep-both',
      applicabilityNote: '签约口径用于合同，回款口径用于经营月报。',
    });
    expect(request.winnerId).toBeUndefined();
  });

  it('replaces a conflicting rule only with an explicit winner', async () => {
    const conflictPair = {
      leftRevisionId: 'memory-1-r1',
      rightRevisionId: 'memory-2-r1',
      state: 'unresolved' as const,
    };
    const left = memoryViewItem({ conflicts: [conflictPair] });
    const right = memoryViewItem({
      id: 'memory-2',
      revisionId: 'memory-2-r1',
      content: '本期改为不含税回款金额。',
    });
    const current = state({ memories: [left, right] });
    render(<MemoryPage state={current} />);

    fireEvent.click(screen.getByRole('button', { name: '替代另一条' }));
    await waitFor(() => expect(current.resolveConflict).toHaveBeenCalledTimes(1));
    const request = vi.mocked(current.resolveConflict).mock
      .calls[0]?.[0] as ResolveMemoryConflictRequest;
    expect(request).toMatchObject({ decision: 'replace', winnerId: 'memory-1' });
    expect(request.applicabilityNote).toBeUndefined();
  });

  it('treats deleted records as terminal and keeps them out of the actionable groups', () => {
    const deleted = memoryViewItem({
      id: 'memory-deleted',
      revisionId: 'memory-deleted-r1',
      status: 'deleted',
      effectiveStatus: 'deleted',
      candidateDisposition: undefined,
    });
    const current = state({ memories: [memoryViewItem(), deleted] });
    render(<MemoryPage state={current} />);

    fireEvent.click(screen.getByText('历史与已停用 · 1 条'));
    expect(screen.getByText('终态记录，不可恢复')).toBeTruthy();
    // 待确认分组里那条仍可「以后不用」；终态记录不得再出现任何动作按钮。
    expect(screen.getAllByRole('button', { name: '以后不用' })).toHaveLength(1);
    expect(screen.getByText('终态记录，不可恢复').closest('article')?.textContent).toContain(
      deleted.content,
    );
  });

  it('surfaces list warnings and the pending projection separately from errors', () => {
    const current = state({
      memories: [memoryViewItem({ sourceAvailability: 'review-required' })],
      warnings: [{ code: 'HISTORY_TRUNCATED', message: '记忆较多，本次只列出最近 50 条。' }],
      projectionState: 'pending',
      error: '',
    });
    render(<MemoryPage state={current} />);

    expect(screen.getByText('记忆较多，本次只列出最近 50 条。')).toBeTruthy();
    expect(screen.getByText('记忆已保存，Markdown 投影待重建。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重建投影' })).toBeTruthy();
    expect(screen.getByText('来源待复核')).toBeTruthy();
    expect(screen.getByRole('button', { name: '复核来源' })).toBeTruthy();
  });

  it('limits expert memory management to the selected scope', () => {
    const currentWorkspaceMemory = memoryViewItem({
      id: 'expert-workspace-memory-1',
      revisionId: 'expert-workspace-memory-1-r1',
      scope: { kind: 'expert-workspace', expertId: 'expert-1', workspaceId: 'workspace-1' },
      content: '当前工作空间的经验。',
    });
    const otherWorkspaceMemory = memoryViewItem({
      id: 'expert-workspace-memory-2',
      revisionId: 'expert-workspace-memory-2-r1',
      scope: { kind: 'expert-workspace', expertId: 'expert-1', workspaceId: 'workspace-2' },
      content: '其他工作空间的经验。',
    });
    const expertMemory = memoryViewItem({
      id: 'expert-memory-1',
      revisionId: 'expert-memory-1-r1',
      scope: { kind: 'expert', expertId: 'expert-1' },
      content: '专家通用经验。',
    });
    const create = vi.fn(async (): Promise<MemoryMutationOutcome> => success);
    const update = vi.fn(async (): Promise<MemoryMutationOutcome> => success);
    const current = state({
      memories: [currentWorkspaceMemory, otherWorkspaceMemory, expertMemory],
      create,
      update,
    });
    const clearScope = vi.fn();
    const scopeTarget: MemoryManagementTarget = {
      expertId: 'expert-1',
      expertName: '经营分析专家',
      workspaceId: 'workspace-1',
    };
    render(
      <MemoryPage
        state={current}
        scopeTarget={scopeTarget}
        onClearScope={clearScope}
        workspaceId="workspace-1"
      />,
    );

    expect(screen.getByText('当前范围：经营分析专家 · 当前工作空间')).toBeTruthy();
    expect(screen.getByText(currentWorkspaceMemory.content)).toBeTruthy();
    expect(screen.getByText(expertMemory.content)).toBeTruthy();
    expect(screen.queryByText(otherWorkspaceMemory.content)).toBeNull();
    // 有专家时默认落在「专家与工作空间」，不静默提升为专家通用或全局。
    fireEvent.click(screen.getByRole('button', { name: /新增经验/ }));
    fireEvent.change(screen.getByRole('textbox', { name: '记忆正文' }), {
      target: { value: '专家每次先核对规则。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存为经验' }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: 'expert-workspace', expertId: 'expert-1', workspaceId: 'workspace-1' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '查看全部记忆' }));
    expect(clearScope).toHaveBeenCalledTimes(1);
  });

  it('edits a confirmed memory through update with the current revision', async () => {
    const confirmed = memoryViewItem({
      id: 'memory-confirmed',
      revisionId: 'memory-confirmed-r2',
      revision: 2,
      status: 'confirmed',
      effectiveStatus: 'confirmed',
      candidateDisposition: undefined,
      content: '先列异常，再列总体指标。',
    });
    const update = vi.fn(async (): Promise<MemoryMutationOutcome> => success);
    const current = state({ memories: [confirmed], update });
    render(<MemoryPage state={current} />);

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByRole('textbox', { name: '记忆正文' }), {
      target: { value: '先列异常和待决策事项，再列总体指标。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const input = vi.mocked(current.update).mock.calls[0]?.[0] as UpdateMemoryRequest;
    expect(input).toMatchObject({
      id: 'memory-confirmed',
      expectedRevision: 2,
      patch: { content: '先列异常和待决策事项，再列总体指标。' },
    });
    expect(input.operationId).toMatch(UUID_PATTERN);
  });

  it('把待澄清与重复的计数作为管理提示，并给重复候选行内标记', () => {
    const unresolved = {
      leftRevisionId: 'memory-left-r1',
      rightRevisionId: 'memory-right-r1',
      state: 'unresolved' as const,
    };
    const left = memoryViewItem({
      id: 'memory-left',
      revisionId: 'memory-left-r1',
      status: 'confirmed',
      effectiveStatus: 'confirmed',
      candidateDisposition: undefined,
      content: '收入按回款金额统计。',
      conflicts: [unresolved],
    });
    const right = memoryViewItem({
      id: 'memory-right',
      revisionId: 'memory-right-r1',
      status: 'confirmed',
      effectiveStatus: 'confirmed',
      candidateDisposition: undefined,
      content: '收入按签约金额统计。',
      conflicts: [unresolved],
    });
    const duplicate = memoryViewItem({
      id: 'memory-duplicate',
      revisionId: 'memory-duplicate-r1',
      content: '交付物优先使用中文。',
      duplicatesConfirmedMemoryId: 'memory-left',
    });
    render(<MemoryPage state={state({ memories: [left, right, duplicate] })} />);

    // 同一对两侧都带这条冲突，计数只算一组（契约 §10）。
    expect(screen.getByText(/1 组口径待澄清 · 1 条候选与已确认记忆重复/)).toBeTruthy();
    expect(screen.getByText(/与已确认记忆重复：确认后会出现两条同口径记录/)).toBeTruthy();
  });

  it('没有待澄清与重复时不显示管理提示', () => {
    render(<MemoryPage state={state()} />);
    expect(screen.queryByText(/组口径待澄清/)).toBeNull();
  });
});

describe('MemoryPage 召回策略（MI06）', () => {
  afterEach(cleanup);

  const confirmed = (overrides?: Partial<MemoryViewItem>): MemoryViewItem =>
    memoryViewItem({
      status: 'confirmed',
      effectiveStatus: 'confirmed',
      candidateDisposition: undefined,
      facet: 'constraint',
      ...overrides,
    });

  it('默认按相关性选择，可显式设为优先带入并追加修订提交', async () => {
    const current = state({ memories: [confirmed()] });
    render(<MemoryPage state={current} />);

    expect(screen.getByText('按相关性选择')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '设为优先带入' }));
    await waitFor(() => expect(current.update).toHaveBeenCalledTimes(1));
    const input = vi.mocked(current.update).mock.calls[0]?.[0];
    expect(input).toMatchObject({
      id: 'memory-1',
      expectedRevision: 1,
      patch: { recallPolicy: 'pinned' },
    });
    expect(String(vi.mocked(current.update).mock.calls[0]?.[0]?.operationId ?? '')).toMatch(
      UUID_PATTERN,
    );
  });

  it('已优先的记录可取消，且措辞不承诺模型一定采用', async () => {
    const current = state({ memories: [confirmed({ recallPolicy: 'pinned' })] });
    render(<MemoryPage state={current} />);

    expect(screen.getByText('优先带入')).toBeDefined();
    const hint = screen.getByText(/优先带入只免/);
    expect(hint.textContent).toContain('不表示模型一定采用');
    expect(hint.textContent).not.toContain('模型已阅读');

    fireEvent.click(screen.getByRole('button', { name: '取消优先带入' }));
    await waitFor(() => expect(current.update).toHaveBeenCalledTimes(1));
    expect(vi.mocked(current.update).mock.calls[0]?.[0]).toMatchObject({
      patch: { recallPolicy: 'relevant' },
    });
  });

  it('Main 拒绝不合格策略时把原因显示在列表内，不改口径为已保存', async () => {
    const current = state({
      memories: [confirmed({ facet: 'fact' })],
      error: '优先带入只用于工作要求，事实与经验仍按相关性选择。',
    });
    render(<MemoryPage state={current} />);
    expect(screen.getByText('优先带入只用于工作要求，事实与经验仍按相关性选择。')).toBeDefined();
  });

  it('终态记录不提供策略开关', () => {
    const current = state({
      memories: [confirmed({ status: 'deleted', effectiveStatus: 'rejected' })],
    });
    render(<MemoryPage state={current} />);
    expect(screen.queryByRole('button', { name: '设为优先带入' })).toBeNull();
  });
});

describe('MemoryPage 冲突来源回看（MI07）', () => {
  afterEach(cleanup);

  const pairOf = (state: MemoryConflictPair['state'], note?: string): MemoryConflictPair =>
    state === 'keep-both'
      ? {
          leftRevisionId: 'memory-1-r1',
          rightRevisionId: 'memory-2-r1',
          state,
          applicabilityNote: note ?? '签约口径用于合同，回款口径用于月报。',
        }
      : { leftRevisionId: 'memory-1-r1', rightRevisionId: 'memory-2-r1', state };

  const sides = (): MemoryViewItem[] => [
    memoryViewItem({
      conflicts: [pairOf('keep-both')],
      status: 'confirmed',
      effectiveStatus: 'confirmed',
      candidateDisposition: undefined,
    }),
    memoryViewItem({
      id: 'memory-2',
      revisionId: 'memory-2-r1',
      content: '收入按回款金额统计。',
      status: 'confirmed',
      effectiveStatus: 'confirmed',
      candidateDisposition: undefined,
    }),
  ];

  it('默认只说「可能冲突」，展开后按精确修订显示两侧来源摘要', async () => {
    const loadRevision = vi.fn(
      async (input: GetMemoryRequest): Promise<MemoryOutcome<MemoryViewItem>> => ({
        ok: true,
        data: memoryViewItem({
          content: '收入按回款金额统计。',
          ...(input.revisionId === undefined ? {} : { revisionId: input.revisionId }),
        }),
        warnings: [],
      }),
    );
    const current = state({ memories: sides(), loadRevision });
    render(<MemoryPage state={current} />);

    expect(screen.getByText('签约口径用于合同，回款口径用于月报。')).toBeDefined();
    expect(screen.queryByText(/摘录「/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '查看两侧来源' }));
    await waitFor(() => expect(loadRevision).toHaveBeenCalledTimes(2));
    expect(
      await screen.findAllByText(/摘录「先核对财务规则|摘录「收入按回款金额统计/),
    ).toHaveLength(2);
    // 读取按精确修订发起，不拿当前草稿冒充历史裁决对象。
    expect(loadRevision.mock.calls.map((call) => call[0]?.revisionId)).toEqual([
      'memory-1-r1',
      'memory-2-r1',
    ]);
  });

  it('另一条越出可管理范围时不请求也不显示其正文', async () => {
    const loadRevision = vi.fn(
      async (input: GetMemoryRequest): Promise<MemoryOutcome<MemoryViewItem>> => ({
        ok: true,
        data: memoryViewItem({
          ...(input.revisionId === undefined ? {} : { revisionId: input.revisionId }),
        }),
        warnings: [],
      }),
    );
    const orphan = memoryViewItem({
      conflicts: [pairOf('unresolved')],
      status: 'confirmed',
      effectiveStatus: 'confirmed',
      candidateDisposition: undefined,
    });
    const current = state({ memories: [orphan], loadRevision });
    render(<MemoryPage state={current} />);

    fireEvent.click(screen.getByRole('button', { name: '查看两侧来源' }));
    await waitFor(() => expect(loadRevision).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/另一条不在当前管理范围或已不可读取/)).toBeDefined();
    expect(screen.queryByText('收入按回款金额统计。')).toBeNull();
  });
});
