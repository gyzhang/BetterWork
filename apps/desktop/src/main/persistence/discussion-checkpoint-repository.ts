import { randomUUID } from 'node:crypto';

import {
  type CreateDiscussionCheckpointRequest,
  type DiscussionCheckpoint,
  discussionCheckpointSchema,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface DiscussionCheckpointRow {
  id: string;
  task_id: string;
  run_id: string | null;
  stage: DiscussionCheckpoint['stage'];
  status: DiscussionCheckpoint['status'];
  title: string;
  summary: string;
  artifact_version_ids_json: string;
  feedback: string | null;
  next_action: string | null;
  supersedes_id: string | null;
  created_at: number;
  updated_at: number;
}

const parseIds = (value: string): string[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error('Stored discussion checkpoint artifact references are invalid');
  }
  return parsed.map((item) => {
    if (typeof item !== 'string')
      throw new Error('Stored discussion checkpoint artifact reference is invalid');
    return item;
  });
};

const toCheckpoint = (row: DiscussionCheckpointRow): DiscussionCheckpoint =>
  discussionCheckpointSchema.parse({
    id: row.id,
    taskId: row.task_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    stage: row.stage,
    status: row.status,
    title: row.title,
    summary: row.summary,
    artifactVersionIds: parseIds(row.artifact_version_ids_json),
    ...(row.feedback ? { feedback: row.feedback } : {}),
    ...(row.next_action ? { nextAction: row.next_action } : {}),
    ...(row.supersedes_id ? { supersedesId: row.supersedes_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

export class DiscussionCheckpointRepository {
  constructor(private readonly db: Database.Database) {}

  listByTask(taskId: string): DiscussionCheckpoint[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM discussion_checkpoints
         WHERE task_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(taskId) as DiscussionCheckpointRow[];
    return rows.map(toCheckpoint);
  }

  get(id: string): DiscussionCheckpoint | undefined {
    const row = this.db.prepare('SELECT * FROM discussion_checkpoints WHERE id = ?').get(id) as
      DiscussionCheckpointRow | undefined;
    return row ? toCheckpoint(row) : undefined;
  }

  create(taskId: string, input: CreateDiscussionCheckpointRequest): DiscussionCheckpoint {
    const parsed = discussionCheckpointSchema
      .omit({ status: true, createdAt: true, updatedAt: true })
      .parse({ ...input, taskId });
    const task = this.db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    if (!task) throw new Error('Discussion checkpoint Task does not exist');
    if (parsed.runId) {
      const run = this.db.prepare('SELECT task_id FROM runs WHERE id = ?').get(parsed.runId) as
        { task_id: string } | undefined;
      if (!run) throw new Error('Discussion checkpoint Run does not exist');
      if (run.task_id !== taskId)
        throw new Error('Discussion checkpoint Run does not belong to Task');
    }
    if (parsed.supersedesId) {
      const previous = this.db
        .prepare('SELECT task_id FROM discussion_checkpoints WHERE id = ?')
        .get(parsed.supersedesId) as { task_id: string } | undefined;
      if (!previous || previous.task_id !== taskId) {
        throw new Error('Discussion checkpoint to supersede does not belong to Task');
      }
    }
    for (const versionId of parsed.artifactVersionIds) {
      const version = this.db
        .prepare(
          `SELECT a.task_id AS task_id
           FROM artifact_versions v
           JOIN artifacts a ON a.id = v.artifact_id
           WHERE v.id = ?`,
        )
        .get(versionId) as { task_id: string } | undefined;
      if (!version)
        throw new Error(`Discussion checkpoint ArtifactVersion does not exist: ${versionId}`);
      if (version.task_id !== taskId) {
        throw new Error('Discussion checkpoint ArtifactVersion does not belong to Task');
      }
    }
    const now = Date.now();
    const insert = this.db.transaction(() => {
      const existing = this.get(parsed.id);
      if (existing) return existing;
      if (parsed.supersedesId) {
        this.db
          .prepare(
            `UPDATE discussion_checkpoints
             SET status = 'superseded', updated_at = ?
             WHERE id = ? AND task_id = ? AND status = 'open'`,
          )
          .run(now, parsed.supersedesId, taskId);
      }
      this.db
        .prepare(
          `INSERT INTO discussion_checkpoints (
             id, task_id, run_id, stage, status, title, summary,
             artifact_version_ids_json, feedback, next_action, supersedes_id,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          parsed.id || randomUUID(),
          taskId,
          parsed.runId ?? null,
          parsed.stage,
          parsed.title,
          parsed.summary,
          JSON.stringify(parsed.artifactVersionIds),
          parsed.feedback ?? null,
          parsed.nextAction ?? null,
          parsed.supersedesId ?? null,
          now,
          now,
        );
      const saved = this.get(parsed.id);
      if (!saved) throw new Error('Discussion checkpoint was not available after save');
      return saved;
    });
    return insert();
  }
}
