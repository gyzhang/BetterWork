import type Database from 'better-sqlite3';

import { openAppDatabase } from '../db';
import { CredentialMigrationJournalRepository } from '../db/credential-migration-journal';
import type { SafeStorageAdapter } from '../infrastructure/credential-store';
import { ArtifactInputRelationRepository } from './artifact-input-relation-repository';
import { ArtifactRepository } from './artifact-repository';
import { type CredentialOwnerRef, CredentialRepository } from './credential-repository';
import { DependencyOperationRepository } from './dependency-operation-repository';
import { DependencySnapshotRepository } from './dependency-snapshot-repository';
import { DiscussionCheckpointRepository } from './discussion-checkpoint-repository';
import { EvidenceRepository } from './evidence-repository';
import { ExpertRepository } from './expert-repository';
import { InputSnapshotRepository } from './input-snapshot-repository';
import { McpConnectionRepository } from './mcp-connection-repository';
import { MemoryExtractionRepository } from './memory-extraction-repository';
import { MemoryOperationRepository } from './memory-operation-repository';
import { MemoryRepository } from './memory-repository';
import { ModelRepository } from './model-repository';
import { NotificationRepository } from './notification-repository';
import { ResearchDraftOperationRepository } from './research-draft-operation-repository';
import { RunArtifactSourceDeclarationRepository } from './run-artifact-source-declaration-repository';
import { RunContextSnapshotRepository } from './run-context-snapshot-repository';
import { RunMaterialReadRepository } from './run-material-read-repository';
import { RunMemoryContextRepository } from './run-memory-context-repository';
import { RunRepository } from './run-repository';
import { RuntimeEnvironmentRepository } from './runtime-environment-repository';
import { SearchEngineRepository } from './search-engine-repository';
import { SkillExecutionRepository } from './skill-execution-repository';
import { SkillRepository } from './skill-repository';
import { TaskContextRepository } from './task-context-repository';
import { TaskRepository } from './task-repository';
import { WorkspaceReferenceRepository } from './workspace-reference-repository';
import { WorkspaceRepository } from './workspace-repository';

/**
 * 应用状态的持久化入口，取代此前的 RunJournal「上帝对象」。
 *
 * 约定：
 * - 每个 Repository 只写自己的聚合表，但都可以读其他表做存在性与归属校验；
 * - 跨聚合的写入由调用方（Service 或 IPC 层）用 `transaction()` 显式包起来，
 *   Repository 之间不互相持有引用，避免形成隐式依赖网；
 * - 所有 Repository 共用同一个 better-sqlite3 连接，因此事务是连接级、天然共享的。
 */
export class AppStore {
  readonly workspaces: WorkspaceRepository;
  readonly tasks: TaskRepository;
  readonly taskContexts: TaskContextRepository;
  readonly runs: RunRepository;
  readonly runContextSnapshots: RunContextSnapshotRepository;
  readonly materialReads: RunMaterialReadRepository;
  readonly evidence: EvidenceRepository;
  readonly experts: ExpertRepository;
  readonly inputSnapshots: InputSnapshotRepository;
  readonly artifacts: ArtifactRepository;
  readonly artifactInputRelations: ArtifactInputRelationRepository;
  readonly models: ModelRepository;
  readonly memories: MemoryRepository;
  readonly mcpConnections: McpConnectionRepository;
  readonly searchEngines: SearchEngineRepository;
  readonly notifications: NotificationRepository;
  readonly skills: SkillRepository;
  readonly executions: SkillExecutionRepository;
  readonly environments: RuntimeEnvironmentRepository;
  readonly dependencyOperations: DependencyOperationRepository;
  readonly snapshots: DependencySnapshotRepository;
  readonly discussionCheckpoints: DiscussionCheckpointRepository;
  readonly memoryOperations: MemoryOperationRepository;
  readonly runMemoryContexts: RunMemoryContextRepository;
  readonly memoryExtractions: MemoryExtractionRepository;
  readonly workspaceReferences: WorkspaceReferenceRepository;
  readonly researchDraftOperations: ResearchDraftOperationRepository;
  readonly runArtifactDeclarations: RunArtifactSourceDeclarationRepository;
  /** 迁移进度日志只依赖 db，始终可用。 */
  readonly credentialJournal: CredentialMigrationJournalRepository;
  /** 凭据仓储需要 Main 注入 safeStorage 适配器；未注入时为 undefined（不加密，保持旧行为）。 */
  readonly credentials: CredentialRepository | undefined;

  private constructor(
    private readonly db: Database.Database,
    safeStorage?: SafeStorageAdapter,
  ) {
    // 凭据仓储先建：模型与搜索摘要要靠它判断「已配置凭据」，不能等明文列。
    const credentials = safeStorage ? new CredentialRepository(db, safeStorage) : undefined;
    const hasCredential = credentials
      ? (ref: CredentialOwnerRef): boolean => credentials.hasSecret(ref)
      : undefined;
    this.credentials = credentials;
    this.credentialJournal = new CredentialMigrationJournalRepository(db);
    this.workspaces = new WorkspaceRepository(db);
    this.tasks = new TaskRepository(db);
    this.taskContexts = new TaskContextRepository(db);
    this.runs = new RunRepository(db);
    this.runContextSnapshots = new RunContextSnapshotRepository(db);
    this.materialReads = new RunMaterialReadRepository(db);
    this.evidence = new EvidenceRepository(db);
    this.experts = new ExpertRepository(db);
    this.inputSnapshots = new InputSnapshotRepository(db);
    this.artifacts = new ArtifactRepository(db);
    this.artifactInputRelations = new ArtifactInputRelationRepository(db);
    this.models = new ModelRepository(db, hasCredential);
    this.memories = new MemoryRepository(db);
    this.mcpConnections = new McpConnectionRepository(db);
    this.searchEngines = new SearchEngineRepository(db, hasCredential);
    this.notifications = new NotificationRepository(db);
    this.skills = new SkillRepository(db);
    this.executions = new SkillExecutionRepository(db);
    this.environments = new RuntimeEnvironmentRepository(db);
    this.dependencyOperations = new DependencyOperationRepository(db);
    this.snapshots = new DependencySnapshotRepository(db);
    this.discussionCheckpoints = new DiscussionCheckpointRepository(db);
    this.memoryOperations = new MemoryOperationRepository(db);
    this.runMemoryContexts = new RunMemoryContextRepository(db);
    this.memoryExtractions = new MemoryExtractionRepository(db);
    this.workspaceReferences = new WorkspaceReferenceRepository(db);
    this.researchDraftOperations = new ResearchDraftOperationRepository(db);
    this.runArtifactDeclarations = new RunArtifactSourceDeclarationRepository(db);
  }

  static open(filePath: string, safeStorage?: SafeStorageAdapter): AppStore {
    return new AppStore(openAppDatabase(filePath), safeStorage);
  }

  /**
   * 跨聚合写入的统一入口。better-sqlite3 支持嵌套事务（内层降级为 SAVEPOINT），
   * 因此 Repository 内部已有的事务可以安全地被包进来。
   */
  transaction<T>(body: () => T): T {
    const run = this.db.transaction(body);
    return run();
  }

  close(): void {
    this.db.close();
  }
}

export {
  type CredentialJournalEntry,
  CredentialMigrationJournalRepository,
  type CredentialMigrationStatus,
} from '../db/credential-migration-journal';
export { ArtifactInputRelationRepository } from './artifact-input-relation-repository';
export { ArtifactRepository } from './artifact-repository';
export {
  CredentialError,
  type CredentialOwnerRef,
  CredentialRepository,
} from './credential-repository';
export {
  type CreateOperationInput,
  DependencyOperationRepository,
  isTerminalOperationStatus,
  type OperationProgressPatch,
  type OperationTerminalPatch,
} from './dependency-operation-repository';
export {
  type CreateSnapshotInput,
  DependencySnapshotRepository,
} from './dependency-snapshot-repository';
export { DiscussionCheckpointRepository } from './discussion-checkpoint-repository';
export { EvidenceRepository, type NewEvidence } from './evidence-repository';
export { type CreateExpertInput, ExpertRepository } from './expert-repository';
export {
  type CreateInputSnapshotInput,
  type InputSnapshot,
  InputSnapshotRepository,
  type InputSnapshotStatus,
} from './input-snapshot-repository';
export { McpConnectionRepository, type McpDiscoveryPatch } from './mcp-connection-repository';
export {
  type EnqueueExtractionJobInput,
  extractionSourceKey,
  type JobEnqueueOutcome,
  MemoryExtractionRepository,
  type MemoryJobListPage,
  type MemoryJobListQuery,
  MemoryJobStateConflictError,
  MemoryQueueFullError,
  type MemorySettingsWriteOutcome,
} from './memory-extraction-repository';
export {
  type ConflictDecisionInput,
  MemoryIdempotencyConflictError,
  type MemoryOperationClaim,
  type MemoryOperationInput,
  MemoryOperationRepository,
  MemoryOperationValidationError,
} from './memory-operation-repository';
export {
  deriveEffectiveStatus,
  isMemoryEffectiveAt,
  MemoryConflictError,
  type MemoryCreateInput,
  type MemoryDeletionImpact,
  type MemoryEditCommand,
  type MemoryGovernanceCommand,
  type MemoryListPage,
  type MemoryListPageQuery,
  type MemoryReadInput,
  MemoryRepository,
  MemoryScopeMismatchError,
  MemoryTerminalError,
  MemoryValidationError,
  type MemoryWriteOutcome,
  type RecallCandidateQuery,
} from './memory-repository';
export { ModelRepository, type RunnableModel } from './model-repository';
export { NotificationRepository } from './notification-repository';
export {
  materialReferenceKey,
  type RunContextSnapshot,
  RunContextSnapshotRepository,
} from './run-context-snapshot-repository';
export { RunMaterialReadRepository } from './run-material-read-repository';
export {
  RunMemoryContextRepository,
  RunMemoryPhaseError,
  type RunMemorySelectionInput,
} from './run-memory-context-repository';
export { RunRepository } from './run-repository';
export {
  type CreateEnvironmentInput,
  type EnvironmentStatusPatch,
  RuntimeEnvironmentRepository,
} from './runtime-environment-repository';
export { type EnabledSearchEngine, SearchEngineRepository } from './search-engine-repository';
export {
  type CreateBindingInput,
  type CreateExecutionInput,
  type ExecutionTerminalPatch,
  isTerminalExecutionStatus,
  SkillExecutionRepository,
} from './skill-execution-repository';
export {
  type SaveSkillInput,
  type SaveSkillProfileInput,
  type SaveSkillRevisionInput,
  type SaveSkillTrustGrantInput,
  SkillRepository,
  type SkillTrustGrantSource,
  type SkillTrustPreference,
} from './skill-repository';
export { type SaveTaskContextInput, TaskContextRepository } from './task-context-repository';
export { TaskRepository } from './task-repository';
export {
  type ReferenceWriteOutcome,
  type SetReferenceInput,
  type WorkspaceReferenceDeletionImpact,
  WorkspaceReferenceLimitError,
  WorkspaceReferenceMismatchError,
  WorkspaceReferenceRepository,
  WorkspaceReferenceUnavailableError,
} from './workspace-reference-repository';
export { WorkspaceRepository } from './workspace-repository';
