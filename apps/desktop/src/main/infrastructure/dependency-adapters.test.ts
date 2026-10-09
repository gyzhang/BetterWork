import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { createFetchDownloader, createNodeProcessRunner } from './dependency-adapters';

const execute = promisify(execFile);

describe('createNodeProcessRunner', () => {
  it.each(['cancel-live-parent', 'cancel-exited-parent', 'natural-exit', 'timeout'] as const)(
    'joins descendant processes on %s',
    async (mode) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'dependency-process-'));
      const script = path.join(directory, 'tree.mjs');
      const pidFile = path.join(directory, 'pids.json');
      await writeFile(
        script,
        `
        import { spawn } from 'node:child_process';
        import { writeFileSync } from 'node:fs';
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: '${mode === 'natural-exit' ? 'ignore' : 'inherit'}' });
        writeFileSync(process.argv[2], JSON.stringify({ parent: process.pid, child: child.pid }));
        ${mode === 'cancel-exited-parent' || mode === 'natural-exit' ? 'child.unref();' : 'setTimeout(() => {}, 60000);'}
      `,
      );
      const handle = createNodeProcessRunner().run({
        executable: process.execPath,
        argv: [script, pidFile],
        timeoutMs: mode === 'timeout' ? 1000 : 20_000,
      });
      try {
        let pids: { parent: number; child: number } | undefined;
        await vi.waitFor(async () => {
          pids = JSON.parse(await readFile(pidFile, 'utf8')) as { parent: number; child: number };
          expect(pids.child).toBeGreaterThan(0);
        });
        if (!pids) throw new Error('Missing process fixture PIDs');
        const group = pids.parent;
        if (mode === 'cancel-exited-parent') {
          await vi.waitFor(() => expect(() => process.kill(group, 0)).toThrow());
        }
        if (mode !== 'timeout' && mode !== 'natural-exit') {
          handle.kill();
          handle.kill();
        }
        const result = await handle.result;
        expect(result.timedOut).toBe(mode === 'timeout');
        await vi.waitFor(async () => {
          const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,pgid=,state=']);
          const members = stdout.split('\n').filter((line) => {
            const fields = line.trim().split(/\s+/u);
            return Number(fields[1]) === group && !fields[2]?.startsWith('Z');
          });
          expect(members).toEqual([]);
        });
      } finally {
        handle.kill();
        await handle.result;
        await rm(directory, { recursive: true, force: true });
      }
    },
    25_000,
  );
});

describe('createFetchDownloader', () => {
  it('rejects non-HTTPS URLs without making a request', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(new Uint8Array());
    };
    const downloader = createFetchDownloader(fetchImpl);

    await expect(
      downloader.download('http://packages.example/wheel.whl', new AbortController().signal),
    ).rejects.toThrow('https');
    expect(calls).toBe(0);
  });

  it('passes caller cancellation to fetch', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = (_input, init) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) {
        return Promise.reject(new Error('fetch did not receive an abort signal'));
      }
      requestSignal = signal;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('fetch aborted')), {
          once: true,
        });
      });
    };
    const downloader = createFetchDownloader(fetchImpl);
    const controller = new AbortController();
    const download = downloader.download('https://packages.example/wheel.whl', controller.signal);

    expect(requestSignal).toBeInstanceOf(AbortSignal);
    controller.abort();

    await expect(download).rejects.toThrow('fetch aborted');
    expect(requestSignal?.aborted).toBe(true);
  });
});
