import { longTitle } from './ui-page-fixture-data';
import { click, hasText, requireElement, waitFor } from './ui-page-step-support';

export async function runArtifactSteps(step: string): Promise<void> {
  if (step === 'open') {
    click(longTitle);
    await waitFor(() => hasText('当前版本') && hasText('2 个版本'));
  }

  if (step === 'version-failed') {
    click('打开版本 v1');
    await waitFor(() => hasText('合成故障：历史版本暂不可读'));
    if (!hasText('当前版本') || !document.querySelector('[role="alert"]'))
      throw new Error('版本失败丢失正文或反馈');
  }

  if (step === 'version-recovered') {
    click('打开版本 v1');
    await waitFor(() => hasText('旧版结论仍可回溯。') && !document.querySelector('[role="alert"]'));
  }

  if (step === 'edit-failed') {
    click('编辑此版本');
    await waitFor(() => Boolean(document.querySelector('textarea')));
    const input = requireElement<HTMLTextAreaElement>('textarea');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('缺原生文本输入接口');
    descriptor.set.call(input, `${input.value}\n\n用户修订草稿，保存失败后仍应保留。`);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    click('保存新版本');
    await waitFor(() => hasText('合成故障：保存失败，草稿保留'));
    if (
      !requireElement<HTMLTextAreaElement>('textarea').value.includes(
        '用户修订草稿，保存失败后仍应保留。',
      )
    )
      throw new Error('保存失败丢失草稿');
  }

  if (step === 'save-recovered') {
    click('保存新版本');
    await waitFor(
      () =>
        !document.querySelector('textarea') &&
        hasText('v3') &&
        hasText('用户修订草稿，保存失败后仍应保留。') &&
        hasText('3 个版本') &&
        !document.querySelector('[role="alert"]'),
    );
  }

  if (step === 'back') {
    click('成果');
    await waitFor(() => hasText('可继续工作的交付物'));
  }
}
