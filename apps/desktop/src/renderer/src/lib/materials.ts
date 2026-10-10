import {
  type MaterialCandidate,
  materialListIdentity,
  type MaterialReference,
  type TaskMaterialSelection,
} from '@betterwork/agent-protocol';

export const taskMaterialKey = (selection: TaskMaterialSelection): string =>
  materialListIdentity(selection.reference);

export const materialCandidateKey = (candidate: MaterialCandidate): string =>
  materialListIdentity(candidate.reference);

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
