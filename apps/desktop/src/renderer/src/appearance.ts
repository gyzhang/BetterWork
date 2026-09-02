export type AppearanceMode = 'system' | 'light' | 'dark';
export type ColorScheme = 'jade' | 'ink' | 'ocean' | 'sand';
export type ResolvedAppearance = 'light' | 'dark';

export interface AppearancePreference {
  mode: AppearanceMode;
  scheme: ColorScheme;
}

export const appearanceStorageKey = 'betterwork-appearance';

export const colorSchemes: ReadonlyArray<{ id: ColorScheme; name: string; description: string }> = [
  { id: 'jade', name: '青玉', description: '暖灰纸面，克制青绿' },
  { id: 'ink', name: '纸墨', description: '安静阅读，近黑强调' },
  { id: 'ocean', name: '远洋', description: '冷静专业，深海蓝调' },
  { id: 'sand', name: '暖砂', description: '温和办公，暗金铜色' },
];

const modes: ReadonlySet<string> = new Set<AppearanceMode>(['system', 'light', 'dark']);
const schemes: ReadonlySet<string> = new Set<ColorScheme>(colorSchemes.map((scheme) => scheme.id));

export const defaultAppearance: AppearancePreference = { mode: 'system', scheme: 'jade' };

export function parseAppearance(value: string | null): AppearancePreference {
  if (!value) return defaultAppearance;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return defaultAppearance;
    const candidate = parsed as { mode?: unknown; scheme?: unknown };
    if (typeof candidate.mode !== 'string' || typeof candidate.scheme !== 'string') return defaultAppearance;
    if (!modes.has(candidate.mode) || !schemes.has(candidate.scheme)) return defaultAppearance;
    return { mode: candidate.mode as AppearanceMode, scheme: candidate.scheme as ColorScheme };
  } catch {
    return defaultAppearance;
  }
}

export function resolveAppearance(mode: AppearanceMode, prefersDark: boolean): ResolvedAppearance {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

export function readAppearance(): AppearancePreference {
  if (typeof window === 'undefined') return defaultAppearance;
  return parseAppearance(window.localStorage.getItem(appearanceStorageKey));
}

export function applyAppearance(preference: AppearancePreference): ResolvedAppearance {
  const prefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = resolveAppearance(preference.mode, prefersDark);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.scheme = preference.scheme;
    document.documentElement.style.colorScheme = resolved;
  }
  return resolved;
}

export function persistAppearance(preference: AppearancePreference): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(appearanceStorageKey, JSON.stringify(preference));
}

export function bootstrapAppearance(): AppearancePreference {
  const preference = readAppearance();
  applyAppearance(preference);
  return preference;
}
