import { click, findButton, hasText, method, waitFor } from './ui-app-step-support';

export async function runRecoveryJourney(step: string): Promise<void> {
  if (step === 'restarted') {
    const findRecoveredTask = (): HTMLButtonElement | undefined =>
      [...document.querySelectorAll<HTMLButtonElement>('.workspace-group-tasks button')].find(
        (item) => item.textContent?.includes('生成 Markdown 下期复盘'),
      );
    // 旅程入口安装早于 App 的异步 IPC 初始化；等待实际任务导航，不能把未加载当丢失。
    await waitFor(() => Boolean(findRecoveredTask()));
    await click('工作');
    const task = findRecoveredTask();
    if (!task) throw new Error('重启后任务导航丢失');
    task.click();
    await waitFor(() => hasText('下期复盘已完成') && hasText('合成故障：离线请求失败'));
    await click('设置');
    await click('记忆');
    await waitFor(() => hasText(method) && hasText('取消优先带入'));
  }
  if (step === 'process-history' || step === 'acceptance-history') {
    await click('工作');
    const findTask = (): HTMLButtonElement | undefined =>
      [...document.querySelectorAll<HTMLButtonElement>('.workspace-group-tasks button')].find(
        (item) => item.textContent?.includes('生成 Markdown 本期复盘'),
      );
    await waitFor(() => Boolean(findTask()));
    const task = findTask();
    if (!task) throw new Error('新进程丢失本期任务');
    task.click();
    await waitFor(
      () =>
        hasText('本期复盘已完成') &&
        (step === 'acceptance-history' || hasText('算台上次退出时这次执行被中断')) &&
        !findButton('停止'),
    );
  }
  if (step === 'process-exclusions') {
    await click('查看上下文');
    await click('记忆');
    await waitFor(() => Boolean(findButton('恢复参与选择')));
  }
}
