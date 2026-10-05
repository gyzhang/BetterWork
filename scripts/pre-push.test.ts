import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
    git('init', '-q', '--initial-branch=main');
    git('config', 'user.name', 'Hook fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(path.join(directory, 'scripts'), { recursive: true });
    writeFileSync(
      path.join(directory, 'scripts/pre-push-check.mjs'),
      readFileSync(checkScriptPath),
    );
    writeFileSync(path.join(directory, 'source.ts'), 'export const value = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', base);

    if (kind !== 'docs')
      writeFileSync(path.join(directory, 'source.ts'), 'export const value = 2;\n');
    if (kind !== 'code') {
      mkdirSync(path.join(directory, 'docs'));
      writeFileSync(path.join(directory, 'docs/guide.md'), '# Guide\n');
    }
    git('add', '.');
    git('commit', '-qm', 'change');
    const head = git('rev-parse', 'HEAD');
    check(directory, base, head);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runHook(
  directory: string,
  localOid: string,
  remoteOid: string,
  remoteRef = 'refs/heads/codex/task',
): ReturnType<typeof spawnSync> {
  return spawnSync('sh', ['-e', hookPath], {
    cwd: directory,
    encoding: 'utf8',
    input: `refs/heads/codex/task ${localOid} ${remoteRef} ${remoteOid}\n`,
  });
}

describe('推送钩子只做轻量边界检查，完整验证由 PR Gate 执行', () => {
  it.each(['code', 'docs', 'mixed'] as const)('%s 分支推送不重复运行 npm 检查', (kind) => {
    withRepository(kind, (directory, base, head) => {
      const result = runHook(directory, head, base);
      expect(result.status, String(result.stderr)).toBe(0);
      expect(() => readFileSync(path.join(directory, '.fixture-npm.log'))).toThrow();
    });
  });

  it('首次推送新分支时以 origin/main 为基点做空白检查', () => {
    withRepository('code', (directory, _base, head) => {
      const result = runHook(directory, head, zeroOid);
      expect(result.status, String(result.stderr)).toBe(0);
    });
  });

  it('拒绝直接推送 main，并提示通过 PR Gate 合并', () => {
    withRepository('code', (directory, base, head) => {
      const result = runHook(directory, head, base, 'refs/heads/main');
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain('禁止直接推送 main');
      expect(String(result.stderr)).toContain('PR Gate');
    });
  });

  it('未提交修复不能替已经提交的 HEAD 推送', () => {
    withRepository('code', (directory, base, head) => {
      writeFileSync(path.join(directory, 'source.ts'), 'uncommitted repair\n');
      const result = runHook(directory, head, base);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain('工作树不干净');
    });
  });

  it('推送其他提交不能借当前 HEAD 的检查结果放行', () => {
    withRepository('code', (directory, base, head) => {
      execFileSync('git', ['commit', '--allow-empty', '-qm', 'another commit'], { cwd: directory });
      const result = runHook(directory, head, base);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain('推送对象不是当前 HEAD');
    });
  });

  it('新分支无法解析 origin/main 时拒绝推送', () => {
    withRepository('code', (directory, _base, head) => {
      execFileSync('git', ['update-ref', '-d', 'refs/remotes/origin/main'], { cwd: directory });
      const result = runHook(directory, head, zeroOid);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain('请先获取 origin/main');
    });
  });
});
