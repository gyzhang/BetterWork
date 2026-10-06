import type {
  SkillRuntimeDiscoveryFinding,
  SkillToolchainRequirement,
} from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { unconfiguredExternalRuntimeClues } from './skill-runtime-discovery';

const finding = (
  kind: SkillRuntimeDiscoveryFinding['kind'],
  label: string,
): SkillRuntimeDiscoveryFinding => ({
  kind,
  sourcePath: 'SKILL.md',
  lineNumber: 1,
  label,
});

describe('unconfiguredExternalRuntimeClues', () => {
  it('returns only external clues not covered by the declared toolchains', () => {
    const requirements: SkillToolchainRequirement[] = [
      { id: 'ppt-master', name: 'PPT Master', environmentVariable: 'PPTM_HOME' },
    ];

    expect(
      unconfiguredExternalRuntimeClues(
        [
          finding('environment-variable', '发现外部目录变量 PPTM_HOME'),
          finding('toolchain-name', '发现外部工具链引用 ppt-master'),
          finding('environment-variable', '发现外部目录变量 SKILL_DIR'),
          finding('toolchain-name', '发现外部工具链引用 other-tool'),
          finding('python-script', '发现 Python 脚本'),
        ],
        requirements,
      ),
    ).toEqual(['SKILL_DIR', 'other-tool']);
  });

  it('returns all directory and toolchain clues when no toolchain is declared', () => {
    expect(
      unconfiguredExternalRuntimeClues(
        [
          finding('environment-variable', '发现外部目录变量 PPTM_HOME'),
          finding('toolchain-name', '发现外部工具链引用 ppt-master'),
        ],
        [],
      ),
    ).toEqual(['PPTM_HOME', 'ppt-master']);
  });

  it('deduplicates the same external clue found in multiple files', () => {
    expect(
      unconfiguredExternalRuntimeClues(
        [
          finding('environment-variable', '发现外部目录变量 PPTM_HOME'),
          finding('environment-variable', '发现外部目录变量 PPTM_HOME'),
        ],
        [],
      ),
    ).toEqual(['PPTM_HOME']);
  });
});
