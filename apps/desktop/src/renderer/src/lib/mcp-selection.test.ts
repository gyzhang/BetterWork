import { describe, expect, it } from 'vitest';

import { canToggleMcpTool } from './mcp-selection';

describe('canToggleMcpTool', () => {
  it('allows adding tools only from a ready connection', () => {
    expect(canToggleMcpTool('ready', false)).toBe(true);
    expect(canToggleMcpTool('failed', false)).toBe(false);
    expect(canToggleMcpTool('disconnected', false)).toBe(false);
    expect(canToggleMcpTool('connecting', false)).toBe(false);
    expect(canToggleMcpTool('unconfigured', false)).toBe(false);
  });

  it('keeps an existing binding removable after the connection fails', () => {
    expect(canToggleMcpTool('failed', true)).toBe(true);
    expect(canToggleMcpTool('disconnected', true)).toBe(true);
    expect(canToggleMcpTool('connecting', true)).toBe(true);
  });
});
