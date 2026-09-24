/** 知识域稳定错误码（契约 §13.1）。 */
export type KnowledgeErrorCode =
  | 'KNOWLEDGE_NOT_SELECTED'
  | 'KNOWLEDGE_REVISION_MISMATCH'
  | 'KNOWLEDGE_CURSOR_INVALID'
  | 'KNOWLEDGE_READ_BUDGET_EXCEEDED'
  | 'KNOWLEDGE_AUDIT_FAILED'
  | 'KNOWLEDGE_DOCUMENT_REMOVED'
  | 'PARSER_NONDETERMINISTIC'
  | 'EXTRACTION_LIMIT_EXCEEDED'
  | 'EMBEDDING_MODEL_UNAVAILABLE'
  | 'EMBEDDING_RESPONSE_INVALID'
  | 'EMBEDDING_TIMEOUT'
  | 'INDEX_CAPACITY_EXCEEDED'
  | 'INDEX_CONFIGURATION_CHANGED'
  | 'INDEX_ITEM_NOT_RETRYABLE'
  | 'OPERATION_CONFLICT'
  | 'REVISION_CONFLICT'
  | 'WORKER_TIMEOUT'
  | 'WORKER_UNAVAILABLE'
  | 'WORKER_EXTRACT_FAILED';

export class KnowledgeServiceError extends Error {
  constructor(
    readonly code: KnowledgeErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'KnowledgeServiceError';
  }
}
