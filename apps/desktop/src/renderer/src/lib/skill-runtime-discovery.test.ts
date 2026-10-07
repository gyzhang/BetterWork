import type {
  SkillRuntimeDiscoveryFinding,
  SkillToolchainRequirement,
} from '@betterwork/agent-protocol';
import { describe, expect, it } from 'vitest';

import { unconfiguredEnvironmentVariableClues } from './skill-runtime-discovery';

const finding = (
  kind: SkillRuntimeDiscoveryFinding['kind'],
  label: string,
): SkillRuntimeDiscoveryFinding => ({
  kind,
  sourcePath: 'SKILL.md',
  lineNumber: 1,
  label,
});

describe('unconfiguredEnvironmentVariableClues', () => {
  it('returns only external clues not covered by the declared toolchains', () => {
    const requirements: SkillToolchainRequirement[] = [
      { id: 'media-indexer', name: 'Media Indexer', environmentVariable: 'MEDIA_INDEXER_HOME' },
    ];

    expect(
      unconfiguredEnvironmentVariableClues(
        [
          finding('environment-variable', '发现外部目录变量 MEDIA_INDEXER_HOME'),
          finding('environment-variable', '发现外部目录变量 SKILL_DIR'),
          finding('python-script', '发现 Python 脚本'),
        ],
        requirements,
      ),
    ).toEqual(['SKILL_DIR', 'other-tool']);
  });

  it('returns external directory clues when no toolchain is declared', () => {
    expect(
      unconfiguredEnvironmentVariableClues(
        [finding('environment-variable', '发现外部目录变量 MEDIA_INDEXER_HOME')],
        [],
      ),
    ).toEqual(['MEDIA_INDEXER_HOME']);
  });

  it('deduplicates the same external clue found in multiple files', () => {
    expect(
      unconfiguredEnvironmentVariableClues(
        [
          finding('environment-variable', '发现外部目录变量 MEDIA_INDEXER_HOME'),
          finding('environment-variable', '发现外部目录变量 MEDIA_INDEXER_HOME'),
        ],
        [],
      ),
    ).toEqual(['MEDIA_INDEXER_HOME']);
  });
});
