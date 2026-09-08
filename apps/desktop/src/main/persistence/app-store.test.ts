import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { CreatedTask } from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from './index';

const openStores: AppStore[] = [];
const temporaryDirectories: string[] = [];
/** 每个用例自己开一个内存库并登记清理，用例内部因此不需要任何非空断言。 */
const openStore = (): AppStore => {
  const store = AppStore.open(':memory:');
  openStores.push(store);
  return store;
};

/**
 * 外键约束开启后，Evidence 与 Run Event 必须挂在真实存在的 Task / Session / Run 上。
 * 这两个夹具按生产链路建库，测试因此不再需要伪造父级 id。
 */
const seedTask = (store: AppStore, rootPath: string, title: string): CreatedTask => {
  const workspace = store.workspaces.getOrCreate(rootPath, title);
  return store.tasks.create(workspace.id, title, `${title}的目标`);
};

const seedRun = (store: AppStore, task: CreatedTask, runId: string): void => {
  store.runs.create({
    id: runId,
    taskId: task.task.id,
    sessionId: task.sessionId,
    prompt: runId,
    status: 'running',
    createdAt: 1,
  });
};
afterEach(() => {
  for (const store of openStores.splice(0)) store.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('AppStore', () => {
  it('keeps disable and revoked preferences after reopening the database', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-skills-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'app.sqlite');
    const first = AppStore.open(file);
    first.skills.save({
      id: 'skill-restart',
      name: 'Restart',
      description: '',
      sourceKind: 'user',
      currentRevisionId: 'revision-restart',
    });
    first.skills.saveRevision({
      id: 'revision-restart',
      skillId: 'skill-restart',
      contentHash: 'restart-hash',
      resourceKey: 'user/restart/restart-hash',
      frontmatter: {},
    });
    first.skills.setEnabled('skill-restart', false);
    first.skills.setTrustPreference('skill-restart', 'revoked');
    first.close();

    const second = AppStore.open(file);
    expect(second.skills.get('skill-restart')).toMatchObject({
      enabled: false,
      trustStatus: 'revoked',
    });
    second.close();
  });

  it('persists immutable Skill revisions, profiles, and revocable trust grants', () => {
    const store = openStore();
    store.skills.save({
      id: 'skill-1',
      name: 'PPT Skill',
      description: 'A local skill',
      sourceKind: 'user',
      currentRevisionId: 'revision-1',
    });
    const revisionId = store.skills.saveRevision({
      id: 'revision-1',
      skillId: 'skill-1',
      contentHash: 'content-hash-1',
      originalVersion: 'v20260907',
      resourceKey: 'user/skill-1/content-hash-1',
      frontmatter: { version: 'v20260907', custom: 'kept' },
    });
    const profileId = store.skills.saveProfile({
      id: 'profile-1',
      skillId: 'skill-1',
      profileHash: 'profile-hash-1',
      profile: { commands: [], environmentRequirements: [], outputContract: { outputPaths: [] } },
    });
    store.skills.save({
      id: 'skill-1',
      name: 'PPT Skill',
      description: 'A local skill',
      sourceKind: 'user',
      currentRevisionId: revisionId,
      currentProfileRevisionId: profileId,
    });
    expect(store.skills.get('skill-1')).toMatchObject({
      trustStatus: 'untrusted',
      environmentStatus: 'unprepared',
      revision: { originalVersion: 'v20260907', frontmatter: { custom: 'kept' } },
    });
    store.skills.saveTrustGrant({
      skillId: 'skill-1',
      revisionId,
      profileHash: 'profile-hash-1',
      dependencyFingerprint: 'dependencies-1',
      scopeHash: 'scope-1',
      source: 'user',
    });
    expect(store.skills.get('skill-1')?.trustStatus).toBe('trusted');
    store.skills.setTrustPreference('skill-1', 'revoked');
    expect(store.skills.get('skill-1')?.trustStatus).toBe('revoked');
    store.close();
  });

  it('keeps old Skill revisions when a new revision becomes current', () => {
    const store = openStore();
    store.skills.save({
      id: 'skill-versions',
      name: 'Versions',
      description: '',
      sourceKind: 'user',
      currentRevisionId: 'revision-placeholder',
    });
    const firstRevision = store.skills.saveRevision({
      skillId: 'skill-versions',
      contentHash: 'hash-1',
      resourceKey: 'user/skill-versions/hash-1',
      frontmatter: {},
    });
    const secondRevision = store.skills.saveRevision({
      skillId: 'skill-versions',
      contentHash: 'hash-2',
      resourceKey: 'user/skill-versions/hash-2',
      frontmatter: {},
    });
    store.skills.save({
      id: 'skill-versions',
      name: 'Versions',
      description: '',
      sourceKind: 'user',
      currentRevisionId: firstRevision,
    });
    store.skills.save({
      id: 'skill-versions',
      name: 'Versions',
      description: '',
      sourceKind: 'user',
      currentRevisionId: secondRevision,
    });
    expect(store.skills.get('skill-versions')?.currentRevisionId).toBe(secondRevision);
    expect(
      store.skills.listRevisions('skill-versions').map((revision) => revision.contentHash),
    ).toEqual(['hash-1', 'hash-2']);
  });

  it('creates a stable workspace, task, and separate session identifiers', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/work/customer-a', '客户 A');
    const sameWorkspace = store.workspaces.getOrCreate(
      '/work/customer-a',
      '不同名称不会复制工作区',
    );
    const created = store.tasks.create(workspace.id, '季度复盘', '根据资料完成季度复盘');
    expect(sameWorkspace.id).toBe(workspace.id);
    expect(created.task).toMatchObject({
      workspaceId: workspace.id,
      title: '季度复盘',
      goal: '根据资料完成季度复盘',
    });
    expect(created.sessionId).not.toBe(created.task.id);
    expect(() => store.tasks.create('missing-workspace', '无效任务', '不应创建')).toThrow(
      'Workspace does not exist',
    );
  });

  it('lists one recent task with its latest run instead of duplicate run rows', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/work/customer-a', '客户 A');
    const task = store.tasks.create(workspace.id, '季度复盘', '根据资料完成季度复盘');
    store.runs.create({
      id: 'run-1',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '第一轮',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });
    store.runs.create({
      id: 'run-2',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '第二轮',
      status: 'running',
      createdAt: 3,
    });
    expect(store.tasks.listRecent(workspace.id)).toEqual([
      expect.objectContaining({
        id: task.task.id,
        sessionId: task.sessionId,
        latestRun: expect.objectContaining({ id: 'run-2', prompt: '第二轮' }),
      }),
    ]);
  });

  it('persists deduplicated local evidence for a task', () => {
    const store = openStore();
    const task = seedTask(store, '/work/customer-a', '客户 A');
    seedRun(store, task, 'run-1');
    const evidence = {
      taskId: task.task.id,
      runId: 'run-1',
      sourceUri: '/notes/interview.md',
      title: '客户访谈',
      locator: '全文',
      excerpt: '续约风险需要跟进。',
      contentHash: 'hash-1',
    };
    store.evidence.saveLocal(evidence);
    store.evidence.saveLocal(evidence);
    expect(store.evidence.listByTask(task.task.id)).toEqual([
      expect.objectContaining({ ...evidence, sourceType: 'local-file' }),
    ]);
  });

  it('creates a Markdown artifact and appends revisions without overwriting history', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/work/customer-a', '客户 A');
    const task = store.tasks.create(workspace.id, '季度复盘', '根据资料完成季度复盘');
    store.runs.create({
      id: 'run-1',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '生成复盘',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });
    store.runs.create({
      id: 'run-2',
      taskId: task.task.id,
      sessionId: task.sessionId,
      prompt: '修改复盘',
      status: 'completed',
      createdAt: 3,
      completedAt: 4,
    });
    store.evidence.saveLocal({
      taskId: task.task.id,
      runId: 'run-2',
      sourceUri: '/notes/customer.md',
      title: '客户访谈',
      locator: '段落 2',
      excerpt: '续约风险需要跟进。',
      contentHash: 'evidence-hash',
    });
    const first = store.artifacts.saveMarkdown({
      taskId: task.task.id,
      origin: 'assistant-run',
      runId: 'run-1',
      title: '季度复盘',
      content: '# 第一版',
    });
    const revised = store.artifacts.saveMarkdown({
      artifactId: first.id,
      taskId: task.task.id,
      origin: 'assistant-run',
      runId: 'run-2',
      title: '季度复盘（修订）',
      content: '# 第二版',
    });
    const manuallyEdited = store.artifacts.saveMarkdown({
      artifactId: first.id,
      taskId: task.task.id,
      origin: 'user-edit',
      title: '季度复盘（人工修订）',
      content: '# 第三版',
    });
    expect(first).toMatchObject({
      type: 'markdown',
      versionNumber: 1,
      origin: 'assistant-run',
      sourceRunId: 'run-1',
    });
    expect(revised).toMatchObject({
      id: first.id,
      title: '季度复盘（修订）',
      versionNumber: 2,
      origin: 'assistant-run',
      sourceRunId: 'run-2',
    });
    expect(manuallyEdited).toMatchObject({
      id: first.id,
      title: '季度复盘（人工修订）',
      versionNumber: 3,
      origin: 'user-edit',
    });
    expect(manuallyEdited.sourceRunId).toBeUndefined();
    expect(store.artifacts.list(task.task.id)).toEqual([
      expect.objectContaining({ id: first.id, versionNumber: 3, origin: 'user-edit' }),
    ]);
    expect(store.artifacts.getDetail(first.id)).toMatchObject({
      id: first.id,
      content: '# 第三版',
      versionNumber: 3,
      origin: 'user-edit',
      evidence: [expect.objectContaining({ title: '客户访谈', locator: '段落 2' })],
    });
    expect(store.artifacts.listVersions(first.id)).toEqual([
      expect.objectContaining({ versionNumber: 3, origin: 'user-edit' }),
      expect.objectContaining({ versionNumber: 2, origin: 'assistant-run', sourceRunId: 'run-2' }),
      expect.objectContaining({ versionNumber: 1, origin: 'assistant-run', sourceRunId: 'run-1' }),
    ]);
    const version = store.artifacts.listVersions(first.id).find((item) => item.versionNumber === 2);
    expect(version).toBeDefined();
    if (!version) throw new Error('Expected the second artifact version');
    expect(store.artifacts.getVersionDetail(version.id)).toMatchObject({
      id: version.id,
      content: '# 第二版',
      versionNumber: 2,
      sourceRunId: 'run-2',
      evidence: [expect.objectContaining({ title: '客户访谈' })],
    });
  });

  it('persists runs and ordered events', () => {
    const store = openStore();
    const task = seedTask(store, '/work/run-events', '事件工作区');
    seedRun(store, task, 'run-1');
    store.runs.appendEvent({
      id: 'event-1',
      runId: 'run-1',
      sequence: 0,
      createdAt: 2,
      type: 'run.started',
      taskId: task.task.id,
      sessionId: task.sessionId,
    });
    store.runs.appendEvent({
      id: 'event-2',
      runId: 'run-1',
      sequence: 1,
      createdAt: 3,
      type: 'run.completed',
      finalContent: 'done',
    });
    expect(store.runs.listEvents('run-1').map((event) => event.type)).toEqual([
      'run.started',
      'run.completed',
    ]);
    expect(store.runs.list()[0]?.status).toBe('completed');
  });

  it('lists only a task’s own runs when requested', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/workspace-runs', '工作区');
    const firstTask = store.tasks.create(workspace.id, '市场研究', '研究市场');
    const secondTask = store.tasks.create(workspace.id, '客户复盘', '复盘客户');
    store.runs.create({
      id: 'market-run-1',
      taskId: firstTask.task.id,
      sessionId: firstTask.sessionId,
      prompt: '收集资料',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });
    store.runs.create({
      id: 'market-run-2',
      taskId: firstTask.task.id,
      sessionId: firstTask.sessionId,
      prompt: '形成结论',
      status: 'completed',
      createdAt: 3,
      completedAt: 4,
    });
    store.runs.create({
      id: 'customer-run-1',
      taskId: secondTask.task.id,
      sessionId: secondTask.sessionId,
      prompt: '识别风险',
      status: 'completed',
      createdAt: 5,
      completedAt: 6,
    });
    expect(store.runs.list(firstTask.task.id).map((run) => run.id)).toEqual([
      'market-run-2',
      'market-run-1',
    ]);
  });

  it('stores model credentials without returning them in summaries', () => {
    const store = openStore();
    const id = store.models.save({
      name: '测试模型',
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:8000/v1',
      model: 'demo',
      role: 'language',
      apiKey: 'secret-value',
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      temperature: 0.2,
      enabled: true,
    });
    expect(store.models.list()[0]).toMatchObject({ id, name: '测试模型', apiKeyConfigured: true });
    expect(store.models.list()[0]).not.toHaveProperty('apiKey');
    expect(store.models.getWithSecret(id)?.apiKey).toBe('secret-value');
  });

  it('uses an explicitly selected enabled model as the default for its role', () => {
    const store = openStore();
    const first = store.models.save({
      name: '第一语言模型',
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:8000/v1',
      model: 'first',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      temperature: 0.2,
      enabled: true,
    });
    const second = store.models.save({
      name: '第二语言模型',
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:8000/v1',
      model: 'second',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      temperature: 0.2,
      enabled: true,
    });
    expect(store.models.getForRun('language')?.id).toBe(first);
    expect(store.models.setDefault(second)).toBe(true);
    expect(store.models.getForRun('language')?.id).toBe(second);
  });

  it('keeps a persisted model connection result in renderer-facing summaries', () => {
    const store = openStore();
    const id = store.models.save({
      name: '待测试模型',
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:8000/v1',
      model: 'test',
      role: 'language',
      apiKey: '',
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
      temperature: 0.2,
      enabled: true,
    });
    expect(store.models.list()[0]?.connectionStatus).toBe('untested');
    store.models.recordConnection(id, 'connected');
    expect(store.models.list()[0]).toMatchObject({ connectionStatus: 'connected' });
    expect(store.models.list()[0]?.lastTestedAt).toEqual(expect.any(Number));
    expect(store.models.setEnabled(id, false)).toBe(true);
    expect(store.models.list()[0]).toMatchObject({
      enabled: false,
      connectionStatus: 'connected',
    });
  });

  it('rejects artifact writes that cross task or run boundaries', () => {
    const store = openStore();
    const workspace = store.workspaces.getOrCreate('/work/boundary', '边界工作区');
    const first = store.tasks.create(workspace.id, '任务一', '目标一');
    const second = store.tasks.create(workspace.id, '任务二', '目标二');
    store.runs.create({
      id: 'run-first',
      taskId: first.task.id,
      sessionId: first.sessionId,
      prompt: '任务一运行',
      status: 'completed',
      createdAt: 1,
      completedAt: 2,
    });
    store.runs.create({
      id: 'run-second',
      taskId: second.task.id,
      sessionId: second.sessionId,
      prompt: '任务二运行',
      status: 'completed',
      createdAt: 3,
      completedAt: 4,
    });
    expect(() =>
      store.artifacts.saveMarkdown({
        taskId: first.task.id,
        origin: 'assistant-run',
        runId: 'run-second',
        title: '跨任务运行',
        content: '# 内容',
      }),
    ).toThrow('Run does not belong to task');
    expect(() =>
      store.artifacts.saveMarkdown({
        taskId: 'missing-task',
        origin: 'assistant-run',
        runId: 'run-first',
        title: '缺失任务',
        content: '# 内容',
      }),
    ).toThrow('Task does not exist');
    const artifact = store.artifacts.saveMarkdown({
      taskId: first.task.id,
      origin: 'assistant-run',
      runId: 'run-first',
      title: '归属正确',
      content: '# 第一版',
    });
    expect(() =>
      store.artifacts.saveMarkdown({
        artifactId: artifact.id,
        taskId: second.task.id,
        origin: 'user-edit',
        title: '跨任务修订',
        content: '# 内容',
      }),
    ).toThrow('Artifact does not belong to task');
  });

  it('keeps evidence scoped to its own run when the same source appears in several runs', () => {
    const store = openStore();
    const task = seedTask(store, '/work/evidence-scope', '证据工作区');
    seedRun(store, task, 'run-1');
    seedRun(store, task, 'run-2');
    const base = {
      taskId: task.task.id,
      sourceUri: '/notes/customer.md',
      title: '客户访谈',
      locator: '全文',
      excerpt: '续约风险需要跟进。',
      contentHash: 'hash-1',
    };
    store.evidence.saveLocal({ ...base, runId: 'run-1' });
    store.evidence.saveLocal({ ...base, runId: 'run-2' });
    store.evidence.saveLocal({ ...base, runId: 'run-2' });
    expect(store.evidence.listByTask(task.task.id)).toHaveLength(2);
    expect(
      store.evidence
        .listByTask(task.task.id)
        .map((item) => item.runId)
        .sort(),
    ).toEqual(['run-1', 'run-2']);
  });

  it('stores the enabled search engine with masked credentials and preserves its connection status until the key changes', () => {
    const store = openStore();
    expect(store.searchEngines.getEnabled()).toBeUndefined();
    store.searchEngines.save({
      provider: 'baidu_qianfan',
      apiKey: 'secret-key',
      webTopK: 8,
      enabled: true,
    });
    expect(store.searchEngines.list()[0]).toMatchObject({
      provider: 'baidu_qianfan',
      apiKeyConfigured: true,
      enabled: true,
      webTopK: 8,
      connectionStatus: 'untested',
    });
    expect(store.searchEngines.list()[0]).not.toHaveProperty('apiKey');
    expect(store.searchEngines.getEnabled()).toMatchObject({ apiKey: 'secret-key', webTopK: 8 });
    store.searchEngines.recordConnection('baidu_qianfan', 'connected', 'secret-key');
    expect(store.searchEngines.list()[0]).toMatchObject({ connectionStatus: 'connected' });
    store.searchEngines.save({ provider: 'baidu_qianfan', apiKey: '', webTopK: 12, enabled: true });
    expect(store.searchEngines.getEnabled()).toMatchObject({ apiKey: 'secret-key', webTopK: 12 });
    expect(store.searchEngines.list()[0]).toMatchObject({ connectionStatus: 'connected' });
    store.searchEngines.save({
      provider: 'baidu_qianfan',
      apiKey: 'next-key',
      webTopK: 10,
      enabled: true,
    });
    expect(store.searchEngines.list()[0]).toMatchObject({ connectionStatus: 'untested' });
    expect(store.searchEngines.get('baidu_qianfan')?.apiKey).toBe('next-key');
  });

  it('persists deduplicated web evidence with a web-page source type', () => {
    const store = openStore();
    const task = seedTask(store, '/work/web-evidence', '网页证据工作区');
    seedRun(store, task, 'run-1');
    const evidence = {
      taskId: task.task.id,
      runId: 'run-1',
      sourceUri: 'https://example.com/a',
      title: '网页标题',
      locator: 'example.com',
      excerpt: '网页摘要。',
      contentHash: 'hash-web',
    };
    store.evidence.saveWeb(evidence);
    store.evidence.saveWeb(evidence);
    expect(store.evidence.listByTask(task.task.id)).toEqual([
      expect.objectContaining({ ...evidence, sourceType: 'web-page' }),
    ]);
  });

  it('keeps the connection result of a test that ran before the first save', () => {
    const store = openStore();
    store.searchEngines.recordConnection('baidu_qianfan', 'connected', 'tested-key');
    expect(store.searchEngines.list()[0]).toMatchObject({
      apiKeyConfigured: true,
      enabled: false,
      connectionStatus: 'connected',
    });
    store.searchEngines.save({
      provider: 'baidu_qianfan',
      apiKey: 'tested-key',
      webTopK: 10,
      enabled: true,
    });
    expect(store.searchEngines.list()[0]).toMatchObject({
      enabled: true,
      connectionStatus: 'connected',
    });
  });

  it('stores notifications with targets, enforces the rolling cap, and tracks unread counts', () => {
    const store = openStore();
    const first = store.notifications.save({
      level: 'success',
      kind: 'run',
      title: '任务完成：计算',
      target: { kind: 'task', taskId: 'task-1' },
    });
    const second = store.notifications.save({
      level: 'warning',
      kind: 'knowledge-import',
      title: '资料未导入（1 份）',
      detail: 'a.md：格式不支持',
      target: { kind: 'knowledge' },
    });
    const third = store.notifications.save({
      level: 'info',
      kind: 'artifact',
      title: '已导出「报告」',
      target: { kind: 'artifact', artifactId: 'artifact-1' },
    });
    const fourth = store.notifications.save({ level: 'error', kind: 'run', title: '任务失败' });

    expect(store.notifications.unreadCount()).toBe(4);
    const listed = store.notifications.list();
    expect(listed.map((item) => item.id)).toEqual([fourth.id, third.id, second.id, first.id]);
    expect(listed[0]?.level).toBe('error');
    expect(listed[0]?.kind).toBe('run');
    expect(listed[0]?.read).toBe(false);
    expect(listed[0]?.target).toBeUndefined();
    expect(listed[1]).toMatchObject({ target: { kind: 'artifact', artifactId: 'artifact-1' } });
    expect(listed[2]).toMatchObject({
      level: 'warning',
      detail: 'a.md：格式不支持',
      target: { kind: 'knowledge' },
    });
    expect(listed[3]).toMatchObject({ target: { kind: 'task', taskId: 'task-1' } });

    expect(store.notifications.markRead(second.id)).toBe(3);
    expect(store.notifications.markAllRead()).toBe(0);
    expect(store.notifications.list().every((item) => item.read)).toBe(true);

    store.notifications.clear();
    expect(store.notifications.list()).toEqual([]);
    expect(store.notifications.unreadCount()).toBe(0);
  });

  it('evicts the oldest notifications beyond the 200-entry cap', () => {
    const store = openStore();
    for (let index = 0; index < 205; index += 1)
      store.notifications.save({ level: 'info', kind: 'system', title: `通知 ${index}` });
    const listed = store.notifications.list();
    expect(listed).toHaveLength(200);
    expect(listed[0]?.title).toBe('通知 204');
    expect(listed.at(-1)?.title).toBe('通知 5');
  });
});
