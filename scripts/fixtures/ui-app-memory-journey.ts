import { click, findButton, hasText, input, method, waitFor } from './ui-app-step-support';

export async function runMemoryJourney(step: string): Promise<void> {
  if (step === 'capture-keyboard') await click('记住这段经验');
  if (step === 'save-source') {
    await click('记住这段经验');
    await waitFor(() => Boolean(document.querySelector('.memory-capture-source')));
    const source = document.querySelector('.memory-capture-source textarea');
    if (!(source instanceof HTMLTextAreaElement)) throw new Error('缺只读原文');
    source.focus();
    source.setSelectionRange(0, Math.min(source.value.length, 30));
    source.dispatchEvent(new Event('select', { bubbles: true }));
    await click('确认选区');
    await waitFor(() => Boolean(findButton('重选')));
    await input('.memory-capture textarea[aria-label="记忆正文"]', source.value.slice(0, 30));
    await click('保留来源并记住');
    await waitFor(() => !document.querySelector('.memory-capture'));
  }
  if (step === 'save-method') {
    await click('设置');
    await click('记忆');
    await waitFor(() => hasText('让长期经验可查看、可确认、可撤回'));
    await click('新增经验');
    await waitFor(() => Boolean(document.querySelector('textarea[aria-label="记忆正文"]')));
    await input('textarea[aria-label="记忆正文"]', method);
    await click('保存为经验');
    await waitFor(() => !document.querySelector('.memory-editor-host') && hasText(method));
    const row = [...document.querySelectorAll('.list-row')].find((item) =>
      item.textContent?.includes(method),
    );
    const pin = [...(row?.querySelectorAll('button') ?? [])].find(
      (item) => item.textContent?.trim() === '设为优先带入',
    );
    if (!pin) throw new Error('缺明确制定口径的优先策略入口');
    pin.click();
    await waitFor(() => hasText('取消优先带入'));
  }
  if (step === 'exclude' || step === 'restore') {
    if (step === 'exclude') {
      await click('工作');
      await input('textarea[aria-label^="任务输入"]', '下一期复盘');
      await click('查看上下文');
      await click('记忆');
      await waitFor(() => hasText(method) && Boolean(findButton('本任务不用')));
      const row = [...document.querySelectorAll('.list-row')].find((item) =>
        item.textContent?.includes(method),
      );
      const exclude = [...(row?.querySelectorAll('button') ?? [])].find(
        (item) => item.textContent?.trim() === '本任务不用',
      );
      if (!exclude) throw new Error('缺工作口径的本任务排除入口');
      exclude.click();
      await waitFor(() => Boolean(findButton('恢复参与选择')));
    } else {
      await click('恢复参与选择');
      await waitFor(() => !findButton('恢复参与选择') && Boolean(findButton('本任务不用')));
      await click('收起上下文面板');
    }
  }
  if (step === 'process-memory') {
    await click('设置');
    await click('记忆');
    await waitFor(() => hasText(method) && hasText('取消优先带入'));
  }
}
