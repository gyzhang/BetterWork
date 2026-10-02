import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
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
import { fileURLToPath, URL } from 'node:url';

import { describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(new URL('./drift-check.mjs', import.meta.url));
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');
const committedBaseline = 'docs/development/drift-readings.json';

/**
 * 每次巡检都要 `git log` 并读全仓文本（实测本机约 0.6s／次）。放宽的是这条用例的**夹具时间**，
 * 不是墙钟预算——墙钟与内存断言仍只住在 `*.bench.test.ts`（docs/12 §9）。
 */
const cliTimeout = 20_000;

interface Report {
  at: string;
  baselineSavedAt: string;
  readings: Record<string, number | string>;
  checks: { id: string; label: string; findings: string[] }[];
  findings: string[];
}

const runDrift = (...args: string[]) => {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: cliTimeout,
  });
  return result;
};

const parseReport = (stdout: string): Report => JSON.parse(stdout) as Report;

describe('治理巡检 CLI', () => {
  it(
    '巡检覆盖四类漂移，并以机器可读的读数报告它们',
    () => {
      const result = runDrift('--json');

      // 巡检本身不许崩：状态码只允许 0（无漂移）或 1（发现漂移），2 以上是异常退出。
      expect(result.status, result.stderr).toBeOneOf([0, 1]);
      expect(result.stderr).toBe('');
      const report = parseReport(result.stdout);
      expect(
        report.checks.map((check) => check.id),
        '少了一类巡检：治理机制被悄悄删掉就没人发现了',
      ).toEqual(['logs', 'hooks', 'unpushed', 'scale']);
      for (const key of ['测试文件', '用例', '结构护栏', '例外登记', '规则文件', '产品源码行'])
        expect(typeof report.readings[key]).toBe('number');
      expect(typeof report.readings['判据总数']).toBe('number');
      // 短标题和 describe › it 是同一判据的两个查找名，不能算成两条护栏。
      expect(report.readings['判据总数']).toBe(report.readings['结构护栏']);
      expect(report.readings['被点过名的判据']).toBeLessThanOrEqual(
        Number(report.readings['判据总数']),
      );
      // findings 与逐条 checks 的合计必须一致，否则「报告说没事」和「明细里有事」会各说一套。
      expect(report.findings.length).toBe(
        report.checks.reduce((total, check) => total + check.findings.length, 0),
      );
    },
    cliTimeout,
  );

  it(
    '点名要求的日期没有工作日志时必须判红，并把日期说出来',
    () => {
      const result = runDrift('--require-log=2000-01-01');

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('2000-01-01 有提交却没有 docs/logs/2000-01-01.md');
    },
    cliTimeout,
  );

  it(
    '写错的参数不能被当成一次通过的巡检',
    () => {
      const result = runDrift('--snce=2026-01-01');

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('不支持的参数');
    },
    cliTimeout,
  );

  it(
    '--save 只写指定的基线文件，不碰仓内那份读数',
    () => {
      const target = path.join(os.tmpdir(), `betterwork-drift-${process.pid}-${Date.now()}.json`);
      const relativeTarget = path.relative(repositoryRoot, target);
      const committedBefore = readFileSync(path.join(repositoryRoot, committedBaseline), 'utf8');
      try {
        const result = runDrift('--save', `--baseline=${relativeTarget}`);

        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(existsSync(target)).toBe(true);
        const saved = JSON.parse(readFileSync(target, 'utf8')) as {
          savedAt: string;
          readings: Record<string, number>;
        };
        expect(saved.readings['结构护栏']).toBeGreaterThan(0);
        // 留档必须写到被点名的位置，仓内那份基线一个字节都不许动（测试不改工作树，AGENTS.md §8）。
        expect(readFileSync(path.join(repositoryRoot, committedBaseline), 'utf8')).toBe(
          committedBefore,
        );
      } finally {
        rmSync(target, { force: true });
      }
    },
    cliTimeout,
  );
});

/** 独立 Git 克隆，避免改真实配置、基线、工作日志与用户 Husky init.sh。 */
function withDriftRepository(
  check: (directory: string, run: (...args: string[]) => ReturnType<typeof runDrift>) => void,
): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'betterwork-drift-fixture-'));
  try {
    for (const name of ['scripts', 'standards', 'docs/logs', '.husky/_', '.fixture-config/husky'])
      mkdirSync(path.join(directory, name), { recursive: true });
    copyFileSync(scriptPath, path.join(directory, 'scripts/drift-check.mjs'));
    symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(directory, 'node_modules'));
    for (const name of ['h', 'pre-commit', 'pre-push'])
      copyFileSync(
        path.join(repositoryRoot, '.husky/_', name),
        path.join(directory, '.husky/_', name),
      );
    writeFileSync(
      path.join(directory, '.gitignore'),
      'node_modules/\n.husky/_/\n.fixture-config/\n',
    );
    writeFileSync(
      path.join(directory, 'eslint.config.mjs'),
      "export default [{ files: ['**/*.ts'], rules: { strict: 'error' } }];\n",
    );
    writeFileSync(
      path.join(directory, 'standards/coding-standard.test.ts'),
      "const exceptions = [{ match: '.small', reason: 'badge' }];\n",
    );
    writeFileSync(path.join(directory, 'docs/logs/2000-01-01.md'), '# Existing log\n');
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.name', 'Drift fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    execFileSync('git', ['commit', '-qm', 'fixture'], {
      cwd: directory,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2000-01-01T12:00:00+08:00',
        GIT_COMMITTER_DATE: '2000-01-01T12:00:00+08:00',
      },
    });
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('config', 'core.hooksPath', '.husky/_');
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        [path.join(directory, 'scripts/drift-check.mjs'), '--baseline=baseline.json', ...args],
        {
          cwd: directory,
          encoding: 'utf8',
          timeout: cliTimeout,
          env: {
            ...process.env,
            HUSKY: '1',
            XDG_CONFIG_HOME: path.join(directory, '.fixture-config'),
          },
        },
      );
    expect(run('--save').status).toBe(0);
    check(directory, run);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const appendBatchLog = (directory: string): void =>
  writeFileSync(
    path.join(directory, 'docs/logs/2000-01-01.md'),
    '\n## 12:00 Fixture batch（状态：完成）\n\n- 背景：fixture\n- 变更内容：rules reviewed\n- 测试证据：fixture passed\n',
    { flag: 'a' },
  );

describe('治理信号不能被数量或留档掩盖', () => {
  it.each(['match', 'reason'])(
    '例外数量相同，修改 %s 也必须报告具体清单',
    (field) => {
      withDriftRepository((directory, run) => {
        const file = path.join(directory, 'standards/coding-standard.test.ts');
        writeFileSync(
          file,
          readFileSync(file, 'utf8').replace(field === 'match' ? '.small' : 'badge', 'expanded'),
        );
        const result = run('--json');
        expect(result.status).toBe(1);
        const report = parseReport(result.stdout);
        expect(report.readings['例外登记']).toBe(1);
        expect(report.findings.join(' ')).toContain('exceptions');
        const before = readFileSync(path.join(directory, 'baseline.json'), 'utf8');
        expect(run('--save').status).toBe(1);
        expect(readFileSync(path.join(directory, 'baseline.json'), 'utf8')).toBe(before);
        appendBatchLog(directory);
        const saved = run('--save', '--batch-base=HEAD', '--review-reason=fixture-reviewed');
        // 留档并不把当次发现涂绿；下一次才和经 Review 的新基线比。
        expect(saved.status).toBe(1);
        expect(saved.stdout).toContain('已留存读数');
        expect(run('--json').status).toBe(0);
      });
    },
    cliTimeout,
  );

  it(
    '格式和注释变化不制造例外漂移，ESLint 放宽规则必须判红',
    () => {
      withDriftRepository((directory, run) => {
        writeFileSync(
          path.join(directory, 'standards/coding-standard.test.ts'),
          "// comment\nconst exceptions = [\n { match: '.small', reason: 'badge' }\n];\n",
        );
        expect(run('--json').status).toBe(0);
        const file = path.join(directory, 'eslint.config.mjs');
        writeFileSync(file, readFileSync(file, 'utf8').replace("'error'", "'off'"));
        const report = parseReport(run('--json').stdout);
        expect(report.findings.join(' ')).toContain('eslint.config.mjs');
      });
    },
    cliTimeout,
  );

  it(
    '正则字面值里的空白是规则本体，不能被格式归一化抹掉',
    () => {
      withDriftRepository((directory, run) => {
        const file = path.join(directory, 'eslint.config.mjs');
        writeFileSync(file, readFileSync(file, 'utf8') + '\nconst selector = /a b/;\n');
        appendBatchLog(directory);
        expect(run('--save', '--batch-base=HEAD', '--review-reason=fixture-reviewed').status).toBe(
          1,
        );
        writeFileSync(file, readFileSync(file, 'utf8').replace('/a b/', '/ab/'));
        const result = run('--json');
        expect(result.status).toBe(1);
        expect(parseReport(result.stdout).findings.join(' ')).toContain('eslint.config.mjs');
      });
    },
    cliTimeout,
  );

  it(
    '已有当天文件不能替本批次日志，新任务小节完整后才通过',
    () => {
      withDriftRepository((directory, run) => {
        const before = readFileSync(path.join(directory, 'baseline.json'), 'utf8');
        expect(run('--batch-base=HEAD').status).toBe(1);
        expect(run('--batch-base=HEAD', '--save', '--review-reason=reviewed').status).toBe(1);
        expect(readFileSync(path.join(directory, 'baseline.json'), 'utf8')).toBe(before);
        appendBatchLog(directory);
        expect(run('--batch-base=HEAD').status).toBe(0);
      });
    },
    cliTimeout,
  );

  it(
    'init.sh 停用 Husky 时实际入口探针判红，禁止留档掩盖',
    () => {
      withDriftRepository((directory, run) => {
        writeFileSync(path.join(directory, '.fixture-config/husky/init.sh'), 'export HUSKY=0\n');
        const report = parseReport(run('--json').stdout);
        expect(report.checks.find((check) => check.id === 'hooks')?.findings).toHaveLength(2);
        const before = readFileSync(path.join(directory, 'baseline.json'), 'utf8');
        expect(run('--save').status).toBe(1);
        expect(readFileSync(path.join(directory, 'baseline.json'), 'utf8')).toBe(before);
      });
    },
    cliTimeout,
  );

  it(
    '缺 hooksPath 与损坏的基线均不能产生通过读数',
    () => {
      withDriftRepository((directory, run) => {
        execFileSync('git', ['config', '--unset', 'core.hooksPath'], { cwd: directory });
        expect(parseReport(run('--json').stdout).findings.join(' ')).toContain('没有把钩子指到');
        writeFileSync(
          path.join(directory, 'baseline.json'),
          '{"savedAt":"fixture","readings":{},"ruleSnapshot":{"version":1}}',
        );
        const result = run('--json');
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('规则快照损坏');
      });
    },
    cliTimeout,
  );
});
