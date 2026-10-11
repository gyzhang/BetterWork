import { longTitle } from './ui-page-fixture-data';
import { click, hasText, waitFor } from './ui-page-step-support';

export async function runKnowledgeSteps(step: string): Promise<void> {
  if (step === 'detail-failed' || step === 'detail-recovered') {
    click(`更多操作：${longTitle}`);
    await waitFor(() => Boolean(document.querySelector('[role="menu"]')));
    click('查看详情');
    await waitFor(() =>
      step === 'detail-failed' ? hasText('合成故障：保存文本读取失败') : hasText('第二段保存文本'),
    );
    if ((step === 'detail-failed') !== Boolean(document.querySelector('[role="alert"]')))
      throw new Error('知识详情反馈错误');
  }

  if (step === 'return') {
    click('返回列表');
    await waitFor(() => !hasText('合成故障：保存文本读取失败'));
  }
}
