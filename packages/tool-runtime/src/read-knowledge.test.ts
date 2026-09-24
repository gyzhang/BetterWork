import { isAbortError, type ToolExecutionContext } from '@betterwork/agent-core';
import {
  KNOWLEDGE_PAGE_MAX_CODE_POINTS,
  type KnowledgeMaterialReference,
  type KnowledgeReadRequest,
  type KnowledgeTextPage,
} from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { createKnowledgeReadTool } from './read-knowledge';

const reference: KnowledgeMaterialReference = {
  kind: 'knowledge-revision',
  knowledgeDocumentId: 'doc-1',
  knowledgeRevisionId: 'rev-1',
  contentHash: 'hash-1',
  sourcePath: '/notes/资料.md',
};

const page: KnowledgeTextPage = {
  reference,
  textHash: 'text-hash-1',
  title: '资料',
  parserVersion: 'text-extract-v1',
  chunkingVersion: 'format-locator-v1',
  warnings: [],
  parts: [
    {
      span: { sectionOrdinal: 0, start: 0, end: 5 },
      locator: '全文',
      text: '第一段',
      excerptHash: 'eh',
    },
  ],
  returnedCodePoints: 3,
  complete: false,
  nextCursor: { revisionId: 'rev-1', textHash: 'text-hash-1', sectionOrdinal: 0, offset: 3 },
};

const context = (aborted = false): ToolExecutionContext => ({
  runId: 'run-1',
  toolCallId: 'call-1',
  workspacePath: '/tmp',
  signal: { aborted } as AbortSignal,
  reportProgress: () => undefined,
});

describe('createKnowledgeReadTool', () => {
  it('passes the validated request and host context through to the audited reader', async () => {
    const seen: Array<[KnowledgeReadRequest, ToolExecutionContext]> = [];
    const tool = createKnowledgeReadTool((request, toolContext) => {
      seen.push([request, toolContext]);
      return { ...page, parts: [], remainingRunCodePoints: 60_000 };
    });
    await tool.execute({ reference }, context());
    expect(seen[0]?.[0]).toEqual({ reference });
    expect(seen[0]?.[1].toolCallId).toBe('call-1');
  });

  it('rejects oversized pages and forged schemas before touching the vault', async () => {
    const tool = createKnowledgeReadTool(() => ({
      ...page,
      parts: [],
      remainingRunCodePoints: 0,
    }));
    await expect(
      tool.execute({ reference, maxCodePoints: KNOWLEDGE_PAGE_MAX_CODE_POINTS + 1 }, context()),
    ).rejects.toThrow();
    await expect(
      tool.execute({ reference: { kind: 'artifact-version' } }, context()),
    ).rejects.toThrow();
  });

  it('honours cancellation before the read with the unified abort error', async () => {
    const tool = createKnowledgeReadTool(() => ({
      ...page,
      parts: [],
      remainingRunCodePoints: 0,
    }));
    const error: unknown = await tool.execute({ reference }, context(true)).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(isAbortError(error)).toBe(true);
  });
});
