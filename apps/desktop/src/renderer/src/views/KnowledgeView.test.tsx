// @vitest-environment jsdom

import type {
  KnowledgeJobSummary,
  KnowledgeRevisionSummary,
  KnowledgeTextPage,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KnowledgeLibrary } from '../hooks/use-knowledge-library';
import { KnowledgePage } from './KnowledgeView';

/**
 * 资料库视图护栏（KM09，契约 §7/§9/§12）：
 * 检索方式与覆盖必须如实呈现；没有合格模型时不给出可用的开关；
 * 进行中作业必须提供取消入口。人工 UI 验收留给 KM15。
 */

const job = (overrides: Partial<KnowledgeJobSummary> = {}): KnowledgeJobSummary => ({
  id: 'job-1',
  kind: 'rebuild-semantic',
  status: 'running',
  attempt: 1,
  sequence: 2,
  totalCount: 2,
  completedCount: 1,
  failedCount: 0,
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

const revision: KnowledgeRevisionSummary = {
  id: 'rev-2',
  documentId: 'doc-1',
  revision: 2,
  title: '合同条款',
  sourcePath: '/tmp/合同条款.md',
  format: 'markdown',
  byteSize: 24,
  contentHash: 'b'.repeat(64),
  parserVersion: 'text-extract-v1',
  chunkingVersion: 'format-locator-v1',
  textHash: 'c'.repeat(64),
  sectionCount: 1,
  warnings: [],
  importedAt: 1,
  createdAt: 2,
};

const page: KnowledgeTextPage = {
  reference: {
    kind: 'knowledge-revision',
    knowledgeDocumentId: 'doc-1',
    knowledgeRevisionId: 'rev-2',
    contentHash: 'b'.repeat(64),
    sourcePath: '/tmp/合同条款.md',
  },
  textHash: 'c'.repeat(64),
  title: '合同条款',
  parserVersion: 'text-extract-v1',
  chunkingVersion: 'format-locator-v1',
  warnings: [],
  parts: [
    {
      span: { sectionOrdinal: 0, start: 0, end: 7 },
      locator: '全文',
      text: '第二段保存文本',
      excerptHash: 'd'.repeat(64),
    },
  ],
  returnedCodePoints: 7,
  complete: true,
};

const library = (overrides: Partial<KnowledgeLibrary> = {}): KnowledgeLibrary => ({
  documents: [],
  results: [],
  query: '',
  setQuery: () => undefined,
  message: '',
  setMessage: () => undefined,
  issues: [],
  importing: false,
  loading: false,
  loadError: '',
  settings: { semanticEnabled: false, revision: 1, embeddingAvailable: false },
  embeddingModels: [],
  activeJobs: [],
  searchStatus: undefined,
  retryTarget: undefined,
  refresh: () => undefined,
  onImport: async () => undefined,
  onSearch: async () => undefined,
  onOpenSource: async () => undefined,
  onRefresh: async () => undefined,
  onRemove: async () => undefined,
  selectedMaterials: [],
  isSelected: () => false,
  toggleSelect: () => undefined,
  selectAllResults: () => undefined,
  clearSelection: () => undefined,
  researchBusy: false,
  research: async () => undefined,
  saveSettings: async () => undefined,
  rebuildSemantic: async () => undefined,
  cancelJob: async () => undefined,
  retryFailedItems: async () => undefined,
  detailDocument: undefined,
  detailRevisions: [],
  detailRevisionId: undefined,
  detailPage: undefined,
  detailLoading: false,
  detailError: '',
  detailCanGoBack: false,
  openDocument: async () => undefined,
  closeDocument: () => undefined,
  selectDetailRevision: async () => undefined,
  loadNextDetailPage: async () => undefined,
  loadPreviousDetailPage: async () => undefined,
  checkDocumentSource: async () => undefined,
  ...overrides,
});

afterEach(() => cleanup());

describe('KnowledgePage 索引管理护栏（KM09）', () => {
  it('检索结果条展示真实生效方式、降级原因与向量覆盖', () => {
    render(
      <KnowledgePage
        library={library({
          query: '续约',
          searchStatus: {
            effectiveMode: 'hybrid',
            coverage: { eligibleChunks: 20, indexedChunks: 12 },
            degradedReason: 'index-partial',
          },
        })}
        onResearch={() => undefined}
      />,
    );
    expect(
      screen.getByText(/本次检索方式：关键词＋语义 · 部分资料未完成向量索引 · 向量覆盖 12\/20/),
    ).toBeTruthy();
  });

  it('没有合格嵌入模型时语义开关不可用，并解释原因而不只是禁用', () => {
    render(
      <KnowledgePage
        library={library({
          settings: {
            semanticEnabled: false,
            revision: 1,
            embeddingAvailable: false,
            unavailableReason: '还没有配置可用的嵌入模型。',
          },
        })}
        onResearch={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '索引与模型' }));
    const toggle = screen.getByRole('checkbox', { name: '语义检索' });
    expect(toggle.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('还没有配置可用的嵌入模型。')).toBeTruthy();
  });

  it('进行中的作业必须有可见状态与取消入口', () => {
    const cancelJob = vi.fn(async () => undefined);
    render(
      <KnowledgePage
        library={library({ activeJobs: [job()], cancelJob })}
        onResearch={() => undefined}
      />,
    );
    expect(screen.getByText(/向量索引重建：进行中 1\/2/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(cancelJob).toHaveBeenCalledWith('job-1');
  });

  it('启用语义检索前必须经过费用与范围确认，不静默启用', () => {
    const saveSettings = vi.fn(async () => undefined);
    render(
      <KnowledgePage
        library={library({
          settings: { semanticEnabled: false, revision: 1, embeddingAvailable: true },
          saveSettings,
        })}
        onResearch={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '索引与模型' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '语义检索' }));
    expect(saveSettings).not.toHaveBeenCalled();
    expect(screen.getByText('启用语义检索？')).toBeTruthy();
    expect(screen.getByText(/可能产生调用费用/)).toBeTruthy();
  });

  it('详情子视图分开保存文本与原件状态，返回入口常驻', () => {
    const closeDocument = vi.fn();
    render(
      <KnowledgePage
        library={library({
          documents: [
            {
              id: 'doc-1',
              title: '合同条款',
              sourcePath: '/tmp/合同条款.md',
              format: 'markdown',
              byteSize: 24,
              contentHash: 'a'.repeat(64),
              sourceStatus: 'changed',
              sourceCheckedAt: 1_700_000_000_000,
              lexicalState: 'ready',
              semanticState: 'stale',
              importedAt: 1,
              updatedAt: 2,
            },
          ],
          detailDocument: {
            id: 'doc-1',
            title: '合同条款',
            sourcePath: '/tmp/合同条款.md',
            format: 'markdown',
            byteSize: 24,
            contentHash: 'a'.repeat(64),
            sourceStatus: 'changed',
            sourceCheckedAt: 1_700_000_000_000,
            lexicalState: 'ready',
            semanticState: 'stale',
            importedAt: 1,
            updatedAt: 2,
          },
          detailRevisions: [revision],
          detailRevisionId: revision.id,
          detailPage: page,
          closeDocument,
        })}
        onResearch={() => undefined}
      />,
    );
    expect(screen.getByText(/原件已变化/)).toBeTruthy();
    expect(screen.getByText(/向量索引需重建/)).toBeTruthy();
    expect(screen.getByText('第二段保存文本')).toBeTruthy();
    expect(screen.getByText(/已读到结尾/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
    expect(closeDocument).toHaveBeenCalled();
  });
});
