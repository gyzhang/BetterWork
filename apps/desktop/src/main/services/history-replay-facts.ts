import type {
  MaterialReference,
  MemoryDependency,
  MemoryScope,
  RunMaterialRead,
} from '@betterwork/agent-protocol';
import { materialListIdentity } from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import { historyMaterialAvailability } from './history-material-availability';
import { promptHashOf } from './memory-provenance';
import type { LiveMemoryRevision, MemoryRevisionRef, PriorRunRecord } from './run-history-policy';

export interface HistoryReplayFactsInput {
  readonly taskId: string;
  readonly currentRunId: string;
  readonly evaluatedAt: number;
}

export interface HistoryReplayFacts {
  readonly runs: readonly PriorRunFacts[];
  readonly byRunId: ReadonlyMap<string, PriorRunFacts>;
  readonly liveMemoryRevisions: ReadonlyMap<string, LiveMemoryRevision>;
  readonly unavailableSourceKeys: ReadonlySet<string>;
}

interface FinalAnswer {
  readonly eventId: string;
  readonly content: string;
}

export interface PriorRunFacts {
  readonly record: PriorRunRecord;
  readonly answer: FinalAnswer | undefined;
  readonly materialReferences: readonly MaterialReference[];
  readonly memoryDependencies: readonly MemoryDependency[];
}

const collectPriorRunFacts = (store: AppStore, input: HistoryReplayFactsInput): PriorRunFacts[] => {
  const currentRun = store.runs.get(input.currentRunId);
  const facts: PriorRunFacts[] = [];
  const candidates = store.runs.listHistoryReplayCandidates({
    taskId: input.taskId,
    currentRunId: input.currentRunId,
    ...(currentRun === undefined ? {} : { createdBefore: currentRun.createdAt }),
    completedAtOrBefore: input.evaluatedAt,
  });
  const runIds = candidates.map((run) => run.id);
  const answers = new Map(
    store.runs.listLatestNonEmptyMessageCompletions(runIds).map((event) => [event.runId, event]),
  );
  const contexts = new Map(
    store.runMemoryContexts.listByRunIds(runIds).map((context) => [context.runId, context]),
  );
  const snapshots = new Map(
    store.runContextSnapshots.listByRunIds(runIds).map((snapshot) => [snapshot.runId, snapshot]),
  );
  const readsByRun = new Map<string, RunMaterialRead[]>();
  for (const read of store.materialReads.listByRunIds(runIds)) {
    const reads = readsByRun.get(read.runId) ?? [];
    reads.push(read);
    readsByRun.set(read.runId, reads);
  }
  for (const run of candidates) {
    const event = answers.get(run.id);
    const answer: FinalAnswer | undefined =
      event === undefined ? undefined : { eventId: event.id, content: event.content };
    const context = contexts.get(run.id);
    const snapshot = snapshots.get(run.id);
    const selectedRefs: MemoryRevisionRef[] = [];
    const memoryDependencies: MemoryDependency[] = [];
    for (const item of context?.selectedItems ?? []) {
      const ref: MemoryRevisionRef = {
        memoryId: item.memoryId,
        revisionId: item.revisionId,
        contentHash: item.contentHash,
      };
      selectedRefs.push(ref);
      memoryDependencies.push(ref);
    }
    const inheritedMemories = (context?.memoryDependencyUnion ?? []).filter(
      (dependency) => !selectedRefs.some((ref) => ref.revisionId === dependency.revisionId),
    );
    for (const dependency of inheritedMemories) memoryDependencies.push(dependency);

    const ownMaterialKeys = new Set<string>();
    const materialReferences: MaterialReference[] = [];
    for (const selection of snapshot?.materials ?? []) {
      const key = materialListIdentity(selection.reference);
      if (ownMaterialKeys.has(key)) continue;
      ownMaterialKeys.add(key);
      materialReferences.push(selection.reference);
    }
    for (const read of readsByRun.get(run.id) ?? []) {
      const key = materialListIdentity(read.material);
      if (ownMaterialKeys.has(key)) continue;
      ownMaterialKeys.add(key);
      materialReferences.push(read.material);
    }
    const inheritedMaterialKeys: string[] = [];
    for (const reference of context?.materialDependencyUnion ?? []) {
      const key = materialListIdentity(reference);
      materialReferences.push(reference);
      if (ownMaterialKeys.has(key)) continue;
      inheritedMaterialKeys.push(key);
    }

    facts.push({
      record: {
        runId: run.id,
        ...(answer === undefined ? {} : { finalEventId: answer.eventId }),
        prompt: run.prompt,
        answer: answer?.content ?? '',
        promptHash: promptHashOf(run.prompt),
        directMemoryRevisions: selectedRefs,
        inheritedMemoryRevisions: inheritedMemories,
        materialKeys: [...ownMaterialKeys],
        inheritedMaterialKeys: [...new Set(inheritedMaterialKeys)],
        dependencyFactsComplete: context !== undefined && snapshot !== undefined,
      },
      answer,
      materialReferences,
      memoryDependencies,
    });
  }
  return facts;
};

/** 装配完整候选的来源事实；输出预算和安全后缀选择由重放规划负责。 */
export const loadHistoryReplayFacts = (
  store: AppStore,
  input: HistoryReplayFactsInput,
): HistoryReplayFacts => {
  const priorFacts = collectPriorRunFacts(store, input);
  const dependencies = new Map(
    store.memories
      .listReplayDependencies(
        priorFacts.flatMap((fact) => fact.memoryDependencies.map((ref) => ref.revisionId)),
      )
      .map((dependency) => [dependency.revisionId, dependency]),
  );
  const facts = priorFacts.map((fact) => {
    const memoryScopes: Record<string, MemoryScope['kind']> = {};
    for (const ref of fact.record.directMemoryRevisions) {
      const dependency = dependencies.get(ref.revisionId);
      if (dependency !== undefined) memoryScopes[ref.memoryId] = dependency.scope.kind;
    }
    return { ...fact, record: { ...fact.record, memoryScopes } };
  });

  const liveMemoryRevisions = new Map<string, LiveMemoryRevision>();
  for (const fact of facts) {
    const refs = [...fact.record.directMemoryRevisions, ...fact.record.inheritedMemoryRevisions];
    for (const ref of refs) {
      if (liveMemoryRevisions.has(ref.revisionId)) continue;
      const dependency = dependencies.get(ref.revisionId);
      if (dependency === undefined) continue;
      const live: LiveMemoryRevision = {
        memoryId: dependency.id,
        contentHash: dependency.contentHash,
        status: dependency.status,
        ...(dependency.validFrom === undefined ? {} : { validFrom: dependency.validFrom }),
        ...(dependency.validUntil === undefined ? {} : { validUntil: dependency.validUntil }),
        latestRevisionOfIdentity: dependency.latestRevisionOfIdentity,
        revision: dependency.revision,
        scopeKind: dependency.scope.kind,
      };
      const recorded = fact.record.memoryScopes?.[ref.memoryId];
      liveMemoryRevisions.set(
        ref.revisionId,
        recorded === undefined ? live : { ...live, recordedScopeKind: recorded },
      );
    }
  }
  const materialReferences = facts.flatMap((fact) => fact.materialReferences);
  const materialAvailability = historyMaterialAvailability(store, materialReferences);
  const unavailableSourceKeys = new Set<string>();
  for (const [index, reference] of materialReferences.entries()) {
    if (materialAvailability[index] === true) continue;
    unavailableSourceKeys.add(materialListIdentity(reference));
  }
  return {
    runs: facts,
    byRunId: new Map(facts.map((fact) => [fact.record.runId, fact])),
    liveMemoryRevisions,
    unavailableSourceKeys,
  };
};
