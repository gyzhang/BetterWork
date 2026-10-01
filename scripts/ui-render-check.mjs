import { spawn } from 'node:child_process';
import console from 'node:console';
import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const output = await mkdtemp(path.join(tmpdir(), 'betterwork-ui-render-'));

try {
  const probe = process.argv.slice(2);
  if (probe.some((argument) => argument !== '--probe-control-height'))
    throw new Error('仅支持 --probe-control-height 违规探针');
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
    external: ['electron'],
  });
  await writeFile(
    path.join(output, 'index.html'),
    '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"><script defer src="fixture.js"></script></head><body><div id="root"></div></body></html>',
  );
  if (probe.includes('--probe-control-height'))
    await appendFile(
      path.join(output, 'fixture.css'),
      '\n#fixture-button-md { min-height: 16px; padding: 0; }\n',
    );
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [path.join(output, 'runner.cjs'), output], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  });
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      signal ? reject(new Error(`UI 渲染检查被 ${signal} 中断`)) : resolve(code ?? 1),
    );
  });
  if (status === 0) {
    // Electron 提前退出不能读成成功：只有跑完矩阵才会写这个完成结果。
    const results = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'));
    if (!Array.isArray(results) || results.length === 0) throw new Error('UI 渲染矩阵缺完成证据');
  }
  process.exitCode = status;
} catch (error) {
  console.error('UI 渲染检查失败', error);
  process.exitCode = 1;
}
