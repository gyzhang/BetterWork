import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const hookPath = fileURLToPath(new URL('../.husky/pre-push', import.meta.url));

/** 在独立 Git 夹具中运行真实钩子；npm 替身只记录调用，不推送、不改产品仓库。 */
function withRepository(check: (directory: string, head: string) => void): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-pre-push-'));
  try {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Hook fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(path.join(directory, '.gitignore'), '.fixture-bin/\n.fixture-npm.log\n');
    writeFileSync(path.join(directory, 'source.txt'), 'committed\n');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    const binaryDirectory = path.join(directory, '.fixture-bin');
    mkdirSync(binaryDirectory);
    writeFileSync(
      path.join(binaryDirectory, 'npm'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> .fixture-npm.log\nexit 0\n',
      { mode: 0o755 },
    );
    check(directory, git('rev-parse', 'HEAD'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runHook(directory: string, head: string): ReturnType<typeof spawnSync> {
  return spawnSync('sh', ['-e', hookPath], {
    cwd: directory,
    encoding: 'utf8',
    input: `refs/heads/main ${head} refs/heads/main ${'0'.repeat(40)}\n`,
    env: {
      ...process.env,
      PATH: `${path.join(directory, '.fixture-bin')}:${process.env.PATH ?? ''}`,
    },
  });
}

describe('推送门禁验证实际提交', () => {
  it('干净的 HEAD 推送调用完整 verify', () => {
    withRepository((directory, head) => {
      const result = runHook(directory, head);
      expect(result.status, String(result.stderr)).toBe(0);
      expect(readFileSync(path.join(directory, '.fixture-npm.log'), 'utf8')).toBe('run verify\n');
    });
  });

  it('未提交修复不能替已经坏掉的提交取得绿灯', () => {
    withRepository((directory, head) => {
      writeFileSync(path.join(directory, 'source.txt'), 'uncommitted repair\n');
      const result = runHook(directory, head);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain('工作树不干净');
    });
  });

  it('推送其他提交不能借当前 HEAD 的验证结果放行', () => {
    withRepository((directory, head) => {
      execFileSync('git', ['commit', '--allow-empty', '-qm', 'another commit'], { cwd: directory });
      const result = runHook(directory, head);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain('推送对象不是当前 HEAD');
    });
  });

  it('verify 失败必须保留非零退出码', () => {
    withRepository((directory, head) => {
      writeFileSync(path.join(directory, '.fixture-bin', 'npm'), '#!/bin/sh\nexit 7\n', {
        mode: 0o755,
      });
      expect(runHook(directory, head).status).toBe(7);
    });
  });

  it('verify 期间 HEAD 改变，即使工作树干净也必须失败', () => {
    withRepository((directory, head) => {
      writeFileSync(
        path.join(directory, '.fixture-bin', 'npm'),
        '#!/bin/sh\ngit commit --allow-empty -qm "changed head"\nexit 0\n',
        { mode: 0o755 },
      );
      const result = runHook(directory, head);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain('验证期间提交或工作树发生变化');
    });
  });

  it('verify 期间产生的未提交改动必须使推送失败', () => {
    withRepository((directory, head) => {
      writeFileSync(
        path.join(directory, '.fixture-bin', 'npm'),
        '#!/bin/sh\nprintf "changed\\n" >> source.txt\nexit 0\n',
        { mode: 0o755 },
      );
      const result = runHook(directory, head);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain('验证期间提交或工作树发生变化');
    });
  });
});
