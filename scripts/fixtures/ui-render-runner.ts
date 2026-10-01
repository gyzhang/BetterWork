import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow } from 'electron';

import { colorSchemes } from '../../apps/desktop/src/renderer/src/appearance';

function outputDirectory(): string {
  const directory = process.argv[2];
  if (!directory) throw new Error('缺测试输出目录');
  return directory;
}
const output = outputDirectory();
// 独立的临时 Chromium 数据目录；不加载产品 Preload、不读取 SQLite、不调用服务。
app.setPath('userData', path.join(output, 'user-data'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {
  // 每一组结束会销毁窗口；矩阵完成前保持独立测试进程存活，由 run 显式给出退出码。
});
if (process.platform === 'linux') {
  // CI 的合成页面没有网络/宿主能力，避免 Ubuntu userns/AppArmor 限制妨碍离屏检查。
  // 此开关只属于这个独立测试进程，不改变产品窗口的 sandbox 契约。
  app.commandLine.appendSwitch('no-sandbox');
}

async function waitFor(window: BrowserWindow, expression: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready: unknown = await window.webContents.executeJavaScript(expression);
    if (ready === true) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`等待渲染条件失败：${expression}`);
}

async function keyboard(window: BrowserWindow, keyCode: string): Promise<void> {
  // 离屏窗口不抢用户桌面焦点；在该测试渲染器里发送受信键盘输入。
  const parameters = {
    key: keyCode,
    code: keyCode,
    windowsVirtualKeyCode: keyCode === 'Tab' ? 9 : 27,
  };
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyDown',
    ...parameters,
  });
  await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyUp',
    ...parameters,
  });
  await window.webContents.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => resolve(true)))',
  );
}

async function run(): Promise<void> {
  await app.whenReady();
  if (process.platform === 'darwin') app.dock?.hide();
  await mkdir(path.join(output, 'screenshots'), { recursive: true });
  const results: unknown[] = [];
  for (const scheme of colorSchemes) {
    for (const mode of ['light', 'dark']) {
      for (const width of [760, 1380]) {
        const id = `${scheme.id}-${mode}-${width}`;
        const window = new BrowserWindow({
          width,
          height: 800,
          useContentSize: true,
          show: false,
          paintWhenInitiallyHidden: true,
          webPreferences: {
            offscreen: true,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        window.webContents.on('console-message', (details) => {
          if (details.level === 'error') console.error(details.message);
        });
        try {
          const url = pathToFileURL(path.join(output, 'index.html'));
          url.searchParams.set('scheme', scheme.id);
          url.searchParams.set('mode', mode);
          await window.loadURL(url.href);
          window.webContents.debugger.attach('1.3');
          await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
            enabled: true,
          });
          await waitFor(window, 'document.documentElement.dataset.fixtureReady === "true"');
          await window.webContents.executeJavaScript('document.fonts.ready');
          const layout: unknown = await window.webContents.executeJavaScript(
            'window.uiRenderChecks.layout()',
          );
          await writeFile(
            path.join(output, 'screenshots', `${id}.png`),
            (await window.webContents.capturePage()).toPNG(),
          );
          await window.webContents.executeJavaScript(
            'document.getElementById("fixture-query").focus()',
          );
          await keyboard(window, 'Tab');
          const focus: unknown = await window.webContents.executeJavaScript(
            'window.uiRenderChecks.focus()',
          );
          await window.webContents.executeJavaScript(
            'document.getElementById("fixture-menu").focus(); document.getElementById("fixture-menu").click()',
          );
          await waitFor(window, 'Boolean(document.querySelector("[role=menu]"))');
          const menu: unknown = await window.webContents.executeJavaScript(
            'window.uiRenderChecks.overlay("menu")',
          );
          await keyboard(window, 'Escape');
          await waitFor(
            window,
            '!document.querySelector("[role=menu]") && document.activeElement.id === "fixture-menu"',
          );
          await window.webContents.executeJavaScript(
            'document.getElementById("fixture-modal").focus(); document.getElementById("fixture-modal").click()',
          );
          await waitFor(window, 'Boolean(document.querySelector("[aria-modal=true]"))');
          const modal: unknown = await window.webContents.executeJavaScript(
            'window.uiRenderChecks.overlay("modal")',
          );
          await window.webContents.executeJavaScript(
            'document.getElementById("fixture-modal-close").focus()',
          );
          await keyboard(window, 'Tab');
          await waitFor(window, 'document.activeElement.id === "fixture-modal-name"');
          await keyboard(window, 'Escape');
          await waitFor(
            window,
            '!document.querySelector("[aria-modal=true]") && document.activeElement.id === "fixture-modal" && !document.querySelector("main").hasAttribute("inert")',
          );
          results.push({ id, layout, focus, menu, modal });
        } catch (error) {
          throw new Error(`真实渲染失败：${id}`, { cause: error });
        } finally {
          window.destroy();
        }
      }
    }
  }
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.warn(`UI 真实渲染检查通过：${results.length} 组；截图与读数：${output}`);
  app.exit(0);
}

run().catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
