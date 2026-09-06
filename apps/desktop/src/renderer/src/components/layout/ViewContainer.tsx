import type { ReactNode } from 'react';

export type ViewMode = 'list' | 'grid';

export function ViewContainer({
  mode,
  children,
  className = '',
}: {
  mode: ViewMode;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={`view-container view-container-${mode}${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}
