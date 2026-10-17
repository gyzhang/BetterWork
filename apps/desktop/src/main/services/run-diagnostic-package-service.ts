import type {
  RunDiagnosticNode,
  RunDiagnosticPackage,
  RunDiagnosticPackageReference,
  RunDiagnosticsScopeRequest,
  RunDiagnosticsSources,
} from '@betterwork/agent-protocol';
import {
  RUN_DIAGNOSTIC_PACKAGE_MAX_BYTES,
  RUN_DIAGNOSTIC_PACKAGE_SCHEMA_VERSION,
  runDiagnosticPackageHashSchema,
  runDiagnosticPackageIdentifierSchema,
  runDiagnosticPackageSchema,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import type { RunDiagnosticsSourcesService } from './run-diagnostics-sources';

export class RunDiagnosticPackageScopeError extends Error {
  constructor() {
    super('所选 Run 不属于当前工作空间和任务，无法导出诊断包。');
    this.name = 'RunDiagnosticPackageScopeError';
  }
}

export class RunDiagnosticPackageTooLargeError extends Error {
  constructor(maximumBytes: number) {
    const maximum =
      maximumBytes === RUN_DIAGNOSTIC_PACKAGE_MAX_BYTES
        ? '5 MiB'
        : `${maximumBytes.toLocaleString('en-US')} 字节`;
    super(
      maximumBytes === RUN_DIAGNOSTIC_PACKAGE_MAX_BYTES
        ? `诊断包超过 ${maximum}；未写入文件。请从执行记录选择调用较少的 Run 后重试。`
        : `诊断包超过 ${maximum}，无法完整导出。`,
    );
    this.name = 'RunDiagnosticPackageTooLargeError';
  }
}

export interface SerializedRunDiagnosticPackage {
  json: string;
  byteLength: number;
}

export function serializeRunDiagnosticPackage(
  input: unknown,
  maximumBytes = RUN_DIAGNOSTIC_PACKAGE_MAX_BYTES,
): SerializedRunDiagnosticPackage {
  const packageData = runDiagnosticPackageSchema.parse(input);
  const json = `${JSON.stringify(packageData, null, 2)}\n`;
  const byteLength = Buffer.byteLength(json, 'utf8');
  if (byteLength > maximumBytes) throw new RunDiagnosticPackageTooLargeError(maximumBytes);
  return { json, byteLength };
}

export class RunDiagnosticPackageService {
  constructor(
    private readonly store: AppStore,
    private readonly sources: RunDiagnosticsSourcesService,
    private readonly options: {
      now?: () => number;
      applicationVersion?: () => string;
    } = {},
  ) {}

  create(scope: RunDiagnosticsScopeRequest): SerializedRunDiagnosticPackage {
    let diagnosticsRedacted = false;
    let sourcesRedacted = false;
    const projectIdentifier = (
      value: string | undefined,
      diagnostic = false,
    ): string | undefined => {
      if (value === undefined) return undefined;
      if (runDiagnosticPackageIdentifierSchema.safeParse(value).success) return value;
      if (diagnostic) diagnosticsRedacted = true;
      else sourcesRedacted = true;
      return undefined;
    };
    const projectRequiredIdentifier = (value: string): string => {
      const projected = projectIdentifier(value, true);
      if (!projected) throw new Error('Run 标识不符合安全导出格式。');
      return projected;
    };
    const projectHash = (value: string | undefined): string | undefined => {
      if (value === undefined) return undefined;
      if (runDiagnosticPackageHashSchema.safeParse(value).success) return value;
      sourcesRedacted = true;
      return undefined;
    };

    const snapshot = this.store.transaction(() => {
      const run = this.store.runs.get(scope.runId);
      if (
        !run ||
        run.taskId !== scope.taskId ||
        this.store.tasks.getWorkspaceId(scope.taskId) !== scope.workspaceId
      ) {
        throw new RunDiagnosticPackageScopeError();
      }
      const diagnostics = this.store.runDiagnostics.getExportSnapshot(scope.runId);
      const sources = this.sources.get(scope);
      if (!sources || sources.runId !== run.id) throw new RunDiagnosticPackageScopeError();
      return {
        run,
        diagnostics,
        sources,
        issueMark: this.store.runDiagnostics.getIssueMark(run.id),
      };
    });

    const projectReference = (
      reference: RunDiagnosticsSources['materials']['selected'][number]['reference'],
    ): RunDiagnosticPackageReference => {
      const common = { kind: reference.kind, state: reference.state } as const;
      switch (reference.kind) {
        case 'knowledge-revision':
          return {
            ...common,
            documentId: projectIdentifier(reference.documentId),
            revisionId: projectIdentifier(reference.revisionId),
            contentHash: projectHash(reference.contentHash),
          };
        case 'artifact-version':
          return {
            ...common,
            artifactId: projectIdentifier(reference.artifactId),
            versionId: projectIdentifier(reference.versionId),
            contentHash: projectHash(reference.contentHash),
          };
        case 'workspace-input-snapshot':
          return {
            ...common,
            snapshotId: projectIdentifier(reference.snapshotId),
            contentHash: projectHash(reference.contentHash),
          };
        case 'evidence':
          return { ...common, evidenceId: projectIdentifier(reference.evidenceId) };
      }
    };

    const projectNode = (
      node: RunDiagnosticNode,
    ): RunDiagnosticPackage['diagnostics']['nodes'][number] | undefined => {
      const id = projectIdentifier(node.id, true);
      if (!id) return undefined;
      return {
        id,
        ...(projectIdentifier(node.parentId, true)
          ? { parentId: projectIdentifier(node.parentId, true) }
          : {}),
        kind: node.kind,
        status: node.status,
        sourceKind: node.sourceKind,
        evidenceState: node.evidenceState,
        ...(node.sourceSequenceStart === undefined
          ? {}
          : { sourceSequenceStart: node.sourceSequenceStart }),
        ...(node.sourceSequenceEnd === undefined
          ? {}
          : { sourceSequenceEnd: node.sourceSequenceEnd }),
        ...(node.occurredAt === undefined ? {} : { occurredAt: node.occurredAt }),
        ...(node.round === undefined ? {} : { round: node.round }),
        ...(projectIdentifier(node.operationId, true)
          ? { operationId: projectIdentifier(node.operationId, true) }
          : {}),
        ...(projectIdentifier(node.executionId, true)
          ? { executionId: projectIdentifier(node.executionId, true) }
          : {}),
        ...(node.hostKind === undefined ? {} : { hostKind: node.hostKind }),
        ...(node.hostPhase === undefined ? {} : { hostPhase: node.hostPhase }),
        ...(projectIdentifier(node.modelCallId, true)
          ? { modelCallId: projectIdentifier(node.modelCallId, true) }
          : {}),
        ...(projectIdentifier(node.toolCallId, true)
          ? { toolCallId: projectIdentifier(node.toolCallId, true) }
          : {}),
        ...(node.executionState === undefined ? {} : { executionState: node.executionState }),
        ...(node.startedAt === undefined ? {} : { startedAt: node.startedAt }),
        ...(node.endedAt === undefined ? {} : { endedAt: node.endedAt }),
        ...(node.durationMs === undefined ? {} : { durationMs: node.durationMs }),
        ...(node.timeToFirstTextMs === undefined
          ? {}
          : { timeToFirstTextMs: node.timeToFirstTextMs }),
        ...(node.finishReason === undefined ? {} : { finishReason: node.finishReason }),
        ...(node.usage === undefined ? {} : { usage: node.usage }),
      };
    };

    const runId = projectRequiredIdentifier(snapshot.run.id);
    const taskId = projectRequiredIdentifier(snapshot.run.taskId);
    const sessionId = projectRequiredIdentifier(snapshot.run.sessionId);
    let applicationVersion: string | undefined;
    try {
      applicationVersion = this.options.applicationVersion?.();
    } catch {
      applicationVersion = undefined;
    }

    const sources = snapshot.sources;
    const projectedSources: RunDiagnosticPackage['sources'] = {
      integrity: sources.integrity,
      fixedContext: {
        state: sources.fixedContext.state,
        ...(projectIdentifier(sources.fixedContext.taskContextRevisionId)
          ? { taskContextRevisionId: projectIdentifier(sources.fixedContext.taskContextRevisionId) }
          : {}),
        ...(sources.fixedContext.expert &&
        projectIdentifier(sources.fixedContext.expert.expertId) &&
        projectIdentifier(sources.fixedContext.expert.revisionId)
          ? {
              expert: {
                state: sources.fixedContext.expert.state,
                expertId: projectIdentifier(sources.fixedContext.expert.expertId) ?? '',
                revisionId: projectIdentifier(sources.fixedContext.expert.revisionId) ?? '',
                ...(sources.fixedContext.expert.revision === undefined
                  ? {}
                  : { revision: sources.fixedContext.expert.revision }),
              },
            }
          : {}),
        ...(sources.fixedContext.model?.snapshot?.fingerprint
          ? {
              model: {
                ...(projectHash(sources.fixedContext.model.snapshot.fingerprint)
                  ? { fingerprint: projectHash(sources.fixedContext.model.snapshot.fingerprint) }
                  : {}),
              },
            }
          : {}),
        skills: sources.fixedContext.skills.flatMap((skill) => {
          const skillRevisionId = projectIdentifier(skill.skillRevisionId);
          const profileRevisionId = projectIdentifier(skill.profileRevisionId);
          return skillRevisionId && profileRevisionId
            ? [{ skillRevisionId, profileRevisionId, state: skill.state }]
            : [];
        }),
      },
      materials: {
        state: sources.materials.state,
        selected: sources.materials.selected.map((selection) => ({
          reference: projectReference(selection.reference),
          purpose: selection.purpose,
          wasRead: selection.wasRead,
        })),
        reads: sources.materials.reads.map((read) => ({
          reference: projectReference(read.reference),
          operation: read.operation,
          ...(projectHash(read.contentHash) ? { contentHash: projectHash(read.contentHash) } : {}),
          ...(projectHash(read.excerptHash) ? { excerptHash: projectHash(read.excerptHash) } : {}),
          capturedAt: read.capturedAt,
          ...(projectIdentifier(read.toolCallId)
            ? { toolCallId: projectIdentifier(read.toolCallId) }
            : {}),
        })),
      },
      memory: {
        state: sources.memory.state,
        ...(sources.memory.recallVersion === undefined
          ? {}
          : { recallVersion: sources.memory.recallVersion }),
        ...(sources.memory.phase === undefined ? {} : { phase: sources.memory.phase }),
        selectedItems: sources.memory.selectedItems.flatMap((item) => {
          const memoryId = projectIdentifier(item.memoryId);
          const revisionId = projectIdentifier(item.revisionId);
          const contentHash = projectHash(item.contentHash);
          return memoryId && revisionId && contentHash
            ? [{ memoryId, revisionId, contentHash, order: item.order, reason: item.reason }]
            : [];
        }),
        readCount: sources.memory.reads.length,
        replayCount: sources.memory.replay.length,
      },
      continuity: {
        state: sources.continuity.state,
        ...(projectIdentifier(sources.continuity.revisionId)
          ? { revisionId: projectIdentifier(sources.continuity.revisionId) }
          : {}),
        ...(projectHash(sources.continuity.briefHash)
          ? { briefHash: projectHash(sources.continuity.briefHash) }
          : {}),
        ...(sources.continuity.preparedAt === undefined
          ? {}
          : { preparedAt: sources.continuity.preparedAt }),
        ...(sources.continuity.firstProviderRequestAt === undefined
          ? {}
          : { firstProviderRequestAt: sources.continuity.firstProviderRequestAt }),
        omissions: sources.continuity.omissions,
        sourceRunIds: sources.continuity.sourceRunIds.flatMap((id) => {
          const projected = projectIdentifier(id);
          return projected ? [projected] : [];
        }),
        artifactVersionIds: sources.continuity.artifactVersionIds.flatMap((id) => {
          const projected = projectIdentifier(id);
          return projected ? [projected] : [];
        }),
      },
      artifacts: {
        state: sources.artifacts.state,
        producedVersions: sources.artifacts.producedVersions.flatMap((version) => {
          const artifactId = projectIdentifier(version.artifactId);
          const versionId = projectIdentifier(version.versionId);
          if (!artifactId || !versionId) return [];
          return [
            {
              artifactId,
              versionId,
              versionNumber: version.versionNumber,
              origin: version.origin,
              createdAt: version.createdAt,
              ...(projectHash(version.contentHash)
                ? { contentHash: projectHash(version.contentHash) }
                : {}),
            },
          ];
        }),
        inputRelations: sources.artifacts.inputRelations.flatMap((relation) => {
          const outputVersionId = projectIdentifier(relation.outputVersionId);
          return outputVersionId
            ? [
                {
                  outputVersionId,
                  input: projectReference(relation.input),
                  relation: relation.relation,
                  createdAt: relation.createdAt,
                },
              ]
            : [];
        }),
      },
    };
    if (sourcesRedacted && projectedSources.integrity !== 'unavailable') {
      projectedSources.integrity = 'partial';
    }

    const packageData: RunDiagnosticPackage = runDiagnosticPackageSchema.parse({
      schemaVersion: RUN_DIAGNOSTIC_PACKAGE_SCHEMA_VERSION,
      generatedAt: this.options.now?.() ?? Date.now(),
      ...(applicationVersion && /^[A-Za-z0-9.+-]{1,64}$/u.test(applicationVersion)
        ? { applicationVersion }
        : {}),
      run: {
        id: runId,
        taskId,
        sessionId,
        status: snapshot.run.status,
        createdAt: snapshot.run.createdAt,
        ...(snapshot.run.completedAt === undefined
          ? {}
          : { completedAt: snapshot.run.completedAt }),
      },
      diagnostics: {
        integrity: diagnosticsRedacted
          ? snapshot.diagnostics?.summary.integrity === 'unavailable'
            ? 'unavailable'
            : 'partial'
          : (snapshot.diagnostics?.summary.integrity ?? 'unavailable'),
        ...(snapshot.diagnostics
          ? {
              summary: {
                modelCallCount: snapshot.diagnostics.summary.modelCallCount,
                toolCallCount: snapshot.diagnostics.summary.toolCallCount,
                toolExecutionCount: snapshot.diagnostics.summary.toolExecutionCount,
                failedToolExecutionCount: snapshot.diagnostics.summary.failedToolExecutionCount,
                rejectedToolCallCount: snapshot.diagnostics.summary.rejectedToolCallCount,
                usage: snapshot.diagnostics.summary.usage,
              },
            }
          : {}),
        nodes: (snapshot.diagnostics?.nodes ?? []).flatMap((node) => {
          const projected = projectNode(node);
          return projected ? [projected] : [];
        }),
      },
      ...(snapshot.issueMark
        ? {
            issueMark: {
              category: snapshot.issueMark.category,
              ...(projectIdentifier(snapshot.issueMark.diagnosticNodeId, true)
                ? { diagnosticNodeId: projectIdentifier(snapshot.issueMark.diagnosticNodeId, true) }
                : {}),
            },
          }
        : {}),
      sources: projectedSources,
    });
    return serializeRunDiagnosticPackage(packageData);
  }
}
