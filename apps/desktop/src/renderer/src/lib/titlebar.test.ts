// @vitest-environment jsdom

import type { MouseEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleTitlebarDoubleClick } from './titlebar';

const eventFor = (target: HTMLElement): MouseEvent => ({ target }) as unknown as MouseEvent;

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(window, 'betterwork');
  vi.restoreAllMocks();
});

describe('titlebar native actions', () => {
  it.each(['button', 'input', 'textarea', 'select', 'a'])(
    'does not maximize when %s owns the double click',
    (tag) => {
      const toggleMaximize = vi.fn(async () => ({ maximized: true }));
      Object.defineProperty(window, 'betterwork', {
        configurable: true,
        value: { chrome: { toggleMaximize } },
      });
      const target = document.createElement(tag);
      handleTitlebarDoubleClick(eventFor(target));
      expect(toggleMaximize).not.toHaveBeenCalled();
    },
  );

  it('ignores a nested icon inside an interactive titlebar control', () => {
    const toggleMaximize = vi.fn(async () => ({ maximized: true }));
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: { chrome: { toggleMaximize } },
    });
    const button = document.createElement('button');
    const icon = document.createElement('span');
    button.append(icon);
    handleTitlebarDoubleClick(eventFor(icon));
    expect(toggleMaximize).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)(
    'settles a native maximize %s through the background outlet',
    async (outcome) => {
      const error = new Error('window unavailable');
      const toggleMaximize = vi.fn(async () => {
        if (outcome === 'failure') throw error;
        return { maximized: true };
      });
      const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      Object.defineProperty(window, 'betterwork', {
        configurable: true,
        value: { chrome: { toggleMaximize } },
      });
      handleTitlebarDoubleClick(eventFor(document.createElement('header')));
      await Promise.resolve();
      await Promise.resolve();
      expect(toggleMaximize).toHaveBeenCalledOnce();
      if (outcome === 'failure')
        expect(logger).toHaveBeenCalledExactlyOnceWith('切换窗口最大化 failed', error);
      else expect(logger).not.toHaveBeenCalled();
    },
  );
});
