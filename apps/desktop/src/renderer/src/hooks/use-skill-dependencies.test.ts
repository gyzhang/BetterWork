// @vitest-environment jsdom

import type { DependencyOptions, DependencyPlan, SkillDetail } from '@betterwork/agent-protocol';
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
    profile: {
      pythonRequirement: undefined,
      dependencyBundle: undefined,
      dependencyLockId: undefined,
      toolchainRequirements: [],
    },
    finding: { kind: 'none' },
  },
});

const optionsOf = (): DependencyOptions => ({
  distributions: [
    {
      id: 'dist-1',
      name: 'Python 3.12',
      version: '3.12.0',
      platform: { os: 'darwin', arch: 'arm64' },
      active: true,
      path: '/opt/python',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  snapshots: [],
});

const listOptions = vi.fn<() => Promise<DependencyOptions>>();
const inspectPlan = vi.fn<(input: never) => Promise<DependencyPlan>>();
const getOperation = vi.fn<(input: never) => Promise<unknown>>();
const refreshDependencyGrant = vi.fn<(input: never) => Promise<unknown>>();

const install = (): void => {
  listOptions.mockResolvedValue(optionsOf());
  inspectPlan.mockResolvedValue({
    base: { kind: 'managed', distributionId: 'dist-1' },
    environment: { id: 'env-1', status: 'ready', checks: [], failureSummary: undefined },
    modules: [],
    openOperationId: undefined,
  });
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
