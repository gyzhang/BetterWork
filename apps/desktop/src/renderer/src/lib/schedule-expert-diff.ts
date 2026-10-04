import type {
  ExpertRevision,
  ScheduleConfig,
  ScheduleConfigDraft,
} from '@betterwork/agent-protocol';

export interface ScheduleExpertRevisionChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

const renderValue = (value: unknown): string => {
  if (value === undefined || value === null) return '（未设置）';
  if (typeof value === 'string') return value || '（空）';
  if (Array.isArray(value)) {
    return value.length === 0
      ? '（无）'
      : value
          .map((item, index) => {
            const rendered = typeof item === 'string' ? item : JSON.stringify(item, null, 2);
            return `${index + 1}. ${rendered ?? '（未设置）'}`;
          })
          .join('\n');
  }
  return JSON.stringify(value, null, 2) ?? '（未设置）';
};

const change = (
  key: string,
  label: string,
  before: unknown,
  after: unknown,
): ScheduleExpertRevisionChange | undefined => {
  if (JSON.stringify(before) === JSON.stringify(after)) return undefined;
  return { key, label, before: renderValue(before), after: renderValue(after) };
};

/** 对比既有 ExpertRevision 的只读执行定义；不读取或改写 Expert。 */
export const scheduleExpertRevisionChanges = (
  previous: ExpertRevision,
  next: ExpertRevision,
): ScheduleExpertRevisionChange[] =>
  [
    change('name', '专家名称', previous.name, next.name),
    change('summary', '简介', previous.summary, next.summary),
    change('author', '作者', previous.author, next.author),
    change('tags', '标签', previous.tags, next.tags),
    change('identity', '人格与职责', previous.identity, next.identity),
    change('principles', '原则', previous.principles, next.principles),
    change('inputRequirements', '输入要求', previous.inputRequirements, next.inputRequirements),
    change(
      'deliveryRequirements',
      '交付要求',
      previous.deliveryRequirements,
      next.deliveryRequirements,
    ),
    change('skillPreset', 'Skill 绑定', previous.skillPreset, next.skillPreset),
    change('builtinToolPolicy', '内置工具策略', previous.builtinToolPolicy, next.builtinToolPolicy),
    change('modelReference', '模型配置绑定', previous.modelReference, next.modelReference),
    change(
      'mcpToolBindings',
      'MCP 工具绑定',
      previous.mcpToolBindings ?? [],
      next.mcpToolBindings ?? [],
    ),
    change(
      'referenceMaterials',
      '专家常用参考',
      previous.referenceMaterials ?? [],
      next.referenceMaterials ?? [],
    ),
    change('avatarKey', '头像标识', previous.avatarKey, next.avatarKey),
  ].filter((item): item is ScheduleExpertRevisionChange => item !== undefined);

export const scheduleConfigDraftForExpertRevision = (
  config: ScheduleConfig,
  expertRevisionId: string,
): ScheduleConfigDraft => ({
  name: config.name,
  expertId: config.expertId,
  expertRevisionId,
  requirements: config.requirements,
  expectedArtifactTypes: config.expectedArtifactTypes,
  timing: config.timing,
  periodRule: config.periodRule,
  knowledgeSources: config.knowledgeSources,
  outputSubdirectory: config.outputSubdirectory,
});
