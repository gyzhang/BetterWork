import '../../apps/desktop/src/renderer/src/styles.css';

import { createRoot } from 'react-dom/client';

import { App } from '../../apps/desktop/src/renderer/src/App';
import { persistAppearance } from '../../apps/desktop/src/renderer/src/appearance';

const method = '每次复盘先核对口径，再给结论。';
const hasText = (text: string): boolean => document.body.textContent?.includes(text) ?? false;
const findButton = (name: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
    (item) =>
      item.getAttribute('aria-label') === name ||
      item.textContent?.trim() === name ||
      (item.getAttribute('role') === 'tab' && item.textContent?.trim().startsWith(name)),
  );
const click = async (name: string): Promise<void> => {
  const item = findButton(name);
  if (!item || (item instanceof HTMLButtonElement && item.disabled))
    throw new Error(`缺应用动作：${name}`);
  item.scrollIntoView({ block: 'nearest' });
  item.focus();
  item.click();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`应用状态未到达：${document.body.innerText.slice(-700)}`);
}
const input = async (selector: string, value: string): Promise<void> => {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement))
    throw new Error(`缺应用输入：${selector}`);
  const descriptor = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    'value',
  );
  if (!descriptor?.set) throw new Error('缺原生输入接口');
  descriptor.set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};
async function runStep(step: string): Promise<{ step: string; alerts: number; width: number }> {
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
  if (step === 'historical-save') {
    const run = (await window.betterwork.runs.list()).find(
      (item) => item.status === 'completed' && item.prompt.includes('下期复盘'),
    );
    if (!run) throw new Error('历史保存缺少已完成的下期 Run');
    const artifact = (await window.betterwork.artifacts.list({ taskId: run.taskId }))[0];
    if (!artifact) throw new Error('历史保存缺少原成果');
    const detail = await window.betterwork.artifacts.get({ id: artifact.id });
    if (!detail || detail.type !== 'markdown') throw new Error('历史保存缺少 Markdown 正文');
    // 合成前置版本：通过生产 IPC 形成 user-edit，使历史回答可以显式另存为当前版本。
    await window.betterwork.artifacts.saveMarkdown({
      artifactId: detail.id,
      taskId: run.taskId,
      origin: 'user-edit',
      title: detail.title,
      content: `${detail.content}\n\n合成准备：保留人工修订。`,
    });
    await click('成果');
    await click('工作');
    await waitFor(() => document.querySelectorAll('.run-group').length === 3);
    const group = [...document.querySelectorAll<HTMLElement>('.run-group')].find((item) =>
      item.textContent?.includes(run.prompt),
    );
    if (!group) throw new Error('历史保存没有定位到目标回答');
    let save: HTMLButtonElement | undefined;
    await waitFor(() => {
      save = [...group.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.textContent?.trim() === '保存为成果',
      );
      return Boolean(save && !save.disabled);
    });
    if (!save) throw new Error('历史回答没有可用的保存入口');
    save.click();
    await waitFor(() => hasText('已保存为 Markdown 成果（v3）。'));
    const confirmations = [...document.querySelectorAll('#toast-stack .toast p')].filter(
      (item) => item.textContent === '已保存为 Markdown 成果（v3）。',
    );
    if (confirmations.length !== 1)
      throw new Error(`历史保存反馈出口重复：${confirmations.length}`);
    const current = await window.betterwork.artifacts.get({ id: artifact.id });
    if (
      !current ||
      current.type !== 'markdown' ||
      current.sourceRunId !== run.id ||
      current.content !== detail.content
    )
      throw new Error('历史保存没有固定目标 Run 和最终正文');
  }
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
  if (step === 'second-draft') {
    await click('成果');
    await waitFor(() => Boolean(document.querySelector('.completed-work-list button.list-row')));
    const artifact = document.querySelector<HTMLButtonElement>(
      '.completed-work-list button.list-row',
    );
    if (!artifact) throw new Error('缺成果身份动作');
    artifact.click();
    await waitFor(() => Boolean(findButton('基于此版本开始新任务')));
    await click('基于此版本开始新任务');
    await waitFor(
      () =>
        Boolean(document.querySelector('textarea[aria-label^="任务输入"]')) &&
        hasText('离线复盘专家'),
    );
    if (
      (document.querySelector('textarea[aria-label^="任务输入"]') as HTMLTextAreaElement).value !==
      ''
    )
      throw new Error('换期未清空本期要求');
  }
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
  if (step === 'process-memory') {
    await click('设置');
    await click('记忆');
    await waitFor(() => hasText(method) && hasText('取消优先带入'));
  }
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  if (
    document.documentElement.dataset.theme !== 'dark' ||
    document.documentElement.dataset.scheme !== 'jade'
  )
    throw new Error('完整应用外观与报告的青玉深色不一致');
  if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error('完整应用横向溢出');
  return { step, alerts: document.querySelectorAll('[role="alert"]').length, width: innerWidth };
}
declare global {
  interface Window {
    uiAppChecks?: { runStep: typeof runStep };
  }
}
persistAppearance({ mode: 'dark', scheme: 'jade' });
window.uiAppChecks = { runStep };
const host = document.getElementById('root');
if (!host) throw new Error('缺应用挂载节点');
createRoot(host).render(<App />);
