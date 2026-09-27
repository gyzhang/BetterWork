import type {
  MaterialCandidate,
  MaterialReference,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';

/**
 * 材料引用的身份键：同一条精确版本被重复引用时只保留一条（专家与任务材料设计 §3.6）。
 *
 * 这条投影此前在四个文件里各写了一遍（App、ContextPanel、ComposerCapabilityPicker、
 * ExpertsView 共六份函数副本），任何一处改口径都会让「同一条材料在两个列表里算两条」
 * 这类分叉无声发生。收在这里之后，页面只表达「谁参与去重」，不再表达「怎么算同一条」。
 */
export const materialReferenceKey = (reference: MaterialReference): string => {
  if (reference.kind === 'knowledge-revision') return `knowledge:${reference.knowledgeRevisionId}`;
  if (reference.kind === 'artifact-version') return `artifact:${reference.artifactVersionId}`;
  return `snapshot:${reference.snapshotId}`;
};

export const taskMaterialKey = (selection: TaskMaterialSelection): string =>
  materialReferenceKey(selection.reference);

export const materialCandidateKey = (candidate: MaterialCandidate): string =>
  materialReferenceKey(candidate.reference);

/**
 * 成果版本材料只在它诞生的工作空间里可用；知识修订与输入快照跨空间通用。
 * 判据只有一份，召唤专家时的候选过滤与输入框的材料去重必须一致。
 */
export const materialReferenceAppliesToWorkspace = (
  reference: MaterialReference,
  workspaceId: string | undefined,
): boolean => {
  if (reference.kind !== 'artifact-version') return true;
  return Boolean(workspaceId && reference.originWorkspaceId === workspaceId);
};

export const materialCandidateAppliesToWorkspace = (
  candidate: MaterialCandidate,
  workspaceId: string | undefined,
): boolean => materialReferenceAppliesToWorkspace(candidate.reference, workspaceId);
