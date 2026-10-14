import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./diff-coverage.mjs', import.meta.url));
const source = 'apps/desktop/src/main/services/example.ts';
const content =
  Array.from({ length: 5 }, (_, i) => `export const value${i} = ${i};`).join('\n') + '\n';

function fixture(check: (root: string, git: (...args: string[]) => string) => void): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'betterwork-diff-coverage-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'Coverage fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'core.hooksPath', '/dev/null');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(path.join(root, '.gitignore'), 'coverage/\n');
    git('add', '.');
    git('commit', '-qm', 'Base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    mkdirSync(path.join(root, path.dirname(source)), { recursive: true });
    writeFileSync(path.join(root, source), content);
    check(root, git);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function report(root: string, name: string, hits: number[], file = source): string {
  const directory = path.join(root, 'coverage', name);
  mkdirSync(directory, { recursive: true });
  const absolute = path.join(root, file);
  const statementMap = Object.fromEntries(
    hits.map((_, index) => [
      index,
      { start: { line: index + 1, column: 0 }, end: { line: index + 1, column: 20 } },
    ]),
  );
  const target = path.join(directory, 'coverage-final.json');
  writeFileSync(
    target,
    JSON.stringify({
      [absolute]: {
        path: absolute,
        statementMap,
        s: Object.fromEntries(hits.map((hit, index) => [index, hit])),
      },
    }),
  );
  return target;
}

function run(root: string, ...args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [script, '--base', 'origin/main', '--reports', 'coverage', ...args],
    { cwd: root, encoding: 'utf8' },
  );
}

describe('differential executable line coverage', () => {
  // 两次真实 Vitest 子调用在 2026-10-14 并行覆盖采样下实测 7.46s；上限保护夹具，不测性能。
  it('enforces the threshold on actual V8 instrumentation, then passes after the missing behavior executes', () => {
    fixture((root) => {
      symlinkSync(
        fileURLToPath(new URL('../node_modules', import.meta.url)),
        path.join(root, 'node_modules'),
      );
      writeFileSync(
        path.join(root, source),
        'export function work() { return 1; }\n' +
          Array.from(
            { length: 4 },
            (_, index) => `export function unused${index}() {\n  return ${index};\n}`,
          ).join('\n') +
          '\n',
      );
      const testFile = path.join(root, source.replace('.ts', '.test.ts'));
      const testSource = `import { it, expect } from 'vitest';\nimport { work, unused0, unused1, unused2, unused3 } from './example';\nit('executes allowed paths', () => { expect(work()).toBe(1); EXTRA });\n`;
      const measure = (): void => {
        const measured = spawnSync(
          process.execPath,
          [
            fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
            'run',
            '--root',
            realpathSync(root),
            '--config',
            fileURLToPath(new URL('../vitest.coverage.config.ts', import.meta.url)),
            '--project',
            'functional',
            '--coverage',
            `--coverage.include=${source}`,
            '--coverage.reportsDirectory=coverage/actual',
          ],
          { cwd: realpathSync(root), encoding: 'utf8' },
        );
        expect(measured.status, String(measured.stderr)).toBe(0);
      };
      writeFileSync(testFile, testSource.replace('EXTRA', ''));
      measure();
      const rejected = run(root);
      expect(rejected.status, String(rejected.stderr)).toBe(1);
      expect(JSON.parse(String(rejected.stdout)).passed).toBe(false);
      writeFileSync(
        testFile,
        testSource.replace(
          'EXTRA',
          '[unused0, unused1, unused2, unused3].forEach((fn, i) => expect(fn()).toBe(i));',
        ),
      );
      measure();
      const accepted = run(root);
      expect(accepted.status, String(accepted.stdout) + String(accepted.stderr)).toBe(0);
      expect(JSON.parse(String(accepted.stdout)).percent).toBe(100);
    });
  }, 20_000);

  it('accepts exactly 80% and rejects uncovered changed lines', () => {
    fixture((root) => {
      report(root, 'functional', [1, 1, 1, 1, 0]);
      const accepted = run(root);
      expect(accepted.status, String(accepted.stderr)).toBe(0);
      expect(JSON.parse(String(accepted.stdout))).toMatchObject({
        covered: 4,
        total: 5,
        percent: 80,
        passed: true,
      });
      report(root, 'functional', [1, 1, 1, 0, 0]);
      const rejected = run(root);
      expect(rejected.status).toBe(1);
      expect(JSON.parse(String(rejected.stdout))).toMatchObject({
        covered: 3,
        total: 5,
        percent: 60,
        passed: false,
      });
    });
  });

  it('unions execution hits across functional and heavy without double-counting lines', () => {
    fixture((root) => {
      report(root, 'functional', [1, 1, 0, 0, 0]);
      report(root, 'heavy', [0, 1, 1, 1, 0]);
      const result = run(root);
      expect(result.status, String(result.stderr)).toBe(0);
      expect(JSON.parse(String(result.stdout))).toMatchObject({ covered: 4, total: 5 });
    });
  });

  it('counts only changed lines for tracked files', () => {
    fixture((root, git) => {
      git('add', source);
      git('commit', '-qm', 'Existing source');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      writeFileSync(path.join(root, source), content.replace('value0 = 0', 'value0 = 10'));
      report(root, 'functional', [1, 0, 0, 0, 0]);
      const result = run(root);
      expect(result.status, String(result.stderr)).toBe(0);
      expect(JSON.parse(String(result.stdout))).toMatchObject({
        covered: 1,
        total: 1,
        percent: 100,
      });
    });
  });

  it('handles a renamed untracked path with spaces as a new executable file', () => {
    fixture((root) => {
      const renamed = source.replace('example.ts', 'renamed file.ts');
      renameSync(path.join(root, source), path.join(root, renamed));
      report(root, 'functional', [1, 1, 1, 1, 1], renamed);
      const result = run(root);
      expect(result.status, String(result.stderr)).toBe(0);
      expect(JSON.parse(String(result.stdout)).files[0].path).toBe(renamed);
    });
  });

  it('excludes removed files, pure type declarations and forwarding modules from the denominator', () => {
    fixture((root, git) => {
      git('add', source);
      git('commit', '-qm', 'Existing source');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      rmSync(path.join(root, source));
      writeFileSync(
        path.join(root, source.replace('example.ts', 'types.ts')),
        'export interface Record { readonly id: string }\n',
      );
      writeFileSync(
        path.join(root, source.replace('example.ts', 'index.ts')),
        "import { readFileSync } from 'node:fs';\nexport { readFileSync };\nexport * from 'node:path';\n",
      );
      const result = run(root);
      expect(result.status, String(result.stderr)).toBe(0);
      expect(JSON.parse(String(result.stdout))).toMatchObject({ total: 0, passed: true });
    });
  });

  it('rejects reports when the measured source changes during the run', () => {
    for (const mode of ['edit', 'delete'])
      fixture((root) => {
        report(root, 'functional', [1, 1, 1, 1, 1]);
        const snapshot = path.join(root, 'coverage/snapshot.json');
        writeFileSync(
          snapshot,
          JSON.stringify({ [source]: createHash('sha256').update(content).digest('hex') }),
        );
        if (mode === 'delete') rmSync(path.join(root, source));
        else writeFileSync(path.join(root, source), content.replace('value0 = 0', 'value0 = 10'));
        const result = run(root, '--snapshot', snapshot);
        expect(result.status, mode).toBe(1);
        expect(result.stderr).toContain('Source changed during coverage run');
      });
  });

  it.each(['missing', 'corrupt', 'unrelated', 'negative', 'stale'])(
    'fails closed for a %s coverage report',
    (kind) => {
      fixture((root) => {
        const target = report(
          root,
          'functional',
          [1, 1, 1, 1, 1],
          kind === 'unrelated' ? source.replace('example', 'other') : source,
        );
        if (kind === 'missing') rmSync(target);
        if (kind === 'corrupt') writeFileSync(target, '{');
        if (kind === 'negative') report(root, 'functional', [-1, 1, 1, 1, 1]);
        if (kind === 'stale') utimesSync(target, new Date(0), new Date(0));
        const result = run(root, ...(kind === 'stale' ? ['--started-at', String(Date.now())] : []));
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Coverage check failed');
      });
    },
  );
});
