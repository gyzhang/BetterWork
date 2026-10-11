import { click, findButton, hasText, waitFor } from './ui-app-step-support';

export async function runArtifactJourney(step: string): Promise<void> {
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
}
