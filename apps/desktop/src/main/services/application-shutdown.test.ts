import { describe, expect, it, vi } from 'vitest';

import { createQuitHandler } from './application-shutdown';

describe('application shutdown', () => {
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
