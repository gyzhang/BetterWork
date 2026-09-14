import {
  type ExpertBlockedReason,
  type ExpertDetail,
  type ExpertLifecycle,
  type ExpertRevisionDraft,
  expertRevisionDraftSchema,
  type ExpertSummary,
} from '@betterwork/agent-protocol';

import { type AppStore } from '../persistence';

export type ExpertErrorCode =
  | 'expert_not_found'
  | 'expert_builtin_readonly'
  | 'expert_revision_conflict'
  | 'expert_invalid_tool'
  | 'expert_invalid_mcp';

export class ExpertServiceError extends Error {
  constructor(
    readonly code: ExpertErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ExpertServiceError';
  }
}

const BUILTIN_TOOL_NAMES = new Set([
  'calculator',
  'analyze_business_metrics',
  'read_text_file',
  'read_artifact',
  'knowledge_search',
  'web_search',
  'web_fetch',
  'read_office_material',
]);

const validateDraft = (draft: ExpertRevisionDraft): ExpertRevisionDraft => {
  const parsed = expertRevisionDraftSchema.parse(draft);
  if (
    parsed.builtinToolPolicy.mode === 'allow-list' &&
    parsed.builtinToolPolicy.toolNames.some((name) => !BUILTIN_TOOL_NAMES.has(name))
  ) {
    throw new ExpertServiceError(
      'expert_invalid_tool',
      'Expert 包含尚未登记的内置工具，请移除后重试',
    );
  }
  const mcpToolBindings = parsed.mcpToolBindings ?? [];
  if (
    new Set(mcpToolBindings.map((binding) => `${binding.connectionId}\u0000${binding.toolId}`))
      .size !== mcpToolBindings.length
  ) {
    throw new ExpertServiceError('expert_invalid_mcp', 'Expert 的 MCP 工具绑定不能重复');
  }
  return parsed;
};

const addReason = (reasons: Set<ExpertBlockedReason>, reason: ExpertBlockedReason): void => {
  reasons.add(reason);
};

const sameRevision = (current: ExpertDetail['revision'], draft: ExpertRevisionDraft): boolean =>
  current.name === draft.name &&
  current.summary === draft.summary &&
  current.identity === draft.identity &&
  JSON.stringify(current.principles) === JSON.stringify(draft.principles) &&
  JSON.stringify(current.inputRequirements) === JSON.stringify(draft.inputRequirements) &&
  JSON.stringify(current.deliveryRequirements) === JSON.stringify(draft.deliveryRequirements) &&
  JSON.stringify(current.skillPreset) === JSON.stringify(draft.skillPreset) &&
  JSON.stringify(current.builtinToolPolicy) === JSON.stringify(draft.builtinToolPolicy) &&
  JSON.stringify(current.modelReference) === JSON.stringify(draft.modelReference) &&
  JSON.stringify(current.mcpToolBindings ?? []) === JSON.stringify(draft.mcpToolBindings ?? []) &&
  JSON.stringify(current.referenceMaterials ?? []) ===
    JSON.stringify(draft.referenceMaterials ?? []);

export interface BuiltinExpertReleaseEntry {
  expertId: string;
  name: string;
  summary: string;
  identity: string;
  principles: string[];
  inputRequirements: string[];
  deliveryRequirements: string[];
  skillPreset: ExpertRevisionDraft['skillPreset'];
  builtinToolPolicy: ExpertRevisionDraft['builtinToolPolicy'];
  modelReference: ExpertRevisionDraft['modelReference'];
}

export interface BuiltinExpertReleaseManifest {
  formatVersion: 1;
  experts: BuiltinExpertReleaseEntry[];
}

export class ExpertService {
  constructor(private readonly store: AppStore) {}

  list(includeArchived = false): ExpertSummary[] {
    return this.store.experts.list(includeArchived).map((expert) => {
      const detail = this.withStatus(expert);
      return {
        id: detail.id,
        sourceKind: detail.sourceKind,
        lifecycle: detail.lifecycle,
        name: detail.name,
        summary: detail.summary,
        currentRevision: detail.currentRevision,
        blockedReasons: detail.blockedReasons,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      };
    });
  }

  get(id: string): ExpertDetail | undefined {
    const expert = this.store.experts.get(id);
    return expert ? this.withStatus(expert) : undefined;
  }

  create(draft: ExpertRevisionDraft): ExpertDetail {
    const revision = validateDraft(draft);
    return this.withStatus(this.store.experts.create({ sourceKind: 'user', revision }));
  }

  registerBuiltinRelease(entries: readonly BuiltinExpertReleaseEntry[]): ExpertDetail[] {
    const registered: ExpertDetail[] = [];
    for (const entry of entries) {
      const skillPreset = entry.skillPreset.map((binding) => {
        if (binding.revisionId !== 'pending') return binding;
        const skill = this.store.skills.get(binding.skillId);
        if (!skill)
          throw new ExpertServiceError(
            'expert_invalid_tool',
            `内置 Skill 不存在：${binding.skillId}`,
          );
        return { skillId: binding.skillId, revisionId: skill.revision.id };
      });
      const draft = validateDraft({
        name: entry.name,
        summary: entry.summary,
        identity: entry.identity,
        principles: entry.principles,
        inputRequirements: entry.inputRequirements,
        deliveryRequirements: entry.deliveryRequirements,
        skillPreset,
        builtinToolPolicy: entry.builtinToolPolicy,
        modelReference: entry.modelReference,
      });
      const existing = this.store.experts.get(entry.expertId);
      if (existing) {
        if (existing.sourceKind !== 'builtin') {
          throw new ExpertServiceError(
            'expert_not_found',
            `内置 Expert ID 与用户 Expert 冲突：${entry.expertId}`,
          );
        }
        if (sameRevision(existing.revision, draft)) {
          registered.push(existing);
          continue;
        }
        try {
          registered.push(
            this.withStatus(
              this.store.experts.saveBuiltinRevision(
                entry.expertId,
                draft,
                existing.currentRevision,
              ),
            ),
          );
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Expert revision conflict')) {
            throw new ExpertServiceError(
              'expert_revision_conflict',
              '内置 Expert 已被其他启动流程更新，请重新加载后重试',
              { cause: error },
            );
          }
          throw error;
        }
        continue;
      }
      registered.push(
        this.store.experts.create({
          id: entry.expertId,
          sourceKind: 'builtin',
          revision: draft,
        }),
      );
    }
    return registered;
  }

  saveRevision(id: string, draft: ExpertRevisionDraft, expectedRevision: number): ExpertDetail {
    const existing = this.store.experts.get(id);
    if (!existing) throw new ExpertServiceError('expert_not_found', `Expert 不存在：${id}`);
    if (existing.sourceKind === 'builtin') {
      throw new ExpertServiceError('expert_builtin_readonly', '内置 Expert 不可直接覆盖，请先复制');
    }
    if (existing.currentRevision !== expectedRevision) {
      throw new ExpertServiceError(
        'expert_revision_conflict',
        `Expert 已更新到修订 ${existing.currentRevision}，请重新加载后再保存`,
      );
    }
    const revision = validateDraft(draft);
    try {
      return this.withStatus(this.store.experts.saveRevision(id, revision, expectedRevision));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Expert revision conflict')) {
        throw new ExpertServiceError(
          'expert_revision_conflict',
          'Expert 已被其他操作更新，请重新加载后再保存',
          { cause: error },
        );
      }
      throw error;
    }
  }

  copy(id: string, name?: string): ExpertDetail {
    if (!this.store.experts.get(id)) {
      throw new ExpertServiceError('expert_not_found', `Expert 不存在：${id}`);
    }
    return this.withStatus(this.store.experts.copy(id, name));
  }

  setLifecycle(id: string, lifecycle: ExpertLifecycle, expectedRevision: number): ExpertDetail {
    const existing = this.store.experts.get(id);
    if (!existing) throw new ExpertServiceError('expert_not_found', `Expert 不存在：${id}`);
    if (existing.currentRevision !== expectedRevision) {
      throw new ExpertServiceError(
        'expert_revision_conflict',
        `Expert 已更新到修订 ${existing.currentRevision}，请重新加载后再操作`,
      );
    }
    try {
      return this.withStatus(this.store.experts.setLifecycle(id, lifecycle, expectedRevision));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Expert revision conflict')) {
        throw new ExpertServiceError(
          'expert_revision_conflict',
          'Expert 已被其他操作更新，请重新加载后再操作',
          { cause: error },
        );
      }
      throw error;
    }
  }

  private withStatus(expert: ExpertDetail): ExpertDetail {
    const blockedReasons = new Set<ExpertBlockedReason>();
    for (const binding of expert.revision.skillPreset) {
      const skill = this.store.skills.get(binding.skillId);
      if (!skill || !this.store.skills.hasRevision(binding.skillId, binding.revisionId)) {
        addReason(blockedReasons, 'missing-skill');
      } else if (skill.blockedReasons.length > 0) {
        addReason(blockedReasons, 'skill-blocked');
      }
    }
    if (expert.revision.modelReference.mode === 'profile') {
      const model = this.store.models.getWithSecret(expert.revision.modelReference.modelProfileId);
      if (!model) addReason(blockedReasons, 'missing-model');
      else if (!model.enabled || model.role !== 'language')
        addReason(blockedReasons, 'model-disabled');
    }
    if (expert.revision.builtinToolPolicy.mode === 'allow-list') {
      if (
        expert.revision.builtinToolPolicy.toolNames.some((name) => !BUILTIN_TOOL_NAMES.has(name))
      ) {
        addReason(blockedReasons, 'invalid-tool');
      }
    }
    for (const binding of expert.revision.mcpToolBindings ?? []) {
      const connection = this.store.mcpConnections.get(binding.connectionId);
      if (!connection || !connection.tools.some((tool) => tool.id === binding.toolId)) {
        addReason(blockedReasons, 'mcp-unavailable');
      }
    }
    return { ...expert, blockedReasons: [...blockedReasons] };
  }
}
