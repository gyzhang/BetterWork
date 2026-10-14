import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

interface CheckPlan {
  scope: string;
  files: string[];
  commands: { label: string; command: string; args: string[] }[];
}

function withRepository(check: (directory: string) => void): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-quick-check-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: directory });
    git('init', '-q');
    git('config', 'user.name', 'Quick check fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.hooksPath', '/dev/null');
    mkdirSync(path.join(directory, 'scripts'));
    for (const file of ['pr-check.mjs', 'pr-check-plan.mjs']) {
      writeFileSync(
        path.join(directory, 'scripts', file),
        readFileSync(fileURLToPath(new URL(file, import.meta.url))),
      );
    }
    writeFileSync(
      path.join(directory, '.gitignore'),
      'node_modules/\n.fixture-bin/\n.commands\n.summary\n',
    );
    writeFileSync(path.join(directory, 'README.md'), '# Fixture\n');
    mkdirSync(path.join(directory, 'src'));
    writeFileSync(path.join(directory, 'src/work.ts'), 'export const value = 1;\n');
    writeFileSync(path.join(directory, 'src/gone.ts'), 'export const old = 1;\n');
    git('add', '.');
    git('commit', '-qm', 'Seed');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    mkdirSync(path.join(directory, '.fixture-bin'));
    const fakeCommand = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CHECK_LOG, JSON.stringify(args) + '\\n');
if (args.includes(process.env.FAIL_CHECK)) process.exit(17);
if (args.includes(process.env.SIGNAL_CHECK)) process.kill(process.pid, 'SIGTERM');
`;
    for (const name of ['npm', 'npx'])
      writeFileSync(path.join(directory, '.fixture-bin', name), fakeCommand, { mode: 0o755 });
    mkdirSync(path.join(directory, 'node_modules/prettier/bin'), { recursive: true });
    writeFileSync(path.join(directory, 'node_modules/prettier/bin/prettier.cjs'), fakeCommand);
    check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runCheck(
  directory: string,
  args: string[] = [],
  env: Record<string, string> = {},
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ['scripts/pr-check.mjs', ...args], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      CHECK_LOG: path.join(directory, '.commands'),
      PATH: `${path.join(directory, '.fixture-bin')}:${process.env.PATH ?? ''}`,
      ...env,
    },
  });
}

function readPlan(directory: string, ...args: string[]): CheckPlan {
  const result = runCheck(directory, ['--plan', ...args]);
  expect(result.status, String(result.stderr)).toBe(0);
  return JSON.parse(String(result.stdout)) as CheckPlan;
}

describe('daily quick check CLI', () => {
  it('keeps empty changes conservative and separates lint from checks', () => {
    withRepository((directory) => {
      const plan = readPlan(directory);
      expect(plan.scope).toBe('code');
      expect(plan.commands.map((command) => command.label)).toEqual([
        'Lint',
        'Types',
        'Documentation',
        'functional tests',
        'heavy tests',
      ]);
      expect(
        readPlan(directory, '--part', 'lint').commands.map((command) => command.label),
      ).toEqual(['Lint']);
      expect(
        readPlan(directory, '--part', 'checks').commands.some(
          (command) => command.label === 'Lint',
        ),
      ).toBe(false);
      const tests = plan.commands.filter((command) => command.command === 'npx');
      expect(tests).toHaveLength(2);
      for (const command of tests) {
        expect(command.args).toContain('scripts/ui-render-check.test.ts');
        expect(command.args).toContain('--exclude');
        expect(command.args).toContain('--passWithNoTests');
      }
    });
  });

  it('uses only documentation checks for Markdown and notices untracked source', () => {
    withRepository((directory) => {
      writeFileSync(path.join(directory, 'README.md'), '# Updated\n');
      expect(readPlan(directory).commands.map((command) => command.label)).toEqual([
        'Documentation',
      ]);
      writeFileSync(path.join(directory, 'src/new.ts'), 'export const added = 1;\n');
      expect(readPlan(directory).scope).toBe('code');
      expect(readPlan(directory).files).toContain('src/new.ts');
    });
  });

  it('passes renamed paths with spaces as one argument and skips deleted files', () => {
    withRepository((directory) => {
      renameSync(path.join(directory, 'src/work.ts'), path.join(directory, 'src/work space.ts'));
      rmSync(path.join(directory, 'src/gone.ts'));
      execFileSync('git', ['add', 'src'], { cwd: directory });
      const format = readPlan(directory).commands.find((command) => command.label === 'Format');
      expect(format?.args.slice(2)).toEqual(['src/work space.ts']);
      const result = runCheck(directory);
      expect(result.status, String(result.stderr)).toBe(0);
      const commands = readFileSync(path.join(directory, '.commands'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
      expect(commands).toContainEqual(['--check', 'src/work space.ts']);
    });
  });

  it.each(['.prettierrc.json', '.prettierignore', 'package.json', 'package-lock.json'])(
    'falls back to all files when %s changes',
    (file) => {
      withRepository((directory) => {
        writeFileSync(path.join(directory, file), '{}\n');
        expect(
          readPlan(directory)
            .commands.find((command) => command.label === 'Format')
            ?.args.at(-1),
        ).toBe('.');
      });
    },
  );

  it('forces release preflight and actual consumers for manifest changes', () => {
    withRepository((directory) => {
      mkdirSync(path.join(directory, 'resources/skills'), { recursive: true });
      writeFileSync(path.join(directory, 'resources/skills/release-manifest.json'), '{}\n');
      const plan = readPlan(directory);
      expect(plan.scope).toBe('resources');
      expect(plan.commands.map((command) => command.label)).toEqual([
        'Format',
        'Release preflight',
        'Release consumers',
        'Documentation',
      ]);
      const consumers = plan.commands.find((command) => command.label === 'Release consumers');
      expect(consumers?.args).toContain('scripts/builtin-release.test.ts');
      expect(consumers?.args.some((argument) => argument.startsWith('--changed'))).toBe(false);
      writeFileSync(path.join(directory, 'src/work.ts'), 'export const value = 2;\n');
      expect(readPlan(directory).scope).toBe('code');
      expect(
        readPlan(directory).commands.some((command) => command.label === 'Release consumers'),
      ).toBe(true);
    });
  });

  it('stops before consumers when a release preflight fails', () => {
    withRepository((directory) => {
      mkdirSync(path.join(directory, 'resources/experts'), { recursive: true });
      writeFileSync(path.join(directory, 'resources/experts/release-manifest.json'), '{}\n');
      const result = runCheck(directory, [], { FAIL_CHECK: 'expert:preflight' });
      expect(result.status).toBe(17);
      const commands = readFileSync(path.join(directory, '.commands'), 'utf8');
      expect(commands).not.toContain('builtin-release.test.ts');
      expect(commands).not.toContain('docs:check');
    });
  });

  it('stops on a failed check and records the failure in the Actions summary', () => {
    withRepository((directory) => {
      const summary = path.join(directory, '.summary');
      const result = runCheck(directory, [], {
        FAIL_CHECK: 'typecheck',
        GITHUB_STEP_SUMMARY: summary,
      });
      expect(result.status).toBe(17);
      expect(readFileSync(path.join(directory, '.commands'), 'utf8')).not.toContain('docs:check');
      expect(readFileSync(summary, 'utf8')).toMatch(/Types \| [\d.]+ \| failed/u);
    });
  });

  it('treats a terminated check as failure instead of success', () => {
    withRepository((directory) => {
      const result = runCheck(directory, [], { SIGNAL_CHECK: 'lint' });
      expect(result.status).toBe(1);
      expect(readFileSync(path.join(directory, '.commands'), 'utf8')).not.toContain('typecheck');
    });
  });

  it('rejects invalid bases and options before running any check', () => {
    withRepository((directory) => {
      for (const args of [['--base', 'missing-ref'], ['--part', 'ui'], ['--unknown'], ['--base']]) {
        const result = runCheck(directory, args);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Quick check failed');
      }
      expect(() => readFileSync(path.join(directory, '.commands'))).toThrow();
    });
  });
});
