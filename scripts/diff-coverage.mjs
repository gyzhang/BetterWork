import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import ts from 'typescript';

import { isProductionSource } from './coverage-policy.mjs';

const root = process.cwd();
const git = (args) => execFileSync('git', args, { encoding: 'utf8' });
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function coverageFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) =>
    entry.isDirectory()
      ? coverageFiles(path.join(directory, entry.name))
      : entry.name === 'coverage-final.json'
        ? [path.join(directory, entry.name)]
        : [],
  );
}

function readLineHits(reports, startedAt) {
  const files = coverageFiles(reports);
  if (files.length === 0) throw new Error('Missing coverage reports for executable changes');
  const merged = new Map();
  for (const file of files) {
    if (statSync(file).mtimeMs < startedAt) throw new Error(`Stale coverage report: ${file}`);
    const coverage = JSON.parse(readFileSync(file, 'utf8'));
    if (!isRecord(coverage)) throw new Error(`Invalid coverage report: ${file}`);
    for (const [source, data] of Object.entries(coverage)) {
      if (!isRecord(data) || !isRecord(data.statementMap) || !isRecord(data.s))
        throw new Error(`Invalid statement coverage: ${source}`);
      const sourcePath = existsSync(source) ? realpathSync(source) : path.resolve(source);
      const lines = merged.get(sourcePath) ?? new Map();
      for (const [id, statement] of Object.entries(data.statementMap)) {
        const hits = data.s[id];
        const line =
          isRecord(statement) && isRecord(statement.start) ? statement.start.line : undefined;
        if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(hits) || hits < 0)
          throw new Error(`Invalid line/hit count: ${source}`);
        lines.set(line, Math.max(lines.get(line) ?? 0, hits));
      }
      if (Object.keys(data.s).length !== Object.keys(data.statementMap).length)
        throw new Error(`Mismatched statement coverage: ${source}`);
      merged.set(sourcePath, lines);
    }
  }
  return merged;
}

function changedLines(base, file, untracked) {
  const lines = new Set();
  if (untracked.has(file)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((_, index) => lines.add(index + 1));
  } else {
    const diff = git(['diff', '--no-ext-diff', '--no-renames', '--unified=0', base, '--', file]);
    for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gmu)) {
      const start = Number(match[1]);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      for (let offset = 0; offset < count; offset += 1) lines.add(start + offset);
    }
  }
  return lines;
}

function hasRuntime(file) {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      removeComments: true,
    },
  }).outputText;
  const emitted = ts.createSourceFile(file, compiled, ts.ScriptTarget.ESNext, true);
  // 声明性 import/export 没有自身可执行行；按语义识别，不按 index/barrel 文件名豁免。
  return emitted.statements.some(
    (statement) => !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement),
  );
}

try {
  let base = 'origin/main';
  let reports = 'coverage/quick';
  let output;
  let snapshotPath;
  let startedAt = 0;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const argument = args[index];
    const value = args[index + 1];
    if (!value) throw new Error('Coverage options require values');
    if (argument === '--base') base = value;
    else if (argument === '--reports') reports = value;
    else if (argument === '--output') output = value;
    else if (argument === '--snapshot') snapshotPath = value;
    else if (argument === '--started-at') {
      startedAt = Number(value);
      if (!Number.isSafeInteger(startedAt) || startedAt < 0)
        throw new Error('Invalid coverage start time');
    } else throw new Error(`Unknown coverage option: ${argument}`);
  }
  const baseSha = git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  const untracked = new Set(
    git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean),
  );
  const changed = [
    ...new Set([
      ...git(['diff', '--name-only', '--no-renames', '-z', baseSha]).split('\0').filter(Boolean),
      ...untracked,
    ]),
  ];
  const productionSources = changed.filter((file) => isProductionSource(file) && existsSync(file));
  const sources = productionSources.filter(hasRuntime);
  if (snapshotPath) {
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    if (!isRecord(snapshot)) throw new Error('Invalid source snapshot');
    for (const file of new Set([...Object.keys(snapshot), ...productionSources])) {
      if (
        !isProductionSource(file) ||
        !existsSync(file) ||
        snapshot[file] !== createHash('sha256').update(readFileSync(file)).digest('hex')
      )
        throw new Error(`Source changed during coverage run: ${file}`);
    }
  }
  const hits =
    sources.length > 0 ? readLineHits(path.resolve(root, reports), startedAt) : new Map();
  const files = sources.map((file) => {
    const lines = hits.get(realpathSync(path.resolve(root, file)));
    if (!lines || lines.size === 0) throw new Error(`Missing executable file coverage: ${file}`);
    const changed = changedLines(baseSha, file, untracked);
    const executable = [...lines.keys()].filter((line) => changed.has(line));
    const uncovered = executable.filter((line) => lines.get(line) === 0);
    return {
      path: file,
      covered: executable.length - uncovered.length,
      total: executable.length,
      uncovered,
    };
  });
  const total = files.reduce((count, file) => count + file.total, 0);
  const covered = files.reduce((count, file) => count + file.covered, 0);
  const passed = total === 0 || covered * 100 >= total * 80;
  const result = {
    base: baseSha,
    head: git(['rev-parse', 'HEAD']).trim(),
    threshold: 80,
    covered,
    total,
    percent: total === 0 ? null : Number(((covered * 100) / total).toFixed(2)),
    passed,
    files,
  };
  if (output) {
    mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!passed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(
    `Coverage check failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
