import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { planChecks } from './pr-check-plan.mjs';

try {
  let base = 'origin/main';
  let part = 'all';
  let planOnly = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--plan') planOnly = true;
    else if ((argument === '--base' || argument === '--part') && args[index + 1]) {
      const value = args[index + 1];
      if (argument === '--base') base = value;
      else part = value;
      index += 1;
    } else throw new Error('Usage: pr-check.mjs [--base <ref>] [--part all|lint|checks] [--plan]');
  }
  if (!['all', 'lint', 'checks'].includes(part)) throw new Error('Invalid quick check part');
  const git = (arguments_) => execFileSync('git', arguments_, { encoding: 'utf8' });
  const baseSha = git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  git(['diff', '--check', baseSha]);
  const files = [
    ...new Set(
      [
        ...git(['diff', '--name-only', '-z', baseSha]).split('\0'),
        ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
      ].filter((file) => file !== ''),
    ),
  ];
  const plan = planChecks(files, baseSha, part, process.cwd());
  if (planOnly) process.stdout.write(`${JSON.stringify({ base: baseSha, files, ...plan })}\n`);
  else {
    const startedAt = Date.now();
    if (part !== 'lint') {
      rmSync('coverage/quick', { recursive: true, force: true });
      mkdirSync('coverage/quick', { recursive: true });
      writeFileSync(
        'coverage/quick/plan.json',
        JSON.stringify(
          { base: baseSha, head: git(['rev-parse', 'HEAD']).trim(), files, ...plan, startedAt },
          null,
          2,
        ) + '\n',
      );
      writeFileSync(
        'coverage/quick/source-snapshot.json',
        JSON.stringify(
          Object.fromEntries(
            (plan.coverageSources ?? []).map((file) => [
              file,
              createHash('sha256').update(readFileSync(file)).digest('hex'),
            ]),
          ),
          null,
          2,
        ) + '\n',
      );
    }
    for (const test of plan.requiredTests ?? []) {
      if (!existsSync(test)) {
        if (part !== 'lint')
          writeFileSync(
            'coverage/quick/check-status.json',
            JSON.stringify({ label: 'Required consumers', status: 1, missing: test }) + '\n',
          );
        throw new Error(`Required consumer test is missing: ${test}`);
      }
    }
    process.stdout.write(`Quick check: ${plan.scope}; part: ${part}; base: ${baseSha}\n`);
    if (plan.uiRequired)
      process.stdout.write(
        'UI fixtures changed: optional UI verification remains pending under ADR-0046.\n',
      );
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary)
      appendFileSync(
        summary,
        `## Quick check (${part})\n\nScope: ${plan.scope}; base: \`${baseSha}\`\n\n| Check | Seconds | Result |\n| --- | ---: | --- |\n`,
      );
    for (const item of plan.commands) {
      if (item.label === 'Changed line coverage')
        item.args.push(
          '--started-at',
          String(startedAt),
          '--snapshot',
          'coverage/quick/source-snapshot.json',
        );
      const started = Date.now();
      process.stdout.write(`Starting ${item.label}\n`);
      const result = spawnSync(item.command, item.args, { stdio: 'inherit' });
      const status = result.status ?? 1;
      const seconds = ((Date.now() - started) / 1000).toFixed(2);
      process.stdout.write(`${item.label}: ${seconds}s; exit ${status}\n`);
      if (summary)
        appendFileSync(
          summary,
          `| ${item.label} | ${seconds} | ${status === 0 ? 'passed' : 'failed'} |\n`,
        );
      if (part !== 'lint')
        writeFileSync(
          path.join('coverage/quick', 'check-status.json'),
          JSON.stringify(
            {
              base: baseSha,
              label: item.label,
              status,
              seconds,
              signal: result.signal,
              error: result.error?.message,
              uiRequired: plan.uiRequired,
            },
            null,
            2,
          ) + '\n',
        );
      if (result.error) process.stderr.write(`${result.error.message}\n`);
      if (status !== 0) {
        process.exitCode = status;
        break;
      }
    }
  }
} catch (error) {
  process.stderr.write(
    `Quick check failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
