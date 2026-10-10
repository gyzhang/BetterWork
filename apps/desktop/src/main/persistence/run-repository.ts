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

interface StoredEventRow extends EventPayloadRow {
  id: string;
  run_id: string;
  sequence: number;
  type: AgentRuntimeEvent['type'];
}

interface ExistenceRow {
  present: number;
}

export interface HistoryReplayCandidateQuery {
  taskId: string;
  currentRunId: string;
  createdBefore?: number;
  completedAtOrBefore: number;
}

type MessageCompletion = Extract<AgentRuntimeEvent, { type: 'message.completed' }>;
type RunCompletion = Extract<AgentRuntimeEvent, { type: 'run.completed' }>;

const toolEventTypes: readonly AgentRuntimeEvent['type'][] = [
  'tool.requested',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
];

/** 定向事件仍必须自证身份，不能把索引元数据和另一条载荷拼成来源。 */
const parseStoredEvent = (row: StoredEventRow): AgentRuntimeEvent => {
  const event = agentRuntimeEventSchema.parse(JSON.parse(row.payload) as unknown);
  if (
    event.id !== row.id ||
    event.runId !== row.run_id ||
    event.sequence !== row.sequence ||
    event.type !== row.type
  ) {
    throw new Error('Run event metadata does not match its payload');
  }
  return event;
};

const RUNS_LIMIT = 100;
export const RUN_INTERRUPTED_ON_STARTUP_REASON = '算台上次退出时这次执行被中断';

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
    const session = this.db
      .prepare('SELECT task_id FROM sessions WHERE id = ?')
      .get(run.sessionId) as { task_id: string } | undefined;
    if (!session) throw new Error('Run session does not exist');
    if (session.task_id !== run.taskId) throw new Error('Run session does not belong to task');
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

  get(runId: string): RunSummary | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined;
    return row ? toSummary(row) : undefined;
  }

  /** 按时间正序返回 Task 下所有 Run，用于构建跨 Run 对话历史。 */
  listByTask(taskId: string): RunSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY created_at ASC')
      .all(taskId) as RunRow[];
    return rows.map(toSummary);
  }

  /** 历史候选先过滤 Task/状态/时间，不截断安全判定需要的候选集合。 */
  listHistoryReplayCandidates(input: HistoryReplayCandidateQuery): RunSummary[] {
    const conditions = [
      'task_id = ?',
      'id != ?',
      "status = 'completed'",
      '(completed_at IS NULL OR completed_at <= ?)',
    ];
    const parameters: (string | number)[] = [
      input.taskId,
      input.currentRunId,
      input.completedAtOrBefore,
    ];
    if (input.createdBefore !== undefined) {
      conditions.push('created_at < ?');
      parameters.push(input.createdBefore);
    }
    const rows = this.db
      .prepare(`SELECT * FROM runs WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC`)
      .all(...parameters) as RunRow[];
    return rows.map(toSummary);
  }

  /** 只读取 Task 最近的有限轮次，供连续简报来源和历史用户要求装配。 */
  listRecentByTask(taskId: string, limit: number): RunSummary[] {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('Recent Run limit must be a positive integer');
    }
    const rows = this.db
      .prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(taskId, limit) as RunRow[];
    return rows.map(toSummary);
  }

  /** 读取最近的单条事件，避免为 Run 状态摘要扫描整段事件历史。 */
  getLatestEvent(runId: string): AgentRuntimeEvent | undefined {
    const row = this.db
      .prepare('SELECT payload FROM run_events WHERE run_id = ? ORDER BY sequence DESC LIMIT 1')
      .get(runId) as EventPayloadRow | undefined;
    return row ? agentRuntimeEventSchema.parse(JSON.parse(row.payload)) : undefined;
  }

  listEvents(runId: string): AgentRuntimeEvent[] {
    const rows = this.db
      .prepare('SELECT payload FROM run_events WHERE run_id = ? ORDER BY sequence ASC')
      .all(runId) as EventPayloadRow[];
    return rows.map((row) => agentRuntimeEventSchema.parse(JSON.parse(row.payload)));
  }

  getEvent(runId: string, eventId: string): AgentRuntimeEvent | undefined {
    const row = this.db
      .prepare(
        'SELECT id, run_id, sequence, type, payload FROM run_events WHERE run_id = ? AND id = ?',
      )
      .get(runId, eventId) as StoredEventRow | undefined;
    return row ? parseStoredEvent(row) : undefined;
  }

  /** 人工来源需要最后一条消息，包括空消息，不能退回较早回答。 */
  getLatestMessageCompletion(runId: string): MessageCompletion | undefined {
    for (const event of this.messageCompletionsDescending(runId)) return event;
    return undefined;
  }

  /** 历史/消歧沿用最后非空消息；游标只解码找到它之前的消息完成事件。 */
  getLatestNonEmptyMessageCompletion(runId: string): MessageCompletion | undefined {
    for (const event of this.messageCompletionsDescending(runId)) {
      if (event.content.length > 0) return event;
    }
    return undefined;
  }

  /** 保留人工来源旧口径的第一条完成事件，不用最后终态替代它。 */
  getFirstRunCompletion(runId: string): RunCompletion | undefined {
    const row = this.db
      .prepare(
        `SELECT id, run_id, sequence, type, payload FROM run_events
          WHERE run_id = ? AND type = 'run.completed' ORDER BY sequence ASC LIMIT 1`,
      )
      .get(runId) as StoredEventRow | undefined;
    if (!row) return undefined;
    const event = parseStoredEvent(row);
    if (event.type !== 'run.completed') throw new Error('Expected a Run completion event');
    return event;
  }

  hasToolEventAfter(runId: string, sequence: number): boolean {
    const row = this.db
      .prepare(
        `SELECT EXISTS(SELECT 1 FROM run_events WHERE run_id = ? AND sequence > ?
          AND type IN (${toolEventTypes.map(() => '?').join(', ')})) AS present`,
      )
      .get(runId, sequence, ...toolEventTypes) as ExistenceRow | undefined;
    return row?.present === 1;
  }

  private *messageCompletionsDescending(runId: string): Generator<MessageCompletion> {
    const rows = this.db
      .prepare(
        `SELECT id, run_id, sequence, type, payload FROM run_events
          WHERE run_id = ? AND type = 'message.completed' ORDER BY sequence DESC`,
      )
      .iterate(runId) as Iterable<StoredEventRow>;
    for (const row of rows) {
      const event = parseStoredEvent(row);
      if (event.type !== 'message.completed')
        throw new Error('Expected a message completion event');
      yield event;
    }
  }

  belongsToTask(runId: string, taskId: string): boolean {
    const row = this.db.prepare('SELECT task_id FROM runs WHERE id = ?').get(runId) as
      { task_id: string } | undefined;
    return row?.task_id === taskId;
  }

  getTaskId(runId: string): string | undefined {
    const row = this.db.prepare('SELECT task_id FROM runs WHERE id = ?').get(runId) as
      { task_id: string } | undefined;
    return row?.task_id;
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
