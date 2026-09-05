import { randomUUID } from 'node:crypto';

import { abortError } from './errors';
import type { ModelProvider, ModelRequest, ModelStreamChunk } from './types';

/**
 * 教学用 Provider：不联网、输出可预测，用于稳定复现事件顺序与工具行为。
 *
 * 刻意不支持 `web_search` 触发词——联网搜索会发起真实请求并消耗配额，
 * 与「离线可复现」的教学定位冲突。要观察 web_search，请配置真实语言模型。
 */

interface ToolTrigger {
  readonly pattern: RegExp;
  readonly tool: string;
  readonly reasoning: string;
  readonly toInput: (captured: string) => Record<string, unknown>;
}

const TOOL_TRIGGERS: readonly ToolTrigger[] = [
  {
    pattern: /^(?:计算|calculate)\s*[:：]?\s*(.+)$/iu,
    tool: 'calculator',
    reasoning: '选择确定性计算工具。',
    toInput: (expression) => ({ expression }),
  },
  {
    pattern: /^(?:读取|read)\s*[:：]?\s*(.+)$/iu,
    tool: 'read_text_file',
    reasoning: '读取工作区内的文本文件。',
    toInput: (target) => ({ path: target.trim() }),
  },
  {
    pattern: /^(?:搜索知识|检索知识|search knowledge)\s*[:：]?\s*(.+)$/iu,
    tool: 'knowledge_search',
    reasoning: '检索个人资料库中的相关内容。',
    toInput: (query) => ({ query: query.trim() }),
  },
];

const FALLBACK_REPLY =
  '这是算台的基础教学运行。你可以输入“计算: (12 + 8) * 3”、“读取: README.md”或“搜索知识: 市场”来观察工具调用。';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseToolOutput = (content: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const readText = (value: unknown): string => (typeof value === 'string' ? value : '');

const readNumberOrText = (value: unknown): string => {
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return '';
};

const listResults = (
  output: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> => {
  if (!output || !Array.isArray(output.results)) return [];
  return output.results.filter(isRecord);
};

/** 把工具输出转成一句用户能读懂的中文回复，替代此前层层嵌套的三元表达式。 */
function summarizeToolResult(toolName: string | undefined, rawContent: string): string {
  const output = parseToolOutput(rawContent);

  if (toolName === 'calculator') {
    const result = readNumberOrText(output?.result);
    return `计算结果是 ${result || rawContent}。`;
  }

  if (toolName === 'knowledge_search' || toolName === 'web_search') {
    const heading = toolName === 'knowledge_search' ? '已检索个人资料库。' : '已完成联网搜索。';
    const lines = listResults(output).map((result) => {
      const title = readText(result.title);
      const excerpt = readText(result.excerpt) || readText(result.snippet);
      return title ? `- ${title}：${excerpt}` : '';
    });
    return `${heading}${readText(output?.message)}\n\n${lines.filter(Boolean).join('\n')}`.trimEnd();
  }

  return `文件内容如下：\n\n${readText(output?.content) || rawContent}`;
}

export class FakeModelProvider implements ModelProvider {
  readonly id = 'fake';

  constructor(private readonly delayMs = 12) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const last = request.messages.at(-1);
    if (!last) return;

    if (last.role === 'tool') {
      yield* this.streamText(summarizeToolResult(last.toolName, last.content), request.signal, 5);
      return;
    }

    const prompt = last.content.trim();
    for (const trigger of TOOL_TRIGGERS) {
      const match = prompt.match(trigger.pattern);
      const captured = match?.[1];
      if (!captured) continue;
      yield { type: 'reasoning-delta', delta: trigger.reasoning };
      yield {
        type: 'tool-call',
        toolCall: {
          id: randomUUID(),
          name: trigger.tool,
          input: trigger.toInput(captured),
        },
      };
      yield { type: 'done' };
      return;
    }

    yield* this.streamText(FALLBACK_REPLY, request.signal, 6);
  }

  /** 按固定字数切片模拟流式输出，每片之间等待，便于观察 UI 的增量渲染。 */
  private async *streamText(
    text: string,
    signal: AbortSignal,
    chunkSize: number,
  ): AsyncIterable<ModelStreamChunk> {
    for (const piece of text.match(new RegExp(`.{1,${chunkSize}}`, 'gu')) ?? []) {
      await pause(signal, this.delayMs);
      yield { type: 'text-delta', delta: piece };
    }
    yield { type: 'done' };
  }
}

/**
 * 可取消的延时。
 *
 * 定时器正常到期时必须摘掉 abort 监听：流式输出会产生成百上千次延时，
 * 每次都往同一个 AbortSignal 上挂监听会累积到触发 MaxListenersExceededWarning。
 */
const pause = async (signal: AbortSignal, delayMs: number): Promise<void> => {
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
};
