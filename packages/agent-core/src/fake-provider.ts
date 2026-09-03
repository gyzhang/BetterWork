import { randomUUID } from 'node:crypto';
import type { ModelProvider, ModelRequest, ModelStreamChunk } from './types';

const pause = async (signal: AbortSignal, delayMs: number): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Run cancelled'), { name: 'AbortError' }));
    }, { once: true });
  });
};

export class FakeModelProvider implements ModelProvider {
  readonly id = 'fake';

  constructor(private readonly delayMs = 12) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const last = request.messages.at(-1);
    if (!last) return;

    if (last.role === 'tool') {
      const parsed = JSON.parse(last.content) as unknown;
      const text = last.toolName === 'calculator'
        ? `计算结果是 ${typeof parsed === 'object' && parsed !== null && 'result' in parsed ? String(parsed.result) : last.content}。`
        : last.toolName === 'knowledge_search'
          ? `已检索个人资料库。${typeof parsed === 'object' && parsed !== null && 'message' in parsed ? String(parsed.message) : ''}\n\n${typeof parsed === 'object' && parsed !== null && 'results' in parsed && Array.isArray(parsed.results) ? parsed.results.map((result) => typeof result === 'object' && result !== null && 'title' in result && 'excerpt' in result ? `- ${String(result.title)}：${String(result.excerpt)}` : '').filter(Boolean).join('\n') : ''}`
        : `文件内容如下：\n\n${typeof parsed === 'object' && parsed !== null && 'content' in parsed ? String(parsed.content) : last.content}`;
      for (const piece of text.match(/.{1,5}/gu) ?? []) {
        await pause(request.signal, this.delayMs);
        yield { type: 'text-delta', delta: piece };
      }
      yield { type: 'done' };
      return;
    }

    const prompt = last.content.trim();
    const calculation = prompt.match(/^(?:计算|calculate)\s*[:：]?\s*(.+)$/i);
    if (calculation?.[1]) {
      yield { type: 'reasoning-delta', delta: '选择确定性计算工具。' };
      yield {
        type: 'tool-call',
        toolCall: { id: randomUUID(), name: 'calculator', input: { expression: calculation[1] } },
      };
      yield { type: 'done' };
      return;
    }

    const read = prompt.match(/^(?:读取|read)\s*[:：]?\s*(.+)$/i);
    if (read?.[1]) {
      yield { type: 'reasoning-delta', delta: '读取工作区内的文本文件。' };
      yield {
        type: 'tool-call',
        toolCall: { id: randomUUID(), name: 'read_text_file', input: { path: read[1].trim() } },
      };
      yield { type: 'done' };
      return;
    }

    const knowledgeSearch = prompt.match(/^(?:搜索知识|检索知识|search knowledge)\s*[:：]?\s*(.+)$/i);
    if (knowledgeSearch?.[1]) {
      yield { type: 'reasoning-delta', delta: '检索个人资料库中的相关内容。' };
      yield {
        type: 'tool-call',
        toolCall: { id: randomUUID(), name: 'knowledge_search', input: { query: knowledgeSearch[1].trim() } },
      };
      yield { type: 'done' };
      return;
    }

    const text = `这是算台的基础教学运行。你可以输入“计算: (12 + 8) * 3”、“读取: README.md”或“搜索知识: 市场”来观察工具调用。`;
    for (const piece of text.match(/.{1,6}/gu) ?? []) {
      await pause(request.signal, this.delayMs);
      yield { type: 'text-delta', delta: piece };
    }
    yield { type: 'done' };
  }
}
