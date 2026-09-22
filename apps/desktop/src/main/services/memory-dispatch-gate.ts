import { createHash } from 'node:crypto';

import type { ModelProvider, ModelRequest } from '@betterwork/agent-core';
import { stableStringifyJson } from '@betterwork/agent-protocol';

/**
 * 契约 §6.4：首个 ModelRequest 装配完成后先落 `request-prepared`，
 * 真正开始消费委托 Provider 前再落 `dispatch-attempted`；两次落库任一失败都不发包。
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

export const withRunMemoryAudit = (
  provider: ModelProvider,
  gate: {
    runId: string;
    sink: RunMemoryAuditSink;
    modelSnapshot: Record<string, unknown>;
  },
): ModelProvider => {
  let audited = false;
  return {
    id: provider.id,
    stream: (request) => {
      if (!audited) {
        audited = true;
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
