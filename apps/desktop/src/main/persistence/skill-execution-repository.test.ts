import type { VerifiedExecutionOutput } from '@betterwork/agent-protocol';
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

interface SkillFixture {
  skillId: string;
  revisionId: string;
  profileId: string;
  profileHash: string;
  grantId: string;
  runId: string;
  bindingId: string;
}

/**
 * Build the full cross-table chain:
 * workspace -> task -> session -> run -> skill -> revision -> profile -> grant -> binding
 */
const seedFixture = (store: AppStore, overrides: Partial<SkillFixture> = {}): SkillFixture => {
  const skillId = overrides.skillId ?? 'skill-exec';
  const revisionId = overrides.revisionId ?? 'revision-exec';
  const profileId = overrides.profileId ?? 'profile-exec';
  const profileHash = overrides.profileHash ?? 'profile-hash-exec';
  const grantId = overrides.grantId ?? 'grant-exec';
  const runId = overrides.runId ?? 'run-exec';
  const bindingId = overrides.bindingId ?? 'binding-exec';

  store.skills.save({
    id: skillId,
    name: 'Exec Skill',
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
    name: 'Exec Skill',
    description: '',
    sourceKind: 'user',
    currentRevisionId: revisionId,
    currentProfileRevisionId: profileId,
  });
  store.skills.setTrustPreference(skillId, 'trusted');
  const savedGrantId = store.skills.saveTrustGrant({
    id: grantId,
    skillId,
    revisionId,
    profileHash,
    dependencyFingerprint: `dep-${skillId}`,
    scopeHash: `scope-${skillId}`,
    source: 'user',
  });

  const workspace = store.workspaces.getOrCreate(`/work/${skillId}`, 'Exec Workspace');
  const task = store.tasks.create(workspace.id, 'Exec Task', 'Goal');
  store.runs.create({
    id: runId,
    taskId: task.task.id,
    sessionId: task.sessionId,
    prompt: 'exec run',
    status: 'running',
    createdAt: 1,
  });

  store.executions.createBinding({
    id: bindingId,
    runId,
    skillRevisionId: revisionId,
    profileRevisionId: profileId,
    dependencySnapshotIds: [],
    grantId: savedGrantId,
  });

  return {
    skillId,
    revisionId,
    profileId,
    profileHash,
    grantId: savedGrantId,
    runId,
    bindingId,
  };
};

const baseExecutionInput = (fixture: SkillFixture, executionId: string) => ({
  id: executionId,
  runId: fixture.runId,
  bindingId: fixture.bindingId,
  toolCallId: `tc-${executionId}`,
  commandId: 'python',
  argumentDigest: 'arg-digest',
  inputHashes: ['hash-a', 'hash-b'],
  workDirKey: 'workdir-key',
  attemptKey: 'attempt-key',
});

describe('SkillExecutionRepository createBinding and getBinding', () => {
  it('round-trips a binding with all fields', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    const binding = store.executions.getBinding(fixture.bindingId);
    expect(binding).toBeDefined();
    expect(binding?.id).toBe(fixture.bindingId);
    expect(binding?.runId).toBe(fixture.runId);
    expect(binding?.skillRevisionId).toBe(fixture.revisionId);
    expect(binding?.profileRevisionId).toBe(fixture.profileId);
    expect(binding?.dependencySnapshotIds).toEqual([]);
    expect(binding?.grantId).toBe(fixture.grantId);
    expect(typeof binding?.createdAt).toBe('number');
  });

  it('returns undefined for a missing binding', () => {
    const store = openStore();
    expect(store.executions.getBinding('nonexistent')).toBeUndefined();
  });

  it('preserves dependencySnapshotIds in the binding', () => {
    const store = openStore();
    const fixture = seedFixture(store, { bindingId: 'binding-with-snaps' });
    const workspace = store.workspaces.getOrCreate('/work/snaps-binding', 'Snaps Workspace');
    const task = store.tasks.create(workspace.id, 'Snaps Task', 'Goal');
    store.runs.create({
      id: 'run-snaps',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: 'snaps run',
      status: 'running',
      createdAt: 1,
    });
    const binding = store.executions.createBinding({
      id: 'binding-snaps',
      runId: 'run-snaps',
      skillRevisionId: fixture.revisionId,
      profileRevisionId: fixture.profileId,
      dependencySnapshotIds: ['snap-1', 'snap-2'],
      grantId: fixture.grantId,
    });
    expect(binding.dependencySnapshotIds).toEqual(['snap-1', 'snap-2']);
    void fixture;
  });

  it('omits environmentId when not provided', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    const binding = store.executions.getBinding(fixture.bindingId);
    expect(binding).toBeDefined();
    expect(binding?.environmentId).toBeUndefined();
  });
});

describe('SkillExecutionRepository listBindingsByRun', () => {
  it('lists bindings for a run in creation order', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    const bindings = store.executions.listBindingsByRun(fixture.runId);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.id).toBe(fixture.bindingId);
  });

  it('returns empty for a run with no bindings', () => {
    const store = openStore();
    expect(store.executions.listBindingsByRun('nonexistent-run')).toEqual([]);
  });
});

describe('SkillExecutionRepository listBindingSummariesForRun', () => {
  it('returns skill id and name for bindings of a run', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    const summaries = store.executions.listBindingSummariesForRun(fixture.runId);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({
      skillId: fixture.skillId,
      skillName: 'Exec Skill',
    });
  });

  it('returns empty for a run with no bindings', () => {
    const store = openStore();
    expect(store.executions.listBindingSummariesForRun('nonexistent')).toEqual([]);
  });
});

describe('SkillExecutionRepository createExecution and getExecution', () => {
  it('creates an execution in queued status with empty output IDs', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    const execution = store.executions.createExecution(baseExecutionInput(fixture, 'exec-1'));
    expect(execution.id).toBe('exec-1');
    expect(execution.status).toBe('queued');
    expect(execution.outputIds).toEqual([]);
    expect(execution.inputHashes).toEqual(['hash-a', 'hash-b']);
    expect(execution.runId).toBe(fixture.runId);
    expect(execution.bindingId).toBe(fixture.bindingId);
    expect(execution.toolCallId).toBe('tc-exec-1');
    expect(execution.commandId).toBe('python');
    expect(execution.workDirKey).toBe('workdir-key');
    expect(execution.attemptKey).toBe('attempt-key');
    expect(execution.startedAt).toBeUndefined();
    expect(execution.finishedAt).toBeUndefined();
    expect(execution.reason).toBeUndefined();
    expect(execution.reportHash).toBeUndefined();
    expect(typeof execution.createdAt).toBe('number');
  });

  it('returns undefined for a missing execution', () => {
    const store = openStore();
    expect(store.executions.getExecution('nonexistent')).toBeUndefined();
  });
});

describe('SkillExecutionRepository execution state machine', () => {
  it('transitions from queued to running via markRunning', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-run'));
    expect(store.executions.markRunning('exec-run', 100)).toBe(true);
    const execution = store.executions.getExecution('exec-run');
    expect(execution?.status).toBe('running');
    expect(execution?.startedAt).toBe(100);
  });

  it('markRunning returns false for an already running execution', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-double'));
    store.executions.markRunning('exec-double', 100);
    expect(store.executions.markRunning('exec-double', 200)).toBe(false);
  });

  it('markRunning returns false for a nonexistent execution', () => {
    const store = openStore();
    expect(store.executions.markRunning('nonexistent', 100)).toBe(false);
  });

  it('transitions from running to succeeded via finishExecution', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-finish'));
    store.executions.markRunning('exec-finish', 100);
    const finished = store.executions.finishExecution('exec-finish', 'succeeded', {
      finishedAt: 200,
      reportHash: 'report-hash',
      outputIds: ['output-1'],
    });
    expect(finished).toBe(true);
    const execution = store.executions.getExecution('exec-finish');
    expect(execution?.status).toBe('succeeded');
    expect(execution?.finishedAt).toBe(200);
    expect(execution?.reportHash).toBe('report-hash');
    expect(execution?.outputIds).toEqual(['output-1']);
  });

  it('transitions from queued directly to a terminal status', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-queued-fail'));
    const finished = store.executions.finishExecution('exec-queued-fail', 'cancelled', {
      reason: 'cancelled-by-user',
      finishedAt: 150,
    });
    expect(finished).toBe(true);
    const execution = store.executions.getExecution('exec-queued-fail');
    expect(execution?.status).toBe('cancelled');
    expect(execution?.reason).toBe('cancelled-by-user');
  });

  it('finishExecution returns false for an already-terminal execution (idempotent)', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-idem'));
    store.executions.markRunning('exec-idem', 100);
    store.executions.finishExecution('exec-idem', 'succeeded', { finishedAt: 200 });
    const second = store.executions.finishExecution('exec-idem', 'failed', {
      reason: 'execute-failed',
      finishedAt: 300,
    });
    expect(second).toBe(false);
    const execution = store.executions.getExecution('exec-idem');
    expect(execution?.status).toBe('succeeded');
  });

  it('finishExecution throws for a non-terminal status', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-invalid'));
    expect(() =>
      store.executions.finishExecution('exec-invalid', 'running', { finishedAt: 200 }),
    ).toThrow('terminal status');
    expect(() =>
      store.executions.finishExecution('exec-invalid', 'queued', { finishedAt: 200 }),
    ).toThrow('terminal status');
  });

  it.each([
    { status: 'succeeded' as const, label: 'succeeded' },
    { status: 'failed' as const, label: 'failed' },
    { status: 'cancelled' as const, label: 'cancelled' },
    { status: 'timed-out' as const, label: 'timed-out' },
  ])('finishExecution accepts terminal status $label', ({ status }) => {
    const store = openStore();
    const fixture = seedFixture(store);
    const execId = `exec-terminal-${status}`;
    store.executions.createExecution(baseExecutionInput(fixture, execId));
    store.executions.markRunning(execId, 100);
    const result = store.executions.finishExecution(execId, status, {
      ...(status === 'failed' ? { reason: 'execute-failed' as const } : {}),
      ...(status === 'timed-out' ? { reason: 'timed-out' as const } : {}),
      ...(status === 'cancelled' ? { reason: 'cancelled-by-user' as const } : {}),
      finishedAt: 200,
    });
    expect(result).toBe(true);
    expect(store.executions.getExecution(execId)?.status).toBe(status);
  });
});

describe('SkillExecutionRepository listExecutionsByRun and listOpenExecutions', () => {
  it('lists executions for a run in creation order', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-list-1'));
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-list-2'));
    const listed = store.executions.listExecutionsByRun(fixture.runId);
    expect(listed).toHaveLength(2);
    const ids = listed.map((execution) => execution.id);
    expect(ids).toContain('exec-list-1');
    expect(ids).toContain('exec-list-2');
    for (let i = 1; i < listed.length; i++) {
      expect(listed[i - 1]!.createdAt).toBeGreaterThanOrEqual(listed[i]!.createdAt);
    }
  });

  it('returns empty for a run with no executions', () => {
    const store = openStore();
    expect(store.executions.listExecutionsByRun('nonexistent')).toEqual([]);
  });

  it('listOpenExecutions returns only queued and running executions', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-open-1'));
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-open-2'));
    store.executions.markRunning('exec-open-2', 100);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-open-3'));
    store.executions.finishExecution('exec-open-3', 'succeeded', { finishedAt: 200 });

    const open = store.executions.listOpenExecutions();
    const ids = open.map((execution) => execution.id);
    expect(ids).toContain('exec-open-1');
    expect(ids).toContain('exec-open-2');
    expect(ids).not.toContain('exec-open-3');
  });

  it('listOpenExecutions returns empty when all executions are terminal', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-all-done'));
    store.executions.finishExecution('exec-all-done', 'failed', {
      reason: 'spawn-failed',
      finishedAt: 100,
    });
    expect(store.executions.listOpenExecutions()).toEqual([]);
  });
});

describe('SkillExecutionRepository findActiveGrant', () => {
  it('finds an active grant matching skill, revision, profile hash', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    const grant = store.executions.findActiveGrant(
      fixture.skillId,
      fixture.revisionId,
      fixture.profileHash,
    );
    expect(grant).toBeDefined();
    expect(grant?.id).toBe(fixture.grantId);
  });

  it('returns undefined when no grant matches', () => {
    const store = openStore();
    expect(store.executions.findActiveGrant('no-skill', 'no-revision', 'no-hash')).toBeUndefined();
  });

  it('returns undefined when the grant has been revoked', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    const db = (
      store as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
      }
    ).db;
    db.prepare('UPDATE skill_trust_grants SET revoked_at = ? WHERE id = ?').run(
      Date.now(),
      fixture.grantId,
    );
    expect(
      store.executions.findActiveGrant(fixture.skillId, fixture.revisionId, fixture.profileHash),
    ).toBeUndefined();
  });

  it('filters by dependencyFingerprint when provided', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    const matching = store.executions.findActiveGrant(
      fixture.skillId,
      fixture.revisionId,
      fixture.profileHash,
      `dep-${fixture.skillId}`,
    );
    expect(matching).toBeDefined();

    const nonMatching = store.executions.findActiveGrant(
      fixture.skillId,
      fixture.revisionId,
      fixture.profileHash,
      'different-fingerprint',
    );
    expect(nonMatching).toBeUndefined();
  });
});

describe('SkillExecutionRepository isBindingAuthorized', () => {
  it('returns true when skill is enabled, trusted, and grant is active', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    expect(store.executions.isBindingAuthorized(fixture.bindingId)).toBe(true);
  });

  it('returns false when the skill is disabled', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.skills.setEnabled(fixture.skillId, false);
    expect(store.executions.isBindingAuthorized(fixture.bindingId)).toBe(false);
  });

  it('returns false when trust preference is not trusted', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.skills.setTrustPreference(fixture.skillId, 'untrusted');
    expect(store.executions.isBindingAuthorized(fixture.bindingId)).toBe(false);
  });

  it('returns false when the grant has been revoked', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    const db = (
      store as unknown as {
        db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } };
      }
    ).db;
    db.prepare('UPDATE skill_trust_grants SET revoked_at = ? WHERE id = ?').run(
      Date.now(),
      fixture.grantId,
    );
    expect(store.executions.isBindingAuthorized(fixture.bindingId)).toBe(false);
  });

  it('returns false for a nonexistent binding', () => {
    const store = openStore();
    expect(store.executions.isBindingAuthorized('nonexistent')).toBe(false);
  });
});

describe('SkillExecutionRepository verified outputs', () => {
  it('saves and retrieves verified outputs for a running execution', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-verified'));
    store.executions.markRunning('exec-verified', 100);

    const outputs: VerifiedExecutionOutput[] = [
      {
        outputId: 'out-1',
        relativePath: 'report.md',
        fileHash: 'a'.repeat(64),
        fileSize: 1024,
        reportHash: 'b'.repeat(64),
        validation: { structure: 'passed', visual: 'passed', manualEdit: 'passed' },
      },
    ];
    store.executions.saveVerifiedOutputs('exec-verified', outputs);
    const retrieved = store.executions.getVerifiedOutputs('exec-verified');
    expect(retrieved).toEqual(outputs);
  });

  it('returns empty array for a nonexistent execution', () => {
    const store = openStore();
    expect(store.executions.getVerifiedOutputs('nonexistent')).toEqual([]);
  });

  it('does not save verified outputs for a terminal execution', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-terminal-verify'));
    store.executions.finishExecution('exec-terminal-verify', 'succeeded', { finishedAt: 200 });

    const outputs: VerifiedExecutionOutput[] = [
      {
        outputId: 'out-late',
        relativePath: 'late.md',
        fileHash: 'b'.repeat(64),
        fileSize: 512,
      },
    ];
    store.executions.saveVerifiedOutputs('exec-terminal-verify', outputs);
    expect(store.executions.getVerifiedOutputs('exec-terminal-verify')).toEqual([]);
  });
});

describe('SkillExecutionRepository failInterruptedExecutions', () => {
  it('marks all open executions as failed with interrupted reason', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-int-1'));
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-int-2'));
    store.executions.markRunning('exec-int-2', 100);

    const count = store.executions.failInterruptedExecutions(500);
    expect(count).toBe(2);

    const first = store.executions.getExecution('exec-int-1');
    expect(first?.status).toBe('failed');
    expect(first?.reason).toBe('interrupted');
    expect(first?.finishedAt).toBe(500);

    const second = store.executions.getExecution('exec-int-2');
    expect(second?.status).toBe('failed');
    expect(second?.reason).toBe('interrupted');
    expect(second?.finishedAt).toBe(500);
  });

  it('does not affect already-terminal executions', () => {
    const store = openStore();
    const fixture = seedFixture(store);
    store.executions.createExecution(baseExecutionInput(fixture, 'exec-done'));
    store.executions.finishExecution('exec-done', 'succeeded', { finishedAt: 100 });

    const count = store.executions.failInterruptedExecutions(500);
    expect(count).toBe(0);
    expect(store.executions.getExecution('exec-done')?.status).toBe('succeeded');
  });

  it('returns 0 when there are no open executions', () => {
    const store = openStore();
    expect(store.executions.failInterruptedExecutions(500)).toBe(0);
  });
});
