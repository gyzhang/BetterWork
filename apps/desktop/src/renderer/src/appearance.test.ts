import { describe, expect, it } from 'vitest';
import { defaultAppearance, parseAppearance, resolveAppearance } from './appearance';

describe('appearance preference', () => {
  it('uses the product default for malformed or unsupported stored values', () => {
    expect(parseAppearance(null)).toEqual(defaultAppearance);
    expect(parseAppearance('{oops')).toEqual(defaultAppearance);
    expect(parseAppearance('{"mode":"neon","scheme":"jade"}')).toEqual(defaultAppearance);
  });

  it('keeps appearance mode and color scheme as independent choices', () => {
    expect(parseAppearance('{"mode":"system","scheme":"ocean"}')).toEqual({ mode: 'system', scheme: 'ocean' });
    expect(resolveAppearance('system', true)).toBe('dark');
    expect(resolveAppearance('system', false)).toBe('light');
    expect(resolveAppearance('light', true)).toBe('light');
  });
});
