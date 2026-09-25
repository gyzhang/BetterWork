import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ExpertRevisionDraft } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { resolveArtifactVersionExecutor } from './artifact-version-executor';

/** MI08：「从此版本开始新任务」的默认身份只能来自精确版本的来源 Run 快照。 */

const stores: AppStore[] = [];
const directories: string[] = [];

const expertRevision: ExpertRevisionDraft = {
  name: '经营分析专家',
  summary: '按用户口径完成经营分析',
  identity: '负责经营分析。',
  principles: [],
  inputRequirements: [],
  deliveryRequirements: [],
  skillPreset: [],
  builtinToolPolicy: { mode: 'application-defaults' },
  modelReference: { mode: 'application-default' },
};

const openWorld = async (): Promise<{
  store: AppStore;
  workspaceId: string;
  taskId: string;
  sessionId: string;
  expertId: string;
  expertRevisionId: string;
}> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'betterwork-mi08-'));
  directories.push(directory);
  const store = AppStore.open(path.join(directory, 'app.db'));
  stores.push(store);
  const workspaceId = store.workspaces.getOrCreate('/tmp/mi08/空间', 'MI08 空间').id;
  const task = store.tasks.create(workspaceId, '两期经营复盘', '产出本期结论');
  const expert = store.experts.create({ sourceKind: 'user', revision: expertRevision });
  return {
    store,
    workspaceId,
    taskId: task.task.id,
    sessionId: task.sessionId,
    expertId: expert.id,
    expertRevisionId: expert.revision.id,
  };
};

const saveVersion = (
  store: AppStore,
  input: {
    taskId: string;
    runId: string;
    content: string;
    artifactId?: string;
    origin?: 'assistant-run' | 'user-edit';
  },
): string => {
  const saved = store.artifacts.saveMarkdown(
    {
      ...(input.artifactId === undefined ? {} : { artifactId: input.artifactId }),
      taskId: input.taskId,
      title: '经营复盘',
      content: input.content,
      origin: input.origin ?? 'assistant-run',
      runId: input.runId,
    },
    'model',
  );
  const detail = store.artifacts.getDetail(saved.id);
  if (!detail) throw new Error('成果未落库。');
  return detail.currentVersionId;
};

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('resolveArtifactVersionExecutor', () => {
  it('从来源 Run 快照读出专家身份，并单独标明当前修订', async () => {
    const { store, taskId, sessionId, workspaceId, expertId, expertRevisionId } = await openWorld();
    const runId = randomUUID();
    store.runs.create({
      id: runId,
      taskId,
      sessionId,
      prompt: '产出本期结论',
      status: 'completed',
      createdAt: 1,
    });
    store.runContextSnapshots.create({
      runId,
      taskId,
      workspaceId,
      expertId,
      expertRevisionId,
      contextSegmentId: 'segment-1',
      materials: [],
      createdAt: 2,
    });
    const versionId = saveVersion(store, { taskId, runId, content: '# 本期结论' });
    const artifactId = store.artifacts.list(taskId)[0]?.id;
    if (artifactId === undefined) throw new Error('缺少成果。');

    expect(
      resolveArtifactVersionExecutor(store, { artifactId, artifactVersionId: versionId }),
    ).toEqual({
      kind: 'expert',
      sourceRunId: runId,
      expertId,
      sourceExpertRevisionId: expertRevisionId,
      currentExpertRevisionId: expertRevisionId,
      name: '经营分析专家',
    });
  });

  it('user-edit 版本沿前版回溯；断链或缺快照只回 unavailable，绝不取 latest', async () => {
    const { store, taskId, sessionId, workspaceId, expertId, expertRevisionId } = await openWorld();
    const runId = randomUUID();
    store.runs.create({
      id: runId,
      taskId,
      sessionId,
      prompt: '产出本期结论',
      status: 'completed',
      createdAt: 1,
    });
    store.runContextSnapshots.create({
      runId,
      taskId,
      workspaceId,
      expertId,
      expertRevisionId,
      contextSegmentId: 'segment-1',
      materials: [],
      createdAt: 2,
    });
    const firstVersion = saveVersion(store, { taskId, runId, content: '# 初版' });
    const artifactId = store.artifacts.list(taskId)[0]?.id;
    if (artifactId === undefined) throw new Error('缺少成果。');
    const editedVersion = saveVersion(store, {
      taskId,
      runId,
      artifactId,
      origin: 'user-edit',
      content: '# 人工修订',
    });
    // 初版自身也直接命中同一来源 Run，证明回溯不是只对新版本生效。
    expect(
      resolveArtifactVersionExecutor(store, { artifactId, artifactVersionId: firstVersion })?.kind,
    ).toBe('expert');
    const inherited = resolveArtifactVersionExecutor(store, {
      artifactId,
      artifactVersionId: editedVersion,
    });
    expect(inherited?.kind).toBe('expert');
    if (inherited?.kind !== 'expert') return;
    expect(inherited.sourceRunId).toBe(runId);

    // 人工编辑但整条链没有登记来源 Run：不可证明，而不是当成通用。
    const orphanRunId = randomUUID();
    store.runs.create({
      id: orphanRunId,
      taskId,
      sessionId,
      prompt: '无快照的运行',
      status: 'completed',
      createdAt: 3,
    });
    const orphanVersion = saveVersion(store, {
      taskId,
      runId: orphanRunId,
      content: '# 缺快照',
    });
    const orphanArtifact = store.artifacts.list(taskId).find((item) => item.id !== artifactId);
    expect(
      resolveArtifactVersionExecutor(store, {
        artifactId: orphanArtifact?.id ?? '',
        artifactVersionId: orphanVersion,
      }),
    ).toEqual({ kind: 'unavailable', reason: 'source-unavailable' });
  });

  /** MI08 AC5：真实通用运行与「无法证明来源身份」是两件事，混为一谈会让界面说不出原因。 */
  it('通用助手跑出的版本返回 general，而不是 unavailable', async () => {
    const { store, taskId, sessionId, workspaceId } = await openWorld();
    const generalRunId = randomUUID();
    store.runs.create({
      id: generalRunId,
      taskId,
      sessionId,
      prompt: '产出本期结论',
      status: 'completed',
      createdAt: 1,
    });
    store.runContextSnapshots.create({
      runId: generalRunId,
      taskId,
      workspaceId,
      contextSegmentId: 'segment-general',
      materials: [],
      createdAt: 2,
    });
    const versionId = saveVersion(store, { taskId, runId: generalRunId, content: '# 通用结论' });
    const artifactId = store.artifacts.list(taskId)[0]?.id;
    if (artifactId === undefined) throw new Error('缺少成果。');
    expect(
      resolveArtifactVersionExecutor(store, { artifactId, artifactVersionId: versionId }),
    ).toEqual({ kind: 'general', sourceRunId: generalRunId });
  });

  it('来源专家被停用或版本不属于该成果时分别拒绝', async () => {
    const { store, taskId, sessionId, workspaceId, expertId, expertRevisionId } = await openWorld();
    const runId = randomUUID();
    store.runs.create({
      id: runId,
      taskId,
      sessionId,
      prompt: '产出本期结论',
      status: 'completed',
      createdAt: 1,
    });
    store.runContextSnapshots.create({
      runId,
      taskId,
      workspaceId,
      expertId,
      expertRevisionId,
      contextSegmentId: 'segment-1',
      materials: [],
      createdAt: 2,
    });
    const versionId = saveVersion(store, { taskId, runId, content: '# 本期结论' });
    const artifactId = store.artifacts.list(taskId)[0]?.id;
    if (artifactId === undefined) throw new Error('缺少成果。');
    // 版本与成果不匹配：与「不存在」同一形状，不泄露该版本是否存在。
    expect(
      resolveArtifactVersionExecutor(store, {
        artifactId: 'other-artifact',
        artifactVersionId: versionId,
      }),
    ).toBeNull();

    store.experts.setLifecycle(expertId, 'disabled', 1);
    expect(
      resolveArtifactVersionExecutor(store, { artifactId, artifactVersionId: versionId }),
    ).toEqual({ kind: 'unavailable', reason: 'expert-unavailable' });
  });
});
