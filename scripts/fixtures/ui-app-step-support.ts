export const method = '每次复盘先核对口径，再给结论。';

export const hasText = (text: string): boolean =>
  document.body.textContent?.includes(text) ?? false;

export const findButton = (name: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
    (item) =>
      item.getAttribute('aria-label') === name ||
      item.textContent?.trim() === name ||
      (item.getAttribute('role') === 'tab' && item.textContent?.trim().startsWith(name)),
  );

export const click = async (name: string): Promise<void> => {
  const item = findButton(name);
  if (!item || (item instanceof HTMLButtonElement && item.disabled))
    throw new Error(`缺应用动作：${name}`);
  item.scrollIntoView({ block: 'nearest' });
  item.focus();
  item.click();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

export async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`应用状态未到达：${document.body.innerText.slice(-700)}`);
}

export const input = async (selector: string, value: string): Promise<void> => {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement))
    throw new Error(`缺应用输入：${selector}`);
  const descriptor = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    'value',
  );
  if (!descriptor?.set) throw new Error('缺原生输入接口');
  descriptor.set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};
