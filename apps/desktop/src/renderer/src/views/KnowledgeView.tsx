import type {
  KnowledgeCollection,
  KnowledgeDocumentSummary,
  KnowledgeLibraryFilter,
  KnowledgeSearchHit,
} from '@betterwork/agent-protocol';
import { useCallback, useState } from 'react';

import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { EmptyPage, ErrorPage, LoadingPage } from '../components/EmptyState';
import { FieldSelect } from '../components/FieldSelect';
import { KnowledgeDocumentCard } from '../components/KnowledgeDocumentCard';
import { PageHeader } from '../components/layout/PageHeader';
import { PageToolbar } from '../components/layout/PageToolbar';
import { ScrollRegion } from '../components/layout/ScrollRegion';
import { ViewContainer } from '../components/layout/ViewContainer';
import { TransientToast } from '../components/TransientToast';
import type { KnowledgeLibrary } from '../hooks/use-knowledge-library';
import { knowledgeJobTitle } from '../hooks/use-knowledge-library';
import { PlusIcon } from '../icons';
import { reportAction, trackAction } from '../lib/async-action';
import { formatTime } from '../lib/format';

interface KnowledgeToast {
  tone: 'success' | 'error';
  message: string;
}

const MODE_LABELS: Record<string, string> = {
  keyword: '关键词',
  hybrid: '关键词＋语义',
  vector: '语义（向量）',
};

const SOURCE_STATE_LABELS: Record<KnowledgeDocumentSummary['sourceStatus'], string> = {
  unchecked: '来源未检查',
  unchanged: '来源一致',
  changed: '原件已变化',
  missing: '原件缺失',
  unreadable: '原件不可读',
};

const SEMANTIC_STATE_LABELS: Record<KnowledgeDocumentSummary['semanticState'], string> = {
  disabled: '未启用',
  pending: '待建索引',
  ready: '就绪',
  partial: '部分就绪',
  stale: '需重建',
  failed: '建索引失败',
};

const sourceStateLine = (
  document: KnowledgeDocumentSummary,
  revision: { revision: number } | undefined,
): string =>
  [
    revision ? `第 ${revision.revision} 版` : '尚未建立保存版本',
    `${SOURCE_STATE_LABELS[document.sourceStatus]}${
      document.sourceCheckedAt
        ? `（检查于 ${formatTime(document.sourceCheckedAt)}）`
        : '（尚未检查）'
    }`,
    `关键词索引${document.lexicalState === 'ready' ? '就绪' : '失败'}`,
    `向量索引${SEMANTIC_STATE_LABELS[document.semanticState]}`,
  ].join(' · ');

/** FieldSelect 用扁平 id 表达筛选；集合项加前缀避免与派生视图撞名。 */
const COLLECTION_OPTION_PREFIX = 'collection:';

const filterOptionId = (value: KnowledgeLibraryFilter): string =>
  value.kind === 'collection' ? `${COLLECTION_OPTION_PREFIX}${value.collectionId}` : value.kind;

const DEGRADED_LABELS: Record<string, string> = {
  'semantic-disabled': '未启用语义检索',
  'model-unavailable': '嵌入模型不可用',
  'index-missing': '尚未建立语义索引',
  'index-partial': '部分资料未完成向量索引',
  'index-stale': '索引代次已过期，需要重建',
  'embedding-failed': '嵌入服务调用失败',
  'capacity-exceeded': '索引规模已达上限',
};

/**
 * 资料库视图。状态与动作全部来自 useKnowledgeLibrary，
 * 视图只负责呈现，因此这里没有任何 IPC 调用。
 */
export function KnowledgePage({
  library,
  onResearch,
}: {
  library: KnowledgeLibrary;
  onResearch: () => void;
}): React.JSX.Element {
  const {
    documents,
    results,
    query,
    setQuery,
    selectedMaterials,
    isSelected,
    toggleSelect,
    selectAllResults,
    clearSelection,
    researchBusy,
    message,
    issues,
    importing,
    loading,
    loadError,
    settings,
    embeddingModels,
    activeJobs,
    searchStatus,
    retryTarget,
    refresh,
    onImport,
    onSearch,
    onOpenSource,
    onRefresh,
    onRemove,
    saveSettings,
    rebuildSemantic,
    cancelJob,
    retryFailedItems,
    detailDocument,
    detailRevisions,
    detailRevisionId,
    detailPage,
    detailLoading,
    detailError,
    detailCanGoBack,
    openDocument,
    closeDocument,
    selectDetailRevision,
    loadNextDetailPage,
    loadPreviousDetailPage,
    checkDocumentSource,
    collections,
    filter,
    setFilter,
    createCollection,
    renameCollection,
    deleteCollection,
    saveDocumentCollections,
  } = library;
  const detailRevision = detailRevisions.find((revision) => revision.id === detailRevisionId);
  const showingResults = Boolean(query.trim());
  const items: Array<{
    document: KnowledgeDocumentSummary;
    excerpt?: string;
    locator?: string;
    hit?: KnowledgeSearchHit;
  }> = showingResults
    ? results.flatMap((hit) => {
        // 命中身份必须落回登记的资料卡片；库范围检索不到登记文档的命中直接不显示，不伪造卡片。
        const document = documents.find((entry) => entry.id === hit.reference.knowledgeDocumentId);
        return document ? [{ document, locator: hit.locator, excerpt: hit.excerpt, hit }] : [];
      })
    : documents.map((document) => ({ document }));
  const [toast, setToast] = useState<KnowledgeToast>();
  const [removalTarget, setRemovalTarget] = useState<KnowledgeDocumentSummary>();
  const [adminOpen, setAdminOpen] = useState(false);
  const [pendingEnable, setPendingEnable] = useState<{ profileId: string }>();
  const [pendingRebuild, setPendingRebuild] = useState<'normal' | 'forced'>();
  const [pendingCollectionDelete, setPendingCollectionDelete] = useState<KnowledgeCollection>();
  const [newCollectionName, setNewCollectionName] = useState('');
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [memberDraft, setMemberDraft] = useState<{ documentId: string; ids: string[] }>();
  const dismissToast = useCallback(() => setToast(undefined), []);

  const filterOptions = [
    { id: 'all', label: '全部资料' },
    { id: 'uncategorized', label: '未分类' },
    ...collections.map((collection) => ({
      id: `${COLLECTION_OPTION_PREFIX}${collection.id}`,
      label: collection.name,
    })),
  ];

  const semanticOn = settings?.semanticEnabled ?? false;
  const enableAllowed = semanticOn || (settings?.embeddingAvailable ?? false);
  const profileOptions = embeddingModels.map((model) => ({
    id: model.id,
    label: `${model.name} · ${model.model}`,
  }));
  const selectedProfileId = settings?.embeddingProfileId ?? embeddingModels[0]?.id ?? '';
  const detailMemberIds =
    detailDocument && memberDraft?.documentId === detailDocument.id
      ? memberDraft.ids
      : (detailDocument?.collectionIds ?? []);

  return (
    <>
      <PageHeader
        eyebrow="知识 · 个人资料库"
        title="让资料成为下一次工作的起点"
        actions={
          <button
            className="primary-button"
            disabled={importing}
            onClick={() => trackAction(onImport(), '导入资料')}
          >
            {importing ? (
              '正在处理…'
            ) : (
              <>
                <PlusIcon size={13} /> 导入资料
              </>
            )}
          </button>
        }
      />
      <div className="page-scroll knowledge-scroll">
        <section className="page-body knowledge-page">
          <p className="page-intro">
            资料保留在你的本机路径；算台只建立可重建的本地文本索引。当前支持 Markdown、文本、PDF、
            Word、工作簿、CSV 与演示文稿。
          </p>
          <PageToolbar ariaLabel="资料库操作">
            <FieldSelect
              options={filterOptions}
              value={filterOptionId(filter)}
              ariaLabel="按集合筛选资料"
              onChange={(id) =>
                setFilter(
                  id.startsWith(COLLECTION_OPTION_PREFIX)
                    ? {
                        kind: 'collection',
                        collectionId: id.slice(COLLECTION_OPTION_PREFIX.length),
                      }
                    : { kind: id === 'uncategorized' ? 'uncategorized' : 'all' },
                )
              }
            />
            <form
              className="knowledge-search"
              onSubmit={(event) => trackAction(onSearch(event), '检索资料')}
            >
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索资料库中的内容…"
                aria-label="搜索个人资料库"
              />
              <button type="submit">搜索</button>
              {showingResults && (
                <button type="button" className="clear-search" onClick={() => setQuery('')}>
                  清除
                </button>
              )}
            </form>
            <button
              type="button"
              className="knowledge-admin-toggle"
              aria-expanded={adminOpen}
              onClick={() => setAdminOpen((open) => !open)}
            >
              索引与模型
            </button>
          </PageToolbar>
          {adminOpen && (
            <section className="knowledge-admin" aria-label="索引与模型管理">
              <div className="knowledge-admin-row">
                <label className="knowledge-admin-switch">
                  <input
                    type="checkbox"
                    checked={semanticOn}
                    disabled={!enableAllowed}
                    onChange={(event) => {
                      const next = event.target.checked;
                      if (next) {
                        setPendingEnable({ profileId: selectedProfileId });
                      } else {
                        trackAction(saveSettings({ semanticEnabled: false }), '停用语义检索');
                      }
                    }}
                  />
                  语义检索
                </label>
                {!enableAllowed && (
                  <small>
                    {settings?.unavailableReason ??
                      '还没有可用的嵌入模型，请先到模型设置配置；关键词检索不受影响。'}
                  </small>
                )}
                {enableAllowed && profileOptions.length > 0 && (
                  <div className="knowledge-admin-profile">
                    <span>嵌入模型</span>
                    <FieldSelect
                      options={profileOptions}
                      value={selectedProfileId}
                      ariaLabel="选择嵌入模型"
                      onChange={(id) => {
                        if (!semanticOn) {
                          setPendingEnable({ profileId: id });
                          return;
                        }
                        trackAction(
                          saveSettings({ semanticEnabled: true, embeddingProfileId: id }),
                          '切换嵌入模型',
                        );
                      }}
                    />
                    <small>切换模型后需手动重建，旧向量不会混入新查询。</small>
                  </div>
                )}
              </div>
              <div className="knowledge-admin-row">
                <button
                  type="button"
                  disabled={!semanticOn}
                  onClick={() => setPendingRebuild('normal')}
                >
                  重建语义索引
                </button>
                <button
                  type="button"
                  className="knowledge-admin-danger"
                  disabled={!semanticOn}
                  onClick={() => setPendingRebuild('forced')}
                >
                  强制重建语义索引
                </button>
                <small>
                  普通重建只更新当前资料的兼容索引；强制重建会立即停用全部旧语义索引。关键词检索始终可用。
                </small>
              </div>
              <div className="knowledge-admin-row knowledge-collections">
                <strong>集合管理</strong>
                <form
                  className="knowledge-collection-create"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = newCollectionName.trim();
                    if (!name) return;
                    setNewCollectionName('');
                    trackAction(createCollection(name), '新建集合');
                  }}
                >
                  <input
                    value={newCollectionName}
                    onChange={(event) => setNewCollectionName(event.target.value)}
                    placeholder="新集合名称…"
                    aria-label="新集合名称"
                    maxLength={60}
                  />
                  <button type="submit" disabled={!newCollectionName.trim()}>
                    新建
                  </button>
                </form>
                {collections.length === 0 && <small>还没有集合；资料可先留在全部资料中。</small>}
                {collections.map((collection) => {
                  const draftName = renameDrafts[collection.id] ?? collection.name;
                  return (
                    <div className="knowledge-collection-row" key={collection.id}>
                      <input
                        value={draftName}
                        onChange={(event) =>
                          setRenameDrafts((drafts) => ({
                            ...drafts,
                            [collection.id]: event.target.value,
                          }))
                        }
                        aria-label={`集合「${collection.name}」的新名称`}
                        maxLength={60}
                      />
                      <button
                        type="button"
                        disabled={!draftName.trim() || draftName.trim() === collection.name}
                        onClick={() => {
                          const name = draftName.trim();
                          setRenameDrafts((drafts) => {
                            const next = { ...drafts };
                            delete next[collection.id];
                            return next;
                          });
                          trackAction(
                            renameCollection(collection.id, name, collection.revision),
                            '改名集合',
                          );
                        }}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        className="knowledge-admin-danger"
                        onClick={() => setPendingCollectionDelete(collection)}
                      >
                        删除
                      </button>
                    </div>
                  );
                })}
                <small>集合只是本地分类：不移动本机文件，也不改变任务已固定的材料。</small>
              </div>
            </section>
          )}
          {activeJobs.length > 0 && (
            <section className="knowledge-jobs" aria-label="进行中的索引作业">
              {activeJobs.map((job) => (
                <div className="knowledge-job-row" key={job.id}>
                  <span>
                    {knowledgeJobTitle(job.kind)}：
                    {job.status === 'queued'
                      ? '排队中'
                      : `进行中 ${job.completedCount}/${job.totalCount}`}
                  </span>
                  <button type="button" onClick={() => trackAction(cancelJob(job.id), '取消作业')}>
                    取消
                  </button>
                </div>
              ))}
            </section>
          )}
          {message && <p className="inline-message">{message}</p>}
          {issues.length > 0 && (
            <div className="knowledge-issues">
              <strong>以下条目未完成</strong>
              <ul>
                {issues.map((issue, index) => (
                  <li key={`${index}-${issue}`}>{issue}</li>
                ))}
              </ul>
              {retryTarget && (
                <button
                  type="button"
                  onClick={() => trackAction(retryFailedItems(), '重试失败条目')}
                >
                  重试未完成条目（{retryTarget.itemIds.length}）
                </button>
              )}
            </div>
          )}
          <div className="knowledge-summary">
            <span>
              {showingResults
                ? `找到 ${items.length} 条相关资料`
                : `已整理 ${documents.length} 份资料`}
            </span>
            <div className="knowledge-summary-actions">
              {showingResults && searchStatus ? (
                <small>
                  {`本次检索方式：${MODE_LABELS[searchStatus.effectiveMode] ?? searchStatus.effectiveMode}`}
                  {searchStatus.degradedReason
                    ? ` · ${DEGRADED_LABELS[searchStatus.degradedReason] ?? searchStatus.degradedReason}`
                    : ''}
                  {` · 向量覆盖 ${searchStatus.coverage.indexedChunks}/${searchStatus.coverage.eligibleChunks}`}
                </small>
              ) : (
                <small>
                  {showingResults ? '检索仅在本地资料库中进行' : '提交搜索后可见检索方式与覆盖状态'}
                </small>
              )}
              {showingResults && items.length > 0 && (
                <button type="button" onClick={selectAllResults}>
                  全选结果
                </button>
              )}
              {showingResults && selectedMaterials.length > 0 && (
                <button type="button" onClick={clearSelection}>
                  清除选择
                </button>
              )}
              {showingResults && (
                <button
                  className="knowledge-research-button"
                  type="button"
                  disabled={selectedMaterials.length === 0 || researchBusy}
                  onClick={onResearch}
                >
                  {researchBusy
                    ? '正在创建草稿…'
                    : `用已选资料研究${selectedMaterials.length > 0 ? `（${selectedMaterials.length}）` : ''}`}
                </button>
              )}
            </div>
          </div>
          {detailDocument && (
            <ScrollRegion ariaLabel="资料详情" className="knowledge-list-scroll">
              <section className="knowledge-detail">
                <header className="knowledge-detail-header">
                  <button type="button" onClick={closeDocument}>
                    返回列表
                  </button>
                  <div>
                    <strong>{detailDocument.title}</strong>
                    <small>{sourceStateLine(detailDocument, detailRevision)}</small>
                  </div>
                </header>
                <div className="knowledge-detail-actions">
                  <button
                    type="button"
                    onClick={() =>
                      reportAction(
                        onOpenSource(detailDocument.sourcePath).then(() =>
                          setToast({
                            tone: 'success',
                            message: `已打开「${detailDocument.title}」的原始资料。`,
                          }),
                        ),
                        (error) =>
                          setToast({ tone: 'error', message: error || '无法打开原始资料。' }),
                      )
                    }
                  >
                    打开本机原件
                  </button>
                  <button
                    type="button"
                    onClick={() => trackAction(checkDocumentSource(detailDocument.id), '检查来源')}
                  >
                    检查来源
                  </button>
                  <button
                    type="button"
                    disabled={importing}
                    onClick={() =>
                      reportAction(
                        onRefresh(detailDocument).then(() =>
                          setToast({
                            tone: 'success',
                            message: `已刷新「${detailDocument.title}」的本地索引。`,
                          }),
                        ),
                        (error) =>
                          setToast({ tone: 'error', message: error || '刷新索引失败，请重试。' }),
                      )
                    }
                  >
                    刷新内容
                  </button>
                  <button
                    type="button"
                    className="knowledge-admin-danger"
                    onClick={() => setRemovalTarget(detailDocument)}
                  >
                    移出资料库
                  </button>
                </div>
                <p className="knowledge-detail-hint">
                  预览读取的是已保存文本：不产生任务访问记录，也不调用模型；原件变化不会自动刷新索引。
                </p>
                {detailError && <p className="inline-message">{detailError}</p>}
                <section className="knowledge-detail-revisions" aria-label="保存版本列表">
                  <strong>保存版本</strong>
                  {detailRevisions.length === 0 && !detailLoading && <small>暂无历史版本。</small>}
                  {detailRevisions.map((revision) => (
                    <div className="knowledge-revision-row" key={revision.id}>
                      <button
                        type="button"
                        disabled={revision.id === detailRevisionId}
                        onClick={() =>
                          trackAction(selectDetailRevision(revision.id), '切换保存版本')
                        }
                      >
                        第 {revision.revision} 版
                      </button>
                      <small>
                        {`哈希 ${revision.contentHash.slice(0, 8)} · ${formatTime(revision.createdAt)}${
                          revision.warnings.length > 0
                            ? ` · 提取警告 ${revision.warnings.join('、')}`
                            : ''
                        }`}
                      </small>
                    </div>
                  ))}
                </section>
                <section className="knowledge-detail-members" aria-label="所属集合">
                  <strong>集合</strong>
                  {collections.length === 0 && (
                    <small>还没有集合，可在「索引与模型」面板新建。</small>
                  )}
                  {collections.map((collection) => (
                    <label className="knowledge-collection-check" key={collection.id}>
                      <input
                        type="checkbox"
                        checked={detailMemberIds.includes(collection.id)}
                        onChange={(event) =>
                          setMemberDraft({
                            documentId: detailDocument.id,
                            ids: event.target.checked
                              ? [...detailMemberIds, collection.id]
                              : detailMemberIds.filter((id) => id !== collection.id),
                          })
                        }
                      />
                      {collection.name}
                    </label>
                  ))}
                  <div>
                    <button
                      type="button"
                      disabled={memberDraft?.documentId !== detailDocument.id}
                      onClick={() => {
                        const ids = memberDraft?.ids ?? [];
                        setMemberDraft(undefined);
                        trackAction(
                          saveDocumentCollections(
                            detailDocument.id,
                            detailDocument.membershipRevision,
                            ids,
                          ),
                          '保存集合分类',
                        );
                      }}
                    >
                      保存分类
                    </button>
                    <small>勾选即加入、取消即移出；分类不改变内容版本，也不动任务材料。</small>
                  </div>
                </section>
                <section className="knowledge-detail-text" aria-label="保存文本预览">
                  {detailLoading && <small>正在读取保存文本…</small>}
                  {detailPage?.parts.map((part) => (
                    <article key={`${part.locator}-${part.span.start}`}>
                      <small>{part.locator}</small>
                      <p>{part.text}</p>
                    </article>
                  ))}
                  {detailPage && (
                    <footer className="knowledge-detail-pager">
                      <button
                        type="button"
                        disabled={!detailCanGoBack || detailLoading}
                        onClick={() => trackAction(loadPreviousDetailPage(), '上一页')}
                      >
                        上一页
                      </button>
                      <small>
                        {detailPage.complete
                          ? `已读到结尾（本页 ${detailPage.returnedCodePoints} 字）`
                          : `本页 ${detailPage.returnedCodePoints} 字，仍有后续内容`}
                      </small>
                      <button
                        type="button"
                        disabled={!detailPage.nextCursor || detailLoading}
                        onClick={() => trackAction(loadNextDetailPage(), '下一页')}
                      >
                        下一页
                      </button>
                    </footer>
                  )}
                </section>
              </section>
            </ScrollRegion>
          )}
          {!detailDocument && (
            <ScrollRegion
              ariaLabel="知识资料列表"
              busy={importing}
              className="knowledge-list-scroll"
            >
              {loading ? (
                <LoadingPage />
              ) : loadError ? (
                <ErrorPage detail={loadError} onRetry={refresh} />
              ) : items.length === 0 ? (
                <EmptyPage
                  eyebrow={showingResults ? '没有匹配结果' : '从一份资料开始'}
                  title={showingResults ? '换个关键词试试' : '把常用资料放进你的资料库'}
                  detail={
                    showingResults
                      ? '当前先按文本内容进行本地检索。'
                      : '导入 Markdown、文本、PDF、Word、工作簿、CSV 或演示文稿后，它们会在后续研究和写作中成为可引用的个人资料。'
                  }
                />
              ) : (
                <ViewContainer mode="list">
                  {items.map(({ document, excerpt, locator, hit }) => (
                    <KnowledgeDocumentCard
                      key={`${document.id}-${locator ?? 'document'}`}
                      document={document}
                      {...(excerpt ? { excerpt } : {})}
                      {...(locator ? { locator } : {})}
                      {...(hit
                        ? {
                            select: {
                              checked: isSelected(hit),
                              onToggle: (checked: boolean) => toggleSelect(hit, checked),
                              label: `选择「${document.title}」用于研究`,
                            },
                          }
                        : {})}
                      busy={importing}
                      onOpen={() =>
                        reportAction(
                          onOpenSource(document.sourcePath).then(() =>
                            setToast({
                              tone: 'success',
                              message: `已打开「${document.title}」的原始资料。`,
                            }),
                          ),
                          (error) =>
                            setToast({ tone: 'error', message: error || '无法打开原始资料。' }),
                        )
                      }
                      onRefresh={() =>
                        reportAction(
                          onRefresh(document).then(() =>
                            setToast({
                              tone: 'success',
                              message: `已刷新「${document.title}」的本地索引。`,
                            }),
                          ),
                          (error) =>
                            setToast({
                              tone: 'error',
                              message: error || '刷新索引失败，请重试。',
                            }),
                        )
                      }
                      onRemove={() => setRemovalTarget(document)}
                      onOpenDetail={() => trackAction(openDocument(document), '打开资料详情')}
                    />
                  ))}
                </ViewContainer>
              )}
            </ScrollRegion>
          )}
        </section>
      </div>
      {toast && <TransientToast {...toast} onDismiss={dismissToast} />}
      {removalTarget && (
        <ConfirmationDialog
          title={`移出「${removalTarget.title}」？`}
          detail="这不会删除原始文件，只会删除本地检索索引。"
          confirmLabel="移出资料库"
          onCancel={() => setRemovalTarget(undefined)}
          onConfirm={() => {
            const target = removalTarget;
            setRemovalTarget(undefined);
            trackAction(onRemove(target), '移出资料库');
          }}
        />
      )}
      {pendingCollectionDelete && (
        <ConfirmationDialog
          title={`删除集合「${pendingCollectionDelete.name}」？`}
          detail="只解除这层分类，不会删除资料或本机原件；其他集合与任务材料不受影响。"
          confirmLabel="删除集合"
          onCancel={() => setPendingCollectionDelete(undefined)}
          onConfirm={() => {
            const target = pendingCollectionDelete;
            setPendingCollectionDelete(undefined);
            trackAction(deleteCollection(target.id, target.revision), '删除集合');
          }}
        />
      )}
      {pendingEnable && (
        <ConfirmationDialog
          title="启用语义检索？"
          detail={`将使用「${
            profileOptions.find((option) => option.id === pendingEnable.profileId)?.label ??
            '当前默认嵌入模型'
          }」处理资料库中现有 ${documents.length} 份资料的向量索引；资料文本会发送到该模型服务，可能产生调用费用。启用后新导入资料自动纳入，历史资料需手动重建。`}
          confirmLabel="启用并继续"
          onCancel={() => setPendingEnable(undefined)}
          onConfirm={() => {
            const profileId = pendingEnable.profileId;
            setPendingEnable(undefined);
            trackAction(
              saveSettings({
                semanticEnabled: true,
                ...(profileId ? { embeddingProfileId: profileId } : {}),
              }),
              '启用语义检索',
            );
          }}
        />
      )}
      {pendingRebuild && (
        <ConfirmationDialog
          title={pendingRebuild === 'forced' ? '强制重建语义索引？' : '重建语义索引？'}
          detail={
            pendingRebuild === 'forced'
              ? '全部旧语义索引会立即停用且不会恢复；取消或部分失败也不会退回旧结果。将按当前登记的嵌入模型重建全部现行资料，资料文本会再次发送到模型服务。关键词检索不受影响。'
              : '将按当前嵌入模型为选定范围的现行修订重建向量索引，资料文本会再次发送到模型服务。关键词检索不受影响。'
          }
          confirmLabel={pendingRebuild === 'forced' ? '确认强制重建' : '开始重建'}
          onCancel={() => setPendingRebuild(undefined)}
          onConfirm={() => {
            const forced = pendingRebuild === 'forced';
            setPendingRebuild(undefined);
            trackAction(rebuildSemantic(forced), forced ? '强制重建语义索引' : '重建语义索引');
          }}
        />
      )}
    </>
  );
}
