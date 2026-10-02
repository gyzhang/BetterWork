import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const script = fileURLToPath(new URL('./ui-render-check.mjs', import.meta.url));

/**
 * 这些反例各要真起一次 esbuild 打包＋Electron 矩阵（安静机实测 0.5／1.2／1.6s，整档并发或
 * runner 负载下撞过默认 5 秒超时，2026-10-02 macOS runner 红在第一条）。放宽的是这条子进程
 * **夹具时间**，不是墙钟预算——墙钟与内存断言仍只住在 `*.bench.test.ts`（docs/12 §9）。
 * 断言的边界没有变化：每条都要求 CLI 以指定错误退出，且不得把提前退出读成成功。
 */
const cliTimeout = 20_000;

it(
  '真实控件几何退化必须使 CLI 失败，不能把 Electron 提前退出读成成功',
  () => {
    const result = spawnSync(process.execPath, [script, '--probe-control-height'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    // 断言确实进入真实布局检查，进程/显示服务启动失败不算有效的反向验证。
    expect(result.stderr).toContain('md 输入/选择/按钮不等高');
    expect(result.stdout).not.toContain('UI 真实渲染检查通过');
  },
  cliTimeout,
);

it(
  'DOM 主题读数正确而绘制画布错误时，截图像素门禁仍失败',
  () => {
    const result = spawnSync(process.execPath, [script, '--probe-snapshot-theme'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('截图绘制状态不一致：主题画布');
    expect(result.stdout).not.toContain('UI 真实渲染检查通过');
  },
  cliTimeout,
);

it(
  '模态有布局和焦点但没有绘制时，截图不能作为有效证据',
  () => {
    const result = spawnSync(process.execPath, [script, '--probe-snapshot-modal'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('截图绘制状态不一致：模态');
    expect(result.stdout).not.toContain('UI 真实渲染检查通过');
  },
  cliTimeout,
);

it(
  '生产页面出现错误状态但反馈未绘制时，页面回归必须失败',
  () => {
    const result = spawnSync(process.execPath, [script, '--probe-page-feedback'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('页面反馈不可见');
    expect(result.stdout).not.toContain('UI 真实渲染检查通过');
  },
  cliTimeout,
);
