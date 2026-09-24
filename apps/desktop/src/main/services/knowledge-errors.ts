/** 知识域稳定错误码（契约 §13.1），KM01 先覆盖修订身份、游标与提取限额。 */
export type KnowledgeErrorCode =
  | 'KNOWLEDGE_CURSOR_INVALID'
  | 'KNOWLEDGE_REVISION_MISMATCH'
  | 'KNOWLEDGE_DOCUMENT_REMOVED'
  | 'PARSER_NONDETERMINISTIC'
  | 'EXTRACTION_LIMIT_EXCEEDED';

export class KnowledgeServiceError extends Error {
  constructor(
    readonly code: KnowledgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'KnowledgeServiceError';
  }
}
