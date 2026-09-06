import type { KnowledgeDocumentSummary } from '@betterwork/agent-protocol';

import { MoreHorizontalIcon } from '../icons';
import { formatTime } from '../lib/format';

export interface KnowledgeDocumentCardProps {
  document: KnowledgeDocumentSummary;
  excerpt?: string;
  locator?: string;
  busy?: boolean;
  onOpen: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}

const formatLabel = (format: KnowledgeDocumentSummary['format']): string => {
  if (format === 'markdown') return 'MD';
  if (format === 'pdf') return 'PDF';
  if (format === 'docx') return 'DOC';
  return 'TXT';
};

/** 知识资料的领域卡片：展示来源状态，动作由页面注入。 */
export function KnowledgeDocumentCard({
  document,
  excerpt,
  locator,
  busy = false,
  onOpen,
  onRefresh,
  onRemove,
}: KnowledgeDocumentCardProps): React.JSX.Element {
  return (
    <article className="knowledge-card">
      <span className={`knowledge-format ${document.format}`}>{formatLabel(document.format)}</span>
      <div className="knowledge-card-main">
        <strong>{document.title}</strong>
        {excerpt && <p>{excerpt}</p>}
        <small>
          {document.sourcePath}
          {locator ? ` · ${locator}` : ''} · 更新于 {formatTime(document.updatedAt)}
        </small>
      </div>
      <div className="knowledge-card-actions">
        <button className="open-source-button" type="button" onClick={onOpen}>
          打开原文
        </button>
        <details className="knowledge-actions-menu">
          <summary className="knowledge-more-button" aria-label={`更多操作：${document.title}`}>
            <MoreHorizontalIcon size={16} />
            <span>更多</span>
          </summary>
          <div className="knowledge-actions-menu-panel">
            <button type="button" disabled={busy} onClick={onRefresh}>
              刷新索引
            </button>
            <button className="danger" type="button" disabled={busy} onClick={onRemove}>
              移出资料库
            </button>
          </div>
        </details>
      </div>
    </article>
  );
}
