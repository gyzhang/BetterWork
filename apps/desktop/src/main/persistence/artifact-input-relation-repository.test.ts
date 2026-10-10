import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

const stores: AppStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('ArtifactInputRelationRepository', () => {
  it('projects complete output-source relations and version metadata within the Task', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.create('/tmp/source-run-query', '来源投影合成空间');
    const task = store.tasks.create(workspace.id, '本期任务', '核对来源');
    const foreign = store.tasks.create(workspace.id, '另一任务', '隔离来源');
    for (const [id, owner] of [
      ['first', task],
      ['author', task],
      ['foreign', foreign],
    ] as const) {
      store.runs.create({
        id,
        taskId: owner.task.id,
        sessionId: owner.sessionId,
        prompt: '合成来源',
        status: 'running',
        createdAt: 1,
      });
    }
    const input = {
      kind: 'knowledge-revision' as const,
      knowledgeDocumentId: 'doc',
      knowledgeRevisionId: 'revision',
      contentHash: 'hash',
      sourcePath: '/tmp/source.md',
    };
    const first = store.artifacts.saveMarkdown({
      taskId: task.task.id,
      origin: 'assistant-run',
      runId: 'first',
      title: '首期',
      content: '正文不进入元数据投影',
    });
    store.artifactInputRelations.saveForRun(
      first.currentVersionId,
      'author',
      [{ input, relation: 'data' }],
      () => true,
    );
    const followup = store.artifacts.saveMarkdown({
      artifactId: first.id,
      taskId: task.task.id,
      origin: 'assistant-run',
      runId: 'author',
      title: '续作',
      content: '另一次 Run',
    });
    store.artifactInputRelations.saveForRun(
      followup.currentVersionId,
      'author',
      [{ input, relation: 'rule' }],
      () => true,
    );
    const edited = store.artifacts.saveMarkdown({
      artifactId: first.id,
      taskId: task.task.id,
      origin: 'user-edit',
      title: '人工版',
      content: '人工修订',
    });
    store.artifactInputRelations.inheritFromVersion(
      edited.currentVersionId,
      followup.currentVersionId,
      'inherited',
    );
    const other = store.artifacts.saveMarkdown({
      taskId: foreign.task.id,
      origin: 'assistant-run',
      runId: 'foreign',
      title: '别的任务',
      content: '隔离正文',
    });
    store.artifactInputRelations.saveForRun(
      other.currentVersionId,
      'foreign',
      [{ input, relation: 'data' }],
      () => true,
    );
    expect(store.artifactInputRelations.listBySourceRun(task.task.id, 'first')).toEqual(
      store.artifactInputRelations.listByVersion(first.currentVersionId),
    );
    expect(store.artifactInputRelations.listBySourceRun(task.task.id, 'author')).toEqual(
      store.artifactInputRelations.listByVersion(followup.currentVersionId),
    );
    expect(store.artifactInputRelations.listBySourceRun(foreign.task.id, 'first')).toEqual([]);
    expect(store.artifactInputRelations.listBySourceRun(task.task.id, 'foreign')).toEqual([]);
    const versions = store.artifacts.listVersionsBySourceRun(task.task.id, 'first');
    expect(versions).toEqual([
      store.artifacts
        .listVersions(first.id)
        .find((version) => version.id === first.currentVersionId),
    ]);
    expect(versions[0]).not.toHaveProperty('content');
    expect(store.artifacts.listVersionsBySourceRun(foreign.task.id, 'first')).toEqual([]);
  });

  it('preserves historical snapshot path enrichment in the source-Run projection', () => {
    const store = AppStore.open(':memory:');
    stores.push(store);
    const workspace = store.workspaces.create('/tmp/source-run-snapshot', '快照合成空间');
    const task = store.tasks.create(workspace.id, '历史来源', '核对路径');
    store.runs.create({
      id: 'snapshot-run',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '合成快照',
      status: 'running',
      createdAt: 1,
    });
    const snapshot = store.inputSnapshots.createPreparing({
      workspaceId: workspace.id,
      sourcePath: '/tmp/original.md',
      contentHash: 'snapshot-hash',
      byteSize: 10,
      format: 'markdown',
      fileKey: 'synthetic.md',
      createdAt: 1,
    });
    const artifact = store.artifacts.saveMarkdown({
      taskId: task.task.id,
      origin: 'assistant-run',
      runId: 'snapshot-run',
      title: '历史版',
      content: '合成正文',
    });
    store.artifactInputRelations.saveForRun(
      artifact.currentVersionId,
      'snapshot-run',
      [
        {
          input: {
            kind: 'workspace-input-snapshot',
            snapshotId: snapshot.id,
            contentHash: snapshot.contentHash,
            workspaceId: workspace.id,
            format: snapshot.format,
            fileKey: snapshot.fileKey,
          },
          relation: 'data',
        },
      ],
      () => true,
    );
    expect(store.artifactInputRelations.listBySourceRun(task.task.id, 'snapshot-run')).toEqual(
      store.artifactInputRelations.listByVersion(artifact.currentVersionId),
    );
    expect(
      store.artifactInputRelations.listBySourceRun(task.task.id, 'snapshot-run')[0]?.input,
    ).toMatchObject({ sourcePath: '/tmp/original.md' });
  });

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
