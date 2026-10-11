import type { DependencySnapshotExclusion } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import type { AppStore } from './index';
import { AppStore as AppStoreClass } from './index';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStoreClass.open(':memory:');
  stores.push(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

const baseExclusions = (): DependencySnapshotExclusion[] => [
  { path: 'node_modules/.cache', reason: 'transient build cache' },
];

const baseInput = (
  overrides: Partial<Parameters<AppStore['snapshots']['createSnapshot']>[0]> = {},
) => ({
  origin: '/projects/demo',
  originState: 'clean' as const,
  manifestHash: 'manifest-abc',
  pathKey: 'snapshots/demo/abc',
  fileCount: 42,
  totalBytes: 1024,
  exclusions: baseExclusions(),
  ...overrides,
});

describe('DependencySnapshotRepository createSnapshot and getSnapshot', () => {
  it('round-trips a snapshot with all fields', () => {
    const store = openStore();
    const snapshot = store.snapshots.createSnapshot(baseInput());
    expect(snapshot.origin).toBe('/projects/demo');
    expect(snapshot.originState).toBe('clean');
    expect(snapshot.manifestHash).toBe('manifest-abc');
    expect(snapshot.pathKey).toBe('snapshots/demo/abc');
    expect(snapshot.fileCount).toBe(42);
    expect(snapshot.totalBytes).toBe(1024);
    expect(snapshot.exclusions).toEqual(baseExclusions());
    expect(snapshot.originCommit).toBeUndefined();
    expect(snapshot.verifiedAt).toBeUndefined();
    expect(typeof snapshot.id).toBe('string');
    expect(typeof snapshot.createdAt).toBe('number');
  });

  it('preserves originCommit when provided', () => {
    const store = openStore();
    const snapshot = store.snapshots.createSnapshot(baseInput({ originCommit: 'abc123' }));
    expect(snapshot.originCommit).toBe('abc123');
  });

  it('uses a caller-supplied id when provided', () => {
    const store = openStore();
    const snapshot = store.snapshots.createSnapshot(baseInput({ id: 'my-snapshot' }));
    expect(snapshot.id).toBe('my-snapshot');
  });

  it('returns undefined for a missing snapshot id', () => {
    const store = openStore();
    expect(store.snapshots.getSnapshot('nonexistent')).toBeUndefined();
  });

  it('stores dirty origin state', () => {
    const store = openStore();
    const snapshot = store.snapshots.createSnapshot(
      baseInput({ originState: 'dirty', manifestHash: 'dirty-hash' }),
    );
    expect(snapshot.originState).toBe('dirty');
  });

  it('stores unknown origin state', () => {
    const store = openStore();
    const snapshot = store.snapshots.createSnapshot(
      baseInput({ originState: 'unknown', manifestHash: 'unknown-hash' }),
    );
    expect(snapshot.originState).toBe('unknown');
  });
});

describe('DependencySnapshotRepository exclusions JSON handling', () => {
  it('stores and retrieves an empty exclusions array', () => {
    const store = openStore();
    const snapshot = store.snapshots.createSnapshot(
      baseInput({ exclusions: [], manifestHash: 'empty-excl' }),
    );
    expect(snapshot.exclusions).toEqual([]);
  });

  it('stores and retrieves multiple exclusions', () => {
    const store = openStore();
    const exclusions: DependencySnapshotExclusion[] = [
      { path: 'dist', reason: 'build output' },
      { path: '.git', reason: 'version control' },
      { path: 'node_modules/.cache', reason: 'transient cache' },
    ];
    const snapshot = store.snapshots.createSnapshot(
      baseInput({ exclusions, manifestHash: 'multi-excl' }),
    );
    expect(snapshot.exclusions).toEqual(exclusions);
  });
});

describe('DependencySnapshotRepository findByManifestHash', () => {
  it('finds a snapshot by its manifest hash', () => {
    const store = openStore();
    const created = store.snapshots.createSnapshot(baseInput({ manifestHash: 'unique-hash' }));
    const found = store.snapshots.findByManifestHash('unique-hash');
    expect(found).toBeDefined();
    expect(found?.id).toBe(created.id);
  });

  it('returns undefined when no snapshot matches the hash', () => {
    const store = openStore();
    expect(store.snapshots.findByManifestHash('nonexistent')).toBeUndefined();
  });
});

describe('DependencySnapshotRepository listSnapshots', () => {
  it('returns all snapshots ordered by created_at descending', () => {
    const store = openStore();
    store.snapshots.createSnapshot(baseInput({ id: 'snap-1', manifestHash: 'hash-1' }));
    store.snapshots.createSnapshot(baseInput({ id: 'snap-2', manifestHash: 'hash-2' }));
    store.snapshots.createSnapshot(baseInput({ id: 'snap-3', manifestHash: 'hash-3' }));
    const all = store.snapshots.listSnapshots();
    expect(all).toHaveLength(3);
    const ids = all.map((snapshot) => snapshot.id);
    expect(ids).toContain('snap-1');
    expect(ids).toContain('snap-2');
    expect(ids).toContain('snap-3');
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1]!.createdAt).toBeGreaterThanOrEqual(all[i]!.createdAt);
    }
  });

  it('returns an empty array when no snapshots exist', () => {
    const store = openStore();
    expect(store.snapshots.listSnapshots()).toEqual([]);
  });
});

describe('DependencySnapshotRepository deleteSnapshot', () => {
  it('deletes an existing snapshot and returns true', () => {
    const store = openStore();
    const snapshot = store.snapshots.createSnapshot(baseInput({ id: 'to-delete' }));
    expect(store.snapshots.deleteSnapshot(snapshot.id)).toBe(true);
    expect(store.snapshots.getSnapshot(snapshot.id)).toBeUndefined();
  });

  it('returns false when deleting a nonexistent snapshot', () => {
    const store = openStore();
    expect(store.snapshots.deleteSnapshot('nonexistent')).toBe(false);
  });
});

describe('DependencySnapshotRepository markVerified', () => {
  it('records a verification timestamp', () => {
    const store = openStore();
    store.snapshots.createSnapshot(baseInput({ id: 'verify-me' }));
    expect(store.snapshots.markVerified('verify-me', 5000)).toBe(true);
    const updated = store.snapshots.getSnapshot('verify-me');
    expect(updated?.verifiedAt).toBe(5000);
  });

  it('returns false for a nonexistent snapshot', () => {
    const store = openStore();
    expect(store.snapshots.markVerified('nonexistent', 5000)).toBe(false);
  });
});

/**
 * Set up the cross-table fixture for usage tests:
 * skill -> revision -> profile -> trust grant -> selection -> binding -> execution
 */
const seedSkillFixture = (
  store: AppStore,
  options: {
    skillId?: string;
    revisionId?: string;
    profileId?: string;
    grantId?: string;
    profileHash?: string;
    dependencyFingerprint?: string;
    snapshotIds?: string[];
    bindingId?: string;
    runId?: string;
  } = {},
): {
  skillId: string;
  revisionId: string;
  profileId: string;
  grantId: string;
  profileHash: string;
} => {
  const skillId = options.skillId ?? 'skill-usage';
  const revisionId = options.revisionId ?? 'revision-usage';
  const profileId = options.profileId ?? 'profile-usage';
  const profileHash = options.profileHash ?? 'profile-hash-usage';
  const dependencyFingerprint = options.dependencyFingerprint ?? 'dep-fingerprint';
  const grantId = options.grantId ?? 'grant-usage';
  const snapshotIds = options.snapshotIds ?? [];
  const runId = options.runId ?? 'run-usage';
  const bindingId = options.bindingId ?? 'binding-usage';

  store.skills.save({
    id: skillId,
    name: 'Usage Skill',
    description: '',
    sourceKind: 'user',
    currentRevisionId: revisionId,
  });
  store.skills.saveRevision({
    id: revisionId,
    skillId,
    contentHash: `content-${skillId}`,
    resourceKey: `user/${skillId}/content`,
    frontmatter: {},
  });
  store.skills.saveProfile({
    id: profileId,
    skillId,
    profileHash,
    profile: { commands: [], environmentRequirements: [], outputContract: { outputPaths: [] } },
  });
  store.skills.save({
    id: skillId,
    name: 'Usage Skill',
    description: '',
    sourceKind: 'user',
    currentRevisionId: revisionId,
    currentProfileRevisionId: profileId,
  });
  const savedGrantId = store.skills.saveTrustGrant({
    id: grantId,
    skillId,
    revisionId,
    profileHash,
    dependencyFingerprint,
    scopeHash: `scope-${skillId}`,
    source: 'user',
  });
  if (snapshotIds.length > 0) {
    store.skills.saveDependencySelection(savedGrantId, `lock-${skillId}`, snapshotIds);
  }

  const workspace = store.workspaces.getOrCreate(`/work/${skillId}`, 'Usage Workspace');
  const task = store.tasks.create(workspace.id, 'Usage Task', 'Goal');
  store.runs.create({
    id: runId,
    taskId: task.task.id,
    sessionId: task.sessionId,
    prompt: 'usage run',
    status: 'completed',
    createdAt: 1,
    completedAt: 2,
  });
  store.executions.createBinding({
    id: bindingId,
    runId,
    skillRevisionId: revisionId,
    profileRevisionId: profileId,
    dependencySnapshotIds: snapshotIds,
    grantId: savedGrantId,
  });

  return { skillId, revisionId, profileId, grantId: savedGrantId, profileHash };
};

describe('DependencySnapshotRepository listSnapshotsWithUsage and canDelete', () => {
  it('returns canDelete=true when no skills reference the snapshot', () => {
    const store = openStore();
    store.snapshots.createSnapshot(baseInput({ id: 'orphan-snap', manifestHash: 'orphan' }));
    const withUsage = store.snapshots.listSnapshotsWithUsage();
    expect(withUsage).toHaveLength(1);
    expect(withUsage[0]?.canDelete).toBe(true);
    expect(withUsage[0]?.usage).toEqual([]);
  });

  it('reports active authorization usage from skill_dependency_selections', () => {
    const store = openStore();
    store.snapshots.createSnapshot(baseInput({ id: 'auth-snap', manifestHash: 'auth-hash' }));
    seedSkillFixture(store, { snapshotIds: ['auth-snap'] });

    const withUsage = store.snapshots.listSnapshotsWithUsage();
    const snapshot = withUsage.find((entry) => entry.id === 'auth-snap');
    expect(snapshot).toBeDefined();
    expect(snapshot?.canDelete).toBe(false);
    expect(snapshot?.usage).toHaveLength(1);
    expect(snapshot?.usage[0]).toMatchObject({
      skillId: 'skill-usage',
      skillName: 'Usage Skill',
      activeAuthorizationCount: 1,
    });
    expect(snapshot?.usage[0]?.runCount).toBeGreaterThanOrEqual(0);
  });

  it('reports run usage from run_skill_bindings', () => {
    const store = openStore();
    store.snapshots.createSnapshot(baseInput({ id: 'run-snap', manifestHash: 'run-hash' }));
    seedSkillFixture(store, { snapshotIds: ['run-snap'] });

    const withUsage = store.snapshots.listSnapshotsWithUsage();
    const snapshot = withUsage.find((entry) => entry.id === 'run-snap');
    expect(snapshot).toBeDefined();
    const usageEntry = snapshot?.usage.find((entry) => entry.skillId === 'skill-usage');
    expect(usageEntry).toBeDefined();
    expect(usageEntry?.runCount).toBe(1);
  });

  it('canDelete is false when active authorization exists', () => {
    const store = openStore();
    store.snapshots.createSnapshot(baseInput({ id: 'active-snap', manifestHash: 'active-hash' }));
    seedSkillFixture(store, { snapshotIds: ['active-snap'] });

    const withUsage = store.snapshots.listSnapshotsWithUsage();
    const snapshot = withUsage.find((entry) => entry.id === 'active-snap');
    expect(snapshot?.canDelete).toBe(false);
  });

  it('canDelete is false when run count is greater than zero', () => {
    const store = openStore();
    store.snapshots.createSnapshot(baseInput({ id: 'run-only-snap', manifestHash: 'run-only' }));
    seedSkillFixture(store, { snapshotIds: ['run-only-snap'] });

    const withUsage = store.snapshots.listSnapshotsWithUsage();
    const snapshot = withUsage.find((entry) => entry.id === 'run-only-snap');
    expect(snapshot?.canDelete).toBe(false);
  });
});

describe('DependencySnapshotRepository getSnapshotWithUsage', () => {
  it('returns undefined for a missing snapshot', () => {
    const store = openStore();
    expect(store.snapshots.getSnapshotWithUsage('nonexistent')).toBeUndefined();
  });

  it('returns canDelete=true with empty usage for an unreferenced snapshot', () => {
    const store = openStore();
    store.snapshots.createSnapshot(baseInput({ id: 'lone-snap', manifestHash: 'lone' }));
    const result = store.snapshots.getSnapshotWithUsage('lone-snap');
    expect(result).toBeDefined();
    expect(result?.canDelete).toBe(true);
    expect(result?.usage).toEqual([]);
  });

  it('aggregates usage across authorization and run tables for a single snapshot', () => {
    const store = openStore();
    store.snapshots.createSnapshot(baseInput({ id: 'cross-snap', manifestHash: 'cross' }));
    seedSkillFixture(store, {
      skillId: 'skill-cross',
      revisionId: 'revision-cross',
      profileId: 'profile-cross',
      grantId: 'grant-cross',
      profileHash: 'hash-cross',
      dependencyFingerprint: 'dep-cross',
      bindingId: 'binding-cross',
      runId: 'run-cross',
      snapshotIds: ['cross-snap'],
    });

    const result = store.snapshots.getSnapshotWithUsage('cross-snap');
    expect(result).toBeDefined();
    expect(result?.canDelete).toBe(false);
    expect(result?.usage.length).toBeGreaterThanOrEqual(1);
    const usageEntry = result?.usage.find((entry) => entry.skillId === 'skill-cross');
    expect(usageEntry).toBeDefined();
    expect(usageEntry?.activeAuthorizationCount).toBeGreaterThanOrEqual(1);
    expect(usageEntry?.runCount).toBeGreaterThanOrEqual(1);
  });
});
