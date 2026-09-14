import { describe, expect, it } from 'vitest';

import { canToggleMcpTool, hasMcpToolBinding, setMcpToolBinding } from './mcp-selection';

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

  it('matches and toggles by connection plus tool identity', () => {
    const bindings = [
      { connectionId: 'connection-a', toolId: 'monthly_summary' },
      { connectionId: 'connection-b', toolId: 'monthly_summary' },
    ];
    expect(hasMcpToolBinding(bindings, 'connection-a', 'monthly_summary')).toBe(true);
    expect(hasMcpToolBinding(bindings, 'connection-c', 'monthly_summary')).toBe(false);
    expect(setMcpToolBinding(bindings, 'connection-a', 'monthly_summary', false)).toEqual([
      { connectionId: 'connection-b', toolId: 'monthly_summary' },
    ]);
    expect(setMcpToolBinding(bindings, 'connection-b', 'monthly_summary', true)).toEqual(bindings);
  });
});
