import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
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
