import { useEffect, useState } from 'react';

import {
  type AppearancePreference,
  applyAppearance,
  bootstrapAppearance,
  getWindowTheme,
  persistAppearance,
  type ResolvedAppearance,
} from '../appearance';
import { trackAction } from '../lib/async-action';

export interface AppearanceState {
  preference: AppearancePreference;
  resolved: ResolvedAppearance;
  update: (next: AppearancePreference) => void;
}

/**
 * 外观偏好：模式（system / light / dark）与色系是两个独立维度（docs/10 §9.1）。
 *
 * 三件事必须一起发生，因此收在同一个 hook 里：
 * 挂载前恢复已保存的偏好、跟随系统明暗变化、把标题栏颜色同步给主进程。
 */
export function useAppearance(): AppearanceState {
  const [preference, setPreference] = useState<AppearancePreference>(bootstrapAppearance);
  const [resolved, setResolved] = useState<ResolvedAppearance>(() => applyAppearance(preference));

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      // 跟随系统时才重新解析；用户显式选了明暗就不该被系统变化覆盖
      if (preference.mode === 'system') setResolved(applyAppearance(preference));
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  useEffect(() => {
    trackAction(window.betterwork.chrome.updateTheme(getWindowTheme()), '同步窗口主题');
  }, [preference, resolved]);

  const update = (next: AppearancePreference): void => {
    setPreference(next);
    persistAppearance(next);
    setResolved(applyAppearance(next));
  };

  return { preference, resolved, update };
}
