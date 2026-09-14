import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(new URL('./expert-acceptance-preflight.mjs', import.meta.url));
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');

const runPreflight = (
  args: string[],
): Promise<{ status: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));
    child.on('error', reject);
    child.on('close', (status) =>
      resolve({ status, stdout: stdout.join(''), stderr: stderr.join('') }),
    );
  });

describe('expert acceptance preflight CLI', () => {
  it('checks a local model endpoint without requiring signing on the test host', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"data":[]}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');

    try {
      const result = await runPreflight([
        '--model-url',
        `http://127.0.0.1:${address.port}/api/inference/v1`,
        '--skip-signing',
      ]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Expert acceptance preflight passed');
      expect(result.stdout).toContain('/models');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('reports an unavailable model endpoint clearly', async () => {
    const result = await runPreflight([
      '--model-url',
      'http://127.0.0.1:1/api/inference/v1',
      '--skip-signing',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('模型端点检查失败');
  });

  it('does not allow skipping every acceptance check', async () => {
    const result = await runPreflight(['--skip-model', '--skip-signing']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('至少保留模型端点或签名身份检查之一');
  });
});
