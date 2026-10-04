// @vitest-environment jsdom

import type {
  KnowledgeCollection,
  KnowledgeDocumentSummary,
  ScheduleKnowledgeSource,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScheduleSourcePicker } from './ScheduleSourcePicker';

const knowledgeDocument: KnowledgeDocumentSummary = {
  id: 'document-1',
  title: '经营月报',
  sourcePath: `/tmp/${'长期目录/'.repeat(18)}经营月报.md`,
  format: 'markdown',
  byteSize: 1_200,
  contentHash: 'hash-v1',
  currentRevisionId: 'revision-1',
  sourceStatus: 'unchanged',
  lexicalState: 'ready',
  semanticState: 'disabled',
  collectionIds: [],
  membershipRevision: 1,
  importedAt: 1,
  updatedAt: 1,
};

const emptyCollection: KnowledgeCollection = {
  id: 'collection-1',
  name: '暂存参考',
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
};

const renderPicker = (
  options: {
    sources?: ScheduleKnowledgeSource[];
    documents?: KnowledgeDocumentSummary[];
    collections?: KnowledgeCollection[];
    loading?: boolean;
    error?: string;
    onChange?: (sources: ScheduleKnowledgeSource[]) => void;
  } = {},
) => {
  const onChange = options.onChange ?? vi.fn();
  const onRefresh = vi.fn();
  const view = render(
    <ScheduleSourcePicker
      sources={options.sources ?? []}
      documents={options.documents ?? [knowledgeDocument]}
      collections={options.collections ?? [emptyCollection]}
      loading={options.loading ?? false}
      error={options.error ?? ''}
      onRefresh={onRefresh}
      onChange={onChange}
    />,
  );
  return { ...view, onChange, onRefresh };
};

afterEach(() => cleanup());

describe('ScheduleSourcePicker', () => {
  it('stages documents and purpose inside the modal, then commits only on confirmation', async () => {
    const { onChange } = renderPicker();
    const opener = screen.getByRole('button', { name: '选择知识范围' });
    opener.focus();
    fireEvent.click(opener);
    const picker = screen.getByRole('dialog', { name: '选择定时任务知识范围' });
    fireEvent.click(within(picker).getByRole('checkbox', { name: /经营月报/ }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(within(picker).getByRole('button', { name: '资料用途：经营月报' }));
    const purposeMenu = screen.getByRole('menu', { name: '资料用途：经营月报' });
    fireEvent.click(within(purposeMenu).getByRole('menuitem', { name: '历史对比' }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(within(picker).getByRole('button', { name: '确认选择' }));
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'document', documentId: knowledgeDocument.id, purpose: 'historical-comparison' },
    ]);
  });

  it('discards staged changes on cancel and Esc, then restores focus to the opener', async () => {
    const { onChange } = renderPicker();
    const opener = screen.getByRole('button', { name: '选择知识范围' });
    opener.focus();
    fireEvent.click(opener);
    let picker = screen.getByRole('dialog', { name: '选择定时任务知识范围' });
    fireEvent.click(within(picker).getByRole('checkbox', { name: /经营月报/ }));
    fireEvent.click(within(picker).getByRole('button', { name: '取消' }));
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(globalThis.document.activeElement).toBe(opener));

    opener.focus();
    fireEvent.click(opener);
    picker = screen.getByRole('dialog', { name: '选择定时任务知识范围' });
    fireEvent.click(within(picker).getByRole('checkbox', { name: /经营月报/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '选择定时任务知识范围' })).toBeNull(),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(globalThis.document.activeElement).toBe(opener);
  });

  it('supports searching by path, shows no-match feedback, and renders long paths without losing candidates', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: '选择知识范围' }));
    const search = screen.getByRole('textbox', { name: '搜索文档' });
    fireEvent.change(search, { target: { value: '长期目录' } });
    expect(screen.getByText(knowledgeDocument.sourcePath)).toBeTruthy();
    fireEvent.change(search, { target: { value: '不匹配' } });
    expect(screen.getByText('没有匹配的文档；可修改关键词，或到知识页导入资料。')).toBeTruthy();
  });

  it('allows an empty collection as a valid source scope', () => {
    const existing: ScheduleKnowledgeSource[] = [
      { kind: 'collection', collectionId: emptyCollection.id, purpose: 'background' },
    ];
    const { onChange } = renderPicker({ sources: existing, documents: [] });
    expect(screen.getByText(/已选 1 项/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '选择知识范围' }));
    const picker = screen.getByRole('dialog', { name: '选择定时任务知识范围' });
    fireEvent.click(within(picker).getByRole('tab', { name: '集合（1）' }));
    expect(within(picker).getByRole('checkbox', { name: '暂存参考 · 0 项当前成员' })).toBeTruthy();
    fireEvent.click(within(picker).getByRole('button', { name: '确认选择' }));
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'collection', collectionId: emptyCollection.id, purpose: 'background' },
    ]);
  });

  it('shows a whole-Vault budget warning and blocks mixing broad and narrow ranges', () => {
    const largeVaultDocument = { ...knowledgeDocument, byteSize: 600 * 1024 * 1024 };
    renderPicker({ documents: [largeVaultDocument] });
    fireEvent.click(screen.getByRole('button', { name: '选择知识范围' }));
    const picker = screen.getByRole('dialog', { name: '选择定时任务知识范围' });
    fireEvent.click(within(picker).getByRole('tab', { name: '整个资料库' }));
    fireEvent.click(within(picker).getByRole('checkbox', { name: /默认资料库/ }));
    expect(within(picker).getByText(/超过单期来源预算/)).toBeTruthy();
    fireEvent.click(within(picker).getByRole('tab', { name: /文档/ }));
    expect(
      within(picker)
        .getByRole('checkbox', { name: /经营月报/ })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('requires an unavailable selected object to be removed and blocks commit on query failure', () => {
    const missing: ScheduleKnowledgeSource = {
      kind: 'document',
      documentId: 'deleted-document',
      purpose: 'background',
    };
    const { onChange } = renderPicker({ sources: [missing], documents: [] });
    expect(screen.getByText(/已删除或没有可用修订/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '选择知识范围' }));
    const picker = screen.getByRole('dialog', { name: '选择定时任务知识范围' });
    expect(within(picker).getByRole('button', { name: '确认选择' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.click(
      within(picker).getByRole('button', { name: '移除范围 资料 deleted-document（不可用）' }),
    );
    fireEvent.click(within(picker).getByRole('button', { name: '确认选择' }));
    expect(onChange).toHaveBeenCalledWith([]);

    cleanup();
    const failedPicker = renderPicker({ error: 'Vault 暂不可用。' });
    fireEvent.click(screen.getByRole('button', { name: '选择知识范围' }));
    const errorPicker = screen.getByRole('dialog', { name: '选择定时任务知识范围' });
    fireEvent.click(within(errorPicker).getByRole('button', { name: '重试' }));
    expect(failedPicker.onRefresh).toHaveBeenCalledTimes(1);
    expect(
      within(errorPicker).getByRole('button', { name: '确认选择' }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
