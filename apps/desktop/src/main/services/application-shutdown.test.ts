import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppStore } from '../persistence';
import {
  type ApplicationShutdownServices,
  createQuitHandler,
  shutdownApplication,
} from './application-shutdown';
import { KnowledgeIndexService } from './knowledge-index-service';
import { KnowledgeVault } from './knowledge-vault';

afterEach(() => vi.useRealTimers());

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('application shutdown', () => {
  it('stops producers before startup settles and closes real SQLite only after extraction joins', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'application-shutdown-'));
    const store = AppStore.open(path.join(directory, 'application.sqlite'));
    const entered = deferred();
    const release = deferred();
    const ready = deferred();
    const events = vi.fn();
    const vault = new KnowledgeVault(path.join(directory, 'knowledge.sqlite'), {
      extractor: async (format, _bytes, _context, signal) => {
        entered.resolve();
        await release.promise;
        signal?.throwIfAborted();
        return { format, content: 'Late extraction', sections: [] };
      },
    });
    const index = new KnowledgeIndexService({
      vault,
      embedding: {
        defaultSnapshot: () => {
          throw new Error('Semantic indexing is disabled');
        },
        snapshotOf: () => {
          throw new Error('Semantic indexing is disabled');
        },
        embed: vi.fn(),
      },
      onEvent: events,
    });
    const worker = vi.fn(async () => undefined);
    const notifications = vi.fn(async () => undefined);
    const services: ApplicationShutdownServices = {
      startupSettled: ready.promise,
      scheduleHost: { ready: Promise.resolve(), stopForQuit: vi.fn() },
      scheduleScheduler: {
        cancelPreparations: vi.fn(),
        waitForPreparations: vi.fn(async () => undefined),
      },
      knowledgeIndex: index,
      memoryExtractions: { shutdown: vi.fn(async () => undefined) },
      dependencies: { shutdown: vi.fn(async () => undefined) },
      mcpClientService: { shutdown: vi.fn(async () => undefined) },
      knowledgeWorker: { shutdown: worker },
      scheduleNotifications: { waitForPending: notifications },
    };
    const close = vi.fn(() => {
      vault.close();
      store.close();
    });
    const quit = vi.fn();
    const errors = vi.fn();
    const handler = createQuitHandler(() => shutdownApplication(services), close, quit, errors);
    try {
      const file = path.join(directory, 'input.md');
      writeFileSync(file, 'Input document');
      const job = index.startImport([file]);
      await entered.promise;
      handler({ preventDefault: vi.fn() });
      handler({ preventDefault: vi.fn() });
      await vi.waitFor(() => expect(services.dependencies.shutdown).toHaveBeenCalledOnce());
      expect(services.memoryExtractions.shutdown).toHaveBeenCalledOnce();
      expect(services.mcpClientService.shutdown).toHaveBeenCalledOnce();
      expect(index.getJob(job.jobId)?.status).toBe('interrupted');
      expect(() => index.startImport([file])).toThrow('退出');
      expect(close).not.toHaveBeenCalled();
      ready.resolve();
      await Promise.resolve();
      expect(worker).not.toHaveBeenCalled();
      release.resolve();
      await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
      expect(close).toHaveBeenCalledOnce();
      expect(notifications).toHaveBeenCalledOnce();
      expect(worker).toHaveBeenCalledOnce();
      expect(errors).not.toHaveBeenCalled();
      const eventCount = events.mock.calls.length;
      await index.shutdown();
      handler({ preventDefault: vi.fn() });
      expect(events).toHaveBeenCalledTimes(eventCount);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      ready.resolve();
      release.resolve();
      await index.shutdown();
      if (close.mock.calls.length === 0) {
        vault.close();
        store.close();
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('stops every producer even if one shutdown throws synchronously', async () => {
    const dependencies = vi.fn(async () => undefined);
    const mcp = vi.fn(async () => undefined);
    const worker = vi.fn(async () => undefined);
    await expect(
      shutdownApplication({
        startupSettled: Promise.resolve(),
        scheduleHost: { ready: Promise.resolve(), stopForQuit: vi.fn() },
        scheduleScheduler: {
          cancelPreparations: vi.fn(),
          waitForPreparations: vi.fn(async () => undefined),
        },
        memoryExtractions: {
          shutdown: () => {
            throw new Error('cleanup failure');
          },
        },
        dependencies: { shutdown: dependencies },
        mcpClientService: { shutdown: mcp },
        knowledgeWorker: { shutdown: worker },
      }),
    ).rejects.toThrow('Background work failed to stop');
    expect(dependencies).toHaveBeenCalledOnce();
    expect(mcp).toHaveBeenCalledOnce();
    expect(worker).not.toHaveBeenCalled();
  });
  it('keeps storage open after the deadline and reuses pending cleanup on a later quit', async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const shutdown = vi.fn(() => gate.promise);
    const close = vi.fn();
    const quit = vi.fn();
    const errors = vi.fn();
    const handler = createQuitHandler(shutdown, close, quit, errors, { timeoutMs: 100 });
    handler({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(100);
    expect(errors).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    handler({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(shutdown).toHaveBeenCalledOnce();
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('prevents repeated quit events until asynchronous cleanup and storage close complete', async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const calls: string[] = [];
    const handler = createQuitHandler(
      async () => {
        calls.push('shutdown');
        await pending;
      },
      () => {
        calls.push('close');
      },
      () => {
        calls.push('quit');
      },
      (error) => {
        throw error;
      },
    );
    const preventDefault = vi.fn();
    handler({ preventDefault });
    handler({ preventDefault });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['shutdown']);
    finish?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(['shutdown', 'close', 'quit']);
    handler({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });
  it('keeps storage open when cleanup fails and allows a later retry', async () => {
    const shutdown = vi
      .fn()
      .mockRejectedValueOnce(new Error('cleanup failed'))
      .mockResolvedValue(undefined);
    const close = vi.fn();
    const quit = vi.fn();
    const errors = vi.fn();
    const handler = createQuitHandler(shutdown, close, quit, errors);
    handler({ preventDefault: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    handler({ preventDefault: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(quit).toHaveBeenCalledOnce();
  });
});
