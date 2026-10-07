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

export const resolvePptExecutionOutputs = (
  command: RuntimeProfileDraft['commands'][number],
  resolved: ResolvedCommand,
  runWorkDir: string,
): string[] =>
  command.commandId === 'pptx-validate' && resolved.argv[1]
    ? [path.relative(runWorkDir, resolved.argv[1])]
    : (resolved.expectedOutputs ?? command.expectedOutputs);

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

const packageCommand = (
  commandId: string,
  label: string,
  properties: Record<string, unknown>,
  required: string[],
) => ({
  commandId,
  label,
  executableKey: 'managed-python',
  argumentSchema: {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  },
  timeoutMs: 300_000,
  expectedOutputs: [] as string[],
  ...(commandId === 'pptx-validate' ? { validatorId: 'pptx-validate' } : {}),
});

/** Current authoring package profile; the package-local manifest mirrors this reviewed contract. */
const pptGenerationExpertPreviousPackageHash =
  'dfc5086e9196d4c2fb7720b65d9cc903f27fae7e872fe90d4cf35847fb7e5188';
const pptGenerationExpertPreviousSplitPackageHash =
  'af96cb802a79e22a96ae29c6a6e542b8984321ca7195ddf3745249555988472f';
const pptGenerationExpertPreviousCurrentPackageHash =
  '10e9fd879e2ad98e277ab0aa77e3c548e998530c75065c581799f675381fffe5';
const pptGenerationExpertPreviousAlignedPackageHash =
  '2c32f14bd78fd63cc77baf6ced9d1d0f809822e97ec8bc7d6f0642ca4c36c5b7';
const pptGenerationExpertPackageHash =
  'cdb384ff5df07175a659140ead972e2f75abd983932878732b76c60f65263e3d';

const pptGenerationExpertPackageProfile: RuntimeProfileDraft = {
  commands: [
    packageCommand(
      'project-init',
      '初始化 PPT 项目',
      { project_name: { type: 'string', minLength: 1, maxLength: 100 } },
      ['project_name'],
    ),
    packageCommand(
      'icon-sync',
      '同步图标',
      {
        project_dir: { type: 'string', minLength: 1 },
        icons: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 100 },
      },
      ['project_dir', 'icons'],
    ),
    packageCommand(
      'svg-export',
      '检查并导出 SVG',
      { project_dir: { type: 'string', minLength: 1 } },
      ['project_dir'],
    ),
    packageCommand(
      'template-merge',
      '合并公司模板',
      {
        source_pptx: { type: 'string', minLength: 1 },
        template_path: { type: 'string', minLength: 1 },
        final_output: { type: 'string', minLength: 1 },
        config_path: { type: 'string', minLength: 1 },
      },
      ['source_pptx', 'template_path', 'final_output', 'config_path'],
    ),
    packageCommand('pptx-validate', '校验 PPTX', { pptx_path: { type: 'string', minLength: 1 } }, [
      'pptx_path',
    ]),
  ],
  environmentRequirements: [],
  pythonRequirement: '3.12',
  dependencyBundle: {
    id: 'ppt-generation-expert-darwin-arm64-cp312',
    lockPath: 'runtime/locks/ppt-generation-expert-darwin-arm64-cp312.json',
    wheelhousePath: 'runtime/wheelhouse',
  },
  toolchainRequirements: [
    {
      id: 'ppt-master',
      name: 'PPT Master',
      environmentVariable: 'PPTM_HOME',
      versionHint: '6.6.0',
      expectedCommit: '680de11f1bef4628b68d5daad9dffec569fbd51f',
    },
  ],
  outputContract: {
    reportPath: '.outputs/<executionId>/<outputId>.pptx.report.json',
    outputPaths: ['.outputs/<executionId>/<outputId>.pptx'],
  },
};

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

const pptMasterRoot = (context: AdapterContext): string | undefined =>
  context.toolchainRoots?.['ppt-master'] ?? context.pptmHome ?? context.toolchainSnapshotRoot;

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
    const pptmHome = pptMasterRoot(context);
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
    const pptmHome = pptMasterRoot(context);
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
    const pptmHome = pptMasterRoot(context);
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
      expectedOutputs: [
        path.relative(
          context.runWorkDir,
          path.join(projectDir, 'exports', 'betterwork-output.pptx'),
        ),
      ],
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
    const pptmHome = pptMasterRoot(context);
    return {
      executable: context.managedPythonPath,
      argv,
      env: pptmHome ? this.buildEnv(context, pptmHome) : this.buildBaseEnv(),
      cwd: context.runWorkDir,
      expectedOutputs: [path.relative(context.runWorkDir, finalOutput)],
    };
  }

  private resolvePptxValidate(
    args: Record<string, unknown>,
    context: AdapterContext,
  ): ResolvedCommand {
    const pptxPath = resolveWorkPath(stringArg(args, 'pptx_path'), context.runWorkDir);
    const script = path.join(context.skillScriptsRoot, 'scripts', 'validate_pptx.py');
    const argv = [script, pptxPath];
    const pptmHome = pptMasterRoot(context);
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
  pptGenerationExpertPreviousPackageHash,
  pptGenerationExpertPreviousSplitPackageHash,
  pptGenerationExpertPreviousCurrentPackageHash,
  pptGenerationExpertPreviousAlignedPackageHash,
  pptGenerationExpertPackageHash,
];

export function suggestedPptProfile(contentHash: string): RuntimeProfileDraft | undefined {
  if (
    contentHash === pptGenerationExpertPackageHash ||
    contentHash === pptGenerationExpertPreviousAlignedPackageHash ||
    contentHash === pptGenerationExpertPreviousCurrentPackageHash ||
    contentHash === pptGenerationExpertPreviousSplitPackageHash ||
    contentHash === pptGenerationExpertPreviousPackageHash
  ) {
    return pptGenerationExpertPackageProfile;
  }
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
    environmentRequirements: [],
    pythonRequirement: '3.12',
    dependencyLockId: 'ppt-generation-expert-darwin-arm64-cp312',
    toolchainRequirements: [
      {
        id: 'ppt-master',
        name: 'PPT Master',
        environmentVariable: 'PPTM_HOME',
        versionHint: '6.6.0',
      },
    ],
    outputContract: { outputPaths: [] },
  };
}
