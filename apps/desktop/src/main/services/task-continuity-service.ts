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
}
