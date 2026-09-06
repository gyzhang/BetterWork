import type { ReactNode } from 'react';

import { handleTitlebarDoubleClick } from '../../lib/titlebar';

export interface PageHeaderProps {
  eyebrow: string;
  title: string;
  leading?: ReactNode;
  actions?: ReactNode;
}

/** 统一页面标题带：标题位置与窗口拖拽行为由布局组件收口。 */
export function PageHeader({
  eyebrow,
  title,
  leading,
  actions,
}: PageHeaderProps): React.JSX.Element {
  return (
    <header className="page-header" onDoubleClick={handleTitlebarDoubleClick}>
      <div className="page-header-leading">
        {leading}
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
