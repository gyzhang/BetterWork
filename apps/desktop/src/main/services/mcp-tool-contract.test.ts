import { describe, expect, it } from 'vitest';

import {
  mcpContractHash,
  mcpModelAlias,
  mcpSafeResult,
  summarizeMcpTool,
} from './mcp-tool-contract';

describe('MCP reviewed contracts', () => {
  it('ignores key order but includes description, output schema and annotations', () => {
    expect(mcpContractHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      mcpContractHash({ b: { d: 3, c: 2 }, a: 1 }),
    );
    const tool = {
      name: 'read/report',
      description: 'Read report',
      inputSchema: { type: 'object' as const },
    };
    const original = summarizeMcpTool('connection', tool, 1);
    for (const change of [
      { description: 'Changed report' },
      { outputSchema: { type: 'object' as const } },
      { annotations: { destructiveHint: true } },
    ])
      expect(summarizeMcpTool('connection', { ...tool, ...change }, 2).contractHash).not.toBe(
        original.contractHash,
      );
    expect(mcpModelAlias('a', 'b')).toHaveLength(64);
    expect(mcpModelAlias('a/b', 'c')).not.toBe(mcpModelAlias('a', 'b/c'));
  });

  it('rejects remote references, tool errors and unsupported input requests', () => {
    expect(() =>
      summarizeMcpTool(
        'a',
        {
          name: 'b',
          inputSchema: {
            type: 'object',
            properties: { x: { $ref: 'https://example.test/schema' } },
          },
        },
        1,
      ),
    ).toThrow();
    expect(() =>
      mcpSafeResult({ isError: true, content: [{ type: 'text', text: 'failure' }] }),
    ).toThrow();
    expect(() => mcpSafeResult({ resultType: 'input_required', requestState: 'secret' })).toThrow();
    expect(() => mcpSafeResult({ structuredContent: { data: 'x'.repeat(100_001) } })).toThrow();
  });
});
