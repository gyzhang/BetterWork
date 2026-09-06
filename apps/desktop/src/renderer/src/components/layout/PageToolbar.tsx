import type { ReactNode } from 'react';

export function PageToolbar({
  children,
  ariaLabel,
}: {
  children: ReactNode;
  ariaLabel: string;
}): React.JSX.Element {
  return (
    <div className="page-toolbar" role="toolbar" aria-label={ariaLabel}>
      {children}
    </div>
  );
}
