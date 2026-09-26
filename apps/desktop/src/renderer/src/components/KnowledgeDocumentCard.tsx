import type { KnowledgeDocumentSummary } from '@betterwork/agent-protocol';
import { useRef, useState } from 'react';

import { MoreHorizontalIcon } from '../icons';
import { formatTime } from '../lib/format';
import type { PopoverMenuItem } from './PopoverMenu';
import { PopoverMenu } from './PopoverMenu';

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
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuLabel = `更多操作：${document.title}`;
  const menuItems: PopoverMenuItem[] = [
    { id: 'detail', label: '查看详情' },
    { id: 'refresh', label: '刷新索引', disabled: busy },
    { id: 'remove', label: '移出资料库', disabled: busy, tone: 'danger' },
  ];

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
        <button
          ref={menuTriggerRef}
          className="knowledge-more-button"
          type="button"
          aria-label={menuLabel}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontalIcon size={16} />
          <span>更多</span>
        </button>
        <PopoverMenu
          open={menuOpen}
          anchorRef={menuTriggerRef}
          items={menuItems}
          label={menuLabel}
          align="end"
          placement="bottom"
          onDismiss={() => setMenuOpen(false)}
          onSelect={(id) => {
            setMenuOpen(false);
            if (id === 'detail') onOpenDetail();
            if (id === 'refresh') onRefresh();
            if (id === 'remove') onRemove();
          }}
        />
      </div>
    </article>
  );
}
