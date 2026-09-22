import { describeError } from '@betterwork/agent-core';
import type { CreateDiscussionCheckpointRequest, DiscussionCheckpoint } from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';

/**
 * 讨论节点只声明「有可提炼的人工反馈」，不拥有提炼逻辑：
 * 入队失败或队列已满都不改节点写入结果（契约 §7.3）。
 */
export interface CheckpointExtractionRequester {
  requestExtractionForCheckpoint(checkpointId: string): Promise<unknown>;
}

export class DiscussionCheckpointService {
  constructor(
    private readonly store: AppStore,
    private readonly extractionRequester?: CheckpointExtractionRequester,
  ) {}

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
    const checkpoint = this.store.discussionCheckpoints.create(taskId, input);
    // summary 只是背景，不能证明确认；只有人工 feedback 才构成自动提炼的触发来源。
    if (this.extractionRequester && (input.feedback?.trim() ?? '').length > 0) {
      const requester = this.extractionRequester;
      void requester
        .requestExtractionForCheckpoint(checkpoint.id)
        .catch((error: unknown) => {
          console.error('[memory-extraction] 讨论节点入队失败：', describeError(error));
        });
    }
    return checkpoint;
  }

  private assertTask(taskId: string): void {
    if (!this.store.tasks.getWorkspaceId(taskId)) throw new Error('Task does not exist');
  }
}
