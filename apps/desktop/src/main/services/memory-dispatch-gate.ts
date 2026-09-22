import { createHash } from 'node:crypto';

import type { ModelProvider, ModelRequest } from '@betterwork/agent-core';
import { stableStringifyJson } from '@betterwork/agent-protocol';

import { MEMORY_BLOCK_HEADER } from './memory-recall-service';

/**
 * 契约 §6.4：首个 ModelRequest 装配完成后先核对记忆块、再落 `request-prepared`，
 * 真正开始消费委托 Provider 前落 `dispatch-attempted`；任一环节失败都不发包。
 */
export interface RunMemoryAuditSink {
  markRequestPrepared(input: {
    runId: string;
    requestHash: string;
    modelSnapshot: Record<string, unknown>;
  }): void;
  markDispatchAttempted(input: { runId: string }): void;
}

/** 只哈希实际发包的可序列化部分；signal 与凭据都不进指纹。 */
export const modelRequestHash = (request: ModelRequest): string =>
  createHash('sha256')
    .update(
      stableStringifyJson({
        messages: request.messages,
        tools: request.tools,
        ...(request.maxOutputTokens === undefined
          ? {}
          : { maxOutputTokens: request.maxOutputTokens }),
      }),
    )
    .digest('hex');

/** 记忆块与已落库的记忆选择不符：宁可不发包，也不发出解释不了的请求。 */
export class MemoryBlockMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryBlockMismatchError';
  }
}

/**
 * §6.4「核对记忆块修订」：装配阶段用的那份正文与真正要发出去的那份必须是同一份，
 * 否则审计里记下的选择解释不了实际请求。`memoryBlock` 为空串表示这次运行不注入记忆，
 * 此时请求里出现任何带记忆块表头的系统消息都算不符。
 */
export const assertMemoryBlockMatches = (request: ModelRequest, memoryBlock: string): void => {
  const injected = request.messages.filter(
    (message) => message.role === 'system' && message.content.includes(MEMORY_BLOCK_HEADER),
  );
  if (memoryBlock === '') {
    if (injected.length === 0) return;
    throw new MemoryBlockMismatchError('这次运行没有可注入的记忆，但请求里出现了记忆块。');
  }
  if (injected.length === 1 && injected[0]?.content === memoryBlock) return;
  throw new MemoryBlockMismatchError('请求中的记忆块与已记录的记忆修订不一致。');
};

export const withRunMemoryAudit = (
  provider: ModelProvider,
  gate: {
    runId: string;
    sink: RunMemoryAuditSink;
    modelSnapshot: Record<string, unknown>;
    /** 与 `selected_items_json` 同一次装配产出的记忆块正文；不注入时为空串。 */
    memoryBlock: string;
  },
): ModelProvider => {
  let audited = false;
  return {
    id: provider.id,
    stream: (request) => {
      if (!audited) {
        audited = true;
        assertMemoryBlockMatches(request, gate.memoryBlock);
        gate.sink.markRequestPrepared({
          runId: gate.runId,
          requestHash: modelRequestHash(request),
          modelSnapshot: gate.modelSnapshot,
        });
        gate.sink.markDispatchAttempted({ runId: gate.runId });
      }
      return provider.stream(request);
    },
  };
};
