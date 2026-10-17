import { click, hasText, requireElement, waitFor } from './ui-page-step-support';
import { diagnosticExportCallCount, lastHistoryRequest } from './ui-run-diagnostics-fixture';

export const runDiagnosticsSteps = [
  'diagnostics-open',
  'diagnostics-live',
  'diagnostics-long',
  'diagnostics-mark',
  'diagnostics-export-cancel',
  'diagnostics-keyboard',
  'diagnostics-history',
  'diagnostics-failed',
  'diagnostics-cancelled',
  'diagnostics-return',
];

const dialog = (): HTMLElement => requireElement<HTMLElement>('.run-execution-details');
const dialogHasText = (text: string): boolean =>
  document.querySelector<HTMLElement>('.run-execution-details')?.textContent?.includes(text) ===
  true;

const chooseMenuItem = async (label: string): Promise<void> => {
  let item: HTMLElement | undefined;
  await waitFor(() => {
    item = [...document.querySelectorAll<HTMLElement>('.popover-menu-item')].find((candidate) =>
      candidate.textContent?.includes(label),
    );
    return item !== undefined;
  });
  if (!item) throw new Error(`缺下拉选项：${label}`);
  item.click();
};

export async function runRunDiagnosticsSteps(step: string): Promise<void> {
  if (!step.startsWith('diagnostics-')) return;

  if (step === 'diagnostics-open') {
    click('打开执行详情');
    await waitFor(() => dialogHasText('第 1 轮'));
    if (!dialog().textContent?.includes('进行中')) throw new Error('活动 Run 未显示运行状态');
  }

  if (step === 'diagnostics-live') {
    const fixture = window.uiRunDiagnosticsFixture;
    if (!fixture) throw new Error('缺执行诊断隔离夹具');
    fixture.completeLiveRun();
    await waitFor(() => dialog().textContent?.includes('已完成') === true);
    for (const phase of ['Run · 准备', 'Run · 审计', 'Run · 成果提交']) {
      if (!dialog().textContent?.includes(phase)) throw new Error(`缺宿主诊断阶段：${phase}`);
    }
  }

  if (step === 'diagnostics-long') {
    click('工具载荷与结果');
    await waitFor(() => dialog().textContent?.includes('查看工具载荷') === true);
    click('查看工具载荷');
    await waitFor(() => dialog().textContent?.includes('customer notes') === true);
    if (!dialog().textContent?.includes('载荷已截断')) throw new Error('长工具载荷缺截断提示');
    if (document.documentElement.scrollWidth > innerWidth + 1)
      throw new Error('长诊断内容造成横向溢出');
  }

  if (step === 'diagnostics-mark') {
    requireElement<HTMLButtonElement>('#run-diagnostic-issue-category').click();
    await chooseMenuItem('工具');
    requireElement<HTMLButtonElement>('#run-diagnostic-issue-node').click();
    await chooseMenuItem('tool:run-live:0');
    click('保存标记');
    await waitFor(() => dialog().querySelector('[role="alert"]') !== null);
    if (
      !requireElement<HTMLButtonElement>('#run-diagnostic-issue-category').textContent?.includes(
        '工具',
      )
    )
      throw new Error('保存失败后问题类别选择丢失');
    click('保存标记');
    await waitFor(
      () =>
        document.querySelector('[role="status"]')?.textContent?.includes('问题标记已保存') === true,
    );
    click('关闭提醒');
  }

  if (step === 'diagnostics-export-cancel') {
    const before = diagnosticExportCallCount();
    click('导出本 Run 诊断包');
    await waitFor(() => diagnosticExportCallCount() === before + 1);
    if (dialog().querySelector('[role="alert"]') || dialog().querySelector('[role="status"]'))
      throw new Error('取消诊断包导出产生了反馈');
  }

  if (step === 'diagnostics-keyboard') {
    const close = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === '关闭',
    );
    if (!close) throw new Error('执行详情缺少键盘关闭入口');
    close.focus();
    if (document.activeElement !== close) throw new Error('关闭入口不能获得键盘焦点');
  }

  if (step === 'diagnostics-history') {
    click('打开执行详情');
    await waitFor(() => dialogHasText('已完成'));
    click('记录与统计');
    await waitFor(() => dialog().textContent?.includes('执行记录 · 2 个匹配 Run') === true);
    click('任务范围');
    await chooseMenuItem('整个工作空间');
    click('应用筛选');
    await waitFor(() => dialog().textContent?.includes('Run run-cancelled') === true);
    const request = lastHistoryRequest();
    if (!request || request.filter?.taskId !== undefined)
      throw new Error('工作空间筛选仍限制在当前 Task');
  }

  if (step === 'diagnostics-failed') {
    click('查看 Run run-failed 的执行详情');
    await waitFor(() => dialog().textContent?.includes('失败') === true);
    if (!dialog().textContent?.includes('模型调用 1')) throw new Error('失败历史 Run 过程缺失');
  }

  if (step === 'diagnostics-cancelled') {
    click('返回打开时的 Run');
    await waitFor(() => dialog().textContent?.includes('已完成') === true);
    click('记录与统计');
    await waitFor(() => dialog().textContent?.includes('任务范围') === true);
    click('任务范围');
    await chooseMenuItem('整个工作空间');
    click('应用筛选');
    await waitFor(() => dialog().textContent?.includes('Run run-cancelled') === true);
    click('查看 Run run-cancelled 的执行详情');
    await waitFor(() => dialog().textContent?.includes('已停止') === true);
  }

  if (step === 'diagnostics-return') {
    click('返回打开时的 Run');
    await waitFor(() => dialog().textContent?.includes('已完成') === true);
    if (hasText('reasoning.delta')) throw new Error('详情显示了模型私有推理事件');
  }
}

declare global {
  interface Window {
    uiRunDiagnosticsFixture?: {
      completeLiveRun: () => void;
      lastHistoryRequest: typeof lastHistoryRequest;
      diagnosticExportCallCount: typeof diagnosticExportCallCount;
    };
  }
}
