import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

function openStore(): AppStore {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
}

function dbOf(store: AppStore): Database.Database {
  return (store as unknown as { db: Database.Database }).db;
}

function exec(db: Database.Database, sqlText: string, params: unknown[] = []): void {
  db.prepare(sqlText).run(...params);
}

const SHA256_HEX = 'a'.repeat(64);
const SHA256_HEX_ALT = 'b'.repeat(64);

interface ProvenanceIds {
  workspaceId: string;
  taskId: string;
  sessionId: string;
  runId: string;
  expertId: string;
  expertRevisionId: string;
  scheduleId: string;
  occurrenceId: string;
  artifactId: string;
  artifactVersionId: string;
}

function insertProvenance(
  db: Database.Database,
  opts: {
    artifactType?: 'markdown' | 'presentation';
    expectedTypes?: string[];
    contentHash?: string;
    fileHash?: string;
    mismatchTaskWorkspace?: boolean;
    mismatchArtifactTask?: boolean;
    mismatchSourceRun?: boolean;
    noFirstRun?: boolean;
    noTask?: boolean;
  } = {},
): ProvenanceIds {
  const workspaceId = 'ws-1';
  const taskId = 'task-1';
  const sessionId = 'session-1';
  const runId = 'run-1';
  const expertId = 'expert-1';
  const expertRevisionId = 'expert-rev-1';
  const scheduleId = 'sched-1';
  const occurrenceId = 'occ-1';
  const artifactId = 'art-1';
  const artifactVersionId = 'av-1';

  const taskWorkspaceId = opts.mismatchTaskWorkspace ? 'ws-other' : workspaceId;

  const setup = db.transaction(() => {
    exec(
      db,
      'INSERT OR IGNORE INTO workspaces (id, root_path, name, created_at, updated_at) VALUES (?, ?, ?, 0, 0)',
      [workspaceId, '/tmp/ws', 'ws'],
    );
    if (opts.mismatchTaskWorkspace) {
      exec(
        db,
        'INSERT OR IGNORE INTO workspaces (id, root_path, name, created_at, updated_at) VALUES (?, ?, ?, 0, 0)',
        ['ws-other', '/tmp/ws-other', 'other'],
      );
    }
    exec(
      db,
      'INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)',
      [taskId, taskWorkspaceId, 'Task', 'Goal'],
    );
    exec(db, 'INSERT INTO sessions (id, task_id, created_at) VALUES (?, ?, 0)', [
      sessionId,
      taskId,
    ]);
    exec(
      db,
      'INSERT INTO runs (id, task_id, session_id, prompt, status, created_at) VALUES (?, ?, ?, ?, ?, 0)',
      [runId, taskId, sessionId, 'prompt', 'completed'],
    );
    exec(
      db,
      `INSERT OR IGNORE INTO experts (id, source_kind, lifecycle, current_revision_id, created_at, updated_at)
     VALUES (?, 'user', 'active', ?, 0, 0)`,
      [expertId, expertRevisionId],
    );
    exec(
      db,
      `INSERT OR IGNORE INTO expert_revisions
       (id, expert_id, revision, name, summary, identity, principles_json,
        input_requirements_json, delivery_requirements_json, skill_preset_json,
        builtin_tool_policy_json, model_reference_json, created_at)
     VALUES (?, ?, 1, 'Expert', '', '', '[]', '[]', '[]', '[]', '[]', '[]', 0)`,
      [expertRevisionId, expertId],
    );

    exec(
      db,
      `INSERT INTO schedules (id, workspace_id, revision, current_config_version, lifecycle, created_at, updated_at)
     VALUES (?, ?, 1, 1, 'paused', 0, 0)`,
      [scheduleId, workspaceId],
    );

    const expectedTypes = opts.expectedTypes ?? ['markdown'];
    exec(
      db,
      `INSERT INTO schedule_configs
       (schedule_id, version, name, expert_id, expert_revision_id, requirements,
        expected_artifact_types_json, timing_json, period_rule, knowledge_sources_json,
        output_subdirectory, created_at)
     VALUES (?, 1, 'Config', ?, ?, 'Do the thing', ?, '{}', 'none', '[]', '定时成果', 0)`,
      [scheduleId, expertId, expertRevisionId, JSON.stringify(expectedTypes)],
    );

    const needsFullProvenance =
      !opts.noTask &&
      !opts.noFirstRun &&
      !opts.mismatchArtifactTask &&
      !opts.mismatchSourceRun &&
      !opts.mismatchTaskWorkspace;
    const needsTaskInOccurrence = opts.noFirstRun;

    if (needsFullProvenance) {
      exec(
        db,
        `INSERT INTO schedule_occurrences
         (id, schedule_id, config_version, trigger, requested_at, request_key, period_json, phase,
          created_at)
       VALUES (?, ?, 1, 'manual-now', 0, 'req-1', '{}', 'preparing', 0)`,
        [occurrenceId, scheduleId],
      );
      exec(
        db,
        `INSERT INTO schedule_source_snapshots
         (id, occurrence_id, workspace_id, status, config_version, evaluated_at, manifest_hash,
          item_count, total_file_bytes, created_at, completed_at)
       VALUES ('snap-1', ?, ?, 'ready', 1, 0, ?, 0, 0, 0, 0)`,
        [occurrenceId, workspaceId, SHA256_HEX],
      );
      exec(
        db,
        `UPDATE schedule_occurrences
       SET phase = 'dispatched', task_id = ?, session_id = ?, first_run_id = ?,
           source_snapshot_id = 'snap-1', prepared_at = 0
       WHERE id = ?`,
        [taskId, sessionId, runId, occurrenceId],
      );
    } else if (needsTaskInOccurrence) {
      exec(
        db,
        `INSERT INTO schedule_occurrences
         (id, schedule_id, config_version, trigger, requested_at, request_key, period_json, phase,
          created_at)
       VALUES (?, ?, 1, 'manual-now', 0, 'req-1', '{}', 'preparing', 0)`,
        [occurrenceId, scheduleId],
      );
      exec(
        db,
        `INSERT INTO schedule_source_snapshots
         (id, occurrence_id, workspace_id, status, config_version, evaluated_at, manifest_hash,
          item_count, total_file_bytes, created_at, completed_at)
       VALUES ('snap-1', ?, ?, 'ready', 1, 0, ?, 0, 0, 0, 0)`,
        [occurrenceId, workspaceId, SHA256_HEX],
      );
      exec(
        db,
        `UPDATE schedule_occurrences
       SET task_id = ?, session_id = ?, source_snapshot_id = 'snap-1', prepared_at = 0
       WHERE id = ?`,
        [taskId, sessionId, occurrenceId],
      );
    } else {
      exec(
        db,
        `INSERT INTO schedule_occurrences
         (id, schedule_id, config_version, trigger, requested_at, request_key, period_json, phase,
          created_at)
       VALUES (?, ?, 1, 'manual-now', 0, 'req-1', '{}', 'preparing', 0)`,
        [occurrenceId, scheduleId],
      );
    }

    const artifactTaskId = opts.mismatchArtifactTask ? 'task-other' : taskId;
    if (opts.mismatchArtifactTask) {
      exec(
        db,
        'INSERT INTO tasks (id, workspace_id, title, goal, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)',
        ['task-other', workspaceId, 'Other', 'Other'],
      );
    }
    exec(
      db,
      `INSERT INTO artifacts (id, workspace_id, task_id, type, title, current_version_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Title', ?, 0, 0)`,
      [artifactId, workspaceId, artifactTaskId, opts.artifactType ?? 'markdown', artifactVersionId],
    );

    const sourceRunId = opts.mismatchSourceRun ? 'run-other' : runId;
    const contentHash = opts.contentHash ?? SHA256_HEX;
    exec(
      db,
      `INSERT INTO artifact_versions (id, artifact_id, version_number, content_hash, source_run_id, created_at)
     VALUES (?, ?, 1, ?, ?, 0)`,
      [artifactVersionId, artifactId, contentHash, sourceRunId],
    );

    if (opts.artifactType === 'presentation') {
      exec(
        db,
        `INSERT INTO artifact_files
         (version_id, mime_type, file_size, file_hash, file_key, execution_id,
          validation_structure, validation_visual, validation_manual_edit)
       VALUES (?, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 1024, ?, 'key', 'exec-1', 'not-checked', 'not-checked', 'not-checked')`,
        [artifactVersionId, opts.fileHash ?? SHA256_HEX],
      );
    }
  });
  setup();

  return {
    workspaceId,
    taskId,
    sessionId,
    runId,
    expertId,
    expertRevisionId,
    scheduleId,
    occurrenceId,
    artifactId,
    artifactVersionId,
  };
}

describe('ScheduleOutputRepository', () => {
  describe('get / listByOccurrence / listIncomplete', () => {
    it('returns undefined for nonexistent receipt', () => {
      const store = openStore();
      expect(store.scheduleOutputs.get('nope')).toBeUndefined();
    });

    it('lists receipts by occurrence ordered by created_at', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db);

      exec(
        db,
        `INSERT INTO artifact_versions (id, artifact_id, version_number, content_hash, source_run_id, created_at)
         VALUES ('av-2', ?, 2, ?, ?, 0)`,
        [ids.artifactId, SHA256_HEX, ids.runId],
      );

      exec(
        db,
        `INSERT INTO schedule_output_receipts
           (id, occurrence_id, artifact_version_id, workspace_id, relative_path,
            content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, NULL, NULL, 10, 10)`,
        [
          'r1',
          ids.occurrenceId,
          ids.artifactVersionId,
          ids.workspaceId,
          '定时成果/a.md',
          SHA256_HEX,
        ],
      );
      exec(
        db,
        `INSERT INTO schedule_output_receipts
           (id, occurrence_id, artifact_version_id, workspace_id, relative_path,
            content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'saved', 1, NULL, NULL, 5, 5)`,
        ['r2', ids.occurrenceId, 'av-2', ids.workspaceId, '定时成果/b.md', SHA256_HEX],
      );

      const list = store.scheduleOutputs.listByOccurrence(ids.occurrenceId);
      expect(list.map((r) => r.id)).toEqual(['r2', 'r1']);
    });

    it('listIncomplete returns only pending and saving', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db);

      exec(
        db,
        `INSERT INTO artifact_versions (id, artifact_id, version_number, content_hash, source_run_id, created_at)
         VALUES ('av-2', ?, 2, ?, ?, 0)`,
        [ids.artifactId, SHA256_HEX, ids.runId],
      );
      exec(
        db,
        `INSERT INTO artifact_versions (id, artifact_id, version_number, content_hash, source_run_id, created_at)
         VALUES ('av-3', ?, 3, ?, ?, 0)`,
        [ids.artifactId, SHA256_HEX, ids.runId],
      );

      exec(
        db,
        `INSERT INTO schedule_output_receipts
           (id, occurrence_id, artifact_version_id, workspace_id, relative_path,
            content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, NULL, NULL, 1, 1)`,
        [
          'r-pending',
          ids.occurrenceId,
          ids.artifactVersionId,
          ids.workspaceId,
          '定时成果/a.md',
          SHA256_HEX,
        ],
      );
      exec(
        db,
        `INSERT INTO schedule_output_receipts
           (id, occurrence_id, artifact_version_id, workspace_id, relative_path,
            content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'saving', 1, NULL, NULL, 2, 2)`,
        ['r-saving', ids.occurrenceId, 'av-2', ids.workspaceId, '定时成果/b.md', SHA256_HEX],
      );
      exec(
        db,
        `INSERT INTO schedule_output_receipts
           (id, occurrence_id, artifact_version_id, workspace_id, relative_path,
            content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'saved', 1, NULL, NULL, 3, 3)`,
        ['r-saved', ids.occurrenceId, 'av-3', ids.workspaceId, '定时成果/c.md', SHA256_HEX],
      );

      const incomplete = store.scheduleOutputs.listIncomplete();
      expect(incomplete.map((r) => r.id).sort()).toEqual(['r-pending', 'r-saving']);
    });
  });

  describe('createPending', () => {
    it('creates a pending receipt on happy path (markdown)', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db);

      const receipt = store.scheduleOutputs.createPending({
        occurrenceId: ids.occurrenceId,
        artifactVersionId: ids.artifactVersionId,
        relativePath: '定时成果/report.md',
        contentHash: SHA256_HEX,
        createdAt: 100,
      });

      expect(receipt.status).toBe('pending');
      expect(receipt.attempt).toBe(1);
      expect(receipt.occurrenceId).toBe(ids.occurrenceId);
      expect(receipt.workspaceId).toBe(ids.workspaceId);
      expect(receipt.relativePath).toBe('定时成果/report.md');
    });

    it('is idempotent when called with the same parameters', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db);

      const first = store.scheduleOutputs.createPending({
        occurrenceId: ids.occurrenceId,
        artifactVersionId: ids.artifactVersionId,
        relativePath: '定时成果/report.md',
        contentHash: SHA256_HEX,
        createdAt: 100,
      });
      const second = store.scheduleOutputs.createPending({
        occurrenceId: ids.occurrenceId,
        artifactVersionId: ids.artifactVersionId,
        relativePath: '定时成果/report.md',
        contentHash: SHA256_HEX,
        createdAt: 100,
      });

      expect(second.id).toBe(first.id);
      expect(second.status).toBe('pending');
    });

    it('throws when artifact version does not exist in provenance', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db);

      expect(() =>
        store.scheduleOutputs.createPending({
          occurrenceId: ids.occurrenceId,
          artifactVersionId: 'av-nonexistent',
          relativePath: '定时成果/report.md',
          contentHash: SHA256_HEX,
          createdAt: 100,
        }),
      ).toThrow(/成果版本不存在/);
    });

    it('throws when content hash does not match', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db);

      expect(() =>
        store.scheduleOutputs.createPending({
          occurrenceId: ids.occurrenceId,
          artifactVersionId: ids.artifactVersionId,
          relativePath: '定时成果/report.md',
          contentHash: SHA256_HEX_ALT,
          createdAt: 100,
        }),
      ).toThrow(/hash.*不匹配/);
    });

    it('throws when relative path is not under 定时成果', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db);

      expect(() =>
        store.scheduleOutputs.createPending({
          occurrenceId: ids.occurrenceId,
          artifactVersionId: ids.artifactVersionId,
          relativePath: 'wrong/report.md',
          contentHash: SHA256_HEX,
          createdAt: 100,
        }),
      ).toThrow(/定时成果/);
    });

    it('throws when path has nested segments', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db);

      expect(() =>
        store.scheduleOutputs.createPending({
          occurrenceId: ids.occurrenceId,
          artifactVersionId: ids.artifactVersionId,
          relativePath: '定时成果/sub/report.md',
          contentHash: SHA256_HEX,
          createdAt: 100,
        }),
      ).toThrow(/定时成果/);
    });

    it('throws when first_run_id is null', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db, { noFirstRun: true });

      expect(() =>
        store.scheduleOutputs.createPending({
          occurrenceId: ids.occurrenceId,
          artifactVersionId: ids.artifactVersionId,
          relativePath: '定时成果/report.md',
          contentHash: SHA256_HEX,
          createdAt: 100,
        }),
      ).toThrow(/不属于本期首个 Run/);
    });

    it('throws when artifact task does not match occurrence task', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db, { mismatchArtifactTask: true });

      expect(() =>
        store.scheduleOutputs.createPending({
          occurrenceId: ids.occurrenceId,
          artifactVersionId: ids.artifactVersionId,
          relativePath: '定时成果/report.md',
          contentHash: SHA256_HEX,
          createdAt: 100,
        }),
      ).toThrow(/不属于本期首个 Run/);
    });

    it('throws when source_run_id does not match first_run_id', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db, { mismatchSourceRun: true });

      expect(() =>
        store.scheduleOutputs.createPending({
          occurrenceId: ids.occurrenceId,
          artifactVersionId: ids.artifactVersionId,
          relativePath: '定时成果/report.md',
          contentHash: SHA256_HEX,
          createdAt: 100,
        }),
      ).toThrow(/不属于本期首个 Run/);
    });

    it('throws when task workspace does not match schedule workspace', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db, { mismatchTaskWorkspace: true });

      expect(() =>
        store.scheduleOutputs.createPending({
          occurrenceId: ids.occurrenceId,
          artifactVersionId: ids.artifactVersionId,
          relativePath: '定时成果/report.md',
          contentHash: SHA256_HEX,
          createdAt: 100,
        }),
      ).toThrow(/不属于本期首个 Run/);
    });

    it('throws when artifact type is not in expected types', () => {
      const store = openStore();
      const db = dbOf(store);
      insertProvenance(db, {
        artifactType: 'presentation',
        expectedTypes: ['markdown'],
        fileHash: SHA256_HEX,
      });

      expect(() =>
        store.scheduleOutputs.createPending({
          occurrenceId: 'occ-1',
          artifactVersionId: 'av-1',
          relativePath: '定时成果/report.pptx',
          contentHash: SHA256_HEX,
          createdAt: 100,
        }),
      ).toThrow(/不符合本期固定成果类型/);
    });

    it('throws when existing receipt has different occurrence', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db);

      exec(
        db,
        `INSERT INTO schedule_occurrences
           (id, schedule_id, config_version, trigger, requested_at, request_key, period_json, phase,
            created_at)
         VALUES ('occ-2', ?, 1, 'manual-now', 0, 'req-2', '{}', 'preparing', 0)`,
        [ids.scheduleId],
      );

      exec(
        db,
        `INSERT INTO schedule_output_receipts
           (id, occurrence_id, artifact_version_id, workspace_id, relative_path,
            content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at)
         VALUES ('existing', 'occ-2', ?, ?, '定时成果/a.md', ?, 'pending', 1, NULL, NULL, 1, 1)`,
        [ids.artifactVersionId, ids.workspaceId, SHA256_HEX],
      );

      expect(() =>
        store.scheduleOutputs.createPending({
          occurrenceId: ids.occurrenceId,
          artifactVersionId: ids.artifactVersionId,
          relativePath: '定时成果/report.md',
          contentHash: SHA256_HEX,
          createdAt: 100,
        }),
      ).toThrow(/不同的定时成果回执/);
    });

    it('validates createdAt is non-negative safe integer', () => {
      const store = openStore();
      expect(() =>
        store.scheduleOutputs.createPending({
          occurrenceId: 'occ-1',
          artifactVersionId: 'av-1',
          relativePath: '定时成果/report.md',
          contentHash: SHA256_HEX,
          createdAt: -1,
        }),
      ).toThrow(/createdAt/);
    });

    it('creates receipt for presentation artifact using file_hash', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db, {
        artifactType: 'presentation',
        expectedTypes: ['presentation'],
        fileHash: SHA256_HEX,
      });

      const receipt = store.scheduleOutputs.createPending({
        occurrenceId: ids.occurrenceId,
        artifactVersionId: ids.artifactVersionId,
        relativePath: '定时成果/slides.pptx',
        contentHash: SHA256_HEX,
        createdAt: 100,
      });

      expect(receipt.status).toBe('pending');
    });
  });

  describe('claimSaving (CAS)', () => {
    function insertPendingReceipt(
      db: Database.Database,
      occurrenceId: string,
      artifactVersionId: string,
      workspaceId: string,
    ) {
      exec(
        db,
        `INSERT INTO schedule_output_receipts
           (id, occurrence_id, artifact_version_id, workspace_id, relative_path,
            content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at)
         VALUES ('r1', ?, ?, ?, '定时成果/a.md', ?, 'pending', 1, NULL, NULL, 10, 10)`,
        [occurrenceId, artifactVersionId, workspaceId, SHA256_HEX],
      );
    }

    it('transitions pending → saving with correct attempt', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db);
      insertPendingReceipt(db, ids.occurrenceId, ids.artifactVersionId, ids.workspaceId);

      const result = store.scheduleOutputs.claimSaving({
        receiptId: 'r1',
        expectedAttempt: 1,
        updatedAt: 20,
      });

      expect(result.status).toBe('saving');
      expect(result.attempt).toBe(1);
    });

    it('throws when attempt does not match', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db);
      insertPendingReceipt(db, ids.occurrenceId, ids.artifactVersionId, ids.workspaceId);

      expect(() =>
        store.scheduleOutputs.claimSaving({ receiptId: 'r1', expectedAttempt: 99, updatedAt: 20 }),
      ).toThrow(/已变化/);
    });

    it('throws when status is not pending', () => {
      const store = openStore();
      const db = dbOf(store);
      const ids = insertProvenance(db);
      insertPendingReceipt(db, ids.occurrenceId, ids.artifactVersionId, ids.workspaceId);
      store.scheduleOutputs.claimSaving({ receiptId: 'r1', expectedAttempt: 1, updatedAt: 20 });

      expect(() =>
        store.scheduleOutputs.claimSaving({ receiptId: 'r1', expectedAttempt: 1, updatedAt: 30 }),
      ).toThrow(/已变化/);
    });

    it('rejects non-positive expectedAttempt', () => {
      const store = openStore();
      expect(() =>
        store.scheduleOutputs.claimSaving({ receiptId: 'r1', expectedAttempt: 0, updatedAt: 20 }),
      ).toThrow(/expectedAttempt/);
    });
  });

  describe('markSaved', () => {
    function insertSavingReceipt(db: Database.Database) {
      exec(
        db,
        `INSERT INTO schedule_output_receipts
           (id, occurrence_id, artifact_version_id, workspace_id, relative_path,
            content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at)
         VALUES ('r1', 'occ-1', 'av-1', 'ws-1', '定时成果/a.md', ?, 'saving', 1, NULL, NULL, 10, 10)`,
        [SHA256_HEX],
      );
    }

    it('transitions saving → saved', () => {
      const store = openStore();
      const db = dbOf(store);
      insertProvenance(db);
      insertSavingReceipt(db);

      const result = store.scheduleOutputs.markSaved({
        receiptId: 'r1',
        expectedAttempt: 1,
        updatedAt: 20,
      });

      expect(result.status).toBe('saved');
      expect(result.failureCode).toBeUndefined();
    });

    it('is idempotent when already saved with same attempt', () => {
      const store = openStore();
      const db = dbOf(store);
      insertProvenance(db);
      insertSavingReceipt(db);
      store.scheduleOutputs.markSaved({ receiptId: 'r1', expectedAttempt: 1, updatedAt: 20 });

      const result = store.scheduleOutputs.markSaved({
        receiptId: 'r1',
        expectedAttempt: 1,
        updatedAt: 30,
      });

      expect(result.status).toBe('saved');
    });

    it('throws when status is not saving', () => {
      const store = openStore();
      const db = dbOf(store);
      insertProvenance(db);
      exec(
        db,
        `INSERT INTO schedule_output_receipts
           (id, occurrence_id, artifact_version_id, workspace_id, relative_path,
            content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at)
         VALUES ('r1', 'occ-1', 'av-1', 'ws-1', '定时成果/a.md', ?, 'pending', 1, NULL, NULL, 10, 10)`,
        [SHA256_HEX],
      );

      expect(() =>
        store.scheduleOutputs.markSaved({ receiptId: 'r1', expectedAttempt: 1, updatedAt: 20 }),
      ).toThrow(/已变化/);
    });
  });

  describe('markFailed', () => {
    function insertSavingReceipt(db: Database.Database) {
      insertProvenance(db);
      exec(
        db,
        `INSERT INTO schedule_output_receipts
           (id, occurrence_id, artifact_version_id, workspace_id, relative_path,
            content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at)
         VALUES ('r1', 'occ-1', 'av-1', 'ws-1', '定时成果/a.md', ?, 'saving', 1, NULL, NULL, 10, 10)`,
        [SHA256_HEX],
      );
    }

    it('transitions saving → failed with failure code and detail', () => {
      const store = openStore();
      const db = dbOf(store);
      insertSavingReceipt(db);

      const result = store.scheduleOutputs.markFailed({
        receiptId: 'r1',
        expectedAttempt: 1,
        failureCode: 'schedule_output_save_failed',
        failureDetail: 'disk full',
        updatedAt: 20,
      });

      expect(result.status).toBe('failed');
      expect(result.failureCode).toBe('schedule_output_save_failed');
      expect(result.failureDetail).toBe('disk full');
    });

    it('truncates failure detail to 2000 characters', () => {
      const store = openStore();
      const db = dbOf(store);
      insertSavingReceipt(db);

      const longDetail = 'x'.repeat(3000);
      const result = store.scheduleOutputs.markFailed({
        receiptId: 'r1',
        expectedAttempt: 1,
        failureCode: 'schedule_output_save_failed',
        failureDetail: longDetail,
        updatedAt: 20,
      });

      expect(result.failureDetail?.length).toBe(2000);
    });

    it('throws when failure detail is empty after trim', () => {
      const store = openStore();
      const db = dbOf(store);
      insertSavingReceipt(db);

      expect(() =>
        store.scheduleOutputs.markFailed({
          receiptId: 'r1',
          expectedAttempt: 1,
          failureCode: 'schedule_output_save_failed',
          failureDetail: '   ',
          updatedAt: 20,
        }),
      ).toThrow(/failureDetail/);
    });

    it('is idempotent when already failed with same attempt', () => {
      const store = openStore();
      const db = dbOf(store);
      insertSavingReceipt(db);
      store.scheduleOutputs.markFailed({
        receiptId: 'r1',
        expectedAttempt: 1,
        failureCode: 'schedule_output_save_failed',
        failureDetail: 'first',
        updatedAt: 20,
      });

      const result = store.scheduleOutputs.markFailed({
        receiptId: 'r1',
        expectedAttempt: 1,
        failureCode: 'schedule_output_save_failed',
        failureDetail: 'second',
        updatedAt: 30,
      });

      expect(result.status).toBe('failed');
      expect(result.failureDetail).toBe('first');
    });
  });

  describe('retryFailed', () => {
    function insertFailedReceipt(db: Database.Database) {
      insertProvenance(db);
      exec(
        db,
        `INSERT INTO schedule_output_receipts
           (id, occurrence_id, artifact_version_id, workspace_id, relative_path,
            content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at)
         VALUES ('r1', 'occ-1', 'av-1', 'ws-1', '定时成果/report.md', ?, 'failed', 1, 'schedule_output_save_failed', 'disk full', 10, 10)`,
        [SHA256_HEX],
      );
    }

    it('transitions failed → pending with incremented attempt and renamed path', () => {
      const store = openStore();
      const db = dbOf(store);
      insertFailedReceipt(db);

      const result = store.scheduleOutputs.retryFailed({
        receiptId: 'r1',
        expectedAttempt: 1,
        updatedAt: 20,
      });

      expect(result.status).toBe('pending');
      expect(result.attempt).toBe(2);
      expect(result.relativePath).toBe('定时成果/report-attempt-2.md');
      expect(result.failureCode).toBeUndefined();
      expect(result.failureDetail).toBeUndefined();
    });

    it('handles filenames without extension', () => {
      const store = openStore();
      const db = dbOf(store);
      insertProvenance(db);
      exec(
        db,
        `INSERT INTO schedule_output_receipts
           (id, occurrence_id, artifact_version_id, workspace_id, relative_path,
            content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at)
         VALUES ('r1', 'occ-1', 'av-1', 'ws-1', '定时成果/noext', ?, 'failed', 1, 'schedule_output_save_failed', 'err', 10, 10)`,
        [SHA256_HEX],
      );

      const result = store.scheduleOutputs.retryFailed({
        receiptId: 'r1',
        expectedAttempt: 1,
        updatedAt: 20,
      });

      expect(result.relativePath).toBe('定时成果/noext-attempt-2');
    });

    it('throws when status is not failed', () => {
      const store = openStore();
      const db = dbOf(store);
      insertProvenance(db);
      exec(
        db,
        `INSERT INTO schedule_output_receipts
           (id, occurrence_id, artifact_version_id, workspace_id, relative_path,
            content_hash, status, attempt, failure_code, failure_detail, created_at, updated_at)
         VALUES ('r1', 'occ-1', 'av-1', 'ws-1', '定时成果/a.md', ?, 'pending', 1, NULL, NULL, 10, 10)`,
        [SHA256_HEX],
      );

      expect(() =>
        store.scheduleOutputs.retryFailed({ receiptId: 'r1', expectedAttempt: 1, updatedAt: 20 }),
      ).toThrow(/已变化/);
    });

    it('throws when attempt does not match', () => {
      const store = openStore();
      const db = dbOf(store);
      insertFailedReceipt(db);

      expect(() =>
        store.scheduleOutputs.retryFailed({ receiptId: 'r1', expectedAttempt: 99, updatedAt: 20 }),
      ).toThrow(/已变化/);
    });
  });
});
