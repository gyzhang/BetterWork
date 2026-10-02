import type {
  KnowledgeCollection,
  KnowledgeDocumentSummary,
  KnowledgeLibraryFilter,
  KnowledgeSearchHit,
} from '@betterwork/agent-protocol';
import { useEffect, useState } from 'react';

import { AsyncButton, InlineLoading } from '../components/AsyncButton';
import { Button } from '../components/Button';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { Disclosure } from '../components/Disclosure';
import { EmptyPage, ErrorPage, LoadingPage } from '../components/EmptyState';
import { FieldSelect } from '../components/FieldSelect';
import { IconButton } from '../components/IconButton';
import { InlineError } from '../components/InlineError';
import { KnowledgeDocumentCard } from '../components/KnowledgeDocumentCard';
import { PageHeader } from '../components/layout/PageHeader';
import { PageToolbar } from '../components/layout/PageToolbar';
import { ScrollRegion } from '../components/layout/ScrollRegion';
import { ViewContainer } from '../components/layout/ViewContainer';
import { ListRow } from '../components/ListRow';
import { Modal } from '../components/Modal';
import { SectionHeader } from '../components/SectionHeader';
import { Switch } from '../components/Switch';
import { TextField } from '../components/TextField';
import { TransientToast } from '../components/TransientToast';
import type { KnowledgeLibrary } from '../hooks/use-knowledge-library';
import {
  knowledgeDegradedLabel,
  knowledgeJobItemStatusLabel,
  knowledgeJobPhaseLabel,
  knowledgeJobStatusLabel,
  knowledgeJobTitle,
  knowledgeModeLabel,
} from '../hooks/use-knowledge-library';
import { CloseIcon, PlusIcon } from '../icons';
import { reportAction, trackAction } from '../lib/async-action';
import { formatTime } from '../lib/format';
import { knowledgeSourceStateName } from '../lib/labels';

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
    `${knowledgeSourceStateName[document.sourceStatus]}${
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
    error,
    toast,
    showToast,
    dismissToast,
    issues,
    importing,
    loading,
    loadError,
    settings,
    embeddingModels,
    activeJobs,
    recentJobs,
    clearRecentJobs,
    jobDetail,
    jobDetailLoading,
    jobDetailError,
    openJobDetail,
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
    rebuildKeyword,
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
    checkAllSources,
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
  const [removalTarget, setRemovalTarget] = useState<KnowledgeDocumentSummary>();
  const [indexDrawerOpen, setIndexDrawerOpen] = useState(false);
  const [pendingEnable, setPendingEnable] = useState<{ profileId: string }>();
  const [pendingRebuild, setPendingRebuild] = useState<'normal' | 'forced'>();
  const [pendingCollectionDelete, setPendingCollectionDelete] = useState<KnowledgeCollection>();
  const [pendingJobClear, setPendingJobClear] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [memberDraft, setMemberDraft] = useState<{ documentId: string; ids: string[] }>();
  const dialogOpen =
    removalTarget !== undefined ||
    pendingEnable !== undefined ||
    pendingRebuild !== undefined ||
    pendingCollectionDelete !== undefined ||
    pendingJobClear;

  // 键盘可达：Esc 先收起局部提示，再退出详情子视图。「索引与作业」抽屉与确认框都是
  // Modal 基座的表面，它们自己处理 Esc，页面不越级替它们关。
  useEffect((): (() => void) => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || dialogOpen || indexDrawerOpen) return;
      if (toast) {
        dismissToast();
      } else if (detailDocument) {
        closeDocument();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen, indexDrawerOpen, dismissToast, toast, detailDocument, closeDocument]);

  // 抽屉是模态：关着的时候也要知道有没有作业在跑，进度因此挂在入口按钮上。
  const runningJob = activeJobs.find((job) => job.status === 'running') ?? activeJobs[0];
  const indexEntryLabel = runningJob
    ? `索引与作业 · 进行中 ${runningJob.completedCount}/${runningJob.totalCount}`
    : '索引与作业';

  // 条目回看区跟着「展开了哪条作业」走，不区分它来自进行中还是最近作业。
  const jobDetailVisible = jobDetail !== undefined || jobDetailLoading || jobDetailError !== '';

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
        title={detailDocument?.title ?? '让资料成为下一次工作的起点'}
        leading={
          detailDocument ? (
            <Button variant="link" size="sm" type="button" onClick={closeDocument}>
              返回列表
            </Button>
          ) : undefined
        }
        actions={
          detailDocument ? (
            <Button
              variant="text"
              size="lg"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={indexDrawerOpen}
              onClick={() => setIndexDrawerOpen(true)}
            >
              {indexEntryLabel}
            </Button>
          ) : (
            <AsyncButton
              variant="primary"
              size="lg"
              busy={importing}
              label={
                <>
                  <PlusIcon size={13} /> 导入资料
                </>
              }
              busyLabel="正在处理…"
              onClick={() => trackAction(onImport(), '导入资料')}
            />
          )
        }
      />
      <div className="knowledge-stage">
        <section className="page-body knowledge-page">
          {!detailDocument && (
            <>
              <p className="page-intro">
                资料保留在你的本机路径；算台只建立可重建的本地文本索引。当前支持
                Markdown、文本、PDF、 Word、工作簿、CSV 与演示文稿。
              </p>
              <PageToolbar ariaLabel="资料库操作">
                <FieldSelect
                  size="md"
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
                  <TextField
                    size="md"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索资料库中的内容…"
                    aria-label="搜索个人资料库"
                  />
                  <Button variant="primary" size="md" type="submit">
                    搜索
                  </Button>
                  {showingResults && (
                    <Button variant="outline" size="md" type="button" onClick={() => setQuery('')}>
                      清除
                    </Button>
                  )}
                </form>
                <Button
                  variant="text"
                  size="md"
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={indexDrawerOpen}
                  onClick={() => setIndexDrawerOpen(true)}
                >
                  {indexEntryLabel}
                </Button>
              </PageToolbar>
            </>
          )}
          {indexDrawerOpen && (
            <Modal variant="sheet" label="索引与作业" onClose={() => setIndexDrawerOpen(false)}>
              <SectionHeader
                className="knowledge-drawer-head"
                variant="block"
                title="索引与作业"
                actions={
                  <IconButton
                    size="md"
                    label="关闭"
                    icon={CloseIcon}
                    onClick={() => setIndexDrawerOpen(false)}
                  />
                }
              />
              <div className="knowledge-drawer-body">
                {activeJobs.length > 0 && (
                  <section className="knowledge-jobs" aria-label="进行中的作业">
                    {activeJobs.map((job) => (
                      <ListRow
                        key={job.id}
                        variant="plain"
                        detail={`${knowledgeJobTitle(job.kind)}：${knowledgeJobStatusLabel(job.status)}${
                          job.status === 'running' ? ` ${job.completedCount}/${job.totalCount}` : ''
                        }${job.failedCount > 0 ? ` · 失败 ${job.failedCount}` : ''}`}
                        actions={
                          <>
                            <Button
                              variant="quiet"
                              size="sm"
                              type="button"
                              onClick={() => trackAction(openJobDetail(job.id), '查看作业条目')}
                            >
                              {jobDetail?.jobId === job.id ? '收起条目' : '查看条目'}
                            </Button>
                            <Button
                              variant="quiet"
                              size="sm"
                              type="button"
                              onClick={() => trackAction(cancelJob(job.id), '取消作业')}
                            >
                              取消
                            </Button>
                          </>
                        }
                      />
                    ))}
                  </section>
                )}
                <section className="knowledge-admin" aria-label="索引与模型管理">
                  <div className="knowledge-admin-row">
                    <Switch
                      label="语义检索"
                      checked={semanticOn}
                      disabled={!enableAllowed}
                      onChange={(next) => {
                        if (next) {
                          setPendingEnable({ profileId: selectedProfileId });
                        } else {
                          trackAction(saveSettings({ semanticEnabled: false }), '停用语义检索');
                        }
                      }}
                    />
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
                          size="md"
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
                    <Button
                      variant="secondary"
                      size="md"
                      type="button"
                      disabled={!semanticOn}
                      onClick={() => setPendingRebuild('normal')}
                    >
                      重建语义索引
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      tone="danger"
                      type="button"
                      disabled={!semanticOn}
                      onClick={() => setPendingRebuild('forced')}
                    >
                      强制重建语义索引
                    </Button>
                    <small>
                      普通重建只更新当前资料的兼容索引；强制重建会立即停用全部旧语义索引。关键词检索始终可用。
                    </small>
                  </div>
                  <div className="knowledge-admin-row">
                    <Button
                      variant="secondary"
                      size="md"
                      type="button"
                      onClick={() => trackAction(rebuildKeyword(), '重建关键词索引')}
                    >
                      重建关键词索引
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      type="button"
                      disabled={documents.length === 0}
                      onClick={() => trackAction(checkAllSources(), '检查当前列表来源')}
                    >
                      检查当前列表来源（{documents.length}）
                    </Button>
                    <small>
                      这两项只在本机进行、不调用模型：关键词重建重写全部登记资料的派生索引，来源检查只比对当前列表里的原件与登记内容是否一致。
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
                      <TextField
                        size="md"
                        value={newCollectionName}
                        onChange={(event) => setNewCollectionName(event.target.value)}
                        placeholder="新集合名称…"
                        aria-label="新集合名称"
                        maxLength={60}
                      />
                      <Button
                        variant="secondary"
                        size="md"
                        type="submit"
                        disabled={!newCollectionName.trim()}
                      >
                        新建
                      </Button>
                    </form>
                    {collections.length === 0 && (
                      <small>还没有集合；资料可先留在全部资料中。</small>
                    )}
                    {collections.map((collection) => {
                      const draftName = renameDrafts[collection.id] ?? collection.name;
                      return (
                        <div className="knowledge-collection-row" key={collection.id}>
                          <TextField
                            size="md"
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
                          <Button
                            variant="secondary"
                            size="md"
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
                          </Button>
                          <Button
                            variant="secondary"
                            size="md"
                            tone="danger"
                            type="button"
                            onClick={() => setPendingCollectionDelete(collection)}
                          >
                            删除
                          </Button>
                        </div>
                      );
                    })}
                    <small>集合只是本地分类：不移动本机文件，也不改变任务已固定的材料。</small>
                  </div>
                </section>
                {recentJobs.length > 0 && (
                  <section className="knowledge-jobs" aria-label="最近作业">
                    <div className="knowledge-jobs-head">
                      <strong>{`最近作业（含已取消）· ${recentJobs.length} 条`}</strong>
                      <Button
                        variant="quiet"
                        size="sm"
                        tone="danger"
                        type="button"
                        onClick={() => setPendingJobClear(true)}
                      >
                        清空
                      </Button>
                    </div>
                    {recentJobs.map((job) => (
                      <ListRow
                        key={job.id}
                        variant="plain"
                        detail={`${knowledgeJobTitle(job.kind)}：${knowledgeJobStatusLabel(job.status)} ${job.completedCount}/${job.totalCount}${
                          job.failedCount > 0 ? ` · 失败 ${job.failedCount}` : ''
                        }${job.failure ? ` · ${job.failure.message}` : ''}`}
                        actions={
                          <Button
                            variant="quiet"
                            size="sm"
                            type="button"
                            onClick={() => trackAction(openJobDetail(job.id), '查看作业条目')}
                          >
                            {jobDetail?.jobId === job.id ? '收起条目' : '查看条目'}
                          </Button>
                        }
                      />
                    ))}
                  </section>
                )}
                {jobDetailVisible && (
                  <section className="knowledge-jobs" aria-label="作业条目">
                    {jobDetailLoading && <InlineLoading label="正在读取条目…" />}
                    {jobDetailError && <InlineError message={jobDetailError} />}
                    {jobDetail && (
                      <ul className="knowledge-job-items">
                        {jobDetail.items.map((item) => (
                          <li key={item.id}>
                            {`${item.fileName ?? item.documentId ?? '条目'} · ${knowledgeJobItemStatusLabel(
                              item.status,
                            )} · ${knowledgeJobPhaseLabel(item.phase)}`}
                            {item.status === 'running' && (item.totalUnits ?? 0) > 0
                              ? ` ${item.completedUnits}/${item.totalUnits ?? 0}`
                              : ''}
                            {item.failure ? ` · ${item.failure.message}` : ''}
                          </li>
                        ))}
                        {jobDetail.items.length === 0 && <li>这条作业没有留下可回看的条目。</li>}
                      </ul>
                    )}
                  </section>
                )}
                {error && <InlineError message={error} />}
              </div>
            </Modal>
          )}
          {/* 抽屉开着时失败原因显示在抽屉里——页面在它背后，把错误放那儿等于看不见。 */}
          {!indexDrawerOpen && error && <InlineError message={error} />}
          {issues.length > 0 && (
            <InlineError
              message="以下条目未完成"
              problems={issues}
              {...(retryTarget
                ? {
                    actions: (
                      <Button
                        variant="outline"
                        size="md"
                        tone="danger"
                        type="button"
                        onClick={() => trackAction(retryFailedItems(), '重试失败条目')}
                      >
                        重试未完成条目（{retryTarget.itemIds.length}）
                      </Button>
                    ),
                  }
                : {})}
            />
          )}
          {!detailDocument && (
            <div className="knowledge-summary">
              <span>
                {showingResults
                  ? `找到 ${items.length} 条相关资料`
                  : `已整理 ${documents.length} 份资料`}
              </span>
              <div className="knowledge-summary-actions">
                {showingResults && searchStatus ? (
                  <small>
                    {`本次检索方式：${knowledgeModeLabel(searchStatus.effectiveMode)}`}
                    {searchStatus.degradedReason
                      ? ` · ${knowledgeDegradedLabel(searchStatus.degradedReason)}`
                      : ''}
                    {` · 向量覆盖 ${searchStatus.coverage.indexedChunks}/${searchStatus.coverage.eligibleChunks}`}
                  </small>
                ) : (
                  <small>
                    {showingResults
                      ? '检索仅在本地资料库中进行'
                      : '提交搜索后可见检索方式与覆盖状态'}
                  </small>
                )}
                {showingResults && items.length > 0 && (
                  <Button variant="secondary" size="sm" type="button" onClick={selectAllResults}>
                    全选结果
                  </Button>
                )}
                {showingResults && selectedMaterials.length > 0 && (
                  <Button variant="secondary" size="sm" type="button" onClick={clearSelection}>
                    清除选择
                  </Button>
                )}
                {showingResults && (
                  <AsyncButton
                    variant="chip"
                    size="sm"
                    busy={researchBusy}
                    disabled={selectedMaterials.length === 0}
                    label={`用已选资料研究${selectedMaterials.length > 0 ? `（${selectedMaterials.length}）` : ''}`}
                    busyLabel="正在创建草稿…"
                    onClick={onResearch}
                  />
                )}
              </div>
            </div>
          )}
          {detailDocument ? (
            <ScrollRegion ariaLabel="资料详情" className="knowledge-list-scroll">
              <section className="knowledge-detail">
                <p className="knowledge-detail-hint">
                  {sourceStateLine(detailDocument, detailRevision)}
                </p>
                {detailError && <InlineError message={detailError} />}
                {detailRevision && detailRevision.warnings.length > 0 && (
                  <InlineError tone="warning" problems={detailRevision.warnings} />
                )}
                <Disclosure label="来源管理、保存版本与集合">
                  <div className="knowledge-detail-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() =>
                        reportAction(
                          onOpenSource(detailDocument.sourcePath).then(() =>
                            showToast('success', `已打开「${detailDocument.title}」的原始资料。`),
                          ),
                          (failure) => showToast('error', failure || '无法打开原始资料。'),
                        )
                      }
                    >
                      打开本机原件
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() =>
                        trackAction(checkDocumentSource(detailDocument.id), '检查来源')
                      }
                    >
                      检查来源
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={importing}
                      onClick={() =>
                        reportAction(onRefresh(detailDocument), (failure) =>
                          showToast('error', failure || '刷新索引失败，请重试。'),
                        )
                      }
                    >
                      刷新内容
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      tone="danger"
                      type="button"
                      onClick={() => setRemovalTarget(detailDocument)}
                    >
                      移出资料库
                    </Button>
                  </div>
                  <p className="knowledge-detail-hint">
                    预览读取的是已保存文本：不产生任务访问记录，也不调用模型；原件变化不会自动刷新索引。
                  </p>
                  <section className="knowledge-detail-revisions" aria-label="保存版本列表">
                    <strong>保存版本</strong>
                    {detailRevisions.length === 0 && !detailLoading && (
                      <small>暂无历史版本。</small>
                    )}
                    {detailRevisions.map((revision) => (
                      <div className="knowledge-revision-row" key={revision.id}>
                        <Button
                          variant="secondary"
                          size="sm"
                          type="button"
                          disabled={revision.id === detailRevisionId}
                          onClick={() =>
                            trackAction(selectDetailRevision(revision.id), '切换保存版本')
                          }
                        >
                          第 {revision.revision} 版
                        </Button>
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
                      <Button
                        variant="outline"
                        size="md"
                        tone="brand"
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
                      </Button>
                      <small>勾选即加入、取消即移出；分类不改变内容版本，也不动任务材料。</small>
                    </div>
                  </section>
                </Disclosure>
                <section className="knowledge-detail-text" aria-label="保存文本预览">
                  {detailLoading && <InlineLoading label="正在读取保存文本…" />}
                  {detailPage?.parts.map((part) => (
                    <article key={`${part.locator}-${part.span.start}`}>
                      <small>{part.locator}</small>
                      <p>{part.text}</p>
                    </article>
                  ))}
                  {detailPage && (
                    <footer className="knowledge-detail-pager">
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        disabled={!detailCanGoBack || detailLoading}
                        onClick={() => trackAction(loadPreviousDetailPage(), '上一页')}
                      >
                        上一页
                      </Button>
                      <small>
                        {detailPage.complete
                          ? `已读到结尾（本页 ${detailPage.returnedCodePoints} 字）`
                          : `本页 ${detailPage.returnedCodePoints} 字，仍有后续内容`}
                      </small>
                      <Button
                        variant="secondary"
                        size="sm"
                        type="button"
                        disabled={!detailPage.nextCursor || detailLoading}
                        onClick={() => trackAction(loadNextDetailPage(), '下一页')}
                      >
                        下一页
                      </Button>
                    </footer>
                  )}
                </section>
              </section>
            </ScrollRegion>
          ) : (
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
                            showToast('success', `已打开「${document.title}」的原始资料。`),
                          ),
                          (failure) => showToast('error', failure || '无法打开原始资料。'),
                        )
                      }
                      onRefresh={() =>
                        reportAction(onRefresh(document), (failure) =>
                          showToast('error', failure || '刷新索引失败，请重试。'),
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
      {pendingJobClear && (
        <ConfirmationDialog
          title="清空最近作业？"
          detail="只清掉已结束的作业记录；资料、索引与本机原件都不受影响，进行中的作业不会被删除。"
          confirmLabel="清空记录"
          onCancel={() => setPendingJobClear(false)}
          onConfirm={() => {
            setPendingJobClear(false);
            trackAction(clearRecentJobs(), '清空最近作业');
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
