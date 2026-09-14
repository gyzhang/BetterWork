import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('ArtifactInputRelationRepository', () => {
  it('relates a generated ArtifactVersion only to a material read by its Run', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/betterwork-relation-test', '测试工作区');
    const task = store.tasks.create(workspace.id, '测试任务', '验证成果来源');
    const runId = 'run-relation-1';
    store.runs.create({
      id: runId,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '生成成果',
      status: 'running',
      createdAt: 1,
    });
    const material = {
      kind: 'knowledge-revision' as const,
      knowledgeDocumentId: 'doc-1',
      knowledgeRevisionId: 'revision-1',
      contentHash: 'hash-1',
      sourcePath: '/tmp/rules.md',
    };
    store.materialReads.save({
      id: 'read-relation-1',
      runId,
      material,
      operation: 'search',
      locator: '全文',
      contentHash: material.contentHash,
      capturedAt: 2,
    });
    const artifact = store.artifacts.saveMarkdown({
      taskId: task.task.id,
      origin: 'assistant-run',
      runId,
      title: '经营报告',
      content: '报告正文',
    });
    const relations = store.artifactInputRelations.saveForRun(
      artifact.currentVersionId,
      runId,
      [{ input: material, relation: 'rule' }],
      (input) =>
        store.materialReads.hasMaterialRead(runId, JSON.stringify(input), material.contentHash),
    );

    expect(relations).toHaveLength(1);
    expect(store.artifactInputRelations.listByVersion(artifact.currentVersionId)).toEqual([
      expect.objectContaining({
        outputVersionId: artifact.currentVersionId,
        input: material,
        relation: 'rule',
      }),
    ]);
  });

  it('rejects an input that has not been read by the producing Run', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/betterwork-relation-test-2', '测试工作区');
    const task = store.tasks.create(workspace.id, '测试任务', '验证来源拒绝');
    const runId = 'run-relation-2';
    store.runs.create({
      id: runId,
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '生成成果',
      status: 'running',
      createdAt: 1,
    });
    const artifact = store.artifacts.saveMarkdown({
      taskId: task.task.id,
      origin: 'assistant-run',
      runId,
      title: '经营报告',
      content: '报告正文',
    });
    expect(() =>
      store.artifactInputRelations.saveForRun(
        artifact.currentVersionId,
        runId,
        [
          {
            input: {
              kind: 'knowledge-revision',
              knowledgeDocumentId: 'doc-1',
              knowledgeRevisionId: 'revision-1',
              contentHash: 'missing',
              sourcePath: '/tmp/missing.md',
            },
            relation: 'background',
          },
        ],
        () => false,
      ),
    ).toThrow('must be read');
  });

  it('rejects an output version produced by another Run', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.getOrCreate('/tmp/betterwork-relation-test-3', '测试工作区');
    const firstTask = store.tasks.create(workspace.id, '任务一', '验证来源归属');
    const secondTask = store.tasks.create(workspace.id, '任务二', '验证来源归属');
    const firstRunId = 'run-relation-owner-1';
    const secondRunId = 'run-relation-owner-2';
    store.runs.create({
      id: firstRunId,
      taskId: firstTask.task.id,
      sessionId: firstTask.sessionId,
      prompt: '生成成果一',
      status: 'running',
      createdAt: 1,
    });
    store.runs.create({
      id: secondRunId,
      taskId: secondTask.task.id,
      sessionId: secondTask.sessionId,
      prompt: '生成成果二',
      status: 'running',
      createdAt: 2,
    });
    const artifact = store.artifacts.saveMarkdown({
      taskId: firstTask.task.id,
      origin: 'assistant-run',
      runId: firstRunId,
      title: '经营报告',
      content: '报告正文',
    });

    expect(() =>
      store.artifactInputRelations.saveForRun(
        artifact.currentVersionId,
        secondRunId,
        [],
        () => true,
      ),
    ).toThrow('Artifact version does not belong to source Run');
  });
});
