import path from 'node:path';
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';

/**
 * 首帧窗口主题。
 *
 * 这两个值必须与青玉浅色 Variant 的 `--canvas` / `--text-primary` 一致
 * （见 `renderer/src/styles.css` 与 docs/10 §9.6）。它们只在 Renderer 挂载、
 * 通过 `window:update-theme` 回报真实 Token 之前生效，作用是避免冷启动时
 * 闪一下白底。改动色系默认值时要同步这里。
 */
export const INITIAL_WINDOW_THEME = {
  backgroundColor: '#F6F7F5',
  symbolColor: '#1D2420',
} as const;

export const WINDOW_LAYOUT = {
  width: 1380,
  height: 860,
  minWidth: 980,
  minHeight: 640,
  /** macOS 红绿灯的横向占位约 16–68px，侧栏折叠宽度 88px 由此倒推（docs/10 §8.1）。 */
  trafficLightPosition: { x: 16, y: 18 },
} as const;

export function createMainWindow(): BrowserWindow {
  const options: BrowserWindowConstructorOptions = {
    width: WINDOW_LAYOUT.width,
    height: WINDOW_LAYOUT.height,
    minWidth: WINDOW_LAYOUT.minWidth,
    minHeight: WINDOW_LAYOUT.minHeight,
    title: '算台 BetterWork',
    backgroundColor: INITIAL_WINDOW_THEME.backgroundColor,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: WINDOW_LAYOUT.trafficLightPosition,
        }
      : {}),
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: INITIAL_WINDOW_THEME.backgroundColor,
            symbolColor: INITIAL_WINDOW_THEME.symbolColor,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // 安全基线：Renderer 拿不到 Node 能力，只能通过 preload 暴露的类型化 API 通信
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };

  const window = new BrowserWindow(options);
  const target = process.env.ELECTRON_RENDERER_URL
    ? window.loadURL(process.env.ELECTRON_RENDERER_URL)
    : window.loadFile(path.join(__dirname, '../renderer/index.html'));
  target.catch((error: unknown) => {
    console.error('Renderer failed to load', error);
  });
  return window;
}
