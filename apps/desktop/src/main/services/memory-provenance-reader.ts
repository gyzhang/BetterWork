import type {
  AgentRuntimeEvent,
  ArtifactInput,
  MaterialReference,
  MemoryDependency,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { deriveEffectiveStatus } from '../persistence/memory-repository';
import {
  materialReferenceKeyOf,
  type ProvenanceReader,
  type SourceDependencies,
} from './memory-provenance';

/**
 * 主进程侧的来源读取器（契约 §11.1）：来源正文与依赖只能由已登记实体提供，
 * Renderer 提交的选择器只用于定位，不能自报摘录内容。
 *
 * 关键纪律：**读不到审计记录就是「不可证明」，返回 undefined 让上层拒绝**，
 * 绝不像自动提炼读取器那样退化成空数组，把「缺证据」伪装成「无依赖」。
 */

const TOOL_EVENT_TYPES: readonly AgentRuntimeEvent['type'][] = [
  'tool.requested',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'tool.failed',
];

const bySequence = (left: AgentRuntimeEvent, right: AgentRuntimeEvent): number =>
  left.sequence - right.sequence;

/** 只承认「最后一个 message.completed，且其后不再有工具调用」为最终无工具回答。 */
const finalAnswerEvent = (
  events: readonly AgentRuntimeEvent[],
  eventId: string,
): string | undefined => {
  const ordered = [...events].sort(bySequence);
  const completed = ordered.filter((event) => event.type === 'message.completed');
  const last = completed[completed.length - 1];
  if (!last || last.type !== 'message.completed' || last.id !== eventId) return undefined;
  if (last.content.length === 0) return undefined;
  const toolAfter = ordered.some(
    (event) => event.sequence > last.sequence && TOOL_EVENT_TYPES.includes(event.type),
  );
  if (toolAfter) return undefined;
  const finished = ordered.find((event) => event.type === 'run.completed');
  if (finished && finished.type === 'run.completed' && finished.finalContent !== last.content) {
    return undefined;
  }
  return last.content;
};

const dedupeMaterials = (
  references: readonly MaterialReference[],
  into: Map<string, MaterialReference>,
): void => {
  for (const reference of references) {
    const key = materialReferenceKeyOf(reference);
    if (!into.has(key)) into.set(key, reference);
  }
};

const dedupeMemories = (
  dependencies: readonly MemoryDependency[],
  into: Map<string, MemoryDependency>,
): void => {
  for (const dependency of dependencies) {
    if (!into.has(dependency.revisionId)) {
      into.set(dependency.revisionId, dependency);
    }
  }
};

/** evidence 引用指向证据行而不是材料本身，只把材料引用并入依赖。 */
const materialOfInput = (input: ArtifactInput): MaterialReference | undefined =>
  input.kind === 'evidence' ? undefined : input;

export const createStoreProvenanceReader = (store: AppStore): ProvenanceReader => {
  const workspaceOfRun = (runId: string): string | undefined => {
    const snapshot = store.runContextSnapshots.get(runId);
    if (snapshot) return snapshot.workspaceId;
    const run = store.runs.get(runId);
    return run ? store.tasks.getWorkspaceId(run.taskId) : undefined;
  };

  /** 运行自己登记的准备快照＋记忆审计记录，两者齐全才算可证明。 */
  const runDependencies = (runId: string): SourceDependencies | undefined => {
    const snapshot = store.runContextSnapshots.get(runId);
    const context = store.runMemoryContexts.get(runId);
    if (!snapshot || !context) return undefined;
    const materials = new Map<string, MaterialReference>();
    const memories = new Map<string, MemoryDependency>();
    dedupeMaterials(
      snapshot.materials.map((material) => material.reference),
      materials,
    );
    dedupeMaterials(context.materialDependencyUnion, materials);
    dedupeMaterials(
      store.materialReads.listByRun(runId).map((read) => read.material),
      materials,
    );
    dedupeMemories(context.memoryDependencyUnion, memories);
    return {
      workspaceId: snapshot.workspaceId,
      materials: [...materials.values()],
      memories: [...memories.values()],
    };
  };

  /** 成果版本自身登记的输入材料（不含 evidence 那种非材料引用）。 */
  const versionMaterials = (artifactVersionId: string): MaterialReference[] | undefined => {
    const detail = store.artifacts.getVersionDetail(artifactVersionId);
    if (!detail) return undefined;
    const materials = new Map<string, MaterialReference>();
    dedupeMaterials(
      (detail.inputRelations ?? [])
        .map((relation) => relation.input)
        .flatMap((input) => {
          const reference = materialOfInput(input);
          return reference ? [reference] : [];
        }),
      materials,
    );
    return [...materials.values()];
  };

  /**
   * user-edit 版本沿同成果前版回溯到最近的 assistant-run 版本；
   * 断链、循环、缺来源 Run 或缺审计记录一律不可证明，绝不改用 latest。
   */
  const artifactVersionDependencies = (
    artifactVersionId: string,
  ): SourceDependencies | undefined => {
    const visited = new Set<string>();
    const materials = new Map<string, MaterialReference>();
    const memories = new Map<string, MemoryDependency>();
    let currentId: string | undefined = artifactVersionId;
    let workspaceId: string | undefined;
    while (currentId) {
      if (visited.has(currentId)) return undefined;
      visited.add(currentId);
      const detail = store.artifacts.getVersionDetail(currentId);
      if (!detail || detail.type !== 'markdown') return undefined;
      const own = versionMaterials(currentId);
      if (own === undefined) return undefined;
      dedupeMaterials(own, materials);
      const sourceRunId = detail.sourceRunId;
      if (detail.origin === 'assistant-run') {
        if (!sourceRunId) return undefined;
        const runFacts = runDependencies(sourceRunId);
        if (!runFacts) return undefined;
        const run = store.runs.get(sourceRunId);
        if (!run || run.status !== 'completed') return undefined;
        if (!store.artifacts.versionBelongsToArtifact(currentId, detail.artifactId)) {
          return undefined;
        }
        dedupeMaterials(runFacts.materials, materials);
        dedupeMemories(runFacts.memories, memories);
        workspaceId = runFacts.workspaceId;
        break;
      }
      if (sourceRunId) return undefined;
      currentId = store.artifacts.getPreviousVersionId(currentId);
    }
    if (!workspaceId) return undefined;
    return {
      workspaceId,
      materials: [...materials.values()],
      memories: [...memories.values()],
    };
  };

  return {
    runPrompt: (runId) => store.runs.get(runId)?.prompt,
    runWorkspace: workspaceOfRun,
    runAssistantAnswer: (runId, eventId) => {
      const run = store.runs.get(runId);
      if (!run || run.status !== 'completed') return undefined;
      return finalAnswerEvent(store.runs.listEvents(runId), eventId);
    },
    runDependencies,
    checkpointField: (checkpointId, field) => {
      const checkpoint = store.discussionCheckpoints.get(checkpointId);
      if (!checkpoint) return undefined;
      return field === 'feedback' ? checkpoint.feedback : checkpoint.summary;
    },
    checkpointDependencies: (checkpointId) => {
      const checkpoint = store.discussionCheckpoints.get(checkpointId);
      if (!checkpoint) return undefined;
      const workspaceId = store.tasks.getWorkspaceId(checkpoint.taskId);
      if (!workspaceId) return undefined;
      const materials = new Map<string, MaterialReference>();
      const memories = new Map<string, MemoryDependency>();
      for (const versionId of checkpoint.artifactVersionIds) {
        const own = versionMaterials(versionId);
        if (own === undefined) return undefined;
        dedupeMaterials(own, materials);
      }
      const runId = checkpoint.runId;
      if (!runId) {
        // 没有来源运行又没有可证明的材料引用时，summary 不能自证为零依赖。
        return checkpoint.artifactVersionIds.length === 0
          ? undefined
          : { workspaceId, materials: [...materials.values()], memories: [] };
      }
      const runFacts = runDependencies(runId);
      if (!runFacts) return undefined;
      dedupeMaterials(runFacts.materials, materials);
      dedupeMemories(runFacts.memories, memories);
      return { workspaceId, materials: [...materials.values()], memories: [...memories.values()] };
    },
    artifactVersion: (artifactVersionId) => {
      const detail = store.artifacts.getVersionDetail(artifactVersionId);
      if (!detail) return undefined;
      return {
        artifactId: detail.artifactId,
        contentHash: detail.type === 'markdown' ? detail.contentHash : detail.fileHash,
        readableText: detail.type === 'markdown' ? detail.content : undefined,
      };
    },
    artifactVersionDependencies,
    memoryRevision: (revisionId) => {
      const revision = store.memories.getRevision(revisionId);
      if (!revision) return undefined;
      const latest = store.memories.get(revision.id);
      const usable =
        latest !== undefined && deriveEffectiveStatus(latest, Date.now()) === 'confirmed';
      const provenance = revision.provenance;
      if (provenance.verification !== 'verified') {
        return {
          memoryId: revision.id,
          revisionId: revision.revisionId,
          contentHash: revision.contentHash,
          usable: false,
          materialDependencies: [],
          memoryDependencies: [],
        };
      }
      return {
        memoryId: revision.id,
        revisionId: revision.revisionId,
        contentHash: revision.contentHash,
        usable,
        materialDependencies: provenance.materialDependencies,
        memoryDependencies: provenance.memoryDependencies,
      };
    },
  };
};
