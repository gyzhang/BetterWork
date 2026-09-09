// @vitest-environment jsdom

import type {
  DependencyOperation,
  DependencyOptions,
  DependencyPlan,
  RefreshSkillDependencyGrantResult,
  SkillDetail,
} from '@betterwork/agent-protocol';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';

import { useSkillDependencies } from '../../hooks/use-skill-dependencies';
import { DependencyPanel } from './DependencyPanel';

const lockId = 'ppt-generation-expert-darwin-arm64-cp312';

const options: DependencyOptions = {
  distributions: [
    {
      id: 'python-build-standalone-3.12.14-darwin-arm64',
      version: '3.12.14',
      platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
      license: 'PSF-2.0',
      installed: false,
    },
  ],
  lockIds: [lockId],
  snapshots: [
    {
      id: 'snapshot-1',
      origin: '/Users/fixture/ppt-master',
      originState: 'dirty',
      manifestHash: 'a'.repeat(64),
      pathKey: 'dependency-assets/aaa',
      fileCount: 12981,
      totalBytes: 80_179_334,
      exclusions: [{ path: '.git', reason: '版本库对象不是运行所需内容' }],
      createdAt: 1,
    },
  ],
  environments: [],
};

const planOf = (overrides: Partial<DependencyPlan> = {}): DependencyPlan => ({
  environmentKey: 'key-1',
  base: {
    kind: 'managed',
    distributionId: options.distributions[0]!.id,
    version: '3.12.14',
    sha256: 'b'.repeat(64),
  },
  platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
  lockHash: 'c'.repeat(64),
  lock: {
    lockVersion: 1,
    platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
    pythonRequirement: '3.12',
    packages: [],
    importProbes: ['pptx'],
  },
  missingWheels: [],
  requiresDownload: false,
  environment: null,
  ...overrides,
});

const skillOf = (id: string, overrides: Partial<SkillDetail> = {}): SkillDetail => ({
  id,
  name: id === 'skill-1' ? '样本能力' : '第二个能力',
  description: '公司模板 PPT',
  sourceKind: 'user',
  enabled: true,
  currentRevisionId: `${id}-rev`,
  trustStatus: 'needs-review',
  environmentStatus: 'unprepared',
  blockedReasons: ['trust-needs-review', 'environment-unprepared'],
  revision: {
    id: `${id}-rev`,
    skillId: id,
    contentHash: 'hash',
    resourceKey: `user/${id}/revisions/hash`,
    frontmatter: {},
    createdAt: 1,
  },
  ...overrides,
});

interface PrepareReceiptShape {
  operationId: string;
  environmentId: string;
  environmentKey: string;
  reused: boolean;
}

/** 明确的异步签名让 mockImplementation 收下 async 实现，不触发 no-misused-promises。 */
interface ApiShape {
  dependencies: {
    listOptions: Mock<() => Promise<DependencyOptions>>;
    inspectPlan: Mock<(input: unknown) => Promise<DependencyPlan>>;
    prepare: Mock<(input: unknown) => Promise<PrepareReceiptShape>>;
    cancel: Mock<(input: unknown) => Promise<{ applied: boolean; status: string }>>;
    getOperation: Mock<(input: unknown) => Promise<DependencyOperation | null>>;
    chooseInterpreter: Mock<() => Promise<{ cancelled: boolean }>>;
    registerToolchain: Mock<
      (input: unknown) => Promise<{ cancelled: boolean; snapshot: null; reused: boolean }>
    >;
  };
  skills: {
    refreshDependencyGrant: Mock<(input: unknown) => Promise<RefreshSkillDependencyGrantResult>>;
  };
}

const installApi = (
  overrides: {
    plan?: DependencyPlan;
    operation?: DependencyOperation | null;
    grant?: Partial<RefreshSkillDependencyGrantResult>;
    prepareResult?: {
      operationId: string;
      environmentId: string;
      environmentKey: string;
      reused: boolean;
    };
  } = {},
): ApiShape => {
  const api: ApiShape = {
    dependencies: {
      listOptions: vi.fn(async () => options),
      inspectPlan: vi.fn(async () => overrides.plan ?? planOf()),
      prepare: vi.fn(async () => ({
        operationId: 'op-1',
        environmentId: 'env-1',
        environmentKey: 'key-1',
        reused: false,
        ...(overrides.prepareResult ?? {}),
      })),
      cancel: vi.fn(async () => ({ applied: true, status: 'cancelled' })),
      getOperation: vi.fn(async () => overrides.operation ?? null),
      chooseInterpreter: vi.fn(async () => ({ cancelled: true })),
      registerToolchain: vi.fn(async () => ({ cancelled: true, snapshot: null, reused: false })),
    },
    skills: {
      refreshDependencyGrant: vi.fn(async (): Promise<RefreshSkillDependencyGrantResult> => ({
        skill: skillOf('skill-1'),
        grantActive: false,
        grantCreated: false,
        blockedReason: '依赖已确定但没有覆盖它的授权，需要用户确认后建立',
        ...(overrides.grant ?? {}),
      })),
    },
  };
  Object.defineProperty(window, 'betterwork', { configurable: true, value: api });
  return api;
};

function Harness({ skill }: { skill: SkillDetail }): React.JSX.Element {
  const state = useSkillDependencies(skill, () => {});
  return <DependencyPanel skill={skill} state={state} />;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'betterwork');
});

describe('DependencyPanel', () => {
  it('未信任也能准备环境，但明确区分「可准备」与「可执行」', async () => {
    installApi();
    render(<Harness skill={skillOf('skill-1', { trustStatus: 'untrusted' })} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '准备环境' })).toHaveProperty('disabled', false),
    );
    expect(screen.getByText(/环境准备不需要信任授权/)).toBeTruthy();
    // 授权按钮在未信任时不可用：不能让「准备环境」被误读成「可以执行」
    expect(screen.getByRole('button', { name: '确认依赖授权' })).toHaveProperty('disabled', true);
  });

  it('重复点击只启动一个准备作业', async () => {
    const api = installApi({
      operation: {
        id: 'op-1',
        environmentId: 'env-1',
        environmentKey: 'key-1',
        kind: 'prepare',
        status: 'running',
        step: 'install-packages',
        createdAt: 1,
      },
    });
    render(<Harness skill={skillOf('skill-1')} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '准备环境' })).toHaveProperty('disabled', false),
    );

    const button = screen.getByRole('button', { name: '准备环境' });
    button.click();
    button.click();
    button.click();

    await waitFor(() => expect(api.dependencies.prepare).toHaveBeenCalledTimes(1));
  });

  it('准备成功后明确提示还需要新的执行授权', async () => {
    installApi({
      plan: planOf({
        environment: {
          id: 'env-1',
          environmentKey: 'key-1',
          base: {
            kind: 'managed',
            distributionId: options.distributions[0]!.id,
            version: '3.12.14',
            sha256: 'b'.repeat(64),
          },
          platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
          lockHash: 'c'.repeat(64),
          lock: planOf().lock,
          pathKey: 'environments/key-1/instance',
          status: 'ready',
          createdAt: 1,
          updatedAt: 2,
        },
      }),
    });
    render(<Harness skill={skillOf('skill-1', { trustStatus: 'needs-review' })} />);

    await waitFor(() => expect(screen.getByText('就绪')).toBeTruthy());
    expect(screen.getByText(/需要用户确认后建立/)).toBeTruthy();
    expect(screen.queryByText(/环境就绪且授权有效，可以执行脚本。/)).toBeNull();
    expect(screen.getByRole('button', { name: '确认依赖授权' })).toHaveProperty('disabled', false);
  });

  it('失败与取消都有可见结果，不停在「准备中」', async () => {
    installApi({
      plan: planOf({ openOperationId: 'op-1' }),
      operation: {
        id: 'op-1',
        environmentId: 'env-1',
        environmentKey: 'key-1',
        kind: 'prepare',
        status: 'failed',
        step: 'install-packages',
        message: '依赖安装失败（exit=1）：No matching distribution found for lxml',
        failureCode: 'install-failed',
        createdAt: 1,
        finishedAt: 2,
      },
    });
    render(<Harness skill={skillOf('skill-1')} />);

    await waitFor(() => expect(screen.getByText('失败')).toBeTruthy());
    expect(screen.getByText(/install-failed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消准备' })).toHaveProperty('disabled', true);
  });

  it('切换 Skill 后不显示上一个 Skill 的作业进度', async () => {
    const api = installApi({
      plan: planOf({ openOperationId: 'op-1' }),
      operation: {
        id: 'op-1',
        environmentId: 'env-1',
        environmentKey: 'key-1',
        kind: 'prepare',
        status: 'running',
        step: 'install-packages',
        message: '安装 8 个锁定包',
        createdAt: 1,
      },
    });
    const view = render(<Harness skill={skillOf('skill-1')} />);
    await waitFor(() => expect(screen.getByText('安装 8 个锁定包')).toBeTruthy());

    // 第二个 Skill 没有进行中的作业：计划里不带 openOperationId
    api.dependencies.inspectPlan.mockImplementation(async () =>
      planOf({ environmentKey: 'key-2' }),
    );
    api.dependencies.getOperation.mockImplementation(async () => null);
    view.rerender(<Harness skill={skillOf('skill-2')} />);

    await waitFor(() => expect(screen.queryByText('安装 8 个锁定包')).toBeNull());
    expect(api.dependencies.listOptions).toHaveBeenCalledTimes(2);
  });

  it('关闭页面再回来时按环境键找回未完成的作业', async () => {
    const running: DependencyOperation = {
      id: 'op-resumed',
      environmentId: 'env-1',
      environmentKey: 'key-1',
      kind: 'prepare',
      status: 'running',
      step: 'create-environment',
      message: '创建专属 venv',
      createdAt: 1,
    };
    installApi({ plan: planOf({ openOperationId: 'op-resumed' }), operation: running });

    const first = render(<Harness skill={skillOf('skill-1')} />);
    await waitFor(() => expect(screen.getByText('创建专属 venv')).toBeTruthy());
    first.unmount();

    // 重新挂载等价于用户关掉页面再回来：进度必须能继续回看
    installApi({ plan: planOf({ openOperationId: 'op-resumed' }), operation: running });
    render(<Harness skill={skillOf('skill-1')} />);
    await waitFor(() => expect(screen.getByText('创建专属 venv')).toBeTruthy());
  });

  it('取消进行中的作业后给出结果', async () => {
    const running: DependencyOperation = {
      id: 'op-1',
      environmentId: 'env-1',
      environmentKey: 'key-1',
      kind: 'prepare',
      status: 'running',
      step: 'install-packages',
      createdAt: 1,
    };
    const cancelled: DependencyOperation = { ...running, status: 'cancelled', finishedAt: 2 };
    let cancelRequested = false;
    const api = installApi({ plan: planOf({ openOperationId: 'op-1' }), operation: running });
    // 轮询在取消发生前必须一直看到 running，否则按钮会提前禁用而点不到取消。
    api.dependencies.getOperation.mockImplementation(async () =>
      cancelRequested ? cancelled : running,
    );
    api.dependencies.cancel.mockImplementation(async () => {
      cancelRequested = true;
      return { applied: true, status: 'cancelled' };
    });
    render(<Harness skill={skillOf('skill-1')} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '取消准备' })).toHaveProperty('disabled', false),
    );
    screen.getByRole('button', { name: '取消准备' }).click();

    await waitFor(() => expect(api.dependencies.cancel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('已取消')).toBeTruthy());
  });

  it('缺项与需要下载如实展示，不假装离线可用', async () => {
    installApi({
      plan: planOf({ missingWheels: ['python-pptx', 'lxml'], requiresDownload: true }),
    });
    render(<Harness skill={skillOf('skill-1')} />);

    await waitFor(() => expect(screen.getByText(/随包资源缺少 python-pptx、lxml/)).toBeTruthy());
    expect(screen.getByText(/需要显式联网下载并逐个校验/)).toBeTruthy();
  });

  it('工具链快照列出文件数与是否含本地修改', async () => {
    installApi();
    render(<Harness skill={skillOf('skill-1')} />);

    const named = (fragment: string): boolean =>
      screen
        .queryAllByRole('option')
        .some((element) => (element.textContent ?? '').includes(fragment));
    await waitFor(() => expect(named('12981 文件')).toBe(true));
    expect(named('含本地修改')).toBe(true);
  });
});
