import { randomUUID } from 'node:crypto';

import { analyzeBusinessMetrics } from '@betterwork/tool-runtime';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { DiscussionCheckpointService } from './discussion-checkpoint-service';

const stores: AppStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('Expert two-period acceptance path', () => {
  it('keeps tasks independent while the second report cites the first version', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/two-periods', '经营分析');
    const firstTask = store.tasks.create(workspace.id, '2026-08 月报', '完成 8 月经营分析');
    const secondTask = store.tasks.create(workspace.id, '2026-09 月报', '完成 9 月经营分析');
    expect(firstTask.task.id).not.toBe(secondTask.task.id);
    expect(firstTask.sessionId).not.toBe(secondTask.sessionId);

    const firstRunId = randomUUID();
    const secondRunId = randomUUID();
    store.runs.create({
      id: firstRunId,
      taskId: firstTask.task.id,
      sessionId: firstTask.sessionId,
      prompt: '生成 8 月报告',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });
    store.runs.create({
      id: secondRunId,
      taskId: secondTask.task.id,
      sessionId: secondTask.sessionId,
      prompt: '基于 8 月报告生成 9 月报告',
      status: 'completed',
      createdAt: 3,
      completedAt: 4,
    });
    const firstArtifact = store.artifacts.saveMarkdown({
      taskId: firstTask.task.id,
      runId: firstRunId,
      title: '8 月经营报告',
      content: '# 8 月经营报告\n\n收入 100',
      origin: 'assistant-run',
    });
    const firstVersion = store.artifacts.getVersionDetail(firstArtifact.currentVersionId);
    if (!firstVersion || firstVersion.type !== 'markdown')
      throw new Error('first artifact missing');
    const expert = store.experts.create({
      sourceKind: 'user',
      revision: {
        name: '经营分析专家',
        summary: '复用规则和历史报告完成月度分析',
        identity: '负责月度经营分析和报告交付。',
        principles: ['先核对规则，再比较期间数据'],
        inputRequirements: ['本期经营数据'],
        deliveryRequirements: ['交付可追溯报告'],
        skillPreset: [],
        builtinToolPolicy: { mode: 'allow-list', toolNames: ['analyze_business_metrics'] },
        modelReference: { mode: 'application-default' },
        referenceMaterials: [
          {
            reference: {
              kind: 'artifact-version',
              artifactId: firstArtifact.id,
              artifactVersionId: firstVersion.id,
              contentHash: firstVersion.contentHash,
              originWorkspaceId: workspace.id,
            },
            purpose: 'historical-comparison',
          },
        ],
      },
    });
    const confirmedMethod = store.memories.create({
      scope: { kind: 'expert-workspace', expertId: expert.id, workspaceId: workspace.id },
      kind: 'procedural',
      content: '先核对财务规则，再比较期间变化。',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });
    const otherWorkspace = store.workspaces.getOrCreate('/tmp/two-periods-other', '其他公司');
    const otherCompanyMethod = store.memories.create({
      scope: { kind: 'expert-workspace', expertId: expert.id, workspaceId: otherWorkspace.id },
      kind: 'procedural',
      content: '其他公司的经营分析方法。',
      sourceType: 'user-explicit',
      status: 'confirmed',
    });
    expect(store.memories.listApplicable(workspace.id, expert.id)).toContainEqual(confirmedMethod);
    expect(store.memories.listApplicable(workspace.id, expert.id)).not.toContainEqual(
      otherCompanyMethod,
    );
    const secondContext = store.taskContexts.save(secondTask.task.id, {
      executor: {
        kind: 'expert',
        expertId: expert.id,
        expertRevisionId: expert.revision.id,
      },
      skillBindings: [],
      materials: [
        {
          reference: {
            kind: 'artifact-version',
            artifactId: firstArtifact.id,
            artifactVersionId: firstVersion.id,
            contentHash: firstVersion.contentHash,
            originWorkspaceId: workspace.id,
          },
          purpose: 'historical-comparison',
          addedFrom: 'expert-reference',
        },
      ],
    });
    expect(secondContext.executor).toEqual({
      kind: 'expert',
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
    });
    expect(secondContext.materials).toEqual([
      expect.objectContaining({
        reference: expect.objectContaining({ artifactVersionId: firstVersion.id }),
        addedFrom: 'expert-reference',
      }),
    ]);
    store.runContextSnapshots.create({
      runId: secondRunId,
      taskId: secondTask.task.id,
      workspaceId: workspace.id,
      taskContextRevisionId: secondContext.id,
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
      contextSegmentId: 'segment-september-report',
      materials: secondContext.materials ?? [],
      createdAt: 3,
    });
    expect(store.runContextSnapshots.get(secondRunId)).toMatchObject({
      expertId: expert.id,
      expertRevisionId: expert.revision.id,
      taskContextRevisionId: secondContext.id,
    });
    store.memories.recordReads([{ runId: secondRunId, memory: confirmedMethod, capturedAt: 3 }]);
    expect(store.memories.listReads(secondRunId)).toEqual([confirmedMethod]);
    const secondArtifact = store.artifacts.saveMarkdown({
      taskId: secondTask.task.id,
      runId: secondRunId,
      title: '9 月经营报告',
      content: '# 9 月经营报告\n\n收入 120',
      origin: 'assistant-run',
    });
    store.artifactInputRelations.saveForRun(
      secondArtifact.currentVersionId,
      secondRunId,
      [
        {
          input: {
            kind: 'artifact-version',
            artifactId: firstArtifact.id,
            artifactVersionId: firstVersion.id,
            contentHash: firstVersion.contentHash,
            originWorkspaceId: workspace.id,
          },
          relation: 'comparison',
        },
      ],
      () => true,
    );
    const checkpoints = new DiscussionCheckpointService(store);
    checkpoints.create(secondTask.task.id, {
      id: 'checkpoint-september-report',
      taskId: secondTask.task.id,
      runId: secondRunId,
      stage: 'report',
      title: '9 月报告完成',
      summary: '收入环比上升，已关联 8 月版本。',
      artifactVersionIds: [secondArtifact.currentVersionId],
    });

    const result = analyzeBusinessMetrics({
      period: '2026-09',
      current: { revenue: 120 },
      previous: { revenue: 100 },
    });
    expect(result.metrics[0]).toMatchObject({ metric: 'revenue', change: 20, changeRate: 0.2 });
    expect(store.discussionCheckpoints.listByTask(firstTask.task.id)).toEqual([]);
    expect(
      store.artifactInputRelations.listByVersion(secondArtifact.currentVersionId),
    ).toHaveLength(1);
  });
});
