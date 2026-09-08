import type Database from 'better-sqlite3';

import { openAppDatabase } from '../db';
import { ArtifactRepository } from './artifact-repository';
import { EvidenceRepository } from './evidence-repository';
import { ModelRepository } from './model-repository';
import { NotificationRepository } from './notification-repository';
import { RunRepository } from './run-repository';
import { SearchEngineRepository } from './search-engine-repository';
import { SkillExecutionRepository } from './skill-execution-repository';
import { SkillRepository } from './skill-repository';
import { TaskRepository } from './task-repository';
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
  readonly runs: RunRepository;
  readonly evidence: EvidenceRepository;
  readonly artifacts: ArtifactRepository;
  readonly models: ModelRepository;
  readonly searchEngines: SearchEngineRepository;
  readonly notifications: NotificationRepository;
  readonly skills: SkillRepository;
  readonly executions: SkillExecutionRepository;

  private constructor(private readonly db: Database.Database) {
    this.workspaces = new WorkspaceRepository(db);
    this.tasks = new TaskRepository(db);
    this.runs = new RunRepository(db);
    this.evidence = new EvidenceRepository(db);
    this.artifacts = new ArtifactRepository(db);
    this.models = new ModelRepository(db);
    this.searchEngines = new SearchEngineRepository(db);
    this.notifications = new NotificationRepository(db);
    this.skills = new SkillRepository(db);
    this.executions = new SkillExecutionRepository(db);
  }

  static open(filePath: string): AppStore {
    return new AppStore(openAppDatabase(filePath));
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

export { ArtifactRepository } from './artifact-repository';
export { EvidenceRepository, type NewEvidence } from './evidence-repository';
export { ModelRepository, type RunnableModel } from './model-repository';
export { NotificationRepository } from './notification-repository';
export { RunRepository } from './run-repository';
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
export { TaskRepository } from './task-repository';
export { WorkspaceRepository } from './workspace-repository';
