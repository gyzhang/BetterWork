import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(new URL('./pre-commit-check.mjs', import.meta.url));

function withRepository(check: (directory: string) => void): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-pre-commit-'));
  try {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'Hook fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(path.join(directory, 'scripts'), { recursive: true });
    writeFileSync(path.join(directory, 'scripts/pre-commit-check.mjs'), readFileSync(scriptPath));
    mkdirSync(path.join(directory, 'node_modules/.bin'), { recursive: true });
    for (const name of ['eslint', 'prettier']) {
      writeFileSync(
        path.join(directory, 'node_modules/.bin', name),
        '#!/bin/sh\nprintf "%s %s\\n" "$(basename "$0")" "$*" >> "$CHECK_LOG"\n',
        { mode: 0o755 },
      );
    }
    const binaryDirectory = path.join(directory, '.fixture-bin');
    mkdirSync(binaryDirectory);
    writeFileSync(
      path.join(binaryDirectory, 'npm'),
      '#!/bin/sh\nprintf "npm %s\\n" "$*" >> "$CHECK_LOG"\nexit 0\n',
      { mode: 0o755 },
    );
    check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runCheck(directory: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ['scripts/pre-commit-check.mjs'], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      CHECK_LOG: path.join(directory, '.commands'),
      PATH: `${path.join(directory, '.fixture-bin')}:${process.env.PATH ?? ''}`,
    },
  });
}

describe('提交快检按暂存范围选择', () => {
  it('纯 Markdown 只跑文档结构检查', () => {
    withRepository((directory) => {
      mkdirSync(path.join(directory, 'docs'));
      writeFileSync(path.join(directory, 'docs/guide.md'), '# Guide\n');
      execFileSync('git', ['add', 'docs/guide.md'], { cwd: directory });

      const result = runCheck(directory);

      expect(result.status, String(result.stderr)).toBe(0);
      expect(readFileSync(path.join(directory, '.commands'), 'utf8')).toBe('npm run docs:check\n');
    });
  });

  it('TypeScript 只 lint/format 暂存路径，不在每次提交运行全仓 typecheck', () => {
    withRepository((directory) => {
      mkdirSync(path.join(directory, 'src'));
      writeFileSync(path.join(directory, 'src/work.ts'), 'export const value = 1;\n');
      writeFileSync(path.join(directory, 'src/unstaged.ts'), 'export const other = 2;\n');
      execFileSync('git', ['add', 'src/work.ts'], { cwd: directory });

      const result = runCheck(directory);

      expect(result.status, String(result.stderr)).toBe(0);
      expect(readFileSync(path.join(directory, '.commands'), 'utf8')).toBe(
        'eslint src/work.ts\nprettier --check src/work.ts\n',
      );
    });
  });

  it('暂存差异的空白错误会在运行其他检查前拦截提交', () => {
    withRepository((directory) => {
      writeFileSync(path.join(directory, 'notes.md'), 'line with trailing space \n');
      execFileSync('git', ['add', 'notes.md'], { cwd: directory });

      const result = runCheck(directory);

      expect(result.status).not.toBe(0);
      expect([String(result.stdout), String(result.stderr)].join('')).toContain('notes.md');
      expect(() => readFileSync(path.join(directory, '.commands'))).toThrow();
    });
  });

  it('删除的 TypeScript 不触发全仓类型检查', () => {
    withRepository((directory) => {
      mkdirSync(path.join(directory, 'src'));
      writeFileSync(path.join(directory, 'src/gone.ts'), 'export const oldValue = 1;\n');
      execFileSync('git', ['add', 'src/gone.ts'], { cwd: directory });
      execFileSync('git', ['commit', '-qm', 'seed'], { cwd: directory });
      rmSync(path.join(directory, 'src/gone.ts'));
      execFileSync('git', ['add', 'src/gone.ts'], { cwd: directory });

      const result = runCheck(directory);

      expect(result.status, String(result.stderr)).toBe(0);
      expect(() => readFileSync(path.join(directory, '.commands'))).toThrow();
    });
  });
});
