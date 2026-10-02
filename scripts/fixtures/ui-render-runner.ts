import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, type NativeImage } from 'electron';

import { colorSchemes } from '../../apps/desktop/src/renderer/src/appearance';

function outputDirectory(): string {
  const directory = process.argv[2];
  if (!directory) throw new Error('缺测试输出目录');
  return directory;
}
const output = outputDirectory();
// 独立的临时 Chromium 数据目录；不加载产品 Preload、不读取 SQLite、不调用服务。
app.setPath('userData', path.join(output, 'user-data'));
// 测试宿主使用软件合成，减少对桌面显示服务和 GPU 状态的依赖。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {
  // 每一组结束会销毁窗口；矩阵完成前保持独立测试进程存活，由 run 显式给出退出码。
});

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

/** 读取 DOM 后等待新 paint；capturePage 可能仍拿到旧主题或打开模态前的帧。 */
async function paintedFrame(window: BrowserWindow): Promise<NativeImage> {
  await window.webContents.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
  );
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.webContents.removeListener('paint', onPaint);
      reject(new Error('等待新绘制帧超时'));
    }, 1000);
    const onPaint = (_event: unknown, _rect: unknown, image: NativeImage): void => {
      clearTimeout(timeout);
      resolve(image);
    };
    window.webContents.once('paint', onPaint);
    window.webContents.invalidate();
  });
}

interface FrameSample {
  x: number;
  y: number;
  width: number;
  height: number;
  color: number[];
}

async function captureVerifiedFrame(
  window: BrowserWindow,
  filename: string,
  modal: boolean,
): Promise<void> {
  await window.webContents.executeJavaScript(
    'Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => false)))',
  );
  const samples = (await window.webContents.executeJavaScript(`(() => {
    const panel = document.querySelector('[aria-modal="true"]');
    const rect = panel?.getBoundingClientRect();
    const rgb = element => getComputedStyle(element).backgroundColor.match(/\\d+(?:\\.\\d+)?/g).map(Number);
    let canvas = rgb(document.body).slice(0,3);
    if (${modal ? 'true' : 'false'}) {
      const overlay = rgb(document.querySelector('.modal-backdrop'));
      const alpha = overlay[3] ?? 1;
      canvas = canvas.map((channel,index) => Math.round(channel * (1-alpha) + overlay[index] * alpha));
    }
    const samples = [{x: innerWidth - 20, y: innerHeight - 20,
      width: innerWidth, height: innerHeight, color: canvas}];
    if (${modal ? 'true' : 'false'} && panel && rect)
      samples.push({x: rect.left + 4, y: rect.top + rect.height / 2,
        width: innerWidth, height: innerHeight, color: rgb(panel).slice(0,3)});
    return samples;
  })()`)) as FrameSample[];
  let mismatch = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const image = await paintedFrame(window);
    const size = image.getSize();
    // Chromium 的原始 N32 位图在本项目 macOS/Linux x64/arm64 运行环境为 BGRA。
    const bitmap = image.toBitmap();
    mismatch = '';
    for (const sample of samples) {
      const x = Math.floor((sample.x * size.width) / sample.width);
      const y = Math.floor((sample.y * size.height) / sample.height);
      const offset = (y * size.width + x) * 4;
      const pixel = [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]];
      if (
        !pixel.every(
          (value, index) =>
            value !== undefined && Math.abs(value - (sample.color[index] ?? -1)) <= 2,
        )
      ) {
        mismatch = `期望 ${sample.color.join('/')}，实测 ${pixel.join('/')}`;
        break;
      }
    }
    if (!mismatch) {
      await writeFile(filename, image.toPNG());
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`截图绘制状态不一致：${modal ? '模态' : '主题画布'} ${mismatch}`);
}

async function run(): Promise<void> {
  await app.whenReady();
  if (process.platform === 'darwin') app.dock?.hide();
  await mkdir(path.join(output, 'screenshots'), { recursive: true });
  const results: unknown[] = [];
  // 逐组另存一份 partial：红在半途时产物里也要有已跑过组的读数，否则跨组对比无从做起。
  // 完成证据仍只写 results.json（矩阵跑完才落地，见 ui-render-check.mjs 的读取处）。
  const persistPartial = async (): Promise<void> => {
    await writeFile(path.join(output, 'results.partial.json'), JSON.stringify(results, null, 2));
  };
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
          await captureVerifiedFrame(window, path.join(output, 'screenshots', `${id}.png`), false);
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
          await captureVerifiedFrame(
            window,
            path.join(output, 'screenshots', `${id}-modal.png`),
            true,
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
          await persistPartial();
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
