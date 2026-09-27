import { useCallback, useState } from 'react';

import type { ViewMode } from '../components/layout/ViewContainer';

/**
 * 卡片／列表偏好的唯一读写（docs/10 §10.1）。
 *
 * 技能页先落地这套切换，读写连同 storage 不可用时的兜底都写在页面里；专家页接同一个切换时
 * 不该再抄第二份。每个页面用自己的 key，模式偏好互不覆盖。
 */
export function useViewMode(storageKey: string): {
  viewMode: ViewMode;
  changeViewMode: (mode: ViewMode) => void;
} {
  const [viewMode, setViewMode] = useState<ViewMode>(() => readViewMode(storageKey));
  const changeViewMode = useCallback(
    (mode: ViewMode): void => {
      setViewMode(mode);
      try {
        window.localStorage.setItem(storageKey, mode);
      } catch {
        // storage unavailable — the mode still applies for this session
      }
    },
    [storageKey],
  );

  return { viewMode, changeViewMode };
}

const readViewMode = (storageKey: string): ViewMode => {
  try {
    return window.localStorage.getItem(storageKey) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
};
