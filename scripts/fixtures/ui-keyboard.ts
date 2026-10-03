import assert from 'node:assert/strict';

import type { BrowserWindow } from 'electron';

export async function keyboard(
  window: BrowserWindow,
  key: 'Tab' | 'Escape' | 'Enter' | 'Space',
  shift = false,
): Promise<void> {
  const parameters = {
    key: key === 'Space' ? ' ' : key,
    code: key,
    windowsVirtualKeyCode: { Tab: 9, Escape: 27, Enter: 13, Space: 32 }[key],
    modifiers: shift ? 8 : 0,
  };
  for (const type of ['keyDown', 'keyUp'])
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type,
      ...parameters,
      ...(type === 'keyDown' && (key === 'Enter' || key === 'Space')
        ? { text: key === 'Enter' ? '\r' : ' ' }
        : {}),
    });
  await window.webContents.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => resolve(true)))',
  );
}

async function focused(window: BrowserWindow, selector: string): Promise<void> {
  const reading: unknown = await window.webContents.executeJavaScript(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    const style = target ? getComputedStyle(target) : null;
    return { focused: target === document.activeElement,
      ring: Boolean(style && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 1),
      visible: Boolean(target && target.getBoundingClientRect().width > 0) };
  })()`);
  assert.ok(
    reading &&
      typeof reading === 'object' &&
      'focused' in reading &&
      'ring' in reading &&
      'visible' in reading,
  );
  assert.equal(reading.focused, true, `键盘焦点未到达：${selector}`);
  assert.equal(reading.ring, true, `键盘焦点环不可见：${selector}`);
  assert.equal(reading.visible, true, `键盘目标不可见：${selector}`);
}

export async function checkReferenceKeyboard(window: BrowserWindow): Promise<unknown> {
  const filter = '[aria-label="筛选参考标题或版本"]';
  const trigger = '[aria-label="参考类型"]';
  const before: unknown = await window.webContents.executeJavaScript(`(() => {
    document.querySelector(${JSON.stringify(filter)}).focus();
    return [...document.querySelectorAll('.expert-editor input, .expert-editor textarea')]
      .map(item => ({ value: item.value, checked: item.checked }));
  })()`);
  await keyboard(window, 'Tab');
  await focused(window, trigger);
  await keyboard(window, 'Tab', true);
  await focused(window, filter);
  await keyboard(window, 'Tab');
  await keyboard(window, 'Enter');
  await focused(window, '[role="menu"] [role="menuitem"]');
  await keyboard(window, 'Escape');
  await focused(window, trigger);
  assert.equal(
    await window.webContents.executeJavaScript('Boolean(document.querySelector("[role=menu]"))'),
    false,
  );
  const after: unknown = await window.webContents.executeJavaScript(`
    [...document.querySelectorAll('.expert-editor input, .expert-editor textarea')]
      .map(item => ({ value: item.value, checked: item.checked }))`);
  assert.deepEqual(after, before, '参考菜单 Esc 改动草稿或精确参考');
  await keyboard(window, 'Tab');
  await focused(window, '[aria-label="已选参考"] input');
  return {
    nativeKeys: ['Tab', 'Shift+Tab', 'Tab', 'Enter', 'Escape', 'Tab'],
    draftPreserved: true,
    focusReturned: true,
  };
}

export async function checkConflictKeyboard(window: BrowserWindow): Promise<unknown> {
  const trigger = '.memory-conflict [aria-label="替代后保留的记忆"]';
  const note = '.memory-conflict input:not([type="checkbox"])';
  await window.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(trigger)}).focus()`,
  );
  await keyboard(window, 'Tab');
  await focused(window, note);
  await window.webContents.debugger.sendCommand('Input.insertText', {
    text: '月报按回款，合同按签约。',
  });
  await keyboard(window, 'Tab', true);
  await focused(window, trigger);
  await keyboard(window, 'Enter');
  await focused(window, '[role="menu"] [role="menuitem"]');
  await keyboard(window, 'Escape');
  await focused(window, trigger);
  await keyboard(window, 'Tab');
  await focused(window, note);
  await keyboard(window, 'Escape');
  assert.equal(
    await window.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(note)}).value`,
    ),
    '月报按回款，合同按签约。',
    '内联冲突 Esc 丢失适用条件',
  );
  assert.equal(
    await window.webContents.executeJavaScript('Boolean(document.querySelector("[role=menu]"))'),
    false,
  );
  return {
    nativeKeys: ['Tab', 'insertText', 'Shift+Tab', 'Enter', 'Escape', 'Tab', 'Escape'],
    inlineDraftPreserved: true,
    focusReturned: true,
  };
}

export async function checkCaptureKeyboard(window: BrowserWindow): Promise<unknown> {
  const source = '.memory-capture-source textarea';
  assert.equal(
    await window.webContents.executeJavaScript(
      `document.activeElement === document.querySelector(${JSON.stringify(source)})`,
    ),
    true,
    '捕获打开未聚焦原文',
  );
  const route: string[] = [];
  for (let index = 0; index < 20; index += 1) {
    await keyboard(window, 'Tab');
    const name: unknown = await window.webContents.executeJavaScript(
      'document.activeElement?.getAttribute("aria-label") ?? ""',
    );
    assert.equal(typeof name, 'string');
    route.push(String(name));
    if (name !== '记忆正文') continue;
    await focused(window, '.memory-capture [aria-label="记忆正文"]');
    await window.webContents.debugger.sendCommand('Input.insertText', { text: '未提交的键盘草稿' });
    await keyboard(window, 'Tab', true);
    await keyboard(window, 'Tab');
    await focused(window, '.memory-capture [aria-label="记忆正文"]');
    await keyboard(window, 'Escape');
    assert.equal(
      await window.webContents.executeJavaScript(
        'Boolean(document.querySelector(".memory-capture"))',
      ),
      false,
      '捕获 Esc 未关闭',
    );
    assert.equal(
      await window.webContents.executeJavaScript('document.activeElement?.textContent?.trim()'),
      '记住这段经验',
      '捕获关闭未归还焦点',
    );
    return {
      nativeTabRoute: route,
      shiftTabReturned: true,
      escapedWithoutSubmit: true,
      focusReturned: true,
    };
  }
  throw new Error('捕获自然 Tab 路径无法进入记忆正文');
}
