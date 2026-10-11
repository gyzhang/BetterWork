import type {
  BuiltinToolPolicy,
  ExpertModelReference,
  McpToolBinding,
  StartRunRequest,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { ScheduleMaterialResolver } from './schedule-material-resolver';

/** 一次执行的上下文解析结果；仅在 Run 启动前有效。 */
export interface ResolvedRunContext {
  skillBindings?: StartRunRequest['skillBindings'];
  expertInstruction?: string;
  modelReference?: ExpertModelReference;
  builtinToolPolicy?: BuiltinToolPolicy;
  materials: TaskMaterialSelection[];
  materialScope: boolean;
  scheduleSourceSnapshotId?: string;
  taskContextRevisionId?: string;
  expertId?: string;
  expertRevisionId?: string;
  excludedMemoryIds: string[];
  mcpToolBindings: McpToolBinding[];
}

export type RunContextResolutionInput = Pick<
  StartRunRequest,
  'taskId' | 'taskContextRevisionId' | 'expectedTaskContextRevision' | 'skillBindings'
>;

export const resolveRunContext = (
  store: AppStore,
  input: RunContextResolutionInput,
): ResolvedRunContext => {
  const settings = store.runSettings.get();
  if (!input.taskContextRevisionId) {
    assertBuiltinSkillsAvailable(store, input.skillBindings ?? [], settings.enableBuiltinSkills);
    return {
      ...(input.skillBindings ? { skillBindings: input.skillBindings } : {}),
      materials: [],
      materialScope: false,
      excludedMemoryIds: [],
      mcpToolBindings: [],
    };
  }
  const expected = input.expectedTaskContextRevision;
  if (expected === undefined) throw new Error('TaskContextRevision 缺少期望修订号');
  const context = store.taskContexts.get(input.taskContextRevisionId, input.taskId);
  if (!context) throw new Error('TaskContextRevision 不存在或不属于当前 Task');
  if (context.revision !== expected) {
    throw new Error(`TaskContextRevision 已更新：期望 ${expected}，当前为 ${context.revision}`);
  }
  if (input.skillBindings && input.skillBindings.length > 0) {
    throw new Error('TaskContextRevision 与直接 Skill 绑定不能同时提交');
  }
  assertBuiltinSkillsAvailable(store, context.skillBindings, settings.enableBuiltinSkills);
  const workspaceId = store.tasks.getWorkspaceId(input.taskId);
  if (!workspaceId) throw new Error('Task workspace does not exist');
  const explicitMaterials = context.materials ?? [];
  const materials = new ScheduleMaterialResolver(store)
    .resolve({
      taskId: input.taskId,
      workspaceId,
      ...(context.scheduleSourceSnapshotId
        ? { scheduleSourceSnapshotId: context.scheduleSourceSnapshotId }
        : {}),
      materials: explicitMaterials,
    })
    .map(
      (material): TaskMaterialSelection =>
        material.selection ?? {
          reference: material.reference,
          purpose: material.purpose,
          addedFrom:
            material.scheduleOrigin === 'expert-reference'
              ? 'expert-reference'
              : 'workspace-candidate',
        },
    );
  if (context.executor.kind === 'general') {
    return {
      ...(context.skillBindings.length > 0 ? { skillBindings: context.skillBindings } : {}),
      ...(context.modelReference ? { modelReference: context.modelReference } : {}),
      ...(context.builtinToolPolicy ? { builtinToolPolicy: context.builtinToolPolicy } : {}),
      materials,
      materialScope: true,
      ...(context.scheduleSourceSnapshotId
        ? { scheduleSourceSnapshotId: context.scheduleSourceSnapshotId }
        : {}),
      taskContextRevisionId: context.id,
      excludedMemoryIds: context.excludedMemoryIds ?? [],
      mcpToolBindings: context.mcpToolBindings ?? [],
    };
  }
  const expert = store.experts.get(context.executor.expertId);
  if (!expert) throw new Error(`Expert 不存在：${context.executor.expertId}`);
  if (expert.sourceKind === 'builtin' && !settings.enableBuiltinExperts) {
    throw new Error(`内置 Expert「${expert.name}」已在设置中停用`);
  }
  if (expert.lifecycle !== 'active') throw new Error(`Expert「${expert.name}」当前不可用`);
  const revision = store.experts.getRevision(
    context.executor.expertId,
    context.executor.expertRevisionId,
  );
  if (!revision) throw new Error('Expert 修订不存在或不属于该 Expert');
  assertBuiltinSkillsAvailable(store, revision.skillPreset, settings.enableBuiltinSkills);
  return {
    skillBindings: context.skillBindings,
    expertInstruction: composeExpertInstruction(revision),
    modelReference: context.modelReference ?? revision.modelReference,
    builtinToolPolicy: context.builtinToolPolicy ?? revision.builtinToolPolicy,
    materials,
    materialScope: true,
    ...(context.scheduleSourceSnapshotId
      ? { scheduleSourceSnapshotId: context.scheduleSourceSnapshotId }
      : {}),
    taskContextRevisionId: context.id,
    expertId: context.executor.expertId,
    expertRevisionId: context.executor.expertRevisionId,
    excludedMemoryIds: context.excludedMemoryIds ?? [],
    mcpToolBindings: context.mcpToolBindings ?? [],
  };
};

const assertBuiltinSkillsAvailable = (
  store: AppStore,
  bindings: readonly { skillId: string }[],
  enabled: boolean,
): void => {
  if (enabled) return;
  const builtinSkill = bindings
    .map(({ skillId }) => store.skills.get(skillId))
    .find((skill) => skill?.sourceKind === 'builtin');
  if (builtinSkill) throw new Error(`内置 Skill「${builtinSkill.name}」已在设置中停用`);
};

const composeExpertInstruction = (revision: {
  identity: string;
  principles: string[];
  inputRequirements: string[];
  deliveryRequirements: string[];
}): string => {
  const lines = ['以下是当前 Expert 的工作方式，请在本次任务中遵循：', '', revision.identity];
  if (revision.principles.length > 0) {
    lines.push('', '工作原则：', ...revision.principles.map((item) => `- ${item}`));
  }
  if (revision.inputRequirements.length > 0) {
    lines.push('', '输入要求：', ...revision.inputRequirements.map((item) => `- ${item}`));
  }
  if (revision.deliveryRequirements.length > 0) {
    lines.push('', '交付与检查要求：', ...revision.deliveryRequirements.map((item) => `- ${item}`));
  }
  return lines.join('\n');
};
