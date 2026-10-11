import type { RuntimeProfileDraft } from '@betterwork/agent-protocol';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];

const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};

function dbOf(store: AppStore): Database.Database {
  return (store as unknown as { db: Database.Database }).db;
}

function exec(db: Database.Database, sqlText: string, params: unknown[] = []): void {
  db.prepare(sqlText).run(...params);
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const minimalProfile: RuntimeProfileDraft = {
  commands: [],
  environmentRequirements: [],
};

interface SeedSkillOptions {
  skillId?: string;
  name?: string;
  enabled?: boolean;
  revisionId?: string;
  profileId?: string | null;
  profileHash?: string;
  trustPreference?: 'untrusted' | 'trusted' | 'revoked';
  grantRevisionId?: string;
  grantProfileHash?: string;
  grantRevoked?: boolean;
}

function seedSkill(
  db: Database.Database,
  options: SeedSkillOptions = {},
): {
  skillId: string;
  revisionId: string;
  profileId: string | null;
  profileHash: string;
  grantId: string | null;
} {
  const skillId = options.skillId ?? 'skill-1';
  const revisionId = options.revisionId ?? 'rev-1';
  const profileId = options.profileId ?? null;
  const profileHash = options.profileHash ?? 'profile-hash-1';
  const enabled = options.enabled ?? true;

  exec(
    db,
    `INSERT INTO skills (id, name, description, source_kind, enabled, current_revision_id, current_profile_revision_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      skillId,
      options.name ?? 'Test Skill',
      'A test skill',
      'builtin',
      enabled ? 1 : 0,
      revisionId,
      profileId,
      Date.now(),
      Date.now(),
    ],
  );

  exec(
    db,
    `INSERT INTO skill_revisions (id, skill_id, content_hash, resource_key, frontmatter_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      revisionId,
      skillId,
      'content-hash-1',
      'test-skill',
      JSON.stringify({ title: 'Test' }),
      Date.now(),
    ],
  );

  if (profileId) {
    exec(
      db,
      `INSERT INTO skill_runtime_profiles (id, skill_id, profile_hash, profile_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      [profileId, skillId, profileHash, JSON.stringify(minimalProfile), Date.now()],
    );
  }

  let grantId: string | null = null;
  if (options.trustPreference) {
    exec(
      db,
      `INSERT INTO skill_preferences (skill_id, trust_preference, updated_at) VALUES (?, ?, ?)`,
      [skillId, options.trustPreference, Date.now()],
    );
  }

  if (options.grantRevisionId && options.grantProfileHash) {
    grantId = 'grant-1';
    exec(
      db,
      `INSERT INTO skill_trust_grants (id, skill_id, revision_id, profile_hash, dependency_fingerprint, scope_hash, source, granted_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        grantId,
        skillId,
        options.grantRevisionId,
        options.grantProfileHash,
        'dep-fingerprint',
        'scope-hash',
        'builtin-release',
        Date.now(),
        options.grantRevoked ? Date.now() : null,
      ],
    );
  }

  return { skillId, revisionId, profileId, profileHash, grantId };
}

describe('SkillRepository', () => {
  describe('save', () => {
    it('inserts a new skill and returns the id', () => {
      const store = openStore();
      const db = dbOf(store);
      // Pre-create the skill so we can add a matching revision row
      const id = store.skills.save({
        id: 'new-skill',
        name: 'New Skill',
        description: 'A brand new skill',
        sourceKind: 'builtin',
        currentRevisionId: 'rev-1',
      });
      expect(id).toBe('new-skill');

      // Insert the revision the skill points to so get() can resolve it
      exec(
        db,
        `INSERT INTO skill_revisions (id, skill_id, content_hash, resource_key, frontmatter_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ['rev-1', 'new-skill', 'hash-1', 'new-skill', JSON.stringify({}), Date.now()],
      );

      const detail = store.skills.get(id);
      expect(detail).toBeDefined();
      expect(detail?.name).toBe('New Skill');
      expect(detail?.enabled).toBe(true);
    });

    it('uses provided id when given', () => {
      const store = openStore();
      const id = store.skills.save({
        id: 'custom-id',
        name: 'Custom',
        description: 'desc',
        sourceKind: 'user',
        currentRevisionId: 'rev-1',
      });
      expect(id).toBe('custom-id');
    });

    it('updates an existing skill on second save', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      exec(
        db,
        `INSERT INTO skill_revisions (id, skill_id, content_hash, resource_key, frontmatter_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ['rev-2', 'skill-1', 'content-hash-2', 'test-skill-v2', JSON.stringify({}), Date.now()],
      );

      store.skills.save({
        id: 'skill-1',
        name: 'Updated Skill',
        description: 'Updated description',
        sourceKind: 'user',
        currentRevisionId: 'rev-2',
      });

      const detail = store.skills.get('skill-1');
      expect(detail?.name).toBe('Updated Skill');
      expect(detail?.description).toBe('Updated description');
      expect(detail?.sourceKind).toBe('user');
      expect(detail?.currentRevisionId).toBe('rev-2');
      expect(detail?.enabled).toBe(true);
    });

    it('preserves enabled flag when updating', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1', enabled: false });

      exec(
        db,
        `INSERT INTO skill_revisions (id, skill_id, content_hash, resource_key, frontmatter_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ['rev-2', 'skill-1', 'hash-2', 'key-2', JSON.stringify({}), Date.now()],
      );

      store.skills.save({
        id: 'skill-1',
        name: 'Still Disabled',
        description: 'desc',
        sourceKind: 'builtin',
        currentRevisionId: 'rev-2',
      });

      const detail = store.skills.get('skill-1');
      expect(detail?.enabled).toBe(false);
    });
  });

  describe('get', () => {
    it('returns undefined for non-existent skill', () => {
      const store = openStore();
      expect(store.skills.get('nonexistent')).toBeUndefined();
    });

    it('returns skill detail with revision', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
      });

      const detail = store.skills.get('skill-1');
      expect(detail).toBeDefined();
      expect(detail?.id).toBe('skill-1');
      expect(detail?.name).toBe('Test Skill');
      expect(detail?.revision.id).toBe('rev-1');
      expect(detail?.revision.skillId).toBe('skill-1');
      expect(detail?.revision.contentHash).toBe('content-hash-1');
      expect(detail?.revision.resourceKey).toBe('test-skill');
      expect(detail?.runtimeProfile).toBeDefined();
      expect(detail?.runtimeProfile?.id).toBe('prof-1');
      expect(detail?.runtimeProfile?.profileHash).toBe('ph-1');
    });

    it('returns detail without runtimeProfile when no profile is set', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      const detail = store.skills.get('skill-1');
      expect(detail).toBeDefined();
      expect(detail?.runtimeProfile).toBeUndefined();
    });

    it('throws when current revision does not exist', () => {
      const store = openStore();
      const db = dbOf(store);
      exec(
        db,
        `INSERT INTO skills (id, name, description, source_kind, enabled, current_revision_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        ['orphan', 'Orphan', 'desc', 'builtin', 'missing-rev', Date.now(), Date.now()],
      );

      expect(() => store.skills.get('orphan')).toThrow('Skill revision does not exist');
    });
  });

  describe('list', () => {
    it('returns empty array when no skills exist', () => {
      const store = openStore();
      expect(store.skills.list()).toEqual([]);
    });

    it('returns all skills sorted by name case-insensitive', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'c', name: 'Zebra', revisionId: 'rev-c' });
      seedSkill(db, { skillId: 'a', name: 'Alpha', revisionId: 'rev-a' });
      seedSkill(db, { skillId: 'b', name: 'middle', revisionId: 'rev-b' });

      const list = store.skills.list();
      expect(list).toHaveLength(3);
      expect(list[0]?.name).toBe('Alpha');
      expect(list[1]?.name).toBe('middle');
      expect(list[2]?.name).toBe('Zebra');
    });

    it('includes blocked reasons for disabled and untrusted skills', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1', enabled: false });

      const list = store.skills.list();
      expect(list).toHaveLength(1);
      const summary = list[0]!;
      expect(summary.enabled).toBe(false);
      expect(summary.trustStatus).toBe('untrusted');
      expect(summary.blockedReasons).toContain('disabled');
      expect(summary.blockedReasons).toContain('untrusted');
      expect(summary.blockedReasons).toContain('environment-unprepared');
      expect(summary.blockedReasons).toContain('missing-runtime-profile');
    });
  });

  describe('setEnabled', () => {
    it('disables an enabled skill', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      const result = store.skills.setEnabled('skill-1', false);
      expect(result).toBe(true);

      const detail = store.skills.get('skill-1');
      expect(detail?.enabled).toBe(false);
    });

    it('enables a disabled skill', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1', enabled: false });

      store.skills.setEnabled('skill-1', true);
      const detail = store.skills.get('skill-1');
      expect(detail?.enabled).toBe(true);
    });

    it('returns false for non-existent skill', () => {
      const store = openStore();
      expect(store.skills.setEnabled('ghost', false)).toBe(false);
    });
  });

  describe('delete', () => {
    it('deletes an existing skill and cascades', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      const result = store.skills.delete('skill-1');
      expect(result).toBe(true);
      expect(store.skills.get('skill-1')).toBeUndefined();
    });

    it('returns false for non-existent skill', () => {
      const store = openStore();
      expect(store.skills.delete('ghost')).toBe(false);
    });
  });

  describe('saveRevision', () => {
    it('inserts a new revision and returns the id', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      const id = store.skills.saveRevision({
        skillId: 'skill-1',
        contentHash: 'new-hash',
        resourceKey: 'test-skill',
        frontmatter: { version: 2 },
      });
      expect(id).toBeTruthy();

      const revisions = store.skills.listRevisions('skill-1');
      expect(revisions).toHaveLength(2);
    });

    it('deduplicates by skill_id and content_hash', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      const id1 = store.skills.saveRevision({
        skillId: 'skill-1',
        contentHash: 'content-hash-1',
        resourceKey: 'test-skill',
        frontmatter: {},
      });
      expect(id1).toBe('rev-1');
    });

    it('uses provided id when given', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      const id = store.skills.saveRevision({
        id: 'explicit-rev-id',
        skillId: 'skill-1',
        contentHash: 'unique-hash',
        resourceKey: 'test-skill',
        frontmatter: {},
      });
      expect(id).toBe('explicit-rev-id');
    });

    it('stores optional fields correctly', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      store.skills.saveRevision({
        skillId: 'skill-1',
        contentHash: 'hash-with-opts',
        originalVersion: '1.2.3',
        resourceKey: 'test-skill',
        packageId: 'pkg-1',
        frontmatter: { key: 'value' },
      });

      const revisions = store.skills.listRevisions('skill-1');
      const latest = revisions.find((r) => r.contentHash === 'hash-with-opts');
      expect(latest).toBeDefined();
      expect(latest?.originalVersion).toBe('1.2.3');
      expect(latest?.packageId).toBe('pkg-1');
      expect(latest?.frontmatter).toEqual({ key: 'value' });
    });
  });

  describe('listRevisions', () => {
    it('returns empty array for skill with no extra revisions beyond current', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      const revisions = store.skills.listRevisions('skill-1');
      expect(revisions).toHaveLength(1);
      expect(revisions[0]?.id).toBe('rev-1');
    });

    it('returns revisions ordered by created_at ASC', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      store.skills.saveRevision({
        id: 'rev-2',
        skillId: 'skill-1',
        contentHash: 'hash-2',
        resourceKey: 'test-skill',
        frontmatter: {},
      });
      store.skills.saveRevision({
        id: 'rev-3',
        skillId: 'skill-1',
        contentHash: 'hash-3',
        resourceKey: 'test-skill',
        frontmatter: {},
      });

      const revisions = store.skills.listRevisions('skill-1');
      expect(revisions).toHaveLength(3);
      expect(revisions[0]?.id).toBe('rev-1');
      expect(revisions[1]?.id).toBe('rev-2');
      expect(revisions[2]?.id).toBe('rev-3');
    });
  });

  describe('hasRevision', () => {
    it('returns true for existing revision', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      expect(store.skills.hasRevision('skill-1', 'rev-1')).toBe(true);
    });

    it('returns false for wrong skill_id', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      expect(store.skills.hasRevision('other-skill', 'rev-1')).toBe(false);
    });

    it('returns false for non-existent revision', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      expect(store.skills.hasRevision('skill-1', 'missing')).toBe(false);
    });
  });

  describe('saveProfile', () => {
    it('inserts a new profile and returns the id', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      const id = store.skills.saveProfile({
        skillId: 'skill-1',
        profileHash: 'new-profile-hash',
        profile: minimalProfile,
      });
      expect(id).toBeTruthy();
    });

    it('deduplicates by skill_id and profile_hash', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
      });

      const id = store.skills.saveProfile({
        skillId: 'skill-1',
        profileHash: 'ph-1',
        profile: minimalProfile,
      });
      expect(id).toBe('prof-1');
    });

    it('uses provided id when given', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      const id = store.skills.saveProfile({
        id: 'explicit-prof-id',
        skillId: 'skill-1',
        profileHash: 'unique-ph',
        profile: minimalProfile,
      });
      expect(id).toBe('explicit-prof-id');
    });
  });

  describe('getTrustPreference', () => {
    it('returns untrusted by default when no preference row exists', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      expect(store.skills.getTrustPreference('skill-1')).toBe('untrusted');
    });

    it('returns stored preference', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1', trustPreference: 'trusted' });

      expect(store.skills.getTrustPreference('skill-1')).toBe('trusted');
    });
  });

  describe('setTrustPreference', () => {
    it('sets trust preference for existing skill', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      const result = store.skills.setTrustPreference('skill-1', 'trusted');
      expect(result).toBe(true);
      expect(store.skills.getTrustPreference('skill-1')).toBe('trusted');
    });

    it('returns false for non-existent skill', () => {
      const store = openStore();
      expect(store.skills.setTrustPreference('ghost', 'trusted')).toBe(false);
    });

    it('revokes all active grants when preference is revoked', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
        trustPreference: 'trusted',
        grantRevisionId: 'rev-1',
        grantProfileHash: 'ph-1',
      });

      store.skills.setTrustPreference('skill-1', 'revoked');
      expect(store.skills.getTrustPreference('skill-1')).toBe('revoked');

      const row = db
        .prepare('SELECT revoked_at FROM skill_trust_grants WHERE id = ?')
        .get('grant-1') as { revoked_at: number | null };
      expect(row.revoked_at).not.toBeNull();
    });

    it('upserts preference on conflict', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1', trustPreference: 'trusted' });

      store.skills.setTrustPreference('skill-1', 'untrusted');
      expect(store.skills.getTrustPreference('skill-1')).toBe('untrusted');
    });
  });

  describe('saveTrustGrant', () => {
    it('saves a grant and auto-sets trust preference to trusted', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
      });

      const grantId = store.skills.saveTrustGrant({
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileHash: 'ph-1',
        dependencyFingerprint: 'dep-fp',
        scopeHash: 'scope-h',
        source: 'builtin-release',
      });
      expect(grantId).toBeTruthy();
      expect(store.skills.getTrustPreference('skill-1')).toBe('trusted');
    });

    it('uses provided id when given', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      const grantId = store.skills.saveTrustGrant({
        id: 'explicit-grant',
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileHash: 'ph-1',
        dependencyFingerprint: 'dep-fp',
        scopeHash: 'scope-h',
        source: 'user',
      });
      expect(grantId).toBe('explicit-grant');
    });
  });

  describe('trust status in summary', () => {
    it('shows trusted when preference is trusted and active grant exists', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
        trustPreference: 'trusted',
        grantRevisionId: 'rev-1',
        grantProfileHash: 'ph-1',
      });

      const detail = store.skills.get('skill-1');
      expect(detail?.trustStatus).toBe('trusted');
      expect(detail?.blockedReasons).not.toContain('untrusted');
      expect(detail?.blockedReasons).not.toContain('trust-needs-review');
    });

    it('shows needs-review when preference is trusted but no grant matches', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
        trustPreference: 'trusted',
      });

      const detail = store.skills.get('skill-1');
      expect(detail?.trustStatus).toBe('needs-review');
      expect(detail?.blockedReasons).toContain('trust-needs-review');
    });

    it('shows revoked when preference is revoked', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
        trustPreference: 'revoked',
        grantRevisionId: 'rev-1',
        grantProfileHash: 'ph-1',
        grantRevoked: true,
      });

      const detail = store.skills.get('skill-1');
      expect(detail?.trustStatus).toBe('revoked');
      expect(detail?.blockedReasons).toContain('trust-revoked');
    });

    it('shows untrusted when no preference row exists', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      const detail = store.skills.get('skill-1');
      expect(detail?.trustStatus).toBe('untrusted');
      expect(detail?.blockedReasons).toContain('untrusted');
    });
  });

  describe('environment status', () => {
    it('returns unprepared when no profile is set', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      const detail = store.skills.get('skill-1');
      expect(detail?.environmentStatus).toBe('unprepared');
      expect(detail?.blockedReasons).toContain('environment-unprepared');
      expect(detail?.blockedReasons).toContain('missing-runtime-profile');
    });

    it('returns unprepared when no environment row matches', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
        trustPreference: 'trusted',
        grantRevisionId: 'rev-1',
        grantProfileHash: 'ph-1',
      });

      const detail = store.skills.get('skill-1');
      expect(detail?.environmentStatus).toBe('unprepared');
      expect(detail?.blockedReasons).toContain('environment-unprepared');
    });

    it('returns ready when environment is ready', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
        trustPreference: 'trusted',
        grantRevisionId: 'rev-1',
        grantProfileHash: 'ph-1',
      });

      const now = Date.now();
      exec(
        db,
        `INSERT INTO runtime_environments (id, environment_key, base_json, platform_json, lock_hash, lock_json, path_key, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['env-1', 'env-key-1', '{}', '{}', 'lock-hash-1', '{}', 'path-key-1', 'ready', now, now],
      );
      exec(
        db,
        `INSERT INTO skill_dependency_selections (grant_id, lock_hash, snapshot_ids_json) VALUES (?, ?, ?)`,
        ['grant-1', 'lock-hash-1', JSON.stringify(['snap-1'])],
      );

      const detail = store.skills.get('skill-1');
      expect(detail?.environmentStatus).toBe('ready');
      expect(detail?.blockedReasons).not.toContain('environment-unprepared');
    });
  });

  describe('dependency selections', () => {
    it('saves and retrieves dependency selection', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        trustPreference: 'trusted',
        grantRevisionId: 'rev-1',
        grantProfileHash: 'ph-1',
      });

      store.skills.saveDependencySelection('grant-1', 'lock-hash-1', ['snap-1', 'snap-2']);

      const selection = store.skills.getDependencySelection('grant-1');
      expect(selection).toBeDefined();
      expect(selection?.lockHash).toBe('lock-hash-1');
      expect(selection?.snapshotIds).toEqual(['snap-1', 'snap-2']);
    });

    it('returns undefined for non-existent grant selection', () => {
      const store = openStore();
      expect(store.skills.getDependencySelection('ghost-grant')).toBeUndefined();
    });

    it('does not overwrite existing selection (ON CONFLICT DO NOTHING)', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        trustPreference: 'trusted',
        grantRevisionId: 'rev-1',
        grantProfileHash: 'ph-1',
      });

      store.skills.saveDependencySelection('grant-1', 'lock-hash-1', ['snap-1']);
      store.skills.saveDependencySelection('grant-1', 'lock-hash-2', ['snap-2']);

      const selection = store.skills.getDependencySelection('grant-1');
      expect(selection?.lockHash).toBe('lock-hash-1');
      expect(selection?.snapshotIds).toEqual(['snap-1']);
    });

    it('retrieves latest dependency selection by skill/revision/profile/lock', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
        trustPreference: 'trusted',
        grantRevisionId: 'rev-1',
        grantProfileHash: 'ph-1',
      });

      store.skills.saveDependencySelection('grant-1', 'lock-hash-1', ['snap-a', 'snap-b']);

      const result = store.skills.getLatestDependencySelection(
        'skill-1',
        'rev-1',
        'ph-1',
        'lock-hash-1',
      );
      expect(result).toEqual(['snap-a', 'snap-b']);
    });

    it('returns undefined when no matching selection exists', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
      });

      const result = store.skills.getLatestDependencySelection(
        'skill-1',
        'rev-1',
        'ph-1',
        'lock-hash-x',
      );
      expect(result).toBeUndefined();
    });
  });

  describe('removeRevokedSnapshotReferences', () => {
    it('removes snapshot references from revoked grants only', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
        trustPreference: 'trusted',
        grantRevisionId: 'rev-1',
        grantProfileHash: 'ph-1',
      });

      store.skills.saveDependencySelection('grant-1', 'lock-hash-1', [
        'snap-1',
        'snap-2',
        'snap-3',
      ]);

      const removed = store.skills.removeRevokedSnapshotReferences('snap-2');
      expect(removed).toBe(0);

      const selection = store.skills.getDependencySelection('grant-1');
      expect(selection?.snapshotIds).toEqual(['snap-1', 'snap-2', 'snap-3']);
    });

    it('removes snapshot references when grant is revoked', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
        trustPreference: 'revoked',
        grantRevisionId: 'rev-1',
        grantProfileHash: 'ph-1',
        grantRevoked: true,
      });

      store.skills.saveDependencySelection('grant-1', 'lock-hash-1', [
        'snap-1',
        'snap-2',
        'snap-3',
      ]);

      const removed = store.skills.removeRevokedSnapshotReferences('snap-2');
      expect(removed).toBe(1);

      const selection = store.skills.getDependencySelection('grant-1');
      expect(selection?.snapshotIds).toEqual(['snap-1', 'snap-3']);
    });

    it('returns 0 when snapshot is not in any revoked grant selection', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        trustPreference: 'revoked',
        grantRevisionId: 'rev-1',
        grantProfileHash: 'ph-1',
        grantRevoked: true,
      });

      store.skills.saveDependencySelection('grant-1', 'lock-hash-1', ['snap-1']);

      const removed = store.skills.removeRevokedSnapshotReferences('snap-999');
      expect(removed).toBe(0);
    });
  });

  describe('getBoundDetail', () => {
    it('returns detail bound to specific revision and profile', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, {
        skillId: 'skill-1',
        revisionId: 'rev-1',
        profileId: 'prof-1',
        profileHash: 'ph-1',
      });

      store.skills.saveRevision({
        id: 'rev-2',
        skillId: 'skill-1',
        contentHash: 'hash-2',
        resourceKey: 'test-skill',
        frontmatter: {},
      });
      store.skills.saveProfile({
        id: 'prof-2',
        skillId: 'skill-1',
        profileHash: 'ph-2',
        profile: minimalProfile,
      });

      const bound = store.skills.getBoundDetail('rev-2', 'prof-2');
      expect(bound).toBeDefined();
      expect(bound?.currentRevisionId).toBe('rev-2');
      expect(bound?.revision.id).toBe('rev-2');
      expect(bound?.runtimeProfile?.id).toBe('prof-2');
    });

    it('returns undefined when revision and profile belong to different skills', () => {
      const store = openStore();
      const db = dbOf(store);
      seedSkill(db, { skillId: 'skill-1', revisionId: 'rev-1' });

      exec(
        db,
        `INSERT INTO skills (id, name, description, source_kind, enabled, current_revision_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        ['skill-2', 'Other', 'desc', 'builtin', 'rev-2', Date.now(), Date.now()],
      );
      exec(
        db,
        `INSERT INTO skill_revisions (id, skill_id, content_hash, resource_key, frontmatter_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ['rev-2', 'skill-2', 'hash-2', 'key-2', JSON.stringify({}), Date.now()],
      );
      exec(
        db,
        `INSERT INTO skill_runtime_profiles (id, skill_id, profile_hash, profile_json, created_at) VALUES (?, ?, ?, ?, ?)`,
        ['prof-1', 'skill-2', 'ph-1', JSON.stringify(minimalProfile), Date.now()],
      );

      const bound = store.skills.getBoundDetail('rev-1', 'prof-1');
      expect(bound).toBeUndefined();
    });

    it('returns undefined when revision does not exist', () => {
      const store = openStore();
      expect(store.skills.getBoundDetail('ghost-rev', 'ghost-prof')).toBeUndefined();
    });
  });
});
