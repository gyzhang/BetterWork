import { spawn } from 'node:child_process';
import console from 'node:console';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

import { build } from 'esbuild';

import { assertAcceptanceDestination, launchAcceptance } from './fixtures/acceptance-launch.mjs';
import { runProcessRecovery } from './fixtures/process-recovery.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const uiRenderTimeoutMs = 360_000;
// 默认写进一次性临时目录；CI 用 UI_RENDER_OUTPUT_DIR 指到工作区内，失败时才能整目录传成 artifact。
const requestedOutput = process.env.UI_RENDER_OUTPUT_DIR;
const output = requestedOutput ?? (await mkdtemp(path.join(tmpdir(), 'betterwork-ui-render-')));
if (requestedOutput) await mkdir(requestedOutput, { recursive: true });

try {
  // 指定目录可能复用：旧完成读数不能掩盖本轮 Electron 提前退出。
  const probe = process.argv.slice(2);
  const acceptance = probe.some((argument) =>
    ['--prepare-acceptance', '--reopen-acceptance', '--acceptance-smoke'].includes(argument),
  );
  if (acceptance && probe.length !== 1) throw new Error('离线验收模式不能与检查或探针混用');
  if (probe.includes('--reopen-acceptance') && !requestedOutput)
    throw new Error('重开验收需要指定原 UI_RENDER_OUTPUT_DIR');
  if (!acceptance) {
    await rm(path.join(output, 'results.json'), { force: true });
    await rm(path.join(output, 'matrix-results.json'), { force: true });
  }
  const appOnly = probe.includes('--app-only');
  const crashProbe = probe.includes('--probe-crash-recovery');
  const recoveryOnly = probe.includes('--recovery-only') || crashProbe;
  if (appOnly && recoveryOnly) throw new Error('应用与进程恢复定向选项不能混用');
  if (
    probe.some(
      (argument) =>
        ![
          '--probe-control-height',
          '--probe-snapshot-theme',
          '--probe-snapshot-modal',
          '--probe-page-feedback',
          '--probe-app-persistence',
          '--app-only',
          '--schedule-only',
          '--recovery-only',
          '--probe-crash-recovery',
          '--probe-keyboard',
          '--prepare-acceptance',
          '--reopen-acceptance',
          '--acceptance-smoke',
        ].includes(argument),
    )
  )
    throw new Error('仅支持应用旅程定向检查与已登记的违规探针');
  if (acceptance) await assertAcceptanceDestination(output, probe.includes('--reopen-acceptance'));
  await build({
    entryPoints: [path.join(root, 'scripts/fixtures/ui-render-fixture.tsx')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: path.join(output, 'fixture.js'),
    tsconfig: path.join(root, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  await build({
    entryPoints: [path.join(root, 'scripts/fixtures/ui-render-runner.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(output, 'runner.cjs'),
    external: [
      'electron',
      require.resolve('better-sqlite3', { paths: [path.join(root, 'apps/desktop')] }),
    ],
    alias: {
      'better-sqlite3': require.resolve('better-sqlite3', {
        paths: [path.join(root, 'apps/desktop')],
      }),
    },
    tsconfig: path.join(root, 'tsconfig.json'),
  });
  await build({
    entryPoints: [path.join(root, 'scripts/fixtures/ui-acceptance-host.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(output, 'acceptance.cjs'),
    external: [
      'electron',
      require.resolve('better-sqlite3', { paths: [path.join(root, 'apps/desktop')] }),
    ],
    alias: {
      'better-sqlite3': require.resolve('better-sqlite3', {
        paths: [path.join(root, 'apps/desktop')],
      }),
    },
    tsconfig: path.join(root, 'tsconfig.json'),
  });
  await build({
    entryPoints: [path.join(root, 'scripts/fixtures/ui-process-recovery.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(output, 'recovery.cjs'),
    external: [
      'electron',
      require.resolve('better-sqlite3', { paths: [path.join(root, 'apps/desktop')] }),
    ],
    alias: {
      'better-sqlite3': require.resolve('better-sqlite3', {
        paths: [path.join(root, 'apps/desktop')],
      }),
    },
    tsconfig: path.join(root, 'tsconfig.json'),
  });
  await build({
    entryPoints: [path.join(root, 'scripts/fixtures/ui-page-fixture.tsx')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: path.join(output, 'pages.js'),
    tsconfig: path.join(root, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  await build({
    entryPoints: [path.join(root, 'scripts/fixtures/ui-app-fixture.tsx')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    outfile: path.join(output, 'app.js'),
    tsconfig: path.join(root, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  await build({
    entryPoints: [path.join(root, 'apps/desktop/src/preload/index.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: path.join(output, 'app-preload.cjs'),
    tsconfig: path.join(root, 'tsconfig.json'),
    external: ['electron'],
  });
  await writeFile(
    path.join(output, 'app.html'),
    '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><script defer src="app.js"></script></head><body><div id="root"></div></body></html>',
  );
  await writeFile(
    path.join(output, 'pages.html'),
    '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="pages.css"><script defer src="pages.js"></script></head><body><div id="root"></div></body></html>',
  );
  await writeFile(
    path.join(output, 'index.html'),
    '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"><script defer src="fixture.js"></script></head><body><div id="root"></div></body></html>',
  );
  if (probe.includes('--probe-control-height'))
    await appendFile(
      path.join(output, 'fixture.css'),
      '\n#fixture-button-md { min-height: 16px; padding: 0; }\n',
    );
  if (probe.includes('--probe-snapshot-theme'))
    await appendFile(path.join(output, 'fixture.css'), '\n.fixture-main { background: #fff; }\n');
  if (probe.includes('--probe-snapshot-modal'))
    await appendFile(
      path.join(output, 'fixture.css'),
      '\n.modal-backdrop { opacity: 0 !important; }\n',
    );
  if (probe.includes('--probe-page-feedback'))
    await appendFile(
      path.join(output, 'pages.css'),
      '\n.inline-error { display: none !important; }\n',
    );
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  if (acceptance) {
    const marker = await launchAcceptance({
      electron: require('electron'),
      output,
      root,
      environment,
      reopen: probe.includes('--reopen-acceptance'),
      smoke: probe.includes('--acceptance-smoke'),
    });
    if (probe.includes('--acceptance-smoke')) {
      const reopened = await launchAcceptance({
        electron: require('electron'),
        output,
        root,
        environment,
        reopen: true,
        smoke: true,
      });
      if (
        reopened.databaseDirectory !== marker.databaseDirectory ||
        reopened.pid === marker.pid ||
        reopened.memoryCount < 15 ||
        reopened.runCount !== 6 ||
        reopened.syntheticRequests !== 0
      )
        throw new Error('合成验收重开丢失数据或自动调用模型');
      console.warn('合成验收准备与重开通过；人工结果未填写');
    } else console.warn(`离线合成环境已准备，人工验收仍待判定：${output}；PID ${marker.pid}`);
  } else {
    let status = 0;
    if (!recoveryOnly) {
      const child = spawn(
        require('electron'),
        [
          path.join(output, 'runner.cjs'),
          output,
          ...probe.filter((argument) =>
            [
              '--probe-page-feedback',
              '--probe-app-persistence',
              '--probe-keyboard',
              '--app-only',
              '--schedule-only',
            ].includes(argument),
          ),
        ],
        {
          cwd: root,
          env: environment,
          stdio: 'inherit',
        },
      );
      // 限定单次离线宿主的寿命：启动失败或意外挂起必须给出失败，不能遗留测试窗口。
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, uiRenderTimeoutMs);
      try {
        status = await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code, signal) => {
            if (timedOut) {
              reject(new Error(`UI 渲染检查超过 ${uiRenderTimeoutMs / 1_000} 秒后被终止`));
            } else if (signal) {
              reject(new Error(`UI 渲染检查被 ${signal} 中断`));
            } else resolve(code ?? 1);
          });
        });
      } finally {
        clearTimeout(timeout);
      }
    }
    if (status === 0) {
      // Electron 提前退出不能读成成功：只有跑完矩阵才会写这个完成结果。
      const results = recoveryOnly
        ? []
        : JSON.parse(await readFile(path.join(output, 'matrix-results.json'), 'utf8'));
      const scheduleOnly = probe.includes('--schedule-only');
      if (
        !appOnly &&
        !scheduleOnly &&
        !probe.some((argument) => argument.startsWith('--probe-') && !crashProbe)
      ) {
        await mkdir(path.join(output, 'screenshots'), { recursive: true });
        results.push(
          await runProcessRecovery({
            electron: require('electron'),
            output,
            root,
            environment,
            probe: crashProbe,
          }),
        );
      }
      if (probe.some((argument) => argument.startsWith('--probe-')))
        throw new Error('违规探针未被拦截');
      if (!Array.isArray(results) || results.length === 0) throw new Error('UI 渲染矩阵缺完成证据');
      if (
        (!recoveryOnly &&
          !scheduleOnly &&
          !results.some(
            (item) => item.coverage === 'production-app-with-real-ipc-and-temporary-sqlite',
          )) ||
        (!appOnly &&
          !scheduleOnly &&
          !results.some(
            (item) => item.coverage === 'production-process-recovery-with-temporary-sqlite',
          )) ||
        (!appOnly &&
          !recoveryOnly &&
          !(
            scheduleOnly ? ['schedule'] : ['artifact', 'knowledge', 'expert', 'memory', 'schedule']
          ).every((page) => results.some((item) => item.page === page && item.checks?.length > 0)))
      )
        throw new Error('UI 渲染矩阵缺页面或应用旅程证据');
      await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
      console.warn(`UI 真实渲染检查通过：${results.length} 组；截图与读数：${output}`);
    }
    process.exitCode = status;
  }
} catch (error) {
  console.error('UI 渲染检查失败', error);
  process.exitCode = 1;
}
