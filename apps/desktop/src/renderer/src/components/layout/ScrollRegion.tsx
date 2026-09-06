import type { ReactNode } from 'react';

interface ScrollRegionProps {
  children: ReactNode;
  ariaLabel: string;
  busy?: boolean;
  className?: string;
}

/** 页面中唯一负责滚动的区域，同时向辅助技术说明当前状态。 */
export function ScrollRegion({
  children,
  ariaLabel,
  busy = false,
  className = '',
}: ScrollRegionProps): React.JSX.Element {
  return (
    <div
      className={`scroll-region${className ? ` ${className}` : ''}`}
      role="region"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-busy={busy}
    >
      {children}
    </div>
  );
}
