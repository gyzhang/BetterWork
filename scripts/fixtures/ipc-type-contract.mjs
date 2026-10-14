import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import ts from 'typescript';

// 独立 Node checker 保留全部正反例，避免父 Vitest 的 V8 覆盖率采样放大编译器成本。
const request = 'z.object({ text: z.string() })';
const response = 'z.object({ count: z.number() })';
const helpers = ['handleInput', 'handleOptionalInput', 'handleNoInput', 'handleScheduleInput'];
const argument = (helper) => (helper === 'handleNoInput' ? 'emptyRequestSchema' : request);
const value = (helper) => (helper === 'handleNoInput' ? 'input.sender.id' : 'input.text.length');

const valid = helpers.flatMap((helper) =>
  ['', 'async '].map((asyncPrefix) => ({
    name: `${helper} ${asyncPrefix || 'sync '}response`,
    expression: `${helper}('compile-only', ${argument(helper)}, ${response}, ${asyncPrefix}(input) => ({ count: ${value(helper)} }))`,
  })),
);
valid.push(
  {
    name: 'request transform produces handler input',
    expression: `handleInput('compile-only', z.string().transform((text) => text.length), z.string(), (input) => input.toFixed())`,
  },
  {
    name: 'request default produces required handler field',
    expression: `handleOptionalInput('compile-only', z.object({ text: z.string().default('') }), z.number(), (input) => input.text.length)`,
  },
  {
    name: 'response transform accepts its raw input',
    expression: `handleInput('compile-only', ${request}, z.string().transform((text) => text.length), () => 'raw')`,
  },
  {
    name: 'response default may fill an omitted field',
    expression: `handleNoInput('compile-only', emptyRequestSchema, z.object({ count: z.number().default(0) }), () => ({}))`,
  },
  {
    name: 'nullable response preserves missing-object semantics',
    expression: `handleInput('compile-only', ${request}, ${response}.nullable(), () => null)`,
  },
  {
    name: 'undefined response preserves no-value semantics',
    expression: `handleNoInput('compile-only', emptyRequestSchema, z.undefined(), (): undefined => {})`,
  },
  {
    name: 'unknown response remains intentionally unconstrained',
    expression: `handleScheduleInput('compile-only', ${request}, z.unknown(), () => ({ opaque: 'value' }))`,
  },
);

const invalid = helpers.flatMap((helper) =>
  ['', 'async '].map((asyncPrefix) => ({
    name: `${helper} rejects ${asyncPrefix || 'sync '}wrong response`,
    expression: `${helper}('compile-only', ${argument(helper)}, ${response}, ${asyncPrefix}() => ({ count: 'wrong' }))`,
  })),
);
invalid.push(
  {
    name: 'required response field cannot be omitted',
    expression: `handleInput('compile-only', ${request}, ${response}, () => ({}))`,
  },
  {
    name: 'handler input cannot widen the request Schema',
    expression: `handleOptionalInput('compile-only', ${request}, ${response}, (input: { text: number }) => ({ count: input.text }))`,
  },
  {
    name: 'handler must use transformed request output',
    expression: `handleInput('compile-only', z.string().transform((text) => text.length), z.string(), (input) => input.toUpperCase())`,
  },
  {
    name: 'handler returns response transform input rather than output',
    expression: `handleInput('compile-only', ${request}, z.string().transform((text) => text.length), () => 1)`,
  },
  {
    name: 'defaulted response field still has a type',
    expression: `handleNoInput('compile-only', emptyRequestSchema, z.object({ count: z.number().default(0) }), () => ({ count: 'wrong' }))`,
  },
  {
    name: 'literal acknowledgement cannot be false',
    expression: `handleNoInput('compile-only', emptyRequestSchema, z.object({ cleared: z.literal(true) }), () => ({ cleared: false }))`,
  },
  {
    name: 'Schedule handler returns data rather than a transport envelope',
    expression: `handleScheduleInput('compile-only', ${request}, ${response}, () => ({ status: 'success', data: { count: 0 } }))`,
  },
  {
    name: 'undefined response cannot contain a value',
    expression: `handleNoInput('compile-only', emptyRequestSchema, z.undefined(), () => 'wrong')`,
  },
  {
    name: 'nullable response does not authorize undefined',
    expression: `handleInput('compile-only', ${request}, ${response}.nullable(), () => undefined)`,
  },
);

const sourcePath = fileURLToPath(
  new URL('../../apps/desktop/src/main/ipc/register-ipc.ts', import.meta.url),
);
const configPath = ts.findConfigFile(
  path.dirname(sourcePath),
  (fileName) => ts.sys.fileExists(fileName),
  'tsconfig.json',
);
if (!configPath) throw new Error('Repository tsconfig is missing');
const config = ts.readConfigFile(configPath, (fileName) => ts.sys.readFile(fileName));
assert.equal(config.error, undefined);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
assert.deepEqual(parsed.errors, []);
let source = readFileSync(sourcePath, 'utf8') + '\n';
const cases = [...valid, ...invalid].map((probe) => {
  const start = source.length;
  source += `${probe.expression};\n`;
  return { ...probe, start, end: source.length, rejects: invalid.includes(probe) };
});
// 只在 checker 的内存源中追加调用，私有 helper 无需为测试导出或在 Electron 中执行。
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
  if (probe.rejects) {
    assert.ok(errors.length > 0, probe.name);
    assert.ok(
      errors.every((error) => [2322, 2339, 2345].includes(error.code)),
      probe.name,
    );
  } else {
    assert.deepEqual(errors.map(format), [], probe.name);
  }
}
process.stdout.write(JSON.stringify({ valid: valid.length, invalid: invalid.length }) + '\n');
