import { ArtifactIcon } from '../icons';

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
