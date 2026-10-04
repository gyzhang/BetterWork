import { createHash } from 'node:crypto';
import path from 'node:path';

import type {
  DependencySnapshot,
  ExpertRevision,
  ModelProfileSummary,
  ScheduleConfigDraft,
  SkillDetail,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { API_KEY_SLOT } from '../persistence/credential-repository';
import { isSupportedBuiltinToolName } from './expert-service';
import { suggestedPptProfile, supportedPptContentHashes } from './ppt-generation-preset';
import { computeDependencyFingerprint } from './skill-dependency-service';

export type SchedulePreflightProblemCode =
  | 'workspace-unavailable'
  | 'expert-unavailable'
  | 'expert-disabled'
  | 'expert-revision-unavailable'
  | 'model-unavailable'
  | 'model-disabled'
  | 'model-credential-unavailable'
  | 'mcp-unsupported'
  | 'builtin-tool-unsupported'
  | 'web-search-unavailable'
  | 'skill-unavailable'
  | 'skill-revision-changed'
  | 'skill-disabled'
  | 'skill-trust-unavailable'
  | 'skill-profile-unavailable'
  | 'skill-grant-unavailable'
  | 'skill-command-unsupported'
  | 'skill-resource-unavailable'
  | 'skill-dependency-unavailable'
  | 'skill-environment-unavailable'
  | 'skill-toolchain-unavailable';

export interface SchedulePreflightProblem {
  readonly code: SchedulePreflightProblemCode;
  readonly message: string;
  readonly capabilityId?: string;
}

export interface SchedulePreflightResult {
  readonly status: 'ready' | 'blocked';
  readonly fingerprint: string;
  readonly problems: readonly SchedulePreflightProblem[];
}

export interface SchedulePreflightInput {
  readonly workspaceId: string;
  readonly config: ScheduleConfigDraft;
}

export interface SchedulePreflightRuntimeAccess {
  readonly verifySkillResource: (skill: SkillDetail) => Promise<void>;
  readonly resolveEnvironmentPython: (environmentId: string) => string;
  readonly pathExists: (target: string) => Promise<boolean>;
  readonly verifyToolchainSnapshot: (snapshotId: string) => Promise<{ valid: boolean }>;
  readonly resolveSnapshotRoot: (snapshot: DependencySnapshot) => string;
}

interface SkillFingerprint {
  readonly skillId: string;
  readonly requestedRevisionId: string;
  readonly currentRevisionId?: string;
  readonly contentHash?: string;
  readonly profileId?: string;
  readonly profileHash?: string;
  readonly enabled?: boolean;
  readonly trustStatus?: SkillDetail['trustStatus'];
  readonly grantId?: string;
  readonly dependencyFingerprint?: string;
  readonly lockHash?: string;
  readonly snapshotManifestHashes?: readonly string[];
  readonly environmentKey?: string;
  readonly resourceVerified?: boolean;
  readonly runtimeReady?: boolean;
}

const sortedValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortedValue(item)]),
  );
};

const hashFingerprint = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(sortedValue(value)))
    .digest('hex');

const resolveLanguageModel = (
  store: AppStore,
  revision: ExpertRevision,
): ModelProfileSummary | undefined => {
  const models = store.models.list();
  if (revision.modelReference.mode === 'profile') {
    const modelProfileId = revision.modelReference.modelProfileId;
    return models.find((model) => model.id === modelProfileId);
  }
  return models.find((model) => model.role === 'language' && model.enabled);
};

const profileMatchesReviewedPreset = (skill: SkillDetail): boolean => {
  const expected = suggestedPptProfile(skill.revision.contentHash);
  const actual = skill.runtimeProfile?.profile;
  return (
    expected !== undefined &&
    actual !== undefined &&
    JSON.stringify(sortedValue(actual)) === JSON.stringify(sortedValue(expected))
  );
};

const findReadyEnvironment = (
  store: AppStore,
  lockHash: string,
): ReturnType<AppStore['environments']['listEnvironments']>[number] | undefined =>
  store.environments
    .listEnvironments()
    .find(
      (environment) =>
        environment.lockHash === lockHash &&
        environment.status === 'ready' &&
        environment.platform.os === process.platform &&
        environment.platform.arch === process.arch,
    );

const canResolveCredential = async (
  store: AppStore,
  ownerKind: 'model-profile' | 'api-service-profile',
  ownerId: string,
): Promise<boolean> => {
  const credentials = store.credentials;
  if (!credentials) return false;
  try {
    await credentials.resolveForOwner({ ownerKind, ownerId, slot: API_KEY_SLOT });
    return true;
  } catch {
    return false;
  }
};

/** Main 只读无人值守能力检查；不解析模型、不安装依赖、不建立或改变授权。 */
export class SchedulePreflightService {
  constructor(
    private readonly store: AppStore,
    private readonly runtime: SchedulePreflightRuntimeAccess,
  ) {}

  async check(input: SchedulePreflightInput): Promise<SchedulePreflightResult> {
    const problems: SchedulePreflightProblem[] = [];
    const add = (
      code: SchedulePreflightProblemCode,
      message: string,
      capabilityId?: string,
    ): void => {
      problems.push({ code, message, ...(capabilityId ? { capabilityId } : {}) });
    };

    const workspace = this.store.workspaces.get(input.workspaceId);
    if (!workspace) add('workspace-unavailable', '工作空间不可用，无法准备定时任务。');

    const expert = this.store.experts.get(input.config.expertId);
    if (!expert) {
      add('expert-unavailable', '指定的专家不存在，请重新选择专家。', input.config.expertId);
      return this.result(problems, input, undefined, undefined, undefined, []);
    }
    if (expert.lifecycle !== 'active') {
      add('expert-disabled', '指定的专家已停用或归档，请先恢复专家。', expert.id);
    }
    const revision = this.store.experts.getRevision(expert.id, input.config.expertRevisionId);
    if (!revision) {
      add('expert-revision-unavailable', '固定的专家修订不存在或不属于该专家。', expert.id);
      return this.result(problems, input, expert, undefined, undefined, []);
    }

    const model = resolveLanguageModel(this.store, revision);
    const modelCredentialStatus = model
      ? this.store.credentialJournal.statusOf('model-profile', model.id, API_KEY_SLOT)
      : 'none';
    let modelCredentialReady = false;
    if (model?.apiKeyConfigured) {
      modelCredentialReady =
        modelCredentialStatus === 'none' ||
        (modelCredentialStatus === 'done' &&
          (await canResolveCredential(this.store, 'model-profile', model.id)));
    } else if (model && modelCredentialStatus === 'none' && isLoopbackEndpoint(model.baseUrl)) {
      modelCredentialReady = true;
    }
    if (!model) {
      add('model-unavailable', '没有可用于后台执行的真实语言模型配置，请在设置中配置模型。');
    } else {
      if (!model.enabled || model.role !== 'language') {
        add('model-disabled', '指定的语言模型已停用或用途不匹配，请修复专家模型配置。', model.id);
      }
      if (!modelCredentialReady) {
        add(
          'model-credential-unavailable',
          '语言模型凭据缺失或尚未完成安全迁移；请在设置中修复凭据后重试。',
          model.id,
        );
      }
    }

    const mcpBindings = revision.mcpToolBindings ?? [];
    for (const binding of mcpBindings) {
      add(
        'mcp-unsupported',
        '当前版本不能证明 MCP 工具的后台执行效果；请移除 MCP 绑定后再启用定时任务。',
        `${binding.connectionId}/${binding.toolId}`,
      );
    }

    const toolPolicy = revision.builtinToolPolicy;
    if (
      toolPolicy.mode === 'allow-list' &&
      toolPolicy.toolNames.some((toolName) => !isSupportedBuiltinToolName(toolName))
    ) {
      add('builtin-tool-unsupported', '专家选择了当前应用未登记的内置工具。', expert.id);
    }
    const explicitlyNeedsSearch =
      toolPolicy.mode === 'allow-list' && toolPolicy.toolNames.includes('web_search');
    const searchEngines = this.store.searchEngines.list();
    const enabledSearch = searchEngines.find((search) => search.enabled);
    const searchCredentialStatuses = new Map(
      searchEngines.map((search) => [
        search.provider,
        this.store.credentialJournal.statusOf('api-service-profile', search.provider, API_KEY_SLOT),
      ]),
    );
    const enabledSearchCredentialStatus = enabledSearch
      ? searchCredentialStatuses.get(enabledSearch.provider)
      : undefined;
    let enabledSearchCredentialReady = false;
    if (enabledSearch?.apiKeyConfigured) {
      enabledSearchCredentialReady =
        enabledSearchCredentialStatus === 'none' ||
        (enabledSearchCredentialStatus === 'done' &&
          (await canResolveCredential(this.store, 'api-service-profile', enabledSearch.provider)));
    }
    if (
      (enabledSearch &&
        (enabledSearchCredentialStatus === 'pending' ||
          enabledSearchCredentialStatus === 'failed' ||
          (enabledSearchCredentialStatus === 'done' &&
            (!enabledSearch.apiKeyConfigured || !enabledSearchCredentialReady)))) ||
      (explicitlyNeedsSearch && (!enabledSearch || !enabledSearchCredentialReady))
    ) {
      add('web-search-unavailable', '专家要求网页搜索，但没有已启用且凭据已配置的搜索服务。');
    }

    const skillFingerprints: SkillFingerprint[] = [];
    for (const binding of revision.skillPreset) {
      const result = await this.checkSkill(binding, add);
      skillFingerprints.push(result);
    }

    const capabilityState = {
      version: 1,
      workspaceId: input.workspaceId,
      workspacePath: workspace?.rootPath ?? null,
      expertId: expert.id,
      expertLifecycle: expert.lifecycle,
      expertRevision: revision,
      model: model
        ? {
            id: model.id,
            provider: model.provider,
            baseUrl: model.baseUrl,
            model: model.model,
            role: model.role,
            enabled: model.enabled,
            apiKeyConfigured: model.apiKeyConfigured,
            credentialStatus: modelCredentialStatus,
            credentialReady: modelCredentialReady,
            updatedAt: model.updatedAt,
          }
        : null,
      builtinToolPolicy: revision.builtinToolPolicy,
      searchEngines: searchEngines.map((search) => ({
        provider: search.provider,
        enabled: search.enabled,
        apiKeyConfigured: search.apiKeyConfigured,
        credentialStatus: searchCredentialStatuses.get(search.provider) ?? 'none',
        credentialReady:
          search.provider === enabledSearch?.provider ? enabledSearchCredentialReady : undefined,
        webTopK: search.webTopK,
        updatedAt: search.updatedAt,
      })),
      skills: skillFingerprints,
      mcpBindings,
    };
    return {
      status: problems.length === 0 ? 'ready' : 'blocked',
      fingerprint: hashFingerprint(capabilityState),
      problems,
    };
  }

  private result(
    problems: SchedulePreflightProblem[],
    input: SchedulePreflightInput,
    expert: ReturnType<AppStore['experts']['get']>,
    revision: ExpertRevision | undefined,
    model: ModelProfileSummary | undefined,
    skills: readonly SkillFingerprint[],
  ): SchedulePreflightResult {
    return {
      status: 'blocked',
      fingerprint: hashFingerprint({
        version: 1,
        workspaceId: input.workspaceId,
        expertId: expert?.id ?? input.config.expertId,
        expertLifecycle: expert?.lifecycle ?? null,
        expertRevisionId: revision?.id ?? input.config.expertRevisionId,
        expertRevision: revision ?? null,
        modelId: model?.id ?? null,
        skills,
      }),
      problems,
    };
  }

  private async checkSkill(
    binding: ExpertRevision['skillPreset'][number],
    add: (code: SchedulePreflightProblemCode, message: string, capabilityId?: string) => void,
  ): Promise<SkillFingerprint> {
    const skill = this.store.skills.get(binding.skillId);
    const fingerprint: SkillFingerprint = {
      skillId: binding.skillId,
      requestedRevisionId: binding.revisionId,
    };
    if (!skill) {
      add('skill-unavailable', '专家绑定的 Skill 不存在。', binding.skillId);
      return fingerprint;
    }
    if (skill.revision.id !== binding.revisionId) {
      add(
        'skill-revision-changed',
        '专家固定的 Skill 修订已变化，请先更新专家绑定。',
        binding.skillId,
      );
    }
    if (!skill.enabled) add('skill-disabled', '专家绑定的 Skill 已停用。', binding.skillId);
    if (skill.trustStatus !== 'trusted') {
      add('skill-trust-unavailable', 'Skill 没有当前有效的信任授权。', binding.skillId);
    }
    const runtimeProfile = skill.runtimeProfile;
    if (!runtimeProfile) {
      add(
        'skill-profile-unavailable',
        'Skill 缺少固定运行配置，不能用于后台执行。',
        binding.skillId,
      );
      return {
        ...fingerprint,
        currentRevisionId: skill.revision.id,
        contentHash: skill.revision.contentHash,
        enabled: skill.enabled,
        trustStatus: skill.trustStatus,
      };
    }
    const grant = this.store.executions.findActiveGrant(
      skill.id,
      skill.revision.id,
      runtimeProfile.profileHash,
    );
    if (!grant) {
      add('skill-grant-unavailable', 'Skill 没有覆盖当前修订与运行配置的有效授权。', skill.id);
    }

    const baseFingerprint: SkillFingerprint = {
      ...fingerprint,
      currentRevisionId: skill.revision.id,
      contentHash: skill.revision.contentHash,
      profileId: runtimeProfile.id,
      profileHash: runtimeProfile.profileHash,
      enabled: skill.enabled,
      trustStatus: skill.trustStatus,
      ...(grant ? { grantId: grant.id } : {}),
    };
    if (runtimeProfile.profile.commands.length === 0) {
      let resourceVerified = false;
      try {
        await this.runtime.verifySkillResource(skill);
        resourceVerified = true;
      } catch {
        add('skill-resource-unavailable', 'Skill 资源与登记修订不一致或当前不可读取。', skill.id);
      }
      return { ...baseFingerprint, resourceVerified };
    }

    if (!supportedPptContentHashes.includes(skill.revision.contentHash)) {
      add(
        'skill-command-unsupported',
        '后台只支持已审核的 ppt-generation 固定命令；此脚本 Skill 内容哈希未登记。',
        skill.id,
      );
      return baseFingerprint;
    }
    if (!profileMatchesReviewedPreset(skill)) {
      add(
        'skill-command-unsupported',
        '脚本命令表与审核过的 ppt-generation 运行配置不同，请重新审核。',
        skill.id,
      );
      return baseFingerprint;
    }

    let resourceVerified = false;
    try {
      await this.runtime.verifySkillResource(skill);
      resourceVerified = true;
    } catch {
      add('skill-resource-unavailable', 'Skill 资源与登记修订不一致或当前不可读取。', skill.id);
    }

    const selection = grant ? this.store.skills.getDependencySelection(grant.id) : undefined;
    if (!selection) {
      add('skill-dependency-unavailable', '脚本 Skill 缺少已确认的固定依赖选择。', skill.id);
      return { ...baseFingerprint, resourceVerified };
    }
    const snapshots: DependencySnapshot[] = [];
    let snapshotInvalid = false;
    for (const snapshotId of selection.snapshotIds) {
      const snapshot = this.store.snapshots.getSnapshot(snapshotId);
      if (!snapshot) {
        snapshotInvalid = true;
        continue;
      }
      snapshots.push(snapshot);
    }
    const snapshotManifestHashes = snapshots.map((snapshot) => snapshot.manifestHash);
    const dependencyFingerprint = computeDependencyFingerprint({
      lockHash: selection.lockHash,
      snapshotManifestHashes,
    });
    const matchingGrant = this.store.executions.findActiveGrant(
      skill.id,
      skill.revision.id,
      runtimeProfile.profileHash,
      dependencyFingerprint,
    );
    if (snapshotInvalid || matchingGrant?.id !== grant?.id) {
      add('skill-dependency-unavailable', '当前依赖选择与已确认授权不一致。', skill.id);
    }

    const environment = findReadyEnvironment(this.store, selection.lockHash);
    let runtimeReady = environment !== undefined;
    if (!environment) {
      add('skill-environment-unavailable', 'Skill 对应的 macOS arm64 运行环境尚未就绪。', skill.id);
    } else {
      try {
        const pythonPath = this.runtime.resolveEnvironmentPython(environment.id);
        if (!(await this.runtime.pathExists(pythonPath))) runtimeReady = false;
      } catch {
        runtimeReady = false;
      }
      if (!runtimeReady) {
        add('skill-environment-unavailable', 'Skill 对应的 Python 运行环境不可读取。', skill.id);
      }
    }

    let toolchainReady = snapshots.length === 1 && !snapshotInvalid;
    if (snapshots.length !== 1 || snapshotInvalid) {
      toolchainReady = false;
    } else {
      const snapshot = snapshots[0];
      if (snapshot) {
        try {
          const verification = await this.runtime.verifyToolchainSnapshot(snapshot.id);
          const snapshotRoot = this.runtime.resolveSnapshotRoot(snapshot);
          const scripts = [
            path.join(snapshotRoot, 'skills', 'ppt-master', 'scripts', 'project_manager.py'),
            path.join(snapshotRoot, 'skills', 'ppt-master', 'scripts', 'icon_sync.py'),
          ];
          toolchainReady =
            verification.valid &&
            (await Promise.all(scripts.map((script) => this.runtime.pathExists(script)))).every(
              Boolean,
            );
        } catch {
          toolchainReady = false;
        }
      }
    }
    if (!toolchainReady) {
      add(
        'skill-toolchain-unavailable',
        'ppt-generation 需要一个完整、已校验的固定 ppt-master 工具链快照。',
        skill.id,
      );
    }

    return {
      ...baseFingerprint,
      dependencyFingerprint,
      lockHash: selection.lockHash,
      snapshotManifestHashes,
      ...(environment ? { environmentKey: environment.environmentKey } : {}),
      resourceVerified,
      runtimeReady,
    };
  }
}

const isLoopbackEndpoint = (baseUrl: string): boolean => {
  try {
    const { hostname } = new URL(baseUrl);
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
  } catch {
    return false;
  }
};
