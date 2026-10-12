import { click, findButton, hasText, input, waitFor } from './ui-app-step-support';

export async function runTaskJourney(step: string): Promise<void> {
  if (step === 'ready') await waitFor(() => hasText('协作旅程测试空间'));
  if (step === 'navigation') {
    for (const [name, title] of [
      ['知识', '让资料成为下一次工作的起点'],
      ['技能', '管理可复用的工作方法'],
      ['成果', '可继续工作的交付物'],
      ['专家', '召唤固定的工作方式'],
      ['帮助', '操作手册'],
    ]) {
      if (!name || !title) throw new Error('缺导航验收项');
      await click(name);
      await waitFor(() => hasText(title));
      const body = document.querySelector<HTMLElement>('.main-stage .page-body');
      if (!body || Number.parseFloat(getComputedStyle(body).paddingTop) !== 12)
        throw new Error(`${name} 页正文入口不是 12px`);
    }
    await click('目录');
    await click('2. 首次配置');
    await waitFor(() => document.activeElement?.id === '2-首次配置');
    const image = document.querySelector<HTMLImageElement>('.help-page img');
    if (!image) throw new Error('手册缺少随包截图');
    image.scrollIntoView({ block: 'center' });
    await waitFor(() => image.complete && image.naturalWidth > 0);
    image.parentElement?.click();
    await waitFor(() => Boolean(document.querySelector('.help-screenshot')));
    await click('关闭截图');
    if (document.activeElement !== image.parentElement) throw new Error('关闭截图没有返回阅读位置');
  }
  if (step === 'summon') {
    await click('专家');
    await waitFor(() => hasText('离线复盘专家'));
    await click('召唤');
    await waitFor(
      () =>
        hasText('离线复盘专家') &&
        Boolean(document.querySelector('textarea[aria-label^="任务输入"]')),
    );
    if (
      (document.querySelector('textarea[aria-label^="任务输入"]') as HTMLTextAreaElement).value !==
      ''
    )
      throw new Error('召唤自动填入并发送要求');
  }
  if (
    step === 'first-run' ||
    step === 'second-run' ||
    step === 'failed-run' ||
    step === 'cancelled-run' ||
    step === 'interrupted-start' ||
    step === 'acceptance-hang'
  ) {
    if (
      (step === 'failed-run' || step === 'cancelled-run') &&
      !document.querySelector('textarea[aria-label^="任务输入"]')
    )
      await click('工作');
    await input(
      'textarea[aria-label^="任务输入"]',
      step === 'first-run'
        ? '生成 Markdown 本期复盘，核对选定资料。'
        : step === 'second-run'
          ? '生成 Markdown 下期复盘，使用精确参考与复盘口径。'
          : step === 'failed-run'
            ? '合成故障运行'
            : step === 'acceptance-hang'
              ? '合成挂起'
              : step === 'interrupted-start'
                ? '合成中断运行'
                : '合成取消运行',
    );
    await click('开始工作');
    if (step === 'cancelled-run' || step === 'interrupted-start' || step === 'acceptance-hang') {
      await waitFor(() => Boolean(findButton('停止')));
    } else if (step === 'failed-run') {
      await waitFor(() => hasText('合成故障：离线请求失败'));
    } else
      await waitFor(
        () =>
          hasText(step === 'first-run' ? '本期复盘已完成' : '下期复盘已完成') &&
          !findButton('停止'),
      );
  }
  if (step === 'first-run') {
    const header = document.querySelector<HTMLElement>('.main-stage > .page-header');
    const checkpoint = document.querySelector<HTMLElement>('.workspace > .discussion-checkpoints');
    if (!header || !checkpoint) throw new Error('工作页缺少页头或讨论节点');
    const gap = checkpoint.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
    if (Math.abs(gap - 12) > 1) throw new Error(`讨论节点与页头间距错误：${gap}px`);
    await click('查看上下文');
    for (const name of ['过程', '资料', '记忆', '简报', '成果']) {
      const tabButton = [
        ...document.querySelectorAll<HTMLButtonElement>('.context-panel .tabs [role="tab"]'),
      ].find((item) => item.textContent?.trim() === name);
      if (!tabButton) throw new Error(`缺上下文页签：${name}`);
      tabButton.click();
      await waitFor(
        () =>
          document.querySelector('.context-panel .tabs [aria-selected="true"]')?.textContent ===
          name,
      );
      if (name === '简报')
        await waitFor(() => Boolean(document.querySelector('.brief-panel > .empty-notice')));
      const tabs = document.querySelector<HTMLElement>('.context-panel .tabs');
      const selectedTab = document.querySelector<HTMLButtonElement>(
        '.context-panel [role="tab"][aria-selected="true"]',
      );
      const contentId = selectedTab?.getAttribute('aria-controls');
      const content = contentId ? document.getElementById(contentId) : null;
      const first = content?.firstElementChild;
      if (!tabs || !content || !(first instanceof HTMLElement))
        throw new Error(`${name} 页签缺少首块内容`);
      content.scrollTop = 0;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const firstVisible = first.classList.contains('inline-loading')
        ? first
        : (first.firstElementChild ?? first);
      const emptyNotice =
        name === '简报'
          ? first.querySelector<HTMLElement>('.empty-notice[data-variant="block"]')
          : null;
      const contentTop = emptyNotice
        ? emptyNotice.getBoundingClientRect().top +
          Number.parseFloat(getComputedStyle(emptyNotice).paddingTop)
        : firstVisible.getBoundingClientRect().top;
      const tabGap = contentTop - tabs.getBoundingClientRect().bottom;
      if (Math.abs(tabGap - 12) > 1) throw new Error(`${name} 页签入口间距错误：${tabGap}px`);
    }
    await click('收起上下文面板');
  }
  if (step === 'cancelled-stop') {
    await click('停止');
    await waitFor(() => hasText('已停止') || hasText('已取消'));
  }
}
