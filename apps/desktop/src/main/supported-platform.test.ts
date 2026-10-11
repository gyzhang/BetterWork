import { describe, expect, it } from 'vitest';

import { isSupportedPlatform } from './supported-platform';

describe('isSupportedPlatform', () => {
  it('accepts only macOS arm64', () => {
    expect(isSupportedPlatform('darwin', 'arm64')).toBe(true);
    expect(isSupportedPlatform('darwin', 'x64')).toBe(false);
    expect(isSupportedPlatform('linux', 'arm64')).toBe(false);
    expect(isSupportedPlatform('win32', 'x64')).toBe(false);
  });
});
