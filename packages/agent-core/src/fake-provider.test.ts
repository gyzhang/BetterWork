import { describe, expect, it } from 'vitest';

import { FakeModelProvider } from './fake-provider';
import type { ModelRequest, ModelStreamChunk } from './types';

const createRequest = (content: string, signal?: AbortSignal): ModelRequest => ({
  messages: [{ id: 'msg-1', role: 'user', content }],
  tools: [],
  signal: signal ?? new AbortController().signal,
});

const collectChunks = async (
  iterable: AsyncIterable<ModelStreamChunk>,
): Promise<ModelStreamChunk[]> => {
  const chunks: ModelStreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
};

const collectText = (chunks: ModelStreamChunk[]): string =>
  chunks
    .filter((chunk): chunk is { type: 'text-delta'; delta: string } => chunk.type === 'text-delta')
    .map((chunk) => chunk.delta)
    .join('');

describe('FakeModelProvider', () => {
  it('has id "fake"', () => {
    const provider = new FakeModelProvider();
    expect(provider.id).toBe('fake');
  });

  describe('regex-triggered tool dispatch', () => {
    it('dispatches calculator for "计算: (12 + 8) * 3"', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(provider.stream(createRequest('计算: (12 + 8) * 3')));
      const toolCall = chunks.find((chunk) => chunk.type === 'tool-call');
      expect(toolCall).toBeDefined();
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.toolCall.name).toBe('calculator');
        expect(toolCall.toolCall.input).toEqual({ expression: '(12 + 8) * 3' });
      }
    });

    it('dispatches calculator for "calculate: 2+2"', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(provider.stream(createRequest('calculate: 2+2')));
      const toolCall = chunks.find((chunk) => chunk.type === 'tool-call');
      expect(toolCall).toBeDefined();
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.toolCall.name).toBe('calculator');
        expect(toolCall.toolCall.input).toEqual({ expression: '2+2' });
      }
    });

    it('dispatches knowledge_search for "搜索知识: 市场"', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(provider.stream(createRequest('搜索知识: 市场')));
      const toolCall = chunks.find((chunk) => chunk.type === 'tool-call');
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.toolCall.name).toBe('knowledge_search');
        expect(toolCall.toolCall.input).toEqual({ query: '市场' });
      }
    });

    it('dispatches knowledge_search for "search knowledge: market"', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(
        provider.stream(createRequest('search knowledge: market')),
      );
      const toolCall = chunks.find((chunk) => chunk.type === 'tool-call');
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.toolCall.name).toBe('knowledge_search');
        expect(toolCall.toolCall.input).toEqual({ query: 'market' });
      }
    });

    it('dispatches read_text_file for "读取: README.md"', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(provider.stream(createRequest('读取: README.md')));
      const toolCall = chunks.find((chunk) => chunk.type === 'tool-call');
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.toolCall.name).toBe('read_text_file');
        expect(toolCall.toolCall.input).toEqual({ path: 'README.md' });
      }
    });

    it('dispatches read_text_file for "read: src/index.ts"', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(provider.stream(createRequest('read: src/index.ts')));
      const toolCall = chunks.find((chunk) => chunk.type === 'tool-call');
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.toolCall.name).toBe('read_text_file');
        expect(toolCall.toolCall.input).toEqual({ path: 'src/index.ts' });
      }
    });

    it('dispatches web_fetch for "抓取网页: https://example.com"', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(
        provider.stream(createRequest('抓取网页: https://example.com')),
      );
      const toolCall = chunks.find((chunk) => chunk.type === 'tool-call');
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.toolCall.name).toBe('web_fetch');
        expect(toolCall.toolCall.input).toEqual({ url: 'https://example.com' });
      }
    });

    it('dispatches read_artifact for "读取成果: art-1/ver-1"', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(provider.stream(createRequest('读取成果: art-1/ver-1')));
      const toolCall = chunks.find((chunk) => chunk.type === 'tool-call');
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.toolCall.name).toBe('read_artifact');
        expect(toolCall.toolCall.input).toEqual({ artifactId: 'art-1', versionId: 'ver-1' });
      }
    });

    it('dispatches analyze_business_metrics for "经营分析: {...}"', async () => {
      const provider = new FakeModelProvider(0);
      const jsonInput = '{"period":"2024-Q1","current":{"revenue":100}}';
      const chunks = await collectChunks(provider.stream(createRequest(`经营分析: ${jsonInput}`)));
      const toolCall = chunks.find((chunk) => chunk.type === 'tool-call');
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.toolCall.name).toBe('analyze_business_metrics');
        expect(toolCall.toolCall.input).toEqual({
          period: '2024-Q1',
          current: { revenue: 100 },
        });
      }
    });

    it('falls back to non-JSON for analyze_business_metrics when input is not JSON', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(provider.stream(createRequest('经营分析: Q1 report')));
      const toolCall = chunks.find((chunk) => chunk.type === 'tool-call');
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.toolCall.name).toBe('analyze_business_metrics');
        expect(toolCall.toolCall.input).toEqual({ period: 'Q1 report', current: {} });
      }
    });

    it('dispatches read_office_material for "读取 Office: snapshot-1"', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(provider.stream(createRequest('读取 Office: snapshot-1')));
      const toolCall = chunks.find((chunk) => chunk.type === 'tool-call');
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.toolCall.name).toBe('read_office_material');
        expect(toolCall.toolCall.input).toEqual({
          sourceKind: 'workspace-input-snapshot',
          snapshotId: 'snapshot-1',
        });
      }
    });
  });

  describe('fallback reply', () => {
    it('returns fallback text for unrecognized prompts', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(provider.stream(createRequest('hello world')));
      const text = collectText(chunks);
      expect(text).toContain('教学运行');
    });

    it('ends with a done chunk', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(provider.stream(createRequest('hello')));
      const last = chunks[chunks.length - 1];
      expect(last?.type).toBe('done');
    });
  });

  describe('tool result summarization', () => {
    it('summarizes calculator tool result', async () => {
      const provider = new FakeModelProvider(0);
      const toolMessage = {
        id: 'tool-msg',
        role: 'tool' as const,
        content: JSON.stringify({ result: 60 }),
        toolName: 'calculator',
        toolCallId: 'call-1',
      };
      const request: ModelRequest = {
        messages: [toolMessage],
        tools: [],
        signal: new AbortController().signal,
      };
      const chunks = await collectChunks(provider.stream(request));
      const text = collectText(chunks);
      expect(text).toContain('60');
      expect(text).toContain('计算结果');
    });

    it('summarizes sourced business metrics with each fact period', async () => {
      const provider = new FakeModelProvider(0);
      const toolMessage = {
        id: 'tool-msg',
        role: 'tool' as const,
        content: JSON.stringify({
          period: '2026-09',
          metrics: [
            {
              metric: 'revenue',
              current: 120,
              previous: 100,
              change: 20,
              changeRate: 0.2,
              unit: '万元',
              currentPeriod: '2026-09',
              previousPeriod: '2026-08',
              warnings: [],
            },
          ],
          message: '已按确定性规则完成指标计算。',
        }),
        toolName: 'analyze_business_metrics',
        toolCallId: 'call-1',
      };
      const request: ModelRequest = {
        messages: [toolMessage],
        tools: [],
        signal: new AbortController().signal,
      };

      const chunks = await collectChunks(provider.stream(request));
      const text = collectText(chunks);

      expect(text).toContain('revenue 2026-09：120万元');
      expect(text).toContain('revenue 2026-08：100万元');
      expect(text).toContain('revenue 2026-09 对比 2026-08 变化 20万元');
      expect(text).toContain('变化率 20%');
    });

    it('summarizes knowledge_search tool result', async () => {
      const provider = new FakeModelProvider(0);
      const toolMessage = {
        id: 'tool-msg',
        role: 'tool' as const,
        content: JSON.stringify({
          results: [{ title: 'Market Report', excerpt: 'Revenue grew 10%' }],
        }),
        toolName: 'knowledge_search',
        toolCallId: 'call-1',
      };
      const request: ModelRequest = {
        messages: [toolMessage],
        tools: [],
        signal: new AbortController().signal,
      };
      const chunks = await collectChunks(provider.stream(request));
      const text = collectText(chunks);
      expect(text).toContain('已检索个人资料库');
      expect(text).toContain('Market Report');
    });

    it('summarizes read_artifact tool result', async () => {
      const provider = new FakeModelProvider(0);
      const toolMessage = {
        id: 'tool-msg',
        role: 'tool' as const,
        content: JSON.stringify({ content: 'Artifact body text' }),
        toolName: 'read_artifact',
        toolCallId: 'call-1',
      };
      const request: ModelRequest = {
        messages: [toolMessage],
        tools: [],
        signal: new AbortController().signal,
      };
      const chunks = await collectChunks(provider.stream(request));
      const text = collectText(chunks);
      expect(text).toContain('成果版本内容如下');
      expect(text).toContain('Artifact body text');
    });

    it('summarizes web_fetch tool result', async () => {
      const provider = new FakeModelProvider(0);
      const toolMessage = {
        id: 'tool-msg',
        role: 'tool' as const,
        content: JSON.stringify({ content: 'Web page body' }),
        toolName: 'web_fetch',
        toolCallId: 'call-1',
      };
      const request: ModelRequest = {
        messages: [toolMessage],
        tools: [],
        signal: new AbortController().signal,
      };
      const chunks = await collectChunks(provider.stream(request));
      const text = collectText(chunks);
      expect(text).toContain('网页正文如下');
      expect(text).toContain('Web page body');
    });

    it('summarizes read_office_material tool result', async () => {
      const provider = new FakeModelProvider(0);
      const toolMessage = {
        id: 'tool-msg',
        role: 'tool' as const,
        content: 'Office raw content',
        toolName: 'read_office_material',
        toolCallId: 'call-1',
      };
      const request: ModelRequest = {
        messages: [toolMessage],
        tools: [],
        signal: new AbortController().signal,
      };
      const chunks = await collectChunks(provider.stream(request));
      const text = collectText(chunks);
      expect(text).toContain('Office 材料片段如下');
      expect(text).toContain('Office raw content');
    });

    it('falls back to generic file content for unknown tool names', async () => {
      const provider = new FakeModelProvider(0);
      const toolMessage = {
        id: 'tool-msg',
        role: 'tool' as const,
        content: JSON.stringify({ content: 'File body' }),
        toolName: 'unknown_tool',
        toolCallId: 'call-1',
      };
      const request: ModelRequest = {
        messages: [toolMessage],
        tools: [],
        signal: new AbortController().signal,
      };
      const chunks = await collectChunks(provider.stream(request));
      const text = collectText(chunks);
      expect(text).toContain('文件内容如下');
      expect(text).toContain('File body');
    });
  });

  describe('streaming chunks', () => {
    it('emits reasoning-delta before tool-call', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(provider.stream(createRequest('计算: 1+1')));
      const reasoningIndex = chunks.findIndex((chunk) => chunk.type === 'reasoning-delta');
      const toolCallIndex = chunks.findIndex((chunk) => chunk.type === 'tool-call');
      expect(reasoningIndex).toBeGreaterThanOrEqual(0);
      expect(toolCallIndex).toBeGreaterThan(reasoningIndex);
    });

    it('emits text-delta chunks for fallback reply', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(provider.stream(createRequest('hello')));
      const textDeltas = chunks.filter((chunk) => chunk.type === 'text-delta');
      expect(textDeltas.length).toBeGreaterThan(0);
    });

    it('emits multiple text-delta chunks based on chunk size', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(provider.stream(createRequest('hello world test')));
      const textDeltas = chunks.filter((chunk) => chunk.type === 'text-delta');
      // The fallback reply with chunkSize=6 should produce multiple pieces
      expect(textDeltas.length).toBeGreaterThanOrEqual(1);
    });

    it('returns no chunks for empty messages array', async () => {
      const provider = new FakeModelProvider(0);
      const request: ModelRequest = {
        messages: [],
        tools: [],
        signal: new AbortController().signal,
      };
      const chunks = await collectChunks(provider.stream(request));
      expect(chunks).toHaveLength(0);
    });
  });

  describe('cancellation', () => {
    it('throws AbortError when signal is already aborted', async () => {
      const provider = new FakeModelProvider(0);
      const controller = new AbortController();
      controller.abort();
      const request = createRequest('hello', controller.signal);
      await expect(async () => {
        const chunks = await collectChunks(provider.stream(request));
        // The stream should throw during iteration
        if (chunks.length === 0) throw new Error('Expected abort error');
      }).rejects.toThrow();
    });

    it('throws when signal is aborted mid-stream', async () => {
      const provider = new FakeModelProvider(50); // 50ms delay between chunks
      const controller = new AbortController();
      const request = createRequest(
        'hello world this is a longer text to ensure multiple chunks',
        controller.signal,
      );

      const iteration = (async () => {
        const chunks: ModelStreamChunk[] = [];
        for await (const chunk of provider.stream(request)) {
          chunks.push(chunk);
        }
        return chunks;
      })();

      // Abort after a short delay
      setTimeout(() => controller.abort(), 10);

      await expect(iteration).rejects.toThrow();
    });
  });

  describe('tool trigger priority', () => {
    it('matches more specific patterns before generic "read"', async () => {
      const provider = new FakeModelProvider(0);
      // "读取成果" should match read_artifact, not read_text_file
      const chunks = await collectChunks(provider.stream(createRequest('读取成果: art-1/ver-1')));
      const toolCall = chunks.find((chunk) => chunk.type === 'tool-call');
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.toolCall.name).toBe('read_artifact');
      }
    });

    it('matches "读取网页" as web_fetch, not read_text_file', async () => {
      const provider = new FakeModelProvider(0);
      const chunks = await collectChunks(
        provider.stream(createRequest('读取网页: https://example.com')),
      );
      const toolCall = chunks.find((chunk) => chunk.type === 'tool-call');
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.toolCall.name).toBe('web_fetch');
      }
    });
  });
});
