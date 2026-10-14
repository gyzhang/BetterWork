import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import ts from 'typescript';

// Keep compiler work outside Vitest's V8 coverage sampler while retaining every contract probe.
const input = JSON.parse(readFileSync(0, 'utf8'));
assert.ok(Array.isArray(input.valid) && input.valid.every((item) => typeof item === 'string'));
assert.ok(Array.isArray(input.invalid) && input.invalid.every((item) => typeof item === 'string'));

const sourcePath = fileURLToPath(
  new URL('../../apps/desktop/src/preload/index.ts', import.meta.url),
);
const configPath = ts.findConfigFile(
  path.dirname(sourcePath),
  (fileName) => ts.sys.fileExists(fileName),
  'tsconfig.json',
);
assert.ok(configPath, 'Repository tsconfig is missing');
const config = ts.readConfigFile(configPath, (fileName) => ts.sys.readFile(fileName));
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
assert.deepEqual(parsed.errors, []);

let source = readFileSync(sourcePath, 'utf8') + '\n';
const cases = [
  ...input.valid.map((expression) => ({ expression, rejects: false })),
  ...input.invalid.map((expression) => ({ expression, rejects: true })),
].map((probe) => {
  const start = source.length;
  source += `${probe.expression};\n`;
  return { ...probe, start, end: source.length };
});

const options = { ...parsed.options, noEmit: true };
const host = ts.createCompilerHost(options);
const getSourceFile = host.getSourceFile.bind(host);
host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
  path.resolve(fileName) === sourcePath
    ? ts.createSourceFile(fileName, source, languageVersion, true)
    : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
const program = ts.createProgram({ rootNames: [sourcePath], options, host });
const diagnostics = ts.getPreEmitDiagnostics(program);
const format = (diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
const unexpected = diagnostics.filter(
  (diagnostic) =>
    diagnostic.file?.fileName !== sourcePath ||
    diagnostic.start === undefined ||
    !cases.some(
      (probe) =>
        probe.rejects &&
        diagnostic.start !== undefined &&
        diagnostic.start >= probe.start &&
        diagnostic.start < probe.end,
    ),
);
assert.deepEqual(unexpected.map(format), []);
for (const probe of cases) {
  const errors = diagnostics.filter(
    (diagnostic) =>
      diagnostic.file?.fileName === sourcePath &&
      diagnostic.start !== undefined &&
      diagnostic.start >= probe.start &&
      diagnostic.start < probe.end,
  );
  assert.equal(errors.length > 0, probe.rejects, probe.expression);
}

process.stdout.write(
  JSON.stringify({ valid: input.valid.length, invalid: input.invalid.length }) + '\n',
);
