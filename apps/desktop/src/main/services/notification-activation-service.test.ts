import { IpcChannel } from '@betterwork/agent-protocol';
import type { BrowserWindow } from 'electron';
import { describe, expect, it } from 'vitest';

import { NotificationActivationService } from './notification-activation-service';

interface WindowState {
  readonly window: BrowserWindow;
  readonly id: number;
  readonly events: Array<{ channel: string; payload: unknown }>;
  readonly state: { minimized: boolean; shown: number; focused: number; restored: number };
}

const createWindow = (id: number): WindowState => {
  const events: Array<{ channel: string; payload: unknown }> = [];
  const state = { minimized: true, shown: 0, focused: 0, restored: 0 };
  const window = {
    isDestroyed: () => false,
    isMinimized: () => state.minimized,
    restore: () => {
      state.minimized = false;
      state.restored += 1;
    },
    show: () => {
      state.shown += 1;
    },
    focus: () => {
      state.focused += 1;
    },
    webContents: {
      id,
      send: (channel: string, payload: unknown) => events.push({ channel, payload }),
    },
  };
  return { window: window as unknown as BrowserWindow, id, events, state };
};

describe('NotificationActivationService', () => {
  it('creates and focuses a window on click, then delivers once after Renderer readiness', () => {
    let current: WindowState | undefined;
    let nextId = 1;
    const service = new NotificationActivationService({
      getWindow: () => current?.window ?? null,
      ensureWindow: () => {
        current ??= createWindow(nextId++);
        return current.window;
      },
    });

    service.activate('notification-old-task');

    expect(current?.state).toEqual({ minimized: false, shown: 1, focused: 1, restored: 1 });
    expect(current?.events).toEqual([]);

    service.rendererReady(current?.id ?? -1);
    service.rendererReady(current?.id ?? -1);

    expect(current?.events).toEqual([
      {
        channel: IpcChannel.NotificationActivated,
        payload: { id: 'notification-old-task' },
      },
    ]);
  });

  it('keeps a clicked target across a window close and ignores readiness from a stale window', () => {
    let current = createWindow(1);
    const stale = current;
    const service = new NotificationActivationService({
      getWindow: () => current.window,
      ensureWindow: () => current.window,
    });

    service.activate('notification-schedule-occurrence');
    service.windowClosed(stale.id);
    current = createWindow(2);
    service.rendererReady(stale.id);
    expect(current.events).toEqual([]);

    service.rendererReady(current.id);
    expect(current.events).toEqual([
      {
        channel: IpcChannel.NotificationActivated,
        payload: { id: 'notification-schedule-occurrence' },
      },
    ]);
    expect(stale.events).toEqual([]);
  });
});
