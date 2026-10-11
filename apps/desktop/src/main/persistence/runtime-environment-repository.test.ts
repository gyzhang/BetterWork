import type {
  BaseInterpreter,
  DependencyLock,
  SkillEnvironmentStatus,
  TargetPlatform,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from './index';
import type { CreateEnvironmentInput } from './runtime-environment-repository';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
});

const PLATFORM: TargetPlatform = { os: 'darwin', arch: 'arm64', abi: 'macos-15' };

const BASE: BaseInterpreter = {
  kind: 'managed',
  distributionId: 'cpython',
  version: '3.12.7',
  sha256: 'a'.repeat(64),
};

const LOCK: DependencyLock = {
  lockVersion: 1,
  platform: PLATFORM,
  pythonRequirement: '3.12',
  packages: [
    {
      name: 'example',
      version: '1.0.0',
      wheel: 'example-1.0.0-py3-none-any.whl',
      sha256: 'b'.repeat(64),
      source: 'wheelhouse',
    },
  ],
  importProbes: ['example'],
};

const baseInput = (overrides: Partial<CreateEnvironmentInput> = {}): CreateEnvironmentInput => ({
  environmentKey: 'env-key-1',
  base: BASE,
  platform: PLATFORM,
  lockHash: 'lock-hash-abc',
  lock: LOCK,
  pathKey: 'path/key/1',
  ...overrides,
});

describe('RuntimeEnvironmentRepository creates and retrieves environments', () => {
  it('creates an environment and reads it back with all fields', () => {
    const store = openStore();
    const created = store.environments.createEnvironment(baseInput());
    expect(created.id).toBeDefined();
    expect(created.environmentKey).toBe('env-key-1');
    expect(created.base).toEqual(BASE);
    expect(created.platform).toEqual(PLATFORM);
    expect(created.lockHash).toBe('lock-hash-abc');
    expect(created.lock).toEqual(LOCK);
    expect(created.pathKey).toBe('path/key/1');
    expect(created.status).toBe('unprepared');
    expect(created.failureCode).toBeUndefined();
    expect(created.failureSummary).toBeUndefined();
    expect(created.readyAt).toBeUndefined();
    expect(typeof created.createdAt).toBe('number');
    expect(typeof created.updatedAt).toBe('number');
  });

  it('creates with a caller-provided id', () => {
    const store = openStore();
    const created = store.environments.createEnvironment(baseInput({ id: 'custom-id' }));
    expect(created.id).toBe('custom-id');
    expect(store.environments.getEnvironment('custom-id')).toBeDefined();
  });

  it('returns undefined for a missing environment id', () => {
    const store = openStore();
    expect(store.environments.getEnvironment('nonexistent')).toBeUndefined();
  });

  it('finds an environment by its unique key', () => {
    const store = openStore();
    store.environments.createEnvironment(baseInput({ environmentKey: 'unique-key' }));
    const found = store.environments.findByKey('unique-key');
    expect(found).toBeDefined();
    expect(found!.environmentKey).toBe('unique-key');
  });

  it('returns undefined from findByKey for a missing key', () => {
    const store = openStore();
    expect(store.environments.findByKey('missing')).toBeUndefined();
  });

  it('lists all environments ordered by created_at descending', () => {
    const store = openStore();
    store.environments.createEnvironment(baseInput({ environmentKey: 'env-a' }));
    store.environments.createEnvironment(baseInput({ environmentKey: 'env-b' }));
    const all = store.environments.listEnvironments();
    expect(all).toHaveLength(2);
    expect(all[0]!.createdAt).toBeGreaterThanOrEqual(all[1]!.createdAt);
  });
});

describe('RuntimeEnvironmentRepository.updateStatus applies conditional status transitions', () => {
  it('updates status without expected-status guard', () => {
    const store = openStore();
    const created = store.environments.createEnvironment(baseInput());
    const ok = store.environments.updateStatus(created.id, 'preparing');
    expect(ok).toBe(true);
    const loaded = store.environments.getEnvironment(created.id);
    expect(loaded!.status).toBe('preparing');
  });

  it('updates status with matching expected-status guard', () => {
    const store = openStore();
    const created = store.environments.createEnvironment(baseInput());
    const ok = store.environments.updateStatus(created.id, 'preparing', {
      expectedStatuses: ['unprepared'],
    });
    expect(ok).toBe(true);
    const loaded = store.environments.getEnvironment(created.id);
    expect(loaded!.status).toBe('preparing');
  });

  it('rejects status update when current status does not match expected', () => {
    const store = openStore();
    const created = store.environments.createEnvironment(baseInput());
    // Try to mark as ready with expected status 'preparing', but current is 'unprepared'
    const ok = store.environments.updateStatus(created.id, 'ready', {
      expectedStatuses: ['preparing'],
    });
    expect(ok).toBe(false);
    const loaded = store.environments.getEnvironment(created.id);
    expect(loaded!.status).toBe('unprepared');
  });

  it('supports multiple expected statuses in the guard', () => {
    const store = openStore();
    const created = store.environments.createEnvironment(baseInput());
    // Move to preparing first
    store.environments.updateStatus(created.id, 'preparing');
    // Now transition from preparing to ready
    const ok = store.environments.updateStatus(created.id, 'ready', {
      expectedStatuses: ['preparing', 'unprepared'],
      readyAt: Date.now(),
    });
    expect(ok).toBe(true);
    const loaded = store.environments.getEnvironment(created.id);
    expect(loaded!.status).toBe('ready');
    expect(loaded!.readyAt).toBeDefined();
  });

  it('returns false for updateStatus on a nonexistent id', () => {
    const store = openStore();
    const ok = store.environments.updateStatus('nonexistent', 'preparing');
    expect(ok).toBe(false);
  });

  it('writes failure code and summary when provided', () => {
    const store = openStore();
    const created = store.environments.createEnvironment(baseInput());
    store.environments.updateStatus(created.id, 'failed', {
      failureCode: 'timeout',
      failureSummary: 'Dependency download timed out',
    });
    const loaded = store.environments.getEnvironment(created.id);
    expect(loaded!.status).toBe('failed');
    expect(loaded!.failureCode).toBe('timeout');
    expect(loaded!.failureSummary).toBe('Dependency download timed out');
  });

  it.each(['preparing', 'ready', 'failed', 'invalid'] as SkillEnvironmentStatus[])(
    'transitions to %s status from unprepared without guard',
    (targetStatus) => {
      const store = openStore();
      const created = store.environments.createEnvironment(baseInput());
      const ok = store.environments.updateStatus(created.id, targetStatus);
      expect(ok).toBe(true);
      const loaded = store.environments.getEnvironment(created.id);
      expect(loaded!.status).toBe(targetStatus);
    },
  );
});

describe('RuntimeEnvironmentRepository.failInterruptedEnvironments recovers running environments', () => {
  it('marks all preparing environments as failed with interrupted code', () => {
    const store = openStore();
    const env1 = store.environments.createEnvironment(baseInput({ environmentKey: 'env-1' }));
    const env2 = store.environments.createEnvironment(baseInput({ environmentKey: 'env-2' }));
    const env3 = store.environments.createEnvironment(baseInput({ environmentKey: 'env-3' }));
    // Move env1 and env2 to preparing, leave env3 unprepared
    store.environments.updateStatus(env1.id, 'preparing');
    store.environments.updateStatus(env2.id, 'preparing');
    const recoveryTime = Date.now();
    const count = store.environments.failInterruptedEnvironments(
      'Process was killed during preparation',
      recoveryTime,
    );
    expect(count).toBe(2);
    const loaded1 = store.environments.getEnvironment(env1.id);
    const loaded2 = store.environments.getEnvironment(env2.id);
    const loaded3 = store.environments.getEnvironment(env3.id);
    expect(loaded1!.status).toBe('failed');
    expect(loaded1!.failureCode).toBe('interrupted');
    expect(loaded1!.failureSummary).toBe('Process was killed during preparation');
    expect(loaded2!.status).toBe('failed');
    expect(loaded2!.failureCode).toBe('interrupted');
    // env3 should be untouched
    expect(loaded3!.status).toBe('unprepared');
    expect(loaded3!.failureCode).toBeUndefined();
  });

  it('returns zero when no environments are in preparing state', () => {
    const store = openStore();
    store.environments.createEnvironment(baseInput());
    const count = store.environments.failInterruptedEnvironments('shutdown', Date.now());
    expect(count).toBe(0);
  });
});

describe('RuntimeEnvironmentRepository JSON columns survive round-trip with Zod validation', () => {
  it('preserves a managed base interpreter through create and read', () => {
    const store = openStore();
    const managed: BaseInterpreter = {
      kind: 'managed',
      distributionId: 'cpython',
      version: '3.11.5',
      sha256: 'b'.repeat(64),
    };
    const created = store.environments.createEnvironment(baseInput({ base: managed }));
    const loaded = store.environments.getEnvironment(created.id);
    expect(loaded!.base).toEqual(managed);
  });

  it('preserves a local base interpreter through create and read', () => {
    const store = openStore();
    const local: BaseInterpreter = { kind: 'local', path: '/usr/bin/python3', version: '3.12.0' };
    const created = store.environments.createEnvironment(baseInput({ base: local }));
    const loaded = store.environments.getEnvironment(created.id);
    expect(loaded!.base).toEqual(local);
  });

  it('preserves dependency lock with packages through round-trip', () => {
    const store = openStore();
    const lockWithPackages: DependencyLock = {
      lockVersion: 1,
      platform: PLATFORM,
      pythonRequirement: '3.12',
      packages: [
        {
          name: 'numpy',
          version: '1.26.0',
          wheel: 'numpy-1.26.0-cp312-cp312-macosx_11_0_arm64.whl',
          sha256: 'c'.repeat(64),
          source: 'wheelhouse',
        },
      ],
      importProbes: ['numpy'],
    };
    const created = store.environments.createEnvironment(
      baseInput({ lock: lockWithPackages, lockHash: 'hash-with-pkgs' }),
    );
    const loaded = store.environments.getEnvironment(created.id);
    expect(loaded!.lock).toEqual(lockWithPackages);
    expect(loaded!.lockHash).toBe('hash-with-pkgs');
  });
});

describe('RuntimeEnvironmentRepository auxiliary operations', () => {
  it('updatePathKey changes the path key and returns true for existing id', () => {
    const store = openStore();
    const created = store.environments.createEnvironment(baseInput({ pathKey: 'old/path' }));
    const ok = store.environments.updatePathKey(created.id, 'new/path');
    expect(ok).toBe(true);
    const loaded = store.environments.getEnvironment(created.id);
    expect(loaded!.pathKey).toBe('new/path');
  });

  it('updatePathKey returns false for nonexistent id', () => {
    const store = openStore();
    expect(store.environments.updatePathKey('nonexistent', 'path')).toBe(false);
  });

  it('markInvalid transitions to invalid with failure info', () => {
    const store = openStore();
    const created = store.environments.createEnvironment(baseInput());
    const ok = store.environments.markInvalid(created.id, 'health-check-failed', 'Probe failed');
    expect(ok).toBe(true);
    const loaded = store.environments.getEnvironment(created.id);
    expect(loaded!.status).toBe('invalid');
    expect(loaded!.failureCode).toBe('health-check-failed');
    expect(loaded!.failureSummary).toBe('Probe failed');
  });

  it('markInvalid returns false for nonexistent id', () => {
    const store = openStore();
    expect(store.environments.markInvalid('nonexistent', 'code', 'summary')).toBe(false);
  });
});
