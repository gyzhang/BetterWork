import {
  type ArtifactInput,
  type MaterialReference,
  type RunDiagnosticSourceReference,
  type RunDiagnosticsScopeRequest,
  type RunDiagnosticsSources,
  runDiagnosticsSourcesSchema,
  sameMaterialVersion,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import type { KnowledgeVault } from './knowledge-vault';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedString = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : undefined;

const asReference = (
  value: MaterialReference | ArtifactInput,
  store: AppStore,
  knowledgeVault: KnowledgeVault,
  workspaceId: string,
  runId: string,
): RunDiagnosticSourceReference => {
  if (value.kind === 'evidence') {
    const evidence = store.evidence.get(value.evidenceId);
    if (!evidence) {
      return {
        kind: 'evidence',
        evidenceId: value.evidenceId,
        state: 'unavailable',
        reason: 'record-not-found',
      };
    }
    return evidence.runId === runId
      ? { kind: 'evidence', evidenceId: value.evidenceId, state: 'recorded' }
      : {
          kind: 'evidence',
          evidenceId: value.evidenceId,
          state: 'unavailable',
          reason: 'scope-mismatch',
        };
  }

  if (value.kind === 'knowledge-revision') {
    const revision = knowledgeVault.getMaterialRevision(value.knowledgeRevisionId);
    const matched =
      revision?.documentId === value.knowledgeDocumentId &&
      revision.contentHash === value.contentHash &&
      revision.sourcePath === value.sourcePath;
    return {
      kind: 'knowledge-revision',
      documentId: value.knowledgeDocumentId,
      revisionId: value.knowledgeRevisionId,
      contentHash: value.contentHash,
      ...(matched && revision ? { title: revision.title.slice(0, 512) } : {}),
      state: matched ? 'recorded' : 'unavailable',
      ...(!revision ? { reason: 'revision-not-found' as const } : {}),
      ...(revision && !matched
        ? {
            reason:
              revision.documentId === value.knowledgeDocumentId
                ? ('hash-mismatch' as const)
                : ('scope-mismatch' as const),
          }
        : {}),
    };
  }

  if (value.kind === 'artifact-version') {
    const version = store.artifacts.getMaterialVersion(value.artifactVersionId);
    const matched =
      version?.artifactId === value.artifactId &&
      version.workspaceId === value.originWorkspaceId &&
      version.contentHash === value.contentHash;
    return {
      kind: 'artifact-version',
      artifactId: value.artifactId,
      versionId: value.artifactVersionId,
      contentHash: value.contentHash,
      ...(matched && version ? { versionNumber: version.versionNumber } : {}),
      state: matched ? 'recorded' : 'unavailable',
      ...(!version ? { reason: 'revision-not-found' as const } : {}),
      ...(version && !matched
        ? {
            reason:
              version.artifactId === value.artifactId &&
              version.workspaceId === value.originWorkspaceId
                ? ('hash-mismatch' as const)
                : ('scope-mismatch' as const),
          }
        : {}),
    };
  }

  const snapshot = store.inputSnapshots.get(value.snapshotId);
  const matched =
    snapshot?.workspaceId === value.workspaceId &&
    value.workspaceId === workspaceId &&
    snapshot.contentHash === value.contentHash &&
    snapshot.format === value.format &&
    snapshot.fileKey === value.fileKey &&
    snapshot.status === 'ready';
  return {
    kind: 'workspace-input-snapshot',
    snapshotId: value.snapshotId,
    workspaceId: value.workspaceId,
    contentHash: value.contentHash,
    format: value.format.slice(0, 80),
    state: matched ? 'recorded' : 'unavailable',
    ...(!snapshot ? { reason: 'record-not-found' as const } : {}),
    ...(snapshot && !matched
      ? {
          reason:
            snapshot.status !== 'ready'
              ? ('snapshot-not-ready' as const)
              : snapshot.workspaceId !== value.workspaceId ||
                  value.workspaceId !== workspaceId ||
                  snapshot.fileKey !== value.fileKey ||
                  snapshot.format !== value.format
                ? ('scope-mismatch' as const)
                : ('hash-mismatch' as const),
        }
      : {}),
  };
};

const isSameMaterial = (left: MaterialReference, right: MaterialReference): boolean =>
  sameMaterialVersion(left, right);

export class RunDiagnosticsSourcesService {
  constructor(
    private readonly store: AppStore,
    private readonly knowledgeVault: KnowledgeVault,
  ) {}

  get(input: RunDiagnosticsScopeRequest): RunDiagnosticsSources | undefined {
    const taskId = this.store.runs.getTaskId(input.runId);
    if (
      taskId !== input.taskId ||
      this.store.tasks.getWorkspaceId(input.taskId) !== input.workspaceId
    ) {
      return undefined;
    }

    let incomplete = false;
    let fixedContextIncomplete = false;
    let materialsIncomplete = false;
    const snapshot = this.store.runContextSnapshots.get(input.runId);
    const snapshotValid =
      snapshot?.taskId === input.taskId && snapshot.workspaceId === input.workspaceId;
    if (snapshot && !snapshotValid) incomplete = true;

    const memoryContext = this.store.runMemoryContexts.get(input.runId);
    const memoryReads = this.store.memories.listMemoryReads(input.runId);
    const fixedSkills = snapshotValid
      ? this.store.executions.listBindingsByRun(input.runId).map((binding) => {
          const detail = this.store.skills.getBoundDetail(
            binding.skillRevisionId,
            binding.profileRevisionId,
          );
          const revision = this.store.skills.getRevisionSummary(binding.skillRevisionId);
          const environment = binding.environmentId
            ? this.store.environments.getEnvironment(binding.environmentId)
            : undefined;
          const dependencySnapshots = binding.dependencySnapshotIds.map((id) => {
            const dependency = this.store.snapshots.getSnapshot(id);
            return {
              id,
              state: dependency ? ('recorded' as const) : ('unavailable' as const),
              ...(dependency ? { manifestHash: dependency.manifestHash } : {}),
              ...(!dependency ? { reason: 'record-not-found' as const } : {}),
            };
          });
          if (!revision || !detail || (binding.environmentId && !environment)) {
            incomplete = true;
            fixedContextIncomplete = true;
          }
          if (dependencySnapshots.some((entry) => entry.state === 'unavailable')) {
            incomplete = true;
            fixedContextIncomplete = true;
          }
          return {
            bindingId: binding.id,
            ...(revision ? { skillId: revision.skillId } : {}),
            skillRevisionId: binding.skillRevisionId,
            profileRevisionId: binding.profileRevisionId,
            ...(boundedString(revision?.frontmatter.name, 160)
              ? { name: boundedString(revision?.frontmatter.name, 160) }
              : {}),
            state: revision && detail ? ('recorded' as const) : ('unavailable' as const),
            ...(!revision ? { reason: 'revision-not-found' as const } : {}),
            ...(revision && !detail ? { reason: 'record-not-found' as const } : {}),
            ...(binding.environmentId
              ? {
                  environment: {
                    id: binding.environmentId,
                    state: environment ? ('recorded' as const) : ('unavailable' as const),
                    ...(environment
                      ? {
                          status: environment.status,
                          lockHash: environment.lockHash,
                          platform: environment.platform,
                        }
                      : { reason: 'record-not-found' as const }),
                  },
                }
              : {}),
            dependencySnapshots,
          };
        })
      : [];

    const sourceReferences = (snapshotValid ? snapshot.materials : []).map((selection) => {
      const reference = asReference(
        selection.reference,
        this.store,
        this.knowledgeVault,
        input.workspaceId,
        input.runId,
      );
      if (reference.state !== 'recorded') {
        incomplete = true;
        materialsIncomplete = true;
      }
      const matchingReads = this.store.materialReads
        .listByRun(input.runId)
        .filter(
          (read) =>
            isSameMaterial(selection.reference, read.material) &&
            read.contentHash === selection.reference.contentHash,
        );
      return {
        reference,
        purpose: selection.purpose,
        addedFrom: selection.addedFrom,
        wasRead: matchingReads.some(
          (read) => read.operation === 'read' || read.operation === 'parse',
        ),
      };
    });

    const storedReads = this.store.materialReads.listByRun(input.runId);
    const reads = storedReads
      .filter(
        (read) =>
          !snapshotValid ||
          snapshot.materials.some(
            (selection, index) =>
              sourceReferences[index]?.reference.state === 'recorded' &&
              sameMaterialVersion(selection.reference, read.material),
          ),
      )
      .map((read) => {
        const reference = asReference(
          read.material,
          this.store,
          this.knowledgeVault,
          input.workspaceId,
          input.runId,
        );
        const hashMatches = read.contentHash === read.material.contentHash;
        const safeReference = hashMatches
          ? reference
          : { ...reference, state: 'unavailable' as const, reason: 'hash-mismatch' as const };
        if (safeReference.state !== 'recorded') {
          incomplete = true;
          materialsIncomplete = true;
        }
        return {
          id: read.id,
          reference: safeReference,
          operation: read.operation,
          contentHash: read.contentHash,
          ...(read.excerptHash ? { excerptHash: read.excerptHash } : {}),
          capturedAt: read.capturedAt,
          ...(read.toolCallId ? { toolCallId: read.toolCallId } : {}),
          ...(read.evidenceId ? { evidenceId: read.evidenceId } : {}),
        };
      });
    if (snapshotValid && storedReads.length !== reads.length) {
      incomplete = true;
      materialsIncomplete = true;
    }

    const continuity = this.store.taskContinuity.getRunContext(input.runId);
    const continuityMatches = continuity?.taskId === input.taskId;
    let continuityIncomplete = false;
    let artifactsIncomplete = false;
    const sourceRunIds = continuityMatches
      ? [
          ...(continuity.brief.objective.sourceRunId
            ? [continuity.brief.objective.sourceRunId]
            : []),
          ...continuity.brief.activeRequirements.flatMap(
            (requirement) => requirement.sources?.map((source) => source.runId) ?? [],
          ),
          ...(continuity.brief.progress?.sourceRunId
            ? [continuity.brief.progress.sourceRunId]
            : []),
        ]
      : [];
    const validSourceRunIds = [...new Set(sourceRunIds)].filter(
      (id) => this.store.runs.getTaskId(id) === input.taskId,
    );
    const artifactVersionIds = continuityMatches
      ? [...new Set(continuity.brief.progress?.artifactVersionIds ?? [])].filter((id) =>
          this.store.artifacts.versionBelongsToTask(id, input.taskId),
        )
      : [];
    if (
      continuity &&
      (!continuityMatches ||
        validSourceRunIds.length !== new Set(sourceRunIds).size ||
        artifactVersionIds.length !==
          new Set(continuity.brief.progress?.artifactVersionIds ?? []).size)
    ) {
      incomplete = true;
      continuityIncomplete = true;
    }

    const produced = this.store.artifacts.listVersionsBySourceRun(input.taskId, input.runId);
    const producedVersions = produced.flatMap((version) => {
      const exact = this.store.artifacts.getMaterialVersion(version.id);
      if (!exact || exact.artifactId !== version.artifactId) {
        incomplete = true;
        artifactsIncomplete = true;
        return [];
      }
      if (exact.contentHash === 'unavailable') artifactsIncomplete = true;
      return [
        {
          artifactId: version.artifactId,
          versionId: version.id,
          versionNumber: version.versionNumber,
          origin: version.origin,
          ...(version.sourceRunId ? { sourceRunId: version.sourceRunId } : {}),
          createdAt: version.createdAt,
          ...(version.sourceDeclarationKind
            ? { sourceDeclarationKind: version.sourceDeclarationKind }
            : {}),
          ...(exact.contentHash === 'unavailable' ? {} : { contentHash: exact.contentHash }),
          ...(version.type === 'presentation'
            ? {
                mimeType: version.mimeType,
                fileSize: version.fileSize,
                validation: version.validation,
              }
            : {}),
        },
      ];
    });
    const inputRelations = this.store.artifactInputRelations
      .listBySourceRun(input.taskId, input.runId)
      .flatMap((relation) => {
        const output = producedVersions.some(
          (version) => version.versionId === relation.outputVersionId,
        );
        if (!output) {
          incomplete = true;
          artifactsIncomplete = true;
          return [];
        }
        const inputReference = asReference(
          relation.input,
          this.store,
          this.knowledgeVault,
          input.workspaceId,
          input.runId,
        );
        if (inputReference.state !== 'recorded') {
          incomplete = true;
          artifactsIncomplete = true;
        }
        return [
          {
            outputVersionId: relation.outputVersionId,
            input: inputReference,
            relation: relation.relation,
            createdAt: relation.createdAt,
          },
        ];
      });

    const expertRevision =
      snapshotValid && snapshot.expertId && snapshot.expertRevisionId
        ? this.store.experts.getRevision(snapshot.expertId, snapshot.expertRevisionId)
        : undefined;
    const expert =
      snapshotValid && snapshot.expertId && snapshot.expertRevisionId
        ? {
            expertId: snapshot.expertId,
            revisionId: snapshot.expertRevisionId,
            ...(expertRevision
              ? { revision: expertRevision.revision, name: expertRevision.name.slice(0, 160) }
              : {}),
            state: expertRevision ? ('recorded' as const) : ('unavailable' as const),
            ...(!expertRevision ? { reason: 'revision-not-found' as const } : {}),
          }
        : undefined;
    if (snapshotValid && snapshot.expertId && !expertRevision) {
      incomplete = true;
      fixedContextIncomplete = true;
    }

    const modelSnapshot = memoryContext?.modelSnapshot;
    const model =
      snapshotValid || memoryContext
        ? {
            ...(snapshotValid && snapshot.modelReference
              ? { reference: snapshot.modelReference }
              : {}),
            ...(isRecord(modelSnapshot)
              ? {
                  snapshot: {
                    ...(boundedString(modelSnapshot.displayName, 160)
                      ? { displayName: boundedString(modelSnapshot.displayName, 160) }
                      : {}),
                    ...(boundedString(modelSnapshot.fingerprint, 256)
                      ? { fingerprint: boundedString(modelSnapshot.fingerprint, 256) }
                      : {}),
                    ...(boundedString(modelSnapshot.modelProfileId, 256)
                      ? { modelProfileId: boundedString(modelSnapshot.modelProfileId, 256) }
                      : {}),
                  },
                }
              : {}),
            ...(memoryContext
              ? {
                  memoryPhase: memoryContext.phase,
                  ...(memoryContext.requestPreparedAt === undefined
                    ? {}
                    : { requestPreparedAt: memoryContext.requestPreparedAt }),
                  ...(memoryContext.dispatchAttemptedAt === undefined
                    ? {}
                    : { dispatchAttemptedAt: memoryContext.dispatchAttemptedAt }),
                  ...(memoryContext.requestHash ? { requestHash: memoryContext.requestHash } : {}),
                }
              : {}),
          }
        : undefined;
    const memoryState =
      memoryContext || memoryReads.length > 0 ? ('recorded' as const) : ('not-recorded' as const);
    if (memoryContext && memoryContext.runId !== input.runId) incomplete = true;

    const result: RunDiagnosticsSources = {
      runId: input.runId,
      integrity: incomplete ? 'partial' : snapshotValid ? 'complete' : 'unavailable',
      fixedContext: {
        state: snapshotValid
          ? fixedContextIncomplete
            ? 'unavailable'
            : 'recorded'
          : snapshot
            ? 'unavailable'
            : 'not-recorded',
        ...(snapshotValid && snapshot.taskContextRevisionId
          ? { taskContextRevisionId: snapshot.taskContextRevisionId }
          : {}),
        ...(expert ? { expert } : {}),
        ...(model ? { model } : {}),
        skills: fixedSkills,
      },
      materials: {
        state: snapshotValid
          ? materialsIncomplete
            ? 'unavailable'
            : 'recorded'
          : snapshot
            ? 'unavailable'
            : storedReads.length > 0
              ? 'recorded'
              : 'not-recorded',
        selected: sourceReferences,
        reads,
      },
      memory: {
        state: memoryState,
        ...(memoryContext
          ? { recallVersion: memoryContext.recallVersion, phase: memoryContext.phase }
          : {}),
        ...(memoryContext?.dispatchAttemptedAt === undefined
          ? {}
          : { dispatchAttemptedAt: memoryContext.dispatchAttemptedAt }),
        selectedItems: memoryContext?.selectedItems ?? [],
        reads: memoryReads,
        replay: memoryContext?.replay ?? [],
      },
      continuity: {
        state: continuityMatches
          ? continuityIncomplete
            ? 'unavailable'
            : 'recorded'
          : continuity
            ? 'unavailable'
            : 'not-recorded',
        ...(continuityMatches
          ? {
              revisionId: continuity.revisionId,
              briefHash: continuity.briefHash,
              preparedAt: continuity.preparedAt,
              ...(continuity.firstProviderRequestAt === undefined
                ? {}
                : { firstProviderRequestAt: continuity.firstProviderRequestAt }),
              omissions: continuity.omissions,
              sourceRunIds: validSourceRunIds,
              artifactVersionIds,
            }
          : { omissions: [], sourceRunIds: [], artifactVersionIds: [] }),
      },
      artifacts: {
        state: artifactsIncomplete
          ? 'unavailable'
          : producedVersions.length > 0 || inputRelations.length > 0
            ? 'recorded'
            : 'not-recorded',
        producedVersions,
        inputRelations,
      },
    };
    return runDiagnosticsSourcesSchema.parse(result);
  }
}
