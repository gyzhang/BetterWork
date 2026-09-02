import { describe, expect, it } from 'vitest';
import { updateWindowThemeRequestSchema } from './index';

describe('window theme protocol', () => {
  it('allows only explicit six-digit color values across the IPC boundary', () => {
    expect(updateWindowThemeRequestSchema.parse({ backgroundColor: '#F6F7F5', symbolColor: '#1D2420' }))
      .toEqual({ backgroundColor: '#F6F7F5', symbolColor: '#1D2420' });
    expect(() => updateWindowThemeRequestSchema.parse({ backgroundColor: 'rgba(0,0,0,.4)', symbolColor: '#fff' })).toThrow();
  });
});
