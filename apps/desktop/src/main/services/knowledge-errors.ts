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
  | 'COLLECTION_NAME_TAKEN'
  | 'COLLECTION_NOT_FOUND'
  | 'WORKER_TIMEOUT'
  | 'WORKER_UNAVAILABLE'
  | 'WORKER_EXTRACT_FAILED';

export class KnowledgeServiceError extends Error {
  readonly code: KnowledgeErrorCode;

  // Worker 入口用 Node 原生 type-stripping 执行：构造参数属性不被支持，只能在体内赋值。
  constructor(code: KnowledgeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.name = 'KnowledgeServiceError';
  }
}
