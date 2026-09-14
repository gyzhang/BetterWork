// @vitest-environment jsdom

import type { MemoryRecord } from '@betterwork/agent-protocol';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
});
