import { createHash, randomUUID } from 'node:crypto';

import {
  type CreatedTask,
  type SaveTaskContinuityBriefRequest,
  saveTaskContinuityBriefRequestSchema,
  type TaskContinuityBrief,
  type TaskContinuityBriefMutationResult,
  type TaskContinuityRevision,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import {
  type AppendTaskContinuityRevisionInput,
  TaskContinuityError,
  TaskContinuityRevisionConflictError,
} from '../persistence/task-continuity-repository';

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

  getBrief(taskId: string): TaskContinuityRevision | null {
    if (!this.store.tasks.getRecentSummary(taskId)) {
      throw new TaskContinuityError('task-not-found', 'Task 不存在。');
    }
    return this.store.taskContinuity.getLatest(taskId) ?? null;
  }

  /** 只接受可编辑内容；来源与作者标签由 Main 对照当前 revision 保留或推导。 */
  saveUserBrief(input: SaveTaskContinuityBriefRequest): TaskContinuityBriefMutationResult {
    const request = saveTaskContinuityBriefRequestSchema.parse(input);
    const current = this.store.taskContinuity.getLatest(request.taskId);
    if (!current) {
      throw new TaskContinuityError(
        'revision-not-initialized',
        '此 Task 尚无连续简报；只支持新建 Task 的连续协作。',
      );
    }

    const objective =
      request.objective === current.brief.objective.text
        ? current.brief.objective
        : {
            text: request.objective,
            source: 'user-edit' as const,
            ...(current.brief.objective.sourceRunId === undefined
              ? {}
              : { sourceRunId: current.brief.objective.sourceRunId }),
          };
    const existingRequirements = new Map(
      current.brief.activeRequirements.map((requirement) => [requirement.id, requirement]),
    );
    const activeRequirements = request.activeRequirements.map((requirement) => {
      const existing =
        requirement.id === undefined ? undefined : existingRequirements.get(requirement.id);
      if (existing?.text === requirement.text) return existing;
      return {
        id: existing?.id ?? randomUUID(),
        text: requirement.text,
        authoredBy: 'user-edit' as const,
        ...(existing?.sources === undefined ? {} : { sources: existing.sources }),
      };
    });
    const existingProgress = current.brief.progress;
    const progress =
      request.progress === null
        ? undefined
        : existingProgress && this.progressEditMatches(existingProgress, request.progress)
          ? existingProgress
          : {
              authoredBy: 'user-edit' as const,
              ...request.progress,
              ...(existingProgress?.sourceRunId === undefined
                ? {}
                : { sourceRunId: existingProgress.sourceRunId }),
              ...(existingProgress?.sourcePromptHash === undefined
                ? {}
                : { sourcePromptHash: existingProgress.sourcePromptHash }),
            };
    const brief: TaskContinuityBrief = {
      schemaVersion: 1,
      objective,
      activeRequirements,
      ...(progress === undefined ? {} : { progress }),
    };
    if (current.revision !== request.expectedRevision) {
      return { kind: 'conflict', currentRevision: current.revision };
    }
    if (JSON.stringify(brief) === JSON.stringify(current.brief)) {
      return { kind: 'saved', revision: current };
    }

    try {
      const revision = this.store.taskContinuity.append({
        taskId: request.taskId,
        expectedRevision: request.expectedRevision,
        brief,
        sourceKind: 'user-edit',
      });
      return { kind: 'saved', revision };
    } catch (error) {
      if (error instanceof TaskContinuityRevisionConflictError) {
        return { kind: 'conflict', currentRevision: error.currentRevision };
      }
      throw error;
    }
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

  private progressEditMatches(
    progress: NonNullable<TaskContinuityBrief['progress']>,
    edit: NonNullable<SaveTaskContinuityBriefRequest['progress']>,
  ): boolean {
    return (
      progress.status === edit.status &&
      JSON.stringify(progress.completedActions) === JSON.stringify(edit.completedActions) &&
      progress.nextAction === edit.nextAction &&
      JSON.stringify(progress.blockers) === JSON.stringify(edit.blockers) &&
      JSON.stringify(progress.artifactVersionIds) === JSON.stringify(edit.artifactVersionIds)
    );
  }
}
