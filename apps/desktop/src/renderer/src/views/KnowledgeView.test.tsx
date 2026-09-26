// @vitest-environment jsdom

import type {
  KnowledgeCollection,
  KnowledgeDocumentSummary,
  KnowledgeJobItemSummary,
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
  collections: [],
  filter: { kind: 'all' },
  setFilter: () => undefined,
  createCollection: async () => undefined,
  renameCollection: async () => undefined,
  deleteCollection: async () => undefined,
  saveDocumentCollections: async () => undefined,
  activeJobs: [],
  recentJobs: [],
  jobDetail: undefined,
  jobDetailLoading: false,
  jobDetailError: '',
  openJobDetail: async () => undefined,
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
  rebuildKeyword: async () => undefined,
  checkAllSources: async () => undefined,
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
              collectionIds: [],
              membershipRevision: 1,
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
            collectionIds: [],
            membershipRevision: 1,
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

describe('KnowledgePage 集合护栏（KM11）', () => {
  const collection: KnowledgeCollection = {
    id: 'col-1',
    name: '研究',
    revision: 3,
    createdAt: 1,
    updatedAt: 1,
  };
  const documentSummary: KnowledgeDocumentSummary = {
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

  it('集合筛选常驻工具栏；删除集合必须经过「只解除分类」确认', () => {
    const deleteCollection = vi.fn(async () => undefined);
    render(
      <KnowledgePage
        library={library({ collections: [collection], deleteCollection })}
        onResearch={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: '按集合筛选资料' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '索引与模型' }));
    expect(screen.getByText('集合管理')).toBeTruthy();
    expect(screen.getByDisplayValue('研究')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(deleteCollection).not.toHaveBeenCalled();
    expect(screen.getByText('删除集合「研究」？')).toBeTruthy();
    expect(screen.getByText(/只解除这层分类，不会删除资料或本机原件/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除集合' }));
    expect(deleteCollection).toHaveBeenCalledWith('col-1', 3);
  });

  it('详情勾选集合必须显式保存，并按成员修订 CAS 提交', () => {
    const saveDocumentCollections = vi.fn(async () => undefined);
    render(
      <KnowledgePage
        library={library({
          collections: [collection],
          detailDocument: documentSummary,
          detailRevisions: [revision],
          detailRevisionId: revision.id,
          detailPage: page,
          saveDocumentCollections,
        })}
        onResearch={() => undefined}
      />,
    );
    const save = screen.getByRole('button', { name: '保存分类' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: '研究' }));
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);
    expect(saveDocumentCollections).toHaveBeenCalledWith('doc-1', 1, ['col-1']);
  });
});

describe('本机索引动作、作业回看与键盘可达（KM15 走查补齐）', () => {
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

  const item = (overrides: Partial<KnowledgeJobItemSummary> = {}): KnowledgeJobItemSummary => ({
    id: 'item-2',
    jobId: 'job-1',
    fileName: '损坏材料.docx',
    status: 'failed',
    phase: 'extract',
    attempt: 1,
    completedUnits: 0,
    failure: { code: 'INDEX_ITEM_FAILED', message: '解析失败' },
    ...overrides,
  });

  it('索引与模型面板提供关键词重建与当前列表来源检查，两者都不出本机', () => {
    const rebuildKeyword = vi.fn(async () => undefined);
    const checkAllSources = vi.fn(async () => undefined);
    render(
      <KnowledgePage
        library={library({ documents: [summary], rebuildKeyword, checkAllSources })}
        onResearch={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '索引与模型' }));
    fireEvent.click(screen.getByRole('button', { name: '重建关键词索引' }));
    expect(rebuildKeyword).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '检查当前列表来源（1）' }));
    expect(checkAllSources).toHaveBeenCalled();
    expect(screen.getByText(/不调用模型/)).toBeTruthy();
  });

  it('没有资料时不给可点的「检查全部来源」空转按钮', () => {
    render(<KnowledgePage library={library({ documents: [] })} onResearch={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '索引与模型' }));
    const check = screen.getByRole('button', { name: '检查当前列表来源（0）' });
    expect(check.hasAttribute('disabled')).toBe(true);
  });

  it('已取消的作业留在最近作业里，并可展开逐条目阶段与原因', () => {
    const openJobDetail = vi.fn(async () => undefined);
    render(
      <KnowledgePage
        library={library({
          recentJobs: [
            job({ kind: 'import', status: 'cancelled', completedCount: 1, totalCount: 3 }),
          ],
          openJobDetail,
        })}
        onResearch={() => undefined}
      />,
    );
    expect(screen.getByText('最近作业（含已取消）')).toBeTruthy();
    expect(screen.getByText(/资料导入：已取消 1\/3/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看条目' }));
    expect(openJobDetail).toHaveBeenCalledWith('job-1');
  });

  it('条目行把状态、阶段与失败原因都翻成中文', () => {
    render(
      <KnowledgePage
        library={library({
          recentJobs: [job({ kind: 'import', status: 'partial' })],
          jobDetail: { jobId: 'job-1', items: [item()] },
        })}
        onResearch={() => undefined}
      />,
    );
    expect(screen.getByText(/损坏材料\.docx · 失败 · 解析提取 · 解析失败/)).toBeTruthy();
  });

  it('刷新只在提交作业时给「已提交」，不在后台完成前报刷新成功', async () => {
    render(
      <KnowledgePage
        library={library({
          documents: [summary],
          detailDocument: summary,
          detailRevisions: [revision],
          detailRevisionId: revision.id,
          detailPage: page,
          message: '已提交「合同条款」的刷新作业，索引正在后台重建。',
        })}
        onResearch={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '刷新内容' }));
    expect(screen.queryByText(/已刷新/)).toBeNull();
    expect(screen.getByText('已提交「合同条款」的刷新作业，索引正在后台重建。')).toBeTruthy();
  });

  it('Esc 退出详情子视图；确认框打开时不越级改界面', () => {
    const closeDocument = vi.fn();
    render(
      <KnowledgePage
        library={library({
          documents: [summary],
          detailDocument: summary,
          detailRevisions: [revision],
          detailRevisionId: revision.id,
          detailPage: page,
          closeDocument,
        })}
        onResearch={() => undefined}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeDocument).toHaveBeenCalled();
  });
});
