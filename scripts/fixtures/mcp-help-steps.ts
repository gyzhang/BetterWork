import { click, hasText, requireElement, setInput, waitFor } from './ui-page-step-support';

export async function runMcpHelpSteps(step: string): Promise<void> {
  if (step === 'mcp-editor') {
    click('新建连接');
    await waitFor(() => Boolean(document.querySelector('.mcp-editor input')));
    await setInput('名称', '本机经营资料与长标题 / Local contract review');
  }

  if (step === 'mcp-http') {
    click('本地命令 · stdio');
    await waitFor(() => Boolean(document.querySelector('[role="menuitem"]')));
    click('HTTP · Streamable HTTP');
    await waitFor(() =>
      Boolean(document.querySelector('.mcp-editor input[placeholder="https://example.com/mcp"]')),
    );
    await setInput('服务地址', 'https://mcp.synthetic.invalid/' + 'long-path-'.repeat(16));
  }

  if (step === 'mcp-secret') {
    click('无认证');
    await waitFor(() => Boolean(document.querySelector('[role="menuitem"]')));
    click('API Key 请求头');
    await waitFor(() => Boolean(document.querySelector('#mcp-http-secret')));
    await setInput('API Key 请求头名称', 'X-API-Key');
    await setInput('API Key', 'synthetic-write-only-value');
  }

  if (step === 'mcp-failed-save') {
    click('保存');
    await waitFor(() => hasText('合成配置冲突'));
  }

  if (step === 'mcp-return') click('取消');

  if (step === 'mcp-consent') {
    click('登录');
    await waitFor(() => hasText('contract.read'));
  }

  if (step === 'mcp-failed-login') {
    click('在浏览器中继续');
    await waitFor(() => hasText('合成授权失败'));
  }

  if (step === 'mcp-menu') {
    click('更多操作');
    await waitFor(() => Boolean(document.querySelector('[role="menu"]')));
  }

  if (step === 'help-read') {
    await waitFor(() => Boolean(document.querySelector('.help-page')));
    const images = [...document.querySelectorAll<HTMLImageElement>('.help-page img')];
    if (!images.length) throw new Error('手册没有随包截图');
    await Promise.all(
      images.map(async (image) => {
        image.loading = 'eager';
        await image.decode();
      }),
    );
  }

  if (step === 'help-directory') {
    click('目录');
    await waitFor(() => document.querySelectorAll('[role="menuitem"]').length === 14);
  }

  if (step === 'help-chapter') {
    click('4. 从材料到成果的完整示例');
    await waitFor(() => document.activeElement?.id === '4-从材料到成果的完整示例');
  }

  if (step === 'help-image') {
    const link = requireElement<HTMLAnchorElement>('.help-page a[aria-label^="放大截图"]');
    link.scrollIntoView({ block: 'center' });
    link.click();
    await waitFor(() => Boolean(document.querySelector('.help-screenshot')));
    await requireElement<HTMLImageElement>('.help-screenshot').decode();
  }

  if (step === 'help-image-close') {
    click('关闭截图');
    await waitFor(() => !document.querySelector('[role="dialog"]'));
    if (!document.activeElement?.matches('a[aria-label^="放大截图"]'))
      throw new Error('截图焦点未归还');
  }

  if (step === 'help-example') {
    requireElement<HTMLAnchorElement>(
      '.help-page a[href="examples/collaboration-notes.md"]',
    ).click();
    await waitFor(() => hasText('返回手册'));
  }

  if (step === 'help-return') {
    click('返回手册');
    await waitFor(() => hasText('1. 设计用途'));
  }
}
