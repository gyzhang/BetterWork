import type {
  RuntimeProfileDraft,
  SkillRuntimeDiscoveryFinding,
  SkillToolchainRequirement,
} from '@betterwork/agent-protocol';

/** 外部工具链只按 Skill 运行配置中的结构化声明绑定；缺省表示没有外部工具链。 */
export function declaredToolchainRequirements(
  profile: RuntimeProfileDraft | undefined,
): SkillToolchainRequirement[] {
  return profile?.toolchainRequirements ?? [];
}

/** 返回没有被当前 profile 声明覆盖的扫描线索；结果仍只是待确认提示，不会生成配置。 */
export function unconfiguredEnvironmentVariableClues(
  findings: readonly SkillRuntimeDiscoveryFinding[] | undefined,
  requirements: readonly SkillToolchainRequirement[],
): string[] {
  const environmentVariables = new Set(
    requirements.map((requirement) => requirement.environmentVariable.toUpperCase()),
  );
  const clues = new Set<string>();

  for (const finding of findings ?? []) {
    if (finding.kind === 'environment-variable') {
      const variable = finding.label.replace('发现外部目录变量 ', '').trim();
      if (!environmentVariables.has(variable.toUpperCase())) clues.add(variable);
    }
  }

  return [...clues];
}
