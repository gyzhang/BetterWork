import type { DependencyOperationStatus } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type CreateOperationInput,
  isTerminalOperationStatus,
} from './dependency-operation-repository';
import { AppStore } from './index';

const stores: AppStore[] = [];
const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.restoreAllMocks();
});

/**
 * dependency_operations.environment_id 有 FK 指向 runtime_environments(id)，
 * 测试必须先创建环境记录才能插入作业。
 */
const createTestEnvironment = (
  store: AppStore,
  id: string,
  key: string,
): { environmentId: string; environmentKey: string } => {
  store.environments.createEnvironment({
    id,
    environmentKey: key,
    base: { kind: 'local', path: '/usr/bin/python3', version: '3.12' },
    platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
    lockHash: 'a'.repeat(64),
    lock: {
      lockVersion: 1,
      platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
      pythonRequirement: '3.12',
      packages: [],
      importProbes: [],
    },
    pathKey: `path-${key}`,
  });
  return { environmentId: id, environmentKey: key };
};

/**
 * 每个 store 只建一次默认环境，避免重复调用 baseInput 时触发 environment_key UNIQUE 约束。
 */
const defaultEnvCache = new WeakMap<AppStore, { environmentId: string; environmentKey: string }>();
const ensureDefaultEnv = (store: AppStore): { environmentId: string; environmentKey: string } => {
  const cached = defaultEnvCache.get(store);
  if (cached) return cached;
  const env = createTestEnvironment(store, 'env-1', 'env-key-1');
  defaultEnvCache.set(store, env);
  return env;
};

const baseInput = (
  store: AppStore,
  overrides: Partial<CreateOperationInput> = {},
): CreateOperationInput => {
  const env = ensureDefaultEnv(store);
  return { ...env, kind: 'prepare', ...overrides };
};

describe('DependencyOperationRepository creates operations in queued status', () => {
  it('round-trips a created operation with all identity fields', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(baseInput(store));
    expect(created.id).toBeTruthy();
    expect(created.environmentId).toBe('env-1');
    expect(created.environmentKey).toBe('env-key-1');
    expect(created.kind).toBe('prepare');
    expect(created.status).toBe('queued');
    expect(created.step).toBeUndefined();
    expect(created.message).toBeUndefined();
    expect(created.failureCode).toBeUndefined();
    expect(created.failureSummary).toBeUndefined();
    expect(created.startedAt).toBeUndefined();
    expect(created.finishedAt).toBeUndefined();
    expect(typeof created.createdAt).toBe('number');
  });

  it('accepts a caller-supplied id', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(
      baseInput(store, { id: 'op-custom' }),
    );
    expect(created.id).toBe('op-custom');
    expect(store.dependencyOperations.getOperation('op-custom')).toBeDefined();
  });

  it('generates a unique id when none is supplied', () => {
    const store = openStore();
    const a = store.dependencyOperations.createOperation(baseInput(store));
    const b = store.dependencyOperations.createOperation(baseInput(store));
    expect(a.id).not.toBe(b.id);
  });

  it('returns undefined for a missing operation id', () => {
    const store = openStore();
    expect(store.dependencyOperations.getOperation('nonexistent')).toBeUndefined();
  });

  it('supports repair kind', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(
      baseInput(store, { kind: 'repair' }),
    );
    expect(created.kind).toBe('repair');
  });
});

describe('DependencyOperationRepository lists operations by environment', () => {
  it('returns operations for the given environment in descending created_at order', () => {
    const store = openStore();
    const envA = createTestEnvironment(store, 'env-A', 'key-A');
    const envB = createTestEnvironment(store, 'env-B', 'key-B');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    store.dependencyOperations.createOperation({
      environmentId: envA.environmentId,
      environmentKey: envA.environmentKey,
      kind: 'prepare',
      id: 'op-1',
    });
    clock.mockReturnValue(2000);
    store.dependencyOperations.createOperation({
      environmentId: envA.environmentId,
      environmentKey: envA.environmentKey,
      kind: 'prepare',
      id: 'op-2',
    });
    clock.mockReturnValue(3000);
    store.dependencyOperations.createOperation({
      environmentId: envB.environmentId,
      environmentKey: envB.environmentKey,
      kind: 'prepare',
      id: 'op-3',
    });
    const listA = store.dependencyOperations.listOperationsByEnvironment('env-A');
    expect(listA).toHaveLength(2);
    expect(listA.map(({ id, createdAt }) => ({ id, createdAt }))).toEqual([
      { id: 'op-2', createdAt: 2000 },
      { id: 'op-1', createdAt: 1000 },
    ]);
  });

  it('returns an empty array for an environment with no operations', () => {
    const store = openStore();
    expect(store.dependencyOperations.listOperationsByEnvironment('env-none')).toEqual([]);
  });
});

describe('DependencyOperationRepository state machine: queued → running → terminal', () => {
  it('markRunning transitions queued to running with CAS semantics', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(baseInput(store));
    const claimed = store.dependencyOperations.markRunning(
      created.id,
      { step: 'resolve-interpreter', message: 'Starting' },
      1000,
    );
    expect(claimed).toBe(true);
    const loaded = store.dependencyOperations.getOperation(created.id);
    expect(loaded!.status).toBe('running');
    expect(loaded!.step).toBe('resolve-interpreter');
    expect(loaded!.message).toBe('Starting');
    expect(loaded!.startedAt).toBe(1000);
  });

  it('markRunning returns false when operation is not queued (CAS failure)', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(baseInput(store));
    store.dependencyOperations.markRunning(created.id, {}, 1000);
    const secondClaim = store.dependencyOperations.markRunning(created.id, {}, 2000);
    expect(secondClaim).toBe(false);
    const loaded = store.dependencyOperations.getOperation(created.id);
    expect(loaded!.startedAt).toBe(1000);
  });

  it('markRunning preserves the first started_at via COALESCE', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(baseInput(store));
    store.dependencyOperations.markRunning(created.id, {}, 500);
    store.dependencyOperations.markRunning(created.id, {}, 999);
    const loaded = store.dependencyOperations.getOperation(created.id);
    expect(loaded!.startedAt).toBe(500);
  });

  it('markRunning returns false for a nonexistent id', () => {
    const store = openStore();
    expect(store.dependencyOperations.markRunning('no-such-id', {}, 0)).toBe(false);
  });

  it.each<DependencyOperationStatus>(['succeeded', 'failed', 'cancelled', 'interrupted'])(
    'finishOperation transitions to %s with terminal fields',
    (terminalStatus) => {
      const store = openStore();
      const created = store.dependencyOperations.createOperation(baseInput(store));
      store.dependencyOperations.markRunning(created.id, {}, 1000);
      const finished = store.dependencyOperations.finishOperation(created.id, terminalStatus, {
        step: 'finalize',
        message: 'Done',
        finishedAt: 2000,
        ...(terminalStatus === 'failed'
          ? { failureCode: 'ERR_TIMEOUT', failureSummary: 'Timed out' }
          : {}),
      });
      expect(finished).toBe(true);
      const loaded = store.dependencyOperations.getOperation(created.id);
      expect(loaded!.status).toBe(terminalStatus);
      expect(loaded!.step).toBe('finalize');
      expect(loaded!.finishedAt).toBe(2000);
      if (terminalStatus === 'failed') {
        expect(loaded!.failureCode).toBe('ERR_TIMEOUT');
        expect(loaded!.failureSummary).toBe('Timed out');
      }
    },
  );

  it('finishOperation from queued directly (skipping running) succeeds', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(baseInput(store));
    const finished = store.dependencyOperations.finishOperation(created.id, 'cancelled', {
      finishedAt: 3000,
    });
    expect(finished).toBe(true);
    const loaded = store.dependencyOperations.getOperation(created.id);
    expect(loaded!.status).toBe('cancelled');
    expect(loaded!.startedAt).toBeUndefined();
  });

  it('finishOperation returns false when already terminal (CAS prevents double-finish)', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(baseInput(store));
    store.dependencyOperations.finishOperation(created.id, 'succeeded', { finishedAt: 1000 });
    const doubleFinish = store.dependencyOperations.finishOperation(created.id, 'failed', {
      failureCode: 'LATE',
      finishedAt: 2000,
    });
    expect(doubleFinish).toBe(false);
    const loaded = store.dependencyOperations.getOperation(created.id);
    expect(loaded!.status).toBe('succeeded');
    expect(loaded!.failureCode).toBeUndefined();
  });

  it('finishOperation throws when given a non-terminal status', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(baseInput(store));
    expect(() =>
      store.dependencyOperations.finishOperation(created.id, 'running', { finishedAt: 1000 }),
    ).toThrow('finishOperation requires a terminal status');
    expect(() =>
      store.dependencyOperations.finishOperation(created.id, 'queued', { finishedAt: 1000 }),
    ).toThrow('finishOperation requires a terminal status');
  });
});

describe('DependencyOperationRepository updateProgress', () => {
  it('updates step and message on a running operation', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(baseInput(store));
    store.dependencyOperations.markRunning(created.id, { step: 'resolve-interpreter' }, 1000);
    const updated = store.dependencyOperations.updateProgress(created.id, {
      step: 'install-packages',
      message: 'Installing deps',
    });
    expect(updated).toBe(true);
    const loaded = store.dependencyOperations.getOperation(created.id);
    expect(loaded!.step).toBe('install-packages');
    expect(loaded!.message).toBe('Installing deps');
  });

  it('updates progress on a queued operation', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(baseInput(store));
    const updated = store.dependencyOperations.updateProgress(created.id, {
      message: 'Waiting in queue',
    });
    expect(updated).toBe(true);
    const loaded = store.dependencyOperations.getOperation(created.id);
    expect(loaded!.message).toBe('Waiting in queue');
  });

  it('returns false for a terminal operation', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(baseInput(store));
    store.dependencyOperations.finishOperation(created.id, 'succeeded', { finishedAt: 1000 });
    expect(store.dependencyOperations.updateProgress(created.id, { message: 'too late' })).toBe(
      false,
    );
  });

  it('returns false for a nonexistent id', () => {
    const store = openStore();
    expect(store.dependencyOperations.updateProgress('no-such-id', { message: 'x' })).toBe(false);
  });

  it('COALESCE preserves existing step when patch step is undefined', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(baseInput(store));
    store.dependencyOperations.markRunning(created.id, { step: 'create-environment' }, 1000);
    store.dependencyOperations.updateProgress(created.id, { message: 'progress only' });
    const loaded = store.dependencyOperations.getOperation(created.id);
    expect(loaded!.step).toBe('create-environment');
    expect(loaded!.message).toBe('progress only');
  });
});

describe('DependencyOperationRepository findOpenOperation', () => {
  it('finds a queued operation by environment key', () => {
    const store = openStore();
    const env = createTestEnvironment(store, 'env-1', 'key-A');
    store.dependencyOperations.createOperation({
      ...env,
      kind: 'prepare',
      id: 'op-1',
    });
    const open = store.dependencyOperations.findOpenOperation('key-A');
    expect(open).toBeDefined();
    expect(open!.id).toBe('op-1');
    expect(open!.status).toBe('queued');
  });

  it('finds a running operation by environment key', () => {
    const store = openStore();
    const env = createTestEnvironment(store, 'env-1', 'key-A');
    const created = store.dependencyOperations.createOperation({
      ...env,
      kind: 'prepare',
      id: 'op-1',
    });
    store.dependencyOperations.markRunning(created.id, {}, 1000);
    const open = store.dependencyOperations.findOpenOperation('key-A');
    expect(open).toBeDefined();
    expect(open!.status).toBe('running');
  });

  it('returns undefined after the operation reaches a terminal status', () => {
    const store = openStore();
    const env = createTestEnvironment(store, 'env-1', 'key-A');
    const created = store.dependencyOperations.createOperation({
      ...env,
      kind: 'prepare',
    });
    store.dependencyOperations.finishOperation(created.id, 'succeeded', { finishedAt: 1000 });
    expect(store.dependencyOperations.findOpenOperation('key-A')).toBeUndefined();
  });

  it('returns undefined for an unknown environment key', () => {
    const store = openStore();
    expect(store.dependencyOperations.findOpenOperation('unknown-key')).toBeUndefined();
  });
});

describe('DependencyOperationRepository failInterruptedOperations (startup recovery)', () => {
  it('marks all queued and running operations as interrupted', () => {
    const store = openStore();
    const envQ = createTestEnvironment(store, 'env-q', 'k1');
    const envR = createTestEnvironment(store, 'env-r', 'k2');
    const envD = createTestEnvironment(store, 'env-d', 'k3');
    const queued = store.dependencyOperations.createOperation({
      ...envQ,
      kind: 'prepare',
      id: 'op-q',
    });
    const running = store.dependencyOperations.createOperation({
      ...envR,
      kind: 'prepare',
      id: 'op-r',
    });
    store.dependencyOperations.markRunning(running.id, {}, 500);
    const alreadyDone = store.dependencyOperations.createOperation({
      ...envD,
      kind: 'prepare',
      id: 'op-d',
    });
    store.dependencyOperations.finishOperation(alreadyDone.id, 'succeeded', { finishedAt: 800 });

    const count = store.dependencyOperations.failInterruptedOperations(9000);
    expect(count).toBe(2);

    const q = store.dependencyOperations.getOperation(queued.id);
    expect(q!.status).toBe('interrupted');
    expect(q!.failureCode).toBe('interrupted');
    expect(q!.finishedAt).toBe(9000);

    const r = store.dependencyOperations.getOperation(running.id);
    expect(r!.status).toBe('interrupted');
    expect(r!.failureCode).toBe('interrupted');

    const d = store.dependencyOperations.getOperation(alreadyDone.id);
    expect(d!.status).toBe('succeeded');
    expect(d!.finishedAt).toBe(800);
  });

  it('returns 0 when no operations are open', () => {
    const store = openStore();
    expect(store.dependencyOperations.failInterruptedOperations(9000)).toBe(0);
  });

  it('prevents further finishOperation on interrupted operations (CAS)', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(baseInput(store));
    store.dependencyOperations.failInterruptedOperations(1000);
    const lateFinish = store.dependencyOperations.finishOperation(created.id, 'succeeded', {
      finishedAt: 2000,
    });
    expect(lateFinish).toBe(false);
  });
});

describe('isTerminalOperationStatus helper', () => {
  it.each<[DependencyOperationStatus, boolean]>([
    ['queued', false],
    ['running', false],
    ['succeeded', true],
    ['failed', true],
    ['cancelled', true],
    ['interrupted', true],
  ])('returns %s for status %s', (status, expected) => {
    expect(isTerminalOperationStatus(status)).toBe(expected);
  });
});

describe('DependencyOperationRepository conditional start ensures single winner', () => {
  it('only one of two concurrent markRunning calls succeeds on the same operation', () => {
    const store = openStore();
    const created = store.dependencyOperations.createOperation(baseInput(store));
    const first = store.dependencyOperations.markRunning(created.id, { message: 'A' }, 100);
    const second = store.dependencyOperations.markRunning(created.id, { message: 'B' }, 200);
    expect(first).toBe(true);
    expect(second).toBe(false);
    const loaded = store.dependencyOperations.getOperation(created.id);
    expect(loaded!.message).toBe('A');
    expect(loaded!.startedAt).toBe(100);
  });
});
