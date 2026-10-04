// @vitest-environment jsdom

import type { KnowledgeCollection, KnowledgeDocumentSummary } from '@betterwork/agent-protocol';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useScheduleSourceCandidates } from './use-schedule-source-candidates';

const document: KnowledgeDocumentSummary = {
  id: 'document-1',
  title: '经营月报',
  sourcePath: '/tmp/合成资料/经营月报.md',
  format: 'markdown',
  byteSize: 100,
  contentHash: 'hash-v1',
  currentRevisionId: 'revision-1',
  sourceStatus: 'unchanged',
  lexicalState: 'ready',
  semanticState: 'disabled',
  collectionIds: ['collection-1'],
  membershipRevision: 1,
  importedAt: 1,
  updatedAt: 1,
};

const collection: KnowledgeCollection = {
  id: 'collection-1',
  name: '经营资料',
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
};

const installKnowledgeApi = (
  overrides: {
    list?: Window['betterwork']['knowledge']['list'];
    listCollections?: Window['betterwork']['knowledge']['listCollections'];
  } = {},
): void => {
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      knowledge: {
        list: overrides.list ?? vi.fn(async () => [document]),
        listCollections: overrides.listCollections ?? vi.fn(async () => [collection]),
      },
    },
  });
};

afterEach(() => cleanup());

describe('useScheduleSourceCandidates', () => {
  it('loads real document and collection summaries from the existing Knowledge API', async () => {
    const list = vi.fn(async () => [document]);
    const listCollections = vi.fn(async () => [collection]);
    installKnowledgeApi({ list, listCollections });
    const { result } = renderHook(() => useScheduleSourceCandidates(true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(list).toHaveBeenCalledWith({ filter: { kind: 'all' } });
    expect(result.current.documents).toEqual([document]);
    expect(result.current.collections).toEqual([collection]);
    expect(result.current.error).toBe('');
  });

  it('presents query failures and retries both candidate sources together', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('Vault 暂不可用。'))
      .mockResolvedValue([document]);
    const listCollections = vi.fn(async () => [collection]);
    installKnowledgeApi({ list, listCollections });
    const { result } = renderHook(() => useScheduleSourceCandidates(true));

    await waitFor(() => expect(result.current.error).toBe('Vault 暂不可用。'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.documents).toEqual([document]);
    expect(result.current.collections).toEqual([collection]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('ignores a late result after the editor releases the candidate query', async () => {
    let release: ((value: KnowledgeDocumentSummary[]) => void) | undefined;
    const list = vi.fn(
      () => new Promise<KnowledgeDocumentSummary[]>((resolve) => (release = resolve)),
    );
    installKnowledgeApi({ list });
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useScheduleSourceCandidates(active),
      { initialProps: { active: true } },
    );

    rerender({ active: false });
    await act(async () => release?.([document]));
    expect(result.current.documents).toEqual([]);
  });
});
