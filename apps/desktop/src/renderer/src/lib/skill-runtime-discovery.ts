import type {
  RuntimeProfileDraft,
  SkillRuntimeDiscoveryFinding,
  SkillToolchainRequirement,
} from '@betterwork/agent-protocol';

/** 兼容早期 PPT profile 的单工具链字段，同时统一新 profile 的声明形状。 */
export function effectiveToolchainRequirements(
  profile: RuntimeProfileDraft | undefined,
): SkillToolchainRequirement[] {
  if (!profile) return [];
  if (profile.toolchainRequirements) return profile.toolchainRequirements;
  if (profile.environmentRequirements.includes('ppt-master')) {
    return [{ id: 'ppt-master', name: 'PPT Master', environmentVariable: 'PPTM_HOME' }];
  }
  return [];
}

/** 返回没有被当前 profile 声明覆盖的扫描线索；结果仍只是待确认提示，不会生成配置。 */
export function unconfiguredExternalRuntimeClues(
  findings: readonly SkillRuntimeDiscoveryFinding[] | undefined,
  requirements: readonly SkillToolchainRequirement[],
): string[] {
  const environmentVariables = new Set(
    requirements.map((requirement) => requirement.environmentVariable.toUpperCase()),
  );
  const toolchainNames = new Set(
    requirements.flatMap((requirement) => [
      requirement.id.toLowerCase(),
      requirement.name.toLowerCase(),
    ]),
  );
  const clues = new Set<string>();

  for (const finding of findings ?? []) {
    if (finding.kind === 'environment-variable') {
      const variable = finding.label.replace('发现外部目录变量 ', '').trim();
      if (!environmentVariables.has(variable.toUpperCase())) clues.add(variable);
    } else if (finding.kind === 'toolchain-name') {
      const name = finding.label.replace('发现外部工具链引用 ', '').trim();
      if (!toolchainNames.has(name.toLowerCase())) clues.add(name);
    }
  }

  return [...clues];
}
