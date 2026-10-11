export const hasText = (text: string): boolean =>
  document.body.textContent?.includes(text) ?? false;

export const requireElement = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`缺页面元素：${selector}`);
  return element;
};

export const click = (name: string): void => {
  const button = [
    ...document.querySelectorAll<HTMLElement>('button, summary, [role="menuitem"]'),
  ].find(
    (item) =>
      item.getAttribute('aria-label') === name ||
      item.textContent?.trim() === name ||
      (item.getAttribute('role') === 'tab' && item.textContent?.trim().startsWith(name)) ||
      item.querySelector('.list-row-title')?.textContent === name,
  );
  if (
    !button ||
    (button instanceof HTMLButtonElement && button.disabled) ||
    button.getAttribute('aria-disabled') === 'true'
  )
    throw new Error(`缺可用页面动作：${name}`);
  button.focus();
  button.click();
};

export async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('页面状态未到达');
}

export async function setInput(label: string, value: string): Promise<void> {
  const field = [...document.querySelectorAll('label')].find(
    (item) => item.textContent?.trim() === label,
  );
  const labelled = [...document.querySelectorAll('input, textarea')].find(
    (item) => item.getAttribute('aria-label') === label,
  );
  const input =
    labelled ??
    (field?.htmlFor
      ? document.getElementById(field.htmlFor)
      : field?.querySelector('input, textarea'));
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement))
    throw new Error(`缺输入字段：${label}`);
  const descriptor = Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    'value',
  );
  if (!descriptor?.set) throw new Error('缺原生输入接口');
  descriptor.set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
