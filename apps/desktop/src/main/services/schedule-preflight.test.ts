import type {
  ExpertRevisionDraft,
  RuntimeProfileDraft,
  ScheduleConfigDraft,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SafeStorageAdapter } from '../infrastructure/credential-store';
import { AppStore } from '../persistence';
import { API_KEY_SLOT } from '../persistence/credential-repository';
import {
  type SchedulePreflightRuntimeAccess,
  SchedulePreflightService,
} from './schedule-preflight';
import { computeDependencyFingerprint } from './skill-dependency-service';

const stores: AppStore[] = [];

class SyntheticCredentialStore implements SafeStorageAdapter {
  constructor(private readonly failDecrypt: boolean) {}

  async isAvailableAsync(): Promise<boolean> {
    return true;
  }

  async encryptAsync(plaintext: string): Promise<Buffer> {
    return Buffer.from(`synthetic:${plaintext}`, 'utf8');
  }

  async decryptAsync(ciphertext: Buffer): Promise<string> {
    if (this.failDecrypt) throw new Error('synthetic protected storage failure');
    return ciphertext.toString('utf8').replace(/^synthetic:/u, '');
  }
}

const expertDraft = (overrides: Partial<ExpertRevisionDraft> = {}): ExpertRevisionDraft => ({
  name: '定时分析专家',
  summary: '按固定期间分析并交付成果',
  author: '',
  tags: [],
  identity: '按用户提供的范围完成研究。',
  principles: ['区分事实和判断'],
  inputRequirements: ['本期材料'],
  deliveryRequirements: ['交付可回溯成果'],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
  ...overrides,
});

const scheduleConfig = (expertId: string, expertRevisionId: string): ScheduleConfigDraft => ({
  name: '每月工作简报',
  expertId,
  expertRevisionId,
  requirements: '总结上一期间的主要变化。',
  expectedArtifactTypes: ['markdown'],
  timing: { frequency: 'monthly', day: 5, hour: 9, minute: 0, timeZone: 'Asia/Shanghai' },
  periodRule: 'previous-month',
  knowledgeSources: [],
  outputSubdirectory: '定时成果',
});

const genericCommand = {
  commandId: 'verify-input',
  label: '验证输入',
  executableKey: 'managed-python',
  argumentSchema: { type: 'object', additionalProperties: false, properties: {} },
  timeoutMs: 300_000,
  expectedOutputs: [],
  execution: {
    entrypoint: {
      scope: 'toolchain' as const,
      runtime: 'managed-python' as const,
      toolchainId: 'ppt-master',
      path: 'scripts/verify.py',
    },
    pathArguments: [],
    argv: [],
    outputs: [],
  },
};

const legacyCommand = {
  commandId: 'verify-input',
  label: '验证输入',
  executableKey: 'managed-python',
  argumentSchema: { type: 'object', additionalProperties: false, properties: {} },
  timeoutMs: 300_000,
  expectedOutputs: [],
};

const runtimeProfile: RuntimeProfileDraft = {
  commands: [genericCommand],
  environmentRequirements: [],
  pythonRequirement: '3.12',
  dependencyLockId: 'schedule-preflight-lock',
  toolchainRequirements: [
    {
      id: 'ppt-master',
      name: 'Fixture toolchain',
      environmentVariable: 'FIXTURE_TOOLCHAIN_HOME',
    },
  ],
  outputContract: { outputPaths: [] },
};

const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  stores.push(store);
  return store;
};

const makeRuntime = (
  overrides: Partial<SchedulePreflightRuntimeAccess> = {},
): SchedulePreflightRuntimeAccess => ({
  verifySkillResource: vi.fn(async () => undefined),
  resolveEnvironmentPython: vi.fn(() => '/managed/python/bin/python3'),
  pathExists: vi.fn(async () => true),
  verifyToolchainSnapshot: vi.fn(async () => ({ valid: true })),
  resolveSnapshotRoot: vi.fn(() => '/managed/snapshots/ppt-master'),
  ...overrides,
});

const makeFixture = (
  options: {
    withModel?: boolean;
    skillCommands?: 'ppt' | 'unknown' | 'none';
    includeGrantSelection?: boolean;
    expertLifecycle?: 'active' | 'disabled';
    mcp?: boolean;
    credentialGrantMatches?: boolean;
    environmentReady?: boolean;
    runtime?: Partial<SchedulePreflightRuntimeAccess>;
  } = {},
) => {
  const store = openStore();
  const workspace = store.workspaces.create('/tmp/schedule-preflight-workspace', '预检合成空间');
  const runtime = makeRuntime(options.runtime);
  if (options.withModel !== false) {
    store.models.save({
      name: '本机合成模型',
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: 'preflight-secret-sentinel',
      maxContextTokens: 8192,
      maxOutputTokens: 8192,
      temperature: 0.7,
      enabled: true,
    });
  }

  let skillBinding: ExpertRevisionDraft['skillPreset'][number] | undefined;
  if (options.skillCommands) {
    const contentHash = 'fixture-skill-content-hash';
    const profile: RuntimeProfileDraft =
      options.skillCommands === 'unknown'
        ? {
            ...runtimeProfile,
            commands: [legacyCommand],
          }
        : options.skillCommands === 'none'
          ? { ...runtimeProfile, commands: [] }
          : runtimeProfile;
    store.skills.save({
      id: 'ppt-generation-expert',
      name: 'PPT 生成专家',
      description: '',
      sourceKind: 'user',
      currentRevisionId: 'pending-ppt-revision',
    });
    const revisionId = store.skills.saveRevision({
      id: 'ppt-skill-revision-v1',
      skillId: 'ppt-generation-expert',
      contentHash,
      resourceKey: `user/ppt-generation-expert/revisions/${contentHash}`,
      frontmatter: { name: 'ppt-generation-expert' },
    });
    const profileHash =
      options.skillCommands === 'unknown' ? 'altered-profile-hash' : 'ppt-profile-v1';
    const profileId = store.skills.saveProfile({
      skillId: 'ppt-generation-expert',
      profileHash,
      profile,
    });
    store.skills.save({
      id: 'ppt-generation-expert',
      name: 'PPT 生成专家',
      description: '',
      sourceKind: 'user',
      currentRevisionId: revisionId,
      currentProfileRevisionId: profileId,
    });
    store.skills.setTrustPreference('ppt-generation-expert', 'trusted');
    const manifestHash = 'ppt-master-manifest-v1';
    const lockHash = 'python-pptx-lock-v1';
    const snapshot = store.snapshots.createSnapshot({
      origin: '/fixture/ppt-master',
      originCommit: '680de11f1bef4628b68d5daad9dffec569fbd51f',
      originState: 'clean',
      manifestHash,
      pathKey: 'dependency-assets/ppt-master-v1',
      fileCount: 2,
      totalBytes: 100,
      exclusions: [],
    });
    const dependencyFingerprint = computeDependencyFingerprint({
      lockHash,
      snapshotManifestHashes: [manifestHash],
    });
    const grantId = store.skills.saveTrustGrant({
      skillId: 'ppt-generation-expert',
      revisionId,
      profileHash,
      dependencyFingerprint:
        options.credentialGrantMatches === false
          ? 'different-dependency-fingerprint'
          : dependencyFingerprint,
      scopeHash: 'fixed-command-scope-v1',
      source: 'user',
    });
    if (options.includeGrantSelection !== false) {
      store.skills.saveDependencySelection(grantId, lockHash, [snapshot.id]);
    }
    const environment = store.environments.createEnvironment({
      environmentKey: 'ppt-runtime-env-v1',
      base: {
        kind: 'managed',
        distributionId: 'python-3.12.0-test',
        version: '3.12.0',
        sha256: 'a'.repeat(64),
      },
      platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
      lockHash,
      lock: {
        lockVersion: 1,
        platform: { os: 'darwin', arch: 'arm64', abi: 'cp312' },
        pythonRequirement: '3.12',
        packages: [],
        importProbes: [],
      },
      pathKey: 'environments/ppt-runtime-env-v1/instance',
    });
    store.environments.updateStatus(
      environment.id,
      options.environmentReady === false ? 'failed' : 'ready',
    );
    skillBinding = { skillId: 'ppt-generation-expert', revisionId };
  }

  const expert = store.experts.create({
    sourceKind: 'user',
    lifecycle: options.expertLifecycle ?? 'active',
    revision: expertDraft({
      skillPreset: skillBinding ? [skillBinding] : [],
      ...(options.mcp
        ? { mcpToolBindings: [{ connectionId: 'remote-connection', toolId: 'external-write' }] }
        : {}),
    }),
  });
  const config = scheduleConfig(expert.id, expert.revision.id);
  const service = new SchedulePreflightService(store, runtime);
  return { store, workspace, expert, config, runtime, service };
};

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('SchedulePreflightService', () => {
  it('blocks without a configured real language model and does not resolve a teaching fallback', async () => {
    const fixture = makeFixture({ withModel: false });
    const getWithSecret = vi.spyOn(fixture.store.models, 'getWithSecret');

    const result = await fixture.service.check({
      workspaceId: fixture.workspace.id,
      config: fixture.config,
    });

    expect(result.status).toBe('blocked');
    expect(result.problems.map((problem) => problem.code)).toContain('model-unavailable');
    expect(getWithSecret).not.toHaveBeenCalled();
  });

  it('returns only an opaque fingerprint and never reads or returns the model secret', async () => {
    const fixture = makeFixture();
    const getWithSecret = vi.spyOn(fixture.store.models, 'getWithSecret');
    const saveGrant = vi.spyOn(fixture.store.skills, 'saveTrustGrant');

    const result = await fixture.service.check({
      workspaceId: fixture.workspace.id,
      config: fixture.config,
    });

    expect(result.status).toBe('ready');
    expect(JSON.stringify(result)).not.toContain('preflight-secret-sentinel');
    expect(getWithSecret).not.toHaveBeenCalled();
    expect(saveGrant).not.toHaveBeenCalled();
  });

  it('requires credentials for remote models while allowing the configured keyless loopback service', async () => {
    const fixture = makeFixture({ withModel: false });
    fixture.store.models.save({
      name: '远程模型',
      provider: 'openai-compatible',
      baseUrl: 'https://models.example/v1',
      model: 'fixture-model',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8192,
      maxOutputTokens: 8192,
      temperature: 0.7,
      enabled: true,
    });

    const result = await fixture.service.check({
      workspaceId: fixture.workspace.id,
      config: fixture.config,
    });

    expect(result.problems.map((problem) => problem.code)).toContain(
      'model-credential-unavailable',
    );

    const migrating = makeFixture();
    const model = migrating.store.models.list().find((profile) => profile.role === 'language');
    if (!model) throw new Error('test setup: language model is missing');
    migrating.store.credentialJournal.ensurePending('model-profile', model.id, API_KEY_SLOT);
    const migrationResult = await migrating.service.check({
      workspaceId: migrating.workspace.id,
      config: migrating.config,
    });
    expect(migrationResult.problems.map((problem) => problem.code)).toContain(
      'model-credential-unavailable',
    );
  });

  it('checks an encrypted credential can be resolved without exposing it', async () => {
    for (const failDecrypt of [false, true]) {
      const store = AppStore.open(':memory:', new SyntheticCredentialStore(failDecrypt));
      stores.push(store);
      const workspace = store.workspaces.create(
        `/tmp/preflight-credential-workspace-${String(failDecrypt)}`,
        '凭据合成空间',
      );
      const modelId = store.models.save({
        name: '合成远程模型',
        provider: 'openai-compatible',
        baseUrl: 'https://models.example/v1',
        model: 'fixture-model',
        role: 'language',
        apiKey: '',
        maxContextTokens: 8192,
        maxOutputTokens: 8192,
        temperature: 0.7,
        enabled: true,
      });
      const credentials = store.credentials;
      if (!credentials) throw new Error('test setup: credential repository is missing');
      const privateKey = `synthetic-private-key-${String(failDecrypt)}`;
      await credentials.put(
        { ownerKind: 'model-profile', ownerId: modelId, slot: API_KEY_SLOT },
        privateKey,
      );
      store.credentialJournal.markDone('model-profile', modelId, API_KEY_SLOT);
      const expert = store.experts.create({ sourceKind: 'user', revision: expertDraft() });
      const service = new SchedulePreflightService(store, makeRuntime());

      const result = await service.check({
        workspaceId: workspace.id,
        config: scheduleConfig(expert.id, expert.revision.id),
      });

      expect(result.status).toBe(failDecrypt ? 'blocked' : 'ready');
      if (failDecrypt) {
        expect(result.problems.map((problem) => problem.code)).toContain(
          'model-credential-unavailable',
        );
      }
      expect(JSON.stringify(result)).not.toContain(privateKey);
      expect(JSON.stringify(result)).not.toContain('synthetic protected storage failure');
    }
  });

  it('blocks an inactive Expert and every selected MCP tool', async () => {
    const inactive = makeFixture({ expertLifecycle: 'disabled' });
    const inactiveResult = await inactive.service.check({
      workspaceId: inactive.workspace.id,
      config: inactive.config,
    });
    expect(inactiveResult.problems.map((problem) => problem.code)).toContain('expert-disabled');

    const mcp = makeFixture({ mcp: true });
    const mcpResult = await mcp.service.check({
      workspaceId: mcp.workspace.id,
      config: mcp.config,
    });
    expect(mcpResult.problems.map((problem) => problem.code)).toContain('mcp-unsupported');
  });

  it('accepts declared generic commands with an active grant, ready environment and verified toolchain snapshot', async () => {
    const fixture = makeFixture({ skillCommands: 'ppt' });
    const ready = await fixture.service.check({
      workspaceId: fixture.workspace.id,
      config: fixture.config,
    });
    expect(ready.status).toBe('ready');
    expect(fixture.runtime.verifySkillResource).toHaveBeenCalledTimes(1);
    expect(fixture.runtime.verifyToolchainSnapshot).toHaveBeenCalledTimes(1);

    fixture.store.skills.setTrustPreference('ppt-generation-expert', 'revoked');
    const revoked = await fixture.service.check({
      workspaceId: fixture.workspace.id,
      config: fixture.config,
    });
    expect(revoked.problems.map((problem) => problem.code)).toContain('skill-trust-unavailable');
  });

  it('blocks commands without a runtime declaration, missing grant selections and altered toolchain snapshots', async () => {
    const altered = makeFixture({ skillCommands: 'unknown' });
    const alteredResult = await altered.service.check({
      workspaceId: altered.workspace.id,
      config: altered.config,
    });
    expect(alteredResult.problems.map((problem) => problem.code)).toContain(
      'skill-command-unsupported',
    );

    const missingSelection = makeFixture({
      skillCommands: 'ppt',
      includeGrantSelection: false,
    });
    const missingResult = await missingSelection.service.check({
      workspaceId: missingSelection.workspace.id,
      config: missingSelection.config,
    });
    expect(missingResult.problems.map((problem) => problem.code)).toContain(
      'skill-dependency-unavailable',
    );

    const changedToolchain = makeFixture({
      skillCommands: 'ppt',
      includeGrantSelection: true,
    });
    const failingRuntime = makeRuntime({
      verifyToolchainSnapshot: vi.fn(async () => ({ valid: false })),
    });
    const failingService = new SchedulePreflightService(changedToolchain.store, failingRuntime);
    const changedResult = await failingService.check({
      workspaceId: changedToolchain.workspace.id,
      config: changedToolchain.config,
    });
    expect(changedResult.problems.map((problem) => problem.code)).toContain(
      'skill-toolchain-unavailable',
    );

    const mismatchedGrant = makeFixture({
      skillCommands: 'ppt',
      credentialGrantMatches: false,
    });
    const grantResult = await mismatchedGrant.service.check({
      workspaceId: mismatchedGrant.workspace.id,
      config: mismatchedGrant.config,
    });
    expect(grantResult.problems.map((problem) => problem.code)).toContain(
      'skill-dependency-unavailable',
    );

    const unreadyEnvironment = makeFixture({ skillCommands: 'ppt', environmentReady: false });
    const environmentResult = await unreadyEnvironment.service.check({
      workspaceId: unreadyEnvironment.workspace.id,
      config: unreadyEnvironment.config,
    });
    expect(environmentResult.problems.map((problem) => problem.code)).toContain(
      'skill-environment-unavailable',
    );

    const invalidResource = makeFixture({
      skillCommands: 'ppt',
      runtime: {
        verifySkillResource: vi.fn(async () => {
          throw new Error('private resource path');
        }),
      },
    });
    const resourceResult = await invalidResource.service.check({
      workspaceId: invalidResource.workspace.id,
      config: invalidResource.config,
    });
    expect(resourceResult.problems.map((problem) => problem.code)).toContain(
      'skill-resource-unavailable',
    );
    expect(JSON.stringify(resourceResult)).not.toContain('private resource path');
  });

  it('blocks an Expert whose pinned Skill revision is no longer current', async () => {
    const fixture = makeFixture({ skillCommands: 'ppt' });
    const skill = fixture.store.skills.get('ppt-generation-expert');
    if (!skill) throw new Error('test setup: PPT Skill is missing');
    const nextRevisionId = fixture.store.skills.saveRevision({
      id: 'ppt-skill-revision-v2',
      skillId: skill.id,
      contentHash: 'changed-content-hash',
      resourceKey: 'user/ppt-generation-expert/revisions/changed-content-hash',
      frontmatter: { name: 'ppt-generation-expert' },
    });
    fixture.store.skills.save({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      sourceKind: skill.sourceKind,
      currentRevisionId: nextRevisionId,
      ...(skill.runtimeProfile ? { currentProfileRevisionId: skill.runtimeProfile.id } : {}),
    });

    const result = await fixture.service.check({
      workspaceId: fixture.workspace.id,
      config: fixture.config,
    });

    expect(result.problems.map((problem) => problem.code)).toContain('skill-revision-changed');
  });

  it('does not include changing source selection in capability authorization, but detects stale capability fingerprints', async () => {
    const fixture = makeFixture();
    const initial = await fixture.service.check({
      workspaceId: fixture.workspace.id,
      config: fixture.config,
    });
    const sourceUpdated = await fixture.service.check({
      workspaceId: fixture.workspace.id,
      config: {
        ...fixture.config,
        knowledgeSources: [{ kind: 'vault', vaultId: 'default', purpose: 'background' }],
      },
    });
    expect(sourceUpdated.fingerprint).toBe(initial.fingerprint);

    const languageModel = fixture.store.models.list().find((model) => model.role === 'language');
    if (!languageModel) throw new Error('test setup: language model is missing');
    fixture.store.models.setEnabled(languageModel.id, false);
    const capabilityChanged = await fixture.service.check({
      workspaceId: fixture.workspace.id,
      config: fixture.config,
    });
    expect(capabilityChanged.fingerprint).not.toBe(initial.fingerprint);
    expect(capabilityChanged.problems.map((problem) => problem.code)).toContain(
      'model-unavailable',
    );
  });
});
