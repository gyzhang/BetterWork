import { randomUUID } from 'node:crypto';

import type {
  RuntimeProfileDraft,
  RuntimeProfileRevision,
  SkillDetail,
  SkillRevisionSummary,
  SkillSourceKind,
  SkillSummary,
  SkillTrustStatus,
} from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';

export type SkillTrustPreference = 'untrusted' | 'trusted' | 'revoked';
export type SkillTrustGrantSource = 'builtin-release' | 'user';

export interface SaveSkillInput {
  id?: string;
  name: string;
  description: string;
  sourceKind: SkillSourceKind;
  currentRevisionId: string;
  currentProfileRevisionId?: string;
}

export interface SaveSkillRevisionInput {
  id?: string;
  skillId: string;
  contentHash: string;
  originalVersion?: string;
  resourceKey: string;
  frontmatter: Record<string, unknown>;
}

export interface SaveSkillProfileInput {
  id?: string;
  skillId: string;
  profileHash: string;
  profile: RuntimeProfileDraft;
}

export interface SaveSkillTrustGrantInput {
  id?: string;
  skillId: string;
  revisionId: string;
  profileHash: string;
  dependencyFingerprint: string;
  scopeHash: string;
  source: SkillTrustGrantSource;
}

interface SkillRow {
  id: string;
  name: string;
  description: string;
  source_kind: SkillSourceKind;
  enabled: number;
  current_revision_id: string;
  current_profile_revision_id: string | null;
}

interface RevisionRow {
  id: string;
  skill_id: string;
  content_hash: string;
  original_version: string | null;
  resource_key: string;
  frontmatter_json: string;
  created_at: number;
}

interface ProfileRow {
  id: string;
  skill_id: string;
  profile_hash: string;
  profile_json: string;
  created_at: number;
}

interface PreferenceRow {
  trust_preference: SkillTrustPreference;
}

interface GrantRow {
  revision_id: string;
  profile_hash: string;
}

const parseRecord = (value: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Stored Skill metadata must be an object');
  }
  return parsed as Record<string, unknown>;
};

const toRevision = (row: RevisionRow): SkillRevisionSummary => ({
  id: row.id,
  skillId: row.skill_id,
  contentHash: row.content_hash,
  ...(row.original_version === null ? {} : { originalVersion: row.original_version }),
  resourceKey: row.resource_key,
  frontmatter: parseRecord(row.frontmatter_json),
  createdAt: row.created_at,
});

const toProfile = (row: ProfileRow): RuntimeProfileRevision => ({
  id: row.id,
  skillId: row.skill_id,
  profileHash: row.profile_hash,
  profile: JSON.parse(row.profile_json) as RuntimeProfileDraft,
  createdAt: row.created_at,
});

const trustStatus = (
  preference: SkillTrustPreference,
  grant: GrantRow | undefined,
): SkillTrustStatus => {
  if (preference === 'revoked') return 'revoked';
  if (preference === 'trusted' && grant) return 'trusted';
  if (preference === 'trusted') return 'needs-review';
  return 'untrusted';
};

export class SkillRepository {
  constructor(private readonly db: Database.Database) {}

  private getRow(id: string): SkillRow | undefined {
    return this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined;
  }

  private getRevision(id: string): RevisionRow | undefined {
    return this.db.prepare('SELECT * FROM skill_revisions WHERE id = ?').get(id) as
      RevisionRow | undefined;
  }

  private getProfile(id: string): ProfileRow | undefined {
    return this.db.prepare('SELECT * FROM skill_runtime_profiles WHERE id = ?').get(id) as
      ProfileRow | undefined;
  }

  private getPreference(skillId: string): PreferenceRow {
    return (
      (this.db
        .prepare('SELECT trust_preference FROM skill_preferences WHERE skill_id = ?')
        .get(skillId) as PreferenceRow | undefined) ?? { trust_preference: 'untrusted' }
    );
  }

  getTrustPreference(skillId: string): SkillTrustPreference {
    return this.getPreference(skillId).trust_preference;
  }

  private getGrant(
    skillId: string,
    revisionId: string,
    profileHash: string | undefined,
  ): GrantRow | undefined {
    if (!profileHash) return undefined;
    return this.db
      .prepare(
        `SELECT revision_id, profile_hash FROM skill_trust_grants
          WHERE skill_id = ? AND revision_id = ? AND profile_hash = ? AND revoked_at IS NULL
          ORDER BY granted_at DESC LIMIT 1`,
      )
      .get(skillId, revisionId, profileHash) as GrantRow | undefined;
  }

  private toSummary(row: SkillRow): SkillSummary {
    const revision = this.getRevision(row.current_revision_id);
    if (!revision) throw new Error(`Skill revision does not exist: ${row.current_revision_id}`);
    const profile = row.current_profile_revision_id
      ? this.getProfile(row.current_profile_revision_id)
      : undefined;
    const preference = this.getPreference(row.id).trust_preference;
    const status = trustStatus(
      preference,
      this.getGrant(row.id, revision.id, profile?.profile_hash),
    );
    const blockedReasons: SkillSummary['blockedReasons'] = [];
    if (row.enabled === 0) blockedReasons.push('disabled');
    if (status === 'untrusted') blockedReasons.push('untrusted');
    if (status === 'needs-review') blockedReasons.push('trust-needs-review');
    if (status === 'revoked') blockedReasons.push('trust-revoked');
    const environmentStatus = this.getEnvironmentStatus();
    if (environmentStatus !== 'ready') blockedReasons.push('environment-unprepared');
    if (!profile) blockedReasons.push('missing-runtime-profile');
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      sourceKind: row.source_kind,
      enabled: row.enabled === 1,
      currentRevisionId: row.current_revision_id,
      trustStatus: status,
      environmentStatus,
      blockedReasons,
    };
  }

  private getEnvironmentStatus(): SkillSummary['environmentStatus'] {
    const environment = this.db
      .prepare(
        `SELECT status FROM runtime_environments
         ORDER BY CASE status WHEN 'ready' THEN 1 WHEN 'preparing' THEN 2 ELSE 3 END,
                  updated_at DESC
         LIMIT 1`,
      )
      .get() as { status: SkillSummary['environmentStatus'] } | undefined;
    return environment?.status ?? 'unprepared';
  }

  list(): SkillSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM skills ORDER BY name COLLATE NOCASE, id')
      .all() as SkillRow[];
    return rows.map((row) => this.toSummary(row));
  }

  listRevisions(skillId: string): SkillRevisionSummary[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM skill_revisions WHERE skill_id = ? ORDER BY created_at ASC, rowid ASC',
      )
      .all(skillId) as RevisionRow[];
    return rows.map(toRevision);
  }

  get(id: string): SkillDetail | undefined {
    const row = this.getRow(id);
    if (!row) return undefined;
    const revision = this.getRevision(row.current_revision_id);
    if (!revision) throw new Error(`Skill revision does not exist: ${row.current_revision_id}`);
    const profile = row.current_profile_revision_id
      ? this.getProfile(row.current_profile_revision_id)
      : undefined;
    return {
      ...this.toSummary(row),
      revision: toRevision(revision),
      ...(profile ? { runtimeProfile: toProfile(profile) } : {}),
    };
  }

  saveRevision(input: SaveSkillRevisionInput): string {
    const existing = this.db
      .prepare('SELECT id FROM skill_revisions WHERE skill_id = ? AND content_hash = ?')
      .get(input.skillId, input.contentHash) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO skill_revisions
          (id, skill_id, content_hash, original_version, resource_key, frontmatter_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.skillId,
        input.contentHash,
        input.originalVersion ?? null,
        input.resourceKey,
        JSON.stringify(input.frontmatter),
        Date.now(),
      );
    return id;
  }

  saveProfile(input: SaveSkillProfileInput): string {
    const existing = this.db
      .prepare('SELECT id FROM skill_runtime_profiles WHERE skill_id = ? AND profile_hash = ?')
      .get(input.skillId, input.profileHash) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO skill_runtime_profiles
          (id, skill_id, profile_hash, profile_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.skillId, input.profileHash, JSON.stringify(input.profile), Date.now());
    return id;
  }

  save(input: SaveSkillInput): string {
    const id = input.id ?? randomUUID();
    const now = Date.now();
    const existing = this.getRow(id);
    if (existing) {
      this.db
        .prepare(
          `UPDATE skills SET name = ?, description = ?, source_kind = ?, enabled = ?,
             current_revision_id = ?, current_profile_revision_id = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.name,
          input.description,
          input.sourceKind,
          existing.enabled,
          input.currentRevisionId,
          input.currentProfileRevisionId ?? null,
          now,
          id,
        );
      return id;
    }
    this.db
      .prepare(
        `INSERT INTO skills
          (id, name, description, source_kind, enabled, current_revision_id,
           current_profile_revision_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description,
        input.sourceKind,
        input.currentRevisionId,
        input.currentProfileRevisionId ?? null,
        now,
        now,
      );
    return id;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    return (
      this.db
        .prepare('UPDATE skills SET enabled = ?, updated_at = ? WHERE id = ?')
        .run(enabled ? 1 : 0, Date.now(), id).changes > 0
    );
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM skills WHERE id = ?').run(id).changes > 0;
  }

  setTrustPreference(id: string, preference: SkillTrustPreference): boolean {
    if (!this.getRow(id)) return false;
    this.db
      .prepare(
        `INSERT INTO skill_preferences (skill_id, trust_preference, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(skill_id) DO UPDATE SET trust_preference = excluded.trust_preference,
           updated_at = excluded.updated_at`,
      )
      .run(id, preference, Date.now());
    if (preference === 'revoked') {
      this.db
        .prepare(
          'UPDATE skill_trust_grants SET revoked_at = ? WHERE skill_id = ? AND revoked_at IS NULL',
        )
        .run(Date.now(), id);
    }
    return true;
  }

  saveTrustGrant(input: SaveSkillTrustGrantInput): string {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO skill_trust_grants
          (id, skill_id, revision_id, profile_hash, dependency_fingerprint, scope_hash,
           source, granted_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        input.skillId,
        input.revisionId,
        input.profileHash,
        input.dependencyFingerprint,
        input.scopeHash,
        input.source,
        Date.now(),
      );
    this.setTrustPreference(input.skillId, 'trusted');
    return id;
  }
}
