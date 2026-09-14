import { randomUUID } from 'node:crypto';

import {
  builtinToolPolicySchema,
  type ExpertDetail,
  type ExpertLifecycle,
  expertModelReferenceSchema,
  type ExpertRevision,
  type ExpertRevisionDraft,
  expertSkillPresetSchema,
  type ExpertSourceKind,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

interface ExpertRow {
  id: string;
  source_kind: ExpertSourceKind;
  lifecycle: ExpertLifecycle;
  current_revision_id: string;
  created_at: number;
  updated_at: number;
}

interface ExpertRevisionRow {
  id: string;
  expert_id: string;
  revision: number;
  name: string;
  summary: string;
  avatar_key: string | null;
  identity: string;
  principles_json: string;
  input_requirements_json: string;
  delivery_requirements_json: string;
  skill_preset_json: string;
  builtin_tool_policy_json: string;
  model_reference_json: string;
  created_at: number;
}

export interface CreateExpertInput {
  sourceKind: ExpertSourceKind;
  lifecycle?: ExpertLifecycle;
  revision: ExpertRevisionDraft;
}

const parseStringArray = (value: string, field: string): string[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error(`Stored Expert ${field} must be a string array`);
  }
  const strings: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') throw new Error(`Stored Expert ${field} must be a string array`);
    strings.push(item);
  }
  return strings;
};

const toRevision = (row: ExpertRevisionRow): ExpertRevision => ({
  id: row.id,
  expertId: row.expert_id,
  revision: row.revision,
  name: row.name,
  summary: row.summary,
  ...(row.avatar_key === null ? {} : { avatarKey: row.avatar_key }),
  identity: row.identity,
  principles: parseStringArray(row.principles_json, 'principles'),
  inputRequirements: parseStringArray(row.input_requirements_json, 'inputRequirements'),
  deliveryRequirements: parseStringArray(row.delivery_requirements_json, 'deliveryRequirements'),
  skillPreset: expertSkillPresetSchema.parse(JSON.parse(row.skill_preset_json)),
  builtinToolPolicy: builtinToolPolicySchema.parse(JSON.parse(row.builtin_tool_policy_json)),
  modelReference: expertModelReferenceSchema.parse(JSON.parse(row.model_reference_json)),
  createdAt: row.created_at,
});

const emptyBlockedReasons = (): ExpertDetail['blockedReasons'] => [];

export class ExpertRepository {
  constructor(private readonly db: Database.Database) {}

  private getRow(id: string): ExpertRow | undefined {
    return this.db.prepare('SELECT * FROM experts WHERE id = ?').get(id) as ExpertRow | undefined;
  }

  private getRevisionRow(id: string): ExpertRevisionRow | undefined {
    return this.db.prepare('SELECT * FROM expert_revisions WHERE id = ?').get(id) as
      ExpertRevisionRow | undefined;
  }

  private getCurrentRevision(row: ExpertRow): ExpertRevision {
    const revision = this.getRevisionRow(row.current_revision_id);
    if (!revision) throw new Error(`Expert revision does not exist: ${row.current_revision_id}`);
    return toRevision(revision);
  }

  private toDetail(row: ExpertRow): ExpertDetail {
    const revision = this.getCurrentRevision(row);
    return {
      id: row.id,
      sourceKind: row.source_kind,
      lifecycle: row.lifecycle,
      name: revision.name,
      summary: revision.summary,
      currentRevision: revision.revision,
      blockedReasons: emptyBlockedReasons(),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision,
    };
  }

  list(includeArchived = false): ExpertDetail[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM experts
         ${includeArchived ? '' : "WHERE lifecycle != 'archived'"}
         ORDER BY updated_at DESC, id`,
      )
      .all() as ExpertRow[];
    return rows.map((row) => this.toDetail(row));
  }

  get(id: string): ExpertDetail | undefined {
    const row = this.getRow(id);
    return row ? this.toDetail(row) : undefined;
  }

  getRevision(id: string, revisionId: string): ExpertRevision | undefined {
    const row = this.getRow(id);
    const revision = this.getRevisionRow(revisionId);
    if (!row || !revision || revision.expert_id !== id) return undefined;
    return toRevision(revision);
  }

  create(input: CreateExpertInput): ExpertDetail {
    const now = Date.now();
    const expertId = randomUUID();
    const revisionId = randomUUID();
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO experts
             (id, source_kind, lifecycle, current_revision_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(expertId, input.sourceKind, input.lifecycle ?? 'active', revisionId, now, now);
      this.insertRevision(expertId, revisionId, 1, input.revision, now);
    });
    insert();
    const created = this.get(expertId);
    if (!created) throw new Error('Expert was not available after creation');
    return created;
  }

  saveRevision(id: string, revision: ExpertRevisionDraft, expectedRevision: number): ExpertDetail {
    const row = this.getRow(id);
    if (!row) throw new Error(`Expert does not exist: ${id}`);
    if (row.source_kind === 'builtin')
      throw new Error('Builtin Expert cannot be overwritten; copy it first');
    const current = this.getCurrentRevision(row);
    if (current.revision !== expectedRevision) {
      throw new Error(
        `Expert revision conflict: expected ${expectedRevision}, current ${current.revision}`,
      );
    }
    const revisionId = randomUUID();
    const now = Date.now();
    const save = this.db.transaction(() => {
      this.insertRevision(id, revisionId, current.revision + 1, revision, now);
      this.db
        .prepare(
          `UPDATE experts SET current_revision_id = ?, updated_at = ?
           WHERE id = ? AND current_revision_id = ?`,
        )
        .run(revisionId, now, id, row.current_revision_id);
    });
    save();
    const updated = this.get(id);
    if (!updated) throw new Error('Expert was not available after revision save');
    return updated;
  }

  copy(id: string, name?: string): ExpertDetail {
    const source = this.get(id);
    if (!source) throw new Error(`Expert does not exist: ${id}`);
    return this.create({
      sourceKind: 'user',
      revision: {
        name: name ?? `${source.revision.name} 副本`,
        summary: source.revision.summary,
        ...(source.revision.avatarKey ? { avatarKey: source.revision.avatarKey } : {}),
        identity: source.revision.identity,
        principles: source.revision.principles,
        inputRequirements: source.revision.inputRequirements,
        deliveryRequirements: source.revision.deliveryRequirements,
        skillPreset: source.revision.skillPreset,
        builtinToolPolicy: source.revision.builtinToolPolicy,
        modelReference: source.revision.modelReference,
      },
    });
  }

  setLifecycle(id: string, lifecycle: ExpertLifecycle, expectedRevision: number): ExpertDetail {
    const row = this.getRow(id);
    if (!row) throw new Error(`Expert does not exist: ${id}`);
    const current = this.getCurrentRevision(row);
    if (current.revision !== expectedRevision) {
      throw new Error(
        `Expert revision conflict: expected ${expectedRevision}, current ${current.revision}`,
      );
    }
    this.db
      .prepare('UPDATE experts SET lifecycle = ?, updated_at = ? WHERE id = ?')
      .run(lifecycle, Date.now(), id);
    const updated = this.get(id);
    if (!updated) throw new Error('Expert was not available after lifecycle update');
    return updated;
  }

  private insertRevision(
    expertId: string,
    revisionId: string,
    revisionNumber: number,
    draft: ExpertRevisionDraft,
    createdAt: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO expert_revisions (
           id, expert_id, revision, name, summary, avatar_key, identity,
           principles_json, input_requirements_json, delivery_requirements_json,
           skill_preset_json, builtin_tool_policy_json, model_reference_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId,
        expertId,
        revisionNumber,
        draft.name,
        draft.summary,
        draft.avatarKey ?? null,
        draft.identity,
        JSON.stringify(draft.principles),
        JSON.stringify(draft.inputRequirements),
        JSON.stringify(draft.deliveryRequirements),
        JSON.stringify(draft.skillPreset),
        JSON.stringify(draft.builtinToolPolicy),
        JSON.stringify(draft.modelReference),
        createdAt,
      );
  }
}
