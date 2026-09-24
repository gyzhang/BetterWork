import type Database from 'better-sqlite3';

interface ReceiptRow {
  operation_id: string;
  input_hash: string;
  task_id: string;
  context_id: string;
  prompt: string;
  created_at: number;
}

export interface ResearchDraftReceipt {
  operationId: string;
  inputHash: string;
  taskId: string;
  contextId: string;
  prompt: string;
  createdAt: number;
}

/** KM03（契约 §4）：研究草稿的幂等回执；重试以 operationId 命中并返回原草稿。 */
export class ResearchDraftOperationRepository {
  constructor(private readonly db: Database.Database) {}

  get(operationId: string): ResearchDraftReceipt | undefined {
    const row = this.db
      .prepare('SELECT * FROM research_draft_operations WHERE operation_id = ?')
      .get(operationId) as ReceiptRow | undefined;
    return row
      ? {
          operationId: row.operation_id,
          inputHash: row.input_hash,
          taskId: row.task_id,
          contextId: row.context_id,
          prompt: row.prompt,
          createdAt: row.created_at,
        }
      : undefined;
  }

  insert(receipt: ResearchDraftReceipt): void {
    this.db
      .prepare(
        `INSERT INTO research_draft_operations
           (operation_id, input_hash, task_id, context_id, prompt, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.operationId,
        receipt.inputHash,
        receipt.taskId,
        receipt.contextId,
        receipt.prompt,
        receipt.createdAt,
      );
  }
}
