import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { IpcChannel } from '@betterwork/agent-protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * 记录 ipcMain.handle 注册到的 channel。
 * 参考项目里出现过「协议定义了通道、主进程忘了接线」的半成品状态，
 * Renderer 调用时会得到一个永远不 resolve 的 Promise，因此这里把
 * 「协议里的每个请求通道都必须被注册」变成一条可执行断言。
 */
const mocks = vi.hoisted(() => ({
  handled: [] as string[],
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string) => {
      mocks.handled.push(channel);
    },
  },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(async () => '') },
  systemPreferences: { getUserDefault: () => 'Maximize' },
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
  },
}));

/** 推送通道由主进程主动 send，不经 ipcMain.handle 注册。 */
const PUSH_ONLY_CHANNELS = new Set<string>([
  IpcChannel.RunEvent,
  IpcChannel.NotificationChangeEvent,
  IpcChannel.NotificationActivated,
]);

describe('registerIpc', () => {
  let temporaryDirectory: string;

  beforeAll(async () => {
    temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-ipc-'));
    const { AppStore } = await import('../persistence');
    const { KnowledgeVault } = await import('../services/knowledge-vault');
    const { NotificationService } = await import('../services/notification-service');
    const { RunService } = await import('../services/run-service');
    const { registerIpc } = await import('./register-ipc');

    const store = AppStore.open(':memory:');
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
});
