// @vitest-environment jsdom

import type { KnowledgeDocumentSummary } from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeDocumentCard } from './KnowledgeDocumentCard';

const summary: KnowledgeDocumentSummary = {
  id: 'doc-1',
  title: '合同条款',
  sourcePath: '/tmp/合同条款.md',
  format: 'markdown',
  byteSize: 24,
  contentHash: 'a'.repeat(64),
  sourceStatus: 'unchanged',
  lexicalState: 'ready',
  semanticState: 'disabled',
  collectionIds: [],
  membershipRevision: 1,
  importedAt: 1,
  updatedAt: 2,
};

const cardProps = (overrides?: Partial<React.ComponentProps<typeof KnowledgeDocumentCard>>) => ({
  document: summary,
  onOpen: vi.fn(),
  onRefresh: vi.fn(),
  onRemove: vi.fn(),
  onOpenDetail: vi.fn(),
  ...overrides,
});

const trigger = (): HTMLElement => screen.getByRole('button', { name: '更多操作：合同条款' });

afterEach(cleanup);

describe('KnowledgeDocumentCard 更多操作', () => {
  it('走 PopoverMenu 基座：带背板与 menuitem，而不是自造 details 面板', () => {
    const { container } = render(<KnowledgeDocumentCard {...cardProps()} />);
    expect(container.querySelector('details'), 'details 没有「点别处即收起」的语义').toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(container.ownerDocument.body.querySelector('.popover-backdrop')).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  });

  it('选中项回到对应动作并收起菜单，破坏性项带 danger 语义', () => {
    const onRemove = vi.fn();
    render(<KnowledgeDocumentCard {...cardProps({ onRemove })} />);
    fireEvent.click(trigger());

    const remove = screen.getByRole('menuitem', { name: '移出资料库' });
    expect(remove.className).toContain('danger');
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('作业进行中时刷新与移除标为不可用，点击被挡下', () => {
    const onRefresh = vi.fn();
    render(<KnowledgeDocumentCard {...cardProps({ busy: true, onRefresh })} />);
    fireEvent.click(trigger());

    const refresh = screen.getByRole('menuitem', { name: '刷新索引' });
    expect(refresh.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(refresh);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
