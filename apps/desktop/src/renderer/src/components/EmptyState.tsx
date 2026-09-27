import type { ReactNode } from 'react';

import { AlertIcon, ArtifactIcon } from '../icons';

export function EmptyContext({
  title,
  detail,
  icon,
}: {
  title: string;
  detail: string;
  /** 区域语义与默认成果图标不同时传入；图标纯装饰，不进可及名称。 */
  icon?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="empty-context">
      <span aria-hidden="true">{icon ?? <ArtifactIcon size={16} />}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

/**
 * 列表与小节级别占位：给一行说明，或一行标题加一句解释。
 *
 * 区域级的空态是 `EmptyContext`（居中、带图标、吃掉整块高度），侧栏与设置小节
 * 放不下那种尺寸；此前这类占位由 `.empty-runs`、`.empty-models`、
 * `.setting-placeholder` 各写一遍（docs/reviews/2026-09-26-ui-consistency.md §2）。
 */
export function EmptyNotice({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}): React.JSX.Element {
  if (!detail)
    return (
      <div className="empty-notice" data-variant="line">
        <p>{title}</p>
      </div>
    );
  return (
    <div className="empty-notice" data-variant="block">
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function EmptyPage({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail: string;
}): React.JSX.Element {
  return (
    <section className="empty-page">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{detail}</p>
    </section>
  );
}

export function LoadingPage({ label = '正在加载资料…' }: { label?: string }): React.JSX.Element {
  return (
    <section className="loading-page" aria-live="polite" aria-busy="true">
      <span className="spinner" aria-hidden="true" />
      <strong>{label}</strong>
    </section>
  );
}

export function ErrorPage({
  title = '资料暂时无法加载',
  detail,
  onRetry,
}: {
  title?: string;
  detail: string;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <section className="error-page" role="alert">
      <span className="error-page-icon" aria-hidden="true">
        <AlertIcon size={18} />
      </span>
      <strong>{title}</strong>
      <p>{detail}</p>
      <button className="secondary-button" type="button" onClick={onRetry}>
        重新加载
      </button>
    </section>
  );
}
