import assert from 'node:assert/strict';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, session } from 'electron';

import { assemble, seed, syntheticResponse, toolResponse } from './ui-app-journey';

const output = process.argv[2];
const directory = process.argv[3];
const phase = process.argv[4];
if (!output || !directory || !['prepare', 'recover'].includes(phase ?? ''))
  throw new Error('缺进程恢复宿主参数');
const probe = process.argv.includes('--probe-crash-recovery');
app.setPath('userData', path.join(output, 'recovery-user-data', phase ?? ''));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {
  // 等待父 CLI 强杀或显式完成；窗口关闭不代表检查成功。
});

async function run(output: string, directory: string, phase: string): Promise<void> {
  await app.whenReady();
  const host: { window: BrowserWindow | null } = { window: null };
  let requests = 0;
  // 装配本身也不能偷跑网络；先装阻断器，再创建生产服务。
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error('离线进程恢复装配期间禁止模型请求');
  };
  const services = assemble(directory, () => host.window, !probe);
  const { store, vault } = services;
  let hang = false;
  let entered = false;
  const errors: string[] = [];
  const networkAttempts: string[] = [];
  globalThis.fetch = (input) => {
    requests += 1;
    assert.equal(input, 'http://offline.invalid/v1/chat/completions');
    assert.equal(phase, 'prepare', '恢复启动不得自动重放模型请求');
    if (hang) {
      entered = true;
      return new Promise<Response>(() => {
        // 真正挂起 Provider 请求；父进程 SIGKILL 不会执行 JS 取消或 close。
      });
    }
    const current = store.runs.list().find((item) => item.status === 'running');
    assert.ok(current);
    const reference = store.runContextSnapshots.get(current.id)?.materials[0]?.reference;
    assert.ok(reference?.kind === 'knowledge-revision');
    if (requests === 1)
      return Promise.resolve(toolResponse('read_knowledge', { reference }, requests));
    if (requests === 2)
      return Promise.resolve(
        toolResponse(
          'artifact_declare_sources',
          {
            inputRelations: [{ input: reference, relation: 'rule' }],
          },
          requests,
        ),
      );
    return Promise.resolve(
      syntheticResponse({ content: '# 本期复盘已完成\n\n合成恢复验证成果。' }),
    );
  };
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      networkAttempts.push(details.url);
      callback({ cancel: true });
    },
  );
  const checkpoint = (): {
    pid: number;
    completed: ReturnType<typeof store.runs.list>[number];
    completedEvents: ReturnType<typeof store.runs.listEvents>;
    interruptedId: string;
    artifacts: ReturnType<typeof store.artifacts.list>;
    versions: ReturnType<typeof store.artifacts.listVersions>;
    memories: ReturnType<typeof store.memories.list>;
    context: ReturnType<typeof store.taskContexts.getLatest>;
  } => {
    const completed = store.runs.list().find((item) => item.status === 'completed');
    const interrupted = store.runs.list().find((item) => item.status === 'running');
    assert.ok(completed);
    assert.ok(interrupted);
    const artifacts = store.artifacts.list();
    assert.ok(artifacts.length > 0, '合成完成 Run 未生成成果');
    const memories = store.memories.list();
    const pinned = memories.find((item) => item.recallPolicy === 'pinned');
    assert.ok(pinned);
    const context = store.taskContexts.getLatest(completed.taskId);
    assert.deepEqual(context?.excludedMemoryIds, [pinned.id]);
    assert.equal(interrupted.taskId, completed.taskId);
    assert.equal(interrupted.sessionId, completed.sessionId);
    return {
      pid: process.pid,
      completed,
      completedEvents: store.runs.listEvents(completed.id),
      interruptedId: interrupted.id,
      artifacts,
      versions: artifacts.flatMap((item) => store.artifacts.listVersions(item.id)),
      memories,
      context,
    };
  };
  const screenshot = async (name: string): Promise<void> => {
    assert.ok(host.window);
    await host.window.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await writeFile(
      path.join(output, 'screenshots', `process-recovery-${name}.png`),
      (await host.window.webContents.capturePage()).toPNG(),
    );
  };
  const step = async (name: string): Promise<void> => {
    assert.ok(host.window);
    await host.window.webContents.executeJavaScript(
      `window.uiAppChecks.runStep(${JSON.stringify(name)})`,
    );
    assert.deepEqual(errors, [], '进程恢复 Renderer 出错');
    assert.deepEqual(networkAttempts, [], '进程恢复宿主发起网络请求');
  };
  try {
    if (phase === 'prepare') await seed(services, directory);
    host.window = new BrowserWindow({
      width: 1380,
      height: 860,
      show: false,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(output, 'app-preload.cjs'),
      },
    });
    host.window.webContents.on('console-message', (details) => {
      if (details.level === 'error') errors.push(details.message);
    });
    host.window.webContents.on('will-navigate', (event) => event.preventDefault());
    host.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await host.window.loadFile(path.join(output, 'app.html'));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await host.window.webContents.executeJavaScript('Boolean(window.uiAppChecks)')) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    await step('ready');
    if (phase === 'prepare') {
      await step('summon');
      await step('first-run');
      await step('save-method');
      await step('exclude');
      hang = true;
      await step('interrupted-start');
      for (let attempt = 0; attempt < 100 && !entered; attempt += 1)
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      assert.ok(entered, '尚未进入真实 Provider 请求，不能强杀');
      await screenshot('running');
      await writeFile(
        path.join(directory, 'ready.pending.json'),
        JSON.stringify(checkpoint(), null, 2),
      );
      await rename(path.join(directory, 'ready.pending.json'), path.join(directory, 'ready.json'));
      return; // 保持 Run/SQLite 打开，父进程等待 ready 后发 SIGKILL。
    }
    // 只读自己上一进程写下的合成夹具快照，不读取用户库或会话。
    const before = JSON.parse(
      await readFile(path.join(directory, 'ready.json'), 'utf8'),
    ) as ReturnType<typeof checkpoint>;
    assert.notEqual(process.pid, before.pid, '恢复没有进入新进程');
    assert.deepEqual(store.runs.get(before.completed.id), before.completed);
    assert.deepEqual(store.runs.listEvents(before.completed.id), before.completedEvents);
    assert.equal(store.runs.get(before.interruptedId)?.status, 'failed', '强杀后的 Run 未收口');
    assert.equal(
      store.runs.listEvents(before.interruptedId).filter((event) => event.type === 'run.failed')
        .length,
      1,
      '中断 Run 必须恰好一个失败终态',
    );
    assert.deepEqual(store.artifacts.list(), before.artifacts);
    assert.deepEqual(
      before.artifacts.flatMap((item) => store.artifacts.listVersions(item.id)),
      before.versions,
    );
    assert.deepEqual(store.memories.list(), before.memories);
    assert.deepEqual(store.taskContexts.getLatest(before.completed.taskId), before.context);
    assert.equal(store.runs.list().length, 2, '恢复不得新建 Run');
    await step('process-history');
    await screenshot('history');
    await step('process-exclusions');
    await screenshot('exclusions');
    await step('process-memory');
    assert.equal(requests, 0, '恢复界面自动请求了模型');
    assert.equal(
      await readFile(path.join(directory, 'workspace', '合成复盘资料.md'), 'utf8'),
      '合成资料：本期工作已完成，交付结论必须可追溯。',
    );
    await screenshot('recovered');
    await writeFile(
      path.join(directory, 'recovered.json'),
      JSON.stringify(
        {
          id: 'process-recovery-jade-dark-1380',
          coverage: 'production-process-recovery-with-temporary-sqlite',
          mode: 'dark',
          width: 1380,
          previousPid: before.pid,
          recoveredPid: process.pid,
          interruptedRunId: before.interruptedId,
          requests,
          networkAttempts: networkAttempts.length,
          checks: [
            'completed-history',
            'interrupted-terminal',
            'artifacts-and-versions',
            'memory-policy',
            'task-exclusions',
            'production-app-history',
            'no-automatic-replay',
            'source-unchanged',
          ],
          databaseDirectory: path.basename(directory),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    if (host.window && !host.window.isDestroyed()) await screenshot('failed');
    throw new Error('独立进程恢复检查失败', { cause: error });
  } finally {
    if (phase === 'recover') {
      host.window?.destroy();
      store.close();
      vault.close();
    }
  }
}

run(output, directory, phase ?? '').then(
  () => {
    if (phase === 'recover') app.exit(0);
  },
  (error: unknown) => {
    console.error(error);
    app.exit(1);
  },
);
