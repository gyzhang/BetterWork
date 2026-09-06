import type { KnowledgeDocumentSummary } from '@betterwork/agent-protocol';
import { useCallback, useState } from 'react';

import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { EmptyPage, ErrorPage, LoadingPage } from '../components/EmptyState';
import { KnowledgeDocumentCard } from '../components/KnowledgeDocumentCard';
import { PageHeader } from '../components/layout/PageHeader';
import { PageToolbar } from '../components/layout/PageToolbar';
import { ScrollRegion } from '../components/layout/ScrollRegion';
import { ViewContainer } from '../components/layout/ViewContainer';
import { TransientToast } from '../components/TransientToast';
import type { KnowledgeLibrary } from '../hooks/use-knowledge-library';
import { PlusIcon } from '../icons';
import { reportAction, trackAction } from '../lib/async-action';

interface KnowledgeToast {
  tone: 'success' | 'error';
  message: string;
}

/**
 * 资料库视图。状态与动作全部来自 useKnowledgeLibrary，
 * 视图只负责呈现，因此这里没有任何 IPC 调用。
 */
export function KnowledgePage({ library }: { library: KnowledgeLibrary }): React.JSX.Element {
  const {
    documents,
    results,
    query,
    setQuery,
    message,
    issues,
    importing,
    loading,
    loadError,
    refresh,
    onImport,
    onSearch,
    onOpenSource,
    onRefresh,
    onRemove,
  } = library;
  const showingResults = Boolean(query.trim());
  const items: Array<{ document: KnowledgeDocumentSummary; excerpt?: string; locator?: string }> =
    showingResults
      ? results.map((result) => ({
          document: result.document,
          locator: result.locator,
          excerpt: result.excerpt,
        }))
      : documents.map((document) => ({ document }));
  const [toast, setToast] = useState<KnowledgeToast>();
  const [removalTarget, setRemovalTarget] = useState<KnowledgeDocumentSummary>();
  const dismissToast = useCallback(() => setToast(undefined), []);

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
          </PageToolbar>
          {message && <p className="inline-message">{message}</p>}
          {issues.length > 0 && (
            <div className="knowledge-issues">
              <strong>以下资料未导入</strong>
              <ul>
                {issues.map((issue, index) => (
                  <li key={`${index}-${issue}`}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="knowledge-summary">
            <span>
              {showingResults
                ? `找到 ${items.length} 条相关资料`
                : `已整理 ${documents.length} 份资料`}
            </span>
            <small>
              {showingResults ? '检索仅在本地资料库中进行' : '下一步将支持表格与语义检索'}
            </small>
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
                {items.map(({ document, excerpt, locator }) => (
                  <KnowledgeDocumentCard
                    key={`${document.id}-${locator ?? 'document'}`}
                    document={document}
                    {...(excerpt ? { excerpt } : {})}
                    {...(locator ? { locator } : {})}
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
    </>
  );
}
