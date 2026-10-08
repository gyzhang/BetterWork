import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, type NativeImage } from 'electron';

import { colorSchemes } from '../../apps/desktop/src/renderer/src/appearance';
import {
  frameAttemptVerdict,
  frameMismatch,
  type FrameSample,
  MAX_SAMPLE_ATTEMPTS,
  settleDelayMs,
} from './frame-verdict';
import { checkConflictKeyboard, checkReferenceKeyboard, keyboard } from './ui-keyboard';

function outputDirectory(): string {
  const directory = process.argv[2];
  if (!directory) throw new Error('缺测试输出目录');
  return directory;
}
const output = outputDirectory();
// 独立的临时 Chromium 数据目录；组件/页面矩阵不加载产品 Preload；最后一组应用旅程另用真实 IPC 与临时 SQLite。
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

async function captureVerifiedFrame(
  window: BrowserWindow,
  filename: string,
  modal: boolean,
): Promise<void> {
  const label = modal ? '模态' : '主题画布';
  // 逐帧读到稳定再判：连续两帧在同一批采样点上读数一致，这一帧才有资格当证据。
  // 慢机器（2026-10-02 的 macOS runner 容量吃紧那一次）第一帧常是「遮罩已画、面板主题还没换上」
  // 的中间态——单帧即判会把环境差异读成缺陷；而真没画出来的形状在两帧里读数相同，照样拦得住。
  // 期望读数每轮重读：DOM 侧的主题与面板矩形也要与刚采的那一帧同时刻，不能拿开帧前的声明比帧后的像素。
  const sampleScript = `(() => {
    const panel = document.querySelector('[aria-modal="true"]');
    const rect = panel?.getBoundingClientRect();
    const rgb = element => getComputedStyle(element).backgroundColor.match(/\\d+(?:\\.\\d+)?/g).map(Number);
    let canvas = rgb(document.body).slice(0,3);
    const memoryPage = Boolean(document.querySelector('.settings-nav-list'));
    if (memoryPage) {
      // 设置侧栏是 raised 表面：从 Token 解析期望色，不能拿被测侧栏自己的声明当期望。
      const swatch = document.createElement('span');
      swatch.style.backgroundColor = 'var(--surface-raised)';
      document.body.appendChild(swatch);
      canvas = rgb(swatch).slice(0,3);
      swatch.remove();
    }
    if (${modal ? 'true' : 'false'}) {
      const overlay = rgb(document.querySelector('.modal-backdrop'));
      const alpha = overlay[3] ?? 1;
      canvas = canvas.map((channel,index) => Math.round(channel * (1-alpha) + overlay[index] * alpha));
    }
    // 业务页右下角可能有合法 toast/滚动条；页面取左侧空画布或设置导航表面。
    const samples = [{x: ${filename.includes('page-') ? '20' : 'innerWidth - 20'}, y: innerHeight - 20,
      width: innerWidth, height: innerHeight, color: canvas}];
    if (${modal ? 'true' : 'false'} && panel && rect)
      samples.push({x: rect.left + 4, y: rect.top + rect.height / 2,
        width: innerWidth, height: innerHeight, color: rgb(panel).slice(0,3)});
    return samples;
  })()`;
  let previous: string | undefined;
  for (let attempt = 0; attempt < MAX_SAMPLE_ATTEMPTS; attempt += 1) {
    await window.webContents.executeJavaScript(
      // 提炼中的 spinner 是合法持续状态；只等有限过渡，画布仍须连续两帧核对。
      'Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => false)))',
    );
    const samples = (await window.webContents.executeJavaScript(sampleScript)) as FrameSample[];
    const image = await paintedFrame(window);
    const size = image.getSize();
    // Chromium 的原始 N32 位图在本项目 macOS arm64 运行环境为 BGRA。
    const mismatch = frameMismatch(samples, {
      data: image.toBitmap(),
      width: size.width,
      height: size.height,
    });
    const verdict = frameAttemptVerdict(previous, mismatch, attempt);
    if (verdict === 'pass') {
      await writeFile(filename, image.toPNG());
      return;
    }
    // 隐藏窗口可能连续返回上个交互状态的旧帧；只有采样预算耗尽后，重复错误才判为稳定缺陷。
    if (verdict === 'fail') throw new Error(`截图绘制状态不一致：${label} ${mismatch}`);
    previous = mismatch;
    await new Promise<void>((resolve) => setTimeout(resolve, settleDelayMs(attempt)));
  }
  throw new Error(`截图绘制状态未稳定：${label} 连采 ${MAX_SAMPLE_ATTEMPTS} 帧仍没有两帧读数一致`);
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
  // 页面反馈反例只跑能触发失败的页面路径；普通 ui:check 仍跑完整矩阵。
  for (const scheme of process.argv.some((argument) =>
    [
      '--probe-page-feedback',
      '--probe-app-persistence',
      '--probe-keyboard',
      '--app-only',
      '--schedule-only',
      '--mcp-only',
    ].includes(argument),
  )
    ? []
    : colorSchemes) {
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
  // 生产页面关键路径使用合成状态/IPC 替身；独立于上面的固定组件矩阵报告覆盖。
  for (const page of process.argv.some((argument) =>
    ['--probe-app-persistence', '--app-only'].includes(argument),
  )
    ? []
    : process.argv.includes('--probe-keyboard')
      ? ['expert']
      : process.argv.includes('--mcp-only')
        ? ['mcp']
        : process.argv.includes('--schedule-only')
          ? ['schedule']
          : ['artifact', 'knowledge', 'expert', 'memory', 'schedule', 'help', 'mcp']) {
    for (const mode of ['light', 'dark']) {
      for (const width of [760, 1380]) {
        for (const reducedMotion of [false, true]) {
          const id = `page-${page}-jade-${mode}-${width}-${reducedMotion ? 'reduced' : 'normal'}`;
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
          const errors: string[] = [];
          window.webContents.on('console-message', (details) => {
            if (details.level === 'error') errors.push(details.message);
          });
          try {
            const url = pathToFileURL(path.join(output, 'pages.html'));
            url.searchParams.set('page', page);
            url.searchParams.set('mode', mode);
            await window.loadURL(url.href);
            window.webContents.debugger.attach('1.3');
            await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
              features: [
                {
                  name: 'prefers-reduced-motion',
                  value: reducedMotion ? 'reduce' : 'no-preference',
                },
              ],
            });
            await waitFor(window, 'document.documentElement.dataset.fixtureReady === "true"');
            await window.webContents.executeJavaScript('document.fonts.ready');
            const steps = (await window.webContents.executeJavaScript(
              'window.uiPageChecks.steps',
            )) as string[];
            if (steps.length === 0) throw new Error('页面回归缺用户路径');
            const checks: unknown[] = [];
            for (const step of steps) {
              let reading: unknown = await window.webContents.executeJavaScript(
                `window.uiPageChecks.runStep(${JSON.stringify(step)}).catch(error => { throw new Error(${JSON.stringify(step)} + ": " + error.message + "; " + document.body.innerText.slice(-700)); })`,
              );
              if (step === 'expert-keyboard') {
                if (process.argv.includes('--probe-keyboard'))
                  await window.webContents.executeJavaScript(
                    'document.addEventListener("keydown", event => { if (event.key === "Tab") event.preventDefault(); }, { capture: true })',
                  );
                reading = await checkReferenceKeyboard(window);
              }
              if (step === 'memory-keyboard') reading = await checkConflictKeyboard(window);
              if (errors.length > 0) throw new Error(`页面运行错误：${errors.join('；')}`);
              const modalOpen = (await window.webContents.executeJavaScript(
                'Boolean(document.querySelector("[aria-modal=true]"))',
              )) as boolean;
              await captureVerifiedFrame(
                window,
                path.join(output, 'screenshots', `${id}-${step}.png`),
                modalOpen,
              );
              checks.push({ step, reading });
            }
            results.push({
              id,
              coverage: 'production-page-with-synthetic-state',
              page,
              mode,
              width,
              reducedMotion,
              checks,
            });
          } catch (error) {
            await writeFile(
              path.join(output, 'screenshots', `${id}-failed.png`),
              (await window.webContents.capturePage()).toPNG(),
            );
            throw new Error(
              `生产页面回归失败：${id}；浏览器错误：${errors.join('；') || '无'}；页面诊断：${JSON.stringify(await window.webContents.executeJavaScript('({ error: document.documentElement.dataset.fixtureError, text: document.body.innerText, buttons: [...document.querySelectorAll("button")].map(button => button.textContent?.trim()), errors: [...document.querySelectorAll("[role=alert]")].map(item => item.textContent) })'))}`,
              { cause: error },
            );
          } finally {
            await persistPartial();
            window.destroy();
          }
        }
      }
    }
  }
  if (
    !process.argv.includes('--probe-page-feedback') &&
    !process.argv.includes('--schedule-only') &&
    !process.argv.includes('--mcp-only')
  ) {
    const { runAppJourney } = await import('./ui-app-journey');
    results.push(
      await runAppJourney(
        output,
        async (window, filename) => {
          await writeFile(filename, (await paintedFrame(window)).toPNG());
        },
        process.argv.includes('--probe-app-persistence'),
      ),
    );
    await persistPartial();
  }
  await writeFile(path.join(output, 'matrix-results.json'), JSON.stringify(results, null, 2));
  console.warn(`UI 矩阵与应用旅程完成：${results.length} 组；截图与读数：${output}`);
  app.exit(0);
}

run().catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
