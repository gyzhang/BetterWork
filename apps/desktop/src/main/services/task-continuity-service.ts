import { createHash } from 'node:crypto';

import type { CreatedTask, TaskContinuityRevision } from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import type { AppendTaskContinuityRevisionInput } from '../persistence/task-continuity-repository';

/** Main 侧编排 Task 创建与首个 continuity revision 的同事务提交。 */
export class TaskContinuityService {
  constructor(private readonly store: AppStore) {}

  createTask(workspaceId: string, title: string, goal: string): CreatedTask {
    return this.store.transaction(() => {
      const created = this.store.tasks.create(workspaceId, title, goal);
      this.store.taskContinuity.initializeFromTaskGoal(created.task.id);
      return created;
    });
  }

  appendRevision(input: AppendTaskContinuityRevisionInput): TaskContinuityRevision {
    return this.store.taskContinuity.append(input);
  }

  /** 从已落库的 completed Run 与 ArtifactVersion 生成不含模型语义的确定性进度。 */
  recordCompletedRunProgress(input: {
    taskId: string;
    runId: string;
    expectedRevision: number;
  }): TaskContinuityRevision {
    const run = this.store.runs.get(input.runId);
    if (!run || run.taskId !== input.taskId || run.status !== 'completed') {
      throw new Error('Task Continuity progress requires a completed Run from the same Task');
    }
    const current = this.store.taskContinuity.getLatest(input.taskId);
    if (!current) throw new Error('Task is missing its initial continuity revision');
    if (current.brief.progress?.authoredBy === 'user-edit') return current;
    const promptHash = createHash('sha256').update(run.prompt).digest('hex');
    return this.store.taskContinuity.append({
      taskId: input.taskId,
      expectedRevision: input.expectedRevision,
      brief: {
        ...current.brief,
        progress: {
          authoredBy: 'assistant-summary',
          status: 'in-progress',
          completedActions: [`Run ${run.id} 已进入 completed 终态。`],
          blockers: [],
          artifactVersionIds: this.store.artifacts.listVersionIdsBySourceRun(
            input.taskId,
            input.runId,
          ),
          sourceRunId: input.runId,
          sourcePromptHash: promptHash,
        },
      },
      sourceKind: 'assistant-summary',
      sourceRunId: input.runId,
    });
  }
}
