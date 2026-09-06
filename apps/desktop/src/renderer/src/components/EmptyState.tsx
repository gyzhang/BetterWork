import { AlertIcon, ArtifactIcon } from '../icons';

export function EmptyContext({
  title,
  detail,
}: {
  title: string;
  detail: string;
}): React.JSX.Element {
  return (
    <div className="empty-context">
      <span aria-hidden="true">
        <ArtifactIcon size={16} />
      </span>
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
      <span className="loading-page-spinner" aria-hidden="true" />
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
