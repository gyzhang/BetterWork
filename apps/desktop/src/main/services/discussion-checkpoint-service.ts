import {
  type CreateDiscussionCheckpointRequest,
  type DiscussionCheckpoint,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';

export class DiscussionCheckpointService {
  constructor(private readonly store: AppStore) {}

  list(taskId: string): DiscussionCheckpoint[] {
    this.assertTask(taskId);
    return this.store.discussionCheckpoints.listByTask(taskId);
  }

  create(taskId: string, input: CreateDiscussionCheckpointRequest): DiscussionCheckpoint {
    this.assertTask(taskId);
    if (input.taskId !== taskId)
      throw new Error('Discussion checkpoint task does not match request');
    if (input.runId && !this.store.runs.belongsToTask(input.runId, taskId)) {
      throw new Error('Discussion checkpoint Run does not belong to Task');
    }
    if (input.supersedesId) {
      const previous = this.store.discussionCheckpoints.get(input.supersedesId);
      if (!previous || previous.taskId !== taskId) {
        throw new Error('Discussion checkpoint to supersede does not belong to Task');
      }
    }
    for (const versionId of input.artifactVersionIds) {
      const version = this.store.artifacts.getVersionDetail(versionId);
      if (!version) throw new Error(`成果版本不存在：${versionId}`);
      const artifact = this.store.artifacts.getDetail(version.artifactId);
      if (!artifact || artifact.taskId !== taskId) {
        throw new Error('讨论节点引用的成果版本不属于当前 Task');
      }
    }
    return this.store.discussionCheckpoints.create(taskId, input);
  }

  private assertTask(taskId: string): void {
    if (!this.store.tasks.getWorkspaceId(taskId)) throw new Error('Task does not exist');
  }
}
