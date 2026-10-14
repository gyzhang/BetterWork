import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
    for (const file of [
      'pr-check.mjs',
      'pr-check-plan.mjs',
      'coverage-policy.mjs',
      'coverage-policy.json',
      'diff-coverage.mjs',
    ]) {
      writeFileSync(
        path.join(directory, 'scripts', file),
        readFileSync(fileURLToPath(new URL(file, import.meta.url))),
      );
    }
    writeFileSync(
      path.join(directory, '.gitignore'),
      'node_modules/\ncoverage/\n.fixture-bin/\n.commands\n.summary\n',
    );
    writeFileSync(path.join(directory, 'README.md'), '# Fixture\n');
    for (const file of ['builtin-release.test.ts', 'expert-release-preflight.test.ts'])
      writeFileSync(path.join(directory, 'scripts', file), '// Consumer fixture\n');
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
const reportDirectory = args.find(argument => argument.startsWith('--coverage.reportsDirectory='));
if (reportDirectory && process.env.CHECK_COVERAGE_HITS) {
  const path = require('node:path');
  const directory = reportDirectory.split('=')[1];
  const source = path.resolve('apps/desktop/src/main/services/example.ts');
  const hits = JSON.parse(process.env.CHECK_COVERAGE_HITS);
  const statementMap = Object.fromEntries(hits.map((_, index) => [index, { start: { line: index + 1, column: 0 } }]));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'coverage-final.json'), JSON.stringify({ [source]: { path: source, statementMap, s: Object.fromEntries(hits.map((hit, index) => [index, hit])) } }));
}
`;
    for (const name of ['npm', 'npx'])
      writeFileSync(path.join(directory, '.fixture-bin', name), fakeCommand, { mode: 0o755 });
    mkdirSync(path.join(directory, 'node_modules/prettier/bin'), { recursive: true });
    writeFileSync(path.join(directory, 'node_modules/prettier/bin/prettier.cjs'), fakeCommand);
    symlinkSync(
      fileURLToPath(new URL('../node_modules/typescript', import.meta.url)),
      path.join(directory, 'node_modules/typescript'),
    );
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
  // 两轮 Node/CLI 正反例在 2026-10-14 并行采样下实测 6.68s；上限只保护夹具。
  it('fails below changed-line coverage even when behavior checks succeed, then accepts exactly 80%', () => {
    withRepository((directory) => {
      const source = path.join(directory, 'apps/desktop/src/main/services/example.ts');
      mkdirSync(path.dirname(source), { recursive: true });
      writeFileSync(
        source,
        Array.from({ length: 5 }, (_, index) => `export const value${index} = ${index};`).join(
          '\n',
        ) + '\n',
      );
      const rejected = runCheck(directory, [], { CHECK_COVERAGE_HITS: '[1,1,1,0,0]' });
      expect(rejected.status, String(rejected.stderr)).toBe(1);
      const status = path.join(directory, 'coverage/quick/check-status.json');
      expect(JSON.parse(readFileSync(status, 'utf8'))).toMatchObject({
        label: 'Changed line coverage',
        status: 1,
      });
      const accepted = runCheck(directory, [], { CHECK_COVERAGE_HITS: '[1,1,1,1,0]' });
      expect(accepted.status, String(accepted.stderr)).toBe(0);
      expect(
        JSON.parse(readFileSync(path.join(directory, 'coverage/quick/diff-coverage.json'), 'utf8')),
      ).toMatchObject({ passed: true, percent: 80 });
    });
  }, 20_000);

  it('forces resource consumers when Skill payloads change without a manifest edit', () => {
    withRepository((directory) => {
      mkdirSync(path.join(directory, 'resources/skills/example'), { recursive: true });
      writeFileSync(path.join(directory, 'resources/skills/example/SKILL.md'), '# Changed skill\n');
      const plan = readPlan(directory);
      expect(plan.scope).toBe('code');
      expect(plan.commands.some((command) => command.label === 'Release preflight')).toBe(true);
      expect(
        plan.commands.find((command) => command.label === 'Release consumers')?.args,
      ).toContain('scripts/builtin-release.test.ts');
    });
  });

  it('maps subprocess scripts to behavior tests while keeping Electron validation optional', () => {
    withRepository((directory) => {
      mkdirSync(path.join(directory, 'apps/desktop/src/main/infrastructure'), { recursive: true });
      writeFileSync(
        path.join(directory, 'apps/desktop/src/main/infrastructure/knowledge-worker.ts'),
        'export const worker = 1;\n',
      );
      const plan = readPlan(directory);
      expect(
        plan.commands.some((command) =>
          command.args.includes('apps/desktop/src/main/infrastructure/knowledge-worker.test.ts'),
        ),
      ).toBe(true);
      mkdirSync(path.join(directory, 'scripts/fixtures'), { recursive: true });
      writeFileSync(
        path.join(directory, 'scripts/fixtures/ui-render-runner.ts'),
        'export const fixture = 1;\n',
      );
      const uiPlan = readPlan(directory) as CheckPlan & { uiRequired: boolean };
      expect(uiPlan.uiRequired).toBe(true);
      expect(
        uiPlan.commands.some(
          (command) =>
            command.args.includes('scripts/ui-render-check.test.ts') &&
            !command.args.includes('--exclude'),
        ),
      ).toBe(false);
    });
  });

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

  it('fails before running checks when a mapped consumer is missing', () => {
    withRepository((directory) => {
      mkdirSync(path.join(directory, 'resources/skills'), { recursive: true });
      writeFileSync(path.join(directory, 'resources/skills/release-manifest.json'), '{}\n');
      rmSync(path.join(directory, 'scripts/builtin-release.test.ts'));
      const result = runCheck(directory);
      expect(result.status).toBe(1);
      expect(String(result.stderr)).toContain('scripts/builtin-release.test.ts');
      expect(
        JSON.parse(readFileSync(path.join(directory, 'coverage/quick/check-status.json'), 'utf8')),
      ).toMatchObject({ label: 'Required consumers', status: 1 });
      expect(() => readFileSync(path.join(directory, '.commands'))).toThrow();
    });
  });

  it('selects compiler and coverage consumers and marks changed visual components for UI', () => {
    withRepository((directory) => {
      mkdirSync(path.join(directory, 'scripts/fixtures'), { recursive: true });
      writeFileSync(path.join(directory, 'scripts/fixtures/ipc-type-contract.mjs'), '// Changed\n');
      writeFileSync(path.join(directory, 'scripts/merge-coverage.mjs'), '// Changed\n');
      const policy = path.join(directory, 'scripts/coverage-policy.mjs');
      writeFileSync(policy, readFileSync(policy, 'utf8') + '// Changed policy\n');
      const plan = readPlan(directory);
      const consumers = plan.commands.find(
        (command) => command.label === 'functional dynamic consumers',
      );
      expect(consumers?.args).toContain('apps/desktop/src/main/ipc/register-ipc.test.ts');
      expect(consumers?.args).toContain('scripts/diff-coverage.test.ts');
      expect(consumers?.args).toContain('scripts/test-coverage.test.ts');
      mkdirSync(path.join(directory, 'apps/desktop/src/renderer/src'), { recursive: true });
      writeFileSync(path.join(directory, 'apps/desktop/src/renderer/src/View.tsx'), '// Changed\n');
      expect((readPlan(directory) as CheckPlan & { uiRequired: boolean }).uiRequired).toBe(true);
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
