import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function fixture(check: (root: string) => void): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'betterwork-coverage-runner-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    for (const file of ['test-coverage.mjs', 'merge-coverage.mjs'])
      writeFileSync(path.join(root, 'scripts', file), readFileSync(new URL(file, import.meta.url)));
    mkdirSync(path.join(root, 'node_modules/vitest'), { recursive: true });
    symlinkSync(
      fileURLToPath(new URL('../node_modules/istanbul-lib-coverage', import.meta.url)),
      path.join(root, 'node_modules/istanbul-lib-coverage'),
    );
    writeFileSync(
      path.join(root, 'node_modules/vitest/vitest.mjs'),
      `
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const project = args[args.indexOf('--project') + 1];
fs.appendFileSync('calls.jsonl', JSON.stringify({ project, args }) + '\\n');
if (process.env.COVERAGE_FIXTURE_FAILURE === project) process.exit(9);
if (process.env.COVERAGE_FIXTURE_SIGNAL === project) process.kill(process.pid, 'SIGTERM');
const directory = args.find(x => x.startsWith('--coverage.reportsDirectory=')).split('=')[1];
fs.mkdirSync(directory, { recursive: true });
const file = path.resolve('sample.ts');
const coverage = { path: file, statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } }, 1: { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } } }, s: project === 'functional' ? { 0: 1, 1: 0 } : { 0: 0, 1: 1 }, fnMap: {}, f: {}, branchMap: {}, b: {} };
fs.writeFileSync(path.join(directory, 'coverage-final.json'), JSON.stringify({ [file]: coverage }));
`,
    );
    check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const run = (
  root: string,
  args: string[] = [],
  env: Record<string, string> = {},
): ReturnType<typeof spawnSync> =>
  spawnSync(process.execPath, ['scripts/test-coverage.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

describe('serial coverage runner and report merge', () => {
  it('runs functional before heavy and merges their complementary execution coverage', () => {
    fixture((root) => {
      const result = run(root, ['--exclude', 'scripts/ui-render-check.test.ts']);
      expect(result.status, String(result.stderr)).toBe(0);
      const calls = readFileSync(path.join(root, 'calls.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { project: string; args: string[] });
      expect(calls.map((call) => call.project)).toEqual(['functional', 'heavy']);
      for (const call of calls) expect(call.args).toContain('scripts/ui-render-check.test.ts');
      const merged = JSON.parse(
        readFileSync(path.join(root, 'coverage/full/merged/coverage-summary.json'), 'utf8'),
      );
      expect(merged.total.lines).toMatchObject({ covered: 2, total: 2, pct: 100 });
    });
  });

  it('stops before heavy and does not publish a merged green report on functional failure', () => {
    fixture((root) => {
      const result = run(root, [], { COVERAGE_FIXTURE_FAILURE: 'functional' });
      expect(result.status).toBe(9);
      expect(readFileSync(path.join(root, 'calls.jsonl'), 'utf8')).not.toContain('heavy');
      expect(existsSync(path.join(root, 'coverage/full/merged/coverage-summary.json'))).toBe(false);
    });
  });

  it('fails a signalled test process and preserves its diagnostic status', () => {
    fixture((root) => {
      const result = run(root, [], { COVERAGE_FIXTURE_SIGNAL: 'functional' });
      expect(result.status).toBe(1);
      expect(
        JSON.parse(readFileSync(path.join(root, 'coverage/full/functional-status.json'), 'utf8')),
      ).toMatchObject({ signal: 'SIGTERM', status: null });
    });
  });

  it('preserves an existing custom output directory', () => {
    fixture((root) => {
      const destination = path.join(root, 'keep');
      mkdirSync(destination);
      writeFileSync(path.join(destination, 'original.txt'), 'preserve');
      expect(run(root, ['--output-dir', destination]).status).toBe(1);
      expect(readFileSync(path.join(destination, 'original.txt'), 'utf8')).toBe('preserve');
    });
  });
});
