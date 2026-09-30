import type { ReactNode } from 'react';

import { Card, CardMark } from './Card';
import { ListRow } from './ListRow';

/**
 * 一条目录条目（专家、技能）要交代的那几件事。
 *
 * 五格必填：ADR-0030 §决策 1 说「缺一行卡片就退化成一颗按钮」，那句话此前只写在散文里，
 * 所以 2026-09-30 G4 把专家页的卡片抄到技能页时，列表档就少了署名那一格
 * （[ADR-0032](../../../../../../docs/adr/0032-catalog-entry-card-facts.md) §背景）。
 * 改成必填之后，漏一格是编译错误。
 *
 * 交互（`onOpen`）与定位钩子（`className`）**不住在这里**：它们只对某一档有意义，
 * 混进事实就等于让另一档默默吞掉一格（ADR-0032 §决策 5）。
 */
export interface EntryFacts {
  /** 身份块：图标或名称首字。`CardMark` 由配对件套，页面不再自己包第二次。 */
  mark: ReactNode;
  name: ReactNode;
  /** 署名那一行：作者 · 版本号，或来源。 */
  byline: ReactNode;
  /** 说明。卡片档三行定高并被裁切时弹 Tooltip，行档单行省略——同一格两种截断是有意的密度差。 */
  description: ReactNode;
  /** 用途标签与状态片那一行；没有标签且状态正常时不给。 */
  notes?: ReactNode | undefined;
  /** 一排就地动作。卡片放进页脚，行放进右槽。 */
  actions: ReactNode;
  /** 主行动。卡片档悬停与聚焦才显形，行档常驻——两种显形规则都由配对件拥有。 */
  primary?: ReactNode | undefined;
}

interface CatalogCardProps {
  facts: EntryFacts;
  /** 整片可点进详情。 */
  onOpen?: (() => void) | undefined;
  /** 卡片自己的悬停与网格定位钩子；行档不吃它。 */
  className?: string | undefined;
}

/**
 * 目录条目的卡片档（docs/10 §10.1、ADR-0032）。
 *
 * `Card` 管外壳与六槽排版，这里只管把一份事实摆成纵向那一套。
 */
export function CatalogCard({ facts, onOpen, className }: CatalogCardProps): React.JSX.Element {
  return (
    <Card
      {...(className ? { className } : {})}
      leading={facts.mark}
      title={facts.name}
      byline={facts.byline}
      description={facts.description}
      {...(onOpen ? { onOpen } : {})}
      {...(facts.primary
        ? { topTrailing: <span className="card-primary">{facts.primary}</span> }
        : {})}
      footer={facts.actions}
    >
      {facts.notes}
    </Card>
  );
}

/**
 * 目录条目的列表档——与卡片档同一份事实，只是排布不同。
 *
 * 它的入参**没有** `onOpen`：右槽站着就地动作，整行再做成按钮就是按钮套按钮的无效 DOM。
 * 「右槽有按钮就撤掉整行点击区」这条约定在 2026-09-30 之前只由两页各自的注释维持
 * （[UI 治理账本](../../../../../../docs/reviews/2026-09-28-ui-governance-audit.md) R3-D 记着这一笔），
 * 现在由类型维持。真需要「整行可点＋底部动作」时该给 `ListRow` 加一档，这里是唯一改点。
 */
export function CatalogRow({ facts }: { facts: EntryFacts }): React.JSX.Element {
  return (
    <ListRow
      as="article"
      variant="card"
      leading={<CardMark>{facts.mark}</CardMark>}
      title={facts.name}
      detail={facts.description}
      meta={facts.byline}
      actions={
        <>
          {facts.primary}
          {facts.actions}
        </>
      }
    >
      {facts.notes}
    </ListRow>
  );
}
