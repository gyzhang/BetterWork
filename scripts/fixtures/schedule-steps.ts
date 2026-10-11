import { click, hasText, requireElement, setInput, waitFor } from './ui-page-step-support';
import { scheduleContinuationRead, scheduleDocument } from './ui-schedules-fixture';

export async function runScheduleSteps(step: string): Promise<void> {
  if (step === 'schedule-list') {
    await waitFor(() => hasText('月度经营复盘 · Monthly Business Review'));
    if (!document.querySelector('[role="alert"]')) throw new Error('刷新失败未显示内联反馈');
  }

  if (step === 'schedule-list-recovered') {
    click('重试');
    await waitFor(() => !document.querySelector('[role="alert"]'));
    if (!hasText('月度经营复盘 · Monthly Business Review'))
      throw new Error('刷新恢复后列表旧事实丢失');
    const resultBadge = [...document.querySelectorAll<HTMLElement>('.schedule-rows .badge')].find(
      (item) => item.textContent?.trim() === '成果已生成',
    );
    const resultMain = resultBadge?.closest<HTMLElement>('.list-row-main');
    if (
      !resultBadge ||
      !resultMain ||
      resultBadge.getBoundingClientRect().width >= resultMain.getBoundingClientRect().width / 2
    )
      throw new Error('本期结果状态标签被拉伸为整行');
  }

  if (step === 'schedule-detail-open') {
    click('规则与历史');
    await waitFor(() => hasText('2026 年 9 月') && hasText('本期固定配置'));
    if (!hasText('来源快照 · 0 项候选材料') || !hasText('2048 字节'))
      throw new Error('定时详情未呈现固定来源快照事实');
  }

  if (step === 'schedule-action-dialog-open') {
    const opener = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === '立即执行',
    );
    if (!opener) throw new Error('缺立即执行动作');
    opener.focus();
    opener.click();
    await waitFor(() => Boolean(document.querySelector('[aria-modal="true"]')));
    if (!hasText('本期统计期间以确认时刻计算')) throw new Error('立即执行确认文案缺少期间语义');
  }

  if (step === 'schedule-action-dialog-close') {
    const opener = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === '立即执行',
    );
    if (!opener || !document.querySelector('[aria-modal="true"]'))
      throw new Error('立即执行确认层没有保持打开');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(
      () => !document.querySelector('[aria-modal="true"]') && document.activeElement === opener,
    );
  }

  if (step === 'schedule-task-continuation') {
    const taskRow = requireElement<HTMLButtonElement>('.list-row[aria-label^="打开原 Task"]');
    taskRow.focus();
    taskRow.click();
    await waitFor(
      () => scheduleContinuationRead === '已打开原 Task：schedule-task-fixture · 2026 年 9 月',
    );
  }

  if (step === 'schedule-detail-back') {
    click('返回列表');
    await waitFor(() => hasText('按约定时间开始工作'));
  }

  if (step === 'schedule-edit-open') {
    click('编辑');
    await waitFor(
      () => hasText('编辑定时任务') && Boolean(document.querySelector('#schedule-name')),
    );
  }

  if (step === 'schedule-conflict-preserved') {
    await setInput('定时任务名称', '冲突后保留的草稿 Contract Review');
    click('保存并暂停');
    await waitFor(() => hasText('合成冲突：规则已有更新版本。'));
    if (
      requireElement<HTMLInputElement>('#schedule-name').value !==
      '冲突后保留的草稿 Contract Review'
    )
      throw new Error('CAS 冲突后配置草稿丢失');
  }

  if (step === 'schedule-discard-confirm-cancel') {
    click('返回列表');
    await waitFor(() => Boolean(document.querySelector('[role="alertdialog"]')));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(
      () =>
        !document.querySelector('[role="alertdialog"]') &&
        Boolean(document.querySelector('#schedule-name')),
    );
    if (
      requireElement<HTMLInputElement>('#schedule-name').value !==
      '冲突后保留的草稿 Contract Review'
    )
      throw new Error('取消放弃确认后编辑草稿未保留');
  }

  if (step === 'schedule-discard-confirm-accept') {
    click('返回列表');
    await waitFor(() => Boolean(document.querySelector('[role="alertdialog"]')));
    click('放弃草稿');
    await waitFor(() => hasText('按约定时间开始工作'));
    if (hasText('冲突后保留的草稿 Contract Review')) throw new Error('确认放弃后草稿仍显示');
  }

  if (step === 'schedule-create-open') {
    click('新建定时任务');
    await waitFor(() => hasText('新建定时任务'));
  }

  if (step === 'schedule-source-candidate-modal') {
    const opener = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === '选择知识范围',
    );
    if (!opener) throw new Error('缺知识范围入口');
    opener.focus();
    opener.click();
    await waitFor(() =>
      Boolean(document.querySelector('[role="dialog"][aria-label="选择定时任务知识范围"]')),
    );
    await setInput('搜索文档', 'contract-review');
    if (!hasText(scheduleDocument.sourcePath)) throw new Error('长英文路径搜索没有保留文档候选');
    const checkbox = requireElement<HTMLInputElement>(
      '.schedule-source-check-list input[type="checkbox"]',
    );
    checkbox.click();
    if (!checkbox.checked) throw new Error('来源候选勾选没有生效');
  }

  if (step === 'schedule-source-cancel-keyboard') {
    const opener = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent?.trim() === '选择知识范围',
    );
    if (!opener || !document.querySelector('[role="dialog"][aria-label="选择定时任务知识范围"]'))
      throw new Error('知识范围候选层没有保持打开');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(
      () =>
        !document.querySelector('[role="dialog"][aria-label="选择定时任务知识范围"]') &&
        document.activeElement === opener,
    );
    if (!hasText('没有附加知识范围')) throw new Error('Esc 关闭来源选择仍修改了规则草稿');
  }

  if (step === 'schedule-source-confirm') {
    click('选择知识范围');
    await waitFor(() =>
      Boolean(document.querySelector('[role="dialog"][aria-label="选择定时任务知识范围"]')),
    );
    await setInput('搜索文档', '用于长路径换行');
    const checkbox = requireElement<HTMLInputElement>(
      '.schedule-source-check-list input[type="checkbox"]',
    );
    checkbox.click();
    click('确认选择');
    await waitFor(() => hasText('已选 1 项：') && hasText('Contract Review'));
  }

  if (step === 'schedule-create-discard') {
    await setInput('定时任务名称', '新建草稿不应落库 / Unsaved draft');
    click('返回列表');
    await waitFor(() => Boolean(document.querySelector('[role="alertdialog"]')));
    click('放弃草稿');
    await waitFor(() => hasText('按约定时间开始工作'));
  }
}
