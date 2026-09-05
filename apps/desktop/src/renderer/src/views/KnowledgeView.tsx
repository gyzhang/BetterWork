import type { KnowledgeDocumentSummary } from '@betterwork/agent-protocol';
import { useState } from 'react';

import { EmptyPage } from '../components/EmptyState';
import type { KnowledgeLibrary } from '../hooks/use-knowledge-library';
import { PlusIcon } from '../icons';
import { trackAction } from '../lib/async-action';
import { formatTime } from '../lib/format';
import { handleTitlebarDoubleClick } from '../lib/titlebar';

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
  const [openMessage, setOpenMessage] = useState('');
  return (
    <>
      <header className="page-header" onDoubleClick={handleTitlebarDoubleClick}>
        <div>
          <p className="eyebrow">知识 · 个人资料库</p>
          <h1>让资料成为下一次工作的起点</h1>
        </div>
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
      </header>
      <div className="page-scroll">
        <section className="page-body knowledge-page">
          <p className="page-intro">
            资料保留在你的本机路径；算台只建立可重建的本地文本索引。当前支持 Markdown、文本、PDF 与
            Word。
          </p>
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
          {openMessage && <p className="knowledge-open-message">{openMessage}</p>}
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
          {items.length === 0 ? (
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
            <div className="knowledge-list">
              {items.map(({ document, excerpt, locator }) => (
                <article className="knowledge-card" key={`${document.id}-${locator ?? 'document'}`}>
                  <span className={`knowledge-format ${document.format}`}>
                    {document.format === 'markdown'
                      ? 'MD'
                      : document.format === 'pdf'
                        ? 'PDF'
                        : document.format === 'docx'
                          ? 'DOC'
                          : 'TXT'}
                  </span>
                  <div>
                    <strong>{document.title}</strong>
                    {excerpt && <p>{excerpt}</p>}
                    <small>
                      {document.sourcePath}
                      {locator ? ` · ${locator}` : ''} · 更新于 {formatTime(document.updatedAt)}
                    </small>
                  </div>
                  <div className="knowledge-card-actions">
                    <button
                      className="open-source-button"
                      onClick={() =>
                        void onOpenSource(document.sourcePath)
                          .then(() => setOpenMessage(`已打开「${document.title}」的原始资料。`))
                          .catch((reason: unknown) =>
                            setOpenMessage(
                              reason instanceof Error ? reason.message : '无法打开原始资料。',
                            ),
                          )
                      }
                    >
                      打开原文
                    </button>
                    <button
                      className="refresh-knowledge-button"
                      disabled={importing}
                      onClick={() => trackAction(onRefresh(document), '刷新资料索引')}
                    >
                      刷新索引
                    </button>
                    <button
                      className="remove-knowledge-button"
                      disabled={importing}
                      onClick={() => trackAction(onRemove(document), '移出资料库')}
                    >
                      移出资料库
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
