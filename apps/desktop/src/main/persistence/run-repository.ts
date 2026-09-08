import type { AgentRuntimeEvent, RunSummary } from '@betterwork/agent-protocol';
import { agentRuntimeEventSchema } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface RunRow {
  id: string;
  task_id: string;
  session_id: string;
  prompt: string;
  status: RunSummary['status'];
  created_at: number;
  completed_at: number | null;
}

interface EventPayloadRow {
  payload: string;
}

const RUNS_LIMIT = 100;

/** 终态事件与 runs.status 的对应关系；非终态事件不改状态。 */
const terminalStatusOf = (event: AgentRuntimeEvent): RunSummary['status'] | undefined => {
  if (event.type === 'run.completed') return 'completed';
  if (event.type === 'run.failed') return 'failed';
  if (event.type === 'run.cancelled') return 'cancelled';
  return undefined;
};

const toSummary = (row: RunRow): RunSummary => ({
  id: row.id,
  taskId: row.task_id,
  sessionId: row.session_id,
  prompt: row.prompt,
  status: row.status,
  createdAt: row.created_at,
  ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
});

/**
 * Run 是一次执行的稳定标识，Run Event 是它的有序事件日志。
 * 事件先落库再由调用方广播，UI 因此不是唯一消费者。
 */
export class RunRepository {
  constructor(private readonly db: Database.Database) {}

  create(run: RunSummary): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, task_id, session_id, prompt, status, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.taskId,
        run.sessionId,
        run.prompt,
        run.status,
        run.createdAt,
        run.completedAt ?? null,
      );
  }

  /** 写入一条事件；如果是终态事件，同时收口 Run 状态。 */
  appendEvent(event: AgentRuntimeEvent): void {
    agentRuntimeEventSchema.parse(event);
    const terminalStatus = terminalStatusOf(event);
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO run_events (id, run_id, sequence, type, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.runId,
          event.sequence,
          event.type,
          JSON.stringify(event),
          event.createdAt,
        );
      if (terminalStatus) {
        this.db
          .prepare('UPDATE runs SET status = ?, completed_at = ? WHERE id = ?')
          .run(terminalStatus, event.createdAt, event.runId);
      }
    });
    write();
  }

  list(taskId?: string): RunSummary[] {
    const rows = (
      taskId
        ? this.db
            .prepare(
              'SELECT * FROM runs WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
            )
            .all(taskId, RUNS_LIMIT)
        : this.db
            .prepare('SELECT * FROM runs ORDER BY created_at DESC, rowid DESC LIMIT ?')
            .all(RUNS_LIMIT)
    ) as RunRow[];
    return rows.map(toSummary);
  }

  /** 按时间正序返回 Task 下所有 Run，用于构建跨 Run 对话历史。 */
  listByTask(taskId: string): RunSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY created_at ASC')
      .all(taskId) as RunRow[];
    return rows.map(toSummary);
  }

  listEvents(runId: string): AgentRuntimeEvent[] {
    const rows = this.db
      .prepare('SELECT payload FROM run_events WHERE run_id = ? ORDER BY sequence ASC')
      .all(runId) as EventPayloadRow[];
    return rows.map((row) => agentRuntimeEventSchema.parse(JSON.parse(row.payload)));
  }

  belongsToTask(runId: string, taskId: string): boolean {
    const row = this.db.prepare('SELECT task_id FROM runs WHERE id = ?').get(runId) as
      { task_id: string } | undefined;
    return row?.task_id === taskId;
  }

  /**
   * 强制把一个仍在执行的 Run 收口为 failed，并合成对应的 `run.failed` 事件返回，
   * 由调用方负责广播。Run 不存在或已处于终态时返回 undefined，因此重复调用安全。
   *
   * 存在的意义：编排层在进入事件循环之前（读模型配置、构造搜索客户端）
   * 或在写库、广播过程中抛错时，引擎不会产出任何终态事件，
   * Run 会永远停在 running。这条不变量由本方法兜底——
   * 「每个 Run 都必须有明确结果」。
   */
  forceFailure(runId: string, error: string, at: number): AgentRuntimeEvent | undefined {
    const row = this.db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
      { status: RunSummary['status'] } | undefined;
    if (!row || row.status !== 'running') return undefined;

    const event = agentRuntimeEventSchema.parse({
      id: `forced-failure-${runId}`,
      runId,
      sequence: this.nextSequence(runId),
      createdAt: at,
      type: 'run.failed',
      error,
    });

    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO run_events (id, run_id, sequence, type, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.runId,
          event.sequence,
          event.type,
          JSON.stringify(event),
          event.createdAt,
        );
      this.db
        .prepare('UPDATE runs SET status = ?, completed_at = ? WHERE id = ?')
        .run('failed', at, runId);
    });
    write();
    return event;
  }

  /**
   * 进程被强杀或崩溃时，正在执行的 Run 会永远停在 running。
   * 启动时统一收口为 failed，返回被修正的数量，便于启动日志说明发生了什么。
   */
  failInterruptedRuns(reason: string, at: number): number {
    const staleRuns = this.db
      .prepare("SELECT id FROM runs WHERE status = 'running'")
      .all() as Array<{ id: string }>;
    let fixed = 0;
    for (const run of staleRuns) {
      if (this.forceFailure(run.id, reason, at)) fixed += 1;
    }
    return fixed;
  }

  private nextSequence(runId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sequence), -1) + 1 AS next FROM run_events WHERE run_id = ?')
      .get(runId) as { next: number };
    return row.next;
  }
}
