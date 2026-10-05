import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const hookPath = fileURLToPath(new URL('../.husky/pre-push', import.meta.url));
const checkScriptPath = fileURLToPath(new URL('./pre-push-check.mjs', import.meta.url));
const zeroOid = '0'.repeat(40);

type ChangeKind = 'code' | 'docs' | 'mixed';

function withRepository(
  kind: ChangeKind,
  check: (directory: string, base: string, head: string) => void,
): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-pre-push-'));
  try {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Hook fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(path.join(directory, '.gitignore'), '.fixture-bin/\n.fixture-npm.log\n');
    mkdirSync(path.join(directory, 'scripts'), { recursive: true });
    writeFileSync(
      path.join(directory, 'scripts/pre-push-check.mjs'),
      readFileSync(checkScriptPath),
    );
    writeFileSync(path.join(directory, 'source.ts'), 'export const value = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');

    if (kind !== 'docs')
      writeFileSync(path.join(directory, 'source.ts'), 'export const value = 2;\n');
    if (kind !== 'code') {
      mkdirSync(path.join(directory, 'docs'));
      writeFileSync(path.join(directory, 'docs/guide.md'), '# Guide\n');
    }
    git('add', '.');
    git('commit', '-qm', 'change');
    const head = git('rev-parse', 'HEAD');
    const binaryDirectory = path.join(directory, '.fixture-bin');
    mkdirSync(binaryDirectory);
    writeFileSync(
      path.join(binaryDirectory, 'npm'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> .fixture-npm.log\nexit "${FIXTURE_NPM_STATUS:-0}"\n',
      { mode: 0o755 },
    );
    check(directory, base, head);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runHook(
  directory: string,
  localOid: string,
  remoteOid: string,
  extra: { npmScript?: string; npmStatus?: string } = {},
): ReturnType<typeof spawnSync> {
  const script =
    extra.npmScript ??
    '#!/bin/sh\nprintf "%s\\n" "$*" >> .fixture-npm.log\nexit "${FIXTURE_NPM_STATUS:-0}"\n';
  writeFileSync(path.join(directory, '.fixture-bin/npm'), script, { mode: 0o755 });
  return spawnSync('sh', ['-e', hookPath], {
    cwd: directory,
    encoding: 'utf8',
    input: `refs/heads/main ${localOid} refs/heads/main ${remoteOid}\n`,
    env: {
      ...process.env,
      FIXTURE_NPM_STATUS: extra.npmStatus ?? '0',
      PATH: `${path.join(directory, '.fixture-bin')}:${process.env.PATH ?? ''}`,
    },
  });
}

describe('推送门禁验证实际提交并区分文档', () => {
  it('代码推送调用完整 verify', () => {
    withRepository('code', (directory, base, head) => {
      const result = runHook(directory, head, base);
      expect(result.status, String(result.stderr)).toBe(0);
      expect(readFileSync(path.join(directory, '.fixture-npm.log'), 'utf8')).toBe('run verify\n');
    });
  });

  it('纯 Markdown 推送只调用 docs:check', () => {
    withRepository('docs', (directory, base, head) => {
      const result = runHook(directory, head, base);
      expect(result.status, String(result.stderr)).toBe(0);
      expect(readFileSync(path.join(directory, '.fixture-npm.log'), 'utf8')).toBe(
        'run docs:check\n',
      );
    });
  });

  it('混合代码与文档的推送仍调用完整 verify', () => {
    withRepository('mixed', (directory, base, head) => {
      const result = runHook(directory, head, base);
      expect(result.status, String(result.stderr)).toBe(0);
      expect(readFileSync(path.join(directory, '.fixture-npm.log'), 'utf8')).toBe('run verify\n');
    });
  });

  it('未提交修复不能替已经坏掉的提交取得绿灯', () => {
    withRepository('code', (directory, base, head) => {
      writeFileSync(path.join(directory, 'source.ts'), 'uncommitted repair\n');
      const result = runHook(directory, head, base);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain('工作树不干净');
    });
  });

  it('推送其他提交不能借当前 HEAD 的验证结果放行', () => {
    withRepository('code', (directory, base, head) => {
      execFileSync('git', ['commit', '--allow-empty', '-qm', 'another commit'], { cwd: directory });
      const result = runHook(directory, head, base);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain('推送对象不是当前 HEAD');
    });
  });

  it('首次推送没有远端基点时执行完整 verify', () => {
    withRepository('docs', (directory, _base, head) => {
      const result = runHook(directory, head, zeroOid);
      expect(result.status, String(result.stderr)).toBe(0);
      expect(readFileSync(path.join(directory, '.fixture-npm.log'), 'utf8')).toBe('run verify\n');
    });
  });

  it('完整 verify 失败必须保留非零退出码', () => {
    withRepository('code', (directory, base, head) => {
      const result = runHook(directory, head, base, { npmStatus: '7' });
      expect(result.status).toBe(7);
    });
  });

  it('验证期间 HEAD 或工作树改变必须使推送失败', () => {
    withRepository('code', (directory, base, head) => {
      const result = runHook(directory, head, base, {
        npmScript: '#!/bin/sh\ngit commit --allow-empty -qm "changed head"\nexit 0\n',
      });
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain('验证期间提交或工作树发生变化');
    });

    withRepository('code', (directory, base, head) => {
      const result = runHook(directory, head, base, {
        npmScript: '#!/bin/sh\nprintf "changed\\n" >> source.ts\nexit 0\n',
      });
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain('验证期间提交或工作树发生变化');
    });
  });
});
