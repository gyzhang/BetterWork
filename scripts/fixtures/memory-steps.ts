import { checkMemoryRetryIdentity } from './ui-governance-fixture';
import { click, hasText, requireElement, setInput, waitFor } from './ui-page-step-support';

export async function runMemorySteps(step: string): Promise<void> {
  if (step === 'memory-list') {
    await waitFor(() => hasText('待确认：复盘时标明资料缺项。') && hasText('提炼失败'));
    if (
      document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('已确认')
    )
      throw new Error('候选自动确认');
    click('已确认');
  }

  if (step === 'memory-failed') {
    click('编辑');
    await waitFor(() => Boolean(document.querySelector('.memory-editor-host textarea')));
    await setInput('记忆正文', '用户修改：每次复盘先核对口径与来源。');
    click('保存修改');
    await waitFor(() => hasText('合成故障：记忆保存失败，输入保留'));
    if (
      !requireElement<HTMLTextAreaElement>('.memory-editor-host textarea').value.includes(
        '用户修改',
      )
    )
      throw new Error('记忆失败丢失输入');
  }

  if (step === 'memory-recovered') {
    click('保存修改');
    await waitFor(() => !document.querySelector('.memory-editor-host'));
    checkMemoryRetryIdentity();
    click('设为优先带入');
    await waitFor(() => hasText('取消优先带入'));
  }

  if (step === 'candidate-confirmed') {
    click('待确认');
    await waitFor(() =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].some(
        (item) => item.textContent?.trim() === '确认' && !item.disabled,
      ),
    );
    click('确认');
    await waitFor(() => !hasText('待确认：复盘时标明资料缺项。'));
    click('已确认');
    await waitFor(() => hasText('待确认：复盘时标明资料缺项。'));
  }

  if (step === 'job-running') {
    click('重新提炼');
    await waitFor(
      () =>
        hasText('正在提炼') &&
        Boolean(
          [...document.querySelectorAll('button')].find(
            (item) => item.textContent?.trim() === '取消',
          ),
        ),
    );
  }

  if (step === 'job-cancelled') {
    click('取消');
    await waitFor(
      () =>
        hasText('已取消') &&
        ![...document.querySelectorAll('button')].find(
          (item) => item.textContent?.trim() === '取消',
        ),
    );
  }

  if (step === 'job-zero') {
    click('提炼规则与历史作业');
    await waitFor(() => hasText('已完成，这次没有值得长期保留的经验'));
  }

  if (step === 'memory-history') {
    click('历史与已停用');
    await waitFor(() => hasText('以后不用：旧工作要求。'));
    const row = [...document.querySelectorAll('.memory-row')].find((item) =>
      item.textContent?.includes('以后不用：旧工作要求。'),
    );
    if (!row) throw new Error('缺终态记录');
    if (
      row?.textContent?.includes('确认') ||
      row?.querySelector('button')?.textContent?.includes('编辑')
    )
      throw new Error('终态记录可被恢复');
    click('已过期');
    await waitFor(() => hasText('已到期：旧期间约束。'));
  }
}
