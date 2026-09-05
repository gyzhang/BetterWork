import { randomUUID } from 'node:crypto';

import type { WorkspaceSummary } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface WorkspaceRow {
  id: string;
  name: string;
  root_path: string;
  created_at: number;
  updated_at: number;
}

const toSummary = (row: WorkspaceRow): WorkspaceSummary => ({
  id: row.id,
  name: row.name,
  rootPath: row.root_path,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Workspace 是长期工作上下文，以 root_path 唯一。 */
export class WorkspaceRepository {
  constructor(private readonly db: Database.Database) {}

  getOrCreate(rootPath: string, name: string): WorkspaceSummary {
    const existing = this.db
      .prepare('SELECT * FROM workspaces WHERE root_path = ?')
      .get(rootPath) as WorkspaceRow | undefined;
    if (existing) return toSummary(existing);

    const now = Date.now();
    const workspace: WorkspaceRow = {
      id: randomUUID(),
      name,
      root_path: rootPath,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        'INSERT INTO workspaces (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        workspace.id,
        workspace.name,
        workspace.root_path,
        workspace.created_at,
        workspace.updated_at,
      );
    return toSummary(workspace);
  }

  get(id: string): WorkspaceSummary | undefined {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
      WorkspaceRow | undefined;
    return row ? toSummary(row) : undefined;
  }
}
