import { afterEach, describe, expect, it, vi } from 'vitest';

import { type KnowledgeErrorCode, KnowledgeServiceError } from './knowledge-errors';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KnowledgeServiceError represents a stable knowledge-domain error', () => {
  const sampleCode: KnowledgeErrorCode = 'KNOWLEDGE_NOT_SELECTED';
  const sampleMessage = 'No knowledge base is selected for this workspace.';

  it('stores the error code on the .code property', () => {
    const error = new KnowledgeServiceError(sampleCode, sampleMessage);
    expect(error.code).toBe(sampleCode);
  });

  it('sets .name to "KnowledgeServiceError"', () => {
    const error = new KnowledgeServiceError(sampleCode, sampleMessage);
    expect(error.name).toBe('KnowledgeServiceError');
  });

  it('sets .message to the provided message', () => {
    const error = new KnowledgeServiceError(sampleCode, sampleMessage);
    expect(error.message).toBe(sampleMessage);
  });

  it('is an instance of Error', () => {
    const error = new KnowledgeServiceError(sampleCode, sampleMessage);
    expect(error).toBeInstanceOf(Error);
  });

  it('is an instance of KnowledgeServiceError', () => {
    const error = new KnowledgeServiceError(sampleCode, sampleMessage);
    expect(error).toBeInstanceOf(KnowledgeServiceError);
  });

  it('propagates cause when provided', () => {
    const cause = new Error('root cause');
    const error = new KnowledgeServiceError('KNOWLEDGE_AUDIT_FAILED', 'audit failed', { cause });
    expect(error.cause).toBe(cause);
  });

  it('does not set cause when not provided', () => {
    const error = new KnowledgeServiceError(sampleCode, sampleMessage);
    expect(error.cause).toBeUndefined();
  });

  it.each([
    'KNOWLEDGE_NOT_SELECTED',
    'KNOWLEDGE_REVISION_MISMATCH',
    'KNOWLEDGE_CURSOR_INVALID',
    'KNOWLEDGE_READ_BUDGET_EXCEEDED',
    'KNOWLEDGE_AUDIT_FAILED',
    'KNOWLEDGE_DOCUMENT_REMOVED',
    'PARSER_NONDETERMINISTIC',
    'EXTRACTION_LIMIT_EXCEEDED',
    'EMBEDDING_MODEL_UNAVAILABLE',
    'EMBEDDING_RESPONSE_INVALID',
    'EMBEDDING_TIMEOUT',
    'INDEX_CAPACITY_EXCEEDED',
    'INDEX_CONFIGURATION_CHANGED',
    'INDEX_ITEM_NOT_RETRYABLE',
    'OPERATION_CONFLICT',
    'REVISION_CONFLICT',
    'COLLECTION_NAME_TAKEN',
    'COLLECTION_NOT_FOUND',
    'WORKER_TIMEOUT',
    'WORKER_UNAVAILABLE',
    'WORKER_EXTRACT_FAILED',
  ] as const)('accepts the error code "%s"', (code) => {
    const error = new KnowledgeServiceError(code, `message for ${code}`);
    expect(error.code).toBe(code);
  });
});
