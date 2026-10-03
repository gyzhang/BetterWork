import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app } from 'electron';

import { runAppJourney } from './ui-app-journey';

function outputDirectory(): string {
  const directory = process.argv[2];
  assert.ok(directory, '缺离线验收输出目录');
  return directory;
}
const output = outputDirectory();
app.setPath('userData', path.join(output, 'acceptance-user-data'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
let ready = false;
app.on('window-all-closed', () => {
  if (ready) app.quit();
});

async function run(): Promise<void> {
  let reopenDirectory: string | undefined;
  if (process.argv.includes('--reopen-acceptance')) {
    const marker: unknown = JSON.parse(
      await readFile(path.join(output, 'acceptance-ready.json'), 'utf8'),
    );
    assert.ok(marker && typeof marker === 'object' && 'databaseDirectory' in marker);
    assert.ok(
      typeof marker.databaseDirectory === 'string' &&
        /^app-journey-[a-zA-Z0-9]+$/.test(marker.databaseDirectory),
      '只重开本宿主创建的合成数据目录',
    );
    reopenDirectory = path.join(output, marker.databaseDirectory);
    assert.equal(
      path.dirname(await realpath(reopenDirectory)),
      await realpath(output),
      '合成数据库目录不得越过输出目录',
    );
    assert.ok(
      (await stat(path.join(reopenDirectory, 'app.sqlite'))).isFile(),
      '合成库缺失，不能重建冒充恢复',
    );
    assert.ok((await stat(path.join(reopenDirectory, 'vault.sqlite'))).isFile(), '合成知识库缺失');
  }
  globalThis.fetch = async () => {
    throw new Error('离线验收装配阶段禁止网络请求');
  };
  await app.whenReady();
  await mkdir(path.join(output, 'screenshots'), { recursive: true });
  await runAppJourney(
    output,
    async (window, filename) => {
      await writeFile(filename, (await window.webContents.capturePage()).toPNG());
    },
    false,
    {
      interactive: true,
      silent: process.argv.includes('--acceptance-smoke'),
      ...(reopenDirectory ? { reopenDirectory } : {}),
    },
  );
  ready = true;
  if (process.argv.includes('--acceptance-smoke')) app.quit();
}

run().catch((error: unknown) => {
  console.error('离线验收准备失败', error);
  app.exit(1);
});
