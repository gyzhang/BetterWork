import type { KnowledgeDocumentSummary, KnowledgeSearchHit } from '@betterwork/agent-protocol';
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

interface KnowledgeToast {
  tone: 'success' | 'error';
  message: string;
}

const MODE_LABELS: Record<string, string> = {
  keyword: '关键词',
  hybrid: '关键词＋语义',
  vector: '语义（向量）',
};

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
  } = library;
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
  const dismissToast = useCallback(() => setToast(undefined), []);

  const semanticOn = settings?.semanticEnabled ?? false;
  const enableAllowed = semanticOn || (settings?.embeddingAvailable ?? false);
  const profileOptions = embeddingModels.map((model) => ({
    id: model.id,
    label: `${model.name} · ${model.model}`,
  }));
  const selectedProfileId = settings?.embeddingProfileId ?? embeddingModels[0]?.id ?? '';

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
            资料保留在你的本机路径；算台只建立可重建的本地文本索引。当前支持 Markdown、文本、PDF 与
            Word。
          </p>
          <PageToolbar ariaLabel="资料库操作">
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
          <ScrollRegion ariaLabel="知识资料列表" busy={importing} className="knowledge-list-scroll">
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
                    : '导入 Markdown、文本、PDF 或 Word 后，它们会在后续研究和写作中成为可引用的个人资料。'
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
                  />
                ))}
              </ViewContainer>
            )}
          </ScrollRegion>
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
