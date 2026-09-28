import { randomUUID } from 'node:crypto';

import {
  type RecentTaskSummary,
  type WorkspaceAccentId,
  type WorkspaceIconId,
  workspaceIdentityDefaults,
  type WorkspaceSummary,
  type WorkspaceTaskGroup,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

import { type RecentTaskRow, toRecentTaskSummary } from './task-repository';

interface WorkspaceRow {
  id: string;
  name: string;
  root_path: string;
  icon_id: string;
  accent_id: string;
  hidden_at: number | null;
  created_at: number;
  updated_at: number;
}

/** 分组查询在空间行上多带活动时间与任务总数，两者都不进摘要。 */
interface WorkspaceGroupRow extends WorkspaceRow {
  activity_at: number;
  task_total: number;
}

/** 行到摘要的映射与全局最近任务列表共用，这里只多一个组内序号。 */
interface RankedTaskRow extends RecentTaskRow {
  task_rank: number;
}

/**
 * 侧栏一次最多列出的空间数。再多就靠工作空间浮层的搜索定位——一屏塞三十个空间
 * 不会让「回到哪段工作」更快，只会让分组失去意义。
 */
const WORKSPACE_GROUP_LIMIT = 12;
/** 每个空间随分组带出的任务条数：折叠时只给前三条，「展示更多」就地展开到这一档。 */
const WORKSPACE_GROUP_TASK_LIMIT = 20;

const WORKSPACE_COLUMNS =
  'id, name, root_path, icon_id, accent_id, hidden_at, created_at, updated_at';

const toSummary = (row: WorkspaceRow): WorkspaceSummary => ({
  id: row.id,
  name: row.name,
  rootPath: row.root_path,
  iconId: row.icon_id as WorkspaceIconId,
  accentId: row.accent_id as WorkspaceAccentId,
  ...(row.hidden_at === null ? {} : { hiddenAt: row.hidden_at }),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Workspace 是长期工作上下文，以 root_path 唯一。 */
export class WorkspaceRepository {
  constructor(private readonly db: Database.Database) {}

  /** 幂等登记：默认工作空间在每次启动时都要能拿到同一个行。 */
  getOrCreate(rootPath: string, name: string): WorkspaceSummary {
    const existing = this.db
      .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE root_path = ?`)
      .get(rootPath) as WorkspaceRow | undefined;
    if (existing) return toSummary(existing);
    return this.insert(rootPath, name);
  }

  /**
   * 显式新建。路径已登记时抛一句中文说明而不是静默复用：调用方是「新建工作空间」
   * 对话框，静默复用会把用户领进一个她以为自己刚刚建出来的空间。
   */
  create(
    rootPath: string,
    name: string,
    iconId?: WorkspaceIconId,
    accentId?: WorkspaceAccentId,
  ): WorkspaceSummary {
    const existing = this.db
      .prepare('SELECT id FROM workspaces WHERE root_path = ?')
      .get(rootPath) as { id: string } | undefined;
    if (existing) {
      throw new Error('这个文件夹已经登记为工作空间了，请直接打开它，或换一个目录。');
    }
    return this.insert(rootPath, name, iconId, accentId);
  }

  /** 改身份（别名／图标／颜色）：只改传进来的字段，一次推进 updatedAt。 */
  updateIdentity(
    id: string,
    changes: { name?: string; iconId?: WorkspaceIconId; accentId?: WorkspaceAccentId },
  ): WorkspaceSummary {
    const current = this.require(id);
    this.db
      .prepare(
        'UPDATE workspaces SET name = ?, icon_id = ?, accent_id = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        changes.name ?? current.name,
        changes.iconId ?? current.iconId,
        changes.accentId ?? current.accentId,
        Date.now(),
        id,
      );
    return this.require(id);
  }

  /**
   * 隐藏只影响侧栏可见性。删除工作空间会经 `ON DELETE CASCADE` 带走任务、成果、
   * 输入快照与记忆整棵子树，因此删除不在这一层，本轮也不提供入口。
   */
  setHidden(id: string, hidden: boolean): WorkspaceSummary {
    this.require(id);
    this.db
      .prepare('UPDATE workspaces SET hidden_at = ? WHERE id = ?')
      .run(hidden ? Date.now() : null, id);
    return this.require(id);
  }

  get(id: string): WorkspaceSummary | undefined {
    const row = this.db
      .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?`)
      .get(id) as WorkspaceRow | undefined;
    return row ? toSummary(row) : undefined;
  }

  listAll(): WorkspaceSummary[] {
    const rows = this.db
      .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces ORDER BY updated_at DESC`)
      .all() as WorkspaceRow[];
    return rows.map(toSummary);
  }

  /**
   * 侧栏分组：最近活跃的前若干空间，各带一页任务与**该空间的任务总数**。
   *
   * 总数必须来自仓储而不是已加载数组的长度——一个活跃空间吃掉全局名额会让别的空间
   * 整组消失，「展示更多（k）」也就无从报数。空间按自己最近一次任务活动排序，
   * 没有任务时退回登记时间，因此刚建完的空空间不会掉出侧栏。
   */
  listTaskGroups(): WorkspaceTaskGroup[] {
    const spaces = this.db
      .prepare(
        `SELECT w.id, w.name, w.root_path, w.icon_id, w.accent_id, w.hidden_at,
                w.created_at, w.updated_at,
                COALESCE(
                  (SELECT MAX(t.updated_at) FROM tasks t WHERE t.workspace_id = w.id),
                  w.updated_at
                ) AS activity_at,
                (SELECT COUNT(*) FROM tasks t WHERE t.workspace_id = w.id) AS task_total
           FROM workspaces w
          WHERE w.hidden_at IS NULL
          ORDER BY activity_at DESC, w.rowid DESC
          LIMIT ?`,
      )
      .all(WORKSPACE_GROUP_LIMIT) as WorkspaceGroupRow[];
    if (spaces.length === 0) return [];

    const placeholders = spaces.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id, title, goal, created_at, updated_at, session_id,
                run_id, run_session_id, prompt, status, run_created_at, completed_at
           FROM (
             SELECT t.id, t.workspace_id, t.title, t.goal, t.created_at, t.updated_at,
                    s.id AS session_id,
                    r.id AS run_id, r.session_id AS run_session_id, r.prompt, r.status,
                    r.created_at AS run_created_at, r.completed_at,
                    ROW_NUMBER() OVER (
                      PARTITION BY t.workspace_id ORDER BY t.updated_at DESC, t.rowid DESC
                    ) AS task_rank
               FROM tasks t
               JOIN sessions s ON s.id = (
                 SELECT id FROM sessions WHERE task_id = t.id ORDER BY created_at ASC, rowid ASC LIMIT 1
               )
               LEFT JOIN runs r ON r.id = (
                 SELECT id FROM runs WHERE task_id = t.id ORDER BY created_at DESC, rowid DESC LIMIT 1
               )
              WHERE t.workspace_id IN (${placeholders})
           )
          WHERE task_rank <= ?
          ORDER BY workspace_id, task_rank`,
      )
      .all(...spaces.map((space) => space.id), WORKSPACE_GROUP_TASK_LIMIT) as RankedTaskRow[];

    const tasksByWorkspace = new Map<string, RecentTaskSummary[]>();
    for (const row of rows) {
      const bucket = tasksByWorkspace.get(row.workspace_id);
      if (bucket) bucket.push(toRecentTaskSummary(row));
      else tasksByWorkspace.set(row.workspace_id, [toRecentTaskSummary(row)]);
    }
    return spaces.map((space) => ({
      workspace: toSummary(space),
      tasks: tasksByWorkspace.get(space.id) ?? [],
      totalTasks: space.task_total,
    }));
  }

  private insert(
    rootPath: string,
    name: string,
    iconId: WorkspaceIconId = workspaceIdentityDefaults.iconId,
    accentId: WorkspaceAccentId = workspaceIdentityDefaults.accentId,
  ): WorkspaceSummary {
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, root_path, icon_id, accent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, name, rootPath, iconId, accentId, now, now);
    const created = this.get(id);
    if (!created) throw new Error('工作空间登记失败，请重试。');
    return created;
  }

  /** 改身份与隐藏都要在「对象还在不在」上失败得清楚，因此读不到就抛，不静默返回。 */
  private require(id: string): WorkspaceSummary {
    const current = this.get(id);
    if (!current) throw new Error('这个工作空间已经不在了，请刷新后重试。');
    return current;
  }
}
