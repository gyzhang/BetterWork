// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmationDialog } from './ConfirmationDialog';

describe('ConfirmationDialog', () => {
  it('traps focus, closes with Escape, and restores focus to the invoking control', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <main>
        <button type="button">打开确认</button>
      </main>,
    );
    const opener = screen.getByRole('button', { name: '打开确认' });
    opener.focus();

    rerender(
      <main>
        <button type="button">打开确认</button>
        <ConfirmationDialog
          title="移出资料？"
          detail="只移除索引。"
          confirmLabel="移出"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />
      </main>,
    );

    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '移出' });
    expect(document.activeElement).toBe(cancel);
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(true);

    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(confirm, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <main>
        <button type="button">打开确认</button>
      </main>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '打开确认' }));
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(false);
  });
});
