import type {
  MaterialReference,
  MemoryDependency,
  TaskMaterialSelection,
} from '@betterwork/agent-protocol';
import { stableStringifyJson } from '@betterwork/agent-protocol';

import { type AppStore, materialReferenceKey } from '../persistence';
import { deriveEffectiveStatus } from '../persistence/memory-repository';

/**
 * 同一 Task 的助手进度只有在来源 Run 的完整材料/记忆依赖仍属于当前有效选择时才注入。
 * 缺快照、缺依赖记录、被替代记忆或精确引用变化一律视作不可证明。
 */
export const continuityProgressDependenciesAreCurrent = (
  store: AppStore,
  sourceRunId: string,
  taskId: string,
  effectiveRunId: string,
): boolean => {
  try {
    const sourceRun = store.runs.get(sourceRunId);
    const sourceSnapshot = store.runContextSnapshots.get(sourceRunId);
    const sourceMemory = store.runMemoryContexts.get(sourceRunId);
    const effectiveRun = store.runs.get(effectiveRunId);
    const effectiveSnapshot = store.runContextSnapshots.get(effectiveRunId);
    const effectiveMemory = store.runMemoryContexts.get(effectiveRunId);
    if (
      !sourceRun ||
      sourceRun.taskId !== taskId ||
      sourceRun.status !== 'completed' ||
      !sourceSnapshot ||
      sourceSnapshot.taskId !== taskId ||
      !sourceMemory ||
      !effectiveRun ||
      effectiveRun.taskId !== taskId ||
      !effectiveSnapshot ||
      effectiveSnapshot.taskId !== taskId ||
      !effectiveMemory
    ) {
      return false;
    }

    const sourceSelections = sourceSnapshot.materials;
    const latestTaskContext =
      effectiveRunId === sourceRunId ? store.taskContexts.getLatest(taskId) : undefined;
    const effectiveSelections =
      latestTaskContext && latestTaskContext.id !== effectiveSnapshot.taskContextRevisionId
        ? (latestTaskContext.materials ?? effectiveSnapshot.materials)
        : effectiveSnapshot.materials;
    const excludedMemoryIds = new Set(latestTaskContext?.excludedMemoryIds ?? []);
    const sourceReferences = [
      ...sourceSelections.map((selection) => selection.reference),
      ...sourceMemory.materialDependencyUnion,
      ...store.materialReads.listByRun(sourceRunId).map((read) => read.material),
    ];
    const exactReferenceIsSelected = (
      reference: MaterialReference,
      selections: readonly TaskMaterialSelection[],
    ): boolean =>
      selections.some(
        (selection) =>
          materialReferenceKey(selection) ===
            materialReferenceKey({
              reference,
              purpose: 'background',
              addedFrom: 'user-input',
            }) && stableStringifyJson(selection.reference) === stableStringifyJson(reference),
      );
    if (
      sourceReferences.some(
        (reference) =>
          !exactReferenceIsSelected(reference, sourceSelections) ||
          !exactReferenceIsSelected(reference, effectiveSelections),
      )
    ) {
      return false;
    }

    const effectiveMemoryDependencies = new Map(
      effectiveMemory.memoryDependencyUnion.map((dependency) => [
        dependency.revisionId,
        stableStringifyJson(dependency),
      ]),
    );
    const visiting = new Set<string>();
    const verified = new Set<string>();
    const verifyMemory = (dependency: MemoryDependency): boolean => {
      if (visiting.has(dependency.revisionId)) return false;
      if (verified.has(dependency.revisionId)) return true;
      if (
        effectiveMemoryDependencies.get(dependency.revisionId) !== stableStringifyJson(dependency)
      ) {
        return false;
      }
      const current = store.memories.get(dependency.memoryId);
      const revision = store.memories.getRevision(dependency.revisionId);
      const now = Date.now();
      if (
        !current ||
        !revision ||
        revision.id !== dependency.memoryId ||
        current.revisionId !== dependency.revisionId ||
        revision.contentHash !== dependency.contentHash ||
        excludedMemoryIds.has(dependency.memoryId) ||
        current.status !== 'confirmed' ||
        deriveEffectiveStatus(current, now) !== 'confirmed' ||
        (current.validFrom !== undefined && current.validFrom > now) ||
        revision.provenance.verification !== 'verified'
      ) {
        return false;
      }
      visiting.add(dependency.revisionId);
      for (const reference of revision.provenance.materialDependencies) {
        if (
          !exactReferenceIsSelected(reference, sourceSelections) ||
          !exactReferenceIsSelected(reference, effectiveSelections)
        ) {
          visiting.delete(dependency.revisionId);
          return false;
        }
      }
      for (const nested of revision.provenance.memoryDependencies) {
        if (!verifyMemory(nested)) {
          visiting.delete(dependency.revisionId);
          return false;
        }
      }
      visiting.delete(dependency.revisionId);
      verified.add(dependency.revisionId);
      return true;
    };

    return sourceMemory.memoryDependencyUnion.every(verifyMemory);
  } catch {
    return false;
  }
};
