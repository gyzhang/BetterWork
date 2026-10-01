import type { EvidenceSummary, KnowledgeEvidenceSource } from '@betterwork/agent-protocol';
import type { ComponentType, ReactNode } from 'react';

import type { IconSize } from '../icons';
import { CapabilityIcon, GlobeIcon, KnowledgeIcon } from '../icons';
import { Button } from './Button';
import { ListRow } from './ListRow';

/**
 * 「来源是哪一类」的口径只有一处。
 *
 * 上下文面板与成果详情此前各写一遍同一条三元式（图标与类型标签各一份），
 * 而且两边的**详细程度还不一致**：面板会区分「摘要来源／正文来源」并注明历史范围未记录，
 * 成果页只会说「本地资料」——同一条 Evidence 在两处报出不同的身份（§3.1 P12）。
 */
export const evidenceSourceKindLabel = (item: EvidenceSummary): string => {
  if (item.sourceType === 'web-page') return '网页来源';
  if (item.sourceType === 'mcp-tool') return 'MCP 工具';
  return item.knowledgeSource
    ? KNOWLEDGE_OPERATION_LABEL[item.knowledgeSource.operation]
    : '本地资料 · 历史范围未记录';
};

/** 知识 Evidence 的访问类型标签：搜索摘要与正文读取分开呈现（契约 §5.1）。 */
const KNOWLEDGE_OPERATION_LABEL: Record<KnowledgeEvidenceSource['operation'], string> = {
  search: '摘要来源',
  read: '正文来源',
};

/** 只有本地资料有「原文」可打开；网页与 MCP 的来源就是那次调用本身。 */
export const canOpenEvidenceSource = (item: EvidenceSummary): boolean =>
  item.sourceType === 'local-file';

const SOURCE_ICONS: Record<EvidenceSummary['sourceType'], ComponentType<{ size?: IconSize }>> = {
  'local-file': KnowledgeIcon,
  'web-page': GlobeIcon,
  'mcp-tool': CapabilityIcon,
};

/**
 * 带来源标识的引用行：`ListRow` 的一个具名用法，不是第二套行几何。
 *
 * 「图标＋标题＋定位符·类型＋（摘要）＋打开原文」这一种结构此前有两份拷贝，
 * 图标一个 12px 一个 10px，右槽按钮一个用行内动作皮一个自造 `.evidence-open-button`。
 * 页面留给自己的只有两件事：要不要显示摘要，以及右槽里那些**领域动作**
 * （区间回看、预览展开）——它们带着页面的状态与 hook，不进基座签名。
 */
export function SourceRow({
  item,
  showExcerpt = false,
  metaExtra,
  actions,
  onOpenSource,
  openSourceLabel = '原文',
  variant = 'divider',
  className,
}: {
  item: EvidenceSummary;
  /** 摘要行只有上下文面板放得下，成果详情里的引用只要一行。 */
  showExcerpt?: boolean | undefined;
  /** 追加在「定位符 · 类型」之后的领域信息（修订号、命中区间）。 */
  metaExtra?: ReactNode | undefined;
  /** 右槽里的领域动作（区间回看按钮）；「原文」由 `onOpenSource` 表达，不放这里。 */
  actions?: ReactNode | undefined;
  /** 给了才在右槽放打开原文的入口，且只有本地资料会渲染它。 */
  onOpenSource?: (() => void) | undefined;
  openSourceLabel?: string | undefined;
  variant?: 'divider' | 'plain' | 'card' | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  const Icon = SOURCE_ICONS[item.sourceType];
  return (
    <ListRow
      as="article"
      variant={variant}
      {...(className ? { className } : {})}
      leading={
        <span aria-hidden="true">
          <Icon size={12} />
        </span>
      }
      title={item.title}
      {...(showExcerpt ? { detail: item.excerpt } : {})}
      meta={
        <>
          {item.locator} · {evidenceSourceKindLabel(item)}
          {metaExtra}
        </>
      }
      actions={
        <>
          {actions}
          {onOpenSource && canOpenEvidenceSource(item) ? (
            <Button variant="quiet" size="sm" type="button" onClick={onOpenSource}>
              {openSourceLabel}
            </Button>
          ) : undefined}
        </>
      }
    />
  );
}
