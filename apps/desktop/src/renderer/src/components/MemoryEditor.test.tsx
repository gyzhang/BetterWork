// @vitest-environment jsdom

import type { MemoryViewItem } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryEditor, type MemoryEditorSubmission } from './MemoryEditor';

/**
 * 重新表述路径（WM03/WM07，契约 §5.3）：界面必须把被重述的**精确修订**随新建请求提交，
 * 否则回执里没有审计线索；同时不得沿用资料选择器，也不得原样复制资料结论。
 */

const materialItem = (content: string): MemoryViewItem => ({
  id: 'memory-1',
  revisionId: 'memory-1-r1',
  revision: 1,
  scope: { kind: 'workspace', workspaceId: 'workspace-1' },
  kind: 'procedural',
  content,
  sourceType: 'conversation',
  confidence: 0.8,
  status: 'confirmed',
  contentHash: 'a'.repeat(64),
  createdAt: 1,
  updatedAt: 1,
  facet: 'constraint',
  normalizedHash: 'b'.repeat(64),
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
        contentHash: 'a'.repeat(64),
        start: 0,
        end: content.length,
        excerpt: content,
        excerptHash: 'b'.repeat(64),
      },
    ],
    materialDependencies: [
      {
        kind: 'knowledge-revision',
        knowledgeDocumentId: 'knowledge-1',
        knowledgeRevisionId: 'knowledge-1-r1',
        contentHash: 'c'.repeat(64),
        sourcePath: '/materials/finance.md',
      },
    ],
    memoryDependencies: [],
  },
  effectiveStatus: 'confirmed',
  sourceAvailability: 'available',
  requiresMaterialSelection: false,
  conflicts: [],
});

const original = materialItem('资料里说收入按回款金额核对。');

const renderEditor = (onSubmit: (submission: MemoryEditorSubmission) => Promise<boolean>) =>
  render(
    <MemoryEditor
      scopes={[{ kind: 'workspace', workspaceId: 'workspace-1' }, { kind: 'user' }]}
      restateFrom={original}
      onSubmit={onSubmit}
      onCancel={() => undefined}
    />,
  );

describe('MemoryEditor 重新表述路径', () => {
  afterEach(cleanup);

  it('提交新建请求时带上被重述的精确修订', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderEditor(onSubmit);
    fireEvent.change(screen.getByLabelText('记忆正文'), {
      target: { value: '收入按回款金额核对，这是我自己的口径。' },
    });
    fireEvent.click(screen.getByRole('button', { name: /作为我的工作口径重新保存|保存/ }));

    const submission = onSubmit.mock.calls[0]?.[0];
    expect(submission?.kind).toBe('create');
    if (submission?.kind !== 'create') return;
    expect(submission.request.fromMemoryRevisionId).toBe('memory-1-r1');
    expect(submission.request.asUserInstruction).toBe(true);
    expect(submission.request.sourceSelector).toBeUndefined();
  });

  // 契约 §5.1 的议题上限要在界面上看得见，但计数一旦排在输入框下面就会把整列撑高，
  // 同一行的分类／适用范围／日期就不再对齐——所以计数必须待在场内。
  it('议题计数待在场内而不是把整行顶歪', () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderEditor(onSubmit);
    const wrapper = screen.getByLabelText('议题标识').parentElement;
    expect(wrapper?.className).toBe('memory-editor-counted');
    expect(wrapper?.querySelector('small')?.textContent).toBe('0 / 80');
  });

  it('原样复制资料结论时不提交', () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderEditor(onSubmit);
    fireEvent.change(screen.getByLabelText('记忆正文'), { target: { value: original.content } });
    fireEvent.click(screen.getByRole('button', { name: /作为我的工作口径重新保存|保存/ }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('MemoryEditor 回答捕获（MI02）', () => {
  afterEach(cleanup);

  const captureSelector = {
    kind: 'run-assistant',
    runId: 'run-1',
    eventId: 'event-1',
    start: 2,
    end: 8,
  } as const;

  const renderCapture = (
    onSubmit: (submission: MemoryEditorSubmission) => Promise<boolean>,
    withSelector: boolean,
  ): void => {
    render(
      <MemoryEditor
        scopes={[{ kind: 'workspace', workspaceId: 'workspace-1' }]}
        initialContent="汇总收入前先核对回款口径。"
        requireSource
        submitLabel="保留来源并记住"
        {...(withSelector ? { sourceSelector: captureSelector } : {})}
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />,
    );
  };

  const fill = (): void => {
    fireEvent.change(screen.getByLabelText('记忆正文'), {
      target: { value: '汇总收入前先核对回款口径。' },
    });
  };

  it('未确认原文选区时不得提交，也不能被当成自主口径', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderCapture(onSubmit, false);
    fill();
    fireEvent.click(screen.getByRole('button', { name: '保留来源并记住' }));
    await Promise.resolve();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('请先在回答原文里确认要保留的来源片段。')).toBeDefined();
  });

  it('带来源选择器提交时保留 selector 且 asUserInstruction 为 false', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderCapture(onSubmit, true);
    fill();
    fireEvent.click(screen.getByRole('button', { name: '保留来源并记住' }));
    const submission = onSubmit.mock.calls[0]?.[0];
    expect(submission?.kind).toBe('create');
    if (submission?.kind !== 'create') return;
    expect(submission.request.asUserInstruction).toBe(false);
    expect(submission.request.sourceSelector).toEqual(captureSelector);
  });
});
