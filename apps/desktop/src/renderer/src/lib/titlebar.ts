import type { MouseEvent } from 'react';

import { trackAction } from './async-action';

export const handleTitlebarDoubleClick = (event: MouseEvent): void => {
  if ((event.target as HTMLElement).closest('button, input, textarea, select, a')) return;
  trackAction(window.betterwork.chrome.toggleMaximize(), '切换窗口最大化');
};
