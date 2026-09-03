import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { AgentRuntimeEvent, ArtifactDetail, ArtifactSummary, ArtifactVersionDetail, ArtifactVersionSummary, CreatedTask, EvidenceSummary, ModelConnectionStatus, ModelProfileInput, ModelProfileSummary, RecentTaskSummary, RunSummary, SaveMarkdownArtifactRequest, TaskSummary, WorkspaceSummary } from '@betterwork/agent-protocol';
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

interface WorkspaceRow { id: string; name: string; root_path: string; created_at: number; updated_at: number; }
interface TaskRow { id: string; workspace_id: string; title: string; goal: string; created_at: number; updated_at: number; }
interface RecentTaskRow extends TaskRow { session_id: string; run_id: string | null; run_session_id: string | null; prompt: string | null; status: RunSummary['status'] | null; run_created_at: number | null; completed_at: number | null; }
interface EvidenceRow { id: string; task_id: string; run_id: string; source_type: 'local-file'; source_uri: string; title: string; locator: string; excerpt: string; content_hash: string; captured_at: number; }
interface ArtifactRow { id: string; workspace_id: string; task_id: string; type: 'markdown'; title: string; current_version_id: string; version_number: number; source_run_id: string; origin: 'assistant-run' | 'user-edit'; created_at: number; updated_at: number; }
interface ArtifactVersionRow { id: string; artifact_id: string; version_number: number; source_run_id: string; origin: 'assistant-run' | 'user-edit'; content?: string; content_hash?: string; created_at: number; }

export class RunJournal {
  private readonly db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, run_id TEXT NOT NULL,
        source_type TEXT NOT NULL, source_uri TEXT NOT NULL, title TEXT NOT NULL,
        locator TEXT NOT NULL, excerpt TEXT NOT NULL, content_hash TEXT NOT NULL,
        captured_at INTEGER NOT NULL, UNIQUE(run_id, source_uri, locator)
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, task_id TEXT NOT NULL,
        type TEXT NOT NULL, title TEXT NOT NULL, current_version_id TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifact_versions (
        id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, version_number INTEGER NOT NULL,
        content TEXT NOT NULL, content_hash TEXT NOT NULL, source_run_id TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'assistant-run',
        created_at INTEGER NOT NULL, UNIQUE(artifact_id, version_number)
      );
      CREATE TABLE IF NOT EXISTS artifact_version_evidence (
        version_id TEXT NOT NULL, evidence_id TEXT NOT NULL,
        PRIMARY KEY(version_id, evidence_id)
      );
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
    const columns = this.db.prepare('PRAGMA table_info(model_profiles)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'connection_status')) this.db.exec("ALTER TABLE model_profiles ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'untested'");
    if (!columns.some((column) => column.name === 'last_tested_at')) this.db.exec('ALTER TABLE model_profiles ADD COLUMN last_tested_at INTEGER');
    const artifactVersionColumns = this.db.prepare('PRAGMA table_info(artifact_versions)').all() as Array<{ name: string }>;
    if (!artifactVersionColumns.some((column) => column.name === 'origin')) this.db.exec("ALTER TABLE artifact_versions ADD COLUMN origin TEXT NOT NULL DEFAULT 'assistant-run'");
  }

  getOrCreateWorkspace(rootPath: string, name: string): WorkspaceSummary {
    const existing = this.db.prepare('SELECT * FROM workspaces WHERE root_path = ?').get(rootPath) as WorkspaceRow | undefined;
    if (existing) return this.toWorkspaceSummary(existing);
    const now = Date.now();
    const workspace: WorkspaceRow = { id: randomUUID(), name, root_path: rootPath, created_at: now, updated_at: now };
    this.db.prepare('INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(workspace.id, workspace.name, workspace.root_path, workspace.created_at, workspace.updated_at);
    return this.toWorkspaceSummary(workspace);
  }

  createTask(workspaceId: string, title: string, goal: string): CreatedTask {
    const workspace = this.db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as { id: string } | undefined;
    if (!workspace) throw new Error('Workspace does not exist');
    const now = Date.now();
    const task: TaskRow = { id: randomUUID(), workspace_id: workspaceId, title, goal, created_at: now, updated_at: now };
    const sessionId = randomUUID();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(task.id, task.workspace_id, task.title, task.goal, task.created_at, task.updated_at);
      this.db.prepare('INSERT INTO sessions (id, task_id, created_at) VALUES (?, ?, ?)').run(sessionId, task.id, now);
    })();
    return { task: this.toTaskSummary(task), sessionId };
  }

  listTasks(workspaceId?: string): RecentTaskSummary[] {
    const query = `SELECT t.id, t.workspace_id, t.title, t.goal, t.created_at, t.updated_at, s.id AS session_id, r.id AS run_id, r.session_id AS run_session_id, r.prompt, r.status, r.created_at AS run_created_at, r.completed_at FROM tasks t JOIN sessions s ON s.id = (SELECT id FROM sessions WHERE task_id = t.id ORDER BY created_at ASC, rowid ASC LIMIT 1) LEFT JOIN runs r ON r.id = (SELECT id FROM runs WHERE task_id = t.id ORDER BY created_at DESC, rowid DESC LIMIT 1) ${workspaceId ? 'WHERE t.workspace_id = ?' : ''} ORDER BY t.updated_at DESC, t.rowid DESC LIMIT 100`;
    const rows = (workspaceId ? this.db.prepare(query).all(workspaceId) : this.db.prepare(query).all()) as RecentTaskRow[];
    return rows.map((row) => ({
      ...this.toTaskSummary(row), sessionId: row.session_id,
      ...(row.run_id && row.run_session_id && row.prompt && row.status && row.run_created_at !== null ? { latestRun: { id: row.run_id, taskId: row.id, sessionId: row.run_session_id, prompt: row.prompt, status: row.status, createdAt: row.run_created_at, ...(row.completed_at === null ? {} : { completedAt: row.completed_at }) } } : {}),
    }));
  }

  saveLocalEvidence(input: Omit<EvidenceSummary, 'id' | 'sourceType' | 'capturedAt'>): void {
    this.db.prepare(`INSERT OR IGNORE INTO evidence (id, task_id, run_id, source_type, source_uri, title, locator, excerpt, content_hash, captured_at) VALUES (?, ?, ?, 'local-file', ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), input.taskId, input.runId, input.sourceUri, input.title, input.locator, input.excerpt, input.contentHash, Date.now());
  }

  listEvidence(taskId: string): EvidenceSummary[] {
    const rows = this.db.prepare('SELECT * FROM evidence WHERE task_id = ? ORDER BY captured_at DESC, rowid DESC').all(taskId) as EvidenceRow[];
    return rows.map((row) => ({ id: row.id, taskId: row.task_id, runId: row.run_id, sourceType: 'local-file', sourceUri: row.source_uri, title: row.title, locator: row.locator, excerpt: row.excerpt, contentHash: row.content_hash, capturedAt: row.captured_at }));
  }

  saveMarkdownArtifact(input: SaveMarkdownArtifactRequest): ArtifactSummary {
    const task = this.db.prepare('SELECT workspace_id FROM tasks WHERE id = ?').get(input.taskId) as { workspace_id: string } | undefined;
    if (!task) throw new Error('Task does not exist');
    if (input.origin === 'assistant-run') {
      const run = this.db.prepare('SELECT task_id FROM runs WHERE id = ?').get(input.runId) as { task_id: string } | undefined;
      if (!run || run.task_id !== input.taskId) throw new Error('Run does not belong to task');
    }
    const existing = input.artifactId ? this.db.prepare('SELECT id, workspace_id, task_id, current_version_id FROM artifacts WHERE id = ?').get(input.artifactId) as { id: string; workspace_id: string; task_id: string; current_version_id: string } | undefined : undefined;
    if (input.artifactId && (!existing || existing.task_id !== input.taskId || existing.workspace_id !== task.workspace_id)) throw new Error('Artifact does not belong to task');
    const artifactId = existing?.id ?? randomUUID();
    const versionId = randomUUID();
    const now = Date.now();
    const versionNumber = (this.db.prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM artifact_versions WHERE artifact_id = ?').get(artifactId) as { next: number }).next;
    const hash = createHash('sha256').update(input.content).digest('hex');
    this.db.transaction(() => {
      if (existing) {
        this.db.prepare('UPDATE artifacts SET title = ?, current_version_id = ?, updated_at = ? WHERE id = ?').run(input.title, versionId, now, artifactId);
      } else {
        this.db.prepare('INSERT INTO artifacts (id, workspace_id, task_id, type, title, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(artifactId, task.workspace_id, input.taskId, 'markdown', input.title, versionId, now, now);
      }
      this.db.prepare('INSERT INTO artifact_versions (id, artifact_id, version_number, content, content_hash, source_run_id, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(versionId, artifactId, versionNumber, input.content, hash, input.runId ?? '', input.origin, now);
      if (input.origin === 'assistant-run') this.db.prepare('INSERT OR IGNORE INTO artifact_version_evidence (version_id, evidence_id) SELECT ?, id FROM evidence WHERE task_id = ? AND run_id = ?').run(versionId, input.taskId, input.runId);
      else if (existing) this.db.prepare('INSERT OR IGNORE INTO artifact_version_evidence (version_id, evidence_id) SELECT ?, evidence_id FROM artifact_version_evidence WHERE version_id = ?').run(versionId, existing.current_version_id);
    })();
    return this.getArtifact(artifactId)!;
  }

  listArtifacts(taskId?: string): ArtifactSummary[] {
    const rows = taskId
      ? this.db.prepare(`SELECT a.id, a.workspace_id, a.task_id, a.type, a.title, a.current_version_id, v.version_number, v.source_run_id, v.origin, a.created_at, a.updated_at FROM artifacts a JOIN artifact_versions v ON v.id = a.current_version_id WHERE a.task_id = ? ORDER BY a.updated_at DESC, a.rowid DESC`).all(taskId)
      : this.db.prepare(`SELECT a.id, a.workspace_id, a.task_id, a.type, a.title, a.current_version_id, v.version_number, v.source_run_id, v.origin, a.created_at, a.updated_at FROM artifacts a JOIN artifact_versions v ON v.id = a.current_version_id ORDER BY a.updated_at DESC, a.rowid DESC`).all();
    return (rows as ArtifactRow[]).map((row) => this.toArtifactSummary(row));
  }

  getArtifactDetail(id: string): ArtifactDetail | undefined {
    const row = this.db.prepare(`SELECT a.id, a.workspace_id, a.task_id, a.type, a.title, a.current_version_id, v.version_number, v.source_run_id, v.origin, v.content, v.content_hash, a.created_at, a.updated_at FROM artifacts a JOIN artifact_versions v ON v.id = a.current_version_id WHERE a.id = ?`).get(id) as (ArtifactRow & { content: string; content_hash: string }) | undefined;
    return row ? { ...this.toArtifactSummary(row), content: row.content, contentHash: row.content_hash, evidence: this.listArtifactVersionEvidence(row.current_version_id) } : undefined;
  }

  listArtifactVersions(artifactId: string): ArtifactVersionSummary[] {
    const rows = this.db.prepare('SELECT id, artifact_id, version_number, source_run_id, origin, created_at FROM artifact_versions WHERE artifact_id = ? ORDER BY version_number DESC').all(artifactId) as ArtifactVersionRow[];
    return rows.map((row) => this.toArtifactVersionSummary(row));
  }

  getArtifactVersionDetail(id: string): ArtifactVersionDetail | undefined {
    const row = this.db.prepare('SELECT id, artifact_id, version_number, source_run_id, origin, content, content_hash, created_at FROM artifact_versions WHERE id = ?').get(id) as ArtifactVersionRow | undefined;
    return row && row.content !== undefined && row.content_hash !== undefined ? { ...this.toArtifactVersionSummary(row), content: row.content, contentHash: row.content_hash, evidence: this.listArtifactVersionEvidence(row.id) } : undefined;
  }

  createRun(run: RunSummary): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
      INSERT INTO runs (id, task_id, session_id, prompt, status, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(run.id, run.taskId, run.sessionId, run.prompt, run.status, run.createdAt, run.completedAt ?? null);
      this.db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(run.createdAt, run.taskId);
    });
    transaction();
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

  listRuns(taskId?: string): RunSummary[] {
    const rows = (taskId
      ? this.db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100').all(taskId)
      : this.db.prepare('SELECT * FROM runs ORDER BY created_at DESC, rowid DESC LIMIT 100').all()) as RunRow[];
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
      this.db.prepare(`UPDATE model_profiles SET name=?, provider=?, base_url=?, model=?, role=?, api_key=?, enabled=?, priority=COALESCE(?, priority), max_context_tokens=?, max_output_tokens=?, temperature=?, connection_status='untested', last_tested_at=NULL, updated_at=? WHERE id=?`)
        .run(input.name, input.provider, input.baseUrl, input.model, input.role, apiKey, input.enabled ? 1 : 0, input.priority ?? null, input.maxContextTokens, input.maxOutputTokens, input.temperature, now, id);
    } else {
      this.db.prepare(`INSERT INTO model_profiles (id,name,provider,base_url,model,role,api_key,enabled,priority,max_context_tokens,max_output_tokens,temperature,connection_status,last_tested_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, input.name, input.provider, input.baseUrl, input.model, input.role, input.apiKey ?? '', input.enabled ? 1 : 0, input.priority ?? priority!.next, input.maxContextTokens, input.maxOutputTokens, input.temperature, 'untested', null, now, now);
    }
    return id;
  }

  deleteModel(id: string): boolean {
    return this.db.prepare('DELETE FROM model_profiles WHERE id = ?').run(id).changes > 0;
  }

  setDefaultModel(id: string): boolean {
    const target = this.db.prepare('SELECT role, enabled FROM model_profiles WHERE id = ?').get(id) as { role: string; enabled: number } | undefined;
    if (!target || !target.enabled) return false;
    const update = this.db.transaction(() => {
      this.db.prepare('UPDATE model_profiles SET priority = priority + 1 WHERE role = ? AND id != ?').run(target.role, id);
      return this.db.prepare('UPDATE model_profiles SET priority = 0 WHERE id = ?').run(id).changes > 0;
    });
    return update();
  }

  setModelEnabled(id: string, enabled: boolean): boolean {
    return this.db.prepare('UPDATE model_profiles SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, Date.now(), id).changes > 0;
  }

  recordModelConnection(id: string, status: Exclude<ModelConnectionStatus, 'untested'>): void {
    const now = Date.now();
    this.db.prepare('UPDATE model_profiles SET connection_status = ?, last_tested_at = ?, updated_at = ? WHERE id = ?')
      .run(status, now, now, id);
  }

  private toModelSummary(row: Record<string, unknown>): ModelProfileSummary {
    return {
      id: String(row.id), name: String(row.name), provider: String(row.provider), baseUrl: String(row.base_url), model: String(row.model),
      role: row.role as ModelProfileSummary['role'], apiKeyConfigured: Boolean(row.api_key), enabled: Boolean(row.enabled), priority: Number(row.priority),
      connectionStatus: row.connection_status as ModelConnectionStatus ?? 'untested',
      ...(row.last_tested_at === null || row.last_tested_at === undefined ? {} : { lastTestedAt: Number(row.last_tested_at) }),
      maxContextTokens: Number(row.max_context_tokens), maxOutputTokens: Number(row.max_output_tokens), temperature: Number(row.temperature),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    };
  }

  private toWorkspaceSummary(row: WorkspaceRow): WorkspaceSummary {
    return { id: row.id, name: row.name, rootPath: row.root_path, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private toTaskSummary(row: TaskRow): TaskSummary {
    return { id: row.id, workspaceId: row.workspace_id, title: row.title, goal: row.goal, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private getArtifact(id: string): ArtifactSummary | undefined {
    const row = this.db.prepare(`SELECT a.id, a.workspace_id, a.task_id, a.type, a.title, a.current_version_id, v.version_number, v.source_run_id, v.origin, a.created_at, a.updated_at FROM artifacts a JOIN artifact_versions v ON v.id = a.current_version_id WHERE a.id = ?`).get(id) as ArtifactRow | undefined;
    return row ? this.toArtifactSummary(row) : undefined;
  }

  private toArtifactSummary(row: ArtifactRow): ArtifactSummary {
    return { id: row.id, workspaceId: row.workspace_id, taskId: row.task_id, type: 'markdown', title: row.title, currentVersionId: row.current_version_id, versionNumber: row.version_number, origin: row.origin, ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  private toArtifactVersionSummary(row: ArtifactVersionRow): ArtifactVersionSummary {
    return { id: row.id, artifactId: row.artifact_id, versionNumber: row.version_number, origin: row.origin, ...(row.source_run_id ? { sourceRunId: row.source_run_id } : {}), createdAt: row.created_at };
  }

  private listArtifactVersionEvidence(versionId: string): EvidenceSummary[] {
    const rows = this.db.prepare('SELECT e.* FROM artifact_version_evidence ave JOIN evidence e ON e.id = ave.evidence_id WHERE ave.version_id = ? ORDER BY e.captured_at DESC, e.rowid DESC').all(versionId) as EvidenceRow[];
    return rows.map((row) => ({ id: row.id, taskId: row.task_id, runId: row.run_id, sourceType: 'local-file', sourceUri: row.source_uri, title: row.title, locator: row.locator, excerpt: row.excerpt, contentHash: row.content_hash, capturedAt: row.captured_at }));
  }

  close(): void {
    this.db.close();
  }
}
