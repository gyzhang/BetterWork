import {
  countCodePoints,
  type MaterialReference,
  type MemoryDependency,
} from '@betterwork/agent-protocol';

import type { AppStore } from '../persistence';
import type { RunContextSnapshot } from '../persistence/run-context-snapshot-repository';
import type {
  ExtractionCheckpointSourceRecord,
  ExtractionRunSourceRecord,
  ExtractionSourceReader,
} from './memory-extraction-service';

/**
 * §7.2 的来源读取器：自动提炼只能读已登记实体，缺任何一环都不猜内容。
 *
 * 没有准备快照就没有「本次允许的材料」，因此 Run 来源必须挂在快照上；背景回答只在追问
 * 脱离上一轮无法独立理解时才带上，且只取上一轮最终回答，不取本轮新生成的答案。
 */

const ANAPHORIC_PROMPT = /它|这个|这些|那些|上面|刚才|继续|还是|再给一版|改一下/u;

const needsDisambiguation = (prompt: string): boolean =>
  countCodePoints(prompt) <= 24 || ANAPHORIC_PROMPT.test(prompt);

const finalAnswerOf = (
  store: AppStore,
  runId: string,
): { readonly eventId: string; readonly text: string } | undefined => {
  const events = store.runs.listEvents(runId);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'message.completed' && event.content.length > 0) {
      return { eventId: event.id, text: event.content };
    }
  }
  return undefined;
};

const previousFinalAnswer = (
  store: AppStore,
  taskId: string,
  currentRunId: string,
): { readonly runId: string; readonly eventId: string; readonly text: string } | undefined => {
  const earlier = store.runs
    .listByTask(taskId)
    .filter((run) => run.id !== currentRunId && run.status === 'completed')
    .sort((left, right) => right.createdAt - left.createdAt);
  const previous = earlier[0];
  if (!previous) return undefined;
  const answer = finalAnswerOf(store, previous.id);
  return answer ? { runId: previous.id, ...answer } : undefined;
};

/** 依赖整体继承自来源自己的运行上下文，绝不在此新挑材料或记忆（§7.2/§7.3）。 */
const dependenciesOf = (
  store: AppStore,
  runId: string,
  snapshot: RunContextSnapshot | undefined,
): {
  readonly materialDependencies: readonly MaterialReference[];
  readonly memoryDependencies: readonly MemoryDependency[];
} => {
  const union = store.runMemoryContexts.listDependencyUnion(runId);
  if (union.materials.length > 0 || union.memories.length > 0) {
    return { materialDependencies: union.materials, memoryDependencies: union.memories };
  }
  return {
    materialDependencies: snapshot?.materials.map((material) => material.reference) ?? [],
    memoryDependencies: [],
  };
};

const modelProfileIdOf = (snapshot: RunContextSnapshot): string | undefined =>
  snapshot.modelReference?.mode === 'profile' ? snapshot.modelReference.modelProfileId : undefined;

const readRunSource = (store: AppStore, runId: string): ExtractionRunSourceRecord | undefined => {
  const run = store.runs.get(runId);
  const snapshot = store.runContextSnapshots.get(runId);
  if (!run || !snapshot) return undefined;
  const dependencies = dependenciesOf(store, runId, snapshot);
  const background = needsDisambiguation(run.prompt)
    ? previousFinalAnswer(store, snapshot.taskId, runId)
    : undefined;
  const profileId = modelProfileIdOf(snapshot);
  return {
    kind: 'run',
    runId,
    taskId: snapshot.taskId,
    workspaceId: snapshot.workspaceId,
    completed: run.status === 'completed',
    prompt: run.prompt,
    ...(background ? { backgroundAnswer: background } : {}),
    ...(profileId ? { modelProfileId: profileId } : {}),
    materialDependencies: dependencies.materialDependencies,
    memoryDependencies: dependencies.memoryDependencies,
  };
};

/**
 * §7.1：没有来源 Run 的讨论反馈用「当前 TaskContext 的模型」——先取该上下文自己钉住的
 * profile，再退到上下文执行专家修订的默认值；两处都缺省才交给应用级默认语言模型。
 * 这里只回传 profile id：应用级默认与「专家说用应用级默认」在解析结果上是同一个模型。
 */
const taskContextModelProfileId = (store: AppStore, taskId: string): string | undefined => {
  const context = store.taskContexts.getLatest(taskId);
  if (!context) return undefined;
  const revision =
    context.executor.kind === 'expert'
      ? store.experts.getRevision(context.executor.expertId, context.executor.expertRevisionId)
      : undefined;
  const reference = context.modelReference ?? revision?.modelReference;
  return reference?.mode === 'profile' ? reference.modelProfileId : undefined;
};

const readCheckpointSource = (
  store: AppStore,
  checkpointId: string,
): ExtractionCheckpointSourceRecord | undefined => {
  const checkpoint = store.discussionCheckpoints.get(checkpointId);
  if (!checkpoint) return undefined;
  const workspaceId = store.tasks.getWorkspaceId(checkpoint.taskId);
  if (!workspaceId) return undefined;
  const runId = checkpoint.runId;
  const snapshot = runId ? store.runContextSnapshots.get(runId) : undefined;
  const dependencies = runId
    ? dependenciesOf(store, runId, snapshot)
    : { materialDependencies: [] as readonly MaterialReference[], memoryDependencies: [] };
  const profileId = runId
    ? snapshot
      ? modelProfileIdOf(snapshot)
      : undefined
    : taskContextModelProfileId(store, checkpoint.taskId);
  return {
    kind: 'checkpoint',
    checkpointId,
    taskId: checkpoint.taskId,
    workspaceId,
    ...(checkpoint.feedback ? { feedback: checkpoint.feedback } : {}),
    ...(checkpoint.summary ? { summary: checkpoint.summary } : {}),
    ...(profileId ? { modelProfileId: profileId } : {}),
    materialDependencies: dependencies.materialDependencies,
    memoryDependencies: dependencies.memoryDependencies,
  };
};

export const createStoreExtractionSourceReader = (store: AppStore): ExtractionSourceReader => ({
  readSource: (source) =>
    source.kind === 'run'
      ? readRunSource(store, source.runId)
      : readCheckpointSource(store, source.checkpointId),
});
