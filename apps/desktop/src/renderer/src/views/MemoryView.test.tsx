// @vitest-environment jsdom

import type { MemoryRecord } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MemoriesState } from '../hooks/use-memories';
import { MemoryPage } from './MemoryView';

const candidate: MemoryRecord = {
  id: 'memory-1',
  revisionId: 'memory-1-r1',
  revision: 1,
  scope: { kind: 'user' },
  kind: 'procedural',
  content: '先核对财务规则。',
  sourceType: 'conversation',
  confidence: 0.8,
  status: 'candidate',
  contentHash: 'hash',
  createdAt: 1,
  updatedAt: 1,
};

const state = (overrides?: Partial<MemoriesState>): MemoriesState => ({
  memories: [candidate],
  loading: false,
  error: '',
  refresh: vi.fn(),
  create: vi.fn(async () => undefined),
  updateContent: vi.fn(async () => undefined),
  setStatus: vi.fn(async () => undefined),
  ...overrides,
});

describe('MemoryPage', () => {
  afterEach(cleanup);

  it('confirms a candidate and supports the explicit memory form', () => {
    const current = state();
    render(<MemoryPage state={current} />);

    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    expect(current.setStatus).toHaveBeenCalledWith(candidate, 'confirmed');

    fireEvent.change(screen.getByPlaceholderText(/经营月报/), {
      target: { value: '交付前检查引用。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '记住' }));
    expect(current.create).toHaveBeenCalledWith({
      scope: { kind: 'user' },
      kind: 'procedural',
      content: '交付前检查引用。',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });
  });

  it('limits expert memory management to the selected workspace and creates scoped memory', () => {
    const currentWorkspaceMemory: MemoryRecord = {
      ...candidate,
      id: 'expert-workspace-memory-1',
      revisionId: 'expert-workspace-memory-1-r1',
      scope: { kind: 'expert-workspace', expertId: 'expert-1', workspaceId: 'workspace-1' },
      content: '当前工作空间的经验。',
    };
    const otherWorkspaceMemory: MemoryRecord = {
      ...candidate,
      id: 'expert-workspace-memory-2',
      revisionId: 'expert-workspace-memory-2-r1',
      scope: { kind: 'expert-workspace', expertId: 'expert-1', workspaceId: 'workspace-2' },
      content: '其他工作空间的经验。',
    };
    const expertMemory: MemoryRecord = {
      ...candidate,
      id: 'expert-memory-1',
      revisionId: 'expert-memory-1-r1',
      scope: { kind: 'expert', expertId: 'expert-1' },
      content: '专家通用经验。',
    };
    const current = state({
      memories: [currentWorkspaceMemory, otherWorkspaceMemory, expertMemory],
    });
    const clearScope = vi.fn();
    render(
      <MemoryPage
        state={current}
        scopeTarget={{
          expertId: 'expert-1',
          expertName: '经营分析专家',
          workspaceId: 'workspace-1',
        }}
        onClearScope={clearScope}
      />,
    );

    expect(screen.getByText('当前范围：经营分析专家 · 当前工作空间')).toBeTruthy();
    expect(screen.getByText(currentWorkspaceMemory.content)).toBeTruthy();
    expect(screen.getByText(expertMemory.content)).toBeTruthy();
    expect(screen.queryByText(otherWorkspaceMemory.content)).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/经营月报/), {
      target: { value: '专家每次先核对规则。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '记住' }));
    expect(current.create).toHaveBeenCalledWith({
      scope: { kind: 'expert-workspace', expertId: 'expert-1', workspaceId: 'workspace-1' },
      kind: 'procedural',
      content: '专家每次先核对规则。',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });
    fireEvent.click(screen.getByRole('button', { name: '查看全部记忆' }));
    expect(clearScope).toHaveBeenCalledTimes(1);
  });
});
