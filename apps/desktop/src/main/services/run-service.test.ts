import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { IpcChannel } from '@betterwork/agent-protocol';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it } from 'vitest';

import { AppStore } from '../persistence';
import { KnowledgeVault } from './knowledge-vault';
import { NotificationService } from './notification-service';
import { createRunTools, RunService } from './run-service';
import type { SkillExecutionService } from './skill-execution-service';
import { SkillService } from './skill-service';

const temporaryDirectories: string[] = [];
const openStores: AppStore[] = [];
const openVaults: KnowledgeVault[] = [];

afterEach(async () => {
  for (const vault of openVaults.splice(0)) vault.close();
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

interface WindowStub {
  sent: Array<{ channel: string; type: string }>;
  runEventTypes: () => string[];
  notificationEventTypes: () => string[];
  asBrowserWindow: BrowserWindow;
}

const createWindowStub = (options?: { focused?: boolean }): WindowStub => {
  const sent: Array<{ channel: string; type: string }> = [];
  const stub = {
    isDestroyed: () => false,
    isFocused: () => options?.focused ?? true,
    webContents: {
      send: (channel: string, event: { type: string }) => {
        sent.push({ channel, type: event.type });
      },
    },
  };
  const typesOn = (channel: string): string[] =>
    sent.filter((item) => item.channel === channel).map((item) => item.type);
  return {
    sent,
    runEventTypes: () => typesOn(IpcChannel.RunEvent),
    notificationEventTypes: () => typesOn(IpcChannel.NotificationChangeEvent),
    asBrowserWindow: stub as unknown as BrowserWindow,
  };
};

interface Fixture {
  directory: string;
  store: AppStore;
  vault: KnowledgeVault;
  skillService: SkillService;
  taskId: string;
  sessionId: string;
}

/**
 * 外键约束开启后，Run 必须挂在真实存在的 Task 与 Session 上，
 * 因此夹具要走完整链路建库，不能再塞伪造的 id。
 */
const createFixture = async (): Promise<Fixture> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'betterwork-run-'));
  temporaryDirectories.push(directory);
  const store = AppStore.open(':memory:');
  openStores.push(store);
  const vault = new KnowledgeVault(path.join(directory, 'vault.sqlite'));
  openVaults.push(vault);
  const skillService = new SkillService(store, {
    developmentBuiltinRoot: path.join(directory, 'builtin-dev'),
    installedBuiltinRoot: path.join(directory, 'builtin-installed'),
    userRoot: path.join(directory, 'skills'),
  });

  const workspace = store.workspaces.getOrCreate(directory, path.basename(directory));
  const created = store.tasks.create(workspace.id, '测试任务', '用于运行编排测试');
  return {
    directory,
    store,
    vault,
    skillService,
    taskId: created.task.id,
    sessionId: created.sessionId,
  };
};

const createService = (
  fixture: Fixture,
  window?: WindowStub,
  skillExecutionService?: SkillExecutionService,
): RunService =>
  new RunService(
    fixture.store,
    fixture.vault,
    new NotificationService(fixture.store.notifications, () => window?.asBrowserWindow ?? null),
    fixture.skillService,
    () => window?.asBrowserWindow ?? null,
    skillExecutionService,
  );

const statusOf = (fixture: Fixture, runId: string): string | undefined =>
  fixture.store.runs.list().find((run) => run.id === runId)?.status;

const waitForCompletion = async (fixture: Fixture, runId: string): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (statusOf(fixture, runId) !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Run did not complete in time');
};

describe('RunService', () => {
  it('records local knowledge search results as task evidence', async () => {
    const fixture = await createFixture();
    const note = path.join(fixture.directory, '客户资料.md');
    await writeFile(note, '客户续约风险需要在季度复盘中重点跟进。');
    await fixture.vault.importPaths([note]);

    const service = createService(fixture);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '搜索知识: 续约风险',
    });
    await waitForCompletion(fixture, runId);

    expect(fixture.store.evidence.listByTask(fixture.taskId)).toEqual([
      expect.objectContaining({ runId, title: '客户资料', locator: '全文', sourceUri: note }),
    ]);
    expect(statusOf(fixture, runId)).toBe('completed');
  });

  it('cancels a running run, records the terminal event, and broadcasts every event in order', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const service = createService(fixture, window);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '随便聊聊',
    });
    expect(service.cancel(runId)).toBe(true);
    await waitForCompletion(fixture, runId);

    const events = fixture.store.runs.listEvents(runId).map((event) => event.type);
    expect(events[0]).toBe('run.started');
    expect(events.at(-1)).toBe('run.cancelled');
    expect(window.runEventTypes()).toEqual(events);
    expect(window.notificationEventTypes()).toEqual([]);
    // 取消是用户主动行为，不产生通知
    expect(fixture.store.notifications.list()).toEqual([]);

    expect(service.isActive(runId)).toBe(false);
    expect(service.cancel(runId)).toBe(false);
  });

  it('rejects a Session that belongs to a different Task before creating a Run', async () => {
    const fixture = await createFixture();
    const otherTask = fixture.store.tasks.create(
      fixture.store.tasks.getWorkspaceId(fixture.taskId) ?? '',
      '另一项任务',
      '不应共享会话',
    );
    const service = createService(fixture);

    expect(() =>
      service.start({
        taskId: fixture.taskId,
        sessionId: otherTask.sessionId,
        prompt: '错误组合的任务与会话',
      }),
    ).toThrow('Session does not belong to task');
    expect(fixture.store.runs.list()).toEqual([]);
  });

  it('registers the web search tool only when a search engine is configured', () => {
    const knowledgeSearch = (): [] => [];
    expect(createRunTools({ knowledgeSearch }).map((tool) => tool.name)).toEqual([
      'calculator',
      'read_text_file',
      'knowledge_search',
    ]);
    expect(
      createRunTools({ knowledgeSearch, webSearch: async () => ({ results: [] }) }).map(
        (tool) => tool.name,
      ),
    ).toEqual(['calculator', 'read_text_file', 'knowledge_search', 'web_search']);
  });

  it('creates a notification with a task target when a run completes', async () => {
    const fixture = await createFixture();
    const window = createWindowStub({ focused: true });
    const service = createService(fixture, window);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '计算: 1 + 1',
    });
    await waitForCompletion(fixture, runId);

    const notifications = fixture.store.notifications.list();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toEqual(
      expect.objectContaining({
        level: 'success',
        kind: 'run',
        read: false,
        target: { kind: 'task', taskId: fixture.taskId },
      }),
    );
    expect(notifications[0]?.title).toContain('任务完成');
    expect(window.notificationEventTypes()).toEqual(['created']);
  });

  it('synthesizes a terminal failure when orchestration breaks before the event loop', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const service = createService(fixture, window);
    // 模拟编排层在进入事件循环前出错：读模型配置就抛异常。
    // 引擎因此根本不会产出任何事件，终态必须由 RunService 兜底。
    fixture.store.models.getForRun = () => {
      throw new Error('模型配置读取失败');
    };

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '计算: 1 + 1',
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    const events = fixture.store.runs.listEvents(runId);
    expect(events.map((event) => event.type)).toEqual(['run.failed']);
    expect(events[0]).toMatchObject({ type: 'run.failed', error: '模型配置读取失败' });
    // 兜底出来的终态同样要广播，否则界面会一直显示「进行中」
    expect(window.runEventTypes()).toEqual(['run.failed']);

    const notifications = fixture.store.notifications.list();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toEqual(
      expect.objectContaining({
        level: 'error',
        kind: 'run',
        target: { kind: 'task', taskId: fixture.taskId },
      }),
    );
    expect(notifications[0]?.detail).toContain('模型配置读取失败');
  });

  it('closes runs left in progress by a previous crashed process', async () => {
    const fixture = await createFixture();
    fixture.store.runs.create({
      id: 'run-interrupted',
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '上次没跑完',
      status: 'running',
      createdAt: Date.now() - 60_000,
    });

    expect(fixture.store.runs.failInterruptedRuns('算台上次退出时这次执行被中断', Date.now())).toBe(
      1,
    );
    expect(statusOf(fixture, 'run-interrupted')).toBe('failed');
    expect(fixture.store.runs.listEvents('run-interrupted').at(-1)).toMatchObject({
      type: 'run.failed',
    });
    // 已经收口的 Run 不会被二次改写
    expect(fixture.store.runs.failInterruptedRuns('再来一次', Date.now())).toBe(0);
  });

  it('refuses to start a run with an untrusted skill', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const service = createService(fixture, window);

    const skillId = 'skill-untrusted';
    const contentHash = 'a'.repeat(64);
    const resourceKey = `user/${skillId}/revisions/${contentHash}`;
    const skillDir = path.join(fixture.directory, 'skills', skillId, 'revisions', contentHash);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: 测试 Skill\n---\n指令内容');
    fixture.store.skills.save({
      id: skillId,
      name: '测试 Skill',
      description: '用于测试',
      sourceKind: 'user',
      currentRevisionId: 'pending',
    });
    const revisionId = fixture.store.skills.saveRevision({
      skillId,
      contentHash,
      resourceKey,
      frontmatter: { name: '测试 Skill' },
    });
    fixture.store.skills.save({
      id: skillId,
      name: '测试 Skill',
      description: '用于测试',
      sourceKind: 'user',
      currentRevisionId: revisionId,
    });

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '使用 Skill',
      skillBinding: { skillId },
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    const events = fixture.store.runs.listEvents(runId);
    expect(events.at(-1)).toMatchObject({ type: 'run.failed' });
    const error = (events.at(-1) as { type: 'run.failed'; error: string }).error;
    expect(error).toContain('尚未信任');
  });

  it('refuses to start a run with a disabled skill', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const service = createService(fixture, window);

    const skillId = 'skill-disabled';
    const contentHash = 'b'.repeat(64);
    const resourceKey = `user/${skillId}/revisions/${contentHash}`;
    const skillDir = path.join(fixture.directory, 'skills', skillId, 'revisions', contentHash);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: 停用 Skill\n---\n指令内容');
    fixture.store.skills.save({
      id: skillId,
      name: '停用 Skill',
      description: '用于测试',
      sourceKind: 'user',
      currentRevisionId: 'pending',
    });
    const revisionId = fixture.store.skills.saveRevision({
      skillId,
      contentHash,
      resourceKey,
      frontmatter: { name: '停用 Skill' },
    });
    fixture.store.skills.save({
      id: skillId,
      name: '停用 Skill',
      description: '用于测试',
      sourceKind: 'user',
      currentRevisionId: revisionId,
    });
    fixture.store.skills.setEnabled(skillId, false);
    fixture.store.skills.setTrustPreference(skillId, 'trusted');
    fixture.store.skills.saveTrustGrant({
      skillId,
      revisionId,
      profileHash: 'hash',
      dependencyFingerprint: 'fp',
      scopeHash: 'scope',
      source: 'user',
    });

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '使用 Skill',
      skillBinding: { skillId },
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    const events = fixture.store.runs.listEvents(runId);
    const error = (events.at(-1) as { type: 'run.failed'; error: string }).error;
    expect(error).toContain('已停用');
  });

  /** 创建一个已信任且已启用的 Skill，返回 skillId 供后续绑定。 */
  const createTrustedSkill = async (
    fixture: Fixture,
    id: string,
    name = '测试 Skill',
  ): Promise<string> => {
    const contentHash = id.repeat(32).slice(0, 64);
    const resourceKey = `user/${id}/revisions/${contentHash}`;
    const skillDir = path.join(fixture.directory, 'skills', id, 'revisions', contentHash);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\n---\n指令内容`);
    fixture.store.skills.save({
      id,
      name,
      description: '用于测试',
      sourceKind: 'user',
      currentRevisionId: 'pending',
    });
    const revisionId = fixture.store.skills.saveRevision({
      skillId: id,
      contentHash,
      resourceKey,
      frontmatter: { name },
    });
    const profileHash = `${id}-profile-hash`;
    const profileId = fixture.store.skills.saveProfile({
      skillId: id,
      profileHash,
      profile: {
        commands: [],
        environmentRequirements: [],
        outputContract: { outputPaths: [] },
      },
    });
    fixture.store.skills.save({
      id,
      name,
      description: '用于测试',
      sourceKind: 'user',
      currentRevisionId: revisionId,
      currentProfileRevisionId: profileId,
    });
    fixture.store.skills.setEnabled(id, true);
    fixture.store.skills.setTrustPreference(id, 'trusted');
    fixture.store.skills.saveTrustGrant({
      skillId: id,
      revisionId,
      profileHash,
      dependencyFingerprint: 'fp',
      scopeHash: 'scope',
      source: 'user',
    });
    return id;
  };

  it('calls finishRun before publishing the terminal event for a skill-bound run', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const skillId = await createTrustedSkill(fixture, 'skill-a15-order');
    const callOrder: string[] = [];
    const mockExecution = {
      createBinding: () => ({ id: 'binding-test' }),
      async finishRun(): Promise<{ cancelled: number; cleanupFailed: number }> {
        callOrder.push('finishRun');
        return { cancelled: 0, cleanupFailed: 0 };
      },
    } as unknown as SkillExecutionService;
    const service = createService(fixture, window, mockExecution);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '随便聊聊',
      skillBinding: { skillId },
    });
    await waitForCompletion(fixture, runId);

    const events = fixture.store.runs.listEvents(runId);
    const terminalIndex = events.findIndex(
      (e) => e.type === 'run.completed' || e.type === 'run.failed' || e.type === 'run.cancelled',
    );
    expect(terminalIndex).toBeGreaterThan(0);
    expect(callOrder).toEqual(['finishRun']);
    expect(statusOf(fixture, runId)).toBe('completed');
  });

  it('synthesizes run.failed when finishRun throws during cleanup', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const skillId = await createTrustedSkill(fixture, 'skill-a15-cleanup');
    const mockExecution = {
      createBinding: () => ({ id: 'binding-cleanup' }),
      async finishRun(): Promise<{ cancelled: number; cleanupFailed: number }> {
        throw new Error('子进程清理超时');
      },
    } as unknown as SkillExecutionService;
    const service = createService(fixture, window, mockExecution);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '随便聊聊',
      skillBinding: { skillId },
    });
    await waitForCompletion(fixture, runId);

    expect(statusOf(fixture, runId)).toBe('failed');
    const events = fixture.store.runs.listEvents(runId);
    const error = (events.at(-1) as { type: 'run.failed'; error: string }).error;
    expect(error).toContain('子进程清理失败');
    expect(error).toContain('子进程清理超时');
    expect(window.runEventTypes()).toContain('run.failed');
  });

  it('fails the Run when finishRun returns a cleanup failure report', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const execution = {
      async finishRun() {
        return { cancelled: 1, cleanupFailed: 1 };
      },
    } as unknown as SkillExecutionService;
    const service = createService(fixture, window, execution);
    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: 'hello',
    });
    await waitForCompletion(fixture, runId);
    expect(statusOf(fixture, runId)).toBe('failed');
    const terminals = window
      .runEventTypes()
      .filter((type) => ['run.completed', 'run.failed', 'run.cancelled'].includes(type));
    expect(terminals).toEqual(['run.failed']);
  });

  it('shutdown() aborts all active runs and waits for them to settle', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const service = createService(fixture, window);

    const runId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '随便聊聊',
    });
    expect(service.isActive(runId)).toBe(true);

    await service.shutdown();

    expect(statusOf(fixture, runId)).toBe('cancelled');
    expect(service.isActive(runId)).toBe(false);
    // shutdown 是批量取消，不产生通知
    expect(fixture.store.notifications.list()).toEqual([]);
  });

  it('cancelRunsForSkill() only cancels runs bound to the matching skill', async () => {
    const fixture = await createFixture();
    const window = createWindowStub();
    const targetSkill = await createTrustedSkill(fixture, 'skill-target', '目标 Skill');
    const otherSkill = await createTrustedSkill(fixture, 'skill-other', '其他 Skill');
    const service = createService(fixture, window);

    const targetRunId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '随便聊聊',
      skillBinding: { skillId: targetSkill },
    });
    const otherRunId = service.start({
      taskId: fixture.taskId,
      sessionId: fixture.sessionId,
      prompt: '随便聊聊',
      skillBinding: { skillId: otherSkill },
    });

    const cancelled = await service.cancelRunsForSkill(targetSkill);
    expect(cancelled).toBe(1);
    await waitForCompletion(fixture, targetRunId);
    await waitForCompletion(fixture, otherRunId);

    expect(statusOf(fixture, targetRunId)).toBe('cancelled');
    expect(statusOf(fixture, otherRunId)).toBe('completed');
  });
});
