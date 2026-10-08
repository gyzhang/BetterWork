// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HelpPage } from './HelpView';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

describe('HelpPage', () => {
  it('navigates with the chapter menu and body links, placing focus on the selected heading', async () => {
    render(<HelpPage />);
    fireEvent.click(screen.getByRole('button', { name: '目录' }));
    const menu = screen.getByRole('menu', { name: '操作手册目录' });
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(14);
    fireEvent.click(within(menu).getByRole('menuitem', { name: '5. 管理知识' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: '5. 管理知识' })),
    );
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: '首次配置' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '2. 首次配置' }));
  });

  it('opens the bundled example and returns to the manual', () => {
    render(<HelpPage />);
    const exampleLink = document.querySelector<HTMLAnchorElement>(
      'a[href="examples/collaboration-notes.md"]',
    );
    if (!exampleLink) throw new Error('missing example link');
    fireEvent.click(exampleLink);
    expect(screen.getByRole('heading', { name: '演示材料' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回手册' }));
    expect(screen.getByRole('heading', { name: '操作手册' })).toBeTruthy();
  });

  it('enlarges local screenshots and returns keyboard focus when dismissed', async () => {
    render(<HelpPage />);
    const imageLink = screen.getByRole('link', { name: '放大截图：工作页与左侧导航' });
    fireEvent.click(imageLink);
    const dialog = screen.getByRole('dialog', { name: '工作页与左侧导航' });
    expect(within(dialog).getByRole('img')).toHaveProperty(
      'src',
      expect.stringContaining('/images/01-work-overview.png'),
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(imageLink);
  });
});
