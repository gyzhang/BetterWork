// @vitest-environment jsdom

import type {
  DependencyOperation,
  DependencyOptions,
  DependencyPlan,
  RefreshSkillDependencyGrantResult,
  RuntimeEnvironment,
  SkillDetail,
} from '@betterwork/agent-protocol';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';

import { useSkillDependencies } from '../../hooks/use-skill-dependencies';
import { TransientToast } from '../TransientToast';
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
      usage: [
        {
          skillId: 'skill-1',
          skillName: 'PPT 生成 Skill',
          activeAuthorizationCount: 1,
          revokedAuthorizationCount: 0,
          runCount: 2,
        },
      ],
      canDelete: false,
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

const environmentOf = (
  status: RuntimeEnvironment['status'],
  failureSummary?: string,
): RuntimeEnvironment => ({
  id: 'env-1',
  environmentKey: 'key-1',
  base: planOf().base,
  platform: planOf().platform,
  lockHash: planOf().lockHash,
  lock: planOf().lock,
  pathKey: 'environments/key-1/instance',
  status,
  createdAt: 1,
  updatedAt: 2,
  ...(status === 'ready' ? { readyAt: 2 } : {}),
  ...(failureSummary ? { failureCode: 'environment-unhealthy', failureSummary } : {}),
});

const skillOf = (
  id: string,
  overrides: Partial<SkillDetail> = {},
  withRuntimeProfile = true,
): SkillDetail => ({
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
  ...(withRuntimeProfile
    ? {
        runtimeProfile: {
          id: `${id}-profile`,
          skillId: id,
          profileHash: `${id}-profile-hash`,
          profile: {
            commands: [],
            environmentRequirements: [],
            dependencyLockId: lockId,
            outputContract: { outputPaths: [] },
          },
          createdAt: 1,
        },
      }
    : {}),
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
    verifyEnvironment: Mock<(input: unknown) => Promise<RuntimeEnvironment>>;
    prepare: Mock<(input: unknown) => Promise<PrepareReceiptShape>>;
    cancel: Mock<(input: unknown) => Promise<{ applied: boolean; status: string }>>;
    getOperation: Mock<(input: unknown) => Promise<DependencyOperation | null>>;
    chooseInterpreter: Mock<() => Promise<{ cancelled: boolean }>>;
    registerToolchain: Mock<
      (input: unknown) => Promise<{ cancelled: boolean; snapshot: null; reused: boolean }>
    >;
    deleteToolchainSnapshot: Mock<
      (input: unknown) => Promise<{
        status: 'deleted';
        cleanupPending: boolean;
        clearedRevokedAuthorizationReferences: number;
      }>
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
    verifiedEnvironment?: RuntimeEnvironment;
  } = {},
): ApiShape => {
  const api: ApiShape = {
    dependencies: {
      listOptions: vi.fn(async () => options),
      inspectPlan: vi.fn(async () => overrides.plan ?? planOf()),
      verifyEnvironment: vi.fn(async () => overrides.verifiedEnvironment ?? environmentOf('ready')),
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
      deleteToolchainSnapshot: vi.fn(async () => ({
        status: 'deleted',
        cleanupPending: false,
        clearedRevokedAuthorizationReferences: 0,
      })),
    },
    skills: {
      refreshDependencyGrant: vi.fn(async (): Promise<RefreshSkillDependencyGrantResult> => ({
        skill: skillOf('skill-1'),
        selectedSnapshotIds: [],
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
  return (
    <>
      <DependencyPanel skill={skill} state={state} />
      {state.toast && (
        <TransientToast tone="success" message={state.toast} onDismiss={state.dismissToast} />
      )}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'betterwork');
});

describe('DependencyPanel', () => {
  it('未匹配已审核运行配置时只显示静态线索状态，不加载或准备依赖', async () => {
    const api = installApi();
    render(<Harness skill={skillOf('skill-unconfigured', {}, false)} />);

    expect(
      await screen.findByText(/尚未匹配已审核的运行配置；在配置确认前不会准备依赖或外部工具链/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '准备环境' })).toBeNull();
    expect(api.dependencies.listOptions).not.toHaveBeenCalled();
  });

  it('从依赖面板打开快照管理，并说明每条快照被哪个 Skill、授权和 Run 使用', async () => {
    installApi();
    render(<Harness skill={skillOf('skill-1')} />);

    fireEvent.click(await screen.findByRole('button', { name: '管理已登记快照' }));

    expect(await screen.findByRole('dialog', { name: '管理工具链快照' })).toBeTruthy();
    expect(screen.getByText('PPT 生成 Skill')).toBeTruthy();
    expect(screen.getByText(/当前授权 1 · 已撤销 0 · 历史 Run 2/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '删除快照' })).toHaveProperty('disabled', true);
  });

  it('重新打开 Skill 时恢复已保存的工具链选择，并保留现有授权', async () => {
    const skill = skillOf('skill-1', {
      runtimeProfile: {
        id: 'profile-1',
        skillId: 'skill-1',
        profileHash: 'profile-hash-1',
        profile: {
          commands: [],
          environmentRequirements: [],
          dependencyLockId: lockId,
          toolchainRequirements: [
            {
              id: 'ppt-master',
              name: 'PPT Master',
              environmentVariable: 'PPTM_HOME',
              versionHint: '6.6.0',
            },
          ],
          outputContract: { outputPaths: [] },
        },
        createdAt: 1,
      },
    });
    const api = installApi({
      grant: { grantActive: true, selectedSnapshotIds: ['snapshot-1'] },
    });
    render(<Harness skill={skill} />);

    const snapshotSelect = await screen.findByRole('button', { name: 'PPT Master 6.6.0' });
    expect(snapshotSelect.textContent).toContain('aaaaaaaaaaaa · 12981 文件');
    expect(api.skills.refreshDependencyGrant).toHaveBeenCalledWith({
      skillId: 'skill-1',
      lockId,
    });
    expect(screen.queryByRole('button', { name: '确认依赖授权' })).toBeNull();
  });

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

  it('未声明依赖锁时不自动套用目录中的第一份锁', async () => {
    const api = installApi();
    const skill = skillOf('skill-unlocked', {
      runtimeProfile: {
        id: 'profile-unlocked',
        skillId: 'skill-unlocked',
        profileHash: 'profile-hash-unlocked',
        profile: {
          commands: [],
          environmentRequirements: [],
          outputContract: { outputPaths: [] },
        },
        createdAt: 1,
      },
    });
    render(<Harness skill={skill} />);

    const selector = await screen.findByRole('button', { name: '依赖锁' });
    expect(selector.textContent).toBe('');
    expect(screen.getByText(/尚未指定依赖锁.*不会自动套用目录中的锁/)).toBeTruthy();
    expect(api.dependencies.inspectPlan).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '准备环境' })).toHaveProperty('disabled', true);

    selector.click();
    fireEvent.click(await screen.findByRole('menuitem', { name: lockId }));
    await waitFor(() => expect(api.dependencies.inspectPlan).toHaveBeenCalledTimes(1));
  });

  it('发现外部工具链线索但运行配置未声明时不显示「没有依赖」', async () => {
    installApi();
    const skill = skillOf('skill-with-unconfigured-clue', {
      runtimeProfile: {
        id: 'profile-with-unconfigured-clue',
        skillId: 'skill-with-unconfigured-clue',
        profileHash: 'profile-hash-with-unconfigured-clue',
        profile: {
          commands: [],
          environmentRequirements: [],
          dependencyLockId: lockId,
          outputContract: { outputPaths: [] },
        },
        createdAt: 1,
      },
      runtimeDiscovery: [
        {
          kind: 'environment-variable',
          sourcePath: 'SKILL.md',
          lineNumber: 34,
          label: '发现外部目录变量 PPTM_HOME',
        },
      ],
    });
    render(<Harness skill={skill} />);

    expect(await screen.findByText(/尚未映射到运行配置的外部目录变量：PPTM_HOME/)).toBeTruthy();
    expect(screen.queryByText('此 Skill 不依赖外部工具链。')).toBeNull();
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

    await waitFor(() => expect(screen.getByText('已就绪')).toBeTruthy());
    expect(screen.getByText(/需要用户确认后建立/)).toBeTruthy();
    expect(screen.queryByText(/环境就绪且授权有效，可以执行脚本。/)).toBeNull();
    expect(screen.getByRole('button', { name: '确认依赖授权' })).toHaveProperty('disabled', false);
  });

  it('Python 环境已就绪但依赖授权未生效时不宣称 Skill 可以执行', async () => {
    installApi({
      plan: planOf({ environment: environmentOf('ready') }),
      grant: { grantActive: false },
    });
    render(<Harness skill={skillOf('skill-1', { trustStatus: 'trusted' })} />);

    expect(
      await screen.findByText('Python 依赖环境已就绪，但当前依赖授权尚未生效，不能执行 Skill。'),
    ).toBeTruthy();
    expect(screen.queryByText('环境就绪且授权有效，可以执行脚本。')).toBeNull();
  });

  it('已就绪时检查锁定模块可否导入，不会调用环境准备', async () => {
    const api = installApi({
      plan: planOf({ environment: environmentOf('ready') }),
    });
    render(<Harness skill={skillOf('skill-1')} />);

    const checkButton = await screen.findByRole('button', { name: '检查环境' });
    fireEvent.click(checkButton);

    await waitFor(() =>
      expect(api.dependencies.verifyEnvironment).toHaveBeenCalledWith({ environmentId: 'env-1' }),
    );
    expect(api.dependencies.prepare).not.toHaveBeenCalled();
    expect(await screen.findByText('环境检查通过，锁定模块均可导入。')).toBeTruthy();
    expect(screen.getByText(/不会重新安装/)).toBeTruthy();
  });

  it('检查接口同步抛错时复位检查状态并显示错误', async () => {
    const api = installApi({ plan: planOf({ environment: environmentOf('ready') }) });
    api.dependencies.verifyEnvironment.mockImplementation(() => {
      throw new Error('当前应用尚未加载环境检查接口');
    });
    render(<Harness skill={skillOf('skill-1')} />);

    fireEvent.click(await screen.findByRole('button', { name: '检查环境' }));

    expect(await screen.findByText('当前应用尚未加载环境检查接口')).toBeTruthy();
    expect(await screen.findByRole('button', { name: '检查环境' })).toBeTruthy();
  });

  it('检查失败后提供修复动作，并以 repair 模式重建环境', async () => {
    const api = installApi({
      plan: planOf({ environment: environmentOf('ready') }),
      verifiedEnvironment: environmentOf('invalid', '缺少模块 pptx'),
    });
    render(<Harness skill={skillOf('skill-1')} />);

    fireEvent.click(await screen.findByRole('button', { name: '检查环境' }));
    expect(await screen.findByRole('button', { name: '修复环境' })).toBeTruthy();
    expect(screen.getByText('环境检查未通过：缺少模块 pptx')).toBeTruthy();
    expect(screen.getByText(/修复会重建 Skill 专属环境/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '修复环境' }));
    await waitFor(() => expect(api.dependencies.prepare).toHaveBeenCalledTimes(1));
    expect(api.dependencies.prepare.mock.calls[0]?.[0]).toMatchObject({ kind: 'repair' });
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

  it('依赖计划读取失败时不停在「正在计算依赖计划…」，并把这句话显示出来', async () => {
    // `inspect` 走 trackAction，而 loading 此前只在成功路径清除：一次读取失败会让进度条
    // 永远转下去，DependencyPanel:211 那句内联错误也就永远等不到内容。
    const api = installApi();
    api.dependencies.inspectPlan.mockImplementation(async () => {
      throw new Error('依赖计划通道不可用');
    });
    const { container } = render(<Harness skill={skillOf('skill-1')} />);

    await waitFor(() => expect(screen.getByText('依赖计划通道不可用')).toBeTruthy());
    expect(container.querySelector('.dependency-progress')).toBeNull();
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

  it('只为 Skill 声明的外部工具链展示快照选择，并显示快照身份', async () => {
    installApi();
    const skill = skillOf('skill-1', {
      runtimeProfile: {
        id: 'profile-1',
        skillId: 'skill-1',
        profileHash: 'profile-hash',
        profile: {
          commands: [],
          environmentRequirements: [],
          toolchainRequirements: [
            { id: 'ppt-master', name: 'PPT Master', environmentVariable: 'PPTM_HOME' },
          ],
          outputContract: { outputPaths: [] },
        },
        createdAt: 1,
      },
    });
    render(<Harness skill={skill} />);

    const selector = await screen.findByLabelText('PPT Master');
    expect(selector).toBeTruthy();
    expect(selector.textContent).toContain('选择已登记快照…');
    fireEvent.click(selector);
    fireEvent.click(await screen.findByRole('menuitem', { name: /12981 文件 · 含本地修改/ }));
    await waitFor(() => expect(selector.textContent).toContain('12981 文件 · 含本地修改'));
  });

  it('根据 profile 展示多项工具链，不强行塞进单个外部目录选择', async () => {
    installApi();
    const skill = skillOf('skill-1', {
      runtimeProfile: {
        id: 'profile-2',
        skillId: 'skill-1',
        profileHash: 'profile-hash-2',
        profile: {
          commands: [],
          environmentRequirements: [],
          toolchainRequirements: [
            { id: 'ppt-master', name: 'PPT Master', environmentVariable: 'PPTM_HOME' },
            { id: 'svg-tools', name: 'SVG Tools', environmentVariable: 'SVG_TOOLS_HOME' },
          ],
          outputContract: { outputPaths: [] },
        },
        createdAt: 1,
      },
    });
    render(<Harness skill={skill} />);

    expect(await screen.findByLabelText('PPT Master')).toBeTruthy();
    expect(screen.getByLabelText('SVG Tools')).toBeTruthy();
    expect(screen.getByLabelText('PPT Master').textContent).toContain('选择已登记快照…');
    expect(screen.getByLabelText('SVG Tools').textContent).toContain('选择已登记快照…');
    expect(screen.getAllByRole('button', { name: '登记目录…' })).toHaveLength(2);
  });
});
