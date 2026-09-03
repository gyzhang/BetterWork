import { afterEach, describe, expect, it } from 'vitest';
import { RunJournal } from './run-journal';

let journal: RunJournal | undefined;
afterEach(() => journal?.close());

describe('RunJournal', () => {
  it('creates a stable workspace, task, and separate session identifiers', () => {
    journal = new RunJournal(':memory:');
    const workspace = journal.getOrCreateWorkspace('/work/customer-a', '客户 A');
    const sameWorkspace = journal.getOrCreateWorkspace('/work/customer-a', '不同名称不会复制工作区');
    const created = journal.createTask(workspace.id, '季度复盘', '根据资料完成季度复盘');
    expect(sameWorkspace.id).toBe(workspace.id);
    expect(created.task).toMatchObject({ workspaceId: workspace.id, title: '季度复盘', goal: '根据资料完成季度复盘' });
    expect(created.sessionId).not.toBe(created.task.id);
    expect(() => journal!.createTask('missing-workspace', '无效任务', '不应创建')).toThrow('Workspace does not exist');
  });

  it('lists one recent task with its latest run instead of duplicate run rows', () => {
    journal = new RunJournal(':memory:');
    const workspace = journal.getOrCreateWorkspace('/work/customer-a', '客户 A');
    const task = journal.createTask(workspace.id, '季度复盘', '根据资料完成季度复盘');
    journal.createRun({ id: 'run-1', taskId: task.task.id, sessionId: task.sessionId, prompt: '第一轮', status: 'completed', createdAt: 1, completedAt: 2 });
    journal.createRun({ id: 'run-2', taskId: task.task.id, sessionId: task.sessionId, prompt: '第二轮', status: 'running', createdAt: 3 });
    expect(journal.listTasks(workspace.id)).toEqual([expect.objectContaining({ id: task.task.id, sessionId: task.sessionId, latestRun: expect.objectContaining({ id: 'run-2', prompt: '第二轮' }) })]);
  });

  it('persists deduplicated local evidence for a task', () => {
    journal = new RunJournal(':memory:');
    const workspace = journal.getOrCreateWorkspace('/work/customer-a', '客户 A');
    const task = journal.createTask(workspace.id, '季度复盘', '根据资料完成季度复盘');
    const evidence = { taskId: task.task.id, runId: 'run-1', sourceUri: '/notes/interview.md', title: '客户访谈', locator: '全文', excerpt: '续约风险需要跟进。', contentHash: 'hash-1' };
    journal.saveLocalEvidence(evidence);
    journal.saveLocalEvidence(evidence);
    expect(journal.listEvidence(task.task.id)).toEqual([expect.objectContaining({ ...evidence, sourceType: 'local-file' })]);
  });

  it('creates a Markdown artifact and appends revisions without overwriting history', () => {
    journal = new RunJournal(':memory:');
    const workspace = journal.getOrCreateWorkspace('/work/customer-a', '客户 A');
    const task = journal.createTask(workspace.id, '季度复盘', '根据资料完成季度复盘');
    journal.createRun({ id: 'run-1', taskId: task.task.id, sessionId: task.sessionId, prompt: '生成复盘', status: 'completed', createdAt: 1, completedAt: 2 });
    journal.createRun({ id: 'run-2', taskId: task.task.id, sessionId: task.sessionId, prompt: '修改复盘', status: 'completed', createdAt: 3, completedAt: 4 });
    const first = journal.saveMarkdownArtifact({ taskId: task.task.id, origin: 'assistant-run', runId: 'run-1', title: '季度复盘', content: '# 第一版' });
    const revised = journal.saveMarkdownArtifact({ artifactId: first.id, taskId: task.task.id, origin: 'assistant-run', runId: 'run-2', title: '季度复盘（修订）', content: '# 第二版' });
    const manuallyEdited = journal.saveMarkdownArtifact({ artifactId: first.id, taskId: task.task.id, origin: 'user-edit', title: '季度复盘（人工修订）', content: '# 第三版' });
    expect(first).toMatchObject({ type: 'markdown', versionNumber: 1, origin: 'assistant-run', sourceRunId: 'run-1' });
    expect(revised).toMatchObject({ id: first.id, title: '季度复盘（修订）', versionNumber: 2, origin: 'assistant-run', sourceRunId: 'run-2' });
    expect(manuallyEdited).toMatchObject({ id: first.id, title: '季度复盘（人工修订）', versionNumber: 3, origin: 'user-edit' });
    expect(manuallyEdited.sourceRunId).toBeUndefined();
    expect(journal.listArtifacts(task.task.id)).toEqual([expect.objectContaining({ id: first.id, versionNumber: 3, origin: 'user-edit' })]);
    expect(journal.getArtifactDetail(first.id)).toMatchObject({ id: first.id, content: '# 第三版', versionNumber: 3, origin: 'user-edit' });
    expect(journal.listArtifactVersions(first.id)).toEqual([
      expect.objectContaining({ versionNumber: 3, origin: 'user-edit' }),
      expect.objectContaining({ versionNumber: 2, origin: 'assistant-run', sourceRunId: 'run-2' }),
      expect.objectContaining({ versionNumber: 1, origin: 'assistant-run', sourceRunId: 'run-1' }),
    ]);
    const version = journal.listArtifactVersions(first.id).find((item) => item.versionNumber === 2);
    expect(version).toBeDefined();
    if (!version) throw new Error('Expected the second artifact version');
    expect(journal.getArtifactVersionDetail(version.id)).toMatchObject({ id: version.id, content: '# 第二版', versionNumber: 2, sourceRunId: 'run-2' });
  });

  it('persists runs and ordered events', () => {
    journal = new RunJournal(':memory:');
    journal.createRun({ id: 'run-1', taskId: 'task-1', sessionId: 'session-1', prompt: 'hello', status: 'running', createdAt: 1 });
    journal.appendEvent({ id: 'event-1', runId: 'run-1', sequence: 0, createdAt: 2, type: 'run.started', taskId: 'task-1', sessionId: 'session-1' });
    journal.appendEvent({ id: 'event-2', runId: 'run-1', sequence: 1, createdAt: 3, type: 'run.completed', finalContent: 'done' });
    expect(journal.listEvents('run-1').map((event) => event.type)).toEqual(['run.started', 'run.completed']);
    expect(journal.listRuns()[0]?.status).toBe('completed');
  });

  it('stores model credentials without returning them in summaries', () => {
    journal = new RunJournal(':memory:');
    const id = journal.saveModel({
      name: '测试模型', provider: 'openai-compatible', baseUrl: 'http://localhost:8000/v1', model: 'demo', role: 'language',
      apiKey: 'secret-value', maxContextTokens: 8192, maxOutputTokens: 1024, temperature: 0.2, enabled: true,
    });
    expect(journal.listModels()[0]).toMatchObject({ id, name: '测试模型', apiKeyConfigured: true });
    expect(journal.listModels()[0]).not.toHaveProperty('apiKey');
    expect(journal.getModel(id)?.apiKey).toBe('secret-value');
  });

  it('uses an explicitly selected enabled model as the default for its role', () => {
    journal = new RunJournal(':memory:');
    const first = journal.saveModel({ name: '第一语言模型', provider: 'openai-compatible', baseUrl: 'http://localhost:8000/v1', model: 'first', role: 'language', apiKey: '', maxContextTokens: 8192, maxOutputTokens: 1024, temperature: 0.2, enabled: true });
    const second = journal.saveModel({ name: '第二语言模型', provider: 'openai-compatible', baseUrl: 'http://localhost:8000/v1', model: 'second', role: 'language', apiKey: '', maxContextTokens: 8192, maxOutputTokens: 1024, temperature: 0.2, enabled: true });
    expect(journal.getModelForRun('language')?.id).toBe(first);
    expect(journal.setDefaultModel(second)).toBe(true);
    expect(journal.getModelForRun('language')?.id).toBe(second);
  });

  it('keeps a persisted model connection result in renderer-facing summaries', () => {
    journal = new RunJournal(':memory:');
    const id = journal.saveModel({ name: '待测试模型', provider: 'openai-compatible', baseUrl: 'http://localhost:8000/v1', model: 'test', role: 'language', apiKey: '', maxContextTokens: 8192, maxOutputTokens: 1024, temperature: 0.2, enabled: true });
    expect(journal.listModels()[0]?.connectionStatus).toBe('untested');
    journal.recordModelConnection(id, 'connected');
    expect(journal.listModels()[0]).toMatchObject({ connectionStatus: 'connected' });
    expect(journal.listModels()[0]?.lastTestedAt).toEqual(expect.any(Number));
    expect(journal.setModelEnabled(id, false)).toBe(true);
    expect(journal.listModels()[0]).toMatchObject({ enabled: false, connectionStatus: 'connected' });
  });
});
