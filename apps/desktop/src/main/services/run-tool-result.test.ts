import { describe, expect, it } from 'vitest';

import { parseRunToolResult } from './run-tool-result';

const material = {
  kind: 'workspace-input-snapshot',
  workspaceId: '10000000-0000-4000-8000-000000000001',
  snapshotId: '10000000-0000-4000-8000-000000000002',
  fileKey: 'input.csv',
  contentHash: 'hash',
  format: 'csv',
};
const validResults: Array<[string, unknown]> = [
  ['read_text_file', { path: 'input.md', content: '返回30元。' }],
  ['read_artifact', { artifactId: 'a', versionId: 'v', contentHash: 'h', content: '返回30元。' }],
  ['read_office_material', { material, format: 'csv', contentHash: 'h', sections: [] }],
  [
    'knowledge_search',
    { results: [{ title: 't', sourcePath: 'p', locator: 'l', excerpt: '30元', contentHash: 'h' }] },
  ],
  ['read_knowledge', { parts: [{ evidenceId: 'e', text: '30元' }] }],
  [
    'web_search',
    { results: [{ title: 't', url: 'https://example.test', snippet: '30元', site: 's' }] },
  ],
  [
    'web_fetch',
    {
      url: 'https://example.test',
      title: 't',
      content: '30元',
      contentType: 'text/plain',
      status: 200,
    },
  ],
  ['task_write_file', { path: 'report.md', contentHash: 'h' }],
  [
    'analyze_business_metrics',
    { period: '本期', metrics: [{ metric: '收入', current: 30, warnings: [] }], message: '完成' },
  ],
];

describe('Run tool result contracts', () => {
  it.each(validResults)(
    'validates the consumed contract of %s without changing the original',
    (toolName, output) => {
      const original = structuredClone(output);
      expect(parseRunToolResult(toolName, output).kind).toBe(toolName);
      expect(output).toEqual(original);
      expect(parseRunToolResult(toolName, { ...(output as object), extra: '附加信息' }).kind).toBe(
        toolName,
      );
    },
  );

  it.each(validResults.map(([name]) => name))(
    'rejects malformed %s with no raw output in the error',
    (toolName) => {
      expect(() => parseRunToolResult(toolName, { raw: '敏感正文' })).toThrow(
        `工具结果契约错误：${toolName}`,
      );
      expect(() => parseRunToolResult(toolName, { raw: '敏感正文' })).not.toThrow('敏感正文');
    },
  );

  it.each([
    ['read_text_file', { path: 'p', content: 't', sections: [{ locator: 'l', content: 3 }] }],
    ['read_text_file', { path: 'p', content: 't', scope: 'workspace' }],
    ['read_text_file', { path: 'p', content: 't', material: { ...material, snapshotId: '' } }],
    [
      'read_office_material',
      { material, format: 'csv', contentHash: 'h', sections: [{ locator: 'l' }] },
    ],
    ['read_office_material', { material, format: 'pdf', contentHash: 'h', sections: [] }],
    [
      'knowledge_search',
      {
        results: [
          {
            title: 't',
            sourcePath: 'p',
            locator: 'l',
            excerpt: 't',
            contentHash: 'h',
            evidenceId: 3,
          },
        ],
      },
    ],
    ['read_knowledge', { parts: [{ text: 't' }] }],
    ['web_search', { results: [{ title: 't', url: 'u', snippet: 't', site: 3 }] }],
    ['web_fetch', { url: 'u', title: 't', content: 't', contentType: 'text/plain', status: '200' }],
    [
      'analyze_business_metrics',
      { period: 'p', message: 'm', metrics: [{ metric: 'm', current: '30', warnings: [] }] },
    ],
  ])('rejects invalid nested/optional fields of %s', (toolName, output) => {
    expect(() => parseRunToolResult(toolName, output)).toThrow('工具结果契约错误');
  });

  it.each([
    'calculator',
    'skill_execute',
    'skill_read_resource',
    'artifact_register_file',
    'artifact_declare_sources',
  ])('leaves callback-owned effects for %s alone', (toolName) => {
    expect(parseRunToolResult(toolName, undefined)).toEqual({ kind: 'no-additional-effects' });
  });

  it.each([undefined, null, 'text', 30, ['opaque'], { arbitrary: 'value' }])(
    'preserves opaque MCP result %j',
    (output) => {
      const result = parseRunToolResult('mcp_example', output);
      expect(result).toEqual({ kind: 'mcp', toolName: 'mcp_example', output });
      if (result.kind === 'mcp') expect(result.output).toBe(output);
    },
  );

  it.each([undefined, '', 'custom_tool'])(
    'rejects an absent or unregistered tool name %s',
    (toolName) => {
      expect(() => parseRunToolResult(toolName, {})).toThrow('没有对应的结果适配');
    },
  );

  it('preserves all original deterministic fields and extreme arithmetic serialization', () => {
    const output = {
      period: 'p',
      metrics: [{ metric: 'm', current: 1e308, change: Infinity, warnings: [], extra: 123 }],
      message: 'm',
      extra: 456,
    };
    const result = parseRunToolResult('analyze_business_metrics', output);
    if (result.kind !== 'analyze_business_metrics') throw new Error('unexpected kind');
    expect(result.output).toBe(output);
    expect(JSON.stringify(result.output)).toBe(JSON.stringify(output));
  });
});
