import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  RuntimeProfileCommand,
  SkillToolchainRequirement,
  ValidationStateInput,
} from '@betterwork/agent-protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { buildToolchainEnvironment, resolveSkillCommand } from './skill-command-runtime';

const roots: string[] = [];
const temporary = (): string => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'betterwork-command-runtime-')));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const notChecked: ValidationStateInput = {
  structure: 'not-checked',
  visual: 'not-checked',
  manualEdit: 'not-checked',
};

const createCommand = (): RuntimeProfileCommand => ({
  commandId: 'icon-sync',
  label: 'Sync icons',
  executableKey: 'managed-python',
  argumentSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      project_dir: { type: 'string' },
      icons: { type: 'array', items: { type: 'string' } },
    },
  },
  timeoutMs: 60_000,
  expectedOutputs: [],
  execution: {
    entrypoint: {
      scope: 'toolchain',
      runtime: 'managed-python',
      toolchainId: 'icons',
      path: 'scripts/icon_sync.py',
    },
    pathArguments: [{ argumentName: 'project_dir', scope: 'work', access: 'read-write' }],
    argv: [
      { kind: 'argument', name: 'project_dir' },
      { kind: 'argument', name: 'icons', repeat: true },
      { kind: 'literal', value: '--output' },
      { kind: 'output', outputId: 'generated' },
    ],
    outputs: [
      {
        outputId: 'generated',
        source: { kind: 'generated', relativePath: '.attempts/{executionId}/icons.json' },
        extension: 'json',
        mimeType: 'application/json',
        validation: notChecked,
      },
    ],
  },
});

describe('resolveSkillCommand', () => {
  it('resolves declared toolchain entrypoints, path arguments, argv tokens and fresh outputs', () => {
    const root = temporary();
    const skillRoot = path.join(root, 'skill');
    const toolchainRoot = path.join(root, 'toolchain');
    const workDir = path.join(root, 'work');
    const python = path.join(root, 'venv/bin/python3');
    mkdirSync(path.join(skillRoot, 'scripts'), { recursive: true });
    mkdirSync(path.join(toolchainRoot, 'scripts'), { recursive: true });
    mkdirSync(path.join(workDir, 'project'), { recursive: true });
    mkdirSync(path.dirname(python), { recursive: true });
    writeFileSync(path.join(toolchainRoot, 'scripts/icon_sync.py'), 'pass');
    writeFileSync(python, 'python');

    const command = resolveSkillCommand(
      createCommand(),
      { project_dir: 'project', icons: ['brand-a', 'brand-b'] },
      {
        skillRoot,
        toolchainRoots: { icons: toolchainRoot },
        managedPythonPath: python,
        workDir,
        executionId: 'execution-1',
      },
    );

    expect(command.executable).toBe(python);
    expect(command.argv).toEqual([
      path.join(toolchainRoot, 'scripts/icon_sync.py'),
      path.join(workDir, 'project'),
      'brand-a',
      'brand-b',
      '--output',
      path.join(workDir, '.attempts/execution-1/icons.json'),
    ]);
    expect(command.cwd).toBe(workDir);
    expect(command.expectedOutputs).toEqual(['.attempts/execution-1/icons.json']);
    expect(command.outputContracts).toEqual([
      {
        mode: 'create',
        extension: 'json',
        mimeType: 'application/json',
        validation: notChecked,
      },
    ]);
  });

  it('preserves explicit false values in declared argv tokens', () => {
    const root = temporary();
    const skillRoot = path.join(root, 'skill');
    const workDir = path.join(root, 'work');
    const python = path.join(root, 'python3');
    mkdirSync(path.join(skillRoot, 'scripts'), { recursive: true });
    mkdirSync(workDir, { recursive: true });
    writeFileSync(path.join(skillRoot, 'scripts/icon_sync.py'), 'pass');
    writeFileSync(python, 'python');
    const command: RuntimeProfileCommand = {
      ...createCommand(),
      execution: {
        entrypoint: { scope: 'skill', runtime: 'managed-python', path: 'scripts/icon_sync.py' },
        pathArguments: [],
        argv: [{ kind: 'argument', name: 'enabled' }],
        outputs: [],
      },
      argumentSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { enabled: { type: 'boolean' } },
      },
    };

    const resolved = resolveSkillCommand(
      command,
      { enabled: false },
      {
        skillRoot,
        toolchainRoots: {},
        managedPythonPath: python,
        workDir,
        executionId: 'execution-false',
      },
    );

    expect(resolved.argv).toEqual([path.join(skillRoot, 'scripts/icon_sync.py'), 'false']);
  });

  it('resolves package-local validation outputs without format-specific host logic', () => {
    const root = temporary();
    const skillRoot = path.join(root, 'skill');
    const workDir = path.join(root, 'work');
    const python = path.join(root, 'python3');
    mkdirSync(path.join(skillRoot, 'scripts'), { recursive: true });
    mkdirSync(path.join(workDir, 'inputs'), { recursive: true });
    writeFileSync(path.join(skillRoot, 'scripts/validate.py'), 'pass');
    writeFileSync(path.join(workDir, 'inputs/result.pptx'), 'fixture');
    writeFileSync(python, 'python');
    const validation: ValidationStateInput = {
      structure: 'passed',
      visual: 'not-checked',
      manualEdit: 'not-checked',
    };
    const command: RuntimeProfileCommand = {
      ...createCommand(),
      commandId: 'validate',
      execution: {
        entrypoint: { scope: 'skill', runtime: 'managed-python', path: 'scripts/validate.py' },
        pathArguments: [{ argumentName: 'target', scope: 'work', access: 'read' }],
        argv: [{ kind: 'argument', name: 'target' }],
        outputs: [
          {
            outputId: 'validated',
            source: { kind: 'argument', argumentName: 'target' },
            extension: 'pptx',
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            validation,
          },
        ],
      },
    };

    const resolved = resolveSkillCommand(
      command,
      { target: 'inputs/result.pptx' },
      {
        skillRoot,
        toolchainRoots: {},
        managedPythonPath: python,
        workDir,
        executionId: 'execution-2',
      },
    );

    expect(resolved.argv).toEqual([
      path.join(skillRoot, 'scripts/validate.py'),
      path.join(workDir, 'inputs/result.pptx'),
    ]);
    expect(resolved.expectedOutputs).toEqual(['inputs/result.pptx']);
    expect(resolved.outputContracts[0]?.mode).toBe('unchanged');
    expect(resolved.outputContracts[0]?.validation).toEqual(validation);
  });

  it('rejects path traversal and missing declared toolchains', () => {
    const root = temporary();
    const toolchainRoot = path.join(root, 'toolchain');
    const workDir = path.join(root, 'work');
    mkdirSync(path.join(toolchainRoot, 'scripts'), { recursive: true });
    mkdirSync(workDir, { recursive: true });
    writeFileSync(path.join(toolchainRoot, 'scripts/icon_sync.py'), 'pass');

    expect(() =>
      resolveSkillCommand(
        createCommand(),
        { project_dir: '../outside', icons: [] },
        {
          skillRoot: root,
          toolchainRoots: { icons: toolchainRoot },
          managedPythonPath: '/managed/python3',
          workDir,
          executionId: 'execution-3',
        },
      ),
    ).toThrow('escapes');
    expect(() =>
      resolveSkillCommand(
        createCommand(),
        { project_dir: 'project', icons: [] },
        {
          skillRoot: root,
          toolchainRoots: {},
          managedPythonPath: '/managed/python3',
          workDir,
          executionId: 'execution-4',
        },
      ),
    ).toThrow('toolchain snapshot');
  });

  it('rejects symbolic links in declared path arguments', () => {
    const root = temporary();
    const skillRoot = path.join(root, 'skill');
    const toolchainRoot = path.join(root, 'toolchain');
    const workDir = path.join(root, 'work');
    const outside = path.join(root, 'outside');
    mkdirSync(path.join(toolchainRoot, 'scripts'), { recursive: true });
    mkdirSync(workDir, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(toolchainRoot, 'scripts/icon_sync.py'), 'pass');
    symlinkSync(outside, path.join(workDir, 'linked'));

    expect(() =>
      resolveSkillCommand(
        createCommand(),
        { project_dir: 'linked', icons: [] },
        {
          skillRoot,
          toolchainRoots: { icons: toolchainRoot },
          managedPythonPath: '/managed/python3',
          workDir,
          executionId: 'execution-5',
        },
      ),
    ).toThrow('symbolic link');
  });
});

describe('buildToolchainEnvironment', () => {
  it('maps only declared environment variables to verified snapshot roots', () => {
    const requirements: SkillToolchainRequirement[] = [
      { id: 'icons', name: 'Icon tools', environmentVariable: 'ICON_HOME' },
    ];
    expect(buildToolchainEnvironment(requirements, { icons: '/managed/icons' })).toEqual({
      ICON_HOME: '/managed/icons',
    });
    expect(buildToolchainEnvironment(undefined, { icons: '/managed/icons' })).toEqual({});
  });
});
