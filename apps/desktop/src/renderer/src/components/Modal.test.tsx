// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FieldSelect } from './FieldSelect';
import { Modal, type ModalVariant } from './Modal';

afterEach(() => cleanup());

function Harness({
  onClose,
  open = true,
  variant = 'dialog',
  label = '示例面板',
  dismissOnBackdrop = true,
}: {
  onClose: () => void;
  open?: boolean;
  variant?: ModalVariant;
  label?: string;
  dismissOnBackdrop?: boolean;
}): React.JSX.Element {
  const firstRef = useRef<HTMLButtonElement>(null);
  return (
    <main>
      <button type="button">触发元素</button>
      {open ? (
        <Modal
          variant={variant}
          label={label}
          onClose={onClose}
          dismissOnBackdrop={dismissOnBackdrop}
          initialFocusRef={firstRef}
        >
          <button ref={firstRef} type="button">
            第一
          </button>
          <button type="button">中间</button>
          <button type="button">最后</button>
        </Modal>
      ) : undefined}
    </main>
  );
}

describe('Modal 基座', () => {
  it('打开时 inert 掉应用主体并把焦点交给指定元素', () => {
    render(<Harness onClose={vi.fn()} />);
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '第一' }));
  });

  it('没有指定初始焦点时聚焦面板内第一个可聚焦元素', () => {
    const { container } = render(
      <main>
        <button type="button">触发元素</button>
        <Modal variant="sheet" label="抽屉" onClose={vi.fn()}>
          <input aria-label="名称" />
          <button type="button">保存</button>
        </Modal>
      </main>,
    );
    expect(container.ownerDocument.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('关闭时归还焦点并解除 inert', () => {
    const { rerender } = render(<Harness onClose={vi.fn()} open={false} />);
    const opener = screen.getByRole('button', { name: '触发元素' });
    opener.focus();
    rerender(<Harness onClose={vi.fn()} />);
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(true);
    rerender(<Harness onClose={vi.fn()} open={false} />);
    expect(document.activeElement).toBe(opener);
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(false);
  });

  it('Esc 从 window 生效，即使焦点已经走到面板深处', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const inner = screen.getByRole('button', { name: '中间' });
    inner.focus();
    fireEvent.keyDown(inner, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Tab 在三元以上的面板里循环，两端都能兜住', () => {
    render(<Harness onClose={vi.fn()} />);
    const last = screen.getByRole('button', { name: '最后' });
    const first = screen.getByRole('button', { name: '第一' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('焦点被移出面板时按 Tab 拉回面板内', () => {
    render(<Harness onClose={vi.fn()} />);
    const outside = screen.getByRole('button', { name: '触发元素' });
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '第一' }));
  });

  it('点背板关闭，点面板内不关闭', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: '中间' }));
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = document.querySelector('.modal-backdrop');
    if (!backdrop) throw new Error('背板缺失');
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismissible=false 时背板不再关闭（未保存表单不能被误点丢弃）', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} dismissOnBackdrop={false} />);
    const backdrop = document.querySelector('.modal-backdrop');
    if (!backdrop) throw new Error('背板缺失');
    fireEvent.mouseDown(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('role 与 aria 属性齐备，普通覆盖层是 dialog', () => {
    render(<Harness onClose={vi.fn()} label="示例面板" />);
    const dialog = screen.getByRole('dialog', { name: '示例面板' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('data-variant')).toBe('dialog');
  });

  it('破坏性确认走 alertdialog', () => {
    render(
      <main>
        <Modal variant="dialog" label="危险操作" alert onClose={vi.fn()}>
          <button type="button">确认删除</button>
        </Modal>
      </main>,
    );
    expect(screen.getByRole('alertdialog', { name: '危险操作' })).toBeTruthy();
  });

  it('重渲染不抢回初始焦点', () => {
    const { rerender } = render(<Harness onClose={vi.fn()} />);
    const middle = screen.getByRole('button', { name: '中间' });
    middle.focus();
    rerender(<Harness onClose={vi.fn()} />);
    expect(document.activeElement).toBe(middle);
  });
});

describe('模态内的菜单类浮层', () => {
  const ROLE_OPTIONS = [
    { id: 'language', label: '语言模型' },
    { id: 'vision', label: '视觉模型' },
  ];

  const openSheet = (onClose = vi.fn()): void => {
    render(
      <main>
        <Modal variant="sheet" label="编辑模型" onClose={onClose}>
          <FieldSelect
            ariaLabel="模型角色"
            value="language"
            onChange={() => undefined}
            options={ROLE_OPTIONS}
          />
          <button type="button">保存</button>
        </Modal>
      </main>,
    );
    fireEvent.click(screen.getByRole('button', { name: '模型角色' }));
  };

  it('抽屉里点下拉能展开菜单：菜单 portal 在 body 上，不在被 inert 的壳里', () => {
    openSheet();

    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(menu.getAttribute('data-overlay-layer')).toBe('popover');
    expect(screen.getByRole('menuitem', { name: '视觉模型' })).toBeTruthy();
  });

  it('焦点在菜单里时，面板的 Tab 循环不抢焦点', () => {
    openSheet();
    const item = screen.getByRole('menuitem', { name: '视觉模型' });
    item.focus();

    fireEvent.keyDown(window, { key: 'Tab' });

    expect(document.activeElement).toBe(item);
  });

  it('菜单吃掉 Esc 时只关那一层，抽屉不关', () => {
    const onClose = vi.fn();
    openSheet(onClose);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
