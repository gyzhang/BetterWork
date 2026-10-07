import { lstatSync } from 'node:fs';
import path from 'node:path';

import type {
  RuntimeProfileCommand,
  SkillToolchainRequirement,
  ValidationStateInput,
} from '@betterwork/agent-protocol';

import { managedPath } from '../infrastructure/managed-files';

const UNCHECKED_VALIDATION: ValidationStateInput = {
  structure: 'not-checked',
  visual: 'not-checked',
  manualEdit: 'not-checked',
};

export interface SkillCommandRuntimeContext {
  readonly skillRoot: string;
  readonly toolchainRoots: Readonly<Record<string, string>>;
  readonly managedPythonPath: string;
  readonly workDir: string;
  readonly executionId: string;
}

export interface SkillCommandOutputContract {
  readonly mode: 'create' | 'unchanged';
  readonly extension: string;
  readonly mimeType: string;
  readonly validation: ValidationStateInput;
}

export interface ResolvedSkillCommand {
  readonly executable: string;
  readonly argv: string[];
  readonly cwd: string;
  readonly expectedOutputs: string[];
  readonly outputContracts: SkillCommandOutputContract[];
  readonly requireCompleteStdout: boolean;
}

export interface ResolvedToolchainSnapshots {
  readonly roots: Record<string, string>;
  readonly environment: Record<string, string>;
}

/** Map declared requirements to their already-verified immutable snapshot roots. */
export const buildToolchainEnvironment = (
  requirements: readonly SkillToolchainRequirement[] | undefined,
  roots: Readonly<Record<string, string>>,
): Record<string, string> => {
  const environment: Record<string, string> = {};
  if (requirements) {
    for (const requirement of requirements) {
      const root = roots[requirement.id];
      if (root) environment[requirement.environmentVariable] = root;
    }
    return environment;
  }
  return environment;
};

const resolveInputPath = (
  value: unknown,
  rootKey: 'skill' | 'work',
  access: 'read' | 'write' | 'read-write',
  context: SkillCommandRuntimeContext,
): string => {
  if (rootKey === 'skill' && access !== 'read') {
    throw new Error('Skill package resources are read-only');
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('A declared path argument must be a non-empty string');
  }
  const root = rootKey === 'skill' ? context.skillRoot : context.workDir;
  const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  const relative = path.relative(root, absolute);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Command path escapes its declared root');
  }
  const resolved = managedPath(root, relative, access !== 'read');
  if (access !== 'write') {
    const details = lstatSync(resolved);
    if (!details.isFile() && !details.isDirectory()) {
      throw new Error('Declared input path must be a regular file or directory');
    }
  }
  return resolved;
};

const resolveOutputPath = (
  command: RuntimeProfileCommand,
  outputId: string,
  args: Record<string, unknown>,
  context: SkillCommandRuntimeContext,
): { absolutePath: string; relativePath: string; mode: 'create' | 'unchanged' } => {
  const output = command.execution?.outputs.find((candidate) => candidate.outputId === outputId);
  if (!output) throw new Error(`Undeclared command output: ${outputId}`);
  const source = output.source;
  if (source.kind === 'argument') {
    const pathArgument = command.execution?.pathArguments.find(
      (candidate) => candidate.argumentName === source.argumentName,
    );
    if (!pathArgument || pathArgument.scope !== 'work' || pathArgument.access === 'write') {
      throw new Error(
        'Published input outputs must resolve to readable paths in the Run work area',
      );
    }
    const absolutePath = resolveInputPath(
      args[source.argumentName],
      pathArgument.scope,
      pathArgument.access,
      context,
    );
    const relativePath = path.relative(context.workDir, absolutePath);
    if (
      !relativePath ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new Error('Published output path escapes the Run work area');
    }
    return { absolutePath, relativePath, mode: 'unchanged' };
  }

  if (source.kind !== 'generated') {
    throw new Error('Command output source kind is unsupported');
  }
  if (source.relativePath.includes('{') && !source.relativePath.includes('{executionId}')) {
    throw new Error('Output path contains an unsupported template variable');
  }
  const relativePath = source.relativePath.replaceAll('{executionId}', context.executionId);
  if (relativePath.includes('{') || relativePath.includes('}')) {
    throw new Error('Output path contains an unsupported template variable');
  }
  const absolutePath = managedPath(context.workDir, relativePath, true);
  return { absolutePath, relativePath, mode: 'create' };
};

const scalarArgument = (value: unknown, argumentName: string): string => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value && typeof value === 'object') return JSON.stringify(value);
  throw new Error(`Command argument ${argumentName} cannot be serialized to argv`);
};

export const resolveSkillCommand = (
  command: RuntimeProfileCommand,
  args: Record<string, unknown>,
  context: SkillCommandRuntimeContext,
): ResolvedSkillCommand => {
  const execution = command.execution;
  if (!execution) {
    const executableKey = command.executableKey;
    if (!executableKey?.startsWith('scripts/') || !executableKey.endsWith('.py')) {
      throw new Error('Command has no supported declarative execution entrypoint');
    }
    const script = managedPath(context.skillRoot, executableKey);
    const expectedOutputs = command.expectedOutputs ?? [];
    const contracts = expectedOutputs.map((relativePath) => ({
      mode: 'create' as const,
      extension: path.extname(relativePath).slice(1) || 'bin',
      mimeType: 'application/octet-stream',
      validation: UNCHECKED_VALIDATION,
    }));
    return {
      executable: context.managedPythonPath,
      argv: [script, ...buildLegacyArgv(args)],
      cwd: context.workDir,
      expectedOutputs: [...expectedOutputs],
      outputContracts: contracts,
      requireCompleteStdout: command.requireCompleteStdout ?? false,
    };
  }

  const entrypointRoot =
    execution.entrypoint.scope === 'skill'
      ? context.skillRoot
      : context.toolchainRoots[execution.entrypoint.toolchainId];
  if (!entrypointRoot) {
    throw new Error(
      `Required toolchain snapshot is unavailable: ${execution.entrypoint.scope === 'toolchain' ? execution.entrypoint.toolchainId : ''}`,
    );
  }
  const entrypoint = managedPath(entrypointRoot, execution.entrypoint.path);
  const entrypointDetails = lstatSync(entrypoint);
  if (!entrypointDetails.isFile()) throw new Error('Command entrypoint must be a regular file');
  const executable =
    execution.entrypoint.runtime === 'managed-python' ? context.managedPythonPath : entrypoint;
  const argv = execution.entrypoint.runtime === 'managed-python' ? [entrypoint] : [];
  const pathArguments = new Map(
    execution.pathArguments.map((argument) => [argument.argumentName, argument]),
  );
  const resolvedOutputs = execution.outputs.map((output) => ({
    output,
    resolved: resolveOutputPath(command, output.outputId, args, context),
  }));
  const outputPaths = new Map(
    resolvedOutputs.map(({ output, resolved }) => [output.outputId, resolved.absolutePath]),
  );

  for (const token of execution.argv) {
    if (token.kind === 'literal') {
      argv.push(token.value);
      continue;
    }
    if (token.kind === 'work-directory') {
      argv.push(context.workDir);
      continue;
    }
    if (token.kind === 'output') {
      const outputPath = outputPaths.get(token.outputId);
      if (!outputPath) throw new Error(`Undeclared command output: ${token.outputId}`);
      argv.push(outputPath);
      continue;
    }
    const value = args[token.name];
    if (value === undefined || value === null) continue;
    const pathArgument = pathArguments.get(token.name);
    const resolvedValue = pathArgument
      ? resolveInputPath(value, pathArgument.scope, pathArgument.access, context)
      : value;
    if (token.repeat) {
      if (!Array.isArray(resolvedValue)) {
        throw new Error(`Repeated command argument ${token.name} must be an array`);
      }
      argv.push(...resolvedValue.map((entry) => scalarArgument(entry, token.name)));
    } else {
      argv.push(scalarArgument(resolvedValue, token.name));
    }
  }

  const expectedOutputs: string[] = [];
  const outputContracts: SkillCommandOutputContract[] = [];
  for (const { output, resolved } of resolvedOutputs) {
    expectedOutputs.push(resolved.relativePath);
    outputContracts.push({
      mode: resolved.mode,
      extension: output.extension,
      mimeType: output.mimeType,
      validation: output.validation,
    });
  }
  return {
    executable,
    argv,
    cwd: context.workDir,
    expectedOutputs,
    outputContracts,
    requireCompleteStdout: command.requireCompleteStdout ?? false,
  };
};

const buildLegacyArgv = (args: Record<string, unknown>): string[] => {
  const argv: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === false) continue;
    argv.push(`--${key}`);
    if (value === true) continue;
    if (Array.isArray(value)) {
      for (const entry of value) argv.push(scalarArgument(entry, key));
    } else {
      argv.push(scalarArgument(value, key));
    }
  }
  return argv;
};
