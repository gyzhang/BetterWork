import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { type AgentRuntimeEvent, IpcChannel } from '@betterwork/agent-protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AppStore } from '../persistence';

/**
 * 记录 ipcMain.handle 注册到的 channel。
 * 参考项目里出现过「协议定义了通道、主进程忘了接线」的半成品状态，
 * Renderer 调用时会得到一个永远不 resolve 的 Promise，因此这里把
 * 「协议里的每个请求通道都必须被注册」变成一条可执行断言。
 */
const mocks = vi.hoisted(() => ({
  handled: [] as string[],
  handlers: new Map<string, (event: unknown, raw: unknown) => unknown>(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  openPath: vi.fn(async () => ''),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, raw: unknown) => unknown) => {
      mocks.handled.push(channel);
      mocks.handlers.set(channel, handler);
    },
  },
  dialog: { showOpenDialog: mocks.showOpenDialog, showSaveDialog: mocks.showSaveDialog },
  shell: { openPath: mocks.openPath },
  systemPreferences: { getUserDefault: () => 'Maximize' },
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
  },
}));

const invoke = async (channel: string, raw: unknown): Promise<unknown> => {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler({}, raw);
};

/** 推送通道由主进程主动 send，不经 ipcMain.handle 注册。 */
const PUSH_ONLY_CHANNELS = new Set<string>([
  IpcChannel.RunEvent,
  IpcChannel.NotificationChangeEvent,
  IpcChannel.NotificationActivated,
]);

describe('registerIpc', () => {
  let temporaryDirectory: string;
  let store: AppStore;

  beforeAll(async () => {
    temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-ipc-'));
    const { AppStore } = await import('../persistence');
    const { KnowledgeVault } = await import('../services/knowledge-vault');
    const { NotificationService } = await import('../services/notification-service');
    const { RunService } = await import('../services/run-service');
    const { registerIpc } = await import('./register-ipc');

    store = AppStore.open(':memory:');
    const knowledgeVault = new KnowledgeVault(':memory:');
    const notifications = new NotificationService(store.notifications, () => null);
    const runs = new RunService(store, knowledgeVault, notifications, () => null);

    registerIpc({
      store,
      knowledgeVault,
      notifications,
      runs,
      getWindow: () => null,
      getDefaultWorkspaceRoot: () => temporaryDirectory,
    });
  });

  afterAll(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('registers a handler for every request channel in the protocol', () => {
    const expected = Object.values(IpcChannel).filter(
      (channel) => !PUSH_ONLY_CHANNELS.has(channel),
    );
    const missing = expected.filter((channel) => !mocks.handled.includes(channel));
    expect(missing).toEqual([]);
  });

  it('registers no channel outside the protocol', () => {
    const known = new Set<string>(Object.values(IpcChannel));
    expect(mocks.handled.filter((channel) => !known.has(channel))).toEqual([]);
  });

  it('registers each channel exactly once', () => {
    const duplicated = mocks.handled.filter(
      (channel, index) => mocks.handled.indexOf(channel) !== index,
    );
    expect(duplicated).toEqual([]);
  });

  it('rejects malformed request data before it reaches a handler', async () => {
    await expect(
      invoke(IpcChannel.CreateTask, { workspaceId: '', title: '', goal: '' }),
    ).rejects.toThrow();
  });

  it('rejects unexpected data for a no-input dialog channel before opening the dialog', async () => {
    await expect(invoke(IpcChannel.SelectWorkspace, { injected: true })).rejects.toThrow();
    expect(mocks.showOpenDialog).not.toHaveBeenCalled();
  });

  it('returns a safe result when a source is not registered instead of opening an arbitrary path', async () => {
    await expect(
      invoke(IpcChannel.OpenKnowledgeSource, {
        sourcePath: path.join(temporaryDirectory, 'outside.md'),
      }),
    ).resolves.toEqual({ opened: false, error: '该文件不在当前知识库中，无法打开。' });
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it('rejects a malformed handler result before it can cross the IPC boundary', async () => {
    const original = store.models.list.bind(store.models);
    Object.defineProperty(store.models, 'list', {
      configurable: true,
      value: () => [{ id: 'missing-fields' }],
    });
    await expect(invoke(IpcChannel.ListModels, {})).rejects.toThrow();
    Object.defineProperty(store.models, 'list', { value: original });
  });

  it('completes the local task-to-versioned-artifact journey through registered IPC handlers', async () => {
    const workspace = (await invoke(IpcChannel.GetDefaultWorkspace, {})) as { id: string };
    const created = (await invoke(IpcChannel.CreateTask, {
      workspaceId: workspace.id,
      title: '季度复盘',
      goal: '整理续约风险',
    })) as { task: { id: string }; sessionId: string };
    const started = (await invoke(IpcChannel.StartRun, {
      taskId: created.task.id,
      sessionId: created.sessionId,
      prompt: '计算: 21 * 2',
    })) as { runId: string };

    let events: AgentRuntimeEvent[] = [];
    for (let attempt = 0; attempt < 200; attempt += 1) {
      events = (await invoke(IpcChannel.ListRunEvents, {
        runId: started.runId,
      })) as AgentRuntimeEvent[];
      if (events.some((event) => event.type === 'run.completed')) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const completed = events.find(
      (event): event is Extract<AgentRuntimeEvent, { type: 'run.completed' }> =>
        event.type === 'run.completed',
    );
    expect(completed).toBeDefined();
    if (!completed) throw new Error('Run did not complete');

    const artifact = (await invoke(IpcChannel.SaveMarkdownArtifact, {
      taskId: created.task.id,
      runId: started.runId,
      origin: 'assistant-run',
      title: '季度复盘报告',
      content: completed.finalContent,
    })) as { id: string };
    const revised = await invoke(IpcChannel.SaveMarkdownArtifact, {
      artifactId: artifact.id,
      taskId: created.task.id,
      origin: 'user-edit',
      title: '季度复盘报告',
      content: `${completed.finalContent}\n\n人工补充：跟进续约风险。`,
    });
    expect(revised).toEqual(expect.objectContaining({ id: artifact.id, origin: 'user-edit' }));

    const target = path.join(temporaryDirectory, '季度复盘报告.md');
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target });
    await expect(
      invoke(IpcChannel.ExportMarkdownArtifact, { artifactId: artifact.id }),
    ).resolves.toEqual({ cancelled: false, filePath: target });
    await expect(readFile(target, 'utf8')).resolves.toContain('人工补充：跟进续约风险。');
  });
});
