import type { KnowledgeDocumentSummary } from '@betterwork/agent-protocol';

import { MoreHorizontalIcon } from '../icons';
import { formatTime } from '../lib/format';

export interface KnowledgeDocumentCardProps {
  document: KnowledgeDocumentSummary;
  excerpt?: string;
  locator?: string;
  busy?: boolean;
  /** KM03：搜索结果选择模式；列表模式不显示勾选。 */
  select?: { checked: boolean; onToggle: (checked: boolean) => void; label: string };
  onOpen: () => void;
  onRefresh: () => void;
  onRemove: () => void;
  /** KM10：打开主区详情（保存文本、版本列表与来源状态）。 */
  onOpenDetail: () => void;
}

const SOURCE_STATE_LABELS: Record<KnowledgeDocumentSummary['sourceStatus'], string> = {
  unchecked: '来源未检查',
  unchanged: '来源一致',
  changed: '原件已变化',
  missing: '原件缺失',
  unreadable: '原件不可读',
};

const FORMAT_LABELS: Record<KnowledgeDocumentSummary['format'], string> = {
  markdown: 'MD',
  text: 'TXT',
  pdf: 'PDF',
  docx: 'DOC',
  xlsx: 'XLS',
  csv: 'CSV',
  pptx: 'PPT',
};

const formatLabel = (format: KnowledgeDocumentSummary['format']): string => FORMAT_LABELS[format];

/** 知识资料的领域卡片：展示来源状态，动作由页面注入。 */
export function KnowledgeDocumentCard({
  document,
  excerpt,
  locator,
  busy = false,
  select,
  onOpen,
  onRefresh,
  onRemove,
  onOpenDetail,
}: KnowledgeDocumentCardProps): React.JSX.Element {
  return (
    <article className="knowledge-card">
      {select && (
        <label className="knowledge-card-select" title={select.label}>
          <input
            type="checkbox"
            checked={select.checked}
            aria-label={select.label}
            onChange={(event) => select.onToggle(event.target.checked)}
          />
        </label>
      )}
      <span className={`knowledge-format ${document.format}`}>{formatLabel(document.format)}</span>
      <div className="knowledge-card-main">
        <strong>{document.title}</strong>
        {excerpt && <p>{excerpt}</p>}
        <small>
          {document.sourcePath}
          {locator ? ` · ${locator}` : ''} · 更新于 {formatTime(document.updatedAt)} ·{' '}
          {SOURCE_STATE_LABELS[document.sourceStatus]}
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
            <button type="button" onClick={onOpenDetail}>
              查看详情
            </button>
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
