import { click, hasText, requireElement, setInput, waitFor } from './ui-page-step-support';

export async function runExpertSteps(step: string): Promise<void> {
  if (step === 'expert-list') await waitFor(() => hasText('还没有可召唤的专家'));

  if (step === 'expert-editor-open') {
    click('新建专家');
    await waitFor(() => Boolean(document.querySelector('.expert-editor')));
    if (document.activeElement !== document.querySelector('.expert-editor input'))
      throw new Error('专家编辑打开未聚焦名称');
  }

  if (step === 'expert-load-recovered') {
    if (
      !hasText('合成故障：常用参考读取失败') ||
      !document.querySelector('.expert-editor [role=alert]')
    )
      throw new Error('参考读取失败被读成空态');
    await setInput('名称', '失败时的名称草稿');
    click('重试');
    await waitFor(() => !document.querySelector('.expert-editor [role=alert]'));
    if (
      document.querySelector<HTMLInputElement>('.expert-editor input')?.value !== '失败时的名称草稿'
    )
      throw new Error('参考重试丢失草稿');
  }

  if (step === 'expert-cancel') {
    click('取消');
    await waitFor(() => !document.querySelector('.expert-editor'));
    if (document.activeElement?.getAttribute('data-expert-focus') !== 'create')
      throw new Error('专家取消未归还入口焦点');
    if (!hasText('还没有可召唤的专家')) throw new Error('专家取消写入了草稿');
  }

  if (step === 'expert-select' || step === 'expert-select-again') {
    if (!document.querySelector('.expert-editor')) click('新建专家');
    await waitFor(() => Boolean(document.querySelector('.expert-editor')));
    await setInput('名称', '复盘专家 · 合成');
    await setInput('人格与职责', '核对资料与精确版本来源。');
    const group = requireElement<HTMLElement>('[aria-label="当前空间成果版本"]');
    const boxes = [...group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    const otherDisclosure = [...document.querySelectorAll<HTMLDetailsElement>('details')].find(
      (item) => item.textContent?.includes('其他空间成果'),
    );
    if (!otherDisclosure?.open) click('其他空间成果 · 1 项（不可选）');
    await waitFor(() => Boolean(document.querySelector('[aria-label="其他空间成果"] input')));
    const other = requireElement<HTMLInputElement>(
      '[aria-label="其他空间成果"] input[type="checkbox"]',
    );
    if (!other.disabled) throw new Error('跨空间参考可被选入');
    if (!boxes[0]) throw new Error('缺当前空间参考版本');
    boxes[0]?.click();
    await setInput('筛选参考标题或版本', 'v2');
    await waitFor(() => Boolean(document.querySelector('[aria-label="已选参考"] input:checked')));
    if (document.querySelector('[aria-label="其他空间成果"] input:not(:disabled)'))
      throw new Error('跨空间参考可被选入');
  }

  if (step === 'expert-failed') {
    click('保存修订');
    await waitFor(() => hasText('合成故障：专家保存失败'));
    if (!document.querySelector('[aria-label="已选参考"] input:checked') || !hasText('v1'))
      throw new Error('专家保存失败丢失精确参考');
  }

  if (step === 'expert-stale') {
    const selected = requireElement<HTMLInputElement>('[aria-label="已选参考"] input');
    if (selected.disabled) throw new Error('失效的已选参考不可移除');
    selected.click();
    await waitFor(() => !document.querySelector('[aria-label="已选参考"] input'));
    await setInput('筛选参考标题或版本', '');
    await waitFor(() =>
      Boolean(document.querySelector('[aria-label="当前空间成果版本"] input:disabled')),
    );
    // 页面替身把来源恢复；重新加载候选不会重新创建编辑器，用户草稿应仍在。
    window.dispatchEvent(new Event('fixture-reference-recover'));
    await waitFor(
      () =>
        document.querySelector<HTMLInputElement>('[aria-label="当前空间成果版本"] input')
          ?.disabled === false,
    );
    requireElement<HTMLInputElement>('[aria-label="当前空间成果版本"] input').click();
    await waitFor(() => Boolean(document.querySelector('[aria-label="已选参考"] input:checked')));
  }

  if (step === 'expert-recovered') {
    click('保存修订');
    await waitFor(() => hasText('复盘专家 · 合成') && !document.querySelector('.expert-editor'));
    if (document.activeElement?.getAttribute('data-expert-focus') !== 'detail-edit')
      throw new Error('专家保存后未归还详情焦点');
  }
}
