import Database from 'better-sqlite3';
import type { AgentRuntimeEvent, RunSummary } from '@betterwork/agent-protocol';
import { agentRuntimeEventSchema } from '@betterwork/agent-protocol';

interface RunRow {
  id: string;
  task_id: string;
  session_id: string;
  prompt: string;
  status: RunSummary['status'];
  created_at: number;
  completed_at: number | null;
}

export class RunJournal {
  private readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(run_id, sequence)
      );
    `);
  }

  createRun(run: RunSummary): void {
    this.db.prepare(`
      INSERT INTO runs (id, task_id, session_id, prompt, status, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(run.id, run.taskId, run.sessionId, run.prompt, run.status, run.createdAt, run.completedAt ?? null);
  }

  appendEvent(event: AgentRuntimeEvent): void {
    agentRuntimeEventSchema.parse(event);
    const terminalStatus = event.type === 'run.completed' ? 'completed'
      : event.type === 'run.failed' ? 'failed'
        : event.type === 'run.cancelled' ? 'cancelled'
          : undefined;
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO run_events (id, run_id, sequence, type, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(event.id, event.runId, event.sequence, event.type, JSON.stringify(event), event.createdAt);
      if (terminalStatus) {
        this.db.prepare('UPDATE runs SET status = ?, completed_at = ? WHERE id = ?')
          .run(terminalStatus, event.createdAt, event.runId);
      }
    });
    transaction();
  }

  listRuns(): RunSummary[] {
    const rows = this.db.prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT 100').all() as RunRow[];
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      sessionId: row.session_id,
      prompt: row.prompt,
      status: row.status,
      createdAt: row.created_at,
      ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    }));
  }

  listEvents(runId: string): AgentRuntimeEvent[] {
    const rows = this.db.prepare('SELECT payload FROM run_events WHERE run_id = ? ORDER BY sequence ASC')
      .all(runId) as Array<{ payload: string }>;
    return rows.map((row) => agentRuntimeEventSchema.parse(JSON.parse(row.payload)));
  }

  close(): void {
    this.db.close();
  }
}
