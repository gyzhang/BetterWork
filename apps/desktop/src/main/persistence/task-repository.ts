import { randomUUID } from 'node:crypto';

import type {
  CreatedTask,
  RecentTaskSummary,
  RunSummary,
  TaskSummary,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface TaskRow {
  id: string;
  workspace_id: string;
  title: string;
  goal: string;
  created_at: number;
  updated_at: number;
}

/** 最近任务列表把 Task、它的首个 Session 与最新一次 Run 合成一行返回。 */
interface RecentTaskRow extends TaskRow {
  session_id: string;
  run_id: string | null;
  run_session_id: string | null;
  prompt: string | null;
  status: RunSummary['status'] | null;
  run_created_at: number | null;
  completed_at: number | null;
}

interface TaskIdRow {
  id: string;
}

interface RunContextRow {
  workspace_path: string;
}

export interface TaskRunContext {
  workspacePath: string;
}

const RECENT_TASKS_LIMIT = 100;

const toSummary = (row: TaskRow): TaskSummary => ({
  id: row.id,
  workspaceId: row.workspace_id,
  title: row.title,
  goal: row.goal,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toLatestRun = (row: RecentTaskRow): RunSummary | undefined => {
  if (
    !row.run_id ||
    !row.run_session_id ||
    !row.prompt ||
    !row.status ||
    row.run_created_at === null
  ) {
    return undefined;
  }
  return {
    id: row.run_id,
    taskId: row.id,
    sessionId: row.run_session_id,
    prompt: row.prompt,
    status: row.status,
    createdAt: row.run_created_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  };
};

/**
 * Task 与 Session 是两张表、两套标识：一个 Task 目前只创建一个 Session，
 * 但关系不写死在代码里，未来一个 Task 可以有多个 Session。
 */
export class TaskRepository {
  constructor(private readonly db: Database.Database) {}

  create(workspaceId: string, title: string, goal: string): CreatedTask {
    const workspace = this.db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as
      TaskIdRow | undefined;
    if (!workspace) throw new Error('Workspace does not exist');

    const now = Date.now();
    const task: TaskRow = {
      id: randomUUID(),
      workspace_id: workspaceId,
      title,
      goal,
      created_at: now,
      updated_at: now,
    };
    const sessionId = randomUUID();
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(task.id, task.workspace_id, task.title, task.goal, task.created_at, task.updated_at);
      this.db
        .prepare('INSERT INTO sessions (id, task_id, created_at) VALUES (?, ?, ?)')
        .run(sessionId, task.id, now);
    });
    insert();
    return { task: toSummary(task), sessionId };
  }

  listRecent(workspaceId?: string): RecentTaskSummary[] {
    const query = `
      SELECT t.id, t.workspace_id, t.title, t.goal, t.created_at, t.updated_at,
             s.id AS session_id,
             r.id AS run_id, r.session_id AS run_session_id, r.prompt, r.status,
             r.created_at AS run_created_at, r.completed_at
        FROM tasks t
        JOIN sessions s ON s.id = (
          SELECT id FROM sessions WHERE task_id = t.id ORDER BY created_at ASC, rowid ASC LIMIT 1
        )
        LEFT JOIN runs r ON r.id = (
          SELECT id FROM runs WHERE task_id = t.id ORDER BY created_at DESC, rowid DESC LIMIT 1
        )
        ${workspaceId ? 'WHERE t.workspace_id = ?' : ''}
       ORDER BY t.updated_at DESC, t.rowid DESC
       LIMIT ${RECENT_TASKS_LIMIT}
    `;
    const rows = (
      workspaceId ? this.db.prepare(query).all(workspaceId) : this.db.prepare(query).all()
    ) as RecentTaskRow[];
    return rows.map((row) => {
      const latestRun = toLatestRun(row);
      return {
        ...toSummary(row),
        sessionId: row.session_id,
        ...(latestRun ? { latestRun } : {}),
      };
    });
  }

  /** 有新活动时把任务顶到最近列表前面。 */
  touch(taskId: string, updatedAt: number): void {
    this.db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(updatedAt, taskId);
  }

  getWorkspaceId(taskId: string): string | undefined {
    const row = this.db.prepare('SELECT workspace_id FROM tasks WHERE id = ?').get(taskId) as
      { workspace_id: string } | undefined;
    return row?.workspace_id;
  }

  /**
   * Run 的权限上下文只能从已持久化的 Task、Session 与 Workspace 关系取得。
   * Renderer 传来的标识只用于定位，不能自行指定文件访问根目录。
   */
  getRunContext(taskId: string, sessionId: string): TaskRunContext | undefined {
    const row = this.db
      .prepare(
        `SELECT w.root_path AS workspace_path
           FROM tasks t
           JOIN sessions s ON s.task_id = t.id
           JOIN workspaces w ON w.id = t.workspace_id
          WHERE t.id = ? AND s.id = ?`,
      )
      .get(taskId, sessionId) as RunContextRow | undefined;
    return row ? { workspacePath: row.workspace_path } : undefined;
  }
}
