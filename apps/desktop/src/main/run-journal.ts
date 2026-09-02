import Database from 'better-sqlite3';
import type { AgentRuntimeEvent, ModelProfileInput, ModelProfileSummary, RunSummary } from '@betterwork/agent-protocol';
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
      CREATE TABLE IF NOT EXISTS model_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        role TEXT NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0,
        max_context_tokens INTEGER NOT NULL DEFAULT 8192,
        max_output_tokens INTEGER NOT NULL DEFAULT 8192,
        temperature REAL NOT NULL DEFAULT 0.7,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
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

  listModels(): ModelProfileSummary[] {
    const rows = this.db.prepare('SELECT * FROM model_profiles ORDER BY priority ASC, created_at ASC').all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.toModelSummary(row));
  }

  getModel(id: string): (ModelProfileSummary & { apiKey: string }) | undefined {
    const row = this.db.prepare('SELECT * FROM model_profiles WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return { ...this.toModelSummary(row), apiKey: String(row.api_key ?? '') };
  }

  getModelForRun(role: ModelProfileSummary['role']): { id: string; baseUrl: string; apiKey: string; model: string; temperature: number; maxOutputTokens: number } | undefined {
    const row = this.db.prepare('SELECT id, base_url, api_key, model, temperature, max_output_tokens FROM model_profiles WHERE role = ? AND enabled = 1 ORDER BY priority ASC LIMIT 1').get(role) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return { id: String(row.id), baseUrl: String(row.base_url), apiKey: String(row.api_key ?? ''), model: String(row.model), temperature: Number(row.temperature), maxOutputTokens: Number(row.max_output_tokens) };
  }

  saveModel(input: ModelProfileInput & { id?: string | undefined }): string {
    const now = Date.now();
    const id = input.id ?? `model-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const existing = this.db.prepare('SELECT id, created_at FROM model_profiles WHERE id = ?').get(id) as { id: string; created_at: number } | undefined;
    const priority = existing ? undefined : this.db.prepare('SELECT COALESCE(MAX(priority), -1) + 1 AS next FROM model_profiles').get() as { next: number };
    if (existing) {
      const apiKey = input.apiKey ? input.apiKey : String((this.db.prepare('SELECT api_key FROM model_profiles WHERE id = ?').get(id) as { api_key: string }).api_key);
      this.db.prepare(`UPDATE model_profiles SET name=?, provider=?, base_url=?, model=?, role=?, api_key=?, enabled=?, priority=COALESCE(?, priority), max_context_tokens=?, max_output_tokens=?, temperature=?, updated_at=? WHERE id=?`)
        .run(input.name, input.provider, input.baseUrl, input.model, input.role, apiKey, input.enabled ? 1 : 0, input.priority ?? null, input.maxContextTokens, input.maxOutputTokens, input.temperature, now, id);
    } else {
      this.db.prepare(`INSERT INTO model_profiles (id,name,provider,base_url,model,role,api_key,enabled,priority,max_context_tokens,max_output_tokens,temperature,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, input.name, input.provider, input.baseUrl, input.model, input.role, input.apiKey ?? '', input.enabled ? 1 : 0, input.priority ?? priority!.next, input.maxContextTokens, input.maxOutputTokens, input.temperature, now, now);
    }
    return id;
  }

  deleteModel(id: string): boolean {
    return this.db.prepare('DELETE FROM model_profiles WHERE id = ?').run(id).changes > 0;
  }

  private toModelSummary(row: Record<string, unknown>): ModelProfileSummary {
    return {
      id: String(row.id), name: String(row.name), provider: String(row.provider), baseUrl: String(row.base_url), model: String(row.model),
      role: row.role as ModelProfileSummary['role'], apiKeyConfigured: Boolean(row.api_key), enabled: Boolean(row.enabled), priority: Number(row.priority),
      maxContextTokens: Number(row.max_context_tokens), maxOutputTokens: Number(row.max_output_tokens), temperature: Number(row.temperature),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    };
  }

  close(): void {
    this.db.close();
  }
}
