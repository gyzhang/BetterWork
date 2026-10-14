// @vitest-environment jsdom

import type {
  DependencyOptions,
  DependencyPlan,
  RuntimeEnvironment,
  SkillDetail,
} from '@betterwork/agent-protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSkillDependencies } from './use-skill-dependencies';

vi.mock('../lib/skill-runtime-discovery', () => ({
  declaredToolchainRequirements: () => [],
}));

const skillOf = (id: string): SkillDetail => ({
  id,
  name: `技能 ${id}`,
  description: '描述',
  sourceKind: 'user',
  enabled: true,
  currentRevisionId: 'rev-1',
  trustStatus: 'trusted',
  environmentStatus: 'unprepared',
  blockedReasons: [],
  revision: {
    id: 'rev-1',
    skillId: id,
    contentHash: 'hash',
    resourceKey: `user/${id}/revisions/hash`,
    frontmatter: {},
    createdAt: 1,
  },
  runtimeProfile: {
    id: 'rp-1',
    skillId: id,
    profileHash: 'hash',
    profile: {
      commands: [],
      environmentRequirements: [],
      pythonRequirement: undefined,
      dependencyBundle: undefined,
      dependencyLockId: undefined,
      toolchainRequirements: [],
    },
    createdAt: 1,
  },
});

const optionsOf = (): DependencyOptions => ({
  distributions: [
    {
      id: 'dist-1',
      version: '3.12.0',
      platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
      license: 'PSF',
      installed: true,
    },
  ],
  lockIds: [],
  snapshots: [],
  environments: [],
});

const listOptions = vi.fn<() => Promise<DependencyOptions>>();
const inspectPlan = vi.fn<(input: never) => Promise<DependencyPlan>>();
const getOperation = vi.fn<(input: never) => Promise<unknown>>();
const refreshDependencyGrant = vi.fn<(input: never) => Promise<unknown>>();

const environmentOf = (): RuntimeEnvironment => {
  const platform = { os: 'darwin', arch: 'arm64', abi: 'cp312' } as const;
  return {
    id: 'env-1',
    environmentKey: 'env-key',
    base: { kind: 'local', path: '/python', version: '3.12' },
    platform,
    lockHash: 'hash',
    lock: { lockVersion: 1, platform, pythonRequirement: '3.12', packages: [], importProbes: [] },
    pathKey: 'environments/env-1',
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  };
};
const planOf = (): DependencyPlan => {
  const environment = environmentOf();
  return {
    environmentKey: environment.environmentKey,
    base: environment.base,
    platform: environment.platform,
    lockHash: environment.lockHash,
    lock: environment.lock,
    missingWheels: [],
    requiresDownload: false,
    environment,
  };
};

const install = (): void => {
  listOptions.mockResolvedValue(optionsOf());
  inspectPlan.mockResolvedValue(planOf());
  getOperation.mockResolvedValue(undefined);
  refreshDependencyGrant.mockResolvedValue({
    grantCreated: false,
    selectedSnapshotIds: [],
  });
  Object.defineProperty(window, 'betterwork', {
    configurable: true,
    value: {
      dependencies: {
        listOptions,
        inspectPlan,
        getOperation,
      },
      skills: {
        refreshDependencyGrant,
      },
    },
  });
};

const refreshSkills = vi.fn<() => void>();

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'betterwork');
  listOptions.mockReset();
  inspectPlan.mockReset();
  getOperation.mockReset();
  refreshDependencyGrant.mockReset();
  refreshSkills.mockReset();
  vi.restoreAllMocks();
});

describe('useSkillDependencies', () => {
  it('没有 skill 时不发起请求', async () => {
    install();

    renderHook(() => useSkillDependencies(undefined, refreshSkills));
    await act(async () => {
      await Promise.resolve();
    });

    expect(listOptions).not.toHaveBeenCalled();
  });

  it('有 skill 时加载依赖选项', async () => {
    install();
    const skill = skillOf('skill-1');

    const { result } = renderHook(() => useSkillDependencies(skill, refreshSkills));

    await waitFor(() => expect(result.current.options).toBeDefined());
    expect(listOptions).toHaveBeenCalled();
    expect(result.current.base).toBeDefined();
  });

  it('切换 skill 时清空上一个 skill 的状态', async () => {
    install();
    const skill1 = skillOf('skill-1');
    const skill2 = skillOf('skill-2');

    const { result, rerender } = renderHook(
      ({ skill }: { skill: SkillDetail }) => useSkillDependencies(skill, refreshSkills),
      { initialProps: { skill: skill1 } },
    );

    await waitFor(() => expect(result.current.options).toBeDefined());

    rerender({ skill: skill2 });
    await waitFor(() => expect(listOptions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.options).toBeDefined());

    expect(result.current.error).toBe('');
    expect(result.current.toast).toBe('');
  });

  it('dismissToast 清除 toast', async () => {
    install();
    const skill = skillOf('skill-1');

    const { result } = renderHook(() => useSkillDependencies(skill, refreshSkills));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.dismissToast());
    expect(result.current.toast).toBe('');
  });

  it('clearError 清除错误', async () => {
    install();
    const skill = skillOf('skill-1');

    const { result } = renderHook(() => useSkillDependencies(skill, refreshSkills));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.clearError());
    expect(result.current.error).toBe('');
  });

  it('selectManagedDistribution 切换基础选择', async () => {
    install();
    const skill = skillOf('skill-1');

    const { result } = renderHook(() => useSkillDependencies(skill, refreshSkills));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.selectManagedDistribution('dist-1'));
    expect(result.current.base).toEqual({ kind: 'managed', distributionId: 'dist-1' });
  });
});

describe('environment actions and current Skill isolation', () => {
  const readySkill = (): SkillDetail => {
    const skill = skillOf('skill-1');
    skill.runtimeProfile!.profile.dependencyLockId = 'lock-1';
    return skill;
  };
  const actions = () => {
    install();
    const api = {
      chooseInterpreter: vi.fn(async (): Promise<{ cancelled: boolean; path?: string }> => ({
        cancelled: false,
        path: '/chosen/python',
      })),
      verifyEnvironment: vi.fn(async () => environmentOf()),
      prepare: vi.fn(async () => ({
        operationId: 'op-1',
        environmentId: 'env-1',
        environmentKey: 'env-key',
        reused: false,
      })),
      cancel: vi.fn(async () => ({ applied: false, status: 'succeeded' })),
      deleteToolchainSnapshot: vi.fn(async (): Promise<{ status: string }> => ({
        status: 'not-found',
      })),
    };
    Object.assign(window.betterwork.dependencies, api);
    return api;
  };

  it.each(['selected', 'cancelled', 'no-path', 'failure'] as const)(
    'settles interpreter choice %s without a hidden failure',
    async (outcome) => {
      const api = actions();
      if (outcome === 'failure')
        api.chooseInterpreter.mockRejectedValue(new Error('picker rejected'));
      else
        api.chooseInterpreter.mockResolvedValue(
          outcome === 'no-path'
            ? { cancelled: false }
            : { cancelled: outcome === 'cancelled', path: '/chosen/python' },
        );
      const skill = readySkill();
      const { result } = renderHook(() => useSkillDependencies(skill, refreshSkills));
      await waitFor(() => expect(result.current.plan).toBeDefined());
      await act(async () => result.current.chooseLocalInterpreter());
      expect(result.current.base).toEqual(
        outcome === 'selected'
          ? { kind: 'local', path: '/chosen/python' }
          : { kind: 'managed', distributionId: 'dist-1' },
      );
      expect(result.current.error).toBe(outcome === 'failure' ? 'picker rejected' : '');
    },
  );

  it.each(['ready', 'invalid', 'failure'] as const)(
    'settles environment verification %s and stops checking',
    async (outcome) => {
      const api = actions();
      if (outcome === 'failure')
        api.verifyEnvironment.mockRejectedValue(new Error('verification rejected'));
      else
        api.verifyEnvironment.mockResolvedValue({
          ...environmentOf(),
          status: outcome,
          ...(outcome === 'invalid' ? { failureSummary: 'module missing' } : {}),
        });
      const skill = readySkill();
      const { result } = renderHook(() => useSkillDependencies(skill, refreshSkills));
      await waitFor(() => expect(result.current.plan).toBeDefined());
      await act(async () => result.current.checkEnvironment());
      expect(result.current.checking).toBe(false);
      expect(api.verifyEnvironment).toHaveBeenCalledExactlyOnceWith({ environmentId: 'env-1' });
      if (outcome === 'ready') expect(result.current.toast).toContain('环境检查通过');
      else
        expect(result.current.error).toContain(
          outcome === 'failure' ? 'verification rejected' : 'module missing',
        );
      expect(refreshSkills).toHaveBeenCalledTimes(outcome === 'failure' ? 0 : 1);
    },
  );

  it('coalesces repeated environment verification while one request is pending', async () => {
    const api = actions();
    let finish!: (environment: RuntimeEnvironment) => void;
    api.verifyEnvironment.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const skill = readySkill();
    const { result } = renderHook(() => useSkillDependencies(skill, refreshSkills));
    await waitFor(() => expect(result.current.plan).toBeDefined());
    await act(async () => {
      result.current.checkEnvironment();
      result.current.checkEnvironment();
      result.current.prepare();
    });
    expect(api.verifyEnvironment).toHaveBeenCalledOnce();
    expect(api.prepare).not.toHaveBeenCalled();
    await act(async () => finish(environmentOf()));
    expect(result.current.checking).toBe(false);
  });

  it('discards verification errors belonging to the previous Skill', async () => {
    const api = actions();
    let reject!: (error: Error) => void;
    api.verifyEnvironment.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const skill = readySkill();
    const { result, rerender } = renderHook(
      ({ value }) => useSkillDependencies(value, refreshSkills),
      { initialProps: { value: skill } },
    );
    await waitFor(() => expect(result.current.plan).toBeDefined());
    await act(async () => result.current.checkEnvironment());
    rerender({ value: skillOf('other-skill') });
    await act(async () => reject(new Error('old verification failed')));
    expect(result.current.error).toBe('');
    expect(result.current.checking).toBe(false);
    expect(refreshSkills).not.toHaveBeenCalled();
  });

  it('does not inspect or prepare a catalog lock that the Skill never declared', async () => {
    const api = actions();
    const skill = skillOf('skill-1');
    const { result } = renderHook(() => useSkillDependencies(skill, refreshSkills));
    await waitFor(() => expect(result.current.options).toBeDefined());
    act(() => {
      result.current.prepare();
      result.current.confirmGrant();
      result.current.checkEnvironment();
      result.current.cancel();
    });
    expect(inspectPlan).not.toHaveBeenCalled();
    expect(api.prepare).not.toHaveBeenCalled();
    expect(api.verifyEnvironment).not.toHaveBeenCalled();
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it('preserves an actionable prepare failure and prevents duplicate launches', async () => {
    const api = actions();
    api.prepare.mockRejectedValue(new Error('prepare rejected'));
    const skill = readySkill();
    const { result } = renderHook(() => useSkillDependencies(skill, refreshSkills));
    await waitFor(() => expect(result.current.plan).toBeDefined());
    await act(async () => {
      result.current.prepare();
      result.current.prepare();
    });
    expect(api.prepare).toHaveBeenCalledOnce();
    expect(result.current.preparing).toBe(false);
    expect(result.current.error).toBe('prepare rejected');
  });

  it.each([true, false])(
    'records explicit grant confirmation (new=%s) against selected dependencies',
    async (created) => {
      actions();
      const skill = readySkill();
      const { result } = renderHook(() => useSkillDependencies(skill, refreshSkills));
      await waitFor(() => expect(result.current.plan).toBeDefined());
      refreshDependencyGrant.mockResolvedValue({ grantCreated: created, selectedSnapshotIds: [] });
      await act(async () => result.current.confirmGrant());
      expect(refreshDependencyGrant).toHaveBeenLastCalledWith({
        skillId: skill.id,
        lockId: 'lock-1',
        snapshotIds: [],
        confirm: true,
      });
      expect(result.current.toast).toBe(
        created ? '已按当前依赖建立执行授权。' : '授权状态已更新。',
      );
      expect(refreshSkills).toHaveBeenCalledOnce();
    },
  );

  it('returns snapshot deletion failure to its local caller without a false success toast', async () => {
    const api = actions();
    api.deleteToolchainSnapshot.mockRejectedValue(new Error('delete rejected'));
    const skill = readySkill();
    const { result } = renderHook(() => useSkillDependencies(skill, refreshSkills));
    await waitFor(() => expect(result.current.plan).toBeDefined());
    let response;
    await act(async () => {
      response = await result.current.deleteToolchainSnapshot('snapshot-1');
    });
    expect(response).toEqual({ status: 'error', message: 'delete rejected' });
    expect(result.current.toast).toBe('');
  });

  const operationOf = (
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted',
  ) => ({
    id: 'op-1',
    environmentId: 'env-1',
    environmentKey: 'env-key',
    kind: 'prepare' as const,
    status,
    createdAt: 1,
  });

  it.each(['succeeded', 'failed', 'cancelled', 'interrupted'] as const)(
    'stops preparation and polling after the %s terminal state',
    async (status) => {
      const api = actions();
      const skill = readySkill();
      const { result } = renderHook(() => useSkillDependencies(skill, refreshSkills));
      await waitFor(() => expect(result.current.plan).toBeDefined());
      vi.useFakeTimers();
      getOperation
        .mockResolvedValueOnce(operationOf('queued'))
        .mockResolvedValue(operationOf(status));
      await act(async () => result.current.prepare());
      expect(result.current.preparing).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      if (status !== 'succeeded') expect(result.current.operation?.status).toBe(status);
      else expect(result.current.toast).toBe('环境已就绪。');
      expect(result.current.preparing).toBe(false);
      const calls = getOperation.mock.calls.length;
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
      expect(getOperation).toHaveBeenCalledTimes(calls);
      expect(api.prepare).toHaveBeenCalledOnce();
      expect(refreshSkills).toHaveBeenCalledTimes(status === 'succeeded' ? 1 : 0);
    },
  );

  it('discards a late preparation failure after the selected Skill changes', async () => {
    const api = actions();
    let reject!: (error: Error) => void;
    api.prepare.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const skill = readySkill();
    const { result, rerender } = renderHook(
      ({ value }) => useSkillDependencies(value, refreshSkills),
      { initialProps: { value: skill } },
    );
    await waitFor(() => expect(result.current.plan).toBeDefined());
    act(() => result.current.prepare());
    rerender({ value: skillOf('other-skill') });
    await act(async () => reject(new Error('old preparation failure')));
    expect(result.current.error).toBe('');
    expect(result.current.preparing).toBe(false);
    expect(result.current.operation).toBeUndefined();
  });
});
