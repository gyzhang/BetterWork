import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { type AgentRuntimeEvent, IpcChannel } from '@betterwork/agent-protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AppStore } from '../persistence';
import type { SkillDependencyService } from '../services/skill-dependency-service';
import type { ToolchainSnapshotService } from '../services/toolchain-snapshot-service';

/**
 * 记录 ipcMain.handle 注册到的 channel。
 * 参考项目里出现过「协议定义了通道、主进程忘了接线」的半成品状态，
 * Renderer 调用时会得到一个永远不 resolve 的 Promise，因此这里把
 * 「协议里的每个请求通道都必须被注册」变成一条可执行断言。
 */
const mocks = vi.hoisted(() => ({
  handled: [] as string[],
  handlers: new Map<string, (event: unknown, raw: unknown) => unknown>(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  openPath: vi.fn(async () => ''),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, raw: unknown) => unknown) => {
      mocks.handled.push(channel);
      mocks.handlers.set(channel, handler);
    },
  },
  dialog: { showOpenDialog: mocks.showOpenDialog, showSaveDialog: mocks.showSaveDialog },
  shell: { openPath: mocks.openPath },
  systemPreferences: { getUserDefault: () => 'Maximize' },
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
  },
}));

const invoke = async (channel: string, raw: unknown): Promise<unknown> => {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({}, raw);
};

/** 推送通道由主进程主动 send，不经 ipcMain.handle 注册。 */
const PUSH_ONLY_CHANNELS = new Set<string>([
  IpcChannel.RunEvent,
  IpcChannel.NotificationChangeEvent,
  IpcChannel.NotificationActivated,
]);

describe('registerIpc', () => {
  let temporaryDirectory: string;
  let store: AppStore;
  let dependencyTestContext: {
    dependencies: SkillDependencyService;
    snapshots: ToolchainSnapshotService;
    locksRoot: string;
    interpreterPath: string;
  };

  beforeAll(async () => {
    temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-ipc-'));
    const { AppStore } = await import('../persistence');
    const { KnowledgeVault } = await import('../services/knowledge-vault');
    const { NotificationService } = await import('../services/notification-service');
    const { RunService } = await import('../services/run-service');
    const { SkillService } = await import('../services/skill-service');
    const { SkillDependencyService } = await import('../services/skill-dependency-service');
    const { ToolchainSnapshotService } = await import('../services/toolchain-snapshot-service');
    const { FakeDownloader, FakeFileSystem, FakePythonRunner, scenarioOf } =
      await import('../services/fixtures/fake-python-runtime');
    const { registerIpc } = await import('./register-ipc');

    store = AppStore.open(':memory:');
    const knowledgeVault = new KnowledgeVault(':memory:');
    const notifications = new NotificationService(store.notifications, () => null);
    const skillService = new SkillService(store, {
      developmentBuiltinRoot: path.join(temporaryDirectory, 'builtin-dev'),
      installedBuiltinRoot: path.join(temporaryDirectory, 'builtin-installed'),
      userRoot: path.join(temporaryDirectory, 'user-skills'),
    });
    const runs = new RunService(store, knowledgeVault, notifications, skillService, () => null);

    // 依赖通道用离线替身根：不触网、不碰系统 Python，也不写受管目录之外的位置。
    const fakeFilesystem = new FakeFileSystem();
    const fakeProcess = new FakePythonRunner(scenarioOf(), fakeFilesystem);
    const locksRoot = path.join(temporaryDirectory, 'dependency-locks');
    mkdirSync(locksRoot, { recursive: true });
    writeFileSync(
      path.join(locksRoot, 'ipc-sample-darwin-arm64-cp312.json'),
      JSON.stringify({
        lockVersion: 1,
        platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
        pythonRequirement: '3.12',
        packages: [],
        importProbes: ['json'],
      }),
    );
    const interpreterPath = '/usr/local/bin/python3.12';
    fakeFilesystem.write(interpreterPath, '#!/bin/sh\n');
    const dependencies = new SkillDependencyService({
      store,
      paths: {
        userDataRoot: temporaryDirectory,
        pythonRoot: path.join(temporaryDirectory, 'python'),
        environmentsRoot: path.join(temporaryDirectory, 'environments'),
        wheelhouseRoot: path.join(temporaryDirectory, 'wheelhouse'),
      },
      filesystem: fakeFilesystem,
      process: fakeProcess,
      download: new FakeDownloader(),
    });
    const snapshots = new ToolchainSnapshotService({
      store,
      userDataRoot: temporaryDirectory,
      assetsRoot: path.join(temporaryDirectory, 'dependency-assets'),
      filesystem: fakeFilesystem,
      process: fakeProcess,
    });
    dependencyTestContext = { dependencies, snapshots, locksRoot, interpreterPath };

    registerIpc({
      store,
      knowledgeVault,
      notifications,
      runs,
      skillService,
      dependencies,
      snapshots,
      dependencyLocksRoot: locksRoot,
      getWindow: () => null,
      getDefaultWorkspaceRoot: () => temporaryDirectory,
    });
  });

  afterAll(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('registers a handler for every request channel in the protocol', () => {
    const expected = Object.values(IpcChannel).filter(
      (channel) => !PUSH_ONLY_CHANNELS.has(channel),
    );
    const missing = expected.filter((channel) => !mocks.handled.includes(channel));
    expect(missing).toEqual([]);
  });

  it('registers no channel outside the protocol', () => {
    const known = new Set<string>(Object.values(IpcChannel));
    expect(mocks.handled.filter((channel) => !known.has(channel))).toEqual([]);
  });

  it('registers each channel exactly once', () => {
    const duplicated = mocks.handled.filter(
      (channel, index) => mocks.handled.indexOf(channel) !== index,
    );
    expect(duplicated).toEqual([]);
  });

  it('rejects malformed request data before it reaches a handler', async () => {
    await expect(
      invoke(IpcChannel.CreateTask, { workspaceId: '', title: '', goal: '' }),
    ).rejects.toThrow();
  });

  it('rejects unexpected data for a no-input dialog channel before opening the dialog', async () => {
    await expect(invoke(IpcChannel.SelectWorkspace, { injected: true })).rejects.toThrow();
    expect(mocks.showOpenDialog).not.toHaveBeenCalled();
  });

  it('returns a safe result when a source is not registered instead of opening an arbitrary path', async () => {
    await expect(
      invoke(IpcChannel.OpenKnowledgeSource, {
        sourcePath: path.join(temporaryDirectory, 'outside.md'),
      }),
    ).resolves.toEqual({ opened: false, error: '该文件不在当前知识库中，无法打开。' });
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it('rejects a malformed handler result before it can cross the IPC boundary', async () => {
    const original = store.models.list.bind(store.models);
    Object.defineProperty(store.models, 'list', {
      configurable: true,
      value: () => [{ id: 'missing-fields' }],
    });
    await expect(invoke(IpcChannel.ListModels, {})).rejects.toThrow();
    Object.defineProperty(store.models, 'list', { value: original });
  });

  it('completes the Skill management journey through the directory dialogs', async () => {
    const source = path.join(temporaryDirectory, 'import skill');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      path.join(source, 'SKILL.md'),
      '---\nname: Imported Skill\ndescription: A test skill\n---\n\n# Instructions\n',
    );
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [source] });
    const imported = (await invoke(IpcChannel.ImportSkill, {})) as {
      cancelled: boolean;
      skill: { id: string; trustStatus: string };
    };
    expect(imported.cancelled).toBe(false);
    expect(imported.skill.trustStatus).toBe('untrusted');

    const trusted = (await invoke(IpcChannel.SetSkillTrust, {
      skillId: imported.skill.id,
      trusted: true,
    })) as { skill: { trustStatus: string } };
    expect(trusted.skill.trustStatus).toBe('needs-review');
    await expect(
      invoke(IpcChannel.SetSkillTrust, {
        skillId: imported.skill.id,
        trusted: true,
        source: 'builtin',
      }),
    ).rejects.toThrow();

    const profiled = (await invoke(IpcChannel.SaveSkillRuntimeProfile, {
      skillId: imported.skill.id,
      profile: { commands: [], environmentRequirements: [], outputContract: { outputPaths: [] } },
    })) as { skill: { id: string; runtimeProfile?: unknown } };
    expect(profiled.skill.id).toBe(imported.skill.id);

    const copied = (await invoke(IpcChannel.CopySkill, { skillId: imported.skill.id })) as {
      skill: { id: string; sourceKind: string; trustStatus: string };
    };
    expect(copied.skill).toMatchObject({ sourceKind: 'user', trustStatus: 'untrusted' });
    expect(copied.skill.id).not.toBe(imported.skill.id);

    const revoked = (await invoke(IpcChannel.RevokeSkillTrust, { skillId: imported.skill.id })) as {
      skill: { trustStatus: string };
    };
    expect(revoked.skill.trustStatus).toBe('revoked');

    const disabled = (await invoke(IpcChannel.SetSkillEnabled, {
      skillId: imported.skill.id,
      enabled: false,
    })) as { skill: { enabled: boolean; blockedReasons: string[] } };
    expect(disabled.skill.enabled).toBe(false);
    expect(disabled.skill.blockedReasons).toContain('disabled');

    const reopened = (await invoke(IpcChannel.GetSkill, { id: imported.skill.id })) as {
      id: string;
      revision: { resourceKey: string };
    };
    expect(reopened.id).toBe(imported.skill.id);
    expect(reopened.revision.resourceKey).toContain('user/');

    const exportTarget = path.join(temporaryDirectory, 'exported skill');
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: exportTarget });
    const exported = (await invoke(IpcChannel.ExportSkill, { skillId: imported.skill.id })) as {
      cancelled: boolean;
      filePath: string;
    };
    expect(exported).toEqual({ cancelled: false, filePath: exportTarget });
    await expect(readFile(path.join(exportTarget, 'SKILL.md'), 'utf8')).resolves.toContain(
      '# Instructions',
    );
  });

  it('does not import when the directory picker is cancelled', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(invoke(IpcChannel.ImportSkill, {})).resolves.toEqual({ cancelled: true });
  });

  it('completes the local task-to-versioned-artifact journey through registered IPC handlers', async () => {
    const workspace = (await invoke(IpcChannel.GetDefaultWorkspace, {})) as { id: string };
    const created = (await invoke(IpcChannel.CreateTask, {
      workspaceId: workspace.id,
      title: '季度复盘',
      goal: '整理续约风险',
    })) as { task: { id: string }; sessionId: string };
    const started = (await invoke(IpcChannel.StartRun, {
      taskId: created.task.id,
      sessionId: created.sessionId,
      prompt: '计算: 21 * 2',
    })) as { runId: string };

    let events: AgentRuntimeEvent[] = [];
    for (let attempt = 0; attempt < 200; attempt += 1) {
      events = (await invoke(IpcChannel.ListRunEvents, {
        runId: started.runId,
      })) as AgentRuntimeEvent[];
      if (events.some((event) => event.type === 'run.completed')) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const completed = events.find(
      (event): event is Extract<AgentRuntimeEvent, { type: 'run.completed' }> =>
        event.type === 'run.completed',
    );
    expect(completed).toBeDefined();
    if (!completed) throw new Error('Run did not complete');

    const artifact = (await invoke(IpcChannel.SaveMarkdownArtifact, {
      taskId: created.task.id,
      runId: started.runId,
      origin: 'assistant-run',
      title: '季度复盘报告',
      content: completed.finalContent,
    })) as { id: string };
    const revised = await invoke(IpcChannel.SaveMarkdownArtifact, {
      artifactId: artifact.id,
      taskId: created.task.id,
      origin: 'user-edit',
      title: '季度复盘报告',
      content: `${completed.finalContent}\n\n人工补充：跟进续约风险。`,
    });
    expect(revised).toEqual(expect.objectContaining({ id: artifact.id, origin: 'user-edit' }));

    const target = path.join(temporaryDirectory, '季度复盘报告.md');
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target });
    await expect(
      invoke(IpcChannel.ExportMarkdownArtifact, { artifactId: artifact.id }),
    ).resolves.toEqual({ cancelled: false, filePath: target });
    await expect(readFile(target, 'utf8')).resolves.toContain('人工补充：跟进续约风险。');
  });

  /** 直接种入一个带运行配置与信任意愿的用户 Skill，用于依赖授权通道。 */
  const seedDependencySkill = (suffix: string): string => {
    const skillId = `skill-dependency-${suffix}`;
    const revisionId = `${skillId}-rev`;
    store.skills.save({
      id: skillId,
      name: '依赖样本',
      description: '用于 A12 通道测试',
      sourceKind: 'user',
      currentRevisionId: revisionId,
    });
    store.skills.saveRevision({
      id: revisionId,
      skillId,
      contentHash: `hash-${suffix}`,
      resourceKey: `user/${skillId}/revisions/hash`,
      frontmatter: {},
    });
    const profileId = store.skills.saveProfile({
      skillId,
      profileHash: `profile-${suffix}`,
      profile: {
        commands: [
          {
            commandId: 'svg-export',
            label: '导出',
            executableKey: 'python',
            argumentSchema: {},
            timeoutMs: 60_000,
            expectedOutputs: [],
          },
        ],
        environmentRequirements: [],
        outputContract: { outputPaths: [] },
      },
    });
    store.skills.save({
      id: skillId,
      name: '依赖样本',
      description: '用于 A12 通道测试',
      sourceKind: 'user',
      currentRevisionId: revisionId,
      currentProfileRevisionId: profileId,
    });
    store.skills.setTrustPreference(skillId, 'trusted');
    return skillId;
  };

  const waitTerminalOperation = async (operationId: string): Promise<unknown> => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const found = (await invoke(IpcChannel.GetDependencyOperation, { operationId })) as {
        status: string;
      } | null;
      if (found && found.status !== 'queued' && found.status !== 'running') return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('准备作业未在预算内结束');
  };

  it('drives environment preparation through the dependency channels', async () => {
    const options = (await invoke(IpcChannel.ListDependencyOptions, {})) as {
      distributions: Array<{ id: string; installed: boolean }>;
      lockIds: string[];
    };
    expect(options.lockIds).toEqual(['ipc-sample-darwin-arm64-cp312']);
    expect(options.distributions.length).toBeGreaterThan(0);
    expect(options.distributions.every((entry) => entry.installed === false)).toBe(true);

    const base = { kind: 'local', path: dependencyTestContext.interpreterPath };
    const lockId = 'ipc-sample-darwin-arm64-cp312';
    const plan = (await invoke(IpcChannel.InspectDependencyPlan, { base, lockId })) as {
      platform: { os: string; arch: string; abi: string };
      missingWheels: string[];
      requiresDownload: boolean;
      environment: unknown;
      lock: { importProbes: string[] };
    };
    expect(plan.platform).toEqual({ os: 'darwin', arch: 'arm64', abi: 'cp312' });
    expect(plan.missingWheels).toEqual([]);
    expect(plan.requiresDownload).toBe(false);
    expect(plan.environment).toBeNull();
    expect(plan.lock.importProbes).toEqual(['json']);

    const prepared = (await invoke(IpcChannel.PrepareDependencyEnvironment, { base, lockId })) as {
      operationId: string;
      environmentId: string;
      reused: boolean;
    };
    expect(prepared.reused).toBe(false);
    const finished = (await waitTerminalOperation(prepared.operationId)) as {
      status: string;
      step?: string;
    };
    expect(finished.status).toBe('succeeded');
    expect(finished.step).toBe('finalize');

    // 重复准备不会启动第二个作业：环境已就绪，直接复用
    const again = (await invoke(IpcChannel.PrepareDependencyEnvironment, { base, lockId })) as {
      environmentId: string;
      reused: boolean;
    };
    expect(again.reused).toBe(true);
    expect(again.environmentId).toBe(prepared.environmentId);

    await expect(
      invoke(IpcChannel.CancelDependencyPreparation, { operationId: prepared.operationId }),
    ).resolves.toEqual({ applied: false, status: 'succeeded' });

    const afterPrepare = (await invoke(IpcChannel.ListDependencyOptions, {})) as {
      environments: Array<{ id: string; status: string }>;
    };
    expect(afterPrepare.environments).toHaveLength(1);
    expect(afterPrepare.environments[0]).toMatchObject({
      id: prepared.environmentId,
      status: 'ready',
    });
  });

  it('reviews a dependency grant without creating it, then confirms on explicit intent', async () => {
    const skillId = seedDependencySkill('grant');
    const lockId = 'ipc-sample-darwin-arm64-cp312';

    const reviewed = (await invoke(IpcChannel.RefreshSkillDependencyGrant, {
      skillId,
      lockId,
      snapshotIds: [],
    })) as { grantActive: boolean; grantCreated: boolean; blockedReason?: string };
    expect(reviewed.grantActive).toBe(false);
    expect(reviewed.grantCreated).toBe(false);
    expect(reviewed.blockedReason).toContain('需要用户确认');

    const before = (await invoke(IpcChannel.GetSkill, { id: skillId })) as {
      trustStatus: string;
    } | null;
    expect(before?.trustStatus).toBe('needs-review');

    const confirmed = (await invoke(IpcChannel.RefreshSkillDependencyGrant, {
      skillId,
      lockId,
      snapshotIds: [],
      confirm: true,
    })) as { grantActive: boolean; grantCreated: boolean };
    expect(confirmed).toMatchObject({ grantActive: true, grantCreated: true });

    const after = (await invoke(IpcChannel.GetSkill, { id: skillId })) as {
      trustStatus: string;
      blockedReasons: string[];
    } | null;
    expect(after?.trustStatus).toBe('trusted');
    expect(after?.blockedReasons).not.toContain('trust-needs-review');

    // 再次确认不会重复建授权
    await expect(
      invoke(IpcChannel.RefreshSkillDependencyGrant, {
        skillId,
        lockId,
        snapshotIds: [],
        confirm: true,
      }),
    ).resolves.toMatchObject({ grantActive: true, grantCreated: false });
  });

  it('refuses a dependency grant for a Skill whose trust was revoked', async () => {
    const skillId = seedDependencySkill('revoked');
    store.skills.setTrustPreference(skillId, 'revoked');
    const result = (await invoke(IpcChannel.RefreshSkillDependencyGrant, {
      skillId,
      lockId: 'ipc-sample-darwin-arm64-cp312',
      snapshotIds: [],
      confirm: true,
    })) as { grantActive: boolean; grantCreated: boolean; blockedReason?: string };
    expect(result.grantActive).toBe(false);
    expect(result.grantCreated).toBe(false);
    expect(result.blockedReason).toContain('撤销');
  });

  it('refuses test run for unauthorized Skills', async () => {
    const untrustedId = seedDependencySkill('test-run-untrusted');
    store.skills.setEnabled(untrustedId, true);
    store.skills.setTrustPreference(untrustedId, 'revoked');
    await expect(invoke(IpcChannel.TestSkillRun, { skillId: untrustedId })).rejects.toThrow(
      '尚未信任',
    );

    const disabledId = seedDependencySkill('test-run-disabled');
    store.skills.setTrustPreference(disabledId, 'trusted');
    store.skills.setEnabled(disabledId, false);
    await expect(invoke(IpcChannel.TestSkillRun, { skillId: disabledId })).rejects.toThrow(
      '已停用',
    );

    await expect(invoke(IpcChannel.TestSkillRun, { skillId: 'nonexistent-skill' })).rejects.toThrow(
      'Skill does not exist',
    );
  });

  it('rejects malformed dependency requests before they reach the services', async () => {
    await expect(
      invoke(IpcChannel.InspectDependencyPlan, {
        base: { kind: 'local', path: dependencyTestContext.interpreterPath },
        lockId: 'not-cataloged',
      }),
    ).rejects.toThrow();
    await expect(
      invoke(IpcChannel.PrepareDependencyEnvironment, {
        base: { kind: 'managed' },
        lockId: 'ipc-sample-darwin-arm64-cp312',
      }),
    ).rejects.toThrow();
    // strict 形状意味着 Renderer 夹带的额外字段（例如可执行路径）会被直接拒绝
    await expect(
      invoke(IpcChannel.PrepareDependencyEnvironment, {
        base: { kind: 'local', path: '/bin/sh', executable: '/bin/sh' },
        lockId: 'ipc-sample-darwin-arm64-cp312',
      }),
    ).rejects.toThrow();
    await expect(invoke(IpcChannel.ListDependencyOptions, { injected: true })).rejects.toThrow();
  });
});
