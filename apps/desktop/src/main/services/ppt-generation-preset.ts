import path from 'node:path';

import type { RuntimeProfileDraft } from '@betterwork/agent-protocol';
import type { SkillCommandExecuteOutput } from '@betterwork/tool-runtime';

import type {
  AdapterContext,
  AwaitedExecutionSnapshot,
  ResolvedCommand,
  SkillAdapter,
  SkillAdapterFactory,
} from './skill-adapter';

/**
 * PPT 生成样本适配预设（设计 §9、任务 A16）。
 *
 * 把五个抽象 commandId 解析为真实脚本路径与受管环境：
 * - project-init → ppt-master project_manager.py init（注入 --dir）
 * - icon-sync → ppt-master icon_sync.py
 * - svg-export → Skill 自带 svg_native_export.py
 * - template-merge → Skill 自带 merge_into_template.py
 * - pptx-validate → Skill 自带 validate_pptx.py（以 issues 判失败，不看退出码）
 *
 * 按原包内容 hash 匹配；未知 hash 不冒充已兼容。
 */

const SUPPORTED_COMMANDS = new Set([
  'project-init',
  'icon-sync',
  'svg-export',
  'template-merge',
  'pptx-validate',
]);

const stringArg = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Command requires string argument: ${key}`);
  }
  return value;
};

const resolveWorkPath = (value: string, workDir: string): string => {
  const target = path.resolve(workDir, value);
  const relative = path.relative(workDir, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('Command path escapes work directory');
  return target;
};

class PptGenerationAdapter implements SkillAdapter {
  readonly name = 'ppt-generation';

  constructor(private readonly contentHashes: readonly string[]) {}

  isCompatible(contentHash: string): boolean {
    return this.contentHashes.includes(contentHash);
  }

  resolveCommand(
    commandId: string,
    args: Record<string, unknown>,
    context: AdapterContext,
  ): ResolvedCommand | undefined {
    if (!SUPPORTED_COMMANDS.has(commandId)) return undefined;

    switch (commandId) {
      case 'project-init':
        return this.resolveProjectInit(args, context);
      case 'icon-sync':
        return this.resolveIconSync(args, context);
      case 'svg-export':
        return this.resolveSvgExport(args, context);
      case 'template-merge':
        return this.resolveTemplateMerge(args, context);
      case 'pptx-validate':
        return this.resolvePptxValidate(args, context);
    }
  }

  interpretOutput(
    commandId: string,
    raw: AwaitedExecutionSnapshot,
  ): SkillCommandExecuteOutput | undefined {
    if (commandId !== 'pptx-validate') return undefined;
    return interpretValidateOutput(raw);
  }

  runtimeConventions(commandIds: ReadonlySet<string>): string | undefined {
    const clauses: string[] = [];
    if (commandIds.has('svg-export') && commandIds.has('template-merge')) {
      clauses.push(
        'svg-export 与 template-merge 各自在独立 attempt 目录中执行，后续步骤必须使用它们返回的实际输出路径，不得自行拼接路径。',
      );
    }
    if (commandIds.has('template-merge')) {
      clauses.push(
        'template-merge 的 template_path 传 assets/... 时指向本 Skill 自带的只读公司模板，不要复制到其他位置后引用副本。',
      );
    }
    if (commandIds.has('pptx-validate')) {
      clauses.push(
        'pptx-validate 返回成功后，才能用该次执行的 executionId 与 outputIds 调用 artifact_register_file 登记 PPTX 成果。',
      );
    }
    if (clauses.length === 0) return undefined;
    return `PPT 生成补充约定：${clauses.join('')}`;
  }

  private resolveProjectInit(
    args: Record<string, unknown>,
    context: AdapterContext,
  ): ResolvedCommand {
    const pptmHome = context.pptmHome ?? context.toolchainSnapshotRoot;
    if (!pptmHome) {
      throw new Error('project-init requires PPTM_HOME or toolchain snapshot');
    }
    const projectName = stringArg(args, 'project_name');
    if (
      projectName.startsWith('-') ||
      projectName === '.' ||
      projectName === '..' ||
      /[\\/]/u.test(projectName)
    )
      throw new Error('Project name must not be a path or option');
    const script = path.join(pptmHome, 'skills', 'ppt-master', 'scripts', 'project_manager.py');
    const argv = [
      script,
      'init',
      projectName,
      '--dir',
      context.runWorkDir,
      '--quick-generate',
      '--format',
      'ppt169',
    ];
    return {
      executable: context.managedPythonPath,
      argv,
      env: this.buildEnv(context, pptmHome),
      cwd: context.runWorkDir,
    };
  }

  private resolveIconSync(args: Record<string, unknown>, context: AdapterContext): ResolvedCommand {
    const pptmHome = context.pptmHome ?? context.toolchainSnapshotRoot;
    if (!pptmHome) {
      throw new Error('icon-sync requires PPTM_HOME or toolchain snapshot');
    }
    const projectDir = resolveWorkPath(stringArg(args, 'project_dir'), context.runWorkDir);
    const script = path.join(pptmHome, 'skills', 'ppt-master', 'scripts', 'icon_sync.py');
    const icons = args['icons'];
    const iconArgv = Array.isArray(icons)
      ? icons.filter((value): value is string => typeof value === 'string')
      : [];
    const argv = [script, projectDir, ...iconArgv];
    return {
      executable: context.managedPythonPath,
      argv,
      env: this.buildEnv(context, pptmHome),
      cwd: context.runWorkDir,
    };
  }

  private resolveSvgExport(
    args: Record<string, unknown>,
    context: AdapterContext,
  ): ResolvedCommand {
    const pptmHome = context.pptmHome ?? context.toolchainSnapshotRoot;
    if (!pptmHome) {
      throw new Error('svg-export requires PPTM_HOME or toolchain snapshot');
    }
    const projectDir = resolveWorkPath(stringArg(args, 'project_dir'), context.runWorkDir);
    const script = path.join(context.skillScriptsRoot, 'scripts', 'svg_native_export.py');
    const argv = [script, projectDir];
    return {
      executable: context.managedPythonPath,
      argv,
      env: this.buildEnv(context, pptmHome),
      cwd: context.runWorkDir,
    };
  }

  private resolveTemplateMerge(
    args: Record<string, unknown>,
    context: AdapterContext,
  ): ResolvedCommand {
    const sourcePptx = resolveWorkPath(stringArg(args, 'source_pptx'), context.runWorkDir);
    const templateArg = stringArg(args, 'template_path');
    const templatePath = templateArg.startsWith('assets/')
      ? resolveWorkPath(templateArg, context.skillScriptsRoot)
      : resolveWorkPath(templateArg, context.runWorkDir);
    const finalOutput = resolveWorkPath(stringArg(args, 'final_output'), context.runWorkDir);
    const configPath = resolveWorkPath(stringArg(args, 'config_path'), context.runWorkDir);
    const script = path.join(context.skillScriptsRoot, 'scripts', 'merge_into_template.py');
    const argv = [script, sourcePptx, templatePath, finalOutput, configPath];
    const pptmHome = context.pptmHome ?? context.toolchainSnapshotRoot;
    return {
      executable: context.managedPythonPath,
      argv,
      env: pptmHome ? this.buildEnv(context, pptmHome) : this.buildBaseEnv(),
      cwd: context.runWorkDir,
    };
  }

  private resolvePptxValidate(
    args: Record<string, unknown>,
    context: AdapterContext,
  ): ResolvedCommand {
    const pptxPath = resolveWorkPath(stringArg(args, 'pptx_path'), context.runWorkDir);
    const script = path.join(context.skillScriptsRoot, 'scripts', 'validate_pptx.py');
    const argv = [script, pptxPath];
    const pptmHome = context.pptmHome ?? context.toolchainSnapshotRoot;
    return {
      executable: context.managedPythonPath,
      argv,
      env: pptmHome ? this.buildEnv(context, pptmHome) : this.buildBaseEnv(),
      cwd: context.runWorkDir,
    };
  }

  private buildEnv(context: AdapterContext, pptmHome: string): Record<string, string> {
    return {
      ...this.buildBaseEnv(),
      PPTM_HOME: pptmHome,
    };
  }

  private buildBaseEnv(): Record<string, string> {
    return {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      TZ: 'UTC',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUNBUFFERED: '1',
      PYTHONNOUSERSITE: '1',
      PYTHONHOME: '',
      PYTHONPATH: '',
    };
  }
}

/**
 * validate_pptx.py 不以非零退出码报告问题（边界审查 §6 第一项）。
 * 解析 stdout 中的 issues 列表，有问题时覆盖为 failed。
 */
const interpretValidateOutput = (raw: AwaitedExecutionSnapshot): SkillCommandExecuteOutput => {
  const issues = parseValidateIssues(raw.stdout);
  if (issues.length === 0 && raw.status === 'succeeded' && isCompleteValidationReport(raw.stdout)) {
    return {
      executionId: raw.executionId,
      status: 'succeeded',
      message: 'OOXML 校验通过，未发现触发修复的结构问题',
      ...(raw.stdout ? { stdout: raw.stdout } : {}),
    };
  }
  const summary =
    issues.length > 0
      ? `OOXML 校验发现 ${issues.length} 个问题`
      : `校验脚本执行异常（状态 ${raw.status}）`;
  const structuredReport = issues.length > 0 ? JSON.stringify({ issues }, null, 2) : undefined;
  const combinedStdout = [raw.stdout, structuredReport].filter(Boolean).join('\n');
  return {
    executionId: raw.executionId,
    status: 'failed',
    message: summary,
    ...(combinedStdout ? { stdout: combinedStdout } : {}),
    ...(raw.stderr ? { stderr: raw.stderr } : {}),
  };
};

export const isCompleteValidationReport = (stdout: string): boolean => {
  const lines = stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.trim());
  return (
    lines.length === 2 &&
    /^== .+ {2}\(parts=[1-9]\d*, slides=[1-9]\d*\)$/u.test(lines[0] ?? '') &&
    lines[1] === 'OK: 未发现触发修复的结构问题'
  );
};

const parseValidateIssues = (stdout: string): string[] => {
  const issues: string[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('!!')) {
      issues.push(trimmed.slice(2).trim());
    }
  }
  return issues;
};

export const pptGenerationAdapterFactory: SkillAdapterFactory = {
  create(contentHashes) {
    return new PptGenerationAdapter(contentHashes);
  },
};

/** 导出供测试使用。 */
export const __internal = { parseValidateIssues, interpretValidateOutput };

/** Exact source package reviewed locally; no private content is distributed. */
export const supportedPptContentHashes = [
  '4681d64c1736d8162493e9b2da6d2a54bd079338ec46dd92ecdbdaa2f1ee52e1',
];

export function suggestedPptProfile(contentHash: string): RuntimeProfileDraft | undefined {
  if (!supportedPptContentHashes.includes(contentHash)) return undefined;
  const argumentsByCommand: Record<string, string[]> = {
    'project-init': ['project_name'],
    'icon-sync': ['project_dir', 'icons'],
    'svg-export': ['project_dir'],
    'template-merge': ['source_pptx', 'template_path', 'final_output', 'config_path'],
    'pptx-validate': ['pptx_path'],
  };
  return {
    commands: Object.entries(argumentsByCommand).map(([commandId, keys]) => ({
      commandId,
      label: commandId,
      executableKey: 'managed-python',
      timeoutMs: 300_000,
      argumentSchema: {
        type: 'object',
        additionalProperties: false,
        properties: Object.fromEntries(
          keys.map((key) => [
            key,
            key === 'icons' ? { type: 'array', items: { type: 'string' } } : { type: 'string' },
          ]),
        ),
        required: keys,
      },
      expectedOutputs: [],
      ...(commandId === 'pptx-validate' ? { validatorId: 'pptx-validate' } : {}),
    })),
    environmentRequirements: ['python', 'ppt-master'],
    outputContract: { outputPaths: [] },
  };
}
